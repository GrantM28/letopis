import { Container, Sprite } from 'pixi.js';
import { Biome, isWater, RIVER_WATER } from '../shared/types';
import type { BandView } from '../shared/types';
import type { WorldRenderer } from './render';

/**
 * Animals are only for the eye: the simulation does not know them. Wild ones live around the camera,
 * on explored land that suits them, in the right climate and age (mammoths die out, storks fly south
 * in winter). Tame ones stay by the camps of the bands that know how to keep them.
 */

type Move = 'walk' | 'fly' | 'swim' | 'leap';
interface Species {
  id: string;
  /** frame names: [standing, moving]; birds that perch have a separate flying frame */
  stand: string;
  move: string[];
  how: Move;
  biomes: number[];
  minT?: number;
  maxT?: number;
  /** years, negative = BC */
  from?: number;
  until?: number;
  /** months when it is around (migrating birds) */
  months?: number[];
  group: [number, number];
  speed: number; // tiles per second
  weight: number;
  /** lives by the river */
  river?: boolean;
}

const { Grassland: GR, Plains: PL, Forest: FO, Taiga: TA, Hills: HI, Mountain: MO, Snow: SN, Desert: DE, Tundra: TU, Marsh: MA, Beach: BE } = {
  Grassland: Biome.Grassland, Plains: Biome.Plains, Forest: Biome.Forest, Taiga: Biome.Taiga, Hills: Biome.Hills, Mountain: Biome.Mountain,
  Snow: Biome.Snow, Desert: Biome.Desert, Tundra: Biome.Tundra, Marsh: Biome.Marsh, Beach: Biome.Beach,
};
const WARM = [3, 4, 5, 6, 7, 8];
const walk = (id: string) => ({ stand: `${id}0`, move: [`${id}0`, `${id}1`] });

