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
