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

const SLOW_LOAD_MS = 200;
const MAX_HASH_LENGTH = 2000;

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

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

function setDocumentTitle(title) {
  document.title = isNonEmptyString(title)
    ? title + ' – ' + APP.NAME
    : APP.NAME + ' – ' + APP.TAGLINE;
}

function fail(message) {
  throw new Error('NASUR modules.json: ' + message);
}

function checkOrderedList(list, label) {
  const ids = new Set();
  for (const item of list) {
    if (!isPlainObject(item)) {
      fail('every entry in "' + label + '" must be an object.');
    }
    if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) {
      fail('invalid id "' + String(item.id) + '" in "' + label + '".');
    }
    if (ids.has(item.id)) {
      fail('duplicate id "' + item.id + '" in "' + label + '".');
    }
    ids.add(item.id);
    if (!isNonEmptyString(item.title)) {
      fail('"' + label + '" entry "' + item.id + '" needs a title.');
    }
    if (typeof item.order !== 'number' || !Number.isFinite(item.order)) {
      fail('"' + label + '" entry "' + item.id + '" needs a numeric order.');
    }
  }
  return ids;
}

export function validateRegistry(data) {
  if (!isPlainObject(data)) {
    fail('the file must contain an object.');
  }
  for (const key of ['pdca_stages', 'groups', 'modules']) {
    if (!Array.isArray(data[key])) {
      fail('"' + key + '" must be a list.');
    }
  }

  const stageIds = checkOrderedList(data.pdca_stages, 'pdca_stages');
  const groupIds = checkOrderedList(data.groups, 'groups');
  const moduleIds = new Set();

  for (const mod of data.modules) {
    if (!isPlainObject(mod)) {
      fail('every module must be an object.');
    }
    if (typeof mod.id !== 'string' || !ID_PATTERN.test(mod.id)) {
      fail('invalid module id "' + String(mod.id) + '".');
    }
    if (moduleIds.has(mod.id)) {
      fail('duplicate module id "' + mod.id + '".');
    }
    moduleIds.add(mod.id);

    const where = 'module "' + mod.id + '"';
    const expectedRoute = '/' + mod.id.replace(/_/g, '-');
    if (mod.route !== expectedRoute || !ROUTE_PATTERN.test(mod.route)) {
      fail(where + ' must have the route "' + expectedRoute + '".');
    }
    if (!isNonEmptyString(mod.title)) {
      fail(where + ' needs a title.');
    }
    if (!isNonEmptyString(mod.icon)) {
      fail(where + ' needs an icon.');
    }
    if (!isNonEmptyString(mod.description)) {
      fail(where + ' needs a description.');
    }
    if (!groupIds.has(mod.group)) {
      fail(where + ' uses an unknown group "' + String(mod.group) + '".');
    }
    if (mod.pdca !== null && !stageIds.has(mod.pdca)) {
      fail(where + ' uses an unknown PDCA stage "' + String(mod.pdca) + '".');
    }
    if (mod.phase !== null && !(Number.isInteger(mod.phase) && mod.phase >= 1)) {
      fail(where + ' must have a phase number of 1 or more, or null.');
    }
    if (!STATUSES.includes(mod.status)) {
      fail(where + ' must have the status "active" or "planned".');
    }
    if (typeof mod.builtin !== 'boolean') {
      fail(where + ' needs builtin set to true or false.');
    }
    if (mod.file !== null && !(typeof mod.file === 'string' && FILE_PATTERN.test(mod.file))) {
      fail(where + ' has an invalid file path. Use null or "js/modules/<name>.js".');
    }
    if (mod.nav !== null
      && !(isPlainObject(mod.nav) && Number.isFinite(mod.nav.order) && isNonEmptyString(mod.nav.label))) {
      fail(where + ' has an invalid nav entry.');
    }
    if (mod.status === 'active' && !mod.builtin && mod.file === null) {
      fail(where + ' is active but has no file and is not built in.');
    }
  }
  return true;
}

