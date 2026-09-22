// ExpenseDetailPage — V1 shared/expense.html + pages/expense-detail.js.
// Visible only to the owner and the employee's current manager (canViewExpense); the Admin is excluded
// by the route table. Every action button appears only where can() allows it, and the domain function
// behind the button checks the permission again.
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ROLES, STATUS } from '../../domain/constants.js';
import { formatDate, formatDateTime, monthKey, formatMonth } from '../../domain/dates.js';
import { formatMoney } from '../../domain/money.js';
import { deleteDraft, findExpense } from '../../domain/expenses.js';
import { limitStatus } from '../../domain/limits.js';
import { can, canViewExpense, findUser } from '../../domain/permissions.js';
import { projectName } from '../../domain/projects.js';
import { formatBytes, receiptImage } from '../../domain/receipts.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useAction } from '../../app/useAction.js';
import { useDialogs } from '../../app/DialogContext.jsx';
import { expenseEditPath } from '../../app/routes.jsx';
import { LimitBadge, LimitMeter, SelfApprovedBadge, StatusBadge } from '../../components/badges.jsx';
import { Timeline } from '../../components/expense.jsx';
import { useReviewDialogs } from '../../components/reviewDialogs.jsx';
import { EmptyState, Icon } from '../../components/ui.jsx';

