// Phase 7 — shared UI behaviour: the page header primitive, the receipt processing state, and the
// spacing utilities. Presentation only; no business rule is exercised here beyond what the pages call.
import { renderApp } from './dom.jsx';
import { makeCompany, ok, expenseInput, PASSWORD } from './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/domain/auth.js';
import { saveEmployeeExpense } from '../src/domain/expenses.js';
import { loadDb } from '../src/domain/storage.js';

let screen;
afterEach(() => screen?.unmount());

const signIn = (email) => login({ email, password: PASSWORD });

describe('shared page header', () => {
  test('every page renders exactly one header, with its title as the only heading of that level', async () => {
    const company = await makeCompany();
    ok(saveEmployeeExpense(company.e1, expenseInput({ title: 'Header check', projectId: company.pA.id }), { submit: true }));

    const byRole = {
      'e1@test.example': ['/employee/dashboard', '/employee/expenses', '/notifications'],
      'a@test.example': ['/manager/dashboard', '/manager/approvals', '/manager/expenses', '/manager/reimbursements', '/manager/team', '/manager/projects', '/manager/analytics'],
      'admin@test.example': ['/admin/dashboard', '/admin/users', '/admin/activity'],
    };
    for (const [email, paths] of Object.entries(byRole)) {
      await signIn(email);
      for (const path of paths) {
        screen = await renderApp(path);
        const headers = screen.findAll('.page-header');
        assert.equal(headers.length, 1, `one page header on ${path}`);
        assert.ok(headers[0].querySelector('h2')?.textContent.trim(), `header has a title on ${path}`);
        assert.equal(screen.container.querySelectorAll('h1').length, 1, `one h1 on ${path}`);
        screen.unmount();
      }
    }
    screen = null;
  });
});

describe('receipt processing state', () => {
  test('says it is working and refuses to save until the image is ready', async () => {
    const { pA } = await makeCompany();
    await signIn('e1@test.example');
    screen = await renderApp('/expenses/new');
    await screen.change(screen.find('#title'), 'Receipt state claim');
    await screen.change(screen.find('#amount'), '1000');
    await screen.change(screen.find('#category'), 'Travel');
    await screen.change(screen.find('#projectId'), pA.id);

    const saveDraft = () => screen.byText('button', 'Save draft');
    assert.equal(saveDraft().disabled, false, 'enabled before choosing a file');

    // Hold the image "decode" open so the in-between state can be observed.
    globalThis.__stubImageDelay = 60;
    await screen.setFiles(screen.find('#receipt'), [{ name: 'big.png', type: 'image/png', size: 4 * 1024 * 1024 }], { settle: false });
    assert.ok(screen.text.includes('Processing image…'), 'the wait is announced');
    assert.equal(screen.find('[role="status"][hidden]'), null, 'the status is visible while processing');
    assert.equal(saveDraft().disabled, true, 'cannot save while the image is still being processed');
    assert.equal(screen.byText('button', 'Submit for approval').disabled, true);

    await screen.waitFor(() => Boolean(screen.find('.receipt-preview img')));
    globalThis.__stubImageDelay = 0;
    assert.ok(!screen.text.includes('Processing image…'), 'the message goes away when it is done');
    assert.equal(saveDraft().disabled, false, 'saving is possible again');

    await screen.click(saveDraft());
    await screen.waitFor(() => screen.text.includes('Draft saved.'));
    assert.ok(loadDb().expenses.find((expense) => expense.title === 'Receipt state claim').receipt, 'the image was kept');
  });

  test('a rejected file leaves the form usable', async () => {
    const { pA } = await makeCompany();
    await signIn('e1@test.example');
    screen = await renderApp('/expenses/new');
    await screen.setFiles(screen.find('#receipt'), [{ name: 'notes.pdf', type: 'application/pdf', size: 1000 }]);
    await screen.waitFor(() => screen.text.includes('Receipts must be images'));
    assert.equal(screen.byText('button', 'Save draft').disabled, false, 'not stuck in the processing state');
    assert.equal(screen.find('.receipt-preview img'), null);
    assert.ok(pA.id);
  });
});

describe('spacing utilities', () => {
  test('section rhythm comes from classes, not inline margins', async () => {
    await makeCompany();
    await signIn('e1@test.example');
    screen = await renderApp('/employee/dashboard');
    assert.ok(screen.findAll('.section').length > 0, 'section spacing applied through the token class');
    const inlineMargins = screen.findAll('[style]').filter((el) => /margin(Top|Bottom)|margin-(top|bottom)/.test(el.getAttribute('style')));
    assert.equal(inlineMargins.length, 0, 'no inline vertical margins left on this page');
  });
});
