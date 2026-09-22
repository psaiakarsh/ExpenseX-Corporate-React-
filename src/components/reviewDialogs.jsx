// reviewDialogs — the approve / reject / mark-reimbursed dialogs shared by the review screens
// (V1 expense-view.js). Each calls the domain function, which re-checks the permission and the rules.
import { ROLES } from '../domain/constants.js';
import { monthKey } from '../domain/dates.js';
import { formatMoney } from '../domain/money.js';
import { COMMENT_MAX, approveExpense, rejectExpense } from '../domain/expenses.js';
import { REFERENCE_MAX, markReimbursed } from '../domain/reimbursements.js';
import { limitStatus } from '../domain/limits.js';
import { findUser } from '../domain/permissions.js';
import { useCompany } from '../app/CompanyContext.jsx';
import { useDialogs } from '../app/DialogContext.jsx';
import { useToast } from '../app/ToastContext.jsx';
import { LimitBadge } from './badges.jsx';
import { Icon } from './ui.jsx';

function Summary({ expense, children }) {
  return (
    <>
      <p><strong>{expense.title}</strong> · {formatMoney(expense.amount)}</p>
      <p>{children}</p>
    </>
  );
}

export function useReviewDialogs() {
  const { openFormDialog } = useDialogs();
  const { refresh } = useCompany();
  const toast = useToast();

  const run = (action, successMessage) => (result) => {
    if (result.ok) toast(successMessage);
    refresh();
    return result;
  };

  const approve = (manager, expense) => openFormDialog({
    title: 'Approve expense',
    description: <Summary expense={expense}>Approving creates a reimbursement record and moves the claim to Reimbursement Pending.</Summary>,
    fields: [{ name: 'comment', label: 'Comment for the employee', type: 'textarea', maxLength: COMMENT_MAX }],
    submitLabel: 'Approve',
    onSubmit: ({ comment }) => run(null, 'Expense approved. Reimbursement is now pending.')(approveExpense(manager, expense.id, comment)),
  });

  const reject = (manager, expense) => openFormDialog({
    title: 'Reject expense',
    description: <Summary expense={expense}>The employee can edit and resubmit it.</Summary>,
    fields: [{
      name: 'comment',
      label: 'Reason',
      type: 'textarea',
      required: true,
      maxLength: COMMENT_MAX,
      hint: 'Tell the employee what to fix (at least 5 characters).',
    }],
    submitLabel: 'Reject',
    danger: true,
    onSubmit: ({ comment }) => run(null, 'Expense rejected. The employee has been notified.')(rejectExpense(manager, expense.id, comment)),
  });

  const reimburse = (manager, expense) => openFormDialog({
    title: 'Mark as reimbursed',
    description: <Summary expense={expense}>Confirm the amount has been paid out. The expense record itself is not changed.</Summary>,
    fields: [{ name: 'reference', label: 'Payment reference', maxLength: REFERENCE_MAX, placeholder: 'e.g. NEFT-123456' }],
    submitLabel: 'Mark reimbursed',
    onSubmit: ({ reference }) => run(null, 'Marked as reimbursed.')(markReimbursed(manager, expense.reimbursementId, reference)),
  });

  return { approve, reject, reimburse };
}

// Approve / Reject for a pending claim. After the decision the list is redrawn, so focus moves to the
// re-rendered button — or to the page content if the claim has left the list (V1 expense-view.js).
export function ReviewButtons({ manager, expense }) {
  const review = useReviewDialogs();

  const decide = async (kind) => {
    await review[kind](manager, expense);
    setTimeout(() => {
      const again = document.querySelector(`[data-review="${kind}"][data-id="${expense.id}"]`);
      (again ?? document.querySelector('#main'))?.focus();
    }, 0);
  };

  return (
    <>
      <button
        className="btn btn-primary btn-sm" type="button" data-review="approve" data-id={expense.id}
        aria-label={`Approve ${expense.title}`} onClick={() => decide('approve')}
      >
        <Icon name="check" size={16} /> Approve
      </button>
      <button
        className="btn btn-danger-ghost btn-sm" type="button" data-review="reject" data-id={expense.id}
        aria-label={`Reject ${expense.title}`} onClick={() => decide('reject')}
      >
        <Icon name="x" size={16} /> Reject
      </button>
    </>
  );
}

// "Mark reimbursed" for a reimbursement record the manager may pay.
export function ReimburseButton({ manager, expense, label = 'Mark reimbursed' }) {
  const review = useReviewDialogs();
  const pay = async () => {
    await review.reimburse(manager, expense);
    setTimeout(() => {
      const again = document.querySelector(`[data-review="reimburse"][data-id="${expense.id}"]`);
      (again ?? document.querySelector('#main'))?.focus();
    }, 0);
  };
  return (
    <button
      className="btn btn-secondary btn-sm" type="button" data-review="reimburse" data-id={expense.id}
      onClick={pay}
    >
      <Icon name="banknote" size={16} /> {label}<span className="sr-only"> {expense.title}</span>
    </button>
  );
}

// Flags a reviewer sees on a row: the employee's limit level for that claim's month, and "Resubmitted".
export function ReviewFlags({ expense, db }) {
  const employee = findUser(db, expense.employeeId);
  const level = employee?.role === ROLES.EMPLOYEE
    ? limitStatus(employee, db.expenses, db.settings, monthKey(expense.date)).level
    : 'none';
  const resubmitted = expense.history.some((entry) => entry.action === 'resubmitted');
  return (
    <>
      <LimitBadge level={level} />
      {resubmitted ? <span className="badge badge-muted"><Icon name="refresh" size={14} />Resubmitted</span> : null}
    </>
  );
}
