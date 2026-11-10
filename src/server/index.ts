import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createGzip, gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation, SimState } from './sim/sim';
import { Store } from './db';
import { Discovery, SnapshotMessage, TickMessage, WorldInfo, b64encode } from '../shared/types';
import { TECHS } from './sim/tech';
import { notify, notifyEnabled } from './notify';
import { Extras } from './extras';

const PORT = Number(process.env.LETOPIS_PORT ?? 2222);
const DATA = path.resolve(process.env.LETOPIS_DATA ?? '/data');
// set by the image build: 'dev' for the test image, empty for the real one
const CHANNEL = (process.env.LETOPIS_CHANNEL ?? '').trim();
const SPEED = Math.max(0.01, Number(process.env.LETOPIS_SPEED ?? 1)); // only for testing: 100 = 100x faster
const SAVE_EVERY_MS = 2 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, 'public');

mkdirSync(path.join(DATA, 'archive'), { recursive: true });
const STATE_FILE = path.join(DATA, 'world.json.gz');
const store = new Store(path.join(DATA, 'letopis.db'));
const extras = new Extras(store.db);

function log(...a: unknown[]) {
  console.log(new Date().toISOString(), ...a);
}

function loadOrCreate(): Simulation {
  if (existsSync(STATE_FILE)) {
    try {
      const st = JSON.parse(gunzipSync(readFileSync(STATE_FILE)).toString('utf8')) as SimState;
      const sim = new Simulation(st);
      log(`Continuing world ${st.worldId}, year ${Math.floor(sim.year)}, ${st.people.length} people`);
      return sim;
    } catch (e) {
      log('Could not load the world: archiving the broken file and starting a new world', e);
      renameSync(STATE_FILE, path.join(DATA, 'archive', `broken-${Date.now()}.json.gz`));
    }
  }
  const seed = process.env.LETOPIS_SEED ? Number(process.env.LETOPIS_SEED) : undefined;
  const sim = new Simulation(null, seed);
  log(`New world ${sim.s.worldId}`);
  return sim;
}

let sim = loadOrCreate();
store.startWorld(sim.s.worldId);
let worldInfo = makeWorldInfo();

function makeWorldInfo(): WorldInfo {
  const t = sim.t;
  const n = t.w * t.h;
  const height = new Uint8Array(n), temp = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    height[i] = Math.max(0, Math.min(255, Math.round((t.height[i] + 1) * 127.5)));
    temp[i] = Math.round(t.temp[i] * 255);
  }
  return {
    worldId: sim.s.worldId, seed: sim.s.seed, w: t.w, h: t.h,
    height: b64encode(height), biome: b64encode(t.biome), river: b64encode(t.river), temp: b64encode(temp),
    treeKinds: b64encode(sim.treeKind),
  };
}

function bindLookup() {
  sim.lookupDead = (id) => store.getDead(sim.s.worldId, id);
}
bindLookup();

function save() {
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, gzipSync(JSON.stringify(sim.serialize())));
  renameSync(tmp, STATE_FILE);
}

function flush() {
  store.addEvents(sim.s.worldId, sim.events);
  store.addDead(sim.s.worldId, sim.deadQueue);
  sim.deadQueue = [];
  store.addGoneBands(sim.s.worldId, sim.goneQueue);
  sim.goneQueue = [];
}

// ---------- the endless loop ----------

const CHRONICLE_YEARS = 100;
let lastSave = Date.now();
let pendingEvents: TickMessage['events'] = [];

// ---------- the watchers' clock (fork): pause, normal speed, fast forward ----------

/** the speeds the page offers; 0 = paused */
export const TIME_SCALES = [0, 1, 2, 5, 20, 100];
let timeScale = extras.getSetting('timeScale', 1);
if (!TIME_SCALES.includes(timeScale)) timeScale = 1;
let lastBroadcast = 0;
let tickTimer: NodeJS.Timeout | null = null;
const timeInfo = () => ({ ...sim.timeInfo(SPEED * Math.max(1, timeScale)), scale: timeScale });

function setTimeScale(v: number) {
  timeScale = v;
  extras.setSetting('timeScale', v);
  log(v === 0 ? 'Time paused' : `Time runs at x${v}`);
  // start at once on the new speed instead of waiting out the old (maybe very long) month
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = setTimeout(tick, 50);
  const msg = JSON.stringify({ t: 'time', time: timeInfo() });
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
}

