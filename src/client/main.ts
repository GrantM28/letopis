import { Application } from 'pixi.js';
import { Atlas, WorldRenderer, iso, TW, TH } from './render';
import {
  BandView, ChronicleEntry, Discovery, FamilyTree, GoneBand, TreeNode, PersonDetail, PersonRow, SnapshotMessage, TASKS, TASK_NAMES, TickMessage, WorldInfo, b64decode,
} from '../shared/types';
import { SECRET_COUNT, SecretFind, SecretSpot } from '../shared/secrets';
import { ERAS_BG, ERAS_EN, TECH_DESC, TECH_EN, TECH_LIST } from '../shared/i18n';
import { ERA_GATES } from '../shared/later_techs';
import {
  B, BL, CAUSE, CHIEF, DEED, EN, ERA, GENE, HERO, P, SECRET_KIND, T, TASK, TECH, TECH_ID, TITLE, VILLAGE, fmtYear, monthName, num, refName, setLang, translatePage,
} from './lang';

translatePage();

// ---------- small helpers ----------

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

// ---------- state ----------

let kids = store('letopis.kids', false);
let tour = store('letopis.tour', false);
let bands: BandView[] = [];
let people: PersonRow[] = [];
let worldId = '';
let lastEventId = 0;
let tickMs = 10000;
let lastTickAt = performance.now();
const feed: ChronicleEntry[] = [];

// ---------- pixi ----------

const app = new Application();
await app.init({
  resizeTo: window,
  background: '#0d1424',
  antialias: true,
  preference: 'webgl',
  resolution: Math.min(2, window.devicePixelRatio || 1),
  autoDensity: true,
});
$('#stage').appendChild(app.canvas);
const atlas = await Atlas.load('sprites', __BUILD__);
const r = new WorldRenderer(app, atlas);
r.peopleLayer.sortableChildren = true;

// ---------- camera ----------

const cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };
/** person the camera follows; the card stays beside the selected person */
let follow: number | null = null;
let cardPos: { x: number; y: number } | null = null;
let cardSide: 'left' | 'right' = 'left';
function applyCam() {
  r.world.scale.set(cam.zoom);
  r.world.position.set(app.screen.width / 2 - cam.x * cam.zoom, app.screen.height / 2 - cam.y * cam.zoom);
}
function lookAt(x: number, y: number, zoom?: number, instant = false) {
  const p = r.tileTop(x, y);
  cam.tx = p.x;
  cam.ty = p.y;
  if (zoom) cam.tz = zoom;
  if (instant) { cam.x = cam.tx; cam.y = cam.ty; cam.zoom = cam.tz; }
}

let dragging = false, moved = 0, last = { x: 0, y: 0 };
/** four more 1.4x steps in than before (4): close enough to see faces */
const MAX_ZOOM = 4 * 1.4 ** 4;
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
/** after a pinch the map stays put until every finger is up: the last finger must not drag it */
let pinched = false;
const canvas = app.canvas;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  dragging = true; moved = 0; last = { x: e.clientX, y: e.clientY };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinched = true;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const rect = canvas.getBoundingClientRect();
    if (pinchDist > 0) zoomBy(d / pinchDist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
    pinchDist = d;
    moved += 10;
    return;
  }
  if (!dragging || pinched) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  moved += Math.abs(dx) + Math.abs(dy);
  cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom;
  cam.tx = cam.x; cam.ty = cam.y;
  last = { x: e.clientX, y: e.clientY };
  if (moved > 6) { stopTour(); follow = null; }
});
const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (dragging && moved < 6 && pointers.size === 0 && !pinched) pick(e.clientX, e.clientY);
  if (pointers.size === 0) { dragging = false; pinched = false; }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });
/** zoom keeping the point under the cursor (or between the fingers) in place */
function zoomBy(f: number, sx = app.screen.width / 2, sy = app.screen.height / 2) {
  const z0 = cam.zoom;
  const z1 = Math.max(0.18, Math.min(MAX_ZOOM, z0 * f));
  const W = app.screen.width, H = app.screen.height;
  if (follow === null) {
    const wx = cam.x + (sx - W / 2) / z0, wy = cam.y + (sy - H / 2) / z0;
    cam.x = cam.tx = wx - (sx - W / 2) / z1;
    cam.y = cam.ty = wy - (sy - H / 2) / z1;
  }
  cam.zoom = cam.tz = z1;
}
$('#zoomIn').onclick = () => { cam.tz = Math.min(MAX_ZOOM, cam.tz * 1.4); };
$('#zoomOut').onclick = () => { cam.tz = Math.max(0.18, cam.tz / 1.4); };

function pick(sx: number, sy: number) {
  const wx = (sx - r.world.x) / cam.zoom, wy = (sy - r.world.y) / cam.zoom;
  // nearest person
  let best: number | null = null, bd = 14 / Math.max(0.6, cam.zoom) + 6;
  if (cam.zoom > 0.45) {
    for (const [id, p] of r.people) {
      const d = Math.hypot(p.c.x - wx, p.c.y - 5 - wy);
      if (d < bd) { bd = d; best = id; }
    }
  }
  if (best !== null) return showPerson(best);
  const secret = r.pickSecret(wx, wy);
  if (secret) return showSecret(secret);
  // a click on the map next to nobody closes the person card
  if (r.selectedId !== null) return closeCard();
  let bestBand: BandView | null = null, bb = 40;
  for (const b of bands) {
    const p = r.tileTop(b.x, b.y);
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < bb) { bb = d; bestBand = b; }
  }
  if (bestBand) showBand(bestBand);
  else closeCard();
}

// ---------- network ----------

function bandColors(): Map<number, number> {
  return new Map(bands.map((b) => [b.id, b.color]));
}

function applyTime(t: TickMessage['time'], population: number) {
  tickMs = t.tickMs;
  lastTickAt = performance.now();
  r.month = t.month;
  r.fauna.year = t.year;
  $('#year').textContent = fmtYear(t.year);
  $('#month').textContent = monthName(t.month);
  $('#era').textContent = ERA(t.eraName);
  $('#pop').textContent = num(population);
  $('#bandsCount').textContent = String(bands.length);
  const days = (Date.now() - t.startedAt) / 86400000;
  $('#age').textContent = days < 1 ? `${Math.round(days * 24)} ${T('ч.', 'h')}` : `${Math.floor(days)} ${T('дни', 'days')}`;
  currentEra = t.era;
  updateAgeProgress();
}

