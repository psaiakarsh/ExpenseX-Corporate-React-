import { storage, reset } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, KEYS, SCHEMA_VERSION, appNow, clearAppData, commit, createId, hasAnyUsers, loadDb, loadReceipts,
  nowIso, restoreAppData, setClock, snapshotAppData, storageUsageBytes,
} from '../src/domain/storage.js';

describe('storage.js — the only localStorage access point', () => {
  beforeEach(reset);

  test('empty storage loads empty collections and default settings', () => {
    const db = loadDb();
    assert.deepEqual(db.users, []);
    assert.deepEqual(db.credentials, {});
    assert.deepEqual(db.settings, DEFAULT_SETTINGS);
    assert.deepEqual(loadReceipts(), {});
    assert.equal(hasAnyUsers(), false);
    assert.equal('receipts' in db, false, 'receipts are loaded only on demand');
  });

  test('stored settings are merged over the defaults', () => {
    storage.setItem(KEYS.settings, JSON.stringify({ companyName: 'Acme' }));
    const { settings } = loadDb();
    assert.equal(settings.companyName, 'Acme');
    assert.equal(settings.limitWarningPercent, 80);
    assert.equal(settings.allowSignup, true);
  });

  test('corrupted JSON is reported, never silently replaced', () => {
    storage.setItem(KEYS.users, '{not json');
    assert.throws(() => loadDb(), /"exc:users" is corrupted/);
    assert.equal(storage.getItem(KEYS.users), '{not json');
  });

  test('commit writes the schema version and only the named collections', () => {
    const db = loadDb();
    db.users.push({ id: 'u1' });
    db.projects.push({ id: 'p1' });
    commit(db, ['users']);
    assert.equal(storage.getItem(KEYS.schema), String(SCHEMA_VERSION));
    assert.deepEqual(JSON.parse(storage.getItem(KEYS.users)), [{ id: 'u1' }]);
    assert.equal(storage.getItem(KEYS.projects), null);
  });

  test('commit is all-or-nothing when storage is full', () => {
    const before = loadDb();
    before.users.push({ id: 'u0' });
    commit(before, ['users']);
    const snapshot = storage.dump();

    const db = loadDb();
    db.users.push({ id: 'u1' });
    db.expenses.push({ id: 'big', notes: 'x'.repeat(5000) });
    storage.quota = storage.usedChars() + 200; // room for the users write, not the expenses write
    assert.throws(() => commit(db, ['users', 'expenses']), /storage is full/);
    assert.deepEqual(storage.dump(), snapshot, 'every key restored to what it was');
  });

  test('clearAppData removes exc: keys only', () => {
    storage.setItem(KEYS.users, '[]');
    storage.setItem('exc:anything', '1');
    storage.setItem('expensex:old-app', 'keep');
    storage.setItem('other', 'keep');
    clearAppData();
    assert.deepEqual(storage.dump(), { 'expensex:old-app': 'keep', other: 'keep' });
  });

  test('snapshot / restore puts back exactly the app keys', () => {
    storage.setItem(KEYS.users, '[{"id":"a"}]');
    storage.setItem(KEYS.settings, '{"companyName":"A"}');
    storage.setItem('other', 'keep');
    const snapshot = snapshotAppData();
    assert.deepEqual(Object.keys(snapshot).sort(), [KEYS.settings, KEYS.users]);

    storage.setItem(KEYS.users, '[]');
    storage.setItem(KEYS.expenses, '[1]');
    restoreAppData(snapshot);
    assert.deepEqual(storage.dump(), { [KEYS.users]: '[{"id":"a"}]', [KEYS.settings]: '{"companyName":"A"}', other: 'keep' });
  });

  test('usage counts app keys only, 2 bytes per character', () => {
    storage.setItem('exc:x', 'abc'); // 5 + 3 chars
    storage.setItem('other', 'x'.repeat(100));
    assert.equal(storageUsageBytes(), 16);
  });

  test('createId makes unique prefixed UUIDs', () => {
    const a = createId('exp');
    assert.match(a, /^exp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a, createId('exp'));
  });

  test('the app clock can be moved back for the demo and restored', () => {
    const past = new Date(2025, 5, 1, 9);
    setClock(past);
    assert.equal(appNow().getTime(), past.getTime());
    assert.equal(nowIso(), past.toISOString());
    setClock(null);
    assert.ok(Math.abs(appNow() - Date.now()) < 1000);
  });
});
