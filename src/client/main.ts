import { Application } from 'pixi.js';
import { Atlas, WorldRenderer, iso, TW, TH } from './render';
import {
  BandView, ChronicleEntry, FamilyTree, MONTHS, TreeNode, PersonDetail, PersonRow, SnapshotMessage, TASKS, TASK_NAMES, TickMessage, WorldInfo, b64decode, formatYear,
} from '../shared/types';
import { SECRET_COUNT, SECRET_KINDS, SecretSpot } from '../shared/secrets';

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
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
const canvas = app.canvas;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  dragging = true; moved = 0; last = { x: e.clientX, y: e.clientY };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
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
  if (!dragging) return;
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
  if (dragging && moved < 6 && pointers.size === 0) pick(e.clientX, e.clientY);
  if (pointers.size === 0) dragging = false;
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
  const z1 = Math.max(0.18, Math.min(4, z0 * f));
  const W = app.screen.width, H = app.screen.height;
  if (follow === null) {
    const wx = cam.x + (sx - W / 2) / z0, wy = cam.y + (sy - H / 2) / z0;
    cam.x = cam.tx = wx - (sx - W / 2) / z1;
    cam.y = cam.ty = wy - (sy - H / 2) / z1;
  }
  cam.zoom = cam.tz = z1;
}
$('#zoomIn').onclick = () => { cam.tz = Math.min(4, cam.tz * 1.4); };
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
  $('#year').textContent = formatYear(t.year);
  $('#month').textContent = MONTHS[t.month];
  $('#era').textContent = t.eraName;
  $('#pop').textContent = population.toLocaleString('bg-BG');
  $('#bandsCount').textContent = String(bands.length);
  const days = (Date.now() - t.startedAt) / 86400000;
  $('#age').textContent = days < 1 ? `${Math.round(days * 24)} ч.` : `${Math.floor(days)} дни`;
}

function onSnapshot(m: SnapshotMessage) {
  bands = m.bands;
  people = m.people;
  r.setExplored(b64decode(m.explored));
  r.updateBands(bands, kids);
  r.updatePeople(people, bandColors(), 400);
  applyTime(m.time, m.population);
  $('#born').textContent = m.totalBorn.toLocaleString('bg-BG');
  $('#died').textContent = m.totalDied.toLocaleString('bg-BG');
  renderSide();
}

function onTick(m: TickMessage) {
  bands = m.bands;
  people = m.people;
  if (m.explored) r.setExplored(b64decode(m.explored));
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
  if (activeTab === 'bands' || activeTab === 'stats') renderSide();
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
  if (!Number.isNaN(t.getTime())) $('#build').title = `от ${t.toLocaleString('bg-BG')}`;
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
  return kids && e.kids ? e.kids : e.text;
}

