import {
  AlphaFilter, Application, BlurFilter, Container, Filter, GlProgram, Graphics, ImageSource, Rectangle, Sprite, Text, Texture,
} from 'pixi.js';
import { Simplex } from '../shared/noise';
import { Rng } from '../shared/rng';
import { BandView, Biome, PersonRow, TASKS, WorldInfo, b64decode, isWater } from '../shared/types';

export const TW = 32; // tile width
export const TH = 16; // tile height
export const ELEV = 5; // pixels per height level
const CHUNK = 16;

export function iso(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) };
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick<T>(list: T[], n: number): T {
  return list[Math.min(list.length - 1, Math.floor(n * list.length))];
}

// ---------- sprite atlas (made by tools/build_atlas.py from the AI sheets in art/) ----------

interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; s: number }

export class Atlas {
  tex: Record<string, Texture> = {};
  frames: Record<string, Frame> = {};

  static async load(base: string, version = ''): Promise<Atlas> {
    const a = new Atlas();
    const v = version ? `?v=${version}` : '';
    const [meta, blob] = await Promise.all([
      fetch(`${base}/atlas.json${v}`).then((r) => r.json()),
      fetch(`${base}/atlas.png${v}`).then((r) => r.blob()),
    ]);
    // WebGL ignores its premultiply flag for ImageBitmaps, so premultiply here and tell Pixi it is done;
    // otherwise half-transparent edges are drawn too bright (light halos around every sprite)
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
    const source = new ImageSource({
      resource: bitmap,
      alphaMode: 'premultiplied-alpha',
      autoGenerateMipmaps: true,
      scaleMode: 'linear',
      mipmapFilter: 'linear',
      maxAnisotropy: 4,
    });
    a.frames = meta.frames;
    for (const [name, f] of Object.entries(a.frames)) {
      a.tex[name] = new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
    }
    return a;
  }

  has(name: string): boolean {
    return name in this.frames;
  }

  sprite(name: string): Sprite {
    const s = new Sprite();
    this.set(s, name);
    return s;
  }

  /** world units per texture pixel */
  scale(name: string): number {
    return this.frames[name].s;
  }

  set(s: Sprite, name: string, mul = 1) {
    const f = this.frames[name];
    s.texture = this.tex[name];
    s.anchor.set(f.ax, f.ay);
    s.scale.set(f.s * mul);
  }
}

// Totem in the band name -> symbol in the atlas (sym0..sym15, same order as sheet J).
const SYM = {
  paw: 0, wolf: 1, eagle: 2, antlers: 3, falcon: 4, boar: 5, bison: 6, fox: 7,
  owl: 8, fish: 9, oak: 10, waves: 11, flame: 12, star: 13, moon: 14, sun: 15,
};
const TOTEM_SYMBOL: [RegExp, number][] = [
  [/Мечка/, SYM.paw], [/Вълк/, SYM.wolf], [/Орел|Гарван|Щъркел/, SYM.eagle], [/Елен|Сърна/, SYM.antlers],
  [/Сокол|Ястреб|Лястовиц/, SYM.falcon], [/Глиган|Бобър/, SYM.boar], [/Бизон|Кон|Лъв/, SYM.bison], [/Лисиц|Рис/, SYM.fox],
  [/Бухал|Сова/, SYM.owl], [/Риба/, SYM.fish], [/Дъб|Бор|Гора/, SYM.oak], [/Река|Езеро|Змия|Роса|Вят|Облак/, SYM.waves],
  [/Огън|Пламъч/, SYM.flame], [/Звезд|Зорниц/, SYM.star], [/Луна/, SYM.moon], [/Слън/, SYM.sun],
];
export function bandSymbol(name: string, id: number): number {
  for (const [re, s] of TOTEM_SYMBOL) if (re.test(name)) return s;
  return Math.floor(hash(id, 3) * 16);
}

// Own GLSL: gentle moving light on the water surface.
const WATER_VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }
`;
const WATER_FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
uniform vec4 uCam; // x, y offset, scale, unused
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 p = (gl_FragCoord.xy - uCam.xy) / uCam.z;
  float w = sin(p.x * 0.09 + uTime * 1.1) * sin(p.y * 0.21 - uTime * 0.8)
          + 0.5 * sin((p.x + p.y) * 0.05 - uTime * 0.6);
  float glint = smoothstep(1.1, 1.45, w);
  c.rgb += c.a * (vec3(0.02, 0.035, 0.05) * w + vec3(0.16, 0.2, 0.22) * glint);
  finalColor = c;
}
`;

type ObjKind = 'decid' | 'conifer' | 'other';
interface WorldObject { s: Sprite; i: number; kind: ObjKind; base: string; n: number; size: number; flip: number }

export class WorldRenderer {
  app: Application;
  atlas: Atlas;
  world = new Container(); // camera moves this
  terrainLayer = new Container();
  waterLayer = new Container();
  snowLayer = new Container();
  objLayer = new Container();
  fogLayer = new Container();
  campLayer = new Container();
  peopleLayer = new Container();
  glowLayer = new Container();
  labelLayer = new Container();
  nightOverlay = new Graphics();
  info!: WorldInfo;
  level!: Uint8Array;
  biome!: Uint8Array;
  river!: Uint8Array;
  temp!: Uint8Array;
  explored: Uint8Array = new Uint8Array(0);
  cleared = new Set<number>();
  fogChunks = new Map<number, Graphics>();
  objChunks = new Map<number, WorldObject[]>();
  chunkViews: { area: Rectangle; parts: Container[] }[] = [];
  clumps = new Simplex(new Rng(20261101));
  fogReady = false;
  waterFilter: Filter | null = null;
  snowCold!: Container;
  snowCool!: Container;
  people = new Map<number, PersonSprite>();
  selectedId: number | null = null;
  camps = new Map<number, CampSprite>();
  tex!: Record<string, Texture>;
  time = 0;
  month = 0;
  seasonKey = '';
  zoom = 1;
  night = true;

