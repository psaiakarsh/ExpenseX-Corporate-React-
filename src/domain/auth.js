// auth.js — SIMULATED authentication (signup, login, session, logout).
//
// NOT secure: everything lives in this browser's localStorage and anyone with DevTools can read or
// change it. Passwords are salted + hashed (SHA-256) only so they are never stored as plain text.
//
// Public signup ALWAYS creates an Employee (role "user") with no manager. There is no role input:
// Admin and Manager accounts are provisioned by the Admin (users.js).

import { logActivity } from './activity.js';
import { ROLES } from './constants.js';
import { notify, notifyAdmins, refreshPendingDigest } from './notifications.js';
import { DENIED, findUser, isActiveUser } from './permissions.js';
import { KEYS, commit, createId, loadDb, nowIso, randomHex, readData, removeData, writeData } from './storage.js';
import { checkEmail, checkName, checkPassword, collectErrors, hasErrors, normalizeEmail } from './validate.js';

export async function hashPassword(password, salt) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Password hashing needs a secure context. Open the app from localhost (npm run dev or npm run preview).');
  }
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createCredentials(password) {
  const salt = randomHex(16);
  return { salt, passwordHash: await hashPassword(password, salt) };
}

export function emailTaken(db, email) {
  return db.users.some((user) => user.email === normalizeEmail(email));
}

