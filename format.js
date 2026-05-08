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

/**
 * Единое отображение даты для UI: ДД.ММ.ГГГГ.
 * - YYYY-MM-DD → ДД.ММ.ГГГГ
 * - ДД.ММ.ГГГГ → как есть
 * - YYYY-MM-DDTHH:mm:ss... → берём только YYYY-MM-DD
 */
export function formatDateRu(dateLike) {
  const s = String(dateLike ?? '').trim();
  if (!s) return '—';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  const iso = s.split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDateISO(iso);
  return s;
}

/**
 * Разбор даты из строки ДД.ММ.ГГГГ (допускаются однозначные день/месяц).
 * Возвращает YYYY-MM-DD или null.
 */
export function parseDateRu(s) {
  const t = String(s ?? '').trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isFinite(y) || y < 1000 || y > 9999) return null;
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  if (!Number.isFinite(d) || d < 1) return null;
  const last = new Date(y, mo, 0).getDate();
  if (d > last) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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

/**
 * Дефолт времени новой записи по дате: не сегодня — 10:00; сегодня — текущее локальное время,
 * округлённое вверх до слота 00 / 15 / 30 / 45 (как в селектах мастера).
 */
export function defaultNewAppointmentTimeHHMM(dateISO) {
  const day = String(dateISO || '').split('T')[0].trim();
  if (!day || day !== todayISO()) return '10:00';
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const rem = totalMin % 15;
  let ceilMin = rem === 0 ? totalMin : totalMin + (15 - rem);
  if (ceilMin >= 24 * 60) ceilMin = 23 * 60 + 45;
  const h = Math.floor(ceilMin / 60);
  const m = ceilMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

/** Дата строкой YYYY-MM-DD (без времени). */
function dateKey(iso) {
  return String(iso ?? '').split('T')[0].trim();
}

/**
 * Если дата записи — сегодня (локально), вернуть true, если момент начала по времени уже раньше «сейчас».
 * Для будущих календарных дат всегда false.
 */
export function isAppointmentStartInPastToday(dateISO, timeStr, nowMs = Date.now()) {
  const day = dateKey(dateISO);
  if (!day || day !== todayISO()) return false;
  const w = appointmentWindowMs(dateISO, timeStr, 0);
  if (!w) return false;
  return w.startMs < nowMs;
}

/**
 * Пересечение интервалов [start, end) двух записей на одну календарную дату.
 * Поля записи: date, time, plannedMinutes (как в IndexedDB).
 */
export function appointmentTimesOverlapSameDay(apA, apB) {
  const da = dateKey(apA?.date);
  const db = dateKey(apB?.date);
  if (!da || !db || da !== db) return false;
  const wa = appointmentWindowMs(apA.date, apA.time, apA.plannedMinutes);
  const wb = appointmentWindowMs(apB.date, apB.time, apB.plannedMinutes);
  if (!wa || !wb) return false;
  return wa.startMs < wb.endMs && wb.startMs < wa.endMs;
}

/**
 * MVP: до plannedStart — «Запланировано», с начала слота до завершения визита — «В работе» (без «Просрочено»).
 * plannedEnd на подпись не влияет: после конца окна незавершённая запись остаётся «В работе».
 * Сравнение с «сейчас» только для записей на сегодня (на другие даты — «Запланировано», если не done/cancelled).
 * @returns {'done'|'cancelled'|'in_progress'|'upcoming'}
 */
export function appointmentSchedulePhase(ap, nowMs = Date.now()) {
  if (ap.status === 'done') return 'done';
  if (ap.status === 'cancelled') return 'cancelled';
  if (ap.status === 'no_show') return 'no_show';
  const dateStr = (ap.date || '').split('T')[0];
  if (dateStr && dateStr !== todayISO()) return 'upcoming';
  const w = appointmentWindowMs(ap.date, ap.time, ap.plannedMinutes);
  if (!w) return 'upcoming';
  if (nowMs < w.startMs) return 'upcoming';
  return 'in_progress';
}

/** Русская подпись для бейджа. */
export function appointmentStatusLabel(ap, nowMs = Date.now()) {
  const phase = appointmentSchedulePhase(ap, nowMs);
  if (phase === 'done') return 'Завершено';
  if (phase === 'cancelled') return 'Отмена';
  if (phase === 'no_show') return 'Не пришёл';
  if (phase === 'in_progress') return 'В работе';
  return 'Запланировано';
}

/** Классы бейджа (без warn для «просрочки»). */
export function appointmentBadgeClass(ap, nowMs = Date.now()) {
  const phase = appointmentSchedulePhase(ap, nowMs);
  if (phase === 'done') return 'badge ok';
  if (phase === 'cancelled') return 'badge';
  if (phase === 'no_show') return 'badge warn';
  if (phase === 'in_progress') return 'badge';
  return 'badge ok';
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

/** Количество цифр в телефоне (всё кроме 0–9 отбрасывается). */
export function phoneDigitCount(s) {
  return String(s ?? '').replace(/\D/g, '').length;
}

/** Оставляет только цифры (убирает пробелы, +, скобки, дефисы). */
export function normalizeClientPhone(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * Проверка телефона РФ для CRM:
 * - после очистки ровно 11 цифр
 * - начинается с 7 или 8
 * Возвращает { ok, normalized }.
 */
export function validateClientPhoneRu(raw) {
  const digits = normalizeClientPhone(raw);
  if (digits.length !== 11) return { ok: false, normalized: digits };
  if (digits[0] !== '7' && digits[0] !== '8') return { ok: false, normalized: digits };
  return { ok: true, normalized: digits };
}

/** Красивый вывод телефона для UI (в базе хранится просто 11 цифр). */
export function formatClientPhonePretty(raw) {
  const digits = normalizeClientPhone(raw);
  if (digits.length !== 11) return String(raw ?? '').trim();
  const first = digits[0];
  if (first !== '7' && first !== '8') return String(raw ?? '').trim();
  const a = digits.slice(1, 4);
  const b = digits.slice(4, 7);
  const c = digits.slice(7, 9);
  const d = digits.slice(9, 11);
  const head = first === '7' ? '+7' : '8';
  return `${head} (${a}) ${b}-${c}-${d}`;
}

/** Совместимость со старым названием (теперь строгая проверка). */
export function clientPhoneHasEnoughDigits(s) {
  return validateClientPhoneRu(s).ok;
}