function eventHtml(e: ChronicleEntry): string {
  const icon: Record<string, string> = {
    discovery: '💡', rediscovery: '🔁', settle: '🏘️', colony: '🏘️', split: '🚶', death: '🕯️', twins: '👶', hunt: '🦣',
    winter: '❄️', secret: '✨', drought: '☀️', extinct: '🌑', lost: '📜', meet: '🤝', learn: '📚', era: '⭐', milestone: '👥', genesis: '🌅', merge: '🔗', marriage: '💞', end: '🌑',
  };
  return `<li class="ev imp${e.importance}" data-person="${e.personId ?? ''}" data-band="${e.bandId ?? ''}">
    <span class="ev-icon">${icon[e.kind] ?? '•'}</span>
    <div><div class="ev-year">${formatYear(e.year)}</div><div class="ev-text">${esc(evText(e))}</div></div></li>`;
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

let onlyBig = store('letopis.onlyBig', false);
const feedFilter = (e: ChronicleEntry) => !onlyBig || e.importance >= 2;

function toast(e: ChronicleEntry) {
  const t = document.createElement('div');
  t.className = `toast imp${e.importance}`;
  t.innerHTML = `<div class="ev-year">${formatYear(e.year)}</div>${esc(evText(e))}`;
  $('#toasts').prepend(t);
  setTimeout(() => t.classList.add('out'), 9000);
  setTimeout(() => t.remove(), 10000);
  while ($('#toasts').children.length > 3) $('#toasts').lastElementChild?.remove();
}

// ---------- side panel ----------

let activeTab = store('letopis.tab', 'chronicle');

function renderSide() {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
  const body = $('#sideBody');
  if (activeTab === 'chronicle') {
    body.innerHTML = `<label class="chk"><input type="checkbox" id="onlyBig" ${onlyBig ? 'checked' : ''}> Само важните събития</label>
      <ul id="chronicleList" class="events">${feed.filter(feedFilter).map(eventHtml).join('')}</ul>
      <button id="more" class="btn ghost">По-стари записи</button>`;
    $('#onlyBig').onchange = (e) => { onlyBig = (e.target as HTMLInputElement).checked; save('letopis.onlyBig', onlyBig); renderSide(); };
    $('#more').onclick = loadOlder;
  } else if (activeTab === 'bands') {
    const sorted = [...bands].sort((a, b) => b.size - a.size);
    body.innerHTML = `<ul class="bands">${sorted.map((b) => `
      <li data-band="${b.id}"><span class="dot" style="background:#${b.color.toString(16).padStart(6, '0')}"></span>
      <div><b>${esc(b.settlementName ?? b.name)}</b>${b.settlementName ? `<small> · ${esc(b.name)}</small>` : ''}
      <div class="muted">${b.size} души · ${b.settled ? 'село' : 'скитат'} · знания: ${b.techs.length}</div></div></li>`).join('')}</ul>`;
  } else if (activeTab === 'heroes') {
    body.innerHTML = '<p class="muted">Зареждам...</p>';
    api<{ id: number; name: string; age: number; band: string; deeds: string[] }[]>('/api/heroes').then((hs) => {
      if (activeTab !== 'heroes') return;
      body.innerHTML = hs.length ? `<ul class="heroes">${hs.map((h) => `<li data-person="${h.id}"><b>${esc(h.name)}</b>
        <span class="muted">${h.age} г. · ${esc(h.band)}</span>${h.deeds.length ? `<div>${h.deeds.map(esc).join('<br>')}</div>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Още никой не е направил нещо велико. Търпение.</p>';
    });
  } else if (activeTab === 'stats') {
    renderStats(body);
  }
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
      <div><span>Родени</span><b id="born2">${$('#born').textContent}</b></div>
      <div><span>Починали</span><b>${$('#died').textContent}</b></div>
      <div><span>Знания</span><b>${techsKnown.size}</b></div>
    </div>
    <h3>Население</h3><canvas id="popChart" height="160"></canvas>
    <h3>Какво знаят хората</h3><div class="techs">${[...techsKnown].map((t) => `<span class="pill">${esc(t)}</span>`).join('') || '<span class="muted">Нищо още</span>'}</div>`;
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
  g.fillText(formatYear(rows[0].year), 8, h - 8);
  const endLabel = formatYear(rows[rows.length - 1].year);
  g.fillText(endLabel, w - g.measureText(endLabel).width - 8, h - 8);
  g.fillText(`макс. ${Math.round(max / 1.1).toLocaleString('bg-BG')}`, 8, 26);
}

async function loadOlder() {
  const oldest = feed.length ? feed[feed.length - 1].id : undefined;
  const more = await api<ChronicleEntry[]>(`/api/chronicle?limit=80${oldest ? `&before=${oldest}` : ''}`);
  for (const e of more) if (!feed.some((f) => f.id === e.id)) feed.push(e);
  renderSide();
}

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
  b.onclick = () => { activeTab = b.dataset.tab!; save('letopis.tab', activeTab); statsAt = 0; renderSide(); };
});
$('#sideBody').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-band]');
  if (!el) return;
  const pid = Number(el.dataset.person), bid = Number(el.dataset.band);
  if (pid) showPerson(pid);
  else if (bid) {
    const b = bands.find((x) => x.id === bid);
    if (b) { stopTour(); lookAt(b.x, b.y, 1.6); showBand(b); }
  }
});

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
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-tree]');
  if (!el) return;
  e.preventDefault();
  if (el.dataset.tree) showTree(Number(el.dataset.tree));
  else if (el.dataset.person) showPerson(Number(el.dataset.person));
});