// ---------- progress through the ages ----------

let currentEra = 0;
/** the discovery that opens each age */
const GATES = new Map<number, string>([[1, 'agriculture'], [2, 'bronze'], ...ERA_GATES]);
const TECH_ID_BY_BG = new Map(TECH_LIST.map(([id, bg]) => [bg, id]));
/** every discovery some living clan knows, by id (bands carry Bulgarian names) */
function knownNow(): Set<string> {
  const s = new Set<string>();
  for (const b of bands) for (const t of b.techs) { const id = TECH_ID_BY_BG.get(t); if (id) s.add(id); }
  return s;
}
const eraName = (e: number) => (EN ? ERAS_EN[e] : ERAS_BG[e]);
const techLabel = (id: string) => (EN ? TECH_EN[id]?.name : TECH_LIST.find(([x]) => x === id)?.[1]) ?? id;

function updateAgeProgress() {
  const known = knownNow();
  const list = TECH_LIST.filter(([, , e]) => e === currentEra);
  const n = list.filter(([id]) => known.has(id)).length;
  $('#ageCount').textContent = `${n}/${list.length}`;
  ($('#ageBar') as HTMLElement).style.width = `${list.length ? (n / list.length) * 100 : 0}%`;
  const next = currentEra + 1;
  const gate = GATES.get(next);
  const nextEl = $('#ageNext');
  if (next < ERAS_EN.length && gate) {
    nextEl.textContent = `${T('Следва', 'Next')}: ${eraName(next)}`;
    $('#ageProg').title = T(`${eraName(next)} започва, когато някой открие „${techLabel(gate)}“.`, `The ${eraName(next)} begins when someone discovers ${techLabel(gate)}.`);
  } else {
    nextEl.textContent = T('Последната епоха', 'The last age');
    $('#ageProg').title = '';
  }
}

/** back to where the people are */
function showAllBands() {
  stopTour();
  follow = null;
  if (!bands.length) return;
  const xs = bands.map((b) => b.x), ys = bands.map((b) => b.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 8);
  // the iso tiles are about TW wide: fit the spread of the clans into the screen
  const fit = Math.min(app.screen.width, app.screen.height) / (span * TW * 0.75);
  lookAt(cx, cy, Math.max(0.25, Math.min(1.6, fit)));
}
$('#homeBtn').onclick = showAllBands;

function onSnapshot(m: SnapshotMessage) {
  bands = m.bands;
  people = m.people;
  if (m.trees) r.setTrees(m.trees);
  if (m.roads) r.setRoads(m.roads);
  r.setExplored(b64decode(m.explored));
  r.updateBands(bands, kids);
  r.updatePeople(people, bandColors(), 400);
  applyTime(m.time, m.population);
  $('#born').textContent = num(m.totalBorn);
  $('#died').textContent = num(m.totalDied);
  renderSide();
}

function onTick(m: TickMessage) {
  bands = m.bands;
  people = m.people;
  if (m.explored) r.setExplored(b64decode(m.explored));
  if (m.trees) r.updateTrees(m.trees);
  if (m.roads) r.updateRoads(m.roads);
  r.updateBands(bands, kids);
  r.updatePeople(people, bandColors(), m.time.tickMs);
  applyTime(m.time, m.population);
  for (const e of m.events) addEvent(e, true);
  // the open card keeps the age current while the years pass
  const ageEl = document.getElementById('pAge');
  if (ageEl && r.selectedId !== null) {
    const row = people.find((p) => p[0] === r.selectedId);
    if (row) ageEl.textContent = String(row[5]);
  }
  if (activeTab === 'bands') renderBandList();
  else if (activeTab === 'stats') renderSide();
}

/** reload the page when the server runs a newer build (after an update of the container) */
async function checkVersion() {
  try {
    const v = await fetch('version.json', { cache: 'no-store' }).then((r) => r.json());
    if (v.build && v.build !== __BUILD__) location.reload();
  } catch { /* offline: try again later */ }
}
setInterval(() => void checkVersion(), 60_000);
// the version, so it is easy to see that an update arrived; the tooltip says when it was built
{
  $('#build').textContent = `ver. ${__VERSION__}`;
  const t = new Date(parseInt(__BUILD__, 36));
  if (!Number.isNaN(t.getTime())) $('#build').title = `${T('от', 'built')} ${t.toLocaleString(EN ? 'en-GB' : 'bg-BG')}`;
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'snapshot') onSnapshot(m);
    else if (m.t === 'tick') onTick(m);
    else if (m.t === 'newworld') location.reload();
  };
  ws.onopen = () => { $('#conn').classList.remove('off'); void checkVersion(); };
  ws.onclose = () => {
    $('#conn').classList.add('off');
    setTimeout(connect, 3000);
  };
}

// ---------- chronicle ----------

function evText(e: ChronicleEntry): string {
  const src = EN && e.en ? e.en : e;
  return kids && src.kids ? src.kids : src.text;
}

/** the text with the names of people and bands as blue links */
function linkedText(e: ChronicleEntry): string {
  const text = evText(e);
  // English entries name people and bands in English
  const english = EN && !!e.en;
  const refs = (e.refs ?? []).map((r0) => (english ? { ...r0, n: refName(r0.n, !!r0.p) } : r0)).sort((a, b) => b.n.length - a.n.length);
  // longest names first, never two links over the same letters
  const taken: { a: number; z: number; r: (typeof refs)[number] }[] = [];
  for (const r of refs) {
    let from = 0;
    for (;;) {
      const a = text.indexOf(r.n, from);
      if (a < 0) break;
      const z = a + r.n.length;
      if (!taken.some((t) => a < t.z && z > t.a)) taken.push({ a, z, r });
      from = z;
    }
  }
  taken.sort((x, y) => x.a - y.a);
  let out = '', at = 0;
  for (const t of taken) {
    out += esc(text.slice(at, t.a));
    const attr = t.r.p ? `data-person="${t.r.p}"` : `data-band="${t.r.b}"`;
    out += `<a href="#" class="ref" ${attr}>${esc(text.slice(t.a, t.z))}</a>`;
    at = t.z;
  }
  return out + esc(text.slice(at));
}

