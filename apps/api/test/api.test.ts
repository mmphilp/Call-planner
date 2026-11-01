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
  it('shows the support contact on the sign-in page without signing in', async () => {
    expect((await call(null, 'GET', '/api/info')).body).toEqual({ supportEmail: null });
    const other = (await buildApp({ jwtSecret: 'test', supportEmail: 'help@x.org' })).app;
    expect((await other.inject({ url: '/api/info' })).json()).toEqual({ supportEmail: 'help@x.org' });
  });

  it('rejects bad passwords and missing tokens', async () => {
    expect((await call(null, 'POST', '/api/auth/login', { email: 's1@x.org', password: 'nope' })).status).toBe(401);
    expect((await call(null, 'GET', '/api/me')).status).toBe(401);
    const me = await call(surgeonTokens[0], 'GET', '/api/me');
    expect(me.body.name).toBe('Surgeon 1');
    expect(me.body.calendarPath).toMatch(/^\/cal\/.+\.ics$/);
  });

  it('locks out repeated wrong passwords but not a busy shared network', async () => {
    // Plenty of successful sign-ins from one address (a hospital network) are fine.
    for (let i = 0; i < 20; i++) expect(await login('s2@x.org')).toBeTruthy();
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call(null, 'POST', '/api/auth/login', { email: 's1@x.org', password: 'wrong' })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Other accounts on the same network can still sign in.
    expect(await login('s3@x.org')).toBeTruthy();
  });

  it('keeps admin endpoints away from surgeons', async () => {
    expect((await call(surgeonTokens[0], 'GET', '/api/users')).status).toBe(403);
    expect((await call(surgeonTokens[0], 'POST', '/api/periods', { year: 2027, half: 1 })).status).toBe(403);
  });
});