const WILD: Species[] = [
  // ice age: gone as the ice melts
  { id: 'mammoth', ...walk('mammoth'), how: 'walk', biomes: [TU, PL, TA, GR], maxT: 0.5, until: -8000, group: [2, 4], speed: 0.35, weight: 3 },
  { id: 'rhino', ...walk('rhino'), how: 'walk', biomes: [TU, PL, GR], maxT: 0.5, until: -10000, group: [1, 2], speed: 0.35, weight: 2 },
  { id: 'cavebear', ...walk('cavebear'), how: 'walk', biomes: [TA, HI, MO], maxT: 0.5, until: -10500, group: [1, 1], speed: 0.4, weight: 1 },
  { id: 'megaloceros', ...walk('megaloceros'), how: 'walk', biomes: [TA, FO, GR, PL], maxT: 0.6, until: -6000, group: [1, 3], speed: 0.6, weight: 2 },
  { id: 'aurochs', ...walk('aurochs'), how: 'walk', biomes: [GR, PL, FO], minT: 0.25, until: 1627, group: [2, 5], speed: 0.4, weight: 3 },
  { id: 'bison', ...walk('bison'), how: 'walk', biomes: [PL, GR, TU], group: [2, 6], speed: 0.4, weight: 3 },
  { id: 'wildhorse', ...walk('wildhorse'), how: 'walk', biomes: [PL, GR, TU], until: 1900, group: [3, 6], speed: 0.7, weight: 3 },
  { id: 'reindeer', ...walk('reindeer'), how: 'walk', biomes: [TU, TA, SN], maxT: 0.4, group: [3, 7], speed: 0.55, weight: 3 },
  // forest
  { id: 'reddeer', ...walk('reddeer'), how: 'walk', biomes: [FO, TA, GR, HI], minT: 0.2, group: [1, 4], speed: 0.6, weight: 4 },
  { id: 'boar', ...walk('boar'), how: 'walk', biomes: [FO, MA], minT: 0.25, group: [1, 4], speed: 0.5, weight: 3 },
  { id: 'wolf', ...walk('wolf'), how: 'walk', biomes: [FO, TA, TU, HI], group: [2, 4], speed: 0.75, weight: 2 },
  { id: 'bear', ...walk('bear'), how: 'walk', biomes: [FO, TA, MO, HI], group: [1, 1], speed: 0.4, weight: 1.5 },
  { id: 'fox', ...walk('fox'), how: 'walk', biomes: [FO, GR, PL, TU], group: [1, 1], speed: 0.6, weight: 2 },
  { id: 'lynx', ...walk('lynx'), how: 'walk', biomes: [FO, TA, HI], maxT: 0.7, group: [1, 1], speed: 0.55, weight: 1 },
  { id: 'hare', ...walk('hare'), how: 'walk', biomes: [GR, PL, TU], group: [1, 2], speed: 0.9, weight: 2.5 },
  { id: 'beaver', ...walk('beaver'), how: 'walk', biomes: [FO, MA, TA], river: true, group: [1, 2], speed: 0.3, weight: 2 },
  // birds
  { id: 'stork', ...walk('stork'), how: 'walk', biomes: [GR, MA, PL], minT: 0.35, months: WARM, group: [1, 2], speed: 0.3, weight: 2 },
  { id: 'heron', ...walk('heron'), how: 'walk', biomes: [MA, GR, FO, BE], river: true, group: [1, 1], speed: 0.25, weight: 2 },
  { id: 'crow', stand: 'crow', move: ['crowfly', 'crow'], how: 'walk', biomes: [GR, PL, FO, TA, HI, TU, BE], group: [1, 3], speed: 0.8, weight: 2 },
  { id: 'owl', stand: 'owl', move: ['owlfly'], how: 'walk', biomes: [FO, TA], group: [1, 1], speed: 0.8, weight: 1 },
  { id: 'eagle', stand: 'eagle0', move: ['eagle0', 'eagle1'], how: 'fly', biomes: [MO, HI, SN, TA], group: [1, 1], speed: 1.2, weight: 2 },
  // on the water
  { id: 'duck', ...walk('duck'), how: 'swim', biomes: [], minT: 0.2, group: [2, 4], speed: 0.25, weight: 3 },
  { id: 'swan', ...walk('swan'), how: 'swim', biomes: [], minT: 0.25, group: [1, 2], speed: 0.2, weight: 1.5 },
  { id: 'fish', stand: 'fish0', move: ['fish0', 'fish1'], how: 'leap', biomes: [], group: [1, 1], speed: 0, weight: 3 },
  // warm south and desert
  { id: 'lion', ...walk('lion'), how: 'walk', biomes: [GR, PL, DE], minT: 0.66, group: [1, 3], speed: 0.5, weight: 1.5 },
  { id: 'camel', ...walk('camel'), how: 'walk', biomes: [DE], group: [1, 3], speed: 0.4, weight: 2 },
  { id: 'elephant', ...walk('elephant'), how: 'walk', biomes: [GR, FO, PL], minT: 0.72, group: [2, 4], speed: 0.35, weight: 2 },
  { id: 'gazelle', ...walk('gazelle'), how: 'walk', biomes: [DE, GR, PL], minT: 0.62, group: [2, 5], speed: 0.9, weight: 3 },
  { id: 'ostrich', ...walk('ostrich'), how: 'walk', biomes: [DE, PL], minT: 0.66, group: [1, 3], speed: 0.9, weight: 1.5 },
  { id: 'croc', ...walk('croc'), how: 'walk', biomes: [MA, BE], river: true, minT: 0.66, group: [1, 1], speed: 0.15, weight: 1.5 },
  { id: 'monkey', ...walk('monkey'), how: 'walk', biomes: [FO], minT: 0.68, group: [2, 4], speed: 0.5, weight: 2 },
];

