import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { auth, get, type User } from './api';
import { Login } from './pages/Login';
import { PeoplePage } from './pages/People';
import { PeriodPage } from './pages/Period';
import { HolidaysPage } from './pages/Holidays';
import { PeriodsPage } from './pages/Periods';
import { RoutinePage } from './pages/Routine';
import { MeContext } from './me';
import { ServicesPage } from './pages/Services';
import './styles.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!auth.token);

  const loadMe = useCallback(() => {
    if (!auth.token) return setChecking(false);
    get<User>('/api/me')
      .then(setUser)
      .catch(() => auth.set(null))
      .finally(() => setChecking(false));
  }, []);
  useEffect(loadMe, [loadMe]);

  if (checking) return null;
  if (!user) return <Login onSignedIn={setUser} />;
  const isSuper = user.role === 'admin';
  if (!isSuper && !user.adminServiceIds.length) {
    return (
      <div className="login">
        <div className="card">
          <h2>Admins only</h2>
          <p className="muted">Surgeons use the Call Planner mobile app to see their schedule and send requests.</p>
          <button onClick={() => (auth.set(null), setUser(null))}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <MeContext.Provider value={user}>
    <BrowserRouter>
      <div className="shell">
        <nav className="sidebar">
          <div className="brand">
            <img src="/logo.png" alt="" />
            Call Planner
          </div>
          <NavLink to="/periods">Schedules</NavLink>
          <NavLink to="/routine">Weekday call</NavLink>
          <NavLink to="/holidays">Holidays</NavLink>
          {isSuper && <NavLink to="/people">Surgeons</NavLink>}
          {isSuper && <NavLink to="/services">Services</NavLink>}
          <div className="spacer" />
          <span className="muted small" style={{ padding: '0 10px' }}>
            {user.name}
            {!isSuper && <><br />Team admin</>}
          </span>
          <button className="link" style={{ textAlign: 'left' }} onClick={() => (auth.set(null), setUser(null))}>
            Sign out
          </button>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/periods" element={<PeriodsPage />} />
            <Route path="/periods/:id" element={<PeriodPage />} />
            <Route path="/routine" element={<RoutinePage />} />
            <Route path="/holidays" element={<HolidaysPage />} />
            {isSuper && <Route path="/people" element={<PeoplePage currentUserId={user.id} />} />}
            {isSuper && <Route path="/services" element={<ServicesPage />} />}
            <Route path="*" element={<Navigate to="/periods" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
    </MeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
