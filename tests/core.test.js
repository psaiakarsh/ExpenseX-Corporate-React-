import './setup.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EXPENSE_PAISE, MAX_LIMIT_PAISE, formatMoney, formatMoneyCompact, isValidAmount, parseMoney, sumAmounts, toAmountInput } from '../src/domain/money.js';
import { currentMonthKey, formatDate, formatMonth, formatRelative, isValidDate, lastMonthKeys, monthKey, toLocalDate } from '../src/domain/dates.js';
import { checkEmail, checkName, checkPassword, checkText, collectErrors, hasErrors, normalizeEmail } from '../src/domain/validate.js';
import { setClock } from '../src/domain/storage.js';

describe('money: integer paise, string parsing', () => {
  test('parses valid rupee text exactly (no floating point)', () => {
    assert.equal(parseMoney('1250'), 125000);
    assert.equal(parseMoney('1,250.5'), 125050);
    assert.equal(parseMoney('19.99'), 1999); // 19.99 * 100 would be 1998.999… in floating point
    assert.equal(parseMoney('0.1'), 10);
    assert.equal(parseMoney(' 12 '), 1200);
    assert.equal(parseMoney('10,00,000'), MAX_EXPENSE_PAISE);
  });

  test('rejects every invalid form with null', () => {
    for (const bad of ['', '   ', '-5', 'abc', '1e5', 'NaN', 'Infinity', '1.234', '.5', '5.', '1 000', null, undefined]) {
      assert.equal(parseMoney(bad), null, `parseMoney(${JSON.stringify(bad)})`);
    }
  });

  test('isValidAmount: positive safe integers up to the cap', () => {
    assert.equal(isValidAmount(1), true);
    assert.equal(isValidAmount(MAX_EXPENSE_PAISE), true);
    assert.equal(isValidAmount(MAX_EXPENSE_PAISE + 1), false);
    assert.equal(isValidAmount(0), false);
    assert.equal(isValidAmount(-100), false);
    assert.equal(isValidAmount(1.5), false);
    assert.equal(isValidAmount(NaN), false);
    assert.equal(isValidAmount(MAX_LIMIT_PAISE, MAX_LIMIT_PAISE), true);
    assert.equal(isValidAmount(MAX_LIMIT_PAISE + 1, MAX_LIMIT_PAISE), false);
  });

  test('formats with Indian digit grouping', () => {
    assert.equal(formatMoney(12500000), '₹1,25,000.00');
    assert.equal(formatMoney(125050), '₹1,250.50');
    assert.equal(formatMoney(1.5), '₹—');
    assert.equal(formatMoneyCompact(NaN), '');
    assert.ok(formatMoneyCompact(1234500).startsWith('₹'));
  });

  test('round-trips amounts for editing and sums integers', () => {
    assert.equal(toAmountInput(125050), '1250.50');
    assert.equal(toAmountInput(5), '0.05');
    assert.equal(parseMoney(toAmountInput(1999)), 1999);
    assert.equal(sumAmounts([{ amount: 10 }, { amount: 20 }, { amount: 1 }]), 31);
  });
});

describe('dates: local YYYY-MM-DD strings', () => {
  afterEach(() => setClock(null));

  test('validates real calendar dates only', () => {
    assert.equal(isValidDate('2024-02-29'), true);
    assert.equal(isValidDate('2026-02-30'), false);
    assert.equal(isValidDate('2026-2-3'), false);
    assert.equal(isValidDate('not a date'), false);
  });

  test('formats dates and months', () => {
    assert.match(formatDate('2026-09-12'), /^12 Sept? 2026$/); // ICU versions differ: "Sep" or "Sept"
    assert.equal(formatDate('bad'), '—');
    assert.match(formatMonth('2026-09'), /^Sept? 2026$/);
    assert.equal(monthKey('2026-09-12'), '2026-09');
  });

  test('uses local time and the app clock', () => {
    assert.equal(toLocalDate(new Date(2026, 0, 5, 1, 0)), '2026-01-05');
    setClock(new Date(2026, 0, 15, 12));
    assert.equal(currentMonthKey(), '2026-01');
    assert.deepEqual(lastMonthKeys(3), ['2025-11', '2025-12', '2026-01']);
    assert.equal(formatRelative(new Date(2026, 0, 15, 11, 55).toISOString()), '5 min ago');
    assert.equal(formatRelative(new Date(2026, 0, 15, 9).toISOString()), '3 h ago');
    assert.equal(formatRelative(new Date(2026, 0, 13, 12).toISOString()), '2 days ago');
  });
});

describe('validate: field checks', () => {
  test('names are 2–50 characters after trimming', () => {
    assert.equal(checkName(' Ab '), '');
    assert.match(checkName(''), /required/);
    assert.match(checkName('A'), /2–50/);
    assert.match(checkName('x'.repeat(51)), /2–50/);
    assert.match(checkName('', 'Company name'), /^Company name/);
  });

  test('emails are trimmed, lower-cased and pattern-checked', () => {
    assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
    assert.equal(checkEmail('Foo@Bar.COM '), '');
    assert.match(checkEmail('x@y'), /valid email/);
    assert.match(checkEmail(''), /required/);
    assert.match(checkEmail(`${'a'.repeat(95)}@b.com`), /valid email/);
  });

  test('passwords are 6–72 characters', () => {
    assert.equal(checkPassword('123456'), '');
    assert.match(checkPassword('12345'), /6–72/);
    assert.match(checkPassword('x'.repeat(73)), /6–72/);
    assert.match(checkPassword(''), /required/);
  });

  test('optional text length and error collection', () => {
    assert.equal(checkText('abc', 3, 'Notes'), '');
    assert.match(checkText('abcd', 3, 'Notes'), /at most 3/);
    const errors = collectErrors({ name: '', email: 'Bad' });
    assert.deepEqual(errors, { email: 'Bad' });
    assert.equal(hasErrors(errors), true);
    assert.equal(hasErrors({}), false);
  });
});
