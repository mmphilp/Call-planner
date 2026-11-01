import { randomUUID } from 'node:crypto';
import { transaction, type Db } from './db';

/** Who (or what locum) is on a shift. */
export interface Holder {
  userId: string | null;
  cover: string | null;
}

interface ShiftInfo {
  id: string;
  period_id: string;
  service_id: string;
  kind: string;
  date: string;
  start: string;
  end: string;
  covered_by: string | null;
}

const shiftInfo = (db: Db, shiftId: string) => db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as ShiftInfo | undefined;

/** Who is on a shift right now. */
export function holderOf(db: Db, shiftId: string): Holder {
  const s = shiftInfo(db, shiftId);
  const a = db.prepare('SELECT user_id FROM assignments WHERE shift_id = ?').get(shiftId) as { user_id: string } | undefined;
  return { userId: a?.user_id ?? null, cover: s?.covered_by ?? null };
}

const same = (a: Holder, b: Holder) => a.userId === b.userId && a.cover === b.cover;

/** Record that a shift changed hands (no-op when nothing changed). */
export function logShiftChange(
  db: Db,
  e: { shiftId: string; byUserId: string | null; via: 'edit' | 'swap' | 'republish'; from: Holder; to: Holder; note?: string },
) {
  if (same(e.from, e.to)) return;
  const s = shiftInfo(db, e.shiftId);
  if (!s) return;
  db.prepare(
    `INSERT INTO change_log (id, period_id, at, by_user_id, action, via, shift_id, service_id, kind, date, start, end,
                             from_user_id, to_user_id, from_cover, to_cover, note)
     VALUES (?, ?, ?, ?, 'shift', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    s.period_id,
    new Date().toISOString(),
    e.byUserId,
    e.via,
    s.id,
    s.service_id,
    s.kind,
    s.date,
    s.start,
    s.end,
    e.from.userId,
    e.to.userId,
    e.from.cover,
    e.to.cover,
    e.note ?? '',
  );
}

/** A status event: the schedule (or one service of it, with serviceId) published, unpublished… */
export function logStatus(db: Db, periodId: string, byUserId: string, status: string, serviceId: string | null = null) {
  db.prepare(
    `INSERT INTO change_log (id, period_id, at, by_user_id, action, status, service_id) VALUES (?, ?, ?, ?, 'status', ?, ?)`,
  ).run(randomUUID(), periodId, new Date().toISOString(), byUserId, status, serviceId);
}

/**
 * On publishing: log every shift that differs from the last published
 * version (changes made while it was unpublished), then remember this one.
 * The first publish just takes the snapshot.
 */
export function snapshotOnPublish(db: Db, periodId: string, byUserId: string, serviceIds?: string[]) {
  // Just these services (publishing one service, or the rest of the schedule), or all of it.
  const only = serviceIds && new Set(serviceIds);
  const rows = (
    db
      .prepare(
        `SELECT s.id, s.service_id, a.user_id, s.covered_by FROM shifts s LEFT JOIN assignments a ON a.shift_id = s.id WHERE s.period_id = ?`,
      )
      .all(periodId) as { id: string; service_id: string; user_id: string | null; covered_by: string | null }[]
  ).filter((r) => !only || only.has(r.service_id));
  const ids = new Set(rows.map((r) => r.id));
  const before = new Map(
    (
      db.prepare('SELECT shift_id, user_id, covered_by FROM publish_snapshot WHERE period_id = ?').all(periodId) as {
        shift_id: string;
        user_id: string | null;
        covered_by: string | null;
      }[]
    ).map((r) => [r.shift_id, { userId: r.user_id, cover: r.covered_by }]),
  );
  transaction(db, () => {
    for (const r of rows) {
      const was = before.get(r.id);
      if (was) logShiftChange(db, { shiftId: r.id, byUserId, via: 'republish', from: was, to: { userId: r.user_id, cover: r.covered_by } });
    }
    const del = db.prepare('DELETE FROM publish_snapshot WHERE period_id = ? AND shift_id = ?');
    for (const [shiftId] of before) if (ids.has(shiftId) || !only) del.run(periodId, shiftId);
    const ins = db.prepare('INSERT INTO publish_snapshot (period_id, shift_id, user_id, covered_by) VALUES (?, ?, ?, ?)');
    for (const r of rows) ins.run(periodId, r.id, r.user_id, r.covered_by);
  });
}

/** Shifts in a period that changed after it was first published. */
export function changedShiftIds(db: Db, periodId: string): string[] {
  return (
    db.prepare("SELECT DISTINCT shift_id FROM change_log WHERE period_id = ? AND action = 'shift' AND shift_id IS NOT NULL").all(periodId) as {
      shift_id: string;
    }[]
  ).map((r) => r.shift_id);
}
