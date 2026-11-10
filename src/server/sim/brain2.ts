// Brain 2: cultures that learn together (fork). See docs/PLAN-BRAIN-2.md.
//
// Clans descended from the same first clans form a culture, and a culture shares one deeper network:
//   18 senses + 6 memory  ->  24 neurons  ->  16 neurons  ->  9 decisions + 6 memory
// Each clan of a culture lives a two-year period with its own small variation of the shared network (noise drawn
// from the world's seed, in mirrored pairs: one clan gets +noise, its partner -noise). At the end of the period the
// culture ranks its clans by how much better they did than in their own previous period, and moves the shared
// network towards the variations that did best (an evolution strategy, as Salimans et al. 2017 used to teach robots).
// Twenty clans give twenty tries per step instead of one, so the culture learns from far more than luck.
//
// The memory: six numbers the network writes every month and reads back the next. Nobody tells it what to keep there.
// Big cultures split in two along the land and go their own ways, so the world grows several schools of thought.

import type { Band, Person } from './sim';
import type { Brain, BrainHost } from './brain';
import { relationOf } from './relations';

export const SENSES2 = ['spring/autumn', 'winter/summer', 'hunger', 'food stores', 'fruit', 'game', 'fish', 'settled', 'size', 'age of the world',
  'warmth', 'wood', 'children', 'elders', 'crowding', 'friends near', 'rivals near', 'last period'] as const;
export const MEM = 6;
const NS = SENSES2.length;
const IN = NS + MEM;
const H1 = 24, H2 = 16;
/** decisions: six job shares, generosity, (hunting, unused), restlessness; then the memory written back */
const NDEC = 9;
const OUT = NDEC + MEM;
export const LAYERS = [IN, H1, H2, OUT] as const;
// offsets of each part in the flat weight list: W1 (H1 x IN), b1, W2 (H2 x H1), b2, W3 (OUT x H2), b3
const oW1 = 0, oB1 = oW1 + H1 * IN, oW2 = oB1 + H1, oB2 = oW2 + H2 * H1, oW3 = oB2 + H2, oB3 = oW3 + OUT * H2;
export const PARAMS2 = oB3 + OUT;
const JOBN = 6, O_GIVE = 6, O_HUNT = 7, O_ROAM = 8;

/** the period of learning, in months */
const PERIOD = 24;
const SIGMA = Number((typeof process !== 'undefined' && process.env?.LETOPIS_B2_SIGMA) || 0.06);
const RATE = Number((typeof process !== 'undefined' && process.env?.LETOPIS_B2_RATE) || 0.04);
const MOMENTUM = 0.8;
const DECAY = 0.0005;
/** a culture bigger than this splits in two */
const SPLIT_AT = 14;
/** below this many clans a culture learns the simple way: keep a variation only if it did better */
const MIN_ES = 4;
/** how much keeping the land around the camp full of fruit and game counts: food taken today is food missing tomorrow,
 *  for the clan and its neighbours (LETOPIS_B2_STEWARD) */
const STEWARD = Number((typeof process !== 'undefined' && process.env?.LETOPIS_B2_STEWARD) || 1);
/** how much growth counts next to food (the experiments can change it: LETOPIS_B2_GROWTH) */
const GROWTH = Number((typeof process !== 'undefined' && process.env?.LETOPIS_B2_GROWTH) || 1);

export interface Culture {
  id: number;
  net: number[];
  /** momentum of the updates */
  mom?: number[];
  /** learning steps taken */
  gen: number;
  /** how much the clans improved on average at the last steps (smoothed), for the dashboard */
  score: number;
  /** the year it began, and the culture it split from */
  since: number;
  from?: number;
  /** the clan it is named after */
  name?: string;
}

export interface Brain2State {
  cultures?: Record<number, Culture>;
  cultureSeq?: number;
}

/** what Brain 2 keeps in each clan's Brain */
export interface Brain2Part {
  culture?: number;
  /** the clan's variation this period: which pair of noise and which sign */
  slot?: { period: number; j: number; sign: number };
  mem?: number[];
  /** this period's food and growth */
  pAcc?: number; pN?: number; pSize0?: number; pFounded?: number;
  /** how the clan scored last period, and how much better than the one before */
  pLast?: number; imp?: number;
}

type B2 = Brain & Brain2Part;
type Host = BrainHost & { s: BrainHost['s'] & Brain2State & { seed: number; tick: number; relations?: Record<string, number> }; treesNear?(x: number, y: number, R: number, min: number): number };

// ---------- noise from the world's seed ----------

