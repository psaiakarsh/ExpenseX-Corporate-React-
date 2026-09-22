// The Manager experience: dashboard, approvals and rejection, manager-created claims, reimbursements,
// team isolation (UI and direct URL), team management, projects, limits, analytics and notifications.
import { renderApp } from './dom.jsx';
import { makeCompany, ok, expenseInput, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/domain/auth.js';
import { approveExpense, rejectExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { markReimbursed } from '../src/domain/reimbursements.js';
import { assignEmployee, setMonthlyLimit } from '../src/domain/users.js';
import { createProject } from '../src/domain/projects.js';
import { commit, loadDb } from '../src/domain/storage.js';

let screen;
afterEach(() => screen?.unmount());

const signIn = (email) => login({ email, password: PASSWORD });

// Alpha (manager A): e1 with a pending claim and a private draft, e2 with a claim already approved.
// Beta (manager B): e3 with a pending claim — manager A must never see it.
async function managerScenario() {
  const company = await makeCompany();
  const { mA, mB, e1, e2, e3, pA, pB } = company;
  ok(setMonthlyLimit(mA, e1.id, '20000'));
  ok(setMonthlyLimit(mA, e2.id, '1000'));
  const pending = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Alpha pending taxi', amount: '1250', projectId: pA.id }), { submit: true })).expense;
  const draft = ok(saveEmployeeExpense(e1, expenseInput({ title: 'Alpha private draft', amount: '500', projectId: pA.id }))).expense;
  const approved = ok(saveEmployeeExpense(e2, expenseInput({ title: 'Alpha approved hotel', amount: '2000', projectId: pA.id }), { submit: true })).expense;
  ok(approveExpense(mA, approved.id));
  const otherTeam = ok(saveEmployeeExpense(e3, expenseInput({ title: 'Beta secret claim', amount: '4000', projectId: pB.id }), { submit: true })).expense;
  await signIn('a@test.example');
  return { ...company, pending, draft, approved, otherTeam };
}

const dialogForm = () => screen.dialog()?.querySelector('form');

describe('manager dashboard', () => {
  test('summarises the team, the queue, limits and activity — own scope only', async () => {
    await managerScenario();
    screen = await renderApp('/manager/dashboard');
    const stats = screen.findAll('.stat').map((stat) => stat.textContent);
    assert.ok(stats.some((text) => text.includes('Team size') && text.includes('2')), stats.join(' | '));
    assert.ok(stats.some((text) => text.includes('Pending approvals') && text.includes('₹1,250.00')));
    assert.ok(stats.some((text) => text.includes('Reimbursement pending') && text.includes('₹2,000.00')));

    assert.ok(screen.text.includes('Alpha pending taxi'), 'the queue shows the pending claim');
    assert.ok(!screen.text.includes('Alpha private draft'), 'an employee’s unsent draft is never shown');
    assert.ok(!screen.text.includes('Beta secret claim'), 'another team never appears');

    assert.ok(screen.byText('button', 'Approve'), 'approve action on the queue');
    assert.ok(screen.find('.columns'), 'monthly chart');
    assert.ok(screen.findAll('table caption').some((caption) => caption.textContent.includes('Spending per employee')), 'employee summary table');
    assert.ok(screen.text.includes('Emp Two'), 'team member listed');
  });

  test('flags an employee over their limit but never blocks them', async () => {
    const { mA, e2, pA } = await managerScenario();
    ok(saveEmployeeExpense(e2, expenseInput({ title: 'Over limit lunch', amount: '900', projectId: pA.id }), { submit: true }));
    screen = await renderApp('/manager/dashboard');
    assert.ok(screen.text.includes('Over limit') || screen.text.includes('Near limit'), 'limit flag shown');
    const meter = screen.findAll('.meter-track').at(-1);
    assert.ok(Number(meter.getAttribute('aria-valuenow')) >= 80);
    assert.equal(loadDb().expenses.find((expense) => expense.title === 'Over limit lunch').status, 'pending', 'submission still went through');
    assert.ok(setMonthlyLimit(mA, e2.id, '1000').ok);
  });
});

describe('approvals', () => {
  test('lists only claims awaiting this manager, and approves through the dialog', async () => {
    const { pending } = await managerScenario();
    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('1 expense awaiting your review · ₹1,250.00'));
    assert.deepEqual(screen.findAll('.list-row-title').map((row) => row.textContent), ['Alpha pending taxi']);

    await screen.click(screen.byText('button', 'Approve'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    assert.ok(screen.dialog().textContent.includes('Approving creates a reimbursement record'));
    await screen.change(dialogForm().elements.comment, 'Looks fine.');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());

    const stored = loadDb().expenses.find((expense) => expense.id === pending.id);
    assert.equal(stored.status, 'reimbursement_pending');
    assert.equal(stored.review.byId, loadDb().users.find((user) => user.email === 'a@test.example').id);
    assert.equal(stored.review.comment, 'Looks fine.');
    assert.deepEqual(stored.history.map((entry) => entry.action), ['created', 'submitted', 'approved', 'reimbursement_queued']);
    assert.ok(screen.text.includes('Expense approved. Reimbursement is now pending.'));
    assert.ok(screen.text.includes('All caught up'), 'the queue empties');
  });

  test('rejection requires a comment of at least 5 characters', async () => {
    const { pending } = await managerScenario();
    screen = await renderApp('/manager/approvals');
    await screen.click(screen.byText('button', 'Reject'));
    await screen.waitFor(() => Boolean(screen.dialog()));

    await screen.change(dialogForm().elements.comment, 'no');
    await screen.submit(dialogForm());
    await screen.waitFor(() => screen.dialog()?.textContent.includes('Explain the rejection'));
    assert.equal(loadDb().expenses.find((expense) => expense.id === pending.id).status, 'pending', 'still pending after a refused rejection');

    await screen.change(dialogForm().elements.comment, 'Please attach the cab receipt.');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());

    const stored = loadDb().expenses.find((expense) => expense.id === pending.id);
    assert.equal(stored.status, 'rejected');
    assert.equal(stored.review.comment, 'Please attach the cab receipt.');
    assert.ok(loadDb().notifications.some((note) => note.type === 'expense_rejected' && note.message.includes('Please attach the cab receipt.')));
  });

  test('the "Rejected by me" and "Approved by me" views', async () => {
    const { mA, pending, approved } = await managerScenario();
    ok(rejectExpense(mA, pending.id, 'Needs the receipt attached.'));
    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('Nothing is awaiting your review.'));

    await screen.change(screen.find('#view'), 'rejected');
    assert.deepEqual(screen.findAll('.list-row-title').map((row) => row.textContent), ['Alpha pending taxi']);
    await screen.change(screen.find('#view'), 'approved');
    assert.deepEqual(screen.findAll('.list-row-title').map((row) => row.textContent), ['Alpha approved hotel']);
    assert.equal(loadDb().expenses.find((expense) => expense.id === approved.id).status, 'reimbursement_pending');
  });

  test('PENDING → REJECTED → EDIT → PENDING keeps the ID and the whole history', async () => {
    const { mA, e1, pending, pA } = await managerScenario();
    ok(rejectExpense(mA, pending.id, 'Amount does not match the trips.'));
    // The employee edits and resubmits (their side is covered in Phase 3).
    ok(saveEmployeeExpense(e1, expenseInput({ title: 'Alpha pending taxi', amount: '1000', projectId: pA.id }), { expenseId: pending.id, submit: true }));

    screen = await renderApp('/manager/approvals');
    const stored = loadDb().expenses.find((expense) => expense.id === pending.id);
    assert.equal(stored.id, pending.id);
    assert.equal(stored.status, 'pending');
    assert.equal(stored.review, null);
    assert.deepEqual(stored.history.map((entry) => entry.action), ['created', 'submitted', 'rejected', 'resubmitted']);
    assert.ok(screen.text.includes('Resubmitted'), 'the row is flagged as resubmitted');
    assert.ok(screen.byText('button', 'Approve'), 'it is back in the queue');
  });
});

