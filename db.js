const DB_NAME = 'kosopletenie-crm';
const DB_VERSION = 2;

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(createApi(req.result));
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('clients')) {
        const s = db.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
        s.createIndex('phone', 'phone', { unique: false });
      }
      if (!db.objectStoreNames.contains('services')) {
        db.createObjectStore('services', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('materials')) {
        db.createObjectStore('materials', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('appointments')) {
        const a = db.createObjectStore('appointments', { keyPath: 'id', autoIncrement: true });
        a.createIndex('date', 'date', { unique: false });
        a.createIndex('clientId', 'clientId', { unique: false });
        a.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('stockMovements')) {
        const m = db.createObjectStore('stockMovements', { keyPath: 'id', autoIncrement: true });
        m.createIndex('date', 'date', { unique: false });
        m.createIndex('materialId', 'materialId', { unique: false });
      }
      if (e.oldVersion < 2 && db.objectStoreNames.contains('appointments')) {
        const store = e.target.transaction.objectStore('appointments');
        store.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const row = cursor.value;
          if (row.status === 'in_progress') {
            row.status = 'scheduled';
            cursor.update(row);
          }
          cursor.continue();
        };
      }
    };
  });
}

function createApi(db) {
  const LEGACY_SEED_MATERIALS = new Set([
    'Канекалон (розовый)',
    'Резинки чёрные',
    'Канекалон (синий)',
  ]);

  const TEST_MATERIAL_NAMES = new Set([
    'Канекалон (розовый)',
    'Резинки чёрные',
    'Канекалон (синий)',
  ]);

  function appointmentRefsMaterial(a, materialId) {
    const mid = Number(materialId);
    const plan = a.materialsPlan || [];
    const fact = a.materialsFact || [];
    return (
      plan.some((l) => Number(l.materialId) === mid) ||
      fact.some((l) => Number(l.materialId) === mid)
    );
  }

  /** Архивировать, если есть движения по складу или запись использует материал. */
  async function materialShouldBeArchived(mid) {
    const movements = await listMovements();
    if (movements.some((m) => Number(m.materialId) === mid)) return true;
    const appointments = await listAppointments();
    if (appointments.some((a) => appointmentRefsMaterial(a, mid))) return true;
    return false;
  }

  /** Удалить из IndexedDB или пометить isActive:false. */
  async function deleteOrArchiveMaterial(rawId) {
    const id = Number(rawId);
    const mat = await getMaterial(id);
    if (!mat) return { ok: false };
    const archive = await materialShouldBeArchived(id);
    const tx = db.transaction('materials', 'readwrite');
    const store = tx.objectStore('materials');
    if (archive) {
      mat.isActive = false;
      store.put(mat);
      await txDone(tx);
      return { ok: true, archived: true };
    }
    store.delete(id);
    await txDone(tx);
    return { ok: true, archived: false };
  }

  /** Тестовые материалы по точным названиям. */
  async function cleanupTestMaterials() {
    const all = await listMaterials({ includeInactive: true });
    const summary = { removed: 0, archived: 0 };
    const seenIds = new Set();
    for (const m of all) {
      if (!TEST_MATERIAL_NAMES.has(m.name)) continue;
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      const r = await deleteOrArchiveMaterial(m.id);
      if (!r.ok) continue;
      if (r.archived) summary.archived += 1;
      else summary.removed += 1;
    }
    return summary;
  }

  async function getMeta(key) {
    const tx = db.transaction('meta', 'readonly');
    const row = await promisify(tx.objectStore('meta').get(key));
    return row ? row.value : undefined;
  }

  async function setMeta(key, value) {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    await txDone(tx);
  }

  async function getAllMetaObject() {
    const tx = db.transaction('meta', 'readonly');
    const all = await promisify(tx.objectStore('meta').getAll());
    const o = {};
    for (const row of all) o[row.key] = row.value;
    return o;
  }

  async function seedIfNeeded() {
    const baseline = await getMeta('crmInitBaseline');
    if (!baseline) {
      const name = await getMeta('masterName');
      if (name == null || name === '')
        await setMeta('masterName', 'Мастер');
      await setMeta('crmInitBaseline', true);
    }
    await cleanupLegacySeedMaterials();
    await cleanupLegacyDemoServicesAutoOnce();
  }

  /** Один раз убирает из прайса старые демо-услуги из IndexedDB (не из кода). */
  async function cleanupLegacyDemoServicesAutoOnce() {
    const done = await getMeta('legacyDemoServicesAutoPurgedV3');
    if (done) return;
    try {
      await purgeDemoSeedServices();
    } catch (e) {
      console.warn('cleanupLegacyDemoServicesAutoOnce', e);
      return;
    }
    await setMeta('legacyDemoServicesAutoPurgedV3', true);
  }

  async function cleanupLegacySeedMaterials() {
    const cleanupDone = await getMeta('legacyMaterialSeedCleanupDone');
    if (cleanupDone) return;

    const tx = db.transaction(['materials', 'stockMovements', 'appointments', 'meta'], 'readwrite');
    const materialsStore = tx.objectStore('materials');
    const materials = await promisify(materialsStore.getAll());
    const movements = await promisify(tx.objectStore('stockMovements').getAll());
    const appointments = await promisify(tx.objectStore('appointments').getAll());

    const hasMaterialUsage =
      movements.length > 0 ||
      appointments.some((a) => (a.materialsPlan && a.materialsPlan.length) || (a.materialsFact && a.materialsFact.length));
    const onlyLegacyMaterials =
      materials.length === LEGACY_SEED_MATERIALS.size &&
      materials.every((m) => LEGACY_SEED_MATERIALS.has(m.name));

    if (!hasMaterialUsage && onlyLegacyMaterials) {
      materialsStore.clear();
    }

    tx.objectStore('meta').put({ key: 'legacyMaterialSeedCleanupDone', value: true });
    await txDone(tx);
  }

  async function listClients() {
    const tx = db.transaction('clients', 'readonly');
    return promisify(tx.objectStore('clients').getAll());
  }

  async function getClient(id) {
    const tx = db.transaction('clients', 'readonly');
    return promisify(tx.objectStore('clients').get(Number(id)));
  }

  async function putClient(row) {
    const tx = db.transaction('clients', 'readwrite');
    tx.objectStore('clients').put(row);
    await txDone(tx);
    return row.id;
  }

  async function addClient(data) {
    const row = {
      name: data.name || '',
      phone: data.phone || '',
      telegram: data.telegram || '',
      notes: data.notes || '',
      createdAt: Date.now(),
    };
    const tx = db.transaction('clients', 'readwrite');
    const id = await promisify(tx.objectStore('clients').add(row));
    await txDone(tx);
    return id;
  }

  /**
   * @param {{ includeInactive?: boolean }} [opts]
   * По умолчанию только активные (isActive !== false).
   */
  async function listServices(opts = {}) {
    const includeInactive = !!opts.includeInactive;
    const tx = db.transaction('services', 'readonly');
    const all = await promisify(tx.objectStore('services').getAll());
    if (includeInactive) return all;
    return all.filter((s) => s.isActive !== false);
  }

  async function getService(id) {
    const tx = db.transaction('services', 'readonly');
    return promisify(tx.objectStore('services').get(Number(id)));
  }

  async function putService(row) {
    const tx = db.transaction('services', 'readwrite');
    tx.objectStore('services').put(row);
    await txDone(tx);
  }

  async function isServiceReferencedByAppointments(serviceId) {
    const sid = Number(serviceId);
    if (!sid) return false;
    const appointments = await listAppointments();
    return appointments.some((a) => Number(a.serviceId) === sid);
  }

  /** Удалить запись услуги или архивировать, если есть ссылки из записей. */
  async function deleteServiceOrArchive(rawId) {
    const id = Number(rawId);
    if (!id) return { ok: false, reason: 'bad_id' };
    const svc = await getService(id);
    if (!svc) return { ok: false, reason: 'not_found' };
    const used = await isServiceReferencedByAppointments(id);
    if (used) {
      const row = { ...svc, isActive: false };
      await putService(row);
      return { ok: true, archived: true };
    }
    const tx = db.transaction('services', 'readwrite');
    tx.objectStore('services').delete(id);
    await txDone(tx);
    return { ok: true, deleted: true };
  }

  function normalizeDemoServiceName(raw) {
    try {
      return String(raw || '')
        .normalize('NFKC')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    } catch {
      return String(raw || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }
  }

  const DEMO_SEED_SERVICE_NAMES = new Set(
    [
      'Афрокосы',
      'Боксерские косы',
      'Брейды',
      'Брейды в хвост',
      'Детское плетение',
    ].map(normalizeDemoServiceName)
  );

  /** Удалить или архивировать услуги с «тестовыми» названиями из старого сида. */
  async function purgeDemoSeedServices() {
    const all = await listServices({ includeInactive: true });
    let deleted = 0;
    let archived = 0;
    const seenIds = new Set();
    for (const s of all) {
      if (!DEMO_SEED_SERVICE_NAMES.has(normalizeDemoServiceName(s.name))) continue;
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      const r = await deleteServiceOrArchive(s.id);
      if (!r.ok) continue;
      if (r.archived) archived += 1;
      else deleted += 1;
    }
    return { deleted, archived };
  }

  async function addService(data) {
    const d = Number(data.defaultDifficulty);
    const row = {
      name: data.name || '',
      basePrice: Number(data.basePrice) || 0,
      plannedMinutes: Number(data.plannedMinutes) || 60,
      defaultDifficulty:
        Number.isFinite(d) && d >= 1 && d <= 5 ? Math.round(d) : 2,
      note: data.note || '',
      isActive: true,
    };
    const tx = db.transaction('services', 'readwrite');
    const id = await promisify(tx.objectStore('services').add(row));
    await txDone(tx);
    return id;
  }

  /**
   * @param {{ includeInactive?: boolean }} [opts]
   * По умолчанию только активные (isActive !== false). Записи без поля считаются активными.
   */
  async function listMaterials(opts = {}) {
    const includeInactive = !!opts.includeInactive;
    const tx = db.transaction('materials', 'readonly');
    const all = await promisify(tx.objectStore('materials').getAll());
    if (includeInactive) return all;
    return all.filter((m) => m.isActive !== false);
  }

  async function getMaterial(id) {
    const tx = db.transaction('materials', 'readonly');
    return promisify(tx.objectStore('materials').get(Number(id)));
  }

  async function putMaterial(row) {
    const tx = db.transaction('materials', 'readwrite');
    tx.objectStore('materials').put(row);
    await txDone(tx);
  }

  async function addMaterial(data) {
    const packagePrice = Math.max(0, Number(data.packagePrice) || 0);
    const unitCode = data.unit === 'pcs' ? 'pcs' : 'g';
    const packageWeightGrams = Math.max(0, Number(data.packageWeightGrams) || 0);
    const packageQtyPcs = Math.max(0, Number(data.packageQtyPcs) || 0);
    const packageSize = unitCode === 'pcs' ? packageQtyPcs : packageWeightGrams;
    const computedGramPrice =
      packageSize > 0 ? packagePrice / packageSize : 0;
    const row = {
      name: data.name || '',
      materialType: data.materialType || 'прочее',
      unit: unitCode,
      pricePerUnit:
        Number(data.defaultPrice ?? data.pricePerUnit ?? computedGramPrice) || 0,
      baseUnit: unitCode,
      packagePrice,
      packageWeightGrams,
      packageQtyPcs,
      stock: Number(data.stock) || 0,
      minStock: Number(data.minStock) || 0,
      comment: data.comment || '',
      isActive: true,
    };
    const tx = db.transaction('materials', 'readwrite');
    const id = await promisify(tx.objectStore('materials').add(row));
    await txDone(tx);
    return id;
  }

  async function listAppointments() {
    const tx = db.transaction('appointments', 'readonly');
    return promisify(tx.objectStore('appointments').getAll());
  }

  async function getAppointment(id) {
    const tx = db.transaction('appointments', 'readonly');
    return promisify(tx.objectStore('appointments').get(Number(id)));
  }

  function normalizeAppointmentStatus(row) {
    if (row && row.status === 'in_progress') row.status = 'scheduled';
  }

  async function putAppointment(row) {
    normalizeAppointmentStatus(row);
    const tx = db.transaction('appointments', 'readwrite');
    tx.objectStore('appointments').put(row);
    await txDone(tx);
  }

  /**
   * Зафиксировать фактическое начало визита (один раз; повторный вызов — noop с alreadyStarted).
   */
  async function startAppointmentNow(appointmentId) {
    const ap = await getAppointment(Number(appointmentId));
    if (!ap) throw new Error('Запись не найдена');
    if (ap.status === 'done' || ap.status === 'cancelled')
      return { ok: false, reason: 'invalid_status' };
    const existing = Number(ap.actualStartAt);
    if (Number.isFinite(existing) && existing > 0) return { ok: true, alreadyStarted: true };
    ap.actualStartAt = Date.now();
    await putAppointment(ap);
    return { ok: true };
  }

  async function addAppointment(row) {
    normalizeAppointmentStatus(row);
    const tx = db.transaction('appointments', 'readwrite');
    const id = await promisify(tx.objectStore('appointments').add(row));
    await txDone(tx);
    return id;
  }

  async function listMovements() {
    const tx = db.transaction('stockMovements', 'readonly');
    return promisify(tx.objectStore('stockMovements').getAll());
  }

  /** Цена за единицу (г или шт) из последнего прихода по списку движений; иначе null */
  function lastInboundUnitPriceFromMovements(materialId, movements) {
    const mid = Number(materialId);
    const inbound = (movements || []).filter(
      (r) => r.type === 'in' && Number(r.materialId) === mid
    );
    if (!inbound.length) return null;
    inbound.sort((a, b) => {
      const da = `${a.date || ''}`;
      const dbi = `${b.date || ''}`;
      const c = dbi.localeCompare(da);
      if (c !== 0) return c;
      const ca = Number(a.createdAt) || 0;
      const cb = Number(b.createdAt) || 0;
      if (cb !== ca) return cb - ca;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
    const u = Number(inbound[0].unitPrice);
    return Number.isFinite(u) ? u : null;
  }

  /** Себестоимость списания: последний приход, иначе fallback (например pricePerUnit в карточке). */
  function costUnitPriceFromMovements(materialId, movements, fallbackPricePerUnit) {
    const last = lastInboundUnitPriceFromMovements(materialId, movements);
    if (last != null && last >= 0) return last;
    return Math.max(0, Number(fallbackPricePerUnit) || 0);
  }

  async function getLastInboundUnitPrice(materialId) {
    const movements = await listMovements();
    return lastInboundUnitPriceFromMovements(materialId, movements);
  }

  async function resolveCostUnitPrice(materialId, fallbackPricePerUnit) {
    const movements = await listMovements();
    return costUnitPriceFromMovements(materialId, movements, fallbackPricePerUnit);
  }

  async function addMovement(m) {
    const tx = db.transaction('stockMovements', 'readwrite');
    const id = await promisify(tx.objectStore('stockMovements').add(m));
    await txDone(tx);
    return id;
  }

  /**
   * Приход: увеличивает остаток, пишет движение type 'in'.
   * Учёт только в базовых единицах материала: граммы (g) или штуки (pcs).
   * @param qty — всегда количество в г или шт (НЕ в упаковках)
   * @param unitPrice — цена за 1 г или за 1 шт
   * purchasePack* — только справка «как вводили партию»; на остаток и списания не влияют
   */
  async function stockPurchase({
    materialId,
    qty,
    unitPrice,
    supplier,
    date,
    note,
    purchasePackPrice,
    purchasePackSize,
    purchasePackCount,
    purchasePackParamsDiffer,
  }) {
    const mid = Number(materialId);
    const q = Math.max(0, Number(qty) || 0);
    const price = Math.max(0, Number(unitPrice) || 0);
    const totalCost = Math.round(q * price);
    const ts = Date.now();
    const tx = db.transaction(['materials', 'stockMovements'], 'readwrite');
    const matStore = tx.objectStore('materials');
    const mat = await promisify(matStore.get(mid));
    if (!mat) throw new Error('Материал не найден');
    if (mat.isActive === false) throw new Error('Материал в архиве — приход недоступен');
    mat.stock = (Number(mat.stock) || 0) + q;
    mat.pricePerUnit = price;
    matStore.put(mat);
    // qty / unitPrice — базовые ед. (г или шт). purchasePack* — справка о вводе «пачками», не учёт.
    tx.objectStore('stockMovements').add({
      type: 'in',
      materialId: mid,
      qty: q,
      unitPrice: price,
      totalCostRub: totalCost,
      date: date || new Date().toISOString().slice(0, 10),
      supplier: supplier || '',
      note: note || '',
      createdAt: ts,
      purchasePackPrice:
        purchasePackPrice != null ? Math.max(0, Number(purchasePackPrice)) : undefined,
      purchasePackSize:
        purchasePackSize != null ? Math.max(0, Number(purchasePackSize)) : undefined,
      purchasePackCount:
        purchasePackCount != null ? Math.max(0, Number(purchasePackCount)) : undefined,
      purchasePackParamsDiffer: !!purchasePackParamsDiffer,
    });
    await txDone(tx);
  }

  /**
   * Списание по записи: уменьшает остаток, движения type 'out'.
   * line.qty — всегда в базовых единицах материала (г или шт).
   */
  async function stockWriteOffForAppointment(appointmentId, lines, dateStr) {
    const aid = Number(appointmentId);
    const movementsSnapshot = await listMovements();
    const tx = db.transaction(['materials', 'stockMovements'], 'readwrite');
    const matStore = tx.objectStore('materials');
    const movStore = tx.objectStore('stockMovements');
    for (const line of lines) {
      const mid = Number(line.materialId);
      const qty = Math.max(0, Number(line.qty) || 0);
      if (qty <= 0) continue;
      const mat = await promisify(matStore.get(mid));
      if (!mat) continue;
      mat.stock = Math.max(0, (Number(mat.stock) || 0) - qty);
      matStore.put(mat);
      const unit = costUnitPriceFromMovements(mid, movementsSnapshot, mat.pricePerUnit);
      movStore.add({
        type: 'out',
        materialId: mid,
        qty,
        unitPrice: unit,
        totalCostRub: Math.round(qty * unit),
        date: dateStr,
        note: 'Списание по записи',
        appointmentId: aid,
      });
    }
    await txDone(tx);
  }

  /**
   * Завершение записи: сохраняет факт, прибыль, списывает материалы.
   * data.materialsFact[].qty — в базовых единицах материала (г или шт).
   */
  async function completeAppointment(appointmentId, data) {
    const aid = Number(appointmentId);
    const ap = await getAppointment(aid);
    if (!ap) throw new Error('Запись не найдена');
    const dateStr = (ap.date || new Date().toISOString().slice(0, 10)).split('T')[0];
    const lines = Array.isArray(data.materialsFact) ? data.materialsFact : [];
    ap.status = 'done';
    ap.actualEndAt = Date.now();
    ap.actualMinutes = data.actualMinutes != null ? Number(data.actualMinutes) : ap.plannedMinutes;
    ap.materialsFact = lines;
    ap.receivedRub = Math.max(0, Number(data.receivedRub) || 0);
    ap.materialCostRub = Math.max(0, Number(data.materialCostRub) || 0);
    ap.profitRub = Number(data.profitRub) || 0;
    ap.completedAt = new Date().toISOString();
    const movementsSnapshot = await listMovements();
    const tx = db.transaction(['appointments', 'materials', 'stockMovements'], 'readwrite');
    const apStore = tx.objectStore('appointments');
    apStore.put(ap);
    const matStore = tx.objectStore('materials');
    const movStore = tx.objectStore('stockMovements');
    for (const line of lines) {
      const mid = Number(line.materialId);
      const qty = Math.max(0, Number(line.qty) || 0);
      if (qty <= 0) continue;
      const mat = await promisify(matStore.get(mid));
      if (!mat) continue;
      mat.stock = Math.max(0, (Number(mat.stock) || 0) - qty);
      matStore.put(mat);
      const unit = costUnitPriceFromMovements(mid, movementsSnapshot, mat.pricePerUnit);
      movStore.add({
        type: 'out',
        materialId: mid,
        qty,
        unitPrice: unit,
        totalCostRub: Math.round(qty * unit),
        date: dateStr,
        note: 'Списание по записи',
        appointmentId: aid,
      });
    }
    await txDone(tx);
  }

  /** Ключ meta: одноразовая загрузка тестового набора (клиенты, прайс, склад, записи). */
  const DEMO_PACK_META_KEY = 'demoPackLoadedV1';

  /**
   * Добавляет тестовых клиентов, услуги, материалы, приход на склад и 3 записи.
   * Не дублирует, если ранее уже выставлен флаг demoPackLoadedV1.
   */
  async function loadDemoPack() {
    if (await getMeta(DEMO_PACK_META_KEY)) {
      return { ok: false, reason: 'already_loaded' };
    }

    function isoToday() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function isoAddDays(iso, n) {
      const [y, m, d] = iso.split('-').map(Number);
      const t = new Date(y, m - 1, d + Number(n));
      const yy = t.getFullYear();
      const mm = String(t.getMonth() + 1).padStart(2, '0');
      const dd = String(t.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    }

    const today = isoToday();
    const tomorrow = isoAddDays(today, 1);

    const clientId1 = await addClient({
      name: 'Демо · Анна Петрова',
      phone: '+7 900 111-01-01',
      telegram: '',
      notes: 'Тестовый клиент',
    });
    const clientId2 = await addClient({
      name: 'Демо · Мария Соколова',
      phone: '+7 900 222-02-02',
      telegram: '',
      notes: 'Тестовый клиент',
    });
    const clientId3 = await addClient({
      name: 'Демо · Елена Волкова',
      phone: '+7 900 333-03-03',
      telegram: '',
      notes: 'Тестовый клиент',
    });

    const serviceName1 = 'Демо · Косы-коробочки';
    const serviceName2 = 'Демо · Брейды классика';
    const sid1 = await addService({
      name: serviceName1,
      basePrice: 4200,
      plannedMinutes: 180,
      defaultDifficulty: 3,
      note: 'Прайс для теста',
    });
    const sid2 = await addService({
      name: serviceName2,
      basePrice: 2800,
      plannedMinutes: 120,
      defaultDifficulty: 2,
      note: 'Прайс для теста',
    });

    const matName1 = 'Демо · Канекалон Premium';
    const matName2 = 'Демо · Резинки набор';
    const mid1 = await addMaterial({
      name: matName1,
      materialType: 'канекалон',
      unit: 'g',
      packagePrice: 600,
      packageWeightGrams: 100,
      packageQtyPcs: 0,
      stock: 0,
      minStock: 30,
      comment: 'Демо склад',
    });
    const mid2 = await addMaterial({
      name: matName2,
      materialType: 'резинки',
      unit: 'pcs',
      packagePrice: 250,
      packageWeightGrams: 0,
      packageQtyPcs: 50,
      stock: 0,
      minStock: 10,
      comment: 'Демо склад',
    });

    await stockPurchase({
      materialId: mid1,
      qty: 150,
      unitPrice: 6,
      supplier: 'Демо-поставщик',
      date: today,
      note: 'Партия для теста',
    });
    await stockPurchase({
      materialId: mid2,
      qty: 40,
      unitPrice: 5,
      supplier: 'Демо-поставщик',
      date: today,
      note: 'Мелкая фурнитура',
    });

    await addAppointment({
      clientId: clientId1,
      serviceId: sid1,
      serviceNameSnapshot: serviceName1,
      date: today,
      time: '10:00',
      difficulty: 3,
      difficultyTags: [],
      plannedMinutes: 180,
      priceRub: 4200,
      prepaymentRub: 0,
      status: 'scheduled',
      materialsPlan: [],
      materialsFact: null,
      receivedRub: null,
      actualMinutes: null,
      actualStartAt: null,
      actualEndAt: null,
      materialCostRub: null,
      profitRub: null,
      completedAt: null,
      notes: '',
    });
    await addAppointment({
      clientId: clientId2,
      serviceId: sid2,
      serviceNameSnapshot: serviceName2,
      date: today,
      time: '14:30',
      difficulty: 2,
      difficultyTags: [],
      plannedMinutes: 120,
      priceRub: 2800,
      prepaymentRub: 0,
      status: 'scheduled',
      materialsPlan: [],
      materialsFact: null,
      receivedRub: null,
      actualMinutes: null,
      actualStartAt: null,
      actualEndAt: null,
      materialCostRub: null,
      profitRub: null,
      completedAt: null,
      notes: '',
    });
    await addAppointment({
      clientId: clientId3,
      serviceId: sid2,
      serviceNameSnapshot: serviceName2,
      date: tomorrow,
      time: '16:00',
      difficulty: 2,
      difficultyTags: [],
      plannedMinutes: 120,
      priceRub: 2800,
      prepaymentRub: 0,
      status: 'scheduled',
      materialsPlan: [],
      materialsFact: null,
      receivedRub: null,
      actualMinutes: null,
      actualStartAt: null,
      actualEndAt: null,
      materialCostRub: null,
      profitRub: null,
      completedAt: null,
      notes: '',
    });

    await setMeta(DEMO_PACK_META_KEY, true);
    return { ok: true };
  }

  async function exportAll() {
    const [metaRows, clients, services, materials, appointments, stockMovements] =
      await Promise.all([
        new Promise((resolve) => {
          const tx = db.transaction('meta', 'readonly');
          const req = tx.objectStore('meta').getAll();
          req.onsuccess = () => resolve(req.result);
        }),
        listClients(),
        listServices({ includeInactive: true }),
        listMaterials({ includeInactive: true }),
        listAppointments(),
        listMovements(),
      ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      /** meta: имя мастера, триал, активация, флаги вроде demoPackLoadedV1 */
      meta: metaRows,
      clients,
      services,
      materials,
      appointments,
      /** Движения склада: приходы и списания (часто называют materialTransactions). */
      stockMovements,
    };
  }

  async function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Неверный файл');
    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        ['meta', 'clients', 'services', 'materials', 'appointments', 'stockMovements'],
        'readwrite'
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const clearOrder = [
        'stockMovements',
        'appointments',
        'materials',
        'services',
        'clients',
        'meta',
      ];
      for (const name of clearOrder) tx.objectStore(name).clear();
      if (Array.isArray(data.meta)) {
        for (const row of data.meta) {
          if (row && row.key !== undefined) tx.objectStore('meta').put(row);
        }
      }
      const putAll = (storeName, rows) => {
        if (!Array.isArray(rows)) return;
        const s = tx.objectStore(storeName);
        for (const row of rows) {
          if (row && row.id != null) {
            if (storeName === 'appointments') normalizeAppointmentStatus(row);
            s.put(row);
          }
        }
      };
      putAll('clients', data.clients);
      putAll('services', data.services);
      putAll('materials', data.materials);
      putAll('appointments', data.appointments);
      const movements = data.stockMovements ?? data.materialTransactions;
      putAll('stockMovements', movements);
    });
  }

  const api = {
    raw: db,
    getMeta,
    setMeta,
    getAllMetaObject,
    seedIfNeeded,
    listClients,
    getClient,
    addClient,
    putClient,
    listServices,
    getService,
    addService,
    putService,
    deleteServiceOrArchive,
    purgeDemoSeedServices,
    listMaterials,
    getMaterial,
    addMaterial,
    putMaterial,
    listAppointments,
    getAppointment,
    addAppointment,
    putAppointment,
    startAppointmentNow,
    listMovements,
    addMovement,
    stockPurchase,
    getLastInboundUnitPrice,
    lastInboundUnitPriceFromMovements,
    costUnitPriceFromMovements,
    resolveCostUnitPrice,
    stockWriteOffForAppointment,
    completeAppointment,
    exportAll,
    importAll,
    loadDemoPack,
    deleteOrArchiveMaterial,
    cleanupTestMaterials,
  };

  return api;
}
