const BUILD_VERSION = 'development';
const BUILD_ASSETS = [];
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `aardvarkland-mini:${SCOPE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

function permitted(url) {
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname) || url.search) return false;
  const path = url.pathname.slice(SCOPE.pathname.length);
  return path === '' || path === 'index.html' || path === 'manifest.webmanifest'
    || /^(assets|fonts|icons)\/[\w./-]+\.(js|css|woff2?|png|svg|jpe?g|webp)$/.test(path);
}
function cacheable(response) {
  return response.ok && !response.redirected && response.type !== 'opaque'
    && !/\b(private|no-store)\b/i.test(response.headers.get('cache-control') || '');
}
self.addEventListener('install', event => { event.waitUntil(cacheAppShell()); });
// SKIP_WAITING is deliberately not used: in-progress warehouse work wins.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('authorization') || request.cache === 'no-store' || !permitted(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Serve the HTML and assets of the controlling version together. A network
    // HTML from a new deployment must not select chunks absent from this cache.
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (cacheable(response)) event.waitUntil(cache.put(request, response.clone()).catch(() => undefined));
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const shell = await cache.match(new URL('./index.html', SCOPE));
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexUrl = new URL('./index.html', SCOPE);
  const response = await fetch(indexUrl, { cache: 'reload' });
  if (!cacheable(response)) throw new Error('App shell could not be cached');
  const html = await response.text();
  const htmlAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  const assets = [...new Set([...APP_SHELL, ...BUILD_ASSETS, ...htmlAssets]
    .map(path => new URL(path, SCOPE)).filter(permitted).map(url => url.href))];
  // An incomplete new version must not replace the last working offline build.
  await Promise.all(assets.map(async asset => {
    const fetched = await fetch(asset, { cache: 'reload' });
    if (!cacheable(fetched)) throw new Error('Static asset could not be cached');
    await cache.put(asset, fetched);
  }));
}
