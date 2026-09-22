// expense-query.js — pure list helpers shared by the expense pages: filtering, sorting and the
// choices offered in filter menus. (The HTML-rendering half of V1's expense-view.js became React
// components; these functions return plain data.)

import { CATEGORIES, STATUS_LABELS, STATUS_ORDER } from './constants.js';
import { formatMonth, monthKey } from './dates.js';
import { findUser } from './permissions.js';
import { projectName } from './projects.js';

// When the claim was last sent for approval (submitted or resubmitted), from its history.
export function lastSubmittedAt(expense) {
  const entry = [...expense.history].reverse().find((h) => h.action === 'submitted' || h.action === 'resubmitted');
  return entry?.at ?? null;
}

export const SORTS = {
  newest: (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  highest: (a, b) => b.amount - a.amount,
  lowest: (a, b) => a.amount - b.amount,
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
};

// filters: { search, status, category, projectId, employeeId, month, sort } — empty values mean "all".
export function filterExpenses(expenses, db, filters = {}) {
  const search = String(filters.search ?? '').trim().toLowerCase();
  return expenses
    .filter((e) => !filters.status || e.status === filters.status)
    .filter((e) => !filters.category || e.category === filters.category)
    .filter((e) => !filters.projectId || (e.projectId ?? 'none') === filters.projectId)
    .filter((e) => !filters.employeeId || e.employeeId === filters.employeeId)
    .filter((e) => !filters.month || monthKey(e.date) === filters.month)
    .filter((e) => {
      if (!search) return true;
      const haystack = [e.title, e.notes, e.category, projectName(db, e.projectId), findUser(db, e.employeeId)?.name]
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    })
    .sort(SORTS[filters.sort] ?? SORTS.newest);
}

export function statusOptions() {
  return [{ value: '', label: 'All statuses' }, ...STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] }))];
}

export function categoryOptions(allLabel = 'All categories') {
  return [{ value: '', label: allLabel }, ...CATEGORIES.map((category) => ({ value: category, label: category }))];
}

export function monthOptions(expenses) {
  const keys = [...new Set(expenses.map((e) => monthKey(e.date)))].sort().reverse();
  return [{ value: '', label: 'All months' }, ...keys.map((key) => ({ value: key, label: formatMonth(key) }))];
}
