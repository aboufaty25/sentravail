/* SenTravail service worker.
 * - Static assets: stale-while-revalidate (fast on 3G, updated in the background).
 * - Images: cache-first with a size cap.
 * - Pages: always from the network (never cached: they contain personal data),
 *   with an offline page when the network is unavailable.
 * - Never cached: POST requests, Socket.io, CV downloads, admin. */
const VERSION = 'v2';
const STATIC_CACHE = `st-static-${VERSION}`;
const IMAGE_CACHE = `st-images-${VERSION}`;
const MAX_IMAGES = 150;
const PRECACHE = [
  '/offline.html',
  '/css/app.css',
  '/js/app.js',
  '/vendor/htmx/htmx.min.js',
  '/vendor/alpine/cdn.min.js',
  '/icons/logo.svg',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('st-') && ![STATIC_CACHE, IMAGE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type !== 'opaque') {
    cache.put(request, res.clone());
    trimCache(IMAGE_CACHE, MAX_IMAGES);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // ads, Cloudinary… handled by the browser
  if (/^\/(socket\.io|cv\/telecharger|admin|notifications)/.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (/^\/(css|js|vendor|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (request.destination === 'image' && url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirstImage(request).catch(() => caches.match(request)));
  }
});
