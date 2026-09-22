// analytics.js — pure summaries calculated from STORED expenses (nothing is hard-coded).
// Callers pass an already-scoped list (visibleExpenses(user, db)), so a manager's numbers only
// ever include their team and an employee's only their own claims.
// Amounts are paise. "Spending" = Pending + Approved + Reimbursement Pending + Reimbursed.

import { APPROVED_STATUSES, MIN_TEAM_SIZE_FOR_BREAKDOWN, ROLES, SPENDING_STATUSES, STATUS, STATUS_LABELS, STATUS_ORDER } from './constants.js';
import { formatMonth, lastMonthKeys, monthKey } from './dates.js';
import { sumAmounts } from './money.js';
import { can, findUser, isActiveUser, teamMembers } from './permissions.js';
import { projectName } from './projects.js';

export function onlySpending(expenses) {
  return expenses.filter((e) => SPENDING_STATUSES.includes(e.status));
}

export function totalOf(expenses) {
  return { count: expenses.length, amount: sumAmounts(expenses) };
}

export function withStatus(expenses, statuses) {
  return totalOf(expenses.filter((e) => statuses.includes(e.status)));
}

export function summarizeExpenses(expenses) {
  return {
    claimed: totalOf(onlySpending(expenses)),
    pending: withStatus(expenses, [STATUS.PENDING]),
    approved: withStatus(expenses, APPROVED_STATUSES), // everything a manager has approved
    reimbursementPending: withStatus(expenses, [STATUS.REIMBURSEMENT_PENDING]),
    reimbursed: withStatus(expenses, [STATUS.REIMBURSED]),
    rejected: withStatus(expenses, [STATUS.REJECTED]),
    drafts: withStatus(expenses, [STATUS.DRAFT]),
  };
}

