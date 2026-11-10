// Trade routes (fork, 1.56): two allied villages that both know trade and are joined by a road trade along it.
// The route is the road between them; the map draws it with carts going to and fro. What trade does stays what it was:
// trading neighbours even out a good and a bad harvest (sim.ts contact()); this file only finds the routes and tells them.

import type { Band } from './sim';
import type { EventHost } from './events';
import { findRoad } from './roads';
import { W, idx } from './world';
import type { Terrain } from './world';

export interface TradeRoute {
  a: number; b: number;
  /** the year it opened */
  since: number;
  /** the road's tiles, from a to b */
  path: number[];
}

export interface TradeHost extends EventHost {
  t: Terrain;
  roads: Uint8Array;
  bRefs(b: Band): import('../../shared/types').ChronicleRef[];
  s: EventHost['s'] & { trade?: Record<string, TradeRoute>; roadPairs?: string[]; relState?: Record<string, 'ally' | 'rival'> };
}

/** once a year: routes open between allied trading villages a road joins, and fall quiet when that ends */
export function tradeStep(h: TradeHost) {
  // the first year (a new world, or one from before 1.56) the routes already there open without news
  const first = h.s.trade === undefined;
  const routes = (h.s.trade ??= {});
  const towns = new Map(h.s.bands.filter((b) => b.settled).map((b) => [b.id, b]));
  const year = Math.floor(h.year);
  // which villages a road joins (built once a year by the villages themselves, see buildRoads)
  const joined = new Set((h.s.roadPairs ?? []).filter((e) => { const l = Number(e.split(':')[1]); return l === 1 || l === 2; }).map((e) => e.split(':')[0]));
  const trades = (b: Band) => h.hasTech(b, 'trade');
  // routes that end: a village gone or no longer a village, the alliance over, no road any more
  for (const [k, r] of Object.entries(routes)) {
    const a = towns.get(r.a), b = towns.get(r.b);
    if (a && b && h.s.relState?.[k] === 'ally' && joined.has(k)) continue;
    delete routes[k];
    if (a && b) {
      h.emit('trade', 1, `Търговският път между ${h.bandLabel(a)} и ${h.bandLabel(b)} опустя.`, undefined, undefined, a.id, h.bRefs(b),
        [`The trade road between ${h.bandEnLabel(a)} and ${h.bandEnLabel(b)} fell quiet.`]);
    }
  }
  // routes that open
  for (const k of joined) {
    if (routes[k] || h.s.relState?.[k] !== 'ally') continue;
    const [ia, ib] = k.split('-').map(Number);
    const a = towns.get(ia), b = towns.get(ib);
    if (!a || !b || !trades(a) || !trades(b)) continue;
    // the road between them (an existing road is cheap to follow, so this finds it)
    const path = findRoad(h.t, h.roads, idx(Math.round(a.cx), Math.round(a.cy)), idx(Math.round(b.cx), Math.round(b.cy)));
    if (!path) continue;
    routes[k] = { a: a.id, b: b.id, since: year, path };
    if (!first) h.emit('trade', 1, `${h.bandLabel(a, true)} и ${h.bandLabel(b)} отвориха търговски път.`, undefined, undefined, a.id, h.bRefs(b),
      [`${h.bandEnLabel(a, true)} and ${h.bandEnLabel(b)} opened a trade road.`]);
  }
}

/** for the map: every route as tile coordinates [x0, y0, x1, y1, ...] */
export function tradeRoutes(h: { s: { trade?: Record<string, TradeRoute> } }) {
  return Object.values(h.s.trade ?? {}).map((r) => ({
    a: r.a, b: r.b, since: r.since,
    path: r.path.flatMap((i) => [i % W, Math.floor(i / W)]),
  }));
}
