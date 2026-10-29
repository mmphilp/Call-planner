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

export type Role = 'admin' | 'surgeon';
export type PeriodStatus = 'draft' | 'open' | 'closed' | 'published';

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
  holidays: string[];
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
  services: (Service & { color: string; sort: number })[];
  shifts: Shift[];
  assignments: Assignment[];
  people: { id: string; name: string }[];
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
    location.href = '/';
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
