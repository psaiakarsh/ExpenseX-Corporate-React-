// AdminUsers — V1 admin/users.html + pages/admin-users.js.
//
// The account directory: names, emails, roles, teams, status and dates only — never expense amounts or
// records. Every action calls a users.js function that checks can() and the business rules itself (for
// example a manager with any assigned employee cannot be deactivated).
import { ROLES } from '../../domain/constants.js';
import { formatDate, toLocalDate } from '../../domain/dates.js';
import { assignEmployee, createManagedAccount, setUserActive } from '../../domain/users.js';
import { findUser, isActiveUser, teamMembers } from '../../domain/permissions.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useAction } from '../../app/useAction.js';
import { useDialogs } from '../../app/DialogContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { RoleBadge } from '../../components/badges.jsx';
import { SearchFilter, SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { Avatar, EmptyState, PageHeader } from '../../components/ui.jsx';

const ROLE_ORDER = { admin: 0, manager: 1, user: 2 };

const ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: ROLES.MANAGER, label: 'Managers' },
  { value: ROLES.EMPLOYEE, label: 'Employees' },
  { value: ROLES.ADMIN, label: 'Admins' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Active and inactive' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const SORTS = {
  role: (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

const SORT_OPTIONS = [
  { value: 'role', label: 'Role, then name' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

function managerOptions(db, { excludeId = null } = {}) {
  return db.users
    .filter((user) => user.role === ROLES.MANAGER && isActiveUser(user) && user.id !== excludeId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((manager) => ({ value: manager.id, label: `${manager.name}${manager.department ? ` · ${manager.department}` : ''}` }));
}

function matches(user, filters) {
  if (filters.role && user.role !== filters.role) return false;
  if (filters.status === 'active' && !isActiveUser(user)) return false;
  if (filters.status === 'inactive' && isActiveUser(user)) return false;
  if (filters.manager === 'unassigned' && !(user.role === ROLES.EMPLOYEE && !user.managerId)) return false;
  if (filters.manager && filters.manager !== 'unassigned' && !(user.managerId === filters.manager || user.id === filters.manager)) return false;
  const search = String(filters.search ?? '').trim().toLowerCase();
  return !search || `${user.name} ${user.email} ${user.department}`.toLowerCase().includes(search);
}

function TeamCell({ user, db }) {
  if (user.role === ROLES.MANAGER) {
    const all = teamMembers(user, db, { includeInactive: true }).length;
    const active = teamMembers(user, db).length;
    return <>{user.department || '—'} · {active} active{all > active ? ` + ${all - active} inactive` : ''}</>;
  }
  if (user.role === ROLES.EMPLOYEE) {
    const manager = findUser(db, user.managerId);
    return manager ? <>{manager.name}</> : <span className="badge badge-warning">Unassigned</span>;
  }
  return <span className="muted">Administration</span>;
}

export function AdminUsers() {
  const { user: admin } = useAuth();
  const { db, refresh } = useCompany();
  const { openFormDialog, confirmAction } = useDialogs();
  const runAction = useAction();
  const toast = useToast();
  const [filters, setFilter] = useFilters({ search: '', role: '', status: '', manager: '', sort: 'role' }, ['manager']);

  const list = db.users.filter((person) => matches(person, filters)).sort(SORTS[filters.sort] ?? SORTS.role);

  const newAccount = async (kind) => {
    const isManager = kind === 'manager';
    await openFormDialog({
      title: isManager ? 'New manager' : 'New employee',
      description: isManager
        ? <p>Managers review and reimburse their team’s expenses. Share the temporary password with them; they can change it in Profile.</p>
        : null,
      fields: [
        { name: 'name', label: 'Full name', required: true, maxLength: 50, autocomplete: 'off' },
        { name: 'email', label: 'Work email', type: 'email', required: true, maxLength: 100, autocomplete: 'off' },
        ...(isManager
          ? [{ name: 'department', label: 'Department / team name', required: true, maxLength: 50, placeholder: 'e.g. Engineering' }]
          : [{ name: 'managerId', label: 'Manager', type: 'select', options: [{ value: '', label: 'No manager yet (drafts only)' }, ...managerOptions(db)] }]),
        { name: 'password', label: 'Temporary password', required: true, maxLength: 72, autocomplete: 'new-password', hint: 'At least 6 characters. Stored only as a salted hash.' },
      ],
      submitLabel: isManager ? 'Create manager' : 'Create employee',
      onSubmit: async (values) => {
        const result = await createManagedAccount(admin, kind, values);
        if (result.ok) toast(`${isManager ? 'Manager' : 'Employee'} ${result.user.name} created.`);
        refresh();
        return result;
      },
    });
  };

  const assign = async (employee) => {
    const choices = managerOptions(db, { excludeId: employee.managerId });
    if (choices.length === 0) {
      toast('There is no other active manager. Create a manager first.', 'error');
      return;
    }
    // No per-employee expense details here (admin privacy): the dialog explains the rule, not the numbers.
    await openFormDialog({
      title: `${employee.managerId ? 'Reassign' : 'Assign'} ${employee.name}`,
      description: (
        <>
          <p>Any expenses still awaiting approval move to the new manager for review.</p>
          <p>Approval history is never rewritten. From now on the new manager reviews and reimburses this employee’s claims.</p>
        </>
      ),
      fields: [{ name: 'managerId', label: 'New manager', type: 'select', required: true, options: choices }],
      submitLabel: employee.managerId ? 'Reassign' : 'Assign',
      onSubmit: ({ managerId }) => {
        const result = assignEmployee(admin, employee.id, managerId);
        if (result.ok) toast(`${employee.name} assigned. The new manager has been notified.`);
        refresh();
        return result;
      },
    });
  };

  const toggleActive = async (person, activate) => {
    const confirmed = await confirmAction({
      title: `${activate ? 'Reactivate' : 'Deactivate'} ${person.name}?`,
      message: activate
        ? 'They will be able to log in again.'
        : 'They will be signed out and unable to log in or act. Their records and history are kept.',
      confirmLabel: activate ? 'Reactivate' : 'Deactivate',
      danger: !activate,
    });
    if (confirmed) runAction(() => setUserActive(admin, person.id, activate), `${person.name} ${activate ? 'reactivated' : 'deactivated'}.`);
  };

  return (
    <>
      <PageHeader
        title="Users & teams"
        description="Create managers and employees, assign employees to teams, and deactivate or reactivate accounts. Accounts are never deleted, so their history stays intact."
        actions={(
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={() => newAccount('employee')}>New employee</button>
            <button className="btn btn-primary" type="button" onClick={() => newAccount('manager')}>New manager</button>
          </div>
        )}
      />

      <Toolbar label="Filter users">
        <SearchFilter value={filters.search} onChange={(value) => setFilter('search', value)} placeholder="Name, email or department" />
        <SelectFilter id="role" label="Role" value={filters.role} options={ROLE_OPTIONS} onChange={(value) => setFilter('role', value)} />
        <SelectFilter id="status" label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(value) => setFilter('status', value)} />
        <SelectFilter
          id="manager" label="Manager" value={filters.manager}
          options={[
            { value: '', label: 'Any manager' },
            { value: 'unassigned', label: 'Unassigned employees' },
            ...db.users.filter((person) => person.role === ROLES.MANAGER)
              .map((manager) => ({ value: manager.id, label: `${manager.name}${isActiveUser(manager) ? '' : ' (inactive)'}` })),
          ]}
          onChange={(value) => setFilter('manager', value)}
        />
        <SelectFilter id="sort" label="Sort" value={filters.sort} options={SORT_OPTIONS} onChange={(value) => setFilter('sort', value)} />
      </Toolbar>

      <p className="result-count" aria-live="polite">
        {list.length} of {db.users.length} account{db.users.length === 1 ? '' : 's'}
      </p>

      {list.length === 0 ? <EmptyState icon="users" message="No accounts match these filters." /> : (
        <div className="table-wrap">
          <table className="table table-stack">
            <caption className="sr-only">Accounts</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Manager / team</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((person) => {
                const active = isActiveUser(person);
                return (
                  <tr key={person.id}>
                    <th scope="row">
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <Avatar name={person.name} size="sm" />
                        <div>
                          <div>{person.name}{person.id === admin.id ? <span className="muted xsmall"> (you)</span> : null}</div>
                          <div className="muted xsmall">{person.email}</div>
                        </div>
                      </div>
                    </th>
                    <td data-label="Role"><RoleBadge role={person.role} /></td>
                    <td data-label="Manager / team"><TeamCell user={person} db={db} /></td>
                    <td data-label="Status">
                      {active ? <span className="badge badge-approved">Active</span> : <span className="badge badge-muted">Inactive</span>}
                    </td>
                    <td data-label="Created">{formatDate(toLocalDate(new Date(person.createdAt)))}</td>
                    <td className="actions-cell">
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        {person.role === ROLES.EMPLOYEE ? (
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => assign(person)}>
                            {person.managerId ? 'Reassign' : 'Assign'}<span className="sr-only"> {person.name}</span>
                          </button>
                        ) : null}
                        {person.id !== admin.id && person.role !== ROLES.ADMIN ? (
                          <button
                            className={`btn ${active ? 'btn-danger-ghost' : 'btn-ghost'} btn-sm`}
                            type="button"
                            onClick={() => toggleActive(person, !active)}
                          >
                            {active ? 'Deactivate' : 'Reactivate'}<span className="sr-only"> {person.name}</span>
                          </button>
                        ) : null}
                        {person.role === ROLES.ADMIN || person.id === admin.id
                          ? (person.role === ROLES.EMPLOYEE ? null : <span className="muted xsmall">—</span>)
                          : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
