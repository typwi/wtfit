/* Офлайн-кэш: приложение открывается без интернета после первого запуска.
   При каждом изменении файлов увеличивайте VERSION — так обновление гарантированно подтянется. */
const VERSION = 'v9';
const FILES = ['./', './index.html', './style.css', './script.js', './manifest.webmanifest',
               './icon-180.png', './icon-192.png', './icon-512.png'];
const WAIT_MS = 2500;   // сколько ждём сеть, прежде чем открыть копию из кэша

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

const fromCache = req => caches.match(req, { ignoreSearch: true })
  .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));

// Сначала сеть, чтобы правки сразу подхватывались. Но если сеть не ответила за WAIT_MS
// (плохая связь в зале), нет сети или сайт ответил ошибкой (404, 5xx) — открываем копию из кэша.
// Свежий ответ, пришедший позже, всё равно сохраняется в кэш — он будет при следующем запуске.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === location.origin;

  const network = fetch(e.request).then(res => {
    if (res.ok && same) {
      const copy = res.clone();
      e.waitUntil(caches.open(VERSION).then(c => c.put(e.request, copy)));
    }
    return res;
  });

  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };

    const timer = setTimeout(() => {
      fromCache(e.request).then(finish);          // сеть медлит — есть копия? отдаём её
    }, WAIT_MS);

    network
      .then(res => {
        if (res.ok) { clearTimeout(timer); finish(res); return; }
        return fromCache(e.request).then(r => { clearTimeout(timer); finish(r || res); });
      })
      .catch(() => fromCache(e.request).then(r => { clearTimeout(timer); finish(r || Response.error()); }));
  }));
});
