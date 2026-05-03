const CACHE = 'kosocrm-v24';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './db.js',
  './format.js',
  './license.js',
  './views.js',
  './app.js',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).catch(() =>
        caches.match(new URL('index.html', self.registration.scope))
      );
    })
  );
});
