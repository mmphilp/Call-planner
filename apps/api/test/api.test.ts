import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createUser } from '../src/routes/people';

type App = Awaited<ReturnType<typeof buildApp>>['app'];

let app: App;
let adminToken: string;
let surgeonTokens: string[];

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body as any,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
}

async function login(email: string) {
  const res = await call(null, 'POST', '/api/auth/login', { email, password: 'password123' });
  return res.body.token as string;
}

beforeEach(async () => {
  const built = await buildApp({ jwtSecret: 'test' });
  app = built.app;
  createUser(built.db, { email: 'admin@x.org', name: 'Admin', role: 'admin', takesCall: false, password: 'password123' });
  adminToken = await login('admin@x.org');
  await call(adminToken, 'POST', '/api/services', { name: 'General', coversWeekdayDay: true, coversWeekdayNight: true, coversWeekend: true });
  await call(adminToken, 'POST', '/api/services', { name: 'Hand', coversWeekdayDay: true, coversWeekdayNight: false, coversWeekend: false });
  surgeonTokens = [];
  for (let i = 1; i <= 8; i++) {
    await call(adminToken, 'POST', '/api/users', {
      email: `s${i}@x.org`,
      name: `Surgeon ${i}`,
      password: 'password123',
      serviceIds: i <= 4 ? ['general', 'hand'] : ['general'],
    });
    surgeonTokens.push(await login(`s${i}@x.org`));
  }
});

describe('auth', () => {
  it('rejects bad passwords and missing tokens', async () => {
    expect((await call(null, 'POST', '/api/auth/login', { email: 's1@x.org', password: 'nope' })).status).toBe(401);
    expect((await call(null, 'GET', '/api/me')).status).toBe(401);
    const me = await call(surgeonTokens[0], 'GET', '/api/me');
    expect(me.body.name).toBe('Surgeon 1');
    expect(me.body.calendarPath).toMatch(/^\/cal\/.+\.ics$/);
  });

  it('rate-limits repeated login attempts', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call(null, 'POST', '/api/auth/login', { email: 's1@x.org', password: 'wrong' })).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });

  it('keeps admin endpoints away from surgeons', async () => {
    expect((await call(surgeonTokens[0], 'GET', '/api/users')).status).toBe(403);
    expect((await call(surgeonTokens[0], 'POST', '/api/periods', { year: 2027, half: 1 })).status).toBe(403);
  });
});

describe('partial updates', () => {
  it('only changes the fields sent', async () => {
    const svc = await call(adminToken, 'PATCH', '/api/services/hand', { color: '#ff0000' });
    expect(svc.body).toMatchObject({ color: '#ff0000', coversWeekdayDay: true, coversWeekdayNight: false, coversWeekend: false });

    const users = (await call(adminToken, 'GET', '/api/users')).body;
    const admin = users.find((u: any) => u.email === 'admin@x.org');
    const s1 = users.find((u: any) => u.email === 's1@x.org');
    await call(adminToken, 'PATCH', `/api/users/${s1.id}`, { fte: 0.5 });
    await call(adminToken, 'PATCH', `/api/users/${admin.id}`, { name: 'Renamed' });
    const after = (await call(adminToken, 'GET', '/api/users')).body;
    expect(after.find((u: any) => u.id === s1.id)).toMatchObject({ fte: 0.5, serviceIds: s1.serviceIds, role: 'surgeon' });
    expect(after.find((u: any) => u.id === admin.id)).toMatchObject({ name: 'Renamed', role: 'admin', takesCall: false });
  });
});

describe('locum cover', () => {
  it('leaves locum weekends out of the optimizer and fair shares', async () => {
    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    const { body: s8 } = await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`);
    const weekendId = 'general:weekend:2027-07-02';
    await call(adminToken, 'PUT', `/api/periods/${p.id}/assignments/${weekendId}`, { userId: s8.people[1].id });
    const cover = await call(adminToken, 'PUT', `/api/periods/${p.id}/shifts/${weekendId}/cover`, { coveredBy: 'Dr. Locum' });
    expect(cover.status).toBe(200);

    const opt = await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 1 });
    expect(opt.body.unassignedShiftIds).toEqual([]);
    expect(opt.body.violations).toEqual([]);
    const weekendShare = opt.body.stats.reduce((t: number, s: any) => t + s.targets.weekend, 0);
    const weekends = s8.shifts.filter((s: any) => s.kind === 'weekend').length;
    expect(Math.round(weekendShare)).toBe(weekends - 1);

    const after = await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`);
    expect(after.body.shifts.find((s: any) => s.id === weekendId).coveredBy).toBe('Dr. Locum');
    expect(after.body.assignments.find((a: any) => a.shiftId === weekendId)).toBeUndefined();
    const csv = await call(adminToken, 'GET', `/api/periods/${p.id}/export.csv`);
    expect(csv.body).toContain('"Dr. Locum (locum)"');

    await call(adminToken, 'PUT', `/api/periods/${p.id}/shifts/${weekendId}/cover`, { coveredBy: null });
    const report = await call(adminToken, 'GET', `/api/periods/${p.id}/report`);
    expect(report.body.violations.map((v: any) => v.shiftIds[0])).toEqual([weekendId]);
  }, 30_000);
});

