/* Офлайн-кэш: приложение открывается без интернета после первого запуска.
   При каждом изменении файлов увеличивайте VERSION — так обновление гарантированно подтянется. */
const VERSION = 'v7';
const FILES = ['./', './index.html', './style.css', './script.js', './manifest.webmanifest',
               './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// сначала сеть (чтобы правки сразу подхватывались).
// Нет сети ИЛИ сайт отвечает ошибкой (404 — файлы удалены, 5xx — сбой) → берём из кэша.
const fromCache = req => caches.match(req, { ignoreSearch: true })
  .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          if (same) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
          return res;
        }
        return fromCache(e.request).then(r => r || res);
      })
      .catch(() => fromCache(e.request).then(r => r || Response.error()))
  );
});
