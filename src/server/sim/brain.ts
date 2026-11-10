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
import { BRAIN2_SHAPE, Brain2Part, account2, cultureInfo, cultureSummary, decide2, learn2, moreSenses, neighbourhood, reactsTo2, view2 } from './brain2';

export const JOBS = ['farm', 'herd', 'fish', 'craft', 'build', 'forage'] as const;
export type JobKey = (typeof JOBS)[number];

/** what the network senses, in order */
export const SENSES = ['season (spring–autumn)', 'season (winter–summer)', 'hunger', 'food stores', 'fruit around', 'game around',
  'fish around', 'settled', 'clan size', 'age of the world', 'warmth'] as const;
const IN = SENSES.length;
const HID = 8;
/** outputs after the jobs: generosity, a liking for the hunt (unused, see below), and restlessness (moving camp early) */
const O_GIVE = JOBS.length, O_HUNT = JOBS.length + 1, O_ROAM = JOBS.length + 2;
const OUT = JOBS.length + 3;
const PARAMS = IN * HID + HID + HID * OUT + OUT;
/** the size of the networks before hunting and moving were theirs to decide (v1.33) */
const OUT_V133 = JOBS.length + 1;
const PARAMS_V133 = IN * HID + HID + HID * OUT_V133 + OUT_V133;

export interface Brain extends Brain2Part {
  /** the network's weights: input->hidden, hidden biases, hidden->output, output biases */
  net?: number[];
  /** what the network decided last month (job weights) and how generous it is now */
  out?: number[];
  /** the job weights and generosity averaged over the last year (for showing and naming the way of life) */
  w: number[];
  give: number;
  /** the network being tried this year, or null; 'from' when it was copied from a neighbour */
  trial: { net: number[]; from?: number } | null;
  /** how big a change this clan tries (self-tuning: grows while tries succeed, shrinks while they fail) */
  sigma?: number;
  /** tries copied from neighbours, and how many of them were kept */
  copied?: number;
  copiedKept?: number;
  /** how well fed the clan was with the kept network (smoothed), and this year's sum and count */
  score: number;
  acc: number;
  n: number;
  /** for the yearly average of the decisions */
  wAcc?: number[];
  /** clan size when this year began (growth is part of how well a network did) */
  size0?: number;
  /** people who left this year to found daughter clans: they count as the clan's growth, not its loss */
  founded?: number;
  /** years the current try has run: a try is judged after two years, so slow payoffs (moving to fresh land) count */
  trialYears?: number;
  /** what the clan sensed last month (for explaining the brain) */
  senses?: number[];
  /** generation of the brain: 0 for the first clans, +1 with every split */
  gen: number;
  tried: number;
  kept: number;
  style?: string;
  /** a way of life seen once, waiting to be confirmed by the next period before the chronicle tells it */
  styleSeen?: string;
  styleSeenTimes?: number;
  /** the year the chronicle last told this clan's change of life */
  styleNews?: number;
}

export interface BrainHost extends EventHost {
  s: EventHost['s'] & { brains?: Record<number, Brain> };
}

const SIGMA_TRIAL = 0.08;
/** for experiments only: LETOPIS_NO_LEARN=1 freezes every network as it was born (tools/tests compare with and without learning) */
const LEARN = !(typeof process !== 'undefined' && process.env?.LETOPIS_NO_LEARN === '1');
const SIGMA_BIRTH = 0.12;
/** Brain 2 (brain2.ts: cultures sharing a deeper network) is the brain from v2.0; LETOPIS_BRAIN=1 brings back Brain 1 for comparisons */
const FIXED = typeof process !== 'undefined' && process.env?.LETOPIS_FIXED ? (() => { const v = process.env.LETOPIS_FIXED!.split(',').map(Number); return [...v.slice(0, 6), v[6] ?? 0.5, 0.5, v[7] ?? 0.2]; })() : null;
export const BRAIN2 = !(typeof process !== 'undefined' && process.env?.LETOPIS_BRAIN === '1');

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
    const base = o < JOBS.length ? Math.log(Math.max(0.2, w?.[o] ?? 1)) : o === O_GIVE ? Math.log((give ?? 0.5) / Math.max(0.01, 1 - (give ?? 0.5))) : o === O_ROAM ? -1.5 : 0;
    net.push(r3(w ? base : base + gauss(h) * 0.3));
  }
  return net;
}

