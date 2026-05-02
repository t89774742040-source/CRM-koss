import * as License from './license.js';
import * as F from './format.js';

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

const STATUS = {
  scheduled: 'Запланировано',
  in_progress: 'В работе',
  done: 'Завершено',
  cancelled: 'Отмена',
};

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

function unitCodeLabel(unitCode) {
  return unitCode === 'pcs' ? 'штуки' : 'граммы';
}

function unitCodeShort(unitCode) {
  return unitCode === 'pcs' ? 'шт' : 'г';
}

function unitCodePriceLabel(unitCode) {
  return unitCode === 'pcs' ? 'штуку' : 'грамм';
}

function parseRoute(r) {
  const base = (r || 'today').split('?')[0];
  if (base.startsWith('client-')) return { view: 'client', id: base.slice(7) };
  if (base.startsWith('material-')) return { view: 'material', id: base.slice(9) };
  if (base.startsWith('complete-')) return { view: 'complete', id: base.slice(9) };
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
    parsed.view === 'complete' ||
    parsed.view === 'purchase' ||
    parsed.view === 'add-material' ||
    parsed.view === 'add-service';

  const activeNav =
    parsed.view === 'client'
      ? 'clients'
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
  } else if (parsed.view === 'complete') {
    await renderComplete(root, db, parsed.id, go, refresh);
  } else {
    root.innerHTML = await renderToday(db, meta, go);
  }

  wireImport(ctx);
}

function renderOnboarding() {
  return `<div class="ob-root">
    <div style="font-size:3rem;margin-bottom:8px" aria-hidden="true">🪢</div>
    <h1>Косоплетение CRM</h1>
    <p>Бесплатный демо-доступ на 3 дня. Записи, материалы и прибыль — в одном месте, с телефона.</p>
    <button type="button" class="btn btn-primary" id="ob-start">Начать демо</button>
    <p class="muted" style="margin-top:20px">Уже есть код?</p>
    <input type="text" class="field" id="ob-code" placeholder="Код активации" autocomplete="off" />
    <button type="button" class="btn btn-secondary" id="ob-activate">Активировать</button>
  </div>`;
}

export function attachOnboarding(shell, db, go, refresh) {
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
        toast('Код не подходит');
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
    <h1 style="text-align:center">Демо закончилось</h1>
    <p class="muted" style="text-align:center">Введите код активации, чтобы продолжить. Данные в телефоне сохраняются.</p>
    <label class="label" for="lk-code">Код активации</label>
    <input class="field" id="lk-code" placeholder="Например: KOSO-FULL-2026" />
    <button type="button" class="btn btn-primary" id="lk-btn">Активировать</button>
  </div>`;
}

export function attachLock(shell, db, go, refresh) {
  const btn = shell.querySelector('#lk-btn');
  const code = shell.querySelector('#lk-code');
  if (btn) {
    btn.onclick = async () => {
      const ok = await License.activateWithCode(db, code.value);
      if (!ok) {
        toast('Код не подходит');
        return;
      }
      await refresh();
      go('today');
    };
  }
}

async function renderToday(db, meta, go) {
  const t = F.todayISO();
  const [appointments, clients] = await Promise.all([
    db.listAppointments(),
    db.listClients(),
  ]);
  const day = appointments.filter((a) => a.date === t);
  const dayForLoad = day.filter((a) => a.status !== 'cancelled');
  const name = (await db.getMeta('masterName')) || 'Мастер';
  const doneToday = day.filter((a) => a.status === 'done');
  const rev = doneToday.reduce((s, a) => s + (Number(a.receivedRub) || 0), 0);
  const profit = doneToday.reduce((s, a) => s + (Number(a.profitRub) || 0), 0);
  const matCost = doneToday.reduce((s, a) => s + (Number(a.materialCostRub) || 0), 0);
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
    const unfinishedInWindow = timedRows.filter(
      ({ a, startMs, endMs }) =>
        a.status !== 'done' &&
        startMs <= nowMs &&
        nowMs <= endMs
    );
    unfinishedInWindow.sort((x, y) => x.startMs - y.startMs);

    const futureScheduled = timedRows.filter(
      ({ a, startMs }) => a.status === 'scheduled' && startMs > nowMs
    );
    futureScheduled.sort((x, y) => x.startMs - y.startMs);

    if (unfinishedInWindow.length) {
      const { a, endMs } = unfinishedInWindow[0];
      const cName = clientMap[a.clientId]?.name || 'Клиент';
      const until = F.msToClockHHMM(endMs);
      nextScheduleLine = `<p class="status-line" style="margin:10px 0 0;font-size:0.9rem;font-weight:600;color:var(--accent)">Сейчас: ${esc(cName)} (до ${esc(until)})</p>`;
    } else if (futureScheduled.length) {
      const hh = F.clockHHMM(futureScheduled[0].a.time);
      nextScheduleLine = `<p class="status-line" style="margin:10px 0 0;font-size:0.9rem">Следующая: ${esc(hh)}</p>`;
    } else {
      nextScheduleLine =
        '<p class="status-line" style="margin:10px 0 0;font-size:0.9rem">На сегодня всё выполнено</p>';
    }
  }

  const sorted = [...day].sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const trialLeft = License.isActivated(meta)
    ? null
    : License.trialDaysLeft(meta);

  const cards = sorted.length
    ? sorted
        .map((a) => {
          const c = clientMap[a.clientId];
          const visits = appointments.filter((x) => x.clientId === a.clientId).length;
          const star = visits > 1 ? '<span class="badge" title="Повторный">⭐</span>' : '';
          return `<article class="card record-card" data-open="${a.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div><strong>${esc(F.formatTime(a.time))}</strong> · ${esc(c?.name || 'Клиент')} ${star}</div>
            <span class="badge ok">${esc(STATUS[a.status] || a.status)}</span>
          </div>
          <div style="margin-top:6px;font-weight:600">${esc(a.serviceNameSnapshot || '')}</div>
          <div class="status-line">План: ${esc(F.minutesToLabel(a.plannedMinutes))} · Сложн.: ${a.difficulty || '—'}</div>
          ${
            a.status !== 'done'
              ? `<div style="margin-top:10px;display:flex;gap:8px">
              <button type="button" class="btn btn-secondary" style="padding:10px" data-inprog="${a.id}">В работе</button>
              <button type="button" class="btn btn-primary" style="padding:10px" data-done="${a.id}">Завершить</button>
            </div>`
              : `<div class="status-line">Оплачено: ${F.money(a.receivedRub || 0)} · Прибыль: ${F.money(a.profitRub || 0)}</div>`
          }
        </article>`;
        })
        .join('')
    : `<div class="empty-hint">На сегодня записей нет.<br />Добавьте первую запись.</div>`;

  return `<header class="page-header">
    <div>
      <h1>Привет, ${esc(name)}</h1>
      <p class="sub">${esc(F.formatDateISO(t))}</p>
    </div>
    <button type="button" class="icon-btn" id="open-settings" aria-label="Настройки">⚙️</button>
  </header>
  ${trialLeft != null ? `<div class="trial-pill">Демо: осталось ${trialLeft} дн.</div>` : ''}
  <div class="content">
    <div class="card">
      <div class="card-title">Сегодня</div>
      <p class="stat-big">${day.length} записей</p>
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
          <div class="card-title">Материалы (факт)</div>
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
    <h2 style="margin:20px 0 10px;font-size:1rem">Записи на сегодня</h2>
    <div class="list-gap">${cards}</div>
  </div>`;
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
      go(`complete-${id}`);
    });
  });
  root.querySelectorAll('[data-inprog]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(b.getAttribute('data-inprog'));
      const a = await db.getAppointment(id);
      if (a) {
        a.status = 'in_progress';
        await db.putAppointment(a);
        await refresh();
        go('today');
      }
    });
  });
  root.querySelectorAll('[data-done]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.getAttribute('data-done');
      go(`complete-${id}`);
    });
  });
}

async function renderRecords(db, go) {
  const [appointments, clients] = await Promise.all([db.listAppointments(), db.listClients()]);
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));
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
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-weight:700">${esc(F.formatDateISO(a.date))} · ${esc(F.formatTime(a.time))}</div>
              <div class="status-line">${esc(c?.name || 'Клиент')}</div>
            </div>
            <span class="badge">${esc(STATUS[a.status] || a.status)}</span>
          </div>
          <div style="margin-top:8px;font-weight:600">${esc(a.serviceNameSnapshot || '')}</div>
          <div class="status-line">${F.money(a.priceRub || 0)} · сложн. ${a.difficulty || '—'}</div>
        </article>`;
        })
        .join('')
    : `<div class="empty-hint">Записей пока нет</div>`;

  return `<header class="page-header">
    <div><h1>Записи</h1><p class="sub">Все визиты</p></div>
  </header>
  <div class="content list-gap">${html}</div>`;
}

