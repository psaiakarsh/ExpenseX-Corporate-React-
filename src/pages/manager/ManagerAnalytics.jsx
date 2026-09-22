// ManagerAnalytics — V1 manager/analytics.html + pages/manager-analytics.js.
// Every figure starts from visibleExpenses(manager) / visibleReimbursements(manager), so another team's
// claims and company-wide data never appear. The calculations live in analytics.js; this page filters by
// period/employee/project and renders.
import { STATUS } from '../../domain/constants.js';
import { formatMonth, lastMonthKeys } from '../../domain/dates.js';
import { formatMoney } from '../../domain/money.js';
import {
  approvalRate, breakdownByStatus, filterByMonths, reimbursementStats, spendingByCategory, spendingByMonth,
  spendingByProject, summarizeExpenses,
} from '../../domain/analytics.js';
import { findUser, teamMembers, visibleExpenses, visibleProjects, visibleReimbursements } from '../../domain/permissions.js';
import { projectName } from '../../domain/projects.js';
import { filterExpenses } from '../../domain/expense-query.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { BarList, ColumnChart, SplitChart, StatCard, StatusChart, countText } from '../../components/charts.jsx';
import { SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { EmptyState, PageHeader } from '../../components/ui.jsx';

const PERIODS = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
];

function EmployeeTable({ expenses, db, managerId }) {
  const ids = [...new Set(expenses.map((expense) => expense.employeeId))];
  if (ids.length === 0) return <EmptyState message="No expenses in this period." icon="users" />;
  const rows = ids
    .map((id) => ({ id, name: findUser(db, id)?.name ?? 'Unknown', summary: summarizeExpenses(expenses.filter((expense) => expense.employeeId === id)) }))
    .sort((a, b) => b.summary.claimed.amount - a.summary.claimed.amount);

  return (
    <div className="table-wrap">
      <table className="table table-stack">
        <caption className="sr-only">Spending per person in the selected period</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col" className="amount">Spending</th>
            <th scope="col" className="amount">Claims</th>
            <th scope="col" className="amount">Average</th>
            <th scope="col" className="amount">Pending</th>
            <th scope="col" className="amount">Reimbursed</th>
            <th scope="col" className="amount">Rejected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, summary }) => (
            <tr key={id}>
              <th scope="row">
                {name}{id === managerId ? <span className="muted xsmall"> (me)</span> : null}
              </th>
              <td data-label="Spending" className="amount">{formatMoney(summary.claimed.amount)}</td>
              <td data-label="Claims" className="amount">{summary.claimed.count}</td>
              <td data-label="Average" className="amount">
                {formatMoney(summary.claimed.count ? Math.round(summary.claimed.amount / summary.claimed.count) : 0)}
              </td>
              <td data-label="Pending" className="amount">{formatMoney(summary.pending.amount)}</td>
              <td data-label="Reimbursed" className="amount">{formatMoney(summary.reimbursed.amount)}</td>
              <td data-label="Rejected" className="amount">{summary.rejected.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ManagerAnalytics() {
  const { user } = useAuth();
  const { db } = useCompany();
  const [filters, setFilter] = useFilters({ months: '6', employeeId: '', projectId: '' });

  const scoped = visibleExpenses(user, db);
  const people = [user, ...teamMembers(user, db, { includeInactive: true })];
  const projectIds = [...new Set([...visibleProjects(user, db).map((project) => project.id), ...scoped.map((expense) => expense.projectId ?? 'none')])];

  const months = lastMonthKeys(Number(filters.months) || 6);
  const expenses = filterByMonths(filterExpenses(scoped, db, filters), months);
  const summary = summarizeExpenses(expenses);
  const rate = approvalRate(expenses);
  const ids = new Set(expenses.map((expense) => expense.id));
  const reimbursements = reimbursementStats(visibleReimbursements(user, db).filter((record) => ids.has(record.expenseId)));

  return (
    <>
      <PageHeader title="Team analytics" description="Calculated live from stored expenses in your scope only: your own expenses and the submitted claims of your
            current team. Spending = Pending + Approved + Reimbursement Pending + Reimbursed." />

      <Toolbar label="Analytics filters">
        <SelectFilter id="months" label="Period (by expense date)" value={filters.months} options={PERIODS} onChange={(value) => setFilter('months', value)} />
        <SelectFilter
          id="employeeId" label="Employee" value={filters.employeeId}
          options={[{ value: '', label: 'Everyone' }, ...people.map((person) => ({ value: person.id, label: person.id === user.id ? `${person.name} (me)` : person.name }))]}
          onChange={(value) => setFilter('employeeId', value)}
        />
        <SelectFilter
          id="projectId" label="Project" value={filters.projectId}
          options={[{ value: '', label: 'All projects' }, ...projectIds.map((id) => ({ value: id, label: id === 'none' ? 'No project' : projectName(db, id) }))]}
          onChange={(value) => setFilter('projectId', value)}
        />
      </Toolbar>

      <section aria-label="Summary">
        <div className="stats stats-4">
          <StatCard label="Spending" value={formatMoney(summary.claimed.amount)} sub={countText(summary.claimed.count)} icon="receipt" accent />
          <StatCard
            label="Average claim"
            value={formatMoney(summary.claimed.count ? Math.round(summary.claimed.amount / summary.claimed.count) : 0)}
            icon="chart"
          />
          <StatCard
            label="Approval rate" value={rate === null ? '—' : `${rate}%`}
            sub={`${summary.approved.count} approved · ${summary.rejected.count} rejected`} icon="check"
          />
          <StatCard label="Pending review" value={formatMoney(summary.pending.amount)} sub={countText(summary.pending.count)} icon="clock" />
        </div>
      </section>

      <section className="card" aria-labelledby="monthly-title" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2 id="monthly-title">Monthly spending</h2>
          <span className="muted xsmall">{formatMonth(months[0])} – {formatMonth(months.at(-1))}</span>
        </div>
        <ColumnChart rows={spendingByMonth(expenses, months)} caption="Team spending per month" />
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="category-title">
          <div className="card-header"><h2 id="category-title">Spending by category</h2></div>
          <BarList rows={spendingByCategory(expenses)} limit={10} />
        </section>
        <section className="card" aria-labelledby="project-title">
          <div className="card-header"><h2 id="project-title">Spending by project</h2></div>
          <BarList rows={spendingByProject(expenses, db)} limit={10} />
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="status-title">
          <div className="card-header"><h2 id="status-title">Status distribution</h2></div>
          <p className="muted xsmall" style={{ marginBottom: 12 }}>
            Approving an expense moves it straight to Reimbursement Pending, so “Approved” is shown as a history figure
            below rather than a waiting status.
          </p>
          {/* Managers never see others' drafts and their own claims are never drafts. */}
          <StatusChart rows={breakdownByStatus(expenses).filter((row) => row.status !== STATUS.DRAFT)} empty="No expenses in this period." />
          <p className="small footnote">
            <strong>{summary.approved.count}</strong> claim{summary.approved.count === 1 ? '' : 's'} approved
            ({formatMoney(summary.approved.amount)}) — now Reimbursement Pending or Reimbursed.
          </p>
        </section>
        <section className="card" aria-labelledby="reimbursement-title">
          <div className="card-header"><h2 id="reimbursement-title">Reimbursements</h2></div>
          <SplitChart
            parts={[
              { status: STATUS.REIMBURSEMENT_PENDING, label: 'Reimbursement pending', ...reimbursements.pending },
              { status: STATUS.REIMBURSED, label: 'Reimbursed', ...reimbursements.reimbursed },
            ]}
          />
          <p className="small footnote">
            {reimbursements.averageDays === null
              ? 'Nothing reimbursed in this period yet.'
              : `Average time from approval to payout: ${reimbursements.averageDays} day${reimbursements.averageDays === 1 ? '' : 's'}.`}
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="employee-title">
        <div className="card-header"><h2 id="employee-title">Employee spending</h2></div>
        <EmployeeTable expenses={expenses} db={db} managerId={user.id} />
      </section>
    </>
  );
}
