import { longDateRange, SHIFT_KINDS, type ShiftKind } from '@call-planner/core';
import { useState } from 'react';
import { get, type Hospital } from '../api';
import { useLoad } from '../useLoad';
import type { PeriodData } from './Period';
import { TYPE_LABEL } from './RequestsTab';
import { sortServices } from './ServiceFilter';

type View = 'total' | 'service' | 'hospital';
type Tally = Record<ShiftKind, number>;
const empty = (): Tally => ({ day: 0, night: 0, weekend: 0 });
const sum = (t: Tally) => t.day + t.night + t.weekend;
const LETTER: Record<ShiftKind, string> = { day: 'D', night: 'N', weekend: 'W' };

/** "5" with "3D · 2N" underneath (zeros left out). */
function Cell({ t }: { t?: Tally }) {
  if (!t || !sum(t)) return <span className="muted">—</span>;
  const parts = SHIFT_KINDS.filter((k) => t[k]).map((k) => `${t[k]}${LETTER[k]}`);
  return (
    <span title={SHIFT_KINDS.filter((k) => t[k]).map((k) => `${t[k]} ${KIND[k].toLowerCase()}`).join(', ')}>
      <b>{sum(t)}</b>
      {parts.length > 1 || !t.day ? <div className="small muted">{parts.join(' · ')}</div> : null}
    </span>
  );
}

/**
 * Who has how much call in each column (a service, or a hospital or group of
 * hospitals), from the current assignments. Cross-cover counts for the
 * surgeon who covers it; locum shifts aren't anyone's.
 */
