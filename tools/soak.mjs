// The server soak test: the real server on a copy of a world at high speed, every endpoint asked again and again.
//   node tools/soak.mjs <data folder> <minutes>
// Reports any answer of 500 or more, any error in the server's log, the slowest answers, memory and database size.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const data = process.argv[2], minutes = Number(process.argv[3] ?? 10);
const port = 26500, base = `http://127.0.0.1:${port}`, token = 'soak-test-token';
const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server.js'], {
  env: { ...process.env, LETOPIS_DATA: data, LETOPIS_PORT: String(port), LETOPIS_SPEED: '200', LETOPIS_ADMIN_TOKEN: token, LETOPIS_BACKUP_HOURS: '0.05' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logErrors = [];
let log = '';
const onLog = (d) => { const t = String(d); log += t; for (const l of t.split('\n')) if (/error|exception|failed/i.test(l) && !/wrong token/i.test(l)) logErrors.push(l.slice(0, 300)); };
proc.stdout.on('data', onLog); proc.stderr.on('data', onLog);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const stats = new Map(); // path kind -> { n, worst, bad }
const bad = [];
async function hit(kind, p, init = {}) {
  const a = performance.now();
  let status = 0;
  try {
    const r = await fetch(base + p, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
    status = r.status;
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const body = await r.arrayBuffer();
    const ms = performance.now() - a;
    const s = stats.get(kind) ?? { n: 0, worst: 0, bad: 0 };
    s.n++; s.worst = Math.max(s.worst, ms);
    if (status >= 500) { s.bad++; bad.push(`${status} ${p}: ${Buffer.from(body).toString().slice(0, 160)}`); }
    stats.set(kind, s);
    return { status, body };
  } catch (e) {
    bad.push(`no answer ${p}: ${e.message}`);
    return { status: 0, body: new ArrayBuffer(0) };
  }
}
const json = (b) => { try { return JSON.parse(Buffer.from(b).toString()); } catch { return null; } };
for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not yet */ } }
await hit('admin', '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
const end = Date.now() + minutes * 60_000;
let rounds = 0, rssPeak = 0;
const rss = () => { try { return Math.round(process.platform === 'win32' ? 0 : 0); } catch { return 0; } };
void rss;
while (Date.now() < end) {
  rounds++;
  const snap = json((await hit('snapshot', '/api/snapshot')).body);
  const bands = snap?.bands ?? [];
  const people = snap?.people ?? [];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const b = pick(bands), p = pick(people);
  const cultures = json((await hit('cultures', '/api/cultures')).body) ?? [];
  const realms = json((await hit('realms', '/api/realms')).body) ?? [];
  await Promise.all([
    hit('health', '/api/health'), hit('history', '/api/history'), hit('timeline', '/api/timeline'), hit('trade', '/api/trade'),
    hit('brains', '/api/brains'), hit('techtree', '/api/techtree'), hit('chronicle', '/api/chronicle?limit=80'), hit('acts', '/api/acts'),
    b && hit('brain', `/api/brain/${b.id}`), b && hit('relations', `/api/relations/${b.id}`), b && hit('people', `/api/people?band=${b.id}&sort=old&limit=200`),
    p && hit('person', `/api/person/${p[0]}`), p && hit('tree', `/api/tree/${p[0]}`),
    cultures.length && hit('culture', `/api/culture/${pick(cultures).id}`), realms.length && hit('realm', `/api/realm/${pick(realms).id}`),
    hit('search', `/api/people?q=${pick(['a', 'ivan', 'village', 'zz'])}&sort=${pick(['old', 'young', 'name', 'deeds', 'children'])}&limit=100`),
  ]);
  if (rounds % 5 === 0) { await hit('book', '/book'); await hit('bookmap', '/api/book/map.png'); await hit('adminhealth', '/api/admin/health'); await hit('adminbackups', '/api/admin/backups'); }
  if (rounds % 12 === 0) await hit('time', `/api/time?scale=${pick([1, 2, 5, 20, 100])}`, { method: 'POST' });
  if (rounds % 20 === 0) await hit('backup', '/api/admin/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const h = json((await hit('adminhealth', '/api/admin/health')).body);
  if (h) rssPeak = Math.max(rssPeak, h.memoryMB ?? 0);
  if (rounds % 30 === 0 && h) console.log(`round ${rounds}: year ${h.year}, ${h.people} people, memory ${h.memoryMB} MB, database ${h.databaseMB} MB, a month takes ${h.monthMs} ms`);
}
const h = json((await hit('adminhealth', '/api/admin/health')).body);
proc.kill();
await wait(1500);
let db = 0; try { db = Math.round(statSync(path.join(data, 'letopis.db')).size / 1048576); } catch { /* none */ }
console.log(JSON.stringify({
  rounds, end: h, memoryPeakMB: rssPeak, databaseMB: db, serverErrors: logErrors.slice(0, 20), badAnswers: bad.slice(0, 20),
  slowest: [...stats].sort((a, b) => b[1].worst - a[1].worst).slice(0, 8).map(([k, v]) => `${k}: ${Math.round(v.worst)} ms (${v.n} asked)`),
}, null, 1));
