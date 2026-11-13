/**
 * NASUR – Test harness
 * File: tests/harness.js
 *
 * Shared by tests/runner.html and the test files (tests/phase1.test.js and
 * tests/phase2.test.js). Provides the suite registry, assertion helpers, file
 * helpers, and loads the app modules the tests exercise. It never loads
 * js/core/app.js (that would start the whole app). Tests use a scratch
 * database chosen by the runner, so saved data is never touched.
 */

export const ROOT = new URL('../', import.meta.url);
export const TEST_DB = 'nasur-test-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
export const TEST_TIMEOUT_MS = 20000;


/* ==========================================================================
   1. SUITES AND ASSERTIONS
   ========================================================================== */

export class SkipSignal extends Error {}

export function skip(reason) {
  throw new SkipSignal(reason);
}

export const suites = [];

export function suite(name, build) {
  const entry = { name, tests: [], before: null, after: null, ui: null };
  suites.push(entry);
  build({
    test(title, fn) { entry.tests.push({ title, fn }); },
    before(fn) { entry.before = fn; },
    after(fn) { entry.after = fn; }
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, label, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) { return; }
    await sleep(40);
  }
  throw new Error('Timed out waiting for: ' + label);
}

export function stable(value) {
  if (Array.isArray(value)) { return value.map(stable); }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const output = {};
    for (const key of Object.keys(value).sort()) { output[key] = stable(value[key]); }
    return output;
  }
  return value;
}

export function same(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function show(value) {
  if (value === undefined) { return 'undefined'; }
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) { text = String(value); }
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

export function assert(condition, message) {
  if (!condition) { throw new Error(message || 'Assertion failed.'); }
}

export function eq(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error((label ? label + ': ' : '') + 'expected ' + show(expected) + ' but got ' + show(actual));
  }
}

export function deepEq(actual, expected, label) {
  if (!same(actual, expected)) {
    throw new Error((label ? label + ': ' : '') + 'expected ' + show(expected) + ' but got ' + show(actual));
  }
}

/** Runs fn (sync or async); it must fail with an error code (text) or an error class. */
export async function expectError(fn, matcher, label) {
  let caught = null;
  let failed = false;
  try { await fn(); } catch (error) { caught = error; failed = true; }
  const prefix = label ? label + ': ' : '';
  if (!failed) { throw new Error(prefix + 'expected an error but none was thrown'); }
  if (typeof matcher === 'string') {
    if (!caught || caught.code !== matcher) {
      throw new Error(prefix + 'expected error code "' + matcher + '" but got "' + (caught && caught.code) + '" (' + (caught && caught.message) + ')');
    }
  } else if (typeof matcher === 'function' && !(caught instanceof matcher)) {
    throw new Error(prefix + 'expected ' + matcher.name + ' but got ' + (caught && caught.name) + ': ' + (caught && caught.message));
  }
  return caught;
}

export function captureConsole() {
  const original = { error: console.error, warn: console.warn };
  const captured = { errors: [], warnings: [] };
  console.error = (...args) => { captured.errors.push(args); };
  console.warn = (...args) => { captured.warnings.push(args); };
  captured.restore = () => { console.error = original.error; console.warn = original.warn; };
  return captured;
}

export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out after ' + ms / 1000 + ' seconds.')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

export function describeError(error) {
  const message = error && error.message ? error.message : String(error);
  return error && error.code ? message + ' [' + error.code + ']' : message;
}


/* ==========================================================================
   2. BROWSER STORAGE THAT TESTS MAY TOUCH
   ========================================================================== */

export const LS_WATCH = ['nasur.language', 'nasur.theme', 'nasur.last_route', 'nasur.weather_cache'];
const lsBackup = {};
for (const key of LS_WATCH) {
  try { lsBackup[key] = localStorage.getItem(key); } catch { lsBackup[key] = null; }
}