function hash(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) { h ^= x | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  return h >>> 0;
}
/** the noise vector for one pair of clans in one period of one culture: the same every time it is asked for */
function noise(seed: number, culture: number, period: number, j: number): Float64Array {
  let a = hash(seed, culture, period, j) || 1;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const v = new Float64Array(PARAMS2);
  for (let i = 0; i < PARAMS2; i += 2) {
    const u = Math.max(1e-12, rnd()), w = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    v[i] = r * Math.cos(2 * Math.PI * w);
    if (i + 1 < PARAMS2) v[i + 1] = r * Math.sin(2 * Math.PI * w);
  }
  return v;
}

/** each clan's weights for this period (shared network + its noise), worked out once a period, never saved */
const cache = new WeakMap<object, { key: string; w: Float64Array }>();
function weightsOf(h: Host, br: B2, c: Culture): Float64Array {
  const s = br.slot;
  const key = `${c.id}:${c.gen}:${s ? `${s.period}:${s.j}:${s.sign}` : '-'}`;
  const hit = cache.get(br);
  if (hit && hit.key === key) return hit.w;
  const w = Float64Array.from(c.net);
  if (s) {
    const e = noise(h.s.seed, c.id, s.period, s.j);
    for (let i = 0; i < PARAMS2; i++) w[i] += SIGMA * s.sign * e[i];
  }
  cache.set(br, { key, w });
  return w;
}

// ---------- the network ----------

/** all layers' activations for one input: [input, hidden 1, hidden 2, raw output] */
export function forward2(w: ArrayLike<number>, x: number[]): number[][] {
  const h1 = new Array<number>(H1), h2 = new Array<number>(H2), o = new Array<number>(OUT);
  for (let j = 0; j < H1; j++) { let s = w[oB1 + j]; const r = oW1 + j * IN; for (let i = 0; i < IN; i++) s += w[r + i] * x[i]; h1[j] = Math.tanh(s); }
  for (let j = 0; j < H2; j++) { let s = w[oB2 + j]; const r = oW2 + j * H1; for (let i = 0; i < H1; i++) s += w[r + i] * h1[i]; h2[j] = Math.tanh(s); }
  for (let j = 0; j < OUT; j++) { let s = w[oB3 + j]; const r = oW3 + j * H2; for (let i = 0; i < H2; i++) s += w[r + i] * h2[i]; o[j] = s; }
  return [x, h1, h2, o];
}

/** raw outputs to decisions in Brain 1's format (job shares, give, hunt, roam) and the new memory */
function decisions(raw: number[]): { out: number[]; mem: number[] } {
  const jobs = raw.slice(0, JOBN);
  const top = Math.max(...jobs);
  const ex = jobs.map((v) => Math.exp(Math.max(-8, v - top)));
  const sum = ex.reduce((a, b) => a + b, 0);
  const out = ex.map((e) => Math.max(0.15, Math.min(4, (e / sum) * JOBN)));
  out.push(1 / (1 + Math.exp(-raw[O_GIVE])), 0.5, 1 / (1 + Math.exp(-raw[O_ROAM])));
  // memory to hundredths: a saved and reloaded world remembers exactly the same
  const mem = raw.slice(NDEC).map((v) => Math.round(Math.tanh(v) * 100) / 100);
  return { out, mem };
}

/** a new culture's network: small random weights, and job habits taken from its clans' old ways (if any) */
function newCultureNet(seed: number, id: number, w?: number[], give?: number): number[] {
  const e = noise(seed, id, -1, 0);
  const net = new Array<number>(PARAMS2).fill(0);
  for (let i = oW1; i < oB1; i++) net[i] = e[i] * 0.3;
  for (let i = oW2; i < oB2; i++) net[i] = e[i] * 0.25;
  for (let i = oW3; i < oB3; i++) net[i] = e[i] * (i < oW3 + NDEC * H2 ? 0.2 : 0.3);
  for (let o = 0; o < JOBN; o++) net[oB3 + o] = Math.log(Math.max(0.2, w?.[o] ?? 1));
  const g = Math.max(0.05, Math.min(0.95, give ?? 0.5));
  net[oB3 + O_GIVE] = Math.log(g / (1 - g));
  net[oB3 + O_ROAM] = -1.5;
  return net;
}

