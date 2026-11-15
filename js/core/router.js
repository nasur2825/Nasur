import { APP, EVENTS, LS_KEYS } from './config.js';
import { emit } from './eventbus.js';
import { html, renderHtml } from '../services/sanitize.js';

export const DEFAULT_ROUTE = '/home';
const MODULES_URL = new URL('../../data/modules.json', import.meta.url).href;
const MODULE_BASE_URL = new URL('../../', import.meta.url).href;

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const ROUTE_PATTERN = /^\/[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_PATTERN = /^js\/modules\/[a-z0-9]+([_-][a-z0-9]+)*\.js$/;
const STATUSES = Object.freeze(['active', 'planned']);

let registry = null;
let registryPromise = null;
let modulesById = new Map();
let modulesByRoute = new Map();
const builtins = new Map();
const moduleCache = new Map();

let running = false;
let rootEl = null;
let focusEl = null;
let guard = null;
let navToken = 0;
let currentHash = '';
let currentRoute = null;
let currentView = null;
let currentCleanup = null;
let currentController = null;
let firstRender = true;

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isStr(v) { return typeof v === 'string' && v.trim() !== ''; }

export function validateRegistry(data) {
  if (!isPlainObject(data)) throw new Error('NASUR modules.json: invalid object');
  const stageIds = new Set((data.pdca_stages || []).map((s) => s.id));
  const groupIds = new Set((data.groups || []).map((g) => g.id));
  for (const mod of data.modules || []) {
    if (!ID_PATTERN.test(mod.id)) throw new Error('NASUR modules.json: invalid id ' + mod.id);
    const expectedRoute = '/' + mod.id.replace(/_/g, '-');
    if (mod.route !== expectedRoute || !ROUTE_PATTERN.test(mod.route)) {
      throw new Error('NASUR modules.json: module "' + mod.id + '" must have route "' + expectedRoute + '"');
    }
    if (!groupIds.has(mod.group)) throw new Error('NASUR modules.json: unknown group in ' + mod.id);
    if (mod.pdca !== null && !stageIds.has(mod.pdca)) throw new Error('NASUR modules.json: unknown pdca in ' + mod.id);
    if (!STATUSES.includes(mod.status)) throw new Error('NASUR modules.json: bad status in ' + mod.id);
    if (mod.file !== null && !FILE_PATTERN.test(mod.file)) {
      throw new Error('NASUR modules.json: invalid file path in ' + mod.id);
    }
  }
  return true;
}

export function setModuleRegistry(data) {
  validateRegistry(data);
  registry = JSON.parse(JSON.stringify(data));
  modulesById = new Map(registry.modules.map((m) => [m.id, m]));
  modulesByRoute = new Map(registry.modules.map((m) => [m.route, m]));
  return registry;
}

export function clearModuleRegistry() {
  registry = null; registryPromise = null;
  modulesById = new Map(); modulesByRoute = new Map();
}

export function loadModuleRegistry(options = {}) {
  if (registry && !options.force) return Promise.resolve(registry);
  if (registryPromise && !options.force) return registryPromise;
  registryPromise = fetch(MODULES_URL)
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((d) => setModuleRegistry(d))
    .finally(() => { registryPromise = null; });
  return registryPromise;
}

export function getRegistry() { return registry; }
export function getModules() { return registry ? registry.modules : []; }
export function getModule(id) { return modulesById.get(id) || null; }
export function getModuleByRoute(route) { return modulesByRoute.get(route) || null; }
export function isModuleOpenable(mod) { return Boolean(mod) && mod.status === 'active'; }

export function getNavItems() {
  return getModules().filter((m) => m.nav !== null && m.status === 'active').sort((a, b) => a.nav.order - b.nav.order);
}

export function getModulesByGroup() {
  if (!registry) return [];
  return registry.groups.slice().sort((a, b) => a.order - b.order)
    .map((group) => ({ group, modules: registry.modules.filter((m) => m.group === group.id) }))
    .filter((e) => e.modules.length > 0);
}

export function getModulesByPdca() {
  if (!registry) return [];
  return registry.pdca_stages.slice().sort((a, b) => a.order - b.order)
    .map((stage) => ({ stage, modules: registry.modules.filter((m) => m.pdca === stage.id) }))
    .filter((e) => e.modules.length > 0);
}

export function parseHash(hash) {
  let text = typeof hash === 'string' ? hash : '';
  if (text.startsWith('#')) text = text.slice(1);
  let queryText = '';
  const mark = text.indexOf('?');
  if (mark !== -1) { queryText = text.slice(mark + 1); text = text.slice(0, mark); }
  const raw = text.split('/').filter(Boolean);
  const segments = raw.map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { valid: true, path: '/' + raw.join('/'), segments, query: new URLSearchParams(queryText) };
}

export function routePath(moduleId, segments = [], query = {}) {
  let path = '/' + moduleId.replace(/_/g, '-');
  for (const s of segments) path += '/' + encodeURIComponent(String(s));
  const params = new URLSearchParams();
  for (const k of Object.keys(query || {})) {
    if (query[k] !== undefined && query[k] !== null) params.set(k, String(query[k]));
  }
  const q = params.toString();
  return q ? path + '?' + q : path;
}

export function hrefFor(moduleId, segments, query) { return '#' + routePath(moduleId, segments, query); }

export function registerBuiltin(moduleId, renderFn) { builtins.set(moduleId, renderFn); }
export function setNavigationGuard(fn) { guard = fn; return () => { if (guard === fn) guard = null; }; }

function teardown() {
  if (currentController) { currentController.abort(); currentController = null; }
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch {} }
  currentCleanup = null;
  currentView = null;
  if (rootEl) rootEl.replaceChildren();
}

