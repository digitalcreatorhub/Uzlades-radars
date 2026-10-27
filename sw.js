/* Service worker: оболочка приложения работает офлайн. Данные станций кэширует само приложение. */
const VERSION = 'ur-v6';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'logic.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Тайлы карты, Overpass и живые данные (live.json) не кэшируем здесь: свежесть важнее.
  if (url.hostname.endsWith('openstreetmap.org') || url.hostname.includes('overpass') || url.hostname === 'raw.githubusercontent.com') return;

  if (url.origin === self.location.origin) {
    // Свои файлы: сначала сеть (чтобы обновления доходили), при её отсутствии кэш.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // Leaflet и шрифты: из кэша, если уже скачаны.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
