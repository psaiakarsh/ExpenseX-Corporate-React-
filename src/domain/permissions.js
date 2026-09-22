// permissions.js — WHO may do WHAT, and WHICH records each user may see.
//
// Every action function (expenses.js, users.js, …) calls can() before changing anything,
// so hiding a button is never the only protection. Pages read data only through the
// visible…() scope functions below.
//
// Reminder: this is a browser-only prototype. Anyone can edit localStorage in DevTools;
// real enforcement would need a server.

import { ROLES, STATUS } from './constants.js';
import { loadDb } from './storage.js';

export function findUser(db, userId) {
  return db.users.find((user) => user.id === userId) ?? null;
}

export function isActiveUser(user) {
  return Boolean(user) && user.status === 'active';
}

export function isManagerOf(manager, employee) {
  return Boolean(employee) && manager.role === ROLES.MANAGER && employee.role === ROLES.EMPLOYEE && employee.managerId === manager.id;
}

// actor: the logged-in user. target: the record the action is about (may be undefined).
// The STORED account is always re-read, so a user who was deactivated (or whose role/team changed)
// in another tab cannot keep acting with a stale copy held by an open page.
export function can(actorInput, action, target, db = loadDb()) {
  const actor = findUser(db, actorInput?.id);
  if (!isActiveUser(actor)) return false;
  const role = actor.role;

  switch (action) {
    // ---- Accounts ----
    case 'user.createManager':
    case 'user.setActive':
    case 'user.assign':
    case 'admin.settings':
    case 'admin.activity':
    case 'admin.demo':
    case 'admin.aggregates':
      return role === ROLES.ADMIN;

    case 'user.createEmployee':
      return role === ROLES.ADMIN || role === ROLES.MANAGER;

    case 'limit.set': // target: employee
      return isManagerOf(actor, target);

    // ---- Projects ----
    case 'project.create':
      return role === ROLES.MANAGER;
    case 'project.manage': // target: project
      return role === ROLES.MANAGER && target?.managerId === actor.id;

    // ---- Expenses ----
    case 'expense.view': // target: expense
      return canViewExpense(actor, target, db);

    case 'expense.createOwn': // employees file their own claims
      return role === ROLES.EMPLOYEE;

    case 'expense.createAsManager': // target: the employee the expense is for (may be the manager)
      return role === ROLES.MANAGER && (target?.id === actor.id || (isManagerOf(actor, target) && isActiveUser(target)));

    case 'expense.edit': // only the owner's drafts and rejected claims
      return (
        role === ROLES.EMPLOYEE &&
        target?.employeeId === actor.id &&
        target?.createdById === actor.id &&
        [STATUS.DRAFT, STATUS.REJECTED].includes(target.status)
      );

    case 'expense.submit': // an employee with an ACTIVE manager submitting their own draft/rejected claim
      return can(actor, 'expense.edit', target, db) && isActiveUser(findUser(db, actor.managerId));

    case 'expense.deleteDraft':
      return can(actor, 'expense.edit', target, db) && target.status === STATUS.DRAFT;

    case 'expense.review': // target: expense — only a PENDING claim of an employee currently in this manager's team
      return (
        role === ROLES.MANAGER &&
        target?.status === STATUS.PENDING &&
        target.managerId === actor.id &&
        target.employeeId !== actor.id &&
        isManagerOf(actor, findUser(db, target.employeeId))
      );

    case 'reimbursement.markPaid': // target: reimbursement record — see reimbursementManagerId()
      return (
        role === ROLES.MANAGER &&
        target?.status === 'pending' &&
        reimbursementManagerId(db, target) === actor.id &&
        canViewExpense(actor, db.expenses.find((e) => e.id === target.expenseId), db)
      );

    default:
      return false;
  }
}

// Employee: own expenses only.
// Manager:  own expenses + SUBMITTED expenses of employees CURRENTLY in their team (never unsent drafts).
//           Visibility follows current team membership; the stored expense.managerId (who reviewed it)
//           is history and is never rewritten.
// Admin:    none — aggregates only.
export function canViewExpense(viewer, expense, db = loadDb()) {
  const user = findUser(db, viewer?.id); // stored account, as in can()
  if (!expense || !isActiveUser(user)) return false;
  if (user.role === ROLES.EMPLOYEE) return expense.employeeId === user.id;
  if (user.role === ROLES.MANAGER) {
    if (expense.employeeId === user.id) return true;
    return expense.status !== STATUS.DRAFT && isManagerOf(user, findUser(db, expense.employeeId));
  }
  return false;
}

// ---------- Scopes: the only way pages obtain records ----------

export function visibleExpenses(user, db) {
  return db.expenses.filter((expense) => canViewExpense(user, expense, db));
}

export function teamMembers(manager, db, { includeInactive = false } = {}) {
  return db.users.filter(
    (user) => user.role === ROLES.EMPLOYEE && user.managerId === manager.id && (includeInactive || isActiveUser(user)),
  );
}

// Projects a user may pick when filing an expense reviewed by `managerId`.
export function selectableProjects(db, managerId) {
  return db.projects.filter((project) => project.managerId === managerId && project.status === 'active');
}

export function visibleProjects(user, db) {
  if (user.role === ROLES.MANAGER) return db.projects.filter((project) => project.managerId === user.id);
  if (user.role === ROLES.EMPLOYEE) return db.projects.filter((project) => project.managerId === user.managerId);
  return [];
}

// Who may pay out a reimbursement: the employee's CURRENT manager — the same manager who can see the
// expense — or, for a manager's own (self-approved) expense, that manager. `record.managerId` is the
// manager who APPROVED it; like the expense's review and history it is kept as history and never
// rewritten. Who actually paid is recorded separately in `reimbursedById` / `reimbursedAt`.
// So after a reassignment, the new manager can both open and pay a pending reimbursement, and the
// old manager can do neither (they no longer see that employee).
export function reimbursementManagerId(db, record) {
  const owner = findUser(db, record?.employeeId);
  if (!owner) return null;
  return owner.role === ROLES.MANAGER ? owner.id : owner.managerId;
}

// Reimbursement records follow the same visibility as their expense.
export function visibleReimbursements(user, db) {
  return db.reimbursements.filter((record) => canViewExpense(user, db.expenses.find((e) => e.id === record.expenseId), db));
}

// Public profile fields only — never credentials.
export function publicUser(user) {
  if (!user) return null;
  const { id, name, email, role, managerId, department, status, monthlyLimit, createdAt } = user;
  return { id, name, email, role, managerId, department, status, monthlyLimit, createdAt };
}

export const DENIED = { ok: false, error: 'You do not have permission to do that.' };
