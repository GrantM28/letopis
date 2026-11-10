// The admin page (admin.ts) on a real server: off without a token, the token and the cookie, a backup, a roll back that
// trims the chronicle to match, and a new world from a chosen seed. Run `npm run build` first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'test-token-0123456789';

async function server(env: Record<string, string>) {
  const data = mkdtempSync(path.join(tmpdir(), 'letopis-admin-'));
  const port = 25000 + Math.floor(Math.random() * 2000);
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server.js'], {
    env: { ...process.env, LETOPIS_PORT: String(port), LETOPIS_DATA: data, LETOPIS_SPEED: '400', LETOPIS_NTFY_URL: '', LETOPIS_WEBHOOK_URL: '', LETOPIS_SEED: '7', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const call = async (p: string, method = 'GET', body?: unknown, type = 'application/json') => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'content-type': type } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* the page */ }
    return { status: r.status, json, text };
  };
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await wait(250); try { up = (await call('/api/health')).status === 200; } catch { /* not yet */ } }
  // (Windows keeps the files locked until the process has really gone)
  const stop = async () => {
    const gone = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await Promise.race([gone, wait(5000)]);
    rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  if (!up) { await stop(); throw new Error(`the server did not start:\n${log.slice(-600)}`); }
  return { call, stop, log: () => log, setCookie: (c: string) => { cookie = c; } };
}

export async function admin() {
  const bad: string[] = [];
  // off without a token
  const off = await server({ LETOPIS_ADMIN_TOKEN: '' });
  try {
    const st = await off.call('/api/admin/status');
    if (st.json.enabled !== false) bad.push('the admin page is on without a token');
    if ((await off.call('/api/admin/health')).status !== 404) bad.push('admin health answered with the page off');
  } finally { await off.stop(); }

  const s = await server({ LETOPIS_ADMIN_TOKEN: TOKEN });
  try {
    if (!(await s.call('/admin')).text.includes('Letopis admin')) bad.push('/admin does not serve the page');
    if ((await s.call('/api/admin/health')).status !== 401) bad.push('health answered without logging in');
    if ((await s.call('/api/admin/login', 'POST', { token: 'wrong' })).status !== 403) bad.push('a wrong token was not refused');
    if ((await s.call('/api/admin/login', 'POST', { token: TOKEN })).status !== 429) bad.push('a second try within a second was not slowed down');
    await wait(1100);
    if ((await s.call('/api/admin/login', 'POST', { token: TOKEN }, 'text/plain')).status !== 415) bad.push('a login that is not JSON was accepted');
    await wait(1100);
    const ok = await s.call('/api/admin/login', 'POST', { token: TOKEN });
    if (!ok.json.ok) bad.push(`could not log in: ${ok.status}`);
    if (s.log().includes(TOKEN)) bad.push('the token appeared in the log');
    const h = await s.call('/api/admin/health');
    if (h.status !== 200 || typeof h.json.people !== 'number') bad.push(`health: ${h.status}`);
    // a forged cookie is refused
    // a backup, then let the world run, then roll back to it
    const b = await s.call('/api/admin/backup', 'POST', {});
    const backup = b.json.backup as { file: string; year: number; tick: number } | undefined;
    if (!backup) bad.push(`no backup: ${b.text.slice(0, 120)}`);
    await wait(3000);
    const before = (await s.call('/api/chronicle?limit=1')).json as unknown as { id: number; year: number }[];
    const list = await s.call('/api/admin/backups');
    const row = (list.json.backups as { file: string; canRollBack: boolean }[]).find((x) => x.file === backup?.file);
    if (!row?.canRollBack) bad.push('the backup cannot be rolled back to');
    if ((await s.call('/api/admin/rollback', 'POST', { file: '../world.json.gz' })).json.error === undefined) bad.push('a roll back to a bad name was accepted');
    const rb = await s.call('/api/admin/rollback', 'POST', { file: backup?.file });
    if (!rb.json.ok) bad.push(`roll back failed: ${rb.text.slice(0, 160)}`);
    const after = await s.call('/api/health');
    if ((after.json.year as number) > (backup?.year ?? 0) + 1) bad.push(`after the roll back the year is ${after.json.year}, the backup was ${backup?.year}`);
    const chron = (await s.call('/api/chronicle?limit=50')).json as unknown as { year: number; kind: string; id: number }[];
    if (!chron.some((e) => e.kind === 'rollback')) bad.push('the roll back is not in the chronicle');
    if (chron.some((e) => e.kind !== 'rollback' && e.year > (backup?.year ?? 0) + 1)) bad.push('chronicle entries from after the backup are still there');
    if (before[0] && (rb.json.chronicle as number) <= 0 && before[0].year > (backup?.year ?? 0)) bad.push('no chronicle entries were removed');
    // a new world from a seed
    await wait(1500);
    const nw = await s.call('/api/admin/newworld', 'POST', { seed: 12345 });
    if (!nw.json.ok || nw.json.seed !== 12345) bad.push(`new world: ${nw.text.slice(0, 120)}`);
    const nh = await s.call('/api/admin/health');
    if (nh.json.seed !== 12345 || (nh.json.year as number) > -11990) bad.push(`the new world is not fresh: seed ${nh.json.seed}, year ${nh.json.year}`);
    if ((await s.call('/api/admin/newworld', 'POST', { seed: 'abc' })).status !== 400) bad.push('a bad seed was accepted');
    // logged out, and a made-up cookie gets nothing
    await s.call('/api/admin/logout', 'POST', {});
    s.setCookie('letopis_admin=' + '0'.repeat(64));
    if ((await s.call('/api/admin/health')).status !== 401) bad.push('a made-up cookie was accepted');
  } finally { await s.stop(); }
  if (bad.length) throw new Error(bad.join('\n'));
}
