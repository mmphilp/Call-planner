import { useState, type FormEvent } from 'react';
import { post, type User } from '../api';

/**
 * Choose a new password. `forced`: shown on its own after signing in with a
 * temporary password (new account, or reset by the admin); nothing else is
 * available until it's done.
 */
export function ChangePassword({ forced, onDone, onSignOut }: { forced?: boolean; onDone: (u: User) => void; onSignOut?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== again) return setError('The new passwords don’t match.');
    setBusy(true);
    try {
      const user = await post<User>('/api/me/password', { current, next });
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(true);
      onDone(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form className="card" onSubmit={submit} style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {forced ? (
        <>
          <img className="login-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
          <div>
            <h1>Choose a new password</h1>
            <p className="muted">You signed in with a temporary password. Pick your own to continue.</p>
          </div>
        </>
      ) : (
        <h2>Change password</h2>
      )}
      {error && <div className="alert error">{error}</div>}
      {done && !forced && <div className="alert ok">Password changed.</div>}
      <label className="field">
        {forced ? 'Temporary password' : 'Current password'}
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
      </label>
      <label className="field">
        New password <span className="small muted">(at least 8 characters)</span>
        <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
      </label>
      <label className="field">
        New password again
        <input type="password" autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required />
      </label>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      {forced && onSignOut && (
        <button type="button" className="link" onClick={onSignOut}>Sign out</button>
      )}
    </form>
  );
  return forced ? <div className="login">{form}</div> : form;
}