export function ExpenseDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { db } = useCompany();
  const navigate = useNavigate();
  const runAction = useAction();
  const { openFormDialog, confirmAction } = useDialogs();
  const review = useReviewDialogs();

  const expense = findExpense(db, id);
  const visible = canViewExpense(user, expense, db);

  useEffect(() => {
    if (visible) document.title = `${expense.title} · ExpenseX Corporate`;
  }, [visible, expense]);

  const backTo = user.role === ROLES.MANAGER ? '/manager/expenses' : '/employee/expenses';

  // The same message whether the expense doesn't exist or isn't theirs, so nothing leaks.
  if (!visible) {
    return (
      <>
        <Link className="back-link" to={backTo}><Icon name="arrowLeft" size={16} /> Back to expenses</Link>
        <div className="card"><EmptyState message="Expense not found, or you don’t have access to it." icon="alert" /></div>
      </>
    );
  }

  const employee = findUser(db, expense.employeeId);
  const creator = findUser(db, expense.createdById);
  const manager = findUser(db, expense.managerId);
  const record = db.reimbursements.find((item) => item.id === expense.reimbursementId);
  const reviewer = expense.review ? findUser(db, expense.review.byId) : null;
  const receiptSrc = receiptImage(expense.receipt);
  const isReviewer = user.role === ROLES.MANAGER && expense.employeeId !== user.id;

  const openReceipt = () => openFormDialog({
    title: expense.receipt.fileName,
    description: <img className="receipt-full" src={receiptSrc} alt={`Receipt for ${expense.title}`} />,
    submitLabel: 'Close',
    onSubmit: () => ({ ok: true }),
  });

  const removeDraft = async () => {
    const confirmed = await confirmAction({
      title: 'Delete draft?',
      message: 'This draft was never submitted, so it is removed completely.',
      confirmLabel: 'Delete draft',
      danger: true,
    });
    if (confirmed && runAction(() => deleteDraft(user, expense.id), 'Draft deleted.').ok) {
      navigate('/employee/expenses');
    }
  };

  const actions = [];
  if (can(user, 'expense.edit', expense, db)) {
    if (expense.status === STATUS.DRAFT) {
      actions.push(
        <Link key="edit" className="btn btn-primary" to={expenseEditPath(expense.id)}><Icon name="edit" size={18} /> Edit draft</Link>,
        <button key="delete" className="btn btn-danger-ghost" type="button" onClick={removeDraft}><Icon name="trash" size={18} /> Delete draft</button>,
      );
    } else {
      actions.push(
        <Link key="edit" className="btn btn-primary" to={expenseEditPath(expense.id)}><Icon name="edit" size={18} /> Edit &amp; resubmit</Link>,
      );
    }
  }
  if (can(user, 'expense.review', expense, db)) {
    actions.push(
      <button key="approve" className="btn btn-primary" type="button" onClick={() => review.approve(user, expense)}><Icon name="check" size={18} /> Approve</button>,
      <button key="reject" className="btn btn-danger-ghost" type="button" onClick={() => review.reject(user, expense)}><Icon name="x" size={18} /> Reject</button>,
    );
  }
  if (can(user, 'reimbursement.markPaid', record, db)) {
    actions.push(
      <button key="pay" className="btn btn-primary" type="button" onClick={() => review.reimburse(user, expense)}><Icon name="banknote" size={18} /> Mark as reimbursed</button>,
    );
  }

  const limit = isReviewer && employee?.role === ROLES.EMPLOYEE
    ? limitStatus(employee, db.expenses, db.settings, monthKey(expense.date))
    : null;

  return (
    <>
      <Link className="back-link" to={backTo}><Icon name="arrowLeft" size={16} /> Back to expenses</Link>

      <div className="grid-3">
        <div className="span-2 stack">
          <section className="card stack" aria-labelledby="expense-title">
            <div className="detail-hero">
              <div className="row">
                <StatusBadge status={expense.status} />
                {expense.selfApproved ? <SelfApprovedBadge /> : null}
              </div>
              <h2 id="expense-title">{expense.title}</h2>
              <p className="detail-amount">{formatMoney(expense.amount)}</p>
            </div>

            <dl className="details">
              <div><dt>Employee</dt><dd>{employee?.name ?? 'Unknown'}</dd></div>
              <div><dt>Entered by</dt><dd>{creator?.name ?? 'Unknown'}</dd></div>
              <div><dt>Reviewing manager</dt><dd>{manager?.name ?? 'Not submitted yet'}</dd></div>
              <div><dt>Project</dt><dd>{projectName(db, expense.projectId)}</dd></div>
              <div><dt>Category</dt><dd>{expense.category}</dd></div>
              <div><dt>Expense date</dt><dd>{formatDate(expense.date)}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(expense.createdAt)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDateTime(expense.updatedAt)}</dd></div>
            </dl>

            <div>
              <h3 className="small muted">Description</h3>
              <p>{expense.notes ? expense.notes : <span className="muted">No description.</span>}</p>
            </div>

            {expense.review ? (
              <div className={`callout ${expense.review.decision === 'rejected' ? 'callout-danger' : 'callout-info'}`}>
                <Icon name={expense.review.decision === 'rejected' ? 'x' : 'check'} />
                <div>
                  <strong>
                    {expense.review.decision === 'rejected' ? 'Rejected' : 'Approved'} by {reviewer?.name ?? 'manager'} · {formatDateTime(expense.review.at)}
                  </strong>
                  {expense.review.comment ? expense.review.comment : <span className="muted">No comment.</span>}
                </div>
              </div>
            ) : null}

            <div className="row-actions">
              {actions.length ? actions : (
                <p className="muted small">
                  <Icon name="shield" size={14} />{' '}
                  {[STATUS.DRAFT, STATUS.REJECTED].includes(expense.status)
                    ? 'View only.'
                    : 'View only — submitted and approved records are locked to preserve financial history.'}
                </p>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="history-title">
            <div className="card-header">
              <h2 id="history-title">History</h2>
              <span className="muted xsmall">Newest first · never rewritten</span>
            </div>
            <Timeline expense={expense} db={db} />
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="receipt-title">
            <div className="card-header"><h2 id="receipt-title">Receipt</h2></div>
            {receiptSrc ? (
              <>
                <button className="receipt-button" type="button" onClick={openReceipt} aria-label={`Open receipt ${expense.receipt.fileName} full size`}>
                  <img
                    className="receipt-thumb" src={receiptSrc} alt={`Receipt for ${expense.title}`}
                    style={{ width: '100%', height: 'auto', maxHeight: 320, objectFit: 'contain' }}
                  />
                </button>
                <p className="muted xsmall" style={{ marginTop: 8 }}>{expense.receipt.fileName} · {formatBytes(expense.receipt.sizeBytes)}</p>
              </>
            ) : <EmptyState message="No receipt attached." icon="image" />}
          </section>

          <section className="card" aria-labelledby="reimbursement-title">
            <div className="card-header"><h2 id="reimbursement-title">Reimbursement</h2></div>
            {record ? (
              <dl className="details" style={{ gridTemplateColumns: '1fr' }}>
                <div>
                  <dt>Status</dt>
                  <dd><StatusBadge status={record.status === 'reimbursed' ? STATUS.REIMBURSED : STATUS.REIMBURSEMENT_PENDING} /></dd>
                </div>
                <div><dt>Amount</dt><dd className="num">{formatMoney(record.amount)}</dd></div>
                <div><dt>Approved by</dt><dd>{findUser(db, record.managerId)?.name ?? '—'} · {formatDateTime(record.createdAt)}</dd></div>
                {record.reimbursedAt ? (
                  <div><dt>Reimbursed by</dt><dd>{findUser(db, record.reimbursedById)?.name ?? '—'} · {formatDateTime(record.reimbursedAt)}</dd></div>
                ) : null}
                {record.reference ? <div><dt>Reference</dt><dd>{record.reference}</dd></div> : null}
              </dl>
            ) : <p className="muted small">A reimbursement record is created when the expense is approved.</p>}
          </section>

          {limit ? (
            <section className="card" aria-labelledby="limit-title">
              <div className="card-header">
                <h2 id="limit-title">{employee.name}’s limit</h2>
                <LimitBadge level={limit.level} />
              </div>
              <LimitMeter status={limit} label={formatMonth(limit.month)} />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
