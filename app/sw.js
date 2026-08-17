const CACHE_NAME = 'aardvarkland-mini-preview-v10';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './language-flags.js',
  './assets/index-wMnB8Pza.css',
  './assets/source-fidelity.css',
  './assets/language-flags.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/flags/cz.svg',
  './icons/flags/gb.svg',
  './icons/flags/ua.svg',
  './icons/flags/fr.svg',
  './icons/flags/de.svg',
  './icons/flags/es.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type !== 'opaque') {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        throw new Error('OFFLINE_CACHE_MISS');
      }),
  );
});

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async (asset) => {
    try {
      await cache.add(asset);
    } catch {}
  }));
}
