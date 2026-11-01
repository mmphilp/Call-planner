import { addDays, DAY_NAMES, dayOfWeek, eachDay, MONTH_NAMES } from '@call-planner/core';
import { useState } from 'react';
import type { PeriodData } from './Period';
import { serviceLabel } from '../serviceLabel';
import { ServiceFilter, sortServices, type ServiceFilterState } from './ServiceFilter';

type Shift = PeriodData['schedule']['shifts'][number];

interface Entry {
  key: string;
  color: string;
  /** Short calendar label, e.g. CRS. */
  service: string;
  /** Full service name, for the tooltip. */
  fullName: string;
  label: string;
  /** Person ids on this entry, for highlighting. */
  people: string[];
  cover?: boolean;
  open?: boolean;
  /** The service's night shift, shown on its own line under the day. */
  night?: { label: string; people: string[]; cover: boolean; open: boolean };
}

/** Last name, or the whole name if it's one word ("Dr. Goda E Savulionyte" → "Savulionyte"). */
const shortName = (name: string) => name.replace(/^Dr\.?\s+/, '').split(' ').at(-1) ?? name;

/**
 * Month calendar of who covers what each day. Read-only; edit in the
 * Weekdays / Weekends views.
 */
export function CalendarView({
  data,
  highlight,
  filter,
}: {
  data: PeriodData;
  highlight: string;
  filter: ServiceFilterState;
}) {
  const { schedule, users } = data;
  const p = schedule.period;
  const months = [...new Set(eachDay(p.startDate, p.endDate).map((d) => d.slice(0, 7)))];
  const [month, setMonth] = useState(() => {
    const today = new Date().toISOString().slice(0, 7);
    return months.includes(today) ? today : months[0];
  });


  const name = new Map(users.map((u) => [u.id, u.name]));
  const owner = new Map(schedule.assignments.map((a) => [a.shiftId, a]));
  // Alphabetical, with weekend-block services after the weekday teams (on a
  // Friday the weekend block starts at 5pm, after the day's team call).
  const inSchedule = sortServices(schedule.services.filter((s) => schedule.shifts.some((x) => x.serviceId === s.id)));
  const services = inSchedule.filter((s) => !filter.hidden.has(s.id));
  const svc = new Map(services.map((s) => [s.id, s]));

  // Shifts changed after publishing get a ✎.
  const changed = new Set(schedule.changedShiftIds ?? []);
  const who = (s: Shift) => {
    const mark = changed.has(s.id) ? ' ✎' : '';
    if (s.coveredBy) return { text: s.coveredBy + mark, ids: [], cover: false, open: false };
    const a = owner.get(s.id);
    if (!a) return { text: 'Open' + mark, ids: [], cover: false, open: true };
    return { text: shortName(name.get(a.userId) ?? '?') + mark, ids: [a.userId], cover: a.source === 'backup', open: false };
  };

  const entriesFor = (d: string): Entry[] => {
    const out: Entry[] = [];
    for (const service of services) {
      const s = svc.get(service.id)!;
      // Weekend block: show it on every day it covers (Fri evening through Sunday, plus holiday days).
      const weekend = schedule.shifts.find(
        (x) => x.serviceId === s.id && x.kind === 'weekend' && x.start.slice(0, 10) <= d && x.end > `${d}T07:00`,
      );
      if (weekend) {
        const w = who(weekend);
        out.push({ key: `${s.id}w`, color: s.color, service: serviceLabel(s), fullName: s.name, label: w.text, people: w.ids, open: w.open });
        continue;
      }
      const day = schedule.shifts.find((x) => x.serviceId === s.id && x.kind === 'day' && x.date === d);
      const night = schedule.shifts.find((x) => x.serviceId === s.id && x.kind === 'night' && x.date === d);
      if (!day && !night) continue;
      const dw = day && who(day);
      const nw = night && who(night);
      out.push({
        key: s.id,
        color: s.color,
        service: serviceLabel(s),
        fullName: s.name,
        label: dw ? dw.text : '',
        people: dw?.ids ?? [],
        cover: dw?.cover,
        open: dw?.open,
        night: nw && { label: nw.text, people: nw.ids, cover: nw.cover, open: nw.open },
      });
    }
    return out;
  };

  // Sunday-first grid for the month.
  const first = `${month}-01`;
  const lead = dayOfWeek(first);
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const [y, m] = month.split('-').map(Number);

  return (
    <div className="calendar">
      <div className="row no-print" style={{ marginBottom: 8 }}>
        <div className="tabs" style={{ marginBottom: 0, flex: 1 }}>
          {months.map((mo) => (
            <button key={mo} className={mo === month ? 'active' : ''} onClick={() => setMonth(mo)}>
              {MONTH_NAMES[Number(mo.slice(5)) - 1]}
            </button>
          ))}
        </div>
        <button onClick={() => window.print()}>Print</button>
      </div>
      <h2 className="print-only">
        Call coverage — {MONTH_NAMES[m - 1]} {y}
      </h2>
      <ServiceFilter services={inSchedule} filter={filter}>
        <span className="muted">
          <i>Italic</i> = cross-cover
          {(schedule.changedShiftIds?.length ?? 0) > 0 && <> · ✎ = changed since publishing</>}
        </span>
      </ServiceFilter>
      <div className="cal-grid">
        {DAY_NAMES.map((d) => (
          <div key={d} className="cal-head">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-cell empty" />;
          const inPeriod = d >= p.startDate && d <= p.endDate;
          const marks = schedule.calendarHolidays.filter((h) => h.date === d);
          return (
            <div key={d} className={`cal-cell ${dayOfWeek(d) % 6 === 0 ? 'wknd' : ''} ${marks.length ? 'holiday' : ''}`}>
              <div className="cal-date">
                {Number(d.slice(8))}
                {marks.map((h) => (
                  <span key={h.name} className="cal-holiday">
                    ★ {h.name}
                    {h.observed && ' (observed)'}
                  </span>
                ))}
              </div>
              {inPeriod &&
                entriesFor(d).map((e) => (
                  <div
                    key={e.key}
                    className="cal-entry"
                    title={`${e.fullName}: ${e.label ? `${e.label} (day)` : ''}${e.label && e.night ? ', ' : ''}${e.night ? `${e.night.label} (night)` : ''}`}
                    style={{ borderLeftColor: e.color }}
                  >
                    <div className={`cal-line ${e.cover ? 'cover' : ''} ${e.open ? 'open' : ''} ${highlight && e.people.includes(highlight) ? 'hl' : ''}`}>
                      <b>{e.service}</b> {e.label}
                    </div>
                    {e.night && (
                      <div
                        className={`cal-line night ${e.night.cover ? 'cover' : ''} ${e.night.open ? 'open' : ''} ${highlight && e.night.people.includes(highlight) ? 'hl' : ''}`}
                      >
                        Night: {e.night.label}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
