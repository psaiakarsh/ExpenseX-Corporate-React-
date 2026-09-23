import { storage, reset, makeCompany, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveExpense, createManagerExpense, deleteDraft, findExpense, moveStatus, rejectExpense, saveEmployeeExpense, submitDraft,
} from '../src/domain/expenses.js';
import { createManagedAccount, setMonthlyLimit, setUserActive } from '../src/domain/users.js';
import { createProject, setProjectStatus } from '../src/domain/projects.js';
import { can } from '../src/domain/permissions.js';
import { commit, loadDb, loadReceipts } from '../src/domain/storage.js';
import { toLocalDate } from '../src/domain/dates.js';

const receipt = (name = 'r.jpg') => ({ dataUrl: `data:image/jpeg;base64,${name}`, fileName: name, mimeType: 'image/jpeg', sizeBytes: 3 });
const notesFor = (db, userId, type) => db.notifications.filter((n) => n.recipientId === userId && n.type === type);

describe('employee drafts and validation', () => {
  beforeEach(reset);

  test('saving a draft stores clean typed values and a "created" history entry', async () => {
    const { e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ title: '  Taxi  ', projectId: pA.id, notes: ' note ' })));
    assert.equal(expense.status, 'draft');
    assert.equal(expense.title, 'Taxi');
    assert.equal(expense.amount, 125050);
    assert.equal(expense.notes, 'note');
    assert.equal(expense.managerId, null);
    assert.equal(expense.employeeId, e1.id);
    assert.equal(expense.createdById, e1.id);
    assert.deepEqual(expense.history.map((h) => h.action), ['created']);
  });

  test('every field is validated', async () => {
    const { e1, pA, pB } = await makeCompany();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const cases = [
      [{ title: 'ab' }, 'title', /3–80/],
      [{ title: 'x'.repeat(81) }, 'title', /3–80/],
      [{ title: '' }, 'title', /required/],
      [{ amount: '-1' }, 'amount', /valid amount/],
      [{ amount: '1.234' }, 'amount', /valid amount/],
      [{ amount: '0' }, 'amount', /more than ₹0/],
      [{ amount: '10,00,000.01' }, 'amount', /at most ₹10,00,000/],
      [{ category: 'Communication' }, 'category', /category/],
      [{ date: '2026-02-30' }, 'date', /valid date/],
      [{ date: toLocalDate(tomorrow) }, 'date', /future/],
      [{ date: '2019-12-31' }, 'date', /too far/],
      [{ projectId: '' }, 'projectId', /Choose a project/],
      [{ projectId: pB.id }, 'projectId', /active projects/],
      [{ notes: 'x'.repeat(501) }, 'notes', /Description/],
    ];
    for (const [override, field, pattern] of cases) {
      const result = saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, ...override }));
      assert.match(result.errors?.[field] ?? '', pattern, JSON.stringify(override));
    }
    ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, amount: '10,00,000', date: '2020-01-01' })));
  });

  test('a project is optional when the team has no active projects', async () => {
    const { mA, e1, pA } = await makeCompany();
    ok(setProjectStatus(mA, pA.id, 'archived'));
    ok(saveEmployeeExpense(e1, expenseInput({ projectId: '' })));
  });

  test('employees without a manager can save drafts but not submit', async () => {
    const { admin } = await makeCompany();
    const { user } = ok(await createManagedAccount(admin, 'employee', { name: 'Loner', email: 'l@x.example', password: 'secret1' }));
    ok(saveEmployeeExpense(user, expenseInput()));
    const result = saveEmployeeExpense(user, expenseInput(), { submit: true });
    assert.match(result.error, /assigns you a manager/);
  });

  test('submitting needs an ACTIVE manager', async () => {
    const { admin, mC } = await makeCompany();
    const { user } = ok(await createManagedAccount(admin, 'employee', { name: 'Gamma Emp', email: 'g@x.example', password: 'secret1', managerId: mC.id }));
    // Put the employee under a manager who is then deactivated (state built directly — the UI forbids it).
    ok(setUserActive(admin, user.id, false));
    const db = loadDb();
    db.users.find((u) => u.id === mC.id).status = 'inactive';
    db.users.find((u) => u.id === user.id).status = 'active';
    commit(db, ['users']);
    assert.match(saveEmployeeExpense(user, expenseInput(), { submit: true }).error, /assigns you a manager/);
  });

  test('managers and admins cannot file employee expenses', async () => {
    const { admin, mA } = await makeCompany();
    assert.equal(saveEmployeeExpense(mA, expenseInput()).ok, false);
    assert.equal(saveEmployeeExpense(admin, expenseInput()).ok, false);
  });
});

