import { reset, makeCompany, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NOTIFICATIONS_PER_USER, markAllNotificationsRead, markNotificationRead, notificationsFor, notify, refreshPendingDigest, unreadCount,
} from '../src/domain/notifications.js';
import { ACTIVITY_LABELS, MAX_ACTIVITY, logActivity } from '../src/domain/activity.js';
import { approveExpense, rejectExpense, saveEmployeeExpense } from '../src/domain/expenses.js';
import { markReimbursed } from '../src/domain/reimbursements.js';
import { assignEmployee, setMonthlyLimit, setUserActive } from '../src/domain/users.js';
import { commit, loadDb, setClock } from '../src/domain/storage.js';

const emptyDb = () => ({ notifications: [], activity: [] });

describe('notifications', () => {
  beforeEach(reset);

  test('a key prevents duplicates for the same recipient only', () => {
    const db = emptyDb();
    notify(db, 'u1', { type: 't', title: 'A', message: 'm', key: 'k' });
    notify(db, 'u1', { type: 't', title: 'B', message: 'm', key: 'k' });
    notify(db, 'u2', { type: 't', title: 'C', message: 'm', key: 'k' });
    notify(db, null, { type: 't', title: 'D', message: 'no recipient' });
    assert.deepEqual(db.notifications.map((n) => n.title), ['C', 'A']);
    assert.equal(db.notifications[0].read, false);
  });

  test('keeps only the newest 200 per recipient, without touching others', () => {
    const db = emptyDb();
    notify(db, 'other', { type: 't', title: 'keep', message: 'm' });
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_USER + 5; i++) notify(db, 'u1', { type: 't', title: `n${i}`, message: 'm' });
    const mine = db.notifications.filter((n) => n.recipientId === 'u1');
    assert.equal(mine.length, MAX_NOTIFICATIONS_PER_USER);
    assert.equal(mine[0].title, 'n204');
    assert.ok(!mine.some((n) => n.title === 'n4'));
    assert.equal(db.notifications.filter((n) => n.recipientId === 'other').length, 1);
  });

  test('users read and mark only their own notifications', async () => {
    const { mA, e1, pA } = await makeCompany();
    ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    const db = loadDb();
    const managerNote = notificationsFor(mA, db)[0];
    assert.equal(markNotificationRead(e1, managerNote.id).ok, false);
    const before = unreadCount(e1, db);
    assert.ok(before > 0);
    const { changed } = ok(markAllNotificationsRead(e1));
    assert.equal(changed, before);
    assert.equal(unreadCount(e1, loadDb()), 0);
    assert.ok(unreadCount(mA, loadDb()) > 0, 'another user’s notifications are untouched');
    ok(markNotificationRead(mA, managerNote.id));
    assert.equal(loadDb().notifications.find((n) => n.id === managerNote.id).read, true);
  });

  test('newest first', async () => {
    const { e1 } = await makeCompany();
    const db = loadDb();
    setClock(new Date(2030, 0, 1));
    notify(db, e1.id, { type: 't', title: 'future', message: 'm' });
    setClock(null);
    commit(db, ['notifications']);
    assert.equal(notificationsFor(e1, loadDb())[0].title, 'future');
  });

  test('the pending digest is replaced, never stacked, and removed when nothing is pending', async () => {
    const { mA, e1, pA } = await makeCompany();
    const { expense } = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    refreshPendingDigest(mA);
    refreshPendingDigest(mA);
    const digests = () => loadDb().notifications.filter((n) => n.recipientId === mA.id && n.type === 'pending_digest');
    assert.equal(digests().length, 1);
    ok(approveExpense(mA, expense.id));
    refreshPendingDigest(mA);
    assert.equal(digests().length, 0);
  });
});

describe('activity log — privacy-safe and bounded', () => {
  beforeEach(reset);

  test('keeps the newest 500 entries', () => {
    const db = emptyDb();
    for (let i = 0; i < MAX_ACTIVITY + 3; i++) logActivity(db, 'a', 'settings_updated', { summary: `s${i}` });
    assert.equal(db.activity.length, MAX_ACTIVITY);
    assert.equal(db.activity[0].summary, 's502');
  });

  test('a full workflow never writes titles, amounts, comments or references to the log', async () => {
    const { admin, mA, mB, e1, e2, pA } = await makeCompany();
    const title = 'Secret Offsite Dinner';
    const a = ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id, title, amount: '4321.99' }), { submit: true })).expense;
    const b = ok(saveEmployeeExpense(e2, expenseInput({ projectId: pA.id, title, amount: '4321.99' }), { submit: true })).expense;
    ok(rejectExpense(mA, b.id, 'Confidential rejection reason'));
    ok(approveExpense(mA, a.id, 'Confidential approval note'));
    ok(markReimbursed(mA, loadDb().expenses.find((e) => e.id === a.id).reimbursementId, 'REF-SECRET-9'));
    ok(setMonthlyLimit(mA, e1.id, '9999'));
    ok(assignEmployee(admin, e1.id, mB.id));
    ok(setUserActive(admin, e2.id, false));

    const log = loadDb().activity;
    const text = JSON.stringify(log);
    for (const secret of [title, '4,321.99', '4321', 'Confidential', 'REF-SECRET', '₹']) {
      assert.ok(!text.includes(secret), `activity log leaks "${secret}"`);
    }
    const expenseEntries = log.filter((entry) => entry.targetType === 'expense');
    assert.deepEqual(expenseEntries.map((entry) => entry.action).sort(), ['expense_approved', 'expense_reimbursed', 'expense_rejected']);
    for (const entry of log) assert.ok(ACTIVITY_LABELS[entry.action], `label for ${entry.action}`);
  });
});
