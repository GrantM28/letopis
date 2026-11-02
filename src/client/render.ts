import {
  AlphaFilter, Application, BlurFilter, Container, Filter, GlProgram, Graphics, ImageSource, Rectangle, Sprite, Text, Texture,
} from 'pixi.js';
import { Simplex } from '../shared/noise';
import { Fauna } from './animals';
import { SECRET_KINDS, SecretSpot, secretSpots } from '../shared/secrets';
import { B, VILLAGE } from './lang';
import { Rng } from '../shared/rng';
import { CONIFERS, TREE_KINDS } from '../shared/trees';
import { BandView, Biome, PersonRow, TASKS, WorldInfo, b64decode, isWater, RIVER_WATER } from '../shared/types';

export const TW = 32; // tile width
export const TH = 16; // tile height
export const ELEV = 5;
type Role = 'guard' | 'bodyguard' | 'teller' | 'listener';
/** most people of one band drawn on the map */
const PER_BAND = 36; // pixels per height level
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

interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; s: number; p?: number }

export class Atlas {
  tex: Record<string, Texture> = {};
  frames: Record<string, Frame> = {};

  static async load(base: string, version = ''): Promise<Atlas> {
    const a = new Atlas();
    const v = version ? `?v=${version}` : '';
    const meta = await fetch(`${base}/atlas.json${v}`).then((r) => r.json());
    const files: string[] = meta.pages ? meta.pages.map((p: { file: string }) => p.file) : ['atlas.png'];
    const sources = await Promise.all(files.map(async (file) => {
      const blob = await fetch(`${base}/${file}${v}`).then((r) => r.blob());
      // WebGL ignores its premultiply flag for ImageBitmaps, so premultiply here and tell Pixi it is done;
      // otherwise half-transparent edges are drawn too bright (light halos around every sprite)
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
      return new ImageSource({
        resource: bitmap,
        alphaMode: 'premultiplied-alpha',
        autoGenerateMipmaps: true,
        scaleMode: 'linear',
        mipmapFilter: 'linear',
        maxAnisotropy: 4,
      });
    }));
    a.frames = meta.frames;
    for (const [name, f] of Object.entries(a.frames)) {
      a.tex[name] = new Texture({ source: sources[f.p ?? 0], frame: new Rectangle(f.x, f.y, f.w, f.h) });
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
    if (!f) return; // a missing frame must never stop the drawing
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

type ObjKind = 'tree' | 'other';
/** tk: kind of tree (TREE_KINDS) for the trees the simulation grows */
interface WorldObject { s: Sprite; i: number; kind: ObjKind; base: string; n: number; size: number; flip: number; tk?: number; stump?: WorldObject; isStump?: boolean }

export class WorldRenderer {
  app: Application;
  atlas: Atlas;
  world = new Container(); // camera moves this
  terrainLayer = new Container();
  waterLayer = new Container();
  snowLayer = new Container();
  objLayer = new Container();
  /** roads, drawn over the ground (inside the terrain layer) */
  roadLayer = new Container();
  roads = new Uint8Array(0);
  roadSprites = new Map<number, Sprite>();
  roadVersion = 0;
  /** what every band knows (tech ids), for the work people show */
  bandTech = new Map<number, Set<string>>();
  fogLayer = new Container();
  campLayer = new Container();
  peopleLayer = new Container();
  glowLayer = new Container();
  labelLayer = new Container();
  /** the night veil: a small 2D canvas (a quarter of the screen) stretched over everything */
  nightCanvas = document.createElement('canvas');
  nightSprite!: Sprite;
  nightAt = 0;
  /** zoomed far out: the whole map is one ready picture instead of tens of thousands of sprites */
  farLayer = new Container();
  farSprite: Sprite | null = null;
  farKey = '';
  farAt = 0;
  far = false;
  info!: WorldInfo;
  level!: Uint8Array;
  biome!: Uint8Array;
  river!: Uint8Array;
  temp!: Uint8Array;
  explored: Uint8Array = new Uint8Array(0);
  cleared = new Set<number>();
  /** what tree can grow on each tile and how big it is now (from the server) */
  treeKind: Uint8Array = new Uint8Array(0);
  treeStage: Uint8Array = new Uint8Array(0);
  treeObjs = new Map<number, WorldObject>();
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
  lastPeople: { rows: PersonRow[]; bandColors: Map<number, number>; tickMs: number } | null = null;
  camps = new Map<number, CampSprite>();
  fauna = new Fauna(this);
  /** the 100 hidden secrets: tiny, half see-through, buried by snow in winter */
  secrets: { spot: SecretSpot; s: Sprite; i: number; found: boolean }[] = [];
  tex!: Record<string, Texture>;
  time = 0;
  month = 0;
  seasonKey = '';
  zoom = 1;
  night = true;
  /** zoomed out to half or less: no animations */
  still = false;
  /** it is night right now (updated every frame) */
  nightNow = false;

  constructor(app: Application, atlas: Atlas) {
    this.app = app;
    this.atlas = atlas;
    this.world.addChild(this.farLayer, this.waterLayer, this.terrainLayer, this.snowLayer, this.objLayer, this.campLayer, this.peopleLayer, this.fogLayer, this.glowLayer, this.labelLayer);
    this.nightCanvas.width = 8;
    this.nightCanvas.height = 8;
    this.nightSprite = new Sprite(Texture.from(this.nightCanvas));
    this.nightSprite.eventMode = 'none';
    app.stage.addChild(this.world, this.nightSprite);
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
      // gold star over the heads of those who lived to 70
      star: g((x) => {
        x.star(8, 8, 5, 7, 3).fill(0xffd34d).stroke({ color: 0x6b4a10, width: 1.2 });
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
    this.treeKind = info.treeKinds ? b64decode(info.treeKinds) : new Uint8Array(info.w * info.h);
    this.treeStage = new Uint8Array(info.w * info.h);
    this.treeObjs.clear();
    this.cleared.clear();
    for (const l of [this.terrainLayer, this.waterLayer, this.snowCold, this.snowCool, this.fogLayer, this.objLayer]) l.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.fogChunks.clear();
    this.objChunks.clear();
    this.chunkViews = [];
    this.fogReady = false;
    this.seasonKey = '';
    this.buildTerrain();
    this.roads = new Uint8Array(info.w * info.h);
    this.roadSprites.clear();
    this.roadLayer = new Container();
    this.terrainLayer.addChild(this.roadLayer);
    this.setupWaterFilter();
  }

  private lv(x: number, y: number): number {
    const { w, h } = this.info;
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return this.level[y * w + x];
  }

  /** small streams stay hidden; from a real river on, the tile is water */
  private isRiver(i: number): boolean {
    return this.river[i] >= RIVER_WATER && !isWater(this.biome[i]);
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
    // trees: where they can grow comes from the server, their size from every tick
    const tk = this.treeKind[i];
    if (tk) {
      const forest = b === Biome.Forest || b === Biome.Taiga;
      const ox = forest ? (n2 - 0.5) * 10 : 0, oy = forest ? (hash(x, y + 41) - 0.5) * 4 : 0;
      const name = `g_${TREE_KINDS[tk]}3`;
      if (this.atlas.has(name)) {
        add(name, 'tree', ox, oy);
        const o = list[list.length - 1];
        o.tk = tk;
        o.s.visible = false;
        this.treeObjs.set(i, o);
        // the stump left when the tree is cut (old and grey, or fresh with chips)
        const kind = TREE_KINDS[tk];
        const sk = kind === 'birch' ? 'birch' : kind === 'oakOld' ? 'old' : CONIFERS.has(tk) ? 'pine' : 'oak';
        const sn = `stump_${sk}${hash(x + 2, y + 13) < 0.5 ? 0 : 1}`;
        if (this.atlas.has(sn)) {
          add(sn, 'other', ox, oy);
          const st = list[list.length - 1];
          st.isStump = true;
          st.s.visible = false;
          o.stump = st;
        }
      }
      return;
    }
    void dense;
    switch (b) {
      case Biome.Forest:
        if (n > 0.93) add(pick(['fern', 'mushroom', 'log', 'stump', 'berries', 'bush0'], (n - 0.93) / 0.07), 'other', (n2 - 0.5) * 8, 2);
        break;
      case Biome.Taiga:
        if (n > 0.95) add(pick(['fern', 'boulder0', 'stump', 'log'], (n - 0.95) / 0.05), 'other', (n2 - 0.5) * 8, 2);
        break;
      case Biome.Grassland:
        if (n >= 0.03 && n < 0.07) add(pick(['bush0', 'bush1', 'berries', 'flowerbush', 'flowers', 'tuft'], (n - 0.03) / 0.04), 'other', (n2 - 0.5) * 10, 0);
        break;
      case Biome.Plains:
        if (n >= 0.015 && n < 0.05) add(pick(['tuft', 'stones', 'bush1', 'flowers'], (n - 0.015) / 0.035), 'other', (n2 - 0.5) * 10, 0);
        break;
      case Biome.Hills:
        if (n >= 0.04 && n < 0.08) add(pick(['boulder0', 'boulder1', 'tuft', 'stones'], (n - 0.04) / 0.04), 'other', (n2 - 0.5) * 10, 0);
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

  /** the sprite of a tree for its size and the season: bare or snowy in winter, red or yellow in autumn, blossom in spring */
  private treeName(o: WorldObject): string {
    const stage = Math.max(1, this.treeStage[o.i]);
    const kind = TREE_KINDS[o.tk!];
    const key = this.seasonKey;
    const t = this.temp[o.i] / 255;
    let k: string = kind;
    if (CONIFERS.has(o.tk!)) {
      if (key === 'winter' && t < 0.5 && kind.startsWith('spruce')) k = 'spruceS';
    } else if (key === 'winter' && t < 0.7) {
      k = t < 0.5 ? 'bareS' : 'bare';
    } else if (key === 'autumn') {
      if (kind === 'birch') k = o.n < 0.7 ? 'birchY' : kind;
      else if (kind === 'fruit') k = 'apple';
      else if (o.n < 0.35) k = 'autumn';
    } else if (key === 'spring' && (kind === 'oak' || kind === 'oakL' || kind === 'fruit') && o.n < 0.35) {
      k = 'blossom';
    }
    return `g_${k}${stage - 1}`;
  }

  private drawTree(o: WorldObject) {
    this.atlas.set(o.s, this.treeName(o), o.size);
    o.s.scale.x *= o.flip;
    o.s.visible = !!this.explored[o.i] && this.treeStage[o.i] > 0;
    if (o.stump) o.stump.s.visible = this.stumpVisible(o.i);
  }

  private stumpVisible(i: number): boolean {
    return !!this.explored[i] && this.treeStage[i] === 0 && !this.cleared.has(i);
  }

  /** all the roads at once (snapshot) */
  setRoads(b64: string) {
    if (!this.info) return;
    const r = b64decode(b64);
    if (r.length !== this.roads.length) return;
    const ch: number[] = [];
    for (let i = 0; i < r.length; i++) if (r[i] !== this.roads[i]) ch.push(i, r[i]);
    this.updateRoads(ch);
  }

  /** roads built since the last tick: [tile, level, ...]; the tile and its neighbours are redrawn */
  updateRoads(ch: number[]) {
    if (!this.info || !ch.length) return;
    const { w, h } = this.info;
    const redo = new Set<number>();
    for (let k = 0; k + 1 < ch.length; k += 2) {
      const i = ch[k];
      this.roads[i] = ch[k + 1];
      redo.add(i);
      const x = i % w, y = (i - x) / w;
      if (x > 0) redo.add(i - 1);
      if (x < w - 1) redo.add(i + 1);
      if (y > 0) redo.add(i - w);
      if (y < h - 1) redo.add(i + w);
    }
    for (const i of redo) this.drawRoad(i);
    // bushes and stones do not stand on a road
    for (const list of this.objChunks.values()) for (const o of list) if (o.kind === 'other' && !o.isStump && this.roads[o.i]) o.s.visible = false;
    // keep the road sprites in drawing order (back to front)
    this.roadLayer.children.sort((a, b) => a.y - b.y);
    this.roadVersion++;
  }

  private drawRoad(i: number) {
    const { w } = this.info;
    const lvl = this.roads[i];
    const old = this.roadSprites.get(i);
    if (!lvl) { if (old) { old.destroy(); this.roadSprites.delete(i); } return; }
    const x = i % w, y = (i - x) / w;
    const has = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < this.info.h && this.roads[yy * w + xx] > 0;
    // 1 upper-left (-x), 2 upper-right (-y), 4 lower-right (+x), 8 lower-left (+y)
    const mask = (has(x - 1, y) ? 1 : 0) | (has(x, y - 1) ? 2 : 0) | (has(x + 1, y) ? 4 : 0) | (has(x, y + 1) ? 8 : 0);
    let name = `road${lvl}_${mask || 5}`;
    let flip = false;
    if (this.isRiver(i)) {
      name = `bridge${lvl}`;
      flip = (mask & 10) === 0; // the drawn bridge goes along y; along x it is mirrored
    }
    if (!this.atlas.has(name)) return;
    const s = old ?? this.atlas.sprite(name);
    if (old) this.atlas.set(s, name);
    if (flip) s.scale.x = -Math.abs(s.scale.x);
    const p = iso(x, y);
    s.position.set(p.x, p.y - this.level[i] * ELEV + TH / 2);
    if (!old) { this.roadLayer.addChild(s); this.roadSprites.set(i, s); }
  }

  /** all the trees at once (snapshot), base64 bytes 0..4 */
  setTrees(b64: string) {
    if (!this.info) return;
    this.treeStage = b64decode(b64);
    for (const o of this.treeObjs.values()) this.drawTree(o);
  }

  /** trees that grew or were cut this month: [tile, stage, ...] */
  updateTrees(ch: number[]) {
    for (let k = 0; k + 1 < ch.length; k += 2) {
      const i = ch[k];
      this.treeStage[i] = ch[k + 1];
      const o = this.treeObjs.get(i);
      if (o) this.drawTree(o);
    }
  }

  private applySeason() {
    const m = this.month;
    const key = m === 11 || m <= 1 ? 'winter' : m >= 9 ? 'autumn' : m === 3 || m === 4 ? 'spring' : 'summer';
    if (key === this.seasonKey || !this.info) return;
    this.seasonKey = key;
    for (const o of this.treeObjs.values()) this.drawTree(o);
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
    for (const o of this.objChunks.get(chunk) ?? []) {
      o.s.visible = o.isStump ? this.stumpVisible(o.i) : !!this.explored[o.i] && (o.tk ? this.treeStage[o.i] > 0 : !this.cleared.has(o.i));
    }
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

  setSecrets(found: number[]) {
    for (const x of this.secrets) x.s.destroy();
    const have = new Set(found);
    this.secrets = secretSpots(this.info.seed, this.info.w, this.info.h, this.biome, this.river).map((spot) => {
      const s = this.atlas.sprite(`sec_${SECRET_KINDS[spot.kind].id}0`);
      const p = this.tileTop(spot.x, spot.y);
      s.position.set(p.x, p.y);
      s.zIndex = p.y;
      s.eventMode = 'none';
      s.visible = false;
      this.peopleLayer.addChild(s);
      return { spot, s, i: Math.round(spot.y) * this.info.w + Math.round(spot.x), found: have.has(spot.k) };
    });
  }

  markSecret(k: number) {
    const x = this.secrets.find((q) => q.spot.k === k);
    if (x) x.found = true;
  }

  /** a secret under the click (world coordinates), if one shows there */
  pickSecret(wx: number, wy: number): SecretSpot | null {
    for (const x of this.secrets) {
      if (!x.s.visible || x.s.alpha < 0.25) continue;
      if (Math.hypot(x.s.x - wx, x.s.y - 2.75 - wy) < 5) return x.spot;
    }
    return null;
  }

  private secretFrame(nowMs: number, zoom: number, winter: number) {
    for (const x of this.secrets) {
      const on = zoom > 0.75 && this.explored[x.i] === 1;
      x.s.visible = on;
      if (!on) continue;
      // snow covers them on cold ground, the same way it covers the tiles
      const t = this.temp[x.i] / 255;
      const snow = t < 0.33 ? Math.min(1, winter * 1.2) : t < 0.5 && winter >= 1 ? 0.7 : 0;
      x.s.alpha = (x.found ? 0.95 : 0.6) * (1 - snow * 0.97);
      const id = SECRET_KINDS[x.spot.kind].id;
      const f = Math.floor(nowMs / 1600 + x.spot.k * 0.37) % 2;
      this.atlas.set(x.s, `sec_${id}${f}`);
    }
  }

  /** dry land people can walk on (water and wide rivers block them) */
  walkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.info.w || y >= this.info.h) return false;
    const i = y * this.info.w + x;
    return !isWater(this.biome[i]) && this.river[i] < RIVER_WATER;
  }

  /** a walk around the water from one tile to another, as tile points; null if there is none nearby */
  landPath(ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] | null {
    const sx = Math.round(ax), sy = Math.round(ay), tx = Math.round(bx), ty = Math.round(by);
    if (!this.walkable(sx, sy) || !this.walkable(tx, ty)) return null;
    const pad = 14;
    const x0 = Math.min(sx, tx) - pad, y0 = Math.min(sy, ty) - pad;
    const bw = Math.abs(sx - tx) + pad * 2 + 1, bh = Math.abs(sy - ty) + pad * 2 + 1;
    const prev = new Int32Array(bw * bh).fill(-2);
    const key = (x: number, y: number) => (y - y0) * bw + (x - x0);
    const start = key(sx, sy), goal = key(tx, ty);
    prev[start] = -1;
    const queue = [start];
    for (let q = 0; q < queue.length && prev[goal] === -2; q++) {
      const k = queue[q];
      const x = (k % bw) + x0, y = Math.floor(k / bw) + y0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || ny < y0 || nx >= x0 + bw || ny >= y0 + bh) continue;
        const nk = key(nx, ny);
        if (prev[nk] !== -2 || !this.walkable(nx, ny)) continue;
        prev[nk] = k;
        queue.push(nk);
      }
    }
    if (prev[goal] === -2) return null;
    const tiles: { x: number; y: number }[] = [];
    for (let k = goal; k !== -1; k = prev[k]) tiles.push({ x: (k % bw) + x0, y: Math.floor(k / bw) + y0 });
    tiles.reverse();
    // straighten: keep only the corners needed to stay on land
    const out = [{ x: ax, y: ay }];
    let from = out[0];
    for (let i = 1; i < tiles.length; i++) {
      if (!this.dryLine(from.x, from.y, tiles[i].x, tiles[i].y)) {
        from = tiles[i - 1];
        out.push(from);
      }
    }
    out.push({ x: bx, y: by });
    return out;
  }

  /** does a straight walk stay on dry land? */
  dryLine(ax: number, ay: number, bx: number, by: number): boolean {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 4) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.walkable(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t))) return false;
    }
    return true;
  }