describe('team admins and routine days', () => {
  it('lets a team admin run their weekday call without touching weekends or other teams', async () => {
    const users = (await call(adminToken, 'GET', '/api/users')).body;
    const id = (email: string) => users.find((u: any) => u.email === email).id;
    const [s1, s2, s3] = ['s1@x.org', 's2@x.org', 's3@x.org'].map(id);
    // s1 manages the Hand team's weekday call.
    await call(adminToken, 'PATCH', `/api/users/${s1}`, { adminServiceIds: ['hand'] });
    const lead = surgeonTokens[0];

    expect((await call(lead, 'GET', '/api/users')).status).toBe(200);
    expect((await call(lead, 'PUT', '/api/routine', { serviceId: 'hand', kind: 'day', weekday: 1, userId: s2 })).status).toBe(200);
    expect((await call(lead, 'PUT', '/api/routine', { serviceId: 'hand', kind: 'day', weekday: 3, userId: s3 })).status).toBe(200);
    expect((await call(lead, 'PUT', '/api/routine', { serviceId: 'general', kind: 'day', weekday: 1, userId: s2 })).status).toBe(403);
    expect((await call(surgeonTokens[1], 'GET', '/api/routine')).status).toBe(403);

    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2, holidays: ['2027-09-06'] });
    await call(adminToken, 'POST', '/api/requests', { periodId: p.id, userId: s2, type: 'unavailable', startDate: '2027-08-02', endDate: '2027-08-06' });

    // Team admins can see drafts but not change the period itself or weekends.
    expect((await call(lead, 'GET', `/api/periods/${p.id}/schedule`)).status).toBe(200);
    expect((await call(lead, 'PATCH', `/api/periods/${p.id}`, { status: 'open' })).status).toBe(403);
    expect((await call(lead, 'PUT', `/api/periods/${p.id}/assignments/general:weekend:2027-07-02`, { userId: s1 })).status).toBe(403);
    expect((await call(lead, 'POST', `/api/periods/${p.id}/optimize`, { serviceIds: ['general'] })).status).toBe(403);

    const opt = await call(lead, 'POST', `/api/periods/${p.id}/optimize`, { seed: 2 });
    expect(opt.status).toBe(200);
    expect(opt.body.unassignedShiftIds).toEqual([]);
    const sched = (await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`)).body;
    const who = new Map(sched.assignments.map((a: any) => [a.shiftId, a.userId]));
    const handDays = sched.shifts.filter((s: any) => s.serviceId === 'hand');
    expect(handDays.every((s: any) => who.has(s.id))).toBe(true);
    expect(sched.shifts.filter((s: any) => s.serviceId === 'general').some((s: any) => who.has(s.id))).toBe(false);
    const mondays = handDays.filter((s: any) => new Date(s.date).getUTCDay() === 1);
    for (const s of mondays) {
      if (s.date >= '2027-08-02' && s.date <= '2027-08-06') expect(who.get(s.id)).not.toBe(s2);
      else if (s.date !== '2027-09-06') expect(who.get(s.id)).toBe(s2);
    }
    expect(handDays.filter((s: any) => new Date(s.date).getUTCDay() === 3).every((s: any) => who.get(s.id) === s3)).toBe(true);

    // The overall admin then fills weekends only; the Hand team's days stay put.
    await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 3, kinds: ['weekend'] });
    const after = (await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`)).body;
    const who2 = new Map(after.assignments.map((a: any) => [a.shiftId, a.userId]));
    expect(handDays.every((s: any) => who2.get(s.id) === who.get(s.id))).toBe(true);
    expect(after.shifts.filter((s: any) => s.kind === 'weekend').every((s: any) => who2.has(s.id))).toBe(true);
    expect(after.shifts.filter((s: any) => s.serviceId === 'general' && s.kind !== 'weekend').some((s: any) => who2.has(s.id))).toBe(false);
  }, 30_000);
});

