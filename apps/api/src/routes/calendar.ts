import { isHolidayBlock } from '@call-planner/core';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import { httpError } from '../http';
import { LIVE_SQL, listServices } from '../repo';

const KIND_LABEL = { day: 'Day call', night: 'Night call', weekend: 'Weekend call' } as const;

/** 'YYYY-MM-DDTHH:mm' wall-clock time → iCalendar floating DATE-TIME. */
const icsTime = (t: string) => `${t.replace(/[-:]/g, '')}00`;

/**
 * Subscribable iCalendar feed of a surgeon's published shifts, so the
 * schedule shows up in the phone's built-in calendar app. The URL token is
 * the only credential, so it's long and random.
 */
export function calendarRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Params: { token: string } }>('/cal/:token.ics', { config: { public: true } }, async (req, reply) => {
    const user = db.prepare('SELECT id, name FROM users WHERE calendar_token = ? AND active = 1').get(req.params.token) as
      | { id: string; name: string }
      | undefined;
    if (!user) throw httpError(404, 'Calendar not found');
    const services = new Map(listServices(db).map((s) => [s.id, s.name]));
    const shifts = db
      .prepare(
        `SELECT s.* FROM assignments a JOIN shifts s ON s.id = a.shift_id JOIN periods p ON p.id = s.period_id
         WHERE a.user_id = ? AND ${LIVE_SQL} ORDER BY s.start`,
      )
      .all(user.id) as any[];
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Call Planner//EN',
      'CALSCALE:GREGORIAN',
      `X-WR-CALNAME:Call – ${user.name}`,
      ...shifts.flatMap((s) => [
        'BEGIN:VEVENT',
        `UID:${s.id}@call-planner`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsTime(s.start)}`,
        `DTEND:${icsTime(s.end)}`,
        `SUMMARY:${services.get(s.service_id) ?? s.service_id} – ${isHolidayBlock(s) ? 'Holiday call' : KIND_LABEL[s.kind as keyof typeof KIND_LABEL]}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ];
    reply.header('content-type', 'text/calendar; charset=utf-8');
    return lines.join('\r\n');
  });
}
