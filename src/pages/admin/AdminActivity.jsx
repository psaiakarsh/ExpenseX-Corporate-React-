// AdminActivity — V1 admin/activity.html + pages/admin-activity.js.
// The administrative audit trail (activity.js). Entries never contain expense titles, amounts, comments,
// receipts or credentials — approval and reimbursement decisions are recorded by expense ID only.
import { useState } from 'react';
import { ACTIVITY_LABELS } from '../../domain/activity.js';
import { formatDateTime, toLocalDate } from '../../domain/dates.js';
import { findUser } from '../../domain/permissions.js';
import { useCompany } from '../../app/CompanyContext.jsx';
import { SearchFilter, SelectFilter, Toolbar, useFilters } from '../../components/filters.jsx';
import { EmptyState, PageHeader } from '../../components/ui.jsx';

const PAGE_SIZE = 25;
const TARGET_LABELS = { user: 'User', expense: 'Expense', settings: 'Settings' };

function matches(entry, filters) {
  if (filters.actorId && entry.actorId !== filters.actorId) return false;
  if (filters.action && entry.action !== filters.action) return false;
  const day = toLocalDate(new Date(entry.createdAt));
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  const search = String(filters.search ?? '').trim().toLowerCase();
  return !search || entry.summary.toLowerCase().includes(search);
}

export function AdminActivity() {
  const { db } = useCompany();
  const [filters, setFilter] = useFilters({ search: '', actorId: '', action: '', from: '', to: '' });
  const [limit, setLimit] = useState(PAGE_SIZE);

  const matching = db.activity.filter((entry) => matches(entry, filters)); // newest first (stored order)
  const shown = matching.slice(0, limit);

  const actors = [...new Set(db.activity.map((entry) => entry.actorId))]
    .map((id) => ({ value: id, label: findUser(db, id)?.name ?? 'Unknown' }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const change = (name) => (value) => {
    setFilter(name, value);
    setLimit(PAGE_SIZE);
  };

  return (
    <>
      <PageHeader title="Activity log" description="Operational audit trail: accounts, teams, settings, demo data, and approval/reimbursement decisions by
            expense ID. Expense titles, amounts, comments and receipts are never logged here." />

      <Toolbar label="Filter activity">
        <SearchFilter value={filters.search} onChange={change('search')} placeholder="Search summaries" />
        <SelectFilter id="actorId" label="Actor" value={filters.actorId} options={[{ value: '', label: 'Anyone' }, ...actors]} onChange={change('actorId')} />
        <SelectFilter
          id="action" label="Action" value={filters.action}
          options={[{ value: '', label: 'All actions' }, ...Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }))]}
          onChange={change('action')}
        />
        <div className="field">
          <label htmlFor="from">From</label>
          <input className="control" id="from" name="from" type="date" value={filters.from} onChange={(event) => change('from')(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input className="control" id="to" name="to" type="date" value={filters.to} onChange={(event) => change('to')(event.target.value)} />
        </div>
      </Toolbar>

      <p className="result-count" aria-live="polite">
        Showing {shown.length} of {matching.length} matching · {db.activity.length} entries kept (newest 500)
      </p>

      {shown.length === 0 ? (
        <EmptyState icon="activity" message={db.activity.length ? 'No activity matches these filters.' : 'No activity recorded yet.'} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <caption className="sr-only">Activity log entries, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  </th>
                  <td data-label="Actor">{findUser(db, entry.actorId)?.name ?? 'Unknown'}</td>
                  <td data-label="Action"><span className="badge badge-muted">{ACTIVITY_LABELS[entry.action] ?? entry.action}</span></td>
                  <td data-label="Target">{TARGET_LABELS[entry.targetType] ?? '—'}</td>
                  <td data-label="Details">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="centered-actions">
        <button className="btn btn-ghost" type="button" hidden={matching.length <= limit} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
          Show more
        </button>
      </div>
    </>
  );
}
