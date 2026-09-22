import { storage, reset, makeCompany } from './setup.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_LOGINS, DEMO_PASSWORD, loadDemoCompany } from '../src/domain/demo-data.js';
import { getSessionUser, login } from '../src/domain/auth.js';
import { loadDb, loadReceipts } from '../src/domain/storage.js';
import { findUser, teamMembers } from '../src/domain/permissions.js';
import { limitStatus } from '../src/domain/limits.js';
import { companyAggregates } from '../src/domain/analytics.js';

const byEmail = (db, email) => db.users.find((u) => u.email === email);

describe('demo accounts (must match V1 exactly)', () => {
  test('names, emails, roles and password', () => {
    assert.equal(DEMO_PASSWORD, 'Demo@123');
    assert.deepEqual(DEMO_LOGINS.map(({ role, name, email }) => [role, name, email]), [
      ['Admin', 'Sai Akarsh', 'sai.akarsh@verdant.example'],
      ['Manager', 'Abhay', 'abhay@verdant.example'],
      ['Manager', 'Sadiq', 'sadiq@verdant.example'],
      ['Manager', 'Charan Sai', 'charan.sai@verdant.example'],
      ['Employee', 'Ravi Kumar', 'ravi@verdant.example'],
      ['Employee', 'Meera Joshi', 'meera@verdant.example'],
      ['Employee', 'Aditya Bose', 'aditya@verdant.example'],
    ]);
  });
});

