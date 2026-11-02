import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';

/**
 * A complete, consistent copy of the database while the app keeps running
 * (SQLite's VACUUM INTO). The result is a normal .db file: to restore, stop
 * the app and put it in place of call-planner.db.
 */
export function backupTo(db: Db, file: string) {
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 10);
const NAME = /^call-planner-(\d{4}-\d{2}-\d{2})\.db$/;

/** Today's backup in `dir` (one per day), then keep only the newest `keep`. Returns the file written, if any. */
export function dailyBackup(db: Db, dir: string, keep: number): string | null {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `call-planner-${stamp()}.db`);
  const existing = readdirSync(dir).filter((f) => NAME.test(f)).sort();
  let written: string | null = null;
  if (!existing.includes(`call-planner-${stamp()}.db`)) {
    backupTo(db, file);
    written = file;
    existing.push(`call-planner-${stamp()}.db`);
  }
  for (const old of existing.sort().slice(0, Math.max(0, existing.length - keep))) rmSync(join(dir, old), { force: true });
  return written;
}

/** Make a backup now, and check again every hour so there's one each day. */
export function scheduleDailyBackups(db: Db, dir: string, keep: number, log: (msg: string) => void) {
  const run = () => {
    try {
      const file = dailyBackup(db, dir, keep);
      if (file) log(`Backed up the database to ${file}`);
    } catch (e) {
      log(`Backup failed: ${(e as Error).message}`);
    }
  };
  run();
  return setInterval(run, 60 * 60 * 1000).unref();
}
