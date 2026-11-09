// Three worlds live 600 years each without trouble: no error, a sensible population, no runaway clan, discoveries made.
import { Simulation } from '../src/server/sim/sim';

const SEEDS = [5, 21, 42];
const YEARS = 600;

export function smoke() {
  const bad: string[] = [];
  for (const seed of SEEDS) {
    const sim = new Simulation(null, seed);
    let biggest = 0;
    for (let i = 0; i < YEARS * 12; i++) {
      sim.step();
      sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
      if (sim.extinct) { bad.push(`world ${seed} died out in ${Math.floor(sim.year)}`); break; }
      if (i % 12 === 0) {
        const sizes = new Map<number, number>();
        for (const p of sim.s.people) sizes.set(p.bandId, (sizes.get(p.bandId) ?? 0) + 1);
        biggest = Math.max(biggest, ...sizes.values());
      }
    }
    const pop = sim.s.people.length;
    // a clan never grows past three times the biggest split limit (280 for a castle town)
    if (biggest > 840) bad.push(`world ${seed}: a clan reached ${biggest} people`);
    if (!sim.extinct && (pop < 20 || pop > 20000)) bad.push(`world ${seed}: ${pop} people after ${YEARS} years`);
    if (sim.s.discovered.length < 4) bad.push(`world ${seed}: only ${sim.s.discovered.length} discoveries after ${YEARS} years`);
  }
  if (bad.length) throw new Error(bad.join('\n'));
}