const ICON: Record<string, string> = {
  discovery: '💡', rediscovery: '🔁', settle: '🏘️', colony: '🏘️', split: '🚶', death: '🕯️', twins: '👶', hunt: '🦣',
  winter: '❄️', secret: '✨', drought: '☀️', extinct: '🌑', lost: '📜', meet: '🤝', learn: '📚', era: '⭐', milestone: '👥', genesis: '🌅', merge: '🔗', marriage: '💞', end: '🌑',
};

function eventHtml(e: ChronicleEntry): string {
  return `<li class="ev imp${e.importance}">
    <span class="ev-icon">${ICON[e.kind] ?? '•'}</span>
    <div><div class="ev-year">${fmtYear(e.year)}</div><div class="ev-text">${linkedText(e)}</div></div></li>`;
}

function addEvent(e: ChronicleEntry, live: boolean) {
  if (feed.some((f) => f.id === e.id)) return;
  feed.unshift(e);
  if (feed.length > 300) feed.pop();
  lastEventId = Math.max(lastEventId, e.id);
  save(`letopis.seen.${worldId}`, lastEventId);
  if (live && e.importance >= 2) toast(e);
  if (live && tour && e.importance >= 2 && e.bandId) {
    const b = bands.find((x) => x.id === e.bandId);
    if (b) { lookAt(b.x, b.y, Math.max(cam.tz, 1.4)); tourHold = performance.now() + 20000; }
  }
  if (activeTab === 'chronicle') {
    const list = $('#chronicleList');
    if (feedFilter(e)) list.insertAdjacentHTML('afterbegin', eventHtml(e));
    while (list.children.length > 300) list.lastElementChild?.remove();
  }
}

/** chronicle filters: which kinds of entries each chip shows */
const FEED_KINDS: Record<string, { bg: string; en: string; kinds?: string[] }> = {
  all: { bg: 'Всичко', en: 'All' },
  big: { bg: 'Важно', en: 'Important' },
  discovery: { bg: 'Открития', en: 'Discoveries', kinds: ['discovery', 'rediscovery', 'learn', 'era', 'lost'] },
  life: { bg: 'Живот', en: 'Life', kinds: ['death', 'twins', 'marriage', 'milestone', 'genesis'] },
  clans: { bg: 'Родове', en: 'Clans', kinds: ['settle', 'colony', 'split', 'meet', 'merge', 'extinct', 'end'] },
  nature: { bg: 'Природа', en: 'Nature', kinds: ['hunt', 'winter', 'drought', 'secret'] },
};
let feedKind = store('letopis.feedKind', store('letopis.onlyBig', false) ? 'big' : 'all');
if (!FEED_KINDS[feedKind]) feedKind = 'all';
/** older pages fetched by themselves for the current filter */
let autoLoads = 0;
const feedFilter = (e: ChronicleEntry) => {
  if (feedKind === 'all') return true;
  if (feedKind === 'big') return e.importance >= 2;
  return FEED_KINDS[feedKind].kinds!.includes(e.kind);
};

function toast(e: ChronicleEntry) {
  const t = document.createElement('div');
  t.className = `toast imp${e.importance}${e.kind === 'era' ? ' era' : ''}`;
  t.innerHTML = `<span class="ev-icon">${ICON[e.kind] ?? '•'}</span><div><div class="ev-year">${fmtYear(e.year)}</div>${linkedText(e)}</div>`;
  t.onclick = (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-person],[data-band]');
    if (el) { ev.preventDefault(); openRef(el); }
  };
  $('#toasts').prepend(t);
  setTimeout(() => t.classList.add('out'), 9000);
  setTimeout(() => t.remove(), 10000);
  while ($('#toasts').children.length > 3) $('#toasts').lastElementChild?.remove();
}

// ---------- side panel ----------

let activeTab = store('letopis.tab', 'chronicle');
/** ages opened in the discoveries tab; until one is touched, only the current age is open */
const openAges = new Set<number>();
let openAgesTouched = false;
/** the clans tab: search text and sort order */
let bandQuery = '';
let bandSort = store<'size' | 'knowledge' | 'name'>('letopis.bandSort', 'size');

