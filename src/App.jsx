// App — providers and routes. The router itself is provided by main.jsx (HashRouter) or by a test.
//
// Provider order: toasts and dialogs first (the fatal-error screen uses both), then the error boundary,
// then the company data, the session, and the user's notifications.
import { Route, Routes } from 'react-router';
import { CompanyProvider } from './app/CompanyContext.jsx';
import { AuthProvider } from './app/AuthContext.jsx';
import { NotificationProvider } from './app/NotificationContext.jsx';
import { DialogProvider } from './app/DialogContext.jsx';
import { RouteFlash, ToastProvider } from './app/ToastContext.jsx';
import { FatalErrorBoundary } from './app/FatalError.jsx';
import { IndexRedirect, ProtectedRoute, PublicOnlyRoute, RoleRoute } from './app/guards.jsx';
import { APP_ROUTES } from './app/routes.jsx';
import { AppLayout } from './components/AppLayout.jsx';
import { LoginPage } from './pages/public/LoginPage.jsx';
import { SignupPage } from './pages/public/SignupPage.jsx';
import { SetupPage } from './pages/public/SetupPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

export function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <FatalErrorBoundary>
          <CompanyProvider>
            <AuthProvider>
              <NotificationProvider>
                <RouteFlash />
                <Routes>
                  <Route path="/" element={<IndexRedirect />} />

                  <Route element={<PublicOnlyRoute />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                  </Route>
                  {/* Setup is reachable while signed in: it then says setup is already complete (V1). */}
                  <Route path="/setup" element={<SetupPage />} />

                  {/* Signed in, then role-checked, and only then is the shell drawn. */}
                  <Route element={<ProtectedRoute />}>
                    <Route element={<RoleRoute />}>
                      <Route element={<AppLayout />}>
                        {APP_ROUTES.map((route) => (
                          <Route key={route.path} path={route.path} element={route.element} />
                        ))}
                      </Route>
                    </Route>
                  </Route>

                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </NotificationProvider>
            </AuthProvider>
          </CompanyProvider>
        </FatalErrorBoundary>
      </DialogProvider>
    </ToastProvider>
  );
}
