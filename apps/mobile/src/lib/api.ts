import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type ShiftKind = 'day' | 'night' | 'weekend';
export type RequestType = 'unavailable' | 'prefer_off' | 'prefer_on';
export type RequestStatus = 'pending' | 'approved' | 'denied';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'surgeon';
  phone: string | null;
  serviceIds: string[];
  calendarPath?: string;
}

export interface Period {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'open' | 'closed' | 'published';
  requestDeadline: string | null;
}

export interface MyShift {
  id: string;
  serviceName: string;
  color?: string;
  kind: ShiftKind;
  date: string;
  start: string;
  end: string;
  holiday: boolean;
}

export interface Shift {
  id: string;
  serviceId: string;
  kind: ShiftKind;
  date: string;
  start: string;
  end: string;
  holiday?: boolean;
  /** Covered from outside the group (e.g. a locum). */
  coveredBy?: string;
}

export interface Schedule {
  period: Period;
  services: { id: string; name: string; color: string }[];
  shifts: Shift[];
  assignments: { shiftId: string; userId: string }[];
  people: { id: string; name: string; phone: string | null }[];
}

export interface CallRequest {
  id: string;
  periodId: string;
  type: RequestType;
  startDate: string;
  endDate: string;
  shiftKinds: ShiftKind[];
  note: string;
  status: RequestStatus;
  adminNote: string;
}

/**
 * Set EXPO_PUBLIC_API_URL to point the app at your server. The web build is
 * served by the API server itself, so there it defaults to the same origin.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web'
    ? globalThis.location?.origin ?? ''
    : ((Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000'));

const TOKEN_KEY = 'call-planner-token';

export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async set(token: string | null) {
    if (Platform.OS === 'web') {
      if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
      else globalThis.localStorage?.removeItem(TOKEN_KEY);
      return;
    }
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}
