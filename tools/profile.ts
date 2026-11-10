// Experiment: time the months of a saved world, to find what is slow in a big one.
//   esbuild tools/profile.ts --bundle --platform=node --format=esm --outfile=dist/profile.mjs && node --cpu-prof dist/profile.mjs world.json.gz 60
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Simulation } from '../src/server/sim/sim';
const sim = new Simulation(JSON.parse(gunzipSync(readFileSync(process.argv[2])).toString('utf8')));
const months = Number(process.argv[3] ?? 60);
const t: number[] = [];
for (let i = 0; i < months; i++) { const a = performance.now(); sim.step(); t.push(performance.now() - a); sim.events = []; sim.deadQueue = []; sim.goneQueue = []; }
t.sort((a, b) => a - b);
const total = t.reduce((a, v) => a + v, 0);
console.log(`fingerprint: dice ${sim.rng.s.join(",")} people ${sim.s.people.length} born ${sim.s.totalBorn} clans ${sim.s.bands.length} at ${sim.s.bands.reduce((a, b) => a + b.id * 7 + b.cx * 13 + b.cy, 0)} food ${sim.s.bands.reduce((a, b) => a + b.food, 0).toFixed(6)}  total ${(total / 1000).toFixed(1)} s`);
console.log(`people ${sim.s.people.length} clans ${sim.s.bands.length}  month: median ${t[t.length >> 1].toFixed(0)} ms, p90 ${t[Math.floor(t.length * 0.9)].toFixed(0)} ms, max ${t[t.length - 1].toFixed(0)} ms`);