/** tame animals by the camp: [species, techs it needs, from year, how many] */
const TAME: { sp: Species; tech?: string; settled?: boolean; from?: number; n: [number, number] }[] = [
  { sp: { id: 'dog', ...walk('dog'), how: 'walk', biomes: [], group: [1, 1], speed: 0.7, weight: 1 }, tech: 'dog', n: [1, 2] },
  { sp: { id: 'goat', ...walk('goat'), how: 'walk', biomes: [], group: [1, 1], speed: 0.4, weight: 1 }, tech: 'herding', n: [2, 4] },
  { sp: { id: 'sheep', ...walk('sheep'), how: 'walk', biomes: [], group: [1, 1], speed: 0.35, weight: 1 }, tech: 'herding', n: [3, 5] },
  { sp: { id: 'cow', ...walk('cow'), how: 'walk', biomes: [], group: [1, 1], speed: 0.3, weight: 1 }, tech: 'agriculture', n: [1, 3] },
  { sp: { id: 'pig', ...walk('pig'), how: 'walk', biomes: [], group: [1, 1], speed: 0.3, weight: 1 }, tech: 'agriculture', n: [1, 2] },
  { sp: { id: 'hen', ...walk('hen'), how: 'walk', biomes: [], group: [1, 1], speed: 0.3, weight: 1 }, tech: 'agriculture', n: [2, 3] },
  { sp: { id: 'cat', ...walk('cat'), how: 'walk', biomes: [], group: [1, 1], speed: 0.4, weight: 1 }, settled: true, from: -7500, n: [0, 1] },
  { sp: { id: 'horse', ...walk('horse'), how: 'walk', biomes: [], group: [1, 1], speed: 0.5, weight: 1 }, tech: 'agriculture', from: -3500, n: [1, 2] },
  { sp: { id: 'donkey', ...walk('donkey'), how: 'walk', biomes: [], group: [1, 1], speed: 0.4, weight: 1 }, tech: 'agriculture', from: -4000, n: [0, 1] },
];

class Animal {
  c = new Container();
  s = new Sprite();
  x: number;
  y: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  frame = '';
  base = 1;
  facing = 1;
  wait = 0;
  born = performance.now();
  life: number;
  gone = false;
  constructor(public f: Fauna, public sp: Species, x: number, y: number, public range: number, public band = 0) {
    this.x = this.hx = this.tx = x;
    this.y = this.hy = this.ty = y;
    this.c.addChild(this.s);
    this.c.eventMode = 'none';
    this.c.alpha = 0;
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.wait = Math.random() * 4000;
    this.life = sp.how === 'leap' ? 900 : Infinity;
    f.r.peopleLayer.addChild(this.c);
    this.set(sp.stand);
  }

  set(name: string) {
    if (name === this.frame || !this.f.r.atlas.has(name)) return;
    this.frame = name;
    this.f.r.atlas.set(this.s, name);
    this.base = this.s.scale.y;
  }

  step(now: number, dt: number) {
    const sp = this.sp;
    const age = now - this.born;
    if (sp.how === 'leap') {
      this.set(age < 450 ? sp.move[0] : sp.move[1]);
      if (age > this.life) this.gone = true;
    } else {
      const dx = this.tx - this.x, dy = this.ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.05 && this.wait <= 0) {
        const v = Math.min(d, sp.speed * dt);
        this.x += (dx / d) * v;
        this.y += (dy / d) * v;
        const sdx = dx - dy; // screen direction in iso
        if (Math.abs(sdx) > 0.05) this.facing = sdx < 0 ? -1 : 1;
        const k = Math.floor(now / (sp.how === 'fly' ? 260 : 200) + this.hx * 7) % sp.move.length;
        this.set(sp.move[k]);
      } else {
        this.set(sp.stand);
        this.wait -= dt * 1000;
        if (this.wait <= 0) this.pick();
      }
    }
    const p = this.f.r.tileTop(this.x, this.y);
    const flying = sp.how === 'fly' || (this.frame !== sp.stand && (this.frame.endsWith('fly')));
    const lift = sp.how === 'fly' ? 34 + Math.sin(now / 900 + this.hx) * 4 : flying ? 8 : 0;
    this.c.position.set(p.x, p.y - lift);
    this.c.zIndex = sp.how === 'fly' ? 1e6 : p.y;
    this.s.scale.set(this.base * this.facing, this.base);
    // fade in and out
    const target = this.gone ? 0 : 1;
    this.c.alpha += (target - this.c.alpha) * Math.min(1, dt * 3);
  }

  private pick() {
    const r = this.range;
    for (let k = 0; k < 8; k++) {
      const x = this.hx + (Math.random() * 2 - 1) * r, y = this.hy + (Math.random() * 2 - 1) * r;
      // land animals do not wade through rivers and lakes
      const dry = this.sp.how !== 'walk' || this.f.r.dryLine(this.x, this.y, x, y);
      if (dry && this.f.fits(this.sp, Math.round(x), Math.round(y))) {
        this.tx = x;
        this.ty = y;
        break;
      }
    }
    this.wait = 1500 + Math.random() * 6000;
  }

  destroy() {
    this.c.destroy({ children: true });
  }
}

