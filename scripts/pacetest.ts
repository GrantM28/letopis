import { Simulation } from '../src/server/sim/sim';
const seed = Number(process.argv[2] ?? 42);
const until = Number(process.argv[3] ?? -1500);
const sim = new Simulation(null, seed);
const t0 = Date.now();
let lastLog = -99999;
while (sim.year < until && !sim.extinct) {
  sim.step(); sim.events = []; sim.deadQueue = [];
  if (sim.year - lastLog >= 1000) { lastLog = sim.year; console.log(`${Math.floor(sim.year)} pop ${sim.s.people.length} bands ${sim.s.bands.length} era ${sim.s.era} s ${((Date.now() - t0) / 1000).toFixed(0)}`); }
}
console.log((sim.s.firsts ?? []).map((f) => `${f.year} ${f.tech}`).join('\n'));
console.log('pop', sim.s.people.length, 'bands', sim.s.bands.length, 'ms', Date.now() - t0);
