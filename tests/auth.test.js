import { storage, reset, makeCompany, PASSWORD, ok, expenseInput } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, getSessionUser, login, logout, setupCompany, signupEmployee, updateProfileName } from '../src/domain/auth.js';
import { KEYS, loadDb } from '../src/domain/storage.js';
import { setUserActive } from '../src/domain/users.js';
import { updateSettings } from '../src/domain/settings.js';
import { saveEmployeeExpense } from '../src/domain/expenses.js';

const setupInput = { companyName: 'Acme', name: 'Ada Admin', email: 'Ada@Acme.example', password: PASSWORD, confirmPassword: PASSWORD };
const signupInput = { name: 'Sam Signup', email: 'sam@acme.example', password: PASSWORD, confirmPassword: PASSWORD };

describe('first-run setup', () => {
  beforeEach(reset);

  test('creates the single Admin, the company name and a session', async () => {
    const { user } = ok(await setupCompany(setupInput));
    assert.equal(user.role, 'admin');
    assert.equal(user.email, 'ada@acme.example');
    const db = loadDb();
    assert.equal(db.settings.companyName, 'Acme');
    assert.equal(getSessionUser().id, user.id);
    assert.equal(db.activity[0].action, 'company_setup');
  });

  test('can never create a second admin', async () => {
    ok(await setupCompany(setupInput));
    const again = await setupCompany({ ...setupInput, email: 'other@acme.example' });
    assert.equal(again.ok, false);
    assert.match(again.error, /already set up/);
    assert.equal(loadDb().users.length, 1);
  });

  test('validates company, account and password confirmation', async () => {
    const result = await setupCompany({ companyName: '', name: 'A', email: 'bad', password: '123', confirmPassword: '123' });
    assert.deepEqual(Object.keys(result.errors).sort(), ['companyName', 'email', 'name', 'password']);
    const mismatch = await setupCompany({ ...setupInput, confirmPassword: 'different' });
    assert.equal(mismatch.errors.confirmPassword, 'Passwords do not match.');
  });
});

describe('public signup — always an unassigned Employee', () => {
  beforeEach(reset);

  test('is refused before the company exists', async () => {
    const result = await signupEmployee(signupInput);
    assert.match(result.error, /not been set up/);
  });

  test('ignores any role or manager in the input', async () => {
    const { admin, mA } = await makeCompany();
    const { user } = ok(await signupEmployee({ ...signupInput, role: 'admin', managerId: mA.id }, { login: false }));
    assert.equal(user.role, 'user');
    assert.equal(user.managerId, null);
    assert.equal(user.status, 'active');
    assert.equal(getSessionUser().id, admin.id, 'signup with login:false keeps the current session');
    const db = loadDb();
    assert.ok(db.notifications.some((n) => n.recipientId === admin.id && n.type === 'signup_pending_assignment'));
    assert.ok(db.notifications.some((n) => n.recipientId === user.id && n.type === 'welcome'));
    assert.equal(db.activity[0].action, 'employee_signed_up');
  });

  test('refuses duplicate emails case-insensitively', async () => {
    await makeCompany();
    const result = await signupEmployee({ ...signupInput, email: ' E1@TEST.example ' });
    assert.match(result.errors.email, /already exists/);
  });

  test('is refused when the Admin disables it', async () => {
    const { admin } = await makeCompany();
    ok(updateSettings(admin, { companyName: 'Test Co', limitWarningPercent: 80, allowSignup: false }));
    const result = await signupEmployee(signupInput);
    assert.match(result.error, /disabled/);
  });

  test('passwords are stored only as salt + SHA-256 hash', async () => {
    await makeCompany();
    const { user } = ok(await signupEmployee(signupInput, { login: false }));
    const credentials = loadDb().credentials[user.id];
    assert.match(credentials.salt, /^[0-9a-f]{32}$/);
    assert.match(credentials.passwordHash, /^[0-9a-f]{64}$/);
    assert.ok(!Object.values(storage.dump()).some((raw) => raw.includes(PASSWORD)), 'no plain-text password anywhere');
    assert.ok(!('password' in loadDb().users.find((u) => u.id === user.id)));
  });
});