function tick() {
  const started = Date.now();
  tickTimer = null;
  if (timeScale === 0) {
    // paused: nothing happens in the world; look again in a moment
    tickTimer = setTimeout(tick, 500);
    return;
  }
  try {
    sim.step();
    // events gather up while broadcasts are thinned out at high speed
    pendingEvents = pendingEvents.concat(sim.events);
    notify(sim.events, sim.s.worldId);
    extras.onTick(sim);
    flush();
    sim.events = [];
    // a short chronicle: the last 100 years, plus the great discoveries and moments for ever
    if (sim.s.tick % 12 === 6) store.prune(sim.s.worldId, Math.floor(sim.year) - CHRONICLE_YEARS);
    if (sim.s.tick % 12 === 0) {
      store.addStat(sim.s.worldId, {
        tick: sim.s.tick, year: Math.floor(sim.year), population: sim.s.people.length, bands: sim.s.bands.length,
        era: sim.s.era, techs: sim.s.discovered.length,
      });
    }
    // at high speed the page gets a picture a few times a second, not every month
    if (timeScale <= 5 || Date.now() - lastBroadcast >= 250) { broadcast(); lastBroadcast = Date.now(); }
    if (sim.extinct) return restartWorld();
    if (Date.now() - lastSave > SAVE_EVERY_MS) {
      save();
      lastSave = Date.now();
    }
  } catch (e) {
    log('Error in the simulation', e);
  }
  // never run flat out: rest at least half as long as the month took, so the page and its clicks are answered at once
  const spent = Date.now() - started;
  const wait = Math.max(5, spent * 0.5, sim.tickMs(SPEED * timeScale) - spent);
  tickTimer = setTimeout(tick, wait);
}

function restartWorld() {
  const old = sim.s.worldId;
  const summary = `Died out in the year ${Math.floor(sim.year)} after ${sim.s.totalBorn} births.`;
  store.addEvents(old, [{
    id: sim.s.nextEventId++, tick: sim.s.tick, year: sim.year, kind: 'end', importance: 3,
    text: 'Последният човек на този свят си отиде. Летописът се затваря. Скоро ще започне нов свят.',
    kids: 'Хората на този свят изчезнаха. Но скоро ще започне нов свят!',
    en: { text: 'The last person of this world has passed away. The chronicle closes. A new world will begin soon.',
      kids: 'The people of this world are gone. But a new world will begin soon!' },
  }]);
  store.endWorld(old, summary);
  save();
  renameSync(STATE_FILE, path.join(DATA, 'archive', `${old}.json.gz`));
  log(`World ${old} has died out. A new one starts in 1 minute.`);
  setTimeout(() => {
    sim = new Simulation(null);
    bindLookup();
    store.startWorld(sim.s.worldId);
    worldInfo = makeWorldInfo();
    flush();
    sim.events = [];
    save();
    for (const ws of clients) ws.send(JSON.stringify({ t: 'newworld' }));
    tick();
  }, 60_000);
}

