// navigation.js — the V1 navigation per role (layout.js NAV_ITEMS / MOBILE_PRIMARY), with React routes.

export const NAV_ITEMS = {
  user: [
    { key: 'dashboard', label: 'Dashboard', path: '/employee/dashboard', icon: 'dashboard' },
    { key: 'expenses', label: 'My Expenses', path: '/employee/expenses', icon: 'receipt' },
    { key: 'new', label: 'New Expense', path: '/expenses/new', icon: 'plus' },
    { key: 'notifications', label: 'Notifications', path: '/notifications', icon: 'bell' },
    { key: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
  ],
  manager: [
    { key: 'dashboard', label: 'Dashboard', path: '/manager/dashboard', icon: 'dashboard' },
    { key: 'approvals', label: 'Approvals', path: '/manager/approvals', icon: 'inbox' },
    { key: 'expenses', label: 'Team Expenses', path: '/manager/expenses', icon: 'receipt' },
    { key: 'reimbursements', label: 'Reimbursements', path: '/manager/reimbursements', icon: 'banknote' },
    { key: 'team', label: 'Team', path: '/manager/team', icon: 'users' },
    { key: 'projects', label: 'Projects', path: '/manager/projects', icon: 'folder' },
    { key: 'analytics', label: 'Analytics', path: '/manager/analytics', icon: 'chart' },
    { key: 'notifications', label: 'Notifications', path: '/notifications', icon: 'bell' },
    { key: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
  ],
  admin: [
    { key: 'dashboard', label: 'Dashboard', path: '/admin/dashboard', icon: 'dashboard' },
    { key: 'users', label: 'Users', path: '/admin/users', icon: 'users' },
    { key: 'activity', label: 'Activity', path: '/admin/activity', icon: 'activity' },
    { key: 'settings', label: 'Settings', path: '/admin/settings', icon: 'settings' },
    { key: 'notifications', label: 'Notifications', path: '/notifications', icon: 'bell' },
    { key: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
  ],
};

// The first four items of each role go in the bottom bar; the rest live in the "More" sheet.
export const MOBILE_PRIMARY = {
  user: ['dashboard', 'expenses', 'new', 'notifications'],
  manager: ['dashboard', 'approvals', 'expenses', 'reimbursements'],
  admin: ['dashboard', 'users', 'activity', 'settings'],
};