function renderSide() {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
  const body = $('#sideBody');
  if (activeTab === 'chronicle') {
    const shown = feed.filter(feedFilter);
    body.innerHTML = `<div class="chips" role="group" aria-label="${T('Филтър', 'Filter')}">${Object.entries(FEED_KINDS).map(([k, v]) =>
      `<button class="chip" data-kind="${k}" aria-pressed="${k === feedKind}">${esc(EN ? v.en : v.bg)}</button>`).join('')}</div>
      <ul id="chronicleList" class="events">${shown.map(eventHtml).join('')}</ul>
      ${shown.length ? '' : `<p class="empty-note">${T('Няма такива записи наскоро. Зареди по-старите.', 'No entries like this lately. Load older ones.')}</p>`}
      <button id="more" class="btn ghost">${T('По-стари записи', 'Older entries')}</button>`;
    body.querySelectorAll<HTMLButtonElement>('.chip').forEach((c) => {
      c.onclick = () => { feedKind = c.dataset.kind!; save('letopis.feedKind', feedKind); autoLoads = 0; renderSide(); };
    });
    $('#more').onclick = loadOlder;
    // a narrow filter over only the latest entries can come up empty: reach back a few pages by itself
    if (shown.length < 15 && autoLoads < 4) { autoLoads++; void loadOlder(); }
  } else if (activeTab === 'discoveries') {
    body.innerHTML = `<p class="muted">${T('Зареждам...', 'Loading...')}</p>`;
    api<Discovery[]>('/api/discoveries').then((ds) => {
      if (activeTab !== 'discoveries') return;
      const known = new Set(ds.map((d) => d.tech));
      const done = (d: Discovery) => `<li><b>${esc(TECH_ID(d.tech, d.name))}</b> - ${T('открито от', 'discovered by')} ${d.pid ? `<a href="#" class="ref" data-person="${d.pid}">${esc(P(d.who))}</a>` : esc(P(d.who))}${d.band ? ` <span class="muted">(${esc(BL(d.band.replace(/^рода/, 'Родът').replace(/^селото/, 'Селото')))})</span>` : ''} ${T('през', 'in')} <span class="yr">${fmtYear(d.year)}</span></li>`;
      const byId = new Map(ds.map((d) => [d.tech, d]));
      // every age with all its discoveries, like the secrets: the ones still to come are grey and only described
      const eras = [...new Set(TECH_LIST.map(([, , e]) => e))];
      const todo = ([id, bg]: [string, string, number]) => `<li class="todo"><b>${esc(TECH_ID(id, bg))}</b> - ${esc(TECH_DESC[id]?.[EN ? 1 : 0] ?? T('още не е открито', 'not discovered yet'))}</li>`;
      const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
      body.innerHTML = `<div class="overall">
          <div class="age-line"><span>${T('Открити знания', 'Discoveries made')}</span><b>${known.size}/${TECH_LIST.length}</b></div>
          <div class="meter"><i style="width:${pct(known.size, TECH_LIST.length)}%"></i></div>
        </div>
        <p class="lead">${T('Всяко знание е открито за първи път от някого в този свят. Сивите още чакат своя откривател.', 'Each one was first found by someone in this world. The grey ones are still waiting for their discoverer.')}</p>
        ${eras.map((e) => {
          const list = TECH_LIST.filter(([, , x]) => x === e);
          const n = list.filter(([id]) => byId.has(id)).length;
          const state = e === currentEra ? 'current' : n === list.length ? 'done' : n ? 'started' : '';
          const open = openAges.has(e) || (!openAgesTouched && e === currentEra);
          return `<details class="tech-age ${state}" data-era="${e}"${open ? ' open' : ''}><summary>
              <span class="tech-era">${esc(EN ? ERAS_EN[e] : ERAS_BG[e])}${e === currentEra ? ` <span class="tag">${T('сега', 'now')}</span>` : ''}</span>
              <span class="tech-count">${n}/${list.length}</span>
              <div class="meter"><i style="width:${pct(n, list.length)}%"></i></div></summary>
            <ul class="discoveries">${list.map((t) => (byId.has(t[0]) ? done(byId.get(t[0])!) : todo(t))).join('')}</ul></details>`;
        }).join('')}`;
      body.querySelectorAll<HTMLDetailsElement>('details.tech-age').forEach((d) => {
        d.addEventListener('toggle', () => {
          openAgesTouched = true;
          const e = Number(d.dataset.era);
          if (d.open) openAges.add(e); else openAges.delete(e);
        });
      });
    });
  } else if (activeTab === 'bands') {
    const sorts: [typeof bandSort, string, string][] = [['size', 'Най-големи', 'Largest'], ['knowledge', 'Най-учени', 'Most knowledge'], ['name', 'По име', 'By name']];
    body.innerHTML = `<label class="search"><svg class="ic"><use href="#i-search"/></svg>
        <input id="bandSearch" type="search" placeholder="${T('Търси род или село', 'Find a clan or village')}" value="${esc(bandQuery)}" autocomplete="off"></label>
      <div class="chips">${sorts.map(([k, bg, en]) => `<button class="chip" data-sort="${k}" aria-pressed="${k === bandSort}">${T(bg, en)}</button>`).join('')}</div>
      <p class="lead" id="bandSummary"></p>
      <ul class="bands" id="bandList"></ul>`;
    const input = $('#bandSearch') as HTMLInputElement;
    input.oninput = () => { bandQuery = input.value; renderBandList(); };
    body.querySelectorAll<HTMLButtonElement>('.chip[data-sort]').forEach((c) => {
      c.onclick = () => {
        bandSort = c.dataset.sort as typeof bandSort; save('letopis.bandSort', bandSort);
        body.querySelectorAll('.chip[data-sort]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        renderBandList();
      };
    });
    renderBandList();
  } else if (activeTab === 'heroes') {
    body.innerHTML = `<p class="muted">${T('Зареждам...', 'Loading...')}</p>`;
    api<{ id: number; name: string; age: number; band: string; deeds: string[] }[]>('/api/heroes').then((hs) => {
      if (activeTab !== 'heroes') return;
      body.innerHTML = hs.length ? `<ul class="heroes">${hs.map((h) => `<li data-person="${h.id}"><b>${esc(P(h.name))}</b>
        <span class="muted">${h.age} ${T('г.', 'y')} · ${esc(BL(h.band))}</span>${h.deeds.length ? `<div>${h.deeds.map((x) => esc(DEED(x))).join('<br>')}</div>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted">${T('Още никой не е направил нещо велико. Търпение.', 'Nobody has done anything great yet. Patience.')}</p>`;
    }).catch(() => {
      if (activeTab === 'heroes') body.innerHTML = `<p class="muted">${T('Не успях да заредя личностите. Опитай пак след малко.', 'Could not load the people. Try again in a moment.')}</p>`;
    });
  } else if (activeTab === 'stats') {
    renderStats(body);
  } else if (activeTab === 'secrets') {
    api<{ found: SecretFind[] }>('/api/secrets').then(({ found }) => {
      if (activeTab !== 'secrets') return;
      const at = new Map(found.map((f) => [f.k, f.at]));
      const when = (ms: number) => {
        if (!ms) return '';
        const d = new Date(ms), two = (n: number) => String(n).padStart(2, '0');
        return EN ? ` - Found on ${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} at ${two(d.getHours())}:${two(d.getMinutes())}`
          : ` - Открит на ${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} в ${two(d.getHours())}:${two(d.getMinutes())}ч.`;
      };
      body.innerHTML = `<p class="muted">${T(`Намерени ${found.length} от ${SECRET_COUNT}. Тайните са мънички и се крият из проучената земя. Зимата ги затрупва със сняг.`,
        `Found ${found.length} of ${SECRET_COUNT}. The secrets are tiny and hide in the explored land. Winter buries them in snow.`)}</p>
        <ol class="secrets">${Array.from({ length: SECRET_COUNT }, (_, k) => at.has(k)
          ? `<li class="found"><b>${esc(HERO(k))}</b>${when(at.get(k)!)}</li>`
          : `<li>${T('Намери ме', 'Find me')}</li>`).join('')}</ol>`;
    });
  }
}

/** the list part of the clans tab: redrawn every month without touching the search box */
function renderBandList() {
  const list = document.getElementById('bandList');
  if (!list) return;
  const label = (b: BandView) => (b.settlementName ? VILLAGE(b.settlementName) : B(b.name));
  const q = bandQuery.trim().toLowerCase();
  const shown = bands.filter((b) => !q || label(b).toLowerCase().includes(q) || B(b.name).toLowerCase().includes(q));
  shown.sort(bandSort === 'name' ? (a, b) => label(a).localeCompare(label(b), EN ? 'en' : 'bg')
    : bandSort === 'knowledge' ? (a, b) => b.techs.length - a.techs.length || b.size - a.size
    : (a, b) => b.size - a.size);
  const max = Math.max(1, ...bands.map((b) => b.size));
  const villages = bands.filter((b) => b.settled).length;
  const sum = $('#bandSummary');
  if (sum) sum.textContent = T(`${bands.length} рода · ${villages} уседнали в села · ${bands.length - villages} скитат`,
    `${bands.length} clans · ${villages} settled in villages · ${bands.length - villages} wandering`);
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  list.innerHTML = shown.length ? shown.map((b) => `
    <li data-band="${b.id}"><span class="dot" style="background:${hex(b.color)}"></span>
    <div><b>${esc(label(b))}</b>${b.settlementName ? `<small> · ${esc(B(b.name))}</small>` : ''}
      <span class="badge${b.settled ? ' village' : ''}">${b.settled ? T('село', 'village') : T('скитат', 'nomads')}</span>
      <div class="muted">${b.size} ${T('души', 'people')} · ${T('знания', 'knowledge')}: ${b.techs.length}${b.chief ? ` · ${esc(CHIEF(b.chief.title))} ${esc(P(b.chief.name))}` : ''}</div>
      <div class="band-size"><i style="width:${(b.size / max) * 100}%;background:${hex(b.color)}"></i></div></div></li>`).join('')
    : `<li class="empty-note">${T('Няма такъв род.', 'No clan by that name.')}</li>`;
}

let statsAt = 0;
async function renderStats(body: HTMLElement) {
  if (performance.now() - statsAt < 15000 && body.querySelector('canvas')) return;
  statsAt = performance.now();
  const rows = await api<{ year: number; population: number; bands: number; era: number; techs: number }[]>('/api/stats');
  if (activeTab !== 'stats') return;
  const techsKnown = new Set(bands.flatMap((b) => b.techs));
  body.innerHTML = `
    <div class="kpis">
      <div><span>${T('Родени', 'Born')}</span><b id="born2">${$('#born').textContent}</b></div>
      <div><span>${T('Починали', 'Died')}</span><b>${$('#died').textContent}</b></div>
      <div><span>${T('Знания', 'Knowledge')}</span><b>${techsKnown.size}</b></div>
    </div>
    <h3>${T('Население', 'Population')}</h3><canvas id="popChart" height="160"></canvas>
    <h3>${T('Какво знаят хората', 'What people know')}</h3><div class="techs">${[...techsKnown].map((t) => `<span class="pill">${esc(TECH(t))}</span>`).join('') || `<span class="muted">${T('Нищо още', 'Nothing yet')}</span>`}</div>`;
  const c = $('#popChart') as HTMLCanvasElement;
  const w = (c.width = c.clientWidth * 2), h = (c.height = 320);
  const g = c.getContext('2d')!;
  if (rows.length < 2) return;
  const max = Math.max(...rows.map((r2) => r2.population)) * 1.1;
  const styles = getComputedStyle(document.documentElement);
  g.strokeStyle = styles.getPropertyValue('--accent').trim() || '#e0a84f';
  g.fillStyle = (styles.getPropertyValue('--accent').trim() || '#e0a84f') + '33';
  g.lineWidth = 4;
  g.beginPath();
  rows.forEach((r2, i) => {
    const x = (i / (rows.length - 1)) * w, y = h - (r2.population / max) * (h - 20);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
  g.fillStyle = styles.getPropertyValue('--muted').trim();
  g.font = '22px system-ui';
  g.fillText(fmtYear(rows[0].year), 8, h - 8);
  const endLabel = fmtYear(rows[rows.length - 1].year);
  g.fillText(endLabel, w - g.measureText(endLabel).width - 8, h - 8);
  g.fillText(`${T('макс.', 'max')} ${num(Math.round(max / 1.1))}`, 8, 26);
}

async function loadOlder() {
  const oldest = feed.length ? feed[feed.length - 1].id : undefined;
  const more = await api<ChronicleEntry[]>(`/api/chronicle?limit=80${oldest ? `&before=${oldest}` : ''}`);
  for (const e of more) if (!feed.some((f) => f.id === e.id)) feed.push(e);
  if (activeTab === 'chronicle') renderSide();
}

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
  b.onclick = () => { activeTab = b.dataset.tab!; save('letopis.tab', activeTab); statsAt = 0; renderSide(); };
});
$('#sideBody').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-band]');
  if (!el) return;
  e.preventDefault();
  openRef(el);
});

