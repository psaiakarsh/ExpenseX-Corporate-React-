// AuthContext — the signed-in user, from the domain's simulated session (auth.js).
//
// `user` is getSessionUser() re-read with the company data, so it is always the STORED, ACTIVE account:
// a missing or deactivated account clears the session (domain rule) and `user` becomes null, which the
// route guards turn into a redirect to /login. Login/logout call the domain functions — there is no
// other way to become signed in.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { getSessionUser, login as domainLogin, logout as domainLogout } from '../domain/auth.js';
import { useCompany } from './CompanyContext.jsx';
import { homeFor } from './routes.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { version, refresh } = useCompany();
  const navigate = useNavigate();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the session whenever storage changed
  const user = useMemo(() => getSessionUser(), [version]);

  const login = useCallback(async (credentials) => {
    const result = await domainLogin(credentials);
    if (result.ok) refresh();
    return result;
  }, [refresh]);

  // Ends the session only; all company data stays (auth.js logout()).
  const logout = useCallback(() => {
    domainLogout();
    refresh();
  }, [refresh]);

  // Another tab switched to a different account: go to that account's home (V1 layout.js did the same).
  // Logging out or deactivation elsewhere makes `user` null; the guards send the tab to /login.
  const previous = useRef(user);
  useEffect(() => {
    const before = previous.current;
    previous.current = user;
    if (before && user && (before.id !== user.id || before.role !== user.role)) {
      navigate(homeFor(user.role), { replace: true });
    }
  }, [user, navigate]);

  const value = useMemo(() => ({ user, login, logout, refreshSession: refresh }), [user, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth() must be used inside <AuthProvider>.');
  return context;
}
