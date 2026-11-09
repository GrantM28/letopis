// Clans that learn: every clan carries a small neural network, its "brain".
//
// Each month the network senses the clan's situation (11 inputs: the season, how well fed the clan is, its stores,
// the fruit, game and fish around it, the cold, its size, whether it is settled and the age of the world), passes
// it through 8 hidden neurons and decides (7 outputs) how the clan's work is shared between farming, herding,
// fishing, crafting, building and foraging, and how generous it is with its friends. So a clan can learn to hunt
// more in winter, fish when the game is gone, or share when it is rich.
//
// Learning in a lifetime: once a year the clan tries a slightly changed network (a (1+1) evolution strategy, a
// gradient-free kind of reinforcement learning). If the clan ate better that year than with its old network,
// it keeps the change; if not, it goes back.
//
// Learning over generations (neuroevolution): a clan that splits gives its network to the daughter clan with
// small random mutations. Clans whose network does not work go hungry, shrink and die out; good networks spread.
// Nobody writes these strategies.

import type { Band, Person } from './sim';
import type { EventHost } from './events';
import { idx, inBounds } from './world';

export const JOBS = ['farm', 'herd', 'fish', 'craft', 'build', 'forage'] as const;
export type JobKey = (typeof JOBS)[number];

/** what the network senses, in order */
export const SENSES = ['season (spring–autumn)', 'season (winter–summer)', 'hunger', 'food stores', 'fruit around', 'game around',
  'fish around', 'settled', 'clan size', 'age of the world', 'warmth'] as const;
const IN = SENSES.length;
const HID = 8;
const OUT = JOBS.length + 1; // the jobs and generosity
const PARAMS = IN * HID + HID + HID * OUT + OUT;

export interface Brain {
  /** the network's weights: input->hidden, hidden biases, hidden->output, output biases */
  net?: number[];
  /** what the network decided last month (job weights) and how generous it is now */
  out?: number[];
  /** the job weights and generosity averaged over the last year (for showing and naming the way of life) */
  w: number[];
  give: number;
  /** the network being tried this year, or null */
  trial: { net: number[] } | null;
  /** how well fed the clan was with the kept network (smoothed), and this year's sum and count */
  score: number;
  acc: number;
  n: number;
  /** for the yearly average of the decisions */
  wAcc?: number[];
  /** clan size when this year began (growth is part of how well a network did) */
  size0?: number;
  /** what the clan sensed last month (for explaining the brain) */
  senses?: number[];
  /** generation of the brain: 0 for the first clans, +1 with every split */
  gen: number;
  tried: number;
  kept: number;
  style?: string;
}

export interface BrainHost extends EventHost {
  s: EventHost['s'] & { brains?: Record<number, Brain> };
}

const SIGMA_TRIAL = 0.08;
/** for experiments only: LETOPIS_NO_LEARN=1 freezes every network as it was born (tools/tests compare with and without learning) */
const LEARN = !(typeof process !== 'undefined' && process.env?.LETOPIS_NO_LEARN === '1');
const SIGMA_BIRTH = 0.12;

function gauss(h: EventHost): number {
  // Box-Muller from the world's own dice, so a world stays the same with the same seed
  const u = Math.max(1e-9, h.rng.next()), v = h.rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** a fresh network; with a clan's old fixed preferences (before the networks) as its starting point */
function newNet(h: EventHost, w?: number[], give?: number): number[] {
  const net: number[] = [];
  for (let i = 0; i < IN * HID; i++) net.push(r3(gauss(h) * 0.35));
  for (let i = 0; i < HID; i++) net.push(r3(gauss(h) * 0.1));
  for (let i = 0; i < HID * OUT; i++) net.push(r3(gauss(h) * 0.2));
  for (let o = 0; o < OUT; o++) {
    const base = o < JOBS.length ? Math.log(Math.max(0.2, w?.[o] ?? 1)) : Math.log((give ?? 0.5) / Math.max(0.01, 1 - (give ?? 0.5)));
    net.push(r3(w ? base : base + gauss(h) * 0.3));
  }
  return net;
}

function mutate(h: EventHost, net: number[], sigma: number): number[] {
  return net.map((x) => r3(Math.max(-6, Math.min(6, x + gauss(h) * sigma))));
}

/** the network: senses in, job weights (0.2..5) and generosity (0..1) out */
export function forward(net: number[], x: number[]): number[] {
  const hid = new Array<number>(HID);
  for (let j = 0; j < HID; j++) {
    let s = net[IN * HID + j];
    for (let i = 0; i < IN; i++) s += net[j * IN + i] * x[i];
    hid[j] = Math.tanh(s);
  }
  const base = IN * HID + HID;
  const out: number[] = [];
  for (let o = 0; o < OUT; o++) {
    let s = net[base + HID * OUT + o];
    for (let j = 0; j < HID; j++) s += net[base + o * HID + j] * hid[j];
    out.push(o < JOBS.length ? Math.exp(Math.max(-1.6, Math.min(1.6, s))) : 1 / (1 + Math.exp(-s)));
  }
  return out;
}

/** share of the land around a band that is still full of a resource (0..1) */
function fullness(field: Float32Array, cap: Float32Array | null, b: Band, R: number): number {
  const cx = Math.round(b.cx), cy = Math.round(b.cy);
  let s = 0, c = 0;
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    s += field[i];
    c += cap ? cap[i] : 1;
  }
  if (!c) return 0;
  return cap ? s / c : (s / c) / (s / c + 0.5);
}

