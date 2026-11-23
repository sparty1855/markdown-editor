const VERSION = '15';
const CACHE = 'redditmd-v' + VERSION;

// App code is version-pinned with ?v=N in index.html so CDN edges and the
// cache never mix versions. Vendor files never change once published.
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  `./storage.js?v=${VERSION}`,
  `./markdown.js?v=${VERSION}`,
  `./tablebuilder.js?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  './vendor/css/bootstrap.min.css',
  './vendor/js/bootstrap.bundle.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Same-origin app code must always be checked against the network first,
// otherwise index.html v(N) can load app.js v(N-1) from cache and features
// silently go missing.
const FRESH_FIRST = [
  /\/index\.html(\?|$)/,
  /\/(app|markdown|storage)\.js(\?|$)/,
  /\/manifest\.webmanifest$/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
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
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || FRESH_FIRST.some((re) => re.test(url.pathname))) {
    // Network-first with cache fallback (offline).
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Static assets: serve instantly from cache, refresh in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || new Response('', { status: 504 }));
      return hit || refresh;
    })
  );
});
