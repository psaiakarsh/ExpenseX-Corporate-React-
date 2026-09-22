// Authentication UI and context behaviour: login, logout, session restoration, deactivation,
// cross-tab changes, signup, first-run setup, and the demo-account panel.
import { renderApp } from './dom.jsx';
import { makeCompany, reset, storage, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSessionUser, login, logout } from '../src/domain/auth.js';
import { setUserActive } from '../src/domain/users.js';
import { updateSettings } from '../src/domain/settings.js';
import { KEYS, loadDb } from '../src/domain/storage.js';
import { DEMO_LOGINS, DEMO_PASSWORD } from '../src/domain/demo-data.js';

let screen;
afterEach(() => screen?.unmount());

const loginForm = () => screen.find('form.form');

async function signInThroughUi(email, password) {
  const form = loginForm();
  screen.fill(form, { email, password });
  await screen.submit(form);
}

describe('login', () => {
  test('requires both fields before calling the domain', async () => {
    await makeCompany();
    logout();
    screen = await renderApp('/login');
    await screen.submit(loginForm());
    assert.ok(screen.text.includes('Enter your email.'));
    assert.equal(screen.path, '/login');
  });

  test('a wrong password shows V1’s message, clears the password and stays signed out', async () => {
    await makeCompany();
    logout();
    screen = await renderApp('/login');
    await signInThroughUi('e1@test.example', 'wrong-password');
    await screen.waitFor(() => screen.text.includes('Incorrect email or password.'));
    assert.equal(screen.path, '/login');
    assert.equal(loginForm().elements.password.value, '');
    assert.equal(getSessionUser(), null);
  });

  test('the right password signs in and lands on the role home', async () => {
    const { e1 } = await makeCompany();
    logout();
    screen = await renderApp('/login');
    await signInThroughUi('  E1@Test.EXAMPLE ', PASSWORD);
    await screen.waitFor(() => screen.path === '/employee/dashboard');
    assert.equal(getSessionUser().id, e1.id);
    assert.ok(screen.text.includes('Emp One'));
    assert.equal(screen.title, 'Dashboard · ExpenseX Corporate');
  });

  test('a deactivated account is refused with its own message', async () => {
    const { admin, e1 } = await makeCompany();
    setUserActive(admin, e1.id, false);
    logout();
    screen = await renderApp('/login');
    await signInThroughUi('e1@test.example', PASSWORD);
    await screen.waitFor(() => screen.text.includes('This account has been deactivated.'));
    assert.equal(getSessionUser(), null);
  });
});

describe('logout', () => {
  test('ends the session, says so, and returns to the login page', async () => {
    await makeCompany();
    await login({ email: 'e1@test.example', password: PASSWORD });
    screen = await renderApp('/employee/dashboard');
    await screen.click(screen.find('.sidebar .icon-btn[aria-label="Log out"]'));
    await screen.waitFor(() => screen.path === '/login');
    assert.equal(getSessionUser(), null);
    assert.ok(screen.text.includes('You have been logged out.'));
    assert.ok(storage.getItem(KEYS.users), 'company data is kept');
  });
});

describe('cross-tab session changes', () => {
  test('deactivation in another tab logs this tab out on the next storage event', async () => {
    const { admin, e1 } = await makeCompany();
    await login({ email: 'e1@test.example', password: PASSWORD });
    screen = await renderApp('/employee/dashboard');
    assert.equal(screen.path, '/employee/dashboard');

    setUserActive(admin, e1.id, false); // "another tab"
    await screen.storageEvent('exc:users');
    await screen.waitFor(() => screen.path === '/login');
    assert.equal(getSessionUser(), null);
  });

  test('logging out in another tab sends this tab to the login page', async () => {
    await makeCompany();
    await login({ email: 'e1@test.example', password: PASSWORD });
    screen = await renderApp('/employee/dashboard');
    logout();
    await screen.storageEvent('exc:session');
    await screen.waitFor(() => screen.path === '/login');
  });

  test('switching account in another tab moves this tab to that account’s home', async () => {
    await makeCompany();
    await login({ email: 'e1@test.example', password: PASSWORD });
    screen = await renderApp('/employee/dashboard');
    await login({ email: 'a@test.example', password: PASSWORD }); // "another tab"
    await screen.storageEvent('exc:session');
    await screen.waitFor(() => screen.path === '/manager/dashboard');
    assert.ok(screen.text.includes('Manager A'));
  });

  test('company data changed elsewhere refreshes the badges (CompanyContext)', async () => {
    const { admin } = await makeCompany();
    screen = await renderApp('/admin/dashboard');
    const bell = () => screen.find('.topbar .icon-btn[href]');
    assert.equal(bell().getAttribute('aria-label'), 'Notifications');

    // A new signup notifies the admin (domain), as another tab would.
    const { signupEmployee } = await import('../src/domain/auth.js');
    await signupEmployee({ name: 'Sam Signup', email: 'sam@test.example', password: PASSWORD, confirmPassword: PASSWORD }, { login: false });
    await screen.storageEvent('exc:notifications');
    await screen.waitFor(() => bell().getAttribute('aria-label') === 'Notifications, 1 unread');
    assert.equal(getSessionUser().id, admin.id, 'the signup did not change the session');
  });

  test('changes to other sites’ keys are ignored', async () => {
    await makeCompany();
    screen = await renderApp('/admin/dashboard');
    const before = screen.text;
    await screen.storageEvent('expensex:old-app');
    assert.equal(screen.text, before);
  });
});