describe('review authority (defensive states)', () => {
  // A claim can be visible to a manager while belonging to someone else's review queue. Normal use does
  // not produce this (reassignment moves pending claims), so the state is built directly to pin the rule
  // that the queue and the buttons follow can('expense.review'), not merely "pending and visible".
  test('a pending claim assigned to another manager is visible but not reviewable', async () => {
    const { mB, pending } = await managerScenario();
    const db = loadDb();
    db.expenses.find((expense) => expense.id === pending.id).managerId = mB.id;
    commit(db, ['expenses']);

    screen = await renderApp('/manager/approvals');
    assert.ok(screen.text.includes('Nothing is awaiting your review.'), 'not in this manager’s queue');
    assert.equal(screen.byText('button', 'Approve'), null);
    screen.unmount();

    // It is still in the manager's scope (their team member submitted it) but carries no review actions.
    screen = await renderApp('/manager/expenses');
    assert.ok(screen.text.includes('Alpha pending taxi'), 'still visible as a team expense');
    assert.equal(screen.byText('button', 'Approve'), null, 'no approve action');
    assert.equal(screen.byText('button', 'Reject'), null, 'no reject action');
    screen.unmount();

    screen = await renderApp(`/expenses/${pending.id}`);
    assert.ok(screen.text.includes('Alpha pending taxi'));
    assert.equal(screen.byText('button', 'Approve'), null, 'no approve action on the detail page');
  });

  test('an employee never sees a "Mark as reimbursed" action on their own claim', async () => {
    const { approved } = await managerScenario();
    await signIn('e2@test.example');
    screen = await renderApp(`/expenses/${approved.id}`);
    assert.ok(screen.text.includes('Alpha approved hotel'));
    assert.ok(screen.text.includes('Reimbursement Pending') || screen.text.includes('Reimbursement pending'));
    assert.equal(screen.byText('button', 'Mark as reimbursed'), null);
    assert.equal(screen.byText('button', 'Approve'), null);
  });
});

