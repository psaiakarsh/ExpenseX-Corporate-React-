// expenses.js — the expense workflow (a small state machine).
//
//   Employee:  draft ─submit─▶ pending ─approve─▶ approved ─▶ reimbursement_pending ─▶ reimbursed
//                                 └──reject──▶ rejected ─edit + resubmit─▶ pending
//   Manager-created (for self or a team member): approved ─▶ reimbursement_pending ─▶ reimbursed
//
// Every change: check permission → validate → change status through moveStatus() (which appends to
// the append-only `history`) → notify → commit. Approved (and later) expenses can never be edited.
//
// Expense {
//   id, title, amount (paise), category, date, projectId, notes,
//   employeeId (whose money), createdById (who entered it), managerId (reviewer, set at submission),
//   receipt: { id, fileName, mimeType, sizeBytes } | null,
//   status, selfApproved, review: { decision, byId, at, comment } | null, reimbursementId,
//   history: [{ at, byId, action, fromStatus, toStatus, comment?, changes? }], createdAt, updatedAt
// }

import { logActivity } from './activity.js';
import { CATEGORIES, STATUS } from './constants.js';
import { isValidDate, monthKey, toLocalDate } from './dates.js';
import { checkLimitAlerts } from './limits.js';
import { formatMoney, isValidAmount, parseMoney, toAmountInput } from './money.js';
import { notify } from './notifications.js';
import { DENIED, can, findUser, isActiveUser, selectableProjects } from './permissions.js';
import { attachReceipt } from './receipts.js';
import { startReimbursement } from './reimbursements.js';
import { commit, createId, loadDb, loadReceipts, nowIso } from './storage.js';
import { checkText, collectErrors, hasErrors } from './validate.js';

export const ALLOWED_TRANSITIONS = {
  draft: ['pending'],
  pending: ['approved', 'rejected'],
  approved: ['reimbursement_pending'],
  reimbursement_pending: ['reimbursed'],
  reimbursed: [],
  rejected: ['pending'],
};

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const NOTES_MAX = 500;
export const COMMENT_MAX = 300;
export const EARLIEST_EXPENSE_DATE = '2020-01-01';

// The only way a status changes. Throws on an illegal jump (a programming error, never user input).
export function moveStatus(expense, toStatus, byId, details = {}) {
  const fromStatus = expense.status;
  if (!ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    throw new Error(`Invalid status change: ${fromStatus} → ${toStatus}`);
  }
  const at = nowIso();
  expense.status = toStatus;
  expense.updatedAt = at;
  expense.history.push({ at, byId, action: details.action ?? toStatus, fromStatus, toStatus, ...details });
}

export function findExpense(db, expenseId) {
  return db.expenses.find((expense) => expense.id === expenseId) ?? null;
}

// input: raw form strings. reviewingManagerId decides which projects may be chosen.
// Returns { errors, values } — values are clean, typed and safe to store.
export function validateExpenseInput(db, input, reviewingManagerId) {
  const title = String(input.title ?? '').trim();
  const amount = parseMoney(input.amount);
  const date = String(input.date ?? '');
  const projectId = input.projectId || null;
  const projects = reviewingManagerId ? selectableProjects(db, reviewingManagerId) : [];

  const errors = collectErrors({
    title: !title
      ? 'Title is required.'
      : title.length < TITLE_MIN || title.length > TITLE_MAX ? `Title must be ${TITLE_MIN}–${TITLE_MAX} characters.` : '',
    amount: amount === null
      ? 'Enter a valid amount, e.g. 1250 or 1250.50 (no negative values, at most 2 decimals).'
      : !isValidAmount(amount) ? 'Amount must be more than ₹0 and at most ₹10,00,000.' : '',
    category: CATEGORIES.includes(input.category) ? '' : 'Choose a category.',
    date: !isValidDate(date)
      ? 'Enter a valid date.'
      : date > toLocalDate() ? 'The date cannot be in the future.' : date < EARLIEST_EXPENSE_DATE ? 'The date is too far in the past.' : '',
    projectId: projectId
      ? projects.some((p) => p.id === projectId) ? '' : 'Choose one of your team’s active projects.'
      : projects.length > 0 ? 'Choose a project.' : '',
    notes: checkText(input.notes, NOTES_MAX, 'Description'),
  });

  return {
    errors,
    values: { title, amount, category: input.category, date, projectId, notes: String(input.notes ?? '').trim() },
  };
}

export const TRACKED_FIELDS = ['title', 'amount', 'category', 'date', 'projectId', 'notes'];

// [{ field, from, to }] for every field that differs — stored when a rejected claim is resubmitted,
// so the original values are never lost.
export function diffExpense(expense, values) {
  return TRACKED_FIELDS.filter((field) => expense[field] !== values[field]).map((field) => ({
    field,
    from: expense[field],
    to: values[field],
  }));
}

