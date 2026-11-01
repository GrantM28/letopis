import { Simulation } from '../src/server/sim/sim';
const seed = Number(process.argv[2] ?? 42);
const years = Number(process.argv[3] ?? 6000);
const sim = new Simulation(null, seed);
const t0 = Date.now();
let ev: string[] = []; const causes: Record<string,number> = {};
for (let i = 0; i < years * 12; i++) {
  sim.step();
  for (const e of sim.events) if (e.importance >= 2) ev.push(`${Math.floor(e.year)}: ${e.text}`);
  for (const d of sim.deadQueue) causes[d.cause]=(causes[d.cause]??0)+1; sim.events = []; sim.deadQueue = [];
  if (i % (12 * Number(process.argv[4] ?? 500)) === 0) console.log(`год ${Math.floor(sim.year)} хора ${sim.s.people.length} родове ${sim.s.bands.length} ера ${sim.s.era} техн ${sim.s.discovered.length} dir ${sim.directorFactor().toFixed(2)} fed ${sim.s.bands.slice(0,8).map(b=>(b.fed??0).toFixed(2)).join(',')} born ${sim.s.totalBorn} died ${sim.s.totalDied}`);
  if (sim.extinct) { console.log('EXTINCT', sim.year); break; }
}
console.log(ev.filter(x=>/откри|опитоми|научи|нарисува|уши|върза|смля|забеляза|изпече|затвори|изпреде|издигна|издълба|опъна|запомни|пя|Започва|основа/.test(x)).slice(0,60).join('\n'));
console.log(JSON.stringify(causes)); console.log('events', ev.length, 'ms', Date.now()-t0, 'pop', sim.s.people.length, 'bands', sim.s.bands.length, 'settled', sim.s.bands.filter(b=>b.settled).length);
