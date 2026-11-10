// The fork's statistics: the Stats tab and the full dashboard (charts, records, ages, the clans' learning).
import { ERAS_EN, TECH_LIST } from '../shared/i18n';
import { barList, lineChart } from './charts';
import { fmtYear, num } from './lang';
import { $, api, esc, ui } from './kit';

let statsAt = 0;
/** the next visit to the tab loads fresh numbers */
export const resetStats = () => { statsAt = 0; };

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
  learning?: { year: number; score: number; gen: number }[];
}

const EVENT_NAMES: Record<string, string> = {
  discovery: 'First discoveries', rediscovery: 'Rediscoveries', learn: 'Knowledge shared', death: 'Notable deaths', twins: 'Twins born',
  marriage: 'Marriages between clans', meet: 'Clans meeting', merge: 'Clans merging', extinct: 'Clans dying out', settle: 'Villages founded',
  hunt: 'Great hunts', winter: 'Hard winters', drought: 'Droughts', flood: 'Floods', plague: 'Plagues', harvest: 'Rich harvests',
  comet: 'Comets', eclipse: 'Eclipses', quake: 'Earthquakes', fire: 'Town fires', festival: 'Festivals', wonder: 'Great buildings',
  expedition: 'Expeditions', secret: 'Secrets found', era: 'New ages', milestone: 'Population milestones', blessing: 'Blessings',
  rain: 'Rains sent', feast: 'Feasts', lost: 'Knowledge lost',
  alliance: 'Alliances sworn', rivalry: 'Rivalries', quarrel: 'Quarrels', aid: 'Food sent to friends', peace: 'Feuds ended', estranged: 'Friendships faded',
  learned: 'Clans changing their way of life', culture: 'Cultures parting', trade: 'Trade roads opened and fallen quiet', realm: 'Realms rising, changing and falling', ruler: 'New rulers', rollback: 'Worlds turned back', inspired: 'Inventors inspired', prayer: 'Prayers', imitate: 'Clans learning from neighbours', move: 'Camps moved',
};