// Groups spending by key → [{ key, label, amount, count }], largest first.
export function groupSpending(expenses, keyOf, labelOf) {
  const groups = new Map();
  onlySpending(expenses).forEach((expense) => {
    const key = keyOf(expense);
    const row = groups.get(key) ?? { key, label: labelOf(key), amount: 0, count: 0 };
    row.amount += expense.amount;
    row.count += 1;
    groups.set(key, row);
  });
  return [...groups.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

export function spendingByCategory(expenses) {
  return groupSpending(expenses, (e) => e.category, (category) => category);
}

export function spendingByEmployee(expenses, db) {
  return groupSpending(expenses, (e) => e.employeeId, (id) => findUser(db, id)?.name ?? 'Unknown');
}

export function spendingByProject(expenses, db) {
  return groupSpending(expenses, (e) => e.projectId ?? 'none', (id) => projectName(db, id === 'none' ? null : id));
}

// One row per month key (months with no spending show 0, so the timeline has no gaps).
export function spendingByMonth(expenses, monthKeys) {
  const spending = onlySpending(expenses);
  return monthKeys.map((key) => {
    const inMonth = spending.filter((e) => monthKey(e.date) === key);
    return { key, label: formatMonth(key), amount: sumAmounts(inMonth), count: inMonth.length };
  });
}

// Every status, in workflow order, with count and amount (drafts and rejected included).
export function breakdownByStatus(expenses) {
  return STATUS_ORDER.map((status) => {
    const matching = expenses.filter((e) => e.status === status);
    return { status, label: STATUS_LABELS[status], count: matching.length, amount: sumAmounts(matching) };
  });
}

// Share of decided claims that were approved (null when nothing has been decided yet).
export function approvalRate(expenses) {
  const approved = expenses.filter((e) => APPROVED_STATUSES.includes(e.status)).length;
  const rejected = expenses.filter((e) => e.status === STATUS.REJECTED).length;
  return approved + rejected === 0 ? null : Math.round((approved * 100) / (approved + rejected));
}

// Reimbursement records (already scoped by the caller) → totals and the average days from approval
// (record created) to payout. averageDays is null until something has been reimbursed.
export function reimbursementStats(records) {
  const pending = records.filter((r) => r.status === 'pending');
  const paid = records.filter((r) => r.status === 'reimbursed');
  const days = paid.map((r) => (new Date(r.reimbursedAt) - new Date(r.createdAt)) / 86_400_000);
  return {
    pending: totalOf(pending),
    reimbursed: totalOf(paid),
    averageDays: days.length ? Math.round((days.reduce((sum, d) => sum + d, 0) / days.length) * 10) / 10 : null,
  };
}

export function filterByMonths(expenses, monthKeys) {
  const keys = new Set(monthKeys);
  return expenses.filter((e) => keys.has(monthKey(e.date)));
}

// ---------- Admin: aggregates only ----------
// Returns NUMBERS, never expense records, so the Admin dashboard cannot show anyone's private claims.
// Team totals are hidden for teams smaller than MIN_TEAM_SIZE_FOR_BREAKDOWN.
// The team a claim belongs to today: a manager's own claim → that manager; an employee's → their
// current manager (the same rule as manager visibility). null for unassigned people.
export function currentTeamOf(db, expense) {
  const owner = findUser(db, expense.employeeId);
  if (!owner) return null;
  return owner.role === ROLES.MANAGER ? owner.id : owner.managerId;
}

// Privacy-safe team totals for the Admin.
//  1. A team's total is shown only if it has at least MIN_TEAM_SIZE_FOR_BREAKDOWN employees
//     (active + inactive members, since both contribute to the total).
//  2. Complementary suppression: whatever is NOT shown can be worked out as
//     "company total − shown teams", so that remainder must be empty or include spending from at
//     least MIN EMPLOYEES (a manager's own claims don't count towards the minimum). Otherwise the
//     smallest shown team is hidden too, until the remainder is safe.
export function privacySafeTeams(db, spending) {
  const candidates = db.users
    .filter((u) => u.role === ROLES.MANAGER && isActiveUser(u))
    .map((manager) => {
      const claims = spending.filter((e) => currentTeamOf(db, e) === manager.id);
      return {
        key: manager.id,
        label: manager.department ? `${manager.department} · ${manager.name}` : manager.name,
        employees: teamMembers(manager, db, { includeInactive: true }).length,
        amount: sumAmounts(claims),
        count: claims.length,
      };
    });

  const shown = candidates.filter((team) => team.employees >= MIN_TEAM_SIZE_FOR_BREAKDOWN);
  const protectedTeams = candidates
    .filter((team) => team.employees < MIN_TEAM_SIZE_FOR_BREAKDOWN)
    .map((team) => ({ key: team.key, label: team.label, employees: team.employees, reason: 'small' }));

  for (;;) {
    const shownIds = new Set(shown.map((team) => team.key));
    const spenders = new Set(spending.filter((e) => !shownIds.has(currentTeamOf(db, e))).map((e) => e.employeeId));
    const employeeSpenders = [...spenders].filter((id) => findUser(db, id)?.role === ROLES.EMPLOYEE).length;
    const safe = spenders.size === 0 || employeeSpenders >= MIN_TEAM_SIZE_FOR_BREAKDOWN;
    if (safe || shown.length === 0) break;
    shown.sort((a, b) => a.amount - b.amount);
    const hidden = shown.shift();
    protectedTeams.push({ key: hidden.key, label: hidden.label, employees: hidden.employees, reason: 'complement' });
  }

  return { shown: shown.sort((a, b) => b.amount - a.amount), protectedTeams };
}

export function companyAggregates(actor, db, monthKeys = lastMonthKeys(6)) {
  if (!can(actor, 'admin.aggregates', null, db)) return null;

  const managers = db.users.filter((u) => u.role === ROLES.MANAGER);
  const employees = db.users.filter((u) => u.role === ROLES.EMPLOYEE);
  const expenses = db.expenses;
  const { shown, protectedTeams } = privacySafeTeams(db, onlySpending(expenses));

  return {
    users: {
      managers: managers.filter(isActiveUser).length,
      employees: employees.filter(isActiveUser).length,
      active: db.users.filter(isActiveUser).length,
      unassigned: employees.filter((u) => isActiveUser(u) && !u.managerId).length,
      inactive: db.users.filter((u) => !isActiveUser(u)).length,
    },
    projects: db.projects.filter((p) => p.status === 'active').length,
    summary: summarizeExpenses(expenses),
    submittedCount: expenses.filter((e) => e.status !== STATUS.DRAFT).length,
    approvalRate: approvalRate(expenses),
    byStatus: breakdownByStatus(expenses).filter((row) => row.status !== STATUS.DRAFT), // drafts are private
    byCategory: spendingByCategory(expenses).map(({ key, label, amount, count }) => ({ key, label, amount, count })),
    byMonth: spendingByMonth(expenses, monthKeys),
    teams: shown, // [{ key, label, employees, amount, count }]
    protectedTeams, // [{ key, label, employees, reason: 'small' | 'complement' }] — no amounts
  };
}
