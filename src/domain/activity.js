// activity.js — the administrative activity log shown to Admin.
// It records account and system events, plus a privacy-safe line for each approval decision and
// reimbursement (who acted, approve/reject/reimbursed, expense ID, when). Expense titles, amounts and comments are NEVER
// written here — the full decision (with comment) lives in the expense's own `history`, visible
// only to the employee and their manager. So the Admin can audit activity without seeing spending.
//
// ActivityEntry { id, actorId, action, targetType, targetId, summary, createdAt }

import { createId, nowIso } from './storage.js';

export const MAX_ACTIVITY = 500;

export const ACTIVITY_LABELS = {
  company_setup: 'Company set up',
  employee_signed_up: 'Employee signed up',
  account_created: 'Account created',
  account_deactivated: 'Account deactivated',
  account_reactivated: 'Account reactivated',
  employee_assigned: 'Employee assigned',
  employee_reassigned: 'Employee reassigned',
  settings_updated: 'Settings updated',
  expense_approved: 'Expense approved',
  expense_rejected: 'Expense rejected',
  expense_reimbursed: 'Expense reimbursed',
  demo_loaded: 'Demo company loaded',
  demo_reset: 'Demo data reset',
};

export function logActivity(db, actorId, action, { targetType = null, targetId = null, summary }) {
  db.activity.unshift({ id: createId('act'), actorId, action, targetType, targetId, summary, createdAt: nowIso() });
  db.activity = db.activity.slice(0, MAX_ACTIVITY);
}
