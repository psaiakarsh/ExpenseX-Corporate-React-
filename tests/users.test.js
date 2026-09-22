import { reset, makeCompany, PASSWORD, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assignEmployee, createManagedAccount, setMonthlyLimit, setUserActive } from '../src/domain/users.js';
import { login } from '../src/domain/auth.js';
import { commit, loadDb } from '../src/domain/storage.js';
import { findUser } from '../src/domain/permissions.js';
import { approveExpense, saveEmployeeExpense } from '../src/domain/expenses.js';

const account = (email, extra = {}) => ({ name: 'New Person', email, password: PASSWORD, ...extra });

describe('account provisioning', () => {
  beforeEach(reset);

  test('only the Admin creates managers, and a department is required', async () => {
    const { admin, mA, e1 } = await makeCompany();
    assert.equal((await createManagedAccount(mA, 'manager', account('m@x.example', { department: 'Ops' }))).ok, false);
    assert.equal((await createManagedAccount(e1, 'manager', account('m@x.example', { department: 'Ops' }))).ok, false);
    const missing = await createManagedAccount(admin, 'manager', account('m@x.example'));
    assert.match(missing.errors.department, /Department/);
    const { user } = ok(await createManagedAccount(admin, 'manager', account('m@x.example', { department: 'Ops' })));
    assert.equal(user.role, 'manager');
    assert.equal(user.managerId, null);
    assert.equal(loadDb().activity[0].action, 'account_created');
  });

  test('a manager can only add employees to their own team', async () => {
    const { mA, mB, e1 } = await makeCompany();
    const { user } = ok(await createManagedAccount(mA, 'employee', account('n@x.example', { managerId: mB.id, role: 'admin' })));
    assert.equal(user.role, 'user');
    assert.equal(user.managerId, mA.id);
    assert.equal((await createManagedAccount(e1, 'employee', account('z@x.example'))).ok, false, 'employees cannot create accounts');
  });

  test('the Admin may create an unassigned employee, or assign an active manager only', async () => {
    const { admin, mA, mC } = await makeCompany();
    const { user } = ok(await createManagedAccount(admin, 'employee', account('u@x.example', { managerId: '' })));
    assert.equal(user.managerId, null);

    ok(setUserActive(admin, mC.id, false));
    const inactive = await createManagedAccount(admin, 'employee', account('v@x.example', { managerId: mC.id }));
    assert.match(inactive.errors.managerId, /active manager/);

    const { user: assigned } = ok(await createManagedAccount(admin, 'employee', account('w@x.example', { managerId: mA.id })));
    const db = loadDb();
    assert.ok(db.notifications.some((n) => n.recipientId === assigned.id && n.type === 'welcome'));
    assert.ok(db.notifications.some((n) => n.recipientId === mA.id && n.type === 'team_joined'));
  });

  test('duplicate emails are refused', async () => {
    const { admin } = await makeCompany();
    const result = await createManagedAccount(admin, 'employee', account('A@TEST.example'));
    assert.match(result.errors.email, /already exists/);
  });
});

describe('activation', () => {
  beforeEach(reset);

  test('only the Admin, never on themselves', async () => {
    const { admin, mA, e1 } = await makeCompany();
    assert.equal(setUserActive(mA, e1.id, false).ok, false);
    assert.match(setUserActive(admin, admin.id, false).error, /your own account/);
  });

  test('a manager with any assigned employee (even inactive) cannot be deactivated', async () => {
    const { admin, mB, e3 } = await makeCompany();
    ok(setUserActive(admin, e3.id, false));
    assert.match(setUserActive(admin, mB.id, false).error, /1 assigned employee/);
  });

  test('a manager without a team can be deactivated; records are kept', async () => {
    const { admin, mC } = await makeCompany();
    ok(setUserActive(admin, mC.id, false));
    const db = loadDb();
    assert.equal(findUser(db, mC.id).status, 'inactive');
    assert.equal(db.activity[0].action, 'account_deactivated');
    assert.equal((await login({ email: 'c@test.example', password: PASSWORD })).ok, false);
    ok(setUserActive(admin, mC.id, true));
    ok(await login({ email: 'c@test.example', password: PASSWORD }));
  });

  test('reactivating an employee whose manager is inactive clears the manager (defensive guard)', async () => {
    const { admin, mC, e3 } = await makeCompany();
    ok(setUserActive(admin, e3.id, false));
    ok(setUserActive(admin, mC.id, false));
    // The UI can't produce this state (managers with a team can't be deactivated), so build it directly.
    const db = loadDb();
    findUser(db, e3.id).managerId = mC.id;
    commit(db, ['users']);
    ok(setUserActive(admin, e3.id, true));
    assert.equal(findUser(loadDb(), e3.id).managerId, null);
  });
});

