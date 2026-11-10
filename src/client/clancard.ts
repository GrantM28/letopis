// The clan card (1.60): the shared card layout with four tabs.
//   Overview    what its people do, where it came from, its newest discoveries, the help buttons
//   Brain       what its brain does right now and why, in words; what it senses; how it learns; the network behind a button
//   Neighbours  its realm, its culture, its trade partners, its friends and rivals
//   People      everyone, the chief first
// main.ts hands over what it already knows (the counts and what everyone is doing this month).
import type { BandView } from '../shared/types';
import { TASK_NAMES } from '../shared/types';
import { B, CHIEF, P, TASK, TECH, VILLAGE, fmtYear, num } from './lang';
import { api, esc, ui } from './kit';
import { useAct } from './help';
import { BrainNet, DeepNet, brainSvg } from './brainview';
import { readableNet, wireNet } from './netview';
import { realmOfBand } from './realms';
import { cardHtml, chip, mountCard, type CardTab } from './cardkit';
import type { PersonListRow } from './people';

export interface ClanBasics {
  children: number;
  elders: number;
  /** what everyone is doing this month: [task in words, how many] */
  tasks: [string, number][];
  era: string;
  origin: string;
}

interface BrainData {
  style: string; give: number; roam: number; inspired: boolean; network: string;
  now: Record<string, number>; weights: Record<string, number>;
  brain2?: boolean; deep?: DeepNet | null; memory?: number[] | null; lastPeriod?: number | null; senses?: number[]; senseNames?: string[];
  can?: string[]; reasons?: { text: string; up: boolean; strength: number }[];
  culture?: { id: number; name: string; steps: number; since: number; from: string | null; clans: { id: number; name: string }[] } | null;
  generation: number; tried: number; kept: number; copied: number; copiedKept: number; step: number;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const JOB: Record<string, string> = { farm: 'Farming', herd: 'Herding', fish: 'Fishing', craft: 'Crafting', build: 'Building', forage: 'Hunting and gathering' };

/** how well fed a clan has been lately, in words (1 = just enough) */
function fedWords(fed = 1): string {
  return fed >= 1.2 ? 'plenty' : fed >= 0.97 ? 'enough' : fed >= 0.8 ? 'short' : 'hungry';
}

export async function showClanCard(b: BandView, basics: ClanBasics) {
  const [brain, realm] = await Promise.all([
    api<BrainData | null>(`/api/brain/${b.id}`).catch(() => null),
    realmOfBand(b.id).catch(() => null),
  ]);
  const color = hex(b.color);
  const title = b.settlementName ? VILLAGE(b.settlementName) : B(b.name);
  const chips: string[] = [];
  if (b.chief) chips.push(chip('🧓', `${esc(CHIEF(b.chief.title))} ${esc(P(b.chief.name))}`, `data-person="${b.chief.id}"`));
  if (brain?.culture) chips.push(chip('🌐', `Culture of ${esc(brain.culture.name.replace(/^the /, 'the '))}`, `data-culture="${brain.culture.id}"`));
  if (realm) chips.push(chip('♛', `${realm.capital === b.id ? 'Capital of' : 'Part of'} the ${esc(realm.name)}`, `data-realm="${realm.id}"`));
  if (brain?.inspired) chips.push(chip('💭', 'Inspired'));
  const tabs: CardTab[] = [
    { id: 'overview', label: 'Overview', render: (el) => overview(el, b, basics) },
    { id: 'brain', label: 'Brain', render: (el) => brainTab(el, b, brain) },
    { id: 'neighbours', label: 'Neighbours', render: (el) => neighbours(el, b, brain, realm) },
    { id: 'people', label: 'People', render: (el) => peopleTab(el, b) },
  ];
  const spec = {
    kind: 'clan', dot: color, title,
    facts: `${b.settled ? 'village' : 'wandering clan'}${b.settlementName ? ` of ${esc(B(b.name))}` : ''} · ${esc(basics.era)} · since ${fmtYear(b.founded)}`,
    chips,
    stats: [['people', num(b.size)], ['children', num(basics.children)], ['elders', num(basics.elders)], ['food', fedWords(b.fed)]] as [string, string][],
    tabs, help: 'brain',
  };
  ui.openCard(cardHtml(spec));
  mountCard(spec);
}

function overview(el: HTMLElement, b: BandView, basics: ClanBasics) {
  const total = basics.tasks.reduce((a, [, n]) => a + n, 0) || 1;
  const color = hex(b.color);
  const techs = b.techs.slice(-6).reverse();
  el.innerHTML = `
    <h3>What the grown-ups are doing</h3>
    <div class="barlist">${basics.tasks.sort((x, y) => y[1] - x[1]).slice(0, 6).map(([t, n]) => `<div class="barrow"><span class="bl-k">${esc(t)}</span><span class="bl-v">${Math.round((n / total) * 100)}%</span>
      <div class="bl-bar"><i style="width:${(n / total) * 100}%;background:${color}"></i></div></div>`).join('')}</div>
    <h3>Where they came from</h3><div class="ck-note">${basics.origin}</div>
    <h3>What they know <small>${b.techs.length}</small></h3>
    <div class="techs">${techs.map((t) => `<span class="pill">${esc(TECH(t))}</span>`).join('') || '<span class="muted">Nothing yet</span>'}
      ${b.techs.length > techs.length ? `<button class="chip" id="allTechs">all ${b.techs.length}</button>` : ''}</div>
    <h3>Lend them a hand</h3>
    <div class="help-row">
      <button class="btn" data-act="bless" title="Food for this clan">🌟 Bless</button><button class="btn" data-act="rain" title="Rain over their land">🌧️ Rain</button>
      <button class="btn" data-act="inspire" title="Four times the chance of a discovery for two years">💭 Inspire</button>
      <button class="btn" data-act="feast" title="They invite their neighbours">🍖 Feast</button><button class="btn" data-act="calm" title="Make peace with their rivals">🕊️ Calm</button>
    </div><p class="act-note" hidden></p>`;
  el.querySelector<HTMLButtonElement>('#allTechs')?.addEventListener('click', (e) => {
    (e.target as HTMLElement).parentElement!.innerHTML = b.techs.map((t) => `<span class="pill">${esc(TECH(t))}</span>`).join('');
  });
  el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const note = el.querySelector<HTMLElement>('.act-note')!;
      note.hidden = false;
      note.innerHTML = await useAct(btn.dataset.act!, b.id);
      btn.disabled = false;
    };
  });
}

