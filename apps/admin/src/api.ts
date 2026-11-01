import type {
  Assignment,
  CallRequest,
  Rules,
  Service,
  Shift,
  SurgeonStats,
  RequestOutcome,
  Violation,
} from '@call-planner/core';

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
  half: 1 | 2;
  label: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  requestDeadline: string | null;
  /** Holidays this schedule observes: the hospital's observed day and the holiday's name. */
  holidays: { date: string; name: string }[];
  rules: Partial<Rules>;
  publishedAt: string | null;
}

export interface RequestRow extends CallRequest {
  periodId: string;
  userName: string;
  adminNote: string;
  createdAt: string;
}

export interface Schedule {
  period: Period;
  /** Holiday markers for calendars: actual dates, and observed days that differ. */
  calendarHolidays: { date: string; name: string; observed: boolean }[];
  /** The shifts no longer match the services' coverage (admins only). */
  shiftsOutOfDate?: boolean;
  services: (Service & { color: string; sort: number })[];
  /** coveredBy: covered from outside the call pool (e.g. a locum). */
  shifts: (Shift & { coveredBy?: string })[];
  /** source 'backup': filled automatically by the team's covering service. */
  assignments: (Assignment & { source?: 'backup' })[];
  people: { id: string; name: string }[];
  /** Shifts changed after the schedule was first published. */
  changedShiftIds?: string[];
}

/** One entry in a schedule's change log (overall admin only). */
export interface ChangeEntry {
  id: string;
  at: string;
  by: { id: string; name: string } | null;
  action: 'shift' | 'status';
  /** How a shift changed: by hand, an approved swap, or while unpublished (found on republishing). */
  via: 'edit' | 'swap' | 'republish' | null;
  status: PeriodStatus | null;
  shift: TradeShift | null;
  from: { user: { id: string; name: string } | null; cover: string | null } | null;
  to: { user: { id: string; name: string } | null; cover: string | null } | null;
  note: string;
}

export interface TradeShift {
  id: string;
  serviceId: string;
  serviceName: string;
  kind: 'day' | 'night' | 'weekend';
  date: string;
  start: string;
  end: string;
}

/** A shift offer or swap between surgeons. */
export interface Trade {
  id: string;
  periodId: string;
  kind: 'offer' | 'swap';
  status: 'open' | 'proposed' | 'accepted' | 'approved' | 'declined' | 'cancelled' | 'rejected';
  note: string;
  adminNote: string;
  createdAt: string;
  decidedAt: string | null;
  shift?: TradeShift;
  theirShift?: TradeShift;
  from: { id: string; name: string };
  to: { id: string; name: string } | null;
  /** The signed-in admin may approve or reject it. */
  canDecide: boolean;
  /** Rule problems approving would add. */
  issues: string[];
}

/** A surgeon's flag on an assignment in a schedule out for review. */
export interface Flag {
  id: string;
  periodId: string;
  periodLabel: string;
  shift: TradeShift;
  from: { id: string; name: string };
  /** Who was on the shift when it was flagged, and who is on it now. */
  assignedThen: { id: string; name: string } | null;
  assignedNow: { id: string; name: string } | null;
  note: string;
  status: 'open' | 'fixed' | 'no_change' | 'withdrawn';
  adminNote: string;
  createdAt: string;
  resolvedAt: string | null;
  canResolve: boolean;
}

export interface Report {
  stats: SurgeonStats[];
  requestOutcomes: RequestOutcome[];
  violations: Violation[];
}

const TOKEN_KEY = 'call-planner-token';

export const auth = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable; stay signed in for this tab only */
    }
  },
};

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/auth/login') {
    auth.set(null);
    location.href = import.meta.env.BASE_URL;
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);
