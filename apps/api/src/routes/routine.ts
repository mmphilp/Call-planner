import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { canEditService, httpError, me, parse, requireScheduler } from '../http';
import { listPeriods, listRoutine, toService } from '../repo';
import { refreshCover } from '../sync';

/**
 * Routine weekday call: a surgeon who always takes, say, Monday day call for
 * their service. The optimizer applies these before filling the rest.
 */
export function routineRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/routine', async (req) => {
    requireScheduler(req);
    return listRoutine(db);
  });

  /** How a team covers weekdays: day by day or week-long, and whether rest rules apply. */
  app.put('/api/routine/settings', async (req) => {
    requireScheduler(req);
    const body = parse(
      z.object({
        serviceId: z.string(),
        weekdayMode: z.enum(['shift', 'week']).optional(),
        weekdayRules: z.boolean().optional(),
        backupServiceId: z.string().nullable().optional(),
      }),
      req.body,
    );
    if (!canEditService(me(req), body.serviceId)) throw httpError(403, 'You can only change your own team');
    if (body.weekdayMode) db.prepare('UPDATE services SET weekday_mode = ? WHERE id = ?').run(body.weekdayMode, body.serviceId);
    if (body.backupServiceId !== undefined) {
      if (body.backupServiceId === body.serviceId) throw httpError(400, 'A team cannot cover itself');
      if (body.backupServiceId && !db.prepare('SELECT 1 FROM services WHERE id = ?').get(body.backupServiceId)) {
        throw httpError(400, 'Unknown service');
      }
      db.prepare('UPDATE services SET backup_service_id = ? WHERE id = ?').run(body.backupServiceId, body.serviceId);
      for (const p of listPeriods(db)) if (p.status !== 'published') refreshCover(db, p.id);
    }
    if (body.weekdayRules !== undefined) {
      db.prepare('UPDATE services SET weekday_rules = ? WHERE id = ?').run(body.weekdayRules ? 1 : 0, body.serviceId);
    }
    const row = db.prepare('SELECT * FROM services WHERE id = ?').get(body.serviceId);
    if (!row) throw httpError(404, 'Service not found');
    return toService(row as any);
  });

  app.put('/api/routine', async (req) => {
    requireScheduler(req);
    const body = parse(
      z.object({
        serviceId: z.string(),
        kind: z.enum(['day', 'night']),
        weekday: z.number().int().min(1).max(5),
        userId: z.string().nullable(),
      }),
      req.body,
    );
    if (!canEditService(me(req), body.serviceId)) throw httpError(403, 'You can only set routine days for your own team');
    if (body.userId === null) {
      db.prepare('DELETE FROM routine_days WHERE service_id = ? AND kind = ? AND weekday = ?').run(
        body.serviceId,
        body.kind,
        body.weekday,
      );
    } else {
      const covers = db.prepare('SELECT 1 FROM user_services WHERE user_id = ? AND service_id = ?').get(body.userId, body.serviceId);
      if (!covers) throw httpError(400, 'That surgeon is not set up to cover this service');
      db.prepare(
        `INSERT INTO routine_days (service_id, kind, weekday, user_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (service_id, kind, weekday) DO UPDATE SET user_id = excluded.user_id`,
      ).run(body.serviceId, body.kind, body.weekday, body.userId);
    }
    return listRoutine(db);
  });
}