/** a leaning in words: the brain's push on a job against an even share */
function lean(v: number): string {
  return v >= 2 ? 'much more' : v >= 1.25 ? 'more' : v > 0.8 ? 'as usual' : v > 0.4 ? 'less' : 'much less';
}

/** the 18 senses in six groups */
const GROUPS: [string, string[]][] = [
  ['Season', ['spring/autumn', 'winter/summer', 'warmth']],
  ['Food', ['hunger', 'food stores']],
  ['Land', ['fruit', 'game', 'fish', 'wood']],
  ['People', ['size', 'children', 'elders', 'settled']],
  ['Neighbours', ['crowding', 'friends near', 'rivals near']],
  ['Times', ['age of the world', 'last period']],
];
const SENSE_LABEL: Record<string, string> = {
  'spring/autumn': 'spring ↔ autumn', 'winter/summer': 'winter ↔ summer', 'food stores': 'stores', 'friends near': 'friends', 'rivals near': 'rivals',
  'age of the world': 'age of the world', 'last period': 'last five years',
};

function brainTab(el: HTMLElement, b: BandView, br: BrainData | null) {
  if (!br) { el.innerHTML = '<p class="muted">Still finding its way.</p>'; return; }
  const can = new Set(br.can ?? Object.keys(JOB));
  const color = hex(b.color);
  // 1. right now: how the brain leans on each job it can do (an even share is "as usual")
  const jobs = Object.entries(br.now).filter(([k]) => can.has(k)).sort((x, y) => y[1] - x[1]);
  const max = Math.max(1, ...jobs.map(([, v]) => v));
  const gauge = (label: string, v: number, c: string, words: string) => `<div class="gauge"><span>${label}</span><div class="bl-bar"><i style="width:${Math.round(v * 100)}%;background:${c}"></i></div><b>${words}</b></div>`;
  // 3. what it senses, grouped
  const names = br.senseNames ?? [];
  const val = (n: string) => { const i = names.indexOf(n); return i >= 0 && br.senses ? br.senses[i] : null; };
  const senseBar = (n: string) => {
    const v = val(n);
    if (v === null) return '';
    const two = n === 'spring/autumn' || n === 'winter/summer' || n === 'warmth' || n === 'hunger' || n === 'last period';
    const w = two ? Math.abs(v) * 50 : Math.min(100, Math.max(0, v * 66));
    const at = two ? (v >= 0 ? 'left:50%' : `left:${50 - w}%`) : 'left:0';
    return `<div class="sense"><span>${esc(SENSE_LABEL[n] ?? n)}</span><div class="sense-bar${two ? ' two' : ''}"><i style="${at};width:${w}%"></i></div></div>`;
  };
  const c = br.culture;
  el.innerHTML = `
    <p class="ck-note">A small neural network decides, every month, how this clan shares its work, how generous it is and whether to move on.
      It is ${c ? `shared by its whole culture, ` : ''}learned by trial over the years; nobody wrote it.</p>
    <h3>Right now</h3>
    <div class="leans">${jobs.map(([k, v]) => `<div class="lean"><span>${JOB[k] ?? k}</span><div class="bl-bar"><i style="width:${(v / max) * 100}%;background:${color}"></i></div><b>${lean(v)}</b></div>`).join('')}</div>
    <div class="gauges">${gauge('Generosity to friends', br.give, 'var(--good)', `${Math.round(br.give * 100)}%`)}
      ${b.settled ? '' : gauge('Restlessness', br.roam, 'var(--accent-2)', br.roam > 0.6 ? 'eager to move' : br.roam > 0.3 ? 'may move' : 'settled in')}</div>
    ${br.reasons?.length ? `<h3>Why</h3><ul class="reasons">${br.reasons.map((r) => `<li><span class="arrow ${r.up ? 'up' : 'down'}">${r.up ? '▲' : '▼'}</span>${esc(r.text)}</li>`).join('')}</ul>` : ''}
    ${names.length ? `<h3>What it senses now</h3><div class="senses">${GROUPS.map(([g, ns]) => {
      const rows = ns.map(senseBar).join('');
      return rows ? `<div class="sense-group"><h4>${g}</h4>${rows}</div>` : '';
    }).join('')}</div>` : ''}
    ${br.memory?.length ? `<div class="memory"><span>Its memory</span>${br.memory.map((m) => `<i title="${m.toFixed(2)}" style="opacity:${0.25 + Math.abs(m) * 0.75};background:${m >= 0 ? 'var(--accent)' : 'var(--accent-2)'}"></i>`).join('')}<small>six numbers it keeps from month to month; what they mean, it chose itself</small></div>` : ''}
    <h3>How it learns</h3>
    <p class="ck-note">${c ? `Its culture, <a href="#" class="ref" data-culture="${c.id}">the culture of ${esc(c.name)}</a>, tries a small change for five years, then the opposite, and keeps
      whichever made it grow more: ${num(c.steps)} steps so far${br.lastPeriod !== null && br.lastPeriod !== undefined ? `, and the last five years went ${br.lastPeriod >= 0 ? 'better' : 'worse'} than the five before` : ''}.`
      : `It tries a slightly changed copy for two years and keeps it if the clan ate better and grew: ${br.kept} of ${br.tried} changes kept.`}</p>
    <button class="btn" id="showNet">Show the network</button><div id="netHolder" hidden></div>`;
  el.querySelector<HTMLButtonElement>('#showNet')!.onclick = (e) => {
    const h = el.querySelector<HTMLElement>('#netHolder')!;
    h.hidden = !h.hidden;
    (e.target as HTMLElement).textContent = h.hidden ? 'Show the network' : 'Hide the network';
    if (!h.hidden && !h.innerHTML) { h.innerHTML = br.deep ? readableNet(br.deep) : brainSvg(br as unknown as BrainNet); wireNet(h); }
  };
}