export class Fauna {
  wild: Animal[] = [];
  tame = new Map<number, Animal[]>();
  year = -12000;
  private lastSpawn = 0;
  private bandKey = new Map<number, string>();
  constructor(public r: WorldRenderer) {}

  private tile(x: number, y: number): number {
    const { w, h } = this.r.info;
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    return y * w + x;
  }

  /** can this species stand on this tile now? */
  fits(sp: Species, x: number, y: number): boolean {
    const i = this.tile(x, y);
    if (i < 0) return false;
    const b = this.r.biome[i];
    const riverWater = this.r.river[i] >= RIVER_WATER;
    if (sp.how === 'swim' || sp.how === 'leap') return (b === Biome.Water || b === Biome.Lake || riverWater) && this.nearShore(x, y);
    if (isWater(b) || riverWater) return false;
    if (sp.how === 'fly') return true;
    if (sp.biomes.length && !sp.biomes.includes(b)) return false;
    if (sp.river && !this.nearRiver(x, y)) return false;
    return true;
  }

  private nearShore(x: number, y: number): boolean {
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const j = this.tile(x + ox, y + oy);
      if (j >= 0 && !isWater(this.r.biome[j]) && this.r.river[j] < RIVER_WATER) return true;
    }
    return false;
  }

  private nearRiver(x: number, y: number): boolean {
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const j = this.tile(x + ox, y + oy);
      if (j >= 0 && (this.r.river[j] >= 15 || this.r.biome[j] === Biome.Lake)) return true;
    }
    return false;
  }

  private climateOk(sp: Species, x: number, y: number): boolean {
    const t = this.r.tempAt(x, y);
    if (sp.minT !== undefined && t < sp.minT) return false;
    if (sp.maxT !== undefined && t > sp.maxT) return false;
    if (sp.from !== undefined && this.year < sp.from) return false;
    if (sp.until !== undefined && this.year > sp.until) return false;
    if (sp.months && !sp.months.includes(this.r.month)) return false;
    return true;
  }

  /** what is on screen, in tile coordinates (a loose box around the diamond) */
  private view(): { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } {
    const r = this.r, z = r.world.scale.x;
    const W = r.app.screen.width, H = r.app.screen.height;
    const toTile = (sx: number, sy: number) => {
      const wx = (sx - r.world.x) / z, wy = (sy - r.world.y) / z + 20;
      return { x: wy / 16 + wx / 32, y: wy / 16 - wx / 32 };
    };
    const a = toTile(0, 0), b = toTile(W, 0), c = toTile(0, H), d = toTile(W, H), m = toTile(W / 2, H / 2);
    return {
      x0: Math.min(a.x, b.x, c.x, d.x), x1: Math.max(a.x, b.x, c.x, d.x),
      y0: Math.min(a.y, b.y, c.y, d.y), y1: Math.max(a.y, b.y, c.y, d.y), cx: m.x, cy: m.y,
    };
  }

  updateBands(bands: BandView[]) {
    if (!this.r.info) return;
    const seen = new Set<number>();
    for (const b of bands) {
      seen.add(b.id);
      const techs = new Set(b.techs);
      const want = TAME.filter((t) => (!t.tech || techs.has(t.tech)) && (!t.settled || b.settled) && (t.from === undefined || this.year >= t.from));
      const key = want.map((t) => t.sp.id).join(',');
      let list = this.tame.get(b.id);
      if (!list || this.bandKey.get(b.id) !== key) {
        list?.forEach((a) => a.destroy());
        list = [];
        for (const t of want) {
          const n = t.n[0] + ((b.id * 7 + t.sp.id.length) % (t.n[1] - t.n[0] + 1));
          for (let k = 0; k < n; k++) {
            const a = new Animal(this, t.sp, b.x + (Math.random() * 4 - 2), b.y + (Math.random() * 4 - 2), t.sp.id === 'dog' ? 2 : 3, b.id);
            list.push(a);
          }
        }
        this.tame.set(b.id, list);
        this.bandKey.set(b.id, key);
      }
      // the herd follows the camp when it moves
      for (const a of list) {
        if (Math.hypot(a.hx - b.x, a.hy - b.y) > 0.5) {
          a.hx = b.x; a.hy = b.y; a.wait = Math.min(a.wait, 300);
          // no dry way to the new camp: they simply turn up there with the band
          if (!this.r.dryLine(a.x, a.y, b.x, b.y)) { a.x = a.tx = b.x; a.y = a.ty = b.y; }
        }
      }
    }
    for (const [id, list] of this.tame) if (!seen.has(id)) { list.forEach((a) => a.destroy()); this.tame.delete(id); this.bandKey.delete(id); }
  }

  frame(now: number, dt: number) {
    if (!this.r.info) return;
    const z = this.r.world.scale.x;
    const v = this.view();
    // wild ones: keep a few groups around the view, drop the ones far away or out of their time
    if (now - this.lastSpawn > 400) {
      this.lastSpawn = now;
      const span = Math.max(v.x1 - v.x0, v.y1 - v.y0);
      for (const a of this.wild) {
        if (Math.hypot(a.hx - v.cx, a.hy - v.cy) > span * 0.9 || !this.climateOk(a.sp, Math.round(a.hx), Math.round(a.hy))) a.gone = true;
      }
      const target = z < 0.45 ? 0 : Math.min(70, Math.round(span * 1.4));
      const live = this.wild.filter((a) => !a.gone && a.sp.how !== 'leap').length;
      if (live < target) this.spawn(v);
      if (z >= 0.45 && Math.random() < 0.6) this.spawnFish(v);
    }
    for (const a of this.wild) a.step(now, dt);
    for (const list of this.tame.values()) for (const a of list) a.step(now, dt);
    this.wild = this.wild.filter((a) => {
      if (a.gone && a.c.alpha < 0.05) { a.destroy(); return false; }
      return true;
    });
  }

  private spawn(v: ReturnType<Fauna['view']>) {
    for (let k = 0; k < 12; k++) {
      const x = Math.round(v.x0 + Math.random() * (v.x1 - v.x0)), y = Math.round(v.y0 + Math.random() * (v.y1 - v.y0));
      const i = this.tile(x, y);
      if (i < 0 || !this.r.explored[i]) continue;
      const options = WILD.filter((sp) => sp.how !== 'leap' && this.fits(sp, x, y) && this.climateOk(sp, x, y) && (sp.how !== 'fly' || this.r.biome[i] !== Biome.Grassland));
      // keep away from camps: wild animals avoid people
      let nearCamp = false;
      for (const c of this.r.camps.values()) if (Math.hypot(c.tx - x, c.ty - y) < 5) nearCamp = true;
      if (!options.length || nearCamp) continue;
      let sum = 0;
      for (const o of options) sum += o.weight;
      let pick = Math.random() * sum, sp = options[0];
      for (const o of options) { pick -= o.weight; if (pick <= 0) { sp = o; break; } }
      const n = sp.group[0] + Math.floor(Math.random() * (sp.group[1] - sp.group[0] + 1));
      for (let m = 0; m < n; m++) {
        const ax = x + (m ? Math.random() * 2 - 1 : 0), ay = y + (m ? Math.random() * 2 - 1 : 0);
        this.wild.push(new Animal(this, sp, ax, ay, sp.how === 'fly' ? 10 : sp.how === 'swim' ? 2 : 5));
      }
      return;
    }
  }

  private spawnFish(v: ReturnType<Fauna['view']>) {
    const fish = WILD.find((s) => s.id === 'fish')!;
    for (let k = 0; k < 6; k++) {
      const x = Math.round(v.x0 + Math.random() * (v.x1 - v.x0)), y = Math.round(v.y0 + Math.random() * (v.y1 - v.y0));
      const i = this.tile(x, y);
      if (i < 0 || !this.r.explored[i] || !this.fits(fish, x, y)) continue;
      this.wild.push(new Animal(this, fish, x + Math.random() - 0.5, y + Math.random() - 0.5, 0));
      return;
    }
  }
}
