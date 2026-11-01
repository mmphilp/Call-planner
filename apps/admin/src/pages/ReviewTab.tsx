import { longDate, longSpan } from '@call-planner/core';
import { useState } from 'react';
import { get, patch, post, type Approval, type Flag, type SignoffService } from '../api';
import { useMe } from '../me';
import { useLoad } from '../useLoad';
import type { PeriodData } from './Period';
import { publishQuestion, servicesPublished } from './publish';

const KIND = { day: 'day call', night: 'night call', weekend: 'weekend' } as const;

const OUTCOME: Record<Flag['status'], { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'pending' },
  fixed: { label: 'Fixed', tone: 'approved' },
  no_change: { label: 'No change', tone: '' },
  withdrawn: { label: 'Withdrawn', tone: '' },
};

/**
 * Flags surgeons sent on the proposed schedule. Fix the schedule on the
 * Schedule tab, then mark each flag fixed or explain why it stays.
 */
export function ReviewTab({ data, reload }: { data: PeriodData; reload: () => void }) {
  const p = data.schedule.period;
  const open = data.flags.filter((f) => f.status === 'open');
  const closed = data.flags.filter((f) => f.status !== 'open');

  return (
    <>
      <div className="card">
        <h2>Review &amp; sign-off</h2>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {p.status === 'review'
            ? 'Surgeons can see this proposed schedule in the app, flag any assignment they think is wrong, and approve their own schedule. Fix flags on the Schedule tab, then mark each one below. '
            : p.status === 'published'
              ? 'This schedule is published. Sign-offs and flags from review are below. '
              : 'Send the schedule for review from the Overview tab: surgeons will see it as proposed, can flag assignments and approve their own schedule. '}
          Each service’s scheduler signs off their service, and can publish it on its own once it’s ready; a published service is
          final for its surgeons and re-optimizing leaves it alone.
        </p>
      </div>

      <Signoff data={data} reload={reload} />

      <div className="card">
        <h2>Open flags {open.length > 0 && <span className="badge pending">{open.length}</span>}</h2>
        {!open.length && <div className="muted">{p.status === 'review' ? 'Nothing flagged yet.' : 'None.'}</div>}
        {open.map((f) => (
          <FlagRow key={f.id} flag={f} reload={reload} />
        ))}
      </div>

      {closed.length > 0 && (
        <div className="card">
          <h2>Dealt with</h2>
          {closed.map((f) => (
            <FlagRow key={f.id} flag={f} reload={reload} />
          ))}
        </div>
      )}
    </>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** One sign-off: approved (still current, or changed since), or not yet. */
function ApprovalText({ a, who }: { a: Approval | null; who?: string }) {
  if (!a) return <span className="muted">Not yet</span>;
  const by = who ?? a.by?.name;
  return a.current ? (
    <span title={a.note || undefined}>
      <span className="badge approved">Approved</span> <span className="small muted">{by ? `${by}, ` : ''}{shortDate(a.at)}</span>
    </span>
  ) : (
    <span title="The schedule changed after this was approved">
      <span className="badge pending">Changed since approved</span> <span className="small muted">{shortDate(a.at)}</span>
    </span>
  );
}

/**
 * Each service: published on its own or not, its scheduler's sign-off, and
 * how many of its surgeons approved. The overall admin sees every service;
 * a team scheduler sees their own.
 */
function Signoff({ data, reload }: { data: PeriodData; reload: () => void }) {
  const p = data.schedule.period;
  const signoff = useLoad(
    () => get<{ services: SignoffService[] }>(`/api/periods/${p.id}/signoff`),
    [p.id, p.status, data.schedule.assignments.length, p.publishedServiceIds.join()],
  );
  const [error, setError] = useState<string | null>(null);
  const { isSuper } = useMe();
  if (signoff.error || !signoff.data) return signoff.error ? null : <div className="muted">Loading…</div>;
  if (p.status === 'draft' || p.status === 'open') return null;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      signoff.reload();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const publish = (s: SignoffService) =>
    confirm(
      `Publish ${s.name}’s schedule now?\n\nIts surgeons see it as final in the app and their calendars, and can swap shifts. Re-optimizing leaves it alone. The rest of the schedule stays as it is.`,
    ) && act(() => post(`/api/periods/${p.id}/services/${s.id}/publish`));
  const unpublish = (s: SignoffService) =>
    confirm(`Unpublish ${s.name}? Its surgeons see it as proposed (or not at all) again, and it leaves their calendars.`) &&
    act(() => post(`/api/periods/${p.id}/services/${s.id}/unpublish`));
  const approve = (s: SignoffService) => act(() => post(`/api/periods/${p.id}/approvals`, { kind: 'service', serviceId: s.id }));
  const withdraw = (s: SignoffService) => act(() => post(`/api/periods/${p.id}/approvals/withdraw`, { kind: 'service', serviceId: s.id }));
  // Ask surgeons to review and approve again: their approve card comes back in the app.
  const reset = (body: { userId?: string; serviceId?: string }, question: string) =>
    confirm(`${question}\n\nThey’ll see “Please check your schedule” in the app again and can re-approve.`) &&
    act(() => post(`/api/periods/${p.id}/approvals/reset`, body));
  const anyApproved = signoff.data.services.some((s) => s.surgeons.some((u) => u.approval));
  // Publish everything at once (same as Publish final schedule on Overview).
  const canPublishAll = isSuper && (p.status === 'closed' || p.status === 'review');
  const publishAll = () => confirm(publishQuestion(data)) && act(() => patch(`/api/periods/${p.id}`, { status: 'published' }));
  const svc = servicesPublished(data);

  return (
    <div className="card" style={{ padding: 0 }}>
      {(canPublishAll || (isSuper && anyApproved)) && (
        <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <span className="muted small" style={{ flex: 1 }}>
            {svc.published.length > 0 && p.status !== 'published' && `${svc.published.length} of ${svc.total} services published. `}
            {isSuper && anyApproved && 'Sent out a revised schedule? Ask everyone to approve again.'}
          </span>
          {isSuper && anyApproved && (
            <button onClick={() => reset({}, 'Ask every surgeon to review and approve again?')}>Ask everyone to approve again</button>
          )}
          {canPublishAll && (
            <button className="primary" onClick={publishAll}>
              {svc.published.length ? 'Publish the rest' : 'Publish all'}
            </button>
          )}
        </div>
      )}
      {error && <div className="alert error" style={{ margin: 12 }}>{error}</div>}
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Scheduler sign-off</th>
            <th>Surgeons approved</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {signoff.data.services.map((s) => {
            const ok = s.surgeons.filter((u) => u.approval?.current).length;
            const stale = s.surgeons.filter((u) => u.approval && !u.approval.current).length;
            return (
              <tr key={s.id} className="change-row">
                <td>
                  <span className="svc-dot" style={{ background: s.color }} />
                  <b>{s.name}</b>
                  {s.coversWeekend && <div className="small muted">Weekends</div>}
                </td>
                <td>
                  <ApprovalText a={s.approval} />
                  {s.canApprove && (
                    <div className="row small" style={{ marginTop: 4 }}>
                      {(!s.approval || !s.approval.current) && (
                        <button className="link" onClick={() => approve(s)}>{s.approval ? 'Approve again' : 'Approve'}</button>
                      )}
                      {s.approval && <button className="link danger" onClick={() => withdraw(s)}>Withdraw</button>}
                    </div>
                  )}
                </td>
                <td>
                  <details>
                    <summary>
                      {ok} of {s.surgeons.length}
                      {stale > 0 && <span className="badge pending" style={{ marginLeft: 6 }}>{stale} changed since</span>}
                    </summary>
                    <table className="small" style={{ marginTop: 6 }}>
                      <tbody>
                        {s.surgeons.map((u) => (
                          <tr key={u.id}>
                            <td>{u.name}</td>
                            <td><ApprovalText a={u.approval} who="" /></td>
                            <td>
                              {s.canApprove && u.approval && (
                                <button className="link" onClick={() => reset({ userId: u.id }, `Ask ${u.name} to review and approve again?`)}>
                                  Reset
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                  {s.canApprove && s.surgeons.some((u) => u.approval) && (
                    <div className="small" style={{ marginTop: 4 }}>
                      <button
                        className="link"
                        onClick={() => reset({ serviceId: s.id }, `Ask everyone on ${s.name} to review and approve again?`)}
                      >
                        Reset approvals
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  {s.published ? (
                    <>
                      <span className="badge published">Published</span>{' '}
                      <span className="small muted">
                        {s.published.whole ? 'with the whole schedule' : `${s.published.by?.name ?? ''}${s.published.at ? `, ${shortDate(s.published.at)}` : ''}`}
                      </span>
                      {s.canPublish && !s.published.whole && (
                        <div className="small" style={{ marginTop: 4 }}>
                          <button className="link danger" onClick={() => unpublish(s)}>Unpublish</button>
                        </div>
                      )}
                    </>
                  ) : s.canPublish ? (
                    <button onClick={() => publish(s)}>Publish {s.name}</button>
                  ) : (
                    <span className="muted">Not yet</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FlagRow({ flag: f, reload }: { flag: Flag; reload: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = f.assignedNow?.id !== f.assignedThen?.id;

  const resolve = async (outcome: 'fixed' | 'no_change') => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/flags/${f.id}/resolve`, { outcome, adminNote: note });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flag-card">
      <div>
        <div>
          <b>{f.shift.serviceName}</b> {KIND[f.shift.kind]}, {longDate(f.shift.date)}
          {f.shift.kind === 'weekend' && <span className="small muted"> ({longSpan(f.shift.start, f.shift.end)})</span>}
        </div>
        <div className="small">
          On call: <b>{f.assignedThen?.name ?? 'nobody'}</b>
          {changed && (
            <>
              {' '}→ now <b>{f.assignedNow?.name ?? 'nobody'}</b>
            </>
          )}
        </div>
        <div style={{ marginTop: 4 }}>
          <b>{f.from.name}</b>: “{f.note}”
        </div>
        {f.adminNote && <div className="small muted">Your reply: {f.adminNote}</div>}
        {f.canResolve && (
          <div style={{ marginTop: 6 }}>
            <textarea placeholder="Reply to the surgeon (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {error && <div className="alert error small">{error}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <span className={`badge ${OUTCOME[f.status].tone}`}>{OUTCOME[f.status].label}</span>
        {f.canResolve && (
          <>
            <button className="primary" disabled={busy} onClick={() => resolve('fixed')}>
              Mark fixed
            </button>
            <button disabled={busy} onClick={() => resolve('no_change')}>
              No change needed
            </button>
          </>
        )}
        {f.status === 'open' && !f.canResolve && <span className="small muted">{f.shift.kind === 'weekend' ? 'Overall admin resolves' : 'Team admin resolves'}</span>}
      </div>
    </div>
  );
}