export function setModuleRegistry(data) {
  validateRegistry(data);
  const copy = deepFreeze(JSON.parse(JSON.stringify(data)));
  registry = copy;
  modulesById = new Map(copy.modules.map((mod) => [mod.id, mod]));
  modulesByRoute = new Map(copy.modules.map((mod) => [mod.route, mod]));
  return registry;
}

export function clearModuleRegistry() {
  registry = null;
  registryPromise = null;
  modulesById = new Map();
  modulesByRoute = new Map();
}
export function loadModuleRegistry(options = {}) {
  const force = Boolean(options && options.force);
  if (registry && !force) {
    return Promise.resolve(registry);
  }
  if (registryPromise && !force) {
    return registryPromise;
  }

  const attempt = (async () => {
    let response;
    try {
      response = await fetch(MODULES_URL);
    } catch (error) {
      throw new Error('NASUR could not load its module list (data/modules.json). Check your connection and reload.', { cause: error });
    }
    if (!response.ok) {
      throw new Error('NASUR could not load its module list (data/modules.json, status ' + response.status + '). Check that the file was uploaded.');
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('NASUR could not read its module list. data/modules.json is not valid JSON.', { cause: error });
    }
    return setModuleRegistry(data);
  })();

  registryPromise = attempt;
  attempt.then(
    () => { if (registryPromise === attempt) { registryPromise = null; } },
    () => { if (registryPromise === attempt) { registryPromise = null; } }
  );
  return attempt;
}

export function getRegistry() {
  return registry;
}

export function getModules() {
  return registry ? registry.modules : [];
}

export function getModule(id) {
  return modulesById.get(id) || null;
}

export function getModuleByRoute(route) {
  return modulesByRoute.get(route) || null;
}

export function isModuleOpenable(mod) {
  return Boolean(mod) && mod.status === 'active';
}

export function getNavItems() {
  return getModules()
    .filter((mod) => mod.nav !== null && mod.status === 'active')
    .slice()
    .sort((a, b) => a.nav.order - b.nav.order);
}

export function getModulesByGroup() {
  if (!registry) {
    return [];
  }
  return registry.groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((group) => ({ group, modules: registry.modules.filter((mod) => mod.group === group.id) }))
    .filter((entry) => entry.modules.length > 0);
}

export function getModulesByPdca() {
  if (!registry) {
    return [];
  }
  return registry.pdca_stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({ stage, modules: registry.modules.filter((mod) => mod.pdca === stage.id) }))
    .filter((entry) => entry.modules.length > 0);
}

export function parseHash(hash) {
  let text = typeof hash === 'string' ? hash : '';
  let valid = text.length <= MAX_HASH_LENGTH;
  if (text.startsWith('#')) {
    text = text.slice(1);
  }

  let queryText = '';
  const mark = text.indexOf('?');
  if (mark !== -1) {
    queryText = text.slice(mark + 1);
    text = text.slice(0, mark);
  }

  const rawSegments = text.split('/').filter((part) => part !== '');
  const segments = [];
  for (const part of rawSegments) {
    try {
      segments.push(decodeURIComponent(part));
    } catch {
      valid = false;
      segments.push(part);
    }
  }

  return {
    valid,
    path: '/' + rawSegments.join('/'),
    segments,
    query: new URLSearchParams(queryText)
  };
}

