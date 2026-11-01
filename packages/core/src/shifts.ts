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
   * (Friday holiday: starts 7am Friday; Monday: ends 7am Tuesday); any other
   * gets a holiday block of its own, 7am to 7am. Holiday blocks are weekend
   * shifts dated on the holiday.
   */
  extendWeekendsForHolidays?: boolean;
  /**
   * Extra days off that join a holiday to the weekend without being holidays
   * themselves, e.g. the Friday after Thanksgiving.
   */
  bridgeDays?: DateStr[];
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

  // Days off for the teams: holidays, plus bridge days (e.g. the Friday
  // after Thanksgiving) that join a holiday to the weekend.
  const off = new Set([...holidays, ...(opts.bridgeDays ?? [])]);
  const isOff = (d: DateStr) => extend && off.has(d) && isWeekday(d);

  /** Blocks every weekend service covers, as [id date, start, end] times. */
  const blocks: [DateStr, string, string][] = [];
  const inBlock = new Set<DateStr>();
  const addBlock = (date: DateStr, start: string, end: string) => {
    blocks.push([date, start, end]);
    for (let d = start.slice(0, 10); at(d, '12:00') < end; d = addDays(d, 1)) if (at(d, '12:00') > start) inBlock.add(d);
  };
  for (const date of eachDay(opts.start, opts.end)) {
    if (dayOfWeek(date) !== 5) continue;
    // Days off next to the weekend fold into it. A Friday holiday starts the
    // block at 7am that Friday (Christmas Eve and Day: 7am Thursday); a
    // Monday holiday ends it at 7am Tuesday.
    let first = date;
    while (isOff(first) && isOff(addDays(first, -1))) first = addDays(first, -1);
    let to = addDays(date, 3);
    while (isOff(to)) to = addDays(to, 1);
    addBlock(date, isOff(date) ? at(first, DAY_START) : at(date, DAY_END), at(to, DAY_START));
  }
  if (extend) {
    // Other weekday holidays get a block of their own, 7am to 7am the next day.
    for (const date of eachDay(opts.start, opts.end)) {
      if (!isOff(date) || inBlock.has(date)) continue;
      let last = date;
      while (isOff(addDays(last, 1)) && !inBlock.has(addDays(last, 1))) last = addDays(last, 1);
      addBlock(date, at(date, DAY_START), at(addDays(last, 1), DAY_START));
    }
  }

  // The weekday call these blocks replace, for every service.
  if (hasWeekendBlocks) {
    for (const [, start, end] of blocks) {
      for (let d = start.slice(0, 10); at(d, DAY_START) < end; d = addDays(d, 1)) {
        if (start <= at(d, DAY_START) && at(d, DAY_END) <= end) absorbed.add(`${d}|day`);
        if (start <= at(d, DAY_END) && at(addDays(d, 1), DAY_START) <= end) absorbed.add(`${d}|night`);
      }
    }
  }

  for (const service of opts.services) {
    if (!service.coversWeekend) continue;
    for (const [date, start, end] of blocks) {
      const touchesHoliday = [...holidays].some((d) => at(d, '12:00') > start && at(d, '12:00') < end);
      shifts.push({
        id: shiftId(service.id, 'weekend', date),
        serviceId: service.id,
        kind: 'weekend',
        date,
        start,
        end,
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