describe('signup', () => {
  test('creates an unassigned employee without signing them in, then goes to login', async () => {
    await makeCompany();
    logout();
    screen = await renderApp('/signup');
    const form = loginForm();
    screen.fill(form, { name: 'Sam Signup', email: 'sam@test.example', password: PASSWORD, confirmPassword: PASSWORD });
    await screen.submit(form);
    await screen.waitFor(() => screen.text.includes('Account created for sam@test.example'));
    assert.equal(getSessionUser(), null, 'signup never signs the user in');
    const created = loadDb().users.find((user) => user.email === 'sam@test.example');
    assert.equal(created.role, 'user');
    assert.equal(created.managerId, null);

    await screen.click(screen.byText('a', 'Continue to login'));
    await screen.waitFor(() => screen.path === '/login');
    assert.ok(screen.text.includes('Employee account created.'));
  });

  test('shows validation errors from the domain', async () => {
    await makeCompany();
    logout();
    screen = await renderApp('/signup');
    const form = loginForm();
    screen.fill(form, { name: 'S', email: 'bad', password: '123', confirmPassword: '456' });
    await screen.submit(form);
    await screen.waitFor(() => screen.text.includes('Enter a valid email address.'));
    assert.ok(screen.text.includes('must be 2–50 characters'));
    assert.equal(loadDb().users.length, 7, 'nothing was created');
  });

  test('is closed when the Admin disables it', async () => {
    const { admin } = await makeCompany();
    updateSettings(admin, { companyName: 'Test Co', limitWarningPercent: 80, allowSignup: false });
    logout();
    screen = await renderApp('/signup');
    assert.ok(screen.text.includes('Public signup is currently disabled'));
    assert.equal(screen.find('form.form'), null);
  });
});

describe('first-run setup', () => {
  test('creates the company and its admin, then opens the admin dashboard', async () => {
    reset();
    screen = await renderApp('/setup');
    const form = loginForm();
    screen.fill(form, {
      companyName: 'Acme Ltd', name: 'Ada Admin', email: 'ada@acme.example', password: PASSWORD, confirmPassword: PASSWORD,
    });
    await screen.submit(form);
    await screen.waitFor(() => screen.path === '/admin/dashboard');
    assert.ok(screen.text.includes('Company created.'));
    const db = loadDb();
    assert.equal(db.settings.companyName, 'Acme Ltd');
    assert.equal(db.users.length, 1);
    assert.equal(getSessionUser().role, 'admin');
  });

  test('is closed once the company exists', async () => {
    await makeCompany();
    screen = await renderApp('/setup');
    assert.ok(screen.text.includes('Initial setup has already been completed'));
    assert.equal(screen.find('form.form'), null);
  });
});

describe('demo company', () => {
  test('is offered only in an empty browser, and its accounts can sign in', async () => {
    reset();
    screen = await renderApp('/login');
    assert.ok(screen.text.includes('Get started'));

    await screen.click(screen.byText('button', 'Load Demo Company'));
    await screen.waitFor(() => screen.text.includes('Demo accounts'));
    assert.equal(screen.findAll('.demo-account').length, DEMO_LOGINS.length);
    assert.ok(screen.text.includes(DEMO_PASSWORD));
    assert.equal(screen.byText('button', 'Load Demo Company'), null, 'no longer offered once data exists');

    // "Use" fills the form with that account; then a normal sign-in.
    const [firstUse] = screen.findAll('.demo-account button');
    await screen.click(firstUse);
    const form = loginForm();
    assert.equal(form.elements.email.value, DEMO_LOGINS[0].email);
    assert.equal(form.elements.password.value, DEMO_PASSWORD);
    await screen.submit(form);
    await screen.waitFor(() => screen.path === '/admin/dashboard');
    assert.ok(screen.text.includes(DEMO_LOGINS[0].name));
  });
});

describe('corrupted data', () => {
  test('shows the fatal-error screen instead of overwriting anything', async () => {
    await makeCompany();
    storage.setItem(KEYS.users, '{not json');
    screen = await renderApp('/');
    assert.ok(screen.text.includes("ExpenseX Corporate can't start"));
    assert.ok(screen.text.includes('is corrupted'));
    assert.equal(storage.getItem(KEYS.users), '{not json', 'the broken data is left untouched');
  });
});