describe('assignment and reassignment', () => {
  beforeEach(reset);

  test('only PENDING claims move; decided claims keep their original reviewer', async () => {
    const { admin, mA, mB, e1, pA } = await makeCompany();
    const pending = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title: 'Pending claim' }), { submit: true })).expense;
    const decided = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title: 'Decided claim' }), { submit: true })).expense;
    ok(approveExpense(mA, decided.id));
    ok(setMonthlyLimit(mA, e1.id, '5000'));

    const { movedCount } = ok(assignEmployee(admin, e1.id, mB.id));
    assert.equal(movedCount, 1);
    const db = loadDb();
    const moved = db.expenses.find((e) => e.id === pending.id);
    const kept = db.expenses.find((e) => e.id === decided.id);
    assert.equal(moved.managerId, mB.id);
    assert.deepEqual(moved.history.at(-1).action, 'reassigned');
    assert.match(moved.history.at(-1).comment, /from Manager A to Manager B/);
    assert.equal(kept.managerId, mA.id, 'approved claim keeps its reviewer');
    assert.equal(kept.review.byId, mA.id);
    assert.ok(!kept.history.some((h) => h.action === 'reassigned'));
    assert.equal(findUser(db, e1.id).monthlyLimit, null, 'limits are set by each manager for their own team');
  });

  test('notifies employee, new and previous manager, and logs the reassignment', async () => {
    const { admin, mA, mB, e1 } = await makeCompany();
    ok(assignEmployee(admin, e1.id, mB.id));
    const db = loadDb();
    const types = (id) => db.notifications.filter((n) => n.recipientId === id).map((n) => n.type);
    assert.ok(types(e1.id).includes('manager_assigned'));
    assert.ok(types(mB.id).includes('team_joined'));
    assert.ok(types(mA.id).includes('team_left'));
    assert.equal(db.activity[0].action, 'employee_reassigned');
  });

  test('first assignment of an unassigned employee is logged as an assignment', async () => {
    const { admin, mA } = await makeCompany();
    const { user } = ok(await createManagedAccount(admin, 'employee', account('u@x.example')));
    ok(assignEmployee(admin, user.id, mA.id));
    assert.equal(loadDb().activity[0].action, 'employee_assigned');
  });

  test('refuses non-admins, the same manager and inactive managers', async () => {
    const { admin, mA, mB, mC, e1 } = await makeCompany();
    assert.equal(assignEmployee(mB, e1.id, mB.id).ok, false);
    assert.match(assignEmployee(admin, e1.id, mA.id).errors.managerId, /already in/);
    ok(setUserActive(admin, mC.id, false));
    assert.match(assignEmployee(admin, e1.id, mC.id).errors.managerId, /active manager/);
    assert.match(assignEmployee(admin, mA.id, mB.id).error, /Employee not found/);
  });
});

describe('monthly limits', () => {
  beforeEach(reset);

  test('only the employee’s current manager sets them', async () => {
    const { admin, mA, mB, e1 } = await makeCompany();
    assert.equal(setMonthlyLimit(mB, e1.id, '1000').ok, false);
    assert.equal(setMonthlyLimit(admin, e1.id, '1000').ok, false);
    assert.equal(setMonthlyLimit(e1, e1.id, '1000').ok, false);
    const { user } = ok(setMonthlyLimit(mA, e1.id, '20,000.50'));
    assert.equal(user.monthlyLimit, 2000050);
    const note = loadDb().notifications.find((n) => n.recipientId === e1.id && n.type === 'limit_set');
    assert.match(note.message, /₹20,000\.50/);
  });

  test('validates the amount; empty removes the limit', async () => {
    const { mA, e1 } = await makeCompany();
    for (const bad of ['-5', '0', '1e3', 'abc', '1.234', '1,00,00,000.01']) {
      assert.ok(setMonthlyLimit(mA, e1.id, bad).errors?.limit, `limit ${bad}`);
    }
    ok(setMonthlyLimit(mA, e1.id, '1,00,00,000'));
    const { user } = ok(setMonthlyLimit(mA, e1.id, '  '));
    assert.equal(user.monthlyLimit, null);
  });
});