// ---------- Employee: create / edit / submit / resubmit ----------

// options: { expenseId, submit, receipt (from prepareReceipt), removeReceipt }
export function saveEmployeeExpense(actor, input, { expenseId = null, submit = false, receipt = null, removeReceipt = false } = {}) {
  const db = loadDb();
  const employee = findUser(db, actor.id);
  if (!can(employee, 'expense.createOwn', null, db)) return DENIED;

  let expense = expenseId ? findExpense(db, expenseId) : null;
  if (expenseId && !can(employee, 'expense.edit', expense, db)) {
    return { ok: false, error: 'This expense can no longer be edited.' };
  }
  const wasRejected = expense?.status === STATUS.REJECTED;
  if (wasRejected && !submit) return { ok: false, error: 'A rejected expense can only be edited and resubmitted.' };
  if (submit && !isActiveUser(findUser(db, employee.managerId))) {
    return {
      ok: false,
      error: 'You can’t submit expenses until an administrator assigns you a manager. Save it as a draft for now.',
    };
  }

  const { errors, values } = validateExpenseInput(db, input, employee.managerId);
  if (hasErrors(errors)) return { ok: false, errors };

  const at = nowIso();
  let changes = [];
  if (!expense) {
    expense = {
      id: createId('exp'),
      ...values,
      employeeId: employee.id,
      createdById: employee.id,
      managerId: null,
      receipt: null,
      status: STATUS.DRAFT,
      selfApproved: false,
      review: null,
      reimbursementId: null,
      history: [{ at, byId: employee.id, action: 'created', fromStatus: null, toStatus: STATUS.DRAFT }],
      createdAt: at,
      updatedAt: at,
    };
    db.expenses.push(expense);
  } else {
    changes = diffExpense(expense, values);
    Object.assign(expense, values);
    expense.updatedAt = at;
  }

  // Receipts: a draft's old image can be discarded (drafts have no history). A rejected claim's old
  // image is kept in storage because its history still refers to it.
  if (receipt || removeReceipt) {
    const old = expense.receipt;
    if (old && !wasRejected) {
      db.receipts ??= loadReceipts();
      delete db.receipts[old.id];
    }
    expense.receipt = receipt ? attachReceipt(db, receipt) : null;
    if (wasRejected) changes.push({ field: 'receipt', from: old?.fileName ?? null, to: expense.receipt?.fileName ?? null });
    if (!db.receipts) db.receipts = loadReceipts();
  }

  if (submit) {
    const manager = findUser(db, employee.managerId);
    expense.managerId = manager.id;
    // A resubmitted claim is awaiting a fresh decision; the rejection itself stays in `history`.
    if (wasRejected) expense.review = null;
    moveStatus(expense, STATUS.PENDING, employee.id, wasRejected ? { action: 'resubmitted', changes } : { action: 'submitted' });
    notify(db, manager.id, {
      type: wasRejected ? 'expense_resubmitted' : 'expense_submitted',
      title: wasRejected ? 'Expense resubmitted' : 'New expense to review',
      message: `${employee.name} ${wasRejected ? 'resubmitted a' : 'submitted a new'} ${formatMoney(expense.amount)} expense: “${expense.title}”.`,
      expenseId: expense.id,
    });
    checkLimitAlerts(db, employee, monthKey(expense.date));
  }

  commit(db, ['expenses', 'notifications', ...(db.receipts ? ['receipts'] : [])]);
  return { ok: true, expense };
}

// Submits an existing draft from a list (re-validates, e.g. in case its project was archived).
export function submitDraft(actor, expenseId) {
  const db = loadDb();
  const expense = findExpense(db, expenseId);
  if (!expense || expense.status !== STATUS.DRAFT) return { ok: false, error: 'Only drafts can be submitted from here.' };
  const input = { ...expense, amount: toAmountInput(expense.amount), projectId: expense.projectId ?? '' };
  const result = saveEmployeeExpense(actor, input, { expenseId, submit: true });
  if (!result.ok && result.errors) {
    return { ok: false, error: `Open the draft to fix it first: ${Object.values(result.errors)[0]}` };
  }
  return result;
}

// Drafts were never submitted, so they have no financial history and may be deleted.
export function deleteDraft(actor, expenseId) {
  const db = loadDb();
  const expense = findExpense(db, expenseId);
  if (!can(actor, 'expense.deleteDraft', expense, db)) return DENIED;
  db.expenses = db.expenses.filter((e) => e.id !== expenseId);
  const names = ['expenses'];
  if (expense.receipt) {
    db.receipts = loadReceipts();
    delete db.receipts[expense.receipt.id];
    names.push('receipts');
  }
  commit(db, names);
  return { ok: true };
}

// ---------- Manager: create (auto-approved), approve, reject ----------

