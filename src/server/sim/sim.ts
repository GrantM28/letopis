import { Rng } from '../../shared/rng';
import {
  BandView, ChronicleEntry, PersonDetail, PersonRow, TASKS, TASK_NAMES, Task, TimeInfo, TreeNode, FamilyTree, b64encode, formatYear, isWater, Biome, RIVER_WATER,
} from '../../shared/types';
import { Terrain, generateTerrain, findStart, idx, inBounds, W, H, setWorldSize, OLD_SIZE, NEW_SIZE } from './world';
import { SECRET_COUNT, SECRET_HEROES, SECRET_KINDS, SecretFind } from '../../shared/secrets';
import { FEMALE, MALE, bandColor, bandName, fixBandName, familyFrom, nickname, placeName } from './names';
import { ERAS, TECHS, TECH_BY_ID, Tech, eraOf } from './tech';

export const START_YEAR = -12000;
const GLOBAL_DISCOVERY = 0.0006;
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
  events: ChronicleEntry[] = [];
  deadQueue: DeadRecord[] = [];
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
      this.dryCamps();
    } else {
      const sd = seed ?? Math.floor(Math.random() * 2 ** 31);
      setWorldSize(NEW_SIZE);
      this.t = generateTerrain(sd);
      this.regions = this.landRegions();
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
    this.explore();
    this.emit('genesis', 3,
      `Летописът започва. ${this.s.people.length} души в три рода бродят из ${'земите край голямата река'}. Не знаят огъня, нямат имена на местата. Имат само един друг.`,
      'Началото! Няколко семейства живеят сред дивата природа. Нямат огън, нито къщи. Да видим докъде ще стигнат.');
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

  private emit(kind: string, importance: number, text: string, kids?: string, personId?: number, bandId?: number) {
    this.events.push({
      id: this.s.nextEventId++,
      tick: this.s.tick,
      year: this.year,
      kind, importance, text, kids, personId, bandId,
    });
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
    for (const b of this.s.bands) {
      const m = members.get(b.id)!;
      if (m.length === 0) continue;
      this.work(b, m);
      this.discover(b, m);
    }
    this.lifeAndDeath(members);
    if (this.month === 3) this.pairing(members);
    this.bandDynamics(members);
    this.contact();
    if (this.s.tick % 6 === 0) this.explore();
    this.randomEvents(members);
    this.checkEra();
    this.milestones();
    this.s.rng = this.rng.s;
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
    const tool = this.hasTech(b, 'stone_tools') ? 1.25 : 1;
    const fire = this.hasTech(b, 'fire') ? 1.1 : 1;
    const R = b.settled ? 4 : 6;
    const season = this.seasonFactor(b);
    const workers: Person[] = [];
    let need = 0;
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
          huntWant += mult * (0.6 + season * 0.4);
          if (this.rng.chance(this.hasTech(b, 'spear') ? 0.0002 : 0.0004)) this.die(p, 'загина на лов', m);
          break;
        }
        case 'fish': got = 1.4 * skill * (this.hasTech(b, 'boats') ? 1.3 : 1) * (0.7 + season * 0.3); break;
        case 'farm': {
          farmWant += 2.4 * this.farmSeason() * skill * tool;
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
      const x = b.cx + this.rng.range(-1.2, 1.2), y = b.cy + this.rng.range(-1.2, 1.2);
      // stay on dry land by the hearth
      const ok = this.reachable(b, Math.round(x), Math.round(y));
      p.x = ok ? x : b.cx + this.rng.range(-0.3, 0.3);
      p.y = ok ? y : b.cy + this.rng.range(-0.3, 0.3);
    }
    prod += (this.harvest(t.plants, b, R, gatherWant, 0.07) + this.harvest(t.game, b, R + 2, huntWant, 0.045)) * craftBonus * fire;
    if (farmWant > 0) prod += Math.min(farmWant, this.arable(b) * 1.0 * this.farmSeason()) * craftBonus;
    const spoil = this.hasTech(b, 'pottery') ? 0.05 : this.hasTech(b, 'grinding') ? 0.08 : 0.12;
    b.food = Math.max(0, b.food * (1 - spoil) + prod - need);
    // how well fed the band has been lately (smoothed over about a year)
    const cover = need > 0 ? Math.min(2, (prod + Math.min(b.food, need * 2)) / need) : 1;
    b.fed = (b.fed ?? 1.2) * 0.75 + cover * 0.25;
    b.lastProd = prod;
    b.lastNeed = need;
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
      }
    }
    return false;
  }

  private discover(b: Band, m: Person[]) {
    const known = this.techSets.get(b.id)!;
    const dir = this.directorFactor();
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
    const crowd = Math.sqrt(adults.length);
    for (const tech of candidates) {
      // the person who might have the idea this month
      const p = this.rng.pick(adults);
      const g = p.genes[tech.gene] * 0.5 + p.genes.int * 0.25 + p.genes.cur * 0.25;
      // already known somewhere else: rediscovery is easier
      const again = this.s.discovered.includes(tech.id) ? 1.6 : 1;
      const chance = tech.base * GLOBAL_DISCOVERY * dir * again * crowd * Math.pow(g * 2, 3);
      if (!this.rng.chance(chance)) continue;
      this.addTech(b, tech.id);
      const first = !this.s.discovered.includes(tech.id);
      const name = this.nameOf(p);
      const fill = (s: string) => s.replace('{name}', name).replace('{band}', this.bandLabel(b)).replace('{Band}', this.bandLabel(b, true));
      if (first) {
        this.s.discovered.push(tech.id);
        p.deeds.push(`Откри „${tech.name}“ (${formatYear(this.year)})`);
        this.emit('discovery', 3, fill(tech.text), fill(tech.kids), p.id, b.id);
      } else {
        p.deeds.push(`Преоткри „${tech.name}“ за своя род`);
        this.emit('rediscovery', 1, `${name} от ${this.bandLabel(b)} откри наново „${tech.name}“, без да знае, че другаде вече го умеят.`, undefined, p.id, b.id);
      }
      if (tech.id === 'agriculture') this.settle(b, m);
      return; // one discovery per band per month
    }
  }

  private settle(b: Band, m: Person[]) {
    if (b.settled) return;
    b.settled = true;
    const used = new Set(this.s.usedPlaces);
    b.settlementName = placeName(this.rng, used);
    this.s.usedPlaces = [...used];
    const elder = m.reduce((a, p) => (this.ageOf(p) > this.ageOf(a) ? p : a), m[0]);
    this.emit('settle', 3,
      `${b.name} спря да скита и основа селото ${b.settlementName}. Най-възрастната в рода, ${this.nameOf(elder)}, избра мястото край водата.`,
      `${b.name} построи село и го нарече ${b.settlementName}!`, elder.id, b.id);
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
      const medicine = this.hasTech(b, 'herb_lore') ? 0.8 : 1;
      const settledDisease = b.settled ? 1.4 : 1;
      for (const p of m) {
        const a = this.ageOf(p);
        const lon = p.genes.lon, hea = p.genes.hea;
        // annual mortality
        let q: number;
        if (a < 1) q = 0.16;
        else if (a < 5) q = 0.05;
        else if (a < 15) q = 0.012;
        else q = 0.005 + 0.00035 * Math.exp(0.085 * (a - 10 * (lon - 0.5) * 2));
        q *= medicine * settledDisease * (1.3 - hea * 0.6) * guardian;
        let pm = q / 12 + guardian * coldRisk * (a < 5 || a > 55 ? 2 : 1) + hungry * 0.015 * (a < 5 || a > 55 ? 2 : 0.6);
        if (this.rng.chance(pm)) {
          const cause = hungry > 0.25 && this.rng.chance(0.6) ? 'почина в гладна година'
            : coldRisk > 0.004 && this.rng.chance(0.5) ? 'почина в лютата зима'
            : a > 55 ? 'почина от старост' : a < 5 ? 'почина като дете' : 'почина от болест';
          this.die(p, cause, m);
          continue;
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
          this.emit('twins', 1, `В ${this.bandLabel(b)} ${this.nameOf(mother)} роди близнаци.`, `В ${this.bandLabel(b)} се родиха близнаци!`, child.id, b.id);
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
    if (p.deeds.some((d) => d.startsWith('Откри'))) {
      this.emit('death', 2, `${this.nameOf(p)} ${cause} на ${age} години. Родът ще помни, че тя/той ${p.deeds[0].toLowerCase()}.`.replace('тя/той', p.sex ? 'тя' : 'той'),
        `${this.nameOf(p)} си отиде на ${age} години. Всички помнят какво е открил${p.sex ? 'а' : ''}.`, p.id, p.bandId);
    } else if (age >= 70) {
      this.emit('death', 1, `${this.nameOf(p)} от ${b ? this.bandLabel(b) : 'рода'} ${cause} на почтените ${age} години.`, undefined, p.id, p.bandId);
    } else if (cause === 'загина на лов') {
      this.emit('death', 1, `${this.nameOf(p)} от ${b ? this.bandLabel(b) : 'рода'} не се върна от лова.`, `${this.nameOf(p)} не се върна от лова. Родът е тъжен.`, p.id, p.bandId);
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
            this.emit('marriage', 1, `${this.nameOf(man)} и ${this.nameOf(woman)} събраха ${this.bandLabel(b)} и ${this.bandLabel(other)} в едно семейство.`, undefined, man.id, b.id);
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
          this.emit('merge', 1, `Последните ${m.length} от ${this.bandLabel(b)} се присъединиха към ${this.bandLabel(near)}.`, undefined, undefined, near.id);
          members.set(b.id, []);
          this.removeBand(b, true);
          continue;
        }
      }
      // nomads move with the seasons and the game
      if (!b.settled) {
        const poor = b.lastProd < b.lastNeed * 1.1;
        if ((poor && this.rng.chance(0.35)) || this.rng.chance(0.04)) this.moveCamp(b, m, poor ? 22 : 11);
      }
      // split
      const limit = b.settled ? 140 : 30 + Math.round(avg(m, (p) => p.genes.soc) * 16);
      // too many mouths for this land: some leave to find their own
      const crowded = !b.settled && m.length >= 18 && (b.fed ?? 1) < 1.1 && this.rng.chance(0.04);
      if (m.length > limit || crowded) this.split(b, m, members);
    }
    void t;
  }

  private removeBand(b: Band, merged = false) {
    const i = this.s.bands.indexOf(b);
    if (i >= 0) this.s.bands.splice(i, 1);
    this.bandById.delete(b.id);
    this.techSets.delete(b.id);
    // the name is free again for a future band
    this.s.usedBands = this.s.usedBands.filter((n) => n !== b.name);
    if (!merged) {
      this.emit('extinct', 2, `${this.bandLabel(b, true)} угасна. Няма кой да запали огъня на тяхното място.`, `${this.bandLabel(b, true)} изчезна. Няма останали хора от този род.`, undefined, b.id);
    }
    // knowledge lost forever?
    for (const tech of b.techs) {
      if (!this.s.bands.some((o) => this.techSets.get(o.id)?.has(tech))) {
        const name = TECH_BY_ID.get(tech)?.name ?? tech;
        this.s.discovered = this.s.discovered.filter((x) => x !== tech);
        this.emit('lost', 2, `Заедно с ${this.bandLabel(b)} изчезна и знанието за „${name}“. Някой ще трябва да го открие наново.`, undefined, undefined, b.id);
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
    for (const o of this.s.bands) if (o.id !== self.id && Math.hypot(o.cx - x, o.cy - y) < 7) return -1;
    let s = 0;
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

  private moveCamp(b: Band, m: Person[], range: number) {
    let best = { x: b.cx, y: b.cy }, bestS = this.campScore(Math.round(b.cx), Math.round(b.cy), 4, b) * 1.05;
    for (let k = 0; k < 24; k++) {
      const x = Math.round(b.cx + this.rng.range(-range, range)), y = Math.round(b.cy + this.rng.range(-range, range));
      const s = this.campScore(x, y, 4, b);
      if (s > bestS) { bestS = s; best = { x, y }; }
    }
    if (best.x === b.cx && best.y === b.cy) return;
    b.cx = best.x; b.cy = best.y;
    for (const p of m) p.task = 'travel';
  }

  private split(b: Band, m: Person[], members: Map<number, Person[]>) {
    // a founding couple leaves with their children and some friends
    const adults = m.filter((p) => this.ageOf(p) >= 20 && this.ageOf(p) <= 45 && p.partnerId);
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
    leader.deeds.push(`Поведе ${nb.name} към нови земи (${formatYear(this.year)})`);
    if (b.settled && this.hasTech(b, 'agriculture')) {
      this.settleNew(nb);
      this.emit('colony', 2, `${this.nameOf(leader)} поведе ${newList.length} души от ${b.settlementName} и основа ново село: ${nb.settlementName}.`,
        `${this.nameOf(leader)} и още ${newList.length - 1} души основаха новото село ${nb.settlementName}.`, leader.id, nb.id);
    } else {
      this.emit('split', 2, `${b.name} стана твърде голям. ${this.nameOf(leader)} поведе ${newList.length} души на път и така се роди ${nb.name}.`,
        `${this.nameOf(leader)} тръгна с ${newList.length - 1} души да търси нов дом. Така се появи ${nb.name}.`, leader.id, nb.id);
    }
  }

  private settleNew(b: Band) {
    b.settled = true;
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
        if (d > 16) continue;
        if (!a.met.includes(b.id)) {
          a.met.push(b.id);
          b.met.push(a.id);
          if (this.rng.chance(0.4)) {
            this.emit('meet', 1, `${this.bandLabel(a, true)} и ${this.bandLabel(b)} се срещнаха край ${this.featureNear(a)}. Размениха си кремък и истории.`, undefined, undefined, a.id);
          }
        }
        // knowledge travels between neighbours
        const sa = this.techSets.get(a.id)!, sb = this.techSets.get(b.id)!;
        const share = 0.012 * (this.hasTech(a, 'cave_art') || this.hasTech(b, 'cave_art') ? 1.6 : 1);
        for (const tech of a.techs) if (!sb.has(tech) && this.canUse(b, tech) && this.rng.chance(share)) {
          this.addTech(b, tech);
          this.emit('learn', 1, `${this.bandLabel(b, true)} научи „${TECH_BY_ID.get(tech)!.name}“ от ${this.bandLabel(a)}.`, undefined, undefined, b.id);
          if (tech === 'agriculture') this.settle(b, this.s.people.filter((p) => p.bandId === b.id));
        }
        for (const tech of b.techs) if (!sa.has(tech) && this.canUse(a, tech) && this.rng.chance(share)) {
          this.addTech(a, tech);
          this.emit('learn', 1, `${this.bandLabel(a, true)} научи „${TECH_BY_ID.get(tech)!.name}“ от ${this.bandLabel(b)}.`, undefined, undefined, a.id);
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

  private randomEvents(members: Map<number, Person[]>) {
    if (!this.s.bands.length) return;
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
          `${this.nameOf(h)} и ловците хванаха ${beast}! Цяло угощение!`, h.id, b.id);
      }
    }
    // a hard winter
    if (this.month === 0 && this.rng.chance(0.06)) {
      const b = this.rng.pick(this.s.bands);
      b.food *= 0.4;
      this.emit('winter', 1, `Люта зима сполетя ${this.bandLabel(b)}. Запасите се стопиха.`, `Много студена зима при ${this.bandLabel(b)}. Сняг до колене!`, undefined, b.id);
    }
    // drought in summer
    if (this.month === 6 && this.rng.chance(0.03)) {
      const b = this.rng.pick(this.s.bands);
      const cx = Math.round(b.cx), cy = Math.round(b.cy);
      for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 12; x++) if (inBounds(x, y)) this.t.plants[idx(x, y)] *= 0.4;
      this.emit('drought', 1, `Суша изгори тревите около ${this.bandLabel(b)}. Плодовете тази година са малко.`, undefined, undefined, b.id);
    }
  }

  private checkEra() {
    let era = 0;
    for (const b of this.s.bands) era = Math.max(era, eraOf(this.techSets.get(b.id)!));
    if (era > this.s.era) {
      this.s.era = era;
      this.emit('era', 3, `Започва ${ERAS[era].name}. Хората вече не само търсят храна, а я отглеждат.`, `Нова епоха: ${ERAS[era].name}!`);
    }
  }

  private milestones() {
    const marks = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    const pop = this.s.people.length;
    for (const mk of marks) {
      if (pop >= mk && this.s.milestone < mk) {
        this.s.milestone = mk;
        if (mk > 50) this.emit('milestone', 2, `Хората по света вече са ${mk.toLocaleString('bg-BG')}.`, `Вече има ${mk} души на света!`);
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
      size: counts.get(b.id) ?? 0,
      food: Math.round(b.food),
      founded: Math.floor(yearOf(b.founded)),
      hasFire: this.hasTech(b, 'fire'),
      dwelling: this.hasTech(b, 'mudbrick') ? 'house' : b.settled ? 'hut' : this.hasTech(b, 'shelter') ? 'tent' : 'none',
    }));
  }

  personRows(): PersonRow[] {
    return this.s.people.map((p) => [
      p.id, Math.round(p.x * 10), Math.round(p.y * 10), TASKS.indexOf(p.task), p.bandId, Math.floor(this.ageOf(p)), p.sex,
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
      deeds: d.deeds, generation: d.gen,
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
      `Ура! Намерена е тайна №${k + 1}, ${hero}: ${kind.name}! Тайни: ${list.length} от ${SECRET_COUNT}.`);
    return { first: true, found: list.length, at };
  }

  /** notable living people: discoverers, leaders, the oldest */
  heroes(): { id: number; name: string; age: number; band: string; deeds: string[] }[] {
    return this.s.people
      .filter((p) => p.deeds.length > 0 || this.ageOf(p) > 60)
      .sort((a, b) => b.deeds.length - a.deeds.length || this.ageOf(b) - this.ageOf(a))
      .slice(0, 30)
      .map((p) => ({ id: p.id, name: this.nameOf(p), age: Math.floor(this.ageOf(p)), band: this.bandLabel(this.bandById.get(p.bandId)!, true), deeds: p.deeds }));
  }

  /** prepare state for saving */
  serialize(): SimState {
    this.s.rng = this.rng.s;
    this.s.plants = Array.from(this.t.plants, (v) => Math.round(v * 100));
    this.s.game = Array.from(this.t.game, (v) => Math.round(v * 100));
    this.s.explored = this.exploredB64();
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
