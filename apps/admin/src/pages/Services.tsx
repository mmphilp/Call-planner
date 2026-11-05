import { useEffect, useState } from 'react';
import { del, get, patch, post, type Hospital, type Schedule } from '../api';
import { autoLabel } from '../serviceLabel';
import { useLoad } from '../useLoad';

type Service = Schedule['services'][number];
type Editable = Pick<Service, 'name' | 'color' | 'coversWeekdayDay' | 'coversWeekdayNight' | 'coversWeekend'> & {
  shortName: string;
  /** Hospitals this service covers; none = all. */
  hospitalIds: string[];
};

const FIELDS: (keyof Editable)[] = ['name', 'shortName', 'color', 'coversWeekdayDay', 'coversWeekdayNight', 'coversWeekend', 'hospitalIds'];

const blankService: Editable = {
  name: '',
  shortName: '',
  color: '#2563eb',
  coversWeekdayDay: true,
  coversWeekdayNight: true,
  // Most services are specialty teams covering weekdays; weekends are usually one shared service.
  coversWeekend: false,
  hospitalIds: [],
};

const toDraft = (s: Service): Editable => ({ ...s, shortName: s.shortName ?? '', hospitalIds: s.hospitalIds ?? [] });
const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? [...a].sort().join() === [...b].sort().join() : a === b;

// Distinct default colors so services are easy to tell apart on the calendar.
const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f'];

function changes(original: Service, draft: Editable): Partial<Editable> {
  const base = toDraft(original);
  return Object.fromEntries(FIELDS.filter((f) => !same(draft[f], base[f])).map((f) => [f, draft[f]]));
}

export function ServicesPage() {
  const { data: services, error, reload } = useLoad(() => get<Service[]>('/api/services'));
  const hospitals = useLoad(() => get<Hospital[]>('/api/hospitals'));
  const hs = hospitals.data ?? [];
  const [drafts, setDrafts] = useState<Record<string, Editable>>({});
  const [adding, setAdding] = useState<Editable>(blankService);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Start editing from the saved values whenever they (re)load.
  useEffect(() => {
    if (!services) return;
    setDrafts(Object.fromEntries(services.map((s) => [s.id, toDraft(s)])));
    const used = new Set(services.map((s) => s.color.toLowerCase()));
    setAdding((a) => ({ ...a, color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[services.length % PALETTE.length] }));
  }, [services]);

  const dirty = (services ?? []).filter((s) => drafts[s.id] && Object.keys(changes(s, drafts[s.id])).length);
  const edit = (id: string, field: keyof Editable, value: string | boolean | string[]) =>
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

  /** Tick the hospitals a service covers (none ticked = all). */
  const hospitalCell = (value: Editable, onChange: (ids: string[]) => void) =>
    hs.length > 0 && (
      <td>
        <div className="row" style={{ gap: 8 }}>
          {hs.map((h) => (
            <label key={h.id} className="check small" title={h.name}>
              <input
                type="checkbox"
                checked={value.hospitalIds.includes(h.id)}
                onChange={(e) => onChange(e.target.checked ? [...value.hospitalIds, h.id] : value.hospitalIds.filter((x) => x !== h.id))}
              />
              {h.shortName || h.name}
            </label>
          ))}
        </div>
        {value.hospitalIds.length === 0 && <div className="small muted">All</div>}
      </td>
    );

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
          <button disabled={!dirty.length || saving} onClick={() => services && setDrafts(Object.fromEntries(services.map((s) => [s.id, toDraft(s)])))}>
            Discard
          </button>
          <button className="primary" disabled={!dirty.length || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <HospitalsCard hospitals={hs} reload={() => (hospitals.reload(), reload())} />
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Calendar label<br /><span className="small">blank = automatic</span></th>
              <th>Color</th>
              {hs.length > 0 && <th>Hospitals<br /><span className="small">none ticked = all</span></th>}
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
                  <td>
                    <input
                      style={{ width: 110 }}
                      maxLength={16}
                      value={d.shortName}
                      placeholder={autoLabel(d.name)}
                      onChange={(e) => edit(s.id, 'shortName', e.target.value)}
                    />
                  </td>
                  <td><input type="color" value={d.color} onChange={(e) => edit(s.id, 'color', e.target.value)} /></td>
                  {hospitalCell(d, (ids) => edit(s.id, 'hospitalIds', ids))}
                  {coverage(d, (f, v) => edit(s.id, f, v))}
                  <td><button className="link danger" onClick={() => remove(s)}>Delete</button></td>
                </tr>
              );
            })}
            {services?.length === 0 && (
              <tr><td colSpan={8} className="muted">No services yet. Add your first one below.</td></tr>
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
              <td>
                <input
                  style={{ width: 110 }}
                  maxLength={16}
                  value={adding.shortName}
                  placeholder={adding.name.trim() ? autoLabel(adding.name.trim()) : 'e.g. CRS'}
                  onChange={(e) => setAdding({ ...adding, shortName: e.target.value })}
                />
              </td>
              <td><input type="color" value={adding.color} onChange={(e) => setAdding({ ...adding, color: e.target.value })} /></td>
              {hospitalCell(adding, (ids) => setAdding({ ...adding, hospitalIds: ids }))}
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

/**
 * The hospitals the group covers. Each service then ticks the ones it covers:
 * one service per hospital when the surgeons differ, or one service ticked for
 * several when one surgeon covers them all.
 */
function HospitalsCard({ hospitals, reload }: { hospitals: Hospital[]; reload: () => void }) {
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card">
      <h2>Hospitals</h2>
      <p className="muted small">
        Add the hospitals you cover, then tick on each service below which ones it covers. If different surgeons cover a specialty at
        each hospital, add a service per hospital (e.g. “Colorectal – Temple”, “Colorectal – Jeanes”); if one surgeon covers several,
        tick them all on one service. A weekend service takes over Friday nights and holidays only at the hospitals it covers.
      </p>
      {error && <div className="alert error">{error}</div>}
      <div className="row" style={{ gap: 14, marginBottom: 10 }}>
        {hospitals.map((h) => (
          <span key={h.id} className="badge" style={{ fontSize: 13 }}>
            {h.name}
            {h.shortName && <span className="muted"> · {h.shortName}</span>}{' '}
            <button
              className="link"
              title="Rename"
              onClick={() => {
                const n = prompt('Hospital name', h.name);
                if (n === null) return;
                const s = prompt('Short name (e.g. TUH)', h.shortName);
                if (s === null) return;
                run(() => patch(`/api/hospitals/${h.id}`, { name: n.trim() || h.name, shortName: s.trim() }));
              }}
            >
              ✎
            </button>
            <button
              className="link danger"
              title="Remove"
              onClick={() =>
                confirm(`Remove ${h.name}? Services lose it (a service left with none covers all hospitals); unpublished schedules are rebuilt.`) &&
                run(() => del(`/api/hospitals/${h.id}`))
              }
            >
              ×
            </button>
          </span>
        ))}
        {!hospitals.length && <span className="muted small">None yet: every service covers the whole group.</span>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => post('/api/hospitals', { name: name.trim(), shortName: short.trim(), sort: hospitals.length })).then(() => (setName(''), setShort('')));
        }}
      >
        <input placeholder="Hospital, e.g. Temple University Hospital" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 280 }} />
        <input placeholder="Short, e.g. TUH" value={short} maxLength={12} onChange={(e) => setShort(e.target.value)} style={{ width: 120 }} />
        <button disabled={!name.trim()}>Add hospital</button>
      </form>
    </div>
  );
}
