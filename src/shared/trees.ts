// Trees belong to the simulation: they grow from saplings to big trees, the bands cut them for
// their fires and huts, and a camp moves on only when the wood around it is gone.
// The server decides where trees can grow and how big each one is; the client only draws them.

import { Simplex } from './noise';
import { Rng } from './rng';
import { Biome, RIVER_WATER, isWater } from './types';

/** what grows on a tile; 0 = nothing. The names are the sprite groups g_<kind>0..3 (sheets X-Z) */
export const TREE_KINDS = ['', 'oak', 'oakL', 'oakOld', 'birch', 'fruit', 'spruceL', 'spruceD', 'pine', 'pineU'] as const;
export const CONIFERS = new Set([6, 7, 8, 9]);

/** stages: 0 none (cut, or not grown yet), 1 sapling, 2 young, 3 grown, 4 big */
export const BIG = 4;

export function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick<T>(list: readonly T[], n: number): T {
  return list[Math.min(list.length - 1, Math.floor(n * list.length))];
}

const K = (name: (typeof TREE_KINDS)[number]) => TREE_KINDS.indexOf(name);

/** which tree may grow on each tile (groves and clearings, like the old hand-placed forests) */
export function treeKinds(w: number, h: number, biome: ArrayLike<number>, river: ArrayLike<number>, temp: ArrayLike<number>): Uint8Array {
  const clumps = new Simplex(new Rng(20261101));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = biome[i];
      if (isWater(b) || river[i] >= RIVER_WATER) continue;
      const n = hash(x + 11, y + 7);
      const n2 = hash(x + 31, y + 17);
      const t = temp[i];
      const dense = 0.5 + 0.55 * clumps.noise(x * 0.11, y * 0.11);
      let k = 0;
      switch (b) {
        case Biome.Forest:
          if (n < dense - 0.12) k = t < 0.42 ? pick([K('pine'), K('birch'), K('birch'), K('oakL'), K('spruceL')], n2)
            : pick([K('oak'), K('oakL'), K('oakOld'), K('birch'), K('oak'), K('fruit'), K('pine')], n2);
          break;
        case Biome.Taiga:
          if (n < dense - 0.05) k = pick([K('spruceL'), K('spruceD'), K('spruceL'), K('pine')], n2);
          break;
        case Biome.Grassland:
          if (n < 0.03) k = pick([K('oak'), K('fruit'), K('oakL'), K('oakOld'), K('birch')], n / 0.03);
          break;
        case Biome.Plains:
          if (n < 0.015) k = t > 0.6 ? K('pineU') : K('oakL');
          break;
        case Biome.Hills:
          if (n < 0.04) k = pick([K('oakOld'), K('pine'), K('pineU')], n / 0.04);
          break;
      }
      out[i] = k;
    }
  }
  return out;
}

/** how big the trees are when the world begins: mostly old forest */
export function startStage(x: number, y: number): number {
  const r = hash(x + 5, y + 59);
  return r < 0.06 ? 1 : r < 0.14 ? 2 : r < 0.32 ? 3 : 4;
}
