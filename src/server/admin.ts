// The admin page (fork, 1.52): backups, roll back, a new world from a seed, the server's health.
//
// Off unless LETOPIS_ADMIN_TOKEN is set. The token is typed once on /admin; the server answers with a cookie (a keyed hash
// of the token, so it survives restarts and dies when the token changes). The token is never put in a URL or a log.
// Every change is a POST with a JSON body: a page on another site cannot send one (SameSite=Strict, and JSON needs CORS).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import type { Backups } from './backups';
import { Simulation, type SimState, yearOf } from './sim/sim';

export interface AdminHost {
  sim(): Simulation;
  /** put a different world in place (saves it, tells every open page to reload) */
  replace(next: Simulation): void;
  /** close the current world as when it dies out: archived, written in the list of worlds */
  archive(summary: string): void;
  flush(): void;
  save(): void;
  db: DatabaseSync;
  backups: Backups;
  dataDir: string;
  stateFile: string;
  publicDir: string;
  monthMs(): number;
  timeScale(): number;
  log(...a: unknown[]): void;
}

const COOKIE = 'letopis_admin';
const json = (res: http.ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

export class Admin {
  private token = (process.env.LETOPIS_ADMIN_TOKEN ?? '').trim();
  private fails: number[] = [];
  private nextTry = 0;
  private started = Date.now();
  constructor(private host: AdminHost) {}

  get enabled(): boolean { return this.token.length > 0; }

  private session(): string {
    return createHmac('sha256', this.token).update('letopis-admin-session').digest('hex');
  }

  private loggedIn(req: http.IncomingMessage): boolean {
    if (!this.enabled) return false;
    const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})`));
    if (!m) return false;
    const a = Buffer.from(m[1]), b = Buffer.from(this.session());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** true when the request was the admin's to answer */
  handle(req: http.IncomingMessage, res: http.ServerResponse, p: string): boolean {
    if (p === '/admin' || p === '/admin/') {
      const file = path.join(this.host.publicDir, 'admin.html');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(existsSync(file) ? readFileSync(file) : 'admin.html is missing');
      return true;
    }
    if (!p.startsWith('/api/admin/')) return false;
    const what = p.slice('/api/admin/'.length);
    if (what === 'status') { json(res, { enabled: this.enabled, loggedIn: this.loggedIn(req) }); return true; }
    if (!this.enabled) { json(res, { error: 'the admin page is off: set LETOPIS_ADMIN_TOKEN on the container' }, 404); return true; }
    if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      json(res, { error: 'send JSON' }, 415);
      return true;
    }
    if (what === 'login' && req.method === 'POST') { void this.login(req, res); return true; }
    if (what === 'logout' && req.method === 'POST') {
      json(res, { ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
      return true;
    }
    if (!this.loggedIn(req)) { json(res, { error: 'log in first' }, 401); return true; }
    void this.route(req, res, what).catch((e) => {
      this.host.log('Admin error', e);
      if (!res.headersSent) json(res, { error: String((e as Error).message ?? e) }, 500);
    });
    return true;
  }

  private async login(req: http.IncomingMessage, res: http.ServerResponse) {
    const now = Date.now();
    this.fails = this.fails.filter((t) => now - t < 10 * 60_000);
    // wrong tokens are slowed down: one try a second, and none for ten minutes after twenty wrong ones
    if (now < this.nextTry || this.fails.length >= 20) { json(res, { error: 'too many tries, wait a little' }, 429); return; }
    const body = await readJson(req);
    const given = Buffer.from(String((body as { token?: unknown })?.token ?? ''));
    const want = Buffer.from(this.token);
    const ok = given.length === want.length && timingSafeEqual(given, want);
    if (!ok) {
      this.fails.push(now);
      this.nextTry = now + 1000;
      this.host.log('Admin: a wrong token was tried');
      json(res, { error: 'wrong token' }, 403);
      return;
    }
    this.host.log('Admin: logged in');
    json(res, { ok: true }, 200, { 'set-cookie': `${COOKIE}=${this.session()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}` });
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse, what: string) {
    const h = this.host;
    if (what === 'health' && req.method === 'GET') { json(res, this.health()); return; }
    if (what === 'backups' && req.method === 'GET') {
      const sim = h.sim();
      const list = await h.backups.list();
      json(res, { enabled: h.backups.enabled, keep: h.backups.keep, everyHours: h.backups.everyMs / 3600_000, world: sim.s.worldId,
        backups: list.map((b) => ({ ...b, canRollBack: b.world === sim.s.worldId && b.tick <= sim.s.tick })) });
      return;
    }
    if (what.startsWith('backups/') && req.method === 'GET') {
      // download one
      const file = decodeURIComponent(what.slice('backups/'.length));
      const at = await h.backups.pathOf(file);
      if (!at) { json(res, { error: 'no such backup' }, 404); return; }
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store' });
      res.end(readFileSync(at));
      return;
    }
    if (what === 'backup' && req.method === 'POST') {
      const b = await this.backupNow('manual');
      json(res, b ? { ok: true, backup: b } : { error: 'backups are off (LETOPIS_BACKUPS=0) or one is being made' }, b ? 200 : 409);
      return;
    }
    if (what === 'rollback' && req.method === 'POST') {
      const body = (await readJson(req)) as { file?: unknown };
      json(res, await this.rollback(String(body?.file ?? '')));
      return;
    }
    if (what === 'newworld' && req.method === 'POST') {
      const body = (await readJson(req)) as { seed?: unknown };
      const raw = body?.seed;
      const seed = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
      if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31)) { json(res, { error: 'the seed must be a whole number from 0 to 2147483647' }, 400); return; }
      json(res, await this.newWorld(seed));
      return;
    }
    json(res, { error: 'no such admin action' }, 404);
  }

  private health() {
    const h = this.host, sim = h.sim();
    const size = (f: string) => { try { return statSync(f).size; } catch { return 0; } };
    const db = path.join(h.dataDir, 'letopis.db');
    return {
      world: sim.s.worldId, seed: sim.s.seed, year: Math.floor(sim.year), people: sim.s.people.length, clans: sim.s.bands.length,
      villages: sim.s.bands.filter((b) => b.settled).length, cultures: Object.keys(sim.s.cultures ?? {}).length,
      monthMs: Math.round(h.monthMs()), timeScale: h.timeScale(),
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      databaseMB: Math.round((size(db) + size(`${db}-wal`)) / 1048576), saveMB: +(size(h.stateFile) / 1048576).toFixed(1),
      uptimeHours: +((Date.now() - this.started) / 3600_000).toFixed(1),
    };
  }

  private async backupNow(why: 'manual' | 'before-rollback' | 'before-new-world') {
    const h = this.host, sim = h.sim();
    h.flush();
    h.save(); // the world on disk as it is this moment
    const b = await h.backups.make(h.stateFile, { world: sim.s.worldId, year: Math.floor(sim.year), tick: sim.s.tick, people: sim.s.people.length, why });
    if (b) h.log(`Backup ${b.file} (${why})`);
    return b;
  }

  /** the world as it was in a backup; what the chronicle wrote after that moment is taken away, so history matches */
  private async rollback(file: string) {
    const h = this.host;
    const at = await h.backups.pathOf(file);
    if (!at) return { error: 'no such backup' };
    const state = JSON.parse(gunzipSync(readFileSync(at)).toString('utf8')) as SimState;
    const now = h.sim();
    if (state.worldId !== now.s.worldId) return { error: 'that backup is of another world' };
    if (state.tick > now.s.tick) return { error: 'that backup is ahead of the world' };
    await this.backupNow('before-rollback');
    const next = new Simulation(state);
    const trimmed = trimAfter(h.db, state);
    h.replace(next);
    const year = Math.floor(next.year);
    const y = year < 0 ? `${-year} BC` : `AD ${year}`;
    next.host().emit('rollback', 2, `Светът беше върнат към ${year < 0 ? `${-year} пр.н.е.` : `${year} г.`}.`, undefined, undefined, undefined, [],
      [`The world was turned back to ${y}.`]);
    h.flush();
    h.log(`Admin: rolled back to ${file} (year ${year}); removed ${trimmed.chronicle} chronicle entries and ${trimmed.dead} dead`);
    return { ok: true, year, ...trimmed };
  }

  private async newWorld(seed?: number) {
    const h = this.host;
    await this.backupNow('before-new-world');
    const old = h.sim();
    h.archive(`Ended from the admin page in the year ${Math.floor(old.year)}, with ${old.s.people.length} people alive.`);
    const next = new Simulation(null, seed);
    h.replace(next);
    h.log(`Admin: new world ${next.s.worldId} (seed ${next.s.seed})`);
    return { ok: true, world: next.s.worldId, seed: next.s.seed };
  }
}

/** remove what the database holds from after a world's moment (exported for the tests) */
export function trimAfter(db: DatabaseSync, state: SimState): { chronicle: number; dead: number; stats: number } {
  const w = state.worldId, tick = state.tick, year = Math.floor(yearOf(tick));
  const n = (r: { changes: number | bigint }) => Number(r.changes);
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  db.exec('BEGIN');
  try {
    const chronicle = n(db.prepare('DELETE FROM chronicle WHERE world = ? AND id >= ?').run(w, state.nextEventId));
    // the dead are stored in the order they died: walk back from the newest until someone died before the moment
    let dead = 0;
    const back = db.prepare("SELECT rowid AS r, world, json_extract(json, '$.died') AS died FROM dead WHERE rowid < ? ORDER BY rowid DESC LIMIT 2000");
    const del = db.prepare('DELETE FROM dead WHERE rowid = ?');
    let from = Number.MAX_SAFE_INTEGER;
    for (let done = false; !done;) {
      const rows = back.all(from) as { r: number; world: string; died: number }[];
      if (!rows.length) break;
      for (const row of rows) {
        from = row.r;
        if (row.world !== w) continue;
        if (row.died > tick) { del.run(row.r); dead++; } else { done = true; break; }
      }
    }
    let stats = n(db.prepare('DELETE FROM stats WHERE world = ? AND tick > ?').run(w, tick));
    db.prepare("DELETE FROM gone_bands WHERE world = ? AND json_extract(json, '$.endedYear') > ?").run(w, year);
    if (has('x_years')) stats += n(db.prepare('DELETE FROM x_years WHERE world = ? AND year > ?').run(w, year));
    if (has('x_learning')) db.prepare('DELETE FROM x_learning WHERE world = ? AND year > ?').run(w, year);
    if (has('x_history')) db.prepare('DELETE FROM x_history WHERE world = ? AND id >= ?').run(w, state.nextEventId);
    db.exec('COMMIT');
    return { chronicle, dead, stats };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
