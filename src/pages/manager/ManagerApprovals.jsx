// ManagerApprovals — V1 manager/approvals.html + pages/manager-approvals.js.
// "Awaiting my review" is exactly can('expense.review'): a PENDING claim of an employee currently in this
// manager's team, never their own and never another team's. Manager-created claims are approved on
// creation, so they never appear here. Approve/Reject go through the shared dialogs → the domain.
import { Link } from 'react-router';
import { STATUS } from '../../domain/constants.js';
import { formatMoney, sumAmounts } from '../../domain/money.js';
import { can, findUser, visibleExpenses } from '../../domain/permissions.js';
import { projectName } from '../../domain/projects.js';
import { categoryOptions, filterExpenses, lastSubmittedAt, monthOptions } from '../../domain/expense-query.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { expensePath } from '../../app/routes.jsx';
import { ExpenseRow } from '../../components/expense.jsx';
import { SearchFilter, SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { ReviewButtons, ReviewFlags } from '../../components/reviewDialogs.jsx';
import { EmptyState, PageHeader } from '../../components/ui.jsx';

const VIEWS = [
  { value: 'pending', label: 'Awaiting my review' },
  { value: 'rejected', label: 'Rejected by me (awaiting resubmission)' },
  { value: 'approved', label: 'Approved by me' },
];

const SORTS = [
  { value: 'waiting', label: 'Waiting longest' },
  { value: 'newest', label: 'Newest expense date' },
  { value: 'oldest', label: 'Oldest expense date' },
  { value: 'highest', label: 'Highest amount' },
  { value: 'lowest', label: 'Lowest amount' },
];

const EMPTY_TEXT = {
  rejected: 'No rejected expenses are waiting for resubmission.',
  approved: 'You have not approved any expenses yet.',
};

// Which of the visible expenses belong to the chosen view.
function approvalScope(user, db, view) {
  const visible = visibleExpenses(user, db).filter((expense) => expense.employeeId !== user.id);
  if (view === 'rejected') return visible.filter((expense) => expense.status === STATUS.REJECTED && expense.review?.byId === user.id);
  if (view === 'approved') return visible.filter((expense) => expense.history.some((entry) => entry.action === 'approved' && entry.byId === user.id));
  return visible.filter((expense) => can(user, 'expense.review', expense, db));
}

export function ManagerApprovals() {
  const { user } = useAuth();
  const { db } = useCompany();
  const [filters, setFilter] = useFilters({ search: '', view: 'pending', employeeId: '', category: '', projectId: '', month: '', sort: 'waiting' });

  const queue = approvalScope(user, db, 'pending');
  const scoped = approvalScope(user, db, filters.view);

  // Filter menus are built only from records already in this manager's scope.
  const people = [...new Set(scoped.map((expense) => expense.employeeId))].map((id) => findUser(db, id)).filter(Boolean);
  const projectIds = [...new Set(scoped.map((expense) => expense.projectId ?? 'none'))];

  const sorted = filterExpenses(scoped, db, { ...filters, sort: filters.sort === 'waiting' ? 'newest' : filters.sort });
  const shown = filters.sort === 'waiting'
    ? [...sorted].sort((a, b) => (lastSubmittedAt(a) ?? a.updatedAt).localeCompare(lastSubmittedAt(b) ?? b.updatedAt))
    : sorted;

  return (
    <>
      <PageHeader title="Approvals" description={<>{queue.length
              ? `${queue.length} expense${queue.length === 1 ? '' : 's'} awaiting your review · ${formatMoney(sumAmounts(queue))}`
              : 'Nothing is awaiting your review.'}</>} />

      <Toolbar label="Filter approvals">
        <SearchFilter value={filters.search} onChange={(value) => setFilter('search', value)} placeholder="Title, employee, project…" />
        <SelectFilter id="view" label="Show" value={filters.view} options={VIEWS} onChange={(value) => setFilter('view', value)} />
        <SelectFilter
          id="employeeId" label="Employee" value={filters.employeeId}
          options={[{ value: '', label: 'All employees' }, ...people.map((person) => ({ value: person.id, label: person.name }))]}
          onChange={(value) => setFilter('employeeId', value)}
        />
        <SelectFilter id="category" label="Category" value={filters.category} options={categoryOptions()} onChange={(value) => setFilter('category', value)} />
        <SelectFilter
          id="projectId" label="Project" value={filters.projectId}
          options={[{ value: '', label: 'All projects' }, ...projectIds.map((id) => ({ value: id, label: id === 'none' ? 'No project' : projectName(db, id) }))]}
          onChange={(value) => setFilter('projectId', value)}
        />
        <SelectFilter id="month" label="Expense month" value={filters.month} options={monthOptions(scoped)} onChange={(value) => setFilter('month', value)} />
        <SelectFilter id="sort" label="Sort" value={filters.sort} options={SORTS} onChange={(value) => setFilter('sort', value)} />
      </Toolbar>

      <p className="result-count" aria-live="polite">{shown.length} shown · {formatMoney(sumAmounts(shown))}</p>

      {shown.length ? (
        <ul className="list">
          {shown.map((expense) => (
            <ExpenseRow
              key={expense.id} expense={expense} db={db} showEmployee showSubmitted
              flag={<ReviewFlags expense={expense} db={db} />}
              actions={(
                <>
                  <Link className="btn btn-ghost btn-sm" to={expensePath(expense.id)}>
                    Details<span className="sr-only"> for {expense.title}</span>
                  </Link>
                  {can(user, 'expense.review', expense, db) ? <ReviewButtons manager={user} expense={expense} /> : null}
                </>
              )}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="inbox"
          message={EMPTY_TEXT[filters.view] ?? (scoped.length ? 'No pending expenses match these filters.' : 'All caught up — nothing is awaiting your review.')}
        />
      )}
    </>
  );
}