/** a v1.33 network (jobs and generosity only) grown to decide hunting and moving too, keeping all it learned */
function growNet(h: EventHost, old: number[]): number[] {
  const net = old.slice(0, IN * HID + HID);
  const base = IN * HID + HID;
  for (let o = 0; o < OUT; o++) for (let j = 0; j < HID; j++) net.push(o < OUT_V133 ? old[base + o * HID + j] : r3(gauss(h) * 0.15));
  for (let o = 0; o < OUT; o++) net.push(o < OUT_V133 ? old[base + HID * OUT_V133 + o] : o === O_ROAM ? -1.5 : 0);
  return net;
}

function mutate(h: EventHost, net: number[], sigma: number): number[] {
  return net.map((x) => r3(Math.max(-6, Math.min(6, x + gauss(h) * sigma))));
}

/** the network: senses in; job weights as shares (a softmax scaled to average 1, 0.15..4) and the rest 0..1 out.
 *  (v1.40: shares instead of six separate exp() values, which all pushed up to the same ceiling and said little) */
export function forward(net: number[], x: number[]): number[] {
  const hid = new Array<number>(HID);
  for (let j = 0; j < HID; j++) {
    let s = net[IN * HID + j];
    for (let i = 0; i < IN; i++) s += net[j * IN + i] * x[i];
    hid[j] = Math.tanh(s);
  }
  const base = IN * HID + HID;
  const raw: number[] = [];
  for (let o = 0; o < OUT; o++) {
    let s = net[base + HID * OUT + o];
    for (let j = 0; j < HID; j++) s += net[base + o * HID + j] * hid[j];
    raw.push(s);
  }
  const jobs = raw.slice(0, JOBS.length);
  const top = Math.max(...jobs);
  const ex = jobs.map((v) => Math.exp(Math.max(-8, v - top)));
  const sum = ex.reduce((a, b) => a + b, 0);
  const out = ex.map((e) => Math.max(0.15, Math.min(4, (e / sum) * JOBS.length)));
  for (let o = JOBS.length; o < OUT; o++) out.push(1 / (1 + Math.exp(-raw[o])));
  return out;
}

