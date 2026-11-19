/* NASUR service worker — v7
   Network-first for app code, styles, data and pages (so a new commit shows up on the
   very next load); cache is the offline fallback. AI providers and weather (other origins)
   always go straight to the network. */

const VERSION = 'v7';
const CACHE = 'nasur-' + VERSION;
const NETWORK_TIMEOUT_MS = 6000;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/home.css',
  'css/jarvis.css',
  'css/settings.css',
  'css/observations.css',
  'css/reference.css',
  'css/ops.css',
  'js/core/config.js',
  'js/core/eventbus.js',
  'js/core/router.js',
  'js/core/app.js',
  'js/jarvis/drawer.js',
  'js/jarvis/voice.js',
  'js/jarvis/context.js',
  'js/services/db.js',
  'js/services/repo.js',
  'js/services/config.js',
  'js/services/settings.js',
  'js/services/sanitize.js',
  'js/services/regions.js',
  'js/services/calendar.js',
  'js/services/heat.js',
  'js/services/weather.js',
  'js/services/workspace.js',
  'js/services/templates.js',
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
    // Each file is cached on its own, so one missing file never blocks the install.
    const results = await Promise.allSettled(
      PRECACHE.map((path) => cache.add(new Request(scopeUrl(path), { cache: 'reload' })))
    );
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
      .filter(Boolean);
    if (failed.length) {
      console.warn('[sw] not cached (missing or unreachable):', failed.join(', '));
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

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Network first; the cache is used only when the network fails, is too slow, or the server is down (5xx). */
async function networkFirst(request, cacheKey, fallbackKeys) {
  const cache = await caches.open(CACHE);
  const lookup = async () => {
    const direct = await cache.match(cacheKey, { ignoreSearch: true });
    if (direct) return direct;
    for (const key of fallbackKeys) {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
    }
    return null;
  };

  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(cacheKey, response.clone()).catch(() => {});
      return response;
    }
    if (response && response.status >= 500) {
      const cached = await lookup();
      if (cached) return cached;
    }
    return response;
  } catch (error) {
    const cached = await lookup();
    return cached || offlineResponse();
  }
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
    event.respondWith(networkFirst(request, scopeUrl('index.html'), [scopeUrl('./')]));
    return;
  }

  event.respondWith(networkFirst(request, request, []));
});
