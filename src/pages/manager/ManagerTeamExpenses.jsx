// ManagerTeamExpenses — V1 manager/expenses.html + pages/manager-expenses.js.
// Everything this manager may see: their own claims and the SUBMITTED claims of employees currently in
// their team (visibleExpenses). Another team's claims and unsent drafts never reach this page.
import { useState } from 'react';
import { Link } from 'react-router';
import { STATUS } from '../../domain/constants.js';
import { formatMoney, sumAmounts } from '../../domain/money.js';
import { can, isActiveUser, teamMembers, visibleExpenses, visibleProjects } from '../../domain/permissions.js';
import { projectName } from '../../domain/projects.js';
import { categoryOptions, filterExpenses, monthOptions, statusOptions } from '../../domain/expense-query.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { ExpenseRow } from '../../components/expense.jsx';
import { SORT_OPTIONS, SearchFilter, SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { ReimburseButton, ReviewButtons } from '../../components/reviewDialogs.jsx';
import { EmptyState, PageHeader } from '../../components/ui.jsx';

const PAGE_SIZE = 20;

export function ManagerTeamExpenses() {
  const { user } = useAuth();
  const { db } = useCompany();
  const [filters, setFilter] = useFilters(
    { search: '', employeeId: '', status: '', category: '', projectId: '', month: '', sort: 'newest' },
    ['employee'],
  );
  const [limit, setLimit] = useState(PAGE_SIZE);

  const all = visibleExpenses(user, db);
  const people = [user, ...teamMembers(user, db, { includeInactive: true })];
  // ?employee= (from the Team page) is only honoured when it names someone in this manager's scope.
  const wanted = filters.employee && people.some((person) => person.id === filters.employee) ? filters.employee : '';
  const employeeId = filters.employeeId || wanted;
  const projectIds = [...new Set([...visibleProjects(user, db).map((project) => project.id), ...all.map((expense) => expense.projectId ?? 'none')])];

  const matching = filterExpenses(all, db, { ...filters, employeeId });
  const shown = matching.slice(0, limit);

  const change = (name) => (value) => {
    setFilter(name, value);
    setLimit(PAGE_SIZE);
  };

  const rowActions = (expense) => {
    if (can(user, 'expense.review', expense, db)) return <ReviewButtons manager={user} expense={expense} />;
    const record = db.reimbursements.find((item) => item.id === expense.reimbursementId);
    if (can(user, 'reimbursement.markPaid', record, db)) return <ReimburseButton manager={user} expense={expense} />;
    return null;
  };

  return (
    <>
      <PageHeader title="Team expenses" description="Your own expenses and the submitted claims of employees currently in your team. Employees’ unsent drafts stay private." actions={<Link className="btn btn-primary" to="/expenses/new">New expense</Link>} />

      <Toolbar label="Filter team expenses">
        <SearchFilter value={filters.search} onChange={change('search')} placeholder="Title, employee, project…" />
        <SelectFilter
          id="employeeId" label="Employee" value={employeeId}
          options={[
            { value: '', label: 'Everyone' },
            ...people.map((person) => ({
              value: person.id,
              label: person.id === user.id ? `${person.name} (me)` : `${person.name}${isActiveUser(person) ? '' : ' (inactive)'}`,
            })),
          ]}
          onChange={change('employeeId')}
        />
        <SelectFilter
          id="status" label="Status" value={filters.status}
          options={statusOptions().filter((option) => option.value !== STATUS.DRAFT)}
          onChange={change('status')}
        />
        <SelectFilter id="category" label="Category" value={filters.category} options={categoryOptions()} onChange={change('category')} />
        <SelectFilter
          id="projectId" label="Project" value={filters.projectId}
          options={[{ value: '', label: 'All projects' }, ...projectIds.map((id) => ({ value: id, label: id === 'none' ? 'No project' : projectName(db, id) }))]}
          onChange={change('projectId')}
        />
        <SelectFilter id="month" label="Month" value={filters.month} options={monthOptions(all)} onChange={change('month')} />
        <SelectFilter id="sort" label="Sort" value={filters.sort} options={SORT_OPTIONS} onChange={change('sort')} />
      </Toolbar>

      <p className="result-count" aria-live="polite">
        Showing {shown.length} of {matching.length} matching ({formatMoney(sumAmounts(matching))}) · {all.length} in your scope
      </p>

      {shown.length ? (
        <ul className="list">
          {shown.map((expense) => (
            <ExpenseRow key={expense.id} expense={expense} db={db} showEmployee showUpdated actions={rowActions(expense)} />
          ))}
        </ul>
      ) : (
        <EmptyState icon="receipt" message={all.length ? 'No expenses match these filters.' : 'No team expenses yet.'} />
      )}

      <div className="centered-actions">
        <button className="btn btn-ghost" type="button" hidden={matching.length <= limit} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
          Show more
        </button>
      </div>
    </>
  );
}