const css = (v: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

/** the statistics tab; `wide` lays the same out on two columns in a big card */
export async function renderStats(body: HTMLElement, wide = false) {
  if (!wide && performance.now() - statsAt < 15000 && body.querySelector('.chart')) return;
  if (!wide) statsAt = performance.now();
  const h = await api<History>('/api/history').catch(() => null);
  if (!wide && ui.activeTab() !== 'stats') return;
  if (!h) { body.innerHTML = '<p class="muted">Could not load the statistics. Try again in a moment.</p>'; return; }
  const s = h.series;
  const last = s[s.length - 1];
  const known = ui.knownNow();
  const villages = ui.bands().filter((b) => b.settled).length;
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
        ${kpi('People', num(ui.people().length || last?.population || 0), trend(last?.population, prev?.population))}
        ${kpi('Clans', num(ui.bands().length), `${villages} villages`)}
        ${kpi('Discoveries', `${known.size}/${TECH_LIST.length}`, ui.eraName(ui.currentEra()))}
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
      <li class="done"><b>${ui.eraName(0)}</b><small>${fmt(-12000)}</small></li>
      ${ERAS_EN.slice(1).map((_, i) => {
        const e = i + 1;
        const reached = e <= h.era;
        const ev = h.eras[e - 1];
        const note = reached ? (ev ? fmt(ev.year) : 'reached') : e === h.era + 1 ? `opens with ${ui.techLabel(ui.gates.get(e) ?? '')}` : 'still ahead';
        return `<li class="${reached ? 'done' : e === h.era + 1 ? 'next' : ''}"><b>${ui.eraName(e)}</b><small>${note}</small></li>`;
      }).join('')}
    </ol></section>
    <section><h3>How the clans learned</h3><div id="dashBrains" class="muted">Loading…</div></section>
    <section><h3>How people died</h3>${barList(Object.entries(h.causes), '#b48ead', 8)}</section>
    <section><h3>What happened most</h3>${barList(Object.entries(h.events).map(([k, v]) => [`${ui.icon[k] ?? '•'} ${EVENT_NAMES[k] ?? k}`, v] as [string, number]), 'var(--accent-2)', 12)}</section>
    <section class="span2"><h3>What people know</h3><div class="techs">${[...known].map((t) => `<span class="pill">${esc(ui.techLabel(t))}</span>`).join('') || '<span class="muted">Nothing yet</span>'}</div></section>
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
  api<{ clans: number; styles: Record<string, number>; avgGeneration: number; maxGeneration: number; tried: number; kept: number; copied?: number; copiedKept?: number; avgStep?: number; network: { inputs: number; hidden: number; outputs: number; weights: number; layers?: number[] }; brain2?: boolean;
    cultures?: { id: number; name: string; clans: number; steps: number; score: number; since: number }[] } | null>('/api/brains').then((bs) => {
    const el = body.querySelector<HTMLElement>('#dashBrains');
    if (!el || !bs) return;
    el.classList.remove('muted');
    if (bs.brain2) {
      const cs = bs.cultures ?? [];
      el.innerHTML = `<p class="lead">Each culture shares one brain and learns it by trial: five years with a small change, five with the
        opposite, keeping whichever made it grow more. <a href="#" class="ck-help" data-help="cultures">How it works</a></p>
        <div id="chLearn"></div>
        <h4>Biggest cultures <small>${cs.length} in all</small></h4>
        <ul class="plain">${cs.slice(0, 10).map((c) => `<li><a href="#" class="ref" data-culture="${c.id}">the culture of ${esc(c.name)}</a>
          <span class="muted">· ${c.clans} clan${c.clans === 1 ? '' : 's'} · ${num(c.steps)} learning steps</span></li>`).join('')}</ul>
        <h4>Ways of life now</h4>${barList(Object.entries(bs.styles), 'var(--accent)', 8)}`;
      const L = h.learning ?? [];
      lineChart(el.querySelector<HTMLElement>('#chLearn')!, { xs: L.map((x) => x.year), fmtX: fmt, height: 130, fmtY: (y) => y.toFixed(2), series: [
        { name: 'How well clans do (food and growth)', color: '#6cc38a', values: L.map((x) => x.score), fill: true },
      ] });
      return;
    }
    el.innerHTML = `<p class="lead">Every clan carries a small neural network (${bs.network.inputs} senses → ${bs.network.hidden} neurons, ${bs.network.weights} weights)
      that decides each month how the clan shares its work between six jobs, how generous it is with friends and when a wandering clan moves on.
      A clan learns by trial: it lives two years with a slightly changed copy of its network and keeps the copy only if it ate better and grew;
      now and then the copy is a blend with a neighbour doing better. Daughter clans inherit their parents' network with small changes.
      Nobody wrote these strategies.</p>
      <p class="muted">How much it helps: in tests over 3,000 years, learning changes how clans live but has not made worlds bigger than clans whose
      brains never change. A new brain where whole cultures learn together is being built to fix that.</p>
      <div id="chLearn"></div>
      <h4>Ways of life now</h4>${barList(Object.entries(bs.styles), 'var(--accent)', 8)}
      <p class="muted">Generations (daughter clans count one more than their parents): ${bs.avgGeneration} on average, up to ${bs.maxGeneration}
        · ${num(bs.kept)} of ${num(bs.tried)} changes kept by the clans alive now · ${num(bs.copiedKept ?? 0)} of ${num(bs.copied ?? 0)} blends with neighbours kept.</p>`;
    const L = h.learning ?? [];
    lineChart(el.querySelector<HTMLElement>('#chLearn')!, { xs: L.map((x) => x.year), fmtX: fmt, height: 130, fmtY: (y) => y.toFixed(2), series: [
      { name: 'How well clans do (food and growth)', color: '#6cc38a', values: L.map((x) => x.score), fill: true },
      { name: 'Generation ÷ 10', color: '#b48ead', values: L.map((x) => x.gen / 10), dashed: true },
    ] });
  }).catch(() => {});
  const wideBtn = body.querySelector<HTMLButtonElement>('#statsWide');
  if (wideBtn) wideBtn.onclick = () => { ui.openCard('<div id="dashBody"><p class="muted">Loading…</p></div>', false, 'wide'); void renderStats($('#dashBody'), true); };
}
