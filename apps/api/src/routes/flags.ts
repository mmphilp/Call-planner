import { randomUUID } from 'node:crypto';
import type { ShiftKind } from '@call-planner/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { canEditShift, canView, httpError, me, parse } from '../http';
import { getPeriod, listPeriods, listServices, listUsers, type User } from '../repo';

type FlagStatus = 'open' | 'fixed' | 'no_change' | 'withdrawn';

interface FlagRow {
  id: string;
  period_id: string;
  shift_id: string;
  user_id: string;
  assigned_user_id: string | null;
  note: string;
  status: FlagStatus;
  admin_note: string;
  created_at: string;
  resolved_at: string | null;
  // Joined from shifts / assignments.
  service_id: string;
  kind: ShiftKind;
  date: string;
  start: string;
  end: string;
  current_user_id: string | null;
}

const SELECT = `
  SELECT f.*, s.service_id, s.kind, s.date, s.start, s.end, a.user_id AS current_user_id
  FROM flags f
  JOIN shifts s ON s.id = f.shift_id
  LEFT JOIN assignments a ON a.shift_id = f.shift_id`;

/**
 * Review flags: while a proposed schedule is out for review, surgeons can
 * flag any assignment they think is wrong, with a note. The admin (or the
 * team admin, for weekday shifts) marks each one fixed or left as is before
 * publishing.
 */
export function flagRoutes(app: FastifyInstance, db: Db) {
  const describe = (rows: FlagRow[], user: User) => {
    const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const services = new Map(listServices(db).map((s) => [s.id, s.name]));
    const periods = new Map(listPeriods(db).map((p) => [p.id, p]));
    const person = (id: string | null) => (id ? { id, name: names.get(id) ?? 'Unknown' } : null);
    return rows.map((r) => ({
      id: r.id,
      periodId: r.period_id,
      periodLabel: periods.get(r.period_id)?.label ?? '',
      shift: { id: r.shift_id, serviceId: r.service_id, serviceName: services.get(r.service_id) ?? r.service_id, kind: r.kind, date: r.date, start: r.start, end: r.end },
      from: person(r.user_id)!,
      /** Who was on the shift when it was flagged, and who is on it now. */
      assignedThen: person(r.assigned_user_id),
      assignedNow: person(r.current_user_id),
      note: r.note,
      status: r.status,
      adminNote: r.admin_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      canResolve: r.status === 'open' && canEditShift(user, { serviceId: r.service_id, kind: r.kind }),
    }));
  };

  const flag = (id: string) => db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as FlagRow | undefined;

  /** Flags you sent; with ?all=1, everyone's (admins, team admins and viewers). */
  app.get('/api/flags', async (req) => {
    const q = parse(z.object({ periodId: z.string().optional(), all: z.string().optional() }), req.query);
    const user = me(req);
    const all = q.all === '1' && canView(user);
    const where = [all ? '1 = 1' : 'f.user_id = ?', q.periodId ? 'f.period_id = ?' : '1 = 1'].join(' AND ');
    const args = [...(all ? [] : [user.id]), ...(q.periodId ? [q.periodId] : [])];
    const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY s.start, f.created_at`).all(...args) as unknown as FlagRow[];
    return describe(rows, user);
  });

  app.post('/api/flags', async (req, reply) => {
    const user = me(req);
    if (user.role === 'viewer') throw httpError(403, 'View-only accounts can’t flag assignments');
    const body = parse(z.object({ shiftId: z.string(), note: z.string().trim().min(1, 'Say what looks wrong').max(1000) }), req.body);
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(body.shiftId) as { id: string; period_id: string } | undefined;
    if (!shift) throw httpError(404, 'Shift not found');
    const period = getPeriod(db, shift.period_id);
    if (period?.status !== 'review') throw httpError(409, 'This schedule isn’t out for review');
    if (db.prepare("SELECT 1 FROM flags WHERE shift_id = ? AND user_id = ? AND status = 'open'").get(shift.id, user.id)) {
      throw httpError(409, 'You’ve already flagged this shift');
    }
    const assigned = db.prepare('SELECT user_id FROM assignments WHERE shift_id = ?').get(shift.id) as { user_id: string } | undefined;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO flags (id, period_id, shift_id, user_id, assigned_user_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, shift.period_id, shift.id, user.id, assigned?.user_id ?? null, body.note, new Date().toISOString());
    reply.code(201);
    return describe([flag(id)!], user)[0];
  });

  /** Take back a flag you sent, while it's still open. */
  app.post<{ Params: { id: string } }>('/api/flags/:id/withdraw', async (req) => {
    const user = me(req);
    const f = flag(req.params.id);
    if (!f || f.user_id !== user.id) throw httpError(404, 'Flag not found');
    if (f.status !== 'open') throw httpError(409, 'This flag has already been dealt with');
    db.prepare("UPDATE flags SET status = 'withdrawn', resolved_at = ? WHERE id = ?").run(new Date().toISOString(), f.id);
    return describe([flag(f.id)!], user)[0];
  });

  /** Close a flag: 'fixed' (the schedule was changed) or 'no_change' (it stays, with a reason). */
  app.post<{ Params: { id: string } }>('/api/flags/:id/resolve', async (req) => {
    const user = me(req);
    const body = parse(z.object({ outcome: z.enum(['fixed', 'no_change']), adminNote: z.string().trim().max(1000).default('') }), req.body);
    const f = flag(req.params.id);
    if (!f) throw httpError(404, 'Flag not found');
    if (!canEditShift(user, { serviceId: f.service_id, kind: f.kind })) {
      throw httpError(403, f.kind === 'weekend' ? 'Only the overall admin can resolve weekend flags' : 'Not your team’s shift');
    }
    if (f.status !== 'open') throw httpError(409, 'This flag has already been dealt with');
    db.prepare('UPDATE flags SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?').run(
      body.outcome,
      body.adminNote,
      new Date().toISOString(),
      f.id,
    );
    return describe([flag(f.id)!], user)[0];
  });
}