// Shared checks for every new account (signup, setup, admin/manager provisioning).
export function validateNewAccount(db, { name, email, password, confirmPassword }, { requireConfirm = true } = {}) {
  const errors = collectErrors({
    name: checkName(name),
    email: checkEmail(email) || (emailTaken(db, email) ? 'An account with this email already exists.' : ''),
    password: checkPassword(password),
  });
  if (requireConfirm && !errors.password && confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
  return errors;
}

// Builds a user record. The role comes from the calling function, never from form input.
export function buildUser({ name, email, role, managerId = null, department = '', createdById = null }) {
  const now = nowIso();
  return {
    id: createId('usr'),
    name: String(name).trim(),
    email: normalizeEmail(email),
    role,
    managerId: role === ROLES.EMPLOYEE ? managerId : null,
    department: String(department ?? '').trim(),
    monthlyLimit: null,
    status: 'active',
    createdById,
    createdAt: now,
    updatedAt: now,
  };
}

export function startSession(userId) {
  writeData(KEYS.session, { userId, loginAt: nowIso() });
}

// ---------- Public signup (Employee only) ----------

export async function signupEmployee(input, { login = true } = {}) {
  let db = loadDb();
  if (!db.settings.allowSignup) return { ok: false, error: 'Public signup is currently disabled by the administrator.' };
  if (db.users.length === 0) return { ok: false, error: 'This company has not been set up yet.' };

  const errors = validateNewAccount(db, input);
  if (hasErrors(errors)) return { ok: false, errors };

  const credentials = await createCredentials(input.password);

  // Re-read after the async hash so nothing saved meanwhile is overwritten.
  db = loadDb();
  if (emailTaken(db, input.email)) return { ok: false, errors: { email: 'An account with this email already exists.' } };

  const user = buildUser({ name: input.name, email: input.email, role: ROLES.EMPLOYEE, managerId: null });
  db.users.push(user);
  db.credentials[user.id] = credentials;
  notify(db, user.id, {
    type: 'welcome',
    title: 'Welcome to ExpenseX',
    message: 'You can save expense drafts now. You can submit them once an administrator assigns you a manager.',
  });
  notifyAdmins(db, {
    type: 'signup_pending_assignment',
    title: 'New employee waiting for assignment',
    message: `${user.name} signed up and needs to be assigned to a manager.`,
  });
  logActivity(db, user.id, 'employee_signed_up', { targetType: 'user', targetId: user.id, summary: `${user.name} signed up (unassigned).` });
  commit(db, ['users', 'credentials', 'notifications', 'activity']);

  if (login) startSession(user.id);
  return { ok: true, user };
}

// ---------- First run: create the first Admin (only while no users exist) ----------

export async function setupCompany(input) {
  let db = loadDb();
  if (db.users.length > 0) return { ok: false, error: 'The company is already set up. Please log in.' };

  const errors = validateNewAccount(db, input);
  const companyError = checkName(input.companyName, 'Company name');
  if (companyError) errors.companyName = companyError;
  if (hasErrors(errors)) return { ok: false, errors };

  const credentials = await createCredentials(input.password);
  db = loadDb();
  if (db.users.length > 0) return { ok: false, error: 'The company is already set up. Please log in.' };

  const admin = buildUser({ name: input.name, email: input.email, role: ROLES.ADMIN });
  db.users.push(admin);
  db.credentials[admin.id] = credentials;
  db.settings = { ...db.settings, companyName: input.companyName.trim() };
  logActivity(db, admin.id, 'company_setup', { targetType: 'user', targetId: admin.id, summary: `${admin.name} set up ${db.settings.companyName}.` });
  commit(db, ['users', 'credentials', 'settings', 'activity']);

  startSession(admin.id);
  return { ok: true, user: admin };
}

// ---------- Login / logout / session ----------

export const INVALID_LOGIN = 'Incorrect email or password.';

export async function login({ email, password }) {
  if (!String(email ?? '').trim() || !password) return { ok: false, error: 'Enter your email and password.' };

  const db = loadDb();
  const user = db.users.find((u) => u.email === normalizeEmail(email));
  const credentials = user && db.credentials[user.id];
  if (!credentials) return { ok: false, error: INVALID_LOGIN };
  if ((await hashPassword(password, credentials.salt)) !== credentials.passwordHash) return { ok: false, error: INVALID_LOGIN };
  // Checked only after the password, so the message doesn't reveal which emails exist.
  if (user.status !== 'active') return { ok: false, error: 'This account has been deactivated. Contact your administrator.' };

  startSession(user.id);
  if (user.role === ROLES.MANAGER) refreshPendingDigest(user);
  return { ok: true, user };
}

// Ends the session only. All company data stays in storage.
export function logout() {
  removeData(KEYS.session);
}

// The logged-in, ACTIVE user — or null. A session pointing at a missing or deactivated
// account is cleared, so deactivation takes effect on the user's next page load.
export function getSessionUser() {
  const session = readData(KEYS.session, null);
  if (!session) return null;
  const user = readData(KEYS.users, []).find((u) => u.id === session.userId);
  if (!user || user.status !== 'active') {
    removeData(KEYS.session);
    return null;
  }
  return user;
}

// ---------- Profile ----------

// Only the name can change here. id, email and role are copied from the stored record.
export function updateProfileName(actor, name) {
  const error = checkName(name);
  if (error) return { ok: false, errors: { name: error } };
  const db = loadDb();
  const user = findUser(db, actor.id);
  if (!isActiveUser(user)) return DENIED;
  user.name = name.trim();
  user.updatedAt = nowIso();
  commit(db, ['users']);
  return { ok: true, user };
}

export async function changePassword(actor, { currentPassword, newPassword, confirmPassword }) {
  const errors = collectErrors({
    currentPassword: currentPassword ? '' : 'Enter your current password.',
    newPassword: checkPassword(newPassword),
  });
  if (!errors.newPassword && newPassword !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  if (hasErrors(errors)) return { ok: false, errors };

  let db = loadDb();
  const stored = db.credentials[actor.id];
  if (!stored || (await hashPassword(currentPassword, stored.salt)) !== stored.passwordHash) {
    return { ok: false, errors: { currentPassword: 'Current password is incorrect.' } };
  }
  const credentials = await createCredentials(newPassword);
  db = loadDb();
  db.credentials[actor.id] = credentials;
  commit(db, ['credentials']);
  return { ok: true };
}
