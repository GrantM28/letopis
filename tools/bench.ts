// The brain benchmark: one world lived for many years without the server, printing one JSON line.
//   npm run bench -- <seed> <years>
// Switches: LETOPIS_BRAIN=1 uses the old brain (Brain 1), LETOPIS_NO_LEARN=1 freezes every brain as it was born.
// tools/bench.mjs runs the whole set (6 worlds, every variant) in parallel and prints the table.
import { Simulation } from '../src/server/sim/sim';
import { brainSummary } from '../src/server/sim/brain';
import { cultureSummary } from '../src/server/sim/brain2';

const seed = Number(process.argv[2] ?? 42), years = Number(process.argv[3] ?? 3000);
const sim = new Simulation(null, seed);
let popSum = 0, n = 0, biggest = 0, eraYear: Record<number, number> = {}, ms = 0, msN = 0;
for (let i = 0; i < years * 12; i++) {
  const t0 = performance.now();
  sim.step();
  if (i >= years * 12 - 1200) { ms += performance.now() - t0; msN++; }
  sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
  if (sim.extinct) break;
  if (i % 12 === 0) {
    const sizes = new Map<number, number>();
    for (const p of sim.s.people) sizes.set(p.bandId, (sizes.get(p.bandId) ?? 0) + 1);
    for (const v of sizes.values()) if (v > biggest) biggest = v;
    if (eraYear[sim.s.era] === undefined) eraYear[sim.s.era] = Math.floor(sim.year);
  }
  if (i % 120 === 0 && i >= years * 6) { popSum += sim.s.people.length; n++; }
}
const b = brainSummary(sim.host());
const total = Object.values(b.styles).reduce((a, c) => a + c, 0) || 1;
// how varied the ways of life are: 1 = all the same, more = more kinds of clans (the exponential of the Shannon entropy)
const variety = Math.exp(-Object.values(b.styles).reduce((a, c) => a + (c / total) * Math.log(c / total), 0));
console.log(JSON.stringify({
  seed, brain: process.env.LETOPIS_NO_LEARN === '1' ? 'frozen' : process.env.LETOPIS_BRAIN === '1' ? 'brain1' : 'brain2',
  year: Math.floor(sim.year), pop: sim.s.people.length, avgPop: Math.round(popSum / Math.max(1, n)), bands: sim.s.bands.length,
  biggest, eras: eraYear, shares: (() => { const w = b.avgWeights as Record<string, number>; const t = Object.values(w).reduce((a, v) => a + v, 0) || 1; return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +(v / t).toFixed(2)])); })(), discovered: sim.s.discovered.length, variety: +variety.toFixed(2), styles: b.styles,
  cultures: (() => { const c = cultureSummary(sim.host() as never).filter((x) => x.clans); return { n: c.length, steps: Math.max(0, ...c.map((x) => x.steps)), sizes: c.map((x) => x.clans).slice(0, 8), score: c.slice(0, 5).map((x) => x.score) }; })(),
  cultureScore: (() => { const cs = Object.values(sim.s.cultures ?? {}); return cs.length ? +(cs.reduce((a, c) => a + c.score, 0) / cs.length).toFixed(3) : null; })(),
  msPerMonth: +(ms / Math.max(1, msN)).toFixed(2), saveKB: Math.round(JSON.stringify(sim.serialize()).length / 1024),
}));