describe('Load Demo Company', () => {
  let db;
  before(async () => {
    reset();
    storage.setItem('expensex:old-app', 'keep me');
    const result = await loadDemoCompany();
    assert.deepEqual(result, { ok: true });
    db = loadDb();
  });

  test('everyone is logged out and unrelated keys survive', () => {
    assert.equal(getSessionUser(), null);
    assert.equal(storage.getItem('expensex:old-app'), 'keep me');
  });

  test('company contents match the documented demo', () => {
    const count = (role, status) => db.users.filter((u) => u.role === role && (!status || u.status === status)).length;
    assert.equal(db.settings.companyName, 'Verdant Systems Pvt Ltd');
    assert.equal(db.settings.demoLoaded, true);
    assert.equal(count('admin'), 1);
    assert.equal(count('manager'), 3);
    assert.equal(count('user'), 10);
    assert.equal(count('user', 'inactive'), 1);
    assert.equal(db.users.filter((u) => u.role === 'user' && !u.managerId).length, 1);
    assert.equal(db.projects.length, 7);
    assert.equal(db.projects.filter((p) => p.status === 'archived').length, 1);
    assert.equal(db.expenses.length, 56);
    assert.equal(db.expenses.filter((e) => e.selfApproved).length, 5);
    assert.equal(Object.keys(loadReceipts()).length, 9);
    for (const status of ['draft', 'pending', 'reimbursement_pending', 'reimbursed', 'rejected']) {
      assert.ok(db.expenses.some((e) => e.status === status), `some ${status} expense`);
    }
    assert.ok(db.expenses.some((e) => e.history.some((h) => h.action === 'resubmitted')), 'a rejected → resubmitted claim');
    assert.equal(db.activity[0].action, 'demo_loaded');
  });

  test('every V1-required kind of record is present (Phase 6 audit)', () => {
    const byStatus = (status) => db.expenses.filter((expense) => expense.status === status).length;
    assert.ok(byStatus('draft') > 0, 'draft expenses');
    assert.ok(byStatus('pending') > 0, 'pending expenses');
    assert.ok(byStatus('reimbursement_pending') > 0, 'reimbursement-pending expenses');
    assert.ok(byStatus('reimbursed') > 0, 'reimbursed expenses');
    assert.ok(byStatus('rejected') > 0, 'rejected expenses');
    assert.ok(db.expenses.some((expense) => expense.history.some((entry) => entry.action === 'approved')), 'approved history');
    assert.ok(db.expenses.some((expense) => expense.history.some((entry) => entry.action === 'resubmitted')), 'a resubmitted claim');
    assert.ok(db.expenses.some((expense) => expense.history.some((entry) => entry.action === 'reassigned')), 'a reassigned claim');
    assert.ok(db.expenses.some((expense) => expense.selfApproved), 'manager-created self-approved claims');
    assert.ok(db.expenses.some((expense) => expense.createdById !== expense.employeeId), 'a claim a manager created for someone');
    assert.ok(db.expenses.some((expense) => expense.receipt), 'receipts attached');
    assert.ok(db.projects.some((project) => project.status === 'active') && db.projects.some((project) => project.status === 'archived'), 'active and inactive projects');
    assert.ok(db.users.some((user) => user.monthlyLimit), 'spending limits set');
    assert.ok(db.users.some((user) => user.role === 'user' && !user.managerId), 'an unassigned employee');
    assert.ok(db.users.some((user) => user.status === 'inactive'), 'a deactivated account');
    assert.ok(db.notifications.length > 0 && db.activity.length > 0, 'notifications and activity');
    // Analytics have something to work with in every dimension.
    assert.ok(new Set(db.expenses.map((expense) => expense.category)).size > 3, 'several categories');
    assert.ok(new Set(db.expenses.map((expense) => expense.date.slice(0, 7))).size > 3, 'several months');
    assert.ok(db.reimbursements.some((record) => record.status === 'pending') && db.reimbursements.some((record) => record.status === 'reimbursed'));
  });

  test('teams: Engineering 4, Sales 3 (incl. reassigned Farhan), Operations 1 active + 1 inactive', () => {
    const team = (email) => teamMembers(byEmail(db, email), db, { includeInactive: true }).map((u) => u.name).sort();
    assert.deepEqual(team('abhay@verdant.example'), ['Karthik Reddy', 'Meera Joshi', 'Ravi Kumar', 'Sneha Iyer']);
    assert.deepEqual(team('sadiq@verdant.example'), ['Divya Menon', 'Farhan Ali', 'Rahul Verma']);
    assert.deepEqual(team('charan.sai@verdant.example'), ['Neha Gupta', 'Rohit Das']);
    assert.equal(byEmail(db, 'rohit@verdant.example').status, 'inactive');
    assert.equal(byEmail(db, 'aditya@verdant.example').managerId, null);
  });

  test('reassignment history: Farhan’s Nashik claim moved to Sadiq, who approved and paid it', () => {
    const sadiq = byEmail(db, 'sadiq@verdant.example');
    const nashik = db.expenses.find((e) => e.title === 'Site visit – Nashik warehouse');
    assert.equal(nashik.status, 'reimbursed');
    assert.equal(nashik.managerId, sadiq.id);
    assert.equal(nashik.review.byId, sadiq.id);
    assert.ok(nashik.history.some((h) => h.action === 'reassigned'));
    const record = db.reimbursements.find((r) => r.expenseId === nashik.id);
    assert.equal(record.managerId, sadiq.id);
    assert.equal(record.reimbursedById, sadiq.id);
    // Farhan's older claims keep Charan Sai as the approver.
    const charan = byEmail(db, 'charan.sai@verdant.example');
    const forklift = db.expenses.find((e) => e.title === 'Forklift safety training');
    assert.equal(forklift.review.byId, charan.id);
  });

  test('limit examples: Ravi ₹14,500 of ₹20,000; Meera over her limit', () => {
    const ravi = limitStatus(byEmail(db, 'ravi@verdant.example'), db.expenses, db.settings);
    assert.equal(ravi.used, 14_500_00);
    assert.equal(ravi.limit, 20_000_00);
    assert.equal(limitStatus(byEmail(db, 'meera@verdant.example'), db.expenses, db.settings).level, 'exceeded');
  });

  test('Admin view: Engineering shown; Operations small; Sales hidden by complementary suppression', () => {
    const stats = companyAggregates(byEmail(db, 'sai.akarsh@verdant.example'), db);
    assert.deepEqual(stats.teams.map((t) => t.label), ['Engineering · Abhay']);
    const reasons = Object.fromEntries(stats.protectedTeams.map((t) => [t.label, t.reason]));
    assert.deepEqual(reasons, { 'Operations · Charan Sai': 'small', 'Sales · Sadiq': 'complement' });
  });

  test('activity log holds no expense titles or amounts', () => {
    const text = JSON.stringify(db.activity);
    assert.ok(!text.includes('₹'));
    for (const expense of db.expenses) assert.ok(!text.includes(expense.title), expense.title);
  });

  test('every demo account logs in with Demo@123; a wrong-case password is refused', async () => {
    for (const account of DEMO_LOGINS) {
      const result = await login({ email: account.email, password: DEMO_PASSWORD });
      assert.equal(result.ok, true, account.email);
      assert.equal(result.user.name, account.name);
    }
    assert.equal((await login({ email: 'sai.akarsh@verdant.example', password: 'demo@123' })).ok, false);
    assert.ok(!Object.values(storage.dump()).some((raw) => raw.includes(DEMO_PASSWORD)), 'no plain-text password stored');
  });
});

describe('demo load / reset rules', () => {
  test('from the login page only while no data exists', async () => {
    await makeCompany();
    const result = await loadDemoCompany();
    assert.match(result.error, /already exists/);
    assert.equal(loadDb().settings.companyName, 'Test Co');
  });

  test('only the Admin may load or reset from Settings', async () => {
    const { mA, admin } = await makeCompany();
    assert.equal((await loadDemoCompany(mA)).ok, false);
    assert.equal(loadDb().settings.companyName, 'Test Co');
    assert.deepEqual(await loadDemoCompany(admin, 'reset'), { ok: true });
    const db = loadDb();
    assert.equal(db.activity[0].action, 'demo_reset');
    assert.equal(findUser(db, admin.id), null, 'the old company is replaced entirely');
  });

  test('a failed load restores the previous data exactly', async () => {
    const { admin } = await makeCompany();
    storage.setItem('unrelated', 'x');
    const before = storage.dump();
    storage.quota = storage.usedChars() + 20_000; // the demo cannot fit
    const result = await loadDemoCompany(admin);
    assert.equal(result.ok, false);
    assert.match(result.error, /storage is full/);
    storage.quota = Infinity;
    assert.deepEqual(storage.dump(), before);
  });
});
