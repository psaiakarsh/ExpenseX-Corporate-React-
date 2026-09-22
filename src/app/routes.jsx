// routes.jsx — one table for every signed-in page: path, allowed roles, nav key and title.
// App.jsx builds the router from it, RoleRoute enforces `roles` from it, AppLayout reads `nav`/`title`.
// V1 URLs map as: employee/*.html → /employee/*, manager/*.html → /manager/*, admin/*.html → /admin/*,
// shared/expense-form.html → /expenses/new and /expenses/:id/edit, shared/expense.html?id= → /expenses/:id.
import { matchPath } from 'react-router';
import { ROLES } from '../domain/constants.js';
import { EmployeeDashboard } from '../pages/employee/EmployeeDashboard.jsx';
import { EmployeeExpenses } from '../pages/employee/EmployeeExpenses.jsx';
import { ExpenseFormPage } from '../pages/shared/ExpenseFormPage.jsx';
import { ExpenseDetailPage } from '../pages/shared/ExpenseDetailPage.jsx';
import { NotificationsPage } from '../pages/shared/NotificationsPage.jsx';
import { ProfilePage } from '../pages/shared/ProfilePage.jsx';
import { ManagerDashboard } from '../pages/manager/ManagerDashboard.jsx';
import { ManagerApprovals } from '../pages/manager/ManagerApprovals.jsx';
import { ManagerTeamExpenses } from '../pages/manager/ManagerTeamExpenses.jsx';
import { ManagerReimbursements } from '../pages/manager/ManagerReimbursements.jsx';
import { ManagerTeam } from '../pages/manager/ManagerTeam.jsx';
import { ManagerProjects } from '../pages/manager/ManagerProjects.jsx';
import { ManagerAnalytics } from '../pages/manager/ManagerAnalytics.jsx';
import { AdminDashboard } from '../pages/admin/AdminDashboard.jsx';
import { AdminUsers } from '../pages/admin/AdminUsers.jsx';
import { AdminActivity } from '../pages/admin/AdminActivity.jsx';
import { AdminSettings } from '../pages/admin/AdminSettings.jsx';

const { ADMIN, MANAGER, EMPLOYEE } = ROLES;
const ALL = [ADMIN, MANAGER, EMPLOYEE];

export const HOME = { [ADMIN]: '/admin/dashboard', [MANAGER]: '/manager/dashboard', [EMPLOYEE]: '/employee/dashboard' };

export function homeFor(role) {
  return HOME[role] ?? '/login';
}

export const APP_ROUTES = [
  { path: '/employee/dashboard', roles: [EMPLOYEE], nav: 'dashboard', title: 'Dashboard', element: <EmployeeDashboard /> },
  { path: '/employee/expenses', roles: [EMPLOYEE], nav: 'expenses', title: 'My Expenses', element: <EmployeeExpenses /> },

  { path: '/manager/dashboard', roles: [MANAGER], nav: 'dashboard', title: 'Dashboard', element: <ManagerDashboard /> },
  { path: '/manager/approvals', roles: [MANAGER], nav: 'approvals', title: 'Approvals', element: <ManagerApprovals /> },
  { path: '/manager/expenses', roles: [MANAGER], nav: 'expenses', title: 'Team Expenses', element: <ManagerTeamExpenses /> },
  { path: '/manager/reimbursements', roles: [MANAGER], nav: 'reimbursements', title: 'Reimbursements', element: <ManagerReimbursements /> },
  { path: '/manager/team', roles: [MANAGER], nav: 'team', title: 'Team', element: <ManagerTeam /> },
  { path: '/manager/projects', roles: [MANAGER], nav: 'projects', title: 'Projects', element: <ManagerProjects /> },
  { path: '/manager/analytics', roles: [MANAGER], nav: 'analytics', title: 'Analytics', element: <ManagerAnalytics /> },

  { path: '/admin/dashboard', roles: [ADMIN], nav: 'dashboard', title: 'Dashboard', element: <AdminDashboard /> },
  { path: '/admin/users', roles: [ADMIN], nav: 'users', title: 'Users', element: <AdminUsers /> },
  { path: '/admin/activity', roles: [ADMIN], nav: 'activity', title: 'Activity', element: <AdminActivity /> },
  { path: '/admin/settings', roles: [ADMIN], nav: 'settings', title: 'Settings', element: <AdminSettings /> },

  // Shared pages. The Admin is excluded from every expense page (admin privacy).
  { path: '/expenses/new', roles: [EMPLOYEE, MANAGER], nav: 'new', title: 'New expense', element: <ExpenseFormPage /> },
  { path: '/expenses/:id/edit', roles: [EMPLOYEE, MANAGER], nav: '', title: 'Edit expense', element: <ExpenseFormPage /> },
  { path: '/expenses/:id', roles: [EMPLOYEE, MANAGER], nav: '', title: 'Expense', element: <ExpenseDetailPage /> },
  { path: '/notifications', roles: ALL, nav: 'notifications', title: 'Notifications', element: <NotificationsPage /> },
  { path: '/profile', roles: ALL, nav: 'profile', title: 'Profile', element: <ProfilePage /> },
];

// The table entry for a URL path, or null.
export function findRoute(pathname) {
  return APP_ROUTES.find((route) => matchPath({ path: route.path, end: true }, pathname)) ?? null;
}

export const expensePath = (id) => `/expenses/${encodeURIComponent(id)}`;
export const expenseEditPath = (id) => `/expenses/${encodeURIComponent(id)}/edit`;
