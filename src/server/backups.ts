// Daily backups of the world (fork, 1.51).
//
// Once a day (real time) the world save is copied into /data/backups, with a small note beside it (world, year, people),
// and only the newest few are kept. The chronicle database is not copied (it can be gigabytes): a roll back instead deletes
// what the database wrote after the backup (1.52), so world and history always match.
//   LETOPIS_BACKUPS       how many to keep (default 14, 0 turns backups off)
//   LETOPIS_BACKUP_HOURS  how often (default 24)

import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface BackupInfo {
  /** file name inside the backups folder */
  file: string;
  world: string;
  /** the world's year, its tick and how many people lived when it was taken */
  year: number;
  tick: number;
  people: number;
  /** when it was taken (ms since 1970) and why */
  at: number;
  why: 'daily' | 'manual' | 'before-rollback' | 'before-new-world';
  size: number;
}

export class Backups {
  readonly dir: string;
  readonly keep: number;
  readonly everyMs: number;
  private last = 0;
  private busy = false;

  constructor(dataDir: string, keep = Number(process.env.LETOPIS_BACKUPS ?? 14), hours = Number(process.env.LETOPIS_BACKUP_HOURS ?? 24)) {
    this.dir = path.join(dataDir, 'backups');
    this.keep = Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : 14;
    this.everyMs = (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600_000;
  }

  get enabled(): boolean { return this.keep > 0; }

  /** read when the newest backup was taken (call once at startup) */
  async init(): Promise<void> {
    if (!this.enabled) return;
    await mkdir(this.dir, { recursive: true });
    const list = await this.list();
    this.last = list[0]?.at ?? 0;
  }

  /** is a daily backup due? */
  due(now = Date.now()): boolean {
    return this.enabled && !this.busy && now - this.last >= this.everyMs;
  }

  /** copy the world save as it is on disk now; the note says what it holds */
  async make(stateFile: string, info: Omit<BackupInfo, 'file' | 'size' | 'at'>, now = Date.now()): Promise<BackupInfo | null> {
    if (!this.enabled || this.busy) return null;
    this.busy = true;
    try {
      await mkdir(this.dir, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
      const base = `${info.world.replace(/[^\w-]/g, '_')}-${stamp}-${info.why}`;
      const file = `${base}.json.gz`;
      // copied under a temporary name first, so a half-written backup never looks like a real one
      await copyFile(stateFile, path.join(this.dir, `${file}.tmp`));
      const size = (await stat(path.join(this.dir, `${file}.tmp`))).size;
      const full: BackupInfo = { ...info, file, at: now, size };
      await writeFile(path.join(this.dir, `${base}.meta.json`), JSON.stringify(full));
      await rename(path.join(this.dir, `${file}.tmp`), path.join(this.dir, file));
      this.last = now;
      await this.prune();
      return full;
    } finally {
      this.busy = false;
    }
  }

  /** every backup, newest first */
  async list(): Promise<BackupInfo[]> {
    let names: string[];
    try { names = await readdir(this.dir); } catch { return []; }
    const out: BackupInfo[] = [];
    for (const n of names) {
      if (!n.endsWith('.meta.json')) continue;
      try {
        const info = JSON.parse(await readFile(path.join(this.dir, n), 'utf8')) as BackupInfo;
        if (names.includes(info.file)) out.push(info);
      } catch { /* a broken note: ignore it */ }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** keep only the newest `keep` backups (and clear away leftovers of interrupted ones) */
  async prune(): Promise<void> {
    const list = await this.list();
    for (const b of list.slice(this.keep)) {
      await unlink(path.join(this.dir, b.file)).catch(() => {});
      await unlink(path.join(this.dir, b.file.replace(/\.json\.gz$/, '.meta.json'))).catch(() => {});
    }
    // (prune runs after a new backup has its final name, so any .tmp left is from an interrupted one)
    let names: string[] = [];
    try { names = await readdir(this.dir); } catch { /* none */ }
    for (const n of names) if (n.endsWith('.tmp')) await unlink(path.join(this.dir, n)).catch(() => {});
  }

  /** the path of a backup by its file name, or null if there is no such backup (names from outside are checked) */
  async pathOf(file: string): Promise<string | null> {
    if (!/^[\w.-]+\.json\.gz$/.test(file)) return null;
    const list = await this.list();
    return list.some((b) => b.file === file) ? path.join(this.dir, file) : null;
  }
}