/** share of the land around a band that is still full of a resource (0..1) */
function fullness(field: Float32Array, cap: Float32Array | null, b: Band, R: number): number {
  const cx = Math.round(b.cx), cy = Math.round(b.cy);
  let s = 0, c = 0;
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    // read the land as the save keeps it (to hundredths): a reloaded world senses exactly the same (v1.40)
    s += Math.round(field[i] * 100) / 100;
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

// (v1.34 tried letting the brain choose between hunting and gathering: every clan learned to hunt more, the game ran out
// for all of them and worlds ended up smaller - a tragedy of the commons - so that output is kept but not used)

/** called from bandDynamics(): a wandering clan whose brain says it is time to go moves on before it must */
export function wantsToMove(h: BrainHost, b: Band): boolean {
  const v = h.s.brains?.[b.id]?.out?.[O_ROAM];
  // every wandering clan moves on now and then (fresh land pays off later); the brain can only add to that
  return v !== undefined && !b.settled && h.rng.chance(0.012 + v * 0.05);
}

/** how generous a clan is right now (relations.ts uses it for food sent to friends) */
export function generosity(h: { s: { brains?: Record<number, Brain> } }, id: number): number {
  const br = h.s.brains?.[id];
  return br ? (br.out?.[O_GIVE] ?? br.give) : 0.5;
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
  let near: ReturnType<typeof neighbourhood> | undefined;
  for (const b of h.s.bands) {
    let br = brains[b.id];
    const parent = b.from ? brains[b.from.id] : undefined;
    if (!br) {
      // a daughter clan takes after the clan it came from, with small mutations
      const net = parent?.net ? mutate(h, parent.net, SIGMA_BIRTH) : newNet(h, parent?.w, parent?.give);
      // and the people who left with it are the parent's success
      if (parent) {
        parent.founded = (parent.founded ?? 0) + (members.get(b.id)?.length ?? 0);
        parent.pFounded = (parent.pFounded ?? 0) + (members.get(b.id)?.length ?? 0);
      }
      br = brains[b.id] = { net, w: JOBS.map(() => 1), give: 0.5, trial: null, score: parent?.score ?? 1, acc: 0, n: 0, gen: parent ? parent.gen + 1 : 0, tried: 0, kept: 0 };
    }
    // brains from before the networks: their fixed preferences become the network's starting point
    if (br.net && br.net.length === PARAMS_V133) br.net = growNet(h, br.net);
    if (br.trial && br.trial.net.length === PARAMS_V133) br.trial.net = growNet(h, br.trial.net);
    if (!br.net || br.net.length !== PARAMS) br.net = newNet(h, br.w, br.give);
    // decide for this month from what the clan senses now
    // rounded to 2 decimals: a saved and reloaded world (whose land the original rounds when it saves) decides the same (v1.40)
    const ms = members.get(b.id) ?? [];
    let x = sense(h, b, ms.length);
    if (BRAIN2) {
      near ??= neighbourhood(h as never);
      x = x.concat(moreSenses(h as never, b, br, ms, near.get(b.id)!));
    }
    x = x.map((v) => Math.round(v * 100) / 100);
    br.senses = x;
    br.out = BRAIN2 ? decide2(h as never, b, br, x) : forward(br.trial?.net ?? br.net, x);
    if (BRAIN2) account2(br, b.lastProd ?? 0, b.lastNeed ?? 0, ms.length, (x[4] + x[5]) / 2);
    // experiments only: LETOPIS_FIXED=<6 job weights,give,roam> gives every clan the same fixed decisions
    const fixedNow = (globalThis as { letopisFixed?: number[] }).letopisFixed ?? FIXED;
    if (fixedNow) br.out = fixedNow;
    br.wAcc ??= new Array(OUT).fill(0);
    br.out.forEach((v, i) => { br.wAcc![i] += v; });
    // how well fed the clan is (beyond plenty more food does not count)
    if (br.n === 0) br.size0 = members.get(b.id)?.length ?? 0;
    br.acc += Math.min(1.4, b.fed ?? 1);
    br.n++;
  }
  if (BRAIN2) learn2(h as never, members, LEARN);
  if (h.month !== 11) return;
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (!br || br.n < 6) continue;
    // a try runs two years before it is judged: keep adding up the first year
    if (br.trial && (br.trialYears ?? 0) < 1) {
      br.trialYears = (br.trialYears ?? 0) + 1;
      continue;
    }
    br.trialYears = 0;
    // what the learning tries to make better: eating well and growing (natural selection rewards the same)
    const size = members.get(b.id)?.length ?? 0;
    const grow = Math.max(-0.3, Math.min(0.5, (size + (br.founded ?? 0) - (br.size0 ?? size)) / Math.max(5, br.size0 ?? size)));
    br.founded = 0;
    const year = br.acc / br.n + grow * 2;
    // the decisions of the year, on average: the clan's way of life
    if (br.wAcc) {
      br.w = br.wAcc.slice(0, JOBS.length).map((v) => r3(v / br.n));
      br.give = r3(br.wAcc[O_GIVE] / br.n);
    }
    br.wAcc = new Array(OUT).fill(0);
    br.acc = 0;
    br.n = 0;
    br.sigma ??= SIGMA_TRIAL;
    if (BRAIN2) br.trial = null;
    if (br.trial) {
      br.tried++;
      const from = br.trial.from;
      // keep the new network only if it fed the clan better (a little noise is forgiven: the weather differs)
      if (year > br.score + 0.01) {
        br.net = br.trial.net;
        br.kept++;
        br.score = year;
        if (from === undefined) {
          // the one-fifth rule: while its own tries succeed, a clan tries bolder changes
          br.sigma = Math.min(0.3, br.sigma * 1.25);
        } else {
          br.copiedKept = (br.copiedKept ?? 0) + 1;
          const teacher = h.s.bands.find((x) => x.id === from);
          if (teacher && (members.get(b.id)?.length ?? 0) >= 10 && h.rng.chance(0.3)) {
            h.emit('imitate', 1, `${h.bandLabel(b, true)} се научи от ${h.bandLabel(teacher)} как да живее по-добре.`, undefined, undefined, b.id, [],
              [`${h.bandEnLabel(b, true)} learned better ways from watching ${h.bandEnLabel(teacher)}.`]);
          }
        }
      } else {
        // what the old way scores drifts with the land: remember it softly
        br.score = br.score * 0.7 + year * 0.3;
        if (from === undefined) br.sigma = Math.max(0.02, br.sigma * 0.95);
      }
      br.trial = null;
    } else {
      br.score = br.score * 0.5 + year * 0.5;
    }
    if (!LEARN || BRAIN2) { newsOfStyle(h, b, br, members); continue; }
    // next year's try: now and then a blend with a neighbour that does better (learning from others),
    // otherwise a small change of its own
    const teacher = h.rng.chance(0.2) ? betterNeighbour(h, b, br) : null;
    if (teacher) {
      const t = brains[teacher.id].net!;
      br.trial = { net: br.net!.map((x, i) => r3(x * 0.7 + t[i] * 0.3)), from: teacher.id };
      br.copied = (br.copied ?? 0) + 1;
    } else {
      br.trial = { net: mutate(h, br.net!, br.sigma) };
    }
    newsOfStyle(h, b, br, members);
  }
  // forget the brains of clans that are gone
  if (h.s.tick % 60 === 0) {
    const alive = new Set(h.s.bands.map((b) => b.id));
    for (const id of Object.keys(brains)) if (!alive.has(Number(id))) delete brains[Number(id)];
  }
}

