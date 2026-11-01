import { useEffect, useState, type FormEvent } from 'react';
import { auth, get, post, type User } from '../api';

export function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supportEmail, setSupportEmail] = useState<string | null>(null);

  useEffect(() => {
    get<{ supportEmail: string | null }>('/api/info')
      .then((i) => setSupportEmail(i.supportEmail))
      .catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ token: string; user: User }>('/api/auth/login', { email, password });
      auth.set(res.token);
      onSignedIn(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <img className="login-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
        <div>
          <h1>Call Planner</h1>
          <p className="muted">Admin console</p>
        </div>
        {error && <div className="alert error">{error}</div>}
        <label className="field">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {supportEmail && (
          <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
            Can’t sign in? Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          </p>
        )}
      </form>
    </div>
  );
}
