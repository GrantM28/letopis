// The same seed makes the same world (the dice are seeded; nothing may depend on the clock or on luck outside them).
import { Simulation } from '../src/server/sim/sim';

export function determinism() {
  const run = () => {
    const s = new Simulation(null, 13);
    for (let i = 0; i < 12 * 250; i++) { s.step(); s.events = []; s.deadQueue = []; s.goneQueue = []; }
    return [s.s.people.length, s.s.bands.length, s.s.totalBorn, s.s.discovered.join(','), s.rng.s.join(','), JSON.stringify(s.s.brains ?? {}).length].join(' | ');
  };
  const a = run(), b = run();
  if (a !== b) throw new Error(`two runs of the same seed differ:\n${a}\n${b}`);
}
