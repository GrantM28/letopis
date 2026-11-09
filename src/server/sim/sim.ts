import { Rng } from '../../shared/rng';
import {
  BandView, ChronicleEntry, ChronicleRef, GoneBand, PersonDetail, PersonRow, TASKS, TASK_NAMES, Task, CHIEF_TITLES, TimeInfo, TreeNode, FamilyTree, b64encode, formatYear, isWater, Biome, RIVER_WATER,
} from '../../shared/types';
import { Terrain, generateTerrain, findStart, idx, inBounds, W, H, setWorldSize, OLD_SIZE, NEW_SIZE } from './world';
import { SECRET_COUNT, SECRET_HEROES, SECRET_KINDS, SecretFind } from '../../shared/secrets';
import { FEMALE, MALE, bandColor, bandName, fixBandName, familyFrom, nickname, placeName } from './names';
import { ERAS, TECHS, TECH_BY_ID, Tech, eraOf } from './tech';
import { LATER_ERA_WHY } from '../../shared/later_techs';
import { ActKind, EventHost, act, answerPrayer, prayersStep, worldEvents } from './events';
import { RelationHost, relationsStep } from './relations';
import { BrainHost, brainStep, steerJobs } from './brain';
import { BIG, startStage, treeKinds } from '../../shared/trees';
import { findRoad } from './roads';
import { BEAST_EN, ERAS_EN, FEATURE_EN, SECRET_HEROES_EN, SECRET_KINDS_EN, TECH_EN, bandEn, bandLabelEn, bandThe, causeEn, chiefEn, deedEn, personEn, translit } from '../../shared/i18n';

export const START_YEAR = -12000;
/** what a new age brings, written in the chronicle when the first band reaches it: [bg, en] */
const ERA_WHY: Record<number, [string, string]> = {
  1: ['Хората вече не само търсят храна, а я отглеждат.', 'People no longer only search for food, they grow it.'],
  2: ['Медта и калаят се сливат в метал, по-твърд от камъка. Селата растат в градове.', 'Copper and tin melt into a metal harder than stone. Villages grow into towns.'],
  ...LATER_ERA_WHY,
};
/** chance per band and month for an idea whose time has come */
const GLOBAL_DISCOVERY = 0.0003;
const GENE_KEYS = ['str', 'int', 'cur', 'soc', 'hea', 'lon'] as const;
type GeneKey = (typeof GENE_KEYS)[number];
export const GENE_NAMES: Record<GeneKey, string> = {
  str: 'Сила', int: 'Ум', cur: 'Любопитство', soc: 'Общителност', hea: 'Здраве', lon: 'Дълголетие',
};

export interface Person {
  id: number;
  first: string;
  nick: string | null;
  family: string | null;
  sex: 0 | 1;
  born: number; // tick
  motherId: number | null;
  fatherId: number | null;
  partnerId: number | null;
  bandId: number;
  genes: Record<GeneKey, number>;
  x: number;
  y: number;
  task: Task;
  children: number[];
  deeds: string[];
  gen: number;
  lastBirth: number; // tick of last child (women)
}

export interface Band {
  id: number;
  name: string;
  color: number;
  cx: number;
  cy: number;
  settled: boolean;
  settlementName: string | null;
  techs: string[];
  food: number;
  founded: number; // tick
  lastProd: number;
  lastNeed: number;
  fed?: number; // smoothed food cover, 1 = just enough
  met: number[]; // bands already met
  /** the head of the band: always the oldest man */
  chiefId?: number | null;
  /** who founded the band and which band they left (none for the first bands) */
  founder?: { id: number; name: string } | null;
  from?: { id: number; name: string } | null;
  /** wood the band still needs to cut (one unit = one young tree) */
  wood?: number;
  /** nomads: the chief went ahead to look at a new place; the band follows when he gets there */
  scout?: { x: number; y: number; px?: number; py?: number } | null;
}

/** Everything in here is saved to disk. */
export interface SimState {
  version: 1;
  worldId: string;
  seed: number;
  /** map side in tiles; missing in worlds saved before maps grew (192) */
  size?: number;
  /** secrets (easter eggs) found by the people watching; numbers only in v1.04 saves */
  secrets?: (number | SecretFind)[];
  tick: number;
  rng: [number, number, number, number];
  nextPersonId: number;
  nextBandId: number;
  nextEventId: number;
  people: Person[];
  bands: Band[];
  usedPlaces: string[];
  usedBands: string[];
  discovered: string[]; // techs known by anyone ever (first discovery)
  totalBorn: number;
  totalDied: number;
  era: number;
  startedAt: number;
  milestone: number;
  plants: number[]; // terrain resource state (rounded)
  game: number[];
  explored: string; // base64
  /** first discoveries ever: what, who, when (from v1.14) */
  firsts?: { tech: string; pid: number; name: string; band: string; year: number }[];
  /** size of every tree, one byte per tile (0 none .. 4 big); missing before v1.11 */
  trees?: string;
  /** road on every tile (0 none, 1 dirt, 2 paved); missing before v1.20 */
  roads?: string;
  /** village pairs joined by a road, as 'a-b:level' */
  roadPairs?: string[];
  /** how two neighbouring clans feel about each other, 'a-b' -> -100..100 (fork: relations.ts) */
  relations?: Record<string, number>;
  /** sworn alliances and rivalries, 'a-b' -> 'ally' | 'rival' */
  relState?: Record<string, 'ally' | 'rival'>;
  /** what each clan has learned (fork: brain.ts) */
  brains?: Record<number, import('./brain').Brain>;
  /** watchers' help: inspired clans (band id -> months left) and open prayers (fork: events.ts) */
  inspired?: Record<number, number>;
  prayers?: import('./events').Prayer[];
}

export interface DeadRecord {
  id: number;
  name: string;
  sex: 0 | 1;
  born: number;
  died: number;
  cause: string;
  motherId: number | null;
  fatherId: number | null;
  partnerId: number | null;
  children: number[];
  deeds: string[];
  genes: Record<string, number>;
  bandName: string;
  gen: number;
}

export function yearOf(tick: number): number {
  return START_YEAR + tick / 12;
}

export class Simulation {
  s: SimState;
  t: Terrain;
  rng: Rng;
  private byId = new Map<number, Person>();
  private bandById = new Map<number, Band>();
  private techSets = new Map<number, Set<string>>();
  private regions: Int32Array = new Int32Array(0);
  /** which tree can grow on each tile (0 none), and how big it is now (0..4) */
  treeKind: Uint8Array = new Uint8Array(0);
  trees: Uint8Array = new Uint8Array(0);
  /** trees that changed this month, as [tile, stage, tile, stage, ...] for the viewers */
  treeChanges: number[] = [];
  roads: Uint8Array = new Uint8Array(0);
  /** roads built this month, as [tile, level, ...] for the viewers */
  roadChanges: number[] = [];
  events: ChronicleEntry[] = [];
  deadQueue: DeadRecord[] = [];
  goneQueue: GoneBand[] = [];
  exploredDirty = true;
  /** set by the server so that dead people's names can be looked up */
  lookupDead: (id: number) => DeadRecord | null = () => null;

  constructor(state: SimState | null, seed?: number) {
    if (state) {
      this.s = state;
      setWorldSize(state.size ?? OLD_SIZE);
      for (const b of state.bands) b.name = fixBandName(b.name);
      state.usedBands = state.usedBands.map(fixBandName);
      this.t = generateTerrain(state.seed);
      this.regions = this.landRegions();
      this.rng = new Rng(state.rng);
      for (let i = 0; i < state.plants.length; i++) this.t.plants[i] = state.plants[i] / 100;
      for (let i = 0; i < state.game.length; i++) this.t.game[i] = state.game[i] / 100;
      const ex = Buffer.from(state.explored, 'base64');
      for (let i = 0; i < this.t.explored.length; i++) this.t.explored[i] = (ex[i >> 3] >> (i & 7)) & 1;
      this.initTrees(state.trees);
      this.roads = state.roads ? new Uint8Array(Buffer.from(state.roads, 'base64')) : new Uint8Array(W * H);
      if (this.roads.length !== W * H) this.roads = new Uint8Array(W * H);
      this.dryCamps();
    } else {
      const sd = seed ?? Math.floor(Math.random() * 2 ** 31);
      setWorldSize(NEW_SIZE);
      this.t = generateTerrain(sd);
      this.regions = this.landRegions();
      this.initTrees();
      this.roads = new Uint8Array(W * H);
      this.rng = new Rng(sd ^ 0x5bd1e995);
      this.s = {
        version: 1,
        worldId: `${new Date().toISOString().slice(0, 10)}-${sd.toString(36)}`,
        seed: sd,
        size: NEW_SIZE,
        tick: 0,
        rng: this.rng.s,
        nextPersonId: 1,
        nextBandId: 1,
        nextEventId: 1,
        people: [],
        bands: [],
        usedPlaces: [],
        usedBands: [],
        discovered: [],
        totalBorn: 0,
        totalDied: 0,
        era: 0,
        startedAt: Date.now(),
        milestone: 0,
        plants: [],
        game: [],
        explored: '',
      };
      this.genesis();
    }
    this.reindex();
    this.treeChanges = [];
    this.roadChanges = [];
  }

  /** dry land you can walk on: no sea, lake or river wide enough to be drawn as water */
  private walkable(i: number): boolean {
    return !isWater(this.t.biome[i]) && this.t.river[i] < RIVER_WATER;
  }

