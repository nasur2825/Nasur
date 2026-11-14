/* NASUR service worker - offline-first (Phase 4, cache v4) */
const CACHE_VERSION = 'v4';
const CACHE_NAME = 'nasur-' + CACHE_VERSION;

const CORE_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/home.css',
  'css/settings.css',
  'css/observations.css',
  'js/core/config.js',
  'js/core/eventbus.js',
  'js/core/router.js',
  'js/core/app.js',
  'js/services/sanitize.js',
  'js/services/db.js',
  'js/services/repo.js',
  'js/services/config.js',
  'js/services/calendar.js',
  'js/services/heat.js',
  'js/services/weather.js',
  'js/services/workspace.js',
  'js/services/regions.js',
  'js/services/settings.js',
  'js/services/clients.js',
  'js/services/photos.js',
  'js/services/actions.js',
  'js/services/templates.js',
  'js/services/observations.js',
  'js/services/ai_extender.js',
  'js/services/incidents.js',
  'js/services/reports.js',
  'js/services/rca.js',
  'js/services/search.js',
  'js/services/jarvis_core.js',
  'js/jarvis/context.js',
  'js/jarvis/voice.js',
  'js/jarvis/drawer.js',
  'js/modules/home.js',
  'js/modules/settings.js',
  'js/modules/clients.js',
  'js/modules/career.js',
  'js/modules/workspace.js',
  'js/modules/observations.js',
  'js/modules/reports.js',
  'js/modules/rca_coach.js',
  'js/modules/incidents.js',
  'js/modules/history_search.js',
  'js/modules/jarvis_studio.js',
  'data/modules.json',
  'data/hooks/manufacturing-hooks.json',
  'data/workspaces/base.json',
  'data/regions.json',
  'data/competency.json',
  'data/nasur_master_blueprint.json'
];

async function precacheOne(cache, url) {
  try {
    const res = await fetch(url, { cache: 'reload' });
    if (res && res.ok) await cache.put(url, res);
  } catch (e) {
    /* skip files that are not available yet */
  }
}

async function activeModuleFiles() {
  try {
    const res = await fetch('data/modules.json', { cache: 'reload' });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.modules || Object.values(json);
    return list
      .filter((m) => m && m.status === 'active' && m.file)
      .map((m) => m.file);
  } catch (e) {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const modules = await activeModuleFiles();
      const files = Array.from(new Set(CORE_FILES.concat(modules)));
      await Promise.all(files.map((f) => precacheOne(cache, f)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.indexOf('nasur-') === 0 && k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('index.html', res.clone());
          return res;
        } catch (e) {
          const cached = (await caches.match('index.html')) || (await caches.match('./'));
          return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        network.catch(() => null);
        return cached;
      }
      const res = await network;
      return res || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
