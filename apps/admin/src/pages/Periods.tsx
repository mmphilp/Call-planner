import { longDate } from '@call-planner/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post, type Period } from '../api';
import { useMe } from '../me';
import { useLoad } from '../useLoad';

export const STATUS_LABEL: Record<Period['status'], string> = {
  draft: 'Draft',
  open: 'Taking requests',
  closed: 'Building schedule',
  published: 'Published',
};

/** The half-year after the latest one that exists, or the next upcoming one. */
function nextHalf(periods: Period[]): { year: number; half: 1 | 2 } {
  if (periods.length) {
    const p = periods[0];
    return p.half === 1 ? { year: p.year, half: 2 } : { year: p.year + 1, half: 1 };
  }
  const now = new Date();
  return now.getMonth() < 6 ? { year: now.getFullYear(), half: 2 } : { year: now.getFullYear() + 1, half: 1 };
}

export function PeriodsPage() {
  const { data: periods, error, reload } = useLoad(() => get<Period[]>('/api/periods'));
  const [creating, setCreating] = useState<{ year: number; half: 1 | 2 } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { isSuper } = useMe();

  const create = async () => {
    if (!creating) return;
    try {
      const p = await post<Period>('/api/periods', creating);
      navigate(`/periods/${p.id}`);
    } catch (e) {
      setCreateError((e as Error).message);
      reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Schedules</h1>
          <div className="muted">Each schedule covers half a year: January–June or July–December.</div>
        </div>
        {isSuper && periods && !creating && <button className="primary" onClick={() => setCreating(nextHalf(periods))}>New half-year</button>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {creating && (
        <div className="card">
          <h2>New schedule</h2>
          {createError && <div className="alert error">{createError}</div>}
          <div className="row">
            <select value={creating.half} onChange={(e) => setCreating({ ...creating, half: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>January – June</option>
              <option value={2}>July – December</option>
            </select>
            <input
              type="number"
              value={creating.year}
              style={{ width: 100 }}
              onChange={(e) => setCreating({ ...creating, year: Number(e.target.value) })}
            />
            <button className="primary" onClick={create}>Create</button>
            <button onClick={() => setCreating(null)}>Cancel</button>
          </div>
          <p className="muted small">Shifts are created for every service automatically. Add holidays on the next screen.</p>
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Status</th>
              <th>Request deadline</th>
              <th>Holidays</th>
            </tr>
          </thead>
          <tbody>
            {periods?.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/periods/${p.id}`}>{p.label}</Link>
                </td>
                <td>
                  <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td>{p.requestDeadline ? longDate(p.requestDeadline, { year: true }) : <span className="muted">—</span>}</td>
                <td>{p.holidays.length}</td>
              </tr>
            ))}
            {periods?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">No schedules yet. Create the first half-year to get started.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
