// ProfilePage — V1 shared/profile.html + pages/profile.js.
// Account details are read-only; only the display name and the password can change here. Role, email,
// manager and team are managed elsewhere, and the domain functions ignore anything else that is sent.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ROLES, ROLE_LABELS } from '../../domain/constants.js';
import { formatDateTime } from '../../domain/dates.js';
import { changePassword, updateProfileName } from '../../domain/auth.js';
import { limitStatus } from '../../domain/limits.js';
import { findUser, isActiveUser, teamMembers, visibleProjects } from '../../domain/permissions.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { LimitMeter, RoleBadge } from '../../components/badges.jsx';
import { Field, FormError, useFormErrors } from '../../components/forms.jsx';
import { Icon } from '../../components/ui.jsx';

function WorkDetails({ user, db }) {
  if (user.role === ROLES.EMPLOYEE) {
    const manager = findUser(db, user.managerId);
    return (
      <div className="stack">
        <p>
          {manager
            ? <>Manager: <strong>{manager.name}</strong>{manager.department ? ` · ${manager.department}` : ''}</>
            : <span className="text-warning">No manager assigned yet.</span>}
        </p>
        <LimitMeter status={limitStatus(user, db.expenses, db.settings)} label="This month" />
      </div>
    );
  }
  if (user.role === ROLES.MANAGER) {
    const team = teamMembers(user, db);
    const projects = visibleProjects(user, db).filter((project) => project.status === 'active').length;
    return (
      <p>
        {user.department || 'Manager'} · <strong>{team.length}</strong> active employee{team.length === 1 ? '' : 's'} ·{' '}
        <strong>{projects}</strong> active projects
      </p>
    );
  }
  return (
    <p className="muted small">
      Administrators manage accounts, teams and system settings. For privacy, individual expense records are not
      visible to this role.
    </p>
  );
}

export function ProfilePage() {
  const { user, logout } = useAuth();
  const { db, refresh } = useCompany();
  const toast = useToast();
  const navigate = useNavigate();

  const nameForm = useRef(null);
  const passwordForm = useRef(null);
  const nameErrors = useFormErrors(nameForm);
  const passwordErrors = useFormErrors(passwordForm);
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);

  const saveName = (event) => {
    event.preventDefault();
    nameErrors.clear();
    const result = updateProfileName(user, name);
    refresh();
    if (!result.ok) {
      nameErrors.show(result);
      return;
    }
    toast('Name updated.', 'success');
  };

  const savePassword = async (event) => {
    event.preventDefault();
    passwordErrors.clear();
    setBusy(true);
    try {
      const form = event.currentTarget;
      const result = await changePassword(user, Object.fromEntries(new FormData(form)));
      if (!result.ok) {
        passwordErrors.show(result);
        return;
      }
      form.reset();
      toast('Password changed.');
    } catch (error) {
      passwordErrors.show({ error: error.message });
    } finally {
      setBusy(false);
    }
  };

  const doLogout = () => {
    logout();
    toast('You have been logged out.', 'info');
    navigate('/login', { replace: true });
  };

  return (
    <div className="grid-2">
      <div className="stack">
        <section className="card" aria-labelledby="account-title">
          <div className="card-header"><h2 id="account-title">Account</h2><RoleBadge role={user.role} /></div>
          <dl className="details">
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABELS[user.role]}</dd></div>
            <div>
              <dt>Account status</dt>
              <dd>{isActiveUser(user) ? <span className="badge badge-approved">Active</span> : <span className="badge badge-muted">Inactive</span>}</dd>
            </div>
            <div><dt>Company</dt><dd>{db.settings.companyName}</dd></div>
            <div><dt>Member since</dt><dd>{formatDateTime(user.createdAt)}</dd></div>
            <div style={{ gridColumn: '1/-1' }}><dt>Account ID (never changes)</dt><dd><code className="xsmall">{user.id}</code></dd></div>
          </dl>
        </section>

        <section className="card" aria-labelledby="work-title">
          <div className="card-header"><h2 id="work-title">Work</h2></div>
          <WorkDetails user={user} db={db} />
        </section>

        <section className="card" aria-labelledby="session-title">
          <div className="card-header"><h2 id="session-title">Session</h2></div>
          <p className="muted small" style={{ marginBottom: 16 }}>
            You stay logged in on this browser until you log out. Your role and team are managed by an
            administrator and can&apos;t be changed here.
          </p>
          <button className="btn btn-ghost" type="button" onClick={doLogout}><Icon name="logout" size={18} /> Log out</button>
        </section>
      </div>

      <div className="stack">
        <section className="card" aria-labelledby="name-title">
          <div className="card-header"><h2 id="name-title">Display name</h2></div>
          <form ref={nameForm} className="form" noValidate onSubmit={saveName}>
            <Field
              name="name" label="Full name" autoComplete="name" required maxLength={50}
              value={name} onChange={(event) => setName(event.target.value)} error={nameErrors.errors.name}
            />
            <FormError errors={nameErrors.errors} formError={nameErrors.formError} fields={['name']} />
            <div className="form-actions"><button className="btn btn-primary" type="submit">Save name</button></div>
          </form>
        </section>

        <section className="card" aria-labelledby="password-title">
          <div className="card-header"><h2 id="password-title">Change password</h2></div>
          <form ref={passwordForm} className="form" noValidate onSubmit={savePassword}>
            <Field name="currentPassword" label="Current password" type="password" autoComplete="current-password" required error={passwordErrors.errors.currentPassword} />
            <Field name="newPassword" label="New password" type="password" autoComplete="new-password" required maxLength={72} error={passwordErrors.errors.newPassword} />
            <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required maxLength={72} error={passwordErrors.errors.confirmPassword} />
            <FormError
              errors={passwordErrors.errors} formError={passwordErrors.formError}
              fields={['currentPassword', 'newPassword', 'confirmPassword']}
            />
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
