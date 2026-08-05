/* ============================================================
   Teacher PWA — minimal service worker.

   PURPOSE: satisfy Chrome's installability requirement (a fetch
   handler that can respond when offline) WITHOUT ever caching
   application code.

   Deliberately NOT a caching proxy: HTML, JS and CSS always come
   from the network, so a new deploy is live the instant it lands —
   no stale-bundle class of bug, which matters because these apps
   ship several times a day. The only cached thing is a tiny
   offline fallback page shown when the device is truly offline.
   ============================================================ */
const OFFLINE_URL = '/offline.html';
const CACHE = 'rka-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only page navigations get the offline fallback. Everything else
  // (API calls, assets) goes straight to the network, untouched.
  if (req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE_URL))
  );
});
