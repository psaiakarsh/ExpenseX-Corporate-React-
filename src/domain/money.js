// money.js — every amount is stored as a whole number of PAISE (₹1 = 100 paise).
// Integers keep additions exact (0.1 + 0.2 !== 0.3 in floating point). Rupees are only for display.

export const MAX_EXPENSE_PAISE = 10_00_000 * 100; // ₹10,00,000 per expense
export const MAX_LIMIT_PAISE = 1_00_00_000 * 100; // ₹1 crore monthly limit

// "1,250.5" → 125050. Uses string arithmetic only (19.99 * 100 is 1998.9999… in floating point).
// Returns null for anything invalid: empty, negative, NaN, Infinity, "1e5", more than 2 decimals.
export function parseMoney(text) {
  const clean = String(text ?? '').trim().replaceAll(',', '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;

  const [rupees, fraction = ''] = clean.split('.');
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

// A valid stored amount: a finite, safe, positive integer no larger than `max`.
export function isValidAmount(paise, max = MAX_EXPENSE_PAISE) {
  return Number.isSafeInteger(paise) && paise > 0 && paise <= max;
}

// 125050 → "₹1,250.50" (Indian digit grouping). Display only.
export function formatMoney(paise) {
  if (!Number.isSafeInteger(paise)) return '₹—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

// 1234500 → "₹12.3K" for chart labels. Display only.
export function formatMoneyCompact(paise) {
  if (!Number.isFinite(paise)) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(paise / 100);
}

// 125050 → "1250.50" (to pre-fill an input when editing).
export function toAmountInput(paise) {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

export function sumAmounts(records) {
  return records.reduce((sum, record) => sum + record.amount, 0);
}
