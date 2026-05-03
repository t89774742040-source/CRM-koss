/**
 * Импорт клиентов (имя и телефон) из .xlsx через SheetJS.
 * Библиотека подключается в index.html как ./js/xlsx.full.min.js (глобальный XLSX).
 */

function getXlsx() {
  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g && g.XLSX) return g.XLSX;
  throw new Error(
    'Библиотека SheetJS не загружена. Проверьте подключение скрипта js/xlsx.full.min.js в index.html.'
  );
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function normHeader(cell) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/** Подходит ли заголовок столбца под подсказку (точное совпадение, начало слова, вхождение). */
function headerMatches(h, hint) {
  if (!h || !hint) return false;
  if (h === hint) return true;
  if (h.startsWith(hint + ' ')) return true;
  if (h.endsWith(' ' + hint)) return true;
  if (h.includes(' ' + hint + ' ')) return true;
  if (h.endsWith(' ' + hint)) return true;
  if (hint.length >= 4 && h.includes(hint)) return true;
  return false;
}

const NAME_HINTS = ['имя', 'фио', 'клиент'];
const PHONE_HINTS = ['телефон', 'номер', 'контакт'];
const NOTE_HINTS = ['заметка', 'комментарий'];

function findColumnIndex(headers, hints) {
  const hs = headers.map(normHeader);
  for (const hint of hints) {
    for (let i = 0; i < hs.length; i++) {
      if (headerMatches(hs[i], hint)) return i;
    }
  }
  return -1;
}

function normalizeName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Цифры телефона для сравнения дублей (последние 10, если цифр достаточно). */
function normalizePhoneForDedupe(s) {
  const raw = String(s ?? '').replace(/\D/g, '');
  if (raw.length === 0) return '';
  return raw.length >= 10 ? raw.slice(-10) : raw;
}

/**
 * Ключ для проверки дублей: при наличии телефона — он (по последним 10 цифрам), иначе имя.
 */
function duplicateKey(name, phone) {
  const tail = normalizePhoneForDedupe(phone);
  if (tail.length > 0) return `p:${tail}`;
  return `n:${normalizeName(name)}`;
}

function cellValue(row, colIdx) {
  if (colIdx < 0) return '';
  const v = row[colIdx];
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    /* Телефон в Excel часто хранится как число; избегаем научной нотации. */
    if (Math.abs(v) >= 1e6) return String(Math.round(v));
    return String(v);
  }
  return String(v).trim();
}

/**
 * Читает первый лист, возвращает матрицу строк (массив массивов).
 */
function sheetToMatrix(workbook) {
  const XLSX = getXlsx();
  const name = workbook.SheetNames[0];
  if (!name) throw new Error('В файле нет листов.');
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error('Не удалось прочитать первый лист.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Файл пустой или не содержит строк.');
  }
  return rows;
}

/**
 * Строит множество ключей уже существующих клиентов.
 */
function existingKeySet(clients) {
  const set = new Set();
  for (const c of clients) {
    set.add(duplicateKey(c.name, c.phone));
  }
  return set;
}

/**
 * Разбор файла и подсчёт: что добавим, что считаем дублем.
 */
export function parseClientXlsxForImport(arrayBuffer, existingClients) {
  const XLSX = getXlsx();
  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: 'array' });
  } catch {
    throw new Error('Не удалось открыть файл. Убедитесь, что это настоящий .xlsx.');
  }

  const matrix = sheetToMatrix(workbook);
  if (matrix.length < 2) {
    throw new Error('В таблице только заголовок — нет строк с данными.');
  }
  const headerRow = matrix[0] || [];
  const iName = findColumnIndex(headerRow, NAME_HINTS);
  if (iName < 0) {
    throw new Error(
      'Не найдена колонка с именем. Добавьте столбец с заголовком «Имя», «ФИО» или «Клиент».'
    );
  }
  const iPhone = findColumnIndex(headerRow, PHONE_HINTS);
  const iNote = findColumnIndex(headerRow, NOTE_HINTS);

  const existing = existingKeySet(existingClients);
  const batchSeen = new Set();
  const toAdd = [];

  let rawRows = 0;
  let skippedEmpty = 0;
  let skippedNoName = 0;
  let duplicates = 0;

  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const name = cellValue(row, iName);
    const phone = cellValue(row, iPhone);
    const notes = cellValue(row, iNote);

    const hasAny = normalizeName(name) || String(phone).trim() || String(notes).trim();
    if (!hasAny) {
      skippedEmpty++;
      continue;
    }
    rawRows++;

    if (!normalizeName(name)) {
      skippedNoName++;
      continue;
    }

    const key = duplicateKey(name, phone);
    if (existing.has(key) || batchSeen.has(key)) {
      duplicates++;
      continue;
    }
    batchSeen.add(key);
    toAdd.push({
      name: name.trim(),
      phone: String(phone).trim(),
      notes: String(notes).trim(),
      telegram: '',
    });
  }

  const previewLines = [
    `Строк с данными в таблице (без шапки): ${rawRows}`,
    `Будет добавлено новых клиентов: ${toAdd.length}`,
    `Пропущено как дубликаты (уже в базе или повтор в файле): ${duplicates}`,
  ];
  if (skippedEmpty > 0) previewLines.push(`Пустых строк пропущено: ${skippedEmpty}`);
  if (skippedNoName > 0) previewLines.push(`Строк без имени пропущено: ${skippedNoName}`);

  return {
    toAdd,
    previewText: previewLines.join('\n'),
    stats: { rawRows, newCount: toAdd.length, duplicates, skippedEmpty, skippedNoName },
  };
}

