// AppLayout — the app shell for a signed-in role (V1 layout.js buildShell): sidebar on desktop, topbar,
// bottom navigation + "More" sheet on phones, live badges, and logout.
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { ROLES, ROLE_LABELS } from '../domain/constants.js';
import { can } from '../domain/permissions.js';
import { useAuth } from '../app/AuthContext.jsx';
import { useCompany } from '../app/CompanyContext.jsx';
import { useNotifications } from '../app/NotificationContext.jsx';
import { useToast } from '../app/ToastContext.jsx';
import { MOBILE_PRIMARY, NAV_ITEMS } from '../app/navigation.js';
import { findRoute, homeFor } from '../app/routes.jsx';
import { useModalDialog } from './dialogs.jsx';
import { Avatar, BrandMark, Icon } from './ui.jsx';

function Badge({ navKey, count, dot = false }) {
  const word = navKey === 'approvals' ? 'waiting' : 'unread';
  return (
    <span className={dot ? 'dot num' : 'nav-badge num'} hidden={count === 0}>
      {count > 0 ? (
        <>
          {dot ? null : <span aria-hidden="true">{count > 99 ? '99+' : count}</span>}
          <span className="sr-only">, {count} {word}</span>
        </>
      ) : null}
    </span>
  );
}

function NavItem({ item, activeKey, className, badge, onNavigate }) {
  return (
    <Link
      className={className}
      to={item.path}
      data-nav={item.key}
      aria-current={item.key === activeKey ? 'page' : undefined}
      onClick={onNavigate}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      <Badge navKey={item.key} count={badge ?? 0} dot={className === 'bottom-link'} />
    </Link>
  );
}

function Brand({ to }) {
  return (
    <Link className="brand" to={to} aria-label="ExpenseX Corporate — home">
      <BrandMark textHidden />
    </Link>
  );
}

// The phone "More" sheet: the navigation items that don't fit in the bottom bar, plus logout.
function MoreSheet({ user, activeKey, badges, onClose, onLogout }) {
  const { dialogProps } = useModalDialog(onClose);
  const extra = NAV_ITEMS[user.role].filter((item) => !MOBILE_PRIMARY[user.role].includes(item.key));
  return (
    <dialog className="dialog more-sheet" aria-label="More navigation" {...dialogProps}>
      <div className="dialog-form">
        <header className="dialog-header">
          <h2>{user.name} <span className="muted small">· {ROLE_LABELS[user.role]}</span></h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <nav aria-label="More">
          <ul className="list">
            {extra.map((item) => (
              <li key={item.key}>
                <NavItem item={item} activeKey={activeKey} className="nav-link" badge={badges[item.key]} onNavigate={onClose} />
              </li>
            ))}
          </ul>
        </nav>
        <button className="btn btn-ghost btn-block" type="button" onClick={onLogout}>
          <Icon name="logout" size={18} /> Log out
        </button>
      </div>
    </dialog>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { db } = useCompany();
  const { unread } = useNotifications();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef(null);
  const firstRender = useRef(true);
  const moreButton = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const route = findRoute(location.pathname);
  const title = route?.title ?? '';
  const activeKey = route?.nav ?? '';
  const home = homeFor(user.role);

  useEffect(() => {
    document.title = `${title} · ExpenseX Corporate`;
  }, [title]);

  // A new page: back to the top, and move focus to the content (a full page load did this in V1).
  useEffect(() => {
    window.scrollTo(0, 0);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const badges = {
    notifications: unread,
    approvals: user.role === ROLES.MANAGER ? db.expenses.filter((expense) => can(user, 'expense.review', expense, db)).length : 0,
  };

  const doLogout = () => {
    setMoreOpen(false);
    logout();
    toast('You have been logged out.', 'info');
    navigate('/login', { replace: true });
  };

  const items = NAV_ITEMS[user.role];
  const primary = items.filter((item) => MOBILE_PRIMARY[user.role].includes(item.key));

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault(); // with HashRouter a bare #main would be treated as a route
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      <div className="app-shell">
        <aside className="sidebar">
          <Brand to={home} />
          <nav aria-label="Main">
            {items.map((item) => (
              <NavItem key={item.key} item={item} activeKey={activeKey} className="nav-link" badge={badges[item.key]} />
            ))}
          </nav>
          <div className="sidebar-user">
            <Avatar name={user.name} size="sm" />
            <div className="grow">
              <div className="sidebar-user-name truncate">{user.name}</div>
              <div className="muted xsmall">{ROLE_LABELS[user.role]}</div>
            </div>
            <button className="icon-btn" type="button" aria-label="Log out" title="Log out" onClick={doLogout}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <span className="topbar-brand"><Brand to={home} /></span>
            <h1 className="topbar-title truncate">{title}</h1>
            {user.role !== ROLES.ADMIN && activeKey !== 'new' ? (
              <Link className="btn btn-primary btn-sm topbar-add" to="/expenses/new"><Icon name="plus" size={16} /> New expense</Link>
            ) : null}
            <Link className="icon-btn" to="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Icon name="bell" />
              <span className="bell-dot" hidden={unread === 0} />
            </Link>
          </header>

          <main id="main" className="page page-enter" tabIndex={-1} ref={mainRef} key={location.pathname}>
            <Outlet />
          </main>
        </div>

        <nav className="bottom-nav" aria-label="Main (mobile)">
          {primary.map((item) => (
            <NavItem key={item.key} item={item} activeKey={activeKey} className="bottom-link" badge={badges[item.key]} />
          ))}
          <button
            className="bottom-link"
            type="button"
            ref={moreButton}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <Icon name="more" />
            <span>More</span>
          </button>
        </nav>
      </div>

      {moreOpen ? (
        <MoreSheet user={user} activeKey={activeKey} badges={badges} onClose={() => setMoreOpen(false)} onLogout={doLogout} />
      ) : null}
    </>
  );
}
