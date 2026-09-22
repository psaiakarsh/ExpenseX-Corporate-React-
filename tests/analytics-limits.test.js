import { reset, makeCompany, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalRate, breakdownByStatus, companyAggregates, filterByMonths, privacySafeTeams, reimbursementStats, spendingByCategory,
  spendingByEmployee, spendingByMonth, spendingByProject, summarizeExpenses,
} from '../src/domain/analytics.js';
import { limitLevel, limitStatus, monthlySpend } from '../src/domain/limits.js';
import { approveExpense, createManagerExpense, rejectExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { loadDb, setClock } from '../src/domain/storage.js';
import { STATUS_ORDER } from '../src/domain/constants.js';

const exp = (status, amount, extra = {}) => ({ id: `e${Math.random()}`, status, amount, date: '2026-03-10', category: 'Travel', employeeId: 'u1', projectId: null, ...extra });

describe('analytics summaries (pure)', () => {
  afterEach(() => setClock(null));

  const sample = [
    exp('draft', 100), exp('pending', 200), exp('approved', 300), exp('reimbursement_pending', 400),
    exp('reimbursed', 500, { category: 'Food', date: '2026-02-01' }), exp('rejected', 600),
  ];

  test('"spending" = pending + approved + reimbursement pending + reimbursed', () => {
    const s = summarizeExpenses(sample);
    assert.deepEqual(s.claimed, { count: 4, amount: 1400 });
    assert.deepEqual(s.pending, { count: 1, amount: 200 });
    assert.deepEqual(s.approved, { count: 3, amount: 1200 });
    assert.deepEqual(s.reimbursementPending, { count: 1, amount: 400 });
    assert.deepEqual(s.reimbursed, { count: 1, amount: 500 });
    assert.deepEqual(s.rejected, { count: 1, amount: 600 });
    assert.deepEqual(s.drafts, { count: 1, amount: 100 });
  });

  test('groupings exclude drafts and rejected claims, largest first', () => {
    assert.deepEqual(spendingByCategory(sample).map((r) => [r.label, r.amount, r.count]), [['Travel', 900, 3], ['Food', 500, 1]]);
    const db = { users: [{ id: 'u1', name: 'Una' }], projects: [] };
    assert.deepEqual(spendingByEmployee(sample, db).map((r) => r.label), ['Una']);
    assert.deepEqual(spendingByProject(sample, db).map((r) => [r.key, r.label]), [['none', 'No project']]);
  });

  test('monthly timeline has no gaps', () => {
    const rows = spendingByMonth(sample, ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(rows.map((r) => r.amount), [0, 500, 900]);
    assert.deepEqual(filterByMonths(sample, ['2026-02']).length, 1);
  });

  test('status breakdown in workflow order; approval rate; payout time', () => {
    assert.deepEqual(breakdownByStatus(sample).map((r) => r.status), STATUS_ORDER);
    assert.equal(approvalRate(sample), 75); // 3 approved-or-later vs 1 rejected
    assert.equal(approvalRate([exp('pending', 1)]), null);
    const stats = reimbursementStats([
      { status: 'pending', amount: 10, createdAt: '2026-01-01T00:00:00Z' },
      { status: 'reimbursed', amount: 20, createdAt: '2026-01-01T00:00:00Z', reimbursedAt: '2026-01-03T00:00:00Z' },
      { status: 'reimbursed', amount: 30, createdAt: '2026-01-01T00:00:00Z', reimbursedAt: '2026-01-04T12:00:00Z' },
    ]);
    assert.deepEqual(stats, { pending: { count: 1, amount: 10 }, reimbursed: { count: 2, amount: 50 }, averageDays: 2.8 });
    assert.equal(reimbursementStats([]).averageDays, null);
  });
});

describe('spending limits (pure)', () => {
  test('levels: none / ok / warning at the % / exceeded at 100 %', () => {
    assert.equal(limitLevel(500, null, 80), 'none');
    assert.equal(limitLevel(799, 1000, 80), 'ok');
    assert.equal(limitLevel(800, 1000, 80), 'warning');
    assert.equal(limitLevel(500, 1000, 50), 'warning');
    assert.equal(limitLevel(1000, 1000, 80), 'exceeded');
  });

  test('used = this month’s pending + approved + reimbursement pending + reimbursed, by expense date', () => {
    const expenses = [
      exp('pending', 100), exp('reimbursed', 200), exp('draft', 1000), exp('rejected', 1000),
      exp('pending', 5000, { date: '2026-02-28' }), exp('pending', 7000, { employeeId: 'u2' }),
    ];
    assert.equal(monthlySpend(expenses, 'u1', '2026-03'), 300);
    const status = limitStatus({ id: 'u1', monthlyLimit: 400 }, expenses, { limitWarningPercent: 80 }, '2026-03');
    assert.deepEqual(status, { month: '2026-03', limit: 400, used: 300, remaining: 100, percent: 75, level: 'ok' });
    const preview = limitStatus({ id: 'u1', monthlyLimit: 400 }, expenses, { limitWarningPercent: 80 }, '2026-03', 200);
    assert.equal(preview.level, 'exceeded');
    assert.equal(preview.remaining, -100);
    assert.equal(limitStatus({ id: 'u1', monthlyLimit: null }, expenses, { limitWarningPercent: 80 }, '2026-03').remaining, null);
  });
});

describe('Admin aggregates and privacy-safe team totals', () => {
  beforeEach(reset);

  // Hand-built company: M1 (3 employees), M2 (3 employees), M3 (2 employees), one unassigned employee.
  const users = [
    { id: 'M1', role: 'manager', status: 'active', name: 'One', department: 'D1' },
    { id: 'M2', role: 'manager', status: 'active', name: 'Two', department: 'D2' },
    { id: 'M3', role: 'manager', status: 'active', name: 'Three', department: '' },
    ...['a', 'b', 'c'].map((id) => ({ id, role: 'user', status: 'active', managerId: 'M1' })),
    ...['d', 'e', 'f'].map((id) => ({ id, role: 'user', status: 'active', managerId: 'M2' })),
    { id: 'g', role: 'user', status: 'active', managerId: 'M3' },
    { id: 'h', role: 'user', status: 'inactive', managerId: 'M3' },
    { id: 'u', role: 'user', status: 'active', managerId: null },
  ];
  const db = { users };
  const spend = (employeeId, amount) => exp('pending', amount, { employeeId });

  test('teams under 3 employees are protected; the rest are shown when the remainder is empty', () => {
    const result = privacySafeTeams(db, [spend('a', 100), spend('d', 300)]);
    assert.deepEqual(result.shown.map((t) => [t.key, t.amount, t.employees]), [['M2', 300, 3], ['M1', 100, 3]]);
    assert.deepEqual(result.protectedTeams, [{ key: 'M3', label: 'Three', employees: 2, reason: 'small' }]);
    assert.equal(result.shown[0].label, 'D2 · Two');
  });

  test('complementary suppression: hide the smallest shown team until the remainder has ≥ 3 employees', () => {
    const result = privacySafeTeams(db, [spend('a', 100), spend('d', 300), spend('g', 50), spend('h', 70)]);
    assert.deepEqual(result.shown.map((t) => t.key), ['M2']);
    assert.deepEqual(result.protectedTeams.map((t) => [t.key, t.reason]), [['M3', 'small'], ['M1', 'complement']]);
    assert.ok(!('amount' in result.protectedTeams[1]), 'protected teams carry no amount');
  });

  test('a manager’s own claims never count towards the 3-employee minimum of the remainder', () => {
    // Remainder = M3's own claim only → unsafe → hide M1 (smallest) → remainder has a, b, c → safe.
    const result = privacySafeTeams(db, [spend('a', 10), spend('b', 10), spend('c', 10), spend('d', 300), spend('M3', 80)]);
    assert.deepEqual(result.shown.map((t) => t.key), ['M2']);
    assert.deepEqual(result.protectedTeams.map((t) => [t.key, t.reason]), [['M3', 'small'], ['M1', 'complement']]);
  });

  test('when no safe split exists, every team is hidden (unassigned spender in the remainder)', () => {
    // Remainder {u} → hide M1 → {u, a} (2 employees) → hide M2 → nothing shown.
    const result = privacySafeTeams(db, [spend('a', 100), spend('d', 300), spend('u', 80)]);
    assert.deepEqual(result.shown, []);
    assert.deepEqual(result.protectedTeams.map((t) => t.reason), ['small', 'complement', 'complement']);
  });

  test('companyAggregates: Admin only, numbers only, no drafts', async () => {
    const { admin, mA, e1, e2, pA } = await makeCompany();
    const secret = 'Very Private Title';
    ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title: secret })));
    const sub = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title: secret }), { submit: true })).expense;
    const rej = ok(saveEmployeeExpense(e2, expenseInput({ projectId: pA.id, title: secret }), { submit: true })).expense;
    ok(approveExpense(mA, sub.id));
    ok(rejectExpense(mA, rej.id, 'Needs a receipt'));
    ok(createManagerExpense(mA, expenseInput({ projectId: pA.id, title: secret }), { employeeId: mA.id }));

    const db = loadDb();
    assert.equal(companyAggregates(mA, db), null);
    assert.equal(companyAggregates(e1, db), null);
    const stats = companyAggregates(admin, db);
    const text = JSON.stringify(stats);
    assert.ok(!text.includes(secret));
    for (const expense of db.expenses) assert.ok(!text.includes(expense.id), 'no expense ids');
    assert.ok(!text.includes(e1.id) && !text.includes(e2.id), 'no employee ids');
    assert.ok(!stats.byStatus.some((row) => row.status === 'draft'));
    assert.equal(stats.submittedCount, 3);
    assert.equal(stats.approvalRate, 67);
    assert.deepEqual(stats.users, { managers: 3, employees: 3, active: 7, unassigned: 0, inactive: 0 });
    assert.equal(stats.projects, 2);
    assert.equal(stats.byMonth.length, 6);
    assert.deepEqual(stats.teams, []); // Alpha has 2 employees → protected
    assert.equal(stats.protectedTeams.find((t) => t.key === mA.id).reason, 'small');
  });
});