  constructor(app: Application, atlas: Atlas) {
    this.app = app;
    this.atlas = atlas;
    this.world.addChild(this.waterLayer, this.terrainLayer, this.snowLayer, this.objLayer, this.campLayer, this.peopleLayer, this.fogLayer, this.glowLayer, this.labelLayer);
    app.stage.addChild(this.world, this.nightOverlay);
    this.snowCold = new Container();
    this.snowCool = new Container();
    this.snowLayer.addChild(this.snowCool, this.snowCold);
    this.glowLayer.blendMode = 'add';
    // one soft veil over the unknown lands
    this.fogLayer.filters = [new BlurFilter({ strength: 6, quality: 3 }), new AlphaFilter({ alpha: 0.9 })];
    this.makeTextures();
  }

  private makeTextures() {
    const r = this.app.renderer;
    const g = (draw: (g: Graphics) => void) => {
      const gr = new Graphics();
      draw(gr);
      const t = r.generateTexture({ target: gr, resolution: 3 });
      gr.destroy();
      return t;
    };
    this.tex = {
      ground: g((x) => {
        for (let i = 6; i > 0; i--) x.ellipse(52, 26, 24 + i * 4, 12 + i * 2).fill({ color: 0x7a5a36, alpha: 0.12 });
        x.ellipse(52, 26, 26, 13).fill({ color: 0x8c6b44, alpha: 0.5 });
      }),
      glow: g((x) => {
        for (let i = 10; i > 0; i--) x.circle(40, 40, i * 4).fill({ color: 0xff8a2a, alpha: 0.035 });
      }),
    };
  }

  setWorld(info: WorldInfo) {
    this.info = info;
    const h = b64decode(info.height);
    this.biome = b64decode(info.biome);
    this.river = b64decode(info.river);
    this.temp = b64decode(info.temp);
    this.level = new Uint8Array(h.length);
    for (let i = 0; i < h.length; i++) {
      const v = h[i] / 127.5 - 1;
      this.level[i] = isWater(this.biome[i]) ? 0 : 1 + Math.floor(Math.max(0, v) * 14);
    }
    this.explored = new Uint8Array(info.w * info.h);
    this.cleared.clear();
    for (const l of [this.terrainLayer, this.waterLayer, this.snowCold, this.snowCool, this.fogLayer, this.objLayer]) l.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.fogChunks.clear();
    this.objChunks.clear();
    this.chunkViews = [];
    this.fogReady = false;
    this.seasonKey = '';
    this.buildTerrain();
    this.setupWaterFilter();
  }

  private lv(x: number, y: number): number {
    const { w, h } = this.info;
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return this.level[y * w + x];
  }

  /** small streams stay hidden; from a real river on, the tile is water */
  private isRiver(i: number): boolean {
    return this.river[i] >= 40 && !isWater(this.biome[i]);
  }

  private buildTerrain() {
    const { w, h } = this.info;
    const nch = Math.ceil(w / CHUNK);
    for (let s = 0; s <= 2 * (nch - 1); s++) {
      for (let cx = 0; cx < nch; cx++) {
        const cy = s - cx;
        if (cy < 0 || cy >= nch) continue;
        const land = new Container();
        const water = new Container();
        const cold = new Container();
        const cool = new Container();
        const objs = new Container();
        const list: WorldObject[] = [];
        for (let d = 0; d <= 2 * (CHUNK - 1); d++) {
          for (let lx = 0; lx < CHUNK; lx++) {
            const ly = d - lx;
            if (ly < 0 || ly >= CHUNK) continue;
            const x = cx * CHUNK + lx, y = cy * CHUNK + ly;
            if (x >= w || y >= h) continue;
            this.placeTile(x, y, land, water, cold, cool);
            this.placeObjects(x, y, objs, list);
          }
        }
        objs.sortableChildren = true;
        // bounds of the chunk in world space, so the culler skips chunks off screen
        const p0 = iso(cx * CHUNK, cy * CHUNK);
        const area = new Rectangle(p0.x - CHUNK * TW / 2 - TW, p0.y - 15 * ELEV - 40, CHUNK * TW + 2 * TW, CHUNK * TH + 15 * ELEV + 80);
        for (const [c, layer] of [[land, this.terrainLayer], [water, this.waterLayer], [cold, this.snowCold], [cool, this.snowCool], [objs, this.objLayer]] as [Container, Container][]) {
          layer.addChild(c);
        }
        const key = cy * nch + cx;
        this.objChunks.set(key, list);
        const fog = new Graphics();
        this.fogLayer.addChild(fog);
        this.fogChunks.set(key, fog);
        this.chunkViews.push({ area, parts: [land, water, cold, cool, objs, fog] });
      }
    }
    for (const list of this.objChunks.values()) for (const o of list) o.s.visible = false;
  }

