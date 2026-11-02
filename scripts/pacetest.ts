// Runs a world headless until a year and prints when each discovery was first made.
// usage: node dist/pacetest.mjs <seed> <until year> [save to world.json.gz] [load from world.json.gz]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Simulation } from '../src/server/sim/sim';
const seed = Number(process.argv[2] ?? 42);
const until = Number(process.argv[3] ?? -1500);
const out = process.argv[4];
const from = process.argv[5];
const sim = from ? new Simulation(JSON.parse(gunzipSync(readFileSync(from)).toString('utf8'))) : new Simulation(null, seed);
const t0 = Date.now();
let lastLog = -99999, steps = 0, stepT = Date.now();
while (sim.year < until && !sim.extinct) {
  sim.step(); sim.events = []; sim.deadQueue = []; sim.goneQueue = []; sim.treeChanges = []; sim.roadChanges = [];
  steps++;
  if (sim.year - lastLog >= (from ? 50 : 1000)) {
    lastLog = sim.year;
    console.log(`${Math.floor(sim.year)} pop ${sim.s.people.length} bands ${sim.s.bands.length} era ${sim.s.era} s ${((Date.now() - t0) / 1000).toFixed(0)} ms/step ${((Date.now() - stepT) / steps).toFixed(1)}`);
    steps = 0; stepT = Date.now();
  }
}
console.log((sim.s.firsts ?? []).map((f) => `${f.year} ${f.tech}`).join('\n'));
console.log('pop', sim.s.people.length, 'bands', sim.s.bands.length, 'ms', Date.now() - t0);
if (out) writeFileSync(out, gzipSync(JSON.stringify(sim.serialize())));