export function routePath(moduleId, segments = [], query = {}) {
  if (typeof moduleId !== 'string' || !ID_PATTERN.test(moduleId)) {
    throw new TypeError('NASUR router: routePath needs a module id such as "observations".');
  }
  if (!Array.isArray(segments)) {
    throw new TypeError('NASUR router: segments must be an array.');
  }

  let path = '/' + moduleId.replace(/_/g, '-');
  for (const segment of segments) {
    const text = String(segment);
    if (text === '') {
      throw new TypeError('NASUR router: a path segment cannot be empty.');
    }
    path += '/' + encodeURIComponent(text);
  }

  const params = new URLSearchParams();
  const source = query !== null && typeof query === 'object' ? query : {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const queryText = params.toString();
  return queryText === '' ? path : path + '?' + queryText;
}

export function hrefFor(moduleId, segments, query) {
  return '#' + routePath(moduleId, segments, query);
}

function toHash(path) {
  if (typeof path !== 'string') {
    throw new TypeError('NASUR router: a route must be a string.');
  }
  const text = path.startsWith('#') ? path.slice(1) : path;
  if (!text.startsWith('/') || /[\s#]/.test(text)) {
    throw new TypeError('NASUR router: a route must start with "/" and contain no spaces or "#".');
  }
  return '#' + text;
}

export function registerBuiltin(moduleId, renderFn) {
  if (typeof moduleId !== 'string' || !ID_PATTERN.test(moduleId)) {
    throw new TypeError('NASUR router: registerBuiltin needs a module id.');
  }
  if (typeof renderFn !== 'function') {
    throw new TypeError('NASUR router: registerBuiltin needs a render function.');
  }
  builtins.set(moduleId, renderFn);
}

export function setNavigationGuard(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('NASUR router: the navigation guard must be a function or null.');
  }
  guard = fn;
  return () => {
    if (guard === fn) {
      guard = null;
    }
  };
}

function guardAllows(from, to) {
  if (!guard) {
    return true;
  }
  try {
    return guard({ from, to }) !== false;
  } catch (error) {
    console.error('NASUR router: the navigation guard failed, so navigation was allowed.', error);
    return true;
  }
}

function homeActions() {
  return [
    html`<a class="btn btn--primary" href="#/home">Go to Home</a>`,
    html`<a class="btn" href="#/more">All modules</a>`
  ];
}

function stateView(icon, title, text, actions) {
  return html`<div class="empty-state">
    <div class="empty-state__icon" aria-hidden="true">${icon}</div>
    <h2 class="empty-state__title">${title}</h2>
    <p class="empty-state__text">${text}</p>
    <div class="empty-state__actions">${actions}</div>
  </div>`;
}

function notFoundView() {
  return stateView(
    '🔍',
    'Page not found',
    'We could not find that page. It may have been moved, or the link may be wrong.',
    homeActions()
  );
}

function plannedView(mod) {
  const when = mod.phase === null
    ? 'This module is planned for a later release and is not available yet.'
    : 'This module is planned for build phase ' + mod.phase + ' and is not available yet.';
  return html`<div class="empty-state">
    <div class="empty-state__icon" aria-hidden="true">${mod.icon}</div>
    <h2 class="empty-state__title">${mod.title}</h2>
    <p class="empty-state__text">${mod.description}</p>
    <p class="empty-state__text">${when}</p>
    <div class="empty-state__actions">${homeActions()}</div>
  </div>`;
}

function errorView(loadFailed) {
  const text = loadFailed
    ? 'This page could not be loaded. If you are offline and have not opened it before, connect to the internet once so NASUR can save it for offline use.'
    : 'Something went wrong while showing this page. Your saved data is not affected. Try again, or go back to Home.';
  const actions = [
    html`<button type="button" class="btn btn--primary" data-router-action="retry">Try again</button>`,
    html`<a class="btn" href="#/home">Go to Home</a>`
  ];
  return stateView('⚠️', 'This page could not be shown', text, actions);
}

function loadingView() {
  return html`<div class="empty-state" role="status">
    <span class="spinner" aria-label="Loading"></span>
    <p class="empty-state__text">Loading…</p>
  </div>`;
}

function wireRetry(viewEl) {
  const button = viewEl.querySelector('[data-router-action="retry"]');
  if (button) {
    button.addEventListener('click', () => {
      void resolveCurrent();
    });
  }
}
function runCleanup(fn) {
  if (typeof fn !== 'function') {
    return;
  }
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(undefined, (error) => console.error('NASUR router: a view cleanup failed.', error));
    }
  } catch (error) {
    console.error('NASUR router: a view cleanup failed.', error);
  }
}