describe('team isolation', () => {
  test('another team’s claim is absent from every manager list', async () => {
    await managerScenario();
    for (const path of ['/manager/expenses', '/manager/approvals', '/manager/analytics', '/manager/reimbursements']) {
      screen = await renderApp(path);
      assert.ok(!screen.text.includes('Beta secret claim'), path);
      assert.ok(!screen.text.includes('Emp Three'), path);
      screen.unmount();
    }
    screen = null;
  });

  test('a direct URL to another team’s expense is refused', async () => {
    const { otherTeam } = await managerScenario();
    screen = await renderApp(`/expenses/${otherTeam.id}`);
    assert.ok(screen.text.includes('Expense not found, or you don’t have access to it.'));
    assert.ok(!screen.text.includes('Beta secret claim'));
    assert.equal(screen.byText('button', 'Approve'), null, 'no review actions on a claim outside the team');
  });

  test('a manager cannot reach admin or employee pages', async () => {
    await managerScenario();
    for (const path of ['/admin/users', '/admin/settings', '/admin/activity', '/employee/dashboard', '/employee/expenses']) {
      screen = await renderApp(path);
      assert.equal(screen.path, '/manager/dashboard', path);
      screen.unmount();
    }
    screen = null;
  });

  test('an employee’s own draft never appears for the manager', async () => {
    const { draft } = await managerScenario();
    screen = await renderApp(`/expenses/${draft.id}`);
    assert.ok(screen.text.includes('Expense not found, or you don’t have access to it.'));
  });
});

