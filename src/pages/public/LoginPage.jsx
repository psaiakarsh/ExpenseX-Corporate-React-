// LoginPage — V1 login.html + pages/login.js: sign in, demo-account shortcuts, and "Load Demo Company"
// (offered only while this browser holds no company data, exactly as in V1).
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ROLES } from '../../domain/constants.js';
import { collectErrors, hasErrors } from '../../domain/validate.js';
import { DEMO_LOGINS, DEMO_PASSWORD, loadDemoCompany } from '../../domain/demo-data.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { Field, FormError, useFormErrors } from '../../components/forms.jsx';
import { Avatar, Icon } from '../../components/ui.jsx';
import { AuthCard, useDocumentTitle } from './AuthCard.jsx';

const FIELDS = ['email', 'password'];

export function LoginPage() {
  const { db, refresh } = useCompany();
  const { login } = useAuth();
  const toast = useToast();
  const formRef = useRef(null);
  const demoListRef = useRef(null);
  const { errors, formError, show, clear } = useFormErrors(formRef);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  useDocumentTitle('Log in · ExpenseX Corporate');

  const empty = db.users.length === 0;
  // Only demo accounts that really exist in this browser are listed: data from an older demo version can
  // have different emails, and it is never migrated silently (V1 behaviour).
  const activeEmails = new Set(db.users.filter((user) => user.status === 'active').map((user) => user.email));
  const available = DEMO_LOGINS.filter((account) => activeEmails.has(account.email));
  const stale = !empty && db.settings.demoLoaded && available.length !== DEMO_LOGINS.length;
  const storedAdmin = db.users.find((user) => user.role === ROLES.ADMIN);

  const useAccount = (email) => {
    const form = formRef.current;
    form.elements.email.value = email;
    form.elements.password.value = DEMO_PASSWORD;
    clear();
    form.querySelector('button[type="submit"]').focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clear();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const missing = collectErrors({
      email: values.email.trim() ? '' : 'Enter your email.',
      password: values.password ? '' : 'Enter your password.',
    });
    if (hasErrors(missing)) {
      show({ errors: missing });
      return;
    }
    setBusy(true);
    try {
      const result = await login(values);
      if (!result.ok) {
        show({ error: result.error });
        formRef.current.elements.password.value = '';
        return;
      }
      // PublicOnlyRoute sends the now signed-in user to their dashboard.
    } catch (error) {
      show({ error: error.message });
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    setDemoBusy(true);
    const result = await loadDemoCompany();
    setDemoBusy(false);
    refresh();
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast('Demo company loaded. Pick an account to log in.');
    setTimeout(() => demoListRef.current?.querySelector('button')?.focus(), 0);
  };

  return (
    <main className="auth-page" id="main">
      <div className={`auth-layout${empty || db.settings.demoLoaded ? ' has-aside' : ''}`}>
        <AuthCard titleId="login-title" title="Log in" subtitle={empty ? 'Corporate expense management' : db.settings.companyName}>
          <form ref={formRef} className="form" noValidate onSubmit={handleSubmit}>
            <Field name="email" label="Work email" type="email" autoComplete="username" required error={errors.email} />
            <Field name="password" label="Password" type="password" autoComplete="current-password" required error={errors.password} />
            <FormError errors={errors} formError={formError} fields={FIELDS} />
            <button className="btn btn-primary btn-block" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </button>
          </form>
          {!empty && db.settings.allowSignup ? (
            <p className="auth-switch">New employee? <Link to="/signup">Create an employee account</Link></p>
          ) : null}
        </AuthCard>

        {!empty && db.settings.demoLoaded ? (
          <section className="card stack" aria-labelledby="demo-title">
            <div>
              <h2 id="demo-title">Demo accounts</h2>
              <p className="muted small">Every demo account uses the password <code>{DEMO_PASSWORD}</code>. Choose one to fill the form.</p>
            </div>
            {stale ? (
              <div className="callout callout-warning" role="status">
                <Icon name="alert" />
                <div>
                  <strong>This browser holds demo data from an older version.</strong>
                  {' '}Some demo accounts are not in it. Log in as this browser's admin (<code>{storedAdmin?.email ?? ''}</code>,
                  password <code>{DEMO_PASSWORD}</code> unless it was changed), open Settings → Load Demo Company and
                  type REPLACE to recreate the demo.
                </div>
              </div>
            ) : null}
            <ul className="demo-accounts" ref={demoListRef}>
              {available.map((account) => (
                <li className="demo-account" key={account.email}>
                  <Avatar name={account.name} size="sm" />
                  <div className="grow">
                    <div className="small"><strong>{account.name}</strong> · {account.role}</div>
                    <div className="muted xsmall">{account.note}</div>
                    <code>{account.email}</code>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    aria-label={`Use ${account.name} (${account.role})`}
                    onClick={() => useAccount(account.email)}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {empty ? (
          <section className="card stack" aria-labelledby="empty-title">
            <div>
              <h2 id="empty-title">Get started</h2>
              <p className="muted small">There is no company data in this browser yet.</p>
            </div>
            <button className="btn btn-primary" type="button" onClick={loadDemo} disabled={demoBusy} aria-busy={demoBusy}>
              {demoBusy ? 'Loading demo company…' : 'Load Demo Company'}
            </button>
            <p className="muted small">
              Creates the fictional company <strong>Verdant Systems Pvt Ltd</strong>: 1 admin, 3 managers,
              10 employees (1 unassigned), projects, and expenses in every status.
            </p>
            <Link className="btn btn-ghost" to="/setup">Set up your own company instead</Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}
