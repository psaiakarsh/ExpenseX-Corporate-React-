// ManagerDashboard — V1 manager/dashboard.html + pages/manager-dashboard.js.
// Scope: visibleExpenses(manager) = the manager's own claims + the SUBMITTED claims of employees
// currently in their team, and teamMembers(manager). Nothing company-wide, no other team.
import { Link } from 'react-router';
import { STATUS } from '../../domain/constants.js';
import { breakdownByStatus, onlySpending, spendingByCategory, spendingByMonth, spendingByProject, summarizeExpenses } from '../../domain/analytics.js';
import { currentMonthKey, formatMonth, lastMonthKeys, monthKey } from '../../domain/dates.js';
import { formatMoney, sumAmounts } from '../../domain/money.js';
import { limitStatus } from '../../domain/limits.js';
import { can, teamMembers, visibleExpenses } from '../../domain/permissions.js';
import { SORTS } from '../../domain/expense-query.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useNotifications } from '../../app/NotificationContext.jsx';
import { LimitBadge, LimitMeter } from '../../components/badges.jsx';
import { BarList, ColumnChart, StatCard, StatusChart, countText } from '../../components/charts.jsx';
import { ExpenseList, ExpenseRow, RecentEvents } from '../../components/expense.jsx';
import { NotificationPreview } from '../../components/notifications.jsx';
import { ReviewButtons, ReviewFlags } from '../../components/reviewDialogs.jsx';
import { EmptyState, PageHeader } from '../../components/ui.jsx';

function LimitWarnings({ team, db }) {
  if (team.length === 0) return <EmptyState message="No employees in your team yet." icon="users" />;
  const rows = team.map((member) => ({ member, status: limitStatus(member, db.expenses, db.settings) }));
  const flagged = rows
    .filter(({ status }) => status.level === 'warning' || status.level === 'exceeded')
    .sort((a, b) => b.status.percent - a.status.percent);
  const noLimit = rows.filter(({ status }) => status.level === 'none').length;

  const footer = (
    <p className="muted xsmall footnote">
      Warning at {db.settings.limitWarningPercent}% · exceeded at 100%. Limits only warn; employees can still submit.
      {noLimit ? ` ${noLimit} employee${noLimit === 1 ? ' has' : 's have'} no limit set.` : ''}
    </p>
  );

  if (flagged.length === 0) {
    return (
      <>
        <EmptyState message="Everyone is within their monthly limit." icon="check" />
        {footer}
      </>
    );
  }
  return (
    <>
      <div className="stack">
        {flagged.map(({ member, status }) => (
          <div key={member.id}>
            <div className="row" style={{ marginBottom: 6 }}><LimitBadge level={status.level} /></div>
            <LimitMeter status={status} label={member.name} />
          </div>
        ))}
      </div>
      {footer}
    </>
  );
}