describe('manager-created expenses', () => {
  test('for themselves: self-approved, straight to Reimbursement Pending, never in the queue', async () => {
    const { mA, pA } = await managerScenario();
    screen = await renderApp('/expenses/new');
    assert.ok(screen.find('#employeeId'), 'the "Expense for" field is shown to managers');
    assert.ok(screen.text.includes('approved straight away'));

    await screen.change(screen.find('#title'), 'Leadership offsite');
    await screen.change(screen.find('#amount'), '14500');
    await screen.change(screen.find('#category'), 'Accommodation');
    await screen.change(screen.find('#projectId'), pA.id);
    await screen.click(screen.byText('button', 'Create & approve'));
    await screen.waitFor(() => screen.text.includes('self-approved'));

    const stored = loadDb().expenses.find((expense) => expense.title === 'Leadership offsite');
    assert.equal(stored.employeeId, mA.id);
    assert.equal(stored.selfApproved, true);
    assert.equal(stored.status, 'reimbursement_pending');
    assert.deepEqual(stored.history.map((entry) => entry.action), ['created_approved', 'reimbursement_queued']);
    screen.unmount();

    screen = await renderApp('/manager/approvals');
    assert.ok(!screen.text.includes('Leadership offsite'), 'manager-created claims are never queued for review');
  });

  test('for a team member: approved on creation and the employee is notified', async () => {
    const { e1, pA } = await managerScenario();
    screen = await renderApp('/expenses/new');
    await screen.change(screen.find('#employeeId'), e1.id);
    await screen.change(screen.find('#title'), 'Team hackathon supplies');
    await screen.change(screen.find('#amount'), '3200');
    await screen.change(screen.find('#category'), 'Office Supplies');
    await screen.change(screen.find('#projectId'), pA.id);
    await screen.click(screen.byText('button', 'Create & approve'));
    await screen.waitFor(() => screen.text.includes('The employee has been notified.'));

    const stored = loadDb().expenses.find((expense) => expense.title === 'Team hackathon supplies');
    assert.equal(stored.employeeId, e1.id);
    assert.equal(stored.selfApproved, false);
    assert.equal(stored.status, 'reimbursement_pending');
    assert.ok(loadDb().notifications.some((note) => note.recipientId === e1.id && note.type === 'expense_created_for_you'));
  });

  test('only the manager’s own team appears in "Expense for"', async () => {
    const { mA, e1, e2 } = await managerScenario();
    screen = await renderApp('/expenses/new');
    const options = [...screen.find('#employeeId').options].map((option) => option.value);
    assert.deepEqual(options.sort(), [mA.id, e1.id, e2.id].sort(), 'self + own active team only');
  });
});

