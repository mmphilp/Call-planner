import { addDays, at, dayOfWeek, eachDay, type DateStr } from './dates';
import type { Service, Shift, ShiftKind } from './types';

export interface GenerateOptions {
  start: DateStr;
  end: DateStr;
  services: Service[];
  holidays?: DateStr[];
  /**
   * When a holiday falls on a Friday or Monday, stretch the weekend block to
   * cover it (Thu 17:00 start / Tue 07:00 end) instead of creating separate
   * weekday shifts for that day.
   */
  extendWeekendsForHolidays?: boolean;
}

export const DAY_START = '07:00';
export const DAY_END = '17:00';

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
  // service gets weekday shifts inside a block (Friday night, or the
  // Thursday night / Friday / Monday a holiday folds into the weekend).
  const absorbed = new Set<string>();
  const hasWeekendBlocks = opts.services.some((s) => s.coversWeekend);

  for (const service of opts.services) {
    if (!service.coversWeekend) continue;
    for (const date of eachDay(opts.start, opts.end)) {
      if (dayOfWeek(date) !== 5) continue;
      let startDate = date;
      let endDate = addDays(date, 3);
      if (extend) {
        if (holidays.has(date)) startDate = addDays(date, -1);
        if (holidays.has(endDate)) endDate = addDays(endDate, 1);
      }
      for (let d = startDate; d < date; d = addDays(d, 1)) absorbed.add(`${d}|night`);
      if (startDate < date) absorbed.add(`${date}|day`);
      for (let d = addDays(date, 3); d < endDate; d = addDays(d, 1)) {
        absorbed.add(`${d}|day`);
        absorbed.add(`${d}|night`);
      }
      const touchesHoliday = eachDay(startDate, endDate).some((d) => holidays.has(d));
      shifts.push({
        id: shiftId(service.id, 'weekend', date),
        serviceId: service.id,
        kind: 'weekend',
        date,
        start: at(startDate, DAY_END),
        end: at(endDate, DAY_START),
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
