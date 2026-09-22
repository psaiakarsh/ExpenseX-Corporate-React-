// AdminDashboard — V1 admin/dashboard.html + pages/admin-dashboard.js.
//
// Company statistics from companyAggregates(), which returns NUMBERS only (counts and totals). This page
// never receives expense records, so no individual claim, employee spending or reimbursement can be shown
// here. Team totals are privacy-safe: a team appears only with at least MIN_TEAM_SIZE_FOR_BREAKDOWN
// employees, and never when a hidden team could be worked out by subtraction (analytics.js).
import { Link } from 'react-router';
import { MIN_TEAM_SIZE_FOR_BREAKDOWN } from '../../domain/constants.js';
import { companyAggregates } from '../../domain/analytics.js';
import { formatMoney } from '../../domain/money.js';
import { formatRelative } from '../../domain/dates.js';
import { ACTIVITY_LABELS } from '../../domain/activity.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { BarList, ColumnChart, StatCard, StatusChart, countText } from '../../components/charts.jsx';
import { EmptyState, Icon, PageHeader } from '../../components/ui.jsx';

const PROTECTED_REASONS = {
  small: `fewer than ${MIN_TEAM_SIZE_FOR_BREAKDOWN} employees`,
  complement: 'hidden so a smaller team’s total can’t be worked out by subtraction',
};

const PRIVACY_RULES = [
  'Company-wide counts and totals, by month, category and status.',
  `Team totals only for teams with at least ${MIN_TEAM_SIZE_FOR_BREAKDOWN} employees, and never when a hidden team could be worked out by subtraction.`,
  'No individual expense, receipt, reimbursement or employee spending — those stay with the employee and their manager.',
  'Admins manage people, teams and settings; they cannot approve or reimburse expenses.',
];

function Teams({ teams, protectedTeams }) {
  return (
    <>
      {teams.length ? (
        <BarList rows={teams.map((team) => ({ ...team, label: `${team.label} (${team.employees} employees)` }))} showShare={false} />
      ) : (
        <EmptyState message="No team is large enough to show separately yet." icon="shield" />
      )}
      {protectedTeams.length ? (
        <>
          <ul className="stack" style={{ marginTop: 16 }}>
            {protectedTeams.map((team) => (
              <li className="row" key={team.key}>
                <span className="badge badge-muted"><Icon name="shield" size={14} />Privacy-protected</span>
                <span className="small">{team.label}</span>
                <span className="muted xsmall">{PROTECTED_REASONS[team.reason]}</span>
              </li>
            ))}
          </ul>
          <p className="muted xsmall footnote">Protected teams are still included in the company totals above.</p>
        </>
      ) : null}
    </>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const { db } = useCompany();

  const stats = companyAggregates(user, db); // numbers only — never records
  const summary = stats.summary;
  const activity = db.activity.slice(0, 6);

  return (
    <>
      <PageHeader title={<>{db.settings.companyName}</>} description="Company-level aggregates only. Individual expenses stay private to each employee and their manager." actions={<Link className="btn btn-primary" to="/admin/users">Manage users</Link>} />

      {stats.users.unassigned ? (
        <div className="section">
          <div className="callout callout-warning">
            <Icon name="users" />
            <div>
              <strong>{stats.users.unassigned} employee{stats.users.unassigned === 1 ? '' : 's'} waiting for a manager</strong>
              {' '}They can only save drafts until assigned. <Link to="/admin/users?manager=unassigned">Assign now</Link>
            </div>
          </div>
        </div>
      ) : null}

      <section aria-label="People">
        <div className="stats stats-4">
          <StatCard label="Employees" value={String(stats.users.employees)} sub={`${stats.users.unassigned} unassigned`} icon="users" accent />
          <StatCard label="Managers" value={String(stats.users.managers)} sub={`${stats.projects} active projects`} icon="shield" />
          <StatCard label="Active users" value={String(stats.users.active)} sub="all roles" icon="user" />
          <StatCard label="Inactive accounts" value={String(stats.users.inactive)} sub="records kept" icon="x" />
        </div>
      </section>

      <section aria-label="Company spending">
        <div className="stats">
          <StatCard label="Total expenses" value={String(stats.submittedCount)} sub="submitted claims" icon="receipt" accent />
          <StatCard label="Company spending" value={formatMoney(summary.claimed.amount)} sub="pending + approved + reimbursed" icon="chart" />
          <StatCard label="Pending" value={formatMoney(summary.pending.amount)} sub={countText(summary.pending.count)} icon="clock" />
          <StatCard label="Reimbursement pending" value={formatMoney(summary.reimbursementPending.amount)} sub={countText(summary.reimbursementPending.count)} icon="banknote" />
          <StatCard label="Reimbursed" value={formatMoney(summary.reimbursed.amount)} sub={countText(summary.reimbursed.count)} icon="check" />
        </div>
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="monthly-title">
          <div className="card-header"><h2 id="monthly-title">Monthly company spending</h2><span className="muted xsmall">Last 6 months</span></div>
          <ColumnChart rows={stats.byMonth} caption="Company spending per month" />
        </section>
        <section className="card" aria-labelledby="status-title">
          <div className="card-header"><h2 id="status-title">Status distribution</h2><span className="muted xsmall">Submitted claims</span></div>
          <StatusChart rows={stats.byStatus} empty="No submitted expenses yet." />
          <p className="small footnote">
            Approval rate: <strong>{stats.approvalRate === null ? '—' : `${stats.approvalRate}%`}</strong>
            {' '}· {summary.approved.count} approved (now reimbursement pending or reimbursed) · {summary.rejected.count} rejected
          </p>
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="category-title">
          <div className="card-header"><h2 id="category-title">Category distribution</h2></div>
          <BarList rows={stats.byCategory} limit={10} />
        </section>
        <section className="card" aria-labelledby="teams-title">
          <div className="card-header"><h2 id="teams-title">Team totals</h2><span className="muted xsmall">Privacy-safe</span></div>
          <Teams teams={stats.teams} protectedTeams={stats.protectedTeams} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="activity-title">
          <div className="card-header"><h2 id="activity-title">Recent activity</h2><Link to="/admin/activity">View all</Link></div>
          {activity.length === 0 ? <EmptyState message="No activity recorded yet." icon="activity" /> : (
            <ul className="list">
              {activity.map((entry) => (
                <li className="list-row compact" key={entry.id}>
                  <span className="row-icon" aria-hidden="true"><Icon name="activity" size={16} /></span>
                  <div className="list-row-main">
                    <span className="small"><strong>{ACTIVITY_LABELS[entry.action] ?? entry.action}</strong></span>
                    <span className="muted xsmall">{entry.summary} · {formatRelative(entry.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="privacy-title">
          <div className="card-header"><h2 id="privacy-title">What the Admin can see</h2></div>
          <ul className="stack small">
            {PRIVACY_RULES.map((rule) => (
              <li className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }} key={rule}>
                <Icon name="shield" size={16} /><span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