/** what a band senses this month, each about -1..1 */
function sense(h: BrainHost, b: Band, size: number): number[] {
  const m = h.month;
  const temp = h.t.temp[idx(Math.round(b.cx), Math.round(b.cy))] ?? 0.5;
  return [
    Math.sin((m / 12) * Math.PI * 2), Math.cos((m / 12) * Math.PI * 2),
    Math.max(-1, Math.min(1, 1 - (b.fed ?? 1))),
    Math.min(1.5, Math.log1p(Math.max(0, b.food) / Math.max(1, size)) / 3),
    fullness(h.t.plants, h.t.plantsCap, b, 6), fullness(h.t.game, h.t.gameCap, b, 8), fullness(h.t.fish, null, b, 6),
    b.settled ? 1 : 0, Math.min(1.5, Math.log1p(size) / 4), h.s.era / 8, temp * 2 - 1,
  ];
}

export function brainOf(h: { s: { brains?: Record<number, Brain> } }, id: number): Brain | undefined {
  return h.s.brains?.[id];
}

/** called from work(): lean the band's job shares towards what its brain decided this month */
export function steerJobs(h: BrainHost, b: Band, jobs: [string, number][]) {
  const br = h.s.brains?.[b.id];
  const w = br?.out ?? br?.w;
  if (!w) return;
  for (const j of jobs) {
    const k = JOBS.indexOf(j[0] as JobKey);
    if (k >= 0) j[1] *= w[k];
  }
}

/** how generous a clan is right now (relations.ts uses it for food sent to friends) */
export function generosity(h: { s: { brains?: Record<number, Brain> } }, id: number): number {
  const br = h.s.brains?.[id];
  return br ? (br.out?.[JOBS.length] ?? br.give) : 0.5;
}

/** a name for a way of life, from the jobs a clan leaned on most over the year */
export function styleOf(b: Brain, knows: (tech: string) => boolean): { key: string; name: string } {
  const w = b.w;
  // only the jobs the clan can actually do count
  const can: Record<JobKey, boolean> = { farm: knows('agriculture'), herd: knows('herding'), fish: knows('fishing'), craft: knows('stone_tools'), build: knows('mudbrick'), forage: true };
  const ranked = JOBS.map((j, i) => [j, w[i]] as const).filter(([j]) => can[j]).sort((a, c) => c[1] - a[1]);
  const top = ranked[0]?.[0] ?? 'forage';
  const second = ranked[1];
  const names: Record<JobKey, string> = { farm: 'Farmers', herd: 'Herders', fish: 'Fisherfolk', craft: 'Craftspeople', build: 'Builders', forage: 'Hunters and gatherers' };
  const balanced = second && ranked[0][1] / Math.max(0.01, second[1]) < 1.15;
  return { key: balanced ? 'balanced' : top, name: balanced ? 'Jacks of all trades' : names[top] };
}

