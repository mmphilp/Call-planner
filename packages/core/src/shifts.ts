import { addDays, at, dayOfWeek, eachDay, type DateStr } from './dates';
import type { Service, Shift, ShiftKind } from './types';

export interface GenerateOptions {
  start: DateStr;
  end: DateStr;
  services: Service[];
  holidays?: DateStr[];
  /**
   * Give weekday holidays to the weekend services instead of the weekday
   * teams (default true). A holiday next to a weekend stretches that block
   * (Friday holiday: Thu 17:00 start; Monday: Tue 07:00 end); any other gets a
   * holiday block of its own from 17:00 the evening before to 07:00 the
   * morning after. Holiday blocks are weekend shifts dated on the holiday.
   */
  extendWeekendsForHolidays?: boolean;
}

export const DAY_START = '07:00';
export const DAY_END = '17:00';

/** A mid-week holiday block (e.g. Thanksgiving): a weekend-kind shift not dated on a Friday. */
export const isHolidayBlock = (s: { kind: ShiftKind; date: DateStr }) => s.kind === 'weekend' && dayOfWeek(s.date) !== 5;

export function shiftId(serviceId: string, kind: ShiftKind, date: DateStr): string {
  return `${serviceId}:${kind}:${date}`;
}

/**
 * Build every shift that needs coverage in [start, end]. A shift belongs to
 * the period in which it starts, so a weekend beginning on the last Friday
 * may run into the next period.
 */
export function generateShifts(opts: GenerateOptions): Shift[] {
  const holidays = new Set(opts.holidays ?? []);
  const extend = opts.extendWeekendsForHolidays ?? true;
  const shifts: Shift[] = [];

  // Weekend blocks cover the whole group: when any service has them, no
  // service gets weekday shifts inside a block (Friday night, or the nights
  // and days a holiday folds into the weekend). Weekday holidays work the
  // same way: only the weekend services cover them, in a holiday block.
  const absorbed = new Set<string>();
  const hasWeekendBlocks = opts.services.some((s) => s.coversWeekend);
  const isWeekday = (d: DateStr) => dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6;

  /** Mark the weekday call a block from `from` 17:00 to `to` 07:00 replaces. */
  const absorb = (from: DateStr, to: DateStr) => {
    for (let d = from; d < to; d = addDays(d, 1)) {
      absorbed.add(`${d}|night`);
      if (d > from) absorbed.add(`${d}|day`);
    }
  };

  /**
   * Blocks every weekend service covers, as [id date, from, to]: the block
   * runs from `from` at 17:00 to `to` at 07:00.
   */
  const blocks: [DateStr, DateStr, DateStr][] = [];
  const inBlock = new Set<DateStr>();
  for (const date of eachDay(opts.start, opts.end)) {
    if (dayOfWeek(date) !== 5) continue;
    // Holidays next to the weekend fold into it: the block starts the evening
    // before the first one and ends the morning after the last
    // (Friday holiday → Thu 5pm; Thursday and Friday → Wed 5pm; Monday → Tue 7am).
    let from = date;
    let to = addDays(date, 3);
    if (extend) {
      while (holidays.has(from) && isWeekday(from)) from = addDays(from, -1);
      while (holidays.has(to) && isWeekday(to)) to = addDays(to, 1);
    }
    blocks.push([date, from, to]);
    inBlock.add(date);
    for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) inBlock.add(d);
  }
  if (extend) {
    // Other weekday holidays get a holiday block of their own, e.g.
    // Thanksgiving: Wednesday 5pm to Friday 7am.
    for (const date of eachDay(opts.start, opts.end)) {
      if (!holidays.has(date) || !isWeekday(date) || inBlock.has(date)) continue;
      let last = date;
      while (holidays.has(addDays(last, 1)) && isWeekday(addDays(last, 1)) && !inBlock.has(addDays(last, 1))) last = addDays(last, 1);
      blocks.push([date, addDays(date, -1), addDays(last, 1)]);
      for (let d = date; d <= last; d = addDays(d, 1)) inBlock.add(d);
    }
  }

  if (hasWeekendBlocks) for (const [, from, to] of blocks) absorb(from, to);

  for (const service of opts.services) {
    if (!service.coversWeekend) continue;
    for (const [date, from, to] of blocks) {
      const touchesHoliday = eachDay(from, to).some((d) => holidays.has(d) && d > from && d < to);
      shifts.push({
        id: shiftId(service.id, 'weekend', date),
        serviceId: service.id,
        kind: 'weekend',
        date,
        start: at(from, DAY_END),
        end: at(to, DAY_START),
        holiday: touchesHoliday || undefined,
      });
    }
  }

  for (const date of eachDay(opts.start, opts.end)) {
    const dow = dayOfWeek(date);
    if (dow === 0 || dow === 6) continue;
    for (const service of opts.services) {
      const isHoliday = holidays.has(date) || undefined;
      if (service.coversWeekdayDay && !absorbed.has(`${date}|day`)) {
        shifts.push({
          id: shiftId(service.id, 'day', date),
          serviceId: service.id,
          kind: 'day',
          date,
          start: at(date, DAY_START),
          end: at(date, DAY_END),
          holiday: isHoliday,
        });
      }
      // Friday night is part of the weekend block.
      const fridayCoveredByWeekend = dow === 5 && hasWeekendBlocks;
      if (service.coversWeekdayNight && !fridayCoveredByWeekend && !absorbed.has(`${date}|night`)) {
        shifts.push({
          id: shiftId(service.id, 'night', date),
          serviceId: service.id,
          kind: 'night',
          date,
          start: at(date, DAY_END),
          end: at(addDays(date, 1), DAY_START),
          holiday: isHoliday,
        });
      }
    }
  }

  return shifts.sort((a, b) => a.start.localeCompare(b.start) || a.serviceId.localeCompare(b.serviceId));
}
