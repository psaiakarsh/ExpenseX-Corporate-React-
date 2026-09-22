// notifications.js — in-app alerts, created INSIDE the action that caused them
// (submitExpense, approveExpense, …) so they always match what really happened.
//
// Notification { id, recipientId, type, title, message, expenseId, key, read, createdAt }
// `key` (optional) prevents duplicates, e.g. one "limit exceeded" alert per employee per month.

import { ROLES, STATUS } from './constants.js';
import { formatMoney, sumAmounts } from './money.js';
import { isActiveUser } from './permissions.js';
import { commit, createId, loadDb, nowIso } from './storage.js';

export const MAX_NOTIFICATIONS_PER_USER = 200;

// Adds a notification to db.notifications (the caller commits). Skips duplicates with the same key.
export function notify(db, recipientId, { type, title, message, expenseId = null, key = null }) {
  if (!recipientId) return;
  if (key && db.notifications.some((n) => n.recipientId === recipientId && n.key === key)) return;

  db.notifications.unshift({
    id: createId('ntf'),
    recipientId,
    type,
    title,
    message,
    expenseId,
    key,
    read: false,
    createdAt: nowIso(),
  });

  // Keep only the newest notifications for this recipient so storage cannot grow without limit.
  const mine = db.notifications.filter((n) => n.recipientId === recipientId);
  if (mine.length > MAX_NOTIFICATIONS_PER_USER) {
    const drop = new Set(mine.slice(MAX_NOTIFICATIONS_PER_USER).map((n) => n.id));
    db.notifications = db.notifications.filter((n) => !drop.has(n.id));
  }
}

export function notifyAdmins(db, payload) {
  db.users
    .filter((user) => user.role === ROLES.ADMIN && isActiveUser(user))
    .forEach((admin) => notify(db, admin.id, payload));
}

export function notificationsFor(user, db) {
  return db.notifications
    .filter((n) => n.recipientId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function unreadCount(user, db) {
  return db.notifications.filter((n) => n.recipientId === user.id && !n.read).length;
}

export function markNotificationRead(user, notificationId) {
  const db = loadDb();
  const notification = db.notifications.find((n) => n.id === notificationId);
  if (!notification || notification.recipientId !== user.id) return { ok: false, error: 'Notification not found.' };
  if (!notification.read) {
    notification.read = true;
    commit(db, ['notifications']);
  }
  return { ok: true };
}

export function markAllNotificationsRead(user) {
  const db = loadDb();
  let changed = 0;
  db.notifications.forEach((n) => {
    if (n.recipientId === user.id && !n.read) {
      n.read = true;
      changed++;
    }
  });
  if (changed) commit(db, ['notifications']);
  return { ok: true, changed };
}

// "You have 3 expenses pending approval." Refreshed at manager login: the previous unread digest
// is replaced rather than stacked, so the count shown is always current.
export function refreshPendingDigest(manager) {
  const db = loadDb();
  const pending = db.expenses.filter((e) => e.managerId === manager.id && e.status === STATUS.PENDING);
  db.notifications = db.notifications.filter(
    (n) => !(n.recipientId === manager.id && n.type === 'pending_digest' && !n.read),
  );
  if (pending.length > 0) {
    const total = formatMoney(sumAmounts(pending));
    notify(db, manager.id, {
      type: 'pending_digest',
      title: 'Approvals waiting',
      message: `You have ${pending.length} expense${pending.length === 1 ? '' : 's'} pending approval (${total}).`,
    });
  }
  commit(db, ['notifications']);
}
