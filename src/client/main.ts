import { Application } from 'pixi.js';
import { Atlas, WorldRenderer, iso, TW, TH } from './render';
import {
  BandView, ChronicleEntry, Discovery, FamilyTree, GoneBand, TreeNode, PersonDetail, PersonRow, SnapshotMessage, TASKS, TASK_NAMES, TickMessage, WorldInfo, b64decode,
} from '../shared/types';
import { SECRET_COUNT, SecretFind, SecretSpot } from '../shared/secrets';
import { ERAS_BG, ERAS_EN, TECH_DESC, TECH_EN, TECH_LIST } from '../shared/i18n';
import { ERA_GATES } from '../shared/later_techs';
import { barList, lineChart } from './charts';
import { Minimap } from './minimap';
import {
  B, BL, CAUSE, CHIEF, DEED, EN, ERA, GENE, HERO, P, SECRET_KIND, T, TASK, TECH, TECH_ID, TITLE, VILLAGE, fmtYear, monthName, num, refName, translatePage,
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
  clockFromServer(t.scale ?? 1);
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

// ---------- the speed of time (fork): pause, normal, fast forward ----------

const SCALES = [0, 1, 2, 5, 20, 100];
let timeScale = 1;
/** the speed before pausing, so Space and Play bring it back */
let lastRunning = 1;
/** the speed we asked for and the server has not confirmed yet (months already on their way still carry the old one) */
let wantedScale: number | null = null;
let wantedAt = 0;
function clockFromServer(scale: number) {
  if (wantedScale !== null) {
    if (scale !== wantedScale && performance.now() - wantedAt < 15000) return;
    wantedScale = null;
  }
  showClock(scale);
}
function showClock(scale: number) {
  timeScale = scale;
  if (scale > 0) lastRunning = scale;
  $('#clockPause').setAttribute('aria-pressed', String(scale === 0));
  $('#clockPlay').setAttribute('aria-pressed', String(scale === 1));
  $('#clockFast').setAttribute('aria-pressed', String(scale > 1));
  $('#clockLabel').textContent = scale === 0 ? 'Paused' : `${scale}×`;
  document.body.classList.toggle('paused', scale === 0);
}
async function setScale(scale: number) {
  wantedScale = scale;
  wantedAt = performance.now();
  showClock(scale); // at once; the server confirms to everyone watching
  await fetch(`/api/time?scale=${scale}`, { method: 'POST' }).catch(() => null);
}
$('#clockPause').onclick = () => void setScale(0);
$('#clockPlay').onclick = () => void setScale(1);
$('#clockFast').onclick = () => {
  const next = SCALES.find((s) => s > Math.max(1, timeScale));
  void setScale(next ?? 2);
};
document.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : null;
  if (e.code !== 'Space' || el?.closest('input, textarea, button')) return;
  e.preventDefault();
  void setScale(timeScale === 0 ? lastRunning : 0);
});

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

// ---------- helping the world: a blessing, rain, a feast ----------