/** a name was clicked: go there if it still lives, otherwise just tell about it */
function openRef(el: HTMLElement) {
  const pid = Number(el.dataset.person), bid = Number(el.dataset.band);
  if (pid) showPerson(pid);
  else if (bid) {
    const b = bands.find((x) => x.id === bid);
    if (b) { stopTour(); lookAt(b.x, b.y, 1.6); showBand(b); }
    else showGoneBand(bid);
  }
}

/** "Основан от X, дошъл от Y" for a band card; the first bands came with the world */
function originHtml(founder?: { id: number; name: string } | null, from?: { id: number; name: string } | null): string {
  if (!founder && !from) return `<div class="muted">${T('Един от първите родове на света.', 'One of the first clans of the world.')}</div>`;
  const who = founder ? `<a href="#" data-person="${founder.id}">${esc(P(founder.name))}</a>` : T('неизвестен', 'unknown');
  const src = from ? ` · ${T('дошли от', 'came from')} <a href="#" data-band="${from.id}">${esc(BL(from.name))}</a>` : '';
  return `<div>${T('Основан от', 'Founded by')} ${who}${src}</div>`;
}

async function showGoneBand(id: number) {
  const r2 = await api<{ live?: BandView; gone?: GoneBand }>(`/api/band/${id}`).catch(() => null);
  if (r2?.live) { const b = r2.live; stopTour(); lookAt(b.x, b.y, 1.6); showBand(b); return; }
  const g = r2?.gone;
  if (!g) { openCard(`<h2>${T('Изгубен в мъглата на времето', 'Lost in the mists of time')}</h2><p class="muted">${T('Летописът не помни повече за този род.', 'The chronicle remembers nothing more of this clan.')}</p>`); return; }
  openCard(`
    <h2><span class="dot" style="background:#${g.color.toString(16).padStart(6, '0')}"></span> ${esc(g.settlementName ? VILLAGE(g.settlementName) : B(g.name))}</h2>
    <div class="muted">${g.settlementName ? `${esc(B(g.name))} · ` : ''}${fmtYear(g.foundedYear)} – ${fmtYear(g.endedYear)}</div>
    ${originHtml(g.founder, g.from)}
    <p>${g.end === 'extinct' ? T('Този род угасна. Няма останали хора от него.', 'This clan died out. No one from it is left.')
      : EN ? `The last of this clan joined ${esc(BL(g.end.replace(/^Родът/, 'рода').replace(/^Селото/, 'селото')))}.`
      : `Последните от този род се присъединиха към ${esc(g.end.replace(/^Родът/, 'рода').replace(/^Селото/, 'селото'))}.`}</p>
    <h3>${T('Какво знаеха', 'What they knew')}</h3><div class="techs">${g.techs.map((t) => `<span class="pill">${esc(TECH(t))}</span>`).join('') || `<span class="muted">${T('Нищо', 'Nothing')}</span>`}</div>`);
}

