// Roads between villages: found with A* over the land. Rivers are crossed with bridges,
// the sea and lakes not at all. A road that is already there is cheap to follow, so new
// roads join the old ones and the villages grow into a network.

import { Biome, RIVER_WATER, isWater } from '../../shared/types';
import { Terrain, W, H } from './world';

/** cost of stepping onto tile i, or Infinity where no road can go */
function cost(t: Terrain, roads: Uint8Array, i: number): number {
  const b = t.biome[i];
  if (isWater(b)) return Infinity;
  if (roads[i]) return 0.35;
  let c = 1;
  if (t.river[i] >= RIVER_WATER) c = 7; // a bridge is work
  if (b === Biome.Mountain) c += 5;
  else if (b === Biome.Hills) c += 1.5;
  else if (b === Biome.Marsh) c += 3;
  else if (b === Biome.Snow) c += 8;
  else if (b === Biome.Forest || b === Biome.Taiga) c += 0.6;
  return c;
}

/** a binary heap of [priority, tile] */
class Heap {
  p: number[] = [];
  v: number[] = [];
  get size() { return this.v.length; }
  push(pr: number, val: number) {
    const p = this.p, v = this.v;
    let k = v.length;
    p.push(pr); v.push(val);
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (p[up] <= p[k]) break;
      [p[up], p[k]] = [p[k], p[up]]; [v[up], v[k]] = [v[k], v[up]];
      k = up;
    }
  }
  pop(): number {
    const p = this.p, v = this.v;
    const top = v[0];
    const lp = p.pop()!, lv = v.pop()!;
    if (v.length) {
      p[0] = lp; v[0] = lv;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < v.length && p[l] < p[m]) m = l;
        if (r < v.length && p[r] < p[m]) m = r;
        if (m === k) break;
        [p[m], p[k]] = [p[k], p[m]]; [v[m], v[k]] = [v[k], v[m]];
        k = m;
      }
    }
    return top;
  }
}

/** the cheapest way from a to b (tile indices), or null if there is none close enough */
export function findRoad(t: Terrain, roads: Uint8Array, a: number, b: number, maxNodes = 12000): number[] | null {
  const bx = b % W, by = (b - bx) / W;
  const g = new Map<number, number>();
  const from = new Map<number, number>();
  const open = new Heap();
  g.set(a, 0);
  open.push(0, a);
  let n = 0;
  while (open.size) {
    const i = open.pop();
    if (i === b) {
      const path = [b];
      let k = b;
      while (k !== a) { k = from.get(k)!; path.push(k); }
      return path.reverse();
    }
    if (++n > maxNodes) return null;
    const gi = g.get(i)!;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      const c = j === b ? 1 : cost(t, roads, j);
      if (c === Infinity) continue;
      const ng = gi + c;
      if (ng < (g.get(j) ?? Infinity)) {
        g.set(j, ng);
        from.set(j, i);
        // a slightly greedy estimate: much faster, and the road is still a sensible one
        open.push(ng + 0.7 * (Math.abs(xx - bx) + Math.abs(yy - by)), j);
      }
    }
  }
  return null;
}
