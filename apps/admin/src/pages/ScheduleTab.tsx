import { dayOfWeek, eachDay, weekStart, type Shift } from '@call-planner/core';
import { useMemo, useState } from 'react';
import { post, put, type RequestRow } from '../api';
import { useMe } from '../me';
import { CalendarView } from './CalendarView';
import type { PeriodData } from './Period';

const LOCUM = '__locum__';

type ScheduledShift = PeriodData['schedule']['shifts'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface OptimizeSummary {
  unassignedShiftIds: string[];
  routineCount: number;
  weekCount?: number;
  coverCount?: number;
  violations: unknown[];
  requestOutcomes: { honored: boolean }[];
}

/** Does a request's date range touch this shift? (Ignores times; good enough for flags.) */
function touches(r: RequestRow, s: Shift) {
  if (r.shiftKinds?.length && !r.shiftKinds.includes(s.kind)) return false;
  return r.startDate <= s.end.slice(0, 10) && r.endDate >= s.date;
}

interface Scope {
  key: string;
  label: string;
  serviceIds?: string[];
  kinds?: Shift['kind'][];
}

export function ScheduleTab({ data, reload }: { data: PeriodData; reload: () => void }) {
  const { schedule, requests, report, users } = data;
  const p = schedule.period;
  const { me, isSuper, canEditShift } = useMe();
  const editable = p.status !== 'published';
  const [month, setMonth] = useState(Number(p.startDate.slice(5, 7)) - 1);
  const [highlight, setHighlight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<OptimizeSummary | null>(null);
  // What "optimize" and "clear" act on: the overall admin can pick any part;
  // team admins only their own teams' weekdays.
  const weekdayServices = schedule.services.filter(
    (s) => (s.coversWeekdayDay || s.coversWeekdayNight) && (isSuper || me.adminServiceIds.includes(s.id)),
  );
  const scopes: Scope[] = [
    ...(isSuper ? [{ key: 'all', label: 'Everything' }] : weekdayServices.length > 1 ? [{ key: 'all', label: 'All my teams’ weekdays' }] : []),
    ...(isSuper && schedule.shifts.some((s) => s.kind === 'weekend') ? [{ key: 'weekends', label: 'Weekends only', kinds: ['weekend' as const] }] : []),
    ...weekdayServices.map((s) => ({ key: s.id, label: `${s.name} weekdays`, serviceIds: [s.id], kinds: ['day' as const, 'night' as const] })),
  ];
  const [scopeKey, setScopeKey] = useState(scopes[0]?.key ?? 'all');
  const scope = scopes.find((x) => x.key === scopeKey) ?? scopes[0];
  const inScope = (s: ScheduledShift) =>
    canEditShift(s) && (!scope?.serviceIds || scope.serviceIds.includes(s.serviceId)) && (!scope?.kinds || scope.kinds.includes(s.kind));
  const scopeBody = { serviceIds: scope?.serviceIds, kinds: scope?.kinds };
  const poolCount = schedule.shifts.filter((s) => !s.coveredBy && inScope(s)).length;
  const locumCount = schedule.shifts.filter((s) => s.coveredBy && inScope(s)).length;
  const hasWeekday = schedule.shifts.some((s) => s.kind !== 'weekend');
  const hasWeekend = schedule.shifts.some((s) => s.kind === 'weekend');
  // Once a schedule has assignments, open on the calendar overview.
  const [view, setView] = useState<'calendar' | 'weekdays' | 'weekends'>(
    schedule.assignments.length ? 'calendar' : hasWeekday ? 'weekdays' : 'weekends',
  );

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
  // Team admins see just their own teams in the weekday grid.
  const services = schedule.services.filter(
    (s) => (s.coversWeekdayDay || s.coversWeekdayNight) && (isSuper || me.adminServiceIds.includes(s.id)),
  );

  const optimize = async () => {
    const scoped = schedule.assignments.filter((a) => {
      const s = shiftById.get(a.shiftId);
      return s && inScope(s);
    });
    const lockedCount = scoped.filter((a) => a.locked).length;
    if (scoped.length > lockedCount &&
      !confirm(`Re-optimize ${scope?.label.toLowerCase()}? ${lockedCount} locked assignment(s) will be kept; nothing outside this is changed.`)) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await post<OptimizeSummary>(`/api/periods/${p.id}/optimize`, scopeBody));
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

  const setCover = async (shiftId: string, coveredBy: string | null) => {
    setError(null);
    try {
      await put(`/api/periods/${p.id}/shifts/${encodeURIComponent(shiftId)}/cover`, { coveredBy });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cell = (shift: ScheduledShift | undefined, absorbedLabel: string) => {
    if (!shift) return <span className="muted small">{absorbedLabel}</span>;
    if (shift.coveredBy) {
      return (
        <div className="cell locum" title="Covered from outside the call pool; the optimizer skips this shift">
          <span className="badge">{/locum/i.test(shift.coveredBy) ? shift.coveredBy : `Locum: ${shift.coveredBy}`}</span>
          {editable && canEditShift(shift) && (
            <button className="link" title="Remove locum cover" onClick={() => setCover(shift.id, null)}>×</button>
          )}
        </div>
      );
    }
    const a = owner.get(shift.id);
    const issues = problems.get(shift.id);
    const canEdit = editable && canEditShift(shift);
    const eligible = pool.filter((u) => u.serviceIds.includes(shift.serviceId));
    const flag = (uid: string) => {
      const rs = requests.filter((r) => r.userId === uid && r.status !== 'denied' && touches(r, shift));
      if (rs.some((r) => r.type === 'unavailable' && r.status === 'approved')) return ' — OFF';
      if (rs.some((r) => r.type !== 'prefer_on')) return ' — prefers off';
      if (rs.some((r) => r.type === 'prefer_on')) return ' — wants this';
      return '';
    };
    const classes = ['cell', shift.kind === 'weekend' && 'weekend', issues && 'violation', !a && 'empty', a?.source === 'backup' && 'cover']
      .filter(Boolean)
      .join(' ');
    return (
      <div className={classes} title={issues?.join('\n') ?? (shift.kind === 'weekend' ? `${shift.start} → ${shift.end}` : undefined)}>
        <select
          value={a?.userId ?? ''}
          disabled={!canEdit}
          style={highlight && a?.userId === highlight ? { fontWeight: 700, outline: '2px solid var(--accent)' } : undefined}
          onChange={(e) => {
            if (e.target.value !== LOCUM) return assign(shift.id, e.target.value || null);
            const who = prompt('Who is covering this shift? (e.g. locum’s name)', 'Locum');
            if (who?.trim()) setCover(shift.id, who.trim());
            else e.target.value = a?.userId ?? '';
          }}
        >
          <option value="">{shift.kind === 'weekend' ? '— weekend —' : '—'}</option>
          {a && !eligible.some((u) => u.id === a.userId) && (
            <option value={a.userId}>{nameOf.get(a.userId)} {a.source === 'backup' ? '(cross-cover)' : '(not eligible)'}</option>
          )}
          {eligible.map((u) => <option key={u.id} value={u.id}>{u.name}{flag(u.id)}</option>)}
          <option value={LOCUM}>Locum / outside cover…</option>
        </select>
        {a && (
          <button
            className={`lock ${a.locked ? 'on' : ''}`}
            disabled={!canEdit}
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
          {scopes.length > 1 && (
            <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} aria-label="What to optimize">
              {scopes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          )}
          <button className="primary" disabled={!editable || busy || !scope} onClick={optimize}>
            {busy ? 'Optimizing…' : `Optimize ${scopes.length === 1 && scope ? scope.label.toLowerCase() : ''}`.trim()}
          </button>
          {editable && schedule.assignments.length > 0 && scope && (
            <button
              onClick={() =>
                confirm(`Clear unlocked assignments for ${scope.label.toLowerCase()}?`) &&
                post(`/api/periods/${p.id}/assignments/clear`, scopeBody).then(reload)
              }
            >
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
            Optimized: {poolCount - summary.unassignedShiftIds.length} of {poolCount} shifts filled
            {locumCount > 0 && ` (plus ${locumCount} covered by locums)`},{' '}
            {summary.requestOutcomes.filter((o) => o.honored).length} of {summary.requestOutcomes.length} requests honored
            {!!summary.weekCount && `, ${summary.weekCount} team-weeks given to one surgeon`}
            {!!summary.coverCount && `, ${summary.coverCount} shifts cross-covered by another team`}
            {summary.routineCount > 0 && `, ${summary.routineCount} routine days applied`}.
            {summary.unassignedShiftIds.length > 0 && ' Some shifts could not be filled without breaking a rule. Fill them by hand or relax a rule.'}
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Picking someone by hand locks that assignment, so re-optimizing works around it. Red outlines break a rule; hover for details.
        </p>
      </div>

      <div className="row no-print" style={{ marginBottom: 8 }}>
        <button className={view === 'calendar' ? 'primary' : ''} onClick={() => setView('calendar')}>Calendar</button>
        {hasWeekday && <button className={view === 'weekdays' ? 'primary' : ''} onClick={() => setView('weekdays')}>Weekdays</button>}
        {hasWeekend && <button className={view === 'weekends' ? 'primary' : ''} onClick={() => setView('weekends')}>Weekends</button>}
      </div>

      {view === 'calendar' && <CalendarView data={data} highlight={highlight} />}

      {view === 'weekends' && (
        <WeekendTable data={data} cell={cell} shiftById={shiftById} owner={owner} highlight={highlight} />
      )}

      {view === 'weekdays' && (
      <>
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
      )}
    </>
  );
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Fri Jul 3' from 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
function dayLabel(t: string) {
  const d = t.slice(0, 10);
  return `${DOW[dayOfWeek(d)]} ${MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

function timeLabel(t: string) {
  const h = Number(t.slice(11, 13));
  return `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`;
}

/** Every weekend block in the period on one page: who's on, who's away. */
function WeekendTable({
  data,
  cell,
  shiftById,
  owner,
  highlight,
}: {
  data: PeriodData;
  cell: (shift: ScheduledShift | undefined, absorbedLabel: string) => React.ReactNode;
  shiftById: Map<string, ScheduledShift>;
  owner: Map<string, { userId: string }>;
  highlight: string;
}) {
  const { schedule, requests, users } = data;
  const services = schedule.services.filter((s) => s.coversWeekend);
  const weekends = schedule.shifts.filter((s) => s.kind === 'weekend');
  const fridays = [...new Set(weekends.map((s) => s.date))].sort();
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const pool = users.filter((u) => u.active && u.takesCall && services.some((s) => u.serviceIds.includes(s.id)));

  const counts = new Map(pool.map((u) => [u.id, 0]));
  for (const s of weekends) {
    const a = owner.get(s.id);
    if (a) counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
  }

  const awayLabels = (shift: Shift) => {
    const out: { text: string; strong: boolean }[] = [];
    for (const r of requests) {
      if (r.status === 'denied' || !touches(r, shift)) continue;
      const n = nameOf.get(r.userId) ?? r.userName;
      if (r.type === 'unavailable') out.push({ text: r.status === 'approved' ? n : `${n} (pending)`, strong: r.status === 'approved' });
      else if (r.type === 'prefer_off') out.push({ text: `${n} (prefers off)`, strong: false });
      else out.push({ text: `${n} wants it`, strong: false });
    }
    return out;
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted small">Weekends assigned:</span>
        {pool.map((u) => (
          <span key={u.id} className="badge" style={highlight === u.id ? { outline: '2px solid var(--accent)' } : undefined}>
            {u.name} · {counts.get(u.id)}
          </span>
        ))}
      </div>
      <div className="sched-wrap">
        <table className="sched">
          <thead>
            <tr>
              <th>Weekend</th>
              <th>Hours</th>
              {services.map((s) => (
                <th key={s.id}>
                  <span className="svc-dot" style={{ background: s.color }} />
                  {s.name}
                </th>
              ))}
              <th>Away / requests</th>
            </tr>
          </thead>
          <tbody>
            {fridays.map((fri) => {
              const shifts = services.map((s) => shiftById.get(`${s.id}:weekend:${fri}`));
              const any = shifts.find(Boolean)!;
              const away = awayLabels(any);
              return (
                <tr key={fri} className={any.holiday ? 'holiday' : ''}>
                  <td className="date">
                    {dayLabel(fri)} {any.holiday && <span title="Includes a holiday">★</span>}
                  </td>
                  <td className="small muted">
                    {dayLabel(any.start)} {timeLabel(any.start)} – {dayLabel(any.end)} {timeLabel(any.end)}
                  </td>
                  {shifts.map((s, i) => <td key={services[i].id}>{cell(s, '—')}</td>)}
                  <td className="small" style={{ whiteSpace: 'normal' }}>
                    {away.length ? away.map((a, i) => (
                      <span key={i} className={a.strong ? '' : 'muted'}>{i > 0 && ', '}{a.text}</span>
                    )) : <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