function teardown() {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  const cleanup = currentCleanup;
  currentCleanup = null;
  runCleanup(cleanup);
  currentView = null;
  if (rootEl) {
    rootEl.replaceChildren();
  }
}

function mountView() {
  const viewEl = document.createElement('div');
  viewEl.className = 'view';
  rootEl.replaceChildren(viewEl);
  currentView = viewEl;
  return viewEl;
}

function rememberRoute(info) {
  const value = info.query_string === '' ? info.path : info.path + '?' + info.query_string;
  try {
    localStorage.setItem(LS_KEYS.LAST_ROUTE, value);
  } catch {
    /* optional */
  }
}

function commit(token, info, title) {
  if (token !== navToken || !rootEl) {
    return;
  }
  currentRoute = info;
  setDocumentTitle(title);
  rootEl.removeAttribute('aria-busy');
  if (info.state === 'ok') {
    rememberRoute(info);
  }
  if (!firstRender) {
    window.scrollTo(0, 0);
    if (focusEl && typeof focusEl.focus === 'function') {
      focusEl.focus({ preventScroll: true });
    }
  }
  firstRender = false;
  emit(EVENTS.ROUTE_CHANGED, { ...info, segments: info.segments.slice() });
}

function showState(token, info, title, view) {
  if (token !== navToken || !rootEl) {
    return;
  }
  const viewEl = mountView();
  renderHtml(viewEl, view);
  wireRetry(viewEl);
  commit(token, info, title);
}

async function loadRenderer(mod) {
  if (mod.builtin) {
    const builtin = builtins.get(mod.id);
    if (!builtin) {
      throw new Error('No built-in view is registered for "' + mod.id + '".');
    }
    return builtin;
  }
  if (mod.file === null) {
    throw new Error('The module "' + mod.id + '" has no file.');
  }
  let loaded = moduleCache.get(mod.file);
  if (!loaded) {
    loaded = await import(MODULE_BASE_URL + mod.file);
    moduleCache.set(mod.file, loaded);
  }
  if (typeof loaded.render !== 'function') {
    throw new Error('The module file "' + mod.file + '" does not export a render function.');
  }
  return loaded.render;
}

async function resolveRoute(token) {
  teardown();

  let parsed = parseHash(window.location.hash);
  if (parsed.valid && parsed.segments.length === 0) {
    window.history.replaceState(null, '', '#' + DEFAULT_ROUTE);
    parsed = parseHash(window.location.hash);
  }
  currentHash = window.location.hash;

  const info = {
    hash: currentHash,
    path: parsed.path,
    route: null,
    module_id: null,
    segments: [],
    previous_path: currentRoute ? currentRoute.path : null,
    state: 'ok',
    query_string: parsed.query.toString()
  };

  const firstSeg = parsed.segments.length > 0 ? parsed.segments[0] : '';
  const mod = parsed.valid && firstSeg !== ''
    ? modulesByRoute.get('/' + firstSeg.toLowerCase())
    : undefined;

  if (!mod) {
    info.state = 'not_found';
    showState(token, info, 'Page not found', notFoundView());
    return;
  }

  const rest = parsed.segments.slice(1);
  info.route = mod.route;
  info.module_id = mod.id;
  info.segments = rest;

  if (mod.status !== 'active') {
    info.state = 'planned';
    showState(token, info, mod.title, plannedView(mod));
    return;
  }

  rootEl.setAttribute('aria-busy', 'true');
  const slowTimer = setTimeout(() => {
    if (token === navToken && rootEl) {
      renderHtml(rootEl, loadingView());
    }
  }, SLOW_LOAD_MS);

  let renderer;
  try {
    renderer = await loadRenderer(mod);
  } catch (error) {
    clearTimeout(slowTimer);
    if (token !== navToken) {
      return;
    }
    console.error('NASUR router: could not load the "' + mod.id + '" module.', error);
    info.state = 'error';
    showState(token, info, mod.title, errorView(true));
    return;
  }
  clearTimeout(slowTimer);
  if (token !== navToken) {
    return;
  }

  const viewEl = mountView();
  const controller = new AbortController();
  currentController = controller;

  let viewTitle = null;
  const ctx = {
    root: viewEl,
    module: mod,
    route: mod.route,
    path: parsed.path,
    segments: rest.slice(),
    query: parsed.query,
    signal: controller.signal,
    navigate,
    setTitle(text) {
      viewTitle = String(text);
      if (token === navToken) {
        setDocumentTitle(viewTitle);
      }
    }
  };

  let cleanup;
  try {
    cleanup = await renderer(ctx);
  } catch (error) {
    if (token !== navToken) {
      return;
    }
    console.error('NASUR router: the "' + mod.id + '" view failed.', error);
    info.state = 'error';
    renderHtml(viewEl, errorView(false));
    wireRetry(viewEl);
    commit(token, info, mod.title);
    return;
  }

  if (token !== navToken) {
    runCleanup(cleanup);
    return;
  }
  currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  commit(token, info, viewTitle || mod.title);
}

