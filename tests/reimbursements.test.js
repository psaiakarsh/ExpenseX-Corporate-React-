import { reset, makeCompany, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { markReimbursed } from '../src/domain/reimbursements.js';
import { approveExpense, createManagerExpense, findExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { assignEmployee } from '../src/domain/users.js';
import { can, canViewExpense, reimbursementManagerId, visibleReimbursements } from '../src/domain/permissions.js';
import { commit, loadDb } from '../src/domain/storage.js';

async function approvedClaim() {
  const company = await makeCompany();
  const { mA, e1, pA } = company;
  const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
  const approved = ok(approveExpense(mA, expense.id)).expense;
  return { ...company, expense: approved, recordId: approved.reimbursementId };
}

describe('marking reimbursed', () => {
  beforeEach(reset);

  test('the current manager pays; the approver and payer are both recorded', async () => {
    const { mA, e1, expense, recordId } = await approvedClaim();
    const { record } = ok(markReimbursed(mA, recordId, ' NEFT-123 '));
    assert.equal(record.status, 'reimbursed');
    assert.equal(record.reimbursedById, mA.id);
    assert.equal(record.managerId, mA.id);
    assert.equal(record.reference, 'NEFT-123');
    assert.ok(record.reimbursedAt);

    const db = loadDb();
    const stored = findExpense(db, expense.id);
    assert.equal(stored.status, 'reimbursed');
    assert.equal(stored.amount, expense.amount, 'the expense itself is not rewritten');
    assert.equal(stored.history.at(-1).comment, 'Payment reference: NEFT-123');
    const note = db.notifications.find((n) => n.recipientId === e1.id && n.type === 'expense_reimbursed');
    assert.match(note.message, /Reference: NEFT-123/);
    const entry = db.activity[0];
    assert.equal(entry.action, 'expense_reimbursed');
    assert.ok(!/NEFT|₹|Taxi/.test(entry.summary), 'no reference, amount or title in the admin log');
  });

  test('no double payment; employees and other managers cannot pay', async () => {
    const { mA, mB, e1, recordId } = await approvedClaim();
    assert.equal(markReimbursed(e1, recordId).ok, false);
    assert.equal(markReimbursed(mB, recordId).ok, false);
    ok(markReimbursed(mA, recordId));
    assert.match(markReimbursed(mA, recordId).error, /not waiting for you/);
  });

  test('reference is at most 60 characters', async () => {
    const { mA, recordId } = await approvedClaim();
    assert.ok(markReimbursed(mA, recordId, 'x'.repeat(61)).errors.reference);
  });

  test('refuses a record whose amount no longer matches its expense', async () => {
    const { mA, recordId } = await approvedClaim();
    const db = loadDb();
    db.reimbursements.find((r) => r.id === recordId).amount += 1;
    commit(db, ['reimbursements']);
    assert.match(markReimbursed(mA, recordId).error, /does not match/);
  });

  // Defence in depth: markPaid checks the employee's CURRENT manager as well as visibility of the
  // expense, so a record that points at another team's employee cannot be paid by the wrong manager.
  test('refuses a record whose employee belongs to another manager', async () => {
    const { mA, e3, recordId } = await approvedClaim();
    const db = loadDb();
    db.reimbursements.find((r) => r.id === recordId).employeeId = e3.id; // e3 is Manager B's
    commit(db, ['reimbursements']);
    const fresh = loadDb();
    const record = fresh.reimbursements.find((r) => r.id === recordId);
    assert.equal(canViewExpense(mA, findExpense(fresh, record.expenseId), fresh), true, 'mA can still see the expense');
    assert.notEqual(reimbursementManagerId(fresh, record), mA.id);
    assert.equal(can(mA, 'reimbursement.markPaid', record, fresh), false);
    assert.equal(markReimbursed(mA, recordId).ok, false);
    assert.equal(loadDb().reimbursements.find((r) => r.id === recordId).status, 'pending');
  });

  test('a manager pays their own self-approved claim without notifying themselves', async () => {
    const { mA, pA } = await makeCompany();
    const { expense } = ok(createManagerExpense(mA, expenseInput({ projectId: pA.id }), { employeeId: mA.id }));
    ok(markReimbursed(mA, expense.reimbursementId));
    assert.equal(loadDb().notifications.filter((n) => n.type === 'expense_reimbursed').length, 0);
  });
});

describe('reassignment: payer = CURRENT manager, approver kept as history', () => {
  beforeEach(reset);

  test('after moving the employee, only the new manager can open and pay; history is untouched', async () => {
    const { admin, mA, mB, mC, e1, expense, recordId } = await approvedClaim();
    ok(assignEmployee(admin, e1.id, mB.id));

    let db = loadDb();
    const record = db.reimbursements.find((r) => r.id === recordId);
    const stored = findExpense(db, expense.id);
    assert.equal(reimbursementManagerId(db, record), mB.id);
    assert.equal(canViewExpense(mA, stored, db), false, 'old manager loses access');
    assert.equal(can(mA, 'reimbursement.markPaid', record, db), false);
    assert.equal(canViewExpense(mC, stored, db), false);
    assert.equal(can(mC, 'reimbursement.markPaid', record, db), false);
    assert.equal(canViewExpense(mB, stored, db), true);
    assert.equal(visibleReimbursements(mA, db).length, 0);
    assert.equal(visibleReimbursements(mB, db).length, 1);

    assert.equal(markReimbursed(mA, recordId).ok, false);
    ok(markReimbursed(mB, recordId));
    db = loadDb();
    const paid = db.reimbursements.find((r) => r.id === recordId);
    assert.equal(paid.managerId, mA.id, 'approver is never rewritten');
    assert.equal(paid.reimbursedById, mB.id);
    const after = findExpense(db, expense.id);
    assert.equal(after.review.byId, mA.id);
    assert.equal(after.managerId, mA.id);
    assert.equal(after.history.find((h) => h.action === 'approved').byId, mA.id);
  });

  test('pending claims move to the new manager’s queue', async () => {
    const { admin, mA, mB, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    ok(assignEmployee(admin, e1.id, mB.id));
    const db = loadDb();
    const stored = findExpense(db, expense.id);
    assert.equal(can(mA, 'expense.review', stored, db), false);
    assert.equal(can(mB, 'expense.review', stored, db), true);
    ok(approveExpense(mB, expense.id));
    assert.equal(loadDb().reimbursements[0].managerId, mB.id);
  });
});
