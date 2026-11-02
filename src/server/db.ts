import { DatabaseSync } from 'node:sqlite';
import { ChronicleEntry, GoneBand } from '../shared/types';
import type { DeadRecord } from './sim/sim';

export class Store {
  db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS chronicle (
        world TEXT NOT NULL, id INTEGER NOT NULL, tick INTEGER, year INTEGER, kind TEXT, importance INTEGER,
        text TEXT, kids TEXT, person INTEGER, band INTEGER, PRIMARY KEY (world, id)
      );
      CREATE INDEX IF NOT EXISTS chronicle_imp ON chronicle (world, importance, id);
      CREATE TABLE IF NOT EXISTS dead (world TEXT NOT NULL, id INTEGER NOT NULL, json TEXT, PRIMARY KEY (world, id));
      CREATE TABLE IF NOT EXISTS stats (
        world TEXT NOT NULL, tick INTEGER, year INTEGER, population INTEGER, bands INTEGER, era INTEGER, techs INTEGER,
        PRIMARY KEY (world, tick)
      );
      CREATE TABLE IF NOT EXISTS gone_bands (world TEXT NOT NULL, id INTEGER NOT NULL, json TEXT, PRIMARY KEY (world, id));
      CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, started INTEGER, ended INTEGER, summary TEXT);
    `);
    // v1.11: names in the chronicle link to people and bands
    const cols = this.db.prepare('PRAGMA table_info(chronicle)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'refs')) this.db.exec('ALTER TABLE chronicle ADD COLUMN refs TEXT');
  }

  addGoneBands(world: string, gone: GoneBand[]) {
    if (!gone.length) return;
    const st = this.db.prepare('INSERT OR REPLACE INTO gone_bands VALUES (?,?,?)');
    for (const g of gone) st.run(world, g.id, JSON.stringify(g));
  }

  getGoneBand(world: string, id: number): GoneBand | null {
    const row = this.db.prepare('SELECT json FROM gone_bands WHERE world = ? AND id = ?').get(world, id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  addEvents(world: string, events: ChronicleEntry[]) {
    if (!events.length) return;
    const st = this.db.prepare('INSERT OR REPLACE INTO chronicle (world, id, tick, year, kind, importance, text, kids, person, band, refs) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    this.db.exec('BEGIN');
    for (const e of events) {
      st.run(world, e.id, e.tick, Math.floor(e.year), e.kind, e.importance, e.text, e.kids ?? null, e.personId ?? null, e.bandId ?? null,
        e.refs?.length ? JSON.stringify(e.refs) : null);
    }
    this.db.exec('COMMIT');
  }

  addDead(world: string, dead: DeadRecord[]) {
    if (!dead.length) return;
    const st = this.db.prepare('INSERT OR REPLACE INTO dead VALUES (?,?,?)');
    this.db.exec('BEGIN');
    for (const d of dead) st.run(world, d.id, JSON.stringify(d));
    this.db.exec('COMMIT');
  }

  getDead(world: string, id: number): DeadRecord | null {
    const row = this.db.prepare('SELECT json FROM dead WHERE world = ? AND id = ?').get(world, id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  addStat(world: string, s: { tick: number; year: number; population: number; bands: number; era: number; techs: number }) {
    this.db.prepare('INSERT OR REPLACE INTO stats VALUES (?,?,?,?,?,?,?)').run(world, s.tick, s.year, s.population, s.bands, s.era, s.techs);
  }

  stats(world: string, max = 400) {
    const rows = this.db.prepare('SELECT tick, year, population, bands, era, techs FROM stats WHERE world = ? ORDER BY tick').all(world) as Record<string, number>[];
    if (rows.length <= max) return rows;
    const step = rows.length / max;
    const out = [];
    for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
    out.push(rows[rows.length - 1]);
    return out;
  }

  chronicle(world: string, opts: { before?: number; after?: number; min?: number; limit?: number }): ChronicleEntry[] {
    const limit = Math.min(500, opts.limit ?? 60);
    const min = opts.min ?? 1;
    let rows: Record<string, unknown>[];
    if (opts.after !== undefined) {
      rows = this.db.prepare('SELECT * FROM chronicle WHERE world = ? AND importance >= ? AND id > ? ORDER BY id ASC LIMIT ?')
        .all(world, min, opts.after, limit) as Record<string, unknown>[];
    } else {
      rows = this.db.prepare('SELECT * FROM chronicle WHERE world = ? AND importance >= ? AND id < ? ORDER BY id DESC LIMIT ?')
        .all(world, min, opts.before ?? 2 ** 31, limit) as Record<string, unknown>[];
    }
    return rows.map((r) => ({
      id: r.id as number, tick: r.tick as number, year: r.year as number, kind: r.kind as string,
      importance: r.importance as number, text: r.text as string, kids: (r.kids as string) ?? undefined,
      personId: (r.person as number) ?? undefined, bandId: (r.band as number) ?? undefined,
      refs: r.refs ? JSON.parse(r.refs as string) : undefined,
    }));
  }

  countSince(world: string, after: number): { total: number; big: number } {
    const r = this.db.prepare('SELECT COUNT(*) AS total, SUM(importance >= 2) AS big FROM chronicle WHERE world = ? AND id > ?').get(world, after) as { total: number; big: number | null };
    return { total: r.total, big: r.big ?? 0 };
  }

  startWorld(id: string) {
    this.db.prepare('INSERT OR IGNORE INTO worlds VALUES (?,?,NULL,NULL)').run(id, Date.now());
  }

  endWorld(id: string, summary: string) {
    this.db.prepare('UPDATE worlds SET ended = ?, summary = ? WHERE id = ?').run(Date.now(), summary, id);
  }

  worlds() {
    return this.db.prepare('SELECT * FROM worlds ORDER BY started DESC').all();
  }
}
