import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logStatus, snapshotOnPublish } from '../changelog';
import type { Db } from '../db';
import { canEditService, canView, httpError, me, parse } from '../http';
import { getPeriod, isLive, listServices, listUsers, type Period, type User } from '../repo';

interface ApprovalRow {
  period_id: string;
  kind: 'surgeon' | 'service';
  subject: string;
  approved_by: string | null;
  fingerprint: string;
  note: string;
  created_at: string;
}

const hash = (parts: string[]) => createHash('sha1').update(parts.join('\n')).digest('hex');

/**
 * Per-service publishing and sign-offs.
 *
 * - A service's part of the schedule can be published on its own (team
 *   schedulers for their weekday teams; the overall admin for anything,
 *   including the weekend service). It's then final for surgeons, and
 *   re-optimizing leaves it alone.
 * - Surgeons approve their own schedule; service schedulers approve their
 *   service's. Each approval remembers what it approved, so a later change
 *   shows as "changed since approved".
 * - The overall admin (and view-only accounts) see every service and surgeon;
 *   a team scheduler sees their own services and the surgeons in them.
 */
export function signoffRoutes(app: FastifyInstance, db: Db) {
  /** What a surgeon's approval covers: the shifts they're on in this period. */
  const surgeonPrint = (periodId: string, userId: string) =>
    hash(
      (
        db
          .prepare('SELECT s.id FROM assignments a JOIN shifts s ON s.id = a.shift_id WHERE s.period_id = ? AND a.user_id = ? ORDER BY s.id')
          .all(periodId, userId) as { id: string }[]
      ).map((r) => r.id),
    );
  /** What a service approval covers: who's on each of the service's shifts. */
  const servicePrint = (periodId: string, serviceId: string) =>
    hash(
      (
        db
          .prepare(
            `SELECT s.id, COALESCE(a.user_id, '') AS u, COALESCE(s.covered_by, '') AS c FROM shifts s
             LEFT JOIN assignments a ON a.shift_id = s.id WHERE s.period_id = ? AND s.service_id = ? ORDER BY s.id`,
          )
          .all(periodId, serviceId) as { id: string; u: string; c: string }[]
      ).map((r) => `${r.id}=${r.u}|${r.c}`),
    );

  const approval = (periodId: string, kind: 'surgeon' | 'service', subject: string) =>
    db.prepare('SELECT * FROM approvals WHERE period_id = ? AND kind = ? AND subject = ?').get(periodId, kind, subject) as ApprovalRow | undefined;

  const period = (req: FastifyRequest<{ Params: { id: string } }>) => {
    const p = getPeriod(db, req.params.id);
    if (!p || (p.status === 'draft' && !canView(me(req)))) throw httpError(404, 'Schedule period not found');
    return p;
  };

  /** Surgeons can sign off once they can see their schedule. */
  const surgeonCanSee = (p: Period) => p.status === 'review' || p.status === 'published' || p.publishedServiceIds.length > 0;
  /** Schedulers sign off and publish once the schedule is being built. */
  const building = (p: Period) => p.status === 'closed' || p.status === 'review';

  app.get<{ Params: { id: string } }>('/api/periods/:id/signoff', async (req) => {
    const user = me(req);
    const p = period(req);
    const seeAll = canView(user) && (user.role === 'admin' || user.role === 'viewer');
    if (!seeAll && !user.adminServiceIds.length) throw httpError(403, 'Not allowed');
    const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const surgeons = listUsers(db).filter((u) => u.active && u.takesCall);
    const published = new Map(
      (db.prepare('SELECT * FROM published_services WHERE period_id = ?').all(p.id) as { service_id: string; published_at: string; published_by: string | null }[]).map(
        (r) => [r.service_id, r],
      ),
    );
    const services = listServices(db).filter(
      (s) => (seeAll || user.adminServiceIds.includes(s.id)) && db.prepare('SELECT 1 FROM shifts WHERE period_id = ? AND service_id = ? LIMIT 1').get(p.id, s.id),
    );
    const surgeonApproval = (id: string) => {
      const a = approval(p.id, 'surgeon', id);
      return a ? { at: a.created_at, note: a.note, current: a.fingerprint === surgeonPrint(p.id, id) } : null;
    };
    return {
      status: p.status,
      services: services.map((s) => {
        const a = approval(p.id, 'service', s.id);
        const pub = published.get(s.id);
        const mayEdit = canEditService(user, s.id);
        return {
          id: s.id,
          name: s.name,
          color: s.color,
          coversWeekend: s.coversWeekend,
          published:
            p.status === 'published'
              ? { at: p.publishedAt, by: null, whole: true }
              : pub
                ? { at: pub.published_at, by: pub.published_by ? { id: pub.published_by, name: names.get(pub.published_by) ?? '' } : null, whole: false }
                : null,
          canPublish: mayEdit && building(p),
          approval: a
            ? {
                at: a.created_at,
                note: a.note,
                by: a.approved_by ? { id: a.approved_by, name: names.get(a.approved_by) ?? '' } : null,
                current: a.fingerprint === servicePrint(p.id, s.id),
              }
            : null,
          canApprove: mayEdit && (building(p) || p.status === 'published'),
          surgeons: surgeons
            .filter((u) => u.serviceIds.includes(s.id))
            .map((u) => ({ id: u.id, name: u.name, approval: surgeonApproval(u.id) })),
        };
      }),
    };
  });

  /** Publish one service's part of the schedule ahead of the rest. */
  app.post<{ Params: { id: string; serviceId: string } }>('/api/periods/:id/services/:serviceId/publish', async (req) => {
    const user = me(req);
    const p = period(req);
    if (!canEditService(user, req.params.serviceId)) throw httpError(403, 'You can only publish your own team’s schedule');
    if (!building(p)) throw httpError(409, p.status === 'published' ? 'The whole schedule is already published' : 'Close requests before publishing');
    if (!db.prepare('SELECT 1 FROM shifts WHERE period_id = ? AND service_id = ? LIMIT 1').get(p.id, req.params.serviceId)) {
      throw httpError(404, 'This service has no shifts in this schedule');
    }
    if (isLive(p, req.params.serviceId)) throw httpError(409, 'Already published');
    db.prepare('INSERT INTO published_services (period_id, service_id, published_at, published_by) VALUES (?, ?, ?, ?)').run(
      p.id,
      req.params.serviceId,
      new Date().toISOString(),
      user.id,
    );
    logStatus(db, p.id, user.id, 'published', req.params.serviceId);
    // Logs anything changed since this service was last published.
    snapshotOnPublish(db, p.id, user.id, [req.params.serviceId]);
    return getPeriod(db, p.id);
  });

  app.post<{ Params: { id: string; serviceId: string } }>('/api/periods/:id/services/:serviceId/unpublish', async (req) => {
    const user = me(req);
    const p = period(req);
    if (!canEditService(user, req.params.serviceId)) throw httpError(403, 'You can only unpublish your own team’s schedule');
    if (p.status === 'published') throw httpError(409, 'The whole schedule is published; unpublish it on the Overview tab');
    const r = db.prepare('DELETE FROM published_services WHERE period_id = ? AND service_id = ?').run(p.id, req.params.serviceId);
    if (r.changes) logStatus(db, p.id, user.id, 'closed', req.params.serviceId);
    return getPeriod(db, p.id);
  });

  const approvalBody = z.object({ kind: z.enum(['surgeon', 'service']), serviceId: z.string().optional(), note: z.string().trim().max(1000).default('') });

  /** Who may sign off what: surgeons their own schedule, schedulers their service. */
  const subjectFor = (user: User, p: Period, body: z.infer<typeof approvalBody>) => {
    if (body.kind === 'surgeon') {
      if (!user.takesCall || user.role === 'viewer') throw httpError(403, 'Only surgeons who take call approve their own schedule');
      if (!surgeonCanSee(p)) throw httpError(409, 'This schedule isn’t out for review yet');
      return { subject: user.id, print: surgeonPrint(p.id, user.id) };
    }
    if (!body.serviceId) throw httpError(400, 'serviceId: required');
    if (!canEditService(user, body.serviceId)) throw httpError(403, 'You can only approve your own team’s schedule');
    if (!building(p) && p.status !== 'published') throw httpError(409, 'Close requests before approving');
    return { subject: body.serviceId, print: servicePrint(p.id, body.serviceId) };
  };

  app.post<{ Params: { id: string } }>('/api/periods/:id/approvals', async (req, reply) => {
    const user = me(req);
    const p = period(req);
    const body = parse(approvalBody, req.body);
    const { subject, print } = subjectFor(user, p, body);
    // Approving again replaces the earlier approval (e.g. after changes).
    db.prepare(
      `INSERT INTO approvals (period_id, kind, subject, approved_by, fingerprint, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (period_id, kind, subject) DO UPDATE SET approved_by = excluded.approved_by, fingerprint = excluded.fingerprint,
         note = excluded.note, created_at = excluded.created_at`,
    ).run(p.id, body.kind, subject, user.id, print, body.note, new Date().toISOString());
    reply.code(201);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/periods/:id/approvals/withdraw', async (req) => {
    const user = me(req);
    const p = period(req);
    const body = parse(approvalBody, req.body);
    // A surgeon's approval is final; they approve again if their shifts change.
    if (body.kind === 'surgeon') throw httpError(409, 'Once you’ve approved your schedule it can’t be withdrawn');
    const { subject } = subjectFor(user, p, body);
    db.prepare('DELETE FROM approvals WHERE period_id = ? AND kind = ? AND subject = ?').run(p.id, body.kind, subject);
    return { ok: true };
  });

  /**
   * Ask surgeons to review and approve again (e.g. after sending out a revised
   * schedule): clears their approvals so the approve card comes back in the
   * app. One surgeon, everyone in a service, or everyone. The overall admin
   * can reset anyone; a team scheduler, surgeons in their own services.
   */
  app.post<{ Params: { id: string } }>('/api/periods/:id/approvals/reset', async (req) => {
    const user = me(req);
    const p = period(req);
    const body = parse(z.object({ userId: z.string().optional(), serviceId: z.string().optional() }), req.body);
    const surgeons = listUsers(db).filter((u) => u.takesCall);
    // Surgeons this user may reset: everyone (admin), or those in a service they schedule.
    const mine = (u: User) => user.role === 'admin' || u.serviceIds.some((id) => user.adminServiceIds.includes(id));
    let targets: User[];
    if (body.userId) targets = surgeons.filter((u) => u.id === body.userId);
    else if (body.serviceId) {
      if (!canEditService(user, body.serviceId)) throw httpError(403, 'You can only reset your own team’s approvals');
      targets = surgeons.filter((u) => u.serviceIds.includes(body.serviceId!));
    } else {
      if (user.role !== 'admin') throw httpError(403, 'Only the overall admin can reset everyone');
      targets = surgeons;
    }
    if (targets.some((u) => !mine(u))) throw httpError(403, 'You can only reset surgeons on your own team');
    const del = db.prepare("DELETE FROM approvals WHERE period_id = ? AND kind = 'surgeon' AND subject = ?");
    let reset = 0;
    for (const u of targets) reset += Number(del.run(p.id, u.id).changes);
    return { reset };
  });

  /** Your own sign-offs, for the app. */
  app.get('/api/me/approvals', async (req) => {
    const user = me(req);
    const rows = db.prepare("SELECT * FROM approvals WHERE kind = 'surgeon' AND subject = ?").all(user.id) as unknown as ApprovalRow[];
    return rows.map((a) => ({ periodId: a.period_id, at: a.created_at, note: a.note, current: a.fingerprint === surgeonPrint(a.period_id, user.id) }));
  });
}
