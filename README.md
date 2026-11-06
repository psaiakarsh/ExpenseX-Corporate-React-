# ExpenseX Corporate — React (Version 2)

A corporate expense-management **browser prototype**: employees file expense claims, managers approve, reject
and reimburse them, and an administrator runs the company without ever seeing an individual claim.

This is Version 2 — the completed Version 1 (HTML/CSS/vanilla JS) migrated to React + Vite with its behaviour
preserved exactly. Version 1 is not part of this repository (see [Version 1](#version-1)).

---

## ⚠️ This is a front-end prototype, not a secure system

Everything — accounts, roles, permissions, expenses, receipts — lives in **this browser's `localStorage`**.

- There is **no backend, no API, no database and no server-side authentication or authorization.**
- Anyone who opens DevTools can read or edit the stored data directly.
- Passwords are salted and SHA-256 hashed so they are never stored in plain text, but there is no key
  stretching and no server to verify against. Treat every password here as public.
- The role checks, privacy rules and route guards described below are **product behaviour**, not a security
  boundary. They are enforced consistently in the application's own domain layer, which is what makes the
  prototype behave correctly — but a determined user of the same browser can bypass all of it.

Do not put real personal or financial data into this app. Node.js and npm are used **only** as development and
build tooling; the Vite dev/preview server is tooling too, not part of the product.

---

## Run it

Requires **Node.js 24** (the version pinned in `package.json` and used for deployment), with npm 11.
React Router 8 needs Node 22.22 or newer and Vite 8 needs ^20.19 || >=22.12, so slightly older Node versions
may work for local development, but only 24 is tested.

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (default <http://localhost:5173>).

Other commands:

```bash
npm run build
```

```bash
npm run preview
```

```bash
npm test
```

`npm run build` writes a static `dist/`. Because the app uses `HashRouter` and `base: './'`, that folder can be
served from any static host or opened from a subdirectory — no server rewrites are needed.

### First run

The app starts empty. On the login page choose either:

- **Load Demo Company** — creates the fictional company *Verdant Systems Pvt Ltd* with 1 admin, 3 managers,
  10 employees, projects and expenses in every status; or
- **Set up your own company** — creates the first Admin account, after which the Admin provisions everyone else.

Public signup (when the Admin leaves it enabled) always creates an **Employee** with no manager. Roles are never
chosen by the person signing up.

---

## Demo credentials

Every demo account uses the password **`Demo@123`**.

| Role | Name | Email | Notes |
|---|---|---|---|
| Admin | Sai Akarsh | `sai.akarsh@verdant.example` | Company administration |
| Manager | Abhay | `abhay@verdant.example` | Engineering · 4 employees |
| Manager | Sadiq | `sadiq@verdant.example` | Sales · 3 employees |
| Manager | Charan Sai | `charan.sai@verdant.example` | Operations · 1 active + 1 inactive |
| Employee | Ravi Kumar | `ravi@verdant.example` | ₹14,500 of a ₹20,000 monthly limit used |
| Employee | Meera Joshi | `meera@verdant.example` | Over her monthly limit |
| Employee | Aditya Bose | `aditya@verdant.example` | New signup, no manager yet |

The demo company is fictional and every address uses the reserved `.example` domain, so none of it is
deliverable. The Admin can rebuild it at any time from **Settings → Load Demo Company** (type `REPLACE`) or
**Reset Demo Data** (type `RESET`). Both rebuild only this app's own `exc:` keys; any unrelated `localStorage`
key in the same browser is left untouched.

---

## The three roles

| Role | Sees | Can do |
|---|---|---|
| **Employee** | Only their own claims | File, save as draft, submit, edit and resubmit a rejected claim, delete an unsent draft |
| **Manager** | Their own claims plus the **submitted** claims of employees **currently** in their team | Approve, reject (with a mandatory reason), mark reimbursed, create claims for themselves or a team member, run projects, set monthly limits, view team analytics |
| **Admin** | **Company aggregates only** | Provision managers and employees, assign and reassign employees, deactivate and reactivate accounts, change settings, load/reset the demo, read the activity log |

A manager never sees another team's data, and never an unsent draft — not even their own team's.

### Privacy rules

- **The Admin can never open an individual expense.** Not in the UI, not by URL, and not through the domain
  layer: `visibleExpenses` and `visibleReimbursements` return nothing for an Admin, `canViewExpense` is false,
  and every expense route redirects them to their dashboard.
- The Admin dashboard shows **numbers only** — company totals, per-month and per-category spending, status
  distribution and approval rate. No claim title, amount, description, comment or receipt ever reaches it.
- The **activity log** records decisions by expense ID only. The manager's comment stays in the expense's own
  history, visible to the employee and their manager.
- **Team totals are suppressed for small teams.** A team's figure appears only if it has at least 3 employees,
  and if the unshown remainder could still be narrowed down to fewer than 3 employees, the smallest shown team
  is hidden too — so no individual's spending can be derived by subtraction.

---

## Expense workflow

```
draft ──submit──> pending ──approve──> approved ──> reimbursement_pending ──pay──> reimbursed
                     │
                     └──reject──> rejected ──edit & resubmit──> pending
```

- These are the only transitions that exist. Anything else — `draft → reimbursed`, `reimbursed → rejected`,
  `approved → rejected` and so on — is rejected by the domain layer.
- A **rejection needs a comment of 5–300 characters.** The employee sees the reason, edits the same claim and
  resubmits it: the **expense keeps its identity and its history**, the stale rejection is cleared from the
  live review state but stays recorded in the history, and the manager is notified of the resubmission.
- History is **append-only**. It is never rewritten, reordered or deleted.
- Only an **unsent draft** can be deleted. A rejected claim already carries a manager's decision, so it is kept.
- Amounts are stored as **integer paise**; dates are local `YYYY-MM-DD` strings.
- A claim needs a project when the employee's team has active projects.

### Manager-created claims

A manager can file a claim for themselves or for an active member of their team. It is **approved on creation**
and goes straight to *Reimbursement Pending*. A manager's own claim carries a **Self-approved** badge; a claim
created for an employee notifies that employee.

### Reimbursement

Approving a claim creates a separate reimbursement record. Two different people are recorded and never
conflated:

- **`managerId` — the approver.** History: never changed, not even by a later reassignment.
- **`reimbursedById` — whoever actually paid it out**, with the timestamp and an optional payment reference.

Who *may* pay is the employee's **current** manager (or, for a manager's own self-approved claim, that manager).
So after a reassignment the new manager can open and pay a pending reimbursement and the old one cannot — while
the record still shows who originally approved it.

### Spending limits

A manager sets an optional monthly limit per employee. Usage counts that month's pending, approved,
reimbursement-pending and reimbursed claims; drafts and rejected claims do not count. Limits **warn only** — at
80% (configurable in Settings) and again at 100% — and **never block a submission**. Reassigning an employee
clears the limit, because limits belong to the manager who set them.

### Reassignment

When the Admin moves an employee to another manager:

- **Pending** claims move to the new manager for review, each gaining a `reassigned` history entry.
- **Decided** claims keep their original manager and approver. Approval history is never rewritten.
- The new manager gains access to the employee's submitted claims and pending reimbursements; the old manager
  loses it.
- The employee, the new manager and the previous manager are all notified, and the change is logged.

### Deactivation

Accounts are **never deleted**, so their history stays intact.

- A deactivated user cannot log in, and an open session elsewhere stops working — every permission check
  re-reads the stored account, so a page still holding the old user object can do nothing.
- Their expenses, approvals, reimbursements, notifications and history are all kept, and their manager can
  still see their submitted claims.
- A manager with any assigned employee cannot be deactivated; reassign the team first.
- The Admin cannot deactivate themselves.
- Reactivation restores access exactly. If their old manager has since been deactivated, the employee comes
  back unassigned and the Admin assigns them a new one.

### Receipts

- **Images only** — JPG, PNG, WEBP or GIF — up to **5 MB** as selected.
- The image is resized so its longest side is at most **1280 px** and re-encoded as JPEG at quality 0.72.
  Smaller images are never upscaled.
- While an image is being processed the form says so and saving is disabled, so a claim can't be saved without
  the receipt it is waiting for.
- Receipts are stored apart from the claims (in `exc:receipts`) so lists stay light, and are reachable only by
  people who may see the claim.
- Deleting a draft deletes its image too.

### Notifications

Created inside the action that caused them, so they always match what really happened. Each is addressed to one
recipient and read state is per-person. A notification links to its expense **only if the reader may still see
it** — a notification kept from before a reassignment shows its text but offers no way in.

---

## Architecture

React renders; **all rules live in the domain layer**; only one file touches storage.

```
React components  →  contexts / hooks  →  domain + permissions  →  storage.js  →  localStorage
```

- **Components never call `localStorage`.** `src/domain/storage.js` is the only file that does.
- **Permissions live in the domain layer.** Every state-changing function calls `can()` itself. Hiding a button
  is never the protection — the route guards and the disabled controls are convenience, and the domain refuses
  the action regardless.
- **Pages read records only through the `visible…()` scopes**, never by filtering the raw list themselves.
- **No HTML is ever built from strings.** No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`.
- Contexts hold state and subscriptions only; they contain no business rules and no second copy of the data.
- Another tab's change arrives as a `storage` event and re-reads the data, so open tabs stay in sync and a
  logout or deactivation elsewhere takes effect immediately.

### Project structure

```
src/
  domain/       19 modules: the V1 logic as ES modules, no React.
                storage.js (the only localStorage access), permissions.js (the permission matrix),
                expenses.js, reimbursements.js, users.js, projects.js, limits.js, analytics.js,
                notifications.js, activity.js, receipts.js, auth.js, settings.js, demo-data.js,
                expense-query.js (pure list filters/sorts) + money/dates/validate/constants
  app/          contexts (company data, session, notifications, toasts, dialogs), route guards,
                the route table, the fatal-error screen
  components/   app shell, charts, dialogs, expense pieces, filters, forms, badges, shared UI
  pages/        one component per V1 page — public/ employee/ manager/ admin/ shared/
  styles/       the V1 stylesheets, class names unchanged
tests/          19 test files — domain rules and jsdom UI tests
public/         favicon and touch icon
```

### Storage

All keys are prefixed `exc:` (schema version 1) so this app never collides with anything else in the browser:

| Key | Contents |
|---|---|
| `exc:schema` | `1` |
| `exc:users` | accounts |
| `exc:credentials` | `{ salt, passwordHash }` per account |
| `exc:session` | `{ userId, loginAt }` |
| `exc:projects` · `exc:expenses` · `exc:reimbursements` | the records |
| `exc:receipts` | receipt images, kept apart so lists stay small |
| `exc:notifications` · `exc:activity` · `exc:settings` | the rest |

Saves are **all-or-nothing**: if a write fails part-way (browser storage full), every key it touched is put back
as it was and nothing is half-saved. Corrupted data is reported on a "can't start" screen naming the key and is
**never silently overwritten**; a missing collection falls back to a safe default. Loading or resetting the demo
removes only `exc:` keys.

---

## Testing

```bash
npm test
```

**255 tests in 86 suites**, using Node's built-in `node:test` — no test framework dependency. The suites cover
the domain rules (permissions, the expense lifecycle, reimbursements, users and reassignment, projects,
settings, limits, analytics, notifications, receipts, storage) and render the real app in jsdom for the UI and
routing tests.

Critical protections are verified by **mutation testing**: the rule is deliberately broken and the suite must
fail. Fifteen protections have been checked this way, including Admin expense access, cross-team manager
access, employee privilege escalation, stale review state, the payer/approver distinction, the scope of a
storage reset and cross-tab updates.

---

## Version 1

Version 2 is a migration of an earlier HTML/CSS/vanilla-JS version (Version 1), which is not part of this
repository. The domain logic was carried over as ES modules with its behaviour preserved: 16 of the 18 domain
modules are byte-identical to Version 1. The two differences are deliberate: `auth.js` has one reworded error
message, and `limits.js` lost its two HTML-rendering helpers, which are reproduced exactly by the `LimitBadge`
and `LimitMeter` components. `expense-query.js` holds the logic half of Version 1's `expense-view.js`, also
byte-identical. The stylesheets match Version 1 apart from three added spacing utilities.

---

## Dependencies

Runtime: **React, React DOM, React Router** — nothing else. Development: Vite, `@vitejs/plugin-react` and jsdom.
There is no HTTP client, no state-management library, no UI framework and no analytics or telemetry package.
The built app makes **no external network request of any kind**.

---

## Known limitations

- **Client-side only.** Authentication, roles and privacy are enforced in browser JavaScript over data the user
  can edit. This is a prototype, not a secure system.
- Data lives in one browser profile. It is not shared between browsers, devices or people, and clearing site
  data deletes it.
- Passwords are salted and hashed but not key-stretched, and there is no password reset — an Admin can only
  provision a new temporary password by creating the account.
- Single currency (INR) and a single company per browser.
- Receipt compression and layout were measured in Chromium only.
- `localStorage` is finite (a few MB); receipts are resized aggressively for that reason, and a full store is
  reported rather than silently dropping data.
- The permission table contains one unused key (`expense.submit`), kept because the module is byte-identical to
  Version 1 and the rule it describes is enforced inline.
