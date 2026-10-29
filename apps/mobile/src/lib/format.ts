import type { ShiftKind } from './api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const KIND_LABEL: Record<ShiftKind, string> = { day: 'Day call', night: 'Night call', weekend: 'Weekend call' };

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number) {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "Fri, Jan 8" */
export function shortDate(date: string) {
  const { m, d, dow } = parts(date);
  return `${DAYS[dow]}, ${MONTHS[m - 1]} ${d}`;
}

export function monthLabel(date: string) {
  const { y, m } = parts(date);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "5pm" / "7am" from 'YYYY-MM-DDTHH:mm' */
export function timeLabel(t: string) {
  const h = Number(t.slice(11, 13));
  const min = t.slice(14, 16);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return min === '00' ? `${h12}${suffix}` : `${h12}:${min}${suffix}`;
}

/** "Fri 5pm → Mon 7am" style span for a shift. */
export function shiftSpan(s: { start: string; end: string }) {
  const sd = s.start.slice(0, 10);
  const ed = s.end.slice(0, 10);
  if (sd === ed) return `${timeLabel(s.start)} – ${timeLabel(s.end)}`;
  const days = Math.round((Date.parse(ed) - Date.parse(sd)) / 86_400_000);
  if (days === 1) return `${timeLabel(s.start)} – ${timeLabel(s.end)} next day`;
  return `${DAYS[parts(sd).dow]} ${timeLabel(s.start)} – ${DAYS[parts(ed).dow]} ${shortDate(ed).split(', ')[1]} ${timeLabel(s.end)}`;
}

export function dateRange(a: string, b: string) {
  return a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`;
}

export function dayOfWeek(date: string) {
  return parts(date).dow;
}

/** Current local wall-clock time as 'YYYY-MM-DDTHH:mm', comparable to shift times. */
export function nowLocal() {
  const n = new Date();
  return `${todayStr()}T${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}
