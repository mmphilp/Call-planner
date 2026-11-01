import {
  halfYearLabel,
  type Assignment,
  type CallRequest,
  type Half,
  type Rules,
  type Service,
  type Shift,
  type ShiftKind,
  type Surgeon,
} from '@call-planner/core';
import type { Db } from './db';
import { calendarHolidays, normalizeHolidays, type CalendarHoliday, type PeriodHoliday } from './holidays';

type Row = Record<string, any>;

export type Role = 'admin' | 'surgeon' | 'viewer';
export type PeriodStatus = 'draft' | 'open' | 'closed' | 'review' | 'published';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  fte: number;
  active: boolean;
  takesCall: boolean;
  phone: string | null;
  serviceIds: string[];
  /** Services whose weekday call this user manages (team admin). */
  adminServiceIds: string[];
}

export interface Period {
  id: string;
  year: number;
  half: Half;
  label: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  requestDeadline: string | null;
  /** Observed holidays this schedule uses (date + name). */
  holidays: PeriodHoliday[];
  /** Holiday markers for calendars: actual dates, and observed days that differ. */
  calendarHolidays: CalendarHoliday[];
  rules: Partial<Rules>;
  publishedAt: string | null;
  /** Services published on their own before the whole schedule. */
  publishedServiceIds: string[];
}

export interface RequestRow extends CallRequest {
  periodId: string;
  userName: string;
  adminNote: string;
  createdAt: string;
  decidedAt: string | null;
}

function toUser(db: Db, r: Row): User {
  const serviceIds = db
    .prepare('SELECT service_id FROM user_services WHERE user_id = ?')
    .all(r.id)
    .map((s: Row) => s.service_id as string);
  const adminServiceIds = db
    .prepare('SELECT service_id FROM service_admins WHERE user_id = ?')
    .all(r.id)
    .map((s: Row) => s.service_id as string);
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    fte: r.fte,
    active: !!r.active,
    takesCall: !!r.takes_call,
    phone: r.phone ?? null,
    serviceIds,
    adminServiceIds,
  };
}

export function getUser(db: Db, id: string): User | undefined {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
  return r && toUser(db, r);
}

export function getUserRowByEmail(db: Db, email: string): Row | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Row | undefined;
}

export function listUsers(db: Db): User[] {
  return (db.prepare('SELECT * FROM users ORDER BY name').all() as Row[]).map((r) => toUser(db, r));
}

export function setUserServices(db: Db, userId: string, serviceIds: string[]) {
  db.prepare('DELETE FROM user_services WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO user_services (user_id, service_id) VALUES (?, ?)');
  for (const s of new Set(serviceIds)) ins.run(userId, s);
}

export function setUserAdminServices(db: Db, userId: string, serviceIds: string[]) {
  db.prepare('DELETE FROM service_admins WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO service_admins (user_id, service_id) VALUES (?, ?)');
  for (const s of new Set(serviceIds)) ins.run(userId, s);
}

export interface RoutineDay {
  serviceId: string;
  kind: 'day' | 'night';
  /** 1 = Monday … 5 = Friday */
  weekday: number;
  userId: string;
}

export function listRoutine(db: Db): RoutineDay[] {
  return (db.prepare('SELECT * FROM routine_days ORDER BY service_id, kind, weekday').all() as Row[]).map((r) => ({
    serviceId: r.service_id,
    kind: r.kind,
    weekday: r.weekday,
    userId: r.user_id,
  }));
}

/** Surgeons who take part in the call pool, in the optimizer's shape. */
export function callPool(db: Db): Surgeon[] {
  return listUsers(db)
    .filter((u) => u.active && u.takesCall)
    .map((u) => ({ id: u.id, name: u.name, fte: u.fte, serviceIds: u.serviceIds }));
}

export function toService(
  r: Row,
): Service & { sort: number; weekdayMode: 'shift' | 'week'; weekdayRules: boolean; backupServiceId: string | null } {
  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name ?? '',
    color: r.color,
    coversWeekdayDay: !!r.covers_day,
    coversWeekdayNight: !!r.covers_night,
    coversWeekend: !!r.covers_weekend,
    weekdayMode: r.weekday_mode === 'week' ? 'week' : 'shift',
    weekdayRules: !!r.weekday_rules,
    backupServiceId: r.backup_service_id ?? null,
    sort: r.sort,
  };
}

export function listServices(db: Db) {
  return (db.prepare('SELECT * FROM services ORDER BY sort, name').all() as Row[]).map(toService);
}

