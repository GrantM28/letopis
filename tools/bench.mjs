// Runs the brain benchmark: every world with every variant, a few at a time, then prints a table.
//   node tools/bench.mjs [years] [variants, e.g. brain1,brain2,frozen] [seeds, e.g. 5,11,21,42,3,77]
// Build first: npm run bench:build. Results also go to dist/bench-<variant>.jsonl.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

const years = Number(process.argv[2] ?? 3000);
const variants = (process.argv[3] ?? 'brain1,brain2,frozen').split(',');
const seeds = (process.argv[4] ?? '5,11,21,42,3,77').split(',').map(Number);
const env = { brain1: { LETOPIS_BRAIN: '1' }, brain2: {}, frozen: { LETOPIS_NO_LEARN: '1' }, frozen1: { LETOPIS_NO_LEARN: '1', LETOPIS_BRAIN: '1' }, even: { LETOPIS_FIXED: '1,1,1,1,1,1,0.5,0.2' }, forage: { LETOPIS_FIXED: '0.3,0.3,0.3,0.3,0.3,4,0.5,0.2' }, still: { LETOPIS_FIXED: '1,1,1,1,1,1,0.5,0' }, roam: { LETOPIS_FIXED: '1,1,1,1,1,1,0.5,0.9' }, g0: { LETOPIS_B2_GROWTH: '0' }, g2: { LETOPIS_B2_GROWTH: '2' }, s12: { LETOPIS_B2_SIGMA: '0.12' }, r10: { LETOPIS_B2_RATE: '0.1' }, s12r10: { LETOPIS_B2_SIGMA: '0.12', LETOPIS_B2_RATE: '0.1' }, st0: { LETOPIS_B2_STEWARD: '0' }, st3: { LETOPIS_B2_STEWARD: '3' }, st3g0: { LETOPIS_B2_STEWARD: '3', LETOPIS_B2_GROWTH: '0' }, noenvy: { LETOPIS_B2_ENVY: '99' }, st0g2: { LETOPIS_B2_STEWARD: '0', LETOPIS_B2_GROWTH: '2' }, g2noenvy: { LETOPIS_B2_GROWTH: '2', LETOPIS_B2_ENVY: '99' }, halves: { LETOPIS_B2_HALVES: '1', LETOPIS_B2_GROWTH: '2' }, halvesne: { LETOPIS_B2_HALVES: '1', LETOPIS_B2_GROWTH: '2', LETOPIS_B2_ENVY: '99' }, p120: {LETOPIS_B2_FOOD: '0',LETOPIS_B2_STEWARD: '0',LETOPIS_B2_GROWTH: '1',LETOPIS_B2_PERIOD: '120'}, p120ne: {LETOPIS_B2_FOOD: '0',LETOPIS_B2_STEWARD: '0',LETOPIS_B2_GROWTH: '1',LETOPIS_B2_PERIOD: '120',LETOPIS_B2_ENVY: '99'}, p60: {LETOPIS_B2_FOOD: '0',LETOPIS_B2_STEWARD: '0',LETOPIS_B2_GROWTH: '1',LETOPIS_B2_PERIOD: '60'}, p120s12: {LETOPIS_B2_FOOD: '0',LETOPIS_B2_STEWARD: '0',LETOPIS_B2_GROWTH: '1',LETOPIS_B2_PERIOD: '120',LETOPIS_B2_SIGMA: '0.12'}, p36: { LETOPIS_B2_FOOD: '0', LETOPIS_B2_STEWARD: '0', LETOPIS_B2_GROWTH: '1', LETOPIS_B2_PERIOD: '36' }, craftfix: { LETOPIS_FIXED: '0.5,0.5,0.5,3,0.5,0.5,0.5,0.2' }, b2off: {}, b2p3: { LETOPIS_PASTURE: '3' }, b2p15: { LETOPIS_PASTURE: '1.5' }, frzp3: { LETOPIS_PASTURE: '3', LETOPIS_NO_LEARN: '1' }, fishherd: { LETOPIS_FIXED: '0.5,3,3,1,0.5,0.5,0.5,0.2' } };
const jobs = variants.flatMap((v) => seeds.map((s) => [v, s]));
for (const v of variants) writeFileSync(`dist/bench-${v}${process.env.BENCH_TAG ?? ''}.jsonl`, '');
const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [v, s] = jobs[next++];
    const out = await new Promise((res) => {
      let o = '';
      const p = spawn(process.execPath, [process.env.BENCH_BUNDLE ?? 'dist/bench.mjs', String(s), String(years)], { env: { ...process.env, ...env[v] } });
      p.stdout.on('data', (d) => (o += d));
      p.stderr.on('data', (d) => process.stderr.write(d));
      p.on('close', () => res(o.trim()));
    });
    try { const r = JSON.parse(out.split('\n').pop()); r.variant = v; results.push(r); appendFileSync(`dist/bench-${v}${process.env.BENCH_TAG ?? ''}.jsonl`, JSON.stringify(r) + '\n'); console.log(v, s, 'pop', r.pop, 'avg', r.avgPop, 'variety', r.variety); }
    catch { console.log(v, s, 'FAILED', out.slice(0, 300)); }
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs.length, cpus().length - 1)) }, worker));
console.log('\nvariant   avgPop   finalPop  variety  biggest  discov  ms/month');
for (const v of variants) {
  const rs = results.filter((r) => r.variant === v);
  const m = (f) => rs.length ? rs.reduce((a, r) => a + f(r), 0) / rs.length : 0;
  console.log(v.padEnd(9), String(Math.round(m((r) => r.avgPop))).padStart(7), String(Math.round(m((r) => r.pop))).padStart(10),
    m((r) => r.variety).toFixed(2).padStart(8), String(Math.max(...rs.map((r) => r.biggest))).padStart(8),
    m((r) => r.discovered).toFixed(1).padStart(7), m((r) => r.msPerMonth).toFixed(2).padStart(9));
}
