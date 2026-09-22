// storage.js — the ONLY file that touches localStorage.
//
// Every key starts with "exc:" so this app never collides with the old ExpenseX ("expensex:") keys.
// All accounts share ONE dataset; who may see what is decided in permissions.js, not by storage keys.
//
//   exc:schema          1
//   exc:users           User[]
//   exc:credentials     { [userId]: { salt, passwordHash } }
//   exc:session         { userId, loginAt }
//   exc:projects        Project[]
//   exc:expenses        Expense[]
//   exc:reimbursements  Reimbursement[]
//   exc:receipts        { [receiptId]: dataURL }   (kept apart so expense lists stay small)
//   exc:notifications   Notification[]
//   exc:activity        ActivityEntry[]
//   exc:settings        Settings

export const STORAGE_PREFIX = 'exc:';
export const SCHEMA_VERSION = 1;

export const KEYS = {
  schema: 'exc:schema',
  users: 'exc:users',
  credentials: 'exc:credentials',
  session: 'exc:session',
  projects: 'exc:projects',
  expenses: 'exc:expenses',
  reimbursements: 'exc:reimbursements',
  receipts: 'exc:receipts',
  notifications: 'exc:notifications',
  activity: 'exc:activity',
  settings: 'exc:settings',
};

export const DEFAULT_SETTINGS = {
  companyName: 'ExpenseX Corporate',
  currency: 'INR',
  limitWarningPercent: 80,
  allowSignup: true,
  demoLoaded: false,
};

// Missing key → fallback. Corrupted JSON → throws, so broken data is reported and never silently overwritten.
export function readData(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Saved data "${key}" is corrupted and could not be read.`);
  }
}

export function writeData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new Error('Browser storage is full or unavailable. The change was not saved.');
  }
}

export function removeData(key) {
  localStorage.removeItem(key);
}

// Loads every collection except receipts (large images are loaded only when needed).
export function loadDb() {
  return {
    users: readData(KEYS.users, []),
    credentials: readData(KEYS.credentials, {}),
    projects: readData(KEYS.projects, []),
    expenses: readData(KEYS.expenses, []),
    reimbursements: readData(KEYS.reimbursements, []),
    notifications: readData(KEYS.notifications, []),
    activity: readData(KEYS.activity, []),
    settings: { ...DEFAULT_SETTINGS, ...readData(KEYS.settings, {}) },
  };
}

export function loadReceipts() {
  return readData(KEYS.receipts, {});
}

// Saves the named collections of `db` together. If any write fails (e.g. storage full),
// every key is restored to what it was, so an action is never half-saved.
export function commit(db, names) {
  const backup = names.map((name) => [KEYS[name], localStorage.getItem(KEYS[name])]);
  try {
    localStorage.setItem(KEYS.schema, String(SCHEMA_VERSION));
    names.forEach((name) => localStorage.setItem(KEYS[name], JSON.stringify(db[name])));
  } catch (error) {
    backup.forEach(([key, raw]) => {
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    });
    throw new Error('Browser storage is full or unavailable. The change was not saved.');
  }
}

export function hasAnyUsers() {
  return readData(KEYS.users, []).length > 0;
}

// Removes every ExpenseX Corporate key (and nothing else).
export function clearAppData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

// Raw copy of every ExpenseX Corporate key ({ key: rawString }). Used to undo a failed demo load.
export function snapshotAppData() {
  const snapshot = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) snapshot[key] = localStorage.getItem(key);
  }
  return snapshot;
}

// Puts back exactly what snapshotAppData() captured (app keys only; other keys are never touched).
export function restoreAppData(snapshot) {
  clearAppData();
  Object.entries(snapshot).forEach(([key, raw]) => {
    if (key.startsWith(STORAGE_PREFIX)) localStorage.setItem(key, raw);
  });
}

// Approximate bytes used by this app (localStorage stores UTF-16, 2 bytes per character).
export function storageUsageBytes() {
  let chars = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) chars += key.length + localStorage.getItem(key).length;
  }
  return chars * 2;
}

// Immutable unique ID, e.g. "exp_3f2c…". The prefix only helps humans reading localStorage.
export function createId(prefix) {
  let uuid;
  if (typeof crypto.randomUUID === 'function') {
    uuid = crypto.randomUUID();
  } else {
    // randomUUID is missing in non-secure contexts: build a v4 UUID by hand.
    const hex = randomHex(16).split('');
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const h = hex.join('');
    uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return `${prefix}_${uuid}`;
}

export function randomHex(byteCount) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The app clock. Normally "now"; the demo loader moves it back in time so demo records get
// realistic, backdated timestamps while still being created by the real workflow functions.
let clockOverride = null;

export function appNow() {
  return clockOverride ? new Date(clockOverride) : new Date();
}

export function nowIso() {
  return appNow().toISOString();
}

export function setClock(date) {
  clockOverride = date ? new Date(date) : null;
}