async function neighbours(el: HTMLElement, b: BandView, br: BrainData | null, realm: Awaited<ReturnType<typeof realmOfBand>>) {
  const [rels, trade] = await Promise.all([
    api<{ id: number; name: string; color: number; score: number; kind: string }[]>(`/api/relations/${b.id}`).catch(() => []),
    api<{ a: number; b: number; since: number }[]>('/api/trade').catch(() => []),
  ]);
  const shown = rels.filter((x) => x.kind !== 'neutral').slice(0, 12);
  const label: Record<string, string> = { ally: 'ally', friendly: 'friendly', cool: 'cool', rival: 'rival' };
  const partners = trade.filter((t) => t.a === b.id || t.b === b.id).map((t) => ({ id: t.a === b.id ? t.b : t.a, since: t.since }));
  const nameOf = (id: number) => rels.find((x) => x.id === id)?.name ?? `clan ${id}`;
  const c = br?.culture;
  el.innerHTML = `
    ${realm ? `<h3>Its realm</h3><p>${realm.capital === b.id ? 'The capital' : 'Part'} of the <a href="#" class="ref" data-realm="${realm.id}">${esc(realm.name)}</a>${realm.ruler ? `, ruled by ${esc(realm.ruler)}` : ''}.</p>` : ''}
    ${c ? `<h3>Its culture</h3><p><a href="#" class="ref" data-culture="${c.id}">The culture of ${esc(c.name)}</a>: ${c.clans.length} clan${c.clans.length === 1 ? '' : 's'} sharing one brain.</p>` : ''}
    ${partners.length ? `<h3>Trading with</h3><ul class="plain">${partners.map((p) => `<li><a href="#" class="ref" data-band="${p.id}">${esc(nameOf(p.id))}</a> <span class="muted">· since ${fmtYear(p.since)}</span></li>`).join('')}</ul>` : ''}
    <h3>Friends and rivals</h3>
    ${shown.length ? `<ul class="rels">${shown.map((x) => `<li data-band="${x.id}"><span class="dot" style="background:${hex(x.color)}"></span>
        <span class="rel-name">${esc(x.name)}</span><span class="rel ${x.kind}">${label[x.kind]}</span>
        <span class="rel-bar"><i style="width:${Math.abs(x.score) / 2}%;${x.score < 0 ? 'right:50%' : 'left:50%'}" class="${x.score < 0 ? 'neg' : 'pos'}"></i></span></li>`).join('')}</ul>`
      : '<p class="muted">No strong feelings for any neighbour yet.</p>'}`;
}

async function peopleTab(el: HTMLElement, b: BandView) {
  const res = await api<{ total: number; people: PersonListRow[] }>(`/api/people?band=${b.id}&sort=old&limit=200`);
  const list = res.people.slice().sort((x, y) => Number(y.chief) - Number(x.chief));
  el.innerHTML = `<ul class="people">${list.map((p) => `<li data-person="${p.id}"><span class="avatar sm ${p.sex ? 'f' : 'm'}">${p.age < 12 ? '🧒' : p.age >= 60 ? (p.sex ? '👵' : '👴') : p.sex ? '👩' : '👨'}</span>
    <div><b>${esc(p.name)}</b>${p.chief ? ' <span class="badge village">chief</span>' : ''}<div class="muted">${p.age} y · ${esc(TASK(TASK_NAMES[p.task as keyof typeof TASK_NAMES] ?? p.task))}${p.deeds ? ` · ${p.deeds} deed${p.deeds > 1 ? 's' : ''}` : ''}</div></div></li>`).join('') || '<li class="muted">Nobody.</li>'}</ul>
    ${res.total > list.length ? `<p class="muted">and ${num(res.total - list.length)} more</p>` : ''}`;
}
