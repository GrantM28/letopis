// Pasture (fork): herds need grass, and every herder grazing the same stretch of land shares it.
//
// Before, a herder brought in the same food anywhere (only the clan's own flock size gave diminishing returns), so a world
// could grow without end by splitting into more clans that herd, even on snow and bare rock. Learning brains found that
// (Brain 2 grew a world to 39,000 people by 3,000 BC, a sixth of them herders, half the camps on almost no grass).
// Now the grass within a day's walk of a camp feeds so many herders, shared with every clan's herders nearby.

import type { Band, Person } from './sim';
import { idx, inBounds } from './world';

/** LETOPIS_PASTURE: grass needed per herder (0 switches the rule off) */
const PER_HERDER = Number((typeof process !== 'undefined' && process.env?.LETOPIS_PASTURE) || 0);
export const PASTURE_ON = PER_HERDER > 0;
const R = 6;
const NEAR = 8;

interface PastureHost { s: { tick: number; bands: Band[]; people: Person[] }; t: { plantsCap: Float32Array } }

let cache: { tick: number; herders: Map<number, number>; grass: Map<number, number> } | null = null;

/** the share of a full herd's yield each herder of this clan gets this month (1 = enough grass for everyone) */
export function pastureShare(h: PastureHost, b: Band): number {
  if (!PASTURE_ON) return 1;
  if (!cache || cache.tick !== h.s.tick) {
    // last month's herders (their tasks are still set) and the grass around each camp, counted once a month
    const herders = new Map<number, number>();
    for (const p of h.s.people) if (p.task === 'herd') herders.set(p.bandId, (herders.get(p.bandId) ?? 0) + 1);
    cache = { tick: h.s.tick, herders, grass: new Map() };
  }
  let grass = cache.grass.get(b.id);
  if (grass === undefined) {
    grass = 0;
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) if (inBounds(x, y)) grass += h.t.plantsCap[idx(x, y)];
    cache.grass.set(b.id, grass);
  }
  let near = 0;
  for (const o of h.s.bands) {
    const n = cache.herders.get(o.id);
    if (n && Math.hypot(o.cx - b.cx, o.cy - b.cy) <= NEAR) near += n;
  }
  const fed = grass / PER_HERDER;
  return near <= fed ? 1 : Math.max(0.05, fed / near);
}