describe('reimbursements', () => {
  test('pays a pending record and keeps the approver as history', async () => {
    const { mA, approved } = await managerScenario();
    screen = await renderApp('/manager/reimbursements');
    assert.ok(screen.text.includes('Alpha approved hotel'));
    const stats = screen.findAll('.stat').map((stat) => stat.textContent);
    assert.ok(stats.some((text) => text.includes('Awaiting payout') && text.includes('₹2,000.00')), stats.join(' | '));

    await screen.click(screen.byText('button', 'Mark reimbursed'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.reference, 'NEFT-99');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());

    const db = loadDb();
    const record = db.reimbursements.find((item) => item.expenseId === approved.id);
    assert.equal(record.status, 'reimbursed');
    assert.equal(record.managerId, mA.id, 'approver preserved');
    assert.equal(record.reimbursedById, mA.id);
    assert.ok(record.reimbursedAt);
    assert.equal(record.reference, 'NEFT-99');
    assert.equal(db.expenses.find((expense) => expense.id === approved.id).status, 'reimbursed');

    await screen.click(screen.byText('button', 'Reimbursed'));
    const header = screen.findAll('th').map((cell) => cell.textContent);
    assert.ok(header.includes('Reimbursed by'));
    assert.ok(screen.text.includes('NEFT-99'));
  });

  test('after a reassignment only the new manager can pay, and both names are kept', async () => {
    const { admin, mA, mB, e2, approved } = await managerScenario();
    ok(assignEmployee(admin, e2.id, mB.id));

    screen = await renderApp('/manager/reimbursements'); // still signed in as manager A
    assert.ok(!screen.text.includes('Alpha approved hotel'), 'the old manager loses the record');
    screen.unmount();

    await signIn('b@test.example');
    screen = await renderApp('/manager/reimbursements');
    assert.ok(screen.text.includes('Alpha approved hotel'), 'the new manager sees it');
    await screen.click(screen.byText('button', 'Mark reimbursed'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());

    const record = loadDb().reimbursements.find((item) => item.expenseId === approved.id);
    assert.equal(record.managerId, mA.id, 'approved by the original manager');
    assert.equal(record.reimbursedById, mB.id, 'paid by the current manager');
    screen.unmount();

    screen = await renderApp(`/expenses/${approved.id}`);
    const detail = (term) => screen.findAll('.details dt').find((dt) => dt.textContent === term)?.nextElementSibling?.textContent ?? '';
    assert.match(detail('Approved by'), /^Manager A · /);
    assert.match(detail('Reimbursed by'), /^Manager B · /);
  });
});

describe('team management', () => {
  test('lists the team with limit usage and sets a limit', async () => {
    const { e1 } = await managerScenario();
    screen = await renderApp('/manager/team');
    assert.ok(screen.text.includes('Emp One'));
    assert.ok(screen.text.includes('Emp Two'));
    assert.ok(!screen.text.includes('Emp Three'), 'another team is not listed');
    assert.ok(screen.text.includes('warnings only'), 'the warn-only rule is stated');

    const row = screen.findAll('tbody tr').find((tr) => tr.textContent.includes('Emp One'));
    await screen.click([...row.querySelectorAll('button')].find((button) => button.textContent.includes('Set limit')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.limit, '25000');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    assert.equal(loadDb().users.find((user) => user.id === e1.id).monthlyLimit, 2500000);
    assert.ok(screen.text.includes('Limit for Emp One saved.'));
  });

  test('adds an employee to the manager’s own team only, with no admin powers offered', async () => {
    const { mA } = await managerScenario();
    screen = await renderApp('/manager/team');
    assert.equal(screen.byText('button', 'Deactivate'), null, 'no deactivate control');
    assert.equal(screen.byText('button', 'Reassign'), null, 'no reassign control');

    await screen.click(screen.byText('button', 'Add employee'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    const form = dialogForm();
    await screen.change(form.elements.name, 'New Starter');
    await screen.change(form.elements.email, 'starter@test.example');
    await screen.change(form.elements.password, PASSWORD);
    await screen.submit(form);
    await screen.waitFor(() => !screen.dialog());

    const created = loadDb().users.find((user) => user.email === 'starter@test.example');
    assert.equal(created.role, 'user');
    assert.equal(created.managerId, mA.id);
  });
});

describe('projects', () => {
  test('creates, edits and deactivates the manager’s own projects', async () => {
    const { mB, pB } = await managerScenario();
    ok(createProject(mB, { name: 'Beta only project', description: '' }));
    screen = await renderApp('/manager/projects');
    assert.ok(screen.text.includes('Alpha Project'));
    assert.ok(!screen.text.includes('Beta only project'), 'another manager’s project is not listed');
    assert.ok(!screen.text.includes(pB.name));

    await screen.click(screen.byText('button', 'New project'));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.change(dialogForm().elements.name, 'Cloud Migration');
    await screen.change(dialogForm().elements.description, 'Move services to the cloud');
    await screen.submit(dialogForm());
    await screen.waitFor(() => !screen.dialog());
    const created = loadDb().projects.find((project) => project.name === 'Cloud Migration');
    assert.equal(created.managerId, loadDb().users.find((user) => user.email === 'a@test.example').id);
    assert.equal(created.status, 'active');

    // Deactivate it: confirmation first, then it leaves the employees' picker.
    const row = screen.findAll('.list-row').find((item) => item.textContent.includes('Cloud Migration'));
    await screen.click([...row.querySelectorAll('button')].find((button) => button.textContent.includes('Deactivate')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    await screen.click([...screen.dialog().querySelectorAll('button')].find((button) => button.textContent === 'Deactivate'));
    await screen.waitFor(() => loadDb().projects.find((project) => project.id === created.id).status === 'archived');
    assert.ok(screen.text.includes('Project deactivated.'));
  });

  test('shows per-project spending and a details dialog', async () => {
    await managerScenario();
    screen = await renderApp('/manager/projects');
    const row = screen.findAll('.list-row').find((item) => item.textContent.includes('Alpha Project'));
    assert.ok(row.textContent.includes('₹'), 'project spending shown');
    await screen.click([...row.querySelectorAll('button')].find((button) => button.textContent.includes('Details')));
    await screen.waitFor(() => Boolean(screen.dialog()));
    assert.ok(screen.dialog().textContent.includes('Spending by person'));
    assert.ok(screen.dialog().textContent.includes('Emp One'));
  });
});

describe('analytics', () => {
  test('covers the manager’s scope with period, employee and project filters', async () => {
    const { e1 } = await managerScenario();
    screen = await renderApp('/manager/analytics');
    const stats = screen.findAll('.stat').map((stat) => stat.textContent);
    assert.ok(stats.some((text) => text.includes('Spending') && text.includes('₹3,250.00')), stats.join(' | '));
    assert.ok(stats.some((text) => text.includes('Approval rate')));
    assert.ok(screen.find('.columns'), 'monthly chart');
    assert.equal(screen.findAll('.bar-list').length, 2, 'category and project charts');
    assert.ok(screen.find('.stacked'), 'status distribution');
    assert.ok(screen.findAll('table caption').some((caption) => caption.textContent.includes('Spending per person')));
    assert.ok(!screen.text.includes('Beta secret claim'));

    await screen.change(screen.find('#employeeId'), e1.id);
    // Read the employee table, not the page text: the filter menu lists every team member by name, and
    // the monthly chart has its own screen-reader table.
    const employeeTable = () => screen.findAll('table').find((table) => table.querySelector('caption')?.textContent.includes('Spending per person'));
    const people = () => [...employeeTable().querySelectorAll('tbody th')].map((cell) => cell.textContent);
    assert.deepEqual(people(), ['Emp One'], 'filtered to one employee');
    await screen.change(screen.find('#months'), '3');
    assert.ok(screen.text.includes('Spending'));
  });
});

describe('manager notifications', () => {
  test('shows only this manager’s notifications', async () => {
    const { mA, mB } = await managerScenario();
    screen = await renderApp('/notifications');
    const db = loadDb();
    const mine = db.notifications.filter((note) => note.recipientId === mA.id);
    assert.equal(screen.findAll('.notification').length, mine.length);
    assert.ok(screen.text.includes('New expense to review'));
    const otherOnly = db.notifications
      .filter((note) => note.recipientId === mB.id)
      .filter((note) => !mine.some((own) => own.message === note.message));
    for (const note of otherOnly) assert.ok(!screen.text.includes(note.message), 'another manager’s notification leaked');
  });
});

describe('accessibility basics on the manager pages', () => {
  test('one h1, labelled controls, captioned tables and a live region', async () => {
    await managerScenario();
    const paths = ['/manager/dashboard', '/manager/approvals', '/manager/expenses', '/manager/reimbursements', '/manager/team', '/manager/projects', '/manager/analytics'];
    for (const path of paths) {
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

  test('a review dialog traps focus, closes on Escape and returns focus to its button', async () => {
    await managerScenario();
    screen = await renderApp('/manager/approvals');
    const approve = screen.byText('button', 'Approve');
    approve.focus();
    await screen.click(approve);
    await screen.waitFor(() => Boolean(screen.dialog()));
    const dialog = screen.dialog();
    assert.ok(dialog.contains(screen.container.ownerDocument.activeElement), 'focus moves inside the dialog');

    await screen.press(dialog, 'Escape');
    await screen.waitFor(() => !screen.dialog());
    assert.ok(screen.container.ownerDocument.activeElement === approve, 'focus returns to the opener');
    assert.equal(loadDb().expenses.find((expense) => expense.title === 'Alpha pending taxi').status, 'pending', 'Escape decided nothing');
  });
});
