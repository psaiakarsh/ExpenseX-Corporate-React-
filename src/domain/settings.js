// settings.js — system settings, changed by the Admin only.
// Settings { companyName, currency: 'INR', limitWarningPercent, allowSignup, demoLoaded }

import { logActivity } from './activity.js';
import { DENIED, can } from './permissions.js';
import { commit, loadDb } from './storage.js';
import { checkName, collectErrors, hasErrors } from './validate.js';

export function updateSettings(actor, input) {
  const db = loadDb();
  if (!can(actor, 'admin.settings', null, db)) return DENIED;

  const percent = Number(input.limitWarningPercent);
  const errors = collectErrors({
    companyName: checkName(input.companyName, 'Company name'),
    limitWarningPercent: Number.isInteger(percent) && percent >= 50 && percent <= 99 ? '' : 'Enter a whole number from 50 to 99.',
  });
  if (hasErrors(errors)) return { ok: false, errors };

  db.settings = {
    ...db.settings,
    companyName: input.companyName.trim(),
    limitWarningPercent: percent,
    allowSignup: Boolean(input.allowSignup),
  };
  logActivity(db, actor.id, 'settings_updated', {
    targetType: 'settings',
    summary: `${actor.name} updated settings (limit warning ${percent}%, public signup ${db.settings.allowSignup ? 'on' : 'off'}).`,
  });
  commit(db, ['settings', 'activity']);
  return { ok: true, settings: db.settings };
}
