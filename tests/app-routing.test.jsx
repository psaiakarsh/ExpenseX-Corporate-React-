// Route protection: unauthenticated access, role rules, unknown URLs, and the shell that follows.
import { renderApp, renderGuard } from './dom.jsx';
import { makeCompany, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { login, logout } from '../src/domain/auth.js';
import { saveEmployeeExpense } from '../src/domain/expenses.js';
import { loadDb } from '../src/domain/storage.js';
import { notify } from '../src/domain/notifications.js';
import { commit } from '../src/domain/storage.js';
import { APP_ROUTES } from '../src/app/routes.jsx';
import { ProtectedRoute, RoleRoute } from '../src/app/guards.jsx';
import { ROLES } from '../src/domain/constants.js';

let screen;
afterEach(() => screen?.unmount());

const signIn = async (email) => {
  const result = await login({ email, password: PASSWORD });
  assert.equal(result.ok, true, `sign in ${email}`);
  return result.user;
};

describe('unauthenticated visitors', () => {
  test('are sent to the login page from "/" and from any deep link', async () => {
    await makeCompany();
    logout();
    screen = await renderApp('/');
    assert.equal(screen.path, '/login');
    assert.ok(screen.text.includes('Log in'));

    screen.unmount();
    screen = await renderApp('/manager/approvals');
    assert.equal(screen.path, '/login');
    assert.ok(!screen.text.includes('Approvals'), 'the protected page never rendered');
  });

  test('every protected route redirects, none renders', async () => {
    await makeCompany();
    logout();
    for (const route of APP_ROUTES) {
      const path = route.path.replace(':id', 'exp_1');
      screen = await renderApp(path);
      assert.equal(screen.path, '/login', path);
      screen.unmount();
    }
    screen = null;
  });
});

describe('session restoration', () => {
  test('an existing session is restored on load and lands on the role home', async () => {
    const { admin } = await makeCompany(); // setupCompany() signed the admin in
    screen = await renderApp('/');
    assert.equal(screen.path, '/admin/dashboard');
    assert.ok(screen.text.includes(admin.name));
    assert.equal(screen.title, 'Dashboard · ExpenseX Corporate');
  });

  test('signed-in users are sent away from /login and /signup', async () => {
    await makeCompany();
    screen = await renderApp('/login');
    assert.equal(screen.path, '/admin/dashboard');
    screen.unmount();
    screen = await renderApp('/signup');
    assert.equal(screen.path, '/admin/dashboard');
  });
});

describe('role routes', () => {
  test('an Admin cannot open manager or expense pages', async () => {
    await makeCompany();
    for (const path of ['/manager/approvals', '/manager/team', '/expenses/new', '/expenses/exp_1']) {
      screen = await renderApp(path);
      assert.equal(screen.path, '/admin/dashboard', path);
      assert.ok(screen.text.includes('Access denied'), `flash for ${path}`);
      assert.equal(screen.find('.topbar-title').textContent, 'Dashboard', 'the denied page was never titled/drawn');
      screen.unmount();
    }
    screen = null;
  });

  test('an Employee cannot open admin or manager pages', async () => {
    await makeCompany();
    await signIn('e1@test.example');
    for (const path of ['/admin/users', '/admin/settings', '/manager/dashboard']) {
      screen = await renderApp(path);
      assert.equal(screen.path, '/employee/dashboard', path);
      screen.unmount();
    }
    screen = null;
  });

  test('a Manager cannot open admin or employee pages, but shared pages are allowed', async () => {
    await makeCompany();
    await signIn('a@test.example');
    for (const path of ['/admin/activity', '/employee/expenses']) {
      screen = await renderApp(path);
      assert.equal(screen.path, '/manager/dashboard', path);
      screen.unmount();
    }
    for (const path of ['/expenses/new', '/notifications', '/profile']) {
      screen = await renderApp(path);
      assert.equal(screen.path, path, path);
      screen.unmount();
    }
    screen = null;
  });

  test('each role reaches its own pages', async () => {
    await makeCompany();
    const byRole = { 'e1@test.example': '/employee/expenses', 'a@test.example': '/manager/approvals', 'admin@test.example': '/admin/users' };
    for (const [email, path] of Object.entries(byRole)) {
      await signIn(email);
      screen = await renderApp(path);
      assert.equal(screen.path, path, email);
      screen.unmount();
    }
    screen = null;
  });
});

describe('unknown URLs', () => {
  test('show the not-found page without leaking anything', async () => {
    await makeCompany();
    logout();
    screen = await renderApp('/nope');
    assert.ok(screen.text.includes('Page not found'));
    assert.ok(screen.byText('a', 'Go to login'));
    screen.unmount();

    await signIn('e1@test.example');
    screen = await renderApp('/employee/nope');
    assert.ok(screen.text.includes('Page not found'));
    assert.ok(screen.byText('a', 'Go to your dashboard'));
  });
});

describe('app shell', () => {
  test('shows the role navigation, the user and a working skip link', async () => {
    await makeCompany();
    await signIn('a@test.example');
    screen = await renderApp('/manager/dashboard');
    const labels = screen.findAll('.sidebar .nav-link > span:first-of-type').map((el) => el.textContent);
    assert.deepEqual(labels, ['Dashboard', 'Approvals', 'Team Expenses', 'Reimbursements', 'Team', 'Projects', 'Analytics', 'Notifications', 'Profile']);
    assert.equal(screen.find('.nav-link[data-nav="dashboard"]').getAttribute('aria-current'), 'page');
    assert.ok(screen.text.includes('Manager A'));
    assert.equal(screen.findAll('.bottom-nav .bottom-link').length, 5); // 4 primary + More
    await screen.click(screen.byText('a.skip-link', 'Skip to content'));
    assert.ok(screen.container.ownerDocument.activeElement === screen.find('#main'), 'skip link focuses the content');
  });

  test('the Admin shell has no "New expense" button (no expense access)', async () => {
    await makeCompany();
    screen = await renderApp('/admin/dashboard');
    assert.equal(screen.byText('a', 'New expense'), null);
    const labels = screen.findAll('.sidebar .nav-link > span:first-of-type').map((el) => el.textContent);
    assert.deepEqual(labels, ['Dashboard', 'Users', 'Activity', 'Settings', 'Notifications', 'Profile']);
  });

  test('badges come from the domain: unread notifications and claims awaiting review', async () => {
    const { mA, e1, pA } = await makeCompany();
    saveEmployeeExpense(e1, { title: 'Taxi to client', amount: '1250', category: 'Travel', date: loadDb().expenses[0]?.date ?? new Date().toISOString().slice(0, 10), projectId: pA.id, notes: '' }, { submit: true });
    const db = loadDb();
    notify(db, mA.id, { type: 'welcome', title: 'Hello', message: 'Unread message' });
    commit(db, ['notifications']);
    await signIn('a@test.example');

    screen = await renderApp('/manager/dashboard');
    const approvals = screen.find('.sidebar [data-nav="approvals"] .nav-badge');
    assert.ok(approvals.textContent.includes(', 1 waiting'));
    assert.equal(approvals.hidden, false);
    const bell = screen.find('.topbar .icon-btn[href]');
    assert.match(bell.getAttribute('aria-label'), /Notifications, \d+ unread/);
  });

  test('the "More" sheet opens, navigates and closes on Escape with focus returned', async () => {
    await makeCompany();
    await signIn('e1@test.example');
    screen = await renderApp('/employee/dashboard');
    const more = screen.byText('button.bottom-link', 'More');
    more.focus(); // a real click focuses the button; focus must return here on close
    await screen.click(more);
    const sheet = screen.container.ownerDocument.querySelector('dialog.more-sheet');
    assert.ok(sheet?.hasAttribute('open'));
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.ok([...sheet.querySelectorAll('.nav-link span')].some((el) => el.textContent === 'Profile'));

    await screen.press(sheet, 'Escape');
    assert.equal(screen.container.ownerDocument.querySelector('dialog.more-sheet'), null);
    assert.equal(more.getAttribute('aria-expanded'), 'false');
    assert.ok(screen.container.ownerDocument.activeElement === more, 'focus returns to the opener');
  });
});

describe('each guard on its own', () => {
  test('ProtectedRoute hides its children from signed-out visitors', async () => {
    await makeCompany();
    logout();
    screen = await renderGuard(<ProtectedRoute><p>secret content</p></ProtectedRoute>);
    assert.ok(!screen.text.includes('secret content'));
    assert.equal(screen.path, '/login');
    screen.unmount();

    await signIn('e1@test.example');
    screen = await renderGuard(<ProtectedRoute><p>secret content</p></ProtectedRoute>);
    assert.ok(screen.text.includes('secret content'));
    assert.equal(screen.path, '/secret');
  });

  test('RoleRoute allows only the listed roles', async () => {
    await makeCompany();
    await signIn('e1@test.example');
    screen = await renderGuard(<RoleRoute roles={[ROLES.ADMIN]}><p>admin only</p></RoleRoute>);
    assert.ok(!screen.text.includes('admin only'));
    assert.equal(screen.path, '/employee/dashboard');
    screen.unmount();

    screen = await renderGuard(<RoleRoute roles={[ROLES.EMPLOYEE]}><p>employee only</p></RoleRoute>);
    assert.ok(screen.text.includes('employee only'));
    screen.unmount();

    logout();
    screen = await renderGuard(<RoleRoute roles={[ROLES.EMPLOYEE]}><p>employee only</p></RoleRoute>);
    assert.ok(!screen.text.includes('employee only'));
    assert.equal(screen.path, '/login');
  });
});