describe('partial updates', () => {
  it('saves a service calendar label without touching anything else', async () => {
    const before = (await call(adminToken, 'GET', '/api/services')).body.find((s: any) => s.id === 'general');
    expect(before.shortName).toBe('');
    const after = (await call(adminToken, 'PATCH', '/api/services/general', { shortName: ' GS ' })).body;
    expect(after).toEqual({ ...before, shortName: 'GS' });
  });

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

describe('week-long teams', () => {
  it('gives each week of a week-mode team to one surgeon', async () => {
    const users = (await call(adminToken, 'GET', '/api/users')).body;
    const s1 = users.find((u: any) => u.email === 's1@x.org').id;
    await call(adminToken, 'PATCH', `/api/users/${s1}`, { adminServiceIds: ['hand'] });
    const lead = surgeonTokens[0];
    expect((await call(lead, 'PUT', '/api/routine/settings', { serviceId: 'general', weekdayMode: 'week' })).status).toBe(403);
    const set = await call(lead, 'PUT', '/api/routine/settings', { serviceId: 'hand', weekdayMode: 'week' });
    expect(set.body).toMatchObject({ id: 'hand', weekdayMode: 'week' });

    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    const opt = await call(lead, 'POST', `/api/periods/${p.id}/optimize`, { seed: 1 });
    expect(opt.body.unassignedShiftIds).toEqual([]);
    expect(opt.body.weekCount).toBeGreaterThan(20);
    const sched = (await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`)).body;
    const who = new Map(sched.assignments.map((a: any) => [a.shiftId, a.userId]));
    const owners = new Map<string, Set<string>>();
    for (const s of sched.shifts.filter((x: any) => x.serviceId === 'hand')) {
      const d = new Date(`${s.date}T00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const wk = d.toISOString().slice(0, 10);
      owners.set(wk, (owners.get(wk) ?? new Set()).add(who.get(s.id) as string));
    }
    expect([...owners.values()].every((o) => o.size === 1)).toBe(true);
  }, 30_000);
});

describe('cross-cover', () => {
  it('fills a one-person team’s gaps from the covering service and follows changes', async () => {
    await call(adminToken, 'POST', '/api/services', { name: 'Endo', coversWeekdayDay: true, coversWeekdayNight: false, coversWeekend: false });
    const kuo = (await call(adminToken, 'POST', '/api/users', { email: 'kuo@x.org', name: 'Kuo', password: 'password123', serviceIds: ['endo'] })).body;
    await call(adminToken, 'PUT', '/api/routine/settings', { serviceId: 'endo', weekdayMode: 'week', backupServiceId: 'general' });
    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    await call(adminToken, 'POST', '/api/requests', { periodId: p.id, userId: kuo.id, type: 'unavailable', startDate: '2027-08-09', endDate: '2027-08-20' });

    const opt = await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 1 });
    expect(opt.body.unassignedShiftIds).toEqual([]);
    expect(opt.body.violations).toEqual([]);
    expect(opt.body.coverCount).toBe(10);

    const owner = async () => new Map((await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`)).body.assignments.map((a: any) => [a.shiftId, a]));
    let who = await owner();
    expect((who.get('endo:day:2027-08-12') as any).source).toBe('backup');
    expect((who.get('endo:day:2027-08-12') as any).userId).toBe((who.get('general:day:2027-08-12') as any).userId);
    expect((who.get('endo:day:2027-08-23') as any).userId).toBe(kuo.id);

    // Swap the covering service's surgeon that day: the cover moves with them.
    const users = (await call(adminToken, 'GET', '/api/users')).body;
    const other = users.find((u: any) => u.serviceIds.includes('general') && u.id !== (who.get('general:day:2027-08-12') as any).userId);
    await call(adminToken, 'PUT', `/api/periods/${p.id}/assignments/general:day:2027-08-12`, { userId: other.id });
    who = await owner();
    expect((who.get('endo:day:2027-08-12') as any).userId).toBe(other.id);
  }, 30_000);
});

describe('service coverage changes', () => {
  it('rebuilds unpublished schedules and flags published ones', async () => {
    const { body: open } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 1 });
    const { body: pub } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    await call(adminToken, 'PATCH', `/api/periods/${pub.id}`, { status: 'published' });

    // A shared weekend-only service never gets weekday shifts.
    await call(adminToken, 'POST', '/api/services', { name: 'Specialty Coverage', coversWeekdayDay: false, coversWeekdayNight: false, coversWeekend: true });
    let sched = (await call(adminToken, 'GET', `/api/periods/${open.id}/schedule`)).body;
    expect(sched.shifts.filter((s: any) => s.serviceId === 'specialty-coverage').every((s: any) => s.kind === 'weekend')).toBe(true);
    expect(sched.shifts.some((s: any) => s.serviceId === 'specialty-coverage')).toBe(true);

    // Turning off General's weekday nights takes effect without a manual rebuild.
    await call(adminToken, 'PATCH', '/api/services/general', { coversWeekdayNight: false });
    sched = (await call(adminToken, 'GET', `/api/periods/${open.id}/schedule`)).body;
    expect(sched.shifts.some((s: any) => s.serviceId === 'general' && s.kind === 'night')).toBe(false);
    expect(sched.shiftsOutOfDate).toBe(false);

    // The published schedule is left alone but flagged.
    const published = (await call(adminToken, 'GET', `/api/periods/${pub.id}/schedule`)).body;
    expect(published.shifts.some((s: any) => s.serviceId === 'general' && s.kind === 'night')).toBe(true);
    expect(published.shiftsOutOfDate).toBe(true);
  }, 30_000);
});

describe('holidays', () => {
  it('pre-fills observed holidays, names them, and rotates them year to year', async () => {
    const { body: y1 } = await call(adminToken, 'POST', '/api/periods', { year: 2026, half: 2 });
    expect(y1.holidays.map((h: any) => `${h.name} ${h.date}`)).toEqual([
      'Fourth of July 2026-07-03',
      'Labor Day 2026-09-07',
      'Thanksgiving 2026-11-26',
      'Christmas Eve 2026-12-24',
      'Christmas 2026-12-25',
    ]);
    // The hospital observes the Fourth on Monday the 6th this year.
    const moved = y1.holidays.map((h: any) => (h.name === 'Fourth of July' ? { ...h, date: '2026-07-06' } : h));
    await call(adminToken, 'PATCH', `/api/periods/${y1.id}`, { holidays: moved });
    const sched = (await call(adminToken, 'GET', `/api/periods/${y1.id}/schedule`)).body;
    expect(sched.calendarHolidays).toContainEqual({ date: '2026-07-04', name: 'Fourth of July', observed: false });
    expect(sched.calendarHolidays).toContainEqual({ date: '2026-07-06', name: 'Fourth of July', observed: true });
    // Weekend block stretched to Tuesday 7am and named.
    const w = sched.shifts.find((s: any) => s.id === 'general:weekend:2026-07-03');
    expect(w).toMatchObject({ end: '2026-07-07T07:00', holidayName: 'Fourth of July' });

    await call(adminToken, 'POST', `/api/periods/${y1.id}/optimize`, { seed: 1, kinds: ['weekend'] });
    const history = (await call(adminToken, 'GET', '/api/holidays/history')).body;
    const xmas26 = history.find((o: any) => o.name === 'Christmas' && o.date === '2026-12-25');
    const hadIt = xmas26.covers.find((c: any) => c.kind === 'weekend').userId;
    expect(hadIt).toBeTruthy();
    // Christmas Eve and Christmas are one block from 7am Christmas Eve, tracked as one holiday.
    const sched2 = (await call(adminToken, 'GET', `/api/periods/${y1.id}/schedule`)).body;
    expect(sched2.shifts.find((s: any) => s.id === 'general:weekend:2026-12-25')).toMatchObject({
      start: '2026-12-24T07:00',
      holidayName: 'Christmas Eve & Christmas',
    });
    expect(xmas26.label).toBe('Christmas Eve & Christmas');
    expect(history.some((o: any) => o.name === 'Christmas Eve')).toBe(false);
    expect(xmas26.covers.filter((c: any) => c.kind === 'weekend')).toHaveLength(1);

    // Next year: whoever had the Christmas weekend is rotated off it.
    const { body: y2 } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    for (const seed of [1, 2, 3]) {
      await call(adminToken, 'POST', `/api/periods/${y2.id}/optimize`, { seed, kinds: ['weekend'] });
      const h2 = (await call(adminToken, 'GET', '/api/holidays/history')).body;
      const xmas27 = h2.find((o: any) => o.name === 'Christmas' && o.date === '2027-12-24');
      expect(xmas27.covers.find((c: any) => c.kind === 'weekend').userId).not.toBe(hadIt);
    }
  }, 60_000);
});

describe('review before publishing', () => {
  it('shows surgeons the proposed schedule and lets them flag assignments', async () => {
    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    await call(adminToken, 'PATCH', `/api/periods/${p.id}`, { status: 'closed' });
    await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 1 });

    // Not out for review yet: surgeons see no assignments and can't flag.
    expect((await call(surgeonTokens[0], 'GET', `/api/periods/${p.id}/schedule`)).body.assignments).toHaveLength(0);
    const sched = (await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`)).body;
    const someone = sched.assignments.find((a: any) => a.userId !== undefined);
    expect((await call(surgeonTokens[0], 'POST', '/api/flags', { shiftId: someone.shiftId, note: 'x' })).status).toBe(409);

    await call(adminToken, 'PATCH', `/api/periods/${p.id}`, { status: 'review' });
    expect((await call(surgeonTokens[0], 'GET', `/api/periods/${p.id}/schedule`)).body.assignments.length).toBe(sched.assignments.length);
    const mine = (await call(surgeonTokens[0], 'GET', '/api/me/shifts?from=2027-07-01')).body;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((s: any) => s.proposed)).toBe(true);
    // Proposed shifts aren't in calendar feeds yet.
    const me0 = (await call(surgeonTokens[0], 'GET', '/api/me')).body;
    expect((await app.inject({ url: me0.calendarPath })).body).not.toContain('BEGIN:VEVENT');

    // Flag anyone's assignment, with a note.
    const weekend = sched.assignments.find((a: any) => a.shiftId.includes(':weekend:'));
    const f = await call(surgeonTokens[0], 'POST', '/api/flags', { shiftId: weekend.shiftId, note: 'I’m away that weekend' });
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({ status: 'open', note: 'I’m away that weekend', assignedThen: { id: weekend.userId } });
    expect((await call(surgeonTokens[0], 'POST', '/api/flags', { shiftId: weekend.shiftId, note: 'again' })).status).toBe(409);
    expect((await call(surgeonTokens[0], 'POST', '/api/flags', { shiftId: weekend.shiftId, note: '  ' })).status).toBe(400);

    // Others don't see it; the admin does, and resolves it.
    expect((await call(surgeonTokens[1], 'GET', '/api/flags')).body).toHaveLength(0);
    const all = (await call(adminToken, 'GET', `/api/flags?periodId=${p.id}&all=1`)).body;
    expect(all).toHaveLength(1);
    expect(all[0].canResolve).toBe(true);
    expect((await call(surgeonTokens[1], 'POST', `/api/flags/${all[0].id}/resolve`, { outcome: 'fixed' })).status).toBe(403);
    const done = await call(adminToken, 'POST', `/api/flags/${all[0].id}/resolve`, { outcome: 'no_change', adminNote: 'Request came in late' });
    expect(done.body).toMatchObject({ status: 'no_change', adminNote: 'Request came in late', canResolve: false });
    expect((await call(surgeonTokens[0], 'GET', '/api/flags')).body[0].status).toBe('no_change');

    // A second flag, withdrawn by the surgeon.
    const day = sched.assignments.find((a: any) => a.shiftId.includes(':day:'));
    const g = (await call(surgeonTokens[2], 'POST', '/api/flags', { shiftId: day.shiftId, note: 'Wrong person?' })).body;
    expect((await call(surgeonTokens[1], 'POST', `/api/flags/${g.id}/withdraw`)).status).toBe(404);
    expect((await call(surgeonTokens[2], 'POST', `/api/flags/${g.id}/withdraw`)).body.status).toBe('withdrawn');

    // The admin can still change the schedule while it's in review, then publish.
    expect((await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 2, kinds: ['weekend'] })).status).toBe(200);
    await call(adminToken, 'PATCH', `/api/periods/${p.id}`, { status: 'published' });
    expect((await call(surgeonTokens[0], 'GET', '/api/me/shifts?from=2027-07-01')).body.every((s: any) => !s.proposed)).toBe(true);
    expect((await call(surgeonTokens[0], 'POST', '/api/flags', { shiftId: day.shiftId, note: 'late' })).status).toBe(409);
  }, 60_000);
});