/** Puts the watched LocalStorage keys back to what they were before the run. */
export function restoreLocalStorage() {
  for (const key of LS_WATCH) {
    try {
      if (lsBackup[key] === null) { localStorage.removeItem(key); } else { localStorage.setItem(key, lsBackup[key]); }
    } catch { /* storage blocked */ }
  }
}


/* ==========================================================================
   3. PROJECT FILES AND FILE HELPERS
   ========================================================================== */

export const PROJECT_FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'icons/icon.svg',
  'css/tokens.css', 'css/base.css', 'css/components.css', 'css/home.css',
  'js/core/config.js', 'js/core/eventbus.js', 'js/core/router.js', 'js/core/app.js',
  'js/services/sanitize.js', 'js/services/db.js', 'js/services/repo.js', 'js/services/config.js',
  'js/services/calendar.js', 'js/services/heat.js', 'js/services/weather.js', 'js/services/workspace.js',
  'js/jarvis/context.js', 'js/jarvis/voice.js', 'js/jarvis/drawer.js',
  'js/modules/home.js',
  'data/modules.json', 'data/hooks/manufacturing-hooks.json', 'data/workspaces/base.json'
];
export const CSS_FILES = PROJECT_FILES.filter((path) => path.endsWith('.css'));
export const JS_FILES = PROJECT_FILES.filter((path) => path.endsWith('.js') && path !== 'sw.js');
export const INDUSTRY_IDS = ['construction', 'manufacturing', 'industrial_maintenance', 'facilities_management', 'warehousing_logistics', 'food_manufacturing', 'consultancy'];

const textCache = new Map();

export async function fetchText(path) {
  if (textCache.has(path)) { return textCache.get(path); }
  const response = await fetch(new URL(path, ROOT).href, { cache: 'no-store' });
  if (!response.ok) { throw new Error(path + ' could not be loaded (HTTP ' + response.status + ').'); }
  const text = await response.text();
  textCache.set(path, text);
  return text;
}

export async function fetchJson(path) {
  return JSON.parse(await fetchText(path));
}

export function parseHtml(text) {
  return new DOMParser().parseFromString(text, 'text/html');
}


/* ==========================================================================
   4. APP MODULES UNDER TEST
   ========================================================================== */

export const MODULE_PATHS = {
  cfg: 'js/core/config.js',
  ev: 'js/core/eventbus.js',
  router: 'js/core/router.js',
  san: 'js/services/sanitize.js',
  db: 'js/services/db.js',
  repo: 'js/services/repo.js',
  ucfg: 'js/services/config.js',
  cal: 'js/services/calendar.js',
  heat: 'js/services/heat.js',
  weather: 'js/services/weather.js',
  workspace: 'js/services/workspace.js',
  jctx: 'js/jarvis/context.js',
  voice: 'js/jarvis/voice.js',
  drawer: 'js/jarvis/drawer.js',
  home: 'js/modules/home.js'
};

export const M = {};
export const loadFailures = [];

for (const [name, path] of Object.entries(MODULE_PATHS)) {
  try {
    M[name] = await import(new URL(path, ROOT).href);
  } catch (error) {
    loadFailures.push({ name, path, message: (error && error.message) || String(error) });
  }
}


/* ==========================================================================
   5. TEST HELPERS THAT NEED THE APP MODULES
   ========================================================================== */

/** Empties the scratch database and forgets in-memory state. */
export async function resetDb() {
  await M.db.wipeDatabase();
  M.repo.resetRepoState();
  M.ucfg.resetConfigCache();
  M.weather.clearWeatherCache();
  M.jctx.resetContext();
}

/** Records every event on the shared bus. Call stop() when done. */
export function recordEvents() {
  const events = [];
  const stop = M.ev.on('*', (payload, name) => { events.push({ name, payload }); });
  return { events, stop };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Runs fn with window.fetch replaced by `handler`, then puts the real fetch back. */
export async function withFetch(handler, fn) {
  const original = window.fetch;
  window.fetch = handler;
  try {
    return await fn();
  } finally {
    window.fetch = original;
  }
}