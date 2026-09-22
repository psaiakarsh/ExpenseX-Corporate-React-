// demo-data.js — "Load Demo Company" / "Reset Demo Data".
//
// The demo is NOT hand-typed JSON. It is created by running the real workflow functions
// (setupCompany, createManagedAccount, saveEmployeeExpense, approveExpense, rejectExpense,
// markReimbursed, assignEmployee, …) with the app clock moved back in time. So every history entry,
// reimbursement record, notification and activity line is exactly what the app itself would produce.
//
// Company "Verdant Systems Pvt Ltd" is fictional; ".example" email addresses are reserved and never deliverable.

import { logActivity } from './activity.js';
import { logout, setupCompany, signupEmployee } from './auth.js';
import { formatDate, toLocalDate } from './dates.js';
import { approveExpense, createManagerExpense, rejectExpense, saveEmployeeExpense } from './expenses.js';
import { formatMoney } from './money.js';
import { refreshPendingDigest } from './notifications.js';
import { DENIED, can } from './permissions.js';
import { createProject, setProjectStatus } from './projects.js';
import { dataUrlBytes } from './receipts.js';
import { markReimbursed } from './reimbursements.js';
import { clearAppData, commit, hasAnyUsers, loadDb, restoreAppData, setClock, snapshotAppData } from './storage.js';
import { assignEmployee, createManagedAccount, setMonthlyLimit, setUserActive } from './users.js';

export const DEMO_PASSWORD = 'Demo@123';

export const DEMO_LOGINS = [
  { role: 'Admin', name: 'Sai Akarsh', email: 'sai.akarsh@verdant.example', note: 'Company administration' },
  { role: 'Manager', name: 'Abhay', email: 'abhay@verdant.example', note: 'Engineering · 4 employees' },
  { role: 'Manager', name: 'Sadiq', email: 'sadiq@verdant.example', note: 'Sales · 3 employees' },
  { role: 'Manager', name: 'Charan Sai', email: 'charan.sai@verdant.example', note: 'Operations · small team (1 active + 1 inactive)' },
  { role: 'Employee', name: 'Ravi Kumar', email: 'ravi@verdant.example', note: 'Engineering · ₹14,500 / ₹20,000 used' },
  { role: 'Employee', name: 'Meera Joshi', email: 'meera@verdant.example', note: 'Engineering · over monthly limit' },
  { role: 'Employee', name: 'Aditya Bose', email: 'aditya@verdant.example', note: 'New signup · no manager yet' },
];

// A small receipt-like image drawn on a canvas, so demo claims have something to preview.
export function drawDemoReceipt(merchant, title, amountPaise, date) {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, 360, 480);
  ctx.fillStyle = '#1b1d1f';
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(merchant.toUpperCase(), 180, 56);
  ctx.font = '14px monospace';
  ctx.fillText('TAX INVOICE', 180, 82);
  ctx.fillText(formatDate(date), 180, 104);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#9aa0a6';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(24, 124);
  ctx.lineTo(336, 124);
  ctx.stroke();
  ctx.font = '15px monospace';
  const words = title.split(' ');
  let line = '';
  let y = 156;
  words.forEach((word) => {
    if ((line + word).length > 30) {
      ctx.fillText(line, 24, y);
      line = '';
      y += 22;
    }
    line += `${word} `;
  });
  ctx.fillText(line, 24, y);
  const base = Math.round(amountPaise / 1.18);
  ctx.fillText('Subtotal', 24, 330);
  ctx.fillText('GST 18%', 24, 356);
  ctx.textAlign = 'right';
  ctx.fillText(formatMoney(base), 336, 330);
  ctx.fillText(formatMoney(amountPaise - base), 336, 356);
  ctx.beginPath();
  ctx.moveTo(24, 376);
  ctx.lineTo(336, 376);
  ctx.stroke();
  ctx.font = 'bold 18px monospace';
  ctx.fillText(formatMoney(amountPaise), 336, 408);
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', 24, 408);
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Thank you · Demo receipt', 180, 456);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
  return { dataUrl, fileName: `${merchant.toLowerCase().replace(/\W+/g, '-')}-receipt.jpg`, mimeType: 'image/jpeg', sizeBytes: dataUrlBytes(dataUrl) };
}

