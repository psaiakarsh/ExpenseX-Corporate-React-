// charts.jsx — the V1 charts (charts.js) as components: plain HTML + CSS, no chart library.
// Every chart keeps its readable text form: bar rows show their values as text and the column chart
// carries a screen-reader table.
import { formatMoney, formatMoneyCompact } from '../domain/money.js';
import { currentMonthKey } from '../domain/dates.js';
import { EmptyState, Icon } from './ui.jsx';

export function countText(count, word = 'claim') {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// rows: [{ key, label, amount, count }] → horizontal bars, largest first.
// showShare: false hides the "% of the rows shown" figure (misleading when some rows are hidden).
export function BarList({ rows, empty = 'No spending recorded yet.', limit = 8, showCount = true, showShare = true }) {
  const withAmount = rows.filter((row) => row.amount > 0);
  const visible = withAmount.slice(0, limit);
  if (visible.length === 0) return <EmptyState message={empty} icon="chart" />;

  const max = Math.max(...visible.map((row) => row.amount));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const more = withAmount.length - visible.length;

  return (
    <>
      <ul className="bar-list">
        {visible.map((row) => {
          const width = Math.max(1, Math.round((row.amount * 100) / max));
          const share = total ? Math.round((row.amount * 100) / total) : 0;
          return (
            <li className="bar-item" key={row.key ?? row.label}>
              <div className="bar-item-top">
                <span className="truncate" title={row.label}>{row.label}</span>
                <span className="value">
                  {formatMoney(row.amount)}
                  {showShare ? ` · ${share}%` : ''}
                  {showCount ? ` · ${countText(row.count)}` : ''}
                </span>
              </div>
              <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${width}%` }} /></div>
            </li>
          );
        })}
      </ul>
      {more > 0 ? <p className="muted xsmall footnote">+ {more} more</p> : null}
    </>
  );
}

// rows: [{ key, label, amount }] in time order → vertical columns (current month highlighted).
export function ColumnChart({ rows, caption }) {
  if (rows.every((row) => row.amount === 0)) return <EmptyState message="No spending in this period." icon="chart" />;
  const max = Math.max(...rows.map((row) => row.amount));
  const current = currentMonthKey();

  return (
    <figure>
      <div className="columns" aria-hidden="true">
        {rows.map((row) => (
          <div className="column" key={row.key}>
            <span className="column-value">{row.amount ? formatMoneyCompact(row.amount) : ''}</span>
            <div
              className={`column-bar ${row.key === current ? 'is-current' : ''}`}
              style={{ height: `${row.amount === 0 ? 0 : Math.max(2, Math.round((row.amount * 100) / max))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="column-labels" aria-hidden="true">
        {rows.map((row) => <span key={row.key}>{row.label.split(' ')[0]}</span>)}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Amount</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{formatMoney(row.amount)}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}

// rows from breakdownByStatus() → one stacked bar (by count) + a legend with counts and amounts.
export function StatusChart({ rows, empty = 'No expenses yet.' }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return <EmptyState message={empty} icon="chart" />;
  return (
    <>
      <div className="stacked" aria-hidden="true">
        {rows.filter((row) => row.count > 0).map((row) => (
          <span key={row.status} className={`fill-${row.status}`} style={{ width: `${(row.count * 100) / total}%` }} title={row.label} />
        ))}
      </div>
      <ul className="legend">
        {rows.map((row) => (
          <li key={row.status}>
            <span className={`swatch fill-${row.status}`} aria-hidden="true" />
            <span>{row.label}</span>
            <span className="value">{row.count} · {formatMoney(row.amount)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// Two-part comparison, e.g. Reimbursement Pending vs Reimbursed.
export function SplitChart({ parts }) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total === 0) return <EmptyState message="Nothing approved yet." icon="chart" />;
  return (
    <>
      <div className="stacked" aria-hidden="true">
        {parts.filter((part) => part.amount > 0).map((part) => (
          <span key={part.status} className={`fill-${part.status}`} style={{ width: `${(part.amount * 100) / total}%` }} />
        ))}
      </div>
      <ul className="legend">
        {parts.map((part) => (
          <li key={part.status}>
            <span className={`swatch fill-${part.status}`} aria-hidden="true" />
            <span>{part.label}</span>
            <span className="value">{formatMoney(part.amount)} · {part.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function StatCard({ label, value, sub = '', icon = 'receipt', accent = false }) {
  return (
    <div className={`stat ${accent ? 'stat-accent' : ''}`}>
      <span className="stat-label"><Icon name={icon} size={16} />{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}
