// NotFoundPage — unknown URL. (A static V1 build left this to the web server; a single-page app has to
// answer it itself.) It only offers a way back; it never reveals anything about the company.
import { Link } from 'react-router';
import { useAuth } from '../app/AuthContext.jsx';
import { homeFor } from '../app/routes.jsx';
import { AuthCard, useDocumentTitle } from './public/AuthCard.jsx';

export function NotFoundPage() {
  const { user } = useAuth();
  useDocumentTitle('Page not found · ExpenseX Corporate');
  return (
    <main className="auth-page" id="main">
      <AuthCard titleId="notfound-title" title="Page not found" subtitle="That address does not exist in ExpenseX Corporate.">
        <Link className="btn btn-primary btn-block" to={user ? homeFor(user.role) : '/login'}>
          {user ? 'Go to your dashboard' : 'Go to login'}
        </Link>
      </AuthCard>
    </main>
  );
}
