/* NASUR service worker — Phase 6 (v6)
   Offline-first: precache app shell, stale-while-revalidate for same-origin GET. */

const VERSION = 'v6';
const CACHE = 'nasur-' + VERSION;

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

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
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
    if (failed.length) {
      console.warn('[sw] precache skipped:', failed.join(', '));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('nasur-') && k !== CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  } else if (data && data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION, cache: CACHE });
  }
});

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
    if (cached) return cached;
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
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
    // Refresh in the background; serve instantly from cache.
    network.catch(() => {});
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
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
  // Only same-origin requests; AI provider and weather APIs go straight to network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});