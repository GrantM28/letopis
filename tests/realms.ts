// Realms (realms.ts) on a small made-up world: five villages, long allied and joined by road, become one realm with the
// biggest as capital and its elder as ruler; a rival leaves; a dead ruler's grown child carries on the house; a capital
// that is gone moves; a realm of one village ends.
import { realmsStep, type Realm } from '../src/server/sim/realms';

type P = { id: number; bandId: number; born: number; sex: 0 | 1; motherId: number | null; fatherId: number | null; first: string };

export function realms() {
  const bad: string[] = [];
  const news: string[] = [];
  const bands = [1, 2, 3, 4, 5].map((id) => ({ id, cx: id * 4, cy: 10, settled: true, name: `B${id}`, settlementName: `V${id}`, chiefId: 100 + id as number | null, fed: 1, food: 50 }));
  const people: P[] = bands.map((b) => ({ id: 100 + b.id, bandId: b.id, born: 0, sex: 0, motherId: null, fatherId: null, first: `Elder${b.id}` }));
  const sizes: Record<number, number> = { 1: 20, 2: 60, 3: 30, 4: 25, 5: 22 };
  const members = () => new Map(bands.map((b) => [b.id, Array.from({ length: sizes[b.id] ?? 0 }, () => ({}) as never)]));
  const rel: Record<string, 'ally' | 'rival'> = { '1-2': 'ally', '2-3': 'ally', '3-4': 'ally', '4-5': 'ally' };
  const h = {
    year: -1000, s: { era: 2, tick: 11000 * 12, bands, people, relState: rel, roadPairs: ['1-2:1', '2-3:1', '3-4:1', '4-5:1'] } as Record<string, unknown>,
    emit: (_k: string, _i: number, _t: string, _kids: unknown, _p: unknown, _b: unknown, _x: unknown, en: string[]) => { news.push(en[0]); },
    bandLabel: (b: { name: string }) => b.name, bandEnLabel: (b: { settlementName: string }) => `the village of ${b.settlementName}`,
    nameEn: (p: P) => `${p.first} X`, nameOf: (p: P) => p.first, ageOf: (p: P) => (13000 * 12 - p.born) / 12 - 1000,
  };
  const step = () => { realmsStep(h as never, members()); h.year++; };
  const realmList = () => Object.values((h.s.realms ?? {}) as Record<number, Realm>);
  step();
  const r = realmList()[0];
  if (!r || r.members.length !== 5) bad.push(`no realm of five: ${JSON.stringify(realmList().map((x) => x.members))}`);
  if (r && r.capital !== 2) bad.push(`the capital is ${r.capital}, not the biggest village (2)`);
  if (r?.ruler?.id !== 102) bad.push(`the ruler is ${r?.ruler?.id}, not the capital's elder`);
  if (news.length !== 1 || !news[0].includes('realm')) bad.push(`an old world's realms were not told once: ${JSON.stringify(news)}`);
  if (!r) throw new Error(bad.join('\n'));
  // a village turns against the capital and leaves
  news.length = 0;
  rel['2-5'] = 'rival';
  step();
  if (r.members.includes(5)) bad.push('a rival of the capital stayed');
  if (!news.some((n) => n.includes('left the'))) bad.push('the leaving was not told');
  // the ruler dies; a grown son in the realm carries on the house
  people.push({ id: 200, bandId: 3, born: 0, sex: 0, motherId: null, fatherId: 102, first: 'Son' });
  people.splice(people.findIndex((p) => p.id === 102), 1);
  news.length = 0;
  step();
  if (r.ruler?.id !== 200 || r.ruler.n !== 2) bad.push(`the son did not follow as the second of the house: ${JSON.stringify(r.ruler)}`);
  if (!news.some((n) => n.includes('son of') && n.includes('second of the House'))) bad.push(`the succession was not told: ${JSON.stringify(news)}`);
  // the capital is gone: the biggest village left takes its place
  bands.splice(bands.findIndex((b) => b.id === 2), 1);
  news.length = 0;
  step();
  if (realmList()[0] && realmList()[0].capital !== 3) bad.push(`the capital did not move to the biggest village left: ${realmList()[0]?.capital}`);
  // down to one village: the realm ends
  bands.splice(0, bands.length, bands.find((b) => b.id === 3)!);
  step();
  if (realmList().length) bad.push('a realm of one village did not end');
  if (bad.length) throw new Error(bad.join('\n'));
}
