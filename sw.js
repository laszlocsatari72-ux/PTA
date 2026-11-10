/* P_T_A – offline gyorsítótár. Ha módosítod a játék fájljait, növeld a VERSION számát,
   különben a már telepített telefonok a régi változatot használják tovább. */
var VERSION = 'pta-v1';
var FILES = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css',
  './js/board_data.js', './js/board.js', './js/engine.js', './js/coach.js', './js/app.js',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/favicon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// előbb a hálózat (így a frissítés azonnal megjelenik), net nélkül a tárolt változat
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.ok && new URL(e.request.url).origin === location.origin) {
        var copy = resp.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('./index.html'); });
    })
  );
});
