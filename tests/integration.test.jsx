// Phase 6 — integration: the same stored data seen and changed by all three roles in turn.
// Each step signs a different user in against ONE dataset, so these tests check that the roles agree
// about the same records (and disagree only where V1 says they must).
import { renderApp } from './dom.jsx';
import { makeCompany, ok, expenseInput, storage, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSessionUser, login, logout } from '../src/domain/auth.js';
import { approveExpense, findExpense, rejectExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { markReimbursed } from '../src/domain/reimbursements.js';
import { assignEmployee, setMonthlyLimit, setUserActive } from '../src/domain/users.js';
import { can, canViewExpense, visibleExpenses, visibleReimbursements } from '../src/domain/permissions.js';
import { companyAggregates, summarizeExpenses } from '../src/domain/analytics.js';
import { filterExpenses } from '../src/domain/expense-query.js';
import { notificationsFor } from '../src/domain/notifications.js';
import { KEYS, commit, loadDb, loadReceipts } from '../src/domain/storage.js';

let screen;
afterEach(() => screen?.unmount());

const signIn = (email) => login({ email, password: PASSWORD });
const dialogForm = () => screen.dialog()?.querySelector('form');
const receipt = (name) => ({ dataUrl: `data:image/jpeg;base64,${name}`, fileName: name, mimeType: 'image/jpeg', sizeBytes: 3 });
const statusOf = (id) => loadDb().expenses.find((expense) => expense.id === id).status;

describe('complete expense lifecycle across roles', () => {
  test('draft → submit → approve → reimburse, seen correctly by employee, manager and admin at each step', async () => {
    const { admin, mA, mB, e1, pA } = await makeCompany();

    // --- Employee: draft, then submit through the UI.
    await signIn('e1@test.example');
    screen = await renderApp('/expenses/new');
    await screen.change(screen.find('#title'), 'Lifecycle claim');
    await screen.change(screen.find('#amount'), '5000');
    await screen.change(screen.find('#category'), 'Travel');
    await screen.change(screen.find('#projectId'), pA.id);
    await screen.setFiles(screen.find('#receipt'), [{ name: 'bill.png', type: 'image/png', size: 2048 }]);
    await screen.waitFor(() => Boolean(screen.find('.receipt-preview img')));
    await screen.click(screen.byText('button', 'Save draft'));
    await screen.waitFor(() => screen.text.includes('Draft saved.'));
    const id = loadDb().expenses.find((expense) => expense.title === 'Lifecycle claim').id;
    assert.equal(statusOf(id), 'draft');
    screen.unmount();

    // A draft is private: the manager cannot see it yet.
    assert.equal(canViewExpense(mA, findExpense(loadDb(), id), loadDb()), false);

    screen = await renderApp(`/expenses/${id}/edit`);
    await screen.click(screen.byText('button', 'Submit for approval'));
    await screen.waitFor(() => screen.text.includes('Expense submitted for approval.'));
    assert.equal(statusOf(id), 'pending');
    assert.ok(screen.text.includes('Pending'));
    screen.unmount();

    // --- Manager A: it is in the queue, the receipt is visible, approve it.
    await signIn('a@test.example');
    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('Lifecycle claim'));
    screen.unmount();

    screen = await renderApp(`/expenses/${id}`);
    assert.ok(screen.find('.receipt-thumb'), 'the reviewing manager sees the receipt');
    await screen.click(screen.byText('button', 'Approve'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    assert.equal(statusOf(id), 'reimbursement_pending');
    screen.unmount();

    // Another manager never sees it, at any stage.
    assert.equal(canViewExpense(mB, findExpense(loadDb(), id), loadDb()), false);
    assert.equal(visibleExpenses(mB, loadDb()).some((expense) => expense.id === id), false);

    // --- Employee: the new state is reflected.
    await signIn('e1@test.example');
    screen = await renderApp('/employee/dashboard');
    const stats = screen.findAll('.stat').map((stat) => stat.textContent);
    assert.ok(stats.some((text) => text.includes('Reimbursement pending') && text.includes('₹5,000.00')), stats.join(' | '));
    assert.ok(notificationsFor(e1, loadDb()).some((note) => note.type === 'expense_approved'));
    screen.unmount();

    // --- Manager A: pay it, then both roles agree it is reimbursed.
    await signIn('a@test.example');
    screen = await renderApp('/manager/reimbursements');
    await screen.click(screen.byText('button', 'Mark reimbursed'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.reference, 'NEFT-LIFECYCLE');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    assert.equal(statusOf(id), 'reimbursed');
    const record = loadDb().reimbursements.find((item) => item.expenseId === id);
    assert.equal(record.managerId, mA.id, 'approver kept');
    assert.equal(record.reimbursedById, mA.id);
    assert.equal(record.reference, 'NEFT-LIFECYCLE');
    screen.unmount();

    await signIn('e1@test.example');
    screen = await renderApp(`/expenses/${id}`);
    assert.ok(screen.text.includes('Reimbursed'));
    const detail = (term) => screen.findAll('.details dt').find((dt) => dt.textContent === term)?.nextElementSibling?.textContent ?? '';
    assert.match(detail('Approved by'), /^Manager A · /);
    assert.match(detail('Reimbursed by'), /^Manager A · /);
    assert.ok(notificationsFor(e1, loadDb()).some((note) => note.type === 'expense_reimbursed'));
    screen.unmount();

    // --- Admin: the company totals moved, but no individual record is reachable.
    await signIn('admin@test.example');
    screen = await renderApp('/admin/dashboard');
    assert.ok(screen.text.includes('₹5,000.00'), 'company spending includes the claim');
    assert.ok(!screen.text.includes('Lifecycle claim'));
    const aggregates = companyAggregates(admin, loadDb());
    assert.equal(aggregates.summary.reimbursed.count, 1);
    assert.equal(visibleExpenses(admin, loadDb()).length, 0);
    assert.equal(visibleReimbursements(admin, loadDb()).length, 0);
  });

  test('rejection → resubmission clears the old review and returns it to the same manager', async () => {
    const { mA, e1, pA } = await makeCompany();
    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Round trip', amount: '2000', projectId: pA.id }), { submit: true })).expense;

    await signIn('a@test.example');
    screen = await renderApp('/manager/approvals');
    await screen.click(screen.byText('button', 'Reject'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.comment, 'Attach the itemised bill please.');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    screen.unmount();

    await signIn('e1@test.example');
    screen = await renderApp(`/expenses/${claim.id}`);
    assert.ok(screen.text.includes('Attach the itemised bill please.'));
    screen.unmount();

    screen = await renderApp(`/expenses/${claim.id}/edit`);
    await screen.change(screen.find('#amount'), '1800');
    await screen.click(screen.byText('button', 'Resubmit for approval'));
    await screen.waitFor(() => screen.text.includes('Expense resubmitted for approval.'));

    const stored = findExpense(loadDb(), claim.id);
    assert.equal(stored.id, claim.id, 'same expense identity');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.review, null, 'the old rejection no longer applies');
    assert.deepEqual(stored.history.map((entry) => entry.action), ['created', 'submitted', 'rejected', 'resubmitted']);
    assert.equal(stored.history[2].comment, 'Attach the itemised bill please.', 'rejection kept in history');
    assert.equal(loadDb().expenses.filter((expense) => expense.title === 'Round trip').length, 1, 'no duplicate created');
    screen.unmount();

    await signIn('a@test.example');
    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('Round trip'));
    assert.ok(screen.text.includes('Resubmitted'));
    ok(approveExpense(mA, claim.id));
    assert.equal(statusOf(claim.id), 'reimbursement_pending');
  });

  test('a manager-created claim is approved on creation and never enters the queue', async () => {
    const { mA, e1, pA } = await makeCompany();
    await signIn('a@test.example');
    screen = await renderApp('/expenses/new');
    await screen.change(screen.find('#employeeId'), e1.id);
    await screen.change(screen.find('#title'), 'Manager created claim');
    await screen.change(screen.find('#amount'), '1000');
    await screen.change(screen.find('#category'), 'Food');
    await screen.change(screen.find('#projectId'), pA.id);
    await screen.click(screen.byText('button', 'Create & approve'));
    await screen.waitFor(() => screen.text.includes('The employee has been notified.'));

    const stored = loadDb().expenses.find((expense) => expense.title === 'Manager created claim');
    assert.equal(stored.status, 'reimbursement_pending');
    assert.equal(can(mA, 'expense.review', stored, loadDb()), false, 'never reviewable');
    screen.unmount();

    screen = await renderApp('/manager/approvals');
    assert.ok(!screen.text.includes('Manager created claim'));
  });
});

describe('reassignment integration', () => {
  test('access moves with the employee while history and records stay put', async () => {
    const { admin, mA, mB, e1, pA } = await makeCompany();
    const paid = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Old decided claim', amount: '3000', projectId: pA.id }), { submit: true })).expense;
    ok(approveExpense(mA, paid.id));
    ok(markReimbursed(mA, findExpense(loadDb(), paid.id).reimbursementId, 'NEFT-OLD'));
    const pending = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Still pending claim', amount: '1500', projectId: pA.id }), { submit: true })).expense;
    const before = loadDb().expenses.length;

    await signIn('admin@test.example');
    screen = await renderApp('/admin/users');
    const row = screen.findAll('tbody tr').find((tr) => tr.textContent.includes('Emp One'));
    await screen.click([...row.querySelectorAll('button')].find((button) => button.textContent.includes('Reassign')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.managerId, mB.id);
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    screen.unmount();

    const db = loadDb();
    assert.equal(db.expenses.length, before, 'no duplicate or lost expense');
    assert.equal(findExpense(db, pending.id).managerId, mB.id, 'pending review moved');
    assert.ok(findExpense(db, pending.id).history.some((entry) => entry.action === 'reassigned'), 'reassignment recorded');
    assert.equal(findExpense(db, paid.id).review.byId, mA.id, 'historical approver untouched');
    assert.equal(db.reimbursements.find((item) => item.expenseId === paid.id).reimbursedById, mA.id);

    // Manager A loses access to both claims; manager B gains it.
    assert.equal(visibleExpenses(mA, db).length, 0);
    assert.equal(can(mA, 'expense.review', findExpense(db, pending.id), db), false);
    assert.equal(can(mB, 'expense.review', findExpense(db, pending.id), db), true);

    await signIn('a@test.example');
    screen = await renderApp('/manager/approvals');
    assert.ok(!screen.text.includes('Still pending claim'), 'old manager’s queue is empty');
    screen.unmount();

    // Manager B approves and pays after the move.
    await signIn('b@test.example');
    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('Still pending claim'));
    await screen.click(screen.byText('button', 'Approve'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    ok(markReimbursed(mB, findExpense(loadDb(), pending.id).reimbursementId, 'NEFT-NEW'));

    const after = loadDb();
    const newRecord = after.reimbursements.find((item) => item.expenseId === pending.id);
    assert.equal(newRecord.managerId, mB.id);
    assert.equal(newRecord.reimbursedById, mB.id);
    assert.equal(after.reimbursements.find((item) => item.expenseId === paid.id).managerId, mA.id, 'the old record is unchanged');
  });
});

describe('deactivation integration', () => {
  test('a deactivated employee loses the session and cannot act, and reactivation restores access', async () => {
    const { admin, e1, pA } = await makeCompany();
    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Before deactivation', projectId: pA.id }))).expense;
    await signIn('e1@test.example');
    screen = await renderApp('/employee/dashboard');
    assert.equal(screen.path, '/employee/dashboard');

    ok(setUserActive(admin, e1.id, false)); // "another tab"
    await screen.storageEvent('exc:users');
    await screen.waitFor(() => screen.path === '/login');
    assert.equal(getSessionUser(), null, 'session invalidated');

    // A stale copy of the account cannot act through the domain either.
    const db = loadDb();
    assert.equal(can(e1, 'expense.edit', findExpense(db, claim.id), db), false);
    assert.equal(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { expenseId: claim.id }).ok, false);
    assert.equal((await signIn('e1@test.example')).ok, false, 'cannot log in');
    assert.ok(findExpense(loadDb(), claim.id), 'their records are kept');
    screen.unmount();

    // Protected URLs are closed while deactivated.
    screen = await renderApp('/employee/expenses');
    assert.equal(screen.path, '/login');
    screen.unmount();

    ok(setUserActive(admin, e1.id, true));
    ok(await signIn('e1@test.example'));
    screen = await renderApp('/employee/expenses');
    assert.equal(screen.path, '/employee/expenses');
    assert.ok(screen.text.includes('Before deactivation'));
  });

  test('a manager can only be deactivated once their team is empty, and other data is untouched', async () => {
    const { admin, mA, mB, e1, e2, pA } = await makeCompany();
    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Team claim', projectId: pA.id }), { submit: true })).expense;
    ok(approveExpense(mA, claim.id));

    assert.equal(setUserActive(admin, mA.id, false).ok, false, 'refused while employees are assigned');
    ok(assignEmployee(admin, e1.id, mB.id));
    ok(assignEmployee(admin, e2.id, mB.id));
    ok(setUserActive(admin, mA.id, false));

    const db = loadDb();
    assert.equal(findExpense(db, claim.id).review.byId, mA.id, 'historical approver survives deactivation');
    assert.equal(db.reimbursements.find((item) => item.expenseId === claim.id).managerId, mA.id);
    assert.equal((await login({ email: 'a@test.example', password: PASSWORD })).ok, false);
    // The employee is unaffected and now belongs to manager B.
    ok(await signIn('e1@test.example'));
    screen = await renderApp('/employee/expenses');
    assert.ok(screen.text.includes('Team claim'));
  });
});

describe('receipt integration', () => {
  test('a receipt follows the claim and is visible only to those allowed to see the expense', async () => {
    const { mA, mB, admin, e1, e2, pA } = await makeCompany();
    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Receipt claim', projectId: pA.id }), { submit: true, receipt: receipt('bill') })).expense;
    const db = loadDb();
    const meta = findExpense(db, claim.id).receipt;
    assert.ok(loadReceipts()[meta.id], 'stored in exc:receipts');

    // The owner and the reviewing manager may see the expense (and therefore its receipt);
    // another manager and the Admin may not.
    assert.equal(canViewExpense(e1, findExpense(db, claim.id), db), true);
    assert.equal(canViewExpense(mA, findExpense(db, claim.id), db), true);
    assert.equal(canViewExpense(mB, findExpense(db, claim.id), db), false);
    assert.equal(canViewExpense(e2, findExpense(db, claim.id), db), false);
    assert.equal(canViewExpense(admin, findExpense(db, claim.id), db), false);

    await signIn('b@test.example');
    screen = await renderApp(`/expenses/${claim.id}`);
    assert.ok(screen.text.includes('Expense not found'), 'other manager sees nothing');
    assert.equal(screen.find('.receipt-thumb'), null);
    screen.unmount();

    await signIn('admin@test.example');
    screen = await renderApp(`/expenses/${claim.id}`);
    assert.equal(screen.path, '/admin/dashboard', 'admin is redirected away from the expense page');
    assert.equal(screen.find('.receipt-thumb'), null);
  });

  test('a rejected claim keeps its old image when a new one replaces it on resubmission', async () => {
    const { mA, e1, pA } = await makeCompany();
    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Swap receipt', projectId: pA.id }), { submit: true, receipt: receipt('old') })).expense;
    ok(rejectExpense(mA, claim.id, 'Wrong receipt attached.'));
    ok(saveEmployeeExpense(e1, expenseInput({ title: 'Swap receipt', projectId: pA.id }), { expenseId: claim.id, submit: true, receipt: receipt('new') }));
    assert.equal(Object.keys(loadReceipts()).length, 2, 'history still refers to the old image');
    assert.equal(findExpense(loadDb(), claim.id).receipt.fileName, 'new');
  });
});

describe('notification ownership across roles', () => {
  test('every notification reaches exactly its recipient', async () => {
    const { admin, mA, e1, pA } = await makeCompany();
    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Notify claim', projectId: pA.id }), { submit: true })).expense;
    ok(approveExpense(mA, claim.id));
    ok(markReimbursed(mA, findExpense(loadDb(), claim.id).reimbursementId, 'NEFT-N'));
    ok(setMonthlyLimit(mA, e1.id, '1000'));

    const db = loadDb();
    const types = (user) => notificationsFor(user, db).map((note) => note.type);
    assert.ok(types(mA).includes('expense_submitted'), 'manager told about the submission');
    assert.ok(types(e1).includes('expense_approved'));
    assert.ok(types(e1).includes('expense_reimbursed'));
    assert.ok(types(e1).includes('limit_set'));
    assert.ok(!types(mA).includes('expense_approved'), 'the approver is not told about their own decision');
    assert.ok(!types(admin).includes('expense_submitted'), 'the admin is never told about a claim');

    // Every stored notification belongs to exactly one recipient, and the pages show only the reader's.
    for (const note of db.notifications) assert.ok(db.users.some((user) => user.id === note.recipientId), 'valid recipient');
    await signIn('admin@test.example');
    screen = await renderApp('/notifications');
    assert.equal(screen.findAll('.notification').length, notificationsFor(admin, loadDb()).length);
    assert.ok(!screen.text.includes('Notify claim'), 'no expense title leaks into the admin’s notifications');
  });
});

describe('analytics react to each transition', () => {
  test('employee, manager and admin figures all move with the workflow', async () => {
    const { admin, mA, e1, pA } = await makeCompany();
    const snapshot = () => {
      const db = loadDb();
      return {
        employee: summarizeExpenses(visibleExpenses(e1, db)),
        manager: summarizeExpenses(visibleExpenses(mA, db)),
        company: companyAggregates(admin, db).summary,
      };
    };

    const start = snapshot();
    assert.equal(start.company.claimed.count, 0);

    const claim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Analytics claim', amount: '1000', projectId: pA.id }))).expense;
    let now = snapshot();
    assert.equal(now.employee.drafts.count, 1, 'a draft counts for the employee');
    assert.equal(now.manager.claimed.count, 0, 'but not for the manager');
    assert.equal(now.company.claimed.amount, 0, 'and not as company spending');

    ok(saveEmployeeExpense(e1, expenseInput({ title: 'Analytics claim', amount: '1000', projectId: pA.id }), { expenseId: claim.id, submit: true }));
    now = snapshot();
    assert.equal(now.employee.pending.amount, 100000);
    assert.equal(now.manager.pending.amount, 100000);
    assert.equal(now.company.pending.amount, 100000);

    ok(approveExpense(mA, claim.id));
    now = snapshot();
    assert.equal(now.employee.reimbursementPending.amount, 100000);
    assert.equal(now.manager.approved.count, 1);
    assert.equal(now.company.reimbursementPending.amount, 100000);

    ok(markReimbursed(mA, findExpense(loadDb(), claim.id).reimbursementId, 'NEFT-A'));
    now = snapshot();
    assert.equal(now.employee.reimbursed.amount, 100000);
    assert.equal(now.manager.reimbursed.amount, 100000);
    assert.equal(now.company.reimbursed.amount, 100000);

    // A rejected claim is not spending for anyone.
    const bad = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Rejected analytics', amount: '900', projectId: pA.id }), { submit: true })).expense;
    ok(rejectExpense(mA, bad.id, 'Not reimbursable.'));
    now = snapshot();
    assert.equal(now.employee.claimed.amount, 100000, 'rejected claim excluded');
    assert.equal(now.company.claimed.amount, 100000);
  });

  test('spending limits warn at the configured share and never block', async () => {
    const { mA, e1, pA } = await makeCompany();
    ok(setMonthlyLimit(mA, e1.id, '1000'));
    const submit = (amount, title) => saveEmployeeExpense(e1, expenseInput({ title, amount, projectId: pA.id }), { submit: true });

    ok(submit('800', 'Eighty percent')); // 80 % → warning
    await signIn('e1@test.example');
    screen = await renderApp('/employee/dashboard');
    assert.ok(screen.text.includes('approaching your limit'));
    assert.equal(screen.find('.meter-track').getAttribute('aria-valuenow'), '80');
    screen.unmount();

    ok(submit('300', 'Over the limit')); // 110 % → exceeded, still accepted
    assert.equal(statusOf(loadDb().expenses.find((expense) => expense.title === 'Over the limit').id), 'pending');
    screen = await renderApp('/employee/dashboard');
    assert.ok(screen.text.includes('limit exceeded'));
    screen.unmount();

    await signIn('a@test.example');
    screen = await renderApp('/manager/team');
    assert.ok(screen.text.includes('Over limit'), 'the manager sees the flag');
  });
});

describe('filters never widen access', () => {
  test('filtering by another team’s employee or project returns nothing', async () => {
    const { mA, mB, e1, e3, pA, pB } = await makeCompany();
    ok(saveEmployeeExpense(e1, expenseInput({ title: 'Alpha claim', projectId: pA.id }), { submit: true }));
    ok(saveEmployeeExpense(e3, expenseInput({ title: 'Beta claim', projectId: pB.id }), { submit: true }));
    const db = loadDb();

    // Domain level: the scope is applied before the filter, so a foreign filter value finds nothing.
    assert.deepEqual(filterExpenses(visibleExpenses(mA, db), db, { employeeId: e3.id }), []);
    assert.deepEqual(filterExpenses(visibleExpenses(mA, db), db, { projectId: pB.id }), []);
    assert.deepEqual(filterExpenses(visibleExpenses(mA, db), db, { search: 'Beta claim' }), []);
    assert.equal(filterExpenses(visibleExpenses(mB, db), db, { search: 'Beta' }).length, 1);

    // UI level: searching another team's claim shows nothing.
    await signIn('a@test.example');
    screen = await renderApp('/manager/expenses');
    await screen.change(screen.find('#search'), 'Beta claim');
    assert.ok(!screen.text.includes('Beta claim'));
    assert.ok(screen.text.includes('No expenses match these filters.'));
  });

  test('an employee’s list stays their own whatever the filters say', async () => {
    const { e1, e2, pA } = await makeCompany();
    ok(saveEmployeeExpense(e1, expenseInput({ title: 'Mine', projectId: pA.id })));
    ok(saveEmployeeExpense(e2, expenseInput({ title: 'Theirs', projectId: pA.id })));
    await signIn('e1@test.example');
    screen = await renderApp('/employee/expenses');
    await screen.change(screen.find('#search'), 'Theirs');
    assert.ok(!screen.text.includes('Theirs'));
    const db = loadDb();
    assert.deepEqual(filterExpenses(visibleExpenses(e1, db), db, { search: 'Theirs' }), []);
  });
});

describe('storage and cross-tab integration', () => {
  test('a change made elsewhere reaches an open page, and unrelated keys are untouched', async () => {
    const { mA, e1, pA } = await makeCompany();
    storage.setItem('expensex:old-app', 'keep me');
    await signIn('a@test.example');
    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('Nothing is awaiting your review.'));

    // "Another tab": the employee submits a claim.
    ok(saveEmployeeExpense(e1, expenseInput({ title: 'Arrived from another tab', projectId: pA.id }), { submit: true }));
    await screen.storageEvent('exc:expenses');
    await screen.waitFor(() => screen.text.includes('Arrived from another tab'));
    assert.ok(screen.byText('button', 'Approve'), 'the queue is actionable straight away');

    assert.equal(storage.getItem('expensex:old-app'), 'keep me');
    assert.ok(Object.keys(storage.dump()).every((key) => key.startsWith('exc:') || key === 'expensex:old-app'));
  });

  test('corrupted data shows the fatal screen and is never overwritten', async () => {
    await makeCompany();
    await signIn('e1@test.example');
    storage.setItem(KEYS.expenses, '{broken');
    screen = await renderApp('/employee/expenses');
    assert.ok(screen.text.includes("ExpenseX Corporate can't start"));
    assert.equal(storage.getItem(KEYS.expenses), '{broken');
  });

  test('missing collections fall back to empty without error', async () => {
    await makeCompany();
    await signIn('e1@test.example');
    storage.removeItem(KEYS.notifications);
    storage.removeItem(KEYS.projects);
    screen = await renderApp('/employee/dashboard');
    assert.equal(screen.path, '/employee/dashboard');
    assert.ok(screen.text.includes('No notifications yet.'));
  });
});

describe('routing matrix (direct URLs)', () => {
  test('each role reaches its own pages and is refused the others', async () => {
    const company = await makeCompany();
    const mine = ok(saveEmployeeExpense(company.e1, expenseInput({ title: 'Alpha routing claim', projectId: company.pA.id }), { submit: true })).expense;
    ok(saveEmployeeExpense(company.e3, expenseInput({ title: 'Beta routing claim', projectId: company.pB.id }), { submit: true }));

    // For each role: the pages it may open, the pages it may not, and a claim that is outside its scope
    // and must never appear on the page it is redirected to.
    const matrix = [
      {
        email: 'e1@test.example',
        allowed: ['/employee/dashboard', '/employee/expenses', '/expenses/new', '/notifications', '/profile'],
        denied: ['/manager/dashboard', '/manager/approvals', '/admin/users', '/admin/settings'],
        outOfScope: 'Beta routing claim',
      },
      {
        email: 'a@test.example',
        allowed: ['/manager/dashboard', '/manager/approvals', '/manager/team', '/expenses/new', `/expenses/${mine.id}`],
        denied: ['/employee/dashboard', '/employee/expenses', '/admin/users', '/admin/activity'],
        outOfScope: 'Beta routing claim',
      },
      {
        email: 'admin@test.example',
        allowed: ['/admin/dashboard', '/admin/users', '/admin/activity', '/admin/settings', '/notifications', '/profile'],
        denied: ['/expenses/new', `/expenses/${mine.id}`, '/manager/approvals', '/employee/expenses'],
        outOfScope: 'Alpha routing claim', // the Admin may see no individual claim at all
      },
    ];

    for (const { email, allowed, denied, outOfScope } of matrix) {
      await signIn(email);
      for (const path of allowed) {
        screen = await renderApp(path);
        assert.equal(screen.path, path, `${email} → ${path}`);
        screen.unmount();
      }
      for (const path of denied) {
        screen = await renderApp(path);
        assert.notEqual(screen.path, path, `${email} → ${path} must be refused`);
        assert.ok(!screen.text.includes(outOfScope), `${email} → ${path} leaked "${outOfScope}"`);
        screen.unmount();
      }
    }
    screen = null;
  });

  test('signed-out visitors are refused every protected route', async () => {
    await makeCompany();
    logout();
    for (const path of ['/employee/dashboard', '/manager/approvals', '/admin/users', '/expenses/new', '/notifications', '/profile']) {
      screen = await renderApp(path);
      assert.equal(screen.path, '/login', path);
      screen.unmount();
    }
    screen = null;
  });
});