const ACT_INFO: Record<string, { icon: string; name: string; text: string; who: string }> = {
  bless: { icon: '🌟', name: 'Send a blessing', text: 'Food finds its way to the clan.', who: 'the hungriest clan' },
  rain: { icon: '🌧️', name: 'Send rain', text: 'A long warm rain over the land around the clan.', who: 'the driest land' },
  feast: { icon: '🍖', name: 'Call a feast', text: 'The clan invites its neighbours to a great feast.', who: 'the biggest clan' },
  inspire: { icon: '💭', name: 'Inspire an inventor', text: 'For two years the clan is four times as likely to discover something.', who: 'the biggest clan' },
  calm: { icon: '🕊️', name: 'Calm a feud', text: 'The clan makes peace with its rivals.', who: 'the clan with the most rivals' },
};
const WANT_TEXT: Record<string, string> = { bless: 'pray for food', rain: 'pray for rain', calm: 'pray for peace' };
type ActState = { kind: string; ready: boolean; readyIn: number; last: { at: number; band: string } | null };
type PrayerView = { id: number; band: number; name: string; color: number; want: string; year: number; fadesIn: number };
const mins = (ms: number) => (ms >= 3600000 ? `${Math.floor(ms / 3600000)} h ${Math.ceil((ms % 3600000) / 60000)} min` : `${Math.max(1, Math.ceil(ms / 60000))} min`);
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/** one power: on a chosen clan, or (without one) where it is needed most */
async function useAct(kind: string, band?: number): Promise<string> {
  const res = await fetch(`/api/act/${kind}${band ? `?band=${band}` : ''}`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as
    { ok?: boolean; band?: string; bandId?: number; error?: string; readyIn?: number } | null;
  if (res?.ok && res.bandId) {
    const b = bands.find((x) => x.id === res.bandId);
    if (b) { stopTour(); lookAt(b.x, b.y, Math.max(cam.tz, 1.4)); }
    return `Done: ${esc(res.band ?? '')} will remember it.`;
  }
  return res?.readyIn ? `Not yet: ready again in ${mins(res.readyIn)}.` : `Not now: ${esc(res?.error ?? 'the server did not answer')}.`;
}

async function showActs(note = '') {
  const data = await api<{ acts: ActState[]; prayers: PrayerView[] }>('/api/acts').catch(() => null);
  if (!data) return;
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  openCard(`<h2>✨ Help the world</h2>
    <p class="muted">The world lives on its own, but now and then you may lend a hand. Each power waits a while before it can be used again
      (the same wait for everyone watching), and everything you do is written in the chronicle. To help one particular clan, open its card.</p>
    ${note ? `<p class="act-note">${note}</p>` : ''}
    <h3>Prayers <small>${data.prayers.length}</small></h3>
    ${data.prayers.length ? `<ul class="prayers">${data.prayers.map((p) => `<li>
        <span class="dot" style="background:${hex(p.color)}"></span>
        <span class="pr-body"><a href="#" class="ref" data-band="${p.band}">${esc(p.name)}</a> ${WANT_TEXT[p.want] ?? 'pray'}
          <small>since ${fmtYear(p.year)} · fades in ${mins(p.fadesIn)}</small></span>
        <button class="btn pr-answer" data-prayer="${p.id}">Answer</button></li>`).join('')}</ul>`
      : '<p class="muted">No clan is praying right now. Clans in trouble pray now and then: a hungry clan for food, a dry one for rain, a feuding one for peace.</p>'}
    <h3>Powers</h3>
    <div class="acts">${data.acts.map((a) => {
      const i = ACT_INFO[a.kind];
      if (!i) return '';
      return `<button class="act" data-act="${a.kind}" ${a.ready ? '' : 'disabled'}>
        <span class="act-icon">${i.icon}</span><span class="act-body"><b>${i.name}</b><small>${i.text} Goes to ${i.who}.</small>
        <small class="act-state">${a.ready ? 'Ready' : `Ready again in ${mins(a.readyIn)}`}${a.last ? ` · last: ${esc(a.last.band)}, ${ago(a.last.at)}` : ''}</small></span></button>`;
    }).join('')}</div>`);
  document.querySelectorAll<HTMLButtonElement>('#cardBody .act').forEach((btn) => {
    btn.onclick = async () => { btn.disabled = true; void showActs(await useAct(btn.dataset.act!)); };
  });
  document.querySelectorAll<HTMLButtonElement>('#cardBody .pr-answer').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const res = await fetch(`/api/prayer/${btn.dataset.prayer}`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as { ok?: boolean; band?: string; bandId?: number; error?: string } | null;
      if (res?.ok && res.bandId) { const b = bands.find((x) => x.id === res.bandId); if (b) { stopTour(); lookAt(b.x, b.y, Math.max(cam.tz, 1.4)); } }
      void showActs(res?.ok ? `Your answer reached ${esc(res.band ?? '')}.` : `Too late: ${esc(res?.error ?? 'the server did not answer')}.`);
      void refreshPrayerBadge();
    };
  });
}
$('#actsBtn').onclick = () => void showActs();

