import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation, SimState } from './sim/sim';
import { Store } from './db';
import { SnapshotMessage, TickMessage, WorldInfo, b64encode } from '../shared/types';

const PORT = Number(process.env.LETOPIS_PORT ?? 2222);
const DATA = path.resolve(process.env.LETOPIS_DATA ?? '/data');
const SPEED = Math.max(0.01, Number(process.env.LETOPIS_SPEED ?? 1)); // only for testing: 100 = 100x faster
const SAVE_EVERY_MS = 2 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, 'public');

mkdirSync(path.join(DATA, 'archive'), { recursive: true });
const STATE_FILE = path.join(DATA, 'world.json.gz');
const store = new Store(path.join(DATA, 'letopis.db'));

function log(...a: unknown[]) {
  console.log(new Date().toISOString(), ...a);
}

function loadOrCreate(): Simulation {
  if (existsSync(STATE_FILE)) {
    try {
      const st = JSON.parse(gunzipSync(readFileSync(STATE_FILE)).toString('utf8')) as SimState;
      const sim = new Simulation(st);
      log(`Продължава свят ${st.worldId}, година ${Math.floor(sim.year)}, ${st.people.length} души`);
      return sim;
    } catch (e) {
      log('Неуспешно зареждане, архивирам повредения файл и започвам нов свят', e);
      renameSync(STATE_FILE, path.join(DATA, 'archive', `broken-${Date.now()}.json.gz`));
    }
  }
  const seed = process.env.LETOPIS_SEED ? Number(process.env.LETOPIS_SEED) : undefined;
  const sim = new Simulation(null, seed);
  log(`Нов свят ${sim.s.worldId}`);
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

function tick() {
  const started = Date.now();
  try {
    sim.step();
    pendingEvents = sim.events;
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
    broadcast();
    if (sim.extinct) return restartWorld();
    if (Date.now() - lastSave > SAVE_EVERY_MS) {
      save();
      lastSave = Date.now();
    }
  } catch (e) {
    log('Грешка в симулацията', e);
  }
  const wait = Math.max(5, sim.tickMs(SPEED) - (Date.now() - started));
  setTimeout(tick, wait);
}

function restartWorld() {
  const old = sim.s.worldId;
  const summary = `Угасна в ${Math.floor(sim.year)} г. след ${sim.s.totalBorn} родени.`;
  store.addEvents(old, [{
    id: sim.s.nextEventId++, tick: sim.s.tick, year: sim.year, kind: 'end', importance: 3,
    text: 'Последният човек на този свят си отиде. Летописът се затваря. Скоро ще започне нов свят.',
    kids: 'Хората на този свят изчезнаха. Но скоро ще започне нов свят!',
  }]);
  store.endWorld(old, summary);
  save();
  renameSync(STATE_FILE, path.join(DATA, 'archive', `${old}.json.gz`));
  log(`Светът ${old} угасна. Започвам нов след 1 минута.`);
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

function snapshot(): SnapshotMessage {
  return {
    t: 'snapshot', time: sim.timeInfo(SPEED), bands: sim.bandViews(), people: sim.personRows(), explored: sim.exploredB64(), trees: sim.treesB64(),
    population: sim.s.people.length, totalBorn: sim.s.totalBorn, totalDied: sim.s.totalDied,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  const q = (k: string) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
  const world = sim.s.worldId;
  try {
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
      return r ? json(res, r) : json(res, { error: 'няма такава тайна' }, 404);
    }
    if (p.startsWith('/api/tree/')) {
      const t = sim.familyTree(Number(p.split('/').pop()));
      return t ? json(res, t) : json(res, { error: 'няма такъв човек' }, 404);
    }
    if (p.startsWith('/api/band/')) {
      const id = Number(p.split('/').pop());
      const live = sim.bandViews().find((b) => b.id === id);
      if (live) return json(res, { live });
      const gone = store.getGoneBand(world, id);
      return gone ? json(res, { gone }) : json(res, { error: 'няма такъв род' }, 404);
    }
    if (p.startsWith('/api/person/')) {
      const d = sim.personDetail(Number(p.split('/').pop()));
      return d ? json(res, d) : json(res, { error: 'няма такъв човек' }, 404);
    }
    // static files
    let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    const fresh = file.endsWith('index.html') || file.endsWith('version.json');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      // the page and its version must always be fresh; the rest carries ?v=<build>
      'cache-control': fresh ? 'no-cache' : 'public, max-age=86400',
    });
    createReadStream(file).pipe(res);
  } catch (e) {
    log('HTTP грешка', e);
    json(res, { error: 'вътрешна грешка' }, 500);
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();
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
    return;
  }
  const msg: TickMessage = {
    t: 'tick', time: sim.timeInfo(SPEED), bands: sim.bandViews(), people: sim.personRows(), events: pendingEvents,
    population: sim.s.people.length,
  };
  if (sim.exploredDirty) {
    msg.explored = sim.exploredB64();
    sim.exploredDirty = false;
  }
  if (sim.treeChanges.length) msg.trees = sim.treeChanges;
  sim.treeChanges = [];
  pendingEvents = [];
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

function shutdown() {
  log('Спирам, записвам света...');
  try {
    flush();
    save();
  } catch (e) {
    log('Грешка при запис', e);
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  log(`Летопис слуша на порт ${PORT}, данни в ${DATA}, скорост x${SPEED}`);
  flush();
  sim.events = [];
  save();
  tick();
});
