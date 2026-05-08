import * as License from './license.js';
import * as F from './format.js';
import { setupExcelClientImport, attachExcelClientButtons } from './excel-clients.js';

const WIZARD_KEY = 'kosoWizardV1';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2800);
}

function htmlDemoTelegramHint(opts = {}) {
  const center = opts.centered ? 'text-align:center;' : '';
  return `<p class="muted" style="margin-top:10px;margin-bottom:14px;font-size:0.85rem;line-height:1.45;${center}">
    Чтобы получить код полного доступа, напишите в Telegram:
    <a href="https://t.me/tnatalina" target="_blank" rel="noopener noreferrer">@tnatalina</a>
  </p>`;
}

async function downloadDbBackupJson(db) {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kosopletenie-crm-backup-${F.todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Файл скачан');
}

/**
 * Подтверждение в модальном слое. Во встроенных превью (Simple Browser) `window.confirm` часто
 * отключён или сразу возвращает true — тогда запись «удалялась» без вопроса.
 * @param {string} message
 * @param {{ leftLabel?: string, rightLabel?: string, focusLeft?: boolean }} [options]
 * @returns {Promise<boolean>} true — правый вариант (напр. «Удалить»), false — левый («Оставить»)
 */
function confirmDialog(message, options = {}) {
  const leftLabel = options.leftLabel ?? 'Отмена';
  const rightLabel = options.rightLabel ?? 'ОК';
  const focusLeft = options.focusLeft === true;
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'ui-confirm';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'ui-confirm-title');
    wrap.innerHTML = `
      <div class="ui-confirm__backdrop" data-confirm-dismiss tabindex="-1"></div>
      <div class="ui-confirm__card card">
        <p class="ui-confirm__text" id="ui-confirm-title">${esc(message)}</p>
        <div class="ui-confirm__actions">
          <button type="button" class="btn btn-secondary" data-confirm-no>${esc(leftLabel)}</button>
          <button type="button" class="btn btn-primary" data-confirm-yes>${esc(rightLabel)}</button>
        </div>
      </div>
    `;

    const finish = (val) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(val);
    };

    const onKey = (ev) => {
      if (ev.key === 'Escape') finish(false);
    };

    document.addEventListener('keydown', onKey);
    wrap.querySelector('[data-confirm-yes]')?.addEventListener('click', () => finish(true));
    wrap.querySelector('[data-confirm-no]')?.addEventListener('click', () => finish(false));
    wrap.querySelector('[data-confirm-dismiss]')?.addEventListener('click', () => finish(false));

    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      const el = focusLeft
        ? wrap.querySelector('[data-confirm-no]')
        : wrap.querySelector('[data-confirm-yes]');
      el?.focus();
    });
  });
}

/** Завершённый визит: статус или фактическое окончание (как в completeAppointment). */
function appointmentRowIsFinished(a) {
  if (!a) return false;
  if (a.status === 'done') return true;
  const t = Number(a.actualEndAt);
  return Number.isFinite(t) && t > 0;
}

/** Перенос только запланированной записи: без фактического начала и окончания. */
function appointmentCanReschedule(a) {
  if (!a || a.status === 'cancelled' || a.status === 'no_show') return false;
  if (appointmentRowIsFinished(a)) return false;
  const started = Number(a.actualStartAt);
  if (Number.isFinite(started) && started > 0) return false;
  return true;
}

function appointmentCanCancel(a) {
  if (!a) return false;
  if (a.status !== 'scheduled') return false;
  if (appointmentRowIsFinished(a)) return false;
  const started = Number(a.actualStartAt);
  if (Number.isFinite(started) && started > 0) return false;
  return true;
}

function appointmentDateKeyIso(dateField) {
  return String(dateField ?? '').split('T')[0].trim();
}

