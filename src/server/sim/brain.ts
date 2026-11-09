// Clans that learn. Every clan has a small "brain": how much of its work goes to farming, herding, fishing, crafting,
// building and foraging (hunting and gathering), and how generous it is with its friends.
//
// Learning in a lifetime (a (1+1) evolution strategy, a simple kind of reinforcement learning): every year the clan
// tries a slightly changed strategy. If the clan ate better that year than with its old strategy, it keeps the change;
// if not, it goes back. Over the years each clan climbs towards what works on its own land.
//
// Learning over generations (neuroevolution): a clan that splits gives its brain to the daughter clan with small
// random mutations. Clans whose strategy does not work go hungry, shrink and die out, so good strategies spread.
//
// Nobody writes the strategies: fishing peoples by the rivers, herders on the steppe and farmers on good soil
// appear by themselves.

import type { Band, Person } from './sim';
import type { EventHost } from './events';

export const JOBS = ['farm', 'herd', 'fish', 'craft', 'build', 'forage'] as const;
export type JobKey = (typeof JOBS)[number];

export interface Brain {
  /** weight of each job (multiplies the job's base share), 0.2..5 */
  w: number[];
  /** 0..1: how much food the clan sends to hungry friends */
  give: number;
  /** the strategy being tried this year, or null */
  trial: { w: number[]; give: number } | null;
  /** how well fed the clan was with the kept strategy (smoothed), and this year's sum and count */
  score: number;
  acc: number;
  n: number;
  /** generation of the brain: 0 for the first clans, +1 with every split */
  gen: number;
  /** strategies tried and kept so far */
  tried: number;
  kept: number;
  /** last strategy name announced in the chronicle */
  style?: string;
}

export interface BrainHost extends EventHost {
  s: EventHost['s'] & { brains?: Record<number, Brain> };
}

const clampW = (v: number) => Math.max(0.2, Math.min(5, v));
const LOG_SIGMA_TRIAL = 0.18;
const LOG_SIGMA_BIRTH = 0.25;