/** a small number on the Help button while clans are praying */
async function refreshPrayerBadge() {
  const data = await api<{ prayers: PrayerView[] }>('/api/acts').catch(() => null);
  const n = data?.prayers.length ?? 0;
  const btn = $('#actsBtn');
  let badge = btn.querySelector<HTMLElement>('.count');
  if (!badge) { badge = document.createElement('span'); badge.className = 'count'; btn.appendChild(badge); }
  badge.textContent = String(n);
  badge.hidden = n === 0;
}
setInterval(() => void refreshPrayerBadge(), 30_000);
void refreshPrayerBadge();


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
  mini?.setExplored(r.explored);
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
  if (m.explored) { r.setExplored(b64decode(m.explored)); mini?.setExplored(r.explored); }
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
    else if (m.t === 'time') { tickMs = m.time.tickMs; lastTickAt = performance.now(); clockFromServer(m.time.scale ?? 1); }
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
  // world events (events.ts)
  flood: '🌊', plague: '🦠', harvest: '🌾', comet: '☄️', eclipse: '🌘', quake: '🌋', fire: '🔥', festival: '🎉', wonder: '🏛️',
  expedition: '🧭', blessing: '🌟', rain: '🌧️', feast: '🍖',
  // clan relations (relations.ts)
  alliance: '🤝', rivalry: '😠', quarrel: '🗯️', aid: '🎁', peace: '🕊️', estranged: '🍂',
  // learning clans and the watchers' help (brain.ts, events.ts)
  learned: '🧠', inspired: '💭', prayer: '🙏',
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
  life: { bg: 'Живот', en: 'Life', kinds: ['death', 'twins', 'marriage', 'milestone', 'genesis', 'plague', 'festival', 'feast'] },
  clans: { bg: 'Родове', en: 'Clans', kinds: ['settle', 'colony', 'split', 'meet', 'merge', 'extinct', 'end', 'wonder', 'expedition', 'alliance', 'rivalry', 'quarrel', 'aid', 'peace', 'estranged', 'learned'] },
  nature: { bg: 'Природа', en: 'Nature', kinds: ['hunt', 'winter', 'drought', 'secret', 'flood', 'harvest', 'comet', 'eclipse', 'quake', 'fire', 'blessing', 'rain', 'prayer', 'inspired'] },
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
/** the people tab: everyone alive (searchable, a page at a time) or only the notable ones */
let peopleView = store<'all' | 'notable'>('letopis.peopleView', 'all');
let peopleSort = store('letopis.peopleSort', 'old');
let peopleQuery = '';
let peopleShown = 0;