/** YYYY-MM-DD → ДД.ММ.ГГГГ для поля даты в мастере. */
function isoDateToDdMmYyyyField(iso) {
  const key = appointmentDateKeyIso(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function addDaysIso(baseIso, days) {
  const s = appointmentDateKeyIso(baseIso);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d + Number(days || 0), 0, 0, 0, 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function reminderDateLabel(reminderDateIso, todayIso) {
  const d = appointmentDateKeyIso(reminderDateIso);
  if (!d) return '—';
  if (d === todayIso) return 'сегодня';
  const tomorrow = addDaysIso(todayIso, 1);
  if (d === tomorrow) return 'завтра';
  return F.formatDateISO(d);
}

function pluralizeRecords(count) {
  const n = Math.abs(Math.trunc(Number(count) || 0));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'запись';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'записи';
  return 'записей';
}

/** Активные записи на день для подсказки «занято» (без завершённых и отменённых). */
function appointmentsOnDayActive(appointments, dateKey, excludeAppointmentId) {
  return appointments.filter((a) => {
    if (appointmentDateKeyIso(a.date) !== dateKey) return false;
    if (a.status === 'done' || a.status === 'cancelled' || a.status === 'no_show') return false;
    if (excludeAppointmentId != null && Number(a.id) === Number(excludeAppointmentId)) return false;
    return true;
  });
}

/** HTML-тело списка занятых интервалов на дату (строки уже экранированы). */
async function htmlBusyDaySlotsBody(db, dateKey, excludeAppointmentId) {
  const [appointments, clients] = await Promise.all([db.listAppointments(), db.listClients()]);
  const cmap = Object.fromEntries(clients.map((c) => [Number(c.id), c]));
  const day = appointmentsOnDayActive(appointments, dateKey, excludeAppointmentId);
  if (!day.length) {
    return `<p class="muted" style="margin:0;font-size:0.9rem;line-height:1.45">На этот день записей пока нет.</p>`;
  }
  day.sort((a, b) => {
    const ma = F.timeHHMMToMinutes(a.time);
    const mb = F.timeHHMMToMinutes(b.time);
    if (ma != null && mb != null) return ma - mb;
    return String(a.time || '').localeCompare(String(b.time || ''), 'ru');
  });
  const parts = [];
  for (const a of day) {
    const w = F.appointmentWindowMs(a.date, a.time, a.plannedMinutes);
    if (!w) continue;
    const t0 = F.msToClockHHMM(w.startMs);
    const t1 = F.msToClockHHMM(w.endMs);
    const svc = String(a.serviceNameSnapshot || 'Услуга').trim() || 'Услуга';
    const c = cmap[Number(a.clientId)];
    const nm = String(c?.name || 'Клиент').trim() || 'Клиент';
    parts.push(
      `<p class="status-line" style="margin:5px 0;line-height:1.4">${esc(t0)}–${esc(t1)} · ${esc(svc)} · ${esc(nm)}</p>`
    );
  }
  return parts.length ? parts.join('') : `<p class="muted" style="margin:0;font-size:0.9rem;line-height:1.45">На этот день записей пока нет.</p>`;
}

/** Среди пересечений с кандидатом — запись с самым поздним окончанием (для подсказки «после …»). */
function pickConflictRowWithLatestEnd(candidate, appointments, excludeAppointmentId) {
  let best = null;
  let bestEnd = -1;
  for (const row of appointments) {
    if (excludeAppointmentId != null && Number(row.id) === Number(excludeAppointmentId)) continue;
    if (row.status === 'done' || row.status === 'cancelled' || row.status === 'no_show') continue;
    if (!F.appointmentTimesOverlapSameDay(candidate, row)) continue;
    const win = F.appointmentWindowMs(row.date, row.time, row.plannedMinutes);
    if (!win) continue;
    if (win.endMs > bestEnd) {
      bestEnd = win.endMs;
      best = row;
    }
  }
  return best;
}

function chooseCancelReasonDialog() {
  const wrap = document.createElement('div');
  wrap.className = 'mat-pick-sheet is-open';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `<div class="mat-pick-sheet__backdrop" data-dismiss></div>
    <div class="mat-pick-sheet__panel">
      <div class="mat-pick-sheet__title">Отмена записи</div>
      <p class="muted" style="margin:0 0 12px;line-height:1.45">Выберите причину:</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button type="button" class="btn btn-secondary" data-reason="cancelled">Клиент отменил</button>
        <button type="button" class="btn btn-secondary" data-reason="no_show">Клиент не пришёл</button>
        <button type="button" class="btn btn-ghost" data-reason="delete">Создано ошибочно</button>
        <button type="button" class="btn btn-secondary" data-reason="" data-dismiss>Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  return new Promise((resolve) => {
    const finish = (val) => {
      wrap.remove();
      resolve(val);
    };
    wrap.addEventListener('click', (ev) => {
      const dis = ev.target.closest('[data-dismiss]');
      if (dis) return finish(null);
      const b = ev.target.closest('[data-reason]');
      if (!b) return;
      const r = String(b.getAttribute('data-reason') || '').trim();
      finish(r || null);
    });
  });
}

function toastOverlapFromConflictRow(conflict) {
  if (!conflict) {
    toast('На это время уже есть другая запись. Выберите другое время.');
    return;
  }
  const w = F.appointmentWindowMs(conflict.date, conflict.time, conflict.plannedMinutes);
  if (!w) {
    toast('На это время уже есть другая запись. Выберите другое время.');
    return;
  }
  const t0 = F.msToClockHHMM(w.startMs);
  const t1 = F.msToClockHHMM(w.endMs);
  toast(
    `На это время уже есть запись: ${t0}–${t1}. Выберите время после ${t1} или другой день.`
  );
}

/** Полная себестоимость визита; у старых записей только материалы в materialCostRub. */
function appointmentTotalCogs(a) {
  const t = Number(a?.totalCogsRub);
  if (Number.isFinite(t) && t >= 0) return t;
  return Number(a?.materialCostRub) || 0;
}

/** Разметка карточки «Тест и сохранение данных» (экран «Сегодня» и настройки). */
function htmlDataBackupCard(footnoteHtml = '') {
  return `
      <div class="card-title">Тест и сохранение данных</div>
      <p class="svc-data-lead">Заполните демо-записи или сохраните свои данные</p>

      <div class="svc-data-action">
        <button type="button" class="btn btn-secondary" id="svc-demo">Заполнить демо-данными</button>
      </div>

      <div class="svc-data-action">
        <button type="button" class="btn btn-secondary" id="svc-demo-purge">Удалить демо-данные</button>
      </div>

      <div class="svc-data-action">
        <button type="button" class="btn btn-secondary" id="svc-export">Выгрузить данные</button>
        <p class="svc-data-hint">Рекомендуем сохранять данные 1–2 раза в неделю, чтобы не потерять клиентов</p>
      </div>

      <div class="svc-data-action">
        <button type="button" class="btn btn-secondary" id="svc-import">Загрузить данные</button>
        <p class="svc-data-hint">Если данные пропали, вы можете восстановить их из сохранённого файла</p>
        <p class="svc-data-hint svc-data-hint--fine">Работает, если вы ранее нажимали «Выгрузить данные»</p>
      </div>

      <div class="svc-data-action">
        <button type="button" class="btn btn-secondary" id="svc-xlsx-import">Импорт клиентов (имя и телефон)</button>
        <p class="svc-data-hint">Для переноса базы с услугами и датами будет доступен расширенный импорт</p>
      </div>

      <div class="svc-data-action">
        <button type="button" class="btn btn-secondary" id="svc-xlsx-template">Скачать шаблон Excel</button>
        <p class="svc-data-hint">Скачайте и заполните этот файл, чтобы загрузить клиентов в систему</p>
        <p class="svc-data-hint svc-data-hint--fine">Важно: используйте именно этот шаблон, чтобы данные загрузились корректно</p>
      </div>
      ${footnoteHtml}`;
}

const MATERIAL_TYPES = [
  'канекалон',
  'термоволокно',
  'кудри',
  'резинки',
  'заколки',
  'декор',
  'уход',
  'прочее',
];
const WEIGHT_TYPES = new Set(['канекалон', 'термоволокно', 'кудри']);

/** Типы для формы «новый материал» на экране прихода (value → подпись для итогового name). */
const PM_PURCHASE_NEW_MATERIAL_TYPES = [
  ['канекалон', 'Канекалон'],
  ['термоволокно', 'Термоволокно'],
  ['кудри', 'Кудри'],
  ['резинки', 'Резинки'],
  ['декор', 'Декор'],
  ['уход', 'Уход'],
  ['прочее', 'Другое'],
];
const PM_PURCHASE_TYPE_DISPLAY = Object.fromEntries(PM_PURCHASE_NEW_MATERIAL_TYPES);

function buildPurchaseNewMaterialDisplayName(typeValue, seriesRaw, colorRaw) {
  const label = PM_PURCHASE_TYPE_DISPLAY[String(typeValue || '').trim()];
  const series = String(seriesRaw ?? '').trim();
  const color = String(colorRaw ?? '').trim();
  const parts = [];
  if (label) parts.push(label);
  if (series) parts.push(series);
  if (color) parts.push(color);
  return parts.join(' · ');
}

function buildMaterialCatalogDisplayName(typeValue, seriesRaw, colorRaw) {
  const typeRaw = String(typeValue ?? '').trim();
  const typeLabel = typeRaw
    ? `${typeRaw.charAt(0).toUpperCase()}${typeRaw.slice(1)}`
    : '';
  const series = String(seriesRaw ?? '').trim();
  const color = String(colorRaw ?? '').trim();
  const parts = [];
  if (typeLabel) parts.push(typeLabel);
  if (series) parts.push(series);
  if (color) parts.push(color);
  return parts.join(' · ');
}

function unitCodeLabel(unitCode) {
  return unitCode === 'pcs' ? 'штуки' : 'граммы';
}

function unitCodeShort(unitCode) {
  return unitCode === 'pcs' ? 'шт' : 'г';
}

function unitCodePriceLabel(unitCode) {
  return unitCode === 'pcs' ? 'штуку' : 'грамм';
}

/** Куда вести «Назад» с экрана complete-*: из «Записей» или по умолчанию «Сегодня». */
function completeReturnTarget(route) {
  const raw = route || '';
  const qIdx = raw.indexOf('?');
  if (qIdx < 0) return 'today';
  const p = new URLSearchParams(raw.slice(qIdx + 1));
  return p.get('from') === 'records' ? 'records' : 'today';
}

function parseRoute(r) {
  const base = (r || 'today').split('?')[0];
  if (base.startsWith('client-')) return { view: 'client', id: base.slice(7) };
  if (base.startsWith('material-')) return { view: 'material', id: base.slice(9) };
  if (base.startsWith('service-')) return { view: 'service', id: base.slice(8) };
  if (base.startsWith('complete-')) return { view: 'complete', id: base.slice(9) };
  if (base.startsWith('edit-')) return { view: 'edit', id: base.slice(5) };
  return { view: base || 'today' };
}

function navHtml(active) {
  const items = [
    ['today', '📅', 'Сегодня'],
    ['records', '📋', 'Записи'],
    ['clients', '👤', 'Клиенты'],
    ['services', '💇', 'Прайс'],
    ['materials', '🧵', 'Материалы'],
    ['finance', '💰', 'Финансы'],
  ];
  return `<nav class="nav-bottom" aria-label="Основное меню">
    ${items
      .map(
        ([id, ico, label]) => `
      <a href="#${id}" class="${active === id ? 'active' : ''}" data-nav="${id}">
        <span class="ico" aria-hidden="true">${ico}</span>
        <span>${esc(label)}</span>
      </a>`
      )
      .join('')}
  </nav>`;
}

function inRange(iso, from, to) {
  if (!iso) return false;
  return iso >= from && iso <= to;
}

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function isIsoYearMonth(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const mo = Number(s.slice(5, 7));
  return mo >= 1 && mo <= 12;
}

function formatMonthYearRu(ym) {
  if (!isIsoYearMonth(ym)) return '—';
  const [y, mo] = ym.split('-').map(Number);
  const d = new Date(y, mo - 1, 1);
  const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(
    d
  );
  const cap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${cap} ${y}`;
}

export async function mount(shell, ctx) {
  const { db, meta, route, go, refresh } = ctx;
  const parsed = parseRoute(route);
  const access = License.isAccessAllowed(meta);

  if (!access) {
    if (!License.getTrialStart(meta) && !License.isActivated(meta)) {
      shell.innerHTML = renderOnboarding();
      return;
    }
    shell.innerHTML = renderLock();
    return;
  }

  const hideNav =
    parsed.view === 'new' ||
    parsed.view === 'edit' ||
    parsed.view === 'complete' ||
    parsed.view === 'purchase' ||
    parsed.view === 'add-material' ||
    parsed.view === 'add-service';

  const activeNav =
    parsed.view === 'client'
      ? 'clients'
      : parsed.view === 'service'
        ? 'services'
      : ['purchase', 'add-material', 'material'].includes(parsed.view)
        ? 'materials'
        : parsed.view === 'services'
          ? 'services'
          : parsed.view;

  shell.innerHTML = `<div class="app-wrap" id="app-root"></div>${hideNav ? '' : navHtml(activeNav)}`;
  const root = document.getElementById('app-root');

  if (parsed.view === 'today') {
    root.innerHTML = await renderToday(db, meta, go);
  } else if (parsed.view === 'records') {
    root.innerHTML = await renderRecords(db, go);
  } else if (parsed.view === 'clients') {
    root.innerHTML = await renderClients(db, go);
  } else if (parsed.view === 'client') {
    root.innerHTML = await renderClientDetail(db, parsed.id, go);
  } else if (parsed.view === 'material') {
    root.innerHTML = await renderMaterialDetail(db, parsed.id, go);
  } else if (parsed.view === 'materials') {
    root.innerHTML = await renderMaterials(db, go);
  } else if (parsed.view === 'services') {
    root.innerHTML = await renderServices(db);
  } else if (parsed.view === 'service') {
    root.innerHTML = await renderServiceDetail(db, parsed.id, go);
  } else if (parsed.view === 'add-service') {
    root.innerHTML = await renderAddService();
  } else if (parsed.view === 'purchase') {
    root.innerHTML = await renderPurchase(db, go);
  } else if (parsed.view === 'add-material') {
    root.innerHTML = await renderAddMaterial();
  } else if (parsed.view === 'finance') {
    root.innerHTML = await renderFinance(db, go);
  } else if (parsed.view === 'settings') {
    root.innerHTML = await renderSettings(db, meta, go, refresh);
  } else if (parsed.view === 'new') {
    await renderWizard(root, db, go);
  } else if (parsed.view === 'edit') {
    await renderWizard(root, db, go, { editAppointmentId: parsed.id });
  } else if (parsed.view === 'complete') {
    await renderComplete(root, db, parsed.id, go, refresh, meta, completeReturnTarget(route));
  } else {
    root.innerHTML = await renderToday(db, meta, go);
  }

  wireImport(ctx);
  setupExcelClientImport(ctx);
}

function renderOnboarding() {
  return `<div class="ob-root">
    <div style="font-size:3rem;margin-bottom:8px" aria-hidden="true">🪢</div>
    <h1>Косоплетение CRM</h1>
    <p>Бесплатное демо на 3 дня с момента запуска. Записи, материалы и прибыль — в одном месте, с телефона.</p>
    <button type="button" class="btn btn-primary" id="ob-start">Начать демо</button>
    <div class="ob-pwa-hint">
      <p class="muted ob-pwa-hint__lead">Можно установить CRM на экран телефона, чтобы ссылка не потерялась.</p>
      <button type="button" class="btn btn-ghost ob-pwa-toggle" id="ob-pwa-toggle" aria-expanded="false" aria-controls="ob-pwa-detail">Как установить?</button>
      <div id="ob-pwa-detail" class="ob-pwa-detail" hidden>
        <div class="ob-pwa-detail__inner muted">
          <p class="ob-pwa-detail__title">Как установить на телефон</p>
          <p><strong>Android:</strong> Откройте меню браузера ⋮ и выберите «Добавить на главный экран» или «Установить приложение».</p>
          <p><strong>iPhone:</strong> Откройте ссылку в Safari, нажмите «Поделиться» и выберите «На экран Домой».</p>
          <p class="ob-pwa-detail__foot">После этого CRM появится на экране телефона как обычное приложение.</p>
        </div>
      </div>
    </div>
    <p class="muted" style="margin-top:20px">Уже есть код?</p>
    <input type="text" class="field" id="ob-code" placeholder="Код доступа" autocomplete="off" />
    <button type="button" class="btn btn-secondary" id="ob-activate">Активировать</button>
  </div>`;
}

export function attachOnboarding(shell, db, go, refresh) {
  const pwaToggle = shell.querySelector('#ob-pwa-toggle');
  const pwaDetail = shell.querySelector('#ob-pwa-detail');
  if (pwaToggle && pwaDetail) {
    pwaToggle.addEventListener('click', () => {
      const open = pwaDetail.hidden;
      pwaDetail.hidden = !open;
      pwaToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      pwaToggle.textContent = open ? 'Скрыть' : 'Как установить?';
    });
  }
  const start = shell.querySelector('#ob-start');
  const act = shell.querySelector('#ob-activate');
  const code = shell.querySelector('#ob-code');
  if (start) {
    start.onclick = async () => {
      await License.startTrial(db);
      await refresh();
      go('today');
    };
  }
  if (act) {
    act.onclick = async () => {
      const ok = await License.activateWithCode(db, code.value);
      if (!ok) {
        toast('Неверный код доступа');
        return;
      }
      await refresh();
      toast('Активировано');
      go('today');
    };
  }
}

function renderLock() {
  return `<div class="lock-screen">
    <h1 style="text-align:center">Демо-период закончился</h1>
    <p class="muted" style="text-align:center;margin-top:14px;line-height:1.45">Чтобы продолжить работу, введите код доступа. Ваши данные сохранены на устройстве.</p>
    ${htmlDemoTelegramHint({ centered: true })}
    <label class="label" for="lk-code" style="margin-top:14px">Код доступа</label>
    <input class="field" id="lk-code" placeholder="Введите код доступа" autocomplete="off" />
    <button type="button" class="btn btn-primary" id="lk-btn" style="width:100%;margin-top:10px">Активировать</button>
    <button type="button" class="btn btn-secondary" id="lk-export" style="width:100%;margin-top:10px">Выгрузить данные</button>
  </div>`;
}

export function attachLock(shell, db, go, refresh) {
  const btn = shell.querySelector('#lk-btn');
  const code = shell.querySelector('#lk-code');
  if (btn) {
    btn.onclick = async () => {
      const ok = await License.activateWithCode(db, code.value);
      if (!ok) {
        toast('Неверный код доступа');
        return;
      }
      await refresh();
      go('today');
    };
  }
  shell.querySelector('#lk-export')?.addEventListener('click', async () => {
    try {
      await downloadDbBackupJson(db);
    } catch (e) {
      console.error(e);
      toast('Не удалось выгрузить данные');
    }
  });
}

async function renderToday(db, meta, go) {
  const t = F.todayISO();
  const [appointments, clients] = await Promise.all([
    db.listAppointments(),
    db.listClients(),
  ]);
  const day = appointments.filter((a) => a.date === t);
  const staleOpen = appointments
    .filter(
      (a) =>
        String(a.date || '') < t &&
        a.status !== 'done' &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show'
    )
    .sort((a, b) => {
      const da = `${a.date || ''} ${a.time || ''}`;
      const dbi = `${b.date || ''} ${b.time || ''}`;
      return da.localeCompare(dbi);
    });
  const dayForLoad = day.filter((a) => a.status !== 'cancelled');
  const name = (await db.getMeta('masterName')) || 'Мастер';
  const doneToday = day.filter((a) => a.status === 'done');
  const rev = doneToday.reduce((s, a) => s + (Number(a.receivedRub) || 0), 0);
  const profit = doneToday.reduce((s, a) => s + (Number(a.profitRub) || 0), 0);
  const matCost = doneToday.reduce((s, a) => s + appointmentTotalCogs(a), 0);
  const plannedMinDay = dayForLoad.reduce((s, a) => s + (Number(a.plannedMinutes) || 0), 0);

  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const nowMs = Date.now();
  const timedRows = dayForLoad
    .map((a) => {
      const w = F.appointmentWindowMs(a.date, a.time, a.plannedMinutes);
      if (!w) return null;
      return { a, startMs: w.startMs, endMs: w.endMs };
    })
    .filter(Boolean);

  let nextScheduleLine = '';
  if (!dayForLoad.length) {
    nextScheduleLine = '<p class="status-line" style="margin:10px 0 0;font-size:0.9rem">Нет записей</p>';
  } else {
    const inProgressNow = timedRows.filter(
      ({ a, startMs }) =>
        a.status !== 'done' && a.status !== 'cancelled' && startMs <= nowMs
    );
    inProgressNow.sort((x, y) => x.startMs - y.startMs);

    const futureAppointments = timedRows.filter(
      ({ a, startMs }) =>
        a.status !== 'done' && a.status !== 'cancelled' && startMs > nowMs
    );
    futureAppointments.sort((x, y) => x.startMs - y.startMs);

    if (inProgressNow.length) {
      const { a, endMs } = inProgressNow[0];
      const cName = clientMap[a.clientId]?.name || 'Клиент';
      const until = F.msToClockHHMM(endMs);
      const timeTail =
        nowMs <= endMs ? ` (до ${esc(until)})` : '';
      nextScheduleLine = `<p class="status-line" style="margin:10px 0 0;font-size:0.9rem;font-weight:600;color:var(--accent)">Сейчас: ${esc(cName)}${timeTail}</p>`;
    } else if (futureAppointments.length) {
      const hh = F.clockHHMM(futureAppointments[0].a.time);
      nextScheduleLine = `<p class="status-line" style="margin:10px 0 0;font-size:0.9rem">Следующая: ${esc(hh)}</p>`;
    } else {
      const hasIncomplete = dayForLoad.some(
        (a) => a.status !== 'done' && a.status !== 'cancelled'
      );
      if (!hasIncomplete) {
        nextScheduleLine =
          '<p class="status-line" style="margin:10px 0 0;font-size:0.9rem">На сегодня всё выполнено</p>';
      } else {
        nextScheduleLine = '';
      }
    }
  }

  const sorted = [...day].sort((a, b) => {
    const ma = F.timeHHMMToMinutes(a.time);
    const mb = F.timeHHMMToMinutes(b.time);
    if (ma != null && mb != null) return ma - mb;
    return (a.time || '').localeCompare(b.time || '');
  });

  const trialLeft = License.isActivated(meta)
    ? null
    : License.trialDaysLeft(meta);

  const staleBlock = staleOpen.length
    ? `<h2 style="margin:20px 0 10px;font-size:1rem">Незакрытые записи</h2>
      <div class="list-gap">
        ${staleOpen
          .map((a) => {
            const c = clientMap[a.clientId];
            const whenLine = `${esc(F.formatDateRu(a.date))} · ${esc(F.formatTime(a.time))}`;
            const clientLine = esc(String(c?.name || 'Клиент').trim() || 'Клиент');
            const svc = esc(String(a.serviceNameSnapshot || '').trim());
            const price = F.money(Number(a.priceRub) || 0);
            const diff = a.difficulty || '—';
            return `<article class="card record-card" data-open="${a.id}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div>
                  <div style="font-weight:700">${whenLine}</div>
                  <div class="status-line">${clientLine}</div>
                </div>
                <div class="record-card__head-actions">
                  <span class="${F.appointmentBadgeClass(a, nowMs)}">${esc(F.appointmentStatusLabel(a, nowMs))}</span>
                </div>
              </div>
              <div style="margin-top:8px;font-weight:600">${svc}</div>
              <div class="status-line">${price} · сложн. ${diff}</div>
              <div class="record-card__appt-actions">
                <button type="button" class="btn btn-secondary" style="padding:10px" data-edit="${a.id}">Редактировать</button>
                <button type="button" class="btn btn-primary" style="padding:10px" data-done="${a.id}">Завершить</button>
                ${
                  appointmentCanReschedule(a)
                    ? `<div class="record-card__appt-actions-row">
                        <button type="button" class="btn btn-secondary" data-reschedule-appt="${a.id}">Перенести</button>
                        <button type="button" class="btn btn-secondary" data-cancel-appt="${a.id}">Отменить</button>
                      </div>`
                    : ''
                }
              </div>
            </article>`;
          })
          .join('')}
      </div>`
    : '';

  const cards = sorted.length
    ? sorted
        .map((a) => {
          const c = clientMap[a.clientId];
          const visits = appointments.filter((x) => x.clientId === a.clientId).length;
          const star = visits > 1 ? '<span class="badge" title="Повторный">⭐</span>' : '';
          return `<article class="card record-card" data-open="${a.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div><strong>${esc(F.formatTime(a.time))}</strong> · ${esc(c?.name || 'Клиент')} ${star}</div>
            <div class="record-card__head-actions">
              <span class="${F.appointmentBadgeClass(a, nowMs)}">${esc(F.appointmentStatusLabel(a, nowMs))}</span>
              <button type="button" class="appt-delete-btn" data-delete-appt="${a.id}" data-appt-done="${
                appointmentRowIsFinished(a) ? '1' : '0'
              }" title="Удалить запись" aria-label="Удалить запись"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
            </div>
          </div>
          <div style="margin-top:6px;font-weight:600">${esc(a.serviceNameSnapshot || '')}</div>
          <div class="status-line">План: ${esc(F.minutesToLabel(a.plannedMinutes))} · Сложн.: ${a.difficulty || '—'}</div>
          ${
            a.status === 'scheduled'
              ? `<div class="record-card__appt-actions">
              <button type="button" class="btn btn-secondary" style="padding:10px" data-edit="${a.id}">Редактировать</button>
              <button type="button" class="btn btn-primary" style="padding:10px" data-done="${a.id}">Завершить</button>
              ${
                appointmentCanReschedule(a)
                  ? `<div class="record-card__appt-actions-row">
                      <button type="button" class="btn btn-secondary" data-reschedule-appt="${a.id}">Перенести</button>
                      <button type="button" class="btn btn-secondary" data-cancel-appt="${a.id}">Отменить</button>
                    </div>`
                  : ''
              }
            </div>`
              : a.status === 'done'
                ? `<div class="status-line">Оплачено: ${F.money(a.receivedRub || 0)} · Прибыль: ${F.money(a.profitRub || 0)}</div>
                  <div class="record-card__appt-actions">
                    <button type="button" class="btn btn-secondary" style="padding:10px" data-edit="${a.id}">Редактировать</button>
                  </div>`
                : ''
          }
        </article>`;
        })
        .join('')
    : `<div class="empty-hint">На сегодня записей нет.<br />Добавьте первую запись.</div>`;

  const reminders = appointments
    .filter((a) => {
      const rd = appointmentDateKeyIso(a.reminderDate);
      return !!rd && rd <= t && a.reminderDone !== true;
    })
    .sort((a, b) => {
      const da = appointmentDateKeyIso(a.reminderDate);
      const dbi = appointmentDateKeyIso(b.reminderDate);
      const byDate = da.localeCompare(dbi, 'ru');
      if (byDate !== 0) return byDate;
      const ma = F.timeHHMMToMinutes(a.time);
      const mb = F.timeHHMMToMinutes(b.time);
      if (ma != null && mb != null) return ma - mb;
      return String(a.time || '').localeCompare(String(b.time || ''), 'ru');
    });
  const remindersBlock = reminders.length
    ? `<div class="card" style="margin-top:16px">
      <div class="card-title">Напоминания</div>
      <div class="list-gap">
        ${reminders
          .map((a) => {
            const c = clientMap[a.clientId];
            const cname = String(c?.name || 'Клиент').trim() || 'Клиент';
            const cphone = String(c?.phone || '').trim();
            const clientLine = cphone ? `${esc(cname)} · ${esc(cphone)}` : esc(cname);
            const service = esc(String(a.serviceNameSnapshot || 'Услуга').trim() || 'Услуга');
            const wearUntil = appointmentDateKeyIso(a.wearUntilDate);
            const reminder = appointmentDateKeyIso(a.reminderDate);
            const wearLine = wearUntil ? F.formatDateISO(wearUntil) : '—';
            const remindLine = reminder && reminder < t ? 'Напоминание просрочено' : 'сегодня';
            const comment = String(a.reminderComment || '').trim();
            return `<article class="card compact" style="margin-bottom:8px">
              <div style="font-weight:700">${clientLine}</div>
              <div class="status-line" style="margin-top:4px">${service}</div>
              <div class="status-line">Расплет примерно: ${esc(wearLine)}</div>
              <div class="status-line">Напомнить: ${esc(remindLine)}</div>
              ${comment ? `<div class="status-line">Комментарий: ${esc(comment)}</div>` : ''}
              <div style="margin-top:8px">
                <button type="button" class="btn btn-secondary btn-reschedule" data-reminder-done="${a.id}">Связалась</button>
              </div>
            </article>`;
          })
          .join('')}
      </div>
    </div>`
    : '';

  const serviceBlock = `<div class="card svc-data-card" style="margin-top:20px">${htmlDataBackupCard()}</div>`;

  return `<header class="page-header">
    <div>
      <h1>Привет, ${esc(name)}</h1>
      <p class="sub">${esc(F.formatDateRu(t))}</p>
    </div>
    <button type="button" class="icon-btn" id="open-settings" aria-label="Настройки">⚙️</button>
  </header>
  ${
    trialLeft != null
      ? `<div class="trial-pill trial-pill--active-demo" style="display:block;white-space:normal;line-height:1.35;text-align:center">
    Демо-версия: осталось ${trialLeft} дн.
    <div class="trial-pill__telegram" style="margin-top:5px;font-size:0.78rem;font-weight:500;line-height:1.4;opacity:0.95">
      Хотите оставить CRM себе? Напишите в Telegram:
      <a href="https://t.me/tnatalina" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-underline-offset:2px">@tnatalina</a>
    </div>
  </div>`
      : ''
  }
  <div class="content">
    <div class="card">
      <div class="card-title">Сегодня</div>
      <p class="stat-big">${day.length} ${pluralizeRecords(day.length)}</p>
      <div class="stat-grid">
        <div class="card compact">
          <div class="card-title">Доход</div>
          <p class="stat-big" style="font-size:1.25rem">${F.money(rev)}</p>
        </div>
        <div class="card compact">
          <div class="card-title">Прибыль</div>
          <p class="stat-big" style="font-size:1.25rem">${F.money(profit)}</p>
        </div>
      </div>
      <div class="stat-grid">
        <div class="card compact">
          <div class="card-title">Себестоимость</div>
          <p class="stat-big" style="font-size:1.1rem">${F.money(matCost)}</p>
        </div>
        <div class="card compact">
          <div class="card-title">Загруженность</div>
          <p class="stat-big" style="font-size:1.1rem">${F.minutesToLabel(plannedMinDay)}</p>
          ${nextScheduleLine}
        </div>
      </div>
    </div>
    <button type="button" class="btn btn-primary" id="btn-new-appt">＋ Новая запись</button>
    ${remindersBlock}
    ${staleBlock}
    <h2 style="margin:20px 0 10px;font-size:1rem">Записи на сегодня</h2>
    <div class="list-gap">${cards}</div>
    ${serviceBlock}
  </div>`;
}

function attachAppointmentDeleteButtons(root, db, go, refresh) {
  root.querySelectorAll('[data-delete-appt]').forEach((btn) => {
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-delete-appt'));
        if (!id) return;
        const msg =
          'Удалить запись?\nЗапись исчезнет из списка. Клиент, услуги и материалы останутся.';
        void (async () => {
          const ok = await confirmDialog(msg, {
            leftLabel: 'Отмена',
            rightLabel: 'Удалить',
            focusLeft: true,
          });
          if (!ok) return;
          try {
            await db.deleteAppointment(id);
            await refresh();
            const cur = (location.hash.slice(1) || 'today').split('?')[0];
            go(cur);
          } catch (err) {
            console.error(err);
            toast('Не удалось удалить запись.');
          }
        })();
      },
      true
    );
  });
}

function openRescheduleAppointmentModal(ap, db, refresh, go) {
  const dateVal = String(ap.date || F.todayISO()).split('T')[0].trim() || F.todayISO();
  const tp = F.timeToHourAndQuarter(ap.time);
  const hourOpts = Array.from({ length: 24 }, (_, i) => {
    const sel = i === tp.hours ? ' selected' : '';
    return `<option value="${i}"${sel}>${String(i).padStart(2, '0')}</option>`;
  }).join('');
  const minuteOpts = [0, 15, 30, 45]
    .map((v) => {
      const sel = v === tp.quarterMin ? ' selected' : '';
      return `<option value="${v}"${sel}>${String(v).padStart(2, '0')}</option>`;
    })
    .join('');

  const wrap = document.createElement('div');
  wrap.className = 'mat-pick-sheet is-open';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'rs-modal-title');
  wrap.innerHTML = `
    <div class="mat-pick-sheet-inner card" style="max-width: 420px; margin: auto 0; background: var(--card)">
      <div class="mat-pick-head">
        <h2 id="rs-modal-title" style="margin: 0; font-size: 1.15rem">Перенос записи</h2>
      </div>
      <label class="label" for="rs-date">Новая дата</label>
      <div class="date-overlay">
        <input class="field date-overlay__ui" id="rs-date-ui" type="text" readonly value="${esc(
          F.formatDateRu(dateVal)
        )}" />
        <input class="field date-overlay__native" id="rs-date" type="date" value="${esc(
          dateVal
        )}" aria-label="Новая дата" />
      </div>
      <p class="card-title" style="margin-top: 14px">Новое время</p>
      <p class="muted" style="font-size: 0.84rem; margin: 0 0 10px; line-height: 1.4">Часы 00–23, минуты: 00, 15, 30 или 45.</p>
      <div class="row" style="align-items: flex-end">
        <div style="flex: 1">
          <label class="label" for="rs-th">Часы</label>
          <select class="field" id="rs-th">${hourOpts}</select>
        </div>
        <div style="flex: 1">
          <label class="label" for="rs-tm">Минуты</label>
          <select class="field" id="rs-tm">${minuteOpts}</select>
        </div>
      </div>
      <div class="card compact" style="margin-top: 12px">
        <div class="card-title" style="font-size: 0.95rem">Занято в этот день</div>
        <div id="rs-busy-slots-body"></div>
      </div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px">
        <button type="button" class="btn btn-secondary" data-rs-cancel style="flex: 1; min-width: 120px">Отмена</button>
        <button type="button" class="btn btn-primary" data-rs-save style="flex: 1; min-width: 120px">Сохранить перенос</button>
      </div>
    </div>
  `;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    wrap.remove();
  };

  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };

  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  const rsDateInput = wrap.querySelector('#rs-date');
  const rsDateUi = wrap.querySelector('#rs-date-ui');
  const rsBusyBody = wrap.querySelector('#rs-busy-slots-body');
  wrap.querySelector('.date-overlay')?.addEventListener('click', () => {
    try {
      rsDateInput?.showPicker?.();
    } catch {}
    rsDateInput?.focus?.();
  });
  const reloadRsBusy = async () => {
    const dk = appointmentDateKeyIso(rsDateInput?.value || dateVal);
    if (rsDateUi) rsDateUi.value = F.formatDateRu(dk);
    if (rsBusyBody) rsBusyBody.innerHTML = await htmlBusyDaySlotsBody(db, dk, ap.id);
  };
  rsDateInput?.addEventListener('change', () => {
    void reloadRsBusy();
  });

  wrap.querySelector('[data-rs-cancel]')?.addEventListener('click', close);
  wrap.querySelector('[data-rs-save]')?.addEventListener('click', async () => {
    const dateStr = wrap.querySelector('#rs-date')?.value?.trim() || '';
    const timeStr = F.hourMinuteToHHMM(
      wrap.querySelector('#rs-th')?.value,
      wrap.querySelector('#rs-tm')?.value
    );
    if (!dateStr) {
      toast('Укажите дату.');
      return;
    }
    const fresh = await db.getAppointment(Number(ap.id));
    if (!fresh || !appointmentCanReschedule(fresh)) {
      toast('Запись больше нельзя перенести.');
      close();
      await refresh();
      const cur = (location.hash.slice(1) || 'today').split('?')[0];
      go(cur);
      return;
    }
    if (F.isAppointmentStartInPastToday(dateStr, timeStr)) {
      toast('Вы выбрали время, которое уже прошло. Измените время записи.');
      return;
    }
    const candidate = { ...fresh, date: dateStr, time: timeStr };
    const existing = await db.listAppointments();
    const conflictRow = pickConflictRowWithLatestEnd(candidate, existing, fresh.id);
    if (conflictRow) {
      toastOverlapFromConflictRow(conflictRow);
      return;
    }
    await db.putAppointment({ ...fresh, date: dateStr, time: timeStr });
    close();
    await refresh();
    const cur = (location.hash.slice(1) || 'today').split('?')[0];
    go(cur);
    toast('Запись перенесена.');
  });

  document.body.appendChild(wrap);
  void reloadRsBusy();
  requestAnimationFrame(() => wrap.querySelector('#rs-date')?.focus());
}

function attachRescheduleButtons(root, db, go, refresh) {
  root.querySelectorAll('[data-reschedule-appt]').forEach((btn) => {
    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-reschedule-appt'));
        if (!id) return;
        void (async () => {
          const row = await db.getAppointment(id);
          if (!row || !appointmentCanReschedule(row)) {
            toast('Запись больше нельзя перенести.');
            return;
          }
          openRescheduleAppointmentModal(row, db, refresh, go);
        })();
      },
      true
    );
  });
}

export function attachToday(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('#open-settings')?.addEventListener('click', () => go('settings'));
  root.querySelector('#btn-new-appt')?.addEventListener('click', () => {
    sessionStorage.removeItem(WIZARD_KEY);
    go('new');
  });
  root.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = el.getAttribute('data-open');
      go(`complete-${id}?from=today`);
    });
  });
  root.querySelectorAll('[data-done]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-done');
      go(`complete-${id}?from=today`);
    });
  });
  root.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionStorage.removeItem(WIZARD_KEY);
      const id = b.getAttribute('data-edit');
      if (!id) return;
      go(`edit-${id}?from=today`);
    });
  });
  root.querySelectorAll('[data-cancel-appt]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.getAttribute('data-cancel-appt'));
      if (!id) return;
      void (async () => {
        const row = await db.getAppointment(id);
        if (!row || !appointmentCanCancel(row)) {
          toast('Эту запись уже нельзя отменить.');
          return;
        }
        const reason = await chooseCancelReasonDialog();
        if (!reason) return;
        if (reason === 'delete') {
          const ok = await confirmDialog('Удалить запись? Это действие нельзя отменить.', {
            leftLabel: 'Отмена',
            rightLabel: 'Удалить',
            focusLeft: true,
          });
          if (!ok) return;
          await db.deleteAppointment(id);
          await refresh();
          go('today');
          return;
        }
        row.status = reason === 'no_show' ? 'no_show' : 'cancelled';
        row.cancelReason = reason;
        row.cancelledAt = new Date().toISOString();
        await db.putAppointment(row);
        await refresh();
        go('today');
      })();
    });
  });
  root.querySelectorAll('[data-reminder-done]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(b.getAttribute('data-reminder-done'));
      if (!id) return;
      const row = await db.getAppointment(id);
      if (!row) return;
      row.reminderDone = true;
      row.reminderDoneAt = new Date().toISOString();
      await db.putAppointment(row);
      await refresh();
      go('today');
    });
  });
  attachAppointmentDeleteButtons(root, db, go, refresh);
  attachRescheduleButtons(root, db, go, refresh);
  attachServiceBlock(root, db, go, refresh);
}

