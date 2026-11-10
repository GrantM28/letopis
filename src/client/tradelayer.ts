// Trade routes on the map (fork, 1.56): the road between two trading villages drawn as a dashed line, with little carts
// going to and fro. The Trade button shows or hides them. Lives in the label layer, above the land, under the names.
import { Container, Graphics } from 'pixi.js';
import type { WorldRenderer } from './render';
import { $, api, save, store } from './kit';
import { markOverlay } from './overlays';

interface Route { a: number; b: number; since: number; path: number[] }
interface Line { pts: { x: number; y: number }[]; len: number; seed: number }

export class TradeLayer {
  c = new Container();
  private roadsG = new Graphics();
  private carts = new Graphics();
  private lines: Line[] = [];
  on = false;

  constructor(private r: WorldRenderer) {
    // above the culture tint (index 0), below every name tag
    r.labelLayer.addChildAt(this.c, Math.min(1, r.labelLayer.children.length));
    markOverlay(this.c);
    this.c.addChild(this.roadsG, this.carts);
    this.c.visible = false;
    this.c.eventMode = 'none';
  }

  setOn(on: boolean) {
    this.on = on;
    this.c.visible = on;
  }

  setRoutes(routes: Route[]) {
    this.lines = routes.map((rt) => {
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k + 1 < rt.path.length; k += 2) pts.push(this.r.tileTop(rt.path[k], rt.path[k + 1]));
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      return { pts, len, seed: (rt.a * 7919 + rt.b * 104729) % 1000 };
    }).filter((l) => l.pts.length > 1);
    this.drawRoads();
  }

  /** dashes along every road (drawn once per new list of routes) */
  private drawRoads() {
    const g = this.roadsG;
    g.clear();
    for (const l of this.lines) {
      let on = true, left = 7;
      for (let k = 1; k < l.pts.length; k++) {
        let { x, y } = l.pts[k - 1];
        const ex = l.pts[k].x, ey = l.pts[k].y;
        let seg = Math.hypot(ex - x, ey - y);
        while (seg > 0.01) {
          const step = Math.min(seg, left);
          const nx = x + ((ex - x) * step) / seg, ny = y + ((ey - y) * step) / seg;
          if (on) g.moveTo(x, y).lineTo(nx, ny);
          x = nx; y = ny; seg -= step; left -= step;
          if (left <= 0.01) { on = !on; left = on ? 7 : 5; }
        }
      }
    }
    // a dark edge under a bright gold dash, so a route stands out from the road under it
    g.stroke({ color: 0x2a1a08, width: 4.5, alpha: 0.55 }).stroke({ color: 0xffd36e, width: 2.2, alpha: 1 });
  }

  /** the carts: two per route, one each way, moved every frame (only when they can be seen) */
  frame(nowMs: number, zoom: number) {
    if (!this.on) return;
    const g = this.carts;
    g.clear();
    this.roadsG.alpha = zoom < 0.3 ? 0.55 : 1;
    if (zoom < 0.35) return;
    const t = nowMs / 1000;
    for (const l of this.lines) {
      for (const dir of [0, 1]) {
        // a cart walks about 14 screen-px a second, there and back
        const at = ((t * 14 + l.seed * 3 + dir * l.len * 0.5) % (2 * l.len));
        const d = at <= l.len ? at : 2 * l.len - at;
        const p = this.pointAt(l, d);
        // a cart: wooden box, a pale load, two wheels
        g.rect(p.x - 4, p.y - 6, 8, 4.5).fill({ color: 0x7a4a22 }).stroke({ color: 0xf6e7c1, width: 0.8 })
          .rect(p.x - 2.5, p.y - 8.5, 5, 2.5).fill({ color: 0xe8d6a8 })
          .circle(p.x - 2.5, p.y - 1, 1.3).circle(p.x + 2.5, p.y - 1, 1.3).fill({ color: 0x2a1a08 });
      }
    }
  }

  private pointAt(l: Line, d: number): { x: number; y: number } {
    for (let k = 1; k < l.pts.length; k++) {
      const a = l.pts[k - 1], b = l.pts[k];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= seg) return { x: a.x + ((b.x - a.x) * d) / Math.max(seg, 0.001), y: a.y + ((b.y - a.y) * d) / Math.max(seg, 0.001) };
      d -= seg;
    }
    return l.pts[l.pts.length - 1];
  }
}

/** the Trade button: shows the routes and keeps them fresh while shown */
export function initTrade(r: WorldRenderer, zoom: () => number) {
  const layer = new TradeLayer(r);
  const btn = $('#tradeBtn');
  const refresh = async () => {
    const routes = await api<Route[]>('/api/trade').catch(() => null);
    if (routes) layer.setRoutes(routes);
  };
  const apply = (on: boolean) => {
    layer.setOn(on);
    btn.setAttribute('aria-pressed', String(on));
    if (on) void refresh();
  };
  btn.onclick = () => { const on = !layer.on; save('letopis.trade', on); apply(on); };
  apply(store('letopis.trade', false));
  // routes open and close once a year of the world
  setInterval(() => { if (layer.on) void refresh(); }, 20000);
  r.app.ticker.add(() => layer.frame(performance.now(), zoom()));
  return layer;
}
