import { addDays, dayOfWeek, eachDay } from '@call-planner/core';
import { useState } from 'react';
import type { PeriodData } from './Period';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Shift = PeriodData['schedule']['shifts'][number];

interface Entry {
  key: string;
  color: string;
  service: string;
  label: string;
  /** Person ids on this entry, for highlighting. */
  people: string[];
  cover?: boolean;
  open?: boolean;
}

/** "Minimally Invasive Surgery" → "MIS"; "Endocrine Surgery" → "Endocrine"; "Colorectal" → "Colorectal". */
const serviceAbbr = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 3 ? words.map((w) => w[0].toUpperCase()).join('') : words[0] ?? name;
};

/** Last name, or the whole name if it's one word ("Dr. Goda E Savulionyte" → "Savulionyte"). */
const shortName = (name: string) => name.replace(/^Dr\.?\s+/, '').split(' ').at(-1) ?? name;

/**
 * Month calendar of who covers what each day. Read-only; edit in the
 * Weekdays / Weekends views.
 */
export function CalendarView({ data, highlight }: { data: PeriodData; highlight: string }) {
  const { schedule, users } = data;
  const p = schedule.period;
  const months = [...new Set(eachDay(p.startDate, p.endDate).map((d) => d.slice(0, 7)))];
  const [month, setMonth] = useState(() => {
    const today = new Date().toISOString().slice(0, 7);
    return months.includes(today) ? today : months[0];
  });

  const name = new Map(users.map((u) => [u.id, u.name]));
  const owner = new Map(schedule.assignments.map((a) => [a.shiftId, a]));
  const services = [...schedule.services].sort((a, b) => a.sort - b.sort);
  const svc = new Map(services.map((s) => [s.id, s]));

  const who = (s: Shift) => {
    if (s.coveredBy) return { text: s.coveredBy, ids: [], cover: false, open: false };
    const a = owner.get(s.id);
    if (!a) return { text: 'Open', ids: [], cover: false, open: true };
    return { text: shortName(name.get(a.userId) ?? '?'), ids: [a.userId], cover: a.source === 'backup', open: false };
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
        out.push({ key: `${s.id}w`, color: s.color, service: s.name, label: w.text, people: w.ids, open: w.open });
        continue;
      }
      const day = schedule.shifts.find((x) => x.serviceId === s.id && x.kind === 'day' && x.date === d);
      const night = schedule.shifts.find((x) => x.serviceId === s.id && x.kind === 'night' && x.date === d);
      if (!day && !night) continue;
      const dw = day && who(day);
      const nw = night && who(night);
      const same = dw && nw && dw.text === nw.text;
      const label = same || !nw ? dw!.text : !dw ? `Night: ${nw.text}` : `${dw.text} / ${nw.text} (night)`;
      out.push({
        key: s.id,
        color: s.color,
        service: s.name,
        label,
        people: [...(dw?.ids ?? []), ...(nw?.ids ?? [])],
        cover: !!(dw?.cover || nw?.cover),
        open: !!(dw?.open || nw?.open),
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
              {MONTHS[Number(mo.slice(5)) - 1].slice(0, 3)}
            </button>
          ))}
        </div>
        <button onClick={() => window.print()}>Print</button>
      </div>
      <h2 className="print-only">
        Call coverage — {MONTHS[m - 1]} {y}
      </h2>
      <div className="row small" style={{ marginBottom: 8, gap: 14 }}>
        {services
          .filter((s) => schedule.shifts.some((x) => x.serviceId === s.id))
          .map((s) => (
            <span key={s.id}>
              <span className="svc-dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        <span className="muted">
          <i>Italic</i> = cross-cover
        </span>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-head">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-cell empty" />;
          const inPeriod = d >= p.startDate && d <= p.endDate;
          const holiday = p.holidays.includes(d);
          return (
            <div key={d} className={`cal-cell ${dayOfWeek(d) % 6 === 0 ? 'wknd' : ''} ${holiday ? 'holiday' : ''}`}>
              <div className="cal-date">
                {Number(d.slice(8))}
                {holiday && <span title="Holiday"> ★</span>}
              </div>
              {inPeriod &&
                entriesFor(d).map((e) => (
                  <div
                    key={e.key}
                    className={`cal-entry ${e.cover ? 'cover' : ''} ${e.open ? 'open' : ''} ${highlight && e.people.includes(highlight) ? 'hl' : ''}`}
                    title={`${e.service}: ${e.label}`}
                    style={{ borderLeftColor: e.color }}
                  >
                    <b>{serviceAbbr(e.service)}</b> {e.label}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
