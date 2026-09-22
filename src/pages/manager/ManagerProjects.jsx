// ManagerProjects — V1 manager/projects.html + pages/manager-projects.js.
// This manager's own projects only (visibleProjects). createProject / updateProject / setProjectStatus
// refuse a project owned by another manager, and the spending figures come from this manager's scope.
// Stored status is 'active' | 'archived', shown as Active / Inactive.
import { useState } from 'react';
import { STATUS } from '../../domain/constants.js';
import { formatDate, formatDateTime, toLocalDate } from '../../domain/dates.js';
import { formatMoney, sumAmounts } from '../../domain/money.js';
import { breakdownByStatus, groupSpending, onlySpending } from '../../domain/analytics.js';
import { createProject, setProjectStatus, updateProject } from '../../domain/projects.js';
import { findUser, visibleExpenses, visibleProjects } from '../../domain/permissions.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useAction } from '../../app/useAction.js';
import { useDialogs } from '../../app/DialogContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { BarList, StatCard, StatusChart, countText } from '../../components/charts.jsx';
import { EmptyState, Icon, PageHeader } from '../../components/ui.jsx';

const TABS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'archived', label: 'Inactive' }];

function statsFor(project, spending, scoped) {
  const claims = spending.filter((expense) => expense.projectId === project.id);
  return {
    claims,
    total: sumAmounts(claims),
    pending: scoped.filter((expense) => expense.projectId === project.id && expense.status === STATUS.PENDING).length,
    people: new Set(claims.map((expense) => expense.employeeId)).size,
  };
}