// employeeId: the manager's own id (self-approved) or an active team member's id.
export function createManagerExpense(actor, input, { employeeId, receipt = null }) {
  const db = loadDb();
  const manager = findUser(db, actor.id);
  const owner = findUser(db, employeeId);
  if (!can(manager, 'expense.createAsManager', owner, db)) return { ok: false, errors: { employeeId: 'Choose yourself or an active member of your team.' } };

  const { errors, values } = validateExpenseInput(db, input, manager.id);
  if (hasErrors(errors)) return { ok: false, errors };

  const at = nowIso();
  const selfApproved = owner.id === manager.id;
  const comment = selfApproved ? 'Manager’s own expense — self-approved.' : `Created and approved by ${manager.name}.`;
  const expense = {
    id: createId('exp'),
    ...values,
    employeeId: owner.id,
    createdById: manager.id,
    managerId: manager.id,
    receipt: null,
    status: STATUS.APPROVED,
    selfApproved,
    review: { decision: 'approved', byId: manager.id, at, comment },
    reimbursementId: null,
    history: [{ at, byId: manager.id, action: 'created_approved', fromStatus: null, toStatus: STATUS.APPROVED, comment }],
    createdAt: at,
    updatedAt: at,
  };
  if (receipt) expense.receipt = attachReceipt(db, receipt);
  db.expenses.push(expense);
  startReimbursement(db, expense, manager.id);

  if (!selfApproved) {
    notify(db, owner.id, {
      type: 'expense_created_for_you',
      title: 'Expense added for you',
      message: `${manager.name} added an approved ${formatMoney(expense.amount)} ${expense.category} expense for you: “${expense.title}”. Reimbursement is pending.`,
      expenseId: expense.id,
    });
    checkLimitAlerts(db, owner, monthKey(expense.date));
  }

  commit(db, ['expenses', 'reimbursements', 'notifications', ...(db.receipts ? ['receipts'] : [])]);
  return { ok: true, expense };
}

// Approval does four things at once: records the review + history, creates the reimbursement
// record, moves the expense to Reimbursement Pending, and notifies the employee.
export function approveExpense(actor, expenseId, comment = '') {
  const note = String(comment ?? '').trim();
  if (note.length > COMMENT_MAX) return { ok: false, errors: { comment: `Comment must be at most ${COMMENT_MAX} characters.` } };

  const db = loadDb();
  const expense = findExpense(db, expenseId);
  if (!can(actor, 'expense.review', expense, db)) return { ok: false, error: 'This expense is no longer waiting for your approval.' };

  expense.review = { decision: 'approved', byId: actor.id, at: nowIso(), comment: note };
  moveStatus(expense, STATUS.APPROVED, actor.id, { action: 'approved', comment: note });
  startReimbursement(db, expense, actor.id);
  notify(db, expense.employeeId, {
    type: 'expense_approved',
    title: 'Expense approved',
    message: `Your ${formatMoney(expense.amount)} ${expense.category.toLowerCase()} expense “${expense.title}” was approved. Reimbursement is pending.`,
    expenseId: expense.id,
  });
  logActivity(db, actor.id, 'expense_approved', {
    targetType: 'expense',
    targetId: expense.id,
    summary: `${actor.name} approved expense ${expense.id}; reimbursement is pending.`,
  });
  commit(db, ['expenses', 'reimbursements', 'notifications', 'activity']);
  return { ok: true, expense };
}

export function rejectExpense(actor, expenseId, comment) {
  const note = String(comment ?? '').trim();
  if (note.length < 5 || note.length > COMMENT_MAX) {
    return { ok: false, errors: { comment: `Explain the rejection in 5–${COMMENT_MAX} characters so the employee can fix it.` } };
  }

  const db = loadDb();
  const expense = findExpense(db, expenseId);
  if (!can(actor, 'expense.review', expense, db)) return { ok: false, error: 'This expense is no longer waiting for your approval.' };

  expense.review = { decision: 'rejected', byId: actor.id, at: nowIso(), comment: note };
  moveStatus(expense, STATUS.REJECTED, actor.id, { action: 'rejected', comment: note });
  notify(db, expense.employeeId, {
    type: 'expense_rejected',
    title: 'Expense rejected',
    message: `Your ${formatMoney(expense.amount)} expense “${expense.title}” was rejected. Manager’s comment: “${note}” — please edit and resubmit.`,
    expenseId: expense.id,
  });
  // Admin log: decision only — the comment stays in the expense history (employee + manager only).
  logActivity(db, actor.id, 'expense_rejected', {
    targetType: 'expense',
    targetId: expense.id,
    summary: `${actor.name} rejected expense ${expense.id} and returned it to the employee.`,
  });
  commit(db, ['expenses', 'notifications', 'activity']);
  return { ok: true, expense };
}
