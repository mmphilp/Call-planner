import { longDate, longSpan } from '@call-planner/core';
import { useState } from 'react';
import { post, type Flag } from '../api';
import type { PeriodData } from './Period';

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
        <h2>Review</h2>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {p.status === 'review'
            ? 'Surgeons can see this proposed schedule in the app and flag any assignment they think is wrong. Fix it on the Schedule tab, then mark each flag below. Publish from the Overview tab when you’re done.'
            : p.status === 'published'
              ? 'This schedule is published. Flags sent while it was in review are below.'
              : 'Send the schedule for review from the Overview tab: surgeons will see it as proposed and can flag assignments here before you publish.'}
        </p>
      </div>

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