  /** height level of a tile (0 outside the map) */
  levelAt(x: number, y: number): number {
    return this.lv(Math.round(x), Math.round(y));
  }

  landAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.info.w || y >= this.info.h) return false;
    return !isWater(this.biome[y * this.info.w + x]);
  }

  // ---------- living things ----------

  updateBands(bands: BandView[], kids: boolean) {
    const seen = new Set<number>();
    this.bandTech.clear();
    for (const b of bands) {
      seen.add(b.id);
      this.bandTech.set(b.id, new Set(b.techIds));
      let c = this.camps.get(b.id);
      if (!c) {
        c = new CampSprite(this, b);
        this.camps.set(b.id, c);
      }
      c.update(b, kids);
    }
    for (const [id, c] of this.camps) if (!seen.has(id)) { c.destroy(); this.camps.delete(id); }
    if (this.info) this.updateCleared();
    this.fauna.updateBands(bands);
  }

  /** red outline around the chosen person (null clears it) */
  select(id: number | null) {
    if (this.selectedId !== null) this.people.get(this.selectedId)?.setSelected(false);
    this.selectedId = id;
    // someone who was at home (not drawn) steps out
    if (id !== null && !this.people.has(id) && this.lastPeople) {
      const { rows, bandColors, tickMs } = this.lastPeople;
      this.updatePeople(rows, bandColors, tickMs);
    }
    if (id !== null) this.people.get(id)?.setSelected(true);
  }

  /** dark hours of the 8 minute day (same clock as the night shade) */
  isNight(nowMs = Date.now()): boolean {
    const day = (nowMs / (8 * 60 * 1000)) % 1;
    return Math.cos(day * Math.PI * 2) < -0.25;
  }

  /** at night everyone sleeps within two tiles of the camp (a scout stays where he is) */
  private nightRow(r: PersonRow): PersonRow {
    const c = this.camps.get(r[4]);
    if (!c || TASKS[r[3]] === 'scout') return r;
    // everyone has the same sleeping spot all night: nobody gets up to walk to where the day's work would be
    // spread around the fire, the same spot every night for the same person
    const a = hash(r[0], 5) * Math.PI * 2, rr = 0.6 + hash(r[0], 9) * 1.3;
    let nx = c.tx + Math.cos(a) * rr, ny = c.ty + Math.sin(a) * rr;
    if (!this.walkable(Math.round(nx), Math.round(ny))) { nx = c.tx + (hash(r[0], 2) - 0.5) * 0.6; ny = c.ty + (hash(r[0], 4) - 0.5) * 0.6; }
    const out = [...r] as PersonRow;
    out[1] = Math.round(nx * 10);
    out[2] = Math.round(ny * 10);
    return out;
  }

  updatePeople(rows: PersonRow[], bandColors: Map<number, number>, tickMs: number) {
    this.lastPeople = { rows, bandColors, tickMs };
    const seen = new Set<number>();
    const night = this.isNight();
    // a big village shows at most PER_BAND people on the map (the chief, the chosen one and a steady sample):
    // the rest are at home. Thousands of sprites less, and no crowd piled on the camp
    const byBand = new Map<number, PersonRow[]>();
    for (const r of rows) {
      let l = byBand.get(r[4]);
      if (!l) byBand.set(r[4], (l = []));
      l.push(r);
    }
    const roles = this.roles(rows, byBand);
    const shown: PersonRow[] = [];
    for (const l of byBand.values()) {
      if (l.length <= PER_BAND) { shown.push(...l); continue; }
      const rank = (r: PersonRow) => (r[7] === 1 || r[0] === this.selectedId || roles.has(r[0]) ? -1 : hash(r[0], 99));
      l.sort((a, b) => rank(a) - rank(b));
      shown.push(...l.slice(0, PER_BAND));
    }
    for (const r0 of shown) {
      let r = night ? this.nightRow(r0) : r0;
      // the bodyguard keeps close to the chief while he looks for a new place
      if (roles.get(r0[0]) === 'bodyguard') {
        const chief = byBand.get(r0[4])?.find((q) => q[7] === 1);
        if (chief) {
          r = [...r] as PersonRow;
          r[1] = chief[1] + 6;
          r[2] = chief[2] + 4;
        }
      }
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
    for (const [id, p] of this.people) p.role = roles.get(id) ?? null;
  }

  /** who does what beyond the day's work: two guards in every band (one walks with the chief when he scouts),
   *  an old man of 70+ who tells stories and the child who listens */
  private roles(rows: PersonRow[], byBand: Map<number, PersonRow[]>): Map<number, Role> {
    const out = new Map<number, Role>();
    for (const l of byBand.values()) {
      const chief = l.find((r) => r[7] === 1);
      const scouting = !!chief && TASKS[chief[3]] === 'scout';
      const men = l.filter((r) => r[6] === 0 && r[7] !== 1 && r[5] >= 18 && r[5] < 50 && TASKS[r[3]] !== 'scout').sort((a, b) => a[0] - b[0]);
      const n = l.length >= 8 ? 2 : 1;
      men.slice(0, n).forEach((r, k) => out.set(r[0], scouting && n === 2 && k === 1 ? 'bodyguard' : 'guard'));
      const teller = l.find((r) => r[6] === 0 && r[5] >= 70 && TASKS[r[3]] !== 'scout');
      if (teller) {
        out.set(teller[0], 'teller');
        const kid = l.filter((r) => r[5] >= 4 && r[5] < 12).sort((a, b) => a[0] - b[0])[0];
        if (kid) out.set(kid[0], 'listener');
      }
    }
    void rows;
    return out;
  }

  /** a point of a guard's night round (screen), or null where the camp has no room for it */
  patrolPoint(band: number, now: number, id: number): { x: number; y: number; face: number } | null {
    const c = this.camps.get(band);
    if (!c) return null;
    const dir = hash(id, 3) < 0.5 ? 1 : -1;
    const a = dir * now / 14000 + hash(id, 7) * Math.PI * 2;
    for (const R of [1.8, 1.3, 0.9]) {
      const tx = c.tx + Math.cos(a) * R, ty = c.ty + Math.sin(a) * R;
      if (!this.walkable(Math.round(tx), Math.round(ty))) continue;
      const p = this.tileTop(tx, ty);
      // screen direction of the walk: along the circle
      const d = iso(-Math.sin(a) * dir, Math.cos(a) * dir);
      return { x: p.x, y: p.y, face: d.x < 0 ? -1 : 1 };
    }
    return null;
  }

  /** what a person is doing right now, when the night changes it (null: the day's task) */
  nightTask(id: number): string | null {
    const p = this.people.get(id);
    if (!this.nightNow) return null;
    const role = p?.role;
    if (role === 'guard') return 'пази селото';
    if (role === 'bodyguard') return 'пази водача';
    if (p && TASKS[p.task] === 'scout') return null;
    return 'спи';
  }

  /** the night: a dark veil with clear light 2 tiles around every fire, fading out by 3.5 tiles.
   *  Drawn on a small canvas a few times a second: cheap for the graphics card and the processor. */
  private drawNight(dark: number, nowMs: number) {
    const spr = this.nightSprite;
    spr.visible = dark > 0.005;
    if (!spr.visible) return;
    const moving = this.world.x !== this.lastCam[0] || this.world.y !== this.lastCam[1] || this.world.scale.x !== this.lastCam[2];
    if (!moving && nowMs - this.nightAt < 250) return;
    this.nightAt = nowMs;
    this.lastCam = [this.world.x, this.world.y, this.world.scale.x];
    const Q = 4; // canvas pixels are 4x4 screen pixels; the edges are soft anyway
    const W = this.app.screen.width, H = this.app.screen.height;
    const cw = Math.ceil(W / Q), ch = Math.ceil(H / Q);
    const cv = this.nightCanvas;
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const g = cv.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = `rgba(5, 10, 28, ${dark.toFixed(3)})`;
    g.fillRect(0, 0, cw, ch);
    const z = this.world.scale.x;
    // a circle of r tiles is an ellipse on screen
    const rx = ((TW / 2) * Math.SQRT2 * z) / Q, ry = ((TH / 2) * Math.SQRT2 * z) / Q;
    g.globalCompositeOperation = 'destination-out';
    for (const c of this.camps.values()) {
      if (!c.hasFire) continue;
      const p = this.tileTop(c.tx, c.ty);
      const x = (this.world.x + p.x * z) / Q, y = (this.world.y + p.y * z) / Q;
      const R = 3.5 * rx;
      if (x < -R || y < -R || x > cw + R || y > ch + R) continue;
      g.save();
      g.translate(x, y);
      g.scale(1, ry / rx);
      const grad = g.createRadialGradient(0, 0, 2 * rx, 0, 0, R);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    spr.texture.source.resize(cw, ch);
    spr.texture.source.update();
    spr.width = W;
    spr.height = H;
  }

  private lastCam = [0, 0, 0];

  /** the whole map as one picture for far zoom; made again when the season or the snow changes, or after two minutes */
  private updateFar(key: string, nowMs: number) {
    if (this.farSprite && key === this.farKey && nowMs - this.farAt < 120000) return;
    this.farKey = key;
    this.farAt = nowMs;
    const { w, h } = this.info;
    const x0 = iso(0, h).x - TW, x1 = iso(w, 0).x + TW;
    const y0 = -15 * ELEV - 40, y1 = iso(w, h).y + 40;
    const frame = new Rectangle(x0, y0, x1 - x0, y1 - y0);
    const res = Math.min(0.3, 4000 / frame.width, 4000 / frame.height);
    // draw everything still: ground, water, snow, trees, fog; no people, camps or names
    const save = { x: this.world.x, y: this.world.y, s: this.world.scale.x };
    this.world.position.set(0, 0);
    this.world.scale.set(1);
    for (const c of this.chunkViews) for (const part of c.parts) part.visible = true;
    const hide = [this.farLayer, this.campLayer, this.peopleLayer, this.glowLayer, this.labelLayer];
    const was = hide.map((l) => l.visible);
    for (const l of hide) l.visible = false;
    for (const l of [this.waterLayer, this.terrainLayer, this.snowLayer, this.objLayer, this.fogLayer]) l.visible = true;
    // the fog without its blur: the blur filter would paint the whole frame black, and far away a sharp edge is fine
    const fogFilters = this.fogLayer.filters;
    this.fogLayer.filters = null;
    this.fogLayer.alpha = 0.9;
    const tex = this.app.renderer.generateTexture({ target: this.world, frame, resolution: res, clearColor: [0, 0, 0, 0] });
    this.fogLayer.filters = fogFilters as Filter[];
    this.fogLayer.alpha = 1;
    hide.forEach((l, k) => { l.visible = was[k]; });
    this.world.position.set(save.x, save.y);
    this.world.scale.set(save.s);
    this.farSprite?.destroy(true);
    this.farSprite = new Sprite(tex);
    this.farSprite.position.set(x0, y0);
    this.farSprite.width = frame.width;
    this.farSprite.height = frame.height;
    this.farLayer.addChild(this.farSprite);
  }

  /** called every frame */
  frame(dt: number, nowMs: number) {
    // zoomed far out the whole map is on screen: everything stands still (only the snow still comes and goes)
    const still = this.world.scale.x <= 0.5;
    this.still = still;
    if (!still) this.time += dt / 60;
    if (this.waterFilter) {
      const want = still ? null : [this.waterFilter];
      if ((this.waterLayer.filters?.length ?? 0) !== (want?.length ?? 0)) this.waterLayer.filters = want;
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
    const dark = this.night ? Math.max(0, Math.min(0.82, -sun * 1.0 + 0.05)) : 0;
    const nightNow = sun < -0.25;
    // dusk and dawn: everyone goes to (or gets up from) their sleeping spot at once, not at the next tick
    if (nightNow !== this.nightNow) {
      this.nightNow = nightNow;
      if (this.lastPeople) this.updatePeople(this.lastPeople.rows, this.lastPeople.bandColors, 6000);
    }
    this.drawNight(dark, nowMs);
    this.glowLayer.alpha = Math.min(0.45, dark * 0.55);
    const zoom = this.world.scale.x;
    // far away: one picture of the map, only the camps and their names stay live
    const far = zoom <= 0.4 && !!this.info;
    if (far) {
      this.updateFar(`${this.seasonKey}|${this.snowCold.alpha.toFixed(2)}|${this.snowCool.alpha}|${this.roadVersion}`, nowMs);
      for (const l of [this.waterLayer, this.terrainLayer, this.snowLayer, this.objLayer, this.fogLayer, this.peopleLayer, this.glowLayer]) l.visible = false;
      this.farLayer.visible = true;
      for (const c of this.camps.values()) c.scaleTag(zoom);
      this.far = true;
      return;
    }
    if (this.far) {
      this.far = false;
      this.farLayer.visible = false;
      for (const l of [this.waterLayer, this.terrainLayer, this.snowLayer, this.objLayer, this.fogLayer, this.glowLayer]) l.visible = true;
    }
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
    if (still) {
      // no walking, fire or banners: just keep the camp names readable
      for (const c of this.camps.values()) c.scaleTag(zoom);
      this.secretFrame(nowMs, zoom, winter);
      return;
    }
    const mx = 80, x0 = vx - mx, x1 = vx + vw + mx, y0 = vy - mx, y1 = vy + vh + mx * 2;
    for (const p of this.people.values()) {
      const on = (p.to.x > x0 && p.to.x < x1 && p.to.y > y0 && p.to.y < y1) || (p.from.x > x0 && p.from.x < x1 && p.from.y > y0 && p.from.y < y1);
      p.c.visible = on;
      if (on) p.frame(nowMs);
    }
    for (const c of this.camps.values()) {
      const on = c.pos.x > x0 - 60 && c.pos.x < x1 + 60 && c.pos.y > y0 - 60 && c.pos.y < y1 + 60;
      c.c.visible = on;
      if (on) c.frame(nowMs, zoom);
    }
    this.fauna.frame(performance.now(), Math.min(0.1, dt / 60));
    this.secretFrame(nowMs, zoom, winter);
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
  /** smooth walking position without bobbing or idle wiggle: the card and camera follow this */
  pos = { x: 0, y: 0 };
  /** where the person was heading, in tiles, and the way there around any water (screen points) */
  tile = { x: 0, y: 0 };
  path: { x: number; y: number }[] = [];
  lens: number[] = [];
  t0 = 0;
  dur = 1;
  seed: number;
  task = 0;
  band = 0;
  age = 20;
  female = false;
  /** heads the band: own sprites with a smooth idle animation (sheets S and T) */
  chief = false;
  pose = '';
  facing = 1;
  outline: Container | null = null;
  star: Sprite | null = null;
  /** set by the renderer: the night guard of the band, the old storyteller, or the child listening to him */
  role: Role | null = null;

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
    this.pos = { x: p.x, y: p.y };
    this.tile = { x: row[1] / 10, y: row[2] / 10 };
    this.c.position.set(p.x, p.y);
    this.age = row[5];
    this.female = row[6] === 1;
    this.chief = row[7] === 1;
    this.setPose(this.idlePose());
    this.updateStar();
  }

  /** 70 and more: a small gold star next to the head */
  private updateStar() {
    const want = this.age >= 70;
    if (want && !this.star) {
      this.star = new Sprite(this.r.tex.star);
      this.star.anchor.set(0.5);
      this.star.scale.set(0.25);
      this.c.addChild(this.star);
    } else if (!want && this.star) {
      this.star.destroy();
      this.star = null;
    }
    if (this.star) this.star.position.set(3.2, -Math.abs(this.body.height) - 1.5);
  }

  private setPose(name: string) {
    if (name === this.pose) return;
    this.pose = name;
    this.r.atlas.set(this.body, name);
    // the newer animation sheets keep their own fur colours: no band-coloured clothes on top
    const cloth = this.r.atlas.has(name + '_c');
    this.cloth.visible = cloth;
    if (cloth) this.r.atlas.set(this.cloth, name + '_c');
    this.updateOutline();
    if (this.star) this.star.position.set(3.2, -Math.abs(this.body.height) - 1.5);
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
      // the newer sheets have no separate clothes: their outline is the body alone
      const name = j & 1 ? this.pose + '_c' : this.pose;
      sp.visible = this.r.atlas.has(name);
      if (!sp.visible) return;
      this.r.atlas.set(sp, name);
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

  /** the chief: young with a dark beard or none, old with a white beard (sheets S-V) */
  private chiefPose(now: number, walking: boolean): string | null {
    const look = hash(this.id, 41) < 0.5 ? 'chiefA' : 'chiefB';
    const age = this.age >= 50 ? 'o' : 'y';
    const base = `${look}_${age}_${walking ? 'walk' : 'idle'}`;
    if (!this.r.atlas.has(`${base}0`)) return null;
    // 8-frame loops: a slow, calm idle and a smooth walk
    const f = Math.floor(now / (walking ? 110 : 220) + this.seed) % 8;
    return `${base}${f}`;
  }

  /** animated work, sleep and story poses (sheets AB-AE); null = the usual sprites */
  private actionPose(now: number, walking: boolean, arrived: boolean): string | null {
    const A = this.r.atlas;
    const loop = (base: string, n: number, ms: number) => {
      const name = `${base}${Math.floor(now / ms + this.seed) % n}`;
      return A.has(name) ? name : null;
    };
    const task = TASKS[this.task];
    const knows = (id: string) => this.r.bandTech.get(this.band)?.has(id) ?? false;
    const man = !this.female && this.age >= 16 && this.age < 56;
    if (walking) {
      if (task === 'chop') return loop('carry', 8, 110);
      // bronze age: some men ride, some take a cart to the neighbours
      if (man && knows('horse') && hash(this.id, 53) < 0.2) return loop('rider', 4, 160);
      if (man && knows('trade') && hash(this.id, 51) < 0.2) return loop('trader', 4, 170);
      return null;
    }
    if (this.r.nightNow && task !== 'scout') {
      // everybody sleeps; the guards walk around the fire (see frame) and the bodyguard stands by the chief
      if (this.role === 'guard' || this.role === 'bodyguard') return (A.has(`${this.guardKit()}idle0`) ? loop(`${this.guardKit()}idle`, 8, 450) : null) ?? loop('guard', 4, 900);
      if (this.chief) {
        const own = loop(`${hash(this.id, 41) < 0.5 ? 'chiefA' : 'chiefB'}_${this.age >= 50 ? 'o' : 'y'}_sleep`, 2, 1500);
        if (own) return own;
      }
      if (this.age < 12) return loop(this.female ? 'sleepGirl' : 'sleepBoy', 2, 1500) ?? loop('sleepK', 2, 1500);
      if (this.age > 55) return loop(this.female ? 'sleepOldF' : 'sleepOldM', 2, 1500) ?? loop(this.female ? 'sleepF' : 'sleepM', 2, 1500);
      return loop(this.female ? 'sleepF' : 'sleepM', 2, 1500);
    }
    if ((this.role === 'guard' || this.role === 'bodyguard') && A.has(`${this.guardKit()}idle0`)) return loop(`${this.guardKit()}idle`, 8, 450);
    if (this.role === 'teller') return loop('tell', 8, 240);
    if (this.role === 'listener') return loop('listen', 8, 240);
    if (!arrived) return null;
    switch (task) {
      case 'chop': return loop('chop', 8, 120);
      case 'hunt': return this.age < 56 ? loop('throw', 4, 320) : null;
      case 'gather': return this.female && this.age < 56 ? loop('pick', 4, 340) : null;
      case 'fish': return !this.female ? loop('spearfish', 4, 340) : null;
      case 'craft':
        if (!this.female) {
          if (knows('writing') && hash(this.id, 57) < 0.25) return loop('scribe', 4, 600);
          return (knows('bronze') ? loop('smith', 4, 260) : null) ?? loop('knap', 4, 300);
        }
        if (knows('wheel') && hash(this.id, 55) < 0.5) return loop('wheelpot', 4, 420);
        return knows('weaving') && knows('agriculture') ? loop('weaver', 4, 380) : null;
      case 'farm': return man && knows('plough') ? loop('plougher', 4, 260) : null;
      default: return null;
    }
  }

  /** guards (and the bodyguard) wear the best gear of their time: bronze once the band knows it */
  private guardKit(): string {
    return this.r.bandTech.get(this.band)?.has('bronze') && this.r.atlas.has('bgwalk0') ? 'bg' : 'g';
  }

  private walkPose(now: number): string | null {
    const f = Math.floor(now / 140 + this.seed) % 4;
    if (this.age < 12) return `${this.female ? 'girlwalk' : 'boywalk'}${f}`;
    if (this.age > 55) return this.female ? `oldwalk${f}` : null;
    return `${this.female ? 'womanwalk' : 'walk'}${f}`;
  }

  target(row: PersonRow, color: number, tickMs: number) {
    const tx = row[1] / 10, ty = row[2] / 10;
    const p = this.r.tileTop(tx, ty);
    this.from = { x: this.pos.x, y: this.pos.y };
    this.to = p;
    // go around water; with no way by land (a boat) they still go straight
    const way = this.r.dryLine(this.tile.x, this.tile.y, tx, ty) ? null : this.r.landPath(this.tile.x, this.tile.y, tx, ty);
    this.path = way ? [this.from, ...way.slice(1, -1).map((q) => this.r.tileTop(q.x, q.y)), p] : [this.from, p];
    this.lens = [0];
    for (let i = 1; i < this.path.length; i++) this.lens.push(this.lens[i - 1] + Math.hypot(this.path[i].x - this.path[i - 1].x, this.path[i].y - this.path[i - 1].y));
    this.tile = { x: tx, y: ty };
    this.t0 = performance.now();
    this.dur = Math.max(400, Math.min(tickMs * 0.85, 12000));
    this.cloth.tint = color;
    this.age = row[5];
    this.updateStar();
    this.female = row[6] === 1;
    this.chief = row[7] === 1;
    const s = this.age < 12 ? 0.75 + this.age * 0.02 : this.age > 60 ? 0.95 : 1;
    this.c.scale.set(this.facing * s, s);
    this.task = row[3];
    this.band = row[4];
    if (Math.abs(this.to.x - this.from.x) > 1) this.facing = this.to.x < this.from.x ? -1 : 1;
  }

  frame(now: number) {
    const k = Math.min(1, (performance.now() - this.t0) / this.dur);
    const e = k * k * (3 - 2 * k);
    let x = this.to.x, y = this.to.y;
    const total = this.lens[this.lens.length - 1] ?? 0;
    if (total > 0 && e < 1) {
      const d = e * total;
      let i = 1;
      while (i < this.lens.length - 1 && this.lens[i] < d) i++;
      const a = this.path[i - 1], b = this.path[i];
      const f = (d - this.lens[i - 1]) / Math.max(1e-6, this.lens[i] - this.lens[i - 1]);
      x = a.x + (b.x - a.x) * f;
      y = a.y + (b.y - a.y) * f;
      if (Math.abs(b.x - a.x) > 1) this.facing = b.x < a.x ? -1 : 1;
    }
    const dist = total;
    // a guard on his night round: two tiles around the fire
    const round = this.role === 'guard' && this.r.nightNow ? this.r.patrolPoint(this.band, now, this.id) : null;
    if (round) {
      x = round.x;
      y = round.y;
      this.facing = round.face;
    }
    const walking = !!round || (k < 0.95 && dist > 3);
    this.pos.x = x;
    this.pos.y = y;
    let bob = 0;
    const asleep = this.r.nightNow && TASKS[this.task] !== 'scout';
    const chiefPose = this.chief && !asleep ? this.chiefPose(now, walking) : null;
    const kit = this.guardKit();
    const own = this.r.atlas.has(`${kit}walk0`);
    // guards look like guards all day long once their sprites exist
    const guardOn = (this.role === 'guard' || this.role === 'bodyguard') && own;
    const guardWalk = round || (guardOn && walking) ? `${own ? `${kit}walk` : this.female ? 'womanwalk' : 'walk'}${Math.floor(now / 150 + this.seed) % (own ? 8 : 4)}` : null;
    const special = chiefPose || guardWalk ? null : this.actionPose(now, walking, k >= 1);
    const walk = guardWalk ?? chiefPose ?? special ?? (walking ? this.walkPose(now) : null);
    if (walk) {
      this.setPose(walk);
    } else {
      this.setPose(this.idlePose());
      if (walking) bob = -Math.abs(Math.sin(now / 110 + this.seed)) * 1.2;
    }
    // small idle movement so the camp feels alive (not while sleeping, sitting or working in place)
    const task = TASKS[this.task];
    if (k >= 1 && task !== 'rest' && !special) {
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
  ['fire', 'chopblock', false],
  ['fire', 'woodstack', true],
  ['clothing', 'hiderack', false],
  ['cave_art', 'totem', null],
  ['burial', 'cairn', false],
  ['burial', 'shrine', true],
  ['pottery', 'pots', null],
  ['grinding', 'quern', false],
  ['grinding', 'quern2', true],
  ['pottery', 'kiln', true],
  ['pottery', 'oven', true],
  ['herding', 'pen', false],
  ['herding', 'goatpen', true],
  ['mudbrick', 'bricks', true],
  ['fishing', 'fishtrap', null],
  ['boats', 'canoe', null],
  ['agriculture', 'granary', true],
  ['agriculture', 'haystack', true],
  ['mudbrick', 'well', true],
  ['weaving', 'basket', null],
  // bronze age (shown once the AG/AH sheets are in the atlas)
  ['copper', 'ore', null],
  ['copper', 'furnace', true],
  ['bronze', 'anvil', true],
  ['bronze', 'toolrack', null],
  ['wheel', 'potwheel', true],
  ['weaving', 'loom', true],
  ['plough', 'ploughox', true],
  ['wheel', 'cart', null],
  ['trade', 'cartfull', true],
  ['horse', 'horsepost', null],
  ['sailing', 'sailboat', null],
  ['writing', 'tablets', true],
  ['trade', 'stall', true],
  ['walls', 'tower', true],
  ['walls', 'gate', true],
  ['trade', 'market', true],
  ['calendar', 'statue', true],
];

export class CampSprite {
  r: WorldRenderer;
  c = new Container();
  label: Text;
  glow: Sprite;
  hearth: Sprite;
  homes: Container = new Container();
  fields: Container = new Container();
  /** trampled earth, one tile at a time so it follows the ground (sheet AM) */
  trodden: Container = new Container();
  troddenKey = '';
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
  homeCount = 0;
  building: { s: Sprite; base: string; t0: number; flip: boolean }[] = [];

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
    this.ground.visible = false;
    this.c.addChild(this.ground, this.trodden, this.fields, this.homes);
    this.homes.addChild(this.hearth, this.banner);
    this.hearth.zIndex = 2;
    this.banner.zIndex = 0;
    r.campLayer.addChild(this.c);
    r.glowLayer.addChild(this.glow);
    this.tag.addChild(this.tagBg, this.label);
    r.labelLayer.addChild(this.tag);
  }

  /** where something placed (ox, oy) pixels from the camp centre really stands: on the ground of its own tile.
   * null where that tile is water, a river or a step of more than one level from the camp (it would hang in the air) */
  private spot(ox: number, oy: number): { x: number; y: number } | null {
    const a = ox / (TW / 2), c = oy / (TH / 2);
    const fx = this.tx + (a + c) / 2, fy = this.ty + (c - a) / 2;
    const xi = Math.round(fx), yi = Math.round(fy);
    if (!this.r.walkable(xi, yi)) return null;
    if (Math.abs(this.r.levelAt(xi, yi) - this.r.levelAt(this.tx, this.ty)) > 1) return null;
    const p = this.r.tileTop(fx, fy);
    return { x: p.x - this.pos.x, y: p.y - this.pos.y };
  }

  /** the first good spot on a ring: the wanted one, then closer in, then a little to the side */
  private ringSpot(a: number, rad: number): { x: number; y: number } | null {
    for (const [k, da] of [[1, 0], [0.7, 0], [1, 0.35], [1, -0.35], [0.45, 0], [0.7, 0.6], [0.7, -0.6]]) {
      const q = this.spot(Math.cos(a + da) * rad * k, Math.sin(a + da) * rad * k * 0.5 + 2);
      if (q) return q;
    }
    return null;
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
    this.label.text = b.settlementName ? `${VILLAGE(b.settlementName)} (${b.size})` : `${B(b.name).replace(/^(Родът на|Clan of the) /, '')} (${b.size})`;
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
    this.updateTrodden(b);
    const n = Math.max(1, Math.min(10, Math.round(b.size / (b.dwelling === 'house' ? 6 : 5))));
    const techs = new Set(b.techIds ?? b.techs);
    let props = PROPS.filter(([tech, sp, settled]) => techs.has(tech) && (settled === null || settled === b.settled) && this.r.atlas.has(sp)).map(([, s]) => s);
    // a big village keeps only its newest things around it (later techs are later in the list)
    if (props.length > 12) props = props.slice(-12);
    // walls make a village a town: stone houses, and a temple once it keeps a calendar
    const town = b.dwelling === 'house' && techs.has('walls') && this.r.atlas.has('townb3');
    const cold = this.r.tempAt(b.x, b.y) < 0.35;
    const key = `${b.dwelling}${town ? 'T' : ''}:${n}:${b.settled}:${cold}:${props.join(',')}:${Math.round(b.x)},${Math.round(b.y)}`;
    if (key === this.key) return;
    // homes added since last time are built in four steps; the first look at a camp shows it finished
    const sameKind = this.key.split(':')[0] === `${b.dwelling}${town ? 'T' : ''}` && this.key !== '';
    const builtBefore = sameKind ? this.homeCount : n;
    this.homeCount = n;
    this.key = key;
    const A = this.r.atlas;
    this.building = [];
    for (const ch of [...this.homes.children]) {
      if (ch !== this.hearth && ch !== this.banner) ch.destroy();
    }
    for (let k = 0; k < n; k++) {
      const h = hash(this.id, k + 40);
      let name: string;
      switch (b.dwelling) {
        case 'none': name = 'furbed'; break;
        case 'tent': name = cold && h < 0.5 ? 'bonehut' : h < 0.2 ? 'leanto' : `tent${k % 2}`; break;
        case 'hut': name = A.has('hutb3') ? 'hutb3' : 'roundhut'; break;
        default:
          if (town) name = k === 0 && techs.has('calendar') && A.has('templeb3') ? 'templeb3' : 'townb3';
          else name = k % 3 === 2 ? 'longhouse' : A.has('houseb3') ? 'houseb3' : 'house';
      }
      const a = (k / n) * Math.PI * 2 + 0.6;
      const rad = (b.dwelling === 'house' ? 26 : 19) + (k % 2) * 7;
      const q = this.ringSpot(a, rad);
      if (!q) continue;
      const s = A.sprite(name);
      if (h < 0.5) s.scale.x *= -1;
      s.position.set(q.x, q.y);
      s.zIndex = s.y;
      this.homes.addChild(s);
      if (k >= builtBefore && /^(hut|house|town|temple)b3$/.test(name)) {
        this.building.push({ s, base: name.slice(0, -1), t0: Date.now(), flip: s.scale.x < 0 });
        A.set(s, `${name.slice(0, -1)}0`);
        if (h < 0.5) s.scale.x *= -1;
      }
    }
    // camp props in an outer ring
    props.forEach((name, k) => {
      const a = (k / Math.max(5, props.length)) * Math.PI * 2 + 2.1;
      const rad = (b.dwelling === 'house' ? 40 : 32) + (k % 2) * 5;
      const q = this.ringSpot(a, rad);
      if (!q) return;
      const s = A.sprite(name);
      s.position.set(q.x, q.y);
      s.zIndex = s.y;
      this.homes.addChild(s);
    });
    this.banner.zIndex = this.banner.y;
  }

  /** the trampled ground of the camp: the middle fully worn, the edge fading into the grass */
  private updateTrodden(b: BandView) {
    const A = this.r.atlas;
    if (!A.has('trod0_t')) return;
    const bx = Math.round(b.x), by = Math.round(b.y);
    const R = b.settled ? 2 : 1;
    const key = `${bx}:${by}:${R}`;
    if (key === this.troddenKey) return;
    this.troddenKey = key;
    this.trodden.removeChildren().forEach((c) => c.destroy());
    const L0 = this.r.levelAt(bx, by);
    const tiles: [number, number, number][] = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > R + (R > 1 ? 1 : 0)) continue;
      const x = bx + dx, y = by + dy;
      if (!this.r.walkable(x, y)) continue;
      const L = this.r.levelAt(x, y);
      if (Math.abs(L - L0) > 1) continue;
      // a tile hidden behind a higher one in front would show over its edge
      if (this.r.levelAt(x + 1, y) > L || this.r.levelAt(x, y + 1) > L) continue;
      tiles.push([x, y, d]);
    }
    tiles.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
    for (const [x, y, d] of tiles) {
      const s = A.sprite(`trod${Math.floor(hash(x + 7, y + 3) * 16)}_t`);
      const p = this.r.tileTop(x, y);
      s.position.set(p.x - this.pos.x, p.y - this.pos.y);
      s.alpha = d === 0 ? 1 : d < R ? 0.9 : 0.6;
      this.trodden.addChild(s);
    }
  }

  /** farmed tiles around a village: soil in spring, wheat in summer, stubble after the harvest */
  private updateFields(b: BandView) {
    const m = this.r.month;
    const count = b.settled && (b.techIds ?? b.techs).includes('agriculture') ? Math.min(10, 2 + Math.floor(b.size / 10)) : 0;
    // ploughed in early spring, sprouts, tall wheat in summer, stubble and sheaves after the harvest
    const stage = m >= 2 && m <= 3 ? 0 : m <= 5 && m >= 4 ? 1 : m >= 6 && m <= 8 ? 2 : m >= 9 && m <= 10 ? 3 : 0;
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
      if (!this.r.walkable(x, y)) continue;
      const L = this.r.levelAt(x, y);
      if (Math.abs(L - this.r.levelAt(bx, by)) > 1 || this.r.levelAt(x + 1, y) > L || this.r.levelAt(x, y + 1) > L) continue;
      const h = hash(x, y + 101);
      const name = this.r.atlas.has(`field${stage}_t`) ? `field${stage}`
        : stage === 2 ? `wheat${Math.floor(h * 4)}` : stage === 1 ? `soil${2 + Math.floor(h * 2)}` : `soil${Math.floor(h * 2)}`;
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
    // homes going up: stakes, walls, roof frame, finished (about 15 s for each step)
    if (this.building.length) {
      this.building = this.building.filter((bd) => {
        if (bd.s.destroyed) return false;
        const st = Math.min(3, Math.floor((now - bd.t0) / 15000));
        this.r.atlas.set(bd.s, `${bd.base}${st}`);
        if (bd.flip) bd.s.scale.x *= -1;
        return st < 3;
      });
    }
    const frameNo = this.hasFire ? 1 + (Math.floor(now / 130 + this.id * 7) % 3) : 0;
    if (frameNo !== this.fireFrame) {
      this.fireFrame = frameNo;
      this.r.atlas.set(this.hearth, `hearth${frameNo}`);
    }
    if (this.hasFire) this.glow.scale.set(0.95 + Math.sin(now / 90 + this.id) * 0.06);
    this.bannerCloth.skew.y = Math.sin(now / 500 + this.id) * 0.05;
    this.symbol.skew.y = this.bannerCloth.skew.y;
    this.scaleTag(zoom);
  }

  scaleTag(zoom: number) {
    this.tag.scale.set(1 / Math.max(0.3, Math.min(2, zoom)));
  }

  destroy() {
    this.c.destroy({ children: true });
    this.glow.destroy();
    this.tag.destroy({ children: true });
  }
}
