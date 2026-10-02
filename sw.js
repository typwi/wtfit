/* Офлайн-кэш. Все файлы приложения хранятся ОДНИМ набором под именем VERSION и всегда
   отдаются из него — HTML, CSS и JS гарантированно из одной версии, даже при плохой связи.
   ВАЖНО: после любой правки файлов увеличьте VERSION — иначе телефон продолжит открывать старый набор.
   Новый набор скачивается целиком (в обход HTTP-кэша GitHub Pages); если хоть один основной файл
   не скачался — обновление отменяется и остаётся старая рабочая версия. */
const VERSION = 'v10';
const CORE  = ['./', './index.html', './style.css', './script.js', './manifest.webmanifest'];
const EXTRA = ['./icon-180.png', './icon-192.png', './icon-512.png'];   // иконки — по возможности

const fresh = url => fetch(new Request(url, { cache: 'no-cache' }));

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      // сначала скачиваем всё, и только потом кладём в кэш — набор либо полный, либо никакой
      const got = await Promise.all(CORE.map(async u => {
        const r = await fresh(u);
        if (!r.ok) throw new Error(u + ' → ' + r.status);
        return [u, r];
      }));
      const c = await caches.open(VERSION);
      await Promise.all(got.map(([u, r]) => c.put(u, r)));
      await Promise.all(EXTRA.map(u => fresh(u).then(r => r.ok ? c.put(u, r) : null).catch(() => {})));
    } catch (err) {
      await caches.delete(VERSION);
      throw err;                       // установка не удалась — продолжает работать прежняя версия
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Файлы приложения — только из текущего набора; всё прочее — из сети без HTTP-кэша.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    let hit = await c.match(req, { ignoreSearch: true });
    if (!hit && req.mode === 'navigate') hit = await c.match('./index.html');
    if (hit) return hit;
    try {
      return await fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' });
    } catch (err) {
      return Response.error();
    }
  })());
});

// нажатие на уведомление «Отдых окончен» — открыть приложение
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) return cs[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