/** a clan whose way of life changed is news, now and then */
function newsOfStyle(h: BrainHost, b: Band, br: Brain, members: Map<number, Person[]>) {
  {
    const style = styleOf(br, (t) => h.hasTech(b, t));
    // told only when the new way of life holds two periods running (v1.40: not every flicker)
    if (br.style && style.key !== br.style) {
      if (br.styleSeen === style.key && (br.styleSeenTimes = (br.styleSeenTimes ?? 1) + 1) >= 3) {
        const year = Math.floor(h.year);
        if ((members.get(b.id)?.length ?? 0) >= 12 && (br.styleNews === undefined || year - br.styleNews >= 30)) {
          br.styleNews = year;
          h.emit('learned', 1, `${h.bandLabel(b, true)} промени начина си на живот: ${STYLE_BG[style.key] ?? style.name}.`, undefined, undefined, b.id, [],
            [`${h.bandEnLabel(b, true)} changed their way of life: they are ${style.name.toLowerCase()} now.`]);
        }
        br.style = style.key;
        br.styleSeen = undefined;
      } else if (br.styleSeen !== style.key) { br.styleSeen = style.key; br.styleSeenTimes = 1; }
    } else {
      br.style = style.key;
      br.styleSeen = undefined;
    }
  }
}

/** a neighbour within sight whose brain is doing clearly better, if any */
function betterNeighbour(h: BrainHost, b: Band, br: Brain): Band | null {
  const brains = h.s.brains ?? {};
  let best: Band | null = null, bestScore = br.score + 0.05;
  for (const o of h.s.bands) {
    if (o.id === b.id) continue;
    const ob = brains[o.id];
    if (!ob?.net || ob.net.length !== PARAMS || ob.score <= bestScore) continue;
    if (Math.hypot(o.cx - b.cx, o.cy - b.cy) > 18) continue;
    best = o; bestScore = ob.score;
  }
  return best;
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
  let gen = 0, maxGen = 0, tried = 0, kept = 0, n = 0, score = 0, copied = 0, copiedKept = 0, sigma = 0;
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (!br) continue;
    n++;
    const st = styleOf(br, (t) => h.hasTech(b, t));
    styles[st.name] = (styles[st.name] ?? 0) + 1;
    br.w.forEach((x, i) => { avg[i] += x; });
    gen += br.gen; maxGen = Math.max(maxGen, br.gen); tried += br.tried; kept += br.kept; score += br.score;
    copied += br.copied ?? 0; copiedKept += br.copiedKept ?? 0; sigma += br.sigma ?? SIGMA_TRIAL;
  }
  return {
    clans: n, styles, avgWeights: Object.fromEntries(JOBS.map((j, i) => [j, n ? +(avg[i] / n).toFixed(2) : 1])),
    avgGeneration: n ? +(gen / n).toFixed(1) : 0, maxGeneration: maxGen, tried, kept, avgScore: n ? +(score / n).toFixed(3) : 0,
    copied, copiedKept, avgStep: n ? +(sigma / n).toFixed(3) : 0,
    network: BRAIN2 ? { inputs: BRAIN2_SHAPE.layers[0], hidden: BRAIN2_SHAPE.layers[1] + BRAIN2_SHAPE.layers[2], outputs: BRAIN2_SHAPE.layers[3], weights: BRAIN2_SHAPE.weights, layers: BRAIN2_SHAPE.layers }
      : { inputs: IN, hidden: HID, outputs: OUT, weights: PARAMS },
    brain2: BRAIN2,
    cultures: BRAIN2 ? cultureSummary(h as never).filter((c) => c.clans > 0) : [],
  };
}

