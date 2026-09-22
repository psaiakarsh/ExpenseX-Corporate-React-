// NotificationsPage — V1 shared/notifications.html + pages/notifications.js.
// The reader's OWN notifications only (NotificationContext → notificationsFor), and marking read goes
// through the domain, which refuses another user's notification.
import { useState } from 'react';
import { Link } from 'react-router';
import { ROLES } from '../../domain/constants.js';
import { formatDateTime, formatRelative } from '../../domain/dates.js';
import { findExpense } from '../../domain/expenses.js';
import { canViewExpense } from '../../domain/permissions.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useNotifications } from '../../app/NotificationContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { expensePath } from '../../app/routes.jsx';
import { NOTIFICATION_ICONS, NOTIFICATION_TYPE_LABELS } from '../../components/notifications.jsx';
import { EmptyState, Icon, PageHeader } from '../../components/ui.jsx';

// Where a notification leads. An expense link appears only if the reader may view that expense.
function notificationLink(notification, user, db) {
  if (notification.expenseId) {
    return canViewExpense(user, findExpense(db, notification.expenseId), db)
      ? { to: expensePath(notification.expenseId), label: 'View expense' }
      : null;
  }
  const byRole = {
    [ROLES.MANAGER]: {
      pending_digest: { to: '/manager/approvals', label: 'Open approvals' },
      limit_warning: { to: '/manager/team', label: 'View team' },
      limit_exceeded: { to: '/manager/team', label: 'View team' },
      team_joined: { to: '/manager/team', label: 'View team' },
    },
    [ROLES.ADMIN]: {
      signup_pending_assignment: { to: '/admin/users?manager=unassigned', label: 'Assign manager' },
    },
    [ROLES.EMPLOYEE]: {
      limit_warning: { to: '/employee/dashboard', label: 'View limit' },
      limit_exceeded: { to: '/employee/dashboard', label: 'View limit' },
      limit_set: { to: '/employee/dashboard', label: 'View limit' },
    },
  };
  return byRole[user.role]?.[notification.type] ?? null;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const { db } = useCompany();
  const { notifications, unread, markRead, markAllRead } = useNotifications();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const shown = unreadOnly ? notifications.filter((notification) => !notification.read) : notifications;

  const markAll = () => {
    const result = markAllRead();
    if (result.ok) toast(`${result.changed} notification${result.changed === 1 ? '' : 's'} marked as read.`);
  };

  return (
    <>
      <PageHeader title="Notifications" description={<>{notifications.length} notification{notifications.length === 1 ? '' : 's'} · {unread} unread</>} actions={<button className="btn btn-secondary" type="button" disabled={unread === 0} onClick={markAll}>
          <Icon name="check" size={18} /> Mark all as read
        </button>} />

      <div className="tabs" role="group" aria-label="Show">
        <button className="tab" type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</button>
        <button className="tab" type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</button>
      </div>

      <ul className="list">
        {shown.length === 0 ? (
          <li><EmptyState icon="bell" message={unreadOnly ? 'You’re all caught up.' : 'No notifications yet.'} /></li>
        ) : shown.map((notification) => {
          const link = notificationLink(notification, user, db);
          return (
            <li className={`notification ${notification.read ? '' : 'unread'}`} key={notification.id}>
              <span className="row-icon" aria-hidden="true"><Icon name={NOTIFICATION_ICONS[notification.type] ?? 'bell'} size={18} /></span>
              <div className="list-row-main">
                <span className="notification-title">
                  {notification.title}
                  {notification.read ? null : <span className="sr-only"> (unread)</span>}
                </span>
                <span className="notification-message">{notification.message}</span>
                <span className="muted xsmall">
                  {NOTIFICATION_TYPE_LABELS[notification.type] ?? 'General'} ·{' '}
                  <time dateTime={notification.createdAt} title={formatDateTime(notification.createdAt)}>
                    {formatRelative(notification.createdAt)}
                  </time>
                  {notification.read ? null : <> · <strong className="text-accent">Unread</strong></>}
                </span>
              </div>
              <div className="row-actions">
                {link ? (
                  <Link className="btn btn-ghost btn-sm" to={link.to} onClick={() => markRead(notification.id)}>{link.label}</Link>
                ) : null}
                {notification.read ? null : (
                  <button
                    className="btn btn-ghost btn-sm" type="button"
                    aria-label={`Mark “${notification.title}” as read`}
                    onClick={() => markRead(notification.id)}
                  >
                    <Icon name="check" size={16} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
