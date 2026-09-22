// ManagerReimbursements — V1 manager/reimbursements.html + pages/manager-reimbursements.js.
// Records follow the expense's visibility (visibleReimbursements). "Mark reimbursed" is offered only
// where can('reimbursement.markPaid') allows it — the employee's CURRENT manager, or the manager for
// their own self-approved claim — and markReimbursed() checks the same rule again.
import { useState } from 'react';
import { Link } from 'react-router';
import { STATUS } from '../../domain/constants.js';
import { currentMonthKey, formatDate, monthKey, toLocalDate } from '../../domain/dates.js';
import { formatMoney, sumAmounts } from '../../domain/money.js';
import { findExpense } from '../../domain/expenses.js';
import { can, findUser, visibleReimbursements } from '../../domain/permissions.js';
import { projectName } from '../../domain/projects.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useCompany } from '../../app/CompanyContext.jsx';
import { expensePath } from '../../app/routes.jsx';
import { SelfApprovedBadge, StatusBadge } from '../../components/badges.jsx';
import { StatCard, countText } from '../../components/charts.jsx';
import { SearchFilter, SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { ReimburseButton } from '../../components/reviewDialogs.jsx';
import { EmptyState, PageHeader } from '../../components/ui.jsx';

const dateOf = (isoTimestamp) => (isoTimestamp ? formatDate(toLocalDate(new Date(isoTimestamp))) : '—');

export function ManagerReimbursements() {
  const { user } = useAuth();
  const { db } = useCompany();
  const [tab, setTab] = useState('pending');
  const [filters, setFilter] = useFilters({ search: '', employeeId: '' });

  const records = visibleReimbursements(user, db);
  const pending = records.filter((record) => record.status === 'pending');
  const paid = records.filter((record) => record.status === 'reimbursed');
  const payable = pending.filter((record) => can(user, 'reimbursement.markPaid', record, db));
  const paidThisMonth = paid.filter((record) => monthKey(toLocalDate(new Date(record.reimbursedAt))) === currentMonthKey());
  const nameOf = (userId) => findUser(db, userId)?.name ?? '—';

  const search = filters.search.trim().toLowerCase();
  const list = (tab === 'pending' ? pending : paid)
    .filter((record) => !filters.employeeId || record.employeeId === filters.employeeId)
    .filter((record) => {
      if (!search) return true;
      const expense = findExpense(db, record.expenseId);
      return [expense?.title, nameOf(record.employeeId), projectName(db, expense?.projectId), record.reference].join(' ').toLowerCase().includes(search);
    })
    .sort((a, b) => (tab === 'pending' ? a.createdAt.localeCompare(b.createdAt) : b.reimbursedAt.localeCompare(a.reimbursedAt)));

  const people = [...new Set(records.map((record) => record.employeeId))].map((id) => findUser(db, id)).filter(Boolean);

  return (
    <>
      <PageHeader title="Reimbursements" description="Approving an expense creates a separate reimbursement record. Marking it reimbursed records who paid and
            when; the original expense is never changed." />

      <section aria-label="Reimbursement totals">
        <div className="stats stats-4">
          <StatCard label="Awaiting payout" value={formatMoney(sumAmounts(payable))} sub={countText(payable.length, 'record')} icon="banknote" accent />
          <StatCard
            label="Your own (self-approved)"
            value={formatMoney(sumAmounts(payable.filter((record) => record.employeeId === user.id)))}
            sub="awaiting payout" icon="shield"
          />
          <StatCard label="Reimbursed this month" value={formatMoney(sumAmounts(paidThisMonth))} sub={countText(paidThisMonth.length, 'record')} icon="clock" />
          <StatCard label="Reimbursed (all time)" value={formatMoney(sumAmounts(paid))} sub={countText(paid.length, 'record')} icon="check" />
        </div>
      </section>

      <div className="tabs" role="group" aria-label="Show">
        <button className="tab" type="button" aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}>Reimbursement pending</button>
        <button className="tab" type="button" aria-pressed={tab === 'reimbursed'} onClick={() => setTab('reimbursed')}>Reimbursed</button>
      </div>

      <Toolbar label="Filter reimbursements">
        <SearchFilter value={filters.search} onChange={(value) => setFilter('search', value)} placeholder="Expense, employee, project, reference…" />
        <SelectFilter
          id="employeeId" label="Employee" value={filters.employeeId}
          options={[{ value: '', label: 'Everyone' }, ...people.map((person) => ({ value: person.id, label: person.name }))]}
          onChange={(value) => setFilter('employeeId', value)}
        />
      </Toolbar>

      <p className="result-count" aria-live="polite">
        {list.length} record{list.length === 1 ? '' : 's'} · {formatMoney(sumAmounts(list))}{tab === 'pending' ? ' · oldest approval first' : ''}
      </p>

      {list.length === 0 ? (
        <EmptyState icon="banknote" message={tab === 'pending' ? 'Nothing is waiting for reimbursement.' : 'Nothing reimbursed yet.'} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <caption className="sr-only">{tab === 'pending' ? 'Reimbursements awaiting payout' : 'Reimbursed expenses'}</caption>
            <thead>
              <tr>
                <th scope="col">Expense</th>
                <th scope="col">Employee</th>
                <th scope="col">Project</th>
                <th scope="col" className="amount">Amount</th>
                <th scope="col">Approved</th>
                <th scope="col">Status</th>
                {tab === 'pending' ? (
                  <th scope="col"><span className="sr-only">Action</span></th>
                ) : (
                  <>
                    <th scope="col">Reimbursed</th>
                    <th scope="col">Reimbursed by</th>
                    <th scope="col">Reference</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((record) => {
                const expense = findExpense(db, record.expenseId);
                const isPending = record.status === 'pending';
                return (
                  <tr key={record.id}>
                    <th scope="row">
                      <Link to={expensePath(record.expenseId)}>{expense?.title ?? 'Expense'}</Link>
                      {expense?.selfApproved ? <div><SelfApprovedBadge /></div> : null}
                    </th>
                    <td data-label="Employee">{nameOf(record.employeeId)}</td>
                    <td data-label="Project">{projectName(db, expense?.projectId)}</td>
                    <td data-label="Amount" className="amount">{formatMoney(record.amount)}</td>
                    <td data-label="Approved">
                      {dateOf(record.createdAt)}
                      <div className="muted xsmall">by {nameOf(record.managerId)}</div>
                    </td>
                    <td data-label="Status"><StatusBadge status={isPending ? STATUS.REIMBURSEMENT_PENDING : STATUS.REIMBURSED} /></td>
                    {isPending ? (
                      <td className="actions-cell">
                        {can(user, 'reimbursement.markPaid', record, db) && expense
                          ? <ReimburseButton manager={user} expense={expense} />
                          : <span className="muted xsmall">Not yours to pay</span>}
                      </td>
                    ) : (
                      <>
                        <td data-label="Reimbursed">{dateOf(record.reimbursedAt)}</td>
                        <td data-label="Reimbursed by">{nameOf(record.reimbursedById)}</td>
                        <td data-label="Reference">{record.reference || '—'}</td>
                      </>
                    )}
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