describe('submit → reject → resubmit', () => {
  beforeEach(reset);

  test('submitting sets the reviewer and notifies the manager', async () => {
    const { mA, e1, pA } = await makeCompany();
    const draft = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }))).expense;
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: draft.id, submit: true }));
    assert.equal(expense.id, draft.id);
    assert.equal(expense.status, 'pending');
    assert.equal(expense.managerId, mA.id);
    assert.deepEqual(expense.history.map((h) => h.action), ['created', 'submitted']);
    const [note] = notesFor(loadDb(), mA.id, 'expense_submitted');
    assert.equal(note.expenseId, expense.id);
    assert.match(note.message, /Emp One submitted a new ₹1,250\.50 expense/);
  });

  test('pending claims are locked for the employee', async () => {
    const { e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    assert.match(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: expense.id }).error, /can no longer be edited/);
    assert.equal(deleteDraft(e1, expense.id).ok, false);
  });

  test('rejection needs a 5–300 character comment and notifies with it', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    assert.ok(rejectExpense(mA, expense.id, '   no ').errors.comment);
    assert.ok(rejectExpense(mA, expense.id, 'x'.repeat(301)).errors.comment);
    const { expense: rejected } = ok(rejectExpense(mA, expense.id, 'Please attach the receipt.'));
    assert.equal(rejected.status, 'rejected');
    assert.deepEqual(rejected.review, { decision: 'rejected', byId: mA.id, at: rejected.review.at, comment: 'Please attach the receipt.' });
    const db = loadDb();
    assert.match(notesFor(db, e1.id, 'expense_rejected')[0].message, /Manager’s comment: “Please attach the receipt\.”/);
    assert.equal(db.activity[0].action, 'expense_rejected');
    assert.ok(!db.activity[0].summary.includes('receipt'), 'the comment stays out of the admin log');
    assert.match(approveExpense(mA, expense.id).error, /no longer waiting/, 'rejected claims cannot be approved until resubmitted');
  });

  test('a rejected claim is edited and resubmitted as the SAME expense with a change log', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    ok(rejectExpense(mA, expense.id, 'Amount is wrong.'));
    assert.match(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: expense.id }).error, /only be edited and resubmitted/);

    const { expense: again } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, amount: '1000' }), { expenseId: expense.id, submit: true }));
    assert.equal(again.id, expense.id);
    assert.equal(again.status, 'pending');
    assert.equal(again.review, null, 'current review cleared');
    assert.deepEqual(again.history.map((h) => h.action), ['created', 'submitted', 'rejected', 'resubmitted']);
    assert.equal(again.history[2].comment, 'Amount is wrong.', 'the rejection stays in history');
    assert.deepEqual(again.history[3].changes, [{ field: 'amount', from: 125050, to: 100000 }]);
    assert.equal(notesFor(loadDb(), mA.id, 'expense_resubmitted').length, 1);
  });

  test('illegal status jumps throw (programming errors, never user input)', () => {
    const expense = { status: 'draft', history: [] };
    assert.throws(() => moveStatus(expense, 'reimbursed', 'x'), /Invalid status change: draft → reimbursed/);
    moveStatus(expense, 'pending', 'x');
    assert.equal(expense.history.length, 1);
    assert.equal(expense.history[0].fromStatus, 'draft');
  });
});

