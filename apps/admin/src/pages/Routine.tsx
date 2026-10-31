import { useState } from 'react';
import { get, put, type Schedule, type User } from '../api';
import { useMe } from '../me';
import { useLoad } from '../useLoad';

interface RoutineDay {
  serviceId: string;
  kind: 'day' | 'night';
  weekday: number;
  userId: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function RoutinePage() {
  const { isSuper, canEditService } = useMe();
  const { data, error, reload, setData } = useLoad(async () => {
    const [services, users, routine] = await Promise.all([
      get<Schedule['services']>('/api/services'),
      get<User[]>('/api/users'),
      get<RoutineDay[]>('/api/routine'),
    ]);
    return { services, users, routine };
  });
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const weekdayServices = data.services.filter(
    (s) => (s.coversWeekdayDay || s.coversWeekdayNight) && canEditService(s.id),
  );
  const current = new Map(data.routine.map((r) => [`${r.serviceId}|${r.kind}|${r.weekday}`, r.userId]));

  const set = async (serviceId: string, kind: 'day' | 'night', weekday: number, userId: string) => {
    setMsg(null);
    try {
      const routine = await put<RoutineDay[]>('/api/routine', { serviceId, kind, weekday, userId: userId || null });
      setData({ ...data, routine });
    } catch (e) {
      setMsg((e as Error).message);
      reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekday call</h1>
          <div className="muted">
            Routine days: who always takes a given weekday. Leave a day on <b>Rotate</b> and the optimizer shares it out.
          </div>
        </div>
      </div>
      {msg && <div className="alert error">{msg}</div>}
      <div className="alert info small">
        When a schedule is optimized, routine days are filled first, except on holidays or when that surgeon has time off; those
        go to the rest of the team. Routine days count toward each surgeon’s fair share. Changes apply the next time you optimize.
        {!isSuper && ' Weekends are scheduled by the overall admin.'}
      </div>

      {weekdayServices.length === 0 && (
        <div className="card muted">
          {isSuper
            ? 'No services cover weekday call yet. Turn on weekday days or nights for a service on the Services page.'
            : 'None of your teams cover weekday call yet. Ask the overall admin to turn it on for your service.'}
        </div>
      )}

      {weekdayServices.map((s) => {
        const members = data.users.filter((u) => u.active && u.takesCall && u.serviceIds.includes(s.id));
        const kinds = ([
          s.coversWeekdayDay && (['day', 'Day 7a–5p'] as const),
          s.coversWeekdayNight && (['night', 'Night 5p–7a'] as const),
        ].filter(Boolean)) as (readonly ['day' | 'night', string])[];
        return (
          <div key={s.id} className="card" style={{ padding: 0 }}>
            <div style={{ padding: '14px 18px 4px' }}>
              <h2>
                <span className="svc-dot" style={{ background: s.color }} />
                {s.name}
              </h2>
              <p className="muted small" style={{ marginTop: -6 }}>
                Team: {members.map((m) => m.name).join(', ') || 'nobody set up to cover this service yet'}
              </p>
            </div>
            <table>
              <thead>
                <tr>
                  <th />
                  {WEEKDAYS.map((d) => <th key={d}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {kinds.map(([kind, label]) => (
                  <tr key={kind}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{label}</td>
                    {WEEKDAYS.map((d, i) => {
                      const weekday = i + 1;
                      // Friday night is part of the weekend block when this service covers weekends.
                      if (kind === 'night' && weekday === 5 && s.coversWeekend) {
                        return <td key={d} className="small muted">Weekend</td>;
                      }
                      const value = current.get(`${s.id}|${kind}|${weekday}`) ?? '';
                      return (
                        <td key={d}>
                          <select value={value} onChange={(e) => set(s.id, kind, weekday, e.target.value)} style={{ maxWidth: 170 }}>
                            <option value="">Rotate</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
