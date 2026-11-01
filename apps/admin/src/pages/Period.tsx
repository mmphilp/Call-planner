import { longDate, longDateRange, mergeRules, standardHolidays, type Rules } from '@call-planner/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { del, get, patch, post, type Flag, type Period, type Report, type RequestRow, type Schedule, type User, type Trade } from '../api';
import { useMe } from '../me';
import { useLoad } from '../useLoad';
import { ChangesTab } from './ChangesTab';
import { FairnessTab } from './FairnessTab';
import { STATUS_LABEL } from './Periods';
import { RequestsTab } from './RequestsTab';
import { ReviewTab } from './ReviewTab';
import { ScheduleTab } from './ScheduleTab';
import { SwapsTab } from './SwapsTab';

export interface PeriodData {
  schedule: Schedule;
  requests: RequestRow[];
  report: Report;
  users: User[];
  trades: Trade[];
  flags: Flag[];
}

type Tab = 'overview' | 'requests' | 'schedule' | 'review' | 'swaps' | 'changes' | 'fairness' | 'rules';

export function PeriodPage() {
  const { id } = useParams();
  const { isSuper } = useMe();
  const [tab, setTab] = useState<Tab>(isSuper ? 'overview' : 'schedule');
  const { data, error, reload } = useLoad<PeriodData>(
    async () => {
      const [schedule, requests, report, users, trades, flags] = await Promise.all([
        get<Schedule>(`/api/periods/${id}/schedule`),
        get<RequestRow[]>(`/api/requests?periodId=${id}&all=1`),
        get<Report>(`/api/periods/${id}/report`),
        get<User[]>('/api/users'),
        get<Trade[]>(`/api/trades?periodId=${id}&all=1`),
        get<Flag[]>(`/api/flags?periodId=${id}&all=1`),
      ]);
      return { schedule, requests, report, users, trades, flags };
    },
    [id],
  );

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const p = data.schedule.period;
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const swapsWaiting = data.trades.filter((t) => t.status === 'accepted' && t.canDecide).length;
  const openFlags = data.flags.filter((f) => f.status === 'open').length;

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
            ['review', `Review${openFlags ? ` (${openFlags})` : ''}`],
            ['swaps', `Swaps${swapsWaiting ? ` (${swapsWaiting})` : ''}`],
            ['changes', 'Changes'],
            ['fairness', 'Fairness'],
            ['rules', 'Rules'],
          ] as [Tab, string][]
        )
          // Team admins work on their weekday schedule; period setup stays with the overall admin.
          .filter(([t]) => isSuper || t === 'requests' || t === 'schedule' || t === 'review' || t === 'swaps' || t === 'fairness')
          // Review appears once a schedule has been out for review.
          .filter(([t]) => t !== 'review' || p.status === 'review' || data.flags.length > 0)
          // The change log is for the overall admin, once the schedule has been published.
          .filter(([t]) => t !== 'changes' || (isSuper && p.status !== 'draft' && p.status !== 'open'))
          .map(([t, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview data={data} reload={reload} goTo={setTab} />}
      {tab === 'requests' && <RequestsTab data={data} reload={reload} />}
      {tab === 'schedule' && <ScheduleTab data={data} reload={reload} />}
      {tab === 'review' && <ReviewTab data={data} reload={reload} />}
      {tab === 'changes' && isSuper && <ChangesTab periodId={p.id} />}
      {tab === 'swaps' && <SwapsTab data={data} reload={reload} />}
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
  { status: 'review', title: '4. Review', hint: 'Surgeons check it and flag problems' },
  { status: 'published', title: '5. Published', hint: 'Final: surgeons see their call' },
];

function Overview({ data, reload, goTo }: { data: PeriodData; reload: () => void; goTo: (t: Tab) => void }) {
  const p = data.schedule.period;
  const [error, setError] = useState<string | null>(null);
  const idx = STEPS.findIndex((s) => s.status === p.status);
  const assigned = data.schedule.assignments.length;
  const total = data.schedule.shifts.filter((s) => !s.coveredBy).length;
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const ruleBreaks = data.report.violations.filter((v) => v.type !== 'unassigned').length;
  const openFlags = data.flags.filter((f) => f.status === 'open').length;
  const publish = () => {
    const problems = [
      total - assigned && `${total - assigned} shift${total - assigned === 1 ? ' is' : 's are'} unfilled`,
      ruleBreaks && `${ruleBreaks} rule problem${ruleBreaks === 1 ? ' remains' : 's remain'}`,
      openFlags && `${openFlags} flag${openFlags === 1 ? '' : 's'} from surgeons ${openFlags === 1 ? 'is' : 'are'} still open`,
    ].filter(Boolean);
    const warn = problems.length ? `${problems.join(', ')}. Publish anyway?` : 'Publish this schedule as final?';
    if (confirm(warn)) setStatus('published')();
  };

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
  const setHolidays = (holidays: Period['holidays']) => run(() => patch(`/api/periods/${p.id}`, { holidays }))();

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
              <button
                className="primary"
                disabled={assigned === 0}
                onClick={() => confirm('Send this proposed schedule to surgeons for review? They’ll see it in the app and can flag assignments. It won’t go into their calendars until you publish.') && setStatus('review')()}
              >
                Send for review
              </button>
              <button disabled={assigned === 0} onClick={publish}>Skip review and publish</button>
              <button onClick={setStatus('open')}>Reopen requests</button>
            </>
          )}
          {p.status === 'review' && (
            <>
              <button className="primary" onClick={publish}>Publish final schedule</button>
              <button onClick={() => goTo('review')}>See flags{openFlags ? ` (${openFlags} open)` : ''}</button>
              <button onClick={() => confirm('Take the proposed schedule back? Surgeons will no longer see it.') && setStatus('closed')()}>
                Withdraw from review
              </button>
            </>
          )}
          {p.status === 'published' && (
            <>
              <button onClick={() => goTo('schedule')}>Change a shift</button>
              <button
                onClick={() =>
                  confirm('Unpublish? Surgeons won’t see this schedule, and it leaves their calendars, until you publish again. To change a single shift, you don’t need to unpublish.') &&
                  setStatus('closed')()
                }
              >
                Unpublish for bigger changes
              </button>
              <span className="muted small">Single shifts can be changed on the Schedule tab while published; changes are logged.</span>
            </>
          )}
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
              {(p.status === 'review' || data.flags.length > 0) && (
                <tr>
                  <td>Open flags from surgeons</td>
                  <td className="num">
                    {openFlags ? <button className="link" onClick={() => goTo('review')}>{openFlags}</button> : <span className="badge ok">None</span>}
                  </td>
                </tr>
              )}
              <tr><td>Rule problems</td><td className="num">{ruleBreaks ? <span className="badge bad">{ruleBreaks}</span> : <span className="badge ok">None</span>}</td></tr>
              <tr><td>Dates</td><td className="num">{longDateRange(p.startDate, p.endDate, { year: true })}</td></tr>
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
          Set the day the hospital observes each holiday. On an observed day only the weekend service is on call; the teams have
          none. A Friday holiday starts that weekend at 7am Friday, a Monday one ends it at 7am Tuesday, Thanksgiving runs through
          the Friday after, and any other weekday holiday is covered 7am to 7am. A holiday marked <b>Not observed</b> is a normal
          working day. The actual dates show on every calendar either way.
        </p>
        <HolidayEditor period={p} onSave={setHolidays} />
        <div className="row" style={{ marginTop: 12 }}>
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