// ---------- senses ----------

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** the senses Brain 2 adds to Brain 1's eleven */
export function moreSenses(h: Host, b: Band, br: B2, ms: Person[], near: { all: number; friends: number; rivals: number }): number[] {
  let kids = 0, old = 0;
  for (const p of ms) { const a = h.ageOf(p); if (a < 12) kids++; else if (a >= 55) old++; }
  const n = Math.max(1, ms.length);
  const wood = h.treesNear ? h.treesNear(b.cx, b.cy, 5, 2) : 0;
  return [Math.min(1.5, wood / 30), kids / n * 2, old / n * 4, Math.min(1.5, near.all / 5), Math.min(1.5, near.friends / 3), Math.min(1.5, near.rivals / 3), clamp(br.imp ?? 0, -1, 1)];
}

/** who is near each clan: all clans within 12 tiles, friends and rivals within 20 */
export function neighbourhood(h: Host): Map<number, { all: number; friends: number; rivals: number }> {
  const res = new Map<number, { all: number; friends: number; rivals: number }>();
  const bs = h.s.bands;
  for (const b of bs) res.set(b.id, { all: 0, friends: 0, rivals: 0 });
  for (let i = 0; i < bs.length; i++) for (let k = i + 1; k < bs.length; k++) {
    const a = bs[i], c = bs[k];
    const dx = a.cx - c.cx, dy = a.cy - c.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 400) continue;
    const ra = res.get(a.id)!, rc = res.get(c.id)!;
    if (d2 <= 144) { ra.all++; rc.all++; }
    const rel = relationOf(h, a.id, c.id);
    if (rel > 30) { ra.friends++; rc.friends++; } else if (rel < -30) { ra.rivals++; rc.rivals++; }
  }
  return res;
}

// ---------- each month ----------

/** a clan's decisions for this month (and its memory for the next) */
export function decide2(h: Host, b: Band, br: B2, senses: number[]): number[] {
  const cs = (h.s.cultures ??= {});
  let c = br.culture !== undefined ? cs[br.culture] : undefined;
  if (!c) c = joinCulture(h, b, br);
  br.mem ??= new Array(MEM).fill(0);
  const x = senses.concat(br.mem);
  const acts = forward2(weightsOf(h, br, c), x);
  const { out, mem } = decisions(acts[3]);
  br.mem = mem;
  return out;
}

/** a clan without a culture takes its parent's, or (the first clans, and clans from before Brain 2) starts one */
function joinCulture(h: Host, b: Band, br: B2): Culture {
  const cs = (h.s.cultures ??= {});
  const parent = b.from ? (h.s.brains?.[b.from.id] as B2 | undefined) : undefined;
  if (parent?.culture !== undefined && cs[parent.culture]) {
    br.culture = parent.culture;
    br.mem = parent.mem?.slice();
    return cs[parent.culture];
  }
  // clans from before Brain 2: neighbours without a culture join this one, up to twelve within a day's walk
  const id = (h.s.cultureSeq = (h.s.cultureSeq ?? 0) + 1);
  const brains = h.s.brains ?? {};
  const group = h.s.bands
    .filter((o) => o.id !== b.id && brains[o.id] && (brains[o.id] as B2).culture === undefined && Math.hypot(o.cx - b.cx, o.cy - b.cy) < 25)
    .sort((p, q) => Math.hypot(p.cx - b.cx, p.cy - b.cy) - Math.hypot(q.cx - b.cx, q.cy - b.cy) || p.id - q.id)
    .slice(0, 11);
  const all = [br, ...group.map((o) => brains[o.id] as B2)];
  // the culture starts from its clans' old habits (their average job weights and generosity)
  const avgW = [0, 1, 2, 3, 4, 5].map((k) => all.reduce((a, x) => a + (x.w?.[k] ?? 1), 0) / all.length);
  const avgG = all.reduce((a, x) => a + (x.give ?? 0.5), 0) / all.length;
  const c: Culture = { id, net: newCultureNet(h.s.seed, id, avgW, avgG), gen: 0, score: 0, since: Math.floor(h.year), name: h.bandEnLabel(b) };
  cs[id] = c;
  for (const x of all) x.culture = id;
  return c;
}

/** every month: add up how the clan is doing this period. What counts is how much food the clan's work brought in
 *  against what it needed (on a log scale, so doubling counts the same everywhere): it answers directly to how the
 *  work is shared, month by month, where being fed and growing answer slowly and with much luck. Growth still counts. */
export function account2(br: B2, prod: number, need: number, size: number, land: number) {
  if (!br.pN) { br.pAcc = 0; br.pN = 0; br.pSize0 = size; br.pFounded = 0; }
  br.pAcc! += (need > 0 ? Math.log(clamp(prod / need, 0.1, 4)) : 0) + STEWARD * land;
  br.pN!++;
}

