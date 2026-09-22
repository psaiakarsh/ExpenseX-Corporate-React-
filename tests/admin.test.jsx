// The Admin experience: aggregates-only dashboard, user and team administration, the activity log and
// settings (including demo load/reset). Admin privacy is the thread running through all of it.
import { renderApp } from './dom.jsx';
import { makeCompany, ok, expenseInput, storage, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSessionUser, login } from '../src/domain/auth.js';
import { approveExpense, rejectExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { markReimbursed } from '../src/domain/reimbursements.js';
import { createManagedAccount } from '../src/domain/users.js';
import { KEYS, loadDb } from '../src/domain/storage.js';
import { DEMO_LOGINS } from '../src/domain/demo-data.js';

let screen;
afterEach(() => screen?.unmount());

const SECRET = 'Very Private Client Dinner';
const dialogForm = () => screen.dialog()?.querySelector('form');

// A company with claims in every state, so the admin pages have something to (not) reveal.
async function adminScenario() {
  const company = await makeCompany();
  const { mA, mB, e1, e2, e3, pA, pB } = company;
  const pending = ok(saveEmployeeExpense(e1, expenseInput({ title: SECRET, amount: '4321.99', projectId: pA.id }), { submit: true })).expense;
  const paid = ok(saveEmployeeExpense(e2, expenseInput({ title: SECRET, amount: '2000', projectId: pA.id }), { submit: true })).expense;
  ok(approveExpense(mA, paid.id));
  ok(markReimbursed(mA, loadDb().expenses.find((expense) => expense.id === paid.id).reimbursementId, 'NEFT-SECRET-1'));
  const rejected = ok(saveEmployeeExpense(e3, expenseInput({ title: SECRET, amount: '900', projectId: pB.id }), { submit: true })).expense;
  ok(rejectExpense(mB, rejected.id, 'Confidential rejection reason'));
  await login({ email: 'admin@test.example', password: PASSWORD });
  return { ...company, pending, paid, rejected };
}

describe('admin dashboard — aggregates only', () => {
  test('shows company totals and never an individual claim', async () => {
    await adminScenario();
    screen = await renderApp('/admin/dashboard');
    assert.equal(screen.path, '/admin/dashboard');
    assert.ok(screen.text.includes('Test Co'));
    assert.ok(screen.text.includes('Company-level aggregates only'));

    const stats = screen.findAll('.stat').map((stat) => stat.textContent);
    assert.ok(stats.some((text) => text.includes('Employees') && text.includes('3')), stats.join(' | '));
    assert.ok(stats.some((text) => text.includes('Managers') && text.includes('3')));
    assert.ok(stats.some((text) => text.includes('Total expenses') && text.includes('3')), 'submitted claims counted');
    assert.ok(stats.some((text) => text.includes('Company spending') && text.includes('₹6,321.99')));

    assert.ok(!screen.text.includes(SECRET), 'no expense title anywhere');
    assert.ok(!screen.text.includes('NEFT-SECRET-1'), 'no payment reference');
    assert.ok(!screen.text.includes('Confidential rejection reason'), 'no review comment');
    assert.ok(screen.find('.columns'), 'monthly chart');
    assert.ok(screen.find('.stacked'), 'status distribution');
  });

  test('team totals are privacy-protected below the threshold', async () => {
    await adminScenario();
    screen = await renderApp('/admin/dashboard');
    // Alpha has 2 employees and Beta 1, so no team reaches the 3-employee threshold.
    assert.ok(screen.text.includes('Privacy-protected'));
    assert.ok(screen.text.includes('fewer than 3 employees'));
    assert.ok(screen.text.includes('Protected teams are still included in the company totals'));
    assert.ok(screen.text.includes('What the Admin can see'));
  });

  test('links unassigned employees to the filtered user list', async () => {
    const { admin } = await adminScenario();
    ok(await createManagedAccount(admin, 'employee', { name: 'Unassigned Person', email: 'u@test.example', password: PASSWORD }));
    screen = await renderApp('/admin/dashboard');
    assert.ok(screen.text.includes('1 employee waiting for a manager'));
    // (The test router has no hash prefix; the built app uses HashRouter.)
    const link = screen.byText('a', 'Assign now');
    assert.ok(link.getAttribute('href').endsWith('/admin/users?manager=unassigned'), link.getAttribute('href'));
  });

  test('the Admin has no expense access at all, by URL or by action', async () => {
    const { pending } = await adminScenario();
    for (const path of ['/expenses/new', `/expenses/${pending.id}`, `/expenses/${pending.id}/edit`, '/manager/approvals', '/employee/expenses']) {
      screen = await renderApp(path);
      assert.equal(screen.path, '/admin/dashboard', path);
      assert.ok(!screen.text.includes(SECRET), path);
      screen.unmount();
    }
    screen = null;
  });
});

describe('admin users & teams', () => {
  test('lists every account with role, team and status — and no amounts', async () => {
    await adminScenario();
    screen = await renderApp('/admin/users');
    assert.ok(screen.text.includes('7 of 7 accounts'));
    assert.ok(screen.text.includes('Admin One'));
    assert.ok(screen.text.includes('Manager A'));
    assert.ok(screen.text.includes('Emp One'));
    assert.ok(!screen.text.includes('₹'), 'no spending figures on the user directory');
    assert.ok(!screen.text.includes(SECRET));

    await screen.change(screen.find('#role'), 'manager');
    const names = screen.findAll('tbody th').map((cell) => cell.textContent);
    assert.equal(names.length, 3);
    for (const manager of ['Manager A', 'Manager B', 'Manager C']) {
      assert.ok(names.some((text) => text.includes(manager)), manager);
    }
    await screen.change(screen.find('#role'), '');
    await screen.change(screen.find('#search'), 'e1@test');
    assert.equal(screen.findAll('tbody tr').length, 1);
  });

  test('creates a manager and an employee through the dialogs', async () => {
    await adminScenario();
    screen = await renderApp('/admin/users');

    await screen.click(screen.byText('button', 'New manager'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    let form = dialogForm();
    await screen.change(form.elements.name, 'Manager D');
    await screen.change(form.elements.email, 'd@test.example');
    await screen.change(form.elements.department, 'Delta');
    await screen.change(form.elements.password, PASSWORD);
    await screen.submit(form);
    await screen.waitFor(() => !screen.dialog());
    const manager = loadDb().users.find((user) => user.email === 'd@test.example');
    assert.equal(manager.role, 'manager');
    assert.equal(manager.department, 'Delta');

    await screen.click(screen.byText('button', 'New employee'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    form = dialogForm();
    await screen.change(form.elements.name, 'Employee D');
    await screen.change(form.elements.email, 'ed@test.example');
    await screen.change(form.elements.managerId, manager.id);
    await screen.change(form.elements.password, PASSWORD);
    await screen.submit(form);
    await screen.waitFor(() => !screen.dialog());
    const employee = loadDb().users.find((user) => user.email === 'ed@test.example');
    assert.equal(employee.role, 'user');
    assert.equal(employee.managerId, manager.id);
  });

  test('reassigns an employee: pending claims move, decided history stays', async () => {
    const { mA, mB, e1, pending, paid } = await adminScenario();
    screen = await renderApp('/admin/users');
    const row = screen.findAll('tbody tr').find((tr) => tr.textContent.includes('Emp One'));
    await screen.click([...row.querySelectorAll('button')].find((button) => button.textContent.includes('Reassign')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    assert.ok(screen.dialog().textContent.includes('Approval history is never rewritten'));
    assert.ok(!screen.dialog().textContent.includes('₹'), 'no expense figures in the assign dialog');

    await screen.change(dialogForm().elements.managerId, mB.id);
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());

    const db = loadDb();
    assert.equal(db.users.find((user) => user.id === e1.id).managerId, mB.id);
    assert.equal(db.expenses.find((expense) => expense.id === pending.id).managerId, mB.id, 'pending claim moved');
    assert.equal(db.expenses.find((expense) => expense.id === paid.id).review.byId, mA.id, 'decided claim keeps its approver');
    assert.equal(db.activity[0].action, 'employee_reassigned');
  });

  test('deactivation asks first, and a manager with a team is refused', async () => {
    const { mA, e2 } = await adminScenario();
    screen = await renderApp('/admin/users');

    const managerRow = screen.findAll('tbody tr').find((tr) => tr.textContent.includes('Manager A'));
    await screen.click([...managerRow.querySelectorAll('button')].find((button) => button.textContent.includes('Deactivate')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.click([...screen.dialog().querySelectorAll('button')].find((button) => button.textContent === 'Deactivate'));
    await screen.waitFor(() => screen.text.includes('still has'));
    assert.equal(loadDb().users.find((user) => user.id === mA.id).status, 'active', 'manager with a team stays active');

    const employeeRow = screen.findAll('tbody tr').find((tr) => tr.textContent.includes('Emp Two'));
    await screen.click([...employeeRow.querySelectorAll('button')].find((button) => button.textContent.includes('Deactivate')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.click([...screen.dialog().querySelectorAll('button')].find((button) => button.textContent === 'Deactivate'));
    await screen.waitFor(() => loadDb().users.find((user) => user.id === e2.id).status === 'inactive');
    assert.ok(screen.text.includes('deactivated.'));
    assert.equal((await login({ email: 'e2@test.example', password: PASSWORD })).ok, false, 'deactivated user cannot log in');
  });

  test('the admin cannot deactivate themselves', async () => {
    const { admin } = await adminScenario();
    screen = await renderApp('/admin/users');
    const ownRow = screen.findAll('tbody tr').find((tr) => tr.textContent.includes('(you)'));
    assert.ok(ownRow, 'own row marked');
    assert.equal([...ownRow.querySelectorAll('button')].find((button) => button.textContent.includes('Deactivate')), undefined);
    assert.equal(loadDb().users.find((user) => user.id === admin.id).status, 'active');
  });
});

describe('activity log', () => {
  test('records account and decision events without any expense detail', async () => {
    await adminScenario();
    screen = await renderApp('/admin/activity');
    assert.ok(screen.text.includes('Expense titles, amounts, comments and receipts are never logged here'));
    assert.ok(screen.text.includes('Expense approved'));
    assert.ok(screen.text.includes('Expense rejected'));
    assert.ok(screen.text.includes('Expense reimbursed'));
    assert.ok(!screen.text.includes(SECRET), 'no titles');
    assert.ok(!screen.text.includes('₹'), 'no amounts');
    assert.ok(!screen.text.includes('Confidential rejection reason'), 'no comments');
    assert.ok(!screen.text.includes('NEFT-SECRET-1'), 'no references');
  });

  test('filters by action, actor and search', async () => {
    await adminScenario();
    screen = await renderApp('/admin/activity');
    const rows = () => screen.findAll('tbody tr').length;
    const all = rows();
    await screen.change(screen.find('#action'), 'account_created');
    assert.ok(rows() < all && rows() > 0);
    await screen.change(screen.find('#action'), '');
    await screen.change(screen.find('#search'), 'zzz-no-match');
    assert.ok(screen.text.includes('No activity matches these filters.'));
  });
});

describe('admin settings', () => {
  test('saves company settings and validates the warning percentage', async () => {
    await adminScenario();
    screen = await renderApp('/admin/settings');
    await screen.change(screen.find('#limitWarningPercent'), '120');
    await screen.click(screen.byText('button', 'Save settings'));
    await screen.waitFor(() => screen.text.includes('Enter a whole number from 50 to 99.'));
    assert.equal(loadDb().settings.limitWarningPercent, 80, 'nothing saved');

    await screen.change(screen.find('#companyName'), 'Renamed Co');
    await screen.change(screen.find('#limitWarningPercent'), '75');
    await screen.click(screen.find('#allowSignup'));
    await screen.click(screen.byText('button', 'Save settings'));
    await screen.waitFor(() => screen.text.includes('Settings saved.'));
    const settings = loadDb().settings;
    assert.equal(settings.companyName, 'Renamed Co');
    assert.equal(settings.limitWarningPercent, 75);
    assert.equal(settings.allowSignup, false);
    assert.equal(loadDb().activity[0].action, 'settings_updated');
  });

  test('shows storage usage', async () => {
    await adminScenario();
    screen = await renderApp('/admin/settings');
    const meter = screen.findAll('.meter-track').at(-1);
    assert.equal(meter.getAttribute('aria-label'), 'Browser storage used');
    assert.ok(screen.text.includes('of ~5.0 MB'));
  });

  test('loading the demo needs the typed word, then replaces everything and logs out', async () => {
    await adminScenario();
    storage.setItem('expensex:old-app', 'keep me');
    screen = await renderApp('/admin/settings');
    assert.ok(screen.text.includes('Custom company'));

    await screen.click(screen.byText('button', 'Load Demo Company'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    // The wrong word is refused.
    await screen.change(dialogForm().elements.typed, 'replace');
    await screen.submit(dialogForm());
    await screen.waitFor(() => screen.dialog()?.textContent.includes('Type REPLACE exactly.'));
    assert.equal(loadDb().settings.companyName, 'Test Co', 'nothing replaced yet');

    await screen.change(dialogForm().elements.typed, 'REPLACE');
    await screen.submit(dialogForm());
    await screen.waitFor(() => screen.path === '/login', { timeout: 5000 });

    const db = loadDb();
    assert.equal(db.settings.companyName, 'Verdant Systems Pvt Ltd');
    assert.equal(db.settings.demoLoaded, true);
    assert.equal(db.users.length, 14);
    assert.equal(getSessionUser(), null, 'everyone is logged out');
    assert.equal(storage.getItem('expensex:old-app'), 'keep me', 'other keys untouched');
    assert.ok(screen.text.includes('Demo company loaded.'));
    assert.ok(screen.text.includes('Demo accounts'), 'the login page offers the demo accounts');
  });

  test('reset is offered only once the demo is loaded, and recreates it', async () => {
    await adminScenario();
    screen = await renderApp('/admin/settings');
    assert.equal(screen.byText('button', 'Reset Demo Data').disabled, true);
    screen.unmount();

    // Load the demo through the domain, then sign in as its admin and reset from the UI.
    const { loadDemoCompany } = await import('../src/domain/demo-data.js');
    const { user: admin } = await login({ email: 'admin@test.example', password: PASSWORD });
    ok(await loadDemoCompany(admin));
    ok(await login({ email: DEMO_LOGINS[0].email, password: 'Demo@123' }));
    screen = await renderApp('/admin/settings');
    assert.ok(screen.text.includes('Demo loaded'));
    const reset = screen.byText('button', 'Reset Demo Data');
    assert.equal(reset.disabled, false);

    await screen.click(reset);
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.typed, 'RESET');
    await screen.submit(dialogForm());
    await screen.waitFor(() => screen.path === '/login', { timeout: 5000 });
    const db = loadDb();
    assert.equal(db.activity[0].action, 'demo_reset');
    assert.equal(db.users.length, 14);
    assert.equal(getSessionUser(), null);
  });
});

describe('accessibility basics on the admin pages', () => {
  test('one h1, labelled controls, captioned tables and a live region', async () => {
    await adminScenario();
    for (const path of ['/admin/dashboard', '/admin/users', '/admin/activity', '/admin/settings']) {
      screen = await renderApp(path);
      const doc = screen.container;
      assert.equal(doc.querySelectorAll('h1').length, 1, `one h1 on ${path}`);
      for (const control of doc.querySelectorAll('input:not([type="file"]), select, textarea')) {
        assert.ok(control.labels?.length || control.getAttribute('aria-label'), `labelled control on ${path}`);
      }
      for (const table of doc.querySelectorAll('table')) {
        assert.ok(table.querySelector('caption'), `captioned table on ${path}`);
      }
      assert.ok(doc.querySelector('#main[tabindex="-1"]'), `focusable main on ${path}`);
      assert.ok(doc.ownerDocument.querySelector('.toast-region[aria-live="polite"]'), 'toast live region');
      screen.unmount();
    }
    screen = null;
  });
});
