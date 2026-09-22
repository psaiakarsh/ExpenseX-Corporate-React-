// dates.js — calendar dates are "YYYY-MM-DD" strings in LOCAL time.
// (toISOString() is UTC and would shift the day for IST users before 05:30.)

import { appNow } from './storage.js';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toLocalDate(date = appNow()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// True only for real calendar dates ("2026-02-30" is rejected).
export function isValidDate(text) {
  if (!DATE_PATTERN.test(String(text))) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// "2026-09-12" → "12 Sep 2026"
export function formatDate(isoDate) {
  if (!isValidDate(isoDate)) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ISO timestamp → "17 Sep 2026, 14:05"
export function formatDateTime(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ISO timestamp → "5 min ago", "3 h ago", "2 days ago", or a date for older items.
export function formatRelative(isoTimestamp) {
  const minutes = Math.round((appNow() - new Date(isoTimestamp)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDateTime(isoTimestamp);
}

// "2026-09-12" → "2026-09"
export function monthKey(isoDate) {
  return isoDate.slice(0, 7);
}

export function currentMonthKey() {
  return monthKey(toLocalDate());
}

// "2026-09" → "Sep 2026"
export function formatMonth(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// The last `count` month keys ending with the current month, oldest first.
export function lastMonthKeys(count) {
  const now = appNow();
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(monthKey(toLocalDate(date)));
  }
  return keys;
}