// ---------- every two years: learn ----------

export function learn2(h: Host, members: Map<number, Person[]>, learn: boolean) {
  if (h.s.tick % PERIOD !== PERIOD - 1) return;
  const period = Math.floor(h.s.tick / PERIOD);
  const cs = (h.s.cultures ??= {});
  const brains = (h.s.brains ?? {}) as Record<number, B2>;
  const byCulture = new Map<number, Band[]>();
  for (const b of h.s.bands) {
    const br = brains[b.id];
    if (br?.culture === undefined || !cs[br.culture]) continue;
    (byCulture.get(br.culture) ?? byCulture.set(br.culture, []).get(br.culture)!).push(b);
  }
  for (const [cid, bands] of byCulture) {
    const c = cs[cid];
    // how each clan did this period, and how much better than last period
    const tried: { br: B2; f: number }[] = [];
    for (const b of bands) {
      const br = brains[b.id];
      if (!br.pN || br.pN < 12) continue;
      const size = members.get(b.id)?.length ?? 0;
      const grow = clamp((size + (br.pFounded ?? 0) - (br.pSize0 ?? size)) / Math.max(5, br.pSize0 ?? size), -0.3, 0.5);
      const score = br.pAcc! / br.pN + grow * GROWTH;
      if (br.pLast !== undefined) {
        br.imp = Math.round((score - br.pLast) * 100) / 100;
        if (br.slot && br.slot.period === period - 0) tried.push({ br, f: score - br.pLast });
      }
      br.pLast = score;
      br.pN = 0;
    }
    if (learn && tried.length) step(h, c, period, tried);
    // the next period's variations, in mirrored pairs, by clan id
    const sorted = bands.slice().sort((p, q) => p.id - q.id);
    sorted.forEach((b, k) => { brains[b.id].slot = learn ? { period: period + 1, j: k >> 1, sign: k & 1 ? -1 : 1 } : undefined; });
    if (sorted.length > SPLIT_AT) splitCulture(h, c, sorted);
  }
  // forget the cultures nobody follows any more
  // (counted again: a culture that split this period has members the list above does not know of)
  const followed = new Set(h.s.bands.map((b) => brains[b.id]?.culture));
  for (const id of Object.keys(cs)) if (!followed.has(Number(id))) delete cs[Number(id)];
}