function gauss(h: EventHost): number {
  // Box-Muller from the world's own dice, so a world stays the same with the same seed
  const u = Math.max(1e-9, h.rng.next()), v = h.rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mutate(h: EventHost, w: number[], give: number, sigma: number): { w: number[]; give: number } {
  return {
    w: w.map((x) => clampW(x * Math.exp(gauss(h) * sigma))),
    give: Math.max(0, Math.min(1, give + gauss(h) * sigma * 0.4)),
  };
}

function newBrain(h: EventHost, parent?: Brain): Brain {
  const base = parent ? mutate(h, parent.w, parent.give, LOG_SIGMA_BIRTH)
    : mutate(h, JOBS.map(() => 1), 0.5, 0.35);
  return { w: base.w, give: base.give, trial: null, score: parent?.score ?? 1, acc: 0, n: 0, gen: parent ? parent.gen + 1 : 0, tried: 0, kept: 0 };
}

export function brainOf(h: { s: { brains?: Record<number, Brain> } }, id: number): Brain | undefined {
  return h.s.brains?.[id];
}

/** the weights in use right now (the trial while one runs) */
function current(b: Brain): { w: number[]; give: number } {
  return b.trial ?? b;
}

/** called from work(): lean the band's job shares towards what its brain prefers */
export function steerJobs(h: BrainHost, b: Band, jobs: [string, number][]) {
  const br = h.s.brains?.[b.id];
  if (!br) return;
  const w = current(br).w;
  for (const j of jobs) {
    const k = JOBS.indexOf(j[0] as JobKey);
    if (k >= 0) j[1] *= w[k];
  }
}

/** how generous a clan is (relations.ts uses it for food sent to friends) */
export function generosity(h: { s: { brains?: Record<number, Brain> } }, id: number): number {
  const br = h.s.brains?.[id];
  return br ? current(br).give : 0.5;
}

/** a name for a strategy, from the jobs it leans on most */
export function styleOf(b: Brain, knows: (tech: string) => boolean): { key: string; name: string } {
  const w = current(b).w;
  // only the jobs the clan can actually do count
  const can: Record<JobKey, boolean> = { farm: knows('agriculture'), herd: knows('herding'), fish: knows('fishing'), craft: knows('stone_tools'), build: knows('mudbrick'), forage: true };
  const ranked = JOBS.map((j, i) => [j, w[i]] as const).filter(([j]) => can[j]).sort((a, c) => c[1] - a[1]);
  const top = ranked[0]?.[0] ?? 'forage';
  const second = ranked[1];
  const names: Record<JobKey, string> = { farm: 'Farmers', herd: 'Herders', fish: 'Fisherfolk', craft: 'Craftspeople', build: 'Builders', forage: 'Hunters and gatherers' };
  const balanced = second && ranked[0][1] / Math.max(0.01, second[1]) < 1.15;
  return { key: balanced ? 'balanced' : top, name: balanced ? 'Jacks of all trades' : names[top] };
}

/** every month: give new clans a brain, add up how well each clan eats, and once a year learn */
export function brainStep(h: BrainHost, members: Map<number, Person[]>) {
  const brains = (h.s.brains ??= {});
  for (const b of h.s.bands) {
    let br = brains[b.id];
    if (!br) {
      // a daughter clan takes after the clan it came from
      br = brains[b.id] = newBrain(h, b.from ? brains[b.from.id] : undefined);
    }
    // how well fed: the band's smoothed food cover, but a growing clan also counts as doing well
    br.acc += Math.min(2, b.fed ?? 1);
    br.n++;
  }
  if (h.month !== 11) return;
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (!br || br.n < 6) continue;
    const year = br.acc / br.n;
    br.acc = 0;
    br.n = 0;
    if (br.trial) {
      br.tried++;
      // keep the new way only if it fed the clan better (a little noise is forgiven: the weather differs)
      if (year > br.score + 0.01) {
        br.w = br.trial.w;
        br.give = br.trial.give;
        br.kept++;
        br.score = year;
      } else {
        // what the old way scores drifts with the land: remember it softly
        br.score = br.score * 0.7 + year * 0.3;
      }
      br.trial = null;
    } else {
      br.score = br.score * 0.5 + year * 0.5;
    }
    // try something new next year
    br.trial = mutate(h, br.w, br.give, LOG_SIGMA_TRIAL);
    // a clan whose way of life changed is news, now and then
    const style = styleOf(br, (t) => h.hasTech(b, t));
    if (br.style && style.key !== br.style && (members.get(b.id)?.length ?? 0) >= 12 && h.rng.chance(0.35)) {
      h.emit('learned', 1, `${h.bandLabel(b, true)} промени начина си на живот: ${STYLE_BG[style.key] ?? style.name}.`, undefined, undefined, b.id, [],
        [`${h.bandEnLabel(b, true)} changed their way of life: they are ${style.name.toLowerCase()} now.`]);
    }
    br.style = style.key;
  }
  // forget the brains of clans that are gone
  if (h.s.tick % 60 === 0) {
    const alive = new Set(h.s.bands.map((b) => b.id));
    for (const id of Object.keys(brains)) if (!alive.has(Number(id))) delete brains[Number(id)];
  }
}

const STYLE_BG: Record<string, string> = {
  farm: 'вече са земеделци', herd: 'вече са скотовъдци', fish: 'вече са рибари', craft: 'вече са занаятчии',
  build: 'вече са строители', forage: 'отново са ловци и събирачи', balanced: 'вече правят по малко от всичко',
};

/** for the dashboard: how many clans follow each strategy, and the average brain */
export function brainSummary(h: BrainHost) {
  const brains = h.s.brains ?? {};
  const styles: Record<string, number> = {};
  const avg = JOBS.map(() => 0);
  let gen = 0, maxGen = 0, tried = 0, kept = 0, n = 0;
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (!br) continue;
    n++;
    const st = styleOf(br, (t) => h.hasTech(b, t));
    styles[st.name] = (styles[st.name] ?? 0) + 1;
    br.w.forEach((x, i) => { avg[i] += x; });
    gen += br.gen; maxGen = Math.max(maxGen, br.gen); tried += br.tried; kept += br.kept;
  }
  return {
    clans: n, styles, avgWeights: Object.fromEntries(JOBS.map((j, i) => [j, n ? +(avg[i] / n).toFixed(2) : 1])),
    avgGeneration: n ? +(gen / n).toFixed(1) : 0, maxGeneration: maxGen, tried, kept,
  };
}

/** for a clan card */
export function brainView(h: BrainHost, b: Band) {
  const br = h.s.brains?.[b.id];
  if (!br) return null;
  const st = styleOf(br, (t) => h.hasTech(b, t));
  return {
    style: st.name, weights: Object.fromEntries(JOBS.map((j, i) => [j, +br.w[i].toFixed(2)])), give: +br.give.toFixed(2),
    generation: br.gen, tried: br.tried, kept: br.kept, score: +br.score.toFixed(2), trying: !!br.trial,
  };
}
