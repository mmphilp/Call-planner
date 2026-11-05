import { useState, type FormEvent } from 'react';
import { auth, post } from '../api';

/**
 * Test copy only: replace everything here with a fresh copy of the live site's
 * data. Signs in to the live site with its admin email and password (used once,
 * not stored). Nothing on the live site changes.
 */
export function CopyLivePage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm('Replace ALL data on this test copy with the live site’s current data? Anything you changed here is lost.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ users: number; periods: number }>('/api/test/copy-live', { email, password });
      alert(`Copied the live data: ${r.users} people and ${r.periods} schedules.\n\nSign in again with your live password.`);
      // The accounts here are now the live ones, so this session no longer applies.
      auth.set(null);
      location.href = import.meta.env.BASE_URL;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Copy live data</h1>
          <div className="muted">Load a fresh copy of the live site’s data into this test copy, to try things on real schedules.</div>
        </div>
      </div>
      <form className="card" onSubmit={submit} style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="small" style={{ margin: 0 }}>
          Everything here is <b>replaced</b>: schedules, people, requests, settings. The live site isn’t changed. Afterwards
          everyone’s accounts and passwords are the same as on the live site, and you’ll sign in again.
        </p>
        {error && <div className="alert error">{error}</div>}
        <label className="field">
          Live site admin email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          Live site admin password <span className="small muted">(used once to fetch the data, not saved)</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Copying…' : 'Copy live data now'}</button>
      </form>
    </>
  );
}