describe('viewer role and shift trades', () => {
  it('lets a viewer see everything but change nothing', async () => {
    await call(adminToken, 'POST', '/api/users', { email: 'assistant@x.org', name: 'Assistant', role: 'viewer', takesCall: false, password: 'password123' });
    const viewer = await login('assistant@x.org');
    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 1, kinds: ['weekend'] });

    // Drafts and assignments are visible…
    expect((await call(viewer, 'GET', '/api/periods')).body.map((x: any) => x.id)).toContain(p.id);
    expect((await call(viewer, 'GET', `/api/periods/${p.id}/schedule`)).body.assignments.length).toBeGreaterThan(0);
    for (const url of [`/api/periods/${p.id}/report`, '/api/users', '/api/holidays/history', `/api/periods/${p.id}/export.csv`, `/api/requests?periodId=${p.id}&all=1`]) {
      expect((await call(viewer, 'GET', url)).status).toBe(200);
    }
    // …but nothing can be changed.
    const shift = 'general:weekend:2027-07-09';
    expect((await call(viewer, 'PUT', `/api/periods/${p.id}/assignments/${shift}`, { userId: null })).status).toBe(403);
    expect((await call(viewer, 'POST', `/api/periods/${p.id}/optimize`, {})).status).toBe(403);
    expect((await call(viewer, 'PATCH', `/api/periods/${p.id}`, { status: 'published' })).status).toBe(403);
    expect((await call(viewer, 'POST', '/api/requests', { periodId: p.id, type: 'unavailable', startDate: '2027-08-02', endDate: '2027-08-03' })).status).toBe(403);
  });

  it('offers, swaps, and admin approval', async () => {
    const { body: p } = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2 });
    await call(adminToken, 'POST', `/api/periods/${p.id}/optimize`, { seed: 1, kinds: ['weekend'] });
    const users = (await call(adminToken, 'GET', '/api/users')).body;
    const tokenOf = (id: string) => surgeonTokens[Number(users.find((u: any) => u.id === id).email.match(/s(\d)@/)[1]) - 1];
    const owner = async () =>
      new Map<string, string>((await call(adminToken, 'GET', `/api/periods/${p.id}/schedule`)).body.assignments.map((a: any) => [a.shiftId, a.userId]));
    let who = await owner();
    const w1 = 'general:weekend:2027-07-09';
    const a = who.get(w1) as string;

    // Not published yet: no trading.
    expect((await call(tokenOf(a), 'POST', '/api/trades', { shiftId: w1, kind: 'offer' })).status).toBe(409);
    await call(adminToken, 'PATCH', `/api/periods/${p.id}`, { status: 'published' });

    // Offer: someone else who covers General takes it.
    const offer = (await call(tokenOf(a), 'POST', '/api/trades', { shiftId: w1, kind: 'offer', note: 'Family wedding' })).body;
    expect(offer.status).toBe('open');
    expect((await call(tokenOf(a), 'POST', '/api/trades', { shiftId: w1, kind: 'offer' })).status).toBe(409); // already offered
    const c = users.find((u: any) => u.serviceIds.includes('general') && u.id !== a && u.role === 'surgeon').id;
    const seen = (await call(tokenOf(c), 'GET', '/api/trades')).body;
    expect(seen.map((t: any) => t.id)).toContain(offer.id);
    expect((await call(tokenOf(c), 'POST', `/api/trades/${offer.id}/take`, {})).body.status).toBe('accepted');

    // A team admin can't approve a weekend; the overall admin can.
    await call(adminToken, 'PATCH', `/api/users/${users.find((u: any) => u.email === 's8@x.org').id}`, { adminServiceIds: ['general'] });
    expect((await call(surgeonTokens[7], 'POST', `/api/trades/${offer.id}/approve`, {})).status).toBe(403);
    const pending = (await call(adminToken, 'GET', `/api/trades?periodId=${p.id}&all=1`)).body.find((t: any) => t.id === offer.id);
    expect(pending.canDecide).toBe(true);
    expect(Array.isArray(pending.issues)).toBe(true);
    expect((await call(adminToken, 'POST', `/api/trades/${offer.id}/approve`, {})).body.status).toBe('approved');
    who = await owner();
    expect(who.get(w1)).toBe(c);

    // Swap: c swaps that weekend for someone else's, who declines then accepts a new proposal.
    const w2 = [...who.entries()].find(([id, u]) => id.includes(':weekend:') && id > 'general:weekend:2027-09' && u !== c)![0] as string;
    const b = who.get(w2) as string;
    const swap = (await call(tokenOf(c), 'POST', '/api/trades', { shiftId: w1, kind: 'swap', theirShiftId: w2 })).body;
    expect(swap).toMatchObject({ status: 'proposed', to: { id: b } });
    expect((await call(tokenOf(b), 'POST', `/api/trades/${swap.id}/decline`, {})).body.status).toBe('declined');
    const swap2 = (await call(tokenOf(c), 'POST', '/api/trades', { shiftId: w1, kind: 'swap', theirShiftId: w2, note: 'Please?' })).body;
    expect((await call(tokenOf(a), 'POST', `/api/trades/${swap2.id}/accept`, {})).status).toBe(409); // not theirs to accept
    expect((await call(tokenOf(b), 'POST', `/api/trades/${swap2.id}/accept`, {})).body.status).toBe('accepted');
    expect((await call(adminToken, 'POST', `/api/trades/${swap2.id}/approve`, {})).body.status).toBe('approved');
    who = await owner();
    expect([who.get(w1), who.get(w2)]).toEqual([b, c]);
  }, 30_000);
});

describe('full scheduling workflow', () => {
  it('collects requests, optimizes, edits, publishes and shares the schedule', async () => {
    const created = await call(adminToken, 'POST', '/api/periods', { year: 2027, half: 2, holidays: ['2027-09-06'] });
    expect(created.status).toBe(201);
    const periodId = created.body.id;
    expect(created.body.label).toBe('July–December 2027');

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
