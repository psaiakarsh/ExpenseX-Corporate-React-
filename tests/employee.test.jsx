// The Employee experience: dashboard, expense list, creation, drafts, rejection/resubmission,
// detail permissions, receipts, notifications and profile — driven through the real React pages.
import { renderApp } from './dom.jsx';
import { makeCompany, ok, expenseInput, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { login, logout } from '../src/domain/auth.js';
import { approveExpense, rejectExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { markReimbursed } from '../src/domain/reimbursements.js';
import { setMonthlyLimit } from '../src/domain/users.js';
import { loadDb, loadReceipts } from '../src/domain/storage.js';

let screen;
afterEach(() => screen?.unmount());

const signIn = (email) => login({ email, password: PASSWORD });

// A company where e1 has a claim in every state that matters.
async function employeeScenario() {
  const company = await makeCompany();
  const { mA, e1, e2, pA } = company;
  ok(setMonthlyLimit(mA, e1.id, '20000'));
  const draft = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Draft dinner', amount: '900', category: 'Food', projectId: pA.id }))).expense;
  const pending = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Pending taxi', amount: '1250', projectId: pA.id }), { submit: true })).expense;
  const rejectedClaim = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Rejected dock', amount: '8999', category: 'Equipment', projectId: pA.id }), { submit: true })).expense;
  ok(rejectExpense(mA, rejectedClaim.id, 'Please raise hardware through IT procurement.'));
  const paid = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Paid flight', amount: '9800', projectId: pA.id }), { submit: true })).expense;
  ok(approveExpense(mA, paid.id));
  ok(markReimbursed(mA, loadDb().expenses.find((e) => e.id === paid.id).reimbursementId, 'NEFT-1'));
  const other = ok(saveEmployeeExpense(e2, expenseInput({ title: 'Other employee claim', projectId: pA.id }), { submit: true })).expense;
  await signIn('e1@test.example');
  return { ...company, draft, pending, rejected: rejectedClaim, paid, other };
}

describe('employee dashboard', () => {
  test('shows the employee’s own totals, limit, charts, recent claims and notifications', async () => {
    await employeeScenario();
    screen = await renderApp('/employee/dashboard');
    assert.ok(screen.text.includes('Welcome, Emp'));
    assert.ok(screen.text.includes('Manager: Manager A'));

    const stats = screen.findAll('.stat').map((stat) => stat.textContent);
    // "Spending" counts pending + approved + reimbursement pending + reimbursed: 1,250 + 9,800.
    // The draft (900) and the rejected claim (8,999) are not spending.
    assert.ok(stats.some((text) => text.includes('Total expenses') && text.includes('₹11,050.00') && text.includes('2 claims')), stats.join(' | '));
    assert.ok(stats.some((text) => text.includes('Pending') && text.includes('₹1,250.00')));
    assert.ok(stats.some((text) => text.includes('Reimbursed') && text.includes('₹9,800.00')));

    // Limit meter: 11,050 of 20,000 used this month (the rejected claim does not count).
    const meter = screen.find('.meter-track');
    assert.equal(meter.getAttribute('aria-valuenow'), '55');
    assert.match(meter.getAttribute('aria-valuetext'), /55% of monthly limit used/);

    // Analytics: monthly (with its screen-reader table), category and status charts.
    assert.ok(screen.find('.columns'), 'monthly column chart');
    assert.ok(screen.find('table.sr-only caption').textContent.includes('Your spending per month'));
    assert.ok(screen.find('.bar-list'), 'category bars');
    assert.ok(screen.find('.stacked'), 'status chart');

    assert.ok(screen.text.includes('Pending taxi'), 'recent expenses');
    assert.ok(!screen.text.includes('Other employee claim'), 'another employee’s claim never appears');
  });

  test('an employee with no manager is told drafts-only', async () => {
    const { admin } = await makeCompany();
    const { createManagedAccount } = await import('../src/domain/users.js');
    const { user } = ok(await createManagedAccount(admin, 'employee', { name: 'Solo Emp', email: 'solo@test.example', password: PASSWORD }));
    await signIn('solo@test.example');
    screen = await renderApp('/employee/dashboard');
    assert.ok(screen.text.includes('No manager assigned yet'));
    assert.ok(screen.text.includes('No limit assigned'));
    assert.equal(user.managerId, null);
  });
});

describe('expense history (own expenses only)', () => {
  test('lists own claims with status, filters, search and sort', async () => {
    await employeeScenario();
    screen = await renderApp('/employee/expenses');
    const rows = () => screen.findAll('.list-row .list-row-title').map((row) => row.textContent);
    assert.deepEqual(rows().sort(), ['Draft dinner', 'Paid flight', 'Pending taxi', 'Rejected dock']);
    assert.ok(!screen.text.includes('Other employee claim'));
    assert.ok(screen.text.includes('4 expenses in total'));

    const select = (id, value) => screen.change(screen.find(`#${id}`), value);
    await select('status', 'draft');
    assert.deepEqual(rows(), ['Draft dinner']);
    await select('status', '');
    await select('category', 'Equipment');
    assert.deepEqual(rows(), ['Rejected dock']);
    await select('category', '');

    await screen.change(screen.find('#search'), 'flight');
    assert.deepEqual(rows(), ['Paid flight']);
    await screen.change(screen.find('#search'), 'ZZZ');
    assert.ok(screen.text.includes('No expenses match these filters.'));
    await screen.change(screen.find('#search'), '');

    await select('sort', 'highest');
    assert.equal(rows()[0], 'Paid flight');
    await select('sort', 'lowest');
    assert.equal(rows()[0], 'Draft dinner');
  });

  test('"Show more" pages the list 15 at a time (V1 page size)', async () => {
    const { e1, pA } = await employeeScenario();
    for (let i = 0; i < 14; i++) {
      ok(saveEmployeeExpense(e1, expenseInput({ title: `Extra claim ${i}`, projectId: pA.id })));
    }
    screen = await renderApp('/employee/expenses');
    assert.equal(screen.findAll('.list-row').length, 15);
    assert.ok(screen.text.includes('Showing 15 of 18 matching'));
    const more = screen.byText('button', 'Show more');
    assert.equal(more.hidden, false);
    await screen.click(more);
    assert.equal(screen.findAll('.list-row').length, 18);
    assert.equal(screen.byText('button', 'Show more').hidden, true);
  });

  test('row actions follow the workflow', async () => {
    await employeeScenario();
    screen = await renderApp('/employee/expenses');
    const rowFor = (title) => screen.findAll('.list-row').find((row) => row.textContent.includes(title));
    assert.ok(rowFor('Draft dinner').textContent.includes('Edit'));
    assert.ok(rowFor('Draft dinner').textContent.includes('Delete'));
    assert.ok(rowFor('Rejected dock').textContent.includes('Edit & resubmit'));
    assert.ok(rowFor('Rejected dock').textContent.includes('Please raise hardware through IT procurement.'), 'rejection reason on the row');
    assert.ok(rowFor('Pending taxi').textContent.includes('View'));
    assert.ok(!rowFor('Pending taxi').textContent.includes('Delete'));
    assert.ok(!rowFor('Paid flight').textContent.includes('Edit'));
  });

  test('deleting a draft asks first and then removes it', async () => {
    const { draft } = await employeeScenario();
    screen = await renderApp('/employee/expenses');
    const row = screen.findAll('.list-row').find((item) => item.textContent.includes('Draft dinner'));
    await screen.click([...row.querySelectorAll('button')].find((button) => button.textContent.includes('Delete')));

    const dialog = screen.container.ownerDocument.querySelector('dialog.dialog');
    assert.ok(dialog.textContent.includes('Delete draft?'));
    await screen.click([...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Delete draft'));
    await screen.waitFor(() => !screen.text.includes('Draft dinner'));
    assert.equal(loadDb().expenses.find((expense) => expense.id === draft.id), undefined);
    assert.ok(screen.text.includes('Draft deleted.'));
  });
});

describe('expense creation', () => {
  test('saves a draft, then submits it from the edit form', async () => {
    const { pA } = await employeeScenario();
    screen = await renderApp('/expenses/new');
    const form = screen.find('form.form');
    await screen.change(screen.find('#title'), 'Client lunch');
    await screen.change(screen.find('#amount'), '1,250.50');
    await screen.change(screen.find('#category'), 'Food');
    await screen.change(screen.find('#projectId'), pA.id);
    await screen.change(screen.find('#notes'), 'With the Apollo team');
    await screen.click(screen.byText('button', 'Save draft'));

    await screen.waitFor(() => screen.path.startsWith('/expenses/') && screen.text.includes('Draft saved.'));
    const stored = loadDb().expenses.find((expense) => expense.title === 'Client lunch');
    assert.equal(stored.status, 'draft');
    assert.equal(stored.amount, 125050, 'amount parsed as paise, not floating point');
    assert.equal(stored.notes, 'With the Apollo team');
    assert.ok(screen.text.includes('₹1,250.50'));

    // Edit the draft and submit it.
    screen.unmount();
    screen = await renderApp(`/expenses/${stored.id}/edit`);
    assert.equal(screen.find('#title').value, 'Client lunch');
    await screen.change(screen.find('#amount'), '1300');
    await screen.click(screen.byText('button', 'Submit for approval'));
    await screen.waitFor(() => screen.text.includes('Expense submitted for approval.'));
    const submitted = loadDb().expenses.find((expense) => expense.id === stored.id);
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.amount, 130000);
    assert.equal(submitted.managerId, loadDb().users.find((user) => user.email === 'a@test.example').id);
  });

  test('shows the domain’s validation messages and saves nothing', async () => {
    await employeeScenario();
    const before = loadDb().expenses.length;
    screen = await renderApp('/expenses/new');
    await screen.change(screen.find('#title'), 'ab');
    await screen.change(screen.find('#amount'), '-5');
    await screen.click(screen.byText('button', 'Save draft'));
    await screen.waitFor(() => screen.text.includes('Title must be 3–80 characters.'));
    assert.ok(screen.text.includes('Enter a valid amount'));
    assert.ok(screen.text.includes('Choose a category.'));
    assert.ok(screen.text.includes('Choose a project.'));
    assert.equal(screen.find('#title').getAttribute('aria-invalid'), 'true');
    assert.equal(loadDb().expenses.length, before, 'nothing was created');
  });

  test('an employee without a manager can save a draft but cannot submit', async () => {
    const { admin } = await makeCompany();
    const { createManagedAccount } = await import('../src/domain/users.js');
    ok(await createManagedAccount(admin, 'employee', { name: 'Solo Emp', email: 'solo@test.example', password: PASSWORD }));
    await signIn('solo@test.example');
    screen = await renderApp('/expenses/new');
    assert.ok(screen.text.includes('No manager assigned yet'));
    const submit = screen.byText('button', 'Submit for approval');
    assert.equal(submit.disabled, true);
    assert.equal(submit.getAttribute('aria-describedby'), 'submit-note');

    await screen.change(screen.find('#title'), 'Laptop backpack');
    await screen.change(screen.find('#amount'), '2200');
    await screen.change(screen.find('#category'), 'Equipment');
    await screen.click(screen.byText('button', 'Save draft'));
    await screen.waitFor(() => screen.text.includes('Draft saved.'));
    assert.equal(loadDb().expenses.find((expense) => expense.title === 'Laptop backpack').status, 'draft');
  });

  test('the monthly limit preview warns without blocking', async () => {
    await employeeScenario(); // 11,050 of 20,000 used, warning at 80 %
    screen = await renderApp('/expenses/new');
    await screen.change(screen.find('#amount'), '9000');
    await screen.waitFor(() => screen.text.includes('This expense takes the month over the limit.'));
    assert.ok(screen.text.includes('You can still submit'));
    assert.equal(screen.byText('button', 'Submit for approval').disabled, false);
  });
});

describe('rejected claims', () => {
  test('show the reason, and resubmitting keeps the same expense and its whole history', async () => {
    const { rejected } = await employeeScenario();
    screen = await renderApp(`/expenses/${rejected.id}`);
    assert.ok(screen.text.includes('Please raise hardware through IT procurement.'));
    assert.ok(screen.text.includes('Rejected by Manager A'));

    await screen.click(screen.byText('a', 'Edit & resubmit'));
    await screen.waitFor(() => screen.path.endsWith('/edit'));
    assert.ok(screen.text.includes('Edit and resubmit'));
    await screen.change(screen.find('#amount'), '7500');
    await screen.click(screen.byText('button', 'Resubmit for approval'));
    await screen.waitFor(() => screen.text.includes('Expense resubmitted for approval.'));

    const stored = loadDb().expenses.find((expense) => expense.id === rejected.id);
    assert.equal(stored.id, rejected.id, 'same expense ID');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.review, null, 'the old decision no longer applies');
    assert.deepEqual(stored.history.map((entry) => entry.action), ['created', 'submitted', 'rejected', 'resubmitted']);
    assert.equal(stored.history[2].comment, 'Please raise hardware through IT procurement.');
    assert.deepEqual(stored.history[3].changes, [{ field: 'amount', from: 899900, to: 750000 }]);
    // The history is shown on the page, including the old rejection.
    assert.ok(screen.text.includes('Edited and resubmitted'));
    assert.ok(screen.text.includes('Please raise hardware through IT procurement.'));
  });
});

describe('expense detail permissions', () => {
  test('an employee sees their own claim but not another employee’s', async () => {
    const { pending, other } = await employeeScenario();
    screen = await renderApp(`/expenses/${pending.id}`);
    assert.ok(screen.text.includes('Pending taxi'));
    assert.ok(screen.text.includes('Reviewing manager'));
    screen.unmount();

    screen = await renderApp(`/expenses/${other.id}`);
    assert.ok(screen.text.includes('Expense not found, or you don’t have access to it.'));
    assert.ok(!screen.text.includes('Other employee claim'));
    screen.unmount();

    screen = await renderApp('/expenses/exp_does_not_exist');
    assert.ok(screen.text.includes('Expense not found, or you don’t have access to it.'), 'same message either way');
  });

  test('a reimbursed claim is locked and shows who approved and who paid', async () => {
    const { paid } = await employeeScenario();
    screen = await renderApp(`/expenses/${paid.id}`);
    assert.ok(screen.text.includes('View only — submitted and approved records are locked'));
    // The reimbursement card is a <dt>/<dd> list, so read each value by its term.
    const detail = (term) => screen.findAll('.details dt').find((dt) => dt.textContent === term)?.nextElementSibling?.textContent ?? '';
    assert.match(detail('Approved by'), /^Manager A · /);
    assert.match(detail('Reimbursed by'), /^Manager A · /);
    assert.equal(detail('Reference'), 'NEFT-1');
    assert.equal(screen.byText('a', 'Edit'), null, 'no edit link on a locked claim');
  });
});

describe('receipts', () => {
  test('rejects non-images and files over 5 MB without touching the form', async () => {
    await employeeScenario();
    screen = await renderApp('/expenses/new');
    await screen.setFiles(screen.find('#receipt'), [{ name: 'notes.pdf', type: 'application/pdf', size: 1000 }]);
    await screen.waitFor(() => screen.text.includes('Receipts must be images'));
    await screen.setFiles(screen.find('#receipt'), [{ name: 'huge.png', type: 'image/png', size: 6 * 1024 * 1024 }]);
    await screen.waitFor(() => screen.text.includes('The image is larger than 5 MB'));
    assert.equal(screen.find('.receipt-preview img'), null, 'no preview for a rejected file');
  });

  test('an accepted image is previewed, stored with the expense, and can be removed', async () => {
    const { pA } = await employeeScenario();
    screen = await renderApp('/expenses/new');
    await screen.setFiles(screen.find('#receipt'), [{ name: 'bill.png', type: 'image/png', size: 2048 }]);
    await screen.waitFor(() => Boolean(screen.find('.receipt-preview img')));
    assert.ok(screen.text.includes('bill.png'));

    await screen.click(screen.byText('button', 'Remove receipt'));
    assert.equal(screen.find('.receipt-preview img'), null);

    await screen.setFiles(screen.find('#receipt'), [{ name: 'bill2.png', type: 'image/png', size: 2048 }]);
    await screen.waitFor(() => Boolean(screen.find('.receipt-preview img')));
    await screen.change(screen.find('#title'), 'Hotel stay');
    await screen.change(screen.find('#amount'), '5000');
    await screen.change(screen.find('#category'), 'Accommodation');
    await screen.change(screen.find('#projectId'), pA.id);
    await screen.click(screen.byText('button', 'Save draft'));
    await screen.waitFor(() => screen.text.includes('Draft saved.'));

    const stored = loadDb().expenses.find((expense) => expense.title === 'Hotel stay');
    assert.equal(stored.receipt.fileName, 'bill2.png');
    assert.equal(stored.receipt.mimeType, 'image/jpeg', 'stored as compressed JPEG');
    assert.ok(loadReceipts()[stored.receipt.id].startsWith('data:image/jpeg'));
    assert.ok(screen.find('.receipt-thumb'), 'the detail page shows the receipt');
  });
});

describe('notifications', () => {
  test('shows only the employee’s own notifications and marks them read', async () => {
    const { mA } = await employeeScenario();
    screen = await renderApp('/notifications');
    assert.ok(screen.text.includes('Expense rejected'));
    assert.ok(screen.text.includes('Expense reimbursed'));
    assert.ok(!screen.text.includes('New expense to review'), 'the manager’s notifications are not here');

    const unreadBefore = screen.findAll('.notification.unread').length;
    assert.ok(unreadBefore > 0);
    await screen.click(screen.byText('button', 'Mark all as read'));
    await screen.waitFor(() => screen.findAll('.notification.unread').length === 0);
    assert.ok(screen.text.includes('marked as read.'));

    const db = loadDb();
    assert.equal(db.notifications.filter((n) => n.recipientId === mA.id && !n.read).length > 0, true, 'only the reader’s own were changed');
  });

  test('the unread filter shows only unread items', async () => {
    await employeeScenario();
    screen = await renderApp('/notifications');
    await screen.click(screen.byText('button', 'Unread'));
    assert.equal(screen.findAll('.notification').length, screen.findAll('.notification.unread').length);
  });
});

describe('profile', () => {
  test('changes the display name and the password, and shows account details read-only', async () => {
    await employeeScenario();
    screen = await renderApp('/profile');
    assert.ok(screen.text.includes('e1@test.example'));
    assert.ok(screen.text.includes('Employee'));
    assert.ok(screen.text.includes('Manager: Manager A'));
    assert.ok(screen.find('.meter-track'), 'own limit meter');

    await screen.change(screen.find('#name'), 'Renamed Person');
    await screen.click(screen.byText('button', 'Save name'));
    await screen.waitFor(() => screen.text.includes('Name updated.'));
    assert.equal(loadDb().users.find((user) => user.email === 'e1@test.example').name, 'Renamed Person');

    await screen.change(screen.find('#currentPassword'), 'wrong-one');
    await screen.change(screen.find('#newPassword'), 'newpass1');
    await screen.change(screen.find('#confirmPassword'), 'newpass1');
    await screen.click(screen.byText('button', 'Change password'));
    await screen.waitFor(() => screen.text.includes('Current password is incorrect.'));

    await screen.change(screen.find('#currentPassword'), PASSWORD);
    await screen.change(screen.find('#newPassword'), 'newpass1');
    await screen.change(screen.find('#confirmPassword'), 'newpass1');
    await screen.click(screen.byText('button', 'Change password'));
    await screen.waitFor(() => screen.text.includes('Password changed.'));
    logout();
    assert.equal((await signIn('e1@test.example')).ok, false, 'the old password no longer works');
    ok(await login({ email: 'e1@test.example', password: 'newpass1' }));
  });
});

describe('accessibility basics on the employee pages', () => {
  test('one h1 in the shell, labelled controls, table captions and a live region', async () => {
    await employeeScenario();
    for (const path of ['/employee/dashboard', '/employee/expenses', '/expenses/new', '/notifications', '/profile']) {
      screen = await renderApp(path);
      const doc = screen.container;
      assert.equal(doc.querySelectorAll('h1').length, 1, `one h1 on ${path}`);
      for (const control of doc.querySelectorAll('input:not([type="file"]), select, textarea')) {
        const labelled = control.labels?.length || control.getAttribute('aria-label');
        assert.ok(labelled, `control ${control.id || control.name} is labelled on ${path}`);
      }
      for (const table of doc.querySelectorAll('table')) {
        assert.ok(table.querySelector('caption'), `table has a caption on ${path}`);
      }
      assert.ok(doc.ownerDocument.querySelector('.toast-region[aria-live="polite"]'), 'toast live region exists');
      assert.ok(doc.querySelector('#main[tabindex="-1"]'), 'main is focusable for the skip link');
      screen.unmount();
    }
    screen = null;
  });
});
