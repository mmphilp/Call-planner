import { useRef, useState } from 'react';
import { get, patch, post, type Schedule, type User } from '../api';
import { useLoad } from '../useLoad';

type Draft = Omit<User, 'id'> & { id?: string; password: string };

const blank: Draft = {
  name: '',
  email: '',
  role: 'surgeon',
  fte: 1,
  active: true,
  takesCall: true,
  phone: '',
  serviceIds: [],
  adminServiceIds: [],
  password: '',
  // New accounts always choose their own password at first sign-in.
  mustChangePassword: true,
};

export function PeoplePage({ currentUserId }: { currentUserId: string }) {
  const { data, error, reload } = useLoad(async () => {
    const [users, services] = await Promise.all([get<User[]>('/api/users'), get<Schedule['services']>('/api/services')]);
    return { users, services };
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const open = (d: Draft) => {
    setDraft(d);
    setFormError(null);
    dialog.current?.showModal();
  };

  const save = async () => {
    if (!draft) return;
    try {
      const { id, password, ...rest } = draft;
      const body = { ...rest, phone: rest.phone || null, ...(password ? { password } : {}) };
      if (id) await patch(`/api/users/${id}`, body);
      else await post('/api/users', { ...body, password });
      dialog.current?.close();
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const serviceName = new Map(data?.services.map((s) => [s.id, s.name]));
  const [notice, setNotice] = useState<string | null>(null);
  const requireAll = async () => {
    if (!confirm('Make everyone except you choose a new password the next time they sign in (or open the app)?')) return;
    try {
      const { flagged } = await post<{ flagged: number }>('/api/users/require-password-change');
      setNotice(`${flagged} ${flagged === 1 ? 'person' : 'people'} will be asked to choose a new password.`);
      reload();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Surgeons</h1>
          <div className="muted">Who takes call, what they can cover, and their share of call (FTE).</div>
        </div>
        <div className="row">
          <button onClick={requireAll}>Require everyone to change password</button>
          <button className="primary" onClick={() => open(blank)}>Add person</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Services</th>
              <th className="num">Call share</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td className="small">{u.takesCall ? u.serviceIds.map((s) => serviceName.get(s) ?? s).join(', ') || <span className="badge warn">None</span> : <span className="muted">No call</span>}</td>
                <td className="num">{u.takesCall ? `${Math.round(u.fte * 100)}%` : '—'}</td>
                <td>
                  {u.role === 'admin' ? 'Admin' : u.role === 'viewer' ? 'Viewer (read-only)' : 'Surgeon'}
                  {u.role !== 'admin' && u.adminServiceIds.length > 0 && (
                    <div className="small muted">Team admin: {u.adminServiceIds.map((s) => serviceName.get(s) ?? s).join(', ')}</div>
                  )}
                </td>
                <td>
                  {u.active ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}
                  {u.active && u.mustChangePassword && <div className="small muted">Must change password</div>}
                </td>
                <td><button className="link" onClick={() => open({ ...u, phone: u.phone ?? '', password: '' })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog}>
        {draft && data && (
          <form method="dialog" onSubmit={(e) => (e.preventDefault(), save())}>
            <h2>{draft.id ? `Edit ${draft.name}` : 'Add person'}</h2>
            {formError && <div className="alert error">{formError}</div>}
            <div className="form-grid">
              <label className="field">Name<input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label className="field">Email<input required type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
              <label className="field">Mobile phone<input value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
              <label className="field">
                {draft.id ? 'New password (leave blank to keep)' : 'Temporary password'}
                <input
                  type="password"
                  minLength={8}
                  required={!draft.id}
                  value={draft.password}
                  // A password you set for someone is temporary: they choose their own at next sign-in.
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value, mustChangePassword: draft.id === currentUserId ? draft.mustChangePassword : true })
                  }
                />
              </label>
              <label className="field">
                Role
                <select value={draft.role} disabled={draft.id === currentUserId} onChange={(e) => setDraft({ ...draft, role: e.target.value as User['role'] })}>
                  <option value="surgeon">Surgeon (mobile app)</option>
                  <option value="admin">Admin (this console + app)</option>
                  <option value="viewer">Viewer (read-only console, e.g. an assistant)</option>
                </select>
              </label>
              <label className="field">
                Call share (FTE)
                <select value={draft.fte} onChange={(e) => setDraft({ ...draft, fte: Number(e.target.value) })}>
                  {[1, 0.9, 0.8, 0.75, 0.6, 0.5, 0.4, 0.25].map((f) => <option key={f} value={f}>{Math.round(f * 100)}%</option>)}
                </select>
              </label>
              <div className="full row">
                <label className="check"><input type="checkbox" checked={draft.takesCall} onChange={(e) => setDraft({ ...draft, takesCall: e.target.checked })} /> Takes call</label>
                <label className="check"><input type="checkbox" checked={draft.active} disabled={draft.id === currentUserId} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label>
                {draft.id !== currentUserId && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!draft.mustChangePassword}
                      disabled={!draft.id}
                      onChange={(e) => setDraft({ ...draft, mustChangePassword: e.target.checked })}
                    />{' '}
                    Must choose a new password at next sign-in
                  </label>
                )}
              </div>
              {draft.takesCall && (
                <fieldset className="full" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                  <legend className="small muted">Can cover</legend>
                  <div className="row">
                    {data.services.map((s) => (
                      <label key={s.id} className="check">
                        <input
                          type="checkbox"
                          checked={draft.serviceIds.includes(s.id)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              serviceIds: e.target.checked ? [...draft.serviceIds, s.id] : draft.serviceIds.filter((x) => x !== s.id),
                            })
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {draft.role === 'surgeon' && (
                <fieldset className="full" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                  <legend className="small muted">Team admin for weekday call</legend>
                  <div className="row">
                    {data.services.filter((s) => s.coversWeekdayDay || s.coversWeekdayNight).map((s) => (
                      <label key={s.id} className="check">
                        <input
                          type="checkbox"
                          checked={draft.adminServiceIds.includes(s.id)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              adminServiceIds: e.target.checked
                                ? [...draft.adminServiceIds, s.id]
                                : draft.adminServiceIds.filter((x) => x !== s.id),
                            })
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                    {!data.services.some((s) => s.coversWeekdayDay || s.coversWeekdayNight) && (
                      <span className="small muted">No services cover weekdays yet (set this up on the Services page).</span>
                    )}
                  </div>
                  <p className="small muted" style={{ margin: '6px 0 0' }}>
                    Can sign in to this console to set routine days and build these teams’ weekday schedule. Weekends stay with you.
                  </p>
                </fieldset>
              )}
            </div>
            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
