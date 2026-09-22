// expense.jsx — shared expense pieces (V1 expense-view.js rendering half): list rows and the history
// timeline. Access is never decided here: callers pass records they already obtained from the
// visible…() scopes, and action buttons are rendered only where can() allows them.
import { Link } from 'react-router';
import { STATUS } from '../domain/constants.js';
import { formatDate, formatDateTime, formatRelative } from '../domain/dates.js';
import { formatMoney } from '../domain/money.js';
import { findUser } from '../domain/permissions.js';
import { projectName } from '../domain/projects.js';
import { lastSubmittedAt } from '../domain/expense-query.js';
import { expensePath } from '../app/routes.jsx';
import { SelfApprovedBadge, StatusBadge } from './badges.jsx';
import { EmptyState, Icon } from './ui.jsx';

// One expense as a list row. `actions` and `flag` are extra nodes shown on the right.
export function ExpenseRow({ expense, db, showEmployee = false, showUpdated = false, showSubmitted = false, actions = null, flag = null }) {
  const employee = findUser(db, expense.employeeId);
  const submitted = showSubmitted ? lastSubmittedAt(expense) : null;
  const meta = [
    formatDate(expense.date),
    expense.category,
    projectName(db, expense.projectId),
    showEmployee ? employee?.name ?? 'Unknown' : '',
    expense.receipt ? 'Receipt attached' : 'No receipt',
    submitted ? `Submitted ${formatRelative(submitted)}` : '',
    showUpdated ? `Updated ${formatRelative(expense.updatedAt)}` : '',
  ].filter(Boolean);

  return (
    <li className="list-row">
      <span className="row-icon" aria-hidden="true"><Icon name={expense.receipt ? 'image' : 'receipt'} /></span>
      <div className="list-row-main">
        <Link className="list-row-title truncate" to={expensePath(expense.id)}>{expense.title}</Link>
        <div className="list-row-meta">{meta.map((part) => <span key={part}>{part}</span>)}</div>
      </div>
      <div className="list-row-side">
        <span className="list-row-amount">{formatMoney(expense.amount)}</span>
        <StatusBadge status={expense.status} />
        {expense.selfApproved ? <SelfApprovedBadge /> : null}
        {flag}
        {actions}
      </div>
      {expense.status === STATUS.REJECTED && expense.review?.comment ? (
        <p className="row-note"><strong>Manager comment:</strong> {expense.review.comment}</p>
      ) : null}
    </li>
  );
}

export function ExpenseList({ expenses, db, emptyMessage = 'No expenses yet.', rowActions, ...options }) {
  if (expenses.length === 0) return <EmptyState message={emptyMessage} icon="receipt" />;
  return (
    <ul className="list">
      {expenses.map((expense) => (
        <ExpenseRow key={expense.id} expense={expense} db={db} actions={rowActions?.(expense)} {...options} />
      ))}
    </ul>
  );
}

// Recent workflow events across many expenses — a derived feed for the manager dashboard.
export function RecentEvents({ expenses, db, count = 8 }) {
  const events = expenses
    .flatMap((expense) => expense.history.map((entry) => ({ entry, expense })))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at))
    .slice(0, count);
  if (events.length === 0) return <EmptyState message="No activity yet." icon="activity" />;
  return (
    <ul className="list">
      {events.map(({ entry, expense }, index) => {
        const text = HISTORY_TEXT[entry.action] ?? { label: entry.action, icon: 'info' };
        const by = findUser(db, entry.byId)?.name ?? 'System';
        return (
          <li className="list-row compact" key={`${expense.id}-${entry.at}-${index}`}>
            <span className={`timeline-dot tone-${entry.toStatus ?? ''}`} aria-hidden="true"><Icon name={text.icon} size={14} /></span>
            <div className="list-row-main">
              <Link className="list-row-title small truncate" to={expensePath(expense.id)}>{expense.title}</Link>
              <span className="muted xsmall">{text.label} · {by} · {formatRelative(entry.at)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const HISTORY_TEXT = {
  created: { label: 'Draft created', icon: 'edit' },
  submitted: { label: 'Submitted for approval', icon: 'send' },
  resubmitted: { label: 'Edited and resubmitted', icon: 'refresh' },
  approved: { label: 'Approved', icon: 'check' },
  created_approved: { label: 'Created by manager — approved', icon: 'check' },
  rejected: { label: 'Rejected', icon: 'x' },
  reimbursement_queued: { label: 'Reimbursement pending', icon: 'banknote' },
  reimbursed: { label: 'Reimbursed', icon: 'check' },
  reassigned: { label: 'Review moved to a new manager', icon: 'users' },
};

const FIELD_LABELS = { title: 'Title', amount: 'Amount', category: 'Category', date: 'Date', projectId: 'Project', notes: 'Notes', receipt: 'Receipt' };

function formatFieldValue(db, field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'amount') return formatMoney(value);
  if (field === 'date') return formatDate(value);
  if (field === 'projectId') return projectName(db, value);
  return String(value);
}

// The append-only history, newest first.
export function Timeline({ expense, db }) {
  return (
    <ol className="timeline">
      {[...expense.history].reverse().map((entry, index) => {
        const text = HISTORY_TEXT[entry.action] ?? { label: entry.action, icon: 'info' };
        const by = findUser(db, entry.byId)?.name ?? 'System';
        const changes = entry.changes ?? [];
        return (
          <li key={`${entry.at}-${index}`}>
            <span className={`timeline-dot tone-${entry.toStatus ?? ''}`} aria-hidden="true"><Icon name={text.icon} size={14} /></span>
            <div className="timeline-body">
              <strong>{text.label}{entry.action === 'created_approved' && expense.selfApproved ? ' (self-approved)' : ''}</strong>
              <span className="muted xsmall">{by} · <time dateTime={entry.at}>{formatDateTime(entry.at)}</time></span>
              {entry.comment ? <p className="timeline-comment">{entry.comment}</p> : null}
              {changes.length ? (
                <ul className="change-list" aria-label="Changes">
                  {changes.map((change) => (
                    <li key={change.field}>
                      {FIELD_LABELS[change.field] ?? change.field}: {formatFieldValue(db, change.field, change.from)} → {formatFieldValue(db, change.field, change.to)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
