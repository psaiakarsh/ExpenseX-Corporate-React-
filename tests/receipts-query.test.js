import { reset } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIPT_MAX_INPUT_BYTES, RECEIPT_MAX_SIDE, RECEIPT_QUALITY, RECEIPT_TYPES, attachReceipt, dataUrlBytes, formatBytes, prepareReceipt, receiptImage,
} from '../src/domain/receipts.js';
import { SORTS, categoryOptions, filterExpenses, lastSubmittedAt, monthOptions, statusOptions } from '../src/domain/expense-query.js';
import { commit, loadDb } from '../src/domain/storage.js';
import { CATEGORIES, STATUS_ORDER } from '../src/domain/constants.js';

// Image decoding + canvas compression need a real browser; they are verified in the browser pass.
describe('receipts — rules that run before the canvas', () => {
  beforeEach(reset);

  test('the V1 compression settings are unchanged', () => {
    assert.equal(RECEIPT_MAX_INPUT_BYTES, 5 * 1024 * 1024);
    assert.equal(RECEIPT_MAX_SIDE, 1280);
    assert.equal(RECEIPT_QUALITY, 0.72);
    assert.deepEqual(RECEIPT_TYPES, ['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  });

  test('rejects missing files, non-images and files over 5 MB', async () => {
    assert.match((await prepareReceipt(null)).error, /Choose an image/);
    assert.match((await prepareReceipt({ name: 'a.pdf', type: 'application/pdf', size: 10 })).error, /must be images/);
    assert.match((await prepareReceipt({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).error, /must be images/);
    assert.match((await prepareReceipt({ name: 'a.png', type: 'image/png', size: RECEIPT_MAX_INPUT_BYTES + 1 })).error, /larger than 5 MB/);
  });

  test('size helpers', () => {
    assert.equal(dataUrlBytes('data:image/jpeg;base64,AAAA'), 3);
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(59 * 1024), '59 KB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  });

  test('images are stored apart from expenses and looked up by id', () => {
    const db = loadDb();
    const meta = attachReceipt(db, { dataUrl: 'data:image/jpeg;base64,AAAA', fileName: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 3 });
    assert.deepEqual(Object.keys(meta).sort(), ['fileName', 'id', 'mimeType', 'sizeBytes']);
    commit(db, ['receipts']);
    assert.equal(receiptImage(meta), 'data:image/jpeg;base64,AAAA');
    assert.equal(receiptImage(null), null);
  });
});

describe('expense list queries', () => {
  const db = {
    users: [{ id: 'u1', name: 'Asha Rao' }, { id: 'u2', name: 'Bala' }],
    projects: [{ id: 'p1', name: 'Apollo' }],
  };
  const e = (id, extra) => ({
    id, title: id, notes: '', category: 'Travel', projectId: null, employeeId: 'u1', status: 'pending', amount: 100,
    date: '2026-03-01', createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-01T10:00:00Z', history: [], ...extra,
  });
  const list = [
    e('a', { amount: 300, date: '2026-03-05', projectId: 'p1' }),
    e('b', { amount: 100, date: '2026-02-10', category: 'Food', employeeId: 'u2', status: 'draft', updatedAt: '2026-03-09T00:00:00Z' }),
    e('c', { amount: 200, date: '2026-03-05', createdAt: '2026-03-06T00:00:00Z', notes: 'Hotel near airport' }),
  ];
  const ids = (filters) => filterExpenses(list, db, filters).map((x) => x.id);

  test('filters combine; empty values mean "all"', () => {
    assert.deepEqual(ids({}), ['c', 'a', 'b']);
    assert.deepEqual(ids({ status: 'draft' }), ['b']);
    assert.deepEqual(ids({ category: 'Food' }), ['b']);
    assert.deepEqual(ids({ projectId: 'p1' }), ['a']);
    assert.deepEqual(ids({ projectId: 'none' }), ['c', 'b']);
    assert.deepEqual(ids({ employeeId: 'u2' }), ['b']);
    assert.deepEqual(ids({ month: '2026-03' }), ['c', 'a']);
    assert.deepEqual(ids({ month: '2026-03', status: 'pending', projectId: 'p1' }), ['a']);
  });

  test('search covers title, notes, category, project and employee name', () => {
    assert.deepEqual(ids({ search: '  AIRPORT ' }), ['c']);
    assert.deepEqual(ids({ search: 'apollo' }), ['a']);
    assert.deepEqual(ids({ search: 'bala' }), ['b']);
    assert.deepEqual(ids({ search: 'food' }), ['b']);
  });

  test('sorts', () => {
    assert.deepEqual(ids({ sort: 'oldest' }), ['b', 'a', 'c']);
    assert.deepEqual(ids({ sort: 'highest' }), ['a', 'c', 'b']);
    assert.deepEqual(ids({ sort: 'lowest' }), ['b', 'c', 'a']);
    assert.deepEqual(ids({ sort: 'updated' })[0], 'b');
    assert.deepEqual(ids({ sort: 'bogus' }), ids({ sort: 'newest' }));
    assert.deepEqual(Object.keys(SORTS), ['newest', 'oldest', 'highest', 'lowest', 'updated']);
  });

  test('last submission time comes from history (resubmission wins)', () => {
    const history = [{ action: 'submitted', at: '1' }, { action: 'rejected', at: '2' }, { action: 'resubmitted', at: '3' }, { action: 'approved', at: '4' }];
    assert.equal(lastSubmittedAt({ history }), '3');
    assert.equal(lastSubmittedAt({ history: [{ action: 'created', at: '1' }] }), null);
  });

  test('filter menu options', () => {
    assert.deepEqual(statusOptions().map((o) => o.value), ['', ...STATUS_ORDER]);
    assert.deepEqual(categoryOptions('Choose').map((o) => o.label), ['Choose', ...CATEGORIES]);
    assert.deepEqual(monthOptions(list).map((o) => o.value), ['', '2026-03', '2026-02']);
  });
});
