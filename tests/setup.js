// setup.js — test environment for the domain layer (Node's built-in test runner, no framework).
// Provides an in-memory localStorage (with an optional quota to simulate "storage full") and a
// minimal canvas stub so demo receipts can be drawn outside a browser. Real image compression
// (prepareReceipt) needs a browser and is verified there.

import { setupCompany } from '../src/domain/auth.js';
import { toLocalDate } from '../src/domain/dates.js';
import { setClock } from '../src/domain/storage.js';
import { createProject } from '../src/domain/projects.js';
import { createManagedAccount } from '../src/domain/users.js';

class MemoryStorage {
  #data = new Map();
  quota = Infinity; // max total characters (keys + values), like the browser's ~5 MB limit

  get length() {
    return this.#data.size;
  }
  key(index) {
    return [...this.#data.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }
  setItem(key, value) {
    const text = String(value);
    let used = key.length + text.length;
    for (const [k, v] of this.#data) if (k !== key) used += k.length + v.length;
    if (used > this.quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.#data.set(key, text);
  }
  removeItem(key) {
    this.#data.delete(key);
  }
  clear() {
    this.#data.clear();
  }
  dump() {
    return Object.fromEntries(this.#data);
  }
  usedChars() {
    let used = 0;
    for (const [k, v] of this.#data) used += k.length + v.length;
    return used;
  }
}

export const storage = new MemoryStorage();
globalThis.localStorage = storage;

// Canvas stub: every drawing call is a no-op; toDataURL returns a small fixed JPEG data URL.
const noopContext = new Proxy({}, { get: () => () => {}, set: () => true });
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error(`document.createElement(${tag}) is not stubbed`);
    return { width: 0, height: 0, getContext: () => noopContext, toDataURL: () => `data:image/jpeg;base64,${'A'.repeat(400)}` };
  },
};

export function reset() {
  storage.clear();
  storage.quota = Infinity;
  setClock(null);
}

export const PASSWORD = 'secret1';

export function expenseInput(overrides = {}) {
  return { title: 'Taxi to client', amount: '1250.50', category: 'Travel', date: toLocalDate(), projectId: '', notes: '', ...overrides };
}

// A small company: admin; managers A (Alpha: e1, e2), B (Beta: e3), C (Gamma: no team);
// one active project each for A and B.
export async function makeCompany() {
  reset();
  const ok = (result) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result;
  };
  const admin = ok(await setupCompany({ companyName: 'Test Co', name: 'Admin One', email: 'admin@test.example', password: PASSWORD, confirmPassword: PASSWORD })).user;
  const manager = async (name, email, department) => ok(await createManagedAccount(admin, 'manager', { name, email, password: PASSWORD, department })).user;
  const employee = async (name, email, m) => ok(await createManagedAccount(admin, 'employee', { name, email, password: PASSWORD, managerId: m?.id ?? '' })).user;
  const mA = await manager('Manager A', 'a@test.example', 'Alpha');
  const mB = await manager('Manager B', 'b@test.example', 'Beta');
  const mC = await manager('Manager C', 'c@test.example', 'Gamma');
  const e1 = await employee('Emp One', 'e1@test.example', mA);
  const e2 = await employee('Emp Two', 'e2@test.example', mA);
  const e3 = await employee('Emp Three', 'e3@test.example', mB);
  const pA = ok(createProject(mA, { name: 'Alpha Project', description: '' })).project;
  const pB = ok(createProject(mB, { name: 'Beta Project', description: '' })).project;
  return { admin, mA, mB, mC, e1, e2, e3, pA, pB };
}

export function ok(result) {
  if (!result?.ok) throw new Error(`Expected ok, got ${JSON.stringify(result)}`);
  return result;
}