// Throws if a demo step fails: demo records are hand-checked, so a failure is a programming error.
export function expectOk(result, what) {
  if (!result?.ok) {
    throw new Error(`Demo step failed (${what}): ${result?.error ?? JSON.stringify(result?.errors)}`);
  }
  return result;
}

// actor: the Admin (Settings page), or null on the login page — allowed only while NO data exists,
// because then there is no admin yet and nothing to overwrite.
// mode: 'load' (Load Demo Company — replaces whatever is there) | 'reset' (Reset Demo Data).
// Only "exc:" keys are touched (storage.js); every other localStorage key survives. Everyone is logged out.
export async function loadDemoCompany(actor = null, mode = 'load') {
  if (actor) {
    if (!can(actor, 'admin.demo', null, loadDb())) return DENIED;
  } else if (hasAnyUsers()) {
    return { ok: false, error: 'Company data already exists. An administrator can load the demo from Settings.' };
  }

  // Snapshot of every app key, restored if anything fails, so a failed load never leaves half a company.
  const backup = snapshotAppData();
  try {
    clearAppData();
    await seedDemoCompany(mode);
    logout();
    return { ok: true };
  } catch (error) {
    restoreAppData(backup);
    return { ok: false, error: error.message };
  } finally {
    setClock(null);
  }
}

