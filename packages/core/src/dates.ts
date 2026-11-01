// Calendar helpers that work on plain 'YYYY-MM-DD' strings and local
// 'YYYY-MM-DDTHH:mm' wall-clock times. Everything is computed in UTC so the
// hospital's time zone (and DST changes) never shift a date.

export type DateStr = string; // YYYY-MM-DD
export type LocalDateTime = string; // YYYY-MM-DDTHH:mm

const DAY_MS = 86_400_000;

export function toUtc(date: DateStr): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUtc(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: DateStr, days: number): DateStr {
  return fromUtc(new Date(toUtc(date).getTime() + days * DAY_MS));
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(date: DateStr): number {
  return toUtc(date).getUTCDay();
}

export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / DAY_MS);
}

export function eachDay(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function at(date: DateStr, time: string): LocalDateTime {
  return `${date}T${time}`;
}

/** Minutes since epoch for a wall-clock time, for interval arithmetic. */
export function toMinutes(t: LocalDateTime): number {
  const [date, time = '00:00'] = t.split('T');
  const [hh, mm] = time.split(':').map(Number);
  return toUtc(date).getTime() / 60_000 + hh * 60 + mm;
}

/** Monday of the ISO week containing `date`; used to group nights per week. */
export function weekStart(date: DateStr): DateStr {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export type Half = 1 | 2;

/** Half 1 = January–June, half 2 = July–December. */
export function halfYearRange(year: number, half: Half): { start: DateStr; end: DateStr } {
  return half === 1
    ? { start: `${year}-01-01`, end: `${year}-06-30` }
    : { start: `${year}-07-01`, end: `${year}-12-31` };
}

export function halfYearLabel(year: number, half: Half): string {
  return half === 1 ? `January–June ${year}` : `July–December ${year}`;
}

export interface Holiday {
  name: string;
  /** The actual date. */
  date: DateStr;
  /** The usual observed weekday: Saturday → Friday, Sunday → Monday. */
  observed: DateStr;
}

export const HOLIDAY_NAMES = ['New Year’s Day', 'Memorial Day', 'Juneteenth', 'Fourth of July', 'Labor Day', 'Thanksgiving', 'Christmas Eve', 'Christmas'];

/** The n-th given weekday of a month (n = -1 for the last). */
function nthWeekday(year: number, month: number, weekday: number, n: number): DateStr {
  if (n > 0) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    return addDays(first, ((weekday - dayOfWeek(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`, -1);
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

/** The group's holidays for a year, with their usual observed days. */
export function standardHolidays(year: number): Holiday[] {
  const fixed = (m: number, d: number) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const observed = (date: DateStr) => {
    const dow = dayOfWeek(date);
    return dow === 6 ? addDays(date, -1) : dow === 0 ? addDays(date, 1) : date;
  };
  return [
    ['New Year’s Day', fixed(1, 1)],
    ['Memorial Day', nthWeekday(year, 5, 1, -1)],
    ['Juneteenth', fixed(6, 19)],
    ['Fourth of July', fixed(7, 4)],
    ['Labor Day', nthWeekday(year, 9, 1, 1)],
    ['Thanksgiving', nthWeekday(year, 11, 4, 4)],
    ['Christmas Eve', fixed(12, 24)],
    ['Christmas', fixed(12, 25)],
  ].map(([name, date]) => ({
    name,
    date,
    // Christmas Eve on a weekend is observed the Friday before (Christmas takes the Monday).
    observed: name === 'Christmas Eve' && dayOfWeek(date) % 6 === 0 ? addDays(date, dayOfWeek(date) === 6 ? -1 : -2) : observed(date),
  }));
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Friday, January 8" (add the year with { year: true }; drop the weekday with { weekday: false }). */
export function longDate(date: DateStr, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const md = `${MONTH_NAMES[m - 1]} ${d}`;
  const withDay = opts.weekday === false ? md : `${DAY_NAMES[dayOfWeek(date.slice(0, 10))]}, ${md}`;
  return opts.year ? `${withDay}, ${y}` : withDay;
}

/** "Friday, January 8 – Monday, January 11", or a single date when they match. */
export function longDateRange(a: DateStr, b: DateStr, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return a === b ? longDate(a, opts) : `${longDate(a, opts)} – ${longDate(b, opts)}`;
}

/** "5pm" / "7:30am" from 'YYYY-MM-DDTHH:mm'. */
export function timeOfDay(t: LocalDateTime): string {
  const h = Number(t.slice(11, 13));
  const min = t.slice(14, 16);
  const h12 = h % 12 || 12;
  return `${h12}${min === '00' ? '' : `:${min}`}${h >= 12 ? 'pm' : 'am'}`;
}

/** "Friday, January 8, 5pm – Monday, January 11, 7am". */
export function longSpan(start: LocalDateTime, end: LocalDateTime): string {
  return `${longDate(start)}, ${timeOfDay(start)} – ${longDate(end)}, ${timeOfDay(end)}`;
}
