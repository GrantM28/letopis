// Experiment: run a saved world forward and see what its realms do (how many, how big, what the chronicle says).
//   esbuild tools/realmprobe.ts --bundle --platform=node --format=esm --outfile=dist/realmprobe.mjs && node dist/realmprobe.mjs world.json.gz 50
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Simulation } from '../src/server/sim/sim';
const sim = new Simulation(JSON.parse(gunzipSync(readFileSync(process.argv[2])).toString('utf8')));
const news: string[] = [];
const pop0 = sim.s.people.length;
for (let i = 0; i < 12 * Number(process.argv[3] ?? 50); i++) {
  sim.step();
  for (const e of sim.events) if (e.kind === 'realm' || e.kind === 'ruler') news.push(`${Math.floor(e.year)} [${e.kind}/${e.importance}] ${e.en?.text}`);
  sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
}
const rs = Object.values(sim.s.realms ?? {});
console.log('year', Math.floor(sim.year), 'people', pop0, '->', sim.s.people.length, 'villages', sim.s.bands.filter((b) => b.settled).length, 'realms', rs.length, 'in realms', rs.reduce((a, r) => a + r.members.length, 0));
console.log('sizes', rs.map((r) => r.members.length).sort((a, b) => b - a).join(','), '| names', rs.slice(0, 5).map((r) => r.name).join('; '));
const kinds: Record<string, number> = {};
for (const n of news) { const k = n.includes('ruler') || n.includes(' is now ') ? 'ruler' : n.includes('joined into one realm') ? 'founded' : n.includes(' joined the ') ? 'joined' : n.includes('left the') ? 'left' : n.includes('no more') ? 'ended' : n.includes('capital') ? 'capital moved' : n.includes('begun') ? 'first' : 'other'; kinds[k] = (kinds[k] ?? 0) + 1; }
console.log(news.length, 'news', JSON.stringify(kinds));
for (const n of news.slice(0, 8)) console.log(' ', n);