type PersonListRow = { id: number; name: string; age: number; sex: number; band: string; bandId: number; task: string; chief: boolean; deeds: number; children: number; gen: number };
async function loadPeople(more: boolean) {
  const list = document.getElementById('peopleList');
  if (!list) return;
  if (!more) peopleShown = 0;
  const res = await api<{ total: number; people: PersonListRow[] }>(`/api/people?q=${encodeURIComponent(peopleQuery)}&sort=${peopleSort}&offset=${peopleShown}&limit=100`).catch(() => null);
  if (!res || activeTab !== 'heroes' || peopleView !== 'all') return;
  const color = new Map(bands.map((b) => [b.id, `#${b.color.toString(16).padStart(6, '0')}`]));
  const html = res.people.map((p) => `<li data-person="${p.id}">
      <span class="avatar sm ${p.sex ? 'f' : 'm'}">${p.age < 12 ? '🧒' : p.age >= 60 ? (p.sex ? '👵' : '👴') : p.sex ? '👩' : '👨'}</span>
      <div><b>${esc(p.name)}</b>${p.chief ? ' <span class="badge village">chief</span>' : ''}${p.deeds ? ` <span class="badge">${p.deeds} deed${p.deeds > 1 ? 's' : ''}</span>` : ''}
        <div class="muted"><span class="dot sm" style="background:${color.get(p.bandId) ?? '#888'}"></span>${esc(p.band)} · ${p.age} y · ${esc(TASK(TASK_NAMES[p.task as keyof typeof TASK_NAMES] ?? p.task))}${p.children ? ` · ${p.children} children` : ''}</div></div></li>`).join('');
  if (more) list.insertAdjacentHTML('beforeend', html); else list.innerHTML = html || '<li class="empty-note">Nobody by that name.</li>';
  peopleShown += res.people.length;
  $('#peopleCount').textContent = `${num(res.total)} ${peopleQuery ? 'found' : 'people alive'} · showing ${num(peopleShown)}`;
  ($('#peopleMore') as HTMLElement).hidden = peopleShown >= res.total;
}

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
    const sorts: [string, string][] = [['old', 'Oldest'], ['young', 'Youngest'], ['name', 'Name'], ['deeds', 'Most deeds'], ['children', 'Most children']];
    body.innerHTML = `<div class="chips seg">
        <button class="chip" data-pview="all" aria-pressed="${peopleView === 'all'}">Everyone</button>
        <button class="chip" data-pview="notable" aria-pressed="${peopleView === 'notable'}">Notable</button></div>
      <div id="peopleBody"></div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-pview]').forEach((c) => {
      c.onclick = () => { peopleView = c.dataset.pview as typeof peopleView; save('letopis.peopleView', peopleView); renderSide(); };
    });
    const pb = $('#peopleBody');
    if (peopleView === 'notable') {
      pb.innerHTML = '<p class="muted">Loading...</p>';
      api<{ id: number; name: string; age: number; band: string; deeds: string[] }[]>('/api/heroes').then((hs) => {
        if (activeTab !== 'heroes' || peopleView !== 'notable') return;
        pb.innerHTML = `<p class="lead">People with deeds to their name, and the old ones who have seen the most.</p>` + (hs.length ? `<ul class="heroes">${hs.map((h) => `<li data-person="${h.id}"><b>${esc(P(h.name))}</b>
          <span class="muted">${h.age} y · ${esc(BL(h.band))}</span>${h.deeds.length ? `<div>${h.deeds.map((x) => esc(DEED(x))).join('<br>')}</div>` : ''}</li>`).join('')}</ul>`
          : '<p class="muted">Nobody has done anything great yet. Patience.</p>');
      }).catch(() => { if (activeTab === 'heroes') pb.innerHTML = '<p class="muted">Could not load the people. Try again in a moment.</p>'; });
    } else {
      pb.innerHTML = `<label class="search"><svg class="ic"><use href="#i-search"/></svg>
          <input id="peopleSearch" type="search" placeholder="Find a person or clan" value="${esc(peopleQuery)}" autocomplete="off"></label>
        <div class="chips">${sorts.map(([k, n]) => `<button class="chip" data-psort="${k}" aria-pressed="${k === peopleSort}">${n}</button>`).join('')}</div>
        <p class="lead" id="peopleCount"></p><ul class="people" id="peopleList"></ul>
        <button class="btn ghost" id="peopleMore" hidden>Show more</button>`;
      const input = $('#peopleSearch') as HTMLInputElement;
      let timer = 0;
      input.oninput = () => { clearTimeout(timer); timer = window.setTimeout(() => { peopleQuery = input.value; void loadPeople(false); }, 250); };
      pb.querySelectorAll<HTMLButtonElement>('[data-psort]').forEach((c) => {
        c.onclick = () => {
          peopleSort = c.dataset.psort!; save('letopis.peopleSort', peopleSort);
          pb.querySelectorAll('[data-psort]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
          void loadPeople(false);
        };
      });
      $('#peopleMore').onclick = () => void loadPeople(true);
      void loadPeople(false);
    }

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

interface History {
  series: { year: number; population: number; bands: number; villages: number; births: number; deaths: number; techs: number; era: number; avgAge: number; children: number; elders: number; span?: number }[];
  causes: Record<string, number>;
  events: Record<string, number>;
  eras: { year: number; text: string }[];
  records: {
    largestBand?: { size: number; name: string; year: number };
    oldest?: { age: number; name: string; id: number; year: number };
    peak?: { population: number; year: number };
    mostClans?: { bands: number; year: number };
  };
  gone: { extinct: number; merged: number };
  totalBorn: number; totalDied: number; year: number; era: number; notify: boolean;
  relations?: { alliances: number; rivalries: number };
}

const EVENT_NAMES: Record<string, string> = {
  discovery: 'First discoveries', rediscovery: 'Rediscoveries', learn: 'Knowledge shared', death: 'Notable deaths', twins: 'Twins born',
  marriage: 'Marriages between clans', meet: 'Clans meeting', merge: 'Clans merging', extinct: 'Clans dying out', settle: 'Villages founded',
  hunt: 'Great hunts', winter: 'Hard winters', drought: 'Droughts', flood: 'Floods', plague: 'Plagues', harvest: 'Rich harvests',
  comet: 'Comets', eclipse: 'Eclipses', quake: 'Earthquakes', fire: 'Town fires', festival: 'Festivals', wonder: 'Great buildings',
  expedition: 'Expeditions', secret: 'Secrets found', era: 'New ages', milestone: 'Population milestones', blessing: 'Blessings',
  rain: 'Rains sent', feast: 'Feasts', lost: 'Knowledge lost',
  alliance: 'Alliances sworn', rivalry: 'Rivalries', quarrel: 'Quarrels', aid: 'Food sent to friends', peace: 'Feuds ended', estranged: 'Friendships faded',
  learned: 'Clans changing their way of life', inspired: 'Inventors inspired', prayer: 'Prayers',
};

const css = (v: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

/** the statistics tab; `wide` lays the same out on two columns in a big card */
async function renderStats(body: HTMLElement, wide = false) {
  if (!wide && performance.now() - statsAt < 15000 && body.querySelector('.chart')) return;
  if (!wide) statsAt = performance.now();
  const h = await api<History>('/api/history').catch(() => null);
  if (!wide && activeTab !== 'stats') return;
  if (!h) { body.innerHTML = '<p class="muted">Could not load the statistics. Try again in a moment.</p>'; return; }
  const s = h.series;
  const last = s[s.length - 1];
  const known = knownNow();
  const villages = bands.filter((b) => b.settled).length;
  const kpi = (label: string, value: string, sub = '') => `<div><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const prev = s.length > 10 ? s[s.length - 11] : s[0];
  const trend = (a?: number, b?: number) => (a === undefined || b === undefined || !b ? '' : `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))}% in 10 years`);
  const r = h.records;
  const ageStruct = last ? [last.children, last.population - last.children - last.elders, last.elders] : [0, 0, 0];
  const total = ageStruct.reduce((a, b) => a + b, 0) || 1;
  const fmt = (y: number) => fmtYear(y);
  const pc = (k: number) => Math.round((ageStruct[k] / total) * 100);
  body.innerHTML = `
    ${wide ? '<h2>The state of the world</h2>' : '<button class="btn ghost" id="statsWide">Open the full dashboard</button>'}
    <div class="${wide ? 'dash' : 'dash-narrow'}">
    <section class="span2">
      <div class="kpis kpis-4">
        ${kpi('People', num(people.length || last?.population || 0), trend(last?.population, prev?.population))}
        ${kpi('Clans', num(bands.length), `${villages} villages`)}
        ${kpi('Discoveries', `${known.size}/${TECH_LIST.length}`, eraName(currentEra))}
        ${kpi('Avg. age', last ? last.avgAge.toFixed(1) : '–', 'years')}
        ${kpi('Born', num(h.totalBorn))}
        ${kpi('Died', num(h.totalDied))}
        ${kpi('Clans gone', num(h.gone.extinct), `${num(h.gone.merged)} merged`)}
        ${kpi('Years recorded', num(Math.max(0, h.year - (s[0]?.year ?? h.year))))}
        ${kpi('Alliances', num(h.relations?.alliances ?? 0), 'between neighbours')}
        ${kpi('Rivalries', num(h.relations?.rivalries ?? 0), 'no violence, just grudges')}
      </div>
    </section>
    <section class="span2"><h3>Population and clans</h3><div id="chPop"></div></section>
    <section><h3>Births and deaths per year</h3><div id="chLife"></div></section>
    <section><h3>Discoveries over time</h3><div id="chTech"></div></section>
    <section><h3>Who lives now</h3>
      <div class="stack"><i style="flex:${ageStruct[0]};background:var(--accent-2)" title="Children"></i><i style="flex:${ageStruct[1]};background:var(--accent)" title="Adults"></i><i style="flex:${ageStruct[2]};background:#b48ead" title="Elders"></i></div>
      <div class="legend"><span><i style="background:var(--accent-2)"></i>Children ${pc(0)}%</span><span><i style="background:var(--accent)"></i>Adults ${pc(1)}%</span><span><i style="background:#b48ead"></i>Elders ${pc(2)}%</span></div>
    </section>
    <section><h3>Records</h3><dl class="records">
      ${r.peak ? `<dt>Most people at once</dt><dd>${num(r.peak.population)} <small>in ${fmt(r.peak.year)}</small></dd>` : ''}
      ${r.largestBand ? `<dt>Largest clan</dt><dd>${esc(r.largestBand.name)}, ${r.largestBand.size} people <small>in ${fmt(r.largestBand.year)}</small></dd>` : ''}
      ${r.oldest ? `<dt>Oldest person</dt><dd><a href="#" class="ref" data-person="${r.oldest.id}">${esc(r.oldest.name)}</a>, ${r.oldest.age} years <small>in ${fmt(r.oldest.year)}</small></dd>` : ''}
      ${r.mostClans ? `<dt>Most clans</dt><dd>${r.mostClans.bands} <small>in ${fmt(r.mostClans.year)}</small></dd>` : ''}
    </dl>${r.peak ? '' : '<p class="muted">Records are kept from now on.</p>'}</section>
    <section><h3>The ages</h3><ol class="timeline">
      <li class="done"><b>${eraName(0)}</b><small>${fmt(-12000)}</small></li>
      ${ERAS_EN.slice(1).map((_, i) => {
        const e = i + 1;
        const reached = e <= h.era;
        const ev = h.eras[e - 1];
        const note = reached ? (ev ? fmt(ev.year) : 'reached') : e === h.era + 1 ? `opens with ${techLabel(GATES.get(e) ?? '')}` : 'still ahead';
        return `<li class="${reached ? 'done' : e === h.era + 1 ? 'next' : ''}"><b>${eraName(e)}</b><small>${note}</small></li>`;
      }).join('')}
    </ol></section>
    <section><h3>How the clans learned</h3><div id="dashBrains" class="muted">Loading…</div></section>
    <section><h3>How people died</h3>${barList(Object.entries(h.causes), '#b48ead', 8)}</section>
    <section><h3>What happened most</h3>${barList(Object.entries(h.events).map(([k, v]) => [`${ICON[k] ?? '•'} ${EVENT_NAMES[k] ?? k}`, v] as [string, number]), 'var(--accent-2)', 12)}</section>
    <section class="span2"><h3>What people know</h3><div class="techs">${[...known].map((t) => `<span class="pill">${esc(techLabel(t))}</span>`).join('') || '<span class="muted">Nothing yet</span>'}</div></section>
    <section class="span2"><h3>Notifications</h3><p class="muted">${h.notify ? 'On: the server sends the great moments to your phone or Home Assistant.'
      : 'Off. Set <code>LETOPIS_NTFY_URL</code> (an ntfy topic) or <code>LETOPIS_WEBHOOK_URL</code> (for example a Home Assistant webhook) on the container to get the great moments on your phone.'}</p></section>
    </div>`;
  const xs = s.map((x) => x.year);
  const eras = s.map((x) => x.era);
  const accent = css('--accent', '#e0a84f'), accent2 = css('--accent-2', '#7fb2d9');
  lineChart(body.querySelector<HTMLElement>('#chPop')!, { xs, eras, eraNames: ERAS_EN, fmtX: fmt, series: [
    { name: 'People', color: accent, values: s.map((x) => x.population), fill: true },
    { name: 'Clans ×10', color: accent2, values: s.map((x) => x.bands * 10), dashed: true },
  ] });
  lineChart(body.querySelector<HTMLElement>('#chLife')!, { xs, eras, fmtX: fmt, height: 140, fmtY: (y) => y.toFixed(1), series: [
    { name: 'Births', color: '#6cc38a', values: s.map((x) => x.births / (x.span ?? 1)) },
    { name: 'Deaths', color: '#d9776f', values: s.map((x) => x.deaths / (x.span ?? 1)) },
  ] });
  lineChart(body.querySelector<HTMLElement>('#chTech')!, { xs, eras, fmtX: fmt, height: 120, series: [
    { name: 'Discoveries', color: '#b48ead', values: s.map((x) => x.techs), fill: true },
  ] });
  api<{ clans: number; styles: Record<string, number>; avgGeneration: number; maxGeneration: number; tried: number; kept: number } | null>('/api/brains').then((bs) => {
    const el = body.querySelector<HTMLElement>('#dashBrains');
    if (!el || !bs) return;
    el.classList.remove('muted');
    el.innerHTML = `<p class="lead">Every clan learns by trying a slightly different way of spending its work each year and keeping it when the clan eats better;
      daughter clans inherit their parents' way with small changes. Nobody wrote these strategies.</p>
      ${barList(Object.entries(bs.styles), 'var(--accent)', 8)}
      <p class="muted">Line generations: ${bs.avgGeneration} on average, up to ${bs.maxGeneration} · ${num(bs.kept)} of ${num(bs.tried)} tries kept by the clans alive now.</p>`;
  }).catch(() => {});
  const wideBtn = body.querySelector<HTMLButtonElement>('#statsWide');
  if (wideBtn) wideBtn.onclick = () => { openCard('<div id="dashBody"><p class="muted">Loading…</p></div>', false, 'wide'); void renderStats($('#dashBody'), true); };
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
  const eldersN = members.filter((p) => p[5] >= 60).length;
  const tasks = new Map<string, number>();
  for (const p of members) {
    const t = TASK(r.nightTask(p[0], p[3]) ?? TASK_NAMES[TASKS[p[3]]]);
    tasks.set(t, (tasks.get(t) ?? 0) + 1);
  }
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const knownIds = new Set(b.techIds ?? []);
  const eraOfBand = Math.max(0, ...[...GATES].filter(([, g]) => knownIds.has(g)).map(([e]) => e));
  const taskTotal = members.length || 1;
  openCard(`
    <h2><span class="dot" style="background:${hex(b.color)}"></span> ${esc(b.settlementName ? VILLAGE(b.settlementName) : B(b.name))}</h2>
    <div class="muted">${b.settlementName ? `${esc(B(b.name))} · ` : ''}since ${fmtYear(b.founded)} · ${b.settled ? 'settled' : 'wandering the land'} · ${eraName(eraOfBand)}</div>
    ${b.chief ? `<div>${esc(CHIEF(b.chief.title))}: <a href="#" data-person="${b.chief.id}">${esc(P(b.chief.name))}</a></div>` : ''}
    ${originHtml(b.founder, b.from)}
    <div class="kpis kpis-4"><div><span>People</span><b>${b.size}</b></div><div><span>Children</span><b>${kidsN}</b></div>
      <div><span>Elders</span><b>${eldersN}</b></div><div><span>Food</span><b>${b.food}</b></div></div>
    <div class="help-row" id="bandHelp">
      <button class="btn" data-help="bless" title="Food for this clan">🌟 Bless</button>
      <button class="btn" data-help="rain" title="Rain over their land">🌧️ Rain</button>
      <button class="btn" data-help="inspire" title="Four times the chance of a discovery for two years">💭 Inspire</button>
      <button class="btn" data-help="feast" title="They invite their neighbours">🍖 Feast</button>
      <button class="btn" data-help="calm" title="Make peace with their rivals">🕊️ Calm</button>
    </div>
    <p class="act-note" id="bandHelpNote" hidden></p>
    <h3>Way of life <small id="bandStyleTag"></small></h3><div id="bandBrain" class="muted">Loading…</div>
    <h3>Friends and rivals</h3><div id="bandRel" class="muted">Loading…</div>
    <h3>What they are doing</h3><div class="barlist">${[...tasks].sort((a, c) => c[1] - a[1]).map(([t, n]) => `<div class="barrow"><span class="bl-k">${esc(t)}</span><span class="bl-v">${n}</span>
      <div class="bl-bar"><i style="width:${(n / taskTotal) * 100}%;background:${hex(b.color)}"></i></div></div>`).join('')}</div>
    <h3>What they know <small>${b.techs.length}</small></h3><div class="techs">${b.techs.map((t) => `<span class="pill">${esc(TECH(t))}</span>`).join('') || '<span class="muted">Nothing yet</span>'}</div>
    <h3>The people</h3><ul class="people" id="bandPeople"><li class="muted">Loading…</li></ul>`);
  // help aimed at this clan
  document.querySelectorAll<HTMLButtonElement>('#bandHelp [data-help]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const note = $('#bandHelpNote');
      note.hidden = false;
      note.innerHTML = await useAct(btn.dataset.help!, b.id);
      btn.disabled = false;
    };
  });
  // what the clan has learned (brain.ts on the server)
  const JOB_NAMES: Record<string, string> = { farm: 'Farming', herd: 'Herding', fish: 'Fishing', craft: 'Crafting', build: 'Building', forage: 'Hunting and gathering' };
  api<{ style: string; weights: Record<string, number>; give: number; generation: number; tried: number; kept: number; trying: boolean; inspired: boolean } | null>(`/api/brain/${b.id}`).then((br) => {
    const el = document.getElementById('bandBrain');
    if (!el || !br) { if (el) el.textContent = 'Still finding its way.'; return; }
    el.classList.remove('muted');
    $('#bandStyleTag').textContent = br.style + (br.inspired ? ' · inspired' : '');
    const max = Math.max(...Object.values(br.weights));
    el.innerHTML = `<p class="lead">How this clan has learned to spend its work: every year it tries a slightly different way and keeps it if the clan eats better.
        Generation ${br.generation} of its line · ${br.kept} of ${br.tried} tries kept${br.trying ? ' · trying something new this year' : ''}.</p>
      <div class="barlist">${Object.entries(br.weights).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="barrow"><span class="bl-k">${JOB_NAMES[k] ?? k}</span><span class="bl-v">×${v.toFixed(2)}</span>
        <div class="bl-bar"><i style="width:${(v / max) * 100}%;background:${hex(b.color)}"></i></div></div>`).join('')}
        <div class="barrow"><span class="bl-k">Generosity to friends</span><span class="bl-v">${Math.round(br.give * 100)}%</span>
        <div class="bl-bar"><i style="width:${br.give * 100}%;background:var(--good)"></i></div></div></div>`;
  }).catch(() => { const el = document.getElementById('bandBrain'); if (el) el.textContent = 'Could not load.'; });
  // friends and rivals, and everyone in the clan, each in one request
  api<{ id: number; name: string; color: number; score: number; kind: string }[]>(`/api/relations/${b.id}`).then((rs) => {
    const el = document.getElementById('bandRel');
    if (!el) return;
    const shown = rs.filter((x) => x.kind !== 'neutral').slice(0, 10);
    const label: Record<string, string> = { ally: 'ally', friendly: 'friendly', cool: 'cool', rival: 'rival' };
    el.classList.remove('muted');
    el.innerHTML = shown.length ? `<ul class="rels">${shown.map((x) => `<li data-band="${x.id}"><span class="dot" style="background:${hex(x.color)}"></span>
        <span class="rel-name">${esc(x.name)}</span><span class="rel ${x.kind}">${label[x.kind]}</span>
        <span class="rel-bar"><i style="width:${Math.abs(x.score) / 2}%;${x.score < 0 ? 'right:50%' : 'left:50%'}" class="${x.score < 0 ? 'neg' : 'pos'}"></i></span></li>`).join('')}</ul>`
      : '<p class="muted">No strong feelings for any neighbour yet.</p>';
  }).catch(() => { const el = document.getElementById('bandRel'); if (el) el.textContent = 'Could not load.'; });
  api<{ total: number; people: PersonListRow[] }>(`/api/people?band=${b.id}&sort=old&limit=200`).then((res) => {
    const el = document.getElementById('bandPeople');
    if (!el) return;
    el.innerHTML = res.people.map((p) => `<li data-person="${p.id}"><span class="avatar sm ${p.sex ? 'f' : 'm'}">${p.age < 12 ? '🧒' : p.age >= 60 ? (p.sex ? '👵' : '👴') : p.sex ? '👩' : '👨'}</span>
      <div><b>${esc(p.name)}</b>${p.chief ? ' <span class="badge village">chief</span>' : ''}<div class="muted">${p.age} y · ${esc(TASK(TASK_NAMES[p.task as keyof typeof TASK_NAMES] ?? p.task))}${p.deeds ? ` · ${p.deeds} deed${p.deeds > 1 ? 's' : ''}` : ''}</div></div></li>`).join('')
      || '<li class="muted">Nobody.</li>';
  }).catch(() => { const el = document.getElementById('bandPeople'); if (el) el.innerHTML = '<li class="muted">Could not load.</li>'; });
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
$('#sideHandle').onclick = toggleSide;

// ---------- the world map in the corner ----------

let mini: Minimap | null = null;
let miniAt = 0;
// on a small screen it starts hidden: the map itself is small there
let showMap = store('letopis.minimap', window.innerWidth > 900);
const applyMap = () => {
  document.body.classList.toggle('map-hidden', !showMap);
  $('#mapBtn').setAttribute('aria-pressed', String(showMap));
};
applyMap();
$('#mapBtn').onclick = () => { showMap = !showMap; save('letopis.minimap', showMap); applyMap(); };
function drawMinimap() {
  // the four screen corners, back to tiles (the iso projection undone; height is ignored)
  const W = app.screen.width, H = app.screen.height;
  const corners = [[0, 0], [W, 0], [W, H], [0, H]].map(([sx, sy]) => {
    const wx = (sx - r.world.x) / cam.zoom, wy = (sy - r.world.y) / cam.zoom;
    const a = wx / (TW / 2), b = wy / (TH / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  });
  mini!.draw(bands, corners, null);
}

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
  if (mini && showMap && now - miniAt > 120) { miniAt = now; drawMinimap(); }
  const left = Math.max(0, tickMs - (now - lastTickAt));
  ($('#tickBar') as HTMLElement).style.width = `${100 - (left / tickMs) * 100}%`;
}

// ---------- start ----------

const info = await api<WorldInfo>('/api/world');
worldId = info.worldId;
const seenBefore = store<number>(`letopis.seen.${worldId}`, 0);
r.setWorld(info);
mini = new Minimap($('#minimap') as HTMLCanvasElement, info);
mini.onPick = (x, y) => { stopTour(); follow = null; lookAt(x, y); };
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