function Breakdown({ data, view, hospitals }: { data: PeriodData; view: 'service' | 'hospital'; hospitals: Hospital[] }) {
  const { schedule, users } = data;
  const shift = new Map(schedule.shifts.map((s) => [s.id, s]));
  const service = new Map(schedule.services.map((s) => [s.id, s]));
  const hName = new Map(hospitals.map((h) => [h.id, h.shortName || h.name]));
  // Column for a service: itself, or the hospitals it covers ("All hospitals" when none are set).
  const columnOf = (serviceId: string) => {
    if (view === 'service') return serviceId;
    const ids = (service.get(serviceId)?.hospitalIds ?? []).filter((id) => hName.has(id));
    return ids.length ? [...ids].sort().join('+') : 'all';
  };
  const label = (col: string) =>
    view === 'service'
      ? service.get(col)?.name ?? col
      : col === 'all'
        ? 'All hospitals'
        : col.split('+').map((id) => hName.get(id) ?? id).join(' + ');

  const table = new Map<string, Map<string, Tally>>();
  const totals = new Map<string, Tally>();
  for (const a of schedule.assignments) {
    const s = shift.get(a.shiftId);
    if (!s) continue;
    const col = columnOf(s.serviceId);
    const row = table.get(a.userId) ?? new Map<string, Tally>();
    table.set(a.userId, row);
    const t = row.get(col) ?? empty();
    t[s.kind]++;
    row.set(col, t);
    const ct = totals.get(col) ?? empty();
    ct[s.kind]++;
    totals.set(col, ct);
  }
  const order =
    view === 'service'
      ? sortServices(schedule.services.filter((sv) => totals.has(sv.id))).map((sv) => sv.id)
      : [...totals.keys()].sort((a, b) => (a === 'all' ? 1 : b === 'all' ? -1 : label(a).localeCompare(label(b))));
  const people = users
    .filter((u) => table.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rowTotal = (row?: Map<string, Tally>) => {
    const t = empty();
    for (const v of row?.values() ?? []) for (const k of SHIFT_KINDS) t[k] += v[k];
    return t;
  };

  return (
    <div className="card sched-wrap" style={{ padding: 0 }}>
      <table className="sched">
        <thead>
          <tr>
            <th>Surgeon</th>
            {order.map((col) => (
              <th key={col} className="num">
                {view === 'service' && <span className="svc-dot" style={{ background: service.get(col)?.color }} />}
                {label(col)}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {people.map((u) => {
            const row = table.get(u.id);
            return (
              <tr key={u.id}>
                <td>{u.name}</td>
                {order.map((col) => (
                  <td key={col} className="num"><Cell t={row?.get(col)} /></td>
                ))}
                <td className="num"><Cell t={rowTotal(row)} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th>All surgeons</th>
            {order.map((col) => (
              <th key={col} className="num"><Cell t={totals.get(col)} /></th>
            ))}
            <th className="num"><Cell t={rowTotal(totals)} /></th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const KIND: Record<ShiftKind, string> = { day: 'Days', night: 'Nights', weekend: 'Weekends' };

function Count({ value, target }: { value: number; target: number }) {
  const off = value - target;
  const cls = Math.abs(off) <= 1 ? '' : off > 0 ? 'badge warn' : 'badge';
  return (
    <span className={cls} title={`Fair share: ${target}`}>
      {value} <span className="muted small">/ {target}</span>
    </span>
  );
}

export function FairnessTab({ data }: { data: PeriodData }) {
  const { report, requests, users } = data;
  const fte = new Map(users.map((u) => [u.id, u.fte]));
  const stats = [...report.stats].sort((a, b) => a.name.localeCompare(b.name));
  const unmet = report.requestOutcomes.filter((o) => !o.honored);
  const byId = new Map(requests.map((r) => [r.id, r]));
  const [view, setView] = useState<View>('total');
  const hospitals = useLoad(() => get<Hospital[]>('/api/hospitals')).data ?? [];
  const usesHospitals = data.schedule.services.some((s) => s.hospitalIds?.length);

  if (!data.schedule.assignments.length) {
    return <div className="card muted">Generate a schedule to see how call is shared out.</div>;
  }

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {(
          [
            ['total', 'Total'],
            ['service', 'By service'],
            ...(usesHospitals ? [['hospital', 'By hospital'] as const] : []),
          ] as [View, string][]
        ).map(([v, l]) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {l}
          </button>
        ))}
      </div>
      {view !== 'total' && (
        <>
          <Breakdown data={data} view={view} hospitals={hospitals} />
          <p className="muted small">
            Shifts each surgeon has {view === 'service' ? 'on each service' : 'at each hospital'} in this schedule (D day · N night · W
            weekend or holiday block), including cross-cover; locum shifts aren’t counted.
            {view === 'hospital' && ' A service covering several hospitals at once is counted under all of them together, e.g. “TUH + JH”.'}
            {' '}Fair share is balanced on the totals, shown on the Total view.
          </p>
        </>
      )}
      {view === 'total' && (
      <>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Surgeon</th>
              <th className="num">FTE</th>
              {SHIFT_KINDS.map((k) => <th key={k} className="num">{KIND[k]}</th>)}
              <th className="num">Holidays</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.userId}>
                <td>{s.name}</td>
                <td className="num">{fte.get(s.userId)}</td>
                {SHIFT_KINDS.map((k) => (
                  <td key={k} className="num"><Count value={s.counts[k]} target={s.targets[k]} /></td>
                ))}
                <td className="num"><Count value={s.holidays} target={s.holidayTarget} /></td>
                <td className="num">{s.counts.day + s.counts.night + s.counts.weekend}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Each cell shows shifts assigned / fair share for that surgeon’s FTE. More than one shift over is highlighted.</p>
      </>
      )}

      <div className="card">
        <h2>Requests not met ({unmet.length})</h2>
        {unmet.length === 0 ? (
          <p className="muted">Every request is honored in the current schedule.</p>
        ) : (
          <table>
            <tbody>
              {unmet.map((o) => {
                const r = byId.get(o.requestId);
                return (
                  <tr key={o.requestId}>
                    <td>{r?.userName}</td>
                    <td>{TYPE_LABEL[o.type]}</td>
                    <td>{r && longDateRange(r.startDate, r.endDate)}</td>
                    <td className="small muted">{o.conflictingShiftIds.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
