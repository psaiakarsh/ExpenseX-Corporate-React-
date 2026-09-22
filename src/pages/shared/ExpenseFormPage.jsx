// ExpenseFormPage — V1 shared/expense-form.html + pages/expense-form.js.
//   Employee: new expense (save draft / submit), edit draft, edit + resubmit a rejected claim.
//   Manager:  new expense for themselves (self-approved) or for an active team member (auto-approved).
// Validation and every rule stay in the domain: saveEmployeeExpense() / createManagerExpense() are the
// only things that decide whether a claim is valid, editable or submittable.
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CATEGORIES, ROLES, STATUS } from '../../domain/constants.js';
import { isValidDate, monthKey, toLocalDate, formatMonth } from '../../domain/dates.js';
import { isValidAmount, parseMoney, toAmountInput } from '../../domain/money.js';
import { createManagerExpense, findExpense, saveEmployeeExpense } from '../../domain/expenses.js';
import { limitStatus } from '../../domain/limits.js';
import { prepareReceipt, receiptImage, formatBytes } from '../../domain/receipts.js';
import { canViewExpense, can, findUser, isActiveUser, selectableProjects, teamMembers } from '../../domain/permissions.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { expensePath, homeFor } from '../../app/routes.jsx';
import { StatusBadge } from '../../components/badges.jsx';
import { Field, FormError, useFormErrors } from '../../components/forms.jsx';
import { LimitMeter } from '../../components/badges.jsx';
import { EmptyState, Icon } from '../../components/ui.jsx';

const FIELDS = ['employeeId', 'title', 'amount', 'date', 'category', 'projectId', 'notes'];

function Blocked({ message, expenseId, role }) {
  return (
    <div className="card">
      <EmptyState message={message} icon="alert" />
      <div className="row" style={{ justifyContent: 'center' }}>
        {expenseId ? <Link className="btn btn-secondary" to={expensePath(expenseId)}>View expense</Link> : null}
        <Link className="btn btn-ghost" to={homeFor(role)}>Back to dashboard</Link>
      </div>
    </div>
  );
}

// "Monthly limit check": the month so far and what this expense would add (warn only, never blocking).
function LimitPreview({ owner, amountText, dateText, db, isSelf, warningPercent }) {
  if (!owner || owner.role !== ROLES.EMPLOYEE) {
    return <p className="muted small">Managers have no monthly limit. Your own expenses are self-approved and shown with a “Self-approved” badge.</p>;
  }
  const date = isValidDate(dateText) ? dateText : toLocalDate();
  const amount = parseMoney(amountText);
  const extra = amount !== null && isValidAmount(amount) ? amount : 0;
  const before = limitStatus(owner, db.expenses, db.settings, monthKey(date));
  const after = limitStatus(owner, db.expenses, db.settings, monthKey(date), extra);

  return (
    <>
      <LimitMeter status={before} label={`${formatMonth(before.month)} so far`} />
      <div style={{ marginTop: 16 }}><LimitMeter status={after} label="After this expense" /></div>
      <p className="muted xsmall footnote">
        {isSelf ? 'Your' : `${owner.name}’s`} limit warns at {warningPercent}% and flags at 100%. It never blocks a submission.
      </p>
      {after.level === 'exceeded' || after.level === 'warning' ? (
        <div className={`callout callout-${after.level === 'exceeded' ? 'danger' : 'warning'}`} style={{ marginTop: 12 }}>
          <Icon name="alert" />
          <p>
            {after.level === 'exceeded' ? 'This expense takes the month over the limit.' : 'This expense brings the month close to the limit.'}
            {' '}You can still submit; the manager will see the flag.
          </p>
        </div>
      ) : null}
    </>
  );
}