/** for a clan card */
export function brainView(h: BrainHost, b: Band) {
  const br = h.s.brains?.[b.id];
  if (!br) return null;
  const st = styleOf(br, (t) => h.hasTech(b, t));
  const now = br.out ?? br.w;
  const deep = BRAIN2 ? view2(h as never, br) : null;
  return {
    style: st.name,
    weights: Object.fromEntries(JOBS.map((j, i) => [j, +br.w[i].toFixed(2)])),
    now: Object.fromEntries(JOBS.map((j, i) => [j, +now[i].toFixed(2)])),
    give: +(br.out?.[O_GIVE] ?? br.give).toFixed(2),
    roam: +(br.out?.[O_ROAM] ?? 0).toFixed(2),
    copied: br.copied ?? 0, copiedKept: br.copiedKept ?? 0, step: +(br.sigma ?? SIGMA_TRIAL).toFixed(3),
    generation: br.gen, tried: br.tried, kept: br.kept, score: +br.score.toFixed(2), trying: !!br.trial,
    reactsTo: BRAIN2 ? reactsTo2(h as never, br) : whatMatters(br).slice(0, 3).map((x) => x.sense),
    network: BRAIN2 ? `${BRAIN2_SHAPE.layers.join(' → ')}, ${BRAIN2_SHAPE.weights.toLocaleString('en')} weights` : `${IN} senses → ${HID} neurons → ${OUT} outputs (${PARAMS} weights)`,
    brain2: BRAIN2,
    culture: BRAIN2 ? cultureInfo(h as never, br) : null,
    memory: br.mem ?? null,
    lastPeriod: br.imp ?? null,
    deep: deep ? { layers: BRAIN2_SHAPE.layers, acts: deep.acts, net: deep.net, senseNames: BRAIN2_SHAPE.senses, outputNames: BRAIN2_SHAPE.outputs } : null,
    // the network itself and what it senses now, for drawing it
    net: br.net, senses: br.senses, shape: { inputs: IN, hidden: HID, outputs: OUT }, senseNames: SENSES,
    outputNames: [...JOBS, 'give', 'hunt', 'roam'],
  };
}
