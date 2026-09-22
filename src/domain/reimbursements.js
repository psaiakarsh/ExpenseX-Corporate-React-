// reimbursements.js — a reimbursement is its OWN record, created when an expense is approved.
// Paying it out marks the record "reimbursed" and moves the expense forward; the expense's
// amount, details and history are never rewritten or deleted.
//
// Reimbursement { id, expenseId, employeeId, managerId, amount, status: 'pending'|'reimbursed',
//                 createdAt, reimbursedAt, reimbursedById, reference }
//   managerId      = the manager who APPROVED it (history; never changed, even after a reassignment)
//   reimbursedById = the manager who actually paid it out
// Who may pay is decided by reimbursementManagerId() in permissions.js (the employee's current manager).

import { logActivity } from './activity.js';
import { STATUS } from './constants.js';
import { findExpense, moveStatus } from './expenses.js';
import { formatMoney } from './money.js';
import { notify } from './notifications.js';
import { can } from './permissions.js';
import { commit, createId, loadDb, nowIso } from './storage.js';

export const REFERENCE_MAX = 60;

// Called inside an approval (the caller commits). The amount is copied at approval time.
export function startReimbursement(db, expense, managerId) {
  if (db.reimbursements.some((record) => record.expenseId === expense.id)) {
    throw new Error('This expense already has a reimbursement record.');
  }
  const record = {
    id: createId('rmb'),
    expenseId: expense.id,
    employeeId: expense.employeeId,
    managerId,
    amount: expense.amount,
    status: 'pending',
    createdAt: nowIso(),
    reimbursedAt: null,
    reimbursedById: null,
    reference: '',
  };
  db.reimbursements.push(record);
  expense.reimbursementId = record.id;
  moveStatus(expense, STATUS.REIMBURSEMENT_PENDING, managerId, { action: 'reimbursement_queued' });
  return record;
}

export function markReimbursed(actor, reimbursementId, reference = '') {
  const ref = String(reference ?? '').trim();
  if (ref.length > REFERENCE_MAX) return { ok: false, errors: { reference: `Reference must be at most ${REFERENCE_MAX} characters.` } };

  const db = loadDb();
  const record = db.reimbursements.find((r) => r.id === reimbursementId);
  if (!can(actor, 'reimbursement.markPaid', record, db)) return { ok: false, error: 'This reimbursement is not waiting for you.' };
  const expense = findExpense(db, record.expenseId);
  if (!expense || expense.amount !== record.amount) return { ok: false, error: 'The reimbursement does not match its expense.' };

  const at = nowIso();
  record.status = 'reimbursed';
  record.reimbursedAt = at;
  record.reimbursedById = actor.id;
  record.reference = ref;
  moveStatus(expense, STATUS.REIMBURSED, actor.id, { action: 'reimbursed', comment: ref ? `Payment reference: ${ref}` : '' });

  if (expense.employeeId !== actor.id) {
    notify(db, expense.employeeId, {
      type: 'expense_reimbursed',
      title: 'Expense reimbursed',
      message: `${formatMoney(record.amount)} for “${expense.title}” has been reimbursed.${ref ? ` Reference: ${ref}.` : ''}`,
      expenseId: expense.id,
    });
  }
  // Admin log: who paid, which expense, when — no title, amount or reference (admin privacy).
  logActivity(db, actor.id, 'expense_reimbursed', {
    targetType: 'expense',
    targetId: expense.id,
    summary: `${actor.name} marked expense ${expense.id} as reimbursed.`,
  });
  commit(db, ['reimbursements', 'expenses', 'notifications', 'activity']);
  return { ok: true, record };
}