/** Кнопки демо / выгрузки / загрузки данных («Сегодня» и «Настройки»). */
function attachServiceBlock(root, db, go, refresh) {
  root.querySelector('#svc-demo')?.addEventListener('click', async () => {
    const okAsk = await confirmDialog('Демо-данные будут добавлены в базу. Продолжить?');
    if (!okAsk) return;
    try {
      const r = await db.loadDemoPack();
      if (!r.ok && r.reason === 'already_loaded') {
        toast('Тестовые данные уже были добавлены ранее.');
        return;
      }
      await refresh();
      go('today');
      toast('Демо-данные добавлены.');
    } catch (e) {
      console.error(e);
      toast('Не удалось добавить демо.');
    }
  });

  root.querySelector('#svc-demo-purge')?.addEventListener('click', async () => {
    if (!confirm('Удалить только демо-данные? Ваши реальные данные останутся.')) return;
    try {
      await db.purgeDemoPackData();
      await refresh();
      const cur = (location.hash.slice(1) || 'today').split('?')[0];
      go(cur);
      toast('Демо-данные удалены');
    } catch (e) {
      console.error(e);
      toast('Не удалось удалить демо-данные.');
    }
  });

  root.querySelector('#svc-export')?.addEventListener('click', async () => {
    try {
      await downloadDbBackupJson(db);
    } catch (e) {
      console.error(e);
      toast('Не удалось выгрузить данные');
    }
  });

  root.querySelector('#svc-import')?.addEventListener('click', () => {
    document.getElementById('import-file')?.click();
  });
  attachExcelClientButtons(root);
}

async function renderRecords(db, go) {
  const [appointments, clients] = await Promise.all([db.listAppointments(), db.listClients()]);
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const nowMs = Date.now();
  const list = [...appointments].sort((a, b) => {
    const da = `${a.date} ${a.time || ''}`;
    const dbi = `${b.date} ${b.time || ''}`;
    return dbi.localeCompare(da);
  });
  const html = list.length
    ? list
        .map((a) => {
          const c = cmap[a.clientId];
          return `<article class="card record-card" data-rec="${a.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:700">${esc(F.formatDateRu(a.date))} · ${esc(F.formatTime(a.time))}</div>
              <div class="status-line">${esc(c?.name || 'Клиент')}</div>
            </div>
            <div class="record-card__head-actions">
              <span class="${F.appointmentBadgeClass(a, nowMs)}">${esc(F.appointmentStatusLabel(a, nowMs))}</span>
              <button type="button" class="appt-delete-btn" data-delete-appt="${a.id}" data-appt-done="${
                appointmentRowIsFinished(a) ? '1' : '0'
              }" title="Удалить запись" aria-label="Удалить запись"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
            </div>
          </div>
          <div style="margin-top:8px;font-weight:600">${esc(a.serviceNameSnapshot || '')}</div>
          <div class="status-line">${F.money(a.priceRub || 0)} · сложн. ${a.difficulty || '—'}</div>
          ${
            a.status === 'scheduled'
              ? `<div class="record-card__appt-actions" style="margin-top:8px">
                  <button type="button" class="btn btn-secondary" style="padding:10px" data-edit="${a.id}">Редактировать</button>
                  <button type="button" class="btn btn-primary" style="padding:10px" data-done="${a.id}">Завершить</button>
                  ${
                    appointmentCanReschedule(a)
                      ? `<div class="record-card__appt-actions-row">
                          <button type="button" class="btn btn-secondary" data-reschedule-appt="${a.id}">Перенести</button>
                          <button type="button" class="btn btn-secondary" data-cancel-appt="${a.id}">Отменить</button>
                        </div>`
                      : ''
                  }
                </div>`
              : ''
          }
        </article>`;
        })
        .join('')
    : `<div class="empty-hint">Записей пока нет</div>`;

  return `<header class="page-header">
    <div><h1>Записи</h1><p class="sub">Все визиты</p></div>
  </header>
  <div class="content list-gap">${html}</div>`;
}

export function attachRecords(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelectorAll('[data-rec]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      go(`complete-${el.getAttribute('data-rec')}?from=records`);
    });
  });
  root.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionStorage.removeItem(WIZARD_KEY);
      const id = b.getAttribute('data-edit');
      if (!id) return;
      go(`edit-${id}?from=records`);
    });
  });
  root.querySelectorAll('[data-done]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-done');
      if (!id) return;
      go(`complete-${id}?from=records`);
    });
  });
  root.querySelectorAll('[data-cancel-appt]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.getAttribute('data-cancel-appt'));
      if (!id) return;
      void (async () => {
        const row = await db.getAppointment(id);
        if (!row || !appointmentCanCancel(row)) {
          toast('Эту запись уже нельзя отменить.');
          return;
        }
        const reason = await chooseCancelReasonDialog();
        if (!reason) return;
        if (reason === 'delete') {
          const ok = await confirmDialog('Удалить запись? Это действие нельзя отменить.', {
            leftLabel: 'Отмена',
            rightLabel: 'Удалить',
            focusLeft: true,
          });
          if (!ok) return;
          await db.deleteAppointment(id);
          await refresh();
          go('records');
          return;
        }
        row.status = reason === 'no_show' ? 'no_show' : 'cancelled';
        row.cancelReason = reason;
        row.cancelledAt = new Date().toISOString();
        await db.putAppointment(row);
        await refresh();
        go('records');
      })();
    });
  });
  attachAppointmentDeleteButtons(root, db, go, refresh);
  attachRescheduleButtons(root, db, go, refresh);
}

async function renderClients(db, go) {
  const [clients, appointments] = await Promise.all([db.listClients(), db.listAppointments()]);
  const html = clients.length
    ? clients
        .map((c) => {
          const visits = appointments.filter((a) => a.clientId === c.id).length;
          const done = appointments.filter((a) => a.clientId === c.id && a.status === 'done');
          const avg =
            done.length > 0
              ? done.reduce((s, a) => s + (Number(a.receivedRub) || 0), 0) / done.length
              : 0;
          const star = visits > 1 ? '<span class="badge">⭐ Повторный</span>' : '';
          const phoneList = String(c.phone ?? '').trim();
          const phoneShown = phoneList ? esc(F.formatClientPhonePretty(phoneList)) : '—';
          return `<article class="card client-card" data-client="${c.id}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:700">${esc(c.name || 'Без имени')}</div>
            ${star}
          </div>
          <div class="status-line" style="margin-top:8px;line-height:1.35">${phoneShown}</div>
          <div class="status-line">${visits} визитов · средний чек ${F.money(avg)}</div>
        </article>`;
        })
        .join('')
    : `<div class="empty-hint">Клиентов пока нет — добавьте при новой записи.</div>`;

  return `<header class="page-header">
    <div><h1>Клиенты</h1><p class="sub">Карточки и история</p></div>
  </header>
  <div class="content">
    <input type="search" class="field" id="client-filter" placeholder="Поиск по имени или телефону" />
    <div class="list-gap" id="client-list">${html}</div>
  </div>`;
}

export function attachClients(shell, go) {
  const root = shell.querySelector('#app-root') || shell;
  const filter = root.querySelector('#client-filter');
  const list = root.querySelector('#client-list');
  filter?.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    list.querySelectorAll('[data-client]').forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.style.display = !q || text.includes(q) ? '' : 'none';
    });
  });
  list?.querySelectorAll('[data-client]').forEach((el) => {
    el.addEventListener('click', () => go(`client-${el.getAttribute('data-client')}`));
  });
}

