import { mergeRules, type Rules } from '@call-planner/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { del, get, patch, post, type Period, type Report, type RequestRow, type Schedule, type User } from '../api';
import { useMe } from '../me';
import { useLoad } from '../useLoad';
import { FairnessTab } from './FairnessTab';
import { STATUS_LABEL } from './Periods';
import { RequestsTab } from './RequestsTab';
import { ScheduleTab } from './ScheduleTab';

export interface PeriodData {
  schedule: Schedule;
  requests: RequestRow[];
  report: Report;
  users: User[];
}

type Tab = 'overview' | 'requests' | 'schedule' | 'fairness' | 'rules';

export function PeriodPage() {
  const { id } = useParams();
  const { isSuper } = useMe();
  const [tab, setTab] = useState<Tab>(isSuper ? 'overview' : 'schedule');
  const { data, error, reload } = useLoad<PeriodData>(
    async () => {
      const [schedule, requests, report, users] = await Promise.all([
        get<Schedule>(`/api/periods/${id}/schedule`),
        get<RequestRow[]>(`/api/requests?periodId=${id}&all=1`),
        get<Report>(`/api/periods/${id}/report`),
        get<User[]>('/api/users'),
      ]);
      return { schedule, requests, report, users };
    },
    [id],
  );

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const p = data.schedule.period;
  const pending = data.requests.filter((r) => r.status === 'pending').length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small">
            <Link to="/periods">Schedules</Link> /
          </div>
          <h1>
            {p.label} <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
          </h1>
        </div>
        <a className="btn" href={`/api/periods/${p.id}/export.csv`} onClick={downloadCsv(p)}>
          Export CSV
        </a>
      </div>
      {isSuper && data.schedule.shiftsOutOfDate && <OutOfDate period={p} reload={reload} />}
      <div className="tabs">
        {(
          [
            ['overview', 'Overview'],
            ['requests', `Requests${pending ? ` (${pending})` : ''}`],
            ['schedule', 'Schedule'],
            ['fairness', 'Fairness'],
            ['rules', 'Rules'],
          ] as [Tab, string][]
        )
          // Team admins work on their weekday schedule; period setup stays with the overall admin.
          .filter(([t]) => isSuper || t === 'requests' || t === 'schedule' || t === 'fairness')
          .map(([t, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview data={data} reload={reload} goTo={setTab} />}
      {tab === 'requests' && <RequestsTab data={data} reload={reload} />}
      {tab === 'schedule' && <ScheduleTab data={data} reload={reload} />}
      {tab === 'fairness' && <FairnessTab data={data} />}
      {tab === 'rules' && <RulesTab period={p} reload={reload} />}
    </>
  );
}

/** Shifts no longer match the services (e.g. a service's weekday/weekend coverage changed). */
function OutOfDate({ period, reload }: { period: Period; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fix = async () => {
    const published = period.status === 'published';
    if (published && !confirm('Unpublish this schedule, rebuild its shifts from the current services, and leave it ready to review and republish?')) return;
    setBusy(true);
    setError(null);
    try {
      if (published) await patch(`/api/periods/${period.id}`, { status: 'closed' });
      await post(`/api/periods/${period.id}/generate`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="alert error">
      <b>This schedule’s shifts don’t match your current service settings.</b> A service’s coverage changed (for example,
      weekday boxes ticked on a weekend-only service), so some shifts here shouldn’t exist or are missing.{' '}
      <button className="primary" disabled={busy} onClick={fix} style={{ marginLeft: 6 }}>
        {period.status === 'published' ? 'Unpublish and rebuild shifts' : 'Rebuild shifts'}
      </button>
      {period.status === 'published' && (
        <div className="small" style={{ marginTop: 6 }}>
          Assignments on shifts that still exist are kept. Review the Schedule tab (re-optimize if needed), then publish again.
        </div>
      )}
      {error && <div className="small">{error}</div>}
    </div>
  );
}

/** The CSV endpoint needs the auth header, so fetch it rather than following the link. */
function downloadCsv(p: Period) {
  return async (e: React.MouseEvent) => {
    e.preventDefault();
    const csv = await get<string>(`/api/periods/${p.id}/export.csv`);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-schedule-${p.year}-${p.half === 1 ? 'jan-jun' : 'jul-dec'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
}

const STEPS: { status: Period['status']; title: string; hint: string }[] = [
  { status: 'draft', title: '1. Set up', hint: 'Add holidays and check services' },
  { status: 'open', title: '2. Take requests', hint: 'Surgeons submit requests in the app' },
  { status: 'closed', title: '3. Build schedule', hint: 'Review requests, optimize, adjust' },
  { status: 'published', title: '4. Published', hint: 'Surgeons see their call' },
];

function Overview({ data, reload, goTo }: { data: PeriodData; reload: () => void; goTo: (t: Tab) => void }) {
  const p = data.schedule.period;
  const [error, setError] = useState<string | null>(null);
  const [holiday, setHoliday] = useState('');
  const idx = STEPS.findIndex((s) => s.status === p.status);
  const assigned = data.schedule.assignments.length;
  const total = data.schedule.shifts.filter((s) => !s.coveredBy).length;
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const ruleBreaks = data.report.violations.filter((v) => v.type !== 'unassigned').length;

  const run = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setStatus = (status: Period['status']) => run(() => patch(`/api/periods/${p.id}`, { status }));
  const setHolidays = (holidays: string[]) => run(() => patch(`/api/periods/${p.id}`, { holidays }))();

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="stepper">
          {STEPS.map((s, i) => (
            <div key={s.status} className={`step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
              <div>{s.title}</div>
              <div className="small">{s.hint}</div>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          {p.status === 'draft' && <button className="primary" onClick={setStatus('open')}>Open for requests</button>}
          {p.status === 'open' && <button className="primary" onClick={setStatus('closed')}>Close requests &amp; start scheduling</button>}
          {p.status === 'closed' && (
            <>
              <button className="primary" disabled={assigned === 0} onClick={() => {
                const warn = total - assigned || ruleBreaks
                  ? `${total - assigned} shifts are unfilled and ${ruleBreaks} rule problems remain. Publish anyway?`
                  : 'Publish this schedule to all surgeons?';
                if (confirm(warn)) setStatus('published')();
              }}>Publish schedule</button>
              <button onClick={setStatus('open')}>Reopen requests</button>
            </>
          )}
          {p.status === 'published' && <button onClick={setStatus('closed')}>Unpublish to make changes</button>}
          {p.status === 'draft' && (
            <button className="danger" onClick={() => confirm('Delete this schedule period?') && run(() => del(`/api/periods/${p.id}`))().then(() => history.back())}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Status</h2>
          <table>
            <tbody>
              <tr><td>Shifts filled</td><td className="num">{assigned} / {total}</td></tr>
              <tr><td>Pending requests</td><td className="num">{pending ? <button className="link" onClick={() => goTo('requests')}>{pending}</button> : 0}</td></tr>
              <tr><td>Rule problems</td><td className="num">{ruleBreaks ? <span className="badge bad">{ruleBreaks}</span> : <span className="badge ok">None</span>}</td></tr>
              <tr><td>Dates</td><td className="num">{p.startDate} → {p.endDate}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Request deadline</h2>
          <p className="muted small">Surgeons can submit requests in the app until this date while the period is taking requests.</p>
          <input
            type="date"
            value={p.requestDeadline ?? ''}
            onChange={(e) => run(() => patch(`/api/periods/${p.id}`, { requestDeadline: e.target.value || null }))()}
          />
        </div>
      </div>

      <div className="card">
        <h2>Holidays</h2>
        <p className="muted small">
          Holiday call is balanced separately. A holiday on a Friday or Monday stretches that weekend block (Thu 5pm start or Tue 7am end).
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          {p.holidays.map((h) => (
            <span key={h} className="badge">
              {h}{' '}
              <button className="link" disabled={p.status === 'published'} onClick={() => setHolidays(p.holidays.filter((x) => x !== h))}>×</button>
            </span>
          ))}
          {!p.holidays.length && <span className="muted">No holidays set.</span>}
        </div>
        <div className="row">
          <input type="date" min={p.startDate} max={p.endDate} value={holiday} onChange={(e) => setHoliday(e.target.value)} />
          <button disabled={!holiday || p.status === 'published'} onClick={() => (setHolidays([...p.holidays, holiday]), setHoliday(''))}>
            Add holiday
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button
            disabled={p.status === 'published'}
            title="Run after adding or changing services"
            onClick={run(() => post(`/api/periods/${p.id}/generate`))}
          >
            Rebuild shifts from services
          </button>
        </div>
      </div>
    </>
  );
}

function RulesTab({ period, reload }: { period: Period; reload: () => void }) {
  const [rules, setRules] = useState<Rules>(mergeRules(period.rules));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const locked = period.status === 'published';

  const num = (label: string, hint: string, value: number, onChange: (n: number) => void, step = 1) => (
    <label className="field">
      {label}
      <input type="number" step={step} min={0} value={value} disabled={locked} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="small">{hint}</span>
    </label>
  );

  const save = async () => {
    try {
      await patch(`/api/periods/${period.id}`, { rules });
      setMsg({ ok: true, text: 'Saved. Re-run the optimizer to apply the new rules.' });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="grid2">
        <div className="card">
          <h2>Hard rules</h2>
          <p className="muted small">The optimizer never breaks these. It leaves a shift open if no one fits.</p>
          <div className="form-grid">
            {num('Minimum rest between shifts (hours)', '12 = no day shift right after a night', rules.minRestHours, (v) => setRules({ ...rules, minRestHours: v }))}
            {num('Preferred rest (hours)', 'Set minimum lower to allow back-to-back shifts only when needed', rules.preferredRestHours, (v) => setRules({ ...rules, preferredRestHours: v }))}
            {num('Max weekday nights per week', 'Mon–Thu night shifts', rules.maxNightsPerWeek, (v) => setRules({ ...rules, maxNightsPerWeek: v }))}
            {num('Weekends off between weekend blocks', '1 = never back-to-back weekends', rules.minWeekendsOffBetween, (v) => setRules({ ...rules, minWeekendsOffBetween: v }))}
            {num('Preferred days between shifts', 'Shifts closer than this are discouraged', rules.preferredSpacingDays, (v) => setRules({ ...rules, preferredSpacingDays: v }))}
          </div>
        </div>
        <div className="card">
          <h2>Priorities</h2>
          <p className="muted small">Higher numbers matter more when the optimizer has to trade things off.</p>
          <div className="form-grid">
            {num('Even workload', 'Equal call per FTE', rules.weights.fairness, (v) => setRules({ ...rules, weights: { ...rules.weights, fairness: v } }))}
            {num('Even holidays', 'Spread holiday call', rules.weights.holiday, (v) => setRules({ ...rules, weights: { ...rules.weights, holiday: v } }))}
            {num('"Prefer off" requests', '', rules.weights.preferOff, (v) => setRules({ ...rules, weights: { ...rules.weights, preferOff: v } }))}
            {num('"Prefer on" requests', '', rules.weights.preferOn, (v) => setRules({ ...rules, weights: { ...rules.weights, preferOn: v } }))}
            {num('Unapproved time off', 'Pending "unavailable" requests', rules.weights.pendingUnavailable, (v) => setRules({ ...rules, weights: { ...rules.weights, pendingUnavailable: v } }))}
            {num('Spacing', 'Avoid clustered shifts', rules.weights.spacing, (v) => setRules({ ...rules, weights: { ...rules.weights, spacing: v } }))}
            {num('Rest', 'Avoid back-to-back shifts', rules.weights.shortRest, (v) => setRules({ ...rules, weights: { ...rules.weights, shortRest: v } }))}
          </div>
          <h2 style={{ marginTop: 16 }}>How strictly to balance each shift type</h2>
          <div className="form-grid">
            {num('Weekday day', '', rules.kindWeights.day, (v) => setRules({ ...rules, kindWeights: { ...rules.kindWeights, day: v } }), 0.5)}
            {num('Weekday night', '', rules.kindWeights.night, (v) => setRules({ ...rules, kindWeights: { ...rules.kindWeights, night: v } }), 0.5)}
            {num('Weekend block', '', rules.kindWeights.weekend, (v) => setRules({ ...rules, kindWeights: { ...rules.kindWeights, weekend: v } }), 0.5)}
          </div>
        </div>
      </div>
      <div className="row">
        <button className="primary" disabled={locked} onClick={save}>Save rules</button>
        <button disabled={locked} onClick={() => setRules(mergeRules({}))}>Reset to defaults</button>
      </div>
    </>
  );
}