export async function seedDemoCompany(mode = 'load') {
  const now = new Date();
  const dayOfMonth = now.getDate() - 1; // days since the 1st, so "this month" claims stay in this month
  const at = (daysAgo, hour = 10) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hour, 0, 0, 0);
    return date > now ? now : date;
  };
  const p = DEMO_PASSWORD;

  // ---- Company, admin, managers, employees ----
  setClock(at(200, 9));
  const admin = expectOk(
    await setupCompany({ companyName: 'Verdant Systems Pvt Ltd', name: 'Sai Akarsh', email: 'sai.akarsh@verdant.example', password: p, confirmPassword: p }),
    'setup',
  ).user;

  const makeManager = async (name, email, department) =>
    expectOk(await createManagedAccount(admin, 'manager', { name, email, password: p, department }), name).user;
  const makeEmployee = async (name, email, manager) =>
    expectOk(await createManagedAccount(admin, 'employee', { name, email, password: p, managerId: manager.id }), name).user;

  setClock(at(198, 11));
  const abhay = await makeManager('Abhay', 'abhay@verdant.example', 'Engineering');
  const sadiq = await makeManager('Sadiq', 'sadiq@verdant.example', 'Sales');
  const charan = await makeManager('Charan Sai', 'charan.sai@verdant.example', 'Operations');

  setClock(at(196, 12));
  const ravi = await makeEmployee('Ravi Kumar', 'ravi@verdant.example', abhay);
  const sneha = await makeEmployee('Sneha Iyer', 'sneha@verdant.example', abhay);
  const karthik = await makeEmployee('Karthik Reddy', 'karthik@verdant.example', abhay);
  const meera = await makeEmployee('Meera Joshi', 'meera@verdant.example', abhay);
  const rahul = await makeEmployee('Rahul Verma', 'rahul@verdant.example', sadiq);
  const divya = await makeEmployee('Divya Menon', 'divya@verdant.example', sadiq);
  const farhan = await makeEmployee('Farhan Ali', 'farhan@verdant.example', charan);
  const neha = await makeEmployee('Neha Gupta', 'neha@verdant.example', charan);
  const rohit = await makeEmployee('Rohit Das', 'rohit@verdant.example', charan);

  // ---- Projects ----
  setClock(at(192, 10));
  const project = (manager, name, description) => expectOk(createProject(manager, { name, description }), name).project;
  const apollo = project(abhay, 'Apollo Mobile App', 'Customer mobile app rebuild');
  const cloud = project(abhay, 'Cloud Migration', 'Move on-prem services to the cloud');
  const tools = project(abhay, 'Internal Tools', 'Developer productivity and internal dashboards');
  const enterprise = project(sadiq, 'Enterprise Deals FY26', 'Large-account sales pipeline');
  const summit = project(sadiq, 'Partner Summit 2026', 'Annual partner and dealer summit');
  const warehouse = project(charan, 'Warehouse Automation', 'Scanners, conveyors and process automation');
  const vendor = project(charan, 'Vendor Onboarding', 'New supplier onboarding programme');

  // ---- Monthly limits ----
  setClock(at(190, 10));
  [[abhay, ravi, '20000'], [abhay, sneha, '15000'], [abhay, karthik, '25000'], [abhay, meera, '10000'],
    [sadiq, rahul, '30000'], [sadiq, divya, '25000'], [charan, neha, '15000']]
    .forEach(([manager, employee, limit]) => expectOk(setMonthlyLimit(manager, employee.id, limit), 'limit'));

  // ---- Timeline of events (run oldest first so notifications and activity read naturally) ----
  const refs = {};

  // One employee claim with its full workflow.
  // outcome: draft | pending | rejected | resubmitted | reimbursement_pending | reimbursed
  const claim = (days, employee, manager, title, category, rupees, projectRef, outcome, extra = {}) => ({
    days,
    run: () => {
      const thisMonth = extra.thisMonth;
      const submitAt = at(days, 10);
      const date = toLocalDate(thisMonth ? submitAt : at(days + 1));
      const input = { title, category, amount: String(rupees), date, projectId: projectRef?.id ?? '', notes: extra.notes ?? '' };
      const receipt = extra.receipt ? drawDemoReceipt(extra.receipt, title, rupees * 100, date) : null;

      setClock(submitAt);
      const expense = expectOk(saveEmployeeExpense(employee, input, { submit: outcome !== 'draft', receipt }), title).expense;
      if (extra.ref) refs[extra.ref] = expense;
      if (outcome === 'draft' || outcome === 'pending') return;

      setClock(at(Math.max(days - 1, 0), 16));
      if (outcome === 'rejected' || outcome === 'resubmitted') {
        expectOk(rejectExpense(manager, expense.id, extra.rejectComment), `reject ${title}`);
        if (outcome === 'resubmitted') {
          setClock(at(Math.max(days - 1, 0), 19));
          const fixed = { ...input, amount: String(extra.resubmitRupees ?? rupees), notes: extra.resubmitNotes ?? input.notes };
          const fixReceipt = extra.resubmitReceipt ? drawDemoReceipt(extra.resubmitReceipt, title, (extra.resubmitRupees ?? rupees) * 100, date) : null;
          expectOk(saveEmployeeExpense(employee, fixed, { expenseId: expense.id, submit: true, receipt: fixReceipt }), `resubmit ${title}`);
        }
        return;
      }

      const approved = expectOk(approveExpense(manager, expense.id, extra.approveComment ?? ''), `approve ${title}`).expense;
      if (outcome === 'reimbursed') {
        setClock(at(Math.max(days - 3, 0), 18));
        expectOk(markReimbursed(manager, approved.reimbursementId, `NEFT-${String(700000 + days * 37).slice(0, 6)}`), `reimburse ${title}`);
      }
    },
  });

  // A manager-created claim (auto-approved; self-approved when `owner` is the manager).
  const managerClaim = (days, manager, owner, title, category, rupees, projectRef, reimburse, extra = {}) => ({
    days,
    run: () => {
      const createdAt = at(days, 11);
      const date = toLocalDate(extra.thisMonth ? createdAt : at(days + 1));
      const receipt = extra.receipt ? drawDemoReceipt(extra.receipt, title, rupees * 100, date) : null;
      setClock(createdAt);
      const expense = expectOk(
        createManagerExpense(manager, { title, category, amount: String(rupees), date, projectId: projectRef.id, notes: extra.notes ?? '' }, { employeeId: owner.id, receipt }),
        title,
      ).expense;
      if (reimburse) {
        setClock(at(Math.max(days - 4, 0), 17));
        expectOk(markReimbursed(manager, expense.reimbursementId, `NEFT-${String(800000 + days * 41).slice(0, 6)}`), `reimburse ${title}`);
      }
    },
  });

  const event = (days, run) => ({ days, run });
  const m = (days) => Math.min(days, dayOfMonth); // keeps "this month" events inside the current month
  const thisMonth = { thisMonth: true };

  const timeline = [
    // Engineering — Abhay's team
    claim(150, ravi, abhay, 'Client visit – Pune (train)', 'Travel', 3450, apollo, 'reimbursed'),
    claim(140, ravi, abhay, 'Team lunch with client', 'Client Entertainment', 2800, apollo, 'reimbursed'),
    claim(118, ravi, abhay, 'Hotel – Bengaluru workshop', 'Accommodation', 7200, cloud, 'reimbursed', { receipt: 'Hotel Orchid Bengaluru' }),
    claim(95, ravi, abhay, 'Cab to airport', 'Transportation', 1150, cloud, 'reimbursed'),
    claim(70, ravi, abhay, 'USB-C docking station', 'Equipment', 8999, tools, 'rejected', {
      rejectComment: 'Please raise hardware through IT procurement instead of reimbursement.',
    }),
    claim(62, ravi, abhay, 'AWS certification exam', 'Training', 12500, cloud, 'reimbursed', { approveComment: 'Great initiative — approved.' }),
    claim(40, ravi, abhay, 'Flight – Delhi client review', 'Travel', 9800, apollo, 'reimbursed', { receipt: 'SkyJet Airways' }),
    claim(dayOfMonth + 6, ravi, abhay, 'Working dinner – release night', 'Food', 1850, apollo, 'reimbursement_pending'),
    claim(m(12), ravi, abhay, 'Hotel – Hyderabad sprint review', 'Accommodation', 8400, apollo, 'reimbursement_pending', { ...thisMonth, receipt: 'Lakeview Suites' }),
    claim(m(6), ravi, abhay, 'Client visit – Mumbai', 'Travel', 4500, apollo, 'pending', { ...thisMonth, notes: 'Return train + local travel for the Apollo demo.' }),
    claim(m(3), ravi, abhay, 'Cab – Mumbai office visits', 'Transportation', 1850, apollo, 'resubmitted', {
      ...thisMonth,
      rejectComment: 'The amount doesn’t match the trips listed. Please attach the cab receipt.',
      resubmitRupees: 1600,
      resubmitNotes: 'Corrected total (3 trips) and attached the receipt.',
      resubmitReceipt: 'CityCab',
    }),
    claim(m(1), ravi, abhay, 'Team offsite snacks', 'Food', 900, tools, 'draft', thisMonth),

    claim(130, sneha, abhay, 'Figma annual seat', 'Software', 14400, tools, 'reimbursed'),
    claim(88, sneha, abhay, 'React conference ticket', 'Training', 11999, apollo, 'reimbursed', { receipt: 'ReactConf India' }),
    managerClaim(55, abhay, sneha, 'Team hackathon supplies', 'Office Supplies', 3200, tools, true),
    claim(50, sneha, abhay, 'Taxi – late night deploy', 'Transportation', 780, apollo, 'reimbursed'),
    claim(m(9), sneha, abhay, 'Stationery for sprint planning', 'Office Supplies', 1240, tools, 'pending', thisMonth),
    claim(m(4), sneha, abhay, 'Lunch – onboarding buddies', 'Food', 2100, tools, 'reimbursement_pending', thisMonth),

    claim(160, karthik, abhay, 'Laptop stand & keyboard', 'Equipment', 6450, tools, 'reimbursed'),
    claim(105, karthik, abhay, 'Flight – Chennai data centre', 'Travel', 11200, cloud, 'reimbursed', { receipt: 'SkyJet Airways' }),
    claim(76, karthik, abhay, 'Hotel – Chennai (2 nights)', 'Accommodation', 9600, cloud, 'reimbursed'),
    claim(33, karthik, abhay, 'Kubernetes course', 'Training', 7999, cloud, 'reimbursement_pending'),
    claim(m(10), karthik, abhay, 'Flight – Chennai migration cutover', 'Travel', 12800, cloud, 'reimbursement_pending', { ...thisMonth, receipt: 'SkyJet Airways' }),
    claim(m(5), karthik, abhay, 'Hotel – Chennai cutover', 'Accommodation', 8900, cloud, 'pending', thisMonth),

    claim(90, meera, abhay, 'Design research books', 'Training', 2350, apollo, 'reimbursed'),
    claim(45, meera, abhay, 'User research incentives', 'Other', 6000, apollo, 'rejected', {
      rejectComment: 'Research incentives are paid from the Research budget, not through reimbursement.',
    }),
    claim(m(8), meera, abhay, 'Usability study travel', 'Travel', 6200, apollo, 'reimbursement_pending', thisMonth),
    claim(m(2), meera, abhay, 'Prototype devices rental', 'Equipment', 4800, apollo, 'pending', thisMonth),

    managerClaim(100, abhay, abhay, 'Leadership offsite – hotel', 'Accommodation', 14500, tools, true, { receipt: 'Hilltop Retreat' }),
    managerClaim(m(7), abhay, abhay, 'Client dinner – Apollo launch', 'Client Entertainment', 6750, apollo, false, thisMonth),

    // Sales — Sadiq's team
    claim(170, rahul, sadiq, 'Flight – Delhi enterprise pitch', 'Travel', 10400, enterprise, 'reimbursed'),
    claim(125, rahul, sadiq, 'Client dinner – Q2 renewal', 'Client Entertainment', 7800, enterprise, 'reimbursed'),
    claim(80, rahul, sadiq, 'Hotel – Kolkata roadshow', 'Accommodation', 12600, enterprise, 'reimbursed'),
    claim(35, rahul, sadiq, 'CRM add-on licence', 'Software', 4999, enterprise, 'reimbursed'),
    claim(m(11), rahul, sadiq, 'Flight – Bengaluru partner meet', 'Travel', 8700, summit, 'reimbursement_pending', thisMonth),
    claim(m(3), rahul, sadiq, 'Client lunch – renewal', 'Client Entertainment', 3400, enterprise, 'pending', thisMonth),

    claim(145, divya, sadiq, 'Trade fair booth materials', 'Office Supplies', 9200, summit, 'reimbursed'),
    claim(98, divya, sadiq, 'Cab – client meetings (week)', 'Transportation', 2650, enterprise, 'reimbursed'),
    claim(60, divya, sadiq, 'Client gifts – festive season', 'Client Entertainment', 15000, enterprise, 'rejected', {
      rejectComment: 'Gifts above ₹10,000 need prior approval. Please attach the approval email and resubmit.',
    }),
    claim(20, divya, sadiq, 'Hotel – Partner Summit venue visit', 'Accommodation', 6900, summit, 'reimbursement_pending'),
    claim(m(6), divya, sadiq, 'Train – Pune client visit', 'Travel', 1850, enterprise, 'pending', thisMonth),

    managerClaim(110, sadiq, sadiq, 'Flight – Singapore partner summit', 'Travel', 38500, summit, true, { receipt: 'SkyJet Airways' }),
    managerClaim(m(5), sadiq, sadiq, 'Client dinner – FY26 kickoff', 'Client Entertainment', 9400, enterprise, false, thisMonth),

    // Operations — Charan Sai's team (Farhan moves to Sales; Rohit leaves the company)
    claim(150, rohit, charan, 'Vendor onboarding travel', 'Travel', 5200, vendor, 'reimbursed'),
    claim(135, neha, charan, 'Safety shoes (team of 6)', 'Equipment', 7200, warehouse, 'reimbursed'),
    claim(120, farhan, charan, 'Forklift safety training', 'Training', 4500, warehouse, 'reimbursed'),
    claim(115, neha, charan, 'Excel automation course', 'Training', 3499, warehouse, 'reimbursed'),
    managerClaim(85, charan, charan, 'Warehouse automation expo', 'Training', 6500, warehouse, true),
    claim(65, neha, charan, 'Vendor visit – Surat', 'Travel', 4650, vendor, 'reimbursed'),
    // Pending when Farhan is reassigned → it moves to Sadiq, who approves it.
    claim(64, farhan, charan, 'Site visit – Nashik warehouse', 'Travel', 3800, warehouse, 'pending', { ref: 'farhanNashik' }),
    event(60, () => {
      setClock(at(60, 12));
      expectOk(assignEmployee(admin, farhan.id, sadiq.id), 'reassign Farhan');
      setClock(at(60, 15));
      expectOk(setMonthlyLimit(sadiq, farhan.id, '20000'), 'Farhan limit');
    }),
    event(58, () => {
      setClock(at(58, 11));
      const approved = expectOk(approveExpense(sadiq, refs.farhanNashik.id, 'Approved after team move.'), 'approve Nashik').expense;
      setClock(at(55, 17));
      expectOk(markReimbursed(sadiq, approved.reimbursementId, 'NEFT-552190'), 'reimburse Nashik');
    }),
    event(40, () => {
      setClock(at(40, 10));
      expectOk(setProjectStatus(charan, vendor.id, 'archived'), 'archive project');
    }),
    claim(30, neha, charan, 'Warehouse scanner repair', 'Equipment', 5800, warehouse, 'reimbursement_pending'),
    event(28, () => {
      setClock(at(28, 18));
      expectOk(setUserActive(admin, rohit.id, false), 'deactivate Rohit');
    }),
    claim(m(9), farhan, sadiq, 'Hotel – Jaipur dealer meet', 'Accommodation', 7400, summit, 'reimbursement_pending', thisMonth),
    claim(m(7), neha, charan, 'Label printer ribbons', 'Office Supplies', 2300, warehouse, 'pending', thisMonth),
    claim(m(4), neha, charan, 'Team lunch – audit completion', 'Food', 3600, warehouse, 'rejected', {
      ...thisMonth,
      rejectComment: 'Team meals over ₹3,000 need pre-approval. Please resubmit with the approval reference.',
    }),
    claim(m(2), farhan, sadiq, 'Cab – Jaipur dealer visits', 'Transportation', 1300, summit, 'draft', thisMonth),

    // A new public signup waiting for a manager (can only save drafts).
    event(1, async () => {
      setClock(at(1, 9));
      const aditya = expectOk(
        await signupEmployee({ name: 'Aditya Bose', email: 'aditya@verdant.example', password: p, confirmPassword: p }, { login: false }),
        'signup Aditya',
      ).user;
      setClock(at(1, 10));
      expectOk(
        saveEmployeeExpense(aditya, { title: 'Laptop backpack', category: 'Equipment', amount: '2200', date: toLocalDate(at(1)), projectId: '', notes: '' }),
        'Aditya draft',
      );
    }),
  ];

  timeline.sort((a, b) => b.days - a.days);
  for (const step of timeline) await step.run();

  // ---- Finish: pending digests for managers, mark demo as loaded ----
  setClock(null);
  [abhay, sadiq, charan].forEach((manager) => refreshPendingDigest(manager));
  const db = loadDb();
  db.settings = { ...db.settings, demoLoaded: true };
  logActivity(db, admin.id, mode === 'reset' ? 'demo_reset' : 'demo_loaded', {
    summary: mode === 'reset'
      ? 'Demo data was reset: "Verdant Systems Pvt Ltd" was recreated from scratch.'
      : 'Demo company "Verdant Systems Pvt Ltd" was loaded.',
  });
  commit(db, ['settings', 'activity']);
}