async function renderClientDetail(db, id, go) {
  const client = await db.getClient(id);
  if (!client) {
    return `<div class="content"><p class="empty-hint">Клиент не найден</p><button class="btn btn-secondary" type="button" data-back>Назад</button></div>`;
  }
  const appointments = (await db.listAppointments()).filter((a) => a.clientId === Number(id));
  const visits = appointments.length;
  const done = appointments.filter((a) => a.status === 'done');
  const totalPaid = done.reduce((s, a) => s + (Number(a.receivedRub) || 0), 0);
  const avg = done.length ? totalPaid / done.length : 0;
  const star = visits > 1 ? '<span class="badge">⭐ Повторный клиент</span>' : '';

  const hist = [...appointments]
    .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`))
    .slice(0, 12)
    .map((a) => {
      return `<div class="card compact">
      <div style="font-weight:600">${esc(F.formatDateRu(a.date))} · ${esc(a.serviceNameSnapshot || '')}</div>
      <div class="status-line">${F.money(a.receivedRub || a.priceRub || 0)} · прибыль ${F.money(a.profitRub || 0)}</div>
    </div>`;
    })
    .join('');

  return `<div class="content">
    <div class="back-row"><a href="#clients" data-back>← Назад</a></div>
    <div id="cd-view-block">
      <header class="page-header" style="padding-left:0;padding-right:0">
        <div>
          <h1 id="cd-ro-name">${esc(client.name)}</h1>
          <p class="sub">${star}</p>
        </div>
      </header>
      <button type="button" class="btn btn-secondary" style="width:100%;margin-bottom:14px" id="cd-edit-open">Редактировать</button>
      <div style="text-align:right;margin:-8px 0 14px">
        <button type="button" class="appt-delete-btn" id="cd-delete-client" title="Удалить клиента" aria-label="Удалить клиента"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
      </div>
      <div class="card">
        <div class="card-title">Контакты</div>
        <p id="cd-ro-phone" data-raw-phone="${esc(client.phone || '')}" style="margin:0 0 6px">${esc(
          F.formatClientPhonePretty(client.phone) || '—'
        )}</p>
        <p style="margin:0;color:var(--muted);font-size:0.9rem">${esc(client.telegram || '')}</p>
      </div>
      <div class="card">
        <div class="card-title">Статистика</div>
        <p class="status-line">Визитов: ${visits}</p>
        <p class="status-line">Средний чек: ${F.money(avg)}</p>
        <p class="status-line">Всего оплат: ${F.money(totalPaid)}</p>
      </div>
      <div class="card">
        <div class="card-title">Заметки</div>
        <p id="cd-ro-notes" style="margin:0;white-space:pre-wrap">${esc(client.notes || '—')}</p>
      </div>
      <h2 style="font-size:1rem;margin:16px 0 8px">История</h2>
      ${hist || '<p class="muted">Пока нет записей</p>'}
      <button type="button" class="btn btn-primary" style="margin-top:16px" id="cd-new">＋ Новая запись</button>
    </div>
    <div id="cd-edit-panel" hidden>
      <h2 style="font-size:1.15rem;margin:0 0 12px;padding-top:4px">Редактирование клиента</h2>
      <label class="label" for="cd-ed-name">Имя</label>
      <input class="field" id="cd-ed-name" type="text" autocomplete="name" value="${esc(client.name)}" />
      <label class="label" for="cd-ed-phone">Телефон</label>
      <input class="field" id="cd-ed-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Например: 89774720425" value="${esc(
        client.phone || ''
      )}" />
      <p class="muted" style="font-size:0.82rem;margin:-6px 0 10px;line-height:1.4">Введите 11 цифр. Можно писать без пробелов: 89774720425</p>
      <label class="label" for="cd-ed-notes">Заметка</label>
      <textarea class="field" id="cd-ed-notes" rows="4" placeholder="Заметка">${esc(client.notes || '')}</textarea>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-primary" id="cd-ed-save">Сохранить</button>
        <button type="button" class="btn btn-secondary" id="cd-ed-cancel">Отмена</button>
      </div>
    </div>
  </div>`;
}

export function attachClientDetail(shell, db, go, id) {
  const root = shell.querySelector('#app-root') || shell;
  const cid = Number(id);

  const viewBlock = () => root.querySelector('#cd-view-block');
  const editPanel = () => root.querySelector('#cd-edit-panel');

  /** Подставить в форму редактирования то, что сейчас на экране в режиме просмотра. */
  function refillEditFromRenderedCard() {
    const nameEl = root.querySelector('#cd-ed-name');
    const phoneEl = root.querySelector('#cd-ed-phone');
    const notesEl = root.querySelector('#cd-ed-notes');
    const roName = root.querySelector('#cd-ro-name');
    const roPhone = root.querySelector('#cd-ro-phone');
    const roNotes = root.querySelector('#cd-ro-notes');
    if (nameEl && roName) nameEl.value = roName.textContent || '';
    if (phoneEl && roPhone) {
      const raw = String(roPhone.getAttribute('data-raw-phone') ?? '').trim();
      phoneEl.value = raw;
    }
    if (notesEl && roNotes) {
      const t = roNotes.textContent || '';
      notesEl.value = t === '—' ? '' : t;
    }
  }

  const closeEdit = () => {
    editPanel()?.setAttribute('hidden', '');
    viewBlock()?.removeAttribute('hidden');
    refillEditFromRenderedCard();
  };

  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('clients');
  });
  root.querySelector('#cd-new')?.addEventListener('click', () => {
    sessionStorage.setItem(
      WIZARD_KEY,
      JSON.stringify({
        step: 2,
        clientId: cid,
        materialsPlan: [],
        difficulty: 2,
        tags: [],
      })
    );
    go('new');
  });

  root.querySelector('#cd-edit-open')?.addEventListener('click', () => {
    refillEditFromRenderedCard();
    viewBlock()?.setAttribute('hidden', '');
    editPanel()?.removeAttribute('hidden');
  });

  root.querySelector('#cd-delete-client')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Удалить клиента?\nЕсли у клиента есть записи, лучше не удалять его. История визитов может стать неполной.',
      {
      leftLabel: 'Отмена',
      rightLabel: 'Удалить',
      focusLeft: true,
    });
    if (!ok) return;
    try {
      await db.deleteClient(cid);
      toast('Клиент удалён');
      go('clients');
    } catch (err) {
      console.error(err);
      toast('Не удалось удалить клиента');
    }
  });

  root.querySelector('#cd-ed-cancel')?.addEventListener('click', () => {
    closeEdit();
  });

  root.querySelector('#cd-ed-save')?.addEventListener('click', async () => {
    const name = String(root.querySelector('#cd-ed-name')?.value ?? '').trim();
    const phone = String(root.querySelector('#cd-ed-phone')?.value ?? '').trim();
    const notes = String(root.querySelector('#cd-ed-notes')?.value ?? '').trim();
    if (!name) {
      toast('Введите имя клиента.');
      return;
    }
    const ph = F.validateClientPhoneRu(phone);
    if (!ph.ok) {
      toast('Проверьте номер телефона. Для России нужно 11 цифр: например, 8 999 123-45-67.');
      return;
    }
    try {
      await db.updateClient(cid, { name, phone: ph.normalized, notes });
      toast('Сохранено');
      go(`client-${cid}`);
    } catch (err) {
      console.error(err);
      toast('Не удалось сохранить');
    }
  });
}

async function renderMaterials(db, go) {
  const materials = await db.listMaterials();
  const html = materials.length
    ? materials
        .map((m) => {
          const low = Number(m.stock) <= Number(m.minStock);
          return `<article class="card material-card" data-open-material="${m.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div style="font-weight:700">${esc(m.name)}</div>
                ${low ? '<span class="badge warn">Мало</span>' : ''}
              </div>
          <div class="status-line">Тип: ${esc(m.materialType || 'прочее')}</div>
              <div class="status-line">Остаток: ${esc(String(m.stock))} ${esc(unitCodeShort(m.unit || m.baseUnit || 'g'))}</div>
          <div class="status-line">${F.money(m.pricePerUnit)} за ${esc(unitCodePriceLabel(m.baseUnit || m.unit || 'g'))} · мин. ${esc(String(m.minStock))}</div>
              ${
                Number(m.packagePrice) > 0 &&
                (Number(m.packageWeightGrams) > 0 || Number(m.packageQtyPcs) > 0)
                  ? `<div class="status-line">Упаковка: ${F.money(m.packagePrice)} за ${
                      m.unit === 'pcs'
                        ? `${Number(m.packageQtyPcs || 0)} шт`
                        : `${Number(m.packageWeightGrams || 0)} г`
                    }</div>`
                  : ''
              }
              ${m.comment ? `<div class="status-line">Комментарий: ${esc(m.comment)}</div>` : ''}
            </div>
            <button type="button" class="appt-delete-btn" data-del-mat="${m.id}" title="Удалить" aria-label="Удалить"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
          </div>
        </article>`;
        })
        .join('')
    : `<div class="card" style="text-align:center">
      <p class="empty-hint" style="padding:8px 0;margin:0">У вас пока нет материалов</p>
      <button type="button" class="btn btn-primary" id="btn-add-mat-empty">＋ Добавить материал</button>
    </div>`;

  return `<header class="page-header">
    <div><h1>Материалы</h1><p class="sub">Справочник и склад</p></div>
  </header>
  <div class="content">
    <div class="row" style="margin-bottom:12px">
      <button type="button" class="btn btn-secondary" id="btn-purchase">＋ Пополнить склад</button>
    </div>
    <p class="muted" style="margin:-4px 0 14px;font-size:0.88rem;line-height:1.45">Добавляйте материал на склад после покупки. Если позиции ещё нет в справочнике, создайте её прямо при пополнении.</p>
    <button type="button" class="btn btn-secondary" id="btn-cleanup-test-mat">Очистить тестовые материалы</button>
    <div class="list-gap">${html}</div>
  </div>`;
}

export function attachMaterials(shell, db, go) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('#btn-purchase')?.addEventListener('click', () => go('purchase'));
  // Кнопку «Создать материал» скрыли — новый материал создаётся внутри «Пополнить склад».
  root.querySelector('#btn-add-mat-empty')?.addEventListener('click', () => go('purchase'));
  root.querySelectorAll('[data-open-material]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-mat]')) return;
      go(`material-${card.getAttribute('data-open-material')}`);
    });
  });

  root.querySelectorAll('[data-del-mat]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog(
        'Удалить материал?\nЕсли материал уже использовался в списаниях или закупках, он будет скрыт из склада, но история сохранится.',
        {
          leftLabel: 'Отмена',
          rightLabel: 'Удалить',
          focusLeft: true,
        }
      );
      if (!ok) return;
      const id = b.getAttribute('data-del-mat');
      try {
        const r = await db.deleteOrArchiveMaterial(id);
        if (!r.ok) {
          toast('Не удалось удалить');
          return;
        }
        toast(r.archived ? 'Материал в архиве (есть история использования)' : 'Материал удалён');
        go('materials');
      } catch {
        toast('Ошибка при удалении');
      }
    });
  });

  root.querySelector('#btn-cleanup-test-mat')?.addEventListener('click', async () => {
    if (!confirm('Удалить или отправить в архив тестовые: розовый/чёрные/синий канекалон и резинки?')) return;
    try {
      const s = await db.cleanupTestMaterials();
      toast(
        `Готово: удалено ${s.removed}, в архив ${s.archived}`
      );
      go('materials');
    } catch {
      toast('Не удалось очистить');
    }
  });
}

async function renderMaterialDetail(db, id, go) {
  const mat = await db.getMaterial(Number(id));
  if (!mat || mat.isActive === false) {
    return `<div class="content"><p class="empty-hint">Материал не найден</p></div>`;
  }
  const unitCode = mat.baseUnit || mat.unit || 'g';
  return `<div class="content">
    <div class="back-row"><a href="#materials" data-back>← Материалы</a></div>
    <h1 style="margin:0 0 12px;font-size:1.35rem">${esc(mat.name)}</h1>
    <div class="card">
      <div class="status-line">Тип: ${esc(mat.materialType || 'прочее')}</div>
      <div class="status-line">Базовая единица: ${esc(unitCodeLabel(unitCode))}</div>
      <div class="status-line">Остаток: ${esc(String(mat.stock))} ${esc(unitCodeShort(unitCode))}</div>
      <div class="status-line">Текущая цена (${esc(unitCodePriceLabel(unitCode))}): ${F.money(
    mat.pricePerUnit
  )} — после прихода берётся из последней закупки</div>
      <div class="status-line">Минимум: ${esc(String(mat.minStock))} ${esc(unitCodeShort(unitCode))}</div>
      ${
        Number(mat.packagePrice) > 0 &&
        (Number(mat.packageWeightGrams) > 0 || Number(mat.packageQtyPcs) > 0)
          ? `<div class="status-line">Стандартная упаковка (подставляется в приходе): ${F.money(mat.packagePrice)} за ${
              unitCode === 'pcs'
                ? `${Number(mat.packageQtyPcs || 0)} шт`
                : `${Number(mat.packageWeightGrams || 0)} г`
            }</div>`
          : ''
      }
      ${mat.comment ? `<div class="status-line">Комментарий: ${esc(mat.comment)}</div>` : ''}
    </div>
    <button type="button" class="btn btn-primary" id="md-purchase">＋ Пополнить склад</button>
  </div>`;
}

export function attachMaterialDetail(shell, go, id) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('materials');
  });
  root.querySelector('#md-purchase')?.addEventListener('click', () => {
    go(`purchase?materialId=${encodeURIComponent(id)}`);
  });
}

async function renderPurchase(db, go) {
  const materials = await db.listMaterials();
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const preselectedMaterialId = params.get('materialId');
  const hasMaterials = materials.length > 0;
  // (matById зарезервировано под будущие подсказки по выбранному материалу)
  const purchaseFieldLabels = (unitCode) => {
    if (unitCode === 'pcs') {
      return {
        unitLabel: 'штуки',
        unitPriceWord: 'штуку',
        packCountLabel: 'Количество упаковок',
        packSizeLabel: 'Количество в упаковке (шт)',
        packPriceLabel: 'Цена за упаковку',
        stockSuffix: 'шт',
        costSuffix: '₽/шт',
      };
    }
    return {
      unitLabel: 'граммы',
      unitPriceWord: 'грамм',
      packCountLabel: 'Количество пачек',
      packSizeLabel: 'Вес одной пачки (граммы)',
      packPriceLabel: 'Цена за пачку',
      stockSuffix: 'г',
      costSuffix: '₽/г',
    };
  };
  const packSizeDefaultAttr = (m) => {
    if (!m) return 100;
    const u = m.unit || 'g';
    if (u === 'pcs') return Math.max(0, Number(m.packageQtyPcs) || 0) || 100;
    return Math.max(0, Number(m.packageWeightGrams) || 0) || 100;
  };
  const packPriceDefaultAttr = (m) => Math.max(0, Number(m?.packagePrice) || 0);

  const opts = hasMaterials
    ? materials
        .map((m) => {
          const pSize = packSizeDefaultAttr(m);
          const pPrice = packPriceDefaultAttr(m);
          const stk = Math.max(0, Number(m.stock) || 0);
          return `<option value="${m.id}" data-price="${
            Number(m.pricePerUnit) || 0
          }" data-unit="${esc(m.unit || 'g')}" data-pack-price="${pPrice}" data-pack-size="${pSize}" data-stock="${stk}" ${
            preselectedMaterialId && String(m.id) === String(preselectedMaterialId) ? 'selected' : ''
          }>${esc(m.name)}</option>`;
        })
        .join('')
    : '';
  const selectedMat =
    materials.find((m) => String(m.id) === String(preselectedMaterialId)) || null;
  /** В режиме «новый материал» стартуем с граммовых подписей. */
  const firstPrice = Number(selectedMat?.pricePerUnit) || 0;
  const firstUnit = hasMaterials ? selectedMat?.unit || 'g' : 'g';
  const firstLabels = purchaseFieldLabels(firstUnit);
  const defaultPackSize = hasMaterials ? packSizeDefaultAttr(selectedMat) : 100;
  const defaultPacks = 1;
  const firstPricePerPack = hasMaterials ? packPriceDefaultAttr(selectedMat) : 0;
  const preOk = !!(hasMaterials && preselectedMaterialId);
  const packsStartEnabled = !hasMaterials || !!preOk;
  const unitLineHtml = !hasMaterials
    ? `Новый материал · учёт в: ${esc(firstLabels.unitLabel)}`
    : preselectedMaterialId
      ? `Учёт ведётся в: ${esc(firstLabels.unitLabel)}`
      : 'Выберите материал';
  const priceLineHtml = !hasMaterials
    ? 'Укажите партию — цена списания посчитается автоматически'
    : preselectedMaterialId
      ? `Последняя закупка: ${F.money(firstPrice)} за ${esc(firstLabels.unitPriceWord)}`
      : 'Сначала выберите материал';
  const overrideDisp = packsStartEnabled && hasMaterials ? '' : 'none';
  const pmNewTypeOptions = PM_PURCHASE_NEW_MATERIAL_TYPES.map(
    ([val, lab]) => `<option value="${esc(val)}">${esc(lab)}</option>`
  ).join('');
  return `<div class="content" id="pm-page-root" data-pm-has-mats="${hasMaterials ? '1' : '0'}">
    <div class="back-row"><a href="#materials" data-back>← Материалы</a></div>
    <h1 style="margin:0 0 16px;font-size:1.35rem">Пополнение склада</h1>
    <p class="muted" style="margin:-4px 0 12px;line-height:1.45">Добавьте закупку материала на склад. Можно выбрать материал из списка или сразу создать новый.</p>
    ${
      hasMaterials
        ? `<div class="card compact pm-mode-card" id="pm-mode-wrap">
      <div class="card-title" style="margin-bottom:2px">Способ добавления материала</div>
      <div class="pm-mode-tabs" role="tablist" aria-label="Способ добавления материала">
        <div class="pm-pick-tab">
          <button type="button" role="tab" class="pm-mode-tab is-active" id="pm-tab-existing" aria-selected="true">Выбрать из списка ▾</button>
          <select class="field pm-pick-tab__native" id="pm-m" aria-label="Материал">
            ${
              preselectedMaterialId
                ? ''
                : '<option value="" selected disabled>Выберите материал</option>'
            }
            ${opts}
          </select>
        </div>
        <button type="button" role="tab" class="pm-mode-tab" id="pm-tab-new" aria-selected="false">+ Новый материал</button>
      </div>
    </div>`
        : ''
    }
    <div id="pm-existing-block" ${!hasMaterials ? 'hidden' : ''}>
      <div class="card compact" id="pm-m-summary" style="display:none;margin-top:0">
        <div class="card-title" style="margin-bottom:6px">Выбранный материал</div>
        <div class="status-line" id="pm-m-summary-name">—</div>
        <div class="status-line" id="pm-m-summary-meta">—</div>
      </div>
    </div>
    <div id="pm-new-block" ${hasMaterials ? 'hidden' : ''}>
      <label class="label" for="pm-new-type">Тип материала</label>
      <select class="field" id="pm-new-type">
        <option value="" selected disabled>Выберите тип</option>
        ${pmNewTypeOptions}
      </select>
      <label class="label" for="pm-new-series">Название / серия</label>
      <input class="field" id="pm-new-series" type="text" autocomplete="off" placeholder="Например: Неон, Омбре, Премиум" />
      <label class="label" for="pm-new-color">Цвет / номер оттенка</label>
      <input class="field" id="pm-new-color" type="text" autocomplete="off" placeholder="Например: 2365, 1B или розовый (необязательно)" />
      <label class="label" for="pm-new-unit">Единица списания</label>
      <select class="field" id="pm-new-unit">
        <option value="g">граммы</option>
        <option value="pcs">штуки</option>
      </select>
      <hr class="soft" style="margin:16px 0" />
    </div>
    <p class="status-line" id="pm-unit-line">${unitLineHtml}</p>
    <p class="status-line" id="pm-price-line">${priceLineHtml}</p>

    <div class="card compact" id="pm-override-row" style="margin-bottom:14px;display:${overrideDisp}">
      <label class="checkbox-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:500">
        <input type="checkbox" id="pm-pack-override" ${preOk ? '' : 'disabled'} />
        Параметры закупки отличаются
      </label>
      <p class="status-line" style="margin:8px 0 0">Можно изменить размер и цену упаковки именно этой партии (в карточке останутся стандартные значения).</p>
    </div>

    <div id="pm-packs-block">
      <label class="label" id="pm-pack-count-label" for="pm-pack-count">${esc(firstLabels.packCountLabel)}</label>
      <input class="field" id="pm-pack-count" type="number" inputmode="decimal" min="0" step="1" value="${defaultPacks}" ${packsStartEnabled ? '' : 'disabled'} />
      <label class="label" id="pm-pack-size-label" for="pm-pack-weight">${esc(firstLabels.packSizeLabel)}</label>
      <input class="field" id="pm-pack-weight" type="number" inputmode="decimal" min="0" step="1" value="${defaultPackSize}" ${packsStartEnabled ? '' : 'disabled'} />
      <label class="label" id="pm-pack-price-label" for="pm-pack-price">${esc(firstLabels.packPriceLabel)}</label>
      <input class="field" id="pm-pack-price" type="number" inputmode="decimal" min="0" step="1" value="${Math.round(firstPricePerPack)}" ${packsStartEnabled ? '' : 'disabled'} />
    </div>

    <div class="card compact">
      <div class="card-title">Автоматический расчёт</div>
      <p class="status-line">Итого на склад: <strong id="pm-total-grams">${Math.round(Number(defaultPacks) * Number(defaultPackSize)) || defaultPackSize}</strong> <span id="pm-stock-unit-suffix">${esc(firstLabels.stockSuffix)}</span></p>
      <p class="status-line">Цена списания: <strong id="pm-price-per-gram">${F.money(hasMaterials ? firstPrice : 0)}</strong> <span id="pm-cost-unit-suffix">${esc(firstLabels.costSuffix)}</span></p>
    </div>

    <label class="label" for="pm-s">Поставщик</label>
    <input class="field" id="pm-s" placeholder="Например: WB" />
    <label class="label" for="pm-d">Дата</label>
    <div class="date-overlay" id="pm-date-wrap">
      <input class="field date-overlay__ui" id="pm-d-ui" type="text" readonly value="${esc(
        F.formatDateRu(F.todayISO())
      )}" />
      <input class="field date-overlay__native" id="pm-d" type="date" value="${F.todayISO()}" aria-label="Дата" />
    </div>
    <label class="label" for="pm-n">Комментарий</label>
    <textarea class="field" id="pm-n" placeholder="Необязательно"></textarea>
    <button type="button" class="btn btn-primary" id="pm-save" ${packsStartEnabled ? '' : 'disabled'}>Сохранить приход</button>
  </div>`;
}

export function attachPurchase(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('materials');
  });
  root.querySelector('#pm-go-add')?.addEventListener('click', () => go('add-material'));

  const hasMaterials =
    root.querySelector('#pm-page-root')?.getAttribute('data-pm-has-mats') === '1';
  const existingBlock = root.querySelector('#pm-existing-block');
  const newBlock = root.querySelector('#pm-new-block');

  const matSelect = root.querySelector('#pm-m');
  const newUnitEl = root.querySelector('#pm-new-unit');

  const matSummary = root.querySelector('#pm-m-summary');
  const matSummaryName = root.querySelector('#pm-m-summary-name');
  const matSummaryMeta = root.querySelector('#pm-m-summary-meta');

  const isNewMaterialMode = () => !!(newBlock && !newBlock.hidden);

  const unitLine = root.querySelector('#pm-unit-line');
  const priceLine = root.querySelector('#pm-price-line');
  const totalGramsEl = root.querySelector('#pm-total-grams');
  const pricePerGramEl = root.querySelector('#pm-price-per-gram');
  const stockUnitSuffixEl = root.querySelector('#pm-stock-unit-suffix');
  const costUnitSuffixEl = root.querySelector('#pm-cost-unit-suffix');
  const packCountLabelEl = root.querySelector('#pm-pack-count-label');
  const packCountEl = root.querySelector('#pm-pack-count');
  const packWeightEl = root.querySelector('#pm-pack-weight');
  const packSizeLabelEl = root.querySelector('#pm-pack-size-label');
  const packPriceEl = root.querySelector('#pm-pack-price');
  const saveBtn = root.querySelector('#pm-save');
  const overrideRow = root.querySelector('#pm-override-row');
  const overrideChk = root.querySelector('#pm-pack-override');
  const packPriceLabelEl = root.querySelector('#pm-pack-price-label');

  const pmDateWrap = root.querySelector('#pm-date-wrap');
  const pmDateEl = root.querySelector('#pm-d');
  const pmDateUi = root.querySelector('#pm-d-ui');

  pmDateWrap?.addEventListener('click', () => {
    try {
      pmDateEl?.showPicker?.();
    } catch {}
    pmDateEl?.focus?.();
  });
  pmDateEl?.addEventListener('change', () => {
    const v = String(pmDateEl?.value ?? '').trim();
    if (pmDateUi) pmDateUi.value = F.formatDateRu(v);
  });

  const purchaseFieldLabels = (unitCode) => {
    if (unitCode === 'pcs') {
      return {
        unitLabel: 'штуки',
        unitPriceWord: 'штуку',
        packCountLabel: 'Количество упаковок',
        packSizeLabel: 'Количество в упаковке (шт)',
        packPriceLabel: 'Цена за упаковку',
        stockSuffix: 'шт',
        costSuffix: '₽/шт',
      };
    }
    return {
      unitLabel: 'граммы',
      unitPriceWord: 'грамм',
      packCountLabel: 'Количество пачек',
      packSizeLabel: 'Вес одной пачки (граммы)',
      packPriceLabel: 'Цена за пачку',
      stockSuffix: 'г',
      costSuffix: '₽/г',
    };
  };

  const formInputsCore = [packCountEl];

  /** Количество и цена в базовых ед.: г или шт (из ввода по пачкам/упаковкам) */
  const recalcPurchaseTotals = () => {
    const packsIn = Math.max(0, Number(packCountEl?.value) || 0);
    const sizeOnePack = Math.max(0, Number(packWeightEl?.value) || 0);
    const priceOnePack = Math.max(0, Number(packPriceEl?.value) || 0);
    const qtyBase = packsIn * sizeOnePack;
    const unitPriceBase = sizeOnePack > 0 ? priceOnePack / sizeOnePack : 0;
    if (totalGramsEl) totalGramsEl.textContent = String(Math.round(qtyBase));
    if (pricePerGramEl) pricePerGramEl.textContent = F.money(unitPriceBase);
  };

  const applyPurchaseOverrideUI = () => {
    if (isNewMaterialMode()) {
      if (overrideRow) overrideRow.style.display = 'none';
      if (overrideChk) {
        overrideChk.disabled = true;
        overrideChk.checked = false;
      }
      if (packWeightEl) packWeightEl.disabled = false;
      if (packPriceEl) packPriceEl.disabled = false;
      return;
    }
    const opt = matSelect?.selectedOptions?.[0];
    const chosen = !!(opt?.value);
    if (overrideRow) overrideRow.style.display = chosen ? '' : 'none';
    if (!chosen) {
      if (overrideChk) {
        overrideChk.disabled = true;
        overrideChk.checked = false;
      }
      if (packWeightEl) packWeightEl.disabled = true;
      if (packPriceEl) packPriceEl.disabled = true;
      return;
    }
    if (overrideChk) overrideChk.disabled = false;
    const allowEditPack = !!overrideChk?.checked;
    if (packWeightEl) packWeightEl.disabled = !allowEditPack;
    if (packPriceEl) packPriceEl.disabled = !allowEditPack;
  };

  const syncPackFieldsFromMaterialOption = () => {
    const opt = matSelect?.selectedOptions?.[0];
    if (!opt?.value || !overrideChk || overrideChk.checked) return;
    const psRaw = Number(opt.getAttribute('data-pack-size'));
    const ps = Number.isFinite(psRaw) && psRaw > 0 ? psRaw : 100;
    const pp = Math.max(0, Number(opt.getAttribute('data-pack-price')) || 0);
    if (packWeightEl) packWeightEl.value = String(ps);
    if (packPriceEl) packPriceEl.value = String(Math.round(pp));
  };

  const setMaterialChosenState = (chosen) => {
    if (isNewMaterialMode()) {
      if (saveBtn) saveBtn.disabled = false;
      for (const el of formInputsCore) {
        if (!el) continue;
        if ('disabled' in el) el.disabled = false;
      }
      applyPurchaseOverrideUI();
      recalcPurchaseTotals();
      return;
    }
    if (saveBtn) saveBtn.disabled = !chosen;
    for (const el of formInputsCore) {
      if (!el) continue;
      if ('disabled' in el) el.disabled = !chosen;
    }
    applyPurchaseOverrideUI();
    if (!chosen) {
      if (overrideRow) overrideRow.style.display = 'none';
      if (unitLine) unitLine.textContent = 'Выберите материал';
      if (priceLine) priceLine.textContent = 'Сначала выберите материал';
    }
  };

  const syncNewMaterialLabelsFromUnit = () => {
    const unit = newUnitEl?.value === 'pcs' ? 'pcs' : 'g';
    const labels = purchaseFieldLabels(unit);
    if (unitLine) unitLine.textContent = `Новый материал · учёт в: ${labels.unitLabel}`;
    if (priceLine)
      priceLine.textContent = 'Укажите партию — цена списания посчитается автоматически';
    if (packSizeLabelEl) packSizeLabelEl.textContent = labels.packSizeLabel;
    if (packCountLabelEl) packCountLabelEl.textContent = labels.packCountLabel;
    if (packPriceLabelEl) packPriceLabelEl.textContent = labels.packPriceLabel;
    if (stockUnitSuffixEl) stockUnitSuffixEl.textContent = labels.stockSuffix;
    if (costUnitSuffixEl) costUnitSuffixEl.textContent = labels.costSuffix;
  };

  const syncMaterialMeta = () => {
    if (!hasMaterials || isNewMaterialMode()) return;
    const opt = matSelect?.selectedOptions?.[0];
    if (!opt || !opt.value) {
      setMaterialChosenState(false);
      if (matSummary) matSummary.style.display = 'none';
      return;
    }
    setMaterialChosenState(true);
    const unit = opt.getAttribute('data-unit') || 'g';
    const labels = purchaseFieldLabels(unit);
    const price = Number(opt.getAttribute('data-price')) || 0;
    if (overrideChk) overrideChk.checked = false;
    if (packSizeLabelEl) packSizeLabelEl.textContent = labels.packSizeLabel;
    if (packCountLabelEl) packCountLabelEl.textContent = labels.packCountLabel;
    if (unitLine) unitLine.textContent = `Учёт ведётся в: ${labels.unitLabel}`;
    if (priceLine)
      priceLine.textContent = `Последняя закупка: ${F.money(price)} за ${labels.unitPriceWord}`;
    if (packPriceLabelEl) packPriceLabelEl.textContent = labels.packPriceLabel;
    if (stockUnitSuffixEl) stockUnitSuffixEl.textContent = labels.stockSuffix;
    if (costUnitSuffixEl) costUnitSuffixEl.textContent = labels.costSuffix;
    if (packCountEl && !Number(packCountEl.value)) packCountEl.value = '1';
    syncPackFieldsFromMaterialOption();
    applyPurchaseOverrideUI();
    recalcPurchaseTotals();

    // Показать данные выбранного материала (в т.ч. если остаток 0 — это нормально для пополнения)
    try {
      // Получаем расширенные поля из option/data-* и из самого названия option
      const name = opt.textContent || 'Материал';
      const stk = Math.max(0, Number(opt.getAttribute('data-stock')) || 0);
      const packSize = Math.max(0, Number(opt.getAttribute('data-pack-size')) || 0);
      const packPrice = Math.max(0, Number(opt.getAttribute('data-pack-price')) || 0);
      const unitLabel = unit === 'pcs' ? 'шт' : 'г';
      const metaLine = [
        `Остаток: ${stk} ${unitLabel}`,
        `Ед.: ${unitLabel}`,
        `Упаковка: ${packSize > 0 ? packSize : '—'} ${unitLabel}`,
        `Цена уп.: ${packPrice > 0 ? F.money(packPrice) : '—'}`,
      ].join(' · ');
      if (matSummaryName) matSummaryName.textContent = name;
      if (matSummaryMeta) matSummaryMeta.textContent = metaLine;
      if (matSummary) matSummary.style.display = '';
    } catch {}
  };

  matSelect?.addEventListener('change', syncMaterialMeta);
  newUnitEl?.addEventListener('change', () => {
    if (!isNewMaterialMode()) return;
    syncNewMaterialLabelsFromUnit();
    recalcPurchaseTotals();
  });
  overrideChk?.addEventListener('change', () => {
    if (!overrideChk.checked) syncPackFieldsFromMaterialOption();
    applyPurchaseOverrideUI();
    recalcPurchaseTotals();
  });
  packCountEl?.addEventListener('input', recalcPurchaseTotals);
  packWeightEl?.addEventListener('input', recalcPurchaseTotals);
  packPriceEl?.addEventListener('input', recalcPurchaseTotals);

  const tabExisting = root.querySelector('#pm-tab-existing');
  const tabNew = root.querySelector('#pm-tab-new');

  function updateModeTabsUI() {
    if (!hasMaterials) return;
    const isNew = isNewMaterialMode();
    tabExisting?.classList.toggle('is-active', !isNew);
    tabNew?.classList.toggle('is-active', isNew);
    tabExisting?.setAttribute('aria-selected', !isNew ? 'true' : 'false');
    tabNew?.setAttribute('aria-selected', isNew ? 'true' : 'false');
  }

  function setPurchaseMode(mode) {
    if (!hasMaterials || !existingBlock || !newBlock) return;
    if (mode === 'new') {
      existingBlock.hidden = true;
      newBlock.hidden = false;
      if (matSelect) matSelect.disabled = true;
      if (overrideChk) overrideChk.checked = false;
      syncNewMaterialLabelsFromUnit();
      applyPurchaseOverrideUI();
      if (saveBtn) saveBtn.disabled = false;
      if (packCountEl) packCountEl.disabled = false;
      recalcPurchaseTotals();
    } else {
      newBlock.hidden = true;
      existingBlock.hidden = false;
      if (matSelect) matSelect.disabled = false;
      syncMaterialMeta();
    }
    updateModeTabsUI();
  }

  tabExisting?.addEventListener('click', () => {
    setPurchaseMode('existing');
  });
  tabNew?.addEventListener('click', () => setPurchaseMode('new'));

  if (!hasMaterials) {
    if (overrideRow) overrideRow.style.display = 'none';
    if (overrideChk) overrideChk.disabled = true;
    syncNewMaterialLabelsFromUnit();
    recalcPurchaseTotals();
  } else {
    syncMaterialMeta();
    updateModeTabsUI();
  }

  root.querySelector('#pm-save')?.addEventListener('click', async () => {
    if (isNewMaterialMode()) {
      const typeVal = String(root.querySelector('#pm-new-type')?.value ?? '').trim();
      if (!typeVal) {
        toast('Выберите тип материала.');
        return;
      }
      const seriesTrim = String(root.querySelector('#pm-new-series')?.value ?? '').trim();
      if (!seriesTrim) {
        toast('Введите название или серию материала.');
        return;
      }
    } else {
      const midRaw = root.querySelector('#pm-m')?.value;
      if (!midRaw) {
        toast('Выберите материал для пополнения.');
        return;
      }
    }

    const packsIn = Math.max(0, Number(packCountEl?.value) || 0);
    const sizeOnePack = Math.max(0, Number(packWeightEl?.value) || 0);
    const priceOnePack = Math.max(0, Number(packPriceEl?.value) || 0);
    if (sizeOnePack <= 0 || packsIn <= 0) {
      toast('Укажите число упаковок и размер одной упаковки больше нуля');
      return;
    }
    const qty = packsIn * sizeOnePack;
    const unitPrice = priceOnePack / sizeOnePack;

    if (qty <= 0) {
      toast('Введите количество больше нуля');
      return;
    }
    if (unitPrice < 0 || !Number.isFinite(unitPrice)) {
      toast('Проверьте цену упаковки');
      return;
    }

    let materialIdNum;
    if (isNewMaterialMode()) {
      const typeVal = String(root.querySelector('#pm-new-type')?.value ?? '').trim();
      const seriesTrim = String(root.querySelector('#pm-new-series')?.value ?? '').trim();
      const colorTrim = String(root.querySelector('#pm-new-color')?.value ?? '').trim();
      const unitNorm = root.querySelector('#pm-new-unit')?.value === 'pcs' ? 'pcs' : 'g';
      const displayName = buildPurchaseNewMaterialDisplayName(typeVal, seriesTrim, colorTrim);
      try {
        materialIdNum = await db.addMaterial({
          name: displayName,
          unit: unitNorm,
          materialType: typeVal || 'прочее',
          materialSeries: seriesTrim,
          materialColorCode: colorTrim,
          packagePrice: priceOnePack,
          packageWeightGrams: unitNorm === 'g' ? sizeOnePack : 0,
          packageQtyPcs: unitNorm === 'pcs' ? sizeOnePack : 0,
          stock: 0,
          minStock: 0,
        });
      } catch (e) {
        console.error(e);
        toast('Не удалось создать материал');
        return;
      }
    } else {
      materialIdNum = Number(root.querySelector('#pm-m')?.value);
    }

    const supplier = root.querySelector('#pm-s')?.value ?? '';
    const date = root.querySelector('#pm-d')?.value ?? '';
    const note = root.querySelector('#pm-n')?.value ?? '';
    try {
      await db.stockPurchase({
        materialId: materialIdNum,
        qty,
        unitPrice,
        supplier,
        date,
        note,
        purchasePackPrice: priceOnePack,
        purchasePackSize: sizeOnePack,
        purchasePackCount: packsIn,
        purchasePackParamsDiffer: isNewMaterialMode() ? false : !!(overrideChk?.checked),
      });
    } catch (e) {
      console.error(e);
      toast('Не удалось сохранить приход');
      return;
    }
    toast('Приход сохранён');
    await refresh();
    go('materials');
  });
}

async function renderAddMaterial() {
  const qs = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const ret = new URLSearchParams(qs).get('return');
  const fromWizard = ret === 'new';
  const typeOptions = MATERIAL_TYPES.map((v) => `<option value="${v}">${esc(v)}</option>`).join('');
  return `<div class="content">
    <div class="back-row"><a href="${fromWizard ? '#new' : '#materials'}" data-back>${fromWizard ? '← К записи' : '← Материалы'}</a></div>
    <h1 style="margin:0 0 16px;font-size:1.35rem">Новый материал</h1>
    <label class="label" for="nm-type">Тип материала</label>
    <select class="field" id="nm-type">${typeOptions}</select>
    <label class="label" for="nm-series">Название / серия</label>
    <input class="field" id="nm-series" placeholder="Например: Неон, Омбре, Премиум" />
    <label class="label" for="nm-color">Цвет / номер оттенка</label>
    <input class="field" id="nm-color" placeholder="Например: 2365, 1B или розовый" />
    <label class="label" for="nm-unit">Единица списания</label>
    <select class="field" id="nm-unit">
      <option value="g">граммы</option>
      <option value="pcs">штуки</option>
    </select>
    <p class="status-line" id="nm-base-unit">Базовая единица: граммы</p>
    <label class="label" for="nm-pack-price">Цена за упаковку (пачку)</label>
    <input class="field" id="nm-pack-price" type="number" min="0" step="1" value="0" />
    <label class="label" id="nm-pack-size-label" for="nm-pack-weight">Вес упаковки (граммы)</label>
    <input class="field" id="nm-pack-weight" type="number" min="0" step="1" value="100" />
    <p class="status-line" id="nm-gram-price-preview">≈ 0 ₽ за грамм (расчет)</p>
    <label class="label" id="nm-min-label" for="nm-min">Минимум (граммы)</label>
    <input class="field" id="nm-min" type="number" min="0" step="1" value="0" />
    <label class="label" for="nm-comment">Комментарий</label>
    <textarea class="field" id="nm-comment" placeholder="Необязательно"></textarea>
    <button type="button" class="btn btn-primary" id="nm-save">Сохранить</button>
  </div>`;
}

export function attachAddMaterial(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  const qs = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const ret = new URLSearchParams(qs).get('return');
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go(ret === 'new' ? 'new' : 'materials');
  });
  const packPriceEl = root.querySelector('#nm-pack-price');
  const packWeightEl = root.querySelector('#nm-pack-weight');
  const gramPreviewEl = root.querySelector('#nm-gram-price-preview');
  const typeEl = root.querySelector('#nm-type');
  const unitEl = root.querySelector('#nm-unit');
  const baseUnitEl = root.querySelector('#nm-base-unit');
  const packSizeLabelEl = root.querySelector('#nm-pack-size-label');
  const minLabelEl = root.querySelector('#nm-min-label');
  let unitCode = 'g';

  const syncUnitUi = () => {
    unitCode = unitEl?.value === 'pcs' ? 'pcs' : 'g';
    const isWeight = unitCode === 'g';
    if (baseUnitEl) baseUnitEl.textContent = `Базовая единица: ${isWeight ? 'граммы' : 'штуки'}`;
    if (packSizeLabelEl) {
      packSizeLabelEl.textContent = isWeight
        ? 'Вес упаковки (граммы)'
        : 'Количество в упаковке (шт)';
    }
    if (minLabelEl) minLabelEl.textContent = `Минимум (${isWeight ? 'граммы' : 'шт'})`;
    recalcGramPrice();
  };

  const recalcGramPrice = () => {
    const packPrice = Math.max(0, Number(packPriceEl?.value) || 0);
    const packageSize = Math.max(0, Number(packWeightEl?.value) || 0);
    const basePrice = packageSize > 0 ? packPrice / packageSize : 0;
    if (gramPreviewEl) {
      gramPreviewEl.textContent = `≈ ${F.money(basePrice)} за ${unitCode === 'g' ? 'грамм' : 'штуку'} (расчет)`;
    }
  };
  unitEl?.addEventListener('change', syncUnitUi);
  packPriceEl?.addEventListener('input', recalcGramPrice);
  packWeightEl?.addEventListener('input', recalcGramPrice);
  syncUnitUi();
  recalcGramPrice();
  root.querySelector('#nm-save')?.addEventListener('click', async () => {
    const typeVal = String(typeEl?.value ?? '').trim();
    if (!typeVal) {
      toast('Выберите тип материала.');
      return;
    }
    const seriesTrim = String(root.querySelector('#nm-series')?.value ?? '').trim();
    if (!seriesTrim) {
      toast('Введите название или серию материала.');
      return;
    }
    const colorTrim = String(root.querySelector('#nm-color')?.value ?? '').trim();
    const name = buildMaterialCatalogDisplayName(typeVal, seriesTrim, colorTrim);
    const packagePrice = Math.max(0, Number(packPriceEl?.value) || 0);
    const packageSize = Math.max(0, Number(packWeightEl?.value) || 0);
    const defaultPrice =
      packageSize > 0 ? packagePrice / packageSize : 0;
    await db.addMaterial({
      name,
      materialType: typeVal,
      materialSeries: seriesTrim,
      materialColor: colorTrim,
      materialColorCode: colorTrim,
      packagePrice,
      packageWeightGrams: unitCode === 'g' ? packageSize : 0,
      packageQtyPcs: unitCode === 'pcs' ? packageSize : 0,
      unit: unitCode,
      defaultPrice,
      baseUnit: unitCode,
      minStock: root.querySelector('#nm-min').value,
      comment: root.querySelector('#nm-comment').value.trim(),
    });
    toast('Материал добавлен');
    await refresh();
    go(ret === 'new' ? 'new' : 'materials');
  });
}

async function renderFinance(db, go) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const mode = params.get('m') || 'today';
  const today = F.todayISO();
  const curYm = today.slice(0, 7);

  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  let selectedYm = curYm;
  let from = today;
  let to = today;
  if (mode === 'month') {
    const ymParam = params.get('ym');
    selectedYm = isIsoYearMonth(ymParam) ? ymParam : curYm;
    const r = monthRange(selectedYm);
    from = r.from;
    to = r.to;
  } else if (mode === 'period') {
    const fromParam = params.get('from');
    const toParam = params.get('to');
    from = isIsoDate(fromParam) ? fromParam : today;
    to = isIsoDate(toParam) ? toParam : today;
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
  }

  const appointments = await db.listAppointments();
  const movements = await db.listMovements();

  const apIn = appointments.filter(
    (a) => a.status === 'done' && inRange(a.date, from, to)
  );
  const revenue = apIn.reduce((s, a) => s + (Number(a.receivedRub) || 0), 0);
  const cogs = apIn.reduce((s, a) => s + appointmentTotalCogs(a), 0);
  const profit = apIn.reduce((s, a) => s + (Number(a.profitRub) || 0), 0);

  const purchases = movements.filter((m) => m.type === 'in' && inRange(m.date, from, to));
  const purchaseSum = purchases.reduce((s, m) => s + (Number(m.totalCostRub) || 0), 0);

  const doneVisits = apIn.length;
  const clientsN = new Set(apIn.map((a) => a.clientId)).size;
  const avgCheck = doneVisits > 0 ? revenue / doneVisits : 0;
  const hours = apIn.reduce((s, a) => s + (Number(a.actualMinutes) || 0), 0) / 60;
  const profitPerHour = hours > 0 ? profit / hours : 0;

  const periodLabel =
    mode === 'today'
      ? F.formatDateISO(today)
      : mode === 'month'
        ? formatMonthYearRu(selectedYm)
        : `${F.formatDateISO(from)} — ${F.formatDateISO(to)}`;

  const segHtml = `<div class="segmented" style="margin-top:0">
    <button type="button" class="${mode === 'today' ? 'active' : ''}" data-fin="today">Сегодня</button>
    <button type="button" class="${mode === 'month' ? 'active' : ''}" data-fin="month">Месяц</button>
    <button type="button" class="${mode === 'period' ? 'active' : ''}" data-fin="period">Период</button>
  </div>`;

  const monthInputs =
    mode === 'month'
      ? `<label class="label" for="fin-ym">Месяц</label>
    <input class="field" id="fin-ym" type="month" value="${esc(selectedYm)}" />
    <button type="button" class="btn btn-secondary" id="fin-apply-month">Показать</button>`
      : '';

  const periodInputs =
    mode === 'period'
      ? `<div class="row">
      <div style="flex:1"><label class="label" for="fin-from">С</label><input class="field" id="fin-from" type="text" inputmode="numeric" autocomplete="off" placeholder="ДД.ММ.ГГГГ" maxlength="10" spellcheck="false" value="${esc(F.formatDateISO(from))}" /></div>
      <div style="flex:1"><label class="label" for="fin-to">По</label><input class="field" id="fin-to" type="text" inputmode="numeric" autocomplete="off" placeholder="ДД.ММ.ГГГГ" maxlength="10" spellcheck="false" value="${esc(F.formatDateISO(to))}" /></div>
    </div>
    <button type="button" class="btn btn-secondary" id="fin-apply">Показать</button>`
      : '';

  return `<header class="page-header">
    <div><h1>Финансы</h1><p class="sub">${esc(periodLabel)}</p></div>
  </header>
  <div class="content">
    ${segHtml}
    ${monthInputs}
    ${periodInputs}
    <div class="card">
      <div class="card-title">Выручка</div>
      <p class="stat-big">${F.money(revenue)}</p>
    </div>
    <div class="card">
      <div class="card-title">Себестоимость выполненных визитов</div>
      <p class="stat-big">${F.money(cogs)}</p>
    </div>
    <div class="card">
      <div class="card-title">Прибыль</div>
      <p class="stat-big profit-pos">${F.money(profit)}</p>
    </div>
    <div class="card">
      <div class="card-title">Закупки материалов</div>
      <p class="stat-big">${F.money(purchaseSum)}</p>
      <p class="status-line">Это покупки материалов на склад. Они не равны расходу материалов по визитам.</p>
    </div>
    <div class="card compact">
      <div class="card-title">Кратко</div>
      <p class="status-line">Завершённых визитов: ${doneVisits}</p>
      <p class="status-line">Средний чек: ${F.money(avgCheck)}</p>
      <p class="status-line">Прибыль за час работы: ${F.money(profitPerHour)}</p>
    </div>
  </div>`;
}

async function renderServices(db) {
  const raw = await db.listServices();
  const services = [...raw].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'ru')
  );
  const cards = services
    .map((s) => {
      return `<div class="card sv-price-card" data-sv-open="${s.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700">${esc(s.name)}</div>
            <div class="status-line">${F.money(s.basePrice)} · ${F.minutesToLabel(s.plannedMinutes)}</div>
            ${s.note ? `<p class="status-line" style="margin-top:6px">${esc(s.note)}</p>` : ''}
          </div>
          <button type="button" class="appt-delete-btn" aria-label="Удалить из прайса" data-sv-del="${s.id}"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
        </div>
      </div>`;
    })
    .join('');
  return `<header class="page-header">
    <div><h1>Прайс</h1><p class="sub">Услуги для записей</p></div>
  </header>
  <div class="content">
    ${
      cards ||
      `<div class="card" style="text-align:center;padding:20px 12px;margin-bottom:0"><p class="empty-hint" style="margin:0 0 14px;padding:0">Прайс пуст — добавьте услуги вручную</p><button type="button" class="btn btn-primary" id="sv-empty-add">Добавить услугу</button></div>`
    }
    ${cards ? `<button type="button" class="btn btn-secondary" style="width:100%;margin-top:14px" id="sv-add">Добавить услугу</button>` : ''}
    <button type="button" class="btn btn-ghost" style="width:100%;margin-top:12px;font-size:0.92rem" id="sv-purge-demo">Очистить демо-услуги</button>
    <p class="muted" style="margin-top:14px;font-size:0.82rem">Если услуга уже используется в записях, она скрывается из прайса (архив), а не удаляется.</p>
  </div>`;
}

function remountServices(go) {
  go(`services?_=${Date.now()}`);
}

export function attachServices(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('#sv-add')?.addEventListener('click', () => go('add-service'));
  root.querySelector('#sv-empty-add')?.addEventListener('click', () => go('add-service'));
  root.querySelectorAll('[data-sv-open]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = card.getAttribute('data-sv-open');
      if (!id) return;
      go(`service-${id}`);
    });
  });
  root.querySelectorAll('[data-sv-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(btn.getAttribute('data-sv-del'));
      if (!id) return;
      const ok = await confirmDialog(
        'Удалить услугу из прайса?\nЕсли услуга уже использовалась в записях, она будет скрыта из прайса, но история записей сохранится.',
        {
          leftLabel: 'Отмена',
          rightLabel: 'Удалить',
          focusLeft: true,
        }
      );
      if (!ok) return;
      const r = await db.deleteServiceOrArchive(id);
      if (!r.ok) {
        toast('Не удалось удалить услугу');
        return;
      }
      toast(
        r.archived
          ? 'Услуга скрыта из прайса (есть связанные записи)'
          : 'Услуга удалена'
      );
      await refresh();
      remountServices(go);
    });
  });
  root.querySelector('#sv-purge-demo')?.addEventListener('click', async () => {
    if (
      !confirm(
        'Убрать демо-услуги из прайса? Услуги с записями останутся в базе, но будут скрыты из списка.'
      )
    ) {
      return;
    }
    const r = await db.purgeDemoSeedServices();
    if (r.deleted === 0 && r.archived === 0) {
      toast('Демо-услуги не найдены');
      return;
    }
    toast('Демо-услуги скрыты из прайса');
    await refresh();
    remountServices(go);
  });
}

async function renderAddService() {
  return `<div class="content">
    <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-sv-back>← Назад</button></div>
    <h1 style="margin-top:8px;font-size:1.35rem">Новая услуга</h1>
    <label class="label" for="sv-name">Название услуги</label>
    <input class="field" id="sv-name" placeholder="Например: Классический пучок" />
    <label class="label" for="sv-price">Базовая цена, ₽</label>
    <input class="field" id="sv-price" type="number" min="0" step="100" value="0" />
    <p class="card-title" style="margin-top:14px">Плановая длительность</p>
    <div class="row">
      <div style="flex:1"><label class="label" for="sv-ph">Часы</label><input class="field" id="sv-ph" type="number" min="0" value="2" /></div>
      <div style="flex:1"><label class="label" for="sv-pm">Минуты</label><input class="field" id="sv-pm" type="number" min="0" step="5" value="0" /></div>
    </div>
    <label class="label" for="sv-note">Комментарий</label>
    <textarea class="field" id="sv-note" placeholder="Необязательно"></textarea>
    <button type="button" class="btn btn-primary" style="margin-top:8px" id="sv-save">Сохранить в прайс</button>
  </div>`;
}

async function renderServiceDetail(db, id, go) {
  const sid = Number(id);
  const svc = await db.getService(sid);
  if (!svc) {
    return `<div class="content"><p class="empty-hint">Услуга не найдена</p><button class="btn btn-secondary" type="button" data-back>Назад</button></div>`;
  }
  const planned = Math.max(0, Number(svc.plannedMinutes) || 0);
  const ph = Math.floor(planned / 60);
  const pm = planned % 60;
  const diff = Math.min(5, Math.max(1, Number(svc.defaultDifficulty) || 1));

  return `<div class="content">
    <div class="back-row"><a href="#services" data-back>← Назад</a></div>
    <header class="page-header" style="padding-left:0;padding-right:0">
      <div>
        <h1 style="margin:0">${esc(String(svc.name || 'Услуга').trim() || 'Услуга')}</h1>
        <p class="sub">Редактирование услуги</p>
      </div>
    </header>

    <label class="label" for="s-ed-name">Название услуги</label>
    <input class="field" id="s-ed-name" value="${esc(String(svc.name || '').trim())}" />

    <label class="label" for="s-ed-price">Цена, ₽</label>
    <input class="field" id="s-ed-price" type="number" min="0" step="100" value="${esc(
      String(Number(svc.basePrice) || 0)
    )}" />

    <p class="card-title" style="margin-top:14px">Плановое время</p>
    <div class="row">
      <div style="flex:1"><label class="label" for="s-ed-ph">Часы</label><input class="field" id="s-ed-ph" type="number" min="0" value="${ph}" /></div>
      <div style="flex:1"><label class="label" for="s-ed-pm">Минуты</label><input class="field" id="s-ed-pm" type="number" min="0" step="5" value="${pm}" /></div>
    </div>

    <label class="label" for="s-ed-diff">Сложность (1–5)</label>
    <input class="field" id="s-ed-diff" type="number" min="1" max="5" step="1" value="${diff}" />

    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
      <button type="button" class="btn btn-primary" id="s-ed-save">Сохранить</button>
      <button type="button" class="btn btn-secondary" id="s-ed-cancel">Отмена</button>
    </div>
  </div>`;
}

export function attachAddService(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  const qs = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const ret = new URLSearchParams(qs).get('return');

  root.querySelector('[data-sv-back]')?.addEventListener('click', () => {
    go(ret === 'new' ? 'new' : 'services');
  });

  root.querySelector('#sv-save')?.addEventListener('click', async () => {
    const name = root.querySelector('#sv-name').value.trim();
    if (!name) {
      toast('Введите название услуги');
      return;
    }
    const price = Number(root.querySelector('#sv-price').value) || 0;
    const ph = Number(root.querySelector('#sv-ph').value) || 0;
    const pmin = Number(root.querySelector('#sv-pm').value) || 0;
    const plannedMinutes = Math.max(0, ph * 60 + pmin);
    if (plannedMinutes <= 0) {
      toast('Укажите длительность больше нуля');
      return;
    }
    await db.addService({
      name,
      basePrice: price,
      plannedMinutes,
      defaultDifficulty: 1,
      note: root.querySelector('#sv-note').value.trim(),
    });
    toast('Услуга сохранена');
    await refresh();
    go(ret === 'new' ? 'new' : 'services');
  });
}

export function attachServiceDetail(shell, db, go, id, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  const sid = Number(id);
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('services');
  });
  root.querySelector('#s-ed-cancel')?.addEventListener('click', () => go('services'));
  root.querySelector('#s-ed-save')?.addEventListener('click', async () => {
    const name = String(root.querySelector('#s-ed-name')?.value ?? '').trim();
    const price = Math.max(0, Number(root.querySelector('#s-ed-price')?.value) || 0);
    const ph = Math.max(0, Number(root.querySelector('#s-ed-ph')?.value) || 0);
    const pm = Math.max(0, Number(root.querySelector('#s-ed-pm')?.value) || 0);
    const plannedMinutes = Math.max(0, Math.round(ph * 60 + pm));
    const diff = Math.min(5, Math.max(1, Math.round(Number(root.querySelector('#s-ed-diff')?.value) || 1)));
    if (!name) {
      toast('Введите название услуги');
      return;
    }
    if (plannedMinutes <= 0) {
      toast('Укажите длительность больше нуля');
      return;
    }
    const fresh = await db.getService(sid);
    if (!fresh) {
      toast('Услуга не найдена');
      go('services');
      return;
    }
    await db.putService({
      ...fresh,
      name,
      basePrice: price,
      plannedMinutes,
      defaultDifficulty: diff,
    });
    toast('Сохранено');
    await refresh();
    go('services');
  });
}

export function attachFinance(shell, go) {
  const root = shell.querySelector('#app-root') || shell;
  const navigateMode = (m) => {
    if (m === 'period') {
      const d = F.todayISO();
      location.hash = `#finance?m=period&from=${encodeURIComponent(d)}&to=${encodeURIComponent(d)}`;
    } else if (m === 'month') {
      const ym = F.todayISO().slice(0, 7);
      location.hash = `#finance?m=month&ym=${encodeURIComponent(ym)}`;
    } else {
      location.hash = `#finance?m=${encodeURIComponent(m)}`;
    }
  };
  root.querySelectorAll('[data-fin]').forEach((b) => {
    b.addEventListener('click', () => navigateMode(b.getAttribute('data-fin')));
  });
  root.querySelector('#fin-apply')?.addEventListener('click', () => {
    const fromIso = F.parseDateRu(root.querySelector('#fin-from')?.value);
    const toIso = F.parseDateRu(root.querySelector('#fin-to')?.value);
    if (!fromIso || !toIso) {
      toast('Укажите даты в формате ДД.ММ.ГГГГ');
      return;
    }
    let from = fromIso;
    let to = toIso;
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    location.hash = `#finance?m=period&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  });
  root.querySelector('#fin-apply-month')?.addEventListener('click', () => {
    const ym = root.querySelector('#fin-ym')?.value;
    if (!isIsoYearMonth(ym)) {
      toast('Укажите месяц');
      return;
    }
    location.hash = `#finance?m=month&ym=${encodeURIComponent(ym)}`;
  });

  const subEl = root.querySelector('.page-header .sub');
  const finFromEl = root.querySelector('#fin-from');
  const finToEl = root.querySelector('#fin-to');
  const normalizeFinDateField = (el) => {
    const iso = F.parseDateRu(el?.value);
    if (iso) el.value = F.formatDateISO(iso);
  };
  const syncPeriodSubLabel = () => {
    if (!subEl || !finFromEl || !finToEl) return;
    const fromIso = F.parseDateRu(finFromEl.value);
    const toIso = F.parseDateRu(finToEl.value);
    if (!fromIso || !toIso) return;
    let from = fromIso;
    let to = toIso;
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    subEl.textContent = `${F.formatDateISO(from)} — ${F.formatDateISO(to)}`;
  };
  finFromEl?.addEventListener('input', syncPeriodSubLabel);
  finToEl?.addEventListener('input', syncPeriodSubLabel);
  finFromEl?.addEventListener('blur', () => normalizeFinDateField(finFromEl));
  finToEl?.addEventListener('blur', () => normalizeFinDateField(finToEl));
}

