import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RULES,
  evaluateSchedule,
  generateShifts,
  halfYearRange,
  optimizeSchedule,
  type Half,
} from '@call-planner/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { transaction, type Db } from '../db';
import { dateStr, httpError, me, parse, requireAdmin } from '../http';
import {
  callPool,
  getPeriod,
  listAssignments,
  listPeriods,
  listRequests,
  listServices,
  listShifts,
  listUsers,
  type Period,
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

const periodPatch = z.object({
  status: z.enum(['draft', 'open', 'closed', 'published']).optional(),
  requestDeadline: dateStr.nullable().optional(),
  holidays: z.array(dateStr).optional(),
  rules: rulesBody.optional(),
});

export function periodRoutes(app: FastifyInstance, db: Db) {
  /** Load a period the current user is allowed to see. */
  const visiblePeriod = (req: FastifyRequest, id: string): Period => {
    const p = getPeriod(db, id);
    if (!p || (p.status === 'draft' && me(req).role !== 'admin')) throw httpError(404, 'Schedule period not found');
    return p;
  };

  const editablePeriod = (req: FastifyRequest, id: string): Period => {
    requireAdmin(req);
    const p = visiblePeriod(req, id);
    if (p.status === 'published') throw httpError(409, 'Unpublish the schedule before changing it');
    return p;
  };

  const regenerate = (p: Period) => {
    const shifts = generateShifts({
      start: p.startDate,
      end: p.endDate,
      services: listServices(db),
      holidays: p.holidays,
    });
    transaction(db, () => {
      const keep = new Set(shifts.map((s) => s.id));
      const old = listShifts(db, p.id);
      const del = db.prepare('DELETE FROM shifts WHERE id = ?');
      for (const s of old) if (!keep.has(s.id)) del.run(s.id);
      const upsert = db.prepare(
        `INSERT INTO shifts (id, period_id, service_id, kind, date, start, end, holiday)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET start = excluded.start, end = excluded.end, holiday = excluded.holiday`,
      );
      for (const s of shifts) upsert.run(s.id, p.id, s.serviceId, s.kind, s.date, s.start, s.end, s.holiday ? 1 : 0);
    });
    return shifts.length;
  };

  app.get('/api/rules/defaults', async () => DEFAULT_RULES);

  app.get('/api/periods', async (req) => {
    const all = listPeriods(db);
    return me(req).role === 'admin' ? all : all.filter((p) => p.status !== 'draft');
  });

  app.post('/api/periods', async (req, reply) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        year: z.number().int().min(2000).max(2100),
        half: z.union([z.literal(1), z.literal(2)]),
        requestDeadline: dateStr.nullable().optional(),
        holidays: z.array(dateStr).default([]),
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
    ).run(id, body.year, body.half, start, end, body.requestDeadline ?? null, JSON.stringify(body.holidays));
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
        db.prepare('UPDATE periods SET holidays_json = ? WHERE id = ?').run(
          JSON.stringify([...new Set(body.holidays)].sort()),
          p.id,
        );
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
    const isAdmin = me(req).role === 'admin';
    const people = listUsers(db).map((u) => ({ id: u.id, name: u.name, phone: u.phone }));
    return {
      period: p,
      services: listServices(db),
      shifts: listShifts(db, p.id),
      assignments: isAdmin || p.status === 'published' ? listAssignments(db, p.id) : [],
      people,
    };
  });

  const report = (p: Period) =>
    evaluateSchedule({
      shifts: listShifts(db, p.id),
      surgeons: callPool(db),
      requests: listRequests(db, { periodId: p.id }),
      rules: p.rules,
      assignments: listAssignments(db, p.id),
    });

  app.get<{ Params: { id: string } }>('/api/periods/:id/report', async (req) => {
    requireAdmin(req);
    return report(visiblePeriod(req, req.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/periods/:id/optimize', async (req) => {
    const p = editablePeriod(req, req.params.id);
    const body = parse(z.object({ seed: z.number().int().optional() }), req.body);
    const pool = callPool(db);
    const inPool = new Set(pool.map((u) => u.id));
    const locked = listAssignments(db, p.id).filter((a) => a.locked && inPool.has(a.userId));
    const result = optimizeSchedule({
      shifts: listShifts(db, p.id),
      surgeons: pool,
      requests: listRequests(db, { periodId: p.id }),
      rules: p.rules,
      locked,
      seed: body.seed ?? Math.floor(Math.random() * 1e9),
    });
    transaction(db, () => {
      db.prepare(
        'DELETE FROM assignments WHERE locked = 0 AND shift_id IN (SELECT id FROM shifts WHERE period_id = ?)',
      ).run(p.id);
      const ins = db.prepare('INSERT OR IGNORE INTO assignments (shift_id, user_id, locked) VALUES (?, ?, 0)');
      for (const a of result.assignments) if (!a.locked) ins.run(a.shiftId, a.userId);
    });
    return { ...report(p), unassignedShiftIds: result.unassignedShiftIds, cost: result.cost };
  });

  app.put<{ Params: { id: string; shiftId: string } }>('/api/periods/:id/assignments/:shiftId', async (req) => {
    const p = editablePeriod(req, req.params.id);
    const body = parse(z.object({ userId: z.string().nullable(), locked: z.boolean().optional() }), req.body);
    const shift = db.prepare('SELECT id FROM shifts WHERE id = ? AND period_id = ?').get(req.params.shiftId, p.id);
    if (!shift) throw httpError(404, 'Shift not found');
    if (body.userId === null) {
      db.prepare('DELETE FROM assignments WHERE shift_id = ?').run(req.params.shiftId);
    } else {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(body.userId)) throw httpError(400, 'Unknown user');
      // A hand-picked assignment is locked by default so re-optimizing keeps it.
      db.prepare(
        `INSERT INTO assignments (shift_id, user_id, locked) VALUES (?, ?, ?)
         ON CONFLICT (shift_id) DO UPDATE SET user_id = excluded.user_id, locked = excluded.locked`,
      ).run(req.params.shiftId, body.userId, body.locked === false ? 0 : 1);
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/periods/:id/assignments/clear', async (req) => {
    const p = editablePeriod(req, req.params.id);
    const { includeLocked } = parse(z.object({ includeLocked: z.boolean().default(false) }), req.body);
    db.prepare(
      `DELETE FROM assignments WHERE shift_id IN (SELECT id FROM shifts WHERE period_id = ?)
       ${includeLocked ? '' : 'AND locked = 0'}`,
    ).run(p.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/periods/:id/export.csv', async (req, reply) => {
    requireAdmin(req);
    const p = visiblePeriod(req, req.params.id);
    const services = new Map(listServices(db).map((s) => [s.id, s.name]));
    const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const owner = new Map(listAssignments(db, p.id).map((a) => [a.shiftId, a.userId]));
    const label = { day: 'Day (7a–5p)', night: 'Night (5p–7a)', weekend: 'Weekend (Fri 5p–Mon 7a)' };
    const rows = [['Date', 'Service', 'Shift', 'Start', 'End', 'Surgeon']];
    for (const s of listShifts(db, p.id)) {
      const u = owner.get(s.id);
      rows.push([s.date, services.get(s.serviceId) ?? s.serviceId, label[s.kind], s.start, s.end, u ? names.get(u) ?? '' : '']);
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
    return rows.map((r) => ({
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
