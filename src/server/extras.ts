// More history for the statistics page, and the small acts of the people watching.
// Owns its own tables in the same SQLite file, so the upstream Store stays as it is.
//   GET  /api/history   yearly series, causes of death, kinds of events, the ages, records
//   GET  /api/acts      what a watcher may do now, and when each act is ready again
//   POST /api/act/:kind a blessing, rain or a feast (one per cooldown for everyone watching)

import type http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Simulation } from './sim/sim';
import { ACTS, ACT_COOLDOWN_MIN, ActKind, PRAYER_TTL_MS } from './sim/events';
import { brainSummary, brainView } from './sim/brain';
import { causeEn, personEn, bandTextEn } from '../shared/i18n';
import { TECHS } from './sim/tech';
import { relationCounts, relationsOf } from './sim/relations';

type Json = (res: http.ServerResponse, data: unknown, status?: number) => void;

interface Records {
  largestBand?: { size: number; name: string; year: number };
  oldest?: { age: number; name: string; id: number; year: number };
  peak?: { population: number; year: number };
  mostClans?: { bands: number; year: number };
}

export class Extras {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS x_years (
        world TEXT NOT NULL, year INTEGER NOT NULL, population INTEGER, bands INTEGER, villages INTEGER,
        born_total INTEGER, died_total INTEGER, techs INTEGER, era INTEGER, avg_age REAL, children INTEGER, elders INTEGER,
        PRIMARY KEY (world, year)
      );
      CREATE TABLE IF NOT EXISTS x_counts (world TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER, PRIMARY KEY (world, kind, key));
      CREATE TABLE IF NOT EXISTS x_records (world TEXT PRIMARY KEY, json TEXT);
      CREATE TABLE IF NOT EXISTS x_acts (world TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER, band TEXT, PRIMARY KEY (world, kind));
      CREATE TABLE IF NOT EXISTS x_settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS x_learning (world TEXT NOT NULL, year INTEGER NOT NULL, score REAL, gen REAL, kept INTEGER, tried INTEGER, PRIMARY KEY (world, year));
    `);
  }

  /** a setting kept between restarts (the speed of time, ...) */
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM x_settings WHERE key = ?').get(key) as { value: string } | undefined;
    try { return row ? (JSON.parse(row.value) as T) : fallback; } catch { return fallback; }
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO x_settings VALUES (?, ?)').run(key, JSON.stringify(value));
  }

  /** after every month of the world, before the chronicle and the dead are written away */
  onTick(sim: Simulation) {
    const w = sim.s.worldId;
    const bump = this.db.prepare('INSERT INTO x_counts VALUES (?,?,?,1) ON CONFLICT(world, kind, key) DO UPDATE SET n = n + 1');
    if (sim.deadQueue.length || sim.events.length) {
      this.db.exec('BEGIN');
      for (const d of sim.deadQueue) bump.run(w, 'cause', d.cause);
      for (const e of sim.events) bump.run(w, 'event', e.kind);
      this.db.exec('COMMIT');
    }
    if (sim.s.tick % 12 !== 0) return;
    const people = sim.s.people;
    const ages = people.map((p) => sim.ageOf(p));
    const year = Math.floor(sim.year);
    // the running totals: the births and deaths of each year are their differences (safe across restarts)
    this.db.prepare('INSERT OR REPLACE INTO x_years VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      w, year, people.length, sim.s.bands.length, sim.s.bands.filter((b) => b.settled).length, sim.s.totalBorn, sim.s.totalDied,
      sim.s.discovered.length, sim.s.era, ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
      ages.filter((a) => a < 12).length, ages.filter((a) => a >= 60).length,
    );
    // how well the clans' brains are doing (brain.ts): the learning curve
    const bs = brainSummary(sim.host());
    if (bs.clans) this.db.prepare('INSERT OR REPLACE INTO x_learning VALUES (?,?,?,?,?,?)').run(w, year, bs.avgScore, bs.avgGeneration, bs.kept, bs.tried);
    // records
    const rec = this.records(w);
    let changed = false;
    const counts = new Map<number, number>();
    for (const p of people) counts.set(p.bandId, (counts.get(p.bandId) ?? 0) + 1);
    for (const b of sim.s.bands) {
      const n = counts.get(b.id) ?? 0;
      if (!rec.largestBand || n > rec.largestBand.size) { rec.largestBand = { size: n, name: sim.bandEnLabel(b, true), year }; changed = true; }
    }
    people.forEach((p, i) => {
      const a = Math.floor(ages[i]);
      if (!rec.oldest || a > rec.oldest.age) { rec.oldest = { age: a, name: sim.nameEn(p), id: p.id, year }; changed = true; }
    });
    if (!rec.peak || people.length > rec.peak.population) { rec.peak = { population: people.length, year }; changed = true; }
    if (!rec.mostClans || sim.s.bands.length > rec.mostClans.bands) { rec.mostClans = { bands: sim.s.bands.length, year }; changed = true; }
    if (changed) this.db.prepare('INSERT OR REPLACE INTO x_records VALUES (?,?)').run(w, JSON.stringify(rec));
  }

  private records(world: string): Records {
    const row = this.db.prepare('SELECT json FROM x_records WHERE world = ?').get(world) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : {};
  }

  private history(world: string, max = 360) {
    const raw = this.db.prepare('SELECT year, population, bands, villages, born_total AS bornTotal, died_total AS diedTotal, techs, era, avg_age AS avgAge, children, elders FROM x_years WHERE world = ? ORDER BY year')
      .all(world) as Record<string, number>[];
    // per year: the difference to the year before (the first year has nothing to compare with)
    const rows = raw.slice(1).map((r, i) => {
      const p = raw[i], gap = Math.max(1, r.year - p.year);
      const { bornTotal, diedTotal, ...rest } = r;
      return { ...rest, births: Math.max(0, bornTotal - p.bornTotal) / gap, deaths: Math.max(0, diedTotal - p.diedTotal) / gap };
    });
    if (rows.length <= max) return rows;
    // fewer points for a long history: sum births and deaths over each step so nothing is lost
    const step = Math.ceil(rows.length / max);
    const out: Record<string, number>[] = [];
    for (let i = 0; i < rows.length; i += step) {
      const chunk = rows.slice(i, i + step);
      const last = chunk[chunk.length - 1];
      out.push({ ...last, births: chunk.reduce((s, r) => s + r.births, 0), deaths: chunk.reduce((s, r) => s + r.deaths, 0), span: chunk.length });
    }
    return out;
  }

  /** the learning curve, thinned to at most 300 points */
  private learning(world: string) {
    const rows = this.db.prepare('SELECT year, score, gen FROM x_learning WHERE world = ? ORDER BY year').all(world) as { year: number; score: number; gen: number }[];
    const step = Math.max(1, Math.ceil(rows.length / 300));
    return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  }

  private counts(world: string, kind: string): Record<string, number> {
    const rows = this.db.prepare('SELECT key, n FROM x_counts WHERE world = ? AND kind = ? ORDER BY n DESC').all(world, kind) as { key: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [kind === 'cause' ? causeEn(r.key) : r.key, r.n]));
  }

  private eras(world: string) {
    const rows = this.db.prepare("SELECT year, en, text FROM chronicle WHERE world = ? AND kind = 'era' ORDER BY id").all(world) as { year: number; en: string | null; text: string }[];
    return rows.map((r) => ({ year: r.year, text: r.en ? JSON.parse(r.en).text : r.text }));
  }

  private goneCount(world: string): { extinct: number; merged: number } {
    const rows = this.db.prepare('SELECT json FROM gone_bands WHERE world = ?').all(world) as { json: string }[];
    let extinct = 0;
    for (const r of rows) if (JSON.parse(r.json).end === 'extinct') extinct++;
    return { extinct, merged: rows.length - extinct };
  }

  private acts(world: string) {
    const now = Date.now();
    const rows = this.db.prepare('SELECT kind, at, band FROM x_acts WHERE world = ?').all(world) as { kind: string; at: number; band: string }[];
    return ACTS.map((k) => {
      const r = rows.find((x) => x.kind === k);
      const readyAt = r ? r.at + ACT_COOLDOWN_MIN[k] * 60_000 : 0;
      return { kind: k, ready: readyAt <= now, readyIn: Math.max(0, readyAt - now), last: r ? { at: r.at, band: r.band } : null };
    });
  }

  /** the routes this module answers; false lets the server go on */
  handle(req: http.IncomingMessage, res: http.ServerResponse, p: string, sim: Simulation, json: Json, notify: boolean): boolean {
    const w = sim.s.worldId;
    if (p === '/api/history') {
      json(res, {
        series: this.history(w), causes: this.counts(w, 'cause'), events: this.counts(w, 'event'), eras: this.eras(w),
        records: this.records(w), gone: this.goneCount(w), learning: this.learning(w), totalBorn: sim.s.totalBorn, totalDied: sim.s.totalDied,
        year: Math.floor(sim.year), era: sim.s.era, notify, relations: relationCounts(sim.host()),
      });
      return true;
    }
    if (p === '/api/acts') {
      const bands = new Map(sim.s.bands.map((b) => [b.id, b]));
      const prayers = (sim.s.prayers ?? []).filter((x) => bands.has(x.band)).map((x) => ({
        id: x.id, band: x.band, name: sim.bandEnLabel(bands.get(x.band)!, true), color: bands.get(x.band)!.color, want: x.want, year: x.year,
        fadesIn: Math.max(0, x.at + PRAYER_TTL_MS - Date.now()),
      }));
      json(res, { acts: this.acts(w), prayers });
      return true;
    }
    if (p.startsWith('/api/prayer/') && req.method === 'POST') {
      // answering a prayer needs no waiting time: the clan asked for it
      const r = sim.answerPrayer(Number(p.split('/').pop()));
      if (!r) { json(res, { error: 'that prayer has faded' }, 404); return true; }
      json(res, { ok: true, band: sim.bandEnLabel(r.band, true), bandId: r.band.id, want: r.want });
      return true;
    }
    if (p === '/api/brains') { json(res, brainSummary(sim.host())); return true; }
    if (p === '/api/techtree') {
      // every discovery: what it needs, how many clans know it now, and who found it first
      const knownBy = new Map<string, number>();
      for (const b of sim.s.bands) for (const t of b.techs) knownBy.set(t, (knownBy.get(t) ?? 0) + 1);
      const firsts = new Map((sim.s.firsts ?? []).map((f) => [f.tech, f]));
      json(res, {
        clans: sim.s.bands.length,
        techs: TECHS.map((t) => {
          const f = firsts.get(t.id);
          return { id: t.id, era: t.era, year: t.target, prereq: t.prereq, need: t.need, knownBy: knownBy.get(t.id) ?? 0,
            discovered: sim.s.discovered.includes(t.id),
            first: f ? { who: personEn(f.name), pid: f.pid, band: bandTextEn(f.band), year: f.year } : null };
        }),
      });
      return true;
    }
    if (p.startsWith('/api/brain/')) {
      const b = sim.s.bands.find((x) => x.id === Number(p.split('/').pop()));
      json(res, b ? { ...brainView(sim.host(), b), inspired: !!sim.s.inspired?.[b.id] } : null, b ? 200 : 404);
      return true;
    }
    if (p.startsWith('/api/relations/')) {
      // a clan's friends and rivals, with their names
      const id = Number(p.split('/').pop());
      const byId = new Map(sim.s.bands.map((b) => [b.id, b]));
      json(res, relationsOf(sim.host(), id).filter((r) => byId.has(r.id)).map((r) => {
        const b = byId.get(r.id)!;
        return { id: r.id, name: sim.bandEnLabel(b, true), color: b.color, score: r.score, kind: r.state ?? (r.score > 15 ? 'friendly' : r.score < -15 ? 'cool' : 'neutral') };
      }));
      return true;
    }
    if (p === '/api/people') {
      // everyone alive, searchable and sorted, a page at a time
      const url = new URL(req.url ?? '/', 'http://x');
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const sort = url.searchParams.get('sort') ?? 'old';
      const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      const bandById = new Map(sim.s.bands.map((b) => [b.id, b]));
      const chiefs = new Set(sim.s.bands.map((b) => b.chiefId));
      let rows = sim.s.people.map((x) => {
        const b = bandById.get(x.bandId);
        return { id: x.id, name: sim.nameEn(x), age: Math.floor(sim.ageOf(x)), sex: x.sex, band: b ? sim.bandEnLabel(b, true) : '', bandId: x.bandId,
          task: x.task, chief: chiefs.has(x.id), deeds: x.deeds.length, children: x.children.length, gen: x.gen };
      });
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.band.toLowerCase().includes(q));
      const onlyBand = Number(url.searchParams.get('band') ?? 0);
      if (onlyBand) rows = rows.filter((r) => r.bandId === onlyBand);
      const by: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
        old: (a, b) => b.age - a.age, young: (a, b) => a.age - b.age, name: (a, b) => a.name.localeCompare(b.name),
        deeds: (a, b) => b.deeds - a.deeds || b.age - a.age, children: (a, b) => b.children - a.children || b.age - a.age,
      };
      rows.sort(by[sort] ?? by.old);
      json(res, { total: rows.length, people: rows.slice(offset, offset + limit) });
      return true;
    }
    if (p.startsWith('/api/act/') && req.method === 'POST') {
      const kind = p.split('/').pop() as ActKind;
      if (!ACTS.includes(kind)) { json(res, { error: 'no such act' }, 404); return true; }
      const state = this.acts(w).find((a) => a.kind === kind)!;
      if (!state.ready) { json(res, { error: 'not ready', readyIn: state.readyIn }, 429); return true; }
      const url = new URL(req.url ?? '/', 'http://x');
      const target = Number(url.searchParams.get('band') ?? 0) || undefined;
      const b = sim.watcherAct(kind, target);
      if (!b) { json(res, { error: kind === 'calm' ? 'no feud to calm' : 'nobody to help' }, 409); return true; }
      const band = sim.bandEnLabel(b, true);
      this.db.prepare('INSERT OR REPLACE INTO x_acts VALUES (?,?,?,?)').run(w, kind, Date.now(), band);
      json(res, { ok: true, band, bandId: b.id });
      return true;
    }
    return false;
  }
}