function toPeriod(r: Row): Period {
  return {
    id: r.id,
    year: r.year,
    half: r.half,
    label: halfYearLabel(r.year, r.half),
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    requestDeadline: r.request_deadline ?? null,
    holidays: normalizeHolidays(JSON.parse(r.holidays_json)),
    calendarHolidays: calendarHolidays(r.start_date, r.end_date, normalizeHolidays(JSON.parse(r.holidays_json))),
    rules: JSON.parse(r.rules_json),
    publishedAt: r.published_at ?? null,
    publishedServiceIds: [],
  };
}

/** Services published on their own ahead of the whole schedule. */
function withPublishedServices(db: Db, p: Period): Period {
  const rows = db.prepare('SELECT service_id FROM published_services WHERE period_id = ?').all(p.id) as { service_id: string }[];
  return { ...p, publishedServiceIds: rows.map((r) => r.service_id) };
}

/** Is this service's part of the schedule final (whole schedule published, or the service on its own)? */
export const isLive = (p: Period, serviceId: string) => p.status === 'published' || p.publishedServiceIds.includes(serviceId);

/** SQL: shift `s` (in period `p`) is published, wholly or by its service. */
export const LIVE_SQL = `(p.status = 'published' OR EXISTS (SELECT 1 FROM published_services ps WHERE ps.period_id = s.period_id AND ps.service_id = s.service_id))`;

export function getPeriod(db: Db, id: string): Period | undefined {
  const r = db.prepare('SELECT * FROM periods WHERE id = ?').get(id) as Row | undefined;
  return r && withPublishedServices(db, toPeriod(r));
}

export function listPeriods(db: Db): Period[] {
  return (db.prepare('SELECT * FROM periods ORDER BY year DESC, half DESC').all() as Row[]).map((r) => withPublishedServices(db, toPeriod(r)));
}

/** A shift plus who covers it from outside the call pool, if anyone. */
export type ScheduledShift = Shift & { coveredBy?: string };

export function listShifts(db: Db, periodId: string): ScheduledShift[] {
  return (db.prepare('SELECT * FROM shifts WHERE period_id = ? ORDER BY start').all(periodId) as Row[]).map(
    (r) => ({
      id: r.id,
      serviceId: r.service_id,
      kind: r.kind as ShiftKind,
      date: r.date,
      start: r.start,
      end: r.end,
      holiday: r.holiday ? true : undefined,
      coveredBy: r.covered_by ?? undefined,
    }),
  );
}

/** Shifts the call pool must fill: everything not covered by a locum. */
export function poolShifts(db: Db, periodId: string): Shift[] {
  return listShifts(db, periodId)
    .filter((s) => !s.coveredBy)
    .map(({ coveredBy: _, ...s }) => s);
}

export type StoredAssignment = Assignment & { source?: 'backup' };

export function listAssignments(db: Db, periodId: string): StoredAssignment[] {
  return (
    db
      .prepare(
        `SELECT a.* FROM assignments a JOIN shifts s ON s.id = a.shift_id
         WHERE s.period_id = ? ORDER BY s.start`,
      )
      .all(periodId) as Row[]
  ).map((r) => ({
    shiftId: r.shift_id,
    userId: r.user_id,
    locked: !!r.locked,
    ...(r.source === 'backup' ? { source: 'backup' as const } : {}),
  }));
}

function toRequest(r: Row): RequestRow {
  return {
    id: r.id,
    periodId: r.period_id,
    userId: r.user_id,
    userName: r.user_name,
    type: r.type,
    startDate: r.start_date,
    endDate: r.end_date,
    shiftKinds: r.shift_kinds ? (r.shift_kinds.split(',') as ShiftKind[]) : [],
    note: r.note,
    status: r.status,
    adminNote: r.admin_note,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? null,
  };
}

export function listRequests(db: Db, filter: { periodId?: string; userId?: string }): RequestRow[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.periodId) {
    where.push('r.period_id = ?');
    args.push(filter.periodId);
  }
  if (filter.userId) {
    where.push('r.user_id = ?');
    args.push(filter.userId);
  }
  const sql = `SELECT r.*, u.name AS user_name FROM requests r JOIN users u ON u.id = r.user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.start_date, u.name`;
  return (db.prepare(sql).all(...args) as Row[]).map(toRequest);
}

export function getRequest(db: Db, id: string): RequestRow | undefined {
  const r = db
    .prepare('SELECT r.*, u.name AS user_name FROM requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?')
    .get(id) as Row | undefined;
  return r && toRequest(r);
}
