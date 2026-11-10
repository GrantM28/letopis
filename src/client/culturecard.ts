// The culture card (fork, 1.54): a culture's clans, where it came from, whom it learned from, how it grew, and how its
// clans share their work. While it is open, the culture's land is lit on the map.
import { barList, lineChart } from './charts';
import { fmtYear, num } from './lang';
import { api, esc, ui } from './kit';
import { cultureLayer } from './cultures';
import { hueCss } from './culturelayer';
import { cardHtml, chip, mountCard } from './cardkit';

interface CultureCard {
  id: number; name: string; hue: number; since: number; steps: number;
  from: { id: number; name: string | null; alive: boolean } | null;
  clans: { id: number; name: string; size: number; settled: boolean; x: number; y: number }[];
  people: number;
  daughters: { id: number; name: string }[];
  taughtBy: { id: number; name: string; year: number }[];
  lean: Record<string, number>;
  hist: [number, number][];
}

const JOB: Record<string, string> = { farm: 'Farming', herd: 'Herding', fish: 'Fishing', craft: 'Crafting', build: 'Building', forage: 'Hunting and gathering' };
const cap = (s: string) => s.replace(/^the /, 'the ');
const link = (id: number, name: string) => `<a href="#" class="ref" data-culture="${id}">the culture of ${esc(cap(name))}</a>`;

export async function showCulture(id: number) {
  const c = await api<CultureCard>(`/api/culture/${id}`).catch(() => null);
  if (!c) {
    ui.openCard('<h2>A culture that is gone</h2><p class="muted">Its last clans have joined other cultures or died out.</p>');
    return;
  }
  const color = hueCss(c.hue);
  const villages = c.clans.filter((x) => x.settled).length;
  const total = Object.values(c.lean).reduce((a, v) => a + v, 0) || 1;
  const lean = Object.entries(c.lean).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`${JOB[k] ?? k}`, Math.round((v / total) * 100)] as [string, number]);
  const from = c.from
    ? ` · split from ${c.from.alive ? link(c.from.id, c.from.name ?? `culture ${c.from.id}`) : `the culture of ${esc(cap(c.from.name ?? 'a culture now gone'))}`}`
    : ' · one of the first cultures';
  const spec = {
    kind: 'culture', dot: color, title: `The culture of ${cap(c.name)}`,
    facts: `since ${fmtYear(c.since)} · ${num(c.steps)} learning steps in its line`,
    chips: [
      c.from ? (c.from.alive ? chip('↰', `Split from the culture of ${esc(c.from.name ?? '')}`, `data-culture="${c.from.id}"`) : chip('↰', `Split from the culture of ${esc(c.from.name ?? 'a culture now gone')}`)) : chip('', 'One of the first cultures'),
      `<button class="ck-chip" id="cultureShow">🗺 Show its land</button>`,
    ],
    stats: [['clans', String(c.clans.length)], ['villages', String(villages)], ['people', num(c.people)], ['daughter cultures', String(c.daughters.length)]] as [string, string][],
    help: 'cultures',
    tabs: [
      { id: 'overview', label: 'Overview', render: (el: HTMLElement) => {
        el.innerHTML = `<h3>Its people over time</h3><div class="ck-chart">${c.hist.length > 1 ? '' : '<p class="muted">Not enough years yet.</p>'}</div>
          <h3>How its clans share their work <small>% of their work</small></h3>${barList(lean, color, 6)}`;
        if (c.hist.length > 1) lineChart(el.querySelector<HTMLElement>('.ck-chart')!, { xs: c.hist.map((h) => h[0]), fmtX: fmtYear, height: 120, series: [{ name: 'People', color, values: c.hist.map((h) => h[1]), fill: true }] });
      } },
      { id: 'clans', label: `Clans (${c.clans.length})`, render: (el: HTMLElement) => {
        el.innerHTML = `<ul class="bands">${c.clans.slice(0, 60).map((b) => `<li data-band="${b.id}"><span class="dot" style="background:${color}"></span>
          <div><b>${esc(b.name)}</b> <span class="badge${b.settled ? ' village' : ''}">${b.settled ? 'village' : 'nomads'}</span><div class="muted">${num(b.size)} people</div></div></li>`).join('')}</ul>
          ${c.clans.length > 60 ? `<p class="muted">and ${c.clans.length - 60} more</p>` : ''}`;
      } },
      { id: 'lineage', label: 'Lineage', render: (el: HTMLElement) => {
        el.innerHTML = `<h3>Where it came from</h3><p>${c.from ? `It split from ${c.from.alive ? link(c.from.id, c.from.name ?? `culture ${c.from.id}`) : `the culture of ${esc(cap(c.from.name ?? 'a culture now gone'))}`} in ${fmtYear(c.since)}.` : 'It is one of the first cultures of the world.'}</p>
          <h3>Ways it took from others</h3>${c.taughtBy.length ? `<ul class="plain">${c.taughtBy.map((t) => `<li>${fmtYear(t.year)}: from ${link(t.id, t.name)}</li>`).join('')}</ul>` : '<p class="muted">None yet: it learned everything itself.</p>'}
          <h3>Cultures that split from it</h3>${c.daughters.length ? `<p>${c.daughters.map((d) => link(d.id, d.name)).join(', ')}</p>` : '<p class="muted">None yet.</p>'}`;
      } },
    ],
  };
  ui.openCard(cardHtml(spec));
  mountCard(spec);
  // light its land while the card is open
  cultureLayer?.focus(c.id, { id: c.id, name: c.name, hue: c.hue, from: c.from?.id ?? null, clans: c.clans.length, steps: c.steps });
  const card = document.getElementById('card')!;
  const watch = new MutationObserver(() => {
    if (card.hidden || !document.querySelector('#cultureShow')) { cultureLayer?.focus(null); watch.disconnect(); }
  });
  watch.observe(card, { attributes: true, childList: true, subtree: true });
  const show = document.getElementById('cultureShow');
  if (show && c.clans.length) show.onclick = () => {
    const xs = c.clans.map((b) => b.x), ys = c.clans.map((b) => b.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10);
    ui.lookAt((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(0.25, Math.min(1.2, 18 / span)));
  };
}
