// users.js — account provisioning and team management.
//   Admin:   create managers and employees, deactivate/reactivate, assign employees to managers.
//   Manager: add employees to their own team, set monthly spending limits for their team.
// Accounts are never deleted (they own historical expenses); they are deactivated instead.

import { logActivity } from './activity.js';
import { buildUser, createCredentials, emailTaken, validateNewAccount } from './auth.js';
import { ROLES, ROLE_LABELS, STATUS } from './constants.js';
import { MAX_LIMIT_PAISE, formatMoney, isValidAmount, parseMoney } from './money.js';
import { notify } from './notifications.js';
import { DENIED, can, findUser, isActiveUser, teamMembers } from './permissions.js';
import { commit, loadDb, nowIso } from './storage.js';
import { checkName, hasErrors } from './validate.js';

// kind: 'manager' | 'employee'. The role is decided HERE from `kind` and the actor, never from form data.
export async function createManagedAccount(actor, kind, input) {
  let db = loadDb();
  const role = kind === 'manager' ? ROLES.MANAGER : ROLES.EMPLOYEE;
  if (role === ROLES.MANAGER && !can(actor, 'user.createManager', null, db)) return DENIED;
  if (role === ROLES.EMPLOYEE && !can(actor, 'user.createEmployee', null, db)) return DENIED;

  // A manager can only add employees to their own team; an admin may pick any active manager (or none).
  const managerId = role !== ROLES.EMPLOYEE ? null : actor.role === ROLES.MANAGER ? actor.id : input.managerId || null;

  const errors = validateNewAccount(db, input, { requireConfirm: false });
  if (role === ROLES.MANAGER) {
    const departmentError = checkName(input.department, 'Department');
    if (departmentError) errors.department = departmentError;
  }
  if (managerId) {
    const manager = findUser(db, managerId);
    if (!manager || manager.role !== ROLES.MANAGER || !isActiveUser(manager)) errors.managerId = 'Choose an active manager.';
  }
  if (hasErrors(errors)) return { ok: false, errors };

  const credentials = await createCredentials(input.password);
  db = loadDb();
  if (emailTaken(db, input.email)) return { ok: false, errors: { email: 'An account with this email already exists.' } };

  const user = buildUser({ name: input.name, email: input.email, role, managerId, department: input.department, createdById: actor.id });
  db.users.push(user);
  db.credentials[user.id] = credentials;

  const manager = findUser(db, managerId);
  notify(db, user.id, {
    type: 'welcome',
    title: 'Welcome to ExpenseX',
    message: role === ROLES.MANAGER
      ? `Your manager account for ${user.department} was created by ${actor.name}.`
      : manager
        ? `Your account was created by ${actor.name}. Your manager is ${manager.name}.`
        : `Your account was created by ${actor.name}. You can submit expenses once you are assigned a manager.`,
  });
  if (manager && manager.id !== actor.id) {
    notify(db, manager.id, { type: 'team_joined', title: 'New team member', message: `${user.name} joined your team.` });
  }
  logActivity(db, actor.id, 'account_created', {
    targetType: 'user',
    targetId: user.id,
    summary: `${actor.name} created ${ROLE_LABELS[role].toLowerCase()} account for ${user.name}${manager ? ` (team: ${manager.name})` : ''}.`,
  });
  commit(db, ['users', 'credentials', 'notifications', 'activity']);
  return { ok: true, user };
}

export function setUserActive(actor, userId, active) {
  const db = loadDb();
  if (!can(actor, 'user.setActive', null, db)) return DENIED;
  const user = findUser(db, userId);
  if (!user) return { ok: false, error: 'Account not found.' };
  if (user.id === actor.id) return { ok: false, error: 'You cannot deactivate your own account.' };
  if ((user.status === 'active') === active) return { ok: true, user };

  // A manager can only be deactivated once NO employee (active or inactive) is assigned to them, so no
  // employee — and no pending approval or reimbursement — is ever left with an inactive manager.
  if (!active && user.role === ROLES.MANAGER) {
    const team = teamMembers(user, db, { includeInactive: true });
    if (team.length > 0) {
      return {
        ok: false,
        error: `${user.name} still has ${team.length} assigned employee${team.length === 1 ? '' : 's'}. Reassign them to another manager first.`,
      };
    }
  }
  if (active && user.role === ROLES.EMPLOYEE && user.managerId && !isActiveUser(findUser(db, user.managerId))) {
    user.managerId = null; // their old manager is gone; the admin must assign a new one
  }

  user.status = active ? 'active' : 'inactive';
  user.updatedAt = nowIso();
  logActivity(db, actor.id, active ? 'account_reactivated' : 'account_deactivated', {
    targetType: 'user',
    targetId: user.id,
    summary: `${actor.name} ${active ? 'reactivated' : 'deactivated'} ${user.name} (${ROLE_LABELS[user.role]}).`,
  });
  commit(db, ['users', 'activity']);
  return { ok: true, user };
}