/** Скачать шаблон Excel: Имя | Телефон | Заметка */
export function downloadClientTemplateXlsx() {
  const XLSX = getXlsx();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Имя', 'Телефон', 'Заметка'],
    ['Иванова Мария', '+7 900 000-00-00', 'Пример строки — удалите или замените'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');
  XLSX.writeFile(wb, 'kosopletenie-clients-template.xlsx');
  toast('Шаблон скачан');
}

let pendingToAdd = null;
let importBound = false;

/**
 * Один раз вешает обработчики на скрытый input и модальное окно предпросмотра.
 */
export function setupExcelClientImport(ctx) {
  if (importBound) return;
  importBound = true;

  const { db, refresh, go } = ctx;
  const input = document.getElementById('xlsx-clients-file');
  const modal = document.getElementById('xlsx-preview-modal');
  const textEl = document.getElementById('xlsx-preview-text');
  const btnOk = document.getElementById('xlsx-preview-ok');
  const btnCancel = document.getElementById('xlsx-preview-cancel');

  if (!input || !modal || !textEl || !btnOk || !btnCancel) return;

  function openModal(htmlText) {
    textEl.innerHTML = htmlText.replace(/\n/g, '<br/>');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    btnOk.textContent = 'Добавить';
    btnOk.style.display = '';
    btnOk.disabled = false;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    pendingToAdd = null;
  }

  btnCancel.addEventListener('click', () => closeModal());

  btnOk.addEventListener('click', async () => {
    const rows = pendingToAdd;
    if (!rows || rows.length === 0) {
      closeModal();
      return;
    }
    closeModal();
    try {
      for (const row of rows) {
        await db.addClient(row);
      }
      await refresh();
      if (typeof go === 'function') go('clients');
      toast(`Добавлено клиентов: ${rows.length}`);
    } catch (e) {
      console.error(e);
      toast('Не удалось сохранить клиентов.');
    }
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    btnOk.style.display = '';
    btnOk.disabled = false;

    try {
      const buf = await file.arrayBuffer();
      if (!buf || buf.byteLength === 0) {
        toast('Файл пустой.');
        return;
      }
      const clients = await db.listClients();
      const { toAdd, previewText, stats } = parseClientXlsxForImport(buf, clients);

      if (stats.rawRows === 0) {
        toast('В файле нет строк с данными (после заголовка).');
        return;
      }

      pendingToAdd = toAdd.length > 0 ? toAdd : null;
      if (toAdd.length === 0) {
        btnOk.style.display = 'none';
        openModal(`${previewText}\n\n<span class="muted">Новых клиентов для добавления нет.</span>`);
        return;
      }

      btnOk.style.display = '';
      btnOk.textContent = `Добавить ${toAdd.length} клиентов`;
      openModal(`${previewText}\n\nПодтвердите импорт в базу.`);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Ошибка при чтении Excel.');
    }
  });
}

/** Кнопки в карточке «Тест и сохранение данных» (вызывать при каждом рендере экрана). */
export function attachExcelClientButtons(root) {
  root.querySelector('#svc-xlsx-template')?.addEventListener('click', () => {
    try {
      downloadClientTemplateXlsx();
    } catch (e) {
      console.error(e);
      toast(e.message || 'Не удалось сформировать шаблон.');
    }
  });
  root.querySelector('#svc-xlsx-import')?.addEventListener('click', () => {
    document.getElementById('xlsx-clients-file')?.click();
  });
}