  /** every piece of land cut off by water gets its own number: without boats nobody leaves it */
  private landRegions(): Int32Array {
    const n = W * H, reg = new Int32Array(n).fill(-1);
    let id = 0;
    const stack: number[] = [];
    for (let s = 0; s < n; s++) {
      if (reg[s] >= 0 || !this.walkable(s)) continue;
      reg[s] = id;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % W, y = (i - x) / W;
        if (x > 0 && reg[i - 1] < 0 && this.walkable(i - 1)) { reg[i - 1] = id; stack.push(i - 1); }
        if (x < W - 1 && reg[i + 1] < 0 && this.walkable(i + 1)) { reg[i + 1] = id; stack.push(i + 1); }
        if (y > 0 && reg[i - W] < 0 && this.walkable(i - W)) { reg[i - W] = id; stack.push(i - W); }
        if (y < H - 1 && reg[i + W] < 0 && this.walkable(i + W)) { reg[i + W] = id; stack.push(i + W); }
      }
      id++;
    }
    return reg;
  }

  /** can the band get to this tile? by land, or over water once it has boats */
  private reachable(b: Band, x: number, y: number): boolean {
    if (!inBounds(x, y)) return false;
    const i = idx(x, y);
    if (!this.walkable(i)) return false;
    if (this.hasTech(b, 'boats')) return true;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    return inBounds(cx, cy) && this.regions[i] === this.regions[idx(cx, cy)];
  }

  // ---------- trees ----------

  private initTrees(saved?: string) {
    this.treeKind = treeKinds(W, H, this.t.biome, this.t.river, this.t.temp);
    this.trees = new Uint8Array(W * H);
    if (saved) {
      const b = Buffer.from(saved, 'base64');
      for (let i = 0; i < this.trees.length; i++) this.trees[i] = this.treeKind[i] ? Math.min(BIG, b[i] ?? 0) : 0;
      return;
    }
    for (let i = 0; i < this.trees.length; i++) if (this.treeKind[i]) this.trees[i] = startStage(i % W, Math.floor(i / W));
    // worlds from before v1.11: the land around each camp is already cleared
    for (const b of this.s?.bands ?? []) this.clearAround(b.cx, b.cy, b.settled ? 3 : 1);
  }

  private setTree(i: number, stage: number) {
    if (this.trees[i] === stage) return;
    this.trees[i] = stage;
    this.treeChanges.push(i, stage);
  }

  /** a camp (or village) stands here: the trees under it are cut */
  private clearAround(x: number, y: number, R: number) {
    const cx = Math.round(x), cy = Math.round(y);
    for (let yy = cy - R; yy <= cy + R; yy++) for (let xx = cx - R; xx <= cx + R; xx++) {
      if (inBounds(xx, yy) && (xx - cx) ** 2 + (yy - cy) ** 2 <= R * R + 1) this.setTree(idx(xx, yy), 0);
    }
  }

  /** trees of at least `min` size within R tiles */
  // ---------- roads ----------

  roadsB64(): string {
    return b64encode(this.roads);
  }

  private setRoad(i: number, lvl: number) {
    if (this.roads[i] >= lvl) return;
    this.roads[i] = lvl;
    this.roadChanges.push(i, lvl);
    if (this.trees[i]) this.setTree(i, 0);
  }

  /** once a year villages with carts beat a road to their neighbours; towns with walls pave theirs */
  private buildRoads() {
    const towns = this.s.bands.filter((b) => b.settled);
    if (towns.length < 2) return;
    const pairs = new Map<string, number>();
    for (const e of this.s.roadPairs ?? []) {
      const [k, l] = e.split(':');
      pairs.set(k, Number(l));
    }
    const alive = new Set(towns.map((b) => b.id));
    let built = 0;
    for (const a of this.rng.shuffle([...towns])) {
      if (built >= 12) break;
      if (!this.hasTech(a, 'wheel')) continue;
      const near = towns.filter((o) => o !== a && dist(a, o) < 36).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 2);
      for (const o of near) {
        const key = a.id < o.id ? `${a.id}-${o.id}` : `${o.id}-${a.id}`;
        const lvl = this.hasTech(a, 'walls') && this.hasTech(o, 'walls') ? 2 : 1;
        if ((pairs.get(key) ?? 0) >= lvl) continue;
        const ia = idx(Math.round(a.cx), Math.round(a.cy)), io = idx(Math.round(o.cx), Math.round(o.cy));
        const path = findRoad(this.t, this.roads, ia, io);
        pairs.set(key, path ? lvl : 9); // 9: no way there, do not try again
        built++;
        if (!path) continue;
        for (const i of path) this.setRoad(i, lvl);
      }
    }
    // pairs of villages that are gone are forgotten (their roads stay)
    this.s.roadPairs = [...pairs].filter(([k]) => k.split('-').every((id) => alive.has(Number(id)))).map(([k, l]) => `${k}:${l}`);
  }

  treesNear(x: number, y: number, R: number, min: number): number {
    const cx = Math.round(x), cy = Math.round(y);
    let n = 0;
    for (let yy = cy - R; yy <= cy + R; yy++) for (let xx = cx - R; xx <= cx + R; xx++) {
      if (inBounds(xx, yy) && this.trees[idx(xx, yy)] >= min) n++;
    }
    return n;
  }

  /** every month the trees grow a little and new saplings come up where the forest can be */
  private growTrees() {
    // no new saplings inside the camps and the fields
    const blocked = new Set<number>();
    for (const b of this.s.bands) {
      const R = b.settled ? 3 : 1, cx = Math.round(b.cx), cy = Math.round(b.cy);
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) if (inBounds(x, y)) blocked.add(idx(x, y));
    }
    const grow = 1 / (12 * 8); // about 8 years for each stage
    const seed = 1 / (12 * 15); // a bare spot gets a sapling in about 15 years
    const kinds = this.treeKind, trees = this.trees;
    for (let i = 0; i < kinds.length; i++) {
      if (!kinds[i]) continue;
      const st = trees[i];
      if (st === 0) {
        if (this.rng.next() < seed && !blocked.has(i) && !this.roads[i]) this.setTree(i, 1);
      } else if (st < BIG && this.rng.next() < grow) this.setTree(i, st + 1);
    }
  }

  /** the band cuts what it needs for fires, tools and shelters: the nearest trees go first */
  private chop(b: Band, members: Person[]) {
    const n = members.length;
    const m = this.month;
    const winter = m === 11 || m <= 1 ? 2 : m === 2 || m === 10 ? 1.4 : 1;
    const fire = this.hasTech(b, 'fire') ? 1.4 : 1;
    b.wood = (b.wood ?? 0) + (0.08 + n * 0.004) * winter * fire * (b.settled ? 1.3 : 1);
    const R = b.settled ? 7 : 4;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    for (let guard = 0; b.wood >= 1 && guard < 6; guard++) {
      let best = -1, bestD = Infinity;
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
        if (!inBounds(x, y)) continue;
        const i = idx(x, y);
        if (this.trees[i] < 2) continue; // saplings are left to grow
        const d = (x - cx) ** 2 + (y - cy) ** 2 + this.rng.next() * 6;
        if (d < bestD && d <= R * R + 6) { bestD = d; best = i; }
      }
      if (best < 0) { b.wood = Math.min(b.wood, 3); break; }
      b.wood -= this.trees[best] - 1;
      this.setTree(best, 0);
    }
    // a woodcutter is seen at work by the nearest tree (or carrying the log home)
    let near = -1, nd = Infinity;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!inBounds(x, y) || this.trees[idx(x, y)] < 2) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < nd) { nd = d; near = idx(x, y); }
    }
    if (near < 0) return;
    const men = members.filter((p) => p.sex === 0 && (p.task === 'gather' || p.task === 'hunt') && p.id !== b.chiefId);
    if (!men.length) return;
    const p = men[b.id % men.length];
    p.task = 'chop';
    // stand at the side of the trunk, not inside it
    p.x = (near % W) + 0.45;
    p.y = Math.floor(near / W) + 0.2;
  }

  treesB64(): string {
    return b64encode(this.trees);
  }

  private reindex() {
    this.byId.clear();
    this.bandById.clear();
    this.techSets.clear();
    for (const p of this.s.people) this.byId.set(p.id, p);
    for (const b of this.s.bands) {
      this.bandById.set(b.id, b);
      this.techSets.set(b.id, new Set(b.techs));
    }
  }

  // ---------- creation ----------

  private genesis() {
    // start on a big piece of land, not on a strip between two rivers
    const size = new Map<number, number>();
    for (const r of this.regions) if (r >= 0) size.set(r, (size.get(r) ?? 0) + 1);
    let start = findStart(this.t, this.rng);
    for (let k = 0; k < 20; k++) {
      const s0 = this.nearestLand(start.x, start.y);
      if ((size.get(this.regions[idx(s0.x, s0.y)]) ?? 0) >= 1500) { start = s0; break; }
      start = findStart(this.t, this.rng);
    }
    const home = this.regions[idx(start.x, start.y)];
    const usedB = new Set<string>();
    const offsets = [[0, 0], [9, -5], [-7, 7]];
    for (const [ox, oy] of offsets) {
      const c = this.nearestLand(start.x + ox, start.y + oy, home);
      const band = this.newBand(c.x, c.y, usedB);
      for (let k = 0; k < 12; k++) {
        const age = k < 8 ? this.rng.int(16, 35) : this.rng.int(1, 12);
        this.newPerson(band, null, null, -age * 12 - this.rng.int(0, 11), this.rng.chance(0.5) ? 1 : 0);
      }
      // pair up the adults
      const adults = this.s.people.filter((p) => p.bandId === band.id && this.ageOf(p) >= 16);
      const men = adults.filter((p) => p.sex === 0), women = adults.filter((p) => p.sex === 1);
      for (let i = 0; i < Math.min(men.length, women.length); i++) {
        men[i].partnerId = women[i].id;
        women[i].partnerId = men[i].id;
      }
    }
    this.s.usedBands = [...usedB];
    for (const b of this.s.bands) this.clearAround(b.cx, b.cy, 1);
    this.explore();
    this.emit('genesis', 3,
      `Летописът започва. ${this.s.people.length} души в три рода бродят из ${'земите край голямата река'}. Не знаят огъня, нямат имена на местата. Имат само един друг.`,
      'Началото! Няколко семейства живеят сред дивата природа. Нямат огън, нито къщи. Да видим докъде ще стигнат.', undefined, undefined, [],
      [`The chronicle begins. ${this.s.people.length} people in three clans roam the lands by the great river. They do not know fire and have no names for places. They have only each other.`,
        'The beginning! A few families live in the wild. They have no fire and no houses. Let us see how far they get.']);
  }

  /** dry land a camp can stand on: not sea, lake or a river big enough to be drawn as water */
  private campable(i: number): boolean {
    return this.walkable(i);
  }

  /** camps saved on a river channel step onto the nearest bank */
  private dryCamps() {
    for (const b of this.s.bands) {
      const cx = Math.round(b.cx), cy = Math.round(b.cy);
      if (inBounds(cx, cy) && this.campable(idx(cx, cy))) continue;
      search: for (let r = 1; r < 12; r++) {
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const x = cx + ox, y = cy + oy;
          if (inBounds(x, y) && this.campable(idx(x, y))) { b.cx = x; b.cy = y; break search; }
        }
      }
    }
  }

  private nearestLand(x: number, y: number, region = -1): { x: number; y: number } {
    for (let r = 0; r < 30; r++) {
      for (let k = 0; k < 20; k++) {
        const nx = Math.round(x + this.rng.range(-r, r)), ny = Math.round(y + this.rng.range(-r, r));
        if (inBounds(nx, ny) && this.campable(idx(nx, ny)) && this.t.height[idx(nx, ny)] < 0.6 && (region < 0 || this.regions[idx(nx, ny)] === region)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }

  private newBand(x: number, y: number, used?: Set<string>, techs: string[] = []): Band {
    const set = used ?? new Set(this.s.usedBands);
    const b: Band = {
      id: this.s.nextBandId++,
      name: bandName(this.rng, set),
      color: bandColor(this.rng),
      cx: x, cy: y,
      settled: false,
      settlementName: null,
      techs: [...techs],
      food: 20,
      founded: this.s.tick,
      lastProd: 0, lastNeed: 0,
      met: [],
    };
    if (!used) this.s.usedBands = [...set];
    this.s.bands.push(b);
    this.bandById.set(b.id, b);
    this.techSets.set(b.id, new Set(techs));
    return b;
  }

  private randomGenes(): Record<GeneKey, number> {
    const g = {} as Record<GeneKey, number>;
    for (const k of GENE_KEYS) g[k] = Math.min(1, Math.max(0, 0.5 + this.rng.gauss() * 0.15));
    return g;
  }

  private newPerson(band: Band, mother: Person | null, father: Person | null, bornTick: number, sex: 0 | 1): Person {
    let genes: Record<GeneKey, number>;
    if (mother && father) {
      genes = {} as Record<GeneKey, number>;
      for (const k of GENE_KEYS) {
        const v = (mother.genes[k] + father.genes[k]) / 2 + this.rng.gauss() * 0.06;
        genes[k] = Math.min(1, Math.max(0, v));
      }
    } else genes = this.randomGenes();
    const top = topGene(genes);
    const names = sex === 1 ? FEMALE : MALE;
    // early names come from the older part of the list
    const pool = this.s.era < 2 ? names.slice(0, 40) : names;
    let first = this.rng.pick(pool);
    if (father && this.rng.chance(0.15)) first = sex === 0 ? father.first : first; // named after the father
    const hasFamilies = this.s.era >= 1 && father;
    const p: Person = {
      id: this.s.nextPersonId++,
      first,
      nick: hasFamilies ? null : nickname(this.rng, sex === 1, top),
      family: hasFamilies ? familyFrom(father!.first, sex === 1) : null,
      sex,
      born: bornTick,
      motherId: mother?.id ?? null,
      fatherId: father?.id ?? null,
      partnerId: null,
      bandId: band.id,
      genes,
      x: band.cx + this.rng.range(-1, 1),
      y: band.cy + this.rng.range(-1, 1),
      task: 'child',
      children: [],
      deeds: [],
      gen: Math.max(mother?.gen ?? 0, father?.gen ?? 0) + 1,
      lastBirth: -999,
    };
    this.s.people.push(p);
    this.byId.set(p.id, p);
    this.s.totalBorn++;
    return p;
  }

  // ---------- helpers ----------

  ageOf(p: Person): number {
    return (this.s.tick - p.born) / 12;
  }

  nameOf(p: Person): string {
    if (p.family) return `${p.first} ${p.family}`;
    return p.nick ? `${p.first} ${p.nick}` : p.first;
  }

  /** 'рода на Орела' inside a sentence, 'Родът на Орела' as its subject */
  bandLabel(b: Band, subject = false): string {
    if (b.settlementName) return `${subject ? 'Селото' : 'селото'} ${b.settlementName}`;
    return subject ? b.name : b.name.replace(/^Родът/, 'рода');
  }

  /** the same in English */
  nameEn(p: Person): string {
    return personEn(this.nameOf(p));
  }

  bandEnLabel(b: Band, subject = false): string {
    return bandLabelEn(b.name, b.settlementName, subject);
  }

  techName(id: string, en = false): string {
    return en ? TECH_EN[id]?.name ?? id : TECH_BY_ID.get(id)?.name ?? id;
  }

  hasTech(b: Band, id: string): boolean {
    return this.techSets.get(b.id)!.has(id);
  }

  private addTech(b: Band, id: string) {
    const set = this.techSets.get(b.id)!;
    if (set.has(id)) return;
    set.add(id);
    b.techs.push(id);
  }

  get year(): number {
    return yearOf(this.s.tick);
  }

  get month(): number {
    return ((this.s.tick % 12) + 12) % 12;
  }

  private emit(kind: string, importance: number, text: string, kids?: string, personId?: number, bandId?: number, extra: ChronicleRef[] = [],
    en?: [string, string?]) {
    // every name in the text that has more to show becomes a link
    const cand: ChronicleRef[] = [...extra];
    const p = personId ? this.byId.get(personId) : undefined;
    if (p) cand.push(this.pRef(p));
    const b = bandId ? this.bandById.get(bandId) : undefined;
    if (b) cand.push(...this.bRefs(b));
    const refs: ChronicleRef[] = [];
    for (const r of cand) {
      if (!r.n || refs.some((x) => x.n === r.n)) continue;
      if (text.includes(r.n) || kids?.includes(r.n)) refs.push(r);
    }
    this.events.push({
      id: this.s.nextEventId++,
      tick: this.s.tick,
      year: this.year,
      kind, importance, text, kids, personId, bandId,
      refs: refs.length ? refs : undefined,
      en: en ? { text: en[0], kids: en[1] } : undefined,
    });
  }

  private pRef(p: Person): ChronicleRef {
    return { n: this.nameOf(p), p: p.id };
  }

  /** all the ways a band is written in the chronicle */
  private bRefs(b: Band): ChronicleRef[] {
    const out: ChronicleRef[] = [{ n: b.name, b: b.id }, { n: b.name.replace(/^Родът/, 'рода'), b: b.id }];
    if (b.settlementName) out.push({ n: b.settlementName, b: b.id });
    return out;
  }

  /** chance multiplier from the invisible director that keeps the story close to the ~3 month schedule */
  directorFactor(): number {
    const era = this.s.era;
    const next = ERAS[era + 1];
    if (!next) return 1;
    const cur = ERAS[era];
    const span = next.startYear - cur.startYear;
    const f = (this.year - cur.startYear) / span; // 0..1 expected to reach next era at 1
    if (f < 0.5) return 0.4;
    if (f < 1) return 0.4 + (f - 0.5) * 2;
    return Math.min(6, 1.6 + (f - 1) * 4);
  }

  tickMs(speed: number): number {
    const ypm = ERAS[Math.min(this.s.era, ERAS.length - 1)].yearsPerMin;
    return 60000 / (12 * ypm) / speed;
  }

  timeInfo(speed: number): TimeInfo {
    return {
      tick: this.s.tick,
      year: Math.floor(this.year),
      month: this.month,
      era: this.s.era,
      eraName: ERAS[this.s.era].name,
      tickMs: Math.round(this.tickMs(speed)),
      startedAt: this.s.startedAt,
    };
  }

  // ---------- the monthly step ----------

  step() {
    this.s.tick++;
    const members = new Map<number, Person[]>();
    for (const b of this.s.bands) members.set(b.id, []);
    for (const p of this.s.people) members.get(p.bandId)?.push(p);

    this.regrow();
    this.growTrees();
    for (const b of this.s.bands) {
      const m = members.get(b.id)!;
      if (m.length === 0) continue;
      this.work(b, m);
      this.chop(b, m);
      this.discover(b, m);
    }
    this.lifeAndDeath(members);
    if (this.month === 3) this.pairing(members);
    this.bandDynamics(members);
    this.contact();
    if (this.s.tick % 3 === 0) relationsStep(this as unknown as RelationHost, members);
    brainStep(this as unknown as BrainHost, members);
    if (this.month === 6) this.buildRoads();
    if (this.s.tick % 6 === 0) this.explore();
    this.randomEvents(members);
    this.checkEra();
    this.milestones();
    this.fixStrays();
    this.s.rng = this.rng.s;
  }

  /** a baby born the month its band merged or died out could be left with no band: it goes to its mother's, or the nearest */
  private fixStrays() {
    for (const p of this.s.people) {
      if (this.bandById.has(p.bandId)) continue;
      const mother = p.motherId ? this.byId.get(p.motherId) : undefined;
      let to = mother ? this.bandById.get(mother.bandId) : undefined;
      if (!to) {
        let best = Infinity;
        for (const b of this.s.bands) {
          const d = Math.hypot(b.cx - p.x, b.cy - p.y);
          if (d < best) { best = d; to = b; }
        }
      }
      if (to) p.bandId = to.id;
    }
  }

  private regrow() {
    const t = this.t;
    const m = this.month;
    const growing = m >= 2 && m <= 9;
    const pr = growing ? 0.1 : 0.02;
    for (let i = 0; i < t.plants.length; i++) {
      const cap = t.plantsCap[i];
      if (cap <= 0) continue;
      if (t.plants[i] < cap) t.plants[i] += (cap - t.plants[i]) * pr;
      const gc = t.gameCap[i];
      if (t.game[i] < gc) t.game[i] += (gc - t.game[i]) * 0.035 + 0.002;
    }
  }

  private seasonFactor(b: Band): number {
    const temp = this.t.temp[idx(Math.round(b.cx), Math.round(b.cy))];
    const m = this.month;
    const winter = m === 11 || m <= 1 ? 1 : m === 2 || m === 10 ? 0.5 : 0;
    // cold lands suffer more from winter
    return 1 - winter * (0.75 - temp * 0.5);
  }

  private work(b: Band, m: Person[]) {
    const t = this.t;
    const tool = this.hasTech(b, 'iron') ? 1.65 : this.hasTech(b, 'bronze') ? 1.5 : this.hasTech(b, 'copper') ? 1.35 : this.hasTech(b, 'stone_tools') ? 1.25 : 1;
    const fire = this.hasTech(b, 'fire') ? 1.1 : 1;
    // carts bring food from farther away
    const R = b.settled ? (this.hasTech(b, 'wheel') ? 5 : 4) : 6;
    const season = this.seasonFactor(b);
    const workers: Person[] = [];
    let need = 0;
    const chief = this.ensureChief(b, m);
    for (const p of m) {
      const a = this.ageOf(p);
      need += a < 12 ? 0.6 : a > 60 ? 0.8 : 1;
      if (a < 12) p.task = 'child';
      else if (a > 58) p.task = 'elder';
      else workers.push(p);
    }

    // choose jobs
    const canFish = this.hasTech(b, 'fishing') && this.areaHas(b, R, 'fish');
    const farms = this.hasTech(b, 'agriculture') && b.settled;
    const herds = this.hasTech(b, 'herding');
    // job weights: most people find food, a few make tools or build
    const jobs: [Task, number][] = [];
    if (farms) jobs.push(['farm', 5]);
    if (herds) jobs.push(['herd', 1.5]);
    if (canFish) jobs.push(['fish', 1.5]);
    if (this.hasTech(b, 'stone_tools')) jobs.push(['craft', 0.6]);
    if (b.settled && this.hasTech(b, 'mudbrick')) jobs.push(['build', 0.5]);
    jobs.push(['forage', farms ? 2 : 6] as unknown as [Task, number]);
    steerJobs(this as unknown as BrainHost, b, jobs);
    const total = jobs.reduce((s2, j) => s2 + j[1], 0);
    for (const p of workers) {
      let r = this.rng.next() * total;
      let job: string = 'forage';
      for (const [j, w] of jobs) { if (r < w) { job = j; break; } r -= w; }
      if (job === 'forage') job = (p.genes.str + this.rng.next() * 0.6) > (p.sex === 0 ? 0.7 : 0.95) ? 'hunt' : 'gather';
      p.task = job as Task;
    }
    let prod = 0;
    let gatherWant = 0, huntWant = 0, farmWant = 0;
    const craftBonus = 1 + Math.min(0.25, workers.filter((p) => p.task === 'craft').length * 0.04);
    for (const p of workers) {
      const skill = 0.8 + Math.min(0.4, (this.ageOf(p) - 12) * 0.015) + (p.genes.str - 0.5) * 0.3;
      let got = 0;
      const tx = Math.round(b.cx + this.rng.range(-R, R));
      const ty = Math.round(b.cy + this.rng.range(-R, R));
      const tile = this.reachable(b, tx, ty) ? idx(tx, ty) : idx(Math.round(b.cx), Math.round(b.cy));
      switch (p.task) {
        case 'gather': {
          gatherWant += 2.0 * skill * tool * season;
          break;
        }
        case 'hunt': {
          let mult = 2.0 * skill * tool;
          if (this.hasTech(b, 'spear')) mult *= 1.3;
          if (this.hasTech(b, 'bow')) mult *= 1.25;
          if (this.hasTech(b, 'dog')) mult *= 1.15;
          if (this.hasTech(b, 'horse')) mult *= 1.15;
          huntWant += mult * (0.6 + season * 0.4);
          if (this.rng.chance(this.hasTech(b, 'spear') ? 0.0002 : 0.0004)) this.die(p, 'загина на лов', m);
          break;
        }
        case 'fish': got = 1.4 * skill * (this.hasTech(b, 'boats') ? 1.3 : 1) * (this.hasTech(b, 'sailing') ? 1.25 : 1) * (0.7 + season * 0.3); break;
        case 'farm': {
          farmWant += 2.4 * this.farmSeason() * skill * tool * (this.hasTech(b, 'plough') ? 1.35 : 1) * (this.hasTech(b, 'calendar') ? 1.1 : 1) * this.laterFarming(b);
          break;
        }
        case 'herd': got = 1.7 * skill; break;
        case 'craft': got = 0.4; break;
        case 'build': got = 0.3; break;
      }
      prod += got * craftBonus * fire;
      // where they are seen on the map
      this.placeWorker(p, b, tile);
    }
    for (const p of m) if (p.task === 'child' || p.task === 'elder' || p.task === 'craft' || p.task === 'build') {
      // the old ones never go further than one tile from the hearth: they mind the children and tell stories
      const r = p.task === 'elder' ? 1 : 1.2;
      const x = b.cx + this.rng.range(-r, r), y = b.cy + this.rng.range(-r, r);
      // stay on dry land by the hearth
      const ok = this.reachable(b, Math.round(x), Math.round(y));
      p.x = ok ? x : b.cx + this.rng.range(-0.3, 0.3);
      p.y = ok ? y : b.cy + this.rng.range(-0.3, 0.3);
    }
    // the chief still brings food like everyone else, but he is seen by the camp (or out scouting)
    if (chief) this.lead(b, chief, m);
    prod += (this.harvest(t.plants, b, R, gatherWant, 0.07) + this.harvest(t.game, b, R + 2, huntWant, 0.045)) * craftBonus * fire;
    // the plough turns more land into fields, the calendar sows it at the right time
    const land = (this.hasTech(b, 'plough') ? 1.4 : 1) * (this.hasTech(b, 'calendar') ? 1.1 : 1) * this.laterFarming(b);
    if (farmWant > 0) prod += Math.min(farmWant, this.arable(b) * land * this.farmSeason()) * craftBonus;
    const spoil = this.hasTech(b, 'pottery') ? 0.05 : this.hasTech(b, 'grinding') ? 0.08 : 0.12;
    b.food = Math.max(0, b.food * (1 - spoil) + prod - need);
    // how well fed the band has been lately (smoothed over about a year)
    const cover = need > 0 ? Math.min(2, (prod + Math.min(b.food, need * 2)) / need) : 1;
    b.fed = (b.fed ?? 1.2) * 0.75 + cover * 0.25;
    b.lastProd = prod;
    b.lastNeed = need;
  }

  /** iron ploughs, resting fields, new crops and fertilizer: each makes the same land feed more people */
  private laterFarming(b: Band): number {
    return (this.hasTech(b, 'iron_plough') ? 1.2 : 1) * (this.hasTech(b, 'crop_rotation') ? 1.15 : 1)
      * (this.hasTech(b, 'new_crops') ? 1.1 : 1) * (this.hasTech(b, 'fertilizer') ? 1.3 : 1);
  }

  private farmSeason(): number {
    const m = this.month;
    return m >= 6 && m <= 8 ? 1.8 : m >= 3 && m <= 9 ? 0.9 : 0.4;
  }

  /** fields the village can plough: fertile land close to home */
  private arable(b: Band): number {
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    let n = 0;
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
      if (!inBounds(x, y)) continue;
      const bi = this.t.biome[idx(x, y)];
      if (bi === Biome.Grassland || bi === Biome.Plains) n += 1;
      else if (bi === Biome.Forest || bi === Biome.Marsh || bi === Biome.Hills) n += 0.4;
    }
    return n;
  }

  private placeWorker(p: Person, b: Band, tile: number) {
    let x = tile % W, y = Math.floor(tile / W);
    if (p.task === 'fish') {
      // walk to the nearest water
      const near = this.findNear(b, 8, (i) => this.t.fish[i] > 0);
      if (near >= 0) { x = near % W; y = Math.floor(near / W); }
    } else if (p.task === 'farm' || p.task === 'herd') {
      const fx = Math.round(b.cx + this.rng.range(-3, 3)), fy = Math.round(b.cy + this.rng.range(-3, 3));
      if (this.reachable(b, fx, fy)) { x = fx; y = fy; }
    }
    p.x = x + this.rng.range(-0.4, 0.4);
    p.y = y + this.rng.range(-0.4, 0.4);
  }

  private findNear(b: Band, R: number, pred: (i: number) => boolean): number {
    for (let k = 0; k < 25; k++) {
      const x = Math.round(b.cx + this.rng.range(-R, R)), y = Math.round(b.cy + this.rng.range(-R, R));
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (pred(i) && this.reachable(b, x, y)) return i;
    }
    return -1;
  }

  /** take up to `want` from the area around the camp, never more than `maxFrac` of what grows there */
  private harvest(res: Float32Array, b: Band, R: number, want: number, maxFrac: number): number {
    if (want <= 0) return 0;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    let avail = 0;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!inBounds(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      avail += res[idx(x, y)];
    }
    const got = Math.min(want, avail * maxFrac);
    if (avail <= 0) return 0;
    const keep = 1 - got / avail;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!inBounds(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      res[idx(x, y)] *= keep;
    }
    return got;
  }

  private areaHas(b: Band, R: number, need: string): boolean {
    const t = this.t;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      switch (need) {
        case 'flint': if (t.flint[i]) return true; break;
        case 'clay': if (t.clay[i]) return true; break;
        case 'grain': if (t.grain[i]) return true; break;
        case 'wildHerd': if (t.wildHerd[i]) return true; break;
        case 'fish': if (t.fish[i] > 0) return true; break;
        case 'forest': if (t.biome[i] === Biome.Forest || t.biome[i] === Biome.Taiga) return true; break;
        // copper and tin show in the rocks of hills and mountains
        case 'ore': if (t.biome[i] === Biome.Hills || t.biome[i] === Biome.Mountain) return true; break;
      }
    }
    return false;
  }

  private discover(b: Band, m: Person[]) {
    const known = this.techSets.get(b.id)!;
    const candidates: Tech[] = [];
    for (const tech of TECHS) {
      if (known.has(tech.id)) continue;
      if (!tech.prereq.every((r) => known.has(r))) continue;
      if (tech.need && !this.areaHas(b, b.settled ? 5 : 7, tech.need)) continue;
      candidates.push(tech);
    }
    if (!candidates.length) return;
    const adults = m.filter((p) => this.ageOf(p) >= 12);
    if (!adults.length) return;
    const crowd = Math.sqrt(adults.length / 8);
    for (const tech of candidates) {
      // the person who might have the idea this month
      const p = this.rng.pick(adults);
      const g = p.genes[tech.gene] * 0.5 + p.genes.int * 0.25 + p.genes.cur * 0.25;
      // already known somewhere else: rediscovery is easier
      const seen = this.s.discovered.includes(tech.id);
      const again = seen ? 1.6 : 1;
      // a first discovery happens somewhere in the world: many bands do not make it come sooner
      const world = seen ? 1 : Math.min(1, 4 / this.s.bands.length);
      const written = (this.s.inspired?.[b.id] ? 4 : 1) * (this.hasTech(b, 'writing') ? 1.15 : 1) * (this.hasTech(b, 'university') ? 1.15 : 1) * (this.hasTech(b, 'printing') ? 1.2 : 1);
      const chance = written * world * GLOBAL_DISCOVERY * Math.sqrt(tech.base / 0.0025) * this.techPace(tech) * again * crowd * Math.pow(g * 2, 2);
      if (!this.rng.chance(chance)) continue;
      this.addTech(b, tech.id);
      const first = !this.s.discovered.includes(tech.id);
      const name = this.nameOf(p);
      const fill = (s: string) => s.replace('{name}', name).replace('{band}', this.bandLabel(b)).replace('{Band}', this.bandLabel(b, true));
      const nameE = this.nameEn(p);
      const fillEn = (s: string) => s.replace('{name}', nameE).replace('{band}', this.bandEnLabel(b)).replace('{Band}', this.bandEnLabel(b, true));
      const te = TECH_EN[tech.id];
      if (first) {
        this.s.discovered.push(tech.id);
        if (!(this.s.firsts ??= []).some((f) => f.tech === tech.id)) {
          this.s.firsts.push({ tech: tech.id, pid: p.id, name, band: this.bandLabel(b, true), year: Math.floor(this.year) });
        }
        p.deeds.push(`Откри „${tech.name}“ (${formatYear(this.year)})`);
        this.emit('discovery', 3, fill(tech.text), fill(tech.kids), p.id, b.id, [], te ? [fillEn(te.text), fillEn(te.kids)] : undefined);
      } else {
        p.deeds.push(`Преоткри „${tech.name}“ за своя род`);
        this.emit('rediscovery', 1, `${name} от ${this.bandLabel(b)} откри наново „${tech.name}“, без да знае, че другаде вече го умеят.`, undefined, p.id, b.id, [],
          [`${nameE} of ${this.bandEnLabel(b)} discovered “${this.techName(tech.id, true)}” anew, not knowing that others already have it.`]);
      }
      if (tech.id === 'agriculture') this.settle(b, m);
      return; // one discovery per band per month
    }
  }

  /** ideas come rarely before their time and more and more often after it: keeps the story near the real calendar */
  private techPace(tech: Tech): number {
    const d = (this.year - tech.target) / 250;
    if (d < 0) return Math.exp(4 * d); // 250 years early: 2%, 500 years: 0.03%
    return Math.min(8, 1 + d * 2);
  }

  private settle(b: Band, m: Person[]) {
    if (b.settled) return;
    b.settled = true;
    const used = new Set(this.s.usedPlaces);
    b.settlementName = placeName(this.rng, used);
    this.s.usedPlaces = [...used];
    b.scout = null;
    this.clearAround(b.cx, b.cy, 3);
    const chief = b.chiefId ? this.byId.get(b.chiefId) : undefined;
    const elder = chief ?? m.reduce((a, p) => (this.ageOf(p) > this.ageOf(a) ? p : a), m[0]);
    this.emit('settle', 3,
      `${b.name} спря да скита и основа селото ${b.settlementName}. ${chief ? `Старейшината ${this.nameOf(elder)}` : `Най-възрастният в рода, ${this.nameOf(elder)},`} избра мястото край водата.`,
      `${b.name} построи село и го нарече ${b.settlementName}!`, elder.id, b.id, [],
      [`${bandThe(b.name, true)} stopped wandering and founded the village of ${translit(b.settlementName)}. ${chief ? `The elder ${this.nameEn(elder)}` : `The oldest of the clan, ${this.nameEn(elder)},`} chose the place by the water.`,
        `${bandThe(b.name, true)} built a village and named it ${translit(b.settlementName)}!`]);
  }

  private lifeAndDeath(members: Map<number, Person[]>) {
    // a gentle hand that keeps a tiny humanity from vanishing too early
    const pop = this.s.people.length;
    const guardian = pop < 40 ? 0.45 : pop < 80 ? 0.65 : pop < 150 ? 0.85 : 1;
    const babies: [Band, Person, Person | null][] = [];
    for (const b of this.s.bands) {
      const m = members.get(b.id)!;
      if (!m.length) continue;
      const ratio = b.fed ?? 1.2;
      const now = b.lastNeed > 0 ? (b.lastProd + b.food) / b.lastNeed : 1;
      const hungry = now < 1 ? 1 - now : 0;
      const temp = this.t.temp[idx(Math.round(b.cx), Math.round(b.cy))];
      const winter = this.month === 11 || this.month <= 1;
      const coldRisk = winter && temp < 0.4 ? (0.4 - temp) * (this.hasTech(b, 'clothing') ? 0.15 : 1) * (this.hasTech(b, 'fire') ? 0.4 : 1) * 0.02 : 0;
      const medicine = this.hasTech(b, 'genetics') ? 0.3 : this.hasTech(b, 'antibiotics') ? 0.35 : this.hasTech(b, 'vaccination') ? 0.5
        : this.hasTech(b, 'medicine') ? 0.7 : this.hasTech(b, 'herb_lore') ? 0.8 : 1;
      const settledDisease = b.settled ? 1.4 : 1;
      for (const p of m) {
        const a = this.ageOf(p);
        const lon = p.genes.lon, hea = p.genes.hea;
        // annual mortality
        let q: number;
        if (a < 1) q = 0.16;
        else if (a < 5) q = 0.05;
        else if (a < 15) q = 0.012;
        // hard lives: most adults die before 60, only a few see 70
        else q = 0.012 + 0.00055 * Math.exp(0.09 * (a - 10 * (lon - 0.5) * 2));
        q *= medicine * settledDisease * (1.3 - hea * 0.6) * guardian;
        let pm = q / 12 + guardian * coldRisk * (a < 5 || a > 55 ? 2 : 1) + hungry * 0.015 * (a < 5 || a > 55 ? 2 : 0.6);
        if (this.rng.chance(pm)) {
          const cause = hungry > 0.25 && this.rng.chance(0.6) ? 'почина в гладна година'
            : coldRisk > 0.004 && this.rng.chance(0.5) ? 'почина в лютата зима'
            : a > 55 ? 'почина от старост' : a < 5 ? 'почина като дете' : 'почина от болест';
          this.die(p, cause, m);
          continue;
        }
        // a rare long life: the band honours its old ones
        if (Math.floor(a) === 70 && Math.floor(a - 1 / 12) === 69 && (p.deeds.length > 0 || b.chiefId === p.id || pop < 400)) {
          p.deeds.push(`Доживя до 70 години (${formatYear(this.year)})`);
          this.emit('elder', 1, `${this.nameOf(p)} от ${this.bandLabel(b)} навърши 70 години, рядкост в тези сурови времена. Сега гледа децата край огъня и им разказва истории.`,
            `${this.nameOf(p)} стана на 70! Сега разказва приказки на децата край огъня.`, p.id, b.id, [],
            [`${this.nameEn(p)} of ${this.bandEnLabel(b)} turned 70, a rare thing in these harsh times. Now ${p.sex ? 'she' : 'he'} watches the children by the fire and tells them stories.`,
              `${this.nameEn(p)} turned 70! Now ${p.sex ? 'she' : 'he'} tells stories to the children by the fire.`]);
        }
        // births
        if (p.sex === 1 && p.partnerId && a >= 16 && a <= 42) {
          const interval = b.settled ? 26 : 36;
          if (this.s.tick - p.lastBirth >= interval) {
            // well fed families have children, hungry ones wait
            const fed = Math.max(0, Math.min(1, (ratio - 0.95) / 0.3));
            const chance = (pop < 80 ? 0.075 : 0.05) * fed * (0.6 + hea * 0.8) * (a > 35 ? 0.5 : 1);
            if (this.rng.chance(chance)) {
              const father = this.byId.get(p.partnerId) ?? null;
              babies.push([b, p, father]);
              p.lastBirth = this.s.tick;
            }
          }
        }
      }
    }
    for (const [b, mother, father] of babies) {
      if (!this.byId.has(mother.id)) continue;
      const twins = this.rng.chance(0.012);
      for (let k = 0; k < (twins ? 2 : 1); k++) {
        const child = this.newPerson(b, mother, father, this.s.tick, this.rng.chance(0.5) ? 1 : 0);
        mother.children.push(child.id);
        father?.children.push(child.id);
        child.x = mother.x; child.y = mother.y;
        if (twins && k === 1) {
          this.emit('twins', 1, `В ${this.bandLabel(b)} ${this.nameOf(mother)} роди близнаци.`, `В ${this.bandLabel(b)} се родиха близнаци!`, child.id, b.id, [this.pRef(mother)],
            [`In ${this.bandEnLabel(b)}, ${this.nameEn(mother)} gave birth to twins.`, `Twins were born in ${this.bandEnLabel(b)}!`]);
        }
      }
    }
  }

  private die(p: Person, cause: string, bandMembers?: Person[]) {
    if (!this.byId.has(p.id)) return;
    const b = this.bandById.get(p.bandId);
    this.byId.delete(p.id);
    const i = this.s.people.indexOf(p);
    if (i >= 0) this.s.people.splice(i, 1);
    if (bandMembers) {
      const j = bandMembers.indexOf(p);
      if (j >= 0) bandMembers.splice(j, 1);
    }
    if (p.partnerId) {
      const partner = this.byId.get(p.partnerId);
      if (partner) partner.partnerId = null;
    }
    this.s.totalDied++;
    const age = Math.floor(this.ageOf(p));
    this.deadQueue.push({
      id: p.id, name: this.nameOf(p), sex: p.sex, born: p.born, died: this.s.tick, cause,
      motherId: p.motherId, fatherId: p.fatherId, partnerId: p.partnerId, children: p.children,
      deeds: p.deeds, genes: p.genes, bandName: b ? this.bandLabel(b, true) : '', gen: p.gen,
    });
    const me = [this.pRef(p)];
    const nE = this.nameEn(p), he = p.sex ? 'she' : 'he', ofB = b ? this.bandEnLabel(b) : 'the clan';
    const found = p.deeds.find((d) => d.startsWith('Откри'));
    if (found) {
      this.emit('death', 2, `${this.nameOf(p)} ${cause} на ${age} години. Родът ще помни, че тя/той ${found.toLowerCase()}.`.replace('тя/той', p.sex ? 'тя' : 'той'),
        `${this.nameOf(p)} си отиде на ${age} години. Всички помнят какво е открил${p.sex ? 'а' : ''}.`, p.id, p.bandId, me,
        [`${nE} ${causeEn(cause)} at ${age}. The clan will remember that ${he} ${deedEn(found).replace(/^D/, 'd')}.`,
          `${nE} passed away at ${age}. Everyone remembers what ${he} discovered.`]);
    } else if (age >= 70) {
      this.emit('death', 1, `${this.nameOf(p)} от ${b ? this.bandLabel(b) : 'рода'} ${cause} на почтените ${age} години.`, undefined, p.id, p.bandId, me,
        [`${nE} of ${ofB} ${causeEn(cause)} at the venerable age of ${age}.`]);
    } else if (cause === 'загина на лов') {
      this.emit('death', 1, `${this.nameOf(p)} от ${b ? this.bandLabel(b) : 'рода'} не се върна от лова.`, `${this.nameOf(p)} не се върна от лова. Родът е тъжен.`, p.id, p.bandId, me,
        [`${nE} of ${ofB} did not come back from the hunt.`, `${nE} did not come back from the hunt. The clan is sad.`]);
    }
  }

  private isKin(a: Person, b: Person): boolean {
    if (a.motherId && (a.motherId === b.motherId || a.motherId === b.id)) return true;
    if (a.fatherId && (a.fatherId === b.fatherId || a.fatherId === b.id)) return true;
    if (b.motherId === a.id || b.fatherId === a.id) return true;
    return false;
  }

  private pairing(members: Map<number, Person[]>) {
    for (const b of this.s.bands) {
      const m = members.get(b.id)!;
      const single = (p: Person) => !p.partnerId && this.ageOf(p) >= 16 && this.ageOf(p) <= 55;
      const men = m.filter((p) => p.sex === 0 && single(p));
      for (const man of men) {
        if (!this.rng.chance(0.7)) continue;
        let pool = m.filter((p) => p.sex === 1 && single(p) && !this.isKin(man, p));
        let other: Band | null = null;
        if (!pool.length || this.rng.chance(0.3)) {
          // look to a neighbouring band
          for (const ob of this.s.bands) {
            if (ob.id === b.id || dist(ob, b) > (pool.length ? 25 : 45)) continue;
            const cand = (members.get(ob.id) ?? []).filter((p) => p.sex === 1 && single(p));
            if (cand.length) { pool = cand; other = ob; break; }
          }
        }
        if (!pool.length) continue;
        const woman = this.rng.pick(pool);
        man.partnerId = woman.id;
        woman.partnerId = man.id;
        if (other) {
          // she moves to his band (or he to hers)
          const moveHer = this.rng.chance(0.65);
          const mover = moveHer ? woman : man;
          const from = moveHer ? other : b;
          const to = moveHer ? b : other;
          const fromList = members.get(from.id)!;
          fromList.splice(fromList.indexOf(mover), 1);
          members.get(to.id)!.push(mover);
          mover.bandId = to.id;
          if (this.rng.chance(0.15)) {
            this.emit('marriage', 1, `${this.nameOf(man)} и ${this.nameOf(woman)} събраха ${this.bandLabel(b)} и ${this.bandLabel(other)} в едно семейство.`, undefined, man.id, b.id,
              [this.pRef(woman), ...this.bRefs(other)],
              [`${this.nameEn(man)} and ${this.nameEn(woman)} joined ${this.bandEnLabel(b)} and ${this.bandEnLabel(other)} into one family.`]);
          }
        }
      }
    }
  }

  private bandDynamics(members: Map<number, Person[]>) {
    const t = this.t;
    for (const b of [...this.s.bands]) {
      const m = members.get(b.id)!;
      if (m.length === 0) {
        this.removeBand(b);
        continue;
      }
      // merge tiny bands into a neighbour
      if (m.length < 5 && this.s.bands.length > 1) {
        const near = this.s.bands.filter((o) => o.id !== b.id && dist(o, b) < 20 && (members.get(o.id)?.length ?? 0) > 0)
          .sort((x, y) => dist(x, b) - dist(y, b))[0];
        if (near) {
          for (const p of m) { p.bandId = near.id; members.get(near.id)!.push(p); }
          for (const tech of b.techs) this.addTech(near, tech);
          this.emit('merge', 1, `Последните ${m.length} от ${this.bandLabel(b)} се присъединиха към ${this.bandLabel(near)}.`, undefined, undefined, near.id, this.bRefs(b),
            [`The last ${m.length} of ${this.bandEnLabel(b)} joined ${this.bandEnLabel(near)}.`]);
          members.set(b.id, []);
          this.removeBand(b, near);
          continue;
        }
      }
      // nomads move with the seasons and the game
      // nomads stay while there is wood around the camp; only a real famine drives them off earlier
      if (!b.settled && !b.scout) {
        const noWood = this.treesNear(b.cx, b.cy, 4, 2) === 0;
        const starving = (b.fed ?? 1) < 0.7 && this.rng.chance(0.08);
        if (noWood || starving) this.moveCamp(b, m, noWood ? 22 : 16);
      }
      // split: rare, a band has to grow big first
      // a walled town holds more people before some leave to found a new village
      const limit = b.settled ? (this.hasTech(b, 'castle') ? 280 : this.hasTech(b, 'walls') ? 210 : 140) : 40 + Math.round(avg(m, (p) => p.genes.soc) * 20);
      // too many mouths for this land: some leave to find their own
      const crowded = !b.settled && m.length >= 24 && (b.fed ?? 1) < 1.05 && this.rng.chance(0.012);
      if (m.length > limit || crowded) this.split(b, m, members);
    }
    void t;
  }

  private removeBand(b: Band, into: Band | null = null) {
    const merged = !!into;
    this.goneQueue.push({
      id: b.id, name: b.name, settlementName: b.settlementName, color: b.color,
      foundedYear: Math.floor(yearOf(b.founded)), endedYear: Math.floor(this.year),
      end: into ? this.bandLabel(into, true) : 'extinct',
      techs: b.techs.map((x) => TECH_BY_ID.get(x)?.name ?? x),
      founder: b.founder ?? null, from: b.from ?? null,
    });
    const gone = this.bRefs(b);
    const i = this.s.bands.indexOf(b);
    if (i >= 0) this.s.bands.splice(i, 1);
    this.bandById.delete(b.id);
    this.techSets.delete(b.id);
    // a name is never given twice in one world, even after the band is gone
    if (!merged) {
      this.emit('extinct', 2, `${this.bandLabel(b, true)} угасна. Няма кой да запали огъня на тяхното място.`, `${this.bandLabel(b, true)} изчезна. Няма останали хора от този род.`, undefined, b.id, gone,
        [`${this.bandEnLabel(b, true)} has died out. No one is left to light a fire in their place.`, `${this.bandEnLabel(b, true)} is gone. No one from this clan is left.`]);
    }
    // knowledge lost forever?
    for (const tech of b.techs) {
      if (!this.s.bands.some((o) => this.techSets.get(o.id)?.has(tech))) {
        const name = TECH_BY_ID.get(tech)?.name ?? tech;
        this.s.discovered = this.s.discovered.filter((x) => x !== tech);
        this.emit('lost', 2, `Заедно с ${this.bandLabel(b)} изчезна и знанието за „${name}“. Някой ще трябва да го открие наново.`, undefined, undefined, b.id, gone,
          [`With ${this.bandEnLabel(b)}, the knowledge of “${this.techName(tech, true)}” vanished too. Someone will have to discover it anew.`]);
      }
    }
  }

  private campScore(x: number, y: number, R: number, self: Band): number {
    const t = this.t;
    if (!inBounds(x, y)) return -1;
    const c = idx(x, y);
    if (!this.campable(c) || t.height[c] > 0.62) return -1;
    // a new camp must be reachable: across water only with boats
    if (!this.reachable(self, x, y)) return -1;
    for (const o of this.s.bands) {
      if (o.id === self.id) continue;
      if (Math.hypot(o.cx - x, o.cy - y) < 7) return -1;
      // a place another chief is already walking to is taken
      if (o.scout && Math.hypot(o.scout.x - x, o.scout.y - y) < 7) return -1;
    }
    // a new camp needs wood: at least five big trees close by
    const big = this.treesNear(x, y, 4, BIG);
    if (big < 5) return -1;
    let s = Math.min(12, big) * 0.3;
    for (let oy = -R; oy <= R; oy += 2) for (let ox = -R; ox <= R; ox += 2) {
      if (!inBounds(x + ox, y + oy)) continue;
      const i = idx(x + ox, y + oy);
      s += t.plants[i] + t.game[i] * 1.2 + (this.hasTech(self, 'fishing') ? t.fish[i] * 0.8 : 0);
    }
    const temp = t.temp[c];
    if (temp < 0.3) s *= this.hasTech(self, 'clothing') ? 0.85 : 0.5;
    if (t.fish[c]) s *= 1.15;
    return s;
  }

  /** the band's head: the oldest man; a new one when he dies or leaves */
  private ensureChief(b: Band, m: Person[]): Person | null {
    const cur = b.chiefId ? this.byId.get(b.chiefId) : undefined;
    if (cur && cur.bandId === b.id && this.ageOf(cur) < 70) return cur;
    // at 70 the old chief stays by the fire with the children and hands over to the oldest man after him
    let best: Person | null = null;
    for (const p of m) if (p.sex === 0 && this.ageOf(p) >= 16 && this.ageOf(p) < 70 && (!best || p.born < best.born)) best = p;
    const had = !!b.chiefId;
    b.chiefId = best?.id ?? null;
    if (!best) { b.scout = null; return null; }
    if (had && b.settled) { // nomad bands change elders too often to write each one down
      this.emit('chief', 1, `${this.nameOf(best)} стана ${this.chiefTitle().toLowerCase()} на ${this.bandLabel(b)}.`,
        `${this.nameOf(best)} е новият ${this.chiefTitle().toLowerCase()} на ${this.bandLabel(b)}.`, best.id, b.id, [],
        [`${this.nameEn(best)} became ${chiefEn(this.chiefTitle()).toLowerCase()} of ${this.bandEnLabel(b)}.`]);
    }
    return best;
  }

  chiefTitle(): string {
    return CHIEF_TITLES[Math.min(this.s.era, CHIEF_TITLES.length - 1)];
  }

  /** the chief stays within two tiles of the camp, or walks ahead to a new place and calls the band after him */
  private lead(b: Band, chief: Person, m: Person[]) {
    if (b.scout) {
      chief.task = 'scout';
      // where he walked to so far (starts at the camp)
      const sc = b.scout;
      const px = sc.px ?? b.cx, py = sc.py ?? b.cy;
      const dx = sc.x - px, dy = sc.y - py;
      const d = Math.hypot(dx, dy);
      if (d > 0.6) {
        const v = Math.min(d, Math.max(6, d / 2)); // at most two months ahead of the band: he looks, then calls them
        sc.px = px + (dx / d) * v;
        sc.py = py + (dy / d) * v;
        chief.x = sc.px;
        chief.y = sc.py;
        return;
      }
      // someone else got there first: he gives up and walks back
      if (this.s.bands.some((o) => o.id !== b.id && Math.hypot(o.cx - sc.x, o.cy - sc.y) < 5)) {
        b.scout = null;
        chief.x = b.cx;
        chief.y = b.cy;
        chief.task = 'lead';
        return;
      }
      // he is there and likes it: the camp, the banner and everyone follow
      chief.x = sc.x;
      chief.y = sc.y;
      b.cx = sc.x;
      b.cy = sc.y;
      b.scout = null;
      this.clearAround(b.cx, b.cy, 1);
      for (const p of m) if (p !== chief) p.task = 'travel';
      return;
    }
    chief.task = 'lead';
    for (let k = 0; k < 6; k++) {
      const x = b.cx + this.rng.range(-2, 2), y = b.cy + this.rng.range(-2, 2);
      if (this.reachable(b, Math.round(x), Math.round(y))) { chief.x = x; chief.y = y; return; }
    }
    chief.x = b.cx + this.rng.range(-0.3, 0.3);
    chief.y = b.cy + this.rng.range(-0.3, 0.3);
  }

  private moveCamp(b: Band, m: Person[], range: number) {
    if (b.scout) return; // the chief is still looking
    let best = { x: b.cx, y: b.cy }, bestS = this.campScore(Math.round(b.cx), Math.round(b.cy), 4, b) * 1.05;
    for (let k = 0; k < 24; k++) {
      const x = Math.round(b.cx + this.rng.range(-range, range)), y = Math.round(b.cy + this.rng.range(-range, range));
      const s = this.campScore(x, y, 4, b);
      // -1 means "no camp possible here" (off the map, water, too close to others): never pick it,
      // even when the current camp scores -1 itself
      if (s > 0 && s > bestS) { bestS = s; best = { x, y }; }
    }
    if (best.x === b.cx && best.y === b.cy) return;
    // the chief goes first to look at the place; without one the whole band just goes
    if (b.chiefId && this.byId.get(b.chiefId)?.bandId === b.id) {
      b.scout = best;
      return;
    }
    b.cx = best.x; b.cy = best.y;
    this.clearAround(b.cx, b.cy, 1);
    for (const p of m) p.task = 'travel';
  }

  private split(b: Band, m: Person[], members: Map<number, Person[]>) {
    // a founding couple leaves with their children and some friends
    // the founder is a man in his prime: he becomes the elder of the new band
    const adults = m.filter((p) => p.sex === 0 && p.id !== b.chiefId && this.ageOf(p) >= 20 && this.ageOf(p) <= 45 && p.partnerId);
    if (!adults.length) return;
    const leader = adults.reduce((a, p) => (p.genes.cur + p.genes.str > a.genes.cur + a.genes.str ? p : a), adults[0]);
    const leaving = new Set<Person>([leader]);
    const partner = leader.partnerId ? this.byId.get(leader.partnerId) : undefined;
    if (partner && partner.bandId === b.id) leaving.add(partner);
    const target = Math.floor(m.length * 0.4);
    const families = [leader, partner].filter(Boolean) as Person[];
    for (const f of families) for (const c of f.children) { const ch = this.byId.get(c); if (ch && ch.bandId === b.id) leaving.add(ch); }
    for (const p of m) {
      if (leaving.size >= target) break;
      if (this.rng.chance(0.3)) {
        leaving.add(p);
        const pp = p.partnerId ? this.byId.get(p.partnerId) : undefined;
        if (pp && pp.bandId === b.id) leaving.add(pp);
      }
    }
    // where to go
    let best: { x: number; y: number } | null = null, bestS = 0;
    for (let k = 0; k < 30; k++) {
      const r = this.rng.range(9, b.settled ? 22 : 16);
      const a = this.rng.range(0, Math.PI * 2);
      const x = Math.round(b.cx + Math.cos(a) * r), y = Math.round(b.cy + Math.sin(a) * r);
      const s = this.campScore(x, y, 4, b);
      if (s > bestS) { bestS = s; best = { x, y }; }
    }
    if (!best) return;
    const nb = this.newBand(best.x, best.y, undefined, b.techs);
    nb.chiefId = leader.id;
    nb.founder = { id: leader.id, name: this.nameOf(leader) };
    nb.from = { id: b.id, name: this.bandLabel(b, true) };
    this.clearAround(nb.cx, nb.cy, 1);
    nb.food = b.food * 0.35;
    b.food *= 0.65;
    const list = members.get(b.id)!;
    const newList: Person[] = [];
    for (const p of leaving) {
      p.bandId = nb.id;
      p.task = 'travel';
      list.splice(list.indexOf(p), 1);
      newList.push(p);
    }
    members.set(nb.id, newList);
    leader.deeds.push(`Основа ${nb.name} и стана негов ${this.chiefTitle().toLowerCase()} (${formatYear(this.year)})`);
    // no chronicle line: the band's card tells who founded it and where they came from
    if (b.settled && this.hasTech(b, 'agriculture')) this.settleNew(nb);
  }

  private settleNew(b: Band) {
    b.settled = true;
    this.clearAround(b.cx, b.cy, 3);
    const used = new Set(this.s.usedPlaces);
    b.settlementName = placeName(this.rng, used);
    this.s.usedPlaces = [...used];
  }

  private contact() {
    const bands = this.s.bands;
    for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        const a = bands[i], b = bands[j];
        const d = dist(a, b);
        // horses and carts bring far neighbours together
        const reach = this.hasTech(a, 'railway') || this.hasTech(b, 'railway') ? 32 : this.hasTech(a, 'horse') || this.hasTech(b, 'horse') ? 24 : 16;
        if (d > reach) continue;
        // traders even out a good and a bad harvest between neighbours
        if (this.hasTech(a, 'trade') && this.hasTech(b, 'trade')) {
          const give = (a.food - b.food) * 0.05;
          a.food -= give;
          b.food += give;
        }
        if (!a.met.includes(b.id)) {
          a.met.push(b.id);
          b.met.push(a.id);
          if (this.rng.chance(0.4)) {
            this.emit('meet', 1, `${this.bandLabel(a, true)} и ${this.bandLabel(b)} се срещнаха край ${this.featureNear(a)}. Размениха си кремък и истории.`, undefined, undefined, a.id, this.bRefs(b),
              [`${this.bandEnLabel(a, true)} and ${this.bandEnLabel(b)} met by ${FEATURE_EN[this.featureNear(a)] ?? 'the river'}. They traded flint and stories.`]);
          }
        }
        // knowledge travels between neighbours
        const sa = this.techSets.get(a.id)!, sb = this.techSets.get(b.id)!;
        const share = 0.012 * (this.hasTech(a, 'cave_art') || this.hasTech(b, 'cave_art') ? 1.6 : 1)
          * (this.hasTech(a, 'writing') || this.hasTech(b, 'writing') ? 1.5 : 1);
        for (const tech of a.techs) if (!sb.has(tech) && this.canUse(b, tech) && this.rng.chance(share)) {
          this.addTech(b, tech);
          this.emit('learn', 1, `${this.bandLabel(b, true)} научи „${TECH_BY_ID.get(tech)!.name}“ от ${this.bandLabel(a)}.`, undefined, undefined, b.id, this.bRefs(a),
            [`${this.bandEnLabel(b, true)} learned “${this.techName(tech, true)}” from ${this.bandEnLabel(a)}.`]);
          if (tech === 'agriculture') this.settle(b, this.s.people.filter((p) => p.bandId === b.id));
        }
        for (const tech of b.techs) if (!sa.has(tech) && this.canUse(a, tech) && this.rng.chance(share)) {
          this.addTech(a, tech);
          this.emit('learn', 1, `${this.bandLabel(a, true)} научи „${TECH_BY_ID.get(tech)!.name}“ от ${this.bandLabel(b)}.`, undefined, undefined, a.id, this.bRefs(b),
            [`${this.bandEnLabel(a, true)} learned “${this.techName(tech, true)}” from ${this.bandEnLabel(b)}.`]);
          if (tech === 'agriculture') this.settle(a, this.s.people.filter((p) => p.bandId === a.id));
        }
      }
    }
  }

  private canUse(b: Band, tech: string): boolean {
    const def = TECH_BY_ID.get(tech);
    if (!def) return false;
    const set = this.techSets.get(b.id)!;
    if (!def.prereq.every((r) => set.has(r))) return false;
    // you can only farm where grain grows
    if (tech === 'agriculture' || tech === 'grinding') return this.areaHas(b, 7, 'grain');
    return true;
  }

  private featureNear(b: Band): string {
    const t = this.t;
    const i = idx(Math.round(b.cx), Math.round(b.cy));
    if (t.river[i]) return 'реката';
    const bi = t.biome[i];
    if (bi === Biome.Forest || bi === Biome.Taiga) return 'гората';
    if (bi === Biome.Hills) return 'хълмовете';
    if (bi === Biome.Beach) return 'морето';
    return 'голямата поляна';
  }

  private explore() {
    for (const b of this.s.bands) {
      const R = b.settled ? 6 : 8;
      const cx = Math.round(b.cx), cy = Math.round(b.cy);
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
        if (!inBounds(x, y)) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
        const i = idx(x, y);
        if (!this.t.explored[i]) { this.t.explored[i] = 1; this.exploredDirty = true; }
      }
    }
  }

  /** a small act of a watcher (a blessing, rain, a feast): see events.ts */
  watcherAct(kind: ActKind, target?: number): Band | null {
    return act(this as unknown as EventHost, kind, this.membersNow(), target);
  }

  /** a watcher answers a prayer (fork: events.ts) */
  answerPrayer(id: number) {
    return answerPrayer(this as unknown as EventHost, id, this.membersNow());
  }

  private membersNow(): Map<number, Person[]> {
    const members = new Map<number, Person[]>();
    for (const b of this.s.bands) members.set(b.id, []);
    for (const p of this.s.people) members.get(p.bandId)?.push(p);
    return members;
  }

  private randomEvents(members: Map<number, Person[]>) {
    if (!this.s.bands.length) return;
    worldEvents(this as unknown as EventHost, members);
    prayersStep(this as unknown as EventHost, members);
    // a great hunt
    if (this.rng.chance(0.004)) {
      const b = this.rng.pick(this.s.bands);
      const hunters = (members.get(b.id) ?? []).filter((p) => p.task === 'hunt');
      if (hunters.length) {
        const h = hunters.reduce((a, p) => (p.genes.str > a.genes.str ? p : a), hunters[0]);
        const beast = this.rng.pick(['мамут', 'пещерна мечка', 'огромен зубър', 'стадо диви коне', 'гигантски елен']);
        b.food += 40;
        h.deeds.push(`Поведе лова на ${beast}`);
        this.emit('hunt', 2, `${this.nameOf(h)} поведе ловците на ${this.bandLabel(b)} срещу ${beast}. Месото стигна за цял сезон.`,
          `${this.nameOf(h)} и ловците хванаха ${beast}! Цяло угощение!`, h.id, b.id, [],
          [`${this.nameEn(h)} led the hunters of ${this.bandEnLabel(b)} against ${BEAST_EN[beast] ?? beast}. The meat lasted a whole season.`,
            `${this.nameEn(h)} and the hunters caught ${BEAST_EN[beast] ?? beast}! A real feast!`]);
      }
    }
    // a hard winter
    if (this.month === 0 && this.rng.chance(0.06)) {
      const b = this.rng.pick(this.s.bands);
      b.food *= 0.4;
      this.emit('winter', 1, `Люта зима сполетя ${this.bandLabel(b)}. Запасите се стопиха.`, `Много студена зима при ${this.bandLabel(b)}. Сняг до колене!`, undefined, b.id, [],
        [`A bitter winter struck ${this.bandEnLabel(b)}. The stores melted away.`, `A very cold winter for ${this.bandEnLabel(b)}. Snow up to the knees!`]);
    }
    // drought in summer
    if (this.month === 6 && this.rng.chance(0.03)) {
      const b = this.rng.pick(this.s.bands);
      const cx = Math.round(b.cx), cy = Math.round(b.cy);
      for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 12; x++) if (inBounds(x, y)) this.t.plants[idx(x, y)] *= 0.4;
      this.emit('drought', 1, `Суша изгори тревите около ${this.bandLabel(b)}. Плодовете тази година са малко.`, undefined, undefined, b.id, [],
        [`Drought burned the grass around ${this.bandEnLabel(b)}. There is little fruit this year.`]);
    }
  }

  private checkEra() {
    let era = 0;
    for (const b of this.s.bands) era = Math.max(era, eraOf(this.techSets.get(b.id)!));
    if (era > this.s.era) {
      this.s.era = era;
      const why = ERA_WHY[era] ?? ['', ''];
      this.emit('era', 3, `Започва ${ERAS[era].name}.${why[0] ? ` ${why[0]}` : ''}`, `Нова епоха: ${ERAS[era].name}!`, undefined, undefined, [],
        [`The ${ERAS_EN[era]} begins.${why[1] ? ` ${why[1]}` : ''}`, `A new age: the ${ERAS_EN[era]}!`]);
    }
  }

  private milestones() {
    const marks = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    const pop = this.s.people.length;
    for (const mk of marks) {
      if (pop >= mk && this.s.milestone < mk) {
        this.s.milestone = mk;
        if (mk > 50) this.emit('milestone', 2, `Хората по света вече са ${mk.toLocaleString('bg-BG')}.`, `Вече има ${mk} души на света!`, undefined, undefined, [],
          [`There are now ${mk.toLocaleString('en-US')} people in the world.`, `There are ${mk} people in the world now!`]);
      }
    }
  }

  // ---------- views ----------

  bandViews(): BandView[] {
    const counts = new Map<number, number>();
    for (const p of this.s.people) counts.set(p.bandId, (counts.get(p.bandId) ?? 0) + 1);
    return this.s.bands.map((b) => ({
      id: b.id, name: b.name, color: b.color, x: b.cx, y: b.cy, settled: b.settled, settlementName: b.settlementName,
      techs: b.techs.map((x) => TECH_BY_ID.get(x)?.name ?? x),
      techIds: b.techs,
      chief: this.chiefView(b),
      founder: b.founder ?? null,
      from: b.from ?? null,
      size: counts.get(b.id) ?? 0,
      food: Math.round(b.food),
      founded: Math.floor(yearOf(b.founded)),
      hasFire: this.hasTech(b, 'fire'),
      dwelling: this.hasTech(b, 'mudbrick') ? 'house' : b.settled ? 'hut' : this.hasTech(b, 'shelter') ? 'tent' : 'none',
    }));
  }

  private chiefView(b: Band): BandView['chief'] {
    const c = b.chiefId ? this.byId.get(b.chiefId) : undefined;
    return c ? { id: c.id, name: this.nameOf(c), title: this.chiefTitle() } : null;
  }

  personRows(): PersonRow[] {
    const chiefs = new Set(this.s.bands.map((b) => b.chiefId));
    return this.s.people.map((p) => [
      p.id, Math.round(p.x * 10), Math.round(p.y * 10), TASKS.indexOf(p.task), p.bandId, Math.floor(this.ageOf(p)), p.sex, chiefs.has(p.id) ? 1 : 0,
    ]);
  }

  exploredB64(): string {
    const n = this.t.explored.length;
    const bytes = new Uint8Array((n + 7) >> 3);
    for (let i = 0; i < n; i++) if (this.t.explored[i]) bytes[i >> 3] |= 1 << (i & 7);
    return b64encode(bytes);
  }

  private ref(id: number | null): { id: number; name: string } | null {
    if (!id) return null;
    const p = this.byId.get(id);
    if (p) return { id, name: this.nameOf(p) };
    const d = this.lookupDead(id);
    return d ? { id, name: d.name } : null;
  }

  personDetail(id: number): PersonDetail | null {
    const p = this.byId.get(id);
    if (p) {
      const b = this.bandById.get(p.bandId);
      return {
        id, name: this.nameOf(p), sex: p.sex, bornYear: Math.floor(yearOf(p.born)), diedYear: null,
        age: Math.floor(this.ageOf(p)), cause: null, bandName: b ? this.bandLabel(b, true) : '',
        task: TASK_NAMES[p.task], genes: geneView(p.genes),
        mother: this.ref(p.motherId), father: this.ref(p.fatherId), partner: this.ref(p.partnerId),
        children: p.children.map((c) => ({ ...(this.ref(c) ?? { id: c, name: '?' }), alive: this.byId.has(c) })),
        deeds: p.deeds, generation: p.gen,
        title: b && b.chiefId === p.id ? `${this.chiefTitle()} на ${b.settlementName ? `${b.settlementName}` : b.name.replace(/^Родът на /, 'рода на ')}` : null,
      };
    }
    const d = this.lookupDead(id);
    if (!d) return null;
    return {
      id, name: d.name, sex: d.sex, bornYear: Math.floor(yearOf(d.born)), diedYear: Math.floor(yearOf(d.died)),
      age: Math.floor((d.died - d.born) / 12), cause: d.cause, bandName: d.bandName, task: '',
      genes: geneView(d.genes as Record<GeneKey, number>),
      mother: this.ref(d.motherId), father: this.ref(d.fatherId), partner: this.ref(d.partnerId),
      children: d.children.map((c) => ({ ...(this.ref(c) ?? { id: c, name: '?' }), alive: this.byId.has(c) })),
      deeds: d.deeds, generation: d.gen, title: null,
    };
  }

  /** a person alive or dead, with the ids of the parents */
  private kin(id: number | null): (TreeNode & { motherId: number | null; fatherId: number | null }) | null {
    if (!id) return null;
    const p = this.byId.get(id);
    if (p) return { id, name: this.nameOf(p), sex: p.sex, bornYear: Math.floor(yearOf(p.born)), diedYear: null, generation: p.gen, motherId: p.motherId, fatherId: p.fatherId };
    const d = this.lookupDead(id);
    if (!d) return null;
    return { id, name: d.name, sex: d.sex, bornYear: Math.floor(yearOf(d.born)), diedYear: Math.floor(yearOf(d.died)), generation: d.gen, motherId: d.motherId, fatherId: d.fatherId };
  }

  /** ancestors `depth` generations up, plus the straight mother and father lines back to the first people */
  familyTree(id: number, depth = 3): FamilyTree | null {
    const up = (nid: number | null, left: number): TreeNode | null => {
      const k = this.kin(nid);
      if (!k) return null;
      const { motherId, fatherId, ...node } = k;
      if (left > 0) { node.mother = up(motherId, left - 1); node.father = up(fatherId, left - 1); }
      return node;
    };
    const root = up(id, depth);
    if (!root) return null;
    const line = (side: 'motherId' | 'fatherId'): TreeNode[] => {
      const out: TreeNode[] = [];
      let k = this.kin(id);
      for (let n = 0; k && n < 5000; n++) {
        k = this.kin(k[side]);
        if (!k) break;
        const { motherId: _m, fatherId: _f, ...node } = k;
        out.push(node);
      }
      return out;
    };
    return { root, motherLine: line('motherId'), fatherLine: line('fatherId') };
  }

  /** finds so far, oldest first */
  secretFinds(): SecretFind[] {
    return (this.s.secrets ?? []).map((f) => (typeof f === 'number' ? { k: f, at: 0 } : f));
  }

  /** someone watching found secret k: the first find goes into the chronicle */
  findSecret(k: number): { first: boolean; found: number; at: number } | null {
    if (!Number.isInteger(k) || k < 0 || k >= SECRET_COUNT) return null;
    const list = this.secretFinds();
    const had = list.find((f) => f.k === k);
    if (had) return { first: false, found: list.length, at: had.at };
    const at = Date.now();
    list.push({ k, at });
    this.s.secrets = list;
    const kind = SECRET_KINDS[k % SECRET_KINDS.length];
    const hero = SECRET_HEROES[k];
    this.emit('secret', 2, `Тайна №${k + 1}, ${hero}: някой, който гледа отгоре, забеляза ${kind.name}. Намерени тайни: ${list.length} от ${SECRET_COUNT}.`,
      `Ура! Намерена е тайна №${k + 1}, ${hero}: ${kind.name}! Тайни: ${list.length} от ${SECRET_COUNT}.`, undefined, undefined, [],
      [`Secret #${k + 1}, ${SECRET_HEROES_EN[k]}: someone watching from above spotted ${SECRET_KINDS_EN[kind.id]?.name ?? kind.name}. Secrets found: ${list.length} of ${SECRET_COUNT}.`,
        `Hooray! Secret #${k + 1} is found, ${SECRET_HEROES_EN[k]}: ${SECRET_KINDS_EN[kind.id]?.name ?? kind.name}! Secrets: ${list.length} of ${SECRET_COUNT}.`]);
    return { first: true, found: list.length, at };
  }

  /** notable living people: discoverers, leaders, the oldest */
  heroes(): { id: number; name: string; age: number; band: string; deeds: string[] }[] {
    return this.s.people
      .filter((p) => p.deeds.length > 0 || this.ageOf(p) > 60)
      .sort((a, b) => b.deeds.length - a.deeds.length || this.ageOf(b) - this.ageOf(a))
      .slice(0, 30)
      .map((p) => ({ id: p.id, name: this.nameOf(p), age: Math.floor(this.ageOf(p)), band: this.bandById.has(p.bandId) ? this.bandLabel(this.bandById.get(p.bandId)!, true) : '', deeds: p.deeds }));
  }

  /** prepare state for saving */
  serialize(): SimState {
    this.s.rng = this.rng.s;
    this.s.plants = Array.from(this.t.plants, (v) => Math.round(v * 100));
    this.s.game = Array.from(this.t.game, (v) => Math.round(v * 100));
    this.s.explored = this.exploredB64();
    this.s.trees = Buffer.from(this.trees).toString('base64');
    this.s.roads = Buffer.from(this.roads).toString('base64');
    return this.s;
  }

  get extinct(): boolean {
    return this.s.people.length === 0;
  }
}

function dist(a: Band, b: Band): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function avg<T>(arr: T[], f: (x: T) => number): number {
  return arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0;
}

function topGene(g: Record<GeneKey, number>): string | null {
  let best: string | null = null, v = 0.62;
  for (const k of ['str', 'int', 'cur', 'soc', 'hea'] as const) if (g[k] > v) { v = g[k]; best = k; }
  return best;
}

function geneView(g: Record<GeneKey, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of GENE_KEYS) out[GENE_NAMES[k]] = Math.round((g[k] ?? 0.5) * 100);
  return out;
}

export { H, W };
