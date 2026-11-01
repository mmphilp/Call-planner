import { applyTeamRules, backupMap, coverFromBackup, evaluateSchedule, generateShifts, type Assignment } from '@call-planner/core';
import { transaction, type Db } from './db';
import { bridgeDays } from './holidays';
import { callPool, listAssignments, listPeriods, listRequests, listServices, listShifts, poolShifts, type Period } from './repo';

function expectedShifts(db: Db, p: Period) {
  return generateShifts({
    start: p.startDate,
    end: p.endDate,
    services: listServices(db),
    holidays: p.holidays.map((h) => h.date),
    bridgeDays: bridgeDays(p.holidays),
  });
}

/**
 * Make a period's shifts match the current services and holidays. Shifts
 * that still exist keep their assignments; removed ones take theirs along.
 */
export function regenerate(db: Db, p: Period): number {
  const shifts = expectedShifts(db, p);
  transaction(db, () => {
    const keep = new Set(shifts.map((s) => s.id));
    const del = db.prepare('DELETE FROM shifts WHERE id = ?');
    for (const s of listShifts(db, p.id)) if (!keep.has(s.id)) del.run(s.id);
    const upsert = db.prepare(
      `INSERT INTO shifts (id, period_id, service_id, kind, date, start, end, holiday)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET start = excluded.start, end = excluded.end, holiday = excluded.holiday`,
    );
    for (const s of shifts) upsert.run(s.id, p.id, s.serviceId, s.kind, s.date, s.start, s.end, s.holiday ? 1 : 0);
  });
  refreshCover(db, p.id);
  return shifts.length;
}

/** True when the period's shifts no longer match the services' coverage, holidays or hours. */
export function shiftsOutOfDate(db: Db, p: Period): boolean {
  const expected = new Map(expectedShifts(db, p).map((s) => [s.id, `${s.start}|${s.end}`]));
  const current = listShifts(db, p.id);
  return current.length !== expected.size || current.some((s) => expected.get(s.id) !== `${s.start}|${s.end}`);
}

/**
 * Re-apply cross-cover: unfilled weekday shifts of a team with a covering
 * service go to whoever is on that service's matching shift. Run after
 * anything that changes assignments, so cover follows the latest schedule.
 */
export function refreshCover(db: Db, periodId: string) {
  transaction(db, () => {
    db.prepare(
      "DELETE FROM assignments WHERE source = 'backup' AND shift_id IN (SELECT id FROM shifts WHERE period_id = ?)",
    ).run(periodId);
    const services = listServices(db);
    if (!services.some((s) => s.backupServiceId)) return;
    const ins = db.prepare("INSERT OR IGNORE INTO assignments (shift_id, user_id, locked, source) VALUES (?, ?, 0, 'backup')");
    for (const a of coverFromBackup(poolShifts(db, periodId), listAssignments(db, periodId), services)) {
      ins.run(a.shiftId, a.userId);
    }
  });
}

/**
 * After services change, bring every unpublished schedule up to date.
 * Published schedules are left as they are (the admin console flags them).
 */
export function syncUnpublished(db: Db) {
  for (const p of listPeriods(db)) if (p.status !== 'published') regenerate(db, p);
}

/** Rule check, fairness and request outcomes for a period (optionally with different assignments). */
export function evaluatePeriod(db: Db, p: Period, assignments: Assignment[] = listAssignments(db, p.id)) {
  const services = listServices(db);
  return evaluateSchedule({
    backups: backupMap(services),
    shifts: applyTeamRules(poolShifts(db, p.id), services),
    surgeons: callPool(db),
    requests: listRequests(db, { periodId: p.id }),
    rules: p.rules,
    assignments,
  });
}