// ---------- cards ----------

function openCard(html: string, beside = false, extra = '') {
  $('#cardBody').innerHTML = html;
  $('#card').hidden = false;
  $('#card').classList.toggle('beside', beside);
  $('#card').classList.toggle('wide', extra === 'wide');
  if (!beside) { follow = null; r.select(null); ($('#card') as HTMLElement).style.cssText = ''; }
}
function closeCard() {
  $('#card').hidden = true;
  follow = null;
  r.select(null);
}
$('#cardClose').onclick = closeCard;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
$('#card').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-tree],[data-band]');
  if (!el) return;
  e.preventDefault();
  if (el.dataset.tree) showTree(Number(el.dataset.tree));
  else openRef(el);
});

async function showPerson(id: number) {
  const d = await api<PersonDetail>(`/api/person/${id}`).catch(() => null);
  if (!d) return;
  // the first people have no parents: the world starts with them
  const link = (p: { id: number; name: string } | null) => (p ? `<a href="#" data-person="${p.id}">${esc(P(p.name))}</a>` : `<span class="muted">${d.generation <= 1 ? T('от първите хора', 'one of the first people') : T('неизвестен', 'unknown')}</span>`);
  const genes = Object.entries(d.genes).map(([k, v]) => `<div class="gene"><span>${esc(GENE(k))}</span><div class="bar"><i style="width:${v}%"></i></div></div>`).join('');
  const alive = d.diedYear === null;
  // someone at home (not drawn) steps out to be followed
  if (alive && !r.people.has(id) && people.some((p) => p[0] === id)) r.select(id);
  const live = r.people.get(id);
  const beside = !!(live && alive) && window.innerWidth > 760;
  if (live && alive) { stopTour(); follow = id; r.select(id); cam.tz = Math.max(cam.tz, 2); }
  openCard(`
    <div class="person-head"><div class="avatar ${d.sex ? 'f' : 'm'}">${d.sex ? '👩' : '👨'}</div>
      <div><h2>${esc(P(d.name))}</h2>
      <div class="muted">${alive ? `<span id="pAge">${d.age}</span> ${T('години', 'years')} · ${esc(BL(d.bandName))}` : `${fmtYear(d.bornYear)} – ${fmtYear(d.diedYear!)}, ${esc(CAUSE(d.cause ?? ''))} ${T('на', 'at')} ${d.age}`}</div>
      ${d.title ? `<div class="title">${esc(TITLE(d.title))}</div>` : ''}
      ${alive && d.task ? `<div>${T('Сега', 'Now')} ${esc(TASK(r.nightTask(id) ?? d.task))}</div>` : ''}<div class="muted">${T(`${d.generation}-о поколение`, `generation ${d.generation}`)}</div></div></div>
    <div class="genes">${genes}</div>
    <dl class="family">
      <dt>${T('Майка', 'Mother')}</dt><dd>${link(d.mother)}</dd><dt>${T('Баща', 'Father')}</dt><dd>${link(d.father)}</dd>
      <dt>${T('Партньор', 'Partner')}</dt><dd>${link(d.partner)}</dd>
      <dt>${T('Деца', 'Children')}</dt><dd>${d.children.length ? d.children.map((c) => `<a href="#" data-person="${c.id}" class="${c.alive ? '' : 'dead'}">${esc(P(c.name))}</a>`).join(', ') : `<span class="muted">${T('няма', 'none')}</span>`}</dd>
    </dl>
    <button class="btn tree-btn" data-tree="${d.id}">${T('Родословие', 'Family tree')}</button>
    ${d.deeds.length ? `<h3>${T('Дела', 'Deeds')}</h3><ul class="deeds">${d.deeds.map((x) => `<li>${esc(DEED(x))}</li>`).join('')}</ul>` : ''}`, beside);
  if (live && alive) { follow = id; r.select(id); }
}

/** follow the chosen person and keep the card next to them */
function followStep() {
  const id = r.selectedId;
  if (id === null) return;
  const p = r.people.get(id);
  if (!p) { r.select(null); follow = null; $('#card').classList.remove('beside'); ($('#card') as HTMLElement).style.cssText = ''; return; }
  // follow the smooth walking line, never the hops and the idle wiggle, so nothing shakes
  if (follow === id) { cam.tx = p.pos.x; cam.ty = p.pos.y - 6; }
  const card = $('#card') as HTMLElement;
  if (card.hidden || !card.classList.contains('beside')) { cardPos = null; return; }
  // while the camera follows, the person stays in the middle, so the card holds still beside them
  const ax = follow === id ? cam.x : p.pos.x, ay = follow === id ? cam.y : p.pos.y - 6;
  const sx = r.world.x + ax * cam.zoom, sy = r.world.y + ay * cam.zoom;
  const w = card.offsetWidth, h = card.offsetHeight;
  const W = app.screen.width, H = app.screen.height;
  const gap = 28 + 8 * cam.zoom;
  const side = document.body.classList.contains('side-hidden') ? 0 : ($('.side') as HTMLElement).offsetWidth + 16;
  // stay on the same side while it fits, so the card does not swap back and forth
  const leftFits = sx - gap - w >= 12, rightFits = sx + gap + w <= W - side - 12;
  if (cardSide === 'left' ? !leftFits && rightFits : !rightFits && leftFits) cardSide = cardSide === 'left' ? 'right' : 'left';
  const left = cardSide === 'left' ? Math.max(12, sx - gap - w) : Math.min(sx + gap, W - side - w - 12);
  const top = Math.max(12, Math.min(H - h - 12, sy - h / 2));
  // move with the person; a soft catch-up only smooths a switch of side
  if (!cardPos) cardPos = { x: left, y: top };
  cardPos.x += (left - cardPos.x) * 0.25;
  cardPos.y += (top - cardPos.y) * 0.25;
  card.style.transform = `translate3d(${cardPos.x.toFixed(1)}px, ${cardPos.y.toFixed(1)}px, 0)`;
}

