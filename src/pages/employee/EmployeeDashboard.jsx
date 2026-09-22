// EmployeeDashboard — V1 employee/dashboard.html + pages/employee-dashboard.js.
// Own figures only: every number comes from visibleExpenses(user) (the employee's own claims) and the
// reader's own notifications. Nothing here reaches another employee's data.
import { Link } from 'react-router';
import { breakdownByStatus, spendingByCategory, spendingByMonth, summarizeExpenses } from '../../domain/analytics.js';
import { lastMonthKeys, formatMonth } from '../../domain/dates.js';
import { formatMoney } from '../../domain/money.js';
import { limitStatus } from '../../domain/limits.js';
import { findUser, visibleExpenses } from '../../domain/permissions.js';
import { SORTS } from '../../domain/expense-query.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { useNotifications } from '../../app/NotificationContext.jsx';
import { LimitBadge, LimitMeter } from '../../components/badges.jsx';
import { BarList, ColumnChart, StatCard, StatusChart, countText } from '../../components/charts.jsx';
import { ExpenseList } from '../../components/expense.jsx';
import { NotificationPreview } from '../../components/notifications.jsx';
import { Icon, PageHeader } from '../../components/ui.jsx';

function LimitCard({ user, manager, db }) {
  const status = limitStatus(user, db.expenses, db.settings);
  const spent = (
    <p className="muted small">
      Spent in {formatMonth(status.month)}: <strong className="num">{formatMoney(status.used)}</strong>
    </p>
  );

  if (!manager) {
    return (
      <div className="stack">
        <p><span className="badge badge-muted">No limit assigned</span></p>
        <p className="muted small">Monthly limits are set by your manager. You will get one after an Admin assigns you to a manager.</p>
        {spent}
      </div>
    );
  }
  if (status.limit === null) {
    return (
      <div className="stack">
        <p><span className="badge badge-muted">No limit assigned</span></p>
        <p className="muted small">{manager.name} has not set a monthly limit for you.</p>
        {spent}
      </div>
    );
  }

  const levelText = {
    ok: `${status.percent}% used`,
    warning: `${status.percent}% used — approaching your limit (warning at ${db.settings.limitWarningPercent}%)`,
    exceeded: `${status.percent}% used — limit exceeded`,
  }[status.level];

  return (
    <div className="stack">
      <p className="row">
        {status.level === 'ok' || status.level === 'none'
          ? <span className="badge badge-approved"><Icon name="check" size={14} />Within limit</span>
          : <LimitBadge level={status.level} />}
        <span className="small">{levelText}</span>
      </p>
      <LimitMeter status={status} label={formatMonth(status.month)} />
      <p className="muted xsmall">
        Counts this month&apos;s pending, approved, reimbursement-pending and reimbursed claims.
        Limits only warn — you can still submit expenses over the limit.
      </p>
    </div>
  );
}

export function EmployeeDashboard() {
  const { user } = useAuth();
  const { db } = useCompany();
  const { notifications, unread } = useNotifications();

  const expenses = visibleExpenses(user, db); // own expenses only
  const manager = findUser(db, user.managerId);
  const summary = summarizeExpenses(expenses);
  const recent = [...expenses].sort(SORTS.updated).slice(0, 5);

  return (
    <>
      <PageHeader title={<>Welcome, {user.name.split(' ')[0]}</>} description={<>{manager
              ? `${db.settings.companyName} · Manager: ${manager.name}${manager.department ? ` (${manager.department})` : ''}`
              : db.settings.companyName}</>} actions={<Link className="btn btn-primary" to="/expenses/new">New expense</Link>} />

      {manager ? null : (
        <div className="callout callout-warning" role="status" style={{ marginBottom: 24 }}>
          <Icon name="alert" />
          <div>
            <strong>No manager assigned yet</strong>
            {' '}You can create drafts, but you cannot submit an expense until an Admin assigns you to a Manager.
          </div>
        </div>
      )}

      <section aria-label="Expense summary">
        <div className="stats">
          <StatCard label="Total expenses" value={formatMoney(summary.claimed.amount)} sub={`${countText(summary.claimed.count)} submitted`} icon="receipt" accent />
          <StatCard label="Pending" value={formatMoney(summary.pending.amount)} sub={countText(summary.pending.count)} icon="clock" />
          <StatCard label="Approved" value={formatMoney(summary.approved.amount)} sub={`${countText(summary.approved.count)} (incl. reimbursed)`} icon="check" />
          <StatCard label="Reimbursement pending" value={formatMoney(summary.reimbursementPending.amount)} sub={countText(summary.reimbursementPending.count)} icon="banknote" />
          <StatCard label="Reimbursed" value={formatMoney(summary.reimbursed.amount)} sub={countText(summary.reimbursed.count)} icon="check" />
        </div>
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="limit-title">
          <div className="card-header"><h2 id="limit-title">Monthly spending limit</h2></div>
          <LimitCard user={user} manager={manager} db={db} />
        </section>
        <section className="card" aria-labelledby="status-title">
          <div className="card-header">
            <h2 id="status-title">Status breakdown</h2>
            <Link to="/employee/expenses">View expenses</Link>
          </div>
          <StatusChart rows={breakdownByStatus(expenses)} empty="You have no expenses yet." />
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="monthly-title">
          <div className="card-header">
            <h2 id="monthly-title">Monthly spending</h2>
            <span className="muted xsmall">Last 6 months</span>
          </div>
          <ColumnChart rows={spendingByMonth(expenses, lastMonthKeys(6))} caption="Your spending per month" />
        </section>
        <section className="card" aria-labelledby="category-title">
          <div className="card-header"><h2 id="category-title">Spending by category</h2></div>
          <BarList rows={spendingByCategory(expenses)} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="recent-title">
          <div className="card-header">
            <h2 id="recent-title">Recent expenses</h2>
            <Link to="/employee/expenses">View all</Link>
          </div>
          <ExpenseList expenses={recent} db={db} emptyMessage="No expenses yet. Create your first one." />
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
