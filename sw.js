/* NASUR service worker — Phase 7 prep (v7)
   Strategy:
   - App code & data (js/css/json/html): NETWORK-FIRST, so a fresh commit always wins; cache is the offline fallback.
   - Icons / images / fonts: stale-while-revalidate.
   - Page navigations: network-first with the cached app shell as offline fallback.
   - Tells open pages when a new version has activated, so the app can offer a reload. */

const VERSION = 'v7';
const CACHE = 'nasur-' + VERSION;
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/home.css',
  'css/settings.css',
  'css/observations.css',
  'css/reference.css',
  'css/ops.css',
  'js/core/config.js',
  'js/core/eventbus.js',
  'js/core/router.js',
  'js/core/app.js',
  'js/jarvis/drawer.js',
  'js/jarvis/brain.js',
  'js/jarvis/providers.js',
  'js/jarvis/context.js',
  'js/jarvis/voice.js',
  'js/services/db.js',
  'js/services/repo.js',
  'js/services/config.js',
  'js/services/sanitize.js',
  'js/services/regions.js',
  'js/services/pin.js',
  'js/services/exporter.js',
  'js/services/importer.js',
  'js/services/client_repo.js',
  'js/services/workspace_repo.js',
  'js/services/career_repo.js',
  'js/services/jarvis_core.js',
  'js/services/observations.js',
  'js/services/incidents.js',
  'js/services/rca.js',
  'js/services/reports.js',
  'js/services/search.js',
  'js/services/ai_extender.js',
  'js/services/encyclopedia.js',
  'js/services/safety_reference.js',
  'js/services/opsstore.js',
  'js/services/risk.js',
  'js/services/permits.js',
  'js/services/emergency.js',
  'js/services/doc_control.js',
  'js/services/audits.js',
  'data/modules.json',
  'data/nasur_master_blueprint.json',
  'data/languages.json',
  'data/regions.json',
  'data/encyclopedia/activities_core.json',
  'data/encyclopedia/activities_more.json',
  'data/encyclopedia/fire_safety.json',
  'data/encyclopedia/machine_safety.json',
  'data/encyclopedia/ppe_guide.json',
  'data/ptw/permit_types.json',
  'data/ptw/risk_library.json',
  'data/emergency.json',
  'data/doc_control.json',
  'data/legal_register.json',
  'data/audits.json',
  'js/modules/home.js',
  'js/modules/observations.js',
  'js/modules/incidents.js',
  'js/modules/rca_coach.js',
  'js/modules/reports.js',
  'js/modules/history_search.js',
  'js/modules/jarvis_studio.js',
  'js/modules/activity_encyclopedia.js',
  'js/modules/fire_safety.js',
  'js/modules/ppe_guide.js',
  'js/modules/machine_safety.js',
  'js/modules/ptw_jsa.js',
  'js/modules/emergency.js',
  'js/modules/doc_control.js',
  'js/modules/audits.js',
  'js/modules/clients.js',
  'js/modules/workspace.js',
  'js/modules/career.js',
  'js/modules/settings.js'
];

const STATIC_ASSET = /\.(?:svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i;

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache each file individually so one missing file never blocks installation.
    const results = await Promise.allSettled(
      PRECACHE.map((path) => cache.add(new Request(scopeUrl(path), { cache: 'reload' })))
    );
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn('[sw] precache skipped:', failed.join(', '));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('nasur-') && k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
    const clientList = await self.clients.matchAll({ type: 'window' });
    clientList.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: VERSION, cache: CACHE }));
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  } else if (data && data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION, cache: CACHE });
  } else if (data && data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('nasur-')).map((k) => caches.delete(k)));
      if (event.source) event.source.postMessage({ type: 'CACHES_CLEARED' });
    })());
  }
});

/* Network-first for code/data: always revalidate with the server; fall back to cache offline or if slow. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const fresh = new Request(request, { cache: 'no-cache' });
  const netPromise = fetch(fresh).then((response) => {
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  });
  netPromise.catch(() => {}); // avoid unhandled rejection if the cache answers first

  let response = null;
  try {
    response = await Promise.race([
      netPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS))
    ]);
  } catch (err) {
    response = null;
  }

  if (response && response.status < 500) return response;

  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (response) return response;
  try {
    return await netPromise; // slow network, nothing cached: keep waiting for it
  } catch (err) {
    return offlineResponse();
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(scopeUrl('index.html'), response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached =
      (await cache.match(scopeUrl('index.html'), { ignoreSearch: true })) ||
      (await cache.match(scopeUrl('./'), { ignoreSearch: true }));
    return cached || offlineResponse();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  return (await network) || offlineResponse();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  // Only same-origin requests; AI provider and weather APIs go straight to the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
