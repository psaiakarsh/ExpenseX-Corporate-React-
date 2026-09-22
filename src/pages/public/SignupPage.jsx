// SignupPage — V1 signup.html + pages/signup.js. There is deliberately NO role field: signupEmployee()
// always creates an Employee with no manager, and refuses when the Admin has switched signup off.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { signupEmployee } from '../../domain/auth.js';
import { useCompany } from '../../app/CompanyContext.jsx';
import { Field, FormError, useFormErrors } from '../../components/forms.jsx';
import { Icon } from '../../components/ui.jsx';
import { AuthCard, useDocumentTitle } from './AuthCard.jsx';

const FIELDS = ['name', 'email', 'password', 'confirmPassword'];
const FLASH = {
  flash: { message: 'Employee account created. Log in to save drafts; an administrator will assign your manager.', type: 'success' },
};

export function SignupPage() {
  const { db, refresh } = useCompany();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const continueRef = useRef(null);
  const { errors, formError, show, clear } = useFormErrors(formRef);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  useDocumentTitle('Employee signup · ExpenseX Corporate');

  const closedReason = db.users.length === 0
    ? 'This company has not been set up yet. Go back to the login page to load the demo company or set up your own.'
    : !db.settings.allowSignup
      ? 'Public signup is currently disabled by the administrator. Ask them to create your account.'
      : '';

  // V1 moved to the login page five seconds after a successful signup.
  useEffect(() => {
    if (!created) return undefined;
    continueRef.current?.focus();
    const timer = setTimeout(() => navigate('/login', { state: FLASH }), 5000);
    return () => clearTimeout(timer);
  }, [created, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    clear();
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await signupEmployee(values, { login: false });
      refresh();
      if (!result.ok) {
        show(result);
        return;
      }
      setCreated(result.user);
    } catch (error) {
      show({ error: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page" id="main">
      <AuthCard titleId="signup-title" title="Create an employee account" subtitle={db.users.length ? db.settings.companyName : ''}>
        {closedReason ? (
          <div className="callout callout-warning">
            <Icon name="alert" />
            <div>
              <p>{closedReason}</p>
              <p style={{ marginTop: 8 }}><Link to="/login">Back to login</Link></p>
            </div>
          </div>
        ) : created ? (
          <div className="stack" role="status">
            <div className="callout callout-info">
              <Icon name="check" />
              <div>
                <strong>Account created for {created.email}</strong>
                <p>
                  An administrator must assign you to a manager before you can submit expenses. Until then you can
                  log in and save expense drafts.
                </p>
                <p className="muted small" style={{ marginTop: 8 }}>Taking you to the login page…</p>
              </div>
            </div>
            <Link className="btn btn-primary btn-block" to="/login" state={FLASH} ref={continueRef}>Continue to login</Link>
          </div>
        ) : (
          <>
            <div className="callout callout-info">
              <Icon name="info" />
              <p>
                Public signup always creates an <strong>Employee</strong> account. An administrator assigns you to a
                manager; until then you can save expense drafts but not submit them.
              </p>
            </div>
            <form ref={formRef} className="form" noValidate onSubmit={handleSubmit}>
              <Field name="name" label="Full name" autoComplete="name" required maxLength={50} error={errors.name} />
              <Field name="email" label="Work email" type="email" autoComplete="email" required maxLength={100} error={errors.email} />
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
                {busy ? 'Creating account…' : 'Create employee account'}
              </button>
            </form>
            <p className="auth-switch">Already have an account? <Link to="/login">Log in</Link></p>
          </>
        )}
      </AuthCard>
      <p className="auth-note">Prototype: data stays in this browser. Sign-in is simulated and not secure.</p>
    </main>
  );
}
