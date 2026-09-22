// notifications.jsx — labels, icons and the dashboard preview for in-app notifications
// (V1 pages/notifications.js + ui.js notificationPreview). Callers pass the reader's own notifications.
import { formatRelative } from '../domain/dates.js';
import { EmptyState, Icon } from './ui.jsx';

export const NOTIFICATION_ICONS = {
  expense_submitted: 'inbox',
  expense_resubmitted: 'refresh',
  expense_approved: 'check',
  expense_rejected: 'x',
  expense_reimbursed: 'banknote',
  expense_created_for_you: 'receipt',
  pending_digest: 'clock',
  limit_warning: 'alert',
  limit_exceeded: 'alert',
  limit_set: 'settings',
  signup_pending_assignment: 'users',
  manager_assigned: 'users',
  team_joined: 'users',
  team_left: 'users',
  welcome: 'info',
};

export const NOTIFICATION_TYPE_LABELS = {
  expense_submitted: 'Approval request',
  expense_resubmitted: 'Approval request',
  expense_approved: 'Approved',
  expense_rejected: 'Rejected',
  expense_reimbursed: 'Reimbursed',
  expense_created_for_you: 'Expense added',
  pending_digest: 'Pending approvals',
  limit_warning: 'Spending limit',
  limit_exceeded: 'Spending limit',
  limit_set: 'Spending limit',
  signup_pending_assignment: 'Account',
  manager_assigned: 'Team',
  team_joined: 'Team',
  team_left: 'Team',
  welcome: 'Account',
};

export function NotificationPreview({ notifications, count = 5 }) {
  const items = notifications.slice(0, count);
  if (items.length === 0) return <EmptyState message="No notifications yet." icon="bell" />;
  return (
    <ul className="list">
      {items.map((notification) => (
        <li className="list-row compact" key={notification.id}>
          <span className={notification.read ? '' : 'unread-dot'} aria-hidden="true" />
          <div className="list-row-main">
            <span className="small">
              <strong>{notification.title}</strong>
              {notification.read ? null : <span className="sr-only"> (unread)</span>}
            </span>
            <span className="muted xsmall">{notification.message}</span>
            <span className="muted xsmall">{formatRelative(notification.createdAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