export function attachRecords(shell, db, go) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelectorAll('[data-rec]').forEach((el) => {
    el.addEventListener('click', () => go(`complete-${el.getAttribute('data-rec')}`));
  });
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
          return `<article class="card client-card" data-client="${c.id}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:700">${esc(c.name || 'Без имени')}</div>
            ${star}
          </div>
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
      <div style="font-weight:600">${esc(F.formatDateISO(a.date))} · ${esc(a.serviceNameSnapshot || '')}</div>
      <div class="status-line">${F.money(a.receivedRub || a.priceRub || 0)} · прибыль ${F.money(a.profitRub || 0)}</div>
    </div>`;
    })
    .join('');

  return `<div class="content">
    <div class="back-row"><a href="#clients" data-back>← Назад</a></div>
    <header class="page-header" style="padding-left:0;padding-right:0">
      <div>
        <h1>${esc(client.name)}</h1>
        <p class="sub">${star}</p>
      </div>
    </header>
    <div class="card">
      <div class="card-title">Контакты</div>
      <p style="margin:0 0 6px">${esc(client.phone || '—')}</p>
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
      <p style="margin:0;white-space:pre-wrap">${esc(client.notes || '—')}</p>
    </div>
    <h2 style="font-size:1rem;margin:16px 0 8px">История</h2>
    ${hist || '<p class="muted">Пока нет записей</p>'}
    <button type="button" class="btn btn-primary" style="margin-top:16px" id="cd-new">＋ Новая запись</button>
  </div>`;
}

