// badges.jsx — status/role badges and the spending-limit meter (V1 ui.js badges + limits.js renderers).
// Colour is never the only signal: every badge carries an icon and a text label.
import { ROLE_LABELS, STATUS_LABELS } from '../domain/constants.js';
import { formatMoney } from '../domain/money.js';
import { Icon } from './ui.jsx';

const STATUS_ICONS = {
  draft: 'edit',
  pending: 'clock',
  approved: 'check',
  reimbursement_pending: 'banknote',
  reimbursed: 'check',
  rejected: 'x',
};

export function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      <Icon name={STATUS_ICONS[status]} size={14} />{STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function SelfApprovedBadge() {
  return (
    <span className="badge badge-self" title="Created and approved by the manager for their own expense">
      <Icon name="shield" size={14} />Self-approved
    </span>
  );
}

export function RoleBadge({ role }) {
  return <span className={`badge badge-role-${role}`}>{ROLE_LABELS[role]}</span>;
}

// level: 'none' | 'ok' | 'warning' | 'exceeded' (limits.js). Nothing is shown when there is no flag.
export function LimitBadge({ level }) {
  if (level === 'exceeded') return <span className="badge badge-danger"><Icon name="alert" size={14} />Over limit</span>;
  if (level === 'warning') return <span className="badge badge-warning"><Icon name="alert" size={14} />Near limit</span>;
  return null;
}

// The meter from V1 limitMeter(): "₹14,500.00 / ₹20,000.00" with a labelled progress bar.
export function LimitMeter({ status, label = 'This month' }) {
  if (status.limit === null) {
    return (
      <div className="meter">
        <div className="meter-values">
          <span>{label}</span>
          <span className="num">{formatMoney(status.used)} · no limit set</span>
        </div>
      </div>
    );
  }

  const width = Math.min(100, status.percent);
  const levelClass = status.level === 'exceeded' ? 'meter-exceeded' : status.level === 'warning' ? 'meter-warning' : '';
  const note = status.level === 'exceeded'
    ? <span className="text-danger small"><Icon name="alert" size={14} /> Exceeded by {formatMoney(-status.remaining)}</span>
    : status.level === 'warning'
      ? <span className="text-warning small"><Icon name="alert" size={14} /> {status.percent}% used</span>
      : <span className="muted small">{formatMoney(status.remaining)} remaining</span>;

  return (
    <div className={`meter ${levelClass}`}>
      <div className="meter-values">
        <span>{label}</span>
        <span className="num"><strong>{formatMoney(status.used)}</strong> / {formatMoney(status.limit)}</span>
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-label={`${label} spending against limit`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-valuetext={`${status.percent}% of monthly limit used`}
      >
        <div className="meter-fill" style={{ width: `${width}%` }} />
      </div>
      {note}
    </div>
  );
}
