import type { ShiftKind } from '@call-planner/core';
import { useState } from 'react';
import { del, patch, post, type RequestRow } from '../api';
import type { PeriodData } from './Period';

export const TYPE_LABEL: Record<RequestRow['type'], string> = {
  unavailable: 'Unavailable',
  prefer_off: 'Prefer off',
  prefer_on: 'Prefer on',
};

const KIND_LABEL: Record<ShiftKind, string> = { day: 'Days', night: 'Nights', weekend: 'Weekends' };

export function RequestsTab({ data, reload }: { data: PeriodData; reload: () => void }) {
  const p = data.schedule.period;
  const [filter, setFilter] = useState<'all' | RequestRow['status']>('pending');
  const [error, setError] = useState<string | null>(null);
  const outcomes = new Map(data.report.requestOutcomes.map((o) => [o.requestId, o]));
  const rows = data.requests.filter((r) => filter === 'all' || r.status === filter);

  const act = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const decide = (r: RequestRow, status: RequestRow['status']) => act(() => patch(`/api/requests/${r.id}`, { status }));

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          <b>Approved “unavailable”</b> requests are never scheduled. Pending ones, and all “prefer” requests, are honored whenever the
          schedule allows.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          {(['pending', 'approved', 'denied', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? 'primary' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} ({f === 'all' ? data.requests.length : data.requests.filter((r) => r.status === f).length})
            </button>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>Surgeon</th>
              <th>Type</th>
              <th>Dates</th>
              <th>Applies to</th>
              <th>Note</th>
              <th>Status</th>
              <th>In schedule</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const o = outcomes.get(r.id);
              return (
                <tr key={r.id}>
                  <td>{r.userName}</td>
                  <td>{TYPE_LABEL[r.type]}</td>
                  <td>{r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`}</td>
                  <td>{r.shiftKinds?.length ? r.shiftKinds.map((k) => KIND_LABEL[k]).join(', ') : 'All call'}</td>
                  <td className="small">{r.note}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>
                    {o && data.schedule.assignments.length > 0 ? (
                      o.honored ? <span className="badge ok">Honored</span> : <span className="badge bad" title={o.conflictingShiftIds.join('\n')}>Not met</span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      {r.status !== 'approved' && <button onClick={decide(r, 'approved')}>Approve</button>}
                      {r.status !== 'denied' && <button onClick={decide(r, 'denied')}>Deny</button>}
                      <button className="link danger" onClick={() => confirm('Delete this request?') && act(() => del(`/api/requests/${r.id}`))()}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="muted">No {filter === 'all' ? '' : filter} requests.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AddRequest data={data} onAdded={reload} periodStart={p.startDate} periodEnd={p.endDate} periodId={p.id} />
    </>
  );
}

function AddRequest({ data, onAdded, periodId, periodStart, periodEnd }: {
  data: PeriodData;
  onAdded: () => void;
  periodId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const pool = data.users.filter((u) => u.active && u.takesCall);
  const [form, setForm] = useState({ userId: '', type: 'unavailable' as RequestRow['type'], startDate: '', endDate: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await post('/api/requests', { ...form, periodId, endDate: form.endDate || form.startDate });
      setForm({ ...form, startDate: '', endDate: '', note: '' });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>Add a request for a surgeon</h2>
      <p className="muted small">For time off you already know about (vacation, conferences). Requests you add are approved.</p>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
          <option value="">Surgeon…</option>
          {pool.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as RequestRow['type'] })}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" min={periodStart} max={periodEnd} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        <span className="muted">to</span>
        <input type="date" min={form.startDate || periodStart} max={periodEnd} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        <input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="primary" disabled={!form.userId || !form.startDate} onClick={submit}>Add</button>
      </div>
    </div>
  );
}