async function renderSettings(db, meta, go, refresh) {
  const name = (await db.getMeta('masterName')) || '';
  const hourlyMeta = meta.masterHourlyRateRub;
  const fixedMeta = meta.orderFixedCostRub;
  const hourlyVal =
    hourlyMeta != null && hourlyMeta !== '' ? esc(String(hourlyMeta)) : '';
  const fixedVal =
    fixedMeta != null && fixedMeta !== '' ? esc(String(fixedMeta)) : '';
  return `<div class="content">
    <div class="back-row"><a href="#today" data-back>← Главная</a></div>
    <h1 style="margin-top:8px">Настройки</h1>
    <label class="label" for="st-name">Как к вам обращаться</label>
    <input class="field" id="st-name" value="${esc(name)}" />
    <button type="button" class="btn btn-primary" id="st-save">Сохранить имя</button>
    <hr class="soft" />
    <h2 style="font-size:1rem;margin:0 0 8px">Настройки расчёта прибыли</h2>
    <p class="muted" style="font-size:0.85rem;margin:0 0 12px;line-height:1.45">
      Эти значения используются для расчёта реальной себестоимости записи.
    </p>
    <label class="label" for="st-hourly">Ставка мастера в час, ₽</label>
    <input class="field" id="st-hourly" type="number" min="0" step="50" value="${hourlyVal}" placeholder="500" />
    <label class="label" for="st-fixed">Фиксированный расход на заказ, ₽</label>
    <input class="field" id="st-fixed" type="number" min="0" step="50" value="${fixedVal}" placeholder="200" />
    <button type="button" class="btn btn-secondary" id="st-save-cost" style="margin-top:10px">Сохранить настройки</button>
    <hr class="soft" />
    <label class="label" for="st-code">Активация</label>
    <p class="muted" style="font-size:0.82rem;margin:4px 0 8px;line-height:1.45">
      Код доступа можно получить в Telegram:
      <a href="https://t.me/tnatalina" target="_blank" rel="noopener noreferrer">@tnatalina</a>
    </p>
    <input class="field" id="st-code" placeholder="Код полной версии" />
    <button type="button" class="btn btn-secondary" id="st-activate">Активировать код</button>
    <hr class="soft" />
    <div class="card svc-data-card">
      ${htmlDataBackupCard(
        `<p class="svc-data-footnote">При загрузке файла все данные заменятся — сначала сохраните копию. Импорт клиентов (имя и телефон) только добавляет записи в справочник.</p>`
      )}
    </div>
  </div>`;
}

