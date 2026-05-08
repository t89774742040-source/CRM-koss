import { openDb } from './db.js';
import * as License from './license.js';
import {
  mount,
  attachOnboarding,
  attachLock,
  attachToday,
  attachRecords,
  attachClients,
  attachClientDetail,
  attachMaterials,
  attachMaterialDetail,
  attachPurchase,
  attachAddMaterial,
  attachFinance,
  attachServices,
  attachAddService,
  attachServiceDetail,
  attachSettings,
} from './views.js';

const shell = document.getElementById('shell');

function routeFromHash() {
  return (location.hash.slice(1) || 'today').trim();
}

function go(path) {
  if (!path) return;
  const h = path.startsWith('#') ? path : `#${path}`;
  const next = h.slice(1);
  const cur = location.hash.slice(1) || '';
  /* Тот же hash не вызывает hashchange — а демо/активация должны перерисовать экран. */
  if (cur === next) {
    void render();
    return;
  }
  location.hash = h;
}

let db;
let meta = {};

async function refreshMeta() {
  meta = await db.getAllMetaObject();
}

function parseRoute(r) {
  const base = (r || 'today').split('?')[0];
  if (base.startsWith('client-')) return { view: 'client', id: base.slice(7) };
  if (base.startsWith('material-')) return { view: 'material', id: base.slice(9) };
  if (base.startsWith('service-')) return { view: 'service', id: base.slice(8) };
  if (base.startsWith('complete-')) return { view: 'complete', id: base.slice(9) };
  return { view: base || 'today' };
}

async function render() {
  if (!db) return;
  await refreshMeta();
  const route = routeFromHash();
  await mount(shell, { db, meta, route, go, refresh: refreshMeta });

  if (document.getElementById('ob-start')) {
    attachOnboarding(shell, db, go, refreshMeta);
    return;
  }
  if (document.getElementById('lk-btn')) {
    attachLock(shell, db, go, refreshMeta);
    return;
  }

  const p = parseRoute(route);
  switch (p.view) {
    case 'today':
      attachToday(shell, db, go, refreshMeta);
      break;
    case 'records':
      attachRecords(shell, db, go, refreshMeta);
      break;
    case 'clients':
      attachClients(shell, go);
      break;
    case 'client':
      attachClientDetail(shell, db, go, p.id);
      break;
    case 'materials':
      attachMaterials(shell, db, go);
      break;
    case 'material':
      attachMaterialDetail(shell, go, p.id);
      break;
    case 'purchase':
      attachPurchase(shell, db, go, refreshMeta);
      break;
    case 'add-material':
      attachAddMaterial(shell, db, go, refreshMeta);
      break;
    case 'services':
      attachServices(shell, db, go, refreshMeta);
      break;
    case 'service':
      attachServiceDetail(shell, db, go, p.id, refreshMeta);
      break;
    case 'add-service':
      attachAddService(shell, db, go, refreshMeta);
      break;
    case 'finance':
      attachFinance(shell, go);
      break;
    case 'settings':
      attachSettings(shell, db, go, refreshMeta);
      break;
    default:
      attachToday(shell, db, go, refreshMeta);
  }
}

async function init() {
  db = await openDb();
  await db.seedIfNeeded();
  if (!location.hash) {
    location.replace('#today');
  }
  window.addEventListener('hashchange', () => render());
  await render();

  /* Service worker отключён до проверки на GitHub Pages. Включить: register ./sw.js с scope каталога приложения. */
}

init();
