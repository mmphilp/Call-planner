import { useState } from 'react';
import { del, get, patch, post, type Schedule } from '../api';
import { useLoad } from '../useLoad';

type Service = Schedule['services'][number];

export function ServicesPage() {
  const { data: services, error, reload } = useLoad(() => get<Service[]>('/api/services'));
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => async () => {
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const toggle = (s: Service, key: 'coversWeekdayDay' | 'coversWeekdayNight' | 'coversWeekend') =>
    run(() => patch(`/api/services/${s.id}`, { [key]: !s[key] }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Services</h1>
          <div className="muted">
            Each service needs its own call coverage. After changing coverage, use <b>Rebuild shifts</b> on any unpublished schedule.
          </div>
        </div>
      </div>
      {(error || msg) && <div className="alert error">{error ?? msg}</div>}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Color</th>
              <th>Weekday days<br /><span className="small">7am–5pm</span></th>
              <th>Weekday nights<br /><span className="small">5pm–7am, Mon–Thu</span></th>
              <th>Weekend block<br /><span className="small">Fri 5pm – Mon 7am</span></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {services?.map((s) => (
              <tr key={s.id}>
                <td>
                  <input
                    defaultValue={s.name}
                    onBlur={(e) => e.target.value !== s.name && run(() => patch(`/api/services/${s.id}`, { name: e.target.value }))()}
                  />
                </td>
                <td>
                  <input type="color" value={s.color} onChange={(e) => run(() => patch(`/api/services/${s.id}`, { color: e.target.value }))()} />
                </td>
                <td><input type="checkbox" checked={s.coversWeekdayDay} onChange={toggle(s, 'coversWeekdayDay')} /></td>
                <td><input type="checkbox" checked={s.coversWeekdayNight} onChange={toggle(s, 'coversWeekdayNight')} /></td>
                <td><input type="checkbox" checked={s.coversWeekend} onChange={toggle(s, 'coversWeekend')} /></td>
                <td>
                  <button className="link danger" onClick={() => confirm(`Delete ${s.name}?`) && run(() => del(`/api/services/${s.id}`))()}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card row">
        <input placeholder="New service name, e.g. Orthopedics" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 260 }} />
        <button className="primary" disabled={!name.trim()} onClick={() => run(() => post('/api/services', { name, sort: services?.length ?? 0 }).then(() => setName('')))()}>
          Add service
        </button>
      </div>
    </>
  );
}
