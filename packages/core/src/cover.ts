import type { Assignment, Service, Shift } from './types';

/**
 * Cross-cover between teams: an unfilled weekday shift of a team with a
 * covering service goes to whoever holds that service's matching shift
 * (same day, same day/night). Returns the new assignments.
 */
export function coverFromBackup(shifts: Shift[], assignments: Assignment[], services: Service[]): Assignment[] {
  const backup = new Map(services.filter((s) => s.backupServiceId).map((s) => [s.id, s.backupServiceId!]));
  const owner = new Map(assignments.map((a) => [a.shiftId, a.userId]));
  const slot = (serviceId: string, s: Shift) => `${serviceId}|${s.kind}|${s.start}|${s.end}`;
  const shiftAt = new Map(shifts.map((s) => [slot(s.serviceId, s), s.id]));
  const out: Assignment[] = [];
  for (const s of shifts) {
    const b = backup.get(s.serviceId);
    if (!b || s.kind === 'weekend' || owner.has(s.id)) continue;
    const twin = shiftAt.get(slot(b, s));
    const userId = twin && owner.get(twin);
    if (userId) out.push({ shiftId: s.id, userId });
  }
  return out;
}

/** serviceId → covering serviceId, in the shape the optimizer takes. */
export function backupMap(services: Service[]): Record<string, string> {
  return Object.fromEntries(services.filter((s) => s.backupServiceId).map((s) => [s.id, s.backupServiceId!]));
}