async function resolveCurrent() {
  navToken += 1;
  const token = navToken;
  try {
    await resolveRoute(token);
  } catch (error) {
    console.error('NASUR router: unexpected routing error.', error);
    try {
      showState(token, {
        hash: window.location.hash,
        path: '/',
        route: null,
        module_id: null,
        segments: [],
        previous_path: null,
        state: 'error',
        query_string: ''
      }, 'Error', errorView(false));
    } catch (secondError) {
      console.error('NASUR router: the error view could not be shown.', secondError);
    }
  }
}

function onHashChange() {
  if (!running) {
    return;
  }
  const target = window.location.hash;
  if (target === currentHash) {
    return;
  }
  if (!guardAllows(currentHash, target)) {
    window.history.replaceState(null, '', currentHash === '' ? '#' + DEFAULT_ROUTE : currentHash);
    return;
  }
  void resolveCurrent();
}

export async function startRouter(options = {}) {
  if (running) {
    throw new Error('NASUR router: the router is already running.');
  }
  const root = options ? options.root : null;
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('NASUR router: startRouter needs a root element.');
  }

  await loadModuleRegistry();

  rootEl = root;
  focusEl = options.focusTarget || null;
  firstRender = true;
  running = true;
  window.addEventListener('hashchange', onHashChange);
  await resolveCurrent();
}

export function stopRouter() {
  if (!running) {
    return;
  }
  running = false;
  window.removeEventListener('hashchange', onHashChange);
  navToken += 1;
  teardown();
  if (rootEl) {
    rootEl.removeAttribute('aria-busy');
  }
  rootEl = null;
  focusEl = null;
  guard = null;
  currentRoute = null;
  currentHash = '';
}

export function isRouterRunning() {
  return running;
}

export function navigate(path, options = {}) {
  const hash = toHash(path);
  if (!running) {
    window.location.hash = hash;
    return;
  }
  const replace = Boolean(options && options.replace);
  if (replace || hash === window.location.hash) {
    if (!guardAllows(window.location.hash, hash)) {
      return;
    }
    if (replace) {
      window.history.replaceState(null, '', hash);
    }
    void resolveCurrent();
    return;
  }
  window.location.hash = hash;
}

export function getCurrentRoute() {
  return currentRoute ? { ...currentRoute, segments: currentRoute.segments.slice() } : null;
}

export function getCurrentView() {
  return currentView;
}

export function getLastRoute() {
  let stored = null;
  try {
    stored = localStorage.getItem(LS_KEYS.LAST_ROUTE);
  } catch {
    stored = null;
  }
  if (typeof stored !== 'string' || !stored.startsWith('/') || !registry) {
    return null;
  }
  const parsed = parseHash('#' + stored);
  if (!parsed.valid || parsed.segments.length === 0) {
    return null;
  }
  const firstSeg = parsed.segments[0];
  const mod = modulesByRoute.get('/' + firstSeg.toLowerCase());
  return mod && mod.status === 'active' ? stored : null;
}