// ---------- web ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function json(res: http.ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** every first discovery: what, who and when; old worlds are read back from the chronicle text */
function discoveries(): Discovery[] {
  const out: Discovery[] = [];
  const firsts = sim.s.firsts ?? [];
  const rows = firsts.length < TECHS.length ? store.discoveryRows(sim.s.worldId) : [];
  for (const tech of TECHS) {
    const f = firsts.find((x) => x.tech === tech.id);
    if (f) { out.push({ tech: tech.id, name: tech.name, pid: f.pid, who: f.name, band: f.band, year: f.year }); continue; }
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + esc(tech.text).replace(esc('{name}'), '(.+?)').replace(esc('{band}'), '(.+?)').replace(esc('{Band}'), '(.+?)') + '$');
    for (const r of rows) {
      const m = r.text.match(re);
      if (!m) continue;
      const nameFirst = tech.text.indexOf('{name}') < tech.text.search(/\{[Bb]and\}/) || !/\{[Bb]and\}/.test(tech.text);
      out.push({ tech: tech.id, name: tech.name, pid: r.person, who: nameFirst ? m[1] : m[2] ?? m[1], band: nameFirst ? m[2] ?? '' : m[1], year: r.year });
      break;
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

function snapshot(): SnapshotMessage {
  return {
    t: 'snapshot', time: timeInfo(), bands: sim.bandViews(), people: sim.personRows(), explored: sim.exploredB64(), trees: sim.treesB64(), roads: sim.roadsB64(),
    population: sim.s.people.length, totalBorn: sim.s.totalBorn, totalDied: sim.s.totalDied,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  // a number from the query; anything that is not a number counts as not given (fork: ?limit=abc gave a 500)
  const q = (k: string) => { const v = url.searchParams.has(k) ? Number(url.searchParams.get(k)) : NaN; return Number.isFinite(v) ? v : undefined; };
  const world = sim.s.worldId;
  try {
    if (p === '/api/time') {
      if (req.method === 'POST') {
        const v = Number(url.searchParams.get('scale'));
        if (!TIME_SCALES.includes(v)) return json(res, { error: 'speed must be one of ' + TIME_SCALES.join(', ') }, 400);
        setTimeScale(v);
      }
      return json(res, { scale: timeScale, scales: TIME_SCALES });
    }
    if (extras.handle(req, res, p, sim, json, notifyEnabled)) return;
    if (p === '/api/health') return json(res, { ok: true, world, year: Math.floor(sim.year), population: sim.s.people.length });
    if (p === '/api/world') return json(res, worldInfo);
    if (p === '/api/snapshot') return json(res, snapshot());
    if (p === '/api/chronicle') return json(res, store.chronicle(world, { before: q('before'), after: q('after'), min: q('min'), limit: q('limit') }));
    if (p === '/api/since') {
      const after = q('after') ?? 0;
      return json(res, { ...store.countSince(world, after), events: store.chronicle(world, { after, min: 2, limit: 200 }) });
    }
    if (p === '/api/heroes') return json(res, sim.heroes());
    if (p === '/api/stats') return json(res, store.stats(world));
    if (p === '/api/worlds') return json(res, store.worlds());
    if (p === '/api/secrets') return json(res, { found: sim.secretFinds() });
    if (p.startsWith('/api/secret/') && req.method === 'POST') {
      const r = sim.findSecret(Number(p.split('/').pop()));
      return r ? json(res, r) : json(res, { error: 'no such secret' }, 404);
    }
    if (p.startsWith('/api/tree/')) {
      const t = sim.familyTree(Number(p.split('/').pop()));
      return t ? json(res, t) : json(res, { error: 'no such person' }, 404);
    }
    if (p === '/api/discoveries') return json(res, discoveries());
    if (p.startsWith('/api/band/')) {
      const id = Number(p.split('/').pop());
      const live = sim.bandViews().find((b) => b.id === id);
      if (live) return json(res, { live });
      const gone = store.getGoneBand(world, id);
      return gone ? json(res, { gone }) : json(res, { error: 'no such clan' }, 404);
    }
    if (p.startsWith('/api/person/')) {
      const d = sim.personDetail(Number(p.split('/').pop()));
      return d ? json(res, d) : json(res, { error: 'no such person' }, 404);
    }
    // static files
    let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    const fresh = file.endsWith('index.html') || file.endsWith('version.json');
    // text (the game script, the atlas list) goes compressed: a few times smaller over a slow line
    const ext = path.extname(file);
    const zip = ['.js', '.css', '.json', '.html', '.svg', '.map', '.webmanifest'].includes(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      // the page and its version must always be fresh; the rest carries ?v=<build>
      'cache-control': fresh ? 'no-cache' : 'public, max-age=86400',
      ...(zip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    });
    if (CHANNEL && file.endsWith('index.html')) {
      // the test server says so in the browser tab: "Letopis - Dev"
      const page = readFileSync(file, 'utf8').replace('<title>Letopis</title>', `<title>Letopis - ${CHANNEL[0].toUpperCase()}${CHANNEL.slice(1)}</title>`);
      res.end(zip ? gzipSync(page) : page);
    } else if (zip) createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res);
    else createReadStream(file).pipe(res);
  } catch (e) {
    log('HTTP error', e);
    json(res, { error: 'internal error' }, 500);
  }
});

// every tick carries all the people: compressed it is about a fifth of the size
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 4096, zlibDeflateOptions: { level: 3 } } });
const clients = new Set<WebSocket>();
/** more than this waiting to go out to one page and it gets no more months until it catches up (fork) */
const SLOW_CLIENT_BYTES = 2 * 1024 * 1024;
const lagging = new WeakSet<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(snapshot()));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast() {
  if (!clients.size) {
    pendingEvents = [];
    sim.treeChanges = [];
    sim.roadChanges = [];
    return;
  }
  const msg: TickMessage = {
    t: 'tick', time: timeInfo(), bands: sim.bandViews(), people: sim.personRows(), events: pendingEvents,
    population: sim.s.people.length,
  };
  if (sim.exploredDirty) {
    msg.explored = sim.exploredB64();
    sim.exploredDirty = false;
  }
  if (sim.treeChanges.length) msg.trees = sim.treeChanges;
  sim.treeChanges = [];
  if (sim.roadChanges.length) msg.roads = sim.roadChanges;
  sim.roadChanges = [];
  pendingEvents = [];
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // a page that does not keep up (a hidden tab, a phone in a pocket, a slow line) must not make the server
    // queue month after month for it until it runs out of memory: skip it, and when it has caught up send it
    // one full picture instead of the months it missed (the trees, roads and explored land come as changes)
    if (ws.bufferedAmount > SLOW_CLIENT_BYTES) { lagging.add(ws); continue; }
    if (lagging.has(ws)) { lagging.delete(ws); ws.send(JSON.stringify(snapshot())); continue; }
    ws.send(data);
  }
}

function shutdown() {
  log('Stopping, saving the world...');
  try {
    flush();
    save();
  } catch (e) {
    log('Error while saving', e);
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  log(`Letopis is listening on port ${PORT}, data in ${DATA}, speed x${SPEED}`);
  flush();
  sim.events = [];
  save();
  tick();
});
