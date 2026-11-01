import { randomUUID } from 'node:crypto';
import type { Assignment, ShiftKind } from '@call-planner/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { transaction, type Db } from '../db';
import { canEditShift, canView, httpError, me, parse } from '../http';
import { getPeriod, listAssignments, listServices, listUsers, type User } from '../repo';
import { evaluatePeriod, refreshCover } from '../sync';

type Status = 'open' | 'proposed' | 'accepted' | 'approved' | 'declined' | 'cancelled' | 'rejected';
const ACTIVE: Status[] = ['open', 'proposed', 'accepted'];

interface ShiftRow {
  id: string;
  period_id: string;
  service_id: string;
  kind: ShiftKind;
  date: string;
  start: string;
  end: string;
}

interface TradeRow {
  id: string;
  period_id: string;
  kind: 'offer' | 'swap';
  shift_id: string;
  from_user: string;
  to_user: string | null;
  their_shift_id: string | null;
  status: Status;
  note: string;
  admin_note: string;
  created_at: string;
  decided_at: string | null;
}

/** Local wall-clock time, comparable to shift start times. */
const nowLocal = () => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:${p(n.getMinutes())}`;
};

/**
 * Shift swaps and giveaways on published schedules. Surgeons offer a shift
 * (anyone who covers that service can take it) or propose a swap with a
 * colleague; once taken or accepted, an admin approves it and the schedule
 * changes. Weekends need the overall admin; weekday shifts a team admin too.
 */
export function tradeRoutes(app: FastifyInstance, db: Db) {
  const shift = (id: string) => db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as ShiftRow | undefined;
  const ownerOf = (shiftId: string) =>
    (db.prepare('SELECT user_id FROM assignments WHERE shift_id = ?').get(shiftId) as { user_id: string } | undefined)?.user_id;
  const covers = (userId: string, serviceId: string) =>
    !!db.prepare('SELECT 1 FROM user_services WHERE user_id = ? AND service_id = ?').get(userId, serviceId);
  const trade = (id: string) => db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as TradeRow | undefined;

  /** A future shift in a published schedule. */
  const tradeable = (s: ShiftRow | undefined, what: string) => {
    if (!s) throw httpError(404, `${what} not found`);
    if (getPeriod(db, s.period_id)?.status !== 'published') throw httpError(409, 'Only published schedules can be traded');
    if (s.start <= nowLocal()) throw httpError(409, `${what} has already started`);
    return s;
  };

  const notViewer = (req: FastifyRequest) => {
    if (me(req).role === 'viewer') throw httpError(403, 'View-only accounts can’t trade shifts');
    return me(req);
  };

  /** Rule problems the trade would add for the people involved (shown to admins before approving). */
  const issuesFor = (t: TradeRow): string[] => {
    if (!t.to_user) return [];
    const p = getPeriod(db, t.period_id)!;
    const swapped = (list: Assignment[]) =>
      list.map((a) =>
        a.shiftId === t.shift_id
          ? { ...a, userId: t.to_user! }
          : a.shiftId === t.their_shift_id
            ? { ...a, userId: t.from_user }
            : a,
      );
    const people = new Set([t.from_user, t.to_user]);
    const key = (v: { message: string; shiftIds: string[] }) => `${v.message}|${v.shiftIds.join()}`;
    const before = new Set(evaluatePeriod(db, p).violations.filter((v) => v.userId && people.has(v.userId)).map(key));
    const after = evaluatePeriod(db, p, swapped(listAssignments(db, p.id))).violations;
    // A swap across two schedules: check the other half too.
    const theirs = t.their_shift_id ? shift(t.their_shift_id) : undefined;
    if (theirs && theirs.period_id !== p.id) {
      const q = getPeriod(db, theirs.period_id)!;
      after.push(...evaluatePeriod(db, q, swapped(listAssignments(db, q.id))).violations);
    }
    const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
    return [...new Set(after.filter((v) => v.userId && people.has(v.userId) && !before.has(key(v))).map((v) => `${names.get(v.userId!)}: ${v.message}`))];
  };

  const describe = (t: TradeRow, user: User) => {
    const names = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const services = new Map(listServices(db).map((s) => [s.id, s.name]));
    const view = (s: ShiftRow | undefined) =>
      s && { id: s.id, serviceId: s.service_id, serviceName: services.get(s.service_id) ?? s.service_id, kind: s.kind, date: s.date, start: s.start, end: s.end };
    const s = shift(t.shift_id);
    const theirs = t.their_shift_id ? shift(t.their_shift_id) : undefined;
    const canDecide =
      t.status === 'accepted' && !!s && canEditShift(user, { serviceId: s.service_id, kind: s.kind }) &&
      (!theirs || canEditShift(user, { serviceId: theirs.service_id, kind: theirs.kind }));
    return {
      id: t.id,
      periodId: t.period_id,
      kind: t.kind,
      status: t.status,
      note: t.note,
      adminNote: t.admin_note,
      createdAt: t.created_at,
      decidedAt: t.decided_at,
      shift: view(s),
      theirShift: view(theirs),
      from: { id: t.from_user, name: names.get(t.from_user) ?? '?' },
      to: t.to_user ? { id: t.to_user, name: names.get(t.to_user) ?? '?' } : null,
      canDecide,
      issues: t.status === 'accepted' && canView(user) ? issuesFor(t) : [],
    };
  };

  app.get('/api/trades', async (req) => {
    const q = parse(z.object({ periodId: z.string().optional(), all: z.enum(['1']).optional() }), req.query);
    const user = me(req);
    const rows = db
      .prepare(`SELECT * FROM trades ${q.periodId ? 'WHERE period_id = ?' : ''} ORDER BY created_at DESC`)
      .all(...(q.periodId ? [q.periodId] : [])) as unknown as TradeRow[];
    const visible =
      q.all === '1' && canView(user)
        ? rows
        : rows.filter((t) => {
            if (t.from_user === user.id || t.to_user === user.id) return true;
            // Open offers someone else made that I could take.
            if (t.status !== 'open') return false;
            const s = shift(t.shift_id);
            return !!s && covers(user.id, s.service_id) && s.start > nowLocal();
          });
    return visible.map((t) => describe(t, user));
  });

  app.post('/api/trades', async (req, reply) => {
    const user = notViewer(req);
    const body = parse(
      z.object({
        shiftId: z.string(),
        kind: z.enum(['offer', 'swap']),
        toUserId: z.string().optional(),
        theirShiftId: z.string().optional(),
        note: z.string().max(500).default(''),
      }),
      req.body,
    );
    const mine = tradeable(shift(body.shiftId), 'That shift');
    if (ownerOf(mine.id) !== user.id) throw httpError(403, 'You can only trade your own shifts');
    const busy = db
      .prepare(`SELECT 1 FROM trades WHERE (shift_id = ? OR their_shift_id = ?) AND status IN (${ACTIVE.map(() => '?').join()})`)
      .get(mine.id, mine.id, ...ACTIVE);
    if (busy) throw httpError(409, 'That shift already has a swap or offer in progress');

    let toUser: string | null = null;
    let theirShift: string | null = null;
    if (body.kind === 'swap') {
      if (!body.theirShiftId) throw httpError(400, 'Pick the shift you want in exchange');
      const theirs = tradeable(shift(body.theirShiftId), 'Their shift');
      toUser = ownerOf(theirs.id) ?? null;
      if (!toUser || toUser === user.id) throw httpError(400, 'Pick a colleague’s shift');
      if (body.toUserId && body.toUserId !== toUser) throw httpError(409, 'That shift belongs to someone else now');
      if (!covers(toUser, mine.service_id) || !covers(user.id, theirs.service_id)) {
        throw httpError(400, 'You each need to cover the other’s service to swap');
      }
      theirShift = theirs.id;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO trades (id, period_id, kind, shift_id, from_user, to_user, their_shift_id, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, mine.period_id, body.kind, mine.id, user.id, toUser, theirShift, body.kind === 'swap' ? 'proposed' : 'open', body.note.trim(), new Date().toISOString());
    reply.code(201);
    return describe(trade(id)!, user);
  });

  const step = (
    path: string,
    handler: (t: TradeRow, user: User, body: { adminNote?: string }) => { status: Status; toUser?: string },
  ) =>
    app.post<{ Params: { id: string } }>(`/api/trades/:id/${path}`, async (req) => {
      const t = trade(req.params.id);
      if (!t) throw httpError(404, 'Swap not found');
      const body = parse(z.object({ adminNote: z.string().max(500).optional() }), req.body);
      const next = handler(t, me(req), body);
      db.prepare(
        'UPDATE trades SET status = ?, to_user = COALESCE(?, to_user), admin_note = COALESCE(?, admin_note), decided_at = ? WHERE id = ?',
      ).run(next.status, next.toUser ?? null, body.adminNote ?? null, new Date().toISOString(), t.id);
      return describe(trade(t.id)!, me(req));
    });

  // Take an open offer.
  step('take', (t, user) => {
    notViewerUser(user);
    if (t.kind !== 'offer' || t.status !== 'open') throw httpError(409, 'This offer is no longer open');
    if (t.from_user === user.id) throw httpError(400, 'You can’t take your own offer');
    const s = tradeable(shift(t.shift_id), 'That shift');
    if (!covers(user.id, s.service_id)) throw httpError(403, 'You don’t cover this service');
    return { status: 'accepted', toUser: user.id };
  });

  step('accept', (t, user) => {
    if (t.kind !== 'swap' || t.status !== 'proposed' || t.to_user !== user.id) throw httpError(409, 'This swap isn’t waiting on you');
    tradeable(shift(t.shift_id), 'That shift');
    tradeable(shift(t.their_shift_id!), 'Your shift');
    return { status: 'accepted' };
  });

  step('decline', (t, user) => {
    if (t.kind !== 'swap' || t.status !== 'proposed' || t.to_user !== user.id) throw httpError(409, 'This swap isn’t waiting on you');
    return { status: 'declined' };
  });

  step('cancel', (t, user) => {
    if (t.from_user !== user.id || !ACTIVE.includes(t.status)) throw httpError(409, 'This can’t be cancelled now');
    return { status: 'cancelled' };
  });

  const decide = (t: TradeRow, user: User) => {
    if (t.status !== 'accepted') throw httpError(409, 'Only swaps both sides agreed to can be decided');
    for (const id of [t.shift_id, t.their_shift_id].filter(Boolean) as string[]) {
      const s = shift(id);
      if (!s || !canEditShift(user, { serviceId: s.service_id, kind: s.kind })) {
        throw httpError(403, s?.kind === 'weekend' ? 'Only the overall admin can approve weekend swaps' : 'Not your team’s shift');
      }
    }
  };

  step('reject', (t, user) => {
    decide(t, user);
    return { status: 'rejected' };
  });

  step('approve', (t, user) => {
    decide(t, user);
    // Make sure nothing changed hands since both sides agreed.
    if (ownerOf(t.shift_id) !== t.from_user) throw httpError(409, 'The offered shift changed hands since this was agreed');
    if (t.their_shift_id && ownerOf(t.their_shift_id) !== t.to_user) throw httpError(409, 'The other shift changed hands; ask them to propose again');
    transaction(db, () => {
      // Hand-placed, so re-optimizing keeps the new owners.
      const set = db.prepare("UPDATE assignments SET user_id = ?, locked = 1, source = NULL WHERE shift_id = ?");
      set.run(t.to_user, t.shift_id);
      if (t.their_shift_id) set.run(t.from_user, t.their_shift_id);
    });
    for (const periodId of new Set([t.period_id, t.their_shift_id && shift(t.their_shift_id)?.period_id].filter(Boolean) as string[])) {
      refreshCover(db, periodId);
    }
    return { status: 'approved' };
  });

  function notViewerUser(user: User) {
    if (user.role === 'viewer') throw httpError(403, 'View-only accounts can’t trade shifts');
  }
}