describe('full scheduling workflow', () => {
  it('collects requests, optimizes, edits, publishes and shares the schedule', async () => {
    const created = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2, holidays: ['2027-09-06'] });
    expect(created.status).toBe(201);
    const periodId = created.body.id;
    expect(created.body.label).toBe('Jul–Dec 2027');

    // Draft periods are hidden from surgeons.
    expect((await call(surgeonTokens[0], 'GET', '/api/periods')).body).toEqual([]);
    const req = { periodId, type: 'unavailable', startDate: '2027-08-02', endDate: '2027-08-13', note: 'Vacation' };
    expect((await call(surgeonTokens[0], 'POST', '/api/requests', req)).status).toBe(404);

    await call(adminToken, 'PATCH', `/api/periods/${periodId}`, { status: 'open' });
    const filed = await call(surgeonTokens[0], 'POST', '/api/requests', req);
    expect(filed.status).toBe(201);
    expect(filed.body.status).toBe('pending');
    await call(surgeonTokens[1], 'POST', '/api/requests', {
      periodId,
      type: 'prefer_on',
      startDate: '2027-09-03',
      endDate: '2027-09-07',
      shiftKinds: ['weekend'],
    });
    const bad = await call(surgeonTokens[1], 'POST', '/api/requests', { ...req, startDate: '2028-03-01', endDate: '2028-03-02' });
    expect(bad.status).toBe(400);

    // Surgeons only see their own requests; admins see all.
    expect((await call(surgeonTokens[1], 'GET', `/api/requests?periodId=${periodId}`)).body).toHaveLength(1);
    expect((await call(adminToken, 'GET', `/api/requests?periodId=${periodId}&all=1`)).body).toHaveLength(2);
    expect((await call(surgeonTokens[1], 'GET', `/api/requests?periodId=${periodId}&all=1`)).body).toHaveLength(1);

    await call(adminToken, 'PATCH', `/api/requests/${filed.body.id}`, { status: 'approved' });
    await call(adminToken, 'PATCH', `/api/periods/${periodId}`, { status: 'closed' });
    expect((await call(surgeonTokens[2], 'POST', '/api/requests', req)).status).toBe(409);

    // Hand-pick one weekend, then let the optimizer fill the rest around it.
    const sched = await call(adminToken, 'GET', `/api/periods/${periodId}/schedule`);
    const labourDay = sched.body.shifts.find((s: any) => s.id === 'general:weekend:2027-09-03');
    expect(labourDay.end).toBe('2027-09-07T07:00');
    const s8 = sched.body.people.find((p: any) => p.name === 'Surgeon 8');
    await call(adminToken, 'PUT', `/api/periods/${periodId}/assignments/general:weekend:2027-07-02`, { userId: s8.id });

    const opt = await call(adminToken, 'POST', `/api/periods/${periodId}/optimize`, { seed: 4 });
    expect(opt.status).toBe(200);
    expect(opt.body.unassignedShiftIds).toEqual([]);
    expect(opt.body.violations).toEqual([]);
    expect(opt.body.requestOutcomes.every((o: any) => o.honored)).toBe(true);

    const after = await call(adminToken, 'GET', `/api/periods/${periodId}/schedule`);
    expect(after.body.assignments).toHaveLength(after.body.shifts.length);
    expect(after.body.assignments.find((a: any) => a.shiftId === 'general:weekend:2027-07-02')).toMatchObject({
      userId: s8.id,
      locked: true,
    });

    // Not visible to surgeons until published.
    expect((await call(surgeonTokens[0], 'GET', `/api/periods/${periodId}/schedule`)).body.assignments).toEqual([]);
    expect((await call(surgeonTokens[7], 'GET', '/api/me/shifts')).body).toEqual([]);

    await call(adminToken, 'PATCH', `/api/periods/${periodId}`, { status: 'published' });
    const mine = await call(surgeonTokens[7], 'GET', '/api/me/shifts');
    expect(mine.body[0]).toMatchObject({ id: 'general:weekend:2027-07-02', serviceName: 'General', kind: 'weekend' });

    // Published schedules are frozen until unpublished.
    expect((await call(adminToken, 'POST', `/api/periods/${periodId}/optimize`, {})).status).toBe(409);

    const csv = await call(adminToken, 'GET', `/api/periods/${periodId}/export.csv`);
    expect(csv.body.split('\n')[0]).toBe('"Date","Service","Shift","Start","End","Surgeon"');

    const me = await call(surgeonTokens[7], 'GET', '/api/me');
    const ics = await call(null, 'GET', me.body.calendarPath);
    expect(ics.status).toBe(200);
    expect(ics.body).toContain('BEGIN:VEVENT');
    expect(ics.body).toContain('DTSTART:20270702T170000');
    expect((await call(null, 'GET', '/cal/not-a-token.ics')).status).toBe(404);
  }, 30_000);

  it('reports rule breaks from manual edits', async () => {
    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 1 });
    const { body: sched } = await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`);
    const u = sched.people.find((x: any) => x.name === 'Surgeon 5');
    await call(adminToken, 'PUT', `/api/periods/${p.id}/assignments/general:day:2027-01-04`, { userId: u.id });
    await call(adminToken, 'PUT', `/api/periods/${p.id}/assignments/general:night:2027-01-04`, { userId: u.id });
    await call(adminToken, 'PUT', `/api/periods/${p.id}/assignments/hand:day:2027-01-05`, { userId: u.id });
    const report = await call(adminToken, 'GET', `/api/periods/${p.id}/report`);
    const types = new Set(report.body.violations.map((v: any) => v.type));
    expect(types).toEqual(new Set(['rest', 'ineligible', 'unassigned']));
  });
});
