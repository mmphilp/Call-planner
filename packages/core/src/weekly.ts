import { weekStart } from './dates';
import { optimizeSchedule, type OptimizeInput } from './optimizer';
import type { Assignment, Service, Shift } from './types';

/** Services whose weekday call ignores rest / nights-per-week rules. */
function relaxedServices(services: Service[]) {
  return new Set(services.filter((s) => s.weekdayMode === 'week' || s.weekdayRules === false).map((s) => s.id));
}

/** Mark weekday shifts of teams that don't apply rest rules (small teams, week-long call). */
export function applyTeamRules<T extends Shift>(shifts: T[], services: Service[]): T[] {
  const relaxed = relaxedServices(services);
  return shifts.map((s) => (relaxed.has(s.serviceId) && s.kind !== 'weekend' ? { ...s, relaxed: true } : s));
}

/**
 * Week-long call. For services in week mode, give each Mon–Fri week's
 * weekday shifts to one surgeon who is free the whole week, sharing weeks
 * fairly (by FTE) and preferring not to give anyone back-to-back weeks.
 * Weeks nobody can take whole are left out, so they can be filled day by day.
 *
 * Returns locked assignments for every shift of the weeks handed out.
 */
export function planWeeks(input: OptimizeInput & { services: Service[] }): Assignment[] {
  const weekly = new Set(input.services.filter((s) => s.weekdayMode === 'week').map((s) => s.id));
  const taken = new Set((input.locked ?? []).map((a) => a.shiftId));
  const groups = new Map<string, Shift[]>();
  for (const s of input.shifts) {
    if (!weekly.has(s.serviceId) || s.kind === 'weekend' || taken.has(s.id)) continue;
    const key = `${s.serviceId}|${weekStart(s.date)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  if (!groups.size) return [];

  // One stand-in shift per team-week, spanning the whole week.
  const units: Shift[] = [...groups].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    return {
      id: key,
      serviceId: sorted[0].serviceId,
      kind: 'day',
      date: sorted[0].date,
      start: sorted[0].start,
      end: sorted.reduce((end, s) => (s.end > end ? s.end : end), sorted[0].end),
      holiday: sorted.some((s) => s.holiday) || undefined,
      // A holiday in the week travels with the week, so rotate it at this level.
      holidayName: sorted.find((s) => s.holidayName)?.holidayName,
    };
  });

  const result = optimizeSchedule({
    shifts: units,
    surgeons: input.surgeons,
    requests: input.requests,
    // Weeks start 7 days apart; a 14-day spacing preference discourages
    // giving the same surgeon two weeks in a row.
    rules: { ...input.rules, preferredSpacingDays: 14 },
    holidayHistory: input.holidayHistory,
    seed: input.seed,
  });

  return result.assignments.flatMap((a) =>
    groups.get(a.shiftId)!.map((s) => ({ shiftId: s.id, userId: a.userId, locked: true })),
  );
}
