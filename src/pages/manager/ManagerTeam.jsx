// ManagerTeam — V1 manager/team.html + pages/manager-team.js.
// Employees CURRENTLY assigned to this manager, with their monthly limits. A manager may set limits and
// add an employee to their OWN team (createManagedAccount forces the role and the team). Reassigning,
// deactivating and role changes are Admin-only: they are not offered here and the domain refuses them.
import { Link } from 'react-router';
import { STATUS } from '../../domain/constants.js';
import { currentMonthKey, formatMonth } from '../../domain/dates.js';
import { formatMoney, toAmountInput } from '../../domain/money.js';
import { limitStatus } from '../../domain/limits.js';
import { createManagedAccount, setMonthlyLimit } from '../../domain/users.js';
import { findUser, isActiveUser, teamMembers, visibleExpenses } from '../../domain/permissions.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useDialogs } from '../../app/DialogContext.jsx';
import { useToast } from '../../app/ToastContext.jsx';
import { LimitBadge } from '../../components/badges.jsx';
import { StatCard } from '../../components/charts.jsx';
import { Avatar, EmptyState, Icon, PageHeader } from '../../components/ui.jsx';

export function ManagerTeam() {
  const { user } = useAuth();
  const { db, refresh } = useCompany();
  const { openFormDialog } = useDialogs();
  const toast = useToast();

  const members = teamMembers(user, db, { includeInactive: true }).sort((a, b) => a.name.localeCompare(b.name));
  const active = members.filter(isActiveUser);
  const visible = visibleExpenses(user, db);
  const statuses = active.map((member) => limitStatus(member, db.expenses, db.settings));
  const flagged = statuses.filter((status) => status.level === 'warning' || status.level === 'exceeded').length;

  const setLimit = async (memberId) => {
    const member = findUser(db, memberId);
    await openFormDialog({
      title: `Monthly limit · ${member.name}`,
      description: <p>Leave empty for no limit. Usage counts this month’s pending, approved, reimbursement-pending and reimbursed claims. Limits only warn.</p>,
      fields: [{
        name: 'limit',
        label: 'Monthly limit (₹)',
        value: member.monthlyLimit ? toAmountInput(member.monthlyLimit) : '',
        inputMode: 'decimal',
        placeholder: 'e.g. 20000',
        autocomplete: 'off',
      }],
      submitLabel: 'Save limit',
      onSubmit: ({ limit }) => {
        const result = setMonthlyLimit(user, member.id, limit); // refuses employees outside this team
        if (result.ok) toast(`Limit for ${member.name} saved.`);
        refresh();
        return result;
      },
    });
  };

  const addEmployee = async () => {
    await openFormDialog({
      title: 'Add employee to your team',
      description: <p>Creates an <strong>Employee</strong> account in your team. Share the temporary password; they can change it in Profile.</p>,
      fields: [
        { name: 'name', label: 'Full name', required: true, maxLength: 50, autocomplete: 'off' },
        { name: 'email', label: 'Work email', type: 'email', required: true, maxLength: 100, autocomplete: 'off' },
        { name: 'password', label: 'Temporary password', required: true, maxLength: 72, autocomplete: 'new-password', hint: 'At least 6 characters.' },
      ],
      submitLabel: 'Add employee',
      onSubmit: async (values) => {
        const result = await createManagedAccount(user, 'employee', values); // role + team decided by the domain
        if (result.ok) toast(`${result.user.name} added to your team.`);
        refresh();
        return result;
      },
    });
  };

  return (
    <>
      <PageHeader title="My team" description={<>{active.length} active employee{active.length === 1 ? '' : 's'} in {user.department || 'your team'}
            {members.length > active.length ? ` · ${members.length - active.length} inactive` : ''}.</>} actions={<button className="btn btn-primary" type="button" onClick={addEmployee}>Add employee</button>} />

      <section aria-label="Team limits summary">
        <div className="stats stats-4">
          <StatCard label="Team size" value={String(active.length)} sub="active employees" icon="users" accent />
          <StatCard
            label="Spent this month" value={formatMoney(statuses.reduce((sum, status) => sum + status.used, 0))}
            sub={formatMonth(currentMonthKey())} icon="receipt"
          />
          <StatCard
            label="Total monthly limits" value={formatMoney(statuses.reduce((sum, status) => sum + (status.limit ?? 0), 0))}
            sub={`${statuses.filter((status) => status.limit === null).length} without a limit`} icon="banknote"
          />
          <StatCard label="Limit alerts" value={String(flagged)} sub={`at ≥ ${db.settings.limitWarningPercent}% (warn only)`} icon="alert" />
        </div>
      </section>

      <div className="callout callout-info" style={{ marginBottom: 16 }}>
        <Icon name="info" />
        <p>
          Monthly limits are <strong>warnings only</strong>: employees can still submit over their limit and you will
          see a flag. Reassigning employees, deactivating accounts and changing roles are done by an Admin.
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState icon="users" message="No employees yet. Add one, or ask an Admin to assign employees to you." />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <caption className="sr-only">Employees in your team with monthly limit usage</caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Status</th>
                <th scope="col" className="amount">Monthly limit</th>
                <th scope="col" className="amount">This month</th>
                <th scope="col">Usage</th>
                <th scope="col" className="amount">Expenses</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const status = limitStatus(member, db.expenses, db.settings);
                const claims = visible.filter((expense) => expense.employeeId === member.id);
                const pending = claims.filter((expense) => expense.status === STATUS.PENDING).length;
                return (
                  <tr key={member.id}>
                    <th scope="row">
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <Avatar name={member.name} size="sm" />
                        <div style={{ textAlign: 'left' }}>
                          <div>{member.name}</div>
                          <div className="muted xsmall">{member.email}</div>
                        </div>
                      </div>
                    </th>
                    <td data-label="Status">
                      {isActiveUser(member)
                        ? <span className="badge badge-approved">Active</span>
                        : <span className="badge badge-muted">Inactive</span>}
                    </td>
                    <td data-label="Monthly limit" className="amount">{status.limit === null ? '—' : formatMoney(status.limit)}</td>
                    <td data-label="This month" className="amount">{formatMoney(status.used)}</td>
                    <td data-label="Usage">
                      {status.limit === null ? <span className="badge badge-muted">No limit</span> : (
                        <>
                          {status.level === 'warning' || status.level === 'exceeded'
                            ? <LimitBadge level={status.level} />
                            : <span className="badge badge-approved"><Icon name="check" size={14} />Within limit</span>}
                          {' '}
                          <span className="num small">{status.percent}%</span>
                        </>
                      )}
                    </td>
                    <td data-label="Expenses" className="amount">
                      {claims.length}
                      {pending ? <span className="muted xsmall"> ({pending} pending)</span> : null}
                    </td>
                    <td className="actions-cell">
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setLimit(member.id)}>
                          Set limit<span className="sr-only"> for {member.name}</span>
                        </button>
                        <Link className="btn btn-ghost btn-sm" to={`/manager/expenses?employee=${encodeURIComponent(member.id)}`}>
                          Expenses<span className="sr-only"> of {member.name}</span>
                        </Link>
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
