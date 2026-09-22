// constants.js — fixed lists shared by the whole app.

export const ROLES = { ADMIN: 'admin', MANAGER: 'manager', EMPLOYEE: 'user' };

export const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'Employee' };

export const CATEGORIES = [
  'Travel',
  'Food',
  'Accommodation',
  'Transportation',
  'Office Supplies',
  'Equipment',
  'Client Entertainment',
  'Software',
  'Training',
  'Other',
];

export const STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REIMBURSEMENT_PENDING: 'reimbursement_pending',
  REIMBURSED: 'reimbursed',
  REJECTED: 'rejected',
};

export const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  reimbursement_pending: 'Reimbursement Pending',
  reimbursed: 'Reimbursed',
  rejected: 'Rejected',
};

// Display order for status breakdowns.
export const STATUS_ORDER = ['draft', 'pending', 'approved', 'reimbursement_pending', 'reimbursed', 'rejected'];

// Statuses that count as "claimed spending" (drafts are unsent, rejected claims are not spending).
export const SPENDING_STATUSES = ['pending', 'approved', 'reimbursement_pending', 'reimbursed'];

// Statuses reached only after a manager approved (the "Approved" figure in analytics).
export const APPROVED_STATUSES = ['approved', 'reimbursement_pending', 'reimbursed'];

// Admin team breakdowns are hidden for smaller teams, so one person's spending can't be worked out.
export const MIN_TEAM_SIZE_FOR_BREAKDOWN = 3;