describe('login, session, logout', () => {
  beforeEach(reset);

  test('accepts the right password with a trimmed, case-insensitive email', async () => {
    const { e1 } = await makeCompany();
    logout();
    const { user } = ok(await login({ email: '  E1@Test.EXAMPLE ', password: PASSWORD }));
    assert.equal(user.id, e1.id);
    assert.equal(getSessionUser().id, e1.id);
  });

  test('gives the same message for a wrong password and an unknown email', async () => {
    await makeCompany();
    logout();
    const wrong = await login({ email: 'e1@test.example', password: 'Secret1' });
    const unknown = await login({ email: 'nobody@test.example', password: PASSWORD });
    assert.equal(wrong.error, 'Incorrect email or password.');
    assert.equal(unknown.error, wrong.error);
    assert.equal(getSessionUser(), null);
    assert.match((await login({ email: '', password: '' })).error, /Enter your email/);
  });

  test('deactivated accounts are refused only after the password is checked', async () => {
    const { admin, e1 } = await makeCompany();
    ok(setUserActive(admin, e1.id, false));
    assert.equal((await login({ email: 'e1@test.example', password: 'wrong-password' })).error, 'Incorrect email or password.');
    assert.match((await login({ email: 'e1@test.example', password: PASSWORD })).error, /deactivated/);
  });

  test('a session pointing at a deactivated account is cleared', async () => {
    const { admin, e1 } = await makeCompany();
    ok(await login({ email: 'e1@test.example', password: PASSWORD }));
    ok(setUserActive(admin, e1.id, false));
    assert.equal(getSessionUser(), null);
    assert.equal(storage.getItem(KEYS.session), null);
  });

  test('manager login creates a pending-approvals digest', async () => {
    const { e1, pA } = await makeCompany();
    ok(saveEmployeeExpense(e1, expenseInput({ projectId: pA.id }), { submit: true }));
    const { user } = ok(await login({ email: 'a@test.example', password: PASSWORD }));
    const digest = loadDb().notifications.filter((n) => n.recipientId === user.id && n.type === 'pending_digest');
    assert.equal(digest.length, 1);
    assert.match(digest[0].message, /1 expense pending approval \(₹1,250\.50\)/);
  });

  test('logout ends the session and keeps all data', async () => {
    await makeCompany();
    const users = storage.getItem(KEYS.users);
    logout();
    assert.equal(getSessionUser(), null);
    assert.equal(storage.getItem(KEYS.users), users);
  });
});

describe('profile', () => {
  beforeEach(reset);

  test('only the name can change', async () => {
    const { e1 } = await makeCompany();
    assert.match(updateProfileName(e1, 'X').errors.name, /2–50/);
    const { user } = ok(updateProfileName({ ...e1, role: 'admin', email: 'hack@x.example' }, '  New Name '));
    assert.equal(user.name, 'New Name');
    assert.equal(user.role, 'user');
    assert.equal(user.email, 'e1@test.example');
  });

  test('changing the password needs the current one', async () => {
    const { e1 } = await makeCompany();
    const wrong = await changePassword(e1, { currentPassword: 'nope', newPassword: 'newpass1', confirmPassword: 'newpass1' });
    assert.match(wrong.errors.currentPassword, /incorrect/);
    const mismatch = await changePassword(e1, { currentPassword: PASSWORD, newPassword: 'newpass1', confirmPassword: 'other' });
    assert.match(mismatch.errors.confirmPassword, /do not match/);
    ok(await changePassword(e1, { currentPassword: PASSWORD, newPassword: 'newpass1', confirmPassword: 'newpass1' }));
    assert.equal((await login({ email: 'e1@test.example', password: PASSWORD })).ok, false);
    ok(await login({ email: 'e1@test.example', password: 'newpass1' }));
  });
});
