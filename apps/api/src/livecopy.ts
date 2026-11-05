import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { httpError, parse, requireAdmin } from './http';

/**
 * Replace every row in this database with the rows of another database file
 * (a backup), in place: the app keeps running on the same connection. Only
 * columns both sides have are copied, so a test copy running newer code can
 * load data from an older live version. Returns rows copied per table.
 */
export function loadFromBackup(db: Db, file: string): Record<string, number> {
  const tables = (db2: string) =>
    (db.prepare(`SELECT name FROM ${db2}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map(
      (r) => r.name,
    );
  const columns = (db2: string, table: string) =>
    (db.prepare(`PRAGMA ${db2}.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

  db.prepare('ATTACH DATABASE ? AS live').run(file);
  const copied: Record<string, number> = {};
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const liveTables = new Set(tables('live'));
    db.exec('BEGIN');
    try {
      for (const t of tables('main')) {
        db.exec(`DELETE FROM main."${t}"`);
        if (!liveTables.has(t)) continue;
        const theirs = new Set(columns('live', t));
        const cols = columns('main', t).filter((c) => theirs.has(c)).map((c) => `"${c}"`).join(', ');
        const r = db.prepare(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM live."${t}"`).run();
        copied[t] = Number(r.changes);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('DETACH DATABASE live');
  }
  return copied;
}

/**
 * On a test copy (INSTANCE_LABEL and LIVE_URL set): the overall admin can
 * replace this copy's data with a fresh backup of the live site. It signs in
 * to the live site with the live admin's email and password (used once, not
 * stored) and downloads /api/backup. Nothing on the live site changes.
 */
export function liveCopyRoutes(app: FastifyInstance, db: Db, liveUrl: string | undefined) {
  app.post('/api/test/copy-live', async (req) => {
    requireAdmin(req);
    if (!liveUrl) throw httpError(404, 'Not available on this site');
    const body = parse(z.object({ email: z.string().min(1), password: z.string().min(1) }), req.body);
    const base = liveUrl.replace(/\/$/, '');
    let login: Response;
    try {
      login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw httpError(502, `Can't reach the live site at ${base}`);
    }
    if (!login.ok) throw httpError(400, (await login.json().catch(() => ({})))?.error ?? 'Could not sign in to the live site');
    const { token } = (await login.json()) as { token: string };
    const backup = await fetch(`${base}/api/backup`, { headers: { authorization: `Bearer ${token}` } });
    if (!backup.ok) {
      const err = (await backup.json().catch(() => ({})))?.error;
      throw httpError(400, err ? `Live site: ${err}` : 'The live site refused the backup (is this its overall admin?)');
    }
    const file = join(tmpdir(), `call-planner-live-${randomUUID()}.db`);
    writeFileSync(file, Buffer.from(await backup.arrayBuffer()));
    try {
      const copied = loadFromBackup(db, file);
      return { ok: true, rows: Object.values(copied).reduce((a, b) => a + b, 0), users: copied.users ?? 0, periods: copied.periods ?? 0 };
    } finally {
      rmSync(file, { force: true });
    }
  });
}
