// limits.js — monthly spending limits (set by the manager, per employee).
// "Used" is always calculated from stored expenses: the employee's claims dated in that month
// with status Pending, Approved, Reimbursement Pending or Reimbursed. Drafts and rejected claims don't count.
// Limits WARN only; they never block a submission.

import { ROLES, SPENDING_STATUSES } from './constants.js';
import { currentMonthKey, formatMonth, monthKey } from './dates.js';
import { formatMoney } from './money.js';
import { notify } from './notifications.js';

export function monthlySpend(expenses, employeeId, month) {
  return expenses
    .filter((e) => e.employeeId === employeeId && SPENDING_STATUSES.includes(e.status) && monthKey(e.date) === month)
    .reduce((sum, e) => sum + e.amount, 0);
}

// level: 'none' (no limit) | 'ok' | 'warning' (≥ warning %) | 'exceeded' (≥ 100 %)
export function limitLevel(used, limit, warningPercent) {
  if (!limit) return 'none';
  if (used >= limit) return 'exceeded';
  if (used * 100 >= limit * warningPercent) return 'warning';
  return 'ok';
}

// extraAmount: an expense not yet counted (the one being filed), to preview its effect.
export function limitStatus(employee, expenses, settings, month = currentMonthKey(), extraAmount = 0) {
  const limit = employee?.monthlyLimit ?? null;
  const used = monthlySpend(expenses, employee?.id, month) + extraAmount;
  return {
    month,
    limit,
    used,
    remaining: limit === null ? null : limit - used,
    percent: limit ? Math.round((used * 100) / limit) : 0,
    level: limitLevel(used, limit, settings.limitWarningPercent),
  };
}

// Called inside submit/create actions: sends one warning and one exceeded alert per employee per month
// to the employee and their manager.
export function checkLimitAlerts(db, employee, month) {
  if (!employee || employee.role !== ROLES.EMPLOYEE) return;
  const status = limitStatus(employee, db.expenses, db.settings, month);
  if (status.level !== 'warning' && status.level !== 'exceeded') return;

  const exceeded = status.level === 'exceeded';
  const summary = `${formatMoney(status.used)} of ${formatMoney(status.limit)} used in ${formatMonth(month)}`;
  const type = exceeded ? 'limit_exceeded' : 'limit_warning';
  notify(db, employee.id, {
    type,
    title: exceeded ? 'Monthly limit exceeded' : 'Approaching monthly limit',
    message: `${summary}. You can still submit expenses; your manager will see the flag.`,
    key: `${type}:${month}`,
  });
  notify(db, employee.managerId, {
    type,
    title: exceeded ? 'Team member over limit' : 'Team member near limit',
    message: `${employee.name}: ${summary}.`,
    key: `${type}:${employee.id}:${month}`,
  });
}
