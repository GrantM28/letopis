// A world lived 700 years and checked every year (tests/invariants.ts): nothing impossible in it, nothing piling up,
// every chronicle entry in good English. The long version of this is tools/fulltest.ts.
import { Simulation } from '../src/server/sim/sim';
import { checkEvent, checkWorld } from './invariants';

export function worldcheck() {
  const sim = new Simulation(null, 9);
  const bad = new Set<string>();
  for (let m = 0; m < 12 * 700; m++) {
    sim.step();
    for (const e of sim.events) { const p = checkEvent(e); if (p) bad.add(`chronicle ${p}`); }
    sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
    if (sim.extinct) throw new Error(`the world died out in ${Math.floor(sim.year)}`);
    if (sim.s.tick % 12 === 7) {
      for (const p of checkWorld(sim, true)) bad.add(`${p.level}: ${p.what}`);
      // right after the yearly clean-up nothing is kept for clans that are gone
      const alive = new Set(sim.s.bands.map((b) => b.id));
      const stale = Object.keys(sim.s.moveNews ?? {}).filter((k) => !alive.has(Number(k))).length;
      if (stale > 0) bad.add(`${stale} move notes of gone clans kept after the yearly clean-up`);
    }
    if (bad.size > 10) break;
  }
  if (bad.size) throw new Error([...bad].slice(0, 10).join('\n'));
}
