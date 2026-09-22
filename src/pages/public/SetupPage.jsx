// SetupPage — V1 setup.html + pages/setup.js: first run only. The form appears only while no users
// exist, and setupCompany() checks again before saving, so a second admin can never be created here.
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { setupCompany } from '../../domain/auth.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { Field, FormError, useFormErrors } from '../../components/forms.jsx';
import { Icon } from '../../components/ui.jsx';
import { homeFor } from '../../app/routes.jsx';
import { AuthCard, useDocumentTitle } from './AuthCard.jsx';

const FIELDS = ['companyName', 'name', 'email', 'password', 'confirmPassword'];

export function SetupPage() {
  const { db, refresh } = useCompany();
  const { refreshSession } = useAuth();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const { errors, formError, show, clear } = useFormErrors(formRef);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Set up company · ExpenseX Corporate');

  const done = db.users.length > 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    clear();
    setBusy(true);
    try {
      const result = await setupCompany(Object.fromEntries(new FormData(event.currentTarget)));
      if (!result.ok) {
        show(result);
        return;
      }
      // setupCompany() signs the new admin in; refresh so the session is picked up, then go home.
      refresh();
      refreshSession();
      navigate(homeFor(result.user.role), {
        replace: true,
        state: { flash: { message: 'Company created. Next: add managers from the Users page.', type: 'success' } },
      });
    } catch (error) {
      show({ error: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page" id="main">
      <AuthCard
        titleId="setup-title"
        title={done ? 'Setup complete' : 'Set up your company'}
        subtitle={done ? null : 'First run only: this creates the company and its first Admin account. The admin then creates managers and assigns employees.'}
      >
        {done ? (
          <div className="callout callout-info" role="status">
            <Icon name="info" />
            <div>
              <strong>Initial setup has already been completed</strong>
              <p>This company already has accounts, so the setup page is closed. Additional admins and managers can't be created here.</p>
              <p style={{ marginTop: 8 }}><Link to="/login">Go to login</Link></p>
            </div>
          </div>
        ) : (
          <form ref={formRef} className="form" noValidate onSubmit={handleSubmit}>
            <Field name="companyName" label="Company name" autoComplete="organization" required maxLength={50} autoFocus error={errors.companyName} />
            <Field name="name" label="Admin full name" autoComplete="name" required maxLength={50} error={errors.name} />
            <Field name="email" label="Admin email" type="email" autoComplete="email" required maxLength={100} error={errors.email} />
            <Field
              name="password" label="Password" type="password" autoComplete="new-password" required maxLength={72}
              hint="At least 6 characters." error={errors.password}
            />
            <Field
              name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" required
              maxLength={72} error={errors.confirmPassword}
            />
            <FormError errors={errors} formError={formError} fields={FIELDS} />
            <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? 'Setting up…' : 'Create company and admin'}
            </button>
          </form>
        )}
        <p className="auth-switch"><Link to="/login">Back to login</Link></p>
      </AuthCard>
    </main>
  );
}
