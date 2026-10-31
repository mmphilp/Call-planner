import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, type Db } from '../db';
import { LoginGuard } from '../login-guard';
import { syncUnpublished } from '../sync';
import { httpError, me, parse, requireAdmin, requireScheduler } from '../http';
import { hashPassword, verifyPassword } from '../passwords';
import { getUser, getUserRowByEmail, listServices, listUsers, setUserAdminServices, setUserServices, toService } from '../repo';

// Field rules without defaults, so partial updates (PATCH) only touch the
// fields actually sent. Creating applies the defaults.
const userFields = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'surgeon']),
  fte: z.number().min(0).max(1.5),
  active: z.boolean(),
  takesCall: z.boolean(),
  phone: z.string().nullable().optional(),
  serviceIds: z.array(z.string()),
  /** Services whose weekday call this person manages. */
  adminServiceIds: z.array(z.string()),
  password: z.string().min(8),
});
const userBody = userFields.extend({
  role: userFields.shape.role.default('surgeon'),
  fte: userFields.shape.fte.default(1),
  active: userFields.shape.active.default(true),
  takesCall: userFields.shape.takesCall.default(true),
  serviceIds: userFields.shape.serviceIds.default([]),
  adminServiceIds: userFields.shape.adminServiceIds.default([]),
});
const userPatch = userFields.partial();

const serviceFields = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  coversWeekdayDay: z.boolean(),
  coversWeekdayNight: z.boolean(),
  coversWeekend: z.boolean(),
  sort: z.number().int(),
});
const serviceBody = serviceFields.extend({
  color: serviceFields.shape.color.default('#2563eb'),
  coversWeekdayDay: serviceFields.shape.coversWeekdayDay.default(true),
  coversWeekdayNight: serviceFields.shape.coversWeekdayNight.default(true),
  coversWeekend: serviceFields.shape.coversWeekend.default(true),
  sort: serviceFields.shape.sort.default(0),
});
const servicePatch = serviceFields.partial();

export function newCalendarToken() {
  return randomBytes(24).toString('base64url');
}

export function createUser(db: Db, input: z.input<typeof userBody>) {
  const u = userBody.parse(input);
  const id = randomUUID();
  transaction(db, () => {
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, fte, active, takes_call, phone, calendar_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      u.email,
      u.name,
      hashPassword(u.password),
      u.role,
      u.fte,
      u.active ? 1 : 0,
      u.takesCall ? 1 : 0,
      u.phone ?? null,
      newCalendarToken(),
    );
    setUserServices(db, id, u.serviceIds);
    setUserAdminServices(db, id, u.adminServiceIds);
  });
  return getUser(db, id)!;
}