  private groundOf(b: number, x: number, y: number, n: number): { name: string; tint: number } {
    const v = Math.floor(hash(x * 3 + 1, y * 5 + 2) * 4);
    let tint = 0xffffff;
    let name: string;
    switch (b) {
      case Biome.DeepWater: name = `deep${hash(x, y + 9) < 0.85 ? 0 : 1}`; break;
      case Biome.Water: {
        let coast = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.lv(x + dx, y + dy) > 0) coast = true;
        name = coast ? `shallow${v}` : `deep${hash(x, y + 9) < 0.7 ? 0 : 1}`;
        break;
      }
      case Biome.Lake: name = n < 0.35 ? `lily${v}` : `shallow${v % 2}`; break;
      case Biome.Beach: name = `sand${v}`; break;
      case Biome.Desert: name = `sand${v % 2}`; tint = 0xf2d6a8; break;
      case Biome.Grassland: name = n < 0.22 ? `meadow${v}` : `grass${v}`; break;
      case Biome.Plains: name = `steppe${v}`; break;
      case Biome.Forest: name = `grass${v}`; tint = 0xd6e8c8; break;
      case Biome.Taiga: name = `grass${v}`; tint = 0xa9c4b0; break;
      case Biome.Hills: name = n < 0.5 ? `hill${v}` : `grass${v}`; break;
      case Biome.Mountain: name = n < 0.55 ? `rock${v}` : `crag${v}`; break;
      case Biome.Snow: name = `snow${v}`; break;
      case Biome.Tundra: name = `tundra${v}`; break;
      case Biome.Marsh: name = `marsh${v}`; break;
      default: name = `grass${v}`;
    }
    return { name, tint };
  }

  private placeTile(x: number, y: number, land: Container, water: Container, cold: Container, cool: Container) {
    const { w } = this.info;
    const i = y * w + x;
    const b = this.biome[i];
    const L = this.level[i];
    const p = iso(x, y);
    const top = p.y - L * ELEV;
    const n = hash(x, y);
    let { name, tint } = this.groundOf(b, x, y, n);
    // rivers are strips of shallow water on the land
    if (this.isRiver(i)) { name = `shallow${hash(x, y + 3) < 0.7 ? 0 : 1}`; tint = 0xe8f4ff; }
    if (isWater(b)) {
      // water at the map edge shows its side, inside the sea only the surface
      const edge = x === this.info.w - 1 || y === this.info.h - 1;
      const s = this.atlas.sprite(edge ? name : name + '_t');
      s.position.set(p.x, top + TH / 2);
      water.addChild(s);
      return;
    }
    // light comes from the north-west: tiles facing it are a bit brighter
    const slope = (this.lv(x - 1, y) - L) + (this.lv(x, y - 1) - L);
    const light = Math.max(0.78, Math.min(1.05, 1 - slope * 0.04));
    // cliffs: the tile has its own short wall (one level); deeper drops get stacked earth or rock below it
    const drop = L - Math.min(this.lv(x, y + 1), this.lv(x + 1, y));
    if (drop > 1) {
      const wall = L >= 6 || b === Biome.Mountain || b === Biome.Hills ? `rock${Math.floor(n * 4)}` : 'path0';
      for (let k = drop - 1; k >= 1; k--) {
        const s = this.atlas.sprite(wall);
        s.position.set(p.x, top + TH / 2 + k * ELEV);
        s.tint = scaleColor(0xd8d0c4, 0.75 + 0.2 * (1 - k / drop));
        land.addChild(s);
      }
    }
    // the side wall is only drawn where the tile in front is lower; elsewhere just the top, so the ground looks seamless
    const s = this.atlas.sprite(drop > 0 ? name : name + '_t');
    s.position.set(p.x, top + TH / 2);
    s.tint = scaleColor(tint, light);
    land.addChild(s);
    // winter snow, faded in by season
    const t = this.temp[i] / 255;
    if (b !== Biome.Snow && !this.isRiver(i)) {
      const target = t < 0.33 ? cold : t < 0.5 ? cool : null;
      if (target) {
        const sn = this.atlas.sprite(`snow${Math.floor(hash(x + 5, y) * 4)}${drop > 0 ? '' : '_t'}`);
        sn.position.set(p.x, top + TH / 2);
        target.addChild(sn);
      }
    }
  }

  private placeObjects(x: number, y: number, objs: Container, list: WorldObject[]) {
    const { w } = this.info;
    const i = y * w + x;
    const b = this.biome[i];
    if (isWater(b) || this.isRiver(i)) return;
    const n = hash(x + 11, y + 7);
    const n2 = hash(x + 31, y + 17);
    const t = this.temp[i] / 255;
    // groves and clearings: smooth noise decides how dense the trees are here (0..1)
    const dense = 0.5 + 0.55 * this.clumps.noise(x * 0.11, y * 0.11);
    const add = (name: string, kind: ObjKind, ox: number, oy: number, size = 1) => {
      const p = iso(x, y);
      const s = this.atlas.sprite(name);
      const mul = size * (0.85 + hash(x + ox * 7, y + oy * 3) * 0.3);
      const flip = hash(x * 7 + ox, y) < 0.5 ? -1 : 1;
      const sc = this.atlas.scale(name) * mul;
      s.scale.set(flip * sc, sc);
      s.position.set(p.x + ox, p.y - this.level[i] * ELEV + TH / 2 + oy);
      s.zIndex = s.y;
      objs.addChild(s);
      list.push({ s, i, kind, base: name, n: hash(x + 3, y + 77), size: mul, flip });
    };
    const decid = (k: number) => pick(t < 0.42 ? ['pine0', 'birch0', 'birch1', 'oak1', 'spruce0'] : ['oak0', 'oak1', 'oak2', 'birch0', 'oak0', 'birch1', 'pine1'], k);
    const conifer = (k: number) => pick(['spruce0', 'spruce1', 'spruce0', 'pine0'], k);
    const isConifer = (name: string) => name.startsWith('spruce') || name.startsWith('pine');
    const tree = (name: string, ox: number, oy: number, size = 1) => add(name, isConifer(name) ? 'conifer' : 'decid', ox, oy, size);
    switch (b) {
      // forests: clumps of trees with clearings, not a tree on every tile
      case Biome.Forest:
        if (n < dense - 0.12) tree(decid(n2), (n2 - 0.5) * 10, (hash(x, y + 41) - 0.5) * 4);
        else if (n > 0.93) add(pick(['fern', 'mushroom', 'log', 'stump', 'berries', 'bush0'], (n - 0.93) / 0.07), 'other', (n2 - 0.5) * 8, 2);
        break;
      case Biome.Taiga:
        if (n < dense - 0.05) tree(conifer(n2), (n2 - 0.5) * 10, (hash(x, y + 41) - 0.5) * 4);
        else if (n > 0.95) add(pick(['fern', 'boulder0', 'stump', 'log'], (n - 0.95) / 0.05), 'other', (n2 - 0.5) * 8, 2);
        break;
      case Biome.Grassland:
        if (n < 0.03) tree(pick(['oak0', 'apple', 'sapling', 'oak2', 'birch0'], n / 0.03), 0, 0);
        else if (n < 0.07) add(pick(['bush0', 'bush1', 'berries', 'flowerbush', 'flowers', 'tuft'], (n - 0.03) / 0.04), 'other', (n2 - 0.5) * 10, 0);
        break;
      case Biome.Plains:
        if (n < 0.015) tree('sapling', 0, 0);
        else if (n < 0.05) add(pick(['tuft', 'stones', 'bush1', 'flowers'], (n - 0.015) / 0.035), 'other', (n2 - 0.5) * 10, 0);
        break;
      case Biome.Hills:
        if (n < 0.04) tree(pick(['oak2', 'pine1', 'bush0'], n / 0.04), 0, 0);
        else if (n < 0.08) add(pick(['boulder0', 'boulder1', 'tuft', 'stones'], (n - 0.04) / 0.04), 'other', (n2 - 0.5) * 10, 0);
        break;
      case Biome.Mountain:
        if (n < 0.06) add(pick(['boulder0', 'boulder1', 'boulder2', 'boulder3'], n / 0.06), 'other', (n2 - 0.5) * 8, 0);
        break;
      case Biome.Marsh:
        if (n < 0.2) add('reeds', 'other', (n2 - 0.5) * 12, 0);
        break;
      case Biome.Tundra:
        if (n < 0.07) add(pick(['stones', 'boulder3', 'tuft'], n / 0.07), 'other', (n2 - 0.5) * 8, 0);
        break;
      case Biome.Beach:
        if (n < 0.03) add('stones', 'other', 0, 0, 0.8);
        break;
      default:
    }
  }

  /** trees follow the seasons: bare or snowy in winter, red in autumn, some blossom in spring */
  private applySeason() {
    const m = this.month;
    const key = m === 11 || m <= 1 ? 'winter' : m >= 9 ? 'autumn' : m === 3 || m === 4 ? 'spring' : 'summer';
    if (key === this.seasonKey || !this.info) return;
    this.seasonKey = key;
    for (const list of this.objChunks.values()) {
      for (const o of list) {
        if (o.kind === 'other') continue;
        const t = this.temp[o.i] / 255;
        let name = o.base;
        if (o.kind === 'conifer') {
          if (key === 'winter' && t < 0.5 && o.base.startsWith('spruce')) name = 'spruce_snow';
        } else if (key === 'winter' && t < 0.7) {
          name = t < 0.5 ? 'bare_snow' : 'bare';
        } else if (key === 'autumn' && o.n < 0.3) {
          name = 'autumn';
        } else if (key === 'spring' && o.base.startsWith('oak') && o.n < 0.35) {
          name = 'blossom';
        }
        this.atlas.set(o.s, name, o.size);
        o.s.scale.x *= o.flip;
      }
    }
  }

  private setupWaterFilter() {
    try {
      const f = new Filter({
        glProgram: GlProgram.from({ vertex: WATER_VERT, fragment: WATER_FRAG, name: 'letopis-water' }),
        resources: {
          waterUniforms: {
            uTime: { value: 0, type: 'f32' },
            uCam: { value: new Float32Array([0, 0, 1, 0]), type: 'vec4<f32>' },
          },
        },
      });
      this.waterLayer.filters = [f];
      this.waterFilter = f;
    } catch (e) {
      console.warn('water shader off', e);
    }
  }

  setExplored(bits: Uint8Array) {
    const { w, h } = this.info;
    const n = w * h;
    const next = new Uint8Array(n);
    for (let i = 0; i < n; i++) next[i] = (bits[i >> 3] >> (i & 7)) & 1;
    const nch = Math.ceil(w / CHUNK);
    const dirty = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (next[i] !== this.explored[i] || !this.fogReady) {
        const x = i % w, y = Math.floor(i / w);
        dirty.add(Math.floor(y / CHUNK) * nch + Math.floor(x / CHUNK));
      }
    }
    this.explored = next;
    this.fogReady = true;
    for (const c of dirty) {
      this.drawFog(c);
      this.refreshObjects(c);
    }
  }

  private refreshObjects(chunk: number) {
    for (const o of this.objChunks.get(chunk) ?? []) o.s.visible = !!this.explored[o.i] && !this.cleared.has(o.i);
  }

  /** bands clear the trees around their camp */
  private updateCleared() {
    const { w, h } = this.info;
    const next = new Set<number>();
    for (const c of this.camps.values()) {
      const R = c.settled ? 4 : 2;
      const bx = Math.round(c.tx), by = Math.round(c.ty);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R + 1) continue;
          const x = bx + dx, y = by + dy;
          if (x >= 0 && y >= 0 && x < w && y < h) next.add(y * w + x);
        }
      }
    }
    const nch = Math.ceil(w / CHUNK);
    const dirty = new Set<number>();
    for (const i of next) if (!this.cleared.has(i)) dirty.add(Math.floor(Math.floor(i / w) / CHUNK) * nch + Math.floor((i % w) / CHUNK));
    for (const i of this.cleared) if (!next.has(i)) dirty.add(Math.floor(Math.floor(i / w) / CHUNK) * nch + Math.floor((i % w) / CHUNK));
    this.cleared = next;
    for (const c of dirty) this.refreshObjects(c);
  }

  private drawFog(chunk: number) {
    const { w, h } = this.info;
    const nch = Math.ceil(w / CHUNK);
    const cx = chunk % nch, cy = Math.floor(chunk / nch);
    const g = this.fogChunks.get(chunk)!;
    g.clear();
    for (let d = 0; d <= 2 * (CHUNK - 1); d++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const ly = d - lx;
        if (ly < 0 || ly >= CHUNK) continue;
        const x = cx * CHUNK + lx, y = cy * CHUNK + ly;
        if (x >= w || y >= h) continue;
        const i = y * w + x;
        if (this.explored[i]) continue;
        const L = this.level[i];
        const p = iso(x, y);
        const top = p.y - L * ELEV;
        // cover the tile and, when the tile in front is hidden too, its cliff
        const front = Math.min(this.lv(x + 1, y), this.lv(x, y + 1));
        const frontHidden = (x + 1 >= w || !this.explored[y * w + x + 1]) && (y + 1 >= h || !this.explored[(y + 1) * w + x]);
        const skirt = (frontHidden ? Math.max(0, L - front) * ELEV : 0) + ELEV;
        g.poly([p.x, top - 3, p.x + TW / 2 + 3, top + TH / 2, p.x + TW / 2 + 3, top + TH / 2 + skirt, p.x, top + TH + 3 + skirt, p.x - TW / 2 - 3, top + TH / 2 + skirt, p.x - TW / 2 - 3, top + TH / 2])
          .fill(0x0d1424);
      }
    }
  }

  tileTop(x: number, y: number): { x: number; y: number } {
    const xi = Math.max(0, Math.min(this.info.w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(this.info.h - 1, Math.round(y)));
    const L = this.level[yi * this.info.w + xi];
    const p = iso(x, y);
    return { x: p.x, y: p.y - L * ELEV + TH / 2 };
  }

  tempAt(x: number, y: number): number {
    const xi = Math.max(0, Math.min(this.info.w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(this.info.h - 1, Math.round(y)));
    return this.temp[yi * this.info.w + xi] / 255;
  }

  landAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.info.w || y >= this.info.h) return false;
    return !isWater(this.biome[y * this.info.w + x]);
  }

  // ---------- living things ----------

  updateBands(bands: BandView[], kids: boolean) {
    const seen = new Set<number>();
    for (const b of bands) {
      seen.add(b.id);
      let c = this.camps.get(b.id);
      if (!c) {
        c = new CampSprite(this, b);
        this.camps.set(b.id, c);
      }
      c.update(b, kids);
    }
    for (const [id, c] of this.camps) if (!seen.has(id)) { c.destroy(); this.camps.delete(id); }
    if (this.info) this.updateCleared();
  }

  /** red outline around the chosen person (null clears it) */
  select(id: number | null) {
    if (this.selectedId !== null) this.people.get(this.selectedId)?.setSelected(false);
    this.selectedId = id;
    if (id !== null) this.people.get(id)?.setSelected(true);
  }

  updatePeople(rows: PersonRow[], bandColors: Map<number, number>, tickMs: number) {
    const seen = new Set<number>();
    for (const r of rows) {
      seen.add(r[0]);
      let p = this.people.get(r[0]);
      if (!p) {
        p = new PersonSprite(this, r);
        this.people.set(r[0], p);
        if (r[0] === this.selectedId) p.setSelected(true);
      }
      p.target(r, bandColors.get(r[4]) ?? 0xffffff, tickMs);
    }
    for (const [id, p] of this.people) if (!seen.has(id)) { p.destroy(); this.people.delete(id); }
  }

  /** called every frame */
  frame(dt: number, nowMs: number) {
    this.time += dt / 60;
    if (this.waterFilter) {
      const u = this.waterFilter.resources.waterUniforms.uniforms;
      u.uTime = this.time;
      const s = this.world.scale.x;
      const res = this.app.renderer.resolution;
      const H = this.app.renderer.height;
      // gl_FragCoord has y up
      u.uCam = new Float32Array([this.world.x * res, H - this.world.y * res, s * res, 0]);
    }
    // seasons: snow in winter
    const m = this.month;
    const winter = m === 11 || m <= 1 ? 1 : m === 2 || m === 10 ? 0.45 : 0;
    this.snowCold.alpha = Math.min(1, winter * 1.2);
    this.snowCool.alpha = winter >= 1 ? 0.7 : 0;
    this.snowCold.visible = this.snowCold.alpha > 0;
    this.snowCool.visible = this.snowCool.alpha > 0;
    this.applySeason();
    // a day lasts 8 real minutes, just for the mood
    const day = (nowMs / (8 * 60 * 1000)) % 1;
    const sun = Math.cos(day * Math.PI * 2); // 1 noon, -1 midnight
    const dark = this.night ? Math.max(0, Math.min(0.55, -sun * 0.7 + 0.05)) : 0;
    this.nightOverlay.clear().rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color: 0x0a1030, alpha: dark });
    this.glowLayer.alpha = Math.min(1, dark * 2.2);
    const zoom = this.world.scale.x;
    // draw only the chunks on screen
    const vx = -this.world.x / zoom, vy = -this.world.y / zoom;
    const vw = this.app.screen.width / zoom, vh = this.app.screen.height / zoom;
    for (const c of this.chunkViews) {
      const a = c.area;
      const on = a.x < vx + vw && a.x + a.width > vx && a.y < vy + vh && a.y + a.height > vy;
      for (const part of c.parts) part.visible = on;
    }
    this.peopleLayer.visible = zoom > 0.4;
    this.labelLayer.alpha = 1;
    for (const p of this.people.values()) p.frame(nowMs);
    for (const c of this.camps.values()) c.frame(nowMs, zoom);
  }
}

