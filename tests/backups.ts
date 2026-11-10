// Daily backups (backups.ts): taken on schedule, only the newest kept, bad names refused, and a backup loads as the world.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Backups } from '../src/server/backups';
import { Simulation } from '../src/server/sim/sim';

const T0 = Date.UTC(2026, 10, 10);

export async function backups() {
  const dir = mkdtempSync(path.join(tmpdir(), 'letopis-backups-'));
  const bad: string[] = [];
  try {
    const sim = new Simulation(null, 3);
    for (let i = 0; i < 24; i++) { sim.step(); sim.events = []; sim.deadQueue = []; sim.goneQueue = []; }
    const state = path.join(dir, 'world.json.gz');
    writeFileSync(state, gzipSync(JSON.stringify(sim.serialize())));
    const b = new Backups(dir, 3, 24);
    await b.init();
    if (!b.due(T0)) bad.push('no backup due when there is none');
    const day = 24 * 3600_000;
    const info = { world: sim.s.worldId, year: Math.floor(sim.year), tick: sim.s.tick, people: sim.s.people.length, why: 'daily' as const };
    for (let k = 0; k < 5; k++) await b.make(state, info, T0 + k * day);
    if (b.due(T0 + 4 * day + 3600_000)) bad.push('a backup was due an hour after the last');
    if (!b.due(T0 + 5 * day)) bad.push('no backup due a day after the last');
    const list = await b.list();
    if (list.length !== 3) bad.push(`${list.length} backups kept, not 3`);
    if (list[0]?.at !== T0 + 4 * day) bad.push('the newest backup is not first');
    // a fresh Backups (a restart) knows when the last one was taken
    const again = new Backups(dir, 3, 24);
    await again.init();
    if (again.due(T0 + 4 * day + 3600_000)) bad.push('after a restart a backup was due too early');
    // names from outside are checked
    for (const name of ['../world.json.gz', 'nothing.json.gz', list[0].file.replace('.json.gz', '.meta.json')]) {
      if (await b.pathOf(name)) bad.push(`pathOf accepted ${name}`);
    }
    // the backup is the world
    const p = await b.pathOf(list[0].file);
    if (!p) bad.push('pathOf refused a real backup');
    else {
      const loaded = new Simulation(JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')));
      if (loaded.s.tick !== sim.s.tick || loaded.s.people.length !== sim.s.people.length) bad.push('the backup does not load as the same world');
    }
    // off when keep is 0
    if (new Backups(dir, 0, 24).due(9e15)) bad.push('backups not off with LETOPIS_BACKUPS=0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (bad.length) throw new Error(bad.join('\n'));
}
