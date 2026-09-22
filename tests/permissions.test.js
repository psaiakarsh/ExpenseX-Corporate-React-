import { reset, makeCompany, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, canViewExpense, publicUser, selectableProjects, teamMembers, visibleExpenses, visibleProjects, visibleReimbursements,
} from '../src/domain/permissions.js';
import { approveExpense, createManagerExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { setUserActive } from '../src/domain/users.js';
import { loadDb } from '../src/domain/storage.js';

async function scenario() {
  const company = await makeCompany();
  const { mA, mB, e1, e2, e3, pA, pB } = company;
  const draft = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title: 'e1 draft' }))).expense;
  const pending = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title: 'e1 pending' }), { submit: true })).expense;
  const approved = ok(saveEmployeeExpense(e2, expenseInput({ projectId: pA.id, title: 'e2 approved' }), { submit: true })).expense;
  ok(approveExpense(mA, approved.id));
  const own = ok(createManagerExpense(mA, expenseInput({ projectId: pA.id, title: 'mA own' }), { employeeId: mA.id })).expense;
  const other = ok(saveEmployeeExpense(e3, expenseInput({ projectId: pB.id, title: 'e3 pending' }), { submit: true })).expense;
  const titles = (user) => visibleExpenses(user, loadDb()).map((e) => e.title).sort();
  return { ...company, draft, pending, approved, own, other, titles, mB };
}

describe('expense visibility', () => {
  beforeEach(reset);

  test('employees see only their own claims, drafts included', async () => {
    const { e1, e2, titles } = await scenario();
    assert.deepEqual(titles(e1), ['e1 draft', 'e1 pending']);
    assert.deepEqual(titles(e2), ['e2 approved']);
  });

  test('managers see their own + their current team’s SUBMITTED claims, never drafts or other teams', async () => {
    const { mA, mB, titles } = await scenario();
    assert.deepEqual(titles(mA), ['e1 pending', 'e2 approved', 'mA own']);
    assert.deepEqual(titles(mB), ['e3 pending']);
  });

  test('the Admin sees no individual expense or reimbursement at all', async () => {
    const { admin, pending, own, titles } = await scenario();
    const db = loadDb();
    assert.deepEqual(titles(admin), []);
    assert.equal(canViewExpense(admin, pending, db), false);
    assert.equal(canViewExpense(admin, own, db), false);
    assert.deepEqual(visibleReimbursements(admin, db), []);
    assert.deepEqual(visibleProjects(admin, db), []);
    for (const action of ['expense.review', 'expense.edit', 'expense.createOwn', 'project.create', 'reimbursement.markPaid']) {
      assert.equal(can(admin, action, pending, db), false, action);
    }
  });

  test('reimbursement records follow their expense’s visibility', async () => {
    const { mA, mB, e2 } = await scenario();
    const db = loadDb();
    assert.equal(visibleReimbursements(mA, db).length, 2); // e2's approved claim + own claim
    assert.equal(visibleReimbursements(e2, db).length, 1);
    assert.equal(visibleReimbursements(mB, db).length, 0);
  });
});

describe('can()', () => {
  beforeEach(reset);

  test('re-reads the stored account: a deactivated user holding a stale object can do nothing', async () => {
    const { admin, e1, draft } = await scenario();
    const staleE1 = { ...e1 };
    ok(setUserActive(admin, e1.id, false));
    const db = loadDb();
    assert.equal(can(staleE1, 'expense.edit', draft, db), false);
    assert.equal(canViewExpense(staleE1, draft, db), false);
    assert.equal(can({ id: 'nobody', role: 'admin' }, 'admin.settings', null, db), false, 'role in the passed object is never trusted');
  });

  test('role-gated actions', async () => {
    const { admin, mA, e1 } = await scenario();
    const db = loadDb();
    for (const action of ['user.createManager', 'user.setActive', 'user.assign', 'admin.settings', 'admin.activity', 'admin.demo', 'admin.aggregates']) {
      assert.equal(can(admin, action, null, db), true, action);
      assert.equal(can(mA, action, null, db), false, action);
      assert.equal(can(e1, action, null, db), false, action);
    }
    assert.equal(can(admin, 'user.createEmployee', null, db), true);
    assert.equal(can(mA, 'user.createEmployee', null, db), true);
    assert.equal(can(e1, 'user.createEmployee', null, db), false);
    assert.equal(can(mA, 'no.such.action', null, db), false);
  });

  test('limits: only for employees of the manager’s own team', async () => {
    const { mA, mB, e1, e3 } = await scenario();
    const db = loadDb();
    assert.equal(can(mA, 'limit.set', e1, db), true);
    assert.equal(can(mA, 'limit.set', e3, db), false);
    assert.equal(can(mB, 'limit.set', e1, db), false);
  });

  test('a manager never reviews their own claim', async () => {
    const { mA, own } = await scenario();
    assert.equal(can(mA, 'expense.review', { ...own, status: 'pending' }, loadDb()), false);
  });
});

describe('teams, projects, public profile', () => {
  beforeEach(reset);

  test('teamMembers excludes inactive members unless asked', async () => {
    const { admin, mA, e1 } = await makeCompany();
    ok(setUserActive(admin, e1.id, false));
    const db = loadDb();
    assert.equal(teamMembers(mA, db).length, 1);
    assert.equal(teamMembers(mA, db, { includeInactive: true }).length, 2);
  });

  test('project scopes', async () => {
    const { mA, e1, e3, pA, pB } = await makeCompany();
    const db = loadDb();
    assert.deepEqual(visibleProjects(mA, db).map((p) => p.id), [pA.id]);
    assert.deepEqual(visibleProjects(e1, db).map((p) => p.id), [pA.id]);
    assert.deepEqual(visibleProjects(e3, db).map((p) => p.id), [pB.id]);
    assert.deepEqual(selectableProjects(db, mA.id).map((p) => p.id), [pA.id]);
  });

  test('publicUser never exposes credentials', async () => {
    const { e1 } = await makeCompany();
    const pub = publicUser({ ...e1, passwordHash: 'x', salt: 'y' });
    assert.deepEqual(Object.keys(pub).sort(), ['createdAt', 'department', 'email', 'id', 'managerId', 'monthlyLimit', 'name', 'role', 'status']);
    assert.equal(publicUser(null), null);
  });
});