/** one learning step of a culture from how its clans' variations did */
function step(h: Host, c: Culture, period: number, tried: { br: B2; f: number }[]) {
  const n = tried.length;
  // the slots were given out at the end of the last period, for this one
  const valid = tried.filter((t) => t.br.slot && t.br.slot.period === period);
  if (!valid.length) return;
  let improved = 0;
  for (const t of valid) improved += t.f;
  c.score = Math.round((c.score * 0.8 + (improved / valid.length) * 0.2) * 1000) / 1000;
  if (valid.length < MIN_ES) {
    // a small culture: take the best variation if it did clearly better, otherwise stay
    const best = valid.reduce((a, t) => (t.f > a.f ? t : a));
    if (best.f > 0.02) {
      const e = noise(h.s.seed, c.id, period, best.br.slot!.j);
      for (let i = 0; i < PARAMS2; i++) c.net[i] += SIGMA * best.br.slot!.sign * e[i];
      c.gen++;
    }
    return;
  }
  // ranks from -0.5 (worst) to +0.5 (best): one lucky clan cannot drag the culture along
  const order = valid.map((t, i) => [t.f, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rank = new Array<number>(valid.length);
  order.forEach(([, i], r) => { rank[i] = valid.length > 1 ? r / (valid.length - 1) - 0.5 : 0; });
  const g = new Float64Array(PARAMS2);
  const byPair = new Map<number, Float64Array>();
  valid.forEach((t, i) => {
    const s = t.br.slot!;
    let e = byPair.get(s.j);
    if (!e) { e = noise(h.s.seed, c.id, period, s.j); byPair.set(s.j, e); }
    const k = rank[i] * s.sign;
    for (let p = 0; p < PARAMS2; p++) g[p] += k * e[p];
  });
  const scale = 1 / (valid.length * SIGMA);
  c.mom ??= new Array(PARAMS2).fill(0);
  for (let p = 0; p < PARAMS2; p++) {
    c.mom[p] = MOMENTUM * c.mom[p] + (1 - MOMENTUM) * g[p] * scale;
    c.net[p] = clamp(c.net[p] + RATE * c.mom[p] - DECAY * c.net[p], -6, 6);
  }
  c.gen++;
  void n;
}

/** a culture grown too big parts in two along the land: the clans nearest each of its two farthest clans */
function splitCulture(h: Host, c: Culture, bands: Band[]) {
  let a = bands[0], b = bands[1], far = -1;
  for (let i = 0; i < bands.length; i++) for (let k = i + 1; k < bands.length; k++) {
    const d = Math.hypot(bands[i].cx - bands[k].cx, bands[i].cy - bands[k].cy);
    if (d > far) { far = d; a = bands[i]; b = bands[k]; }
  }
  const brains = (h.s.brains ?? {}) as Record<number, B2>;
  const cs = h.s.cultures!;
  const id = (h.s.cultureSeq = (h.s.cultureSeq ?? 0) + 1);
  const nc: Culture = { id, net: c.net.slice(), gen: c.gen, score: c.score, since: Math.floor(h.year), from: c.id, name: h.bandEnLabel(b) };
  cs[id] = nc;
  for (const x of bands) {
    if (Math.hypot(x.cx - b.cx, x.cy - b.cy) < Math.hypot(x.cx - a.cx, x.cy - a.cy)) brains[x.id].culture = id;
  }
}

// ---------- for the page ----------

export function cultureOf(h: Host, br: B2): Culture | undefined {
  return br.culture !== undefined ? h.s.cultures?.[br.culture] : undefined;
}

/** a clan's network as it is now: every layer's activations, for drawing it */
export function view2(h: Host, br: B2) {
  const c = cultureOf(h, br);
  if (!c || !br.senses) return null;
  const x = br.senses.concat(br.mem ?? new Array(MEM).fill(0));
  const w = weightsOf(h, br, c);
  return { acts: forward2(w, x).map((l) => l.map((v) => Math.round(v * 100) / 100)), net: Array.from(w, (v) => Math.round(v * 1000) / 1000) };
}

export function cultureSummary(h: Host) {
  const cs = Object.values(h.s.cultures ?? {});
  const brains = (h.s.brains ?? {}) as Record<number, B2>;
  const size = new Map<number, number>();
  for (const b of h.s.bands) { const c = brains[b.id]?.culture; if (c !== undefined) size.set(c, (size.get(c) ?? 0) + 1); }
  return cs.map((c) => ({ id: c.id, name: c.name ?? `Culture ${c.id}`, clans: size.get(c.id) ?? 0, steps: c.gen, score: c.score, since: c.since, from: c.from }))
    .sort((a, b) => b.clans - a.clans);
}

export const BRAIN2_SHAPE = { layers: [...LAYERS], weights: PARAMS2, senses: [...SENSES2, ...Array.from({ length: MEM }, (_, i) => `memory ${i + 1}`)],
  outputs: ['farm', 'herd', 'fish', 'craft', 'build', 'forage', 'give', 'hunt', 'roam', ...Array.from({ length: MEM }, (_, i) => `memory ${i + 1}`)] };

/** which senses move a clan's work most right now: nudge each and see how much the job shares change */
export function reactsTo2(h: Host, br: B2): string[] {
  const c = cultureOf(h, br);
  if (!c || !br.senses) return [];
  const w = weightsOf(h, br, c);
  const mem = br.mem ?? new Array(MEM).fill(0);
  const share = (x: number[]) => { const o = decisions(forward2(w, x.concat(mem))[3]).out.slice(0, JOBN); const t = o.reduce((a, v) => a + v, 0); return o.map((v) => v / t); };
  const b0 = share(br.senses);
  return SENSES2.map((name, i) => {
    const x = br.senses!.slice();
    x[i] += 0.5;
    const b1 = share(x);
    return { name, e: b1.reduce((a, v, k) => a + Math.abs(v - b0[k]), 0) };
  }).sort((a, b) => b.e - a.e).slice(0, 3).map((x) => x.name);
}

/** a culture's card: its clans, how it learned */
export function cultureInfo(h: Host, br: B2) {
  const c = cultureOf(h, br);
  if (!c) return null;
  const brains = (h.s.brains ?? {}) as Record<number, B2>;
  const clans = h.s.bands.filter((b) => brains[b.id]?.culture === c.id).map((b) => ({ id: b.id, name: h.bandEnLabel(b), x: b.cx, y: b.cy }));
  const from = c.from !== undefined ? h.s.cultures?.[c.from] : undefined;
  return { id: c.id, name: c.name ?? `Culture ${c.id}`, steps: c.gen, score: c.score, since: c.since, from: from ? from.name ?? `Culture ${from.id}` : null, clans };
}