function mountView() {
  const el = document.createElement('div');
  el.className = 'view';
  rootEl.replaceChildren(el);
  currentView = el;
  return el;
}

function commit(token, info, title) {
  if (token !== navToken || !rootEl) return;
  currentRoute = info;
  document.title = isStr(title) ? title + ' – ' + APP.NAME : APP.NAME;
  rootEl.removeAttribute('aria-busy');
  if (info.state === 'ok') {
    try { localStorage.setItem(LS_KEYS.LAST_ROUTE, info.query_string ? info.path + '?' + info.query_string : info.path); } catch {}
  }
  if (!firstRender) { window.scrollTo(0, 0); if (focusEl) focusEl.focus({ preventScroll: true }); }
  firstRender = false;
  emit(EVENTS.ROUTE_CHANGED, { ...info, segments: info.segments.slice() });
}

async function loadRenderer(mod) {
  if (mod.builtin) return builtins.get(mod.id);
  let loaded = moduleCache.get(mod.file);
  if (!loaded) {
    loaded = await import(MODULE_BASE_URL + mod.file);
    moduleCache.set(mod.file, loaded);
  }
  return loaded.render;
}

async function resolveRoute(token) {
  teardown();
  let parsed = parseHash(window.location.hash);
  if (parsed.segments.length === 0) {
    window.history.replaceState(null, '', '#' + DEFAULT_ROUTE);
    parsed = parseHash(window.location.hash);
  }
  currentHash = window.location.hash;
  const info = { hash: currentHash, path: parsed.path, route: null, module_id: null, segments: [], previous_path: currentRoute ? currentRoute.path : null, state: 'ok', query_string: parsed.query.toString() };
  const firstSeg = parsed.segments.length > 0 ? parsed.segments[0] : '';
  const mod = firstSeg ? modulesByRoute.get('/' + firstSeg.toLowerCase()) : undefined;

  if (!mod) {
    info.state = 'not_found';
    const v = mountView();
    renderHtml(v, html`<div class="empty-state"><h2 class="empty-state__title">Page not found</h2><a class="btn btn--primary" href="#/home">Go to Home</a></div>`);
    commit(token, info, 'Page not found');
    return;
  }

  info.route = mod.route; info.module_id = mod.id; info.segments = parsed.segments.slice(1);
  if (mod.status !== 'active') {
    info.state = 'planned';
    const v = mountView();
    renderHtml(v, html`<div class="empty-state"><div class="empty-state__icon">${mod.icon}</div><h2 class="empty-state__title">${mod.title}</h2><p class="empty-state__text">${mod.description}</p><p class="empty-state__text">Planned · Phase ${mod.phase || ''}</p><a class="btn btn--primary" href="#/home">Go to Home</a></div>`);
    commit(token, info, mod.title);
    return;
  }

  const renderer = await loadRenderer(mod);
  if (token !== navToken) return;
  const viewEl = mountView();
  const controller = new AbortController();
  currentController = controller;
  let viewTitle = null;
  const cleanup = await renderer({
    root: viewEl, module: mod, route: mod.route, path: parsed.path, segments: info.segments.slice(),
    query: parsed.query, signal: controller.signal, navigate,
    setTitle(t) { viewTitle = String(t); if (token === navToken) document.title = viewTitle + ' – ' + APP.NAME; }
  });
  if (token !== navToken) { if (typeof cleanup === 'function') cleanup(); return; }
  currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  commit(token, info, viewTitle || mod.title);
}

async function resolveCurrent() {
  navToken += 1;
  const token = navToken;
  try { await resolveRoute(token); } catch (err) {
    console.error('Router error:', err);
    const v = mountView();
    renderHtml(v, html`<div class="empty-state"><h2 class="empty-state__title">Could not load module</h2><p class="empty-state__text">${err.message || ''}</p><a class="btn btn--primary" href="#/home">Go to Home</a></div>`);
    commit(token, { hash: window.location.hash, path: '/', route: null, module_id: null, segments: [], previous_path: null, state: 'error', query_string: '' }, 'Error');
  }
}

function onHashChange() {
  if (!running || window.location.hash === currentHash) return;
  if (guard && guard({ from: currentHash, to: window.location.hash }) === false) {
    window.history.replaceState(null, '', currentHash || '#' + DEFAULT_ROUTE);
    return;
  }
  void resolveCurrent();
}

export async function startRouter(options = {}) {
  await loadModuleRegistry();
  rootEl = options.root; focusEl = options.focusTarget || null; firstRender = true; running = true;
  window.addEventListener('hashchange', onHashChange);
  await resolveCurrent();
}

export function stopRouter() {
  running = false; window.removeEventListener('hashchange', onHashChange);
  teardown(); rootEl = null; focusEl = null; guard = null; currentRoute = null; currentHash = '';
}

export function isRouterRunning() { return running; }
export function navigate(path, options = {}) {
  const h = path.startsWith('#') ? path : '#' + path;
  if (options.replace) window.history.replaceState(null, '', h);
  else window.location.hash = h;
  if (running) void resolveCurrent();
}
export function getCurrentRoute() { return currentRoute ? { ...currentRoute, segments: currentRoute.segments.slice() } : null; }
export function getCurrentView() { return currentView; }
export function getLastRoute() {
  try {
    const s = localStorage.getItem(LS_KEYS.LAST_ROUTE);
    if (!s || !registry) return null;
    const p = parseHash('#' + s);
    const mod = p.segments[0] ? modulesByRoute.get('/' + p.segments[0].toLowerCase()) : null;
    return mod && mod.status === 'active' ? s : null;
  } catch { return null; }
}