describe('approval', () => {
  beforeEach(reset);

  test('approve = review + history + reimbursement record + Reimbursement Pending + notification + activity', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    assert.ok(approveExpense(mA, expense.id, 'x'.repeat(301)).errors.comment);
    const { expense: approved } = ok(approveExpense(mA, expense.id, 'Fine'));
    assert.equal(approved.status, 'reimbursement_pending');
    assert.deepEqual(approved.history.map((h) => h.action), ['created', 'submitted', 'approved', 'reimbursement_queued']);
    assert.equal(approved.review.decision, 'approved');
    assert.equal(approved.review.byId, mA.id);

    const db = loadDb();
    const record = db.reimbursements.find((r) => r.id === approved.reimbursementId);
    assert.deepEqual(
      { expenseId: record.expenseId, employeeId: record.employeeId, managerId: record.managerId, amount: record.amount, status: record.status },
      { expenseId: expense.id, employeeId: e1.id, managerId: mA.id, amount: 125050, status: 'pending' },
    );
    assert.equal(notesFor(db, e1.id, 'expense_approved').length, 1);
    assert.equal(db.activity[0].action, 'expense_approved');
    assert.equal(db.activity[0].targetId, expense.id);
  });

  test('cannot be approved twice, by another team’s manager, or by an employee', async () => {
    const { mA, mB, e1, e2, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    assert.equal(approveExpense(mB, expense.id).ok, false);
    assert.equal(approveExpense(e2, expense.id).ok, false);
    assert.equal(approveExpense(e1, expense.id).ok, false);
    assert.equal(rejectExpense(mB, expense.id, 'Not mine to reject').ok, false);
    ok(approveExpense(mA, expense.id));
    assert.equal(approveExpense(mA, expense.id).ok, false);
    assert.equal(loadDb().reimbursements.length, 1);
  });

  test('approved claims are locked forever', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    ok(approveExpense(mA, expense.id));
    const db = loadDb();
    const stored = findExpense(db, expense.id);
    assert.equal(can(e1, 'expense.edit', stored, db), false);
    assert.equal(deleteDraft(e1, expense.id).ok, false);
    assert.equal(rejectExpense(mA, expense.id, 'Too late now').ok, false);
  });
});

describe('manager-created expenses', () => {
  beforeEach(reset);

  test('own expense is self-approved, goes straight to Reimbursement Pending, no self-notification', async () => {
    const { mA, pA } = await makeCompany();
    const { expense } = ok(createManagerExpense(mA, expenseInput({ projectId: pA.id }), { employeeId: mA.id, receipt: receipt() }));
    assert.equal(expense.selfApproved, true);
    assert.equal(expense.status, 'reimbursement_pending');
    assert.equal(expense.createdById, mA.id);
    assert.deepEqual(expense.history.map((h) => h.action), ['created_approved', 'reimbursement_queued']);
    assert.equal(expense.review.byId, mA.id);
    const db = loadDb();
    assert.equal(db.notifications.filter((n) => n.recipientId === mA.id && n.expenseId === expense.id).length, 0);
    assert.equal(loadReceipts()[expense.receipt.id], receipt().dataUrl);
  });

  test('for a team member: approved, employee notified; never queued for review', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(createManagerExpense(mA, expenseInput({ projectId: pA.id }), { employeeId: e1.id }));
    assert.equal(expense.selfApproved, false);
    assert.equal(expense.employeeId, e1.id);
    const db = loadDb();
    assert.equal(notesFor(db, e1.id, 'expense_created_for_you').length, 1);
    assert.equal(can(mA, 'expense.review', findExpense(db, expense.id), db), false);
  });

  test('refused for another team, an inactive member, other roles, or another manager’s project', async () => {
    const { admin, mA, e1, e3, pA, pB } = await makeCompany();
    assert.ok(createManagerExpense(mA, expenseInput({ projectId: pA.id }), { employeeId: e3.id }).errors.employeeId);
    assert.ok(createManagerExpense(e1, expenseInput({ projectId: pA.id }), { employeeId: e1.id }).errors.employeeId);
    assert.ok(createManagerExpense(mA, expenseInput({ projectId: pB.id }), { employeeId: mA.id }).errors.projectId);
    ok(setUserActive(admin, e1.id, false));
    assert.ok(createManagerExpense(mA, expenseInput({ projectId: pA.id }), { employeeId: e1.id }).errors.employeeId);
  });
});