export function attachSettings(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('today');
  });
  root.querySelector('#st-save')?.addEventListener('click', async () => {
    await db.setMeta('masterName', root.querySelector('#st-name').value.trim() || 'Мастер');
    toast('Сохранено');
    await refresh();
  });
  root.querySelector('#st-save-cost')?.addEventListener('click', async () => {
    const h = Math.max(0, Number(root.querySelector('#st-hourly').value) || 0);
    const f = Math.max(0, Number(root.querySelector('#st-fixed').value) || 0);
    await db.setMeta('masterHourlyRateRub', h);
    await db.setMeta('orderFixedCostRub', f);
    toast('Сохранено');
    await refresh();
  });
  root.querySelector('#st-activate')?.addEventListener('click', async () => {
    const ok = await License.activateWithCode(db, root.querySelector('#st-code').value);
    if (!ok) {
      toast('Неверный код доступа');
      return;
    }
    toast('Полная версия активирована');
    await refresh();
    go('today');
  });
  attachServiceBlock(root, db, go, refresh);
}

function wireImport(ctx) {
  const input = document.getElementById('import-file');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm('Импорт заменит текущую базу. Продолжить?')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await ctx.db.importAll(data);
      await ctx.refresh();
      toast('Импорт выполнен');
      ctx.go('today');
    } catch {
      toast('Не удалось импортировать файл');
    }
  });
}

function loadWizard() {
  try {
    return JSON.parse(sessionStorage.getItem(WIZARD_KEY) || 'null') || {
      step: 1,
      materialsPlan: [],
      difficulty: 2,
      tags: [],
    };
  } catch {
    return { step: 1, materialsPlan: [], difficulty: 2, tags: [] };
  }
}

function saveWizard(w) {
  sessionStorage.setItem(WIZARD_KEY, JSON.stringify(w));
}

