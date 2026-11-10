// Trade routes (trade.ts): allied trading villages a road joins trade along it; the first year's routes open quietly,
// later ones are told, and a route falls quiet (and is told) when the alliance ends.
import { isWater } from '../src/shared/types';
import { findRoad } from '../src/server/sim/roads';
import { tradeRoutes, tradeStep } from '../src/server/sim/trade';
import { W, generateTerrain, idx } from '../src/server/sim/world';

export function trade() {
  const t = generateTerrain(5);
  // two land tiles a few steps apart with a way between them
  let a = -1, b = -1;
  for (let y = 20; y < 200 && a < 0; y++) for (let x = 20; x < 200 && a < 0; x++) {
    const i = idx(x, y), j = idx(x + 6, y + 2);
    if (!isWater(t.biome[i]) && !isWater(t.biome[j]) && findRoad(t, new Uint8Array(W * W), i, j)) { a = i; b = j; }
  }
  if (a < 0) throw new Error('no two land tiles found for the test');
  const band = (id: number, i: number) => ({ id, cx: i % W, cy: Math.floor(i / W), settled: true, name: `B${id}`, settlementName: `V${id}` });
  const news: string[] = [];
  const h = {
    t, roads: new Uint8Array(W * W), year: -2000,
    s: { bands: [band(1, a), band(2, b)], roadPairs: ['1-2:1'], relState: { '1-2': 'ally' } as Record<string, 'ally' | 'rival'>, trade: undefined as unknown },
    hasTech: () => true, emit: (_k: string, _i: number, _t: string, _kids: unknown, _p: unknown, _b: unknown, _x: unknown, en: string[]) => { news.push(en[0]); },
    bandLabel: (x: { name: string }) => x.name, bandEnLabel: (x: { name: string }) => x.name, bRefs: () => [],
  };
  const step = () => tradeStep(h as never);
  const bad: string[] = [];
  step();
  if (tradeRoutes(h as never).length !== 1) bad.push('the route did not open');
  if (news.length) bad.push(`the first year's route was told: ${news[0]}`);
  const path = tradeRoutes(h as never)[0]?.path ?? [];
  if (path.length < 4) bad.push('the route has no road to draw');
  h.s.relState['1-2'] = 'rival';
  step();
  if (tradeRoutes(h as never).length) bad.push('the route stayed after the alliance ended');
  if (!news.some((n) => n.includes('fell quiet'))) bad.push('the end of the route was not told');
  h.s.relState['1-2'] = 'ally';
  step();
  if (!news.some((n) => n.includes('opened a trade road'))) bad.push('a new route was not told');
  h.s.roadPairs = ['1-2:9'];
  step();
  if (tradeRoutes(h as never).length) bad.push('a route without a road stayed');
  if (bad.length) throw new Error(bad.join('\n'));
}
