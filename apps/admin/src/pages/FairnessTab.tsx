import { longDateRange, SHIFT_KINDS, type ShiftKind } from '@call-planner/core';
import type { PeriodData } from './Period';
import { TYPE_LABEL } from './RequestsTab';

const KIND: Record<ShiftKind, string> = { day: 'Days', night: 'Nights', weekend: 'Weekends' };

function Count({ value, target }: { value: number; target: number }) {
  const off = value - target;
  const cls = Math.abs(off) <= 1 ? '' : off > 0 ? 'badge warn' : 'badge';
  return (
    <span className={cls} title={`Fair share: ${target}`}>
      {value} <span className="muted small">/ {target}</span>
    </span>
  );
}

export function FairnessTab({ data }: { data: PeriodData }) {
  const { report, requests, users } = data;
  const fte = new Map(users.map((u) => [u.id, u.fte]));
  const stats = [...report.stats].sort((a, b) => a.name.localeCompare(b.name));
  const unmet = report.requestOutcomes.filter((o) => !o.honored);
  const byId = new Map(requests.map((r) => [r.id, r]));

  if (!data.schedule.assignments.length) {
    return <div className="card muted">Generate a schedule to see how call is shared out.</div>;
  }

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Surgeon</th>
              <th className="num">FTE</th>
              {SHIFT_KINDS.map((k) => <th key={k} className="num">{KIND[k]}</th>)}
              <th className="num">Holidays</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.userId}>
                <td>{s.name}</td>
                <td className="num">{fte.get(s.userId)}</td>
                {SHIFT_KINDS.map((k) => (
                  <td key={k} className="num"><Count value={s.counts[k]} target={s.targets[k]} /></td>
                ))}
                <td className="num"><Count value={s.holidays} target={s.holidayTarget} /></td>
                <td className="num">{s.counts.day + s.counts.night + s.counts.weekend}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Each cell shows shifts assigned / fair share for that surgeon’s FTE. More than one shift over is highlighted.</p>

      <div className="card">
        <h2>Requests not met ({unmet.length})</h2>
        {unmet.length === 0 ? (
          <p className="muted">Every request is honored in the current schedule.</p>
        ) : (
          <table>
            <tbody>
              {unmet.map((o) => {
                const r = byId.get(o.requestId);
                return (
                  <tr key={o.requestId}>
                    <td>{r?.userName}</td>
                    <td>{TYPE_LABEL[o.type]}</td>
                    <td>{r && longDateRange(r.startDate, r.endDate)}</td>
                    <td className="small muted">{o.conflictingShiftIds.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
