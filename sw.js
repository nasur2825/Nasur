/**
 * NASUR – Service Worker (offline support)
 * File: sw.js
 *
 * Lets NASUR open and run with no internet connection. js/core/app.js
 * registers this file after the first screen is shown.
 *
 * HOW IT WORKS
 *   - On install it downloads the app's core files into one cache
 *     ("nasur-<CACHE_VERSION>"). It also reads data/modules.json and
 *     downloads the file of every module whose status is "active".
 *   - Requests to NASUR's own files use NETWORK FIRST: when online you always
 *     get the newest files (so a re-upload takes effect straight away), and
 *     each good response refreshes the cache. When offline, or when the
 *     network takes longer than 4 seconds and a saved copy exists, the saved
 *     copy is used. If nothing is saved yet, the request waits for the network.
 *   - The app page is served from the saved index.html, so NASUR opens offline.
 *   - Requests to OTHER websites (AI providers, weather) are never touched
 *     or stored. The browser sends them directly.
 *   - Only successful responses (status 200) from NASUR's own address are
 *     saved. Records and settings are NOT stored here (they live in IndexedDB).
 *
 * UPDATING
 *   Re-uploading files is enough: they are fetched fresh whenever you are
 *   online. Change CACHE_VERSION only to force old saved files to be deleted
 *   (this also makes the browser reinstall the worker and download any newly
 *   activated modules ahead of time).
 *
 * LIMIT
 *   A module you have never opened is only available offline if it was
 *   downloaded at install time or opened once while online.
 */

const CACHE_PREFIX = 'nasur-';
const CACHE_VERSION = 'v1';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

/** How long to wait for the network before using a saved copy. */
const NETWORK_TIMEOUT_MS = 4000;

const MODULES_FILE = 'data/modules.json';
const MODULE_FILE_PATTERN = /^js\/modules\/[a-z0-9]+(-[a-z0-9]+)*\.js$/;

/** Files downloaded at install (paths are relative to this file). */
const CORE_FILES = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'js/core/config.js',
  'js/core/eventbus.js',
  'js/core/router.js',
  'js/core/app.js',
  'js/services/sanitize.js',
  'js/services/db.js',
  'js/services/repo.js',
  'js/services/config.js',
  'data/hooks/manufacturing-hooks.json'
];

/** If any of these cannot be downloaded, the install fails (offline would not work). */
const CRITICAL_FILES = ['index.html', 'js/core/app.js', MODULES_FILE];

const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SHELL_URL = toUrl('index.html');


/* ==========================================================================
   1. HELPERS
   ========================================================================== */

/** Converts a path relative to this file into a full address. */
function toUrl(path) {
  return new URL(path, self.registration.scope).href;
}

/** Only complete, same-address responses are worth saving. */
function isCacheable(response) {
  return response.status === 200 && (response.type === 'basic' || response.type === 'default');
}

/**
 * Browsers refuse to answer a page navigation with a response that came from
 * a redirect. This returns a clean copy of such a response.
 */
async function withoutRedirect(response) {
  if (!response.redirected) {
    return response;
  }
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}


/* ==========================================================================
   2. INSTALL: DOWNLOAD THE CORE FILES
   ========================================================================== */

/** Downloads a file fresh from the server, saves it, and returns the response. */
async function storeFresh(cache, url) {
  const fetched = await fetch(url, { cache: 'reload' });
  if (!fetched.ok) {
    throw new Error('HTTP ' + fetched.status);
  }
  const response = await withoutRedirect(fetched);
  await cache.put(url, response.clone());
  return response;
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const urls = new Set(CORE_FILES.map(toUrl));
  const failed = new Set();

  // The module list tells us which module files exist and are ready to use.
  const modulesUrl = toUrl(MODULES_FILE);
  try {
    const response = await storeFresh(cache, modulesUrl);
    const data = await response.json();
    for (const mod of Array.isArray(data.modules) ? data.modules : []) {
      if (mod && mod.status === 'active' && typeof mod.file === 'string' && MODULE_FILE_PATTERN.test(mod.file)) {
        urls.add(toUrl(mod.file));
      }
    }
  } catch (error) {
    failed.add(modulesUrl);
    console.warn('NASUR offline cache: could not download ' + MODULES_FILE + '.', error);
  }

  const list = Array.from(urls);
  const outcomes = await Promise.allSettled(list.map((url) => storeFresh(cache, url)));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      failed.add(list[index]);
      console.warn('NASUR offline cache: could not download ' + list[index] + '.', outcome.reason);
    }
  });

  const missing = CRITICAL_FILES.map(toUrl).filter((url) => failed.has(url));
  if (missing.length > 0) {
    throw new Error('NASUR offline cache: essential files could not be downloaded (' + missing.join(', ') + ').');
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});


/* ==========================================================================
   3. ACTIVATE: REMOVE OLD CACHES AND TAKE CONTROL
   ========================================================================== */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});


/* ==========================================================================
   4. FETCH: NETWORK FIRST WITH A SAVED COPY AS BACKUP
   ========================================================================== */

/** Fetches from the network and refreshes the saved copy. Resolves with the response. */
async function fetchAndStore(request, cacheKey) {
  const fetched = await fetch(request, { cache: 'no-cache' });
  const response = await withoutRedirect(fetched);
  if (isCacheable(response)) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
    } catch (error) {
      console.warn('NASUR offline cache: a file could not be saved (the device may be low on space).', error);
    }
  }
  return response;
}

/**
 * Network-first answer. The network request starts immediately and keeps
 * running (to refresh the saved copy) even if a saved copy is used first.
 */
function networkFirst(event, request, cacheKey) {
  const networkPromise = fetchAndStore(request, cacheKey);
  event.waitUntil(networkPromise.then(() => undefined, () => undefined));

  return (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (!cached) {
      return networkPromise; // nothing saved yet: the network is the only option
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS);
      networkPromise.then(
        (response) => {
          clearTimeout(timer);
          // A server error (5xx) is worse than the saved copy; anything else is the truth.
          resolve(response.status >= 500 ? cached : response);
        },
        () => {
          clearTimeout(timer);
          resolve(cached);
        }
      );
    });
  })();
}

/** True when the request is the browser opening the app page itself. */
function isShellNavigation(request, url) {
  return request.mode === 'navigate'
    && (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  if (request.headers.has('range')) {
    return;
  }
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return; // other websites (AI, weather): never intercepted or stored
  }
  if (url.pathname.endsWith('/sw.js')) {
    return; // the browser checks this file for updates by itself
  }

  if (isShellNavigation(request, url)) {
    event.respondWith(networkFirst(event, new Request(SHELL_URL), SHELL_URL));
    return;
  }
  event.respondWith(networkFirst(event, request, request.url));
});