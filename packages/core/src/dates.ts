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
  return half === 1 ? `Jan–Jun ${year}` : `Jul–Dec ${year}`;
}
