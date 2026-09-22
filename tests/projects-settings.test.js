import { reset, makeCompany, ok } from './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectName, setProjectStatus, updateProject } from '../src/domain/projects.js';
import { selectableProjects } from '../src/domain/permissions.js';
import { updateSettings } from '../src/domain/settings.js';
import { loadDb } from '../src/domain/storage.js';

describe('projects', () => {
  beforeEach(reset);

  test('only managers create projects', async () => {
    const { admin, e1, mA } = await makeCompany();
    assert.equal(createProject(admin, { name: 'Nope' }).ok, false);
    assert.equal(createProject(e1, { name: 'Nope' }).ok, false);
    const { project } = ok(createProject(mA, { name: '  New One ', description: ' d ' }));
    assert.deepEqual([project.name, project.description, project.managerId, project.status], ['New One', 'd', mA.id, 'active']);
  });

  test('names are unique per manager (case-insensitive) and validated', async () => {
    const { mA, mB } = await makeCompany();
    assert.match(createProject(mA, { name: 'alpha PROJECT' }).errors.name, /already have/);
    ok(createProject(mB, { name: 'Alpha Project' })); // another manager may reuse the name
    assert.match(createProject(mA, { name: 'x' }).errors.name, /2–50/);
    assert.match(createProject(mA, { name: 'Valid', description: 'x'.repeat(201) }).errors.description, /200/);
  });

  test('only the owner edits or (de)activates; archived projects leave the picker but keep their name', async () => {
    const { mA, mB, e1, pA } = await makeCompany();
    assert.equal(updateProject(mB, pA.id, { name: 'Hijack' }).ok, false);
    assert.equal(setProjectStatus(mB, pA.id, 'archived').ok, false);
    assert.equal(setProjectStatus(e1, pA.id, 'archived').ok, false);
    ok(updateProject(mA, pA.id, { name: 'Alpha Project', description: 'same name is fine for itself' }));
    assert.match(setProjectStatus(mA, pA.id, 'deleted').error, /Unknown project status/);
    ok(setProjectStatus(mA, pA.id, 'archived'));
    const db = loadDb();
    assert.equal(selectableProjects(db, mA.id).length, 0);
    assert.equal(projectName(db, pA.id), 'Alpha Project');
    ok(setProjectStatus(mA, pA.id, 'active'));
    assert.equal(selectableProjects(loadDb(), mA.id).length, 1);
  });

  test('projectName fallbacks', () => {
    const db = { projects: [] };
    assert.equal(projectName(db, null), 'No project');
    assert.equal(projectName(db, 'prj_missing'), 'Unknown project');
  });
});

describe('settings (Admin only)', () => {
  beforeEach(reset);

  test('validates and saves, and logs the change', async () => {
    const { admin, mA } = await makeCompany();
    const valid = { companyName: 'Renamed Co', limitWarningPercent: '75', allowSignup: false };
    assert.equal(updateSettings(mA, valid).ok, false);
    for (const percent of ['49', '100', 'abc', '80.5', '']) {
      assert.ok(updateSettings(admin, { ...valid, limitWarningPercent: percent }).errors?.limitWarningPercent, percent);
    }
    assert.ok(updateSettings(admin, { ...valid, companyName: 'X' }).errors.companyName);
    ok(updateSettings(admin, { ...valid, limitWarningPercent: '50' }));
    const { settings } = ok(updateSettings(admin, { ...valid, limitWarningPercent: 99 }));
    assert.deepEqual([settings.companyName, settings.limitWarningPercent, settings.allowSignup, settings.currency], ['Renamed Co', 99, false, 'INR']);
    const entry = loadDb().activity[0];
    assert.equal(entry.action, 'settings_updated');
    assert.match(entry.summary, /limit warning 99%, public signup off/);
  });
});
