import type { DateStr, LocalDateTime } from './dates';

/**
 * day     – weekday 07:00–17:00
 * night   – weekday 17:00–07:00 next morning (Mon–Thu)
 * weekend – Friday 17:00 – Monday 07:00 block
 */
export type ShiftKind = 'day' | 'night' | 'weekend';
export const SHIFT_KINDS: ShiftKind[] = ['day', 'night', 'weekend'];

export interface Service {
  id: string;
  name: string;
  color?: string;
  coversWeekdayDay: boolean;
  coversWeekdayNight: boolean;
  coversWeekend: boolean;
  /**
   * How the team covers weekdays: 'shift' fills each day/night separately;
   * 'week' gives one surgeon the whole Mon–Fri week where possible.
   */
  weekdayMode?: 'shift' | 'week';
  /** Apply rest / nights-per-week limits to this team's weekday call (default true; never in week mode). */
  weekdayRules?: boolean;
}

export interface Shift {
  id: string;
  serviceId: string;
  kind: ShiftKind;
  /** Calendar date the shift starts on. */
  date: DateStr;
  start: LocalDateTime;
  end: LocalDateTime;
  holiday?: boolean;
  /** Exempt from rest and nights-per-week rules (small teams, week-long call). */
  relaxed?: boolean;
}

export interface Surgeon {
  id: string;
  name: string;
  /** Relative share of call; 1 = full share, 0.5 = half share. */
  fte: number;
  /** Services this surgeon can cover. */
  serviceIds: string[];
}

export type RequestType = 'unavailable' | 'prefer_off' | 'prefer_on';
export type RequestStatus = 'pending' | 'approved' | 'denied';

export interface CallRequest {
  id: string;
  userId: string;
  type: RequestType;
  startDate: DateStr;
  endDate: DateStr;
  /** Restrict the request to certain shift kinds; empty/undefined = all. */
  shiftKinds?: ShiftKind[];
  status: RequestStatus;
  note?: string;
}

export interface Assignment {
  shiftId: string;
  userId: string;
  locked?: boolean;
}

export interface Rules {
  /** Minimum hours off between two shifts for the same surgeon (never broken). */
  minRestHours: number;
  /**
   * Rest the optimizer aims for (soft). Only matters when set above
   * minRestHours: shorter rest is then allowed, but only where needed.
   */
  preferredRestHours: number;
  /** Max weekday night shifts per Mon–Sun week. */
  maxNightsPerWeek: number;
  /** Weekends off required between weekend blocks (1 = no back-to-back weekends). */
  minWeekendsOffBetween: number;
  /** Shifts closer than this many days apart are penalised (soft). */
  preferredSpacingDays: number;
  weights: {
    fairness: number;
    preferOff: number;
    preferOn: number;
    pendingUnavailable: number;
    spacing: number;
    holiday: number;
    /** Cost of each pair of shifts with less than preferredRestHours between them. */
    shortRest: number;
  };
  /** Relative burden of each kind when balancing workload. */
  kindWeights: Record<ShiftKind, number>;
}

export const DEFAULT_RULES: Rules = {
  minRestHours: 12,
  preferredRestHours: 12,
  maxNightsPerWeek: 2,
  minWeekendsOffBetween: 1,
  preferredSpacingDays: 3,
  weights: {
    fairness: 10,
    preferOff: 150,
    preferOn: 100,
    pendingUnavailable: 300,
    spacing: 4,
    holiday: 10,
    shortRest: 250,
  },
  kindWeights: { day: 1, night: 1.5, weekend: 3 },
};

export function mergeRules(partial?: Partial<Rules> | null): Rules {
  return {
    ...DEFAULT_RULES,
    ...partial,
    weights: { ...DEFAULT_RULES.weights, ...partial?.weights },
    kindWeights: { ...DEFAULT_RULES.kindWeights, ...partial?.kindWeights },
  };
}