export function attachClientDetail(shell, go, id) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('clients');
  });
  root.querySelector('#cd-new')?.addEventListener('click', () => {
    sessionStorage.setItem(
      WIZARD_KEY,
      JSON.stringify({
        step: 2,
        clientId: Number(id),
        materialsPlan: [],
        difficulty: 2,
        tags: [],
      })
    );
    go('new');
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
            <button type="button" class="icon-btn" data-del-mat="${m.id}" title="Удалить" aria-label="Удалить">🗑️</button>
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
      <button type="button" class="btn btn-secondary" id="btn-purchase">＋ Приход</button>
      <button type="button" class="btn btn-secondary" id="btn-add-mat">＋ Материал</button>
    </div>
    <button type="button" class="btn btn-secondary" id="btn-cleanup-test-mat">Очистить тестовые материалы</button>
    <div class="list-gap">${html}</div>
  </div>`;
}

export function attachMaterials(shell, db, go) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('#btn-purchase')?.addEventListener('click', () => go('purchase'));
  root.querySelector('#btn-add-mat')?.addEventListener('click', () => go('add-material'));
  root.querySelector('#btn-add-mat-empty')?.addEventListener('click', () => go('add-material'));
  root.querySelectorAll('[data-open-material]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-mat]')) return;
      go(`material-${card.getAttribute('data-open-material')}`);
    });
  });

  root.querySelectorAll('[data-del-mat]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Убрать материал из списка?')) return;
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
    <button type="button" class="btn btn-primary" id="md-purchase">＋ Приход</button>
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
  if (!materials.length) {
    return `<div class="content">
      <div class="back-row"><a href="#materials" data-back>← Материалы</a></div>
      <h1 style="margin:0 0 16px;font-size:1.35rem">Приход материала</h1>
      <div class="card" style="text-align:center">
        <p class="empty-hint" style="padding:8px 0;margin:0">У вас пока нет материалов</p>
        <button type="button" class="btn btn-primary" id="pm-go-add">＋ Добавить материал</button>
      </div>
    </div>`;
  }
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

  const opts = materials
    .map((m) => {
      const pSize = packSizeDefaultAttr(m);
      const pPrice = packPriceDefaultAttr(m);
      return `<option value="${m.id}" data-price="${
        Number(m.pricePerUnit) || 0
      }" data-unit="${esc(m.unit || 'g')}" data-pack-price="${pPrice}" data-pack-size="${pSize}" ${
        preselectedMaterialId && String(m.id) === String(preselectedMaterialId) ? 'selected' : ''
      }>${esc(m.name)}</option>`;
    })
    .join('');
  const selectedMat =
    materials.find((m) => String(m.id) === String(preselectedMaterialId)) || null;
  const firstPrice = Number(selectedMat?.pricePerUnit) || 0;
  const firstUnit = selectedMat?.unit || 'g';
  const firstLabels = purchaseFieldLabels(firstUnit);
  const defaultPackSize = packSizeDefaultAttr(selectedMat);
  const defaultPacks = 1;
  const firstPricePerPack = packPriceDefaultAttr(selectedMat);
  return `<div class="content">
    <div class="back-row"><a href="#materials" data-back>← Материалы</a></div>
    <h1 style="margin:0 0 16px;font-size:1.35rem">Приход материала</h1>
    <p class="muted" style="margin:-4px 0 12px">Приход вводится пачками/упаковками. На склад и в списание идут граммы или штуки.</p>
    <label class="label" for="pm-m">Материал</label>
    <select class="field" id="pm-m">
      ${
        preselectedMaterialId
          ? ''
          : '<option value="" selected disabled>Выберите материал</option>'
      }
      ${opts}
    </select>
    <p class="status-line" id="pm-unit-line">${
      preselectedMaterialId ? `Учёт ведётся в: ${esc(firstLabels.unitLabel)}` : 'Выберите материал'
    }</p>
    <p class="status-line" id="pm-price-line">${
      preselectedMaterialId
        ? `Последняя закупка: ${F.money(firstPrice)} за ${esc(firstLabels.unitPriceWord)}`
        : 'Сначала выберите материал'
    }</p>

    <div class="card compact" id="pm-override-row" style="margin-bottom:14px;${preselectedMaterialId ? '' : 'display:none'}">
      <label class="checkbox-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:500">
        <input type="checkbox" id="pm-pack-override" ${preselectedMaterialId ? '' : 'disabled'} />
        Параметры закупки отличаются
      </label>
      <p class="status-line" style="margin:8px 0 0">Можно изменить размер и цену упаковки именно этой партии (в карточке останутся стандартные значения).</p>
    </div>

    <div id="pm-packs-block">
      <label class="label" id="pm-pack-count-label" for="pm-pack-count">${esc(firstLabels.packCountLabel)}</label>
      <input class="field" id="pm-pack-count" type="number" inputmode="decimal" min="0" step="1" value="${defaultPacks}" ${preselectedMaterialId ? '' : 'disabled'} />
      <label class="label" id="pm-pack-size-label" for="pm-pack-weight">${esc(firstLabels.packSizeLabel)}</label>
      <input class="field" id="pm-pack-weight" type="number" inputmode="decimal" min="0" step="1" value="${defaultPackSize}" ${preselectedMaterialId ? '' : 'disabled'} />
      <label class="label" id="pm-pack-price-label" for="pm-pack-price">${esc(firstLabels.packPriceLabel)}</label>
      <input class="field" id="pm-pack-price" type="number" inputmode="decimal" min="0" step="1" value="${Math.round(firstPricePerPack)}" ${preselectedMaterialId ? '' : 'disabled'} />
    </div>

    <div class="card compact">
      <div class="card-title">Автоматический расчёт</div>
      <p class="status-line">Итого на склад: <strong id="pm-total-grams">${defaultPackSize}</strong> <span id="pm-stock-unit-suffix">${esc(firstLabels.stockSuffix)}</span></p>
      <p class="status-line">Цена списания: <strong id="pm-price-per-gram">${F.money(firstPrice)}</strong> <span id="pm-cost-unit-suffix">${esc(firstLabels.costSuffix)}</span></p>
    </div>

    <label class="label" for="pm-s">Поставщик</label>
    <input class="field" id="pm-s" placeholder="Например: WB" />
    <label class="label" for="pm-d">Дата</label>
    <input class="field" id="pm-d" type="date" value="${F.todayISO()}" />
    <label class="label" for="pm-n">Комментарий</label>
    <textarea class="field" id="pm-n" placeholder="Необязательно"></textarea>
    <button type="button" class="btn btn-primary" id="pm-save" ${preselectedMaterialId ? '' : 'disabled'}>Сохранить приход</button>
  </div>`;
}

export function attachPurchase(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  root.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    go('materials');
  });
  root.querySelector('#pm-go-add')?.addEventListener('click', () => go('add-material'));
  const matSelect = root.querySelector('#pm-m');
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

  const applyPurchaseOverrideUI = () => {
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

  const syncMaterialMeta = () => {
    const opt = matSelect?.selectedOptions?.[0];
    if (!opt || !opt.value) {
      setMaterialChosenState(false);
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
  };

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

  matSelect?.addEventListener('change', syncMaterialMeta);
  overrideChk?.addEventListener('change', () => {
    if (!overrideChk.checked) syncPackFieldsFromMaterialOption();
    applyPurchaseOverrideUI();
    recalcPurchaseTotals();
  });
  packCountEl?.addEventListener('input', recalcPurchaseTotals);
  packWeightEl?.addEventListener('input', recalcPurchaseTotals);
  packPriceEl?.addEventListener('input', recalcPurchaseTotals);

  syncMaterialMeta();

  root.querySelector('#pm-save')?.addEventListener('click', async () => {
    const materialId = root.querySelector('#pm-m').value;
    if (!materialId) {
      toast('Выберите материал');
      return;
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

    const supplier = root.querySelector('#pm-s').value;
    const date = root.querySelector('#pm-d').value;
    const note = root.querySelector('#pm-n').value;
    await db.stockPurchase({
      materialId,
      qty,
      unitPrice,
      supplier,
      date,
      note,
      purchasePackPrice: priceOnePack,
      purchasePackSize: sizeOnePack,
      purchasePackCount: packsIn,
      purchasePackParamsDiffer: !!(overrideChk?.checked),
    });
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
  const firstType = MATERIAL_TYPES[0];
  const isWeight = WEIGHT_TYPES.has(firstType);
  return `<div class="content">
    <div class="back-row"><a href="${fromWizard ? '#new' : '#materials'}" data-back>${fromWizard ? '← К записи' : '← Материалы'}</a></div>
    <h1 style="margin:0 0 16px;font-size:1.35rem">Новый материал</h1>
    <label class="label" for="nm-name">Название</label>
    <input class="field" id="nm-name" placeholder="Например: Канекалон" />
    <label class="label" for="nm-type">Тип материала</label>
    <select class="field" id="nm-type">${typeOptions}</select>
    <p class="status-line" id="nm-base-unit">Базовая единица: ${isWeight ? 'граммы' : 'штуки'}</p>
    <label class="label" for="nm-pack-price">Цена за упаковку (пачку)</label>
    <input class="field" id="nm-pack-price" type="number" min="0" step="1" value="0" />
    <label class="label" id="nm-pack-size-label" for="nm-pack-weight">${isWeight ? 'Вес упаковки (граммы)' : 'Количество в упаковке (шт)'}</label>
    <input class="field" id="nm-pack-weight" type="number" min="0" step="1" value="100" />
    <p class="status-line" id="nm-gram-price-preview">≈ 0 ₽ за ${isWeight ? 'грамм' : 'штуку'} (расчет)</p>
    <label class="label" id="nm-min-label" for="nm-min">Минимум (${isWeight ? 'граммы' : 'шт'})</label>
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
  const baseUnitEl = root.querySelector('#nm-base-unit');
  const packSizeLabelEl = root.querySelector('#nm-pack-size-label');
  const minLabelEl = root.querySelector('#nm-min-label');
  let unitCode = 'g';

  const syncTypeUi = () => {
    const type = typeEl?.value || 'прочее';
    const isWeight = WEIGHT_TYPES.has(type);
    unitCode = isWeight ? 'g' : 'pcs';
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
  typeEl?.addEventListener('change', syncTypeUi);
  packPriceEl?.addEventListener('input', recalcGramPrice);
  packWeightEl?.addEventListener('input', recalcGramPrice);
  syncTypeUi();
  recalcGramPrice();
  root.querySelector('#nm-save')?.addEventListener('click', async () => {
    const name = root.querySelector('#nm-name').value.trim();
    if (!name) {
      toast('Введите название материала');
      return;
    }
    const packagePrice = Math.max(0, Number(packPriceEl?.value) || 0);
    const packageSize = Math.max(0, Number(packWeightEl?.value) || 0);
    const defaultPrice =
      packageSize > 0 ? packagePrice / packageSize : 0;
    await db.addMaterial({
      name,
      materialType: root.querySelector('#nm-type').value,
      packagePrice,
      packageWeightGrams: packageSize,
      packageQtyPcs: packageSize,
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

  let from = today;
  let to = today;
  if (mode === 'month') {
    const r = monthRange(curYm);
    from = r.from;
    to = r.to;
  }
  if (mode === 'period') {
    from = params.get('from') || today;
    to = params.get('to') || today;
  }

  const appointments = await db.listAppointments();
  const movements = await db.listMovements();

  const apIn = appointments.filter(
    (a) => a.status === 'done' && inRange(a.date, from, to)
  );
  const revenue = apIn.reduce((s, a) => s + (Number(a.receivedRub) || 0), 0);
  const cogs = apIn.reduce((s, a) => s + (Number(a.materialCostRub) || 0), 0);
  const profit = apIn.reduce((s, a) => s + (Number(a.profitRub) || 0), 0);

  const purchases = movements.filter((m) => m.type === 'in' && inRange(m.date, from, to));
  const purchaseSum = purchases.reduce((s, m) => s + (Number(m.totalCostRub) || 0), 0);

  const clientsN = new Set(apIn.map((a) => a.clientId)).size;
  const hours = apIn.reduce((s, a) => s + (Number(a.actualMinutes) || 0), 0) / 60;
  const profitPerHour = hours > 0 ? profit / hours : 0;

  const periodLabel =
    mode === 'today'
      ? F.formatDateISO(today)
      : mode === 'month'
        ? `Месяц ${curYm}`
        : `${F.formatDateISO(from)} — ${F.formatDateISO(to)}`;

  const segHtml = `<div class="segmented" style="margin-top:0">
    <button type="button" class="${mode === 'today' ? 'active' : ''}" data-fin="today">Сегодня</button>
    <button type="button" class="${mode === 'month' ? 'active' : ''}" data-fin="month">Месяц</button>
    <button type="button" class="${mode === 'period' ? 'active' : ''}" data-fin="period">Период</button>
  </div>`;

  const periodInputs =
    mode === 'period'
      ? `<div class="row">
      <div style="flex:1"><label class="label" for="fin-from">С</label><input class="field" id="fin-from" type="date" value="${from}" /></div>
      <div style="flex:1"><label class="label" for="fin-to">По</label><input class="field" id="fin-to" type="date" value="${to}" /></div>
    </div>
    <button type="button" class="btn btn-secondary" id="fin-apply">Показать</button>`
      : '';

  return `<header class="page-header">
    <div><h1>Финансы</h1><p class="sub">${esc(periodLabel)}</p></div>
  </header>
  <div class="content">
    ${segHtml}
    ${periodInputs}
    <div class="card">
      <div class="card-title">Выручка</div>
      <p class="stat-big">${F.money(revenue)}</p>
    </div>
    <div class="card">
      <div class="card-title">Материалы (по визитам)</div>
      <p class="stat-big">${F.money(cogs)}</p>
    </div>
    <div class="card">
      <div class="card-title">Прибыль</div>
      <p class="stat-big profit-pos">${F.money(profit)}</p>
    </div>
    <div class="card">
      <div class="card-title">Закупки за период</div>
      <p class="stat-big">${F.money(purchaseSum)}</p>
      <p class="status-line">Сумма приходов на склад (не то же, что списание по визитам).</p>
    </div>
    <div class="card compact">
      <div class="card-title">Кратко</div>
      <p class="status-line">Уникальных клиентов: ${clientsN}</p>
      <p class="status-line">Прибыль за час (факт. время): ${F.money(profitPerHour)}</p>
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
      const diff =
        Number(s.defaultDifficulty) >= 1 && Number(s.defaultDifficulty) <= 5
          ? s.defaultDifficulty
          : '—';
      return `<div class="card sv-price-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700">${esc(s.name)}</div>
            <div class="status-line">${F.money(s.basePrice)} · ${F.minutesToLabel(s.plannedMinutes)} · сложность ${esc(String(diff))}</div>
            ${s.note ? `<p class="status-line" style="margin-top:6px">${esc(s.note)}</p>` : ''}
          </div>
          <button type="button" class="icon-btn" aria-label="Удалить из прайса" data-sv-del="${s.id}">🗑️</button>
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
    <button type="button" class="btn btn-ghost" style="width:100%;margin-top:12px;font-size:0.92rem" id="sv-purge-demo">Очистить тестовые услуги</button>
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
  root.querySelectorAll('[data-sv-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(btn.getAttribute('data-sv-del'));
      if (!id) return;
      if (!confirm('Убрать услугу из прайса?')) return;
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
        'Удалить из базы тестовые позиции (Афрокосы, боксерские косы и др.)? Занятые в записях будут только скрыты из прайса.'
      )
    ) {
      return;
    }
    const r = await db.purgeDemoSeedServices();
    if (r.deleted === 0 && r.archived === 0) {
      toast('Тестовые услуги не найдены');
      return;
    }
    toast(
      r.archived
        ? `Готово: удалено ${r.deleted}, в архив (есть записи): ${r.archived}`
        : `Удалено услуг: ${r.deleted}`
    );
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
    <p class="card-title">Базовая сложность</p>
    <div class="difficulty-scale" id="sv-diff">
      ${[1, 2, 3, 4, 5]
        .map(
          (n) =>
            `<button type="button" class="${n === 2 ? 'active' : ''}" data-sv-d="${n}">${n}</button>`
        )
        .join('')}
    </div>
    <label class="label" for="sv-note">Комментарий</label>
    <textarea class="field" id="sv-note" placeholder="Необязательно"></textarea>
    <button type="button" class="btn btn-primary" style="margin-top:8px" id="sv-save">Сохранить в прайс</button>
  </div>`;
}

export function attachAddService(shell, db, go, refresh) {
  const root = shell.querySelector('#app-root') || shell;
  const qs = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const ret = new URLSearchParams(qs).get('return');

  let difficulty = 2;
  root.querySelector('#sv-diff')?.querySelectorAll('[data-sv-d]').forEach((b) => {
    b.addEventListener('click', () => {
      difficulty = Number(b.getAttribute('data-sv-d'));
      root.querySelector('#sv-diff').querySelectorAll('[data-sv-d]').forEach((x) => {
        x.classList.toggle(
          'active',
          Number(x.getAttribute('data-sv-d')) === difficulty
        );
      });
    });
  });

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
      defaultDifficulty: difficulty,
      note: root.querySelector('#sv-note').value.trim(),
    });
    toast('Услуга сохранена');
    await refresh();
    go(ret === 'new' ? 'new' : 'services');
  });
}

export function attachFinance(shell, go) {
  const root = shell.querySelector('#app-root') || shell;
  const navigateMode = (m) => {
    if (m === 'period') {
      const d = F.todayISO();
      location.hash = `#finance?m=period&from=${encodeURIComponent(d)}&to=${encodeURIComponent(d)}`;
    } else {
      location.hash = `#finance?m=${encodeURIComponent(m)}`;
    }
  };
  root.querySelectorAll('[data-fin]').forEach((b) => {
    b.addEventListener('click', () => navigateMode(b.getAttribute('data-fin')));
  });
  root.querySelector('#fin-apply')?.addEventListener('click', () => {
    const from = root.querySelector('#fin-from').value;
    const to = root.querySelector('#fin-to').value;
    location.hash = `#finance?m=period&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  });
}

async function renderSettings(db, meta, go, refresh) {
  const name = (await db.getMeta('masterName')) || '';
  const codesHint = 'Коды: KOSO-FULL-2026 · BEAUTY-CRM-KEY · MASTERS-DEMO-UNLOCK';
  return `<div class="content">
    <div class="back-row"><a href="#today" data-back>← Главная</a></div>
    <h1 style="margin-top:8px">Настройки</h1>
    <label class="label" for="st-name">Как к вам обращаться</label>
    <input class="field" id="st-name" value="${esc(name)}" />
    <button type="button" class="btn btn-primary" id="st-save">Сохранить имя</button>
    <hr class="soft" />
    <p class="muted" style="font-size:0.85rem">${esc(codesHint)}</p>
    <label class="label" for="st-code">Активация</label>
    <input class="field" id="st-code" placeholder="Код полной версии" />
    <button type="button" class="btn btn-secondary" id="st-activate">Активировать код</button>
    <hr class="soft" />
    <button type="button" class="btn btn-secondary" id="st-export">Экспорт базы (JSON)</button>
    <button type="button" class="btn btn-secondary" id="st-import">Импорт базы (JSON)</button>
    <p class="muted" style="font-size:0.8rem">Импорт заменяет все данные. Сделайте резервную копию.</p>
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
  root.querySelector('#st-activate')?.addEventListener('click', async () => {
    const ok = await License.activateWithCode(db, root.querySelector('#st-code').value);
    if (!ok) {
      toast('Код не подходит');
      return;
    }
    toast('Полная версия активирована');
    await refresh();
    go('today');
  });
  root.querySelector('#st-export')?.addEventListener('click', async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kosopletenie-backup-${F.todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Файл скачан');
  });
  root.querySelector('#st-import')?.addEventListener('click', () => {
    document.getElementById('import-file')?.click();
  });
}

function wireImport(ctx) {
  const input = document.getElementById('import-file');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
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

async function renderWizard(root, db, go) {
  let w = loadWizard();
  const clients = await db.listClients();
  /** Перечитываем при каждом paint(), чтобы после правок прайса список в мастере не устаревал. */
  let services = await db.listServices();
  let materials = await db.listMaterials();

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
    const rd = Number(wObj.difficulty);
    const diff = Number.isFinite(rd) && rd >= 1 && rd <= 5 ? rd : 1;
    const editBtn = withEditBtn
      ? `<button type="button" class="btn btn-secondary" style="width:100%;margin-top:10px" id="w-open-adjust-service">Изменить цену/время</button>`
      : '';
    return `<div class="card compact" style="margin-bottom:14px;background:var(--accent-soft);border-color:var(--accent)">
      <div class="card-title" style="margin-bottom:6px;color:var(--accent)">Услуга в записи</div>
      <p class="status-line" style="margin:4px 0">Услуга: ${name}</p>
      <p class="status-line" style="margin:4px 0">Цена: ${price}</p>
      <p class="status-line" style="margin:4px 0">Время: ${timeLabel}</p>
      <p class="status-line" style="margin:4px 0">Сложность: ${esc(String(diff))}</p>
      ${editBtn}
    </div>`;
  }

  let wizardClientSearchTimer = null;
  const wizardSearchDebounceMs = 260;

  async function paint() {
    clearTimeout(wizardClientSearchTimer);
    wizardClientSearchTimer = null;

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
      const da = Number(w.difficulty);
      const d = Number.isFinite(da) && da >= 1 && da <= 5 ? Math.round(da) : 2;
      const planned = Number(w.plannedMinutes) || 120;
      const phInit = Math.floor(planned / 60);
      const pmInit = planned % 60;
      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-adjust-cancel>Отмена</button></div>
        <div class="step-bar">Цена и время визита</div>
        <h1 style="margin-top:0;font-size:1.35rem">Изменить параметры услуги</h1>
        <p class="muted" style="line-height:1.45">При необходимости скорректируйте сложность, длительность и цену именно для этой записи. Шаблон в прайсе не меняется.</p>
        <p class="card-title">Сложность (1–5)</p>
        <div class="difficulty-scale" id="w-adj-diff">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button type="button" class="${n === d ? 'active' : ''}" data-adjd="${n}">${n}</button>`
            )
            .join('')}
        </div>
        <label class="label" for="w-adj-ph">Плановое время</label>
        <div class="row">
          <input class="field" id="w-adj-ph" type="number" min="0" step="1" placeholder="Часы" value="${phInit}" />
          <input class="field" id="w-adj-pm" type="number" min="0" step="5" placeholder="Мин" value="${pmInit}" />
        </div>
        <label class="label" for="w-adj-price">Цена услуги, ₽</label>
        <input class="field" id="w-adj-price" type="number" min="0" step="100" value="${Number(w.priceRub) || 0}" />
        <div class="wizard-footer"><button type="button" class="btn btn-primary" id="w-adjust-done">Готово</button></div>
      </div>`;
      root.querySelector('#w-adj-diff')?.querySelectorAll('[data-adjd]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const n = Number(btn.getAttribute('data-adjd'));
          w.difficulty = n;
          saveWizard(w);
          root.querySelector('#w-adj-diff').querySelectorAll('[data-adjd]').forEach((x) => {
            x.classList.toggle('active', Number(x.getAttribute('data-adjd')) === n);
          });
        });
      });
      root.querySelector('[data-adjust-cancel]')?.addEventListener('click', () => {
        delete w.adjustingService;
        delete w.adjustReturnStep;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w-adjust-done')?.addEventListener('click', () => {
        const adjD = Number(
          root.querySelector('#w-adj-diff .active')?.getAttribute('data-adjd')
        );
        w.difficulty =
          Number.isFinite(adjD) && adjD >= 1 && adjD <= 5 ? adjD : Number(w.difficulty) || 2;
        const pm = F.parseMinutesFromFields(
          root.querySelector('#w-adj-ph').value,
          root.querySelector('#w-adj-pm').value
        );
        w.plannedMinutes = pm || Number(w.plannedMinutes) || 120;
        w.priceRub = Number(root.querySelector('#w-adj-price').value) || 0;
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
      const picked = clients.find((c) => Number(c.id) === Number(w.clientId)) || null;

      const pickedBanner = picked
        ? `<div class="card compact" style="margin-bottom:12px;border-color:var(--accent);background:var(--accent-soft);display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div class="card-title" style="color:var(--accent);margin-bottom:4px">Выбран клиент</div>
            <div style="font-weight:700">${esc(picked.name)}</div>
            <div class="status-line">${esc(picked.phone || '')}</div>
          </div>
          <button type="button" class="btn btn-secondary" style="flex-shrink:0;padding:8px 12px" data-clear-client-pick>Сменить</button>
        </div>`
        : '';

      const newFieldsLocked = !!picked ? 'disabled' : '';
      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto;padding:8px 12px" data-cancel>Отмена</button></div>
        <div class="step-bar">Шаг 1 из 4 · Клиент</div>
        <h1 style="margin-top:0;font-size:1.35rem">Кто приходит</h1>
        ${pickedBanner}
        <label class="label" for="w-search">Найти в базе</label>
        <input type="text" class="field" inputmode="search" id="w-search" placeholder="Имя или телефон" value="${esc(rawSearch)}" autocomplete="off" enterkeyhint="search" />
        <div id="w-client-results" class="wizard-client-results" aria-live="polite"></div>
        <hr class="soft" />
        <p class="card-title">${picked ? 'Новый клиент (нажмите «Сменить», чтобы добавить другого)' : 'Новый клиент'}</p>
        <input class="field" id="w-new-name" placeholder="Имя" ${newFieldsLocked ? 'disabled' : ''}/>
        <input class="field" id="w-new-phone" placeholder="Телефон" inputmode="tel" ${newFieldsLocked ? 'disabled' : ''}/>
        <textarea class="field" id="w-new-notes" placeholder="Заметка" ${newFieldsLocked ? 'disabled' : ''}></textarea>
        <div class="wizard-footer"><button type="button" class="btn btn-primary" id="w1-next">Далее</button></div>
      </div>`;

      const searchInput = root.querySelector('#w-search');
      const resultsEl = root.querySelector('#w-client-results');

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
          <div class="status-line">${esc(c.phone || '')}</div>
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
        w.clientId = Number(b.getAttribute('data-pick-client'));
        saveWizard(w);
        paint();
      });

      root.querySelector('[data-clear-client-pick]')?.addEventListener('click', () => {
        delete w.clientId;
        saveWizard(w);
        paint();
      });
      root.querySelector('[data-cancel]')?.addEventListener('click', () => {
        sessionStorage.removeItem(WIZARD_KEY);
        go('today');
      });
      root.querySelector('#w1-next')?.addEventListener('click', async () => {
        flushWizardSearch();
        if (Number(w.clientId) > 0) {
          w.step = 2;
          saveWizard(w);
          paint();
          return;
        }
        const name = root.querySelector('#w-new-name')?.value?.trim();
        if (!name) {
          toast('Выберите клиента из найденных или добавьте нового');
          return;
        }
        const id = await db.addClient({
          name,
          phone: root.querySelector('#w-new-phone')?.value?.trim(),
          notes: root.querySelector('#w-new-notes')?.value?.trim(),
        });
        w.clientId = id;
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
      const listButtons = svcList
        .map(
          (s) =>
            `<button type="button" class="card service-card" style="width:100%;text-align:left" data-svc="${s.id}">
          <div style="font-weight:700">${esc(s.name)}</div>
          <div class="status-line">от ${F.money(s.basePrice)} · ${F.minutesToLabel(s.plannedMinutes)}</div>
        </button>`
        )
        .join('');
      const catalogBlock = svcList.length
        ? `<div class="list-gap">${listButtons}</div>`
        : `<div class="card" style="text-align:center;padding:18px 12px;margin-bottom:12px"><p class="empty-hint" style="margin:0 0 14px;padding:0;line-height:1.4">У вас пока нет услуг в прайсе</p><div style="display:flex;flex-direction:column;gap:10px"><button type="button" class="btn btn-primary" id="w-empty-add-service">+ Добавить услугу</button><button type="button" class="btn btn-secondary" id="w-empty-custom-shortcut">Своя услуга</button></div></div>`;

      let cdRaw = Number(w.difficulty);
      if (!Number.isFinite(cdRaw) || cdRaw < 1 || cdRaw > 5) cdRaw = 2;

      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-w-back>Назад</button></div>
        <div class="step-bar">Шаг 2 из 4 · Услуга</div>
        <h1 style="margin-top:0;font-size:1.35rem">Что делаем</h1>
        ${catalogBlock}
        ${svcList.length ? '' : `<p class="muted" style="font-size:0.85rem;margin:4px 0 0;line-height:1.4">Справочник «Прайс» в нижнем меню пуст или скрыты старые тестовые позиции. Разово можно оформить блоком «Своя услуга» ниже — в прайс это не сохранится.</p>`}
        <hr class="soft" />
        <p class="card-title">Своя услуга <span class="muted" style="font-weight:400;font-size:0.88rem">(не попадает в прайс)</span></p>
        <input class="field" id="w-c-name" placeholder="Название" />
        <div class="row">
          <div style="flex:1"><label class="label" for="w-c-price">Цена, ₽</label><input class="field" id="w-c-price" type="number" min="0" step="100" value="0" /></div>
        </div>
        <label class="label">Плановое время</label>
        <div class="row">
          <input class="field" id="w-c-ph" type="number" min="0" step="1" placeholder="Часы" value="${Math.floor(
            (Number(w.plannedMinutes) || 120) / 60
          )}" />
          <input class="field" id="w-c-pm" type="number" min="0" step="5" placeholder="Мин" value="${(Number(w.plannedMinutes) || 120) % 60}" />
        </div>
        <p class="card-title">Сложность (1–5)</p>
        <div class="difficulty-scale" id="w-c-diff">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button type="button" class="${n === cdRaw ? 'active' : ''}" data-cd="${n}">${n}</button>`
            )
            .join('')}
        </div>
        <div class="wizard-footer">
          <button type="button" class="btn btn-primary" id="w2-custom">Своя услуга — далее</button>
        </div>
      </div>`;
      root.querySelector('#w-empty-add-service')?.addEventListener('click', () =>
        go('add-service?return=new')
      );
      root.querySelector('#w-empty-custom-shortcut')?.addEventListener('click', () => {
        const row = root.querySelector('#w-c-name');
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row?.focus();
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
          w.priceRub = s.basePrice;
          w.plannedMinutes = s.plannedMinutes;
          const d = Number(s.defaultDifficulty);
          w.difficulty =
            Number.isFinite(d) && d >= 1 && d <= 5 ? Math.round(d) : 2;
          delete w.adjustingService;
          delete w.adjustReturnStep;
          w.step = 4;
          saveWizard(w);
          paint();
        });
      });
      root.querySelector('#w-c-diff')?.querySelectorAll('[data-cd]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const n = Number(btn.getAttribute('data-cd'));
          w.difficulty = n;
          saveWizard(w);
          root.querySelector('#w-c-diff').querySelectorAll('[data-cd]').forEach((x) => {
            x.classList.toggle('active', Number(x.getAttribute('data-cd')) === n);
          });
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
        w.step = 1;
        saveWizard(w);
        paint();
      });
      root.querySelector('#w2-custom')?.addEventListener('click', async () => {
        const name = root.querySelector('#w-c-name').value.trim();
        if (!name) {
          toast('Введите название услуги');
          return;
        }
        const price = Number(root.querySelector('#w-c-price').value) || 0;
        const ph = Number(root.querySelector('#w-c-ph').value) || 0;
        const pmField = Number(root.querySelector('#w-c-pm').value) || 0;
        const planned = ph * 60 + pmField;
        if (planned <= 0) {
          toast('Укажите длительность больше нуля');
          return;
        }
        const custD = Number(root.querySelector('#w-c-diff .active')?.getAttribute('data-cd'));
        w.catalogServicePicked = false;
        delete w.serviceId;
        w.serviceNameSnapshot = name;
        w.priceRub = price;
        w.plannedMinutes = planned;
        w.difficulty =
          Number.isFinite(custD) && custD >= 1 && custD <= 5 ? custD : Number(w.difficulty) || 2;
        w.tags = [];
        w.materialsPlan = [];
        delete w.adjustingService;
        delete w.adjustReturnStep;
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
              <button type="button" class="icon-btn" aria-label="Убрать из плана" data-remove-plan-mat="${mid}">🗑️</button>
            </div>
          </div>`;
          }

          const u = m.unit || m.baseUnit || 'g';
          const planLabel = u === 'pcs' ? 'План, шт' : 'План, г';
          const safeVal = esc(qtyVal);
          return `<div class="card compact" data-plan-row="${mid}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">${esc(m.name)}</div>
              <div class="status-line">Остаток: ${esc(String(m.stock ?? 0))} ${esc(unitCodeShort(u))} · ${F.money(m.pricePerUnit)} за ${esc(unitCodePriceLabel(u))}</div>
            </div>
            <button type="button" class="icon-btn" aria-label="Убрать из плана" data-remove-plan-mat="${mid}">🗑️</button>
          </div>
          <label class="label" for="wm-plan-${mid}">${esc(planLabel)}</label>
          <input class="field" id="wm-plan-${mid}" type="number" min="0" step="1" value="${safeVal}" placeholder="0" />
        </div>`;
        })
        .join('');

      const pickCandidates = [...materials]
        .filter((m) => !usedIds.has(Number(m.id)))
        .sort((a, b) => {
          const sa = Number(a.stock) || 0;
          const sb = Number(b.stock) || 0;
          if (sb > 0 && sa <= 0) return 1;
          if (sa > 0 && sb <= 0) return -1;
          return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });

      const pickListHtml =
        pickCandidates.length === 0
          ? '<p class="empty-hint" style="padding:16px 8px;text-align:center;margin:0;font-size:0.92rem">Все позиции уже в плане или справочник пуст. Добавьте материал на складе.</p>'
          : pickCandidates
              .map((m) => {
                const u = m.unit || m.baseUnit || 'g';
                const stk = Number(m.stock) || 0;
                const zero = stk <= 0;
                return `<button type="button" class="mat-pick-item${zero ? ' mat-pick-item--zero' : ''}" data-w-pick-mat="${m.id}">
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
        <p class="muted" style="line-height:1.45;margin-bottom:12px">Сюда попадают только те материалы, которые вы добавите кнопкой ниже. Справочник целиком не показываем. Со склада <strong>ничего не списывается</strong> при сохранении записи — списание только при завершении визита по факту.</p>
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
          const cur = [...(w.materialsPlan || [])];
          if (cur.some((p) => Number(p.materialId) === id)) return;
          cur.push({ materialId: id, qty: '' });
          w.materialsPlan = cur;
          saveWizard(w);
          closeMatPick();
          paint();
        });
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
      const tp = F.timeToHourAndQuarter(w.time || '10:00');
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
      root.innerHTML = `<div class="content">
        <div class="back-row"><button type="button" class="btn btn-ghost" style="width:auto" data-w-back>Назад</button></div>
        <div class="step-bar">Шаг 4 из 4 · Дата и время</div>
        <h1 style="margin-top:0;font-size:1.35rem">Дата и время</h1>
        ${wizardServiceSummaryCard(w, true)}
        <label class="label" for="w-date">Дата</label>
        <input class="field" id="w-date" type="date" value="${w.date || F.todayISO()}" />
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
        <div class="wizard-footer">
          <button type="button" class="btn btn-primary" id="w5-save">Сохранить запись</button>
        </div>
      </div>`;
      root.querySelector('[data-w-back]')?.addEventListener('click', () => {
        w.date = root.querySelector('#w-date').value;
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
        const svcIdCatalog =
          w.catalogServicePicked === false
            ? null
            : w.serviceId != null && Number(w.serviceId) > 0
              ? w.serviceId
              : null;
        const appt = {
          clientId: w.clientId,
          serviceId: svcIdCatalog,
          serviceNameSnapshot: w.serviceNameSnapshot,
          date: root.querySelector('#w-date').value,
          time: F.hourMinuteToHHMM(
            root.querySelector('#w-th').value,
            root.querySelector('#w-tm').value
          ),
          difficulty: w.difficulty || 1,
          difficultyTags: w.tags || [],
          plannedMinutes: w.plannedMinutes || 120,
          priceRub: w.priceRub || 0,
          prepaymentRub: 0,
          status: 'scheduled',
          materialsPlan: w.materialsPlan || [],
          materialsFact: null,
          receivedRub: null,
          actualMinutes: null,
          materialCostRub: null,
          profitRub: null,
          completedAt: null,
          notes: '',
        };
        await db.addAppointment(appt);
        sessionStorage.removeItem(WIZARD_KEY);
        toast('Запись сохранена');
        go('today');
      });
    }
  }

  await paint();
}

async function renderComplete(root, db, id, go, refresh) {
  const ap = await db.getAppointment(Number(id));
  if (!ap) {
    root.innerHTML = `<div class="content empty-hint">Запись не найдена</div>`;
    return;
  }
  if (ap.status === 'done') {
    root.innerHTML = `<div class="content">
      <div class="back-row"><a href="#records" data-back>← Записи</a></div>
      <h1 style="font-size:1.25rem">Уже завершено</h1>
      <div class="card">
        <p>Прибыль: ${F.money(ap.profitRub || 0)}</p>
        <p class="status-line">Оплачено: ${F.money(ap.receivedRub || 0)} · материалы: ${F.money(ap.materialCostRub || 0)}</p>
      </div>
    </div>`;
    root.querySelector('[data-back]')?.addEventListener('click', (e) => {
      e.preventDefault();
      go('records');
    });
    return;
  }

  const allMaterials = await db.listMaterials({ includeInactive: true });
  const allById = Object.fromEntries(allMaterials.map((m) => [Number(m.id), m]));
  const plan = ap.materialsPlan || [];
  const defaultFact =
    ap.materialsFact && ap.materialsFact.length
      ? ap.materialsFact
      : plan.map((p) => ({ materialId: p.materialId, qty: p.qty }));
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
        const valueStr =
          q === '' || q == null || Number(q) === 0 ? '' : String(q);
        const uMat = m.unit || m.baseUnit || 'g';
        return `<div class="card compact" data-mat-row="${mid}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="font-weight:600">${esc(m.name)}</div>
          ${
            !plan.some((p) => Number(p.materialId) === mid)
              ? `<button type="button" class="btn btn-secondary" style="padding:6px 10px;font-size:0.8rem;flex-shrink:0" data-remove-mat="${mid}">✕</button>`
              : ''
          }
        </div>
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
  const pm = ap.plannedMinutes || 120;
  const ah = Math.floor(pm / 60);
  const am = pm % 60;
  const initialPaid = Number(ap.priceRub) || 0;
  const initialCost = computeCost(factLines);
  const initialProfit = initialPaid - initialCost;

  root.innerHTML = `<div class="content">
    <div class="back-row"><a href="#today" data-back>← Назад</a></div>
    <h1 style="font-size:1.25rem;margin-top:0">Завершение записи</h1>
    <p class="muted">${esc(ap.serviceNameSnapshot || '')}</p>

    <label class="label" for="c-act-h">Фактическое время</label>
    <div class="row">
      <input class="field" id="c-act-h" type="number" min="0" value="${ah}" />
      <input class="field" id="c-act-m" type="number" min="0" step="5" value="${am}" />
    </div>

    <h2 style="font-size:1rem;margin:16px 0 8px">Материалы</h2>
    <p class="status-line" style="margin:-4px 0 10px">По плану записи. Добавьте материал, если использовали сверх плана.</p>
    <button type="button" class="btn btn-secondary" id="c-add-material" style="margin-bottom:8px">Добавить материал</button>
    <div id="c-add-mat-picker" style="display:none;margin-bottom:12px" class="list-gap"></div>
    <div id="c-mats">${linesHtml(factLines)}</div>

    <label class="label" for="c-paid">Оплачено клиентом (всего)</label>
    <input class="field" id="c-paid" type="number" min="0" step="100" value="${ap.priceRub || 0}" />

    <div class="card" id="c-sum">
      <div class="card-title">Расчёт</div>
      <p class="status-line">Материалы (себестоимость): <strong id="c-cost">${F.money(initialCost)}</strong></p>
      <p class="status-line">Прибыль: <strong id="c-profit" class="${
        initialProfit >= 0 ? 'profit-pos' : 'profit-neg'
      }">${F.money(initialProfit)}</strong></p>
    </div>

    <button type="button" class="btn btn-primary" id="c-done">Завершить и списать</button>
  </div>`;

  const paidEl = root.querySelector('#c-paid');
  const matsRoot = root.querySelector('#c-mats');

  function recalc() {
    factLines = readFactLinesFromDom();
    const cost = computeCost(factLines);
    const paid = Number(paidEl.value) || 0;
    root.querySelector('#c-cost').textContent = F.money(cost);
    const prof = paid - cost;
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
  matsRoot?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-mat]');
    if (!b) return;
    e.preventDefault();
    const mid = Number(b.getAttribute('data-remove-mat'));
    factLines = factLines.filter((l) => Number(l.materialId) !== mid);
    paintMats();
    recalc();
  });

  paidEl?.addEventListener('input', recalc);

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
    go('today');
  });

  root.querySelector('#c-done')?.addEventListener('click', async () => {
    factLines = readFactLinesFromDom();
    const actualMinutes = F.parseMinutesFromFields(
      root.querySelector('#c-act-h').value,
      root.querySelector('#c-act-m').value
    );
    const next = factLines.filter((l) => (Number(l.qty) || 0) > 0 && allById[Number(l.materialId)]);
    const paid = Number(paidEl.value) || 0;
    const materialCostRub = computeCost(next);
    const profitRub = paid - materialCostRub;
    await db.completeAppointment(ap.id, {
      actualMinutes,
      materialsFact: next,
      receivedRub: paid,
      materialCostRub,
      profitRub,
    });
    toast('Списание выполнено');
    await refresh();
    go('today');
  });

  recalc();
}
