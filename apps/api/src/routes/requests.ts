import { randomUUID } from 'node:crypto';
import { addDays } from '@call-planner/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { dateStr, httpError, me, parse, requireAdmin } from '../http';
import { getPeriod, getRequest, listRequests } from '../repo';

const requestBody = z
  .object({
    periodId: z.string(),
    type: z.enum(['unavailable', 'prefer_off', 'prefer_on']),
    startDate: dateStr,
    endDate: dateStr,
    shiftKinds: z.array(z.enum(['day', 'night', 'weekend'])).default([]),
    note: z.string().max(500).default(''),
    /** Admins may file a request on someone's behalf. */
    userId: z.string().optional(),
  })
  .refine((r) => r.startDate <= r.endDate, { message: 'End date must be on or after start date', path: ['endDate'] });

export function requestRoutes(app: FastifyInstance, db: Db) {
  const today = () => new Date().toISOString().slice(0, 10);

  const assertOpenFor = (periodId: string, isAdmin: boolean) => {
    const p = getPeriod(db, periodId);
    if (!p || (p.status === 'draft' && !isAdmin)) throw httpError(404, 'Schedule period not found');
    if (isAdmin) return p;
    if (p.status !== 'open') throw httpError(409, 'Requests are closed for this period');
    if (p.requestDeadline && today() > p.requestDeadline) throw httpError(409, 'The request deadline has passed');
    return p;
  };

  app.get('/api/requests', async (req) => {
    const q = parse(z.object({ periodId: z.string().optional() }), req.query);
    const user = me(req);
    return listRequests(db, { periodId: q.periodId, userId: user.role === 'admin' ? undefined : user.id });
  });

  app.post('/api/requests', async (req, reply) => {
    const user = me(req);
    const isAdmin = user.role === 'admin';
    const body = parse(requestBody, req.body);
    const p = assertOpenFor(body.periodId, isAdmin);
    // Allow a request to run into the first weekend of the next period.
    if (body.endDate < p.startDate || body.startDate > addDays(p.endDate, 3)) {
      throw httpError(400, `Dates must fall within ${p.label}`);
    }
    const userId = isAdmin && body.userId ? body.userId : user.id;
    const id = randomUUID();
    const now = new Date().toISOString();
    // Admin-entered requests are approved up front.
    const status = isAdmin && body.userId ? 'approved' : 'pending';
    db.prepare(
      `INSERT INTO requests (id, period_id, user_id, type, start_date, end_date, shift_kinds, note, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      p.id,
      userId,
      body.type,
      body.startDate,
      body.endDate,
      body.shiftKinds.join(','),
      body.note,
      status,
      now,
      status === 'approved' ? now : null,
    );
    reply.code(201);
    return getRequest(db, id);
  });

  app.patch<{ Params: { id: string } }>('/api/requests/:id', async (req) => {
    requireAdmin(req);
    const r = getRequest(db, req.params.id);
    if (!r) throw httpError(404, 'Request not found');
    const body = parse(
      z.object({ status: z.enum(['pending', 'approved', 'denied']), adminNote: z.string().max(500).optional() }),
      req.body,
    );
    db.prepare('UPDATE requests SET status = ?, admin_note = COALESCE(?, admin_note), decided_at = ? WHERE id = ?').run(
      body.status,
      body.adminNote ?? null,
      body.status === 'pending' ? null : new Date().toISOString(),
      r.id,
    );
    return getRequest(db, r.id);
  });

  app.delete<{ Params: { id: string } }>('/api/requests/:id', async (req) => {
    const user = me(req);
    const r = getRequest(db, req.params.id);
    if (!r || (user.role !== 'admin' && r.userId !== user.id)) throw httpError(404, 'Request not found');
    if (user.role !== 'admin') {
      if (r.status !== 'pending') throw httpError(409, 'Only pending requests can be withdrawn');
      assertOpenFor(r.periodId, false);
    }
    db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
    return { ok: true };
  });
}
