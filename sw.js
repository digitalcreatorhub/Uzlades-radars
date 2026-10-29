/* Service worker: оболочка приложения работает офлайн. Данные станций кэширует само приложение. */
const VERSION = 'ur-v21';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'logic.js',
  'app.js',
  'lang-lv.js',
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

  // Тайлы карты (OSM), Overpass и живые данные (live.json) не кэшируем здесь: свежесть важнее.
  if (url.hostname.endsWith('openstreetmap.org') || url.hostname.includes('overpass') || url.hostname === 'raw.githubusercontent.com') return;

  if (url.origin === self.location.origin) {
    // Свои файлы: сначала сеть (чтобы обновления доходили), при её отсутствии кэш.
    event.respondWith(
      // no-cache: каждый раз сверяемся с сервером; GitHub Pages иначе держит файлы в кэше браузера до 10 минут
      fetch(req, { cache: 'no-cache' })
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

// Пуш от сервера: «освободилась зарядка». Метка (tag) та же, что у уведомления внутри приложения, поэтому дубль заменяется.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Uzlādes Radars', {
      body: d.body || '',
      tag: d.tag || 'ur-push',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: d.url || './' },
    })
  );
});

// Нажатие на уведомление: открываем станцию. Только адреса нашего же сайта.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = new URL('./', self.registration.scope).href;
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope);
    if (u.origin === self.location.origin) url = u.href;
  } catch (e) { /* остаётся главная страница */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('navigate' in c && 'focus' in c) return c.navigate(url).then((cc) => (cc || c).focus()).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })
  );
});