async function showPerson(id: number) {
  const d = await api<PersonDetail>(`/api/person/${id}`).catch(() => null);
  if (!d) return;
  // the first people have no parents: the world starts with them
  const link = (p: { id: number; name: string } | null) => (p ? `<a href="#" data-person="${p.id}">${esc(p.name)}</a>` : `<span class="muted">${d.generation <= 1 ? 'от първите хора' : 'неизвестен'}</span>`);
  const genes = Object.entries(d.genes).map(([k, v]) => `<div class="gene"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div></div>`).join('');
  const alive = d.diedYear === null;
  const live = r.people.get(id);
  const beside = !!(live && alive) && window.innerWidth > 760;
  if (live && alive) { stopTour(); follow = id; r.select(id); cam.tz = Math.max(cam.tz, 2); }
  openCard(`
    <div class="person-head"><div class="avatar ${d.sex ? 'f' : 'm'}">${d.sex ? '👩' : '👨'}</div>
      <div><h2>${esc(d.name)}</h2>
      <div class="muted">${alive ? `<span id="pAge">${d.age}</span> години · ${esc(d.bandName)}` : `${formatYear(d.bornYear)} – ${formatYear(d.diedYear!)}, ${esc(d.cause ?? '')} на ${d.age}`}</div>
      ${alive && d.task ? `<div>Сега ${esc(d.task)}</div>` : ''}<div class="muted">${d.generation}-о поколение</div></div></div>
    <div class="genes">${genes}</div>
    <dl class="family">
      <dt>Майка</dt><dd>${link(d.mother)}</dd><dt>Баща</dt><dd>${link(d.father)}</dd>
      <dt>Партньор</dt><dd>${link(d.partner)}</dd>
      <dt>Деца</dt><dd>${d.children.length ? d.children.map((c) => `<a href="#" data-person="${c.id}" class="${c.alive ? '' : 'dead'}">${esc(c.name)}</a>`).join(', ') : '<span class="muted">няма</span>'}</dd>
    </dl>
    <button class="btn tree-btn" data-tree="${d.id}">Родословие</button>
    ${d.deeds.length ? `<h3>Дела</h3><ul class="deeds">${d.deeds.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`, beside);
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
  const kind = SECRET_KINDS[spot.kind];
  const res = await fetch(`/api/secret/${spot.k}`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as { first: boolean; found: number } | null;
  r.markSecret(spot.k);
  openCard(`
    <h2>✨ ${esc(kind.name[0].toUpperCase() + kind.name.slice(1))}</h2>
    <p>${esc(kind.text)}</p>
    <div class="muted">${res ? `${res.first ? 'Ти си първият, който я откри!' : 'Някой вече я е открил преди теб.'} Намерени тайни: ${res.found} от ${SECRET_COUNT}.` : ''}</div>`);
}

/** family tree: three generations of ancestors, and the straight lines back to the first people */
async function showTree(id: number) {
  const t = await api<FamilyTree>(`/api/tree/${id}`).catch(() => null);
  if (!t) return;
  // "11 785 – 11 708 г. пр.н.е.": the era is written once when both years share it
  const years = (n: TreeNode) => {
    const a = formatYear(n.bornYear);
    if (n.diedYear === null) return `от ${a}`;
    const b = formatYear(n.diedYear);
    const tail = a.match(/ г\..*$/)?.[0] ?? '';
    return tail && b.endsWith(tail) ? `${a.slice(0, -tail.length)} – ${b}` : `${a} – ${b}`;
  };
  const box = (n: TreeNode | null | undefined, gen: number): string => {
    if (!n) return `<div class="tbox empty">${gen <= 1 ? 'от първите хора' : 'неизвестен'}</div>`;
    const parents = n.mother !== undefined || n.father !== undefined
      ? `<div class="tpar">${box(n.father, n.generation - 1)}${box(n.mother, n.generation - 1)}</div>` : '';
    return `<div class="tn"><div class="tbox ${n.sex ? 'f' : 'm'}${n.diedYear !== null ? ' dead' : ''}" data-tree="${n.id}" title="Покажи неговото родословие">
      <b>${esc(n.name)}</b><small>${years(n)}</small></div>${parents}</div>`;
  };
  const line = (title: string, l: TreeNode[]) => l.length
    ? `<details class="tline"><summary>${title}: ${l.length} поколения назад, до ${esc(l[l.length - 1].name)}</summary><ol>${l.map((n) => `<li><a href="#" data-tree="${n.id}">${esc(n.name)}</a> <span class="muted">${years(n)}</span></li>`).join('')}</ol></details>`
    : '';
  const root = t.root;
  openCard(`
    <h2>Родословие</h2>
    <div class="muted"><a href="#" data-person="${root.id}">${esc(root.name)}</a> · ${root.generation}-о поколение · цъкни някого, за да видиш неговите предци</div>
    <div class="tree">${box(root, root.generation)}</div>
    ${line('По майчина линия', t.motherLine)}
    ${line('По бащина линия', t.fatherLine)}`, false, 'wide');
}

function showBand(b: BandView) {
  const members = people.filter((p) => p[4] === b.id);
  const kidsN = members.filter((p) => p[5] < 12).length;
  const tasks = new Map<string, number>();
  for (const p of members) {
    const t = TASK_NAMES[TASKS[p[3]]];
    tasks.set(t, (tasks.get(t) ?? 0) + 1);
  }
  openCard(`
    <h2><span class="dot" style="background:#${b.color.toString(16).padStart(6, '0')}"></span> ${esc(b.settlementName ?? b.name)}</h2>
    <div class="muted">${b.settlementName ? `${esc(b.name)} · ` : ''}от ${formatYear(b.founded)} · ${b.settled ? 'уседнали' : 'скитат по земята'}</div>
    <div class="kpis"><div><span>Хора</span><b>${b.size}</b></div><div><span>Деца</span><b>${kidsN}</b></div><div><span>Запаси</span><b>${b.food}</b></div></div>
    <h3>Какво правят сега</h3><ul class="deeds">${[...tasks].sort((a, c) => c[1] - a[1]).map(([t, n]) => `<li>${n} ${esc(t)}</li>`).join('')}</ul>
    <h3>Какво знаят</h3><div class="techs">${b.techs.map((t) => `<span class="pill">${esc(t)}</span>`).join('') || '<span class="muted">Още нищо</span>'}</div>
    <h3>Хората</h3><div class="names">${members.slice(0, 60).map((p) => `<a href="#" data-person="${p[0]}">#${p[0]}</a>`).join(', ')}</div>`);
  // names come from the server one by one; fill them in lazily
  const links = [...document.querySelectorAll<HTMLAnchorElement>('#cardBody .names a')];
  links.slice(0, 40).forEach(async (a) => {
    const d = await api<PersonDetail>(`/api/person/${a.dataset.person}`).catch(() => null);
    if (d) a.textContent = d.name;
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
  openCard(`<h2>Докато те нямаше${hours ? ` (${hours} ч.)` : ''}</h2>
    <p class="muted">Записани са ${res.total.toLocaleString('bg-BG')} нови събития, ${res.big} от тях важни.</p>
    ${top.length ? `<h3>Най-важното</h3><ul class="events">${top.map(eventHtml).join('')}</ul>` : ''}
    ${rest.length ? `<h3>Още</h3><ul class="events">${rest.map(eventHtml).join('')}</ul>` : ''}`);
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
$('#sideToggle').onclick = () => document.body.classList.toggle('side-hidden');

// ---------- frame loop ----------

app.ticker.add((t) => {
  const now = performance.now();
  tourStep(now);
  followStep();
  const k = 1 - Math.pow(0.001, t.deltaMS / 1000 / (tour ? 4 : 0.6));
  cam.x += (cam.tx - cam.x) * k;
  cam.y += (cam.ty - cam.y) * k;
  cam.zoom += (cam.tz - cam.zoom) * k;
  applyCam();
  r.frame(t.deltaTime, Date.now());
  const left = Math.max(0, tickMs - (now - lastTickAt));
  ($('#tickBar') as HTMLElement).style.width = `${100 - (left / tickMs) * 100}%`;
});

// ---------- start ----------

const info = await api<WorldInfo>('/api/world');
worldId = info.worldId;
const seenBefore = store<number>(`letopis.seen.${worldId}`, 0);
r.setWorld(info);
api<{ found: number[] }>('/api/secrets').then((s) => r.setSecrets(s.found)).catch(() => r.setSecrets([]));
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