export function ManagerProjects() {
  const { user } = useAuth();
  const { db, refresh } = useCompany();
  const { openFormDialog, confirmAction } = useDialogs();
  const runAction = useAction();
  const toast = useToast();
  const [tab, setTab] = useState('all');

  const projects = visibleProjects(user, db);
  const scoped = visibleExpenses(user, db);
  const spending = onlySpending(scoped);
  const activeProjects = projects.filter((project) => project.status === 'active');
  const tagged = spending.filter((expense) => projects.some((project) => project.id === expense.projectId));

  const shown = projects
    .filter((project) => tab === 'all' || project.status === tab)
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1));

  const projectDialog = (project = null) => openFormDialog({
    title: project ? 'Edit project' : 'New project',
    description: project ? null : <p>The project belongs to your team. Only you can edit or deactivate it.</p>,
    fields: [
      { name: 'name', label: 'Project name', required: true, maxLength: 50, value: project?.name ?? '' },
      { name: 'description', label: 'Description', type: 'textarea', maxLength: 200, value: project?.description ?? '' },
    ],
    submitLabel: project ? 'Save project' : 'Create project',
    onSubmit: (values) => {
      const result = project ? updateProject(user, project.id, values) : createProject(user, values);
      if (result.ok) toast(project ? 'Project updated.' : 'Project created.');
      refresh();
      return result;
    },
  });

  const detailsDialog = (project) => {
    const stats = statsFor(project, spending, scoped);
    const byPerson = groupSpending(stats.claims, (expense) => expense.employeeId, (id) => findUser(db, id)?.name ?? 'Unknown');
    const byStatus = breakdownByStatus(scoped.filter((expense) => expense.projectId === project.id))
      .filter((row) => row.count > 0 && row.status !== STATUS.DRAFT);
    return openFormDialog({
      title: project.name,
      description: (
        <>
          <dl className="details">
            <div><dt>Status</dt><dd>{project.status === 'archived' ? 'Inactive' : 'Active'}</dd></div>
            <div><dt>Created</dt><dd>{formatDateTime(project.createdAt)}</dd></div>
            <div><dt>Owner</dt><dd>{user.name}{user.department ? ` · ${user.department}` : ''}</dd></div>
            <div><dt>Total spending</dt><dd className="num">{formatMoney(stats.total)} · {countText(stats.claims.length)}</dd></div>
            <div style={{ gridColumn: '1/-1' }}><dt>Description</dt><dd>{project.description || 'No description'}</dd></div>
            <div style={{ gridColumn: '1/-1' }}><dt>Project ID</dt><dd><code className="xsmall">{project.id}</code></dd></div>
          </dl>
          <h3 className="small" style={{ marginTop: 8 }}>Spending by person</h3>
          <BarList rows={byPerson} empty="No spending on this project yet." />
          <h3 className="small" style={{ marginTop: 8 }}>Claims by status</h3>
          {byStatus.length ? <StatusChart rows={byStatus} /> : <p className="muted small">No submitted claims.</p>}
        </>
      ),
      submitLabel: 'Close',
      onSubmit: () => ({ ok: true }),
    });
  };

  const toggleStatus = async (project) => {
    const deactivating = project.status === 'active';
    if (deactivating) {
      const confirmed = await confirmAction({
        title: 'Deactivate project?',
        message: 'Existing expenses keep this project. Employees won’t be able to choose it for new expenses until you activate it again.',
        confirmLabel: 'Deactivate',
      });
      if (!confirmed) return;
    }
    runAction(
      () => setProjectStatus(user, project.id, deactivating ? 'archived' : 'active'),
      deactivating ? 'Project deactivated.' : 'Project activated.',
    );
  };

  return (
    <>
      <PageHeader title="Projects" description="Your team chooses one of your active projects on each expense. Inactive projects keep their history but
            can&apos;t be chosen for new expenses." actions={<button className="btn btn-primary" type="button" onClick={() => projectDialog()}>New project</button>} />

      <section aria-label="Project summary">
        <div className="stats stats-4">
          <StatCard label="Active projects" value={String(activeProjects.length)} sub={`${projects.length - activeProjects.length} inactive`} icon="folder" accent />
          <StatCard label="Spending on projects" value={formatMoney(sumAmounts(tagged))} sub={countText(tagged.length)} icon="receipt" />
          <StatCard label="Without a project" value={formatMoney(sumAmounts(spending.filter((expense) => !expense.projectId)))} icon="info" />
          <StatCard
            label="Pending on projects"
            value={String(scoped.filter((expense) => expense.projectId && expense.status === STATUS.PENDING).length)}
            sub="claims awaiting review" icon="clock"
          />
        </div>
      </section>

      <div className="tabs" role="group" aria-label="Show">
        {TABS.map((option) => (
          <button key={option.value} className="tab" type="button" aria-pressed={tab === option.value} onClick={() => setTab(option.value)}>
            {option.label}
          </button>
        ))}
      </div>

      <ul className="list">
        {shown.length === 0 ? (
          <li>
            <EmptyState
              icon="folder"
              message={projects.length ? 'No projects in this view.' : 'No projects yet. Create one so your team can tag expenses.'}
            />
          </li>
        ) : shown.map((project) => {
          const stats = statsFor(project, spending, scoped);
          const inactive = project.status === 'archived';
          return (
            <li className="list-row" key={project.id}>
              <span className="row-icon" aria-hidden="true"><Icon name="folder" /></span>
              <div className="list-row-main">
                <span className="list-row-title">
                  {project.name}{' '}
                  {inactive ? <span className="badge badge-muted">Inactive</span> : <span className="badge badge-approved">Active</span>}
                </span>
                <span className="list-row-meta">
                  <span>{project.description || 'No description'}</span>
                  <span>Created {formatDate(toLocalDate(new Date(project.createdAt)))}</span>
                  <span>{stats.people} {stats.people === 1 ? 'person' : 'people'}</span>
                  {stats.pending ? <span>{stats.pending} pending</span> : null}
                </span>
              </div>
              <div className="list-row-side">
                <span className="list-row-amount">{formatMoney(stats.total)}</span>
                <span className="muted xsmall">{countText(stats.claims.length)}</span>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => detailsDialog(project)}>
                  Details<span className="sr-only"> {project.name}</span>
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => projectDialog(project)}>
                  <Icon name="edit" size={16} /> Edit<span className="sr-only"> {project.name}</span>
                </button>
                <button className={`btn ${inactive ? 'btn-secondary' : 'btn-ghost'} btn-sm`} type="button" onClick={() => toggleStatus(project)}>
                  {inactive ? 'Activate' : 'Deactivate'}<span className="sr-only"> {project.name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
