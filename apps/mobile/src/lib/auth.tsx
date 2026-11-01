import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setPasswordRequiredHandler, setUnauthorizedHandler, tokenStore, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replace the signed-in user (e.g. after changing your password). */
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    // Flagged to change password mid-session: reload who we are, which shows that screen.
    setPasswordRequiredHandler(() => void api<User>('GET', '/api/me').then(setUser).catch(() => {}));
    (async () => {
      try {
        if (await tokenStore.get()) setUser(await api<User>('GET', '/api/me'));
      } catch {
        // Offline or expired; the login screen will show.
      } finally {
        setLoading(false);
      }
    })();
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string }>('POST', '/api/auth/login', { email: email.trim(), password });
    await tokenStore.set(res.token);
    setUser(await api<User>('GET', '/api/me'));
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut, setUser }), [user, loading, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
