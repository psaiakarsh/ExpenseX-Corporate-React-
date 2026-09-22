// guards.jsx — page protection (V1 guard.js requireUser / redirectIfLoggedIn).
//
//   not logged in / deactivated → /login
//   wrong role                  → own dashboard, with an "Access denied" message
//
// This runs BEFORE the page (and before the app shell) renders, so an unauthorised URL never draws the
// page. It is not the only protection: every domain action calls can() itself, and the pages read records
// only through the visible…() scopes.
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext.jsx';
import { findRoute, homeFor } from './routes.jsx';

// Requires a signed-in, active user.
export function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children ?? <Outlet />;
}

// Requires one of `roles`; without the prop it uses the matched route's roles from the route table.
export function RoleRoute({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;

  const allowed = roles ?? findRoute(location.pathname)?.roles;
  if (allowed && !allowed.includes(user.role)) {
    return (
      <Navigate
        to={homeFor(user.role)}
        replace
        state={{ flash: { message: 'Access denied: that page is not available for your role.', type: 'error' } }}
      />
    );
  }
  return children ?? <Outlet />;
}

// Login and signup: someone already signed in goes straight to their dashboard.
export function PublicOnlyRoute({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return children ?? <Outlet />;
}

// "/" — the V1 index page: the right dashboard, or the login page.
export function IndexRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}
