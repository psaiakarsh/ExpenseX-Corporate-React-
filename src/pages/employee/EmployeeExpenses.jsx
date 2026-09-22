// EmployeeExpenses — V1 employee/expenses.html + pages/employee-expenses.js.
// The employee's OWN expenses only (visibleExpenses). Row actions follow the workflow: drafts can be
// edited or deleted, rejected claims edited and resubmitted, everything else is view-only — and
// deleteDraft() re-checks the permission itself.
import { useState } from 'react';
import { Link } from 'react-router';
import { STATUS } from '../../domain/constants.js';
import { deleteDraft } from '../../domain/expenses.js';
import { can, visibleExpenses, visibleProjects } from '../../domain/permissions.js';
import { projectName } from '../../domain/projects.js';
import { categoryOptions, filterExpenses, monthOptions, statusOptions } from '../../domain/expense-query.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useAction } from '../../app/useAction.js';
import { useDialogs } from '../../app/DialogContext.jsx';
import { expenseEditPath, expensePath } from '../../app/routes.jsx';
import { ExpenseRow } from '../../components/expense.jsx';
import { SORT_OPTIONS, SearchFilter, SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { EmptyState, Icon, PageHeader } from '../../components/ui.jsx';

const PAGE_SIZE = 15;

// The employee's current team projects plus any project already on their own claims (e.g. from a
// previous manager). Names only — no other data.
function projectFilterOptions(expenses, db, user) {
  const ids = new Set([...visibleProjects(user, db).map((project) => project.id), ...expenses.map((e) => e.projectId).filter(Boolean)]);
  const options = [...ids]
    .map((id) => ({ value: id, label: projectName(db, id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: '', label: 'All projects' }, ...options, { value: 'none', label: 'No project' }];
}

export function EmployeeExpenses() {
  const { user } = useAuth();
  const { db } = useCompany();
  const runAction = useAction();
  const { confirmAction } = useDialogs();
  const [filters, setFilter] = useFilters(
    { search: '', status: '', category: '', projectId: '', month: '', sort: 'newest' },
    ['status'],
  );
  const [limit, setLimit] = useState(PAGE_SIZE);

  const all = visibleExpenses(user, db); // own expenses only
  const matching = filterExpenses(all, db, filters);
  const shown = matching.slice(0, limit);

  const remove = async (expense) => {
    const confirmed = await confirmAction({
      title: 'Delete draft?',
      message: 'This draft was never submitted, so deleting it removes it completely. Submitted expenses can never be deleted.',
      confirmLabel: 'Delete draft',
      danger: true,
    });
    if (confirmed) runAction(() => deleteDraft(user, expense.id), 'Draft deleted.');
  };

  const rowActions = (expense) => {
    if (!can(user, 'expense.edit', expense, db)) {
      return <Link className="btn btn-ghost btn-sm" to={expensePath(expense.id)}>View<span className="sr-only"> {expense.title}</span></Link>;
    }
    if (expense.status === STATUS.DRAFT) {
      return (
        <>
          <Link className="btn btn-secondary btn-sm" to={expenseEditPath(expense.id)}>
            <Icon name="edit" size={16} /> Edit<span className="sr-only"> {expense.title}</span>
          </Link>
          <button className="btn btn-danger-ghost btn-sm" type="button" onClick={() => remove(expense)}>
            <Icon name="trash" size={16} /> Delete<span className="sr-only"> draft {expense.title}</span>
          </button>
        </>
      );
    }
    return (
      <Link className="btn btn-secondary btn-sm" to={expenseEditPath(expense.id)}>
        <Icon name="edit" size={16} /> Edit &amp; resubmit<span className="sr-only"> {expense.title}</span>
      </Link>
    );
  };

  const change = (name) => (value) => {
    setFilter(name, value);
    setLimit(PAGE_SIZE);
  };

  return (
    <>
      <PageHeader title="My expenses" description="Only you can see your drafts. Submitted claims are also visible to your reviewing manager." actions={<Link className="btn btn-primary" to="/expenses/new">New expense</Link>} />

      {user.managerId ? null : (
        <div className="callout callout-warning" role="status" style={{ marginBottom: 24 }}>
          <Icon name="alert" />
          <div>
            <strong>No manager assigned yet</strong>
            {' '}You can create drafts, but you cannot submit an expense until an Admin assigns you to a Manager.
          </div>
        </div>
      )}

      <Toolbar label="Filter expenses">
        <SearchFilter value={filters.search} onChange={change('search')} />
        <SelectFilter id="status" label="Status" value={filters.status} options={statusOptions()} onChange={change('status')} />
        <SelectFilter id="category" label="Category" value={filters.category} options={categoryOptions()} onChange={change('category')} />
        <SelectFilter id="projectId" label="Project" value={filters.projectId} options={projectFilterOptions(all, db, user)} onChange={change('projectId')} />
        <SelectFilter id="month" label="Month" value={filters.month} options={monthOptions(all)} onChange={change('month')} />
        <SelectFilter id="sort" label="Sort" value={filters.sort} options={SORT_OPTIONS} onChange={change('sort')} />
      </Toolbar>

      <p className="result-count" aria-live="polite">
        Showing {shown.length} of {matching.length} matching · {all.length} expense{all.length === 1 ? '' : 's'} in total
      </p>

      {shown.length ? (
        <ul className="list">
          {shown.map((expense) => (
            <ExpenseRow key={expense.id} expense={expense} db={db} showUpdated actions={rowActions(expense)} />
          ))}
        </ul>
      ) : (
        <EmptyState icon="receipt" message={all.length ? 'No expenses match these filters.' : 'No expenses yet. Create your first one.'} />
      )}

      <div className="centered-actions">
        <button className="btn btn-ghost" type="button" hidden={matching.length <= limit} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
          Show more
        </button>
      </div>
    </>
  );
}