describe('deleting and submitting drafts', () => {
  beforeEach(reset);

  test('only the owner deletes, only drafts, and the receipt image goes too', async () => {
    const { e1, e2, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { receipt: receipt() }));
    assert.equal(deleteDraft(e2, expense.id).ok, false);
    ok(deleteDraft(e1, expense.id));
    assert.equal(loadDb().expenses.length, 0);
    assert.deepEqual(loadReceipts(), {});
  });

  // A rejected claim IS editable, so the draft check in can('expense.deleteDraft') is the only thing
  // stopping it being deleted — and its rejection is financial history that has to survive.
  test('a rejected claim can be edited but never deleted', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    ok(rejectExpense(mA, expense.id, 'Attach the itemised bill.'));
    const db = loadDb();
    const stored = findExpense(db, expense.id);
    assert.equal(can(e1, 'expense.edit', stored, db), true);
    assert.equal(can(e1, 'expense.deleteDraft', stored, db), false);
    assert.equal(deleteDraft(e1, expense.id).ok, false);
    assert.equal(loadDb().expenses.length, 1, 'the rejected claim and its history survive');
  });

  // Defence in depth: expense.edit also requires that the employee CREATED the claim. A manager-created
  // claim is approved on creation, so this only bites if a record ever reaches an editable state.
  test('an expense the employee did not create stays locked even in an editable state', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(createManagerExpense(mA, expenseInput({ projectId: pA.id }), { employeeId: e1.id }));
    const db = loadDb();
    findExpense(db, expense.id).status = 'draft';
    commit(db, ['expenses']);
    const fresh = loadDb();
    assert.equal(can(e1, 'expense.edit', findExpense(fresh, expense.id), fresh), false);
    assert.match(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: expense.id }).error, /can no longer be edited/);
    assert.equal(deleteDraft(e1, expense.id).ok, false);
  });

  test('submitDraft re-validates the stored draft (kept from V1 for list-level submission)', async () => {
    const { mA, e1, pA } = await makeCompany();
    const draft = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }))).expense;
    const { expense } = ok(submitDraft(e1, draft.id));
    assert.equal(expense.status, 'pending');
    assert.match(submitDraft(e1, draft.id).error, /Only drafts/);

    const other = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }))).expense;
    ok(setProjectStatus(mA, pA.id, 'archived'));
    ok(createProject(mA, { name: 'Replacement', description: '' }));
    assert.match(submitDraft(e1, other.id).error, /^Open the draft to fix it first: /);
  });
});

describe('receipts on drafts and resubmissions', () => {
  beforeEach(reset);

  test('replacing or removing a draft’s receipt leaves no orphaned image', async () => {
    const { e1, pA } = await makeCompany();
    const draft = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { receipt: receipt('one') })).expense;
    const replaced = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: draft.id, receipt: receipt('two') })).expense;
    assert.deepEqual(Object.values(loadReceipts()), [receipt('two').dataUrl]);
    assert.equal(replaced.receipt.fileName, 'two');
    const removed = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: draft.id, removeReceipt: true })).expense;
    assert.equal(removed.receipt, null);
    assert.deepEqual(loadReceipts(), {});
  });

  test('a rejected claim keeps its old image (history refers to it) and logs the change', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true, receipt: receipt('old') }));
    ok(rejectExpense(mA, expense.id, 'Wrong receipt attached.'));
    const { expense: again } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: expense.id, submit: true, receipt: receipt('new') }));
    assert.equal(Object.keys(loadReceipts()).length, 2);
    assert.deepEqual(again.history.at(-1).changes, [{ field: 'receipt', from: 'old', to: 'new' }]);
  });

  test('storage full: the save throws and nothing is half-saved', async () => {
    const { e1, pA } = await makeCompany();
    const before = storage.dump();
    storage.quota = storage.usedChars() + 500;
    const big = { ...receipt(), dataUrl: `data:image/jpeg;base64,${'A'.repeat(5000)}` };
    assert.throws(() => saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { receipt: big }), /storage is full/);
    assert.deepEqual(storage.dump(), before);
  });
});

describe('limit alerts (warn only, once per level per month)', () => {
  beforeEach(reset);

  test('warning at the configured %, exceeded at 100 %, never blocking, never repeated', async () => {
    const { mA, e1, pA } = await makeCompany();
    ok(setMonthlyLimit(mA, e1.id, '1000'));
    const submit = (amount) => ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, amount }), { submit: true }));
    submit('700'); // 70 %
    let db = loadDb();
    assert.equal(notesFor(db, e1.id, 'limit_warning').length, 0);
    submit('100'); // 80 % → warning
    submit('100'); // 90 % → no second warning
    db = loadDb();
    assert.equal(notesFor(db, e1.id, 'limit_warning').length, 1);
    assert.equal(notesFor(db, mA.id, 'limit_warning').length, 1);
    submit('300'); // 120 % → exceeded, still submitted
    submit('50');
    db = loadDb();
    assert.equal(notesFor(db, e1.id, 'limit_exceeded').length, 1);
    assert.equal(notesFor(db, mA.id, 'limit_exceeded').length, 1);
    assert.equal(db.expenses.filter((e) => e.status === 'pending').length, 5);
  });
});