export function ExpenseFormPage() {
  const { id: editId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { db, refresh } = useCompany();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const fileRef = useRef(null);
  const { errors, formError, show, clear } = useFormErrors(formRef);
  const [busy, setBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [processing, setProcessing] = useState(false); // the chosen image is being resized
  const [newReceipt, setNewReceipt] = useState(null); // prepared image waiting to be saved
  const [dropReceipt, setDropReceipt] = useState(false);

  const isManager = user.role === ROLES.MANAGER;
  const editing = editId ? findExpense(db, editId) : null;
  const editable = !editId || can(user, 'expense.edit', editing, db);

  const [values, setValues] = useState(() => ({
    title: editing?.title ?? '',
    amount: editing ? toAmountInput(editing.amount) : '',
    date: editing?.date ?? toLocalDate(),
    category: editing?.category ?? '',
    projectId: editing?.projectId ?? '',
    notes: editing?.notes ?? '',
    employeeId: searchParams.get('for') ?? user.id,
  }));
  const setValue = (name) => (event) => setValues((current) => ({ ...current, [name]: event.target.value }));

  if (editId && !editable) {
    return (
      <Blocked
        role={user.role}
        expenseId={canViewExpense(user, editing, db) ? editId : null}
        message={canViewExpense(user, editing, db)
          ? 'This expense can’t be edited. Only your own drafts and rejected expenses can be changed; approved expenses are locked to preserve history.'
          : 'Expense not found, or you don’t have access to it.'}
      />
    );
  }

  const rejected = editing?.status === STATUS.REJECTED;
  // The same rule saveEmployeeExpense() applies; it refuses the submission on its own as well.
  const canSubmit = !isManager && isActiveUser(findUser(db, user.managerId));
  const reviewingManagerId = isManager ? user.id : user.managerId;
  const projects = reviewingManagerId ? selectableProjects(db, reviewingManagerId) : [];
  const owner = isManager ? findUser(db, values.employeeId) : user;
  const existingReceipt = editing?.receipt && !dropReceipt && !newReceipt ? editing.receipt : null;
  const previewSrc = newReceipt?.dataUrl ?? (existingReceipt ? receiptImage(existingReceipt) : null);
  const previewName = newReceipt?.fileName ?? existingReceipt?.fileName ?? '';
  const previewBytes = newReceipt?.sizeBytes ?? existingReceipt?.sizeBytes ?? 0;

  const chooseReceipt = async (event) => {
    setReceiptError('');
    const file = event.target.files[0];
    if (!file) return;
    // Resizing a large photo takes a moment; say so, and don't let the claim be saved without it.
    setProcessing(true);
    try {
      const result = await prepareReceipt(file); // images only, ≤ 5 MB, resized to 1280 px JPEG
      if (!result.ok) {
        setReceiptError(result.error);
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      setNewReceipt(result.receipt);
      setDropReceipt(false);
    } finally {
      setProcessing(false);
    }
  };

  const removeReceipt = () => {
    setNewReceipt(null);
    setDropReceipt(Boolean(editing?.receipt));
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.focus();
  };

  const handleSubmit = (intent) => (event) => {
    event.preventDefault();
    if (busy) return; // a double click must not save twice
    clear();
    setBusy(true);
    let result;
    try {
      result = intent === 'manager'
        ? createManagerExpense(user, values, { employeeId: values.employeeId, receipt: newReceipt })
        : saveEmployeeExpense(user, values, {
          expenseId: editing?.id ?? null,
          submit: intent === 'submit',
          receipt: newReceipt,
          removeReceipt: dropReceipt,
        });
    } catch (error) {
      // Storage full: nothing was saved.
      result = { ok: false, error: error.message };
    }
    refresh();
    if (!result.ok) {
      setBusy(false);
      show({ errors: result.errors, error: result.error ?? (result.errors ? 'Please fix the highlighted fields.' : '') });
      return;
    }
    const message = {
      manager: result.expense.selfApproved
        ? 'Expense created and self-approved. Reimbursement is pending.'
        : 'Expense created and approved. The employee has been notified.',
      submit: rejected ? 'Expense resubmitted for approval.' : 'Expense submitted for approval.',
      draft: 'Draft saved.',
    }[intent];
    navigate(expensePath(result.expense.id), { state: { flash: { message, type: 'success' } } });
  };

  const projectOptions = projects.length === 0
    ? [{ value: '', label: reviewingManagerId ? 'No project (your team has no active projects)' : 'No project (no manager assigned yet)' }]
    : [{ value: '', label: 'Choose a project' }, ...projects.map((project) => ({ value: project.id, label: project.name }))];

  return (
    <>
      <Link className="back-link" to={editId ? expensePath(editId) : isManager ? '/manager/expenses' : '/employee/expenses'}>
        <Icon name="arrowLeft" size={16} /> Back
      </Link>

      <div className="grid-3">
        <section className="card span-2" aria-labelledby="form-title">
          <div className="card-header">
            <div>
              <h2 id="form-title">{rejected ? 'Edit and resubmit' : editing ? 'Edit draft' : 'New expense'}</h2>
              <p className="muted small">
                {isManager
                  ? 'Created by a manager, so it is approved straight away and moves to Reimbursement Pending.'
                  : rejected
                    ? 'Fix what your manager asked for, then resubmit. Your original values stay in the history.'
                    : 'Save a draft, or submit it to your manager for approval.'}
              </p>
            </div>
            <span>{editing ? <StatusBadge status={editing.status} /> : null}</span>
          </div>

          <div className="stack" style={{ marginBottom: 16 }}>
            {rejected && editing.review ? (
              <div className="callout callout-danger">
                <Icon name="x" />
                <div>
                  <strong>Rejected by {findUser(db, editing.review.byId)?.name ?? 'Your manager'}</strong>
                  {editing.review.comment}
                </div>
              </div>
            ) : null}
            {!isManager && !canSubmit ? (
              <div className="callout callout-warning" role="status">
                <Icon name="alert" />
                <div>
                  <strong>No manager assigned yet</strong>
                  {' '}An Admin must assign you to a Manager before you can submit expenses. You can still save this expense as a draft.
                </div>
              </div>
            ) : null}
          </div>

          <form ref={formRef} className="form" noValidate onSubmit={handleSubmit(isManager ? 'manager' : canSubmit ? 'submit' : 'draft')}>
            <div className="form-grid">
              {isManager ? (
                <div className="full">
                  <Field
                    name="employeeId" label="Expense for" as="select" value={values.employeeId} onChange={setValue('employeeId')}
                    hint="Manager-created expenses are approved automatically. Your own are marked “Self-approved”."
                    error={errors.employeeId}
                  >
                    <option value={user.id}>Myself ({user.name}) — self-approved</option>
                    {teamMembers(user, db).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </Field>
                </div>
              ) : null}

              <div className="full">
                <Field
                  name="title" label="Title" required maxLength={80} placeholder="e.g. Flight – Mumbai client visit"
                  value={values.title} onChange={setValue('title')} error={errors.title}
                />
              </div>

              <Field
                name="amount" label="Amount (₹)" inputMode="decimal" autoComplete="off" required placeholder="0.00"
                hint="Up to ₹10,00,000 with at most 2 decimals."
                value={values.amount} onChange={setValue('amount')} error={errors.amount}
              />
              <Field name="date" label="Expense date" type="date" required max={toLocalDate()} value={values.date} onChange={setValue('date')} error={errors.date} />

              <Field name="category" label="Category" as="select" required value={values.category} onChange={setValue('category')} error={errors.category}>
                <option value="">Choose a category</option>
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </Field>
              <Field name="projectId" label="Project" as="select" value={values.projectId} onChange={setValue('projectId')} error={errors.projectId}>
                {projectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Field>

              <div className="full">
                <Field
                  name="notes" label="Description" as="textarea" optionalMark rows={3} maxLength={500}
                  placeholder="Business purpose, attendees, anything the reviewer should know"
                  value={values.notes} onChange={setValue('notes')} error={errors.notes}
                />
              </div>

              <div className="field full">
                <label htmlFor="receipt">Receipt image <span className="optional">(optional)</span></label>
                <div className="receipt-drop">
                  <div className="receipt-preview" aria-busy={processing}>
                    {previewSrc ? (
                      <>
                        <img className="receipt-thumb" src={previewSrc} alt={`Preview of receipt ${previewName}`} />
                        <div className="small">
                          <div>{previewName}</div>
                          <div className="muted xsmall">{previewBytes ? formatBytes(previewBytes) : ''}</div>
                        </div>
                      </>
                    ) : (
                      <p className="muted small"><Icon name="image" size={18} /> No receipt attached.</p>
                    )}
                  </div>
                  <p className="muted small" role="status" hidden={!processing}>
                    {processing ? 'Processing image…' : ''}
                  </p>
                  <div className="row">
                    <input
                      id="receipt" ref={fileRef} type="file" className="control grow"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      aria-describedby="receipt-hint receipt-error"
                      aria-invalid={receiptError ? 'true' : undefined}
                      onChange={chooseReceipt}
                    />
                    <button className="btn btn-ghost btn-sm" type="button" hidden={!previewSrc} onClick={removeReceipt}>Remove receipt</button>
                  </div>
                  <p className="field-hint" id="receipt-hint">JPG, PNG, WEBP or GIF up to 5 MB. Images are resized and stored in this browser.</p>
                  <p className="field-error" id="receipt-error" hidden={!receiptError}>{receiptError}</p>
                </div>
              </div>
            </div>

            <FormError errors={errors} formError={formError} fields={FIELDS} />

            <div className="form-actions">
              {/* The primary button submits the form (so Enter works); "Save draft" is a separate action. */}
              {isManager ? (
                <button className="btn btn-primary" type="submit" disabled={busy || processing} aria-busy={busy}>
                  <Icon name="check" size={18} /> Create &amp; approve
                </button>
              ) : (
                <>
                  {rejected ? null : (
                    <button className="btn btn-ghost" type="button" disabled={busy || processing} onClick={handleSubmit('draft')}>Save draft</button>
                  )}
                  {canSubmit ? null : <span className="muted small" id="submit-note">Submitting needs an assigned manager.</span>}
                  <button
                    className="btn btn-primary" type="submit" disabled={busy || processing || !canSubmit} aria-busy={busy}
                    aria-describedby={canSubmit ? undefined : 'submit-note'}
                  >
                    <Icon name="send" size={18} /> {rejected ? 'Resubmit for approval' : 'Submit for approval'}
                  </button>
                </>
              )}
            </div>
          </form>
        </section>

        <aside className="card" aria-labelledby="limit-title">
          <div className="card-header"><h2 id="limit-title">Monthly limit check</h2></div>
          <div aria-live="polite">
            <LimitPreview
              owner={owner} amountText={values.amount} dateText={values.date} db={db}
              isSelf={owner?.id === user.id} warningPercent={db.settings.limitWarningPercent}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
