// AdminSettings — V1 admin/settings.html + pages/admin-settings.js.
// Company settings (updateSettings) and demo data (loadDemoCompany). Both domain functions check
// can(admin, …) themselves. The demo actions need a typed confirmation (REPLACE / RESET), touch only
// "exc:" keys (storage.js) and log everyone out afterwards.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { updateSettings } from '../../domain/settings.js';
import { loadDemoCompany } from '../../domain/demo-data.js';
import { formatBytes } from '../../domain/receipts.js';
import { storageUsageBytes } from '../../domain/storage.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useDialogs } from '../../app/DialogContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { Field, FormError, useFormErrors } from '../../components/forms.jsx';
import { Icon } from '../../components/ui.jsx';

const APPROX_STORAGE_LIMIT = 5 * 1024 * 1024; // most browsers allow about 5 MB per site
const FIELDS = ['companyName', 'limitWarningPercent'];

export function AdminSettings() {
  const { user: admin, refreshSession } = useAuth();
  const { db, refresh } = useCompany();
  const { confirmTyped } = useDialogs();
  const toast = useToast();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const { errors, formError, show, clear } = useFormErrors(formRef);
  const [values, setValues] = useState({
    companyName: db.settings.companyName,
    limitWarningPercent: String(db.settings.limitWarningPercent),
    allowSignup: db.settings.allowSignup,
  });
  const [busy, setBusy] = useState('');

  const used = storageUsageBytes();
  const percent = Math.min(100, Math.round((used * 100) / APPROX_STORAGE_LIMIT));

  const save = (event) => {
    event.preventDefault();
    clear();
    let result;
    try {
      result = updateSettings(admin, values);
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    refresh();
    if (!result.ok) {
      show(result);
      return;
    }
    toast('Settings saved.');
  };

  const runDemo = async (mode) => {
    const word = mode === 'reset' ? 'RESET' : 'REPLACE';
    const confirmed = await confirmTyped({
      title: mode === 'reset' ? 'Reset demo data?' : 'Load the demo company?',
      message: mode === 'reset'
        ? 'Every ExpenseX Corporate record in this browser is deleted and the demo company is recreated from scratch. Everyone is logged out.'
        : 'Every ExpenseX Corporate record in this browser — including accounts you created — is replaced by the demo company. Everyone is logged out.',
      word,
      confirmLabel: mode === 'reset' ? 'Reset demo data' : 'Replace with demo',
    });
    if (!confirmed) return;

    setBusy(mode);
    const result = await loadDemoCompany(admin, mode);
    setBusy('');
    refresh();
    refreshSession();
    if (!result.ok) {
      toast(result.error ?? 'The demo could not be loaded. Your data was restored.', 'error');
      return;
    }
    // The demo logs everyone out, so the route guard redirects to /login on its own. A message carried as
    // router state would be dropped by that redirect — show it directly instead (toasts outlive navigation).
    toast(mode === 'reset' ? 'Demo data reset. Log in with a demo account.' : 'Demo company loaded. Log in with a demo account.');
    navigate('/login', { replace: true });
  };

  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="company-title">
        <div className="card-header"><h2 id="company-title">Company settings</h2></div>
        <form ref={formRef} className="form" noValidate onSubmit={save}>
          <Field
            name="companyName" label="Company name" required maxLength={50} autoComplete="organization"
            value={values.companyName} onChange={(event) => setValues((current) => ({ ...current, companyName: event.target.value }))}
            error={errors.companyName}
          />
          <Field
            name="limitWarningPercent" label="Spending-limit warning at (%)" type="number" min={50} max={99} step={1}
            inputMode="numeric" required
            hint="50–99. Employees at or above this share of their monthly limit get a warning; 100 % is always “exceeded”. Limits never block submissions."
            value={values.limitWarningPercent}
            onChange={(event) => setValues((current) => ({ ...current, limitWarningPercent: event.target.value }))}
            error={errors.limitWarningPercent}
          />
          <div className="field">
            <div className="switch-row">
              <label htmlFor="allowSignup">Allow public employee signup</label>
              <input
                id="allowSignup" name="allowSignup" type="checkbox" aria-describedby="allowSignup-hint"
                checked={values.allowSignup}
                onChange={(event) => setValues((current) => ({ ...current, allowSignup: event.target.checked }))}
              />
            </div>
            <p className="field-hint" id="allowSignup-hint">
              When off, the signup page explains that signup is unavailable and no account can be created. Public
              signup only ever creates Employee accounts.
            </p>
          </div>
          <FormError errors={errors} formError={formError} fields={FIELDS} />
          <div className="form-actions"><button className="btn btn-primary" type="submit">Save settings</button></div>
        </form>
      </section>

      <div className="stack">
        <section className="card" aria-labelledby="storage-title">
          <div className="card-header"><h2 id="storage-title">Browser storage</h2></div>
          <div className={`meter ${percent >= 90 ? 'meter-exceeded' : percent >= 70 ? 'meter-warning' : ''}`}>
            <div className="meter-values">
              <span>ExpenseX Corporate data</span>
              <span className="num"><strong>{formatBytes(used)}</strong> of ~{formatBytes(APPROX_STORAGE_LIMIT)}</span>
            </div>
            <div
              className="meter-track" role="progressbar" aria-label="Browser storage used"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            >
              <div className="meter-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <p className="muted xsmall footnote">
            Receipt images use most of the space. If storage fills up, saving shows an error and nothing is half-saved.
          </p>
        </section>

        <section className="card" aria-labelledby="demo-title">
          <div className="card-header">
            <h2 id="demo-title">Demo data</h2>
            <span>
              {db.settings.demoLoaded
                ? <span className="badge badge-approved">Demo loaded</span>
                : <span className="badge badge-muted">Custom company</span>}
            </span>
          </div>
          <div className="stack">
            <p className="muted small">
              Demo company: <strong>Verdant Systems Pvt Ltd</strong> — 1 admin, 3 managers, employees in every
              situation, projects, and expenses in every status, created through the app&apos;s real workflow.
            </p>
            <div className="callout callout-warning">
              <Icon name="alert" />
              <p>
                Both actions <strong>replace all ExpenseX Corporate data in this browser</strong> and log everyone out.
                Other websites&apos; and apps&apos; browser data is not touched.
              </p>
            </div>
            <div className="row">
              <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} aria-busy={busy === 'load'} onClick={() => runDemo('load')}>
                {busy === 'load' ? 'Loading…' : 'Load Demo Company'}
              </button>
              <button
                className="btn btn-danger-ghost" type="button"
                disabled={Boolean(busy) || !db.settings.demoLoaded} aria-busy={busy === 'reset'}
                onClick={() => runDemo('reset')}
              >
                {busy === 'reset' ? 'Resetting…' : 'Reset Demo Data'}
              </button>
            </div>
            <p className="muted xsmall">
              {db.settings.demoLoaded
                ? 'Reset Demo Data recreates the demo company from scratch, undoing every change made during a demonstration.'
                : 'Reset is available once the demo company is loaded. Load Demo Company replaces this company with the demo.'}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
