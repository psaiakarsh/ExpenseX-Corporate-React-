// NotificationContext — the signed-in user's in-app notifications (notifications.js).
// Derived from the company data on every change (no separate copy); marking read goes through the
// domain functions, which only ever touch the reader's own notifications.
import { createContext, useCallback, useContext, useMemo } from 'react';
import { markAllNotificationsRead, markNotificationRead, notificationsFor, unreadCount } from '../domain/notifications.js';
import { useAuth } from './AuthContext.jsx';
import { useCompany } from './CompanyContext.jsx';

const NotificationContext = createContext(null);

const EMPTY = { notifications: [], unread: 0 };

export function NotificationProvider({ children }) {
  const { db, refresh } = useCompany();
  const { user } = useAuth();

  const data = useMemo(
    () => (user ? { notifications: notificationsFor(user, db), unread: unreadCount(user, db) } : EMPTY),
    [user, db],
  );

  const markRead = useCallback((notificationId) => {
    const result = markNotificationRead(user, notificationId);
    refresh();
    return result;
  }, [user, refresh]);

  const markAllRead = useCallback(() => {
    const result = markAllNotificationsRead(user);
    refresh();
    return result;
  }, [user, refresh]);

  const value = useMemo(() => ({ ...data, markRead, markAllRead }), [data, markRead, markAllRead]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications() must be used inside <NotificationProvider>.');
  return context;
}