async function showSecret(spot: SecretSpot) {
  const kind = SECRET_KIND(spot.kind);
  const res = await fetch(`/api/secret/${spot.k}`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as { first: boolean; found: number } | null;
  r.markSecret(spot.k);
  if (activeTab === 'secrets') renderSide();
  openCard(`
    <h2>✨ ${T('№', '#')}${spot.k + 1} ${esc(HERO(spot.k))}</h2>
    <div class="muted">${esc(kind.name[0].toUpperCase() + kind.name.slice(1))}</div>
    <p>${esc(kind.text)}</p>
    <div class="muted">${res ? `${res.first ? T('Ти си първият, който я откри!', 'You are the first to find it!') : T('Някой вече я е открил преди теб.', 'Someone found it before you.')} ${T('Намерени тайни', 'Secrets found')}: ${res.found} ${T('от', 'of')} ${SECRET_COUNT}.` : ''}</div>`);
}

/** family tree: three generations of ancestors, and the straight lines back to the first people */
async function showTree(id: number) {
  const t = await api<FamilyTree>(`/api/tree/${id}`).catch(() => null);
  if (!t) return;
  // "11 785 – 11 708 г. пр.н.е.": the era is written once when both years share it
  const years = (n: TreeNode) => {
    const a = fmtYear(n.bornYear);
    if (n.diedYear === null) return `${T('от', 'since')} ${a}`;
    const b = fmtYear(n.diedYear);
    const tail = a.match(EN ? / BC$/ : / г\..*$/)?.[0] ?? '';
    return tail && b.endsWith(tail) ? `${a.slice(0, -tail.length)} – ${b}` : `${a} – ${b}`;
  };
  const box = (n: TreeNode | null | undefined, gen: number): string => {
    if (!n) return `<div class="tbox empty">${gen <= 1 ? T('от първите хора', 'one of the first people') : T('неизвестен', 'unknown')}</div>`;
    const parents = n.mother !== undefined || n.father !== undefined
      ? `<div class="tpar">${box(n.father, n.generation - 1)}${box(n.mother, n.generation - 1)}</div>` : '';
    return `<div class="tn"><div class="tbox ${n.sex ? 'f' : 'm'}${n.diedYear !== null ? ' dead' : ''}" data-tree="${n.id}" title="${T('Покажи неговото родословие', 'Show their family tree')}">
      <b>${esc(P(n.name))}</b><small>${years(n)}</small></div>${parents}</div>`;
  };
  const line = (title: string, l: TreeNode[]) => l.length
    ? `<details class="tline"><summary>${title}: ${T(`${l.length} поколения назад, до`, `${l.length} generations back, to`)} ${esc(P(l[l.length - 1].name))}</summary><ol>${l.map((n) => `<li><a href="#" data-tree="${n.id}">${esc(P(n.name))}</a> <span class="muted">${years(n)}</span></li>`).join('')}</ol></details>`
    : '';
  const root = t.root;
  openCard(`
    <h2>${T('Родословие', 'Family tree')}</h2>
    <div class="muted"><a href="#" data-person="${root.id}">${esc(P(root.name))}</a> · ${T(`${root.generation}-о поколение · цъкни някого, за да видиш неговите предци`, `generation ${root.generation} · click someone to see their ancestors`)}</div>
    <div class="tree">${box(root, root.generation)}</div>
    ${line(T('По майчина линия', 'Mother\'s line'), t.motherLine)}
    ${line(T('По бащина линия', 'Father\'s line'), t.fatherLine)}`, false, 'wide');
}

function showBand(b: BandView) {
  const members = people.filter((p) => p[4] === b.id);
  const kidsN = members.filter((p) => p[5] < 12).length;
  const tasks = new Map<string, number>();
  for (const p of members) {
    const t = TASK(r.nightTask(p[0], p[3]) ?? TASK_NAMES[TASKS[p[3]]]);
    tasks.set(t, (tasks.get(t) ?? 0) + 1);
  }
  openCard(`
    <h2><span class="dot" style="background:#${b.color.toString(16).padStart(6, '0')}"></span> ${esc(b.settlementName ? VILLAGE(b.settlementName) : B(b.name))}</h2>
    <div class="muted">${b.settlementName ? `${esc(B(b.name))} · ` : ''}${T('от', 'since')} ${fmtYear(b.founded)} · ${b.settled ? T('уседнали', 'settled') : T('скитат по земята', 'wandering the land')}</div>
    ${b.chief ? `<div>${esc(CHIEF(b.chief.title))}: <a href="#" data-person="${b.chief.id}">${esc(P(b.chief.name))}</a></div>` : ''}
    ${originHtml(b.founder, b.from)}
    <div class="kpis"><div><span>${T('Хора', 'People')}</span><b>${b.size}</b></div><div><span>${T('Деца', 'Children')}</span><b>${kidsN}</b></div><div><span>${T('Запаси', 'Food')}</span><b>${b.food}</b></div></div>
    <h3>${T('Какво правят сега', 'What they are doing')}</h3><ul class="deeds">${[...tasks].sort((a, c) => c[1] - a[1]).map(([t, n]) => `<li>${n} ${esc(t)}</li>`).join('')}</ul>
    <h3>${T('Какво знаят', 'What they know')}</h3><div class="techs">${b.techs.map((t) => `<span class="pill">${esc(TECH(t))}</span>`).join('') || `<span class="muted">${T('Още нищо', 'Nothing yet')}</span>`}</div>
    <h3>${T('Хората', 'The people')}</h3><div class="names">${members.slice(0, 60).map((p) => `<a href="#" data-person="${p[0]}">#${p[0]}</a>`).join(', ')}</div>`);
  // names come from the server one by one; fill them in lazily
  const links = [...document.querySelectorAll<HTMLAnchorElement>('#cardBody .names a')];
  links.slice(0, 40).forEach(async (a) => {
    const d = await api<PersonDetail>(`/api/person/${a.dataset.person}`).catch(() => null);
    if (d) a.textContent = P(d.name);
  });
}

// ---------- while you were away ----------

async function whileAway(seen: number) {
  const lastVisit = store<number>('letopis.lastVisit', 0);
  save('letopis.lastVisit', Date.now());
  if (!seen) return;
  const res = await api<{ total: number; big: number; events: ChronicleEntry[] }>(`/api/since?after=${seen}`);
  if (res.total < 5) return;
  const hours = lastVisit ? Math.round((Date.now() - lastVisit) / 3600000) : 0;
  const top = res.events.filter((e) => e.importance >= 3).slice(-12);
  const rest = res.events.filter((e) => e.importance === 2).slice(-8);
  openCard(`<h2>${T('Докато те нямаше', 'While you were away')}${hours ? ` (${hours} ${T('ч.', 'h')})` : ''}</h2>
    <p class="muted">${T(`Записани са ${num(res.total)} нови събития, ${res.big} от тях важни.`, `${num(res.total)} new events were written, ${res.big} of them important.`)}</p>
    ${top.length ? `<h3>${T('Най-важното', 'The highlights')}</h3><ul class="events">${top.map(eventHtml).join('')}</ul>` : ''}
    ${rest.length ? `<h3>${T('Още', 'More')}</h3><ul class="events">${rest.map(eventHtml).join('')}</ul>` : ''}`);
}

// ---------- tour mode: the camera wanders by itself ----------

let tourHold = 0;
function stopTour() {
  if (!tour) return;
  tour = false;
  save('letopis.tour', false);
  $('#tourBtn').setAttribute('aria-pressed', 'false');
}
$('#tourBtn').onclick = () => {
  tour = !tour;
  save('letopis.tour', tour);
  $('#tourBtn').setAttribute('aria-pressed', String(tour));
  tourHold = 0;
};
$('#tourBtn').setAttribute('aria-pressed', String(tour));
function tourStep(now: number) {
  if (!tour || now < tourHold || !bands.length) return;
  const b = bands[Math.floor(Math.random() * bands.length)];
  lookAt(b.x, b.y, 1.1 + Math.random() * 0.9);
  tourHold = now + 15000;
}

$('#kidsBtn').onclick = () => {
  kids = !kids;
  save('letopis.kids', kids);
  document.body.classList.toggle('kids', kids);
  $('#kidsBtn').setAttribute('aria-pressed', String(kids));
  r.updateBands(bands, kids);
  renderSide();
};
document.body.classList.toggle('kids', kids);
$('#kidsBtn').setAttribute('aria-pressed', String(kids));
let night = store('letopis.night', true);
r.night = night;
$('#nightBtn').setAttribute('aria-pressed', String(night));
$('#nightBtn').onclick = () => {
  night = !night;
  r.night = night;
  save('letopis.night', night);
  $('#nightBtn').setAttribute('aria-pressed', String(night));
};
// the panel can hide; a small tab at the edge brings it back, and the choice is remembered
const toggleSide = () => save('letopis.sideHidden', document.body.classList.toggle('side-hidden'));
if (store('letopis.sideHidden', false)) document.body.classList.add('side-hidden');
$('#sideToggle').onclick = toggleSide;
$('#langBtn').textContent = EN ? 'БГ' : 'EN';
$('#langBtn').title = EN ? 'Български' : 'English';
$('#langBtn').onclick = () => setLang(EN ? 'bg' : 'en');
$('#sideHandle').onclick = toggleSide;

// ---------- frame loop ----------

app.ticker.add((t) => {
  // one bad frame must not freeze the page: Pixi stops its ticker on an error
  try { frameStep(t); } catch (e) { console.error(e); }
});
function frameStep(t: { deltaMS: number; deltaTime: number }) {
  const now = performance.now();
  tourStep(now);
  followStep();
  const k = 1 - Math.pow(0.001, t.deltaMS / 1000 / (tour ? 4 : 0.6));
  cam.x += (cam.tx - cam.x) * k;
  cam.y += (cam.ty - cam.y) * k;
  cam.zoom += (cam.tz - cam.zoom) * k;
  applyCam();
  r.frame(t.deltaTime, Date.now());
  // nothing moves when zoomed far out: while the camera rests too, draw a few times a second only
  const resting = Math.abs(cam.tx - cam.x) + Math.abs(cam.ty - cam.y) < 0.5 && Math.abs(cam.tz - cam.zoom) < 0.002;
  const fps = r.still && resting && !tour && !dragging && pointers.size === 0 ? 12 : 0;
  if (app.ticker.maxFPS !== fps) app.ticker.maxFPS = fps;
  const left = Math.max(0, tickMs - (now - lastTickAt));
  ($('#tickBar') as HTMLElement).style.width = `${100 - (left / tickMs) * 100}%`;
}

// ---------- start ----------

const info = await api<WorldInfo>('/api/world');
worldId = info.worldId;
const seenBefore = store<number>(`letopis.seen.${worldId}`, 0);
r.setWorld(info);
api<{ found: SecretFind[] }>('/api/secrets').then((s) => r.setSecrets(s.found.map((f) => f.k))).catch(() => r.setSecrets([]));
const snap = await api<SnapshotMessage>('/api/snapshot');
onSnapshot(snap);
const recent = await api<ChronicleEntry[]>('/api/chronicle?limit=120');
for (const e of recent.reverse()) addEvent(e, false);
renderSide();
if (bands.length) {
  const cx = bands.reduce((s, b) => s + b.x, 0) / bands.length;
  const cy = bands.reduce((s, b) => s + b.y, 0) / bands.length;
  lookAt(cx, cy, 1.3, true);
} else {
  const c = iso(info.w / 2, info.h / 2);
  cam.x = cam.tx = c.x; cam.y = cam.ty = c.y;
}
void TW; void TH;
$('#loading').remove();
connect();
whileAway(seenBefore);
