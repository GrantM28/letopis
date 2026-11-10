// Cultures on the map (fork, 1.53): the land around every clan tinted in its culture's colour, with the culture's name
// over its middle when zoomed out. Lives at the bottom of the label layer: above the land, under the names of the clans,
// left out of the far-zoom picture of the map, and still live when zoomed far out.
import { AlphaFilter, BlurFilter, Container, Graphics, Text } from 'pixi.js';
import type { BandView } from '../shared/types';
import { TH, TW, type WorldRenderer } from './render';

export interface CultureInfo { id: number; name: string; hue: number; from: number | null; clans: number; steps: number }

/** a hue (0..360) as a colour: soft enough to sit on the land, strong enough to tell apart */
export function hueColor(h: number, light = 0.5): number {
  const s = 0.78, l = light;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
export const hueCss = (h: number, light = 0.5) => `#${hueColor(h, light).toString(16).padStart(6, '0')}`;

/** how far around a camp its culture's land reaches, in tiles */
const REACH = 6;

export class CultureLayer {
  c = new Container();
  private shapes = new Graphics();
  private names = new Container();
  private labels = new Map<number, Text>();
  cultures = new Map<number, CultureInfo>();
  on = false;
  /** a culture whose land is lit (its card is open): shown even with the layer off, the others left out */
  private focused: number | null = null;
  private lastBands: BandView[] = [];

  constructor(private r: WorldRenderer) {
    r.labelLayer.addChildAt(this.c, 0);
    this.c.addChild(this.shapes, this.names);
    // drawn solid, then made see-through as a whole (so overlaps do not darken) with soft edges
    this.shapes.filters = [new BlurFilter({ strength: 8, quality: 2 }), new AlphaFilter({ alpha: 0.42 })];
    this.c.visible = false;
    this.c.eventMode = 'none';
  }

  setOn(on: boolean) {
    this.on = on;
    this.c.visible = on || this.focused !== null;
    if (this.c.visible) this.draw(this.lastBands);
  }

  /** light one culture's land (or none); its card passes what the layer needs to know of it */
  focus(id: number | null, info?: CultureInfo) {
    this.focused = id;
    if (id !== null && info && !this.cultures.has(id)) this.cultures.set(id, info);
    this.c.visible = this.on || id !== null;
    this.draw(this.lastBands);
  }

  setCultures(list: CultureInfo[]) {
    this.cultures = new Map(list.map((c) => [c.id, c]));
    if (this.on) this.draw(this.lastBands);
  }

  /** the clans moved, split or changed culture */
  update(bands: BandView[]) {
    this.lastBands = bands;
    if (this.on || this.focused !== null) this.draw(bands);
  }

  private tagsHidden = false;

  /** names only far out, where the colours alone could be anyone's */
  frame(zoom: number) {
    // far out the culture map reads better without every clan's name tag over it; close in the tags come back
    const hide = this.on && zoom < 0.9;
    if (hide || this.tagsHidden) {
      for (const ch of this.r.labelLayer.children) if (ch !== this.c) ch.visible = !hide;
      this.tagsHidden = hide;
    }
    if (!this.on) return;
    this.names.visible = zoom < 0.9;
    // the names keep their size on screen
    for (const t of this.labels.values()) t.scale.set(1 / Math.max(0.12, zoom));
  }

  /** the culture whose land is at a map point, if any (the nearest clan within reach) */
  cultureAt(tx: number, ty: number): CultureInfo | null {
    let best: BandView | null = null, bd = REACH * REACH;
    for (const b of this.lastBands) {
      const d = (b.x - tx) ** 2 + (b.y - ty) ** 2;
      if (d < bd && b.culture !== undefined) { bd = d; best = b; }
    }
    return best ? this.cultures.get(best.culture!) ?? null : null;
  }

  private draw(bands: BandView[]) {
    const g = this.shapes;
    g.clear();
    // an iso circle of REACH tiles is an ellipse on screen
    const rx = REACH * TW * 0.62, ry = REACH * TH * 0.62;
    const centres = new Map<number, { x: number; y: number; n: number }>();
    for (const b of bands) {
      const c = b.culture !== undefined ? this.cultures.get(b.culture) : undefined;
      if (!c || (this.focused !== null && c.id !== this.focused)) continue;
      const p = this.r.tileTop(b.x, b.y);
      g.ellipse(p.x, p.y, rx, ry).fill({ color: hueColor(c.hue) });
      const m = centres.get(c.id) ?? { x: 0, y: 0, n: 0 };
      m.x += p.x; m.y += p.y; m.n++;
      centres.set(c.id, m);
    }
    // a name over the middle of every culture of four clans or more
    const seen = new Set<number>();
    for (const [id, m] of centres) {
      const c = this.cultures.get(id)!;
      if (m.n < 4) continue;
      seen.add(id);
      let t = this.labels.get(id);
      if (!t) {
        t = new Text({ text: '', resolution: 2,
          style: { fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: '700', fontStyle: 'italic', fill: hueColor(c.hue, 0.78), stroke: { color: 0x10141c, width: 4 }, letterSpacing: 0.5 } });
        t.anchor.set(0.5);
        this.labels.set(id, t);
        this.names.addChild(t);
      }
      t.text = c.name.replace(/^the /, 'The ');
      t.style.fill = hueColor(c.hue, 0.78);
      t.position.set(m.x / m.n, m.y / m.n - 18);
    }
    for (const [id, t] of this.labels) if (!seen.has(id)) { t.destroy(); this.labels.delete(id); }
  }
}