export function peopleRoutes(app: FastifyInstance, db: Db) {
  const guard = new LoginGuard();

  app.post('/api/auth/login', { config: { public: true } }, async (req) => {
    const { email, password } = parse(z.object({ email: z.string(), password: z.string() }), req.body);
    const wait = guard.blockedFor(req.ip, email.trim());
    if (wait) throw httpError(429, `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    const row = getUserRowByEmail(db, email.trim());
    if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
      guard.recordFailure(req.ip, email.trim());
      throw httpError(401, 'Incorrect email or password');
    }
    guard.recordSuccess(req.ip, email.trim());
    const token = app.jwt.sign({ sub: row.id }, { expiresIn: '30d' });
    return { token, user: getUser(db, row.id) };
  });

  app.get('/api/me', async (req) => {
    const row = db.prepare('SELECT calendar_token FROM users WHERE id = ?').get(me(req).id) as {
      calendar_token: string;
    };
    return { ...me(req), calendarPath: `/cal/${row.calendar_token}.ics` };
  });

  app.post('/api/me/password', async (req) => {
    const body = parse(z.object({ current: z.string(), next: z.string().min(8) }), req.body);
    const row = getUserRowByEmail(db, me(req).email)!;
    if (!verifyPassword(body.current, row.password_hash)) throw httpError(400, 'Current password is wrong');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.next), row.id);
    return { ok: true };
  });

  // Team admins need the roster to fill their team's shifts.
  app.get('/api/users', async (req) => {
    requireScheduler(req);
    return listUsers(db);
  });

  app.post('/api/users', async (req, reply) => {
    requireAdmin(req);
    const body = parse(userBody, req.body);
    if (getUserRowByEmail(db, body.email)) throw httpError(409, 'A user with that email already exists');
    reply.code(201);
    return createUser(db, body);
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    requireAdmin(req);
    const existing = getUser(db, req.params.id);
    if (!existing) throw httpError(404, 'User not found');
    const body = parse(userPatch, req.body);
    if (req.params.id === me(req).id && (body.role === 'surgeon' || body.active === false)) {
      throw httpError(400, 'You cannot remove your own admin access');
    }
    transaction(db, () => {
      const cols: Record<string, unknown> = {
        email: body.email,
        name: body.name,
        role: body.role,
        fte: body.fte,
        active: body.active === undefined ? undefined : body.active ? 1 : 0,
        takes_call: body.takesCall === undefined ? undefined : body.takesCall ? 1 : 0,
        phone: body.phone,
        password_hash: body.password ? hashPassword(body.password) : undefined,
      };
      for (const [col, val] of Object.entries(cols)) {
        if (val !== undefined) db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(val as any, req.params.id);
      }
      if (body.serviceIds) setUserServices(db, req.params.id, body.serviceIds);
      if (body.adminServiceIds) setUserAdminServices(db, req.params.id, body.adminServiceIds);
    });
    return getUser(db, req.params.id);
  });

  app.get('/api/services', async () => listServices(db));

  app.post('/api/services', async (req, reply) => {
    requireAdmin(req);
    const s = parse(serviceBody, req.body);
    const id = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || randomUUID();
    if (db.prepare('SELECT 1 FROM services WHERE id = ?').get(id)) throw httpError(409, 'Service already exists');
    db.prepare(
      `INSERT INTO services (id, name, color, covers_day, covers_night, covers_weekend, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, s.name, s.color, +s.coversWeekdayDay, +s.coversWeekdayNight, +s.coversWeekend, s.sort);
    syncUnpublished(db);
    reply.code(201);
    return toService(db.prepare('SELECT * FROM services WHERE id = ?').get(id) as any);
  });

  app.patch<{ Params: { id: string } }>('/api/services/:id', async (req) => {
    requireAdmin(req);
    const s = parse(servicePatch, req.body);
    const cols: Record<string, unknown> = {
      name: s.name,
      color: s.color,
      covers_day: s.coversWeekdayDay === undefined ? undefined : +s.coversWeekdayDay,
      covers_night: s.coversWeekdayNight === undefined ? undefined : +s.coversWeekdayNight,
      covers_weekend: s.coversWeekend === undefined ? undefined : +s.coversWeekend,
      sort: s.sort,
    };
    for (const [col, val] of Object.entries(cols)) {
      if (val !== undefined) db.prepare(`UPDATE services SET ${col} = ? WHERE id = ?`).run(val as any, req.params.id);
    }
    const row = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    if (!row) throw httpError(404, 'Service not found');
    // Coverage changes take effect on every unpublished schedule right away.
    if (s.coversWeekdayDay !== undefined || s.coversWeekdayNight !== undefined || s.coversWeekend !== undefined) {
      syncUnpublished(db);
    }
    return toService(row as any);
  });

  app.delete<{ Params: { id: string } }>('/api/services/:id', async (req) => {
    requireAdmin(req);
    if (db.prepare('SELECT 1 FROM shifts WHERE service_id = ? LIMIT 1').get(req.params.id)) {
      throw httpError(409, 'This service has shifts in a schedule; remove them first');
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
    syncUnpublished(db);
    return { ok: true };
  });
}