// Moves an employee to another manager.
//   • PENDING expenses move with the employee (the new manager reviews them), with a history entry.
//   • Approved / reimbursement-pending / reimbursed / rejected expenses keep their original manager:
//     financial history is never rewritten.
export function assignEmployee(actor, employeeId, managerId) {
  const db = loadDb();
  if (!can(actor, 'user.assign', null, db)) return DENIED;
  const employee = findUser(db, employeeId);
  const manager = findUser(db, managerId);
  if (!employee || employee.role !== ROLES.EMPLOYEE) return { ok: false, error: 'Employee not found.' };
  if (!manager || manager.role !== ROLES.MANAGER || !isActiveUser(manager)) return { ok: false, errors: { managerId: 'Choose an active manager.' } };
  if (employee.managerId === manager.id) return { ok: false, errors: { managerId: `${employee.name} is already in ${manager.name}'s team.` } };

  const previousManager = findUser(db, employee.managerId);
  const at = nowIso();
  employee.managerId = manager.id;
  employee.monthlyLimit = null; // limits are set by each manager for their own team
  employee.updatedAt = at;

  const moved = db.expenses.filter((e) => e.employeeId === employee.id && e.status === STATUS.PENDING);
  moved.forEach((expense) => {
    expense.history.push({
      at,
      byId: actor.id,
      action: 'reassigned',
      fromStatus: expense.status,
      toStatus: expense.status,
      comment: `Review moved from ${previousManager?.name ?? 'no manager'} to ${manager.name}.`,
    });
    expense.managerId = manager.id;
    expense.updatedAt = at;
  });

  notify(db, employee.id, {
    type: 'manager_assigned',
    title: 'Manager assigned',
    message: `You are now in ${manager.name}'s team${manager.department ? ` (${manager.department})` : ''}. You can submit expenses for approval.`,
  });
  notify(db, manager.id, {
    type: 'team_joined',
    title: 'New team member',
    message: `${employee.name} joined your team.${moved.length ? ` ${moved.length} pending expense${moved.length === 1 ? '' : 's'} moved to you for review.` : ''}`,
  });
  if (previousManager) {
    notify(db, previousManager.id, { type: 'team_left', title: 'Team change', message: `${employee.name} moved to ${manager.name}'s team.` });
  }
  logActivity(db, actor.id, previousManager ? 'employee_reassigned' : 'employee_assigned', {
    targetType: 'user',
    targetId: employee.id,
    summary: `${actor.name} assigned ${employee.name} to ${manager.name}${previousManager ? ` (was ${previousManager.name})` : ''}.`,
  });
  commit(db, ['users', 'expenses', 'notifications', 'activity']);
  return { ok: true, movedCount: moved.length };
}

// Monthly spending limit in rupees text; empty text removes the limit.
export function setMonthlyLimit(actor, employeeId, limitText) {
  const db = loadDb();
  const employee = findUser(db, employeeId);
  if (!can(actor, 'limit.set', employee, db)) return DENIED;

  let limit = null;
  if (String(limitText ?? '').trim() !== '') {
    limit = parseMoney(limitText);
    if (!isValidAmount(limit, MAX_LIMIT_PAISE)) {
      return { ok: false, errors: { limit: 'Enter a positive amount up to ₹1,00,00,000, with at most 2 decimals.' } };
    }
  }
  employee.monthlyLimit = limit;
  employee.updatedAt = nowIso();
  notify(db, employee.id, {
    type: 'limit_set',
    title: 'Monthly limit updated',
    message: limit === null ? `${actor.name} removed your monthly spending limit.` : `${actor.name} set your monthly spending limit to ${formatMoney(limit)}.`,
  });
  commit(db, ['users', 'notifications']);
  return { ok: true, user: employee };
}
