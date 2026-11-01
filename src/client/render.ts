import { AlphaFilter, Application, BlurFilter, Container, Filter, GlProgram, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { BandView, Biome, PersonRow, TASKS, WorldInfo, b64decode, isWater } from '../shared/types';

export const TW = 32; // tile width
export const TH = 16; // tile height
export const ELEV = 5; // pixels per height level
const CHUNK = 16;

export function iso(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) };
}

const BIOME_COLOR: Record<number, number> = {
  [Biome.DeepWater]: 0x1d4e7a,
  [Biome.Water]: 0x2f74a8,
  [Biome.Lake]: 0x3a86b8,
  [Biome.Beach]: 0xd9c78f,
  [Biome.Grassland]: 0x7fb24f,
  [Biome.Plains]: 0xa8b45a,
  [Biome.Forest]: 0x3f7f3a,
  [Biome.Taiga]: 0x3d6b4f,
  [Biome.Hills]: 0x8c9a5b,
  [Biome.Mountain]: 0x8a8378,
  [Biome.Snow]: 0xeef3f6,
  [Biome.Desert]: 0xd8b56a,
  [Biome.Tundra]: 0x9fae9a,
  [Biome.Marsh]: 0x5d7f5a,
};

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
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
  float glint = smoothstep(1.05, 1.4, w);
  c.rgb += c.a * (vec3(0.03, 0.05, 0.07) * w + vec3(0.25, 0.3, 0.32) * glint);
  finalColor = c;
}
`;

export class WorldRenderer {
  app: Application;
  world = new Container(); // camera moves this
  terrainLayer = new Container();
  waterLayer = new Container();
  snowLayer = new Container();
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
  fogChunks = new Map<number, Graphics>();
  fogReady = false;
  waterFilter: Filter | null = null;
  snowCold!: Container;
  snowCool!: Container;
  people = new Map<number, PersonSprite>();
  camps = new Map<number, CampSprite>();
  tex!: Record<string, Texture>;
  time = 0;
  month = 0;
  zoom = 1;

  constructor(app: Application) {
    this.app = app;
    this.world.addChild(this.waterLayer, this.terrainLayer, this.snowLayer, this.campLayer, this.peopleLayer, this.fogLayer, this.glowLayer, this.labelLayer);
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
      body: g((x) => x.roundRect(0, 0, 5, 8, 2).fill(0xffffff)),
      head: g((x) => x.circle(2, 2, 2).fill(0xe8c39e)),
      tent: g((x) => {
        x.poly([0, 14, 9, 0, 18, 14]).fill(0x8a6a4a).stroke({ color: 0x5a4330, width: 1 });
        x.poly([7, 14, 9, 6, 11, 14]).fill(0x3a2a1a);
      }),
      hut: g((x) => {
        x.ellipse(10, 12, 10, 5).fill(0x9a7b55);
        x.poly([0, 11, 10, 0, 20, 11]).fill(0xc8a85a).stroke({ color: 0x8a6d32, width: 1 });
        x.rect(8, 9, 4, 6).fill(0x3a2a1a);
      }),
      house: g((x) => {
        x.poly([0, 8, 10, 13, 10, 22, 0, 17]).fill(0xc9b28f);
        x.poly([10, 13, 20, 8, 20, 17, 10, 22]).fill(0xa8916e);
        x.poly([0, 8, 10, 2, 20, 8, 10, 13]).fill(0xa0522d);
        x.rect(4, 13, 3, 5).fill(0x3a2a1a);
      }),
      rug: g((x) => x.ellipse(6, 3, 6, 3).fill(0x7a5c3e)),
      fire: g((x) => {
        x.poly([0, 8, 4, 0, 8, 8]).fill(0xff9a2e);
        x.poly([2, 8, 4, 3, 6, 8]).fill(0xffe066);
      }),
      glow: g((x) => {
        for (let i = 10; i > 0; i--) x.circle(40, 40, i * 4).fill({ color: 0xff8a2a, alpha: 0.035 });
      }),
      field: g((x) => {
        x.poly([0, 8, 16, 0, 32, 8, 16, 16]).fill(0xc9b04a);
        for (let i = 0; i < 4; i++) x.moveTo(4 + i * 6, 8 + i * 0 - 2).lineTo(12 + i * 6, 12 - 2).stroke({ color: 0x9a8530, width: 1 });
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
    for (const l of [this.terrainLayer, this.waterLayer, this.snowCold, this.snowCool, this.fogLayer]) l.removeChildren().forEach((c) => c.destroy());
    this.fogChunks.clear();
    this.fogReady = false;
    this.buildTerrain();
    this.setupWaterFilter();
  }

  private lv(x: number, y: number): number {
    const { w, h } = this.info;
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return this.level[y * w + x];
  }

  private buildTerrain() {
    const { w, h } = this.info;
    const nch = Math.ceil(w / CHUNK);
    for (let s = 0; s <= 2 * (nch - 1); s++) {
      for (let cx = 0; cx < nch; cx++) {
        const cy = s - cx;
        if (cy < 0 || cy >= nch) continue;
        const land = new Graphics();
        const water = new Graphics();
        const cold = new Graphics();
        const cool = new Graphics();
        for (let d = 0; d <= 2 * (CHUNK - 1); d++) {
          for (let lx = 0; lx < CHUNK; lx++) {
            const ly = d - lx;
            if (ly < 0 || ly >= CHUNK) continue;
            const x = cx * CHUNK + lx, y = cy * CHUNK + ly;
            if (x >= w || y >= h) continue;
            this.drawTile(x, y, land, water, cold, cool);
          }
        }
        for (const [g, layer] of [[land, this.terrainLayer], [water, this.waterLayer], [cold, this.snowCold], [cool, this.snowCool]] as [Graphics, Container][]) {
          layer.addChild(g);
        }
        const fog = new Graphics();
        this.fogLayer.addChild(fog);
        this.fogChunks.set(cy * nch + cx, fog);
      }
    }
  }

  private drawTile(x: number, y: number, land: Graphics, water: Graphics, cold: Graphics, cool: Graphics) {
    const { w } = this.info;
    const i = y * w + x;
    const b = this.biome[i];
    const L = this.level[i];
    const p = iso(x, y);
    const top = p.y - L * ELEV;
    const diamond = [p.x, top, p.x + TW / 2, top + TH / 2, p.x, top + TH, p.x - TW / 2, top + TH / 2];
    const n = hash(x, y);
    if (isWater(b)) {
      let c = BIOME_COLOR[b];
      // shallow water near the coast is lighter
      let coast = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.lv(x + dx, y + dy) > 0) coast = 1;
      if (coast) c = mix(c, 0x58a6c8, 0.45);
      water.poly(diamond).fill(shade(c, 0.95 + n * 0.1));
      return;
    }
    // light comes from the north-west
    const slope = (this.lv(x - 1, y) - L) + (this.lv(x, y - 1) - L);
    let c = BIOME_COLOR[b] ?? 0xff00ff;
    c = shade(c, 0.92 + n * 0.14 - slope * 0.06);
    // side faces where the neighbour is lower
    const south = this.lv(x, y + 1), east = this.lv(x + 1, y);
    if (south < L) {
      const dh = (L - south) * ELEV;
      land.poly([p.x - TW / 2, top + TH / 2, p.x, top + TH, p.x, top + TH + dh, p.x - TW / 2, top + TH / 2 + dh]).fill(shade(c, 0.7));
    }
    if (east < L) {
      const dh = (L - east) * ELEV;
      land.poly([p.x, top + TH, p.x + TW / 2, top + TH / 2, p.x + TW / 2, top + TH / 2 + dh, p.x, top + TH + dh]).fill(shade(c, 0.55));
    }
    land.poly(diamond).fill(c);
    // rivers
    if (this.river[i]) {
      const r = Math.min(1, 0.35 + this.river[i] / 120);
      const k = 0.5 * r;
      land.poly([
        p.x, top + TH / 2 - (TH / 2) * k, p.x + (TW / 2) * k, top + TH / 2, p.x, top + TH / 2 + (TH / 2) * k, p.x - (TW / 2) * k, top + TH / 2,
      ]).fill(0x4a90c2);
    }
    // decorations
    if ((b === Biome.Forest || b === Biome.Taiga) && n > 0.15) {
      const count = n > 0.6 ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const ox = (hash(x + k * 7, y) - 0.5) * 18, oy = (hash(x, y + k * 5) - 0.5) * 7;
        const tx = p.x + ox, ty = top + TH / 2 + oy;
        land.rect(tx - 0.8, ty - 2, 1.6, 4).fill(0x5a3d22);
        if (b === Biome.Taiga) land.poly([tx - 4, ty - 1, tx, ty - 12, tx + 4, ty - 1]).fill(shade(0x2d5a3c, 0.85 + hash(k, x) * 0.3));
        else land.circle(tx, ty - 6, 4.5).fill(shade(0x3a7a32, 0.85 + hash(k, y) * 0.3));
      }
    } else if (b === Biome.Mountain && n > 0.4) {
      land.poly([p.x - 7, top + TH / 2 + 3, p.x - 1, top - 6, p.x + 6, top + TH / 2 + 3]).fill(shade(0x77706a, 0.9 + n * 0.2));
      land.poly([p.x - 3, top - 1, p.x - 1, top - 6, p.x + 1.5, top - 1]).fill(0xf2f2f2);
    } else if (b === Biome.Hills && n > 0.7) {
      land.ellipse(p.x, top + TH / 2, 8, 3).fill(shade(c, 1.08));
    } else if ((b === Biome.Grassland || b === Biome.Plains) && n > 0.85) {
      land.circle(p.x + 3, top + 7, 1.2).fill(0xf2e36b);
      land.circle(p.x - 4, top + 9, 1.2).fill(0xe8e8f2);
    } else if (b === Biome.Marsh && n > 0.4) {
      land.ellipse(p.x, top + TH / 2, 6, 2).fill(0x4f7c8a);
    }
    // winter snow, drawn once and faded in by season
    const t = this.temp[i] / 255;
    if (b !== Biome.Snow) {
      if (t < 0.33) cold.poly(diamond).fill({ color: 0xf4f8fb, alpha: 0.85 });
      else if (t < 0.5) cool.poly(diamond).fill({ color: 0xf4f8fb, alpha: 0.75 });
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
    for (const c of dirty) this.drawFog(c);
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
        const skirt = frontHidden ? Math.max(0, L - front) * ELEV : 0;
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
  }

  updatePeople(rows: PersonRow[], bandColors: Map<number, number>, tickMs: number) {
    const seen = new Set<number>();
    for (const r of rows) {
      seen.add(r[0]);
      let p = this.people.get(r[0]);
      if (!p) {
        p = new PersonSprite(this, r);
        this.people.set(r[0], p);
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
    this.snowCool.alpha = winter >= 1 ? 0.65 : 0;
    // a day lasts 8 real minutes, just for the mood
    const day = (nowMs / (8 * 60 * 1000)) % 1;
    const sun = Math.cos(day * Math.PI * 2); // 1 noon, -1 midnight
    const dark = Math.max(0, Math.min(0.55, -sun * 0.7 + 0.05));
    this.nightOverlay.clear().rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color: 0x0a1030, alpha: dark });
    this.glowLayer.alpha = Math.min(1, dark * 2.2);
    const zoom = this.world.scale.x;
    this.peopleLayer.visible = zoom > 0.45;
    this.labelLayer.alpha = zoom > 0.35 ? 1 : 0;
    for (const p of this.people.values()) p.frame(nowMs);
    for (const c of this.camps.values()) c.frame(nowMs, zoom);
  }
}

export class PersonSprite {
  r: WorldRenderer;
  c = new Container();
  body: Sprite;
  head: Sprite;
  id: number;
  from = { x: 0, y: 0 };
  to = { x: 0, y: 0 };
  t0 = 0;
  dur = 1;
  seed: number;
  task = 0;

  constructor(r: WorldRenderer, row: PersonRow) {
    this.r = r;
    this.id = row[0];
    this.seed = hash(row[0], 7) * 1000;
    this.body = new Sprite(r.tex.body);
    this.head = new Sprite(r.tex.head);
    this.body.anchor.set(0.5, 1);
    this.head.anchor.set(0.5, 1);
    this.head.y = -7.5;
    this.c.addChild(this.body, this.head);
    this.c.eventMode = 'none';
    r.peopleLayer.addChild(this.c);
    const p = r.tileTop(row[1] / 10, row[2] / 10);
    this.from = p;
    this.to = p;
    this.c.position.set(p.x, p.y);
  }

  target(row: PersonRow, color: number, tickMs: number) {
    const p = this.r.tileTop(row[1] / 10, row[2] / 10);
    this.from = { x: this.c.x, y: this.c.y };
    this.to = p;
    this.t0 = performance.now();
    this.dur = Math.max(400, Math.min(tickMs * 0.85, 12000));
    this.body.tint = color;
    const age = row[5];
    const s = age < 12 ? 0.55 + age * 0.03 : age > 60 ? 0.92 : 1;
    this.c.scale.set(s);
    this.task = row[3];
    this.head.tint = age > 55 ? 0xdedede : 0xffffff;
  }

  frame(now: number) {
    const k = Math.min(1, (performance.now() - this.t0) / this.dur);
    const e = k * k * (3 - 2 * k);
    let x = this.from.x + (this.to.x - this.from.x) * e;
    let y = this.from.y + (this.to.y - this.from.y) * e;
    // small idle movement so the camp feels alive
    const task = TASKS[this.task];
    if (k >= 1 && task !== 'rest') {
      const a = now / 1400 + this.seed;
      const amp = task === 'child' ? 4 : 1.5;
      x += Math.sin(a) * amp;
      y += Math.cos(a * 1.3) * amp * 0.5;
    }
    this.c.position.set(x, y);
    this.c.zIndex = y;
  }

  destroy() {
    this.c.destroy({ children: true });
  }
}

export class CampSprite {
  r: WorldRenderer;
  c = new Container();
  label: Text;
  glow: Sprite;
  fire: Sprite;
  homes: Container = new Container();
  fields: Container = new Container();
  id: number;
  key = '';
  pos = { x: 0, y: 0 };

  constructor(r: WorldRenderer, b: BandView) {
    this.r = r;
    this.id = b.id;
    this.fire = new Sprite(r.tex.fire);
    this.fire.anchor.set(0.5, 1);
    this.glow = new Sprite(r.tex.glow);
    this.glow.anchor.set(0.5);
    this.label = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, fontWeight: '600' },
      resolution: 2,
    });
    this.label.anchor.set(0.5, 1);
    this.c.addChild(this.fields, this.homes, this.fire);
    r.campLayer.addChild(this.c);
    r.glowLayer.addChild(this.glow);
    r.labelLayer.addChild(this.label);
  }

  update(b: BandView, kids: boolean) {
    const p = this.r.tileTop(b.x, b.y);
    this.pos = p;
    this.c.position.set(p.x, p.y);
    this.glow.position.set(p.x, p.y - 4);
    this.fire.visible = b.hasFire;
    this.glow.visible = b.hasFire || b.dwelling === 'house';
    this.label.text = b.settlementName ? `${b.settlementName} (${b.size})` : `${b.name.replace('Родът на ', '')} (${b.size})`;
    this.label.style.fontSize = kids ? 16 : 12;
    this.label.position.set(p.x, p.y - 26);
    const n = Math.max(1, Math.min(10, Math.round(b.size / (b.dwelling === 'house' ? 6 : 5))));
    const key = `${b.dwelling}:${n}:${b.settled}`;
    if (key === this.key) return;
    this.key = key;
    this.homes.removeChildren().forEach((c) => c.destroy());
    this.fields.removeChildren().forEach((c) => c.destroy());
    const texName = b.dwelling === 'none' ? 'rug' : b.dwelling;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      const rad = 14 + (k % 2) * 7;
      const s = new Sprite(this.r.tex[texName]);
      s.anchor.set(0.5, 1);
      s.position.set(Math.cos(a) * rad, Math.sin(a) * rad * 0.5 + 4);
      s.zIndex = s.y;
      this.homes.addChild(s);
    }
    this.homes.sortableChildren = true;
    if (b.settled) {
      for (let k = 0; k < Math.min(6, 1 + Math.floor(b.size / 12)); k++) {
        const f = new Sprite(this.r.tex.field);
        f.anchor.set(0.5);
        const a = (k / 6) * Math.PI * 2;
        f.position.set(Math.cos(a) * 46, Math.sin(a) * 23);
        f.alpha = 0.9;
        this.fields.addChild(f);
      }
    }
  }

  frame(now: number, zoom: number) {
    if (this.fire.visible) {
      const f = 0.85 + Math.sin(now / 90 + this.id) * 0.1 + Math.sin(now / 37 + this.id * 3) * 0.06;
      this.fire.scale.set(f, f * 1.05);
      this.glow.scale.set(0.9 + f * 0.2);
    }
    this.label.scale.set(1 / Math.max(0.5, Math.min(2, zoom)));
  }

  destroy() {
    this.c.destroy({ children: true });
    this.glow.destroy();
    this.label.destroy();
  }
}
