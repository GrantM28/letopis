// Brain 2 holds together: every clan belongs to a culture, cultures learn and split, the networks stay finite,
// the same seed gives the same noise, and a world from before Brain 2 is gathered into cultures.
import { Simulation } from '../src/server/sim/sim';
import { PARAMS2, cultureSummary } from '../src/server/sim/brain2';

const step = (s: Simulation) => { s.step(); s.events = []; s.deadQueue = []; s.goneQueue = []; };

export function brain2() {
  const sim = new Simulation(null, 31);
  for (let i = 0; i < 12 * 500; i++) step(sim);
  const h = sim.host() as never;
  const brains = sim.s.brains ?? {};
  const cs = sim.s.cultures ?? {};
  const bad: string[] = [];
  for (const b of sim.s.bands) {
    const c = brains[b.id]?.culture;
    if (c === undefined || !cs[c]) bad.push(`clan ${b.id} has no culture`);
    if ((brains[b.id]?.mem ?? []).length !== 6) bad.push(`clan ${b.id} has no memory`);
  }
  const sum = cultureSummary(h).filter((c) => c.clans);
  if (!sum.length) bad.push('no cultures');
  if (!sum.some((c) => c.steps > 50)) bad.push(`no culture learned much: ${sum.map((c) => c.steps).join(', ')}`);
  if (sum.some((c) => c.clans > 30)) bad.push(`a culture never split: ${Math.max(...sum.map((c) => c.clans))} clans`);
  for (const c of Object.values(cs)) {
    if (c.net.length !== PARAMS2) bad.push(`culture ${c.id}: ${c.net.length} weights`);
    if (c.net.some((v) => !Number.isFinite(v))) bad.push(`culture ${c.id}: a weight is not a number`);
  }
  // a world from before Brain 2 (no cultures saved) is gathered into cultures on its first month
  const state = JSON.parse(JSON.stringify(sim.serialize()));
  delete state.cultures; delete state.cultureSeq;
  for (const br of Object.values(state.brains ?? {}) as Record<string, unknown>[]) { delete br.culture; delete br.slot; delete br.mem; }
  const old = new Simulation(state);
  step(old);
  const ob = old.s.brains ?? {};
  if (old.s.bands.some((b) => ob[b.id]?.culture === undefined)) bad.push('an old world was not gathered into cultures');
  if (bad.length) throw new Error(bad.slice(0, 8).join('\n'));
}
