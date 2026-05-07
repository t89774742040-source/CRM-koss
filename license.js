const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

/** Коды активации (полная версия). Можно добавить свои. */
const VALID_CODES = new Set([
  'KOSO-ACCESS-2026-M7P4',
  'KOSO-ACCESS-2026-R2X9',
  'KOSO-ACCESS-2026-L8Q5',
]);

export function isActivated(meta) {
  return meta.activated === true;
}

export function setActivated(db, value) {
  return db.setMeta('activated', !!value);
}

export function getTrialStart(meta) {
  return meta.trialStartedAt ? Number(meta.trialStartedAt) : null;
}

export async function startTrial(db) {
  await db.setMeta('trialStartedAt', Date.now());
}

export function trialRemainingMs(meta) {
  if (isActivated(meta)) return Infinity;
  const start = getTrialStart(meta);
  if (!start) return 0;
  const end = start + TRIAL_MS;
  return Math.max(0, end - Date.now());
}

export function trialDaysLeft(meta) {
  const ms = trialRemainingMs(meta);
  if (ms === Infinity) return null;
  if (!getTrialStart(meta)) return 0;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function isAccessAllowed(meta) {
  if (isActivated(meta)) return true;
  const start = getTrialStart(meta);
  if (!start) return false;
  return Date.now() < start + TRIAL_MS;
}

export function validateActivationCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return VALID_CODES.has(c);
}

export async function activateWithCode(db, code) {
  if (!validateActivationCode(code)) return false;
  await db.setMeta('activated', true);
  return true;
}
