// A world that is saved and loaded goes on exactly as one that never stopped: every person and clan, births, discoveries,
// the dice, the relations and what every clan's brain has learned. (The server saves every two minutes and on every restart.)
import { Simulation } from '../src/server/sim/sim';

const step = (s: Simulation) => { s.step(); s.events = []; s.deadQueue = []; s.goneQueue = []; };

/** the first place two values differ, numbers allowed to differ by a millionth (a food total's 10th decimal may) */
function differs(a: unknown, b: unknown, path = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 ? null : `${path}: ${a} vs ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = differs(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { const d = differs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return a === b ? null : `${path}: ${String(a)} vs ${String(b)}`;
}

export function saveload() {
  const a = new Simulation(null, 77);
  for (let i = 0; i < 12 * 300; i++) step(a);
  const b = new Simulation(JSON.parse(JSON.stringify(a.serialize())));
  for (let i = 0; i < 12 * 200; i++) { step(a); step(b); }
  const sig = (s: Simulation) => ({
    people: s.s.people.length, bands: s.s.bands.length, born: s.s.totalBorn, discovered: s.s.discovered, dice: s.rng.s,
    relations: s.s.relations ?? {}, clans: s.s.bands, everyone: s.s.people,
    // what each clan has learned must match; the running averages of the month may drift a little, because the original
    // game saves the land's fruit and game rounded (exact saves are a later change to the save format)
    nets: Object.fromEntries(Object.entries(s.s.brains ?? {}).map(([id, br]) => [id, { net: br.net, gen: br.gen, kept: br.kept, tried: br.tried }])),
  });
  const d = differs(sig(a), sig(b));
  if (d) throw new Error(`after a save and load the world differs at ${d}`);
}