/** The group's holidays with the hospital's observed day for each, plus any extra holidays. */
function HolidayEditor({ period: p, onSave }: { period: Period; onSave: (h: Period['holidays']) => void }) {
  const [extra, setExtra] = useState({ name: '', date: '' });
  const locked = p.status === 'published';
  const years = [Number(p.startDate.slice(0, 4)), Number(p.endDate.slice(0, 4))].filter((y, i, a) => a.indexOf(y) === i);
  const standard = years
    .flatMap(standardHolidays)
    .filter((h) => (h.date >= p.startDate && h.date <= p.endDate) || (h.observed >= p.startDate && h.observed <= p.endDate));
  const isStandard = (h: { name: string; date: string }) =>
    standard.some((s) => s.name === h.name && Math.abs(Date.parse(s.date) - Date.parse(h.date)) < 7 * 86_400_000);
  const others = p.holidays.filter((h) => !isStandard(h));

  const setObserved = (name: string, actual: string, date: string | null) => {
    const rest = p.holidays.filter((h) => !(h.name === name && isStandard(h) && Math.abs(Date.parse(actual) - Date.parse(h.date)) < 7 * 86_400_000));
    onSave(date ? [...rest, { name, date }] : rest);
  };

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Holiday</th>
            <th>Date</th>
            <th>Observed by the hospital</th>
          </tr>
        </thead>
        <tbody>
          {standard.map((h) => {
            const entry = p.holidays.find(
              (x) => x.name === h.name && Math.abs(Date.parse(x.date) - Date.parse(h.date)) < 7 * 86_400_000,
            );
            return (
              <tr key={`${h.name}${h.date}`}>
                <td>{h.name}</td>
                <td>{longDate(h.date, { year: true })}</td>
                <td>
                  {entry ? (
                    <div className="row">
                      <span className="badge approved">Observed</span>
                      <input
                        type="date"
                        value={entry.date}
                        min={p.startDate}
                        max={p.endDate}
                        disabled={locked}
                        onChange={(e) => e.target.value.length === 10 && setObserved(h.name, h.date, e.target.value)}
                      />
                      <span className="small muted">{longDate(entry.date)}</span>
                      <button className="link" disabled={locked} onClick={() => setObserved(h.name, h.date, null)}>
                        Don’t observe
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      <span className="badge denied">Not observed</span>
                      <button
                        disabled={locked}
                        onClick={() => setObserved(h.name, h.date, h.observed >= p.startDate && h.observed <= p.endDate ? h.observed : h.date)}
                      >
                        Observe on {longDate(h.observed)}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {others.map((h) => (
            <tr key={`${h.name}${h.date}`}>
              <td>{h.name}</td>
              <td className="muted">—</td>
              <td>
                <div className="row">
                  <span>{longDate(h.date, { year: true })}</span>
                  <button className="link" disabled={locked} onClick={() => onSave(p.holidays.filter((x) => x !== h))}>
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <input placeholder="Another day off, e.g. New Year’s Eve" value={extra.name} onChange={(e) => setExtra({ ...extra, name: e.target.value })} />
        <input type="date" min={p.startDate} max={p.endDate} value={extra.date} onChange={(e) => setExtra({ ...extra, date: e.target.value })} />
        <button
          disabled={!extra.name.trim() || !extra.date || locked}
          onClick={() => {
            onSave([...p.holidays, { name: extra.name.trim(), date: extra.date }]);
            setExtra({ name: '', date: '' });
          }}
        >
          Add holiday
        </button>
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
