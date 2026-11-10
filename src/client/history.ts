// The history view (fork, 1.57): one page for the whole world. The population over time with the ages shaded, then one
// timeline: the ages, first discoveries, great events, cultures beginning and parting, villages founded. Each entry opens
// its person, clan or culture card on top.
import { ERAS_EN } from '../shared/i18n';
import { lineChart } from './charts';
import { fmtYear, num } from './lang';
import { $, api, esc, save, store, ui } from './kit';
import { hueCss } from './culturelayer';

interface Row { id: number; year: number; kind: string; importance: number; text: string; person: number | null; band: number | null }
interface Timeline {
  year: number; era: number;
  events: Row[];
  cultures: { id: number; name: string; hue: number; since: number; from: string | null; fromId: number | null; clans: number }[];
  population: [number, number][];
}
interface Item { year: number; order: number; kind: string; icon: string; html: string; ref: string; big: boolean; group: string }

const FILTERS: [string, string][] = [['all', 'Everything'], ['ages', 'Ages'], ['discoveries', 'Discoveries'], ['events', 'Great events'], ['cultures', 'Cultures'], ['villages', 'Villages']];
const ICON: Record<string, string> = {
  genesis: '🌅', era: '⭐', discovery: '💡', settle: '🏘️', wonder: '🏛️', plague: '🦠', flood: '🌊', quake: '🌋', drought: '☀️', winter: '❄️',
  fire: '🔥', comet: '☄️', eclipse: '🌘', harvest: '🌾', hunt: '🦣', expedition: '🧭', festival: '🎉', lost: '📜', milestone: '👥', extinct: '🌑',
  culture: '🌐', 'culture-begins': '🌐', rollback: '⏪',
};
const group = (kind: string) => (kind === 'era' || kind === 'genesis' ? 'ages' : kind === 'discovery' ? 'discoveries' : kind === 'settle' ? 'villages'
  : kind === 'culture' || kind === 'culture-begins' ? 'cultures' : 'events');

let filter = store('letopis.histFilter', 'all');
let newestFirst = store('letopis.histNewest', false);
let data: Timeline | null = null;

function overlay(): HTMLElement {
  let el = document.getElementById('history');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'history';
  el.className = 'history';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'The history of the world');
  el.innerHTML = `<div class="hist-inner">
    <header class="hist-head"><h2>The history of the world</h2><span class="hist-actions"><a class="btn" href="/book" target="_blank" rel="noopener">The book of the world</a><button class="btn round" id="histClose" title="Close" aria-label="Close">×</button></span></header>
    <p class="muted" id="histSub"></p>
    <div id="histPop"></div>
    <div class="hist-tools"><div class="chips" id="histChips"></div><button class="btn" id="histOrder"></button></div>
    <ol class="hist-list" id="histList"></ol></div>`;
  document.body.appendChild(el);
  $('#histClose').onclick = close;
  // every entry opens its card (the cards sit above this page)
  el.addEventListener('click', (e) => {
    const ref = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-band],[data-culture]');
    if (ref) { e.preventDefault(); ui.openRef(ref); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el!.hidden && document.getElementById('card')?.hidden !== false) close();
  });
  return el;
}

function close() { overlay().hidden = true; }

export async function openHistory() {
  const el = overlay();
  el.hidden = false;
  $('#histList').innerHTML = '<li class="muted">Loading…</li>';
  data = await api<Timeline>('/api/timeline').catch(() => null);
  if (!data) { $('#histList').innerHTML = '<li class="muted">Could not load the history. Try again in a moment.</li>'; return; }
  const d = data;
  const firsts = d.events.filter((e) => e.kind === 'discovery').length;
  $('#histSub').textContent = `${fmtYear(-12000)} to ${fmtYear(d.year)}: ${ERAS_EN.slice(0, d.era + 1).length} ages, ${firsts} first discoveries, ${d.cultures.length} cultures alive now.`;
  // the population, with the ages shaded
  const pop = $('#histPop');
  pop.innerHTML = '';
  if (d.population.length > 1) {
    const eraYears = d.events.filter((e) => e.kind === 'era').map((e) => e.year);
    const eraAt = (y: number) => eraYears.filter((s) => s <= y).length;
    lineChart(pop, { xs: d.population.map((p) => p[0]), eras: d.population.map((p) => eraAt(p[0])), eraNames: ERAS_EN, fmtX: fmtYear, height: 150,
      fmtY: (v) => num(Math.round(v)), series: [{ name: 'People', color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e0a84f', values: d.population.map((p) => p[1]), fill: true }] });
  }
  draw();
}

function items(d: Timeline): Item[] {
  const out: Item[] = d.events.map((e) => {
    const ref = e.person ? `data-person="${e.person}"` : e.band ? `data-band="${e.band}"` : '';
    return { year: e.year, order: e.id, kind: e.kind, icon: ICON[e.kind] ?? '•', html: esc(e.text), ref, big: e.importance >= 3 && e.kind !== 'settle', group: group(e.kind) };
  });
  // the cultures alive now and how they began (the earliest ones began with the world, or when Brain 2 came)
  for (const c of d.cultures) {
    const text = c.from ? `The culture of ${esc(c.name)} began, parting from the culture of ${esc(c.from)}.` : `The culture of ${esc(c.name)} began.`;
    out.push({ year: c.since, order: Number.MAX_SAFE_INTEGER / 2 + c.id, kind: 'culture-begins', icon: `<span class="dot" style="background:${hueCss(c.hue)}"></span>`,
      html: `${text} <span class="muted">${c.clans} clan${c.clans === 1 ? '' : 's'} today</span>`, ref: `data-culture="${c.id}"`, big: false, group: 'cultures' });
  }
  return out.sort((a, b) => a.year - b.year || a.order - b.order);
}

function draw() {
  if (!data) return;
  const chips = $('#histChips');
  chips.innerHTML = FILTERS.map(([k, n]) => `<button class="chip" data-hf="${k}" aria-pressed="${k === filter}">${n}</button>`).join('');
  chips.querySelectorAll<HTMLButtonElement>('[data-hf]').forEach((b) => { b.onclick = () => { filter = b.dataset.hf!; save('letopis.histFilter', filter); draw(); }; });
  const order = $('#histOrder');
  order.textContent = newestFirst ? 'Newest first' : 'Oldest first';
  order.onclick = () => { newestFirst = !newestFirst; save('letopis.histNewest', newestFirst); draw(); };
  // everything but the hundreds of villages, unless they are asked for
  let list = items(data).filter((i) => (filter === 'all' ? i.group !== 'villages' : i.group === filter));
  if (newestFirst) list = list.reverse();
  // a heading for every age the list passes through
  const eras = data.events.filter((e) => e.kind === 'era').map((e) => e.year);
  const ageOf = (y: number) => eras.filter((s) => s <= y).length;
  let lastAge = -1;
  const html: string[] = [];
  for (const i of list) {
    const age = ageOf(i.year);
    if (age !== lastAge) { html.push(`<li class="hist-age">${esc(ERAS_EN[age] ?? '')}</li>`); lastAge = age; }
    html.push(`<li class="hist-item${i.big ? ' big' : ''}${i.ref ? ' link' : ''}" ${i.ref}><span class="hist-year">${fmtYear(i.year)}</span>
      <span class="hist-icon">${i.icon}</span><span class="hist-text">${i.html}</span></li>`);
  }
  $('#histList').innerHTML = html.join('') || '<li class="muted">Nothing like this yet.</li>';
}

export function initHistory() {
  $('#historyBtn').onclick = () => void openHistory();
}
