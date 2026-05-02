export function money(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(v);
}

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateISO(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y) return '—';
  return `${d}.${m}.${y}`;
}

/** «HH:MM» для времени записи («10:00» или полный строковый вид, 24 ч) */
export function clockHHMM(t) {
  if (!t || typeof t !== 'string') return '—';
  const s = t.trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!match) return s.slice(0, 5);
  const h = String(Math.min(23, Math.max(0, parseInt(match[1], 10) || 0))).padStart(2, '0');
  const m = String(Math.min(59, Math.max(0, parseInt(match[2], 10) || 0))).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatTime(t) {
  if (!t) return '—';
  const c = clockHHMM(t);
  return c === '—' ? '—' : c;
}

/** Ближайшие минуты к одному из 0 / 15 / 30 / 45 (для выбора слота). */
export function nearestQuarterMinute(m) {
  const n = Math.min(59, Math.max(0, Math.round(Number(m) || 0)));
  const q = [0, 15, 30, 45];
  return q.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 0);
}

/** Разбор строки времени записи под селекты «часы + кварталы минут». */
export function timeToHourAndQuarter(t) {
  const c = clockHHMM(t && typeof t === 'string' ? t.trim() : '');
  if (c === '—') return { hours: 10, quarterMin: 0 };
  const m = /^(\d{2}):(\d{2})/.exec(c);
  if (!m) return { hours: 10, quarterMin: 0 };
  const hours = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
  const quarterMin = nearestQuarterMinute(parseInt(m[2], 10) || 0);
  return { hours, quarterMin };
}

/** Сборка времени записи HH:MM (24 ч) из значений селектов. */
export function hourMinuteToHHMM(hours, minutes) {
  const h = Math.min(23, Math.max(0, Number(hours) || 0));
  const mi = Math.min(59, Math.max(0, Number(minutes) || 0));
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Минуты от полуночи для сравнения расписания (строка «HH:MM») */
export function timeHHMMToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!match) return null;
  return (Math.min(23, Math.max(0, parseInt(match[1], 10) || 0)) || 0) * 60 + (Math.min(59, Math.max(0, parseInt(match[2], 10) || 0)) || 0);
}

/**
 * Окно записи на дату dateISO (локальное время браузера), мс UNIX.
 * plannedMinutes может увести конец за полночь — учитывается.
 */
export function appointmentWindowMs(dateISO, timeStr, plannedMinutes) {
  const minsFromMidnight = timeHHMMToMinutes(timeStr);
  if (minsFromMidnight == null || !dateISO) return null;
  const parts = dateISO.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  if (!y || !mo || !d) return null;
  const dur = Math.max(0, Math.round(Number(plannedMinutes) || 0));
  const startMs = new Date(
    y,
    mo - 1,
    d,
    Math.floor(minsFromMidnight / 60),
    minsFromMidnight % 60,
    0,
    0
  ).getTime();
  const endMs = startMs + dur * 60 * 1000;
  return { startMs, endMs };
}

/** HH:MM по локальному времени для метки времени */
export function msToClockHHMM(ms) {
  const dt = new Date(ms);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

export function minutesToLabel(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(n / 60);
  const min = n % 60;
  if (h && min) return `${h} ч ${min} мин`;
  if (h) return `${h} ч`;
  return `${min} мин`;
}

export function parseMinutesFromFields(hours, minutes) {
  const h = Math.max(0, parseInt(hours, 10) || 0);
  const m = Math.max(0, parseInt(minutes, 10) || 0);
  return h * 60 + m;
}
