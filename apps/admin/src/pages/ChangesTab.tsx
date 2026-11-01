import { longDate, longSpan } from '@call-planner/core';
import { get, type ChangeEntry } from '../api';
import { useLoad } from '../useLoad';
import { STATUS_LABEL } from './Periods';

const KIND = { day: 'day call', night: 'night call', weekend: 'weekend' } as const;
const VIA = { edit: 'Changed by hand', swap: 'Swap approved', republish: 'Changed while unpublished' } as const;

const STATUS_EVENT: Record<string, string> = {
  published: 'Published',
  closed: 'Unpublished / back to building',
  review: 'Sent for review',
  open: 'Opened for requests',
  draft: 'Moved back to draft',
};

/** "Tuesday, November 3, 4:05pm" in the viewer's time zone. */
function when(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  return `${day}, ${time}`;
}

const holder = (h: ChangeEntry['from']) => (h?.cover ? `${h.cover} (locum)` : h?.user?.name ?? 'nobody');

/**
 * Everything changed on this schedule after it was published, newest first:
 * hand edits, approved swaps, changes made while it was unpublished, and
 * publish/unpublish events. Only the overall admin sees this.
 */
export function ChangesTab({ periodId }: { periodId: string }) {
  const { data, error } = useLoad(() => get<ChangeEntry[]>(`/api/periods/${periodId}/changes`), [periodId]);
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const shiftChanges = data.filter((e) => e.action === 'shift').length;

  return (
    <>
      <div className="card">
        <h2>Change log</h2>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Every change to this schedule after it was published: shifts changed by hand, approved swaps, anything changed while it
          was unpublished (recorded when it’s published again), and each time it was published or unpublished. Only you can see
          this. {shiftChanges > 0 && `${shiftChanges} shift change${shiftChanges === 1 ? '' : 's'} so far.`}
        </p>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {!data.length ? (
          <div className="muted" style={{ padding: 16 }}>Nothing yet. Changes appear here once the schedule is published.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="change-row">
                  <td className="small">{when(e.at)}</td>
                  <td>{e.by?.name ?? '—'}</td>
                  {e.action === 'status' ? (
                    <td colSpan={2}>
                      <span className={`badge ${e.status ?? ''}`}>{STATUS_EVENT[e.status ?? ''] ?? (e.status ? STATUS_LABEL[e.status] : '')}</span>
                    </td>
                  ) : (
                    <>
                      <td>
                        <b>{e.shift?.serviceName}</b> {e.shift && KIND[e.shift.kind]}, {e.shift && longDate(e.shift.date)}
                        {e.shift?.kind === 'weekend' && <div className="small muted">{longSpan(e.shift.start, e.shift.end)}</div>}
                        <div className="small muted">{e.via && VIA[e.via]}</div>
                      </td>
                      <td>
                        {holder(e.from)} → <b>{holder(e.to)}</b>
                        {e.note && <div className="small muted">“{e.note}”</div>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
