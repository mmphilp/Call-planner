import { longDate } from '@call-planner/core';
import { get, type Schedule, type User } from '../api';
import { useLoad } from '../useLoad';

interface Occurrence {
  name: string;
  date: string;
  periodId: string;
  periodLabel: string;
  status: 'draft' | 'open' | 'closed' | 'published';
  covers: {
    shiftId: string;
    serviceId: string;
    kind: 'day' | 'night' | 'weekend';
    userId: string | null;
    coveredBy: string | null;
    crossCover: boolean;
  }[];
}

const KIND = { day: 'day', night: 'night', weekend: 'weekend' } as const;

/** Who covered which holiday, across every schedule, for rotating holiday call. */
export function HolidaysPage() {
  const { data, error } = useLoad(async () => {
    const [history, users, services] = await Promise.all([
      get<Occurrence[]>('/api/holidays/history'),
      get<User[]>('/api/users'),
      get<Schedule['services']>('/api/services'),
    ]);
    return { history, users, services };
  });

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const service = new Map(data.services.map((s) => [s.id, s]));
  const pool = data.users.filter((u) => u.takesCall).sort((a, b) => a.name.localeCompare(b.name));
  const columns = data.history;
  const covered = (o: Occurrence, userId: string) => o.covers.filter((c) => c.userId === userId);
  const total = (userId: string) => columns.filter((o) => covered(o, userId).length).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Holiday coverage</h1>
          <div className="muted">
            Who covered each holiday, across all schedules. When building a schedule, the optimizer avoids giving someone the
            holiday they covered the last time it came round.
          </div>
        </div>
      </div>
      {!columns.length ? (
        <div className="card muted">No holidays in any schedule yet. Set observed holidays on a schedule’s Overview tab.</div>
      ) : (
        <div className="sched-wrap">
          <table className="sched">
            <thead>
              <tr>
                <th>Surgeon</th>
                <th className="num">Holidays</th>
                {columns.map((o) => (
                  <th key={`${o.name}${o.date}`} title={`${o.periodLabel}${o.status === 'published' ? '' : ' (not published yet)'}`}>
                    {o.name}
                    <div className="small" style={{ fontWeight: 400 }}>
                      {longDate(o.date, { year: true })}
                      {o.status !== 'published' && ' · draft'}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pool.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="num">{total(u.id)}</td>
                  {columns.map((o) => {
                    const mine = covered(o, u.id);
                    return (
                      <td key={`${o.name}${o.date}`} className="small" style={mine.length ? { background: 'var(--weekend-bg)' } : undefined}>
                        {mine.map((c) => (
                          <div key={c.shiftId} style={c.crossCover ? { fontStyle: 'italic' } : undefined}>
                            {service.get(c.serviceId)?.name ?? c.serviceId} ({KIND[c.kind]})
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {columns.some((o) => o.covers.some((c) => c.coveredBy)) && (
                <tr>
                  <td className="muted">Locums</td>
                  <td />
                  {columns.map((o) => (
                    <td key={`${o.name}${o.date}`} className="small muted">
                      {o.covers.filter((c) => c.coveredBy).map((c) => (
                        <div key={c.shiftId}>
                          {c.coveredBy}: {service.get(c.serviceId)?.name ?? c.serviceId}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Italic = cross-cover for another team. Drafts update as schedules are optimized.</p>
    </>
  );
}
