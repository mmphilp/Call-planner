import { longDate, longSpan } from '@call-planner/core';
import { useState } from 'react';
import { post, type Trade, type TradeShift } from '../api';
import type { PeriodData } from './Period';

const KIND = { day: 'Day call', night: 'Night call', weekend: 'Weekend' } as const;
const STATUS: Record<Trade['status'], { label: string; tone: string }> = {
  open: { label: 'Offered — no taker yet', tone: '' },
  proposed: { label: 'Waiting for colleague', tone: '' },
  accepted: { label: 'Needs approval', tone: 'pending' },
  approved: { label: 'Approved', tone: 'approved' },
  declined: { label: 'Declined', tone: '' },
  cancelled: { label: 'Cancelled', tone: '' },
  rejected: { label: 'Rejected', tone: 'denied' },
};

function ShiftLabel({ s }: { s?: TradeShift }) {
  if (!s) return <span className="muted">(shift removed)</span>;
  return (
    <span title={longSpan(s.start, s.end)}>
      <b>{s.serviceName}</b> {KIND[s.kind]}, {longDate(s.date)}
    </span>
  );
}

/** Shift offers and swaps between surgeons, and approving them. */
export function SwapsTab({ data, reload }: { data: PeriodData; reload: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const trades = data.trades;
  const waiting = trades.filter((t) => t.status === 'accepted');
  const inProgress = trades.filter((t) => t.status === 'open' || t.status === 'proposed');
  const done = trades.filter((t) => !['accepted', 'open', 'proposed'].includes(t.status));

  const act = async (t: Trade, action: 'approve' | 'reject') => {
    let adminNote: string | undefined;
    if (action === 'reject') {
      const note = prompt('Reason (shown to the surgeons, optional):');
      if (note === null) return;
      adminNote = note.trim() || undefined;
    } else if (t.issues.length && !confirm(`Approving this will cause:\n\n${t.issues.join('\n')}\n\nApprove anyway?`)) {
      return;
    }
    setBusy(t.id);
    setError(null);
    try {
      await post(`/api/trades/${t.id}/${action}`, adminNote ? { adminNote } : {});
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const describe = (t: Trade) =>
    t.kind === 'offer' ? (
      <>
        <b>{t.from.name}</b> gives away <ShiftLabel s={t.shift} />
        {t.to && (
          <>
            {' '}
            → <b>{t.to.name}</b>
          </>
        )}
      </>
    ) : (
      <>
        <b>{t.from.name}</b> swaps <ShiftLabel s={t.shift} /> with <b>{t.to?.name}</b>’s <ShiftLabel s={t.theirShift} />
      </>
    );

  const row = (t: Trade, actions: boolean) => (
    <tr key={t.id}>
      <td>
        {describe(t)}
        {t.note && <div className="small muted">“{t.note}”</div>}
        {t.adminNote && <div className="small">Admin: {t.adminNote}</div>}
        {actions && t.issues.length > 0 && (
          <div className="small" style={{ color: 'var(--bad)' }}>
            ⚠ {t.issues.join(' · ')}
          </div>
        )}
      </td>
      <td>
        <span className={`badge ${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
      </td>
      <td className="small muted">{longDate(t.createdAt.slice(0, 10))}</td>
      <td>
        {actions && t.canDecide && (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="primary" disabled={busy === t.id} onClick={() => act(t, 'approve')}>
              Approve
            </button>
            <button disabled={busy === t.id} onClick={() => act(t, 'reject')}>
              Reject
            </button>
          </div>
        )}
        {actions && !t.canDecide && <span className="small muted">{t.shift?.kind === 'weekend' ? 'Overall admin approves' : 'Team admin approves'}</span>}
      </td>
    </tr>
  );

  const section = (title: string, list: Trade[], actions: boolean, empty: string) => (
    <div className="card" style={{ padding: 0 }}>
      <h2 style={{ padding: '14px 18px 0' }}>
        {title} ({list.length})
      </h2>
      <table>
        <tbody>
          {list.map((t) => row(t, actions))}
          {!list.length && (
            <tr>
              <td className="muted">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <p className="muted small" style={{ marginTop: 0 }}>
        Surgeons offer shifts or propose swaps in the app. Once a colleague takes or accepts one, it appears here to approve.
        Approving updates the published schedule and everyone’s calendars.
      </p>
      {section('Needs approval', waiting, true, 'Nothing waiting.')}
      {section('In progress', inProgress, false, 'No open offers or proposals.')}
      {done.length > 0 && section('History', done, false, '')}
    </>
  );
}
