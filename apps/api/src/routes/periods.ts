import { randomUUID } from 'node:crypto';
import {
  applyTeamRules,
  backupMap,
  dayOfWeek,
  DEFAULT_RULES,
  evaluateSchedule,
  halfYearRange,
  optimizeSchedule,
  planWeeks,
  requestCovers,
  weekStart,
  type Assignment,
  type Half,
  type Shift,
  type ShiftKind,
} from '@call-planner/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { transaction, type Db } from '../db';
import { calendarHolidays, defaultHolidays, nameShifts, normalizeHolidays } from '../holidays';
import { evaluatePeriod, regenerate as syncRegenerate, refreshCover as syncRefreshCover, shiftsOutOfDate } from '../sync';
import { canEditShift, canView, dateStr, httpError, me, parse, requireAdmin, requireScheduler, requireViewer } from '../http';
import {
  callPool,
  getPeriod,
  listAssignments,
  listPeriods,
  listRequests,
  listRoutine,
  listServices,
  listShifts,
  poolShifts,
  listUsers,
  type Period,
  type User,
} from '../repo';

const rulesBody = z
  .object({
    minRestHours: z.number().min(0).max(48),
    preferredRestHours: z.number().min(0).max(48),
    maxNightsPerWeek: z.number().int().min(0).max(7),
    minWeekendsOffBetween: z.number().int().min(0).max(8),
    preferredSpacingDays: z.number().min(0).max(14),
    weights: z.record(z.string(), z.number().min(0)),
    kindWeights: z.record(z.string(), z.number().min(0)),
  })
  .partial();

// Holidays are { date: observed day, name }; bare dates are still accepted.
const holidayList = z.array(z.union([dateStr, z.object({ date: dateStr, name: z.string().trim().min(1).max(60) })]));

