// projects.js — managers create and manage projects; employees pick one when filing an expense.
// Project { id, name, description, managerId, status: 'active'|'archived', createdAt, updatedAt }
// Projects are archived, never deleted, because expenses keep pointing at them.

import { DENIED, can } from './permissions.js';
import { commit, createId, loadDb, nowIso } from './storage.js';
import { checkName, checkText, collectErrors, hasErrors } from './validate.js';

export function validateProject(db, managerId, { name, description }, projectId = null) {
  const errors = collectErrors({
    name: checkName(name, 'Project name'),
    description: checkText(description, 200, 'Description'),
  });
  const clean = String(name ?? '').trim().toLowerCase();
  if (!errors.name && db.projects.some((p) => p.managerId === managerId && p.id !== projectId && p.name.toLowerCase() === clean)) {
    errors.name = 'You already have a project with this name.';
  }
  return errors;
}

export function createProject(actor, input) {
  const db = loadDb();
  if (!can(actor, 'project.create', null, db)) return DENIED;
  const errors = validateProject(db, actor.id, input);
  if (hasErrors(errors)) return { ok: false, errors };

  const now = nowIso();
  const project = {
    id: createId('prj'),
    name: input.name.trim(),
    description: String(input.description ?? '').trim(),
    managerId: actor.id,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  db.projects.push(project);
  commit(db, ['projects']);
  return { ok: true, project };
}

export function updateProject(actor, projectId, input) {
  const db = loadDb();
  const project = db.projects.find((p) => p.id === projectId);
  if (!can(actor, 'project.manage', project, db)) return DENIED;
  const errors = validateProject(db, actor.id, input, projectId);
  if (hasErrors(errors)) return { ok: false, errors };

  project.name = input.name.trim();
  project.description = String(input.description ?? '').trim();
  project.updatedAt = nowIso();
  commit(db, ['projects']);
  return { ok: true, project };
}

export function setProjectStatus(actor, projectId, status) {
  const db = loadDb();
  const project = db.projects.find((p) => p.id === projectId);
  if (!can(actor, 'project.manage', project, db)) return DENIED;
  if (!['active', 'archived'].includes(status)) return { ok: false, error: 'Unknown project status.' };
  project.status = status;
  project.updatedAt = nowIso();
  commit(db, ['projects']);
  return { ok: true, project };
}

export function projectName(db, projectId) {
  if (!projectId) return 'No project';
  return db.projects.find((p) => p.id === projectId)?.name ?? 'Unknown project';
}
