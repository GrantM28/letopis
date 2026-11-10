// The full simulation test: one world lived a long time, checked as it goes (tests/invariants.ts).
//   esbuild tools/fulltest.ts --bundle --platform=node --format=esm --outfile=dist/fulltest.mjs
//   node dist/fulltest.mjs <seed> <years>             a new world
//   node dist/fulltest.mjs --from world.json.gz <years>  a saved world, carried on
// Every chronicle entry is checked as it is written, the whole world once a year (just after the yearly steps), and
// every 500 years the world is saved and loaded and the loaded copy carries on. Each problem is reported once, with
// the year it first appeared and how often; a line of progress every 500 years; a summary as JSON at the end.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Simulation } from '../src/server/sim/sim';
import { checkEvent, checkWorld } from '../tests/invariants';

const args = process.argv.slice(2);
const from = args[0] === '--from' ? args[1] : null;
const years = Number(from ? args[2] : args[1] ?? 3000);
let sim = from ? new Simulation(JSON.parse(gunzipSync(readFileSync(from)).toString('utf8'))) : new Simulation(null, Number(args[0] ?? 1));
const label = from ? `saved world ${sim.s.worldId}` : `seed ${args[0]}`;
const problems = new Map<string, { level: string; first: number; n: number }>();
const note = (level: string, what: string) => {
  // the same kind of problem once: numbers in the message are not part of what it is
  const key = `${level}: ${what.replace(/-?\d+(\.\d+)?/g, '#')}`;
  const p = problems.get(key);
  if (p) p.n++; else { problems.set(key, { level, first: Math.floor(sim.year), n: 1 }); console.log(`  ! ${Math.floor(sim.year)} ${level}: ${what.slice(0, 200)}`); }
};
let worst = 0, events = 0, saves = 0;
const t0 = Date.now();
const startYear = Math.floor(sim.year);
for (let m = 1; m <= years * 12; m++) {
  const a = performance.now();
  try {
    sim.step();
  } catch (e) {
    note('error', `the month threw: ${(e as Error).stack?.split('\n').slice(0, 3).join(' / ')}`);
    break;
  }
  worst = Math.max(worst, performance.now() - a);
  for (const e of sim.events) { events++; const bad = checkEvent(e); if (bad) note('error', `chronicle ${bad}`); }
  sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
  if (sim.extinct) { note('info', 'the world died out'); break; }
  if (sim.s.tick % 12 === 7) for (const p of checkWorld(sim, true)) note(p.level, p.what);
  if (m % (500 * 12) === 0) {
    // saved and loaded: the loaded copy carries on (a restart in the middle of the run)
    try {
      const json = JSON.stringify(sim.serialize());
      sim = new Simulation(JSON.parse(json));
      saves++;
      console.log(`${label} · year ${Math.floor(sim.year)} · era ${sim.s.era} · ${sim.s.people.length} people · ${sim.s.bands.length} clans · ${Object.keys(sim.s.realms ?? {}).length} realms · ${Object.keys(sim.s.cultures ?? {}).length} cultures · discoveries ${sim.s.discovered.length} · slowest month ${Math.round(worst)} ms · save ${Math.round(json.length / 1048576)} MB · heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB · ${Math.round((Date.now() - t0) / 60000)} min`);
      worst = 0;
    } catch (e) {
      note('error', `save and load failed: ${(e as Error).message}`);
    }
  }
}
console.log(JSON.stringify({
  label, from: startYear, to: Math.floor(sim.year), era: sim.s.era, people: sim.s.people.length, clans: sim.s.bands.length, events, saves,
  problems: [...problems].map(([k, v]) => ({ problem: k, ...v })),
}));