/** Normalized, de-duplicated holiday list for storage. */
const storeHolidays = (raw: z.infer<typeof holidayList>) => {
  const seen = new Set<string>();
  return JSON.stringify(
    normalizeHolidays(raw).filter((h) => {
      const k = `${h.date}|${h.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  );
};

const periodPatch = z.object({
  status: z.enum(['draft', 'open', 'closed', 'published']).optional(),
  requestDeadline: dateStr.nullable().optional(),
  holidays: holidayList.optional(),
  rules: rulesBody.optional(),
});

interface HolidayOccurrence {
  name: string;
  /** The observed day. */
  date: string;
  periodId: string;
  periodLabel: string;
  status: Period['status'];
  covers: {
    shiftId: string;
    serviceId: string;
    kind: ShiftKind;
    userId: string | null;
    coveredBy: string | null;
    crossCover: boolean;
  }[];
}

export function periodRoutes(app: FastifyInstance, db: Db) {
  /** Load a period the current user is allowed to see. */
  const visiblePeriod = (req: FastifyRequest, id: string): Period => {
    const p = getPeriod(db, id);
    if (!p || (p.status === 'draft' && !canView(me(req)))) throw httpError(404, 'Schedule period not found');
    return p;
  };

  /** An unpublished period; by default only the overall admin may change it. */
  const editablePeriod = (req: FastifyRequest, id: string, opts: { teamAdmins?: boolean } = {}): Period => {
    if (opts.teamAdmins) requireScheduler(req);
    else requireAdmin(req);
    const p = visiblePeriod(req, id);
    if (p.status === 'published') throw httpError(409, 'Unpublish the schedule before changing it');
    return p;
  };

  const regenerate = (p: Period) => syncRegenerate(db, p);
  const refreshCover = (periodId: string) => syncRefreshCover(db, periodId);

  /** Every holiday in every schedule, with who covered it (for the rotation page and the optimizer). */
  const holidayCoverage = () =>
    listPeriods(db).flatMap((period) => {
      const owner = new Map(listAssignments(db, period.id).map((a) => [a.shiftId, a]));
      const byHoliday = new Map<string, HolidayOccurrence>();
      for (const s of nameShifts(listShifts(db, period.id), period.holidays)) {
        if (!s.holidayName) continue;
        const h = period.holidays.find((x) => x.name === s.holidayName)!;
        const key = `${h.name}|${h.date}`;
        if (!byHoliday.has(key)) {
          byHoliday.set(key, { name: h.name, date: h.date, periodId: period.id, periodLabel: period.label, status: period.status, covers: [] });
        }
        const a = owner.get(s.id);
        byHoliday.get(key)!.covers.push({
          shiftId: s.id,
          serviceId: s.serviceId,
          kind: s.kind,
          userId: a?.userId ?? null,
          coveredBy: s.coveredBy ?? null,
          crossCover: a?.source === 'backup',
        });
      }
      return [...byHoliday.values()];
    });

  /** userId → holidays they covered the last time each came round before this schedule. */
  const lastHolidayCover = (p: Period): Record<string, string[]> => {
    const latest = new Map<string, HolidayOccurrence>();
    for (const o of holidayCoverage()) {
      if (o.date >= p.startDate) continue;
      if (!latest.has(o.name) || latest.get(o.name)!.date < o.date) latest.set(o.name, o);
    }
    const out: Record<string, string[]> = {};
    for (const o of latest.values()) {
      for (const c of o.covers) if (c.userId) (out[c.userId] ??= []).includes(o.name) || out[c.userId].push(o.name);
    }
    return out;
  };

  app.get('/api/holidays/history', async (req) => {
    requireViewer(req);
    return holidayCoverage().sort((a, b) => a.date.localeCompare(b.date));
  });

  app.get('/api/rules/defaults', async () => DEFAULT_RULES);

  app.get('/api/periods', async (req) => {
    const all = listPeriods(db);
    return canView(me(req)) ? all : all.filter((p) => p.status !== 'draft');
  });

  app.post('/api/periods', async (req, reply) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        year: z.number().int().min(2000).max(2100),
        half: z.union([z.literal(1), z.literal(2)]),
        requestDeadline: dateStr.nullable().optional(),
        holidays: holidayList.optional(),
      }),
      req.body,
    );
    if (db.prepare('SELECT 1 FROM periods WHERE year = ? AND half = ?').get(body.year, body.half)) {
      throw httpError(409, 'That half-year already exists');
    }
    const { start, end } = halfYearRange(body.year, body.half as Half);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO periods (id, year, half, start_date, end_date, request_deadline, holidays_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.year,
      body.half,
      start,
      end,
      body.requestDeadline ?? null,
      // New schedules start with the group's holidays on their usual observed days.
      body.holidays ? storeHolidays(body.holidays) : JSON.stringify(defaultHolidays(start, end)),
    );
    const p = getPeriod(db, id)!;
    regenerate(p);
    reply.code(201);
    return p;
  });

  app.get<{ Params: { id: string } }>('/api/periods/:id', async (req) => visiblePeriod(req, req.params.id));

  app.patch<{ Params: { id: string } }>('/api/periods/:id', async (req) => {
    requireAdmin(req);
    const p = visiblePeriod(req, req.params.id);
    const body = parse(periodPatch, req.body);
    if (p.status === 'published' && (body.holidays || body.rules) && body.status !== 'closed') {
      throw httpError(409, 'Unpublish the schedule before changing it');
    }
    transaction(db, () => {
      if (body.status) {
        db.prepare('UPDATE periods SET status = ?, published_at = ? WHERE id = ?').run(
          body.status,
          body.status === 'published' ? new Date().toISOString() : null,
          p.id,
        );
      }
      if (body.requestDeadline !== undefined) {
        db.prepare('UPDATE periods SET request_deadline = ? WHERE id = ?').run(body.requestDeadline, p.id);
      }
      if (body.holidays) {
        db.prepare('UPDATE periods SET holidays_json = ? WHERE id = ?').run(storeHolidays(body.holidays), p.id);
      }
      if (body.rules) db.prepare('UPDATE periods SET rules_json = ? WHERE id = ?').run(JSON.stringify(body.rules), p.id);
    });
    const updated = getPeriod(db, p.id)!;
    if (body.holidays) regenerate(updated);
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/periods/:id', async (req) => {
    const p = editablePeriod(req, req.params.id);
    db.prepare('DELETE FROM periods WHERE id = ?').run(p.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/periods/:id/generate', async (req) => {
    const p = editablePeriod(req, req.params.id);
    return { shiftCount: regenerate(p) };
  });

  app.get<{ Params: { id: string } }>('/api/periods/:id/schedule', async (req) => {
    const p = visiblePeriod(req, req.params.id);
    const isAdmin = canView(me(req));
    const people = listUsers(db).map((u) => ({ id: u.id, name: u.name, phone: u.phone }));
    return {
      period: p,
      // Admins are warned when the shifts no longer match the services.
      shiftsOutOfDate: isAdmin ? shiftsOutOfDate(db, p) : undefined,
      services: listServices(db),
      shifts: nameShifts(listShifts(db, p.id), p.holidays),
      calendarHolidays: calendarHolidays(p.startDate, p.endDate, p.holidays),
      assignments: isAdmin || p.status === 'published' ? listAssignments(db, p.id) : [],
      people,
    };
  });

  const report = (p: Period) => evaluatePeriod(db, p);

  app.get<{ Params: { id: string } }>('/api/periods/:id/report', async (req) => {
    requireViewer(req);
    return report(visiblePeriod(req, req.params.id));
  });

  const scopeBody = z.object({
    serviceIds: z.array(z.string()).optional(),
    kinds: z.array(z.enum(['day', 'night', 'weekend'])).optional(),
  });

  /**
   * Which shifts a request may touch. The overall admin can pick any
   * services/kinds (default: everything); a team admin only gets weekday
   * shifts of their own services.
   */
  const scopeFor = (user: User, body: z.infer<typeof scopeBody>) => {
    let serviceIds = body.serviceIds ?? (user.role === 'admin' ? listServices(db).map((s) => s.id) : user.adminServiceIds);
    let kinds: ShiftKind[] = body.kinds ?? ['day', 'night', 'weekend'];
    if (user.role !== 'admin') {
      if (serviceIds.some((id) => !user.adminServiceIds.includes(id))) {
        throw httpError(403, 'You can only schedule your own team');
      }
      kinds = kinds.filter((k) => k !== 'weekend');
    }
    const services = new Set(serviceIds);
    const kindSet = new Set(kinds);
    return (s: { serviceId: string; kind: ShiftKind }) => services.has(s.serviceId) && kindSet.has(s.kind);
  };

  /** Routine weekday assignments that apply to these shifts (skipping holidays and time off). */
  const routineFor = (shifts: Shift[], periodId: string, poolIds: Set<string>): Assignment[] => {
    const weekly = new Set(listServices(db).filter((s) => s.weekdayMode === 'week').map((s) => s.id));
    const routine = new Map(
      listRoutine(db)
        .filter((r) => !weekly.has(r.serviceId))
        .map((r) => [`${r.serviceId}|${r.kind}|${r.weekday}`, r.userId]),
    );
    if (!routine.size) return [];
    const eligible = new Map(callPool(db).map((u) => [u.id, new Set(u.serviceIds)]));
    const away = listRequests(db, { periodId }).filter((r) => r.type === 'unavailable' && r.status !== 'denied');
    const out: Assignment[] = [];
    for (const s of shifts) {
      if (s.kind === 'weekend' || s.holiday) continue;
      const userId = routine.get(`${s.serviceId}|${s.kind}|${dayOfWeek(s.date)}`);
      if (!userId || !poolIds.has(userId) || !eligible.get(userId)?.has(s.serviceId)) continue;
      if (away.some((r) => r.userId === userId && requestCovers(r, s))) continue;
      out.push({ shiftId: s.id, userId, locked: true });
    }
    return out;
  };

  app.post<{ Params: { id: string } }>('/api/periods/:id/optimize', async (req) => {
    const p = editablePeriod(req, req.params.id, { teamAdmins: true });
    const body = parse(scopeBody.extend({ seed: z.number().int().optional() }), req.body);
    const inScope = scopeFor(me(req), body);
    const pool = callPool(db);
    const inPool = new Set(pool.map((u) => u.id));

    const services = listServices(db);
    const all = nameShifts(applyTeamRules(poolShifts(db, p.id), services), p.holidays);
    const requests = listRequests(db, { periodId: p.id });
    const seed = body.seed ?? Math.floor(Math.random() * 1e9);
    // Cross-cover is recomputed afterwards, so leave it out of the plan.
    const current = listAssignments(db, p.id).filter((a) => inPool.has(a.userId) && a.source !== 'backup');
    const byShift = new Map(current.map((a) => [a.shiftId, a]));
    const shiftById = new Map(all.map((s) => [s.id, s]));
    const scoped = all.filter(inScope);
    const scopedIds = new Set(scoped.map((s) => s.id));
    // Shifts outside the scope keep their current assignee (and still count
    // for rest rules and fairness); unfilled ones there are left alone.
    const fixed = current.filter((a) => shiftById.has(a.shiftId) && !scopedIds.has(a.shiftId));
    const lockedInScope = current.filter((a) => a.locked && scopedIds.has(a.shiftId));
    const open = scoped.filter((s) => !byShift.get(s.id)?.locked);
    // Week-long teams first: whole weeks to one surgeon where possible.
    const history = lastHolidayCover(p);
    const weeks = planWeeks({ shifts: open, surgeons: pool, requests, rules: p.rules, services, seed, holidayHistory: history });
    const weekIds = new Set(weeks.map((a) => a.shiftId));
    const routine = routineFor(open.filter((s) => !weekIds.has(s.id)), p.id, inPool);
    const fixedIds = new Set(fixed.map((a) => a.shiftId));
    const result = optimizeSchedule({
      shifts: all.filter((s) => inScope(s) || fixedIds.has(s.id)),
      surgeons: pool,
      requests,
      rules: p.rules,
      locked: [...fixed.map((a) => ({ ...a, locked: true })), ...lockedInScope, ...weeks, ...routine],
      backups: backupMap(services),
      holidayHistory: history,
      seed,
    });
    // Week and routine picks are stored unlocked, so they're re-planned next time.
    const routineIds = new Set([...routine, ...weeks].map((a) => a.shiftId));
    transaction(db, () => {
      const del = db.prepare('DELETE FROM assignments WHERE shift_id = ? AND locked = 0');
      for (const id of scopedIds) del.run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO assignments (shift_id, user_id, locked) VALUES (?, ?, 0)');
      for (const a of result.assignments) {
        if (scopedIds.has(a.shiftId) && (!a.locked || routineIds.has(a.shiftId))) ins.run(a.shiftId, a.userId);
      }
    });
    refreshCover(p.id);
    const filled = new Set(listAssignments(db, p.id).map((a) => a.shiftId));
    return {
      ...report(p),
      unassignedShiftIds: scoped.filter((s) => !filled.has(s.id)).map((s) => s.id),
      coverCount: listAssignments(db, p.id).filter((a) => a.source === 'backup' && scopedIds.has(a.shiftId)).length,
      routineCount: routine.length,
      weekCount: new Set(
        weeks.map((a) => {
          const s = shiftById.get(a.shiftId)!;
          return `${s.serviceId}|${weekStart(s.date)}`;
        }),
      ).size,
      cost: result.cost,
    };
  });

  /** Look up a shift in this period that the current user may edit. */
  const editableShift = (req: FastifyRequest, periodId: string, shiftId: string) => {
    const shift = db.prepare('SELECT service_id, kind FROM shifts WHERE id = ? AND period_id = ?').get(shiftId, periodId) as
      | { service_id: string; kind: string }
      | undefined;
    if (!shift) throw httpError(404, 'Shift not found');
    if (!canEditShift(me(req), { serviceId: shift.service_id, kind: shift.kind })) {
      throw httpError(403, 'Only the overall admin can change this shift');
    }
  };

  app.put<{ Params: { id: string; shiftId: string } }>('/api/periods/:id/assignments/:shiftId', async (req) => {
    const p = editablePeriod(req, req.params.id, { teamAdmins: true });
    const body = parse(z.object({ userId: z.string().nullable(), locked: z.boolean().optional() }), req.body);
    editableShift(req, p.id, req.params.shiftId);
    if (body.userId === null) {
      db.prepare('DELETE FROM assignments WHERE shift_id = ?').run(req.params.shiftId);
    } else {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(body.userId)) throw httpError(400, 'Unknown user');
      // A hand-picked assignment is locked by default so re-optimizing keeps it.
      db.prepare(
        `INSERT INTO assignments (shift_id, user_id, locked) VALUES (?, ?, ?)
         ON CONFLICT (shift_id) DO UPDATE SET user_id = excluded.user_id, locked = excluded.locked, source = NULL`,
      ).run(req.params.shiftId, body.userId, body.locked === false ? 0 : 1);
    }
    refreshCover(p.id);
    return { ok: true };
  });

  /** Mark a shift as covered from outside the call pool (e.g. a locum), or clear it. */
  app.put<{ Params: { id: string; shiftId: string } }>('/api/periods/:id/shifts/:shiftId/cover', async (req) => {
    const p = editablePeriod(req, req.params.id, { teamAdmins: true });
    const { coveredBy } = parse(z.object({ coveredBy: z.string().trim().min(1).max(100).nullable() }), req.body);
    editableShift(req, p.id, req.params.shiftId);
    transaction(db, () => {
      db.prepare('UPDATE shifts SET covered_by = ? WHERE id = ?').run(coveredBy, req.params.shiftId);
      if (coveredBy) db.prepare('DELETE FROM assignments WHERE shift_id = ?').run(req.params.shiftId);
    });
    refreshCover(p.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/periods/:id/assignments/clear', async (req) => {
    const p = editablePeriod(req, req.params.id, { teamAdmins: true });
    const body = parse(scopeBody.extend({ includeLocked: z.boolean().default(false) }), req.body);
    const inScope = scopeFor(me(req), body);
    const del = db.prepare(`DELETE FROM assignments WHERE shift_id = ? ${body.includeLocked ? '' : 'AND locked = 0'}`);
    transaction(db, () => {
      for (const s of listShifts(db, p.id)) if (inScope(s)) del.run(s.id);
    });
    refreshCover(p.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/periods/:id/export.csv', async (req, reply) => {
    requireViewer(req);
    const p = visiblePeriod(req, req.params.id);
    const services = new Map(listServices(db).map((s) => [s.id, s.name]));
    const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const owner = new Map(listAssignments(db, p.id).map((a) => [a.shiftId, a.userId]));
    const label = { day: 'Day (7a–5p)', night: 'Night (5p–7a)', weekend: 'Weekend (Fri 5p–Mon 7a)' };
    const rows = [['Date', 'Service', 'Shift', 'Start', 'End', 'Surgeon']];
    for (const s of listShifts(db, p.id)) {
      const u = owner.get(s.id);
      const who = s.coveredBy ? `${s.coveredBy} (locum)` : u ? names.get(u) ?? '' : '';
      rows.push([s.date, services.get(s.serviceId) ?? s.serviceId, label[s.kind], s.start, s.end, who]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="call-schedule-${p.year}-h${p.half}.csv"`);
    return csv;
  });

  /** The signed-in surgeon's own shifts in published schedules. */
  app.get('/api/me/shifts', async (req) => {
    const q = parse(z.object({ from: dateStr.optional() }), req.query);
    const services = new Map(listServices(db).map((s) => [s.id, s]));
    const rows = db
      .prepare(
        `SELECT s.* FROM assignments a
         JOIN shifts s ON s.id = a.shift_id
         JOIN periods p ON p.id = s.period_id
         WHERE a.user_id = ? AND p.status = 'published' AND s.end >= ?
         ORDER BY s.start`,
      )
      .all(me(req).id, q.from ?? '0000') as any[];
    const periodHolidays = new Map(listPeriods(db).map((p) => [p.id, p.holidays]));
    return rows.map((r) => ({
      holidayName: nameShifts<Shift>(
        [{ id: r.id, serviceId: r.service_id, kind: r.kind, date: r.date, start: r.start, end: r.end }],
        periodHolidays.get(r.period_id) ?? [],
      )[0].holidayName,
      id: r.id,
      periodId: r.period_id,
      serviceId: r.service_id,
      serviceName: services.get(r.service_id)?.name ?? r.service_id,
      color: services.get(r.service_id)?.color,
      kind: r.kind,
      date: r.date,
      start: r.start,
      end: r.end,
      holiday: !!r.holiday,
    }));
  });
}
