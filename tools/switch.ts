// Experiment: how fast does a world answer a change of plan? Runs on one plan, switches, prints population by year.
//   esbuild tools/switch.ts --bundle --platform=node --format=esm --outfile=dist/switch.mjs && node dist/switch.mjs <seed>
import { Simulation } from '../src/server/sim/sim';
const seed = Number(process.argv[2] ?? 5);
const plan = (s: string) => { const v = s.split(',').map(Number); return [...v.slice(0, 6), v[6], 0.5, v[7]]; };
const even = plan('1,1,1,1,1,1,0.5,0.2'), craft = plan('0.5,0.5,0.5,3,0.5,0.5,0.5,0.2');
const g = globalThis as { letopisFixed?: number[] };
for (const [name, second] of [['even→craft', craft], ['even→even', even]] as const) {
  g.letopisFixed = even;
  const sim = new Simulation(null, seed);
  const step = () => { sim.step(); sim.events = []; sim.deadQueue = []; sim.goneQueue = []; };
  for (let i = 0; i < 800 * 12; i++) step();
  g.letopisFixed = second;
  const out: number[] = [];
  for (let y = 0; y <= 60; y++) { if (y % 5 === 0) out.push(sim.s.people.length); for (let m = 0; m < 12; m++) step(); }
  console.log(name.padEnd(11), out.join(' '));
}