async function renderWizard(root, db, go, opts = {}) {
  let w = loadWizard();
  let clients = await db.listClients();
  /** Перечитываем при каждом paint(), чтобы после правок прайса список в мастере не устаревал. */
  let services = await db.listServices();
  let materials = await db.listMaterials();

  const editId = Number(opts.editAppointmentId) || null;
  if (editId && Number(w.editingAppointmentId) !== editId) {
    const ap = await db.getAppointment(editId);
    if (ap) {
      w = {
        step: 5,
        editingAppointmentId: editId,
        clientId: ap.clientId,
        clientPickSource: 'existing',
        serviceId: ap.serviceId ?? null,
        catalogServicePicked: ap.serviceId != null,
        serviceNameSnapshot: ap.serviceNameSnapshot || '',
        date: ap.date || F.todayISO(),
        time: ap.time || '',
        difficulty: ap.difficulty || 2,
        tags: ap.difficultyTags || [],
        plannedMinutes: ap.plannedMinutes || 120,
        priceRub: ap.priceRub || 0,
        materialsPlan: ap.materialsPlan || [],
        serviceAdjustNote: ap.notes || '',
        comment: ap.notes || '',
        status: ap.status || 'scheduled',
      };
      saveWizard(w);
    }
  }

  /** Поиск клиента по имени и телефону (частичное совпадение, без регистра; цифры — по подстроке в номере). */
  function clientMatchesWizardQuery(c, rawQuery) {
    const q = String(rawQuery || '').trim();
    if (!q) return false;
    const qLower = q.toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const name = String(c.name || '').toLowerCase();
    const phone = String(c.phone || '');
    if (name.includes(qLower)) return true;
    if (phone.toLowerCase().includes(qLower)) return true;
    const pDigits = phone.replace(/\D/g, '');
    if (qDigits.length > 0 && pDigits.includes(qDigits)) return true;
    return false;
  }

  function wizardServiceSummaryCard(wObj, withEditBtn) {
    const name = esc(wObj.serviceNameSnapshot || '—');
    const price = F.money(wObj.priceRub || 0);
    const timeLabel = esc(F.minutesToLabel(Number(wObj.plannedMinutes) || 0));
    const editBtn = withEditBtn
      ? `<button type="button" class="btn btn-secondary" style="width:100%;margin-top:10px" id="w-open-adjust-service">Добавить наценку / время</button>`
      : '';
    return `<div class="card compact" style="margin-bottom:14px;background:var(--accent-soft);border-color:var(--accent)">
      <div class="card-title" style="margin-bottom:6px;color:var(--accent)">Услуга в записи</div>
      <p class="status-line" style="margin:4px 0">Услуга: ${name}</p>
      <p class="status-line" style="margin:4px 0">Цена: ${price}</p>
      <p class="status-line" style="margin:4px 0">Время: ${timeLabel}</p>
      ${editBtn}
    </div>`;
  }

  let wizardClientSearchTimer = null;
  const wizardSearchDebounceMs = 260;

  async function paint() {
    clearTimeout(wizardClientSearchTimer);
    wizardClientSearchTimer = null;

    clients = await db.listClients();
    services = await db.listServices();
    materials = await db.listMaterials();

    if (!w.adjustingService && Number(w.step) === 3) {
      w.step = 4;
      saveWizard(w);
    }

    let step = w.step || 1;

    if (
      w.adjustingService &&
      (Number(w.adjustReturnStep) === 4 || Number(w.adjustReturnStep) === 5)
    ) {
      const retStep = Number(w.adjustReturnStep);
      let baseP = 0;
      let baseM = 0;
      let baseName = String(w.serviceNameSnapshot || '—');
      if (Number(w.serviceId) > 0 && w.catalogServicePicked) {
        const sRow = await db.getService(Number(w.serviceId));
        if (sRow) {
          baseP = Number(sRow.basePrice) || 0;
          baseM = Math.max(0, Number(sRow.plannedMinutes) || 0);
          baseName = String(sRow.name || baseName).trim() || baseName;
          w.serviceBasePriceRub = baseP;
          w.serviceBasePlannedMinutes = baseM;
          saveWizard(w);
        }
      } else {
        baseP = Number(w.serviceBasePriceRub) || 0;
        baseM = Math.max(0, Number(w.serviceBasePlannedMinutes) || 0);
      }
      const curP = Number(w.priceRub) || 0;
      const curMin = Math.max(0, Number(w.plannedMinutes) || 0);
      const surInit = Math.max(0, Math.round(curP - baseP));
      const exInit = Math.max(0, Math.round(curMin - baseM));
      const noteInit = String(w.serviceAdjustNote ?? '');

      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-adjust-cancel>Отмена</button></div>
        <div class="step-bar">Корректировка записи</div>
        <h1 style="margin-top:0;font-size:1.35rem">Корректировка записи</h1>
        <div class="card compact" style="margin-bottom:12px;background:var(--bg)">
          <div class="card-title">База по прайсу</div>
          <p class="status-line">Услуга: ${esc(baseName)}</p>
          <p class="status-line">Базовая цена: ${F.money(baseP)}</p>
          <p class="status-line">Базовое время: ${esc(F.minutesToLabel(baseM))}</p>
        </div>
        <p class="card-title" style="margin-top:4px">Если работа сложнее обычной</p>
        <label class="label" for="w-adj-surcharge">Наценка за сложность, ₽</label>
        <input class="field" id="w-adj-surcharge" type="number" min="0" step="100" value="${surInit}" />
        <label class="label" for="w-adj-extra-min">Дополнительное время, мин</label>
        <input class="field" id="w-adj-extra-min" type="number" min="0" step="5" value="${exInit}" />
        <label class="label" for="w-adj-note">Причина / комментарий</label>
        <textarea class="field" id="w-adj-note" rows="3" placeholder="Кратко опишите, что усложняет работу">${esc(noteInit)}</textarea>
        <p class="muted" style="font-size:0.8rem;margin:-6px 0 14px;line-height:1.45">Например: густые волосы, длина ниже пояса, много мелких деталей, исправление чужой работы.</p>
        <div class="card compact" style="margin-top:4px">
          <div class="card-title">Итого по записи</div>
          <p class="status-line">Цена: <strong id="w-adj-total-price">${F.money(baseP + surInit)}</strong></p>
          <p class="status-line">Плановое время: <strong id="w-adj-total-time">${esc(F.minutesToLabel(baseM + exInit))}</strong></p>
        </div>
        <div class="wizard-footer"><button type="button" class="btn btn-primary" id="w-adjust-done">Готово</button></div>
      </div>`;

      const recalcAdjustTotals = () => {
        const sur = Math.max(0, Number(root.querySelector('#w-adj-surcharge')?.value) || 0);
        const exM = Math.max(0, Number(root.querySelector('#w-adj-extra-min')?.value) || 0);
        const tp = baseP + sur;
        const tm = baseM + exM;
        const elP = root.querySelector('#w-adj-total-price');
        const elT = root.querySelector('#w-adj-total-time');
        if (elP) elP.textContent = F.money(tp);
        if (elT) elT.textContent = F.minutesToLabel(tm);
      };

      root.querySelector('#w-adj-surcharge')?.addEventListener('input', recalcAdjustTotals);
      root.querySelector('#w-adj-extra-min')?.addEventListener('input', recalcAdjustTotals);

      root.querySelector('[data-adjust-cancel]')?.addEventListener('click', () => {
        delete w.adjustingService;
        delete w.adjustReturnStep;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w-adjust-done')?.addEventListener('click', () => {
        const basePr = Number(w.serviceBasePriceRub) || 0;
        const baseMn = Math.max(0, Number(w.serviceBasePlannedMinutes) || 0);
        const sur = Math.max(0, Number(root.querySelector('#w-adj-surcharge')?.value) || 0);
        const exM = Math.max(0, Number(root.querySelector('#w-adj-extra-min')?.value) || 0);
        w.priceRub = basePr + sur;
        w.plannedMinutes = baseMn + exM;
        w.serviceAdjustNote = String(root.querySelector('#w-adj-note')?.value || '').trim();
        delete w.adjustingService;
        delete w.adjustReturnStep;
        w.step = retStep;
        saveWizard(w);
        paint();
      });
      return;
    }

    step = w.step || 1;
    if (step === 1) {
      const rawSearch = String(w.search || '');
      if (
        Number(w.clientId) > 0 &&
        !clients.some((c) => Number(c.id) === Number(w.clientId))
      ) {
        delete w.clientId;
        saveWizard(w);
      }
      let picked = clients.find((c) => Number(c.id) === Number(w.clientId)) || null;
      if (picked) {
        const phCheck = String(picked.phone ?? '').trim();
        if (phCheck && !F.clientPhoneHasEnoughDigits(phCheck)) {
          toast(
            'В карточке клиента слишком короткий номер. Исправьте его в разделе «Клиенты» или выберите другого клиента.'
          );
          delete w.clientId;
          delete w.clientPickSource;
          saveWizard(w);
          picked = null;
        }
      }

      const pickedPhoneLine =
        picked && String(picked.phone ?? '').trim()
          ? `<div class="status-line">${esc(F.formatClientPhonePretty(picked.phone))}</div>`
          : '';
      const pickedBanner = picked
        ? `<div class="card compact wizard-picked-client" style="margin-bottom:12px;border-color:var(--accent);background:var(--accent-soft)">
          <div class="wizard-picked-client__main">
            <div class="card-title" style="color:var(--accent);margin-bottom:4px">Выбран клиент</div>
            <div style="font-weight:700">${esc(picked.name)}</div>
            ${pickedPhoneLine}
          </div>
          <button type="button" class="btn btn-secondary wizard-picked-client__clear" data-clear-client-pick>Сменить</button>
        </div>`
        : '';

      const searchAndNewClientBlock = picked
        ? ''
        : `<label class="label" for="w-search">Найти в базе</label>
        <input type="text" class="field" inputmode="search" id="w-search" placeholder="Имя или телефон" value="${esc(rawSearch)}" autocomplete="off" enterkeyhint="search" />
        <div id="w-client-results" class="wizard-client-results" aria-live="polite"></div>
        <hr class="soft" />
        <p class="card-title">Новый клиент</p>
        <input class="field" id="w-new-name" placeholder="Имя" />
        <input class="field" id="w-new-phone" placeholder="Например: 89774720425" inputmode="tel" />
        <p class="muted" style="font-size:0.82rem;margin:-6px 0 10px;line-height:1.4">Введите 11 цифр. Можно писать без пробелов: 89774720425</p>
        <textarea class="field" id="w-new-notes" placeholder="Заметка"></textarea>`;

      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto;padding:8px 12px" data-cancel>Отмена</button></div>
        <div class="step-bar">Шаг 1 из 4 · Клиент</div>
        <h1 style="margin-top:0;font-size:1.35rem">Кто приходит</h1>
        ${pickedBanner}
        ${searchAndNewClientBlock}
        <div class="wizard-footer"><button type="button" class="btn btn-primary" id="w1-next">Далее</button></div>
      </div>`;

      const searchInput = picked ? null : root.querySelector('#w-search');
      const resultsEl = picked ? null : root.querySelector('#w-client-results');

      /** Обновляет только блок результатов поиска, без замены всего экрана. */
      const renderWizardClientMatches = () => {
        const q = String(searchInput?.value ?? '').trim();
        if (!resultsEl) return;
        if (!q) {
          resultsEl.innerHTML = '';
          return;
        }
        const filtered = clients.filter((c) => clientMatchesWizardQuery(c, q));
        if (!filtered.length) {
          resultsEl.innerHTML = '<p class="empty-hint" style="margin:8px 0 4px">Клиент не найден</p>';
          return;
        }
        resultsEl.innerHTML = `<div class="list-gap">${filtered
          .map((c) => {
            const sel = Number(c.id) === Number(w.clientId) ? ' is-selected' : '';
            return `<button type="button" class="card client-card${sel}" style="width:100%;text-align:left;cursor:pointer" data-pick-client="${c.id}">
          <div style="font-weight:700">${esc(c.name)}</div>
          <div class="status-line">${esc(F.formatClientPhonePretty(c.phone || ''))}</div>
        </button>`;
          })
          .join('')}</div>`;
      };

      const flushWizardSearch = () => {
        clearTimeout(wizardClientSearchTimer);
        wizardClientSearchTimer = null;
        const v = String(searchInput?.value ?? '');
        w.search = v;
        saveWizard(w);
        renderWizardClientMatches();
      };

      const scheduleWizardSearch = () => {
        clearTimeout(wizardClientSearchTimer);
        wizardClientSearchTimer = setTimeout(() => {
          wizardClientSearchTimer = null;
          const v = String(searchInput?.value ?? '');
          w.search = v;
          saveWizard(w);
          renderWizardClientMatches();
        }, wizardSearchDebounceMs);
      };

      if (!picked) {
        searchInput?.addEventListener('input', () => {
          scheduleWizardSearch();
        });

        /** Первичная отрисовка при возврате на шаг с уже введённой строкой. */
        const initialQ = String(searchInput?.value ?? '').trim();
        if (initialQ) flushWizardSearch();
        searchInput?.addEventListener(
          'blur',
          () => {
            flushWizardSearch();
          },
          { passive: true }
        );

        resultsEl?.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-pick-client]');
          if (!b || !resultsEl.contains(b)) return;
          ev.preventDefault();
          const pickId = Number(b.getAttribute('data-pick-client'));
          const rowToPick = clients.find((c) => Number(c.id) === pickId);
          const pTrim = String(rowToPick?.phone ?? '').trim();
          if (!rowToPick || !pTrim) {
            toast('У выбранного клиента не указан номер телефона. Добавьте телефон клиента.');
            return;
          }
          if (!F.clientPhoneHasEnoughDigits(pTrim)) {
            toast('Проверьте номер телефона. Для России нужно 11 цифр: например, 8 999 123-45-67.');
            return;
          }
          w.clientId = pickId;
          w.clientPickSource = 'catalog';
          saveWizard(w);
          paint();
        });
      }

      root.querySelector('[data-clear-client-pick]')?.addEventListener('click', () => {
        delete w.clientId;
        delete w.clientPickSource;
        saveWizard(w);
        paint();
      });
      root.querySelector('[data-cancel]')?.addEventListener('click', () => {
        sessionStorage.removeItem(WIZARD_KEY);
        go('today');
      });
      root.querySelector('#w1-next')?.addEventListener('click', async () => {
        if (!picked) flushWizardSearch();
        if (Number(w.clientId) > 0) {
          const liveClients = await db.listClients();
          const catalogRow = liveClients.find((c) => Number(c.id) === Number(w.clientId));
          const catPhone = String(catalogRow?.phone ?? '').trim();
          if (!catalogRow || !catPhone) {
            toast('У выбранного клиента не указан номер телефона. Добавьте телефон клиента.');
            return;
          }
          if (!F.clientPhoneHasEnoughDigits(catPhone)) {
            toast('Проверьте номер телефона. Для России нужно 11 цифр: например, 8 999 123-45-67.');
            return;
          }
          clients = liveClients;
          delete w.serviceId;
          delete w.catalogServicePicked;
          delete w.serviceNameSnapshot;
          delete w.priceRub;
          delete w.plannedMinutes;
          delete w.serviceBasePriceRub;
          delete w.serviceBasePlannedMinutes;
          delete w.serviceAdjustNote;
          delete w.adjustingService;
          delete w.adjustReturnStep;
          w.difficulty = 2;
          w.tags = [];
          w.materialsPlan = [];
          w.step = 2;
          saveWizard(w);
          paint();
          return;
        }
        const name = String(root.querySelector('#w-new-name')?.value ?? '').trim();
        const phone = String(root.querySelector('#w-new-phone')?.value ?? '').trim();
        if (!name) {
          toast('Введите имя клиента.');
          return;
        }
        const ph = F.validateClientPhoneRu(phone);
        if (!ph.ok) {
          toast('Проверьте номер телефона. Для России нужно 11 цифр: например, 8 999 123-45-67.');
          return;
        }
        const id = await db.addClient({
          name,
          phone: ph.normalized,
          notes: root.querySelector('#w-new-notes')?.value?.trim(),
        });
        w.clientId = id;
        w.clientPickSource = 'new';
        delete w.serviceId;
        delete w.catalogServicePicked;
        delete w.serviceNameSnapshot;
        delete w.priceRub;
        delete w.plannedMinutes;
        delete w.serviceBasePriceRub;
        delete w.serviceBasePlannedMinutes;
        delete w.serviceAdjustNote;
        delete w.adjustingService;
        delete w.adjustReturnStep;
        w.difficulty = 2;
        w.tags = [];
        w.materialsPlan = [];
        w.step = 2;
        saveWizard(w);
        paint();
      });
      return;
    }

    if (step === 2) {
      const svcList = [...services].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'ru')
      );
      const selectedSvcId =
        w.catalogServicePicked && Number(w.serviceId) > 0 ? Number(w.serviceId) : 0;
      const listButtons = svcList
        .map((s) => {
          const sid = Number(s.id);
          const isSel = sid === selectedSvcId;
          return `<button type="button" class="card service-card${
            isSel ? ' is-selected' : ''
          }" style="width:100%;text-align:left" data-svc="${s.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;flex:1;min-width:0">${esc(s.name)}</div>
            ${
              isSel
                ? `<span class="badge ok" style="flex-shrink:0">Выбрано</span>`
                : ''
            }
          </div>
          <div class="status-line">${F.money(s.basePrice)}</div>
          <div class="status-line">${esc(F.minutesToLabel(Number(s.plannedMinutes) || 0))}</div>
        </button>`;
        })
        .join('');
      const catalogBlock = svcList.length
        ? `<div class="list-gap">${listButtons}</div>`
        : `<div class="card" style="text-align:center;padding:18px 12px;margin-bottom:12px"><p class="empty-hint" style="margin:0 0 14px;padding:0;line-height:1.4">У вас пока нет услуг в прайсе</p><button type="button" class="btn btn-primary" id="w-empty-add-service">+ Добавить услугу</button></div>`;

      const pricelistHint = `<p class="muted" style="font-size:0.82rem;margin:14px 0 0;line-height:1.45">
        Нет нужной услуги?
        <button type="button" class="btn btn-ghost w2-pricelist-link" style="display:inline;padding:4px 8px;width:auto;font-size:inherit;vertical-align:baseline">Добавить в прайс</button>
      </p>`;

      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-w-back>Назад</button></div>
        <div class="step-bar">Шаг 2 из 4 · Услуга</div>
        <h1 style="margin-top:0;font-size:1.35rem">Выберите услугу</h1>
        ${catalogBlock}
        ${svcList.length ? pricelistHint : ''}
        <div class="wizard-footer">
          <button type="button" class="btn btn-primary" id="w2-next">Далее</button>
        </div>
      </div>`;
      root.querySelector('#w-empty-add-service')?.addEventListener('click', () =>
        go('add-service?return=new')
      );
      root.querySelectorAll('.w2-pricelist-link').forEach((btn) => {
        btn.addEventListener('click', () => go('add-service?return=new'));
      });
      root.querySelectorAll('[data-svc]').forEach((b) => {
        b.addEventListener('click', async () => {
          const s = await db.getService(Number(b.getAttribute('data-svc')));
          if (!s || s.isActive === false) {
            toast('Этой услуги больше нет в прайсе — обновите экран или выберите другую');
            paint();
            return;
          }
          w.catalogServicePicked = true;
          w.serviceId = s.id;
          w.serviceNameSnapshot = s.name;
          w.serviceBasePriceRub = Number(s.basePrice) || 0;
          w.serviceBasePlannedMinutes = Math.max(0, Number(s.plannedMinutes) || 0);
          w.priceRub = s.basePrice;
          w.plannedMinutes = s.plannedMinutes;
          const d = Number(s.defaultDifficulty);
          w.difficulty =
            Number.isFinite(d) && d >= 1 && d <= 5 ? Math.round(d) : 2;
          delete w.adjustingService;
          delete w.adjustReturnStep;
          saveWizard(w);
          paint();
        });
      });
      root.querySelector('[data-w-back]')?.addEventListener('click', () => {
        delete w.serviceId;
        delete w.catalogServicePicked;
        delete w.adjustingService;
        delete w.adjustReturnStep;
        w.difficulty = 2;
        w.tags = [];
        w.materialsPlan = [];
        delete w.priceRub;
        delete w.plannedMinutes;
        delete w.serviceNameSnapshot;
        delete w.serviceBasePriceRub;
        delete w.serviceBasePlannedMinutes;
        delete w.serviceAdjustNote;
        w.step = 1;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w2-next')?.addEventListener('click', () => {
        if (!Number(w.serviceId) || !w.catalogServicePicked) {
          toast('Выберите услугу из прайса.');
          return;
        }
        w.step = 4;
        saveWizard(w);
        paint();
      });
      return;
    }

    if (step === 4) {
      const plan = w.materialsPlan || [];
      const byId = Object.fromEntries(materials.map((m) => [Number(m.id), m]));
      const usedIds = new Set(plan.map((p) => Number(p.materialId)));

      const planCardsHtml = plan
        .map((row) => {
          const mid = Number(row.materialId);
          const m = byId[mid];
          const qRaw = row.qty;
          const qtyVal =
            qRaw === '' || qRaw === undefined || qRaw === null ? '' : String(qRaw);

          if (!m) {
            return `<div class="card compact" data-plan-row="${mid}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600">Материал #${esc(String(mid))}</div>
                <p class="empty-hint" style="margin:6px 0 0;padding:0;text-align:left;font-size:0.88rem">Нет в справочнике — уберите из плана</p>
              </div>
              <button type="button" class="appt-delete-btn" aria-label="Убрать из плана" data-remove-plan-mat="${mid}"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
            </div>
          </div>`;
          }

          const u = m.unit || m.baseUnit || 'g';
          const planLabel = u === 'pcs' ? 'План, шт' : 'План, г';
          const safeVal = esc(qtyVal);
          const stockNum = Math.max(0, Number(m.stock) || 0);
          const warnZero =
            stockNum <= 0
              ? `<p class="muted" style="margin:6px 0 0;line-height:1.35;color:var(--warn)">Остаток материала на складе 0 ${esc(
                  unitCodeShort(u)
                )}. Проверьте план расхода.</p>`
              : '';
          return `<div class="card compact" data-plan-row="${mid}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">${esc(m.name)}</div>
              <div class="status-line">Остаток: ${esc(String(m.stock ?? 0))} ${esc(unitCodeShort(u))} · ${F.money(m.pricePerUnit)} за ${esc(unitCodePriceLabel(u))}</div>
              ${warnZero}
            </div>
            <button type="button" class="appt-delete-btn" aria-label="Убрать из плана" data-remove-plan-mat="${mid}"><span class="appt-delete-btn__ico" aria-hidden="true">🗑</span></button>
          </div>
          <label class="label" for="wm-plan-${mid}">${esc(planLabel)}</label>
          <input class="field" id="wm-plan-${mid}" type="number" min="0" step="1" max="${esc(
            String(stockNum)
          )}" value="${safeVal}" placeholder="0" />
        </div>`;
        })
        .join('');

      const pickCandidates = [...materials]
        .filter((m) => {
          const id = Number(m.id);
          if (!id || usedIds.has(id)) return false;
          if (m.isActive === false) return false;
          return (Number(m.stock) || 0) > 0;
        })
        .sort((a, b) => {
          return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });

      const pickListHtml =
        pickCandidates.length === 0
          ? '<p class="empty-hint" style="padding:16px 8px;text-align:center;margin:0;font-size:0.92rem">Все позиции уже в плане или справочник пуст. Добавьте материал на складе.</p>'
          : pickCandidates
              .map((m) => {
                const u = m.unit || m.baseUnit || 'g';
                const stk = Number(m.stock) || 0;
                return `<button type="button" class="mat-pick-item" data-w-pick-mat="${m.id}">
                <div style="font-weight:600">${esc(m.name)}</div>
                <div class="muted-line">Остаток: ${esc(String(stk))} ${esc(unitCodeShort(u))} · ${F.money(m.pricePerUnit)} за ${esc(unitCodePriceLabel(u))}</div>
              </button>`;
              })
              .join('');

      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-w-back>Назад</button></div>
        <div class="step-bar">Шаг 3 из 4 · Материалы</div>
        <h1 style="margin-top:0;font-size:1.35rem">План по материалам</h1>
        ${wizardServiceSummaryCard(w, true)}
        <p class="muted" style="line-height:1.45;margin-bottom:12px">Здесь указывается плановый расход. Фактическое списание произойдёт при завершении записи.</p>
        <button type="button" class="btn btn-secondary" style="width:100%" id="w-open-mat-pick">+ Добавить материал</button>
        <p class="muted" style="font-size:0.82rem;margin:10px 0 0">Нужна новая позиция? <button type="button" class="btn btn-ghost" style="display:inline;padding:4px 8px;width:auto;font-size:inherit;vertical-align:baseline" id="w-go-add-material-catalog">Добавить на склад</button></p>
        <div id="w-plan-cards" class="list-gap" style="margin-top:16px">${planCardsHtml}</div>
        <div class="wizard-footer"><button type="button" class="btn btn-primary" id="w4-next">Далее</button></div>
        <div id="w-mat-pick-sheet" class="mat-pick-sheet" aria-hidden="true" role="dialog" aria-labelledby="w-mat-pick-title">
          <div class="mat-pick-sheet-inner card">
            <div class="mat-pick-head">
              <strong id="w-mat-pick-title">Выберите материал для плана</strong>
              <button type="button" class="icon-btn" id="w-mat-pick-close" aria-label="Закрыть">✕</button>
            </div>
            <div class="mat-pick-list" id="w-mat-pick-list">${pickListHtml}</div>
            <button type="button" class="btn btn-secondary" style="width:100%" id="w-mat-pick-to-stock">Добавить новый материал на склад…</button>
          </div>
        </div>
      </div>`;

      const sheet = root.querySelector('#w-mat-pick-sheet');

      const openMatPick = () => {
        sheet?.classList.add('is-open');
        sheet?.setAttribute('aria-hidden', 'false');
      };
      const closeMatPick = () => {
        sheet?.classList.remove('is-open');
        sheet?.setAttribute('aria-hidden', 'true');
      };

      sheet?.querySelector('.mat-pick-sheet-inner')?.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      sheet?.addEventListener('click', (e) => {
        if (e.target === sheet) closeMatPick();
      });

      root.querySelector('#w-open-mat-pick')?.addEventListener('click', () => openMatPick());
      root.querySelector('#w-mat-pick-close')?.addEventListener('click', () => closeMatPick());

      root.querySelector('#w-go-add-material-catalog')?.addEventListener('click', () =>
        go('add-material?return=new')
      );
      root.querySelector('#w-mat-pick-to-stock')?.addEventListener('click', () => {
        closeMatPick();
        go('add-material?return=new');
      });

      root.querySelectorAll('[data-w-pick-mat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-w-pick-mat'));
          if (!id) return;
          const mRow = byId[id];
          if (!mRow || mRow.isActive === false || (Number(mRow.stock) || 0) <= 0) {
            toast('Этого материала нет на складе. Выберите материал с остатком больше 0.');
            return;
          }
          const cur = [...(w.materialsPlan || [])];
          if (cur.some((p) => Number(p.materialId) === id)) return;
          cur.push({ materialId: id, qty: '' });
          w.materialsPlan = cur;
          saveWizard(w);
          closeMatPick();
          paint();
        });
      });

      // Ограничение: план не может быть больше остатка на складе
      root.querySelector('#w-plan-cards')?.addEventListener('input', (ev) => {
        const el = ev.target;
        if (!(el instanceof HTMLInputElement)) return;
        if (!el.id || !el.id.startsWith('wm-plan-')) return;
        const mid = Number(el.id.slice('wm-plan-'.length));
        const m = byId[mid];
        if (!m) return;
        const max = Math.max(0, Number(m.stock) || 0);
        const valRaw = String(el.value ?? '').trim();
        if (!valRaw) return;
        const v = Math.max(0, Math.round(Number(valRaw) || 0));
        if (v > max) {
          toast('Недостаточно материала на складе. Проверьте остаток.');
          el.value = String(max);
        }
      });

      root.querySelector('#w-plan-cards')?.addEventListener('click', (ev) => {
        const rm = ev.target.closest('[data-remove-plan-mat]');
        if (!rm) return;
        const mid = Number(rm.getAttribute('data-remove-plan-mat'));
        w.materialsPlan = (w.materialsPlan || []).filter((p) => Number(p.materialId) !== mid);
        saveWizard(w);
        paint();
      });

      root.querySelector('[data-w-back]')?.addEventListener('click', () => {
        delete w.adjustingService;
        delete w.adjustReturnStep;
        w.step = 2;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w-open-adjust-service')?.addEventListener('click', () => {
        w.adjustingService = true;
        w.adjustReturnStep = 4;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w4-next')?.addEventListener('click', () => {
        const nextPlan = [];
        for (const row of w.materialsPlan || []) {
          const mid = Number(row.materialId);
          const el = root.querySelector(`#wm-plan-${mid}`);
          const qty = Number(el?.value) || 0;
          const m = byId[mid];
          const max = Math.max(0, Number(m?.stock) || 0);
          if (qty > max) {
            toast('Недостаточно материала на складе. Проверьте остаток.');
            return;
          }
          if (qty > 0) nextPlan.push({ materialId: mid, qty });
        }
        w.materialsPlan = nextPlan;
        w.step = 5;
        saveWizard(w);
        paint();
      });
      return;
    }

    if (step === 5) {
      const rawKey = appointmentDateKeyIso(w.date || F.todayISO());
      const dateIsoForUi = /^(\d{4})-(\d{2})-(\d{2})$/.test(rawKey) ? rawKey : F.todayISO();
      const dateStr = dateIsoForUi;
      const excludeId = Number(w.editingAppointmentId) || null;
      const initialBusyHtml = await htmlBusyDaySlotsBody(db, dateStr, excludeId);
      const fallbackTime = F.defaultNewAppointmentTimeHHMM(dateStr);
      if (w.time == null || String(w.time).trim() === '') {
        w.time = fallbackTime;
        saveWizard(w);
      }
      const tp = F.timeToHourAndQuarter(w.time);
      const hourOpts = Array.from({ length: 24 }, (_, i) => {
        const sel = i === tp.hours ? ' selected' : '';
        return `<option value="${i}"${sel}>${String(i).padStart(2, '0')}</option>`;
      }).join('');
      const minuteOpts = [0, 15, 30, 45]
        .map((v) => {
          const sel = v === tp.quarterMin ? ' selected' : '';
          return `<option value="${v}"${sel}>${String(v).padStart(2, '0')}</option>`;
        })
        .join('');
      const initialStatus = String(w.status || 'scheduled');
      const statusOpts = [
        ['scheduled', 'Запланирована'],
        ['cancelled', 'Отменена'],
        ['done', 'Завершена (посчитать прибыль)'],
      ]
        .map(([val, label]) => {
          const sel = val === initialStatus ? ' selected' : '';
          return `<option value="${val}"${sel}>${label}</option>`;
        })
        .join('');
      const headerTitle = w.editingAppointmentId ? 'Редактирование записи' : 'Дата и время';

      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-w-back>Назад</button></div>
        <div class="step-bar">Шаг 4 из 4 · Дата и время</div>
        <h1 style="margin-top:0;font-size:1.35rem">${headerTitle}</h1>
        ${wizardServiceSummaryCard(w, true)}
        <label class="label" for="w-date">Дата</label>
        <div class="date-overlay">
          <input class="field date-overlay__ui" id="w-date-ui" type="text" readonly value="${esc(
            F.formatDateRu(dateIsoForUi)
          )}" />
          <input class="field date-overlay__native" id="w-date" type="date" autocomplete="off" value="${esc(
            dateIsoForUi
          )}" aria-label="Дата" />
        </div>
        <div class="card compact" style="margin-top:14px">
          <div class="card-title">Занято в этот день</div>
          <div id="w-busy-slots-body">${initialBusyHtml}</div>
        </div>
        <p class="card-title" style="margin-top:14px">Время записи</p>
        <p class="muted" style="font-size:0.84rem;margin:0 0 10px;line-height:1.4">Без «до полудня» — только цифры. Часы от 00 до 23, минуты: 00, 15, 30 или 45.</p>
        <div class="row" style="align-items:flex-end">
          <div style="flex:1">
            <label class="label" for="w-th">Часы (0–23)</label>
            <select class="field" id="w-th">${hourOpts}</select>
          </div>
          <div style="flex:1">
            <label class="label" for="w-tm">Минуты</label>
            <select class="field" id="w-tm">${minuteOpts}</select>
          </div>
        </div>
        <label class="label" for="w-status" style="margin-top:14px">Статус записи</label>
        <select class="field" id="w-status">${statusOpts}</select>
        <label class="label" for="w-comment" style="margin-top:14px">Комментарий</label>
        <textarea class="field" id="w-comment" rows="3" placeholder="Например: клиент опоздал, попросила сделать плотнее">${esc(
          String(w.comment || w.serviceAdjustNote || '').trim()
        )}</textarea>
        <div class="wizard-footer">
          <button type="button" class="btn btn-primary" id="w5-save">Сохранить запись</button>
        </div>
      </div>`;
      const wDateEl = root.querySelector('#w-date');
      const wDateUi = root.querySelector('#w-date-ui');
      const wBusyBody = root.querySelector('#w-busy-slots-body');
      root.querySelector('.date-overlay')?.addEventListener('click', () => {
        try {
          wDateEl?.showPicker?.();
        } catch {}
        wDateEl?.focus?.();
      });
      let lastBusyDateKey = dateStr;
      const reloadWizardBusy = async () => {
        const raw = String(wDateEl?.value ?? '').trim();
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : F.parseDateRu(raw);
        const dk = iso || lastBusyDateKey;
        if (iso) lastBusyDateKey = iso;
        if (wDateUi) wDateUi.value = F.formatDateRu(dk);
        if (wBusyBody) wBusyBody.innerHTML = await htmlBusyDaySlotsBody(db, dk, excludeId);
      };
      wDateEl?.addEventListener('input', () => {
        void reloadWizardBusy();
      });
      wDateEl?.addEventListener('change', () => {
        void reloadWizardBusy();
      });
      root.querySelector('[data-w-back]')?.addEventListener('click', () => {
        const raw = String(root.querySelector('#w-date')?.value ?? '').trim();
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : F.parseDateRu(raw);
        if (!iso) {
          toast('Выберите дату в календаре.');
          return;
        }
        w.date = iso;
        w.time = F.hourMinuteToHHMM(
          root.querySelector('#w-th').value,
          root.querySelector('#w-tm').value
        );
        w.step = 4;
        delete w.adjustingService;
        delete w.adjustReturnStep;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w-open-adjust-service')?.addEventListener('click', () => {
        w.adjustingService = true;
        w.adjustReturnStep = 5;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w5-save')?.addEventListener('click', async () => {
        const dateRaw = String(root.querySelector('#w-date')?.value ?? '').trim();
        const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : F.parseDateRu(dateRaw);
        if (!dateIso) {
          toast('Выберите дату в календаре.');
          return;
        }
        const desiredStatus = String(root.querySelector('#w-status')?.value || 'scheduled');
        const svcIdCatalog =
          w.catalogServicePicked === false
            ? null
            : w.serviceId != null && Number(w.serviceId) > 0
              ? w.serviceId
              : null;
        const apptCore = {
          clientId: w.clientId,
          serviceId: svcIdCatalog,
          serviceNameSnapshot: w.serviceNameSnapshot,
          date: dateIso,
          time: F.hourMinuteToHHMM(
            root.querySelector('#w-th').value,
            root.querySelector('#w-tm').value
          ),
          difficulty: w.difficulty || 1,
          difficultyTags: w.tags || [],
          plannedMinutes: w.plannedMinutes || 120,
          priceRub: w.priceRub || 0,
          materialsPlan: w.materialsPlan || [],
          notes: String(root.querySelector('#w-comment')?.value || '').trim(),
        };

        const cid = Number(w.clientId);
        if (!Number.isFinite(cid) || cid <= 0) {
          toast('Сначала выберите клиента на первом шаге.');
          return;
        }
        const clientRow = await db.getClient(cid);
        if (!clientRow) {
          toast('Клиент не найден. Вернитесь к шагу «Клиент».');
          return;
        }
        const clientNameTrim = String(clientRow.name ?? '').trim();
        const clientPhoneTrim = String(clientRow.phone ?? '').trim();
        if (!clientNameTrim) {
          toast('Введите имя клиента.');
          return;
        }
        if (!clientPhoneTrim) {
          const phoneMsg =
            w.clientPickSource === 'new'
              ? 'Введите номер телефона клиента.'
              : 'У выбранного клиента не указан номер телефона. Добавьте телефон клиента.';
          toast(phoneMsg);
          return;
        }
        if (!F.validateClientPhoneRu(clientPhoneTrim).ok) {
          toast('Проверьте номер телефона. Для России нужно 11 цифр: например, 8 999 123-45-67.');
          return;
        }

        if (desiredStatus === 'scheduled' && F.isAppointmentStartInPastToday(apptCore.date, apptCore.time)) {
          toast('Вы выбрали время, которое уже прошло. Поставьте статус «Завершена» или измените время.');
          return;
        }

        const editingId = Number(w.editingAppointmentId) || null;
        const shouldCheckConflicts = desiredStatus === 'scheduled';
        if (shouldCheckConflicts) {
          const existing = await db.listAppointments();
          const conflictRow = pickConflictRowWithLatestEnd(apptCore, existing, editingId);
          if (conflictRow) {
            toastOverlapFromConflictRow(conflictRow);
            return;
          }
        }

        let savedId = editingId;
        if (editingId) {
          const fresh = await db.getAppointment(editingId);
          if (!fresh) {
            toast('Запись не найдена.');
            return;
          }
          await db.putAppointment({
            ...fresh,
            ...apptCore,
            status: desiredStatus === 'done' ? fresh.status || 'scheduled' : desiredStatus,
          });
        } else {
          const apptNew = {
            ...apptCore,
            prepaymentRub: 0,
            status: desiredStatus === 'done' ? 'scheduled' : desiredStatus,
            materialsFact: null,
            receivedRub: null,
            actualMinutes: null,
            actualStartAt: null,
            actualEndAt: null,
            materialCostRub: null,
            profitRub: null,
            completedAt: null,
          };
          savedId = await db.addAppointment(apptNew);
        }

        sessionStorage.removeItem(WIZARD_KEY);
        toast('Запись сохранена');
        if (desiredStatus === 'done' && savedId) {
          toast('Осталось нажать «Завершить», чтобы посчитать прибыль.');
          go(`complete-${savedId}?from=today`);
          return;
        }
        go('today');
      });
    }
  }

  await paint();
}

async function renderComplete(root, db, id, go, refresh, meta = {}, backTarget = 'today') {
  const ap = await db.getAppointment(Number(id));
  if (!ap) {
    root.innerHTML = `<div class="content empty-hint">Запись не найдена</div>`;
    return;
  }
  if (ap.status === 'done') {
    const client =
      ap.clientId != null ? await db.getClient(Number(ap.clientId)) : null;
    const clientName = esc(String(client?.name || 'Клиент').trim() || 'Клиент');
    const phoneTrim = String(client?.phone ?? '').trim();
    const phoneLine = phoneTrim
      ? `<p class="status-line">Телефон: ${esc(F.formatClientPhonePretty(phoneTrim))}</p>`
      : `<p class="status-line muted">Телефон не указан</p>`;
    const svc = esc(String(ap.serviceNameSnapshot || '—'));
    const whenLine = `${esc(F.formatDateRu(ap.date))} · ${esc(F.formatTime(ap.time))}`;
    const plannedLabel = esc(F.minutesToLabel(Number(ap.plannedMinutes) || 0));
    const actMin = Number(ap.actualMinutes);
    const actualLabel =
      Number.isFinite(actMin) && actMin > 0
        ? esc(F.minutesToLabel(actMin))
        : '—';
    const matRub = Number(ap.materialCostRub) || 0;
    const laborRub = Number(ap.laborCostRub) || 0;
    const fixedRub = Number(ap.orderFixedCostRub) || 0;
    const totalCogsRub = appointmentTotalCogs(ap);
    const profitVal = Number(ap.profitRub) || 0;
    const profitBlock =
      profitVal >= 0
        ? `<p class="status-line">Прибыль: <strong>${F.money(profitVal)}</strong></p>`
        : `<p class="status-line">Убыток: <strong>${F.money(Math.abs(profitVal))}</strong></p>`;

    root.innerHTML = `<div class="content">
      <div class="back-row"><a href="#${backTarget}" data-back>← Назад</a></div>
      <h1 style="font-size:1.25rem;margin-top:0">Завершённая запись</h1>
      <div class="card">
        <p class="status-line"><strong>Клиент:</strong> ${clientName}</p>
        ${phoneLine}
        <p class="status-line"><strong>Услуга:</strong> ${svc}</p>
        <p class="status-line"><strong>Дата и время записи:</strong> ${whenLine}</p>
        <p class="status-line"><strong>Плановое время:</strong> ${plannedLabel}</p>
        <p class="status-line"><strong>Фактическое время:</strong> ${actualLabel}</p>
        <p class="status-line"><strong>Оплачено клиентом:</strong> ${F.money(Number(ap.receivedRub) || 0)}</p>
      </div>
      <div class="card">
        <div class="card-title">Расчёт</div>
        <p class="status-line">Материалы: ${F.money(matRub)}</p>
        <p class="status-line">Работа: ${F.money(laborRub)}</p>
        <p class="status-line">Расходы на заказ: ${F.money(fixedRub)}</p>
        <p class="status-line" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
          Итоговая себестоимость: <strong>${F.money(totalCogsRub)}</strong></p>
        ${profitBlock}
      </div>
    </div>`;
    root.querySelector('[data-back]')?.addEventListener('click', (e) => {
      e.preventDefault();
      go(backTarget);
    });
    return;
  }

  const allMaterials = await db.listMaterials({ includeInactive: true });
  const allById = Object.fromEntries(allMaterials.map((m) => [Number(m.id), m]));
  const plan = ap.materialsPlan || [];
  const planQtyById = Object.fromEntries(
    plan.map((p) => [Number(p.materialId), Math.max(0, Number(p.qty) || 0)])
  );
  const defaultFact =
    ap.materialsFact && ap.materialsFact.length
      ? ap.materialsFact
      : plan.map((p) => ({ materialId: p.materialId, qty: Number(p.qty) || 0 }));
  const movementsSnap = await db.listMovements();
  const activeMaterials = allMaterials.filter((m) => m.isActive !== false);

  /** Порядок строк: как в плане, затем добавленные в факт. */
  function orderedFactMaterialIds(fact) {
    const inFact = new Set(fact.map((l) => Number(l.materialId)));
    const ordered = [];
    const seen = new Set();
    for (const p of plan) {
      const mid = Number(p.materialId);
      if (!mid || !inFact.has(mid)) continue;
      ordered.push(mid);
      seen.add(mid);
    }
    for (const l of fact) {
      const mid = Number(l.materialId);
      if (!mid || seen.has(mid)) continue;
      ordered.push(mid);
      seen.add(mid);
    }
    return ordered;
  }

  function linesHtml(fact) {
    const ids = orderedFactMaterialIds(fact);
    return ids
      .map((mid) => {
        const m = allById[mid];
        if (!m) {
          return `<div class="card compact" data-mat-row="${mid}">
          <div style="font-weight:600">Материал #${esc(String(mid))}</div>
          <p class="empty-hint" style="margin:8px 0">Нет в справочнике</p>
          <button type="button" class="btn btn-secondary" data-remove-mat="${mid}">Убрать из факта</button>
        </div>`;
        }
        const row = fact.find((x) => Number(x.materialId) === mid);
        const q = row != null ? row.qty : '';
        const valueStr = q === '' || q == null ? '' : String(Math.max(0, Number(q) || 0));
        const uMat = m.unit || m.baseUnit || 'g';
        const planQty = Math.max(0, Number(planQtyById[mid]) || 0);
        const planLine = planQtyById[mid] != null ? `План: ${planQty} ${unitCodeShort(uMat)}` : '';
        return `<div class="card compact c-mat-card" data-mat-row="${mid}">
        <div class="c-mat-card__head">
          <div class="c-mat-card__title">${esc(m.name)}</div>
          ${
            !plan.some((p) => Number(p.materialId) === mid)
              ? `<button type="button" class="c-mat-remove" data-remove-mat="${mid}" aria-label="Убрать из списка">×</button>`
              : ''
          }
        </div>
        ${planLine ? `<div class="status-line" style="margin:2px 0 8px">${esc(planLine)}</div>` : ''}
        <label class="label" for="cf-${mid}">Списать, ${esc(unitCodeShort(uMat))}</label>
        <input class="field" id="cf-${mid}" type="number" min="0" step="1" value="${esc(valueStr)}" placeholder="0" />
      </div>`;
      })
      .join('');
  }

  function buildAddMaterialPickerHtml(fact) {
    const used = new Set(fact.map((l) => Number(l.materialId)));
    const rest = activeMaterials.filter((m) => !used.has(Number(m.id)));
    if (!rest.length) {
      return '<p class="empty-hint" style="margin:0">Все активные материалы уже в списке</p>';
    }
    return rest
      .map(
        (m) =>
          `<button type="button" class="card client-card" style="width:100%;text-align:left;padding:12px;margin-bottom:8px;border:none;cursor:pointer" data-pick-extra-mat="${m.id}">
        <div style="font-weight:600">${esc(m.name)}</div>
        <div class="status-line">${esc(unitCodeShort(m.unit || m.baseUnit || 'g'))} · ${F.money(m.pricePerUnit)} за ${esc(unitCodePriceLabel(m.baseUnit || m.unit || 'g'))}</div>
      </button>`
      )
      .join('');
  }

  function computeCost(fact) {
    let cost = 0;
    for (const line of fact) {
      const m = allById[Number(line.materialId)];
      if (!m) continue;
      const unit = db.costUnitPriceFromMovements(
        line.materialId,
        movementsSnap,
        m.pricePerUnit
      );
      cost += (Number(line.qty) || 0) * unit;
    }
    return Math.round(cost);
  }

  function readFactLinesFromDom() {
    const rows = root.querySelectorAll('#c-mats [data-mat-row]');
    const out = [];
    for (const card of rows) {
      const mid = Number(card.getAttribute('data-mat-row'));
      if (!mid) continue;
      const inp = card.querySelector('input');
      if (!inp) continue;
      const raw = inp.value ?? '';
      const qty = raw === '' ? 0 : Number(raw) || 0;
      out.push({ materialId: mid, qty });
    }
    return out;
  }

  const mergedInit = [];
  const seenInit = new Set();
  for (const l of defaultFact) {
    const mid = Number(l.materialId);
    if (!mid || seenInit.has(mid)) continue;
    seenInit.add(mid);
    mergedInit.push({ materialId: mid, qty: Number(l.qty) || 0 });
  }
  let factLines = mergedInit;
  const [hourlyDb, fixedDb] = await Promise.all([
    db.getMeta('masterHourlyRateRub'),
    db.getMeta('orderFixedCostRub'),
  ]);
  const hourlyRate = Math.max(
    0,
    Number(hourlyDb ?? meta?.masterHourlyRateRub) || 0
  );
  const fixedOrder = Math.max(
    0,
    Number(fixedDb ?? meta?.orderFixedCostRub) || 0
  );
  const pm = ap.plannedMinutes || 120;
  const ah = Math.floor(pm / 60);
  const am = pm % 60;
  const payDraftKey = `kosoCompletePaid:${ap.id}`;
  function initialPaidFieldValue() {
    const draft = sessionStorage.getItem(payDraftKey);
    if (draft !== null && draft !== '') return draft;
    const prep = Number(ap.prepaymentRub);
    if (prep > 0) return String(Math.round(prep));
    return '';
  }
  const paidFieldValue = initialPaidFieldValue();
  const initialPaidNum = paidFieldValue === '' ? 0 : Number(paidFieldValue) || 0;
  const priceListHint = F.money(Number(ap.priceRub) || 0);
  const initialMatCost = computeCost(factLines);
  const initialActualMin = F.parseMinutesFromFields(String(ah), String(am));
  const initialLaborCost = Math.round((initialActualMin / 60) * hourlyRate);
  const initialTotalCogs = initialMatCost + initialLaborCost + fixedOrder;
  const initialProfit = initialPaidNum - initialTotalCogs;
  const initialLabHint = `${initialActualMin} мин × ${F.money(hourlyRate)}/ч`;
  const wearDaysInitRaw = Number(ap.wearDays);
  const wearDaysInitial = Number.isFinite(wearDaysInitRaw) && wearDaysInitRaw > 0 ? String(Math.round(wearDaysInitRaw)) : '';
  const remindInitRaw = Number(ap.remindBeforeDays);
  const remindBeforeInitial =
    Number.isFinite(remindInitRaw) && remindInitRaw >= 0 ? String(Math.round(remindInitRaw)) : '3';
  const reminderCommentInitial = String(ap.reminderComment || '');

  root.innerHTML = `<div class="content">
    <div class="back-row"><a href="#${backTarget}" data-back>← Назад</a></div>
    <h1 style="font-size:1.25rem;margin-top:0">Завершение записи</h1>
    <p class="muted">${esc(ap.serviceNameSnapshot || '')}</p>

    <label class="label" for="c-act-h">Фактическое время</label>
    <div class="row">
      <input class="field" id="c-act-h" type="number" min="0" value="${ah}" />
      <input class="field" id="c-act-m" type="number" min="0" step="5" value="${am}" />
    </div>

    <h2 style="font-size:1rem;margin:16px 0 8px">Фактический расход материалов</h2>
    <p class="status-line" style="margin:-4px 0 10px">Проверьте плановый расход и укажите, сколько материала ушло по факту.</p>
    <button type="button" class="btn btn-secondary" id="c-add-material" style="margin-bottom:8px">+ Уточнить расход</button>
    <div id="c-add-mat-picker" style="display:none;margin-bottom:12px" class="list-gap"></div>
    <div id="c-mats">${linesHtml(factLines)}</div>

    <p class="muted" style="font-size:0.9rem;margin:16px 0 6px;line-height:1.4">Цена по прайсу: ${priceListHint}</p>
    <label class="label" for="c-paid">Оплачено клиентом (всего)</label>
    <input class="field" id="c-paid" type="number" min="0" step="1" value="${esc(paidFieldValue)}" placeholder="0" inputmode="decimal" />

    <div class="card" id="c-sum">
      <div class="card-title">Расчёт</div>
      <p class="status-line">Материалы: <strong id="c-cost-mat">${F.money(initialMatCost)}</strong></p>
      <p class="status-line">Работа (часы × ставка): <strong id="c-cost-lab">${F.money(initialLaborCost)}</strong>
        <span id="c-lab-detail" class="muted" style="font-size:0.82rem"> (${initialLabHint})</span></p>
      <p class="status-line">Расходы на заказ: <strong id="c-cost-fix">${F.money(fixedOrder)}</strong></p>
      <p class="status-line" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        Итоговая себестоимость: <strong id="c-cost-total">${F.money(initialTotalCogs)}</strong></p>
      <p class="status-line">Прибыль (оплата − себестоимость): <strong id="c-profit" class="${
        initialProfit >= 0 ? 'profit-pos' : 'profit-neg'
      }">${F.money(initialProfit)}</strong></p>
    </div>

    <div class="card compact" id="c-reminder">
      <div class="card-title">Напоминание о расплете</div>
      <label class="label" for="c-wear-days">Срок носки, дней</label>
      <input class="field" id="c-wear-days" type="number" min="0" step="1" value="${esc(wearDaysInitial)}" placeholder="Например: 7" />
      <label class="label" for="c-remind-before">Напомнить за, дней</label>
      <input class="field" id="c-remind-before" type="number" min="0" step="1" value="${esc(remindBeforeInitial)}" placeholder="3" />
      <label class="label" for="c-reminder-comment">Комментарий</label>
      <textarea class="field" id="c-reminder-comment" rows="3" placeholder="Необязательно">${esc(reminderCommentInitial)}</textarea>
      <p class="muted" style="font-size:0.82rem;margin:-6px 0 0;line-height:1.45">Например: написать клиенту за несколько дней до расплета.</p>
      <p class="muted" style="font-size:0.82rem;margin:6px 0 0;line-height:1.45">Укажите срок носки, если хотите создать напоминание о расплете.</p>
    </div>

    <button type="button" class="btn btn-primary" id="c-done">Завершить и списать</button>
  </div>`;

  const paidEl = root.querySelector('#c-paid');
  const matsRoot = root.querySelector('#c-mats');

  function readActualMinutesFromDom() {
    return F.parseMinutesFromFields(
      root.querySelector('#c-act-h').value,
      root.querySelector('#c-act-m').value
    );
  }

  function recalc() {
    factLines = readFactLinesFromDom();
    const matCost = computeCost(factLines);
    const actualMin = readActualMinutesFromDom();
    const laborCost = Math.round((actualMin / 60) * hourlyRate);
    const totalCogs = matCost + laborCost + fixedOrder;
    const paid = Number(paidEl.value) || 0;
    root.querySelector('#c-cost-mat').textContent = F.money(matCost);
    root.querySelector('#c-cost-lab').textContent = F.money(laborCost);
    const detailEl = root.querySelector('#c-lab-detail');
    if (detailEl)
      detailEl.textContent = ` (${actualMin} мин × ${F.money(hourlyRate)}/ч)`;
    root.querySelector('#c-cost-fix').textContent = F.money(fixedOrder);
    root.querySelector('#c-cost-total').textContent = F.money(totalCogs);
    const prof = paid - totalCogs;
    const pel = root.querySelector('#c-profit');
    pel.textContent = F.money(prof);
    pel.className = prof >= 0 ? 'profit-pos' : 'profit-neg';
  }

  function paintMats() {
    if (!matsRoot) return;
    matsRoot.innerHTML = linesHtml(factLines);
  }

  matsRoot?.addEventListener('input', (e) => {
    if (e.target?.tagName === 'INPUT') recalc();
  });
  root.querySelector('#c-act-h')?.addEventListener('input', recalc);
  root.querySelector('#c-act-m')?.addEventListener('input', recalc);
  matsRoot?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-mat]');
    if (!b) return;
    e.preventDefault();
    const mid = Number(b.getAttribute('data-remove-mat'));
    factLines = factLines.filter((l) => Number(l.materialId) !== mid);
    paintMats();
    recalc();
  });

  paidEl?.addEventListener('input', () => {
    sessionStorage.setItem(payDraftKey, paidEl.value);
    recalc();
  });

  root.querySelector('#c-add-material')?.addEventListener('click', () => {
    const picker = root.querySelector('#c-add-mat-picker');
    if (!picker) return;
    factLines = readFactLinesFromDom();
    const isOpen = picker.style.display !== 'none';
    if (isOpen) {
      picker.style.display = 'none';
      picker.innerHTML = '';
      return;
    }
    picker.innerHTML = buildAddMaterialPickerHtml(factLines);
    picker.style.display = 'block';
    picker.querySelectorAll('[data-pick-extra-mat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mid = Number(btn.getAttribute('data-pick-extra-mat'));
        if (factLines.some((l) => Number(l.materialId) === mid)) return;
        factLines.push({ materialId: mid, qty: 0 });
        paintMats();
        picker.style.display = 'none';
        picker.innerHTML = '';
        recalc();
      });
    });
  });

  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go(backTarget);
  });

  root.querySelector('#c-done')?.addEventListener('click', async () => {
    factLines = readFactLinesFromDom();
    const actualMinutes = readActualMinutesFromDom();
    const next = factLines.filter((l) => (Number(l.qty) || 0) > 0 && allById[Number(l.materialId)]);
    for (const l of next) {
      const m = allById[Number(l.materialId)];
      if (!m) continue;
      const want = Math.max(0, Number(l.qty) || 0);
      const have = Math.max(0, Number(m.stock) || 0);
      if (want > have) {
        toast('Недостаточно материала на складе. Проверьте остаток.');
        return;
      }
    }
    const paid = Number(paidEl.value) || 0;
    const materialsCostRub = computeCost(next);
    const laborCostRub = Math.round((actualMinutes / 60) * hourlyRate);
    const orderFixedCostRub = fixedOrder;
    const totalCogsRub = materialsCostRub + laborCostRub + orderFixedCostRub;
    const profitRub = paid - totalCogsRub;
    const wearDaysRaw = String(root.querySelector('#c-wear-days')?.value ?? '').trim();
    const remindRaw = String(root.querySelector('#c-remind-before')?.value ?? '').trim();
    const reminderComment = String(root.querySelector('#c-reminder-comment')?.value ?? '').trim();
    const wearDays = wearDaysRaw === '' ? null : Math.max(0, Math.round(Number(wearDaysRaw) || 0));
    const remindBeforeDays = remindRaw === '' ? 3 : Math.max(0, Math.round(Number(remindRaw) || 0));
    await db.completeAppointment(ap.id, {
      actualMinutes,
      materialsFact: next,
      receivedRub: paid,
      materialsCostRub,
      laborCostRub,
      orderFixedCostRub,
      totalCogsRub,
      materialCostRub: materialsCostRub,
      profitRub,
      wearDays,
      remindBeforeDays,
      reminderComment,
    });
    sessionStorage.removeItem(payDraftKey);
    toast('Списание выполнено');
    await refresh();
    go('today');
  });

  recalc();
}
