// A long world with a line every 500 years (population, clans, age, slowest month), to catch a late explosion early.
//   esbuild tools/longrun.ts --bundle --platform=node --format=esm --outfile=dist/longrun.mjs && node dist/longrun.mjs <seed> <years>
import { Simulation } from '../src/server/sim/sim';
const seed = Number(process.argv[2] ?? 42), years = Number(process.argv[3] ?? 7000);
const sim = new Simulation(null, seed);
let worst = 0;
const t0 = Date.now();
for (let i = 1; i <= years * 12; i++) {
  const a = performance.now();
  sim.step(); sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
  worst = Math.max(worst, performance.now() - a);
  if (sim.extinct) { console.log(`died out in ${Math.floor(sim.year)}`); break; }
  if (i % (500 * 12) === 0) {
    console.log(`year ${Math.floor(sim.year)}  people ${sim.s.people.length}  clans ${sim.s.bands.length}  villages ${sim.s.bands.filter((b) => b.settled).length}  age ${sim.s.era}  discoveries ${sim.s.discovered.length}  slowest month ${Math.round(worst)} ms  (${Math.round((Date.now() - t0) / 60000)} min)`);
    worst = 0;
  }
}
