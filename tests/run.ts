// npm test: every check that must hold before a release. `npm test -- english smoke` runs only those.
// Each test returns nothing when all is well and throws (with a reason) when not.

import { techtree } from './techtree';
import { english } from './english';
import { smoke } from './smoke';
import { saveload } from './saveload';
import { determinism } from './determinism';
import { api } from './api';
import { brain2, brainsForgotten } from './brain2';
import { forget } from './forget';
import { backups } from './backups';

const ALL: [string, () => Promise<void> | void][] = [
  ['techtree', techtree], ['english', english], ['determinism', determinism], ['saveload', saveload], ['smoke', smoke], ['brain2', brain2], ['brainsForgotten', brainsForgotten], ['forget', forget], ['backups', backups], ['api', api],
];

const only = process.argv.slice(2);
let failed = 0;
for (const [name, fn] of ALL) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n       ${(e as Error).message.split('\n').join('\n       ')}`);
  }
}
if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
console.log('all tests passed');
