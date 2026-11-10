// The built server (dist/server.js, so run `npm run build` first) starts with an empty data folder and answers its API.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api() {
  const data = mkdtempSync(path.join(tmpdir(), 'letopis-test-'));
  const port = 23000 + Math.floor(Math.random() * 2000);
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server.js'], {
    env: { ...process.env, LETOPIS_PORT: String(port), LETOPIS_DATA: data, LETOPIS_SPEED: '50', LETOPIS_NTFY_URL: '', LETOPIS_WEBHOOK_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const get = async (p: string, method = 'GET') => {
    const r = await fetch(base + p, { method });
    const text = await r.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: body as Record<string, unknown> | unknown[] | null, text };
  };
  const bad: string[] = [];
  try {
    // wait for it to listen
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await wait(250); try { up = (await get('/api/health')).status === 200; } catch { /* not yet */ } }
    if (!up) throw new Error(`the server did not start:\n${log.slice(-800)}`);
    await wait(1500); // a few months
    // a new server takes its first daily backup at once (backups.ts)
    const bdir = path.join(data, 'backups');
    if (!existsSync(bdir) || !readdirSync(bdir).some((n) => n.endsWith('.json.gz'))) bad.push('no backup was taken when the server started');
    const expect: [string, string[]][] = [
      ['/api/health', ['ok', 'year', 'population']], ['/api/world', ['worldId', 'w', 'h']], ['/api/snapshot', ['bands', 'people', 'time']],
      ['/api/history', ['series', 'causes', 'records', 'learning']], ['/api/brains', ['clans', 'styles', 'network']], ['/api/cultures', []], ['/api/timeline', ['events', 'cultures', 'population']], ['/api/techtree', ['clans', 'techs']],
      ['/api/people?limit=5', ['total', 'people']], ['/api/acts', ['acts', 'prayers']], ['/api/time', ['scale', 'scales']],
      ['/api/discoveries', []], ['/api/chronicle?limit=5', []], ['/api/heroes', []],
    ];
    for (const [p, keys] of expect) {
      const r = await get(p);
      if (r.status !== 200 || r.body === null) { bad.push(`${p}: ${r.status} ${r.text.slice(0, 80)}`); continue; }
      for (const k of keys) if (!(k in (r.body as Record<string, unknown>))) bad.push(`${p}: no "${k}"`);
    }
    // a clan's card
    const snap = (await get('/api/snapshot')).body as { bands: { id: number }[] };
    const id = snap.bands[0]?.id;
    for (const p of [`/api/band/${id}`, `/api/brain/${id}`, `/api/relations/${id}`, `/api/people?band=${id}`]) {
      const r = await get(p);
      if (r.status !== 200) bad.push(`${p}: ${r.status}`);
    }
    // the clock and a power
    if (((await get('/api/time?scale=0', 'POST')).body as { scale?: number })?.scale !== 0) bad.push('could not pause');
    if (((await get('/api/time?scale=7', 'POST')).status) !== 400) bad.push('a wrong speed was accepted');
    if (((await get('/api/time?scale=1', 'POST')).body as { scale?: number })?.scale !== 1) bad.push('could not resume');
    const bless = await get(`/api/act/bless?band=${id}`, 'POST');
    if (!(bless.body as { ok?: boolean })?.ok) bad.push(`blessing failed: ${bless.text.slice(0, 80)}`);
    if ((await get('/api/act/bless', 'POST')).status !== 429) bad.push('a second blessing was not refused');
    if ((await get('/api/nothing-here')).status !== 200) bad.push('unknown paths should serve the page');
    // bad input gets a clear answer, never a crash or a quiet guess
    if ((await get('/api/chronicle?limit=abc')).status !== 200) bad.push('/api/chronicle?limit=abc did not answer');
    if ((await get('/api/people?band=abc')).status !== 400) bad.push('/api/people?band=abc was not refused');
    if ((await get('/api/act/rain?band=abc', 'POST')).status !== 400) bad.push('an act on a clan named abc was not refused');
    if ((await get('/api/act/rain?band=999999', 'POST')).status !== 404) bad.push('an act on a clan that is gone was not refused');
  } finally {
    server.kill();
    await wait(500);
    try { rmSync(data, { recursive: true, force: true }); } catch { /* still closing */ }
  }
  if (bad.length) throw new Error(bad.join('\n'));
}