function EmployeeSummary({ team, expenses, db }) {
  if (team.length === 0) return <EmptyState message="No employees in your team yet." icon="users" />;
  return (
    <div className="table-wrap">
      <table className="table table-stack">
        <caption className="sr-only">Spending per employee in your team</caption>
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col" className="amount">Total claimed</th>
            <th scope="col" className="amount">This month</th>
            <th scope="col">Limit</th>
            <th scope="col" className="amount">Pending</th>
          </tr>
        </thead>
        <tbody>
          {team.map((member) => {
            const own = expenses.filter((expense) => expense.employeeId === member.id);
            const status = limitStatus(member, db.expenses, db.settings);
            const pending = own.filter((expense) => expense.status === STATUS.PENDING).length;
            return (
              <tr key={member.id}>
                <th scope="row">
                  <Link to={`/manager/expenses?employee=${encodeURIComponent(member.id)}`}>{member.name}</Link>
                </th>
                <td data-label="Total claimed" className="amount">{formatMoney(sumAmounts(onlySpending(own)))}</td>
                <td data-label="This month" className="amount">
                  {formatMoney(status.used)}
                  <div className="muted xsmall">{status.limit ? `of ${formatMoney(status.limit)}` : 'no limit'}</div>
                </td>
                <td data-label="Limit">{status.level === 'warning' || status.level === 'exceeded' ? <LimitBadge level={status.level} /> : <span className="muted xsmall">—</span>}</td>
                <td data-label="Pending" className="amount">{pending}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ManagerDashboard() {
  const { user } = useAuth();
  const { db } = useCompany();
  const { notifications, unread } = useNotifications();

  const expenses = visibleExpenses(user, db);
  const team = teamMembers(user, db);
  const summary = summarizeExpenses(expenses);
  const month = currentMonthKey();
  const thisMonth = onlySpending(expenses).filter((expense) => monthKey(expense.date) === month);
  const queue = expenses.filter((expense) => can(user, 'expense.review', expense, db));
  const limitAlerts = team.filter((member) => ['warning', 'exceeded'].includes(limitStatus(member, db.expenses, db.settings).level)).length;
  const pending = [...queue].sort(SORTS.oldest).slice(0, 5); // oldest first: longest wait reviewed first
  const recent = expenses.filter((expense) => expense.employeeId !== user.id).sort(SORTS.updated).slice(0, 6);

  return (
    <>
      <PageHeader
        title={<>Welcome, {user.name.split(' ')[0]}</>}
        description={<>{user.department || 'Your team'} · {db.settings.companyName}</>}
        actions={(
          <div className="row">
            <Link className="btn btn-secondary" to="/manager/approvals">Review approvals</Link>
            <Link className="btn btn-primary" to="/expenses/new">New expense</Link>
          </div>
        )}
      />

      <section aria-label="Team summary">
        <div className="stats stats-4">
          <StatCard label="Team size" value={String(team.length)} sub="active employees" icon="users" accent />
          <StatCard label="Team spending" value={formatMoney(summary.claimed.amount)} sub={`${countText(summary.claimed.count)} · all time`} icon="receipt" />
          <StatCard label="This month" value={formatMoney(sumAmounts(thisMonth))} sub={`${countText(thisMonth.length)} · ${formatMonth(month)}`} icon="clock" />
          <StatCard label="Pending approvals" value={String(queue.length)} sub={formatMoney(sumAmounts(queue))} icon="inbox" />
        </div>
        <div className="stats stats-4">
          <StatCard label="Approved" value={formatMoney(summary.approved.amount)} sub={`${countText(summary.approved.count)} (incl. reimbursement stages)`} icon="check" />
          <StatCard label="Reimbursement pending" value={formatMoney(summary.reimbursementPending.amount)} sub={countText(summary.reimbursementPending.count)} icon="banknote" />
          <StatCard label="Reimbursed" value={formatMoney(summary.reimbursed.amount)} sub={countText(summary.reimbursed.count)} icon="check" />
          <StatCard label="Limit alerts" value={String(limitAlerts)} sub={`employee${limitAlerts === 1 ? '' : 's'} at ≥ ${db.settings.limitWarningPercent}%`} icon="alert" />
        </div>
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="pending-title">
          <div className="card-header"><h2 id="pending-title">Pending approvals</h2><Link to="/manager/approvals">Open queue</Link></div>
          {pending.length ? (
            <>
              <ul className="list">
                {pending.map((expense) => (
                  <ExpenseRow
                    key={expense.id} expense={expense} db={db} showEmployee
                    flag={<ReviewFlags expense={expense} db={db} />}
                    actions={<ReviewButtons manager={user} expense={expense} />}
                  />
                ))}
              </ul>
              {queue.length > pending.length ? (
                <p className="muted xsmall footnote">
                  + {queue.length - pending.length} more in the <Link to="/manager/approvals">approval queue</Link>
                </p>
              ) : null}
            </>
          ) : <EmptyState message="Nothing waiting for your approval." icon="inbox" />}
        </section>

        <section className="card" aria-labelledby="limits-title">
          <div className="card-header"><h2 id="limits-title">Spending-limit warnings</h2><span className="muted xsmall">{formatMonth(month)}</span></div>
          <LimitWarnings team={team} db={db} />
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="recent-title">
          <div className="card-header"><h2 id="recent-title">Recent team expenses</h2><Link to="/manager/expenses">View all</Link></div>
          <ExpenseList expenses={recent} db={db} showEmployee showUpdated emptyMessage="No team expenses yet." />
        </section>
        <section className="card" aria-labelledby="status-title">
          <div className="card-header"><h2 id="status-title">Status breakdown</h2><span className="muted xsmall">Submitted claims</span></div>
          <StatusChart rows={breakdownByStatus(expenses).filter((row) => row.status !== STATUS.DRAFT)} empty="No submitted expenses yet." />
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="monthly-title">
          <div className="card-header"><h2 id="monthly-title">Monthly team spending</h2><span className="muted xsmall">Last 6 months</span></div>
          <ColumnChart rows={spendingByMonth(expenses, lastMonthKeys(6))} caption="Team spending per month" />
        </section>
        <section className="card" aria-labelledby="category-title">
          <div className="card-header"><h2 id="category-title">Spending by category</h2></div>
          <BarList rows={spendingByCategory(expenses)} />
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="project-title">
          <div className="card-header"><h2 id="project-title">Spending by project</h2></div>
          <BarList rows={spendingByProject(expenses, db)} />
        </section>
        <section className="card" aria-labelledby="employee-title">
          <div className="card-header"><h2 id="employee-title">Employee summary</h2><Link to="/manager/team">Team</Link></div>
          <EmployeeSummary team={team} expenses={expenses} db={db} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="activity-title">
          <div className="card-header"><h2 id="activity-title">Recent activity</h2></div>
          <RecentEvents expenses={expenses} db={db} />
        </section>
        <section className="card" aria-labelledby="notifications-title">
          <div className="card-header">
            <h2 id="notifications-title">Notifications</h2>
            <div className="row">
              <span className={unread ? 'badge badge-approved' : 'badge badge-muted'}>{unread ? `${unread} unread` : 'All read'}</span>
              <Link to="/notifications">View all</Link>
            </div>
          </div>
          <NotificationPreview notifications={notifications} />
        </section>
      </div>
    </>
  );
}
