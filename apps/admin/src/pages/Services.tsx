import { useEffect, useState } from 'react';
import { del, get, patch, post, type Schedule } from '../api';
import { useLoad } from '../useLoad';

type Service = Schedule['services'][number];
type Editable = Pick<Service, 'name' | 'color' | 'coversWeekdayDay' | 'coversWeekdayNight' | 'coversWeekend'>;

const FIELDS: (keyof Editable)[] = ['name', 'color', 'coversWeekdayDay', 'coversWeekdayNight', 'coversWeekend'];

const blankService: Editable = {
  name: '',
  color: '#2563eb',
  coversWeekdayDay: true,
  coversWeekdayNight: true,
  // Most services are specialty teams covering weekdays; weekends are usually one shared service.
  coversWeekend: false,
};

// Distinct default colors so services are easy to tell apart on the calendar.
const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f'];

function changes(original: Service, draft: Editable): Partial<Editable> {
  return Object.fromEntries(FIELDS.filter((f) => draft[f] !== original[f]).map((f) => [f, draft[f]]));
}

export function ServicesPage() {
  const { data: services, error, reload } = useLoad(() => get<Service[]>('/api/services'));
  const [drafts, setDrafts] = useState<Record<string, Editable>>({});
  const [adding, setAdding] = useState<Editable>(blankService);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Start editing from the saved values whenever they (re)load.
  useEffect(() => {
    if (!services) return;
    setDrafts(Object.fromEntries(services.map((s) => [s.id, { ...s }])));
    const used = new Set(services.map((s) => s.color.toLowerCase()));
    setAdding((a) => ({ ...a, color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[services.length % PALETTE.length] }));
  }, [services]);

  const dirty = (services ?? []).filter((s) => drafts[s.id] && Object.keys(changes(s, drafts[s.id])).length);
  const edit = (id: string, field: keyof Editable, value: string | boolean) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      for (const s of dirty) await patch(`/api/services/${s.id}`, changes(s, drafts[s.id]));
      setMsg({ ok: true, text: 'Saved. Unpublished schedules were updated to match; published ones will show a warning.' });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    setMsg(null);
    try {
      await post('/api/services', { ...adding, name: adding.name.trim(), sort: services?.length ?? 0 });
      setAdding(blankService);
      setMsg({ ok: true, text: `Added ${adding.name.trim()}.` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const remove = async (s: Service) => {
    if (!confirm(`Delete ${s.name}?`)) return;
    setMsg(null);
    try {
      await del(`/api/services/${s.id}`);
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const coverage = (value: Editable, onChange: (field: keyof Editable, v: boolean) => void) =>
    (['coversWeekdayDay', 'coversWeekdayNight', 'coversWeekend'] as const).map((f) => (
      <td key={f}>
        <input type="checkbox" checked={value[f]} onChange={(e) => onChange(f, e.target.checked)} />
      </td>
    ));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Services</h1>
          <div className="muted">
            Tick only the call each service covers. A shared weekend service (e.g. Specialty Coverage) should have only <b>Weekend block</b> ticked.
          </div>
        </div>
        <div className="row">
          {dirty.length > 0 && <span className="muted small">{dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}</span>}
          <button disabled={!dirty.length || saving} onClick={() => services && setDrafts(Object.fromEntries(services.map((s) => [s.id, { ...s }])))}>
            Discard
          </button>
          <button className="primary" disabled={!dirty.length || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
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
            {services?.map((s) => {
              const d = drafts[s.id];
              if (!d) return null;
              const changed = Object.keys(changes(s, d)).length > 0;
              return (
                <tr key={s.id} style={changed ? { background: 'var(--warn-bg)' } : undefined}>
                  <td><input value={d.name} onChange={(e) => edit(s.id, 'name', e.target.value)} /></td>
                  <td><input type="color" value={d.color} onChange={(e) => edit(s.id, 'color', e.target.value)} /></td>
                  {coverage(d, (f, v) => edit(s.id, f, v))}
                  <td><button className="link danger" onClick={() => remove(s)}>Delete</button></td>
                </tr>
              );
            })}
            {services?.length === 0 && (
              <tr><td colSpan={6} className="muted">No services yet. Add your first one below.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <input
                  placeholder="New service, e.g. Orthopedics"
                  value={adding.name}
                  onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                />
              </td>
              <td><input type="color" value={adding.color} onChange={(e) => setAdding({ ...adding, color: e.target.value })} /></td>
              {coverage(adding, (f, v) => setAdding({ ...adding, [f]: v }))}
              <td><button className="primary" disabled={!adding.name.trim()} onClick={add}>Add</button></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        Coverage changes update unpublished schedules automatically. A published schedule shows a warning until you unpublish and rebuild it.
      </p>
    </>
  );
}