/** every month: give new clans a brain, let every brain decide, and once a year learn */
export function brainStep(h: BrainHost, members: Map<number, Person[]>) {
  const brains = (h.s.brains ??= {});
  for (const b of h.s.bands) {
    let br = brains[b.id];
    const parent = b.from ? brains[b.from.id] : undefined;
    if (!br) {
      // a daughter clan takes after the clan it came from, with small mutations
      const net = parent?.net ? mutate(h, parent.net, SIGMA_BIRTH) : newNet(h, parent?.w, parent?.give);
      br = brains[b.id] = { net, w: JOBS.map(() => 1), give: 0.5, trial: null, score: parent?.score ?? 1, acc: 0, n: 0, gen: parent ? parent.gen + 1 : 0, tried: 0, kept: 0 };
    }
    // brains from before the networks: their fixed preferences become the network's starting point
    if (!br.net || br.net.length !== PARAMS) br.net = newNet(h, br.w, br.give);
    // decide for this month from what the clan senses now
    const x = sense(h, b, members.get(b.id)?.length ?? 0);
    br.senses = x.map(r3);
    br.out = forward(br.trial?.net ?? br.net, x);
    br.wAcc ??= new Array(OUT).fill(0);
    br.out.forEach((v, i) => { br.wAcc![i] += v; });
    // how well fed the clan is (beyond plenty more food does not count)
    if (br.n === 0) br.size0 = members.get(b.id)?.length ?? 0;
    br.acc += Math.min(1.4, b.fed ?? 1);
    br.n++;
  }
  if (h.month !== 11) return;
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (!br || br.n < 6) continue;
    // what the learning tries to make better: eating well and growing (natural selection rewards the same)
    const size = members.get(b.id)?.length ?? 0;
    const grow = Math.max(-0.3, Math.min(0.3, (size - (br.size0 ?? size)) / Math.max(5, br.size0 ?? size)));
    const year = br.acc / br.n + grow * 2;
    // the decisions of the year, on average: the clan's way of life
    if (br.wAcc) {
      br.w = br.wAcc.slice(0, JOBS.length).map((v) => r3(v / br.n));
      br.give = r3(br.wAcc[JOBS.length] / br.n);
    }
    br.wAcc = new Array(OUT).fill(0);
    br.acc = 0;
    br.n = 0;
    if (br.trial) {
      br.tried++;
      // keep the new network only if it fed the clan better (a little noise is forgiven: the weather differs)
      if (year > br.score + 0.01) {
        br.net = br.trial.net;
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
    if (LEARN) br.trial = { net: mutate(h, br.net!, SIGMA_TRIAL) };
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

/** which senses move a clan's decisions most right now: nudge each and see how much the job shares change */
function whatMatters(br: Brain): { sense: string; effect: number }[] {
  if (!br.net || !br.senses) return [];
  const base = forward(br.net, br.senses);
  const share = (o: number[]) => { const t = o.slice(0, JOBS.length).reduce((a, c) => a + c, 0); return o.slice(0, JOBS.length).map((v) => v / t); };
  const b0 = share(base);
  return SENSES.map((name, i) => {
    const x = br.senses!.slice();
    x[i] += 0.5;
    const b1 = share(forward(br.net!, x));
    return { sense: name, effect: b1.reduce((a, v, k) => a + Math.abs(v - b0[k]), 0) };
  }).sort((a, c) => c.effect - a.effect);
}

/** for the dashboard: how many clans follow each way of life, and how well the brains are doing */
export function brainSummary(h: BrainHost) {
  const brains = h.s.brains ?? {};
  const styles: Record<string, number> = {};
  const avg = JOBS.map(() => 0);
  let gen = 0, maxGen = 0, tried = 0, kept = 0, n = 0, score = 0;
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (!br) continue;
    n++;
    const st = styleOf(br, (t) => h.hasTech(b, t));
    styles[st.name] = (styles[st.name] ?? 0) + 1;
    br.w.forEach((x, i) => { avg[i] += x; });
    gen += br.gen; maxGen = Math.max(maxGen, br.gen); tried += br.tried; kept += br.kept; score += br.score;
  }
  return {
    clans: n, styles, avgWeights: Object.fromEntries(JOBS.map((j, i) => [j, n ? +(avg[i] / n).toFixed(2) : 1])),
    avgGeneration: n ? +(gen / n).toFixed(1) : 0, maxGeneration: maxGen, tried, kept, avgScore: n ? +(score / n).toFixed(3) : 0,
    network: { inputs: IN, hidden: HID, outputs: OUT, weights: PARAMS },
  };
}

/** for a clan card */
export function brainView(h: BrainHost, b: Band) {
  const br = h.s.brains?.[b.id];
  if (!br) return null;
  const st = styleOf(br, (t) => h.hasTech(b, t));
  const now = br.out ?? br.w;
  return {
    style: st.name,
    weights: Object.fromEntries(JOBS.map((j, i) => [j, +br.w[i].toFixed(2)])),
    now: Object.fromEntries(JOBS.map((j, i) => [j, +now[i].toFixed(2)])),
    give: +(br.out?.[JOBS.length] ?? br.give).toFixed(2),
    generation: br.gen, tried: br.tried, kept: br.kept, score: +br.score.toFixed(2), trying: !!br.trial,
    reactsTo: whatMatters(br).slice(0, 3).map((x) => x.sense),
    network: `${IN} senses → ${HID} neurons → ${OUT} decisions (${PARAMS} weights)`,
  };
}
