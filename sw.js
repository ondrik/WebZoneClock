/**
 * Offline support.
 *
 * The strategy is chosen per kind of request rather than applied uniformly:
 *
 *   - anything from this origin is fetched from the network first and only
 *     falls back to the cache when there is no network;
 *   - fonts are served from the cache and refreshed behind it, since their
 *     URLs already encode their contents and can never go stale.
 *
 * Network-first for our own files is deliberate. The app is a set of ES
 * modules that import each other, so serving a fresh index.html beside a
 * stale module -- which is what a cache-first policy does for one load after
 * every deploy -- can pair code with an interface it no longer has. Offline
 * capability is the point of this worker; shaving milliseconds off an online
 * load is not worth that risk, and the HTTP cache already does that job.
 *
 * Bump VERSION when shipping a change that must not be served from an old
 * cache. Older caches are deleted on activation.
 */

const VERSION = 'v1';
const SHELL = `wzc-shell-${VERSION}`;
const RUNTIME = `wzc-runtime-${VERSION}`;

// Enough to start the app with no network at all.
const PRECACHE = [
  './',
  'index.html',
  'assets/css/app.css',
  'assets/css/themes.css',
  'assets/favicon.svg',
  'assets/js/main.js',
  'assets/js/calendar.js',
  'assets/js/citydb.js',
  'assets/js/daylight.js',
  'assets/js/geo.js',
  'assets/js/pins.js',
  'assets/js/solar.js',
  'assets/js/state.js',
  'assets/js/strip.js',
  'assets/js/themes.js',
  'assets/js/timeline.js',
  'assets/js/tz.js',
  'assets/js/worldmap.js',
  'data/cities.json',
  'data/land.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // addAll is all-or-nothing; one missing file should not block install.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== SHELL && n !== RUNTIME).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;

  event.respondWith(
    isFont ? staleWhileRevalidate(request, RUNTIME) : networkFirst(request),
  );
});

/** Prefer fresh; fall back to whatever was cached, then to the shell. */
async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // A deep link with no network still deserves the app rather than an error.
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

/** Answer from the cache at once, and update it for next time. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      // Opaque cross-origin font responses are still worth keeping.
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}