function scaleColor(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** A person: a base sprite plus the clothes on top, tinted in the colour of the band. */
export class PersonSprite {
  r: WorldRenderer;
  c = new Container();
  body: Sprite;
  cloth: Sprite;
  id: number;
  from = { x: 0, y: 0 };
  to = { x: 0, y: 0 };
  t0 = 0;
  dur = 1;
  seed: number;
  task = 0;
  age = 20;
  female = false;
  pose = '';
  facing = 1;
  outline: Container | null = null;

  constructor(r: WorldRenderer, row: PersonRow) {
    this.r = r;
    this.id = row[0];
    this.seed = hash(row[0], 7) * 1000;
    this.facing = hash(row[0], 13) < 0.5 ? -1 : 1;
    this.body = new Sprite();
    this.cloth = new Sprite();
    this.c.addChild(this.body, this.cloth);
    this.c.eventMode = 'none';
    r.peopleLayer.addChild(this.c);
    const p = r.tileTop(row[1] / 10, row[2] / 10);
    this.from = p;
    this.to = p;
    this.c.position.set(p.x, p.y);
    this.age = row[5];
    this.female = row[6] === 1;
    this.setPose(this.idlePose());
  }

  private setPose(name: string) {
    if (name === this.pose) return;
    this.pose = name;
    this.r.atlas.set(this.body, name);
    this.r.atlas.set(this.cloth, name + '_c');
    this.updateOutline();
  }

  /** a red outline: the silhouette drawn in red, shifted in 8 directions behind the person */
  setSelected(on: boolean) {
    if (on && !this.outline) {
      this.outline = new Container();
      for (let k = 0; k < 8; k++) this.outline.addChild(new Sprite(), new Sprite());
      this.c.addChildAt(this.outline, 0);
      this.updateOutline();
    } else if (!on && this.outline) {
      this.outline.destroy({ children: true });
      this.outline = null;
    }
  }

  private updateOutline() {
    if (!this.outline) return;
    const d = 0.8 / Math.max(0.4, Math.abs(this.c.scale.y));
    this.outline.children.forEach((ch, j) => {
      const sp = ch as Sprite;
      const k = j >> 1;
      const a = (k / 8) * Math.PI * 2;
      this.r.atlas.set(sp, j & 1 ? this.pose + '_c' : this.pose);
      sp.tint = 0xff2a2a;
      sp.position.set(Math.cos(a) * d, Math.sin(a) * d);
    });
  }

  /** a stable pick per person, so the pose does not flicker */
  private choose(list: string[], salt: number): string {
    return list[Math.floor(hash(this.id, salt) * list.length)];
  }

  private idlePose(): string {
    const task = TASKS[this.task];
    if (this.age < 12) {
      return this.female
        ? this.choose(['girl', 'girl', 'kidberries', 'kidwave', 'kidpuppy'], 31)
        : this.choose(['boy', 'boy', 'kidtoy', 'kidstick', 'kidfish', 'kidpuppy'], 31);
    }
    if (this.age > 55 || task === 'elder') {
      if (!this.female) return 'elder';
      if (task === 'gather' || task === 'farm') return 'oldbasket';
      if (task === 'craft') return 'oldherbs';
      return this.choose(['oldwoman', 'oldscarf', 'oldwoman'], 33);
    }
    switch (task) {
      case 'gather': case 'farm': return 'gatherer';
      case 'hunt': case 'herd': return 'hunter';
      case 'fish': return this.female ? 'waterjar' : 'hunter';
      case 'craft': return this.female ? this.choose(['potter', 'spinner'], 35) : 'carrier';
      case 'build': return this.female ? 'reedcarrier' : 'carrier';
      default: return this.female ? this.choose(['woman', 'woman2', 'woman', 'waterjar'], 37) : hash(this.id, 21) < 0.15 ? 'wave' : 'man';
    }
  }

  private walkPose(now: number): string | null {
    const f = Math.floor(now / 140 + this.seed) % 4;
    if (this.age < 12) return `${this.female ? 'girlwalk' : 'boywalk'}${f}`;
    if (this.age > 55) return this.female ? `oldwalk${f}` : null;
    return `${this.female ? 'womanwalk' : 'walk'}${f}`;
  }

  target(row: PersonRow, color: number, tickMs: number) {
    const p = this.r.tileTop(row[1] / 10, row[2] / 10);
    this.from = { x: this.c.x, y: this.c.y };
    this.to = p;
    this.t0 = performance.now();
    this.dur = Math.max(400, Math.min(tickMs * 0.85, 12000));
    this.cloth.tint = color;
    this.age = row[5];
    this.female = row[6] === 1;
    const s = this.age < 12 ? 0.75 + this.age * 0.02 : this.age > 60 ? 0.95 : 1;
    this.c.scale.set(this.facing * s, s);
    this.task = row[3];
    if (Math.abs(this.to.x - this.from.x) > 1) this.facing = this.to.x < this.from.x ? -1 : 1;
  }

  frame(now: number) {
    const k = Math.min(1, (performance.now() - this.t0) / this.dur);
    const e = k * k * (3 - 2 * k);
    let x = this.from.x + (this.to.x - this.from.x) * e;
    let y = this.from.y + (this.to.y - this.from.y) * e;
    const dist = Math.abs(this.to.x - this.from.x) + Math.abs(this.to.y - this.from.y);
    const walking = k < 0.95 && dist > 3;
    let bob = 0;
    const walk = walking ? this.walkPose(now) : null;
    if (walk) {
      this.setPose(walk);
    } else {
      this.setPose(this.idlePose());
      if (walking) bob = -Math.abs(Math.sin(now / 110 + this.seed)) * 1.2;
    }
    // small idle movement so the camp feels alive
    const task = TASKS[this.task];
    if (k >= 1 && task !== 'rest') {
      const a = now / 1400 + this.seed;
      const amp = task === 'child' ? 4 : 1.5;
      x += Math.sin(a) * amp;
      y += Math.cos(a * 1.3) * amp * 0.5;
    }
    const s = Math.abs(this.c.scale.y);
    this.c.scale.x = this.facing * s;
    this.c.position.set(x, y + bob);
    this.c.zIndex = y;
  }

  destroy() {
    this.c.destroy({ children: true });
  }
}

// Props a band shows in its camp once it knows the matching technology.
const PROPS: [string, string, boolean | null][] = [
  // [tech, sprite, settled only (true) / camps only (false) / both (null)]
  ['fire', 'logpile', null],
  ['clothing', 'hiderack', false],
  ['cave_art', 'totem', null],
  ['burial', 'cairn', false],
  ['burial', 'shrine', true],
  ['pottery', 'pots', null],
  ['grinding', 'quern', null],
  ['pottery', 'kiln', true],
  ['herding', 'pen', null],
  ['fishing', 'fishtrap', null],
  ['boats', 'canoe', null],
  ['agriculture', 'granary', true],
  ['agriculture', 'haystack', true],
  ['mudbrick', 'well', true],
  ['weaving', 'basket', null],
];

export class CampSprite {
  r: WorldRenderer;
  c = new Container();
  label: Text;
  glow: Sprite;
  hearth: Sprite;
  homes: Container = new Container();
  fields: Container = new Container();
  ground: Sprite;
  banner = new Container();
  bannerCloth: Sprite;
  symbol: Sprite;
  tag = new Container();
  tagBg = new Graphics();
  tagText = '';
  id: number;
  key = '';
  fieldKey = '';
  pos = { x: 0, y: 0 };
  tx = 0;
  ty = 0;
  settled = false;
  hasFire = false;
  fireFrame = -1;

  constructor(r: WorldRenderer, b: BandView) {
    this.r = r;
    this.id = b.id;
    const A = r.atlas;
    this.glow = new Sprite(r.tex.glow);
    this.glow.anchor.set(0.5);
    this.label = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, fontWeight: '600' },
      resolution: 2,
    });
    this.label.anchor.set(0.5, 1);
    // worn ground, a stone hearth and a banner in the colour of the band: easy to spot even without fire
    this.ground = new Sprite(r.tex.ground);
    this.ground.anchor.set(0.5);
    this.ground.y = 3;
    this.hearth = A.sprite('hearth0');
    this.hearth.y = 2;
    const pole = A.sprite('banner');
    this.bannerCloth = A.sprite('banner_c');
    this.symbol = A.sprite(`sym${bandSymbol(b.name, b.id)}`);
    const bh = A.frames.banner.h * A.scale('banner');
    this.symbol.scale.set(4.6 / A.frames.sym0.w);
    this.symbol.position.set(0, -bh * 0.5);
    this.symbol.tint = 0x1c140c;
    this.symbol.alpha = 0.85;
    this.banner.addChild(pole, this.bannerCloth, this.symbol);
    this.banner.position.set(-13, 0);
    this.homes.sortableChildren = true;
    this.c.addChild(this.ground, this.fields, this.homes);
    this.homes.addChild(this.hearth, this.banner);
    this.hearth.zIndex = 2;
    this.banner.zIndex = 0;
    r.campLayer.addChild(this.c);
    r.glowLayer.addChild(this.glow);
    this.tag.addChild(this.tagBg, this.label);
    r.labelLayer.addChild(this.tag);
  }

  update(b: BandView, kids: boolean) {
    const p = this.r.tileTop(b.x, b.y);
    this.pos = p;
    this.tx = b.x;
    this.ty = b.y;
    this.settled = b.settled;
    this.hasFire = b.hasFire;
    this.c.position.set(p.x, p.y);
    this.glow.position.set(p.x, p.y - 4);
    this.glow.visible = b.hasFire || b.dwelling === 'house';
    this.label.text = b.settlementName ? `${b.settlementName} (${b.size})` : `${b.name.replace('Родът на ', '')} (${b.size})`;
    this.label.style.fontSize = kids ? 16 : 12;
    this.bannerCloth.tint = b.color;
    this.tag.position.set(p.x, p.y - 30);
    if (this.label.text !== this.tagText) {
      this.tagText = this.label.text;
      const w = this.label.width + 14, h = this.label.height + 4;
      this.tagBg.clear()
        .roundRect(-w / 2, -h, w, h, h / 2).fill({ color: 0x101626, alpha: 0.78 })
        .roundRect(-w / 2, -h, w, h, h / 2).stroke({ color: b.color, width: 2 })
        .poly([-4, 0, 4, 0, 0, 5]).fill(b.color);
      this.label.position.set(0, -2);
    }
    this.updateFields(b);
    const n = Math.max(1, Math.min(10, Math.round(b.size / (b.dwelling === 'house' ? 6 : 5))));
    const techs = new Set(b.techs);
    const props = PROPS.filter(([tech, , settled]) => techs.has(tech) && (settled === null || settled === b.settled)).map(([, s]) => s);
    const cold = this.r.tempAt(b.x, b.y) < 0.35;
    const key = `${b.dwelling}:${n}:${b.settled}:${cold}:${props.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    const A = this.r.atlas;
    for (const ch of [...this.homes.children]) {
      if (ch !== this.hearth && ch !== this.banner) ch.destroy();
    }
    for (let k = 0; k < n; k++) {
      const h = hash(this.id, k + 40);
      let name: string;
      switch (b.dwelling) {
        case 'none': name = 'furbed'; break;
        case 'tent': name = cold && h < 0.5 ? 'bonehut' : h < 0.2 ? 'leanto' : `tent${k % 2}`; break;
        case 'hut': name = 'roundhut'; break;
        default: name = k % 3 === 2 ? 'longhouse' : 'house';
      }
      const a = (k / n) * Math.PI * 2 + 0.6;
      const rad = (b.dwelling === 'house' ? 26 : 19) + (k % 2) * 7;
      const s = A.sprite(name);
      if (h < 0.5) s.scale.x *= -1;
      s.position.set(Math.cos(a) * rad, Math.sin(a) * rad * 0.5 + 2);
      s.zIndex = s.y;
      this.homes.addChild(s);
    }
    // camp props in an outer ring
    props.forEach((name, k) => {
      const a = (k / Math.max(5, props.length)) * Math.PI * 2 + 2.1;
      const rad = (b.dwelling === 'house' ? 40 : 32) + (k % 2) * 5;
      const s = A.sprite(name);
      s.position.set(Math.cos(a) * rad, Math.sin(a) * rad * 0.5 + 2);
      s.zIndex = s.y;
      this.homes.addChild(s);
    });
    this.banner.zIndex = this.banner.y;
  }

  /** farmed tiles around a village: soil in spring, wheat in summer, stubble after the harvest */
  private updateFields(b: BandView) {
    const m = this.r.month;
    const count = b.settled && b.techs.includes('agriculture') ? Math.min(10, 2 + Math.floor(b.size / 10)) : 0;
    const stage = m >= 5 && m <= 7 ? 'wheat' : m >= 2 && m <= 4 ? 'sprout' : 'soil';
    const bx = Math.round(b.x), by = Math.round(b.y);
    const fkey = `${bx}:${by}:${count}:${stage}`;
    if (fkey === this.fieldKey) return;
    this.fieldKey = fkey;
    this.fields.removeChildren().forEach((c) => c.destroy());
    if (!count) return;
    const A = this.r.atlas;
    const ring: [number, number][] = [[3, 0], [0, 3], [3, 1], [1, 3], [3, -1], [-1, 3], [4, 0], [0, 4], [4, 1], [1, 4], [-3, 0], [0, -3]];
    let placed = 0;
    for (const [dx, dy] of ring) {
      if (placed >= count) break;
      const x = bx + dx, y = by + dy;
      if (!this.r.landAt(x, y)) continue;
      const h = hash(x, y + 101);
      const name = stage === 'wheat' ? `wheat${Math.floor(h * 4)}` : stage === 'sprout' ? `soil${2 + Math.floor(h * 2)}` : `soil${Math.floor(h * 2)}`;
      const s = A.sprite(name + '_t');
      const p = this.r.tileTop(x, y);
      s.position.set(p.x - this.pos.x, p.y - this.pos.y);
      this.fields.addChild(s);
      placed++;
    }
    // fields drawn back to front
    this.fields.children.sort((a, c) => a.y - c.y);
  }

  frame(now: number, zoom: number) {
    const frameNo = this.hasFire ? 1 + (Math.floor(now / 130 + this.id * 7) % 3) : 0;
    if (frameNo !== this.fireFrame) {
      this.fireFrame = frameNo;
      this.r.atlas.set(this.hearth, `hearth${frameNo}`);
    }
    if (this.hasFire) this.glow.scale.set(0.95 + Math.sin(now / 90 + this.id) * 0.06);
    this.bannerCloth.skew.y = Math.sin(now / 500 + this.id) * 0.05;
    this.symbol.skew.y = this.bannerCloth.skew.y;
    this.tag.scale.set(1 / Math.max(0.3, Math.min(2, zoom)));
  }

  destroy() {
    this.c.destroy({ children: true });
    this.glow.destroy();
    this.tag.destroy({ children: true });
  }
}
