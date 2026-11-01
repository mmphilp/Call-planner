import { addDays, standardHolidays, type Shift } from '@call-planner/core';

/** A holiday as a schedule observes it: `date` is the day the hospital observes. */
export interface PeriodHoliday {
  date: string;
  name: string;
}

/** A holiday marker for calendars: the actual date, or the observed day when it differs. */
export interface CalendarHoliday {
  date: string;
  name: string;
  observed: boolean;
}

function yearsOf(start: string, end: string) {
  const out: number[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) out.push(y);
  return out;
}

/** Older schedules stored bare dates; name them when they match a known holiday. */
export function normalizeHolidays(raw: unknown): PeriodHoliday[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((h): PeriodHoliday => {
      if (typeof h === 'string') {
        const known = standardHolidays(Number(h.slice(0, 4))).find((s) => s.date === h || s.observed === h);
        return { date: h, name: known?.name ?? 'Holiday' };
      }
      const o = h as { date: string; name?: string };
      return { date: o.date, name: o.name?.trim() || 'Holiday' };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Days off that join a holiday to the weekend: the Friday after Thanksgiving. */
export const bridgeDays = (holidays: PeriodHoliday[]) =>
  holidays.filter((h) => /thanksgiving/i.test(h.name)).map((h) => addDays(h.date, 1));

/** Default observed holidays for a new schedule: the usual rule (Saturday → Friday, Sunday → Monday). */
export function defaultHolidays(start: string, end: string): PeriodHoliday[] {
  return yearsOf(start, end)
    .flatMap(standardHolidays)
    .filter((h) => h.observed >= start && h.observed <= end)
    .map((h) => ({ date: h.observed, name: h.name }));
}

/** Actual holiday dates in the period, plus observed days that fall on a different date. */
export function calendarHolidays(start: string, end: string, holidays: PeriodHoliday[]): CalendarHoliday[] {
  const actual = yearsOf(start, end)
    .flatMap(standardHolidays)
    .filter((h) => h.date >= start && h.date <= end)
    .map((h) => ({ date: h.date, name: h.name, observed: false }));
  const extra = holidays
    .filter((h) => !actual.some((a) => a.date === h.date && a.name === h.name))
    .map((h) => ({ ...h, observed: actual.some((a) => a.name === h.name) || standardHolidays(Number(h.date.slice(0, 4))).some((s) => s.name === h.name) }));
  return [...actual, ...extra].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Tag shifts with the holiday they cover: a weekday shift on an observed
 * day, or a weekend block that includes one.
 */
export function nameShifts<T extends Shift>(shifts: T[], holidays: PeriodHoliday[]): T[] {
  return shifts.map((s) => {
    // A block can take in more than one, e.g. Christmas Eve and Christmas.
    const hs =
      s.kind === 'weekend'
        ? holidays.filter((x) => x.date >= s.start.slice(0, 10) && x.date < s.end.slice(0, 10))
        : holidays.filter((x) => x.date === s.date);
    if (!hs.length) return s;
    const names = [...new Set(hs.map((h) => h.name))];
    return { ...s, holidayName: names.join(' & '), holidayNames: names };
  });
}
