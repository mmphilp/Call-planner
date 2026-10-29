import { dayOfWeek, eachDay, weekStart, type Shift } from '@call-planner/core';
import { useMemo, useState } from 'react';
import { post, put, type RequestRow } from '../api';
import type { PeriodData } from './Period';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface OptimizeSummary {
  unassignedShiftIds: string[];
  violations: unknown[];
  requestOutcomes: { honored: boolean }[];
}

/** Does a request's date range touch this shift? (Ignores times; good enough for flags.) */
function touches(r: RequestRow, s: Shift) {
  if (r.shiftKinds?.length && !r.shiftKinds.includes(s.kind)) return false;
  return r.startDate <= s.end.slice(0, 10) && r.endDate >= s.date;
}

export function ScheduleTab({ data, reload }: { data: PeriodData; reload: () => void }) {
  const { schedule, requests, report, users } = data;
  const p = schedule.period;
  const editable = p.status !== 'published';
  const [month, setMonth] = useState(Number(p.startDate.slice(5, 7)) - 1);
  const [highlight, setHighlight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<OptimizeSummary | null>(null);

  const shiftById = useMemo(() => new Map(schedule.shifts.map((s) => [s.id, s])), [schedule.shifts]);
  const owner = useMemo(() => new Map(schedule.assignments.map((a) => [a.shiftId, a])), [schedule.assignments]);
  const problems = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of report.violations) {
      if (v.type === 'unassigned') continue;
      for (const id of v.shiftIds) m.set(id, [...(m.get(id) ?? []), v.message]);
    }
    return m;
  }, [report.violations]);
  const pool = users.filter((u) => u.active && u.takesCall);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const months = [...new Set(eachDay(p.startDate, p.endDate).map((d) => Number(d.slice(5, 7)) - 1))];
  const monthPrefix = `${p.year}-${String(month + 1).padStart(2, '0')}`;
  const weekdays = eachDay(p.startDate, p.endDate).filter((d) => d.startsWith(monthPrefix) && dayOfWeek(d) % 6 !== 0);
  const services = schedule.services.filter((s) => s.coversWeekdayDay || s.coversWeekdayNight || s.coversWeekend);

  const optimize = async () => {
    const lockedCount = schedule.assignments.filter((a) => a.locked).length;
    if (schedule.assignments.length > lockedCount &&
      !confirm(`Replace the current draft? ${lockedCount} locked assignment(s) will be kept.`)) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await post<OptimizeSummary>(`/api/periods/${p.id}/optimize`, {}));
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const assign = async (shiftId: string, userId: string | null, locked?: boolean) => {
    setError(null);
    try {
      await put(`/api/periods/${p.id}/assignments/${encodeURIComponent(shiftId)}`, { userId, locked });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cell = (shift: Shift | undefined, absorbedLabel: string) => {
    if (!shift) return <span className="muted small">{absorbedLabel}</span>;
    const a = owner.get(shift.id);
    const issues = problems.get(shift.id);
    const eligible = pool.filter((u) => u.serviceIds.includes(shift.serviceId));
    const flag = (uid: string) => {
      const rs = requests.filter((r) => r.userId === uid && r.status !== 'denied' && touches(r, shift));
      if (rs.some((r) => r.type === 'unavailable' && r.status === 'approved')) return ' — OFF';
      if (rs.some((r) => r.type !== 'prefer_on')) return ' — prefers off';
      if (rs.some((r) => r.type === 'prefer_on')) return ' — wants this';
      return '';
    };
    const classes = ['cell', shift.kind === 'weekend' && 'weekend', issues && 'violation', !a && 'empty'].filter(Boolean).join(' ');
    return (
      <div className={classes} title={issues?.join('\n') ?? (shift.kind === 'weekend' ? `${shift.start} → ${shift.end}` : undefined)}>
        <select
          value={a?.userId ?? ''}
          disabled={!editable}
          style={highlight && a?.userId === highlight ? { fontWeight: 700, outline: '2px solid var(--accent)' } : undefined}
          onChange={(e) => assign(shift.id, e.target.value || null)}
        >
          <option value="">{shift.kind === 'weekend' ? '— weekend —' : '—'}</option>
          {a && !eligible.some((u) => u.id === a.userId) && <option value={a.userId}>{nameOf.get(a.userId)} (not eligible)</option>}
          {eligible.map((u) => <option key={u.id} value={u.id}>{u.name}{flag(u.id)}</option>)}
        </select>
        {a && (
          <button
            className={`lock ${a.locked ? 'on' : ''}`}
            disabled={!editable}
            title={a.locked ? 'Locked: the optimizer keeps this. Click to unlock.' : 'Lock so the optimizer keeps this'}
            onClick={() => assign(shift.id, a.userId, !a.locked)}
          >
            {a.locked ? '🔒' : '🔓'}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="row">
          <button className="primary" disabled={!editable || busy} onClick={optimize}>
            {busy ? 'Optimizing…' : schedule.assignments.length ? 'Re-optimize' : 'Generate optimized schedule'}
          </button>
          {editable && schedule.assignments.length > 0 && (
            <button onClick={() => confirm('Clear all unlocked assignments?') && post(`/api/periods/${p.id}/assignments/clear`).then(reload)}>
              Clear unlocked
            </button>
          )}
          <span style={{ flex: 1 }} />
          <label className="row small muted">
            Highlight
            <select value={highlight} onChange={(e) => setHighlight(e.target.value)}>
              <option value="">Nobody</option>
              {pool.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        </div>
        {!editable && <p className="muted small">This schedule is published. Unpublish it on the Overview tab to make changes.</p>}
        {summary && (
          <div className={`alert ${summary.unassignedShiftIds.length || summary.violations.length > summary.unassignedShiftIds.length ? 'error' : 'ok'}`} style={{ marginTop: 12, marginBottom: 0 }}>
            Optimized: {schedule.shifts.length - summary.unassignedShiftIds.length} of {schedule.shifts.length} shifts filled,{' '}
            {summary.requestOutcomes.filter((o) => o.honored).length} of {summary.requestOutcomes.length} requests honored.
            {summary.unassignedShiftIds.length > 0 && ' Some shifts could not be filled without breaking a rule. Fill them by hand or relax a rule.'}
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Picking someone by hand locks that assignment, so re-optimizing works around it. Red outlines break a rule; hover for details.
        </p>
      </div>

      <div className="tabs" style={{ marginBottom: 8 }}>
        {months.map((m) => (
          <button key={m} className={m === month ? 'active' : ''} onClick={() => setMonth(m)}>{MONTHS[m]}</button>
        ))}
      </div>

      <div className="sched-wrap">
        <table className="sched">
          <thead>
            <tr>
              <th>Date</th>
              {services.map((s) => (
                <th key={s.id} colSpan={(s.coversWeekdayDay ? 1 : 0) + (s.coversWeekdayNight || s.coversWeekend ? 1 : 0)}>
                  <span className="svc-dot" style={{ background: s.color }} />
                  {s.name}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {services.flatMap((s) => [
                s.coversWeekdayDay && <th key={`${s.id}d`}>Day 7a–5p</th>,
                (s.coversWeekdayNight || s.coversWeekend) && <th key={`${s.id}n`}>Night 5p–7a / Weekend</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {weekdays.map((d) => {
              const dow = dayOfWeek(d);
              const isHoliday = p.holidays.includes(d);
              return (
                <tr key={d} className={`${weekStart(d) === d ? 'week-start' : ''} ${isHoliday ? 'holiday' : ''}`}>
                  <td className="date">
                    {DOW[dow]} {d.slice(5)} {isHoliday && <span title="Holiday">★</span>}
                  </td>
                  {services.flatMap((s) => [
                    s.coversWeekdayDay && <td key={`${s.id}d`}>{cell(shiftById.get(`${s.id}:day:${d}`), 'weekend')}</td>,
                    (s.coversWeekdayNight || s.coversWeekend) && (
                      <td key={`${s.id}n`}>
                        {dow === 5 && s.coversWeekend
                          ? cell(shiftById.get(`${s.id}:weekend:${d}`), '')
                          : cell(shiftById.get(`${s.id}:night:${d}`), s.coversWeekdayNight ? 'weekend' : '')}
                      </td>
                    ),
                  ])}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
