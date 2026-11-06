const CACHE = 'stagepilot-v4';
const ASSETS = ['/', '/styles.css', '/password-crypto.js', '/app.js', '/manifest.json'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('/media/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
