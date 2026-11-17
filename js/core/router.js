/* NASUR router — permanent loader fix.
   - Phase 1-3 modules: render(ctx) with ctx.root = container element.
   - Phase 4-6 modules: mount(el, ctx) / render(el, ctx) with el = container element.
   - Hash routing (#/route?query), lazy module loading, navigation guard. */

import * as CONFIG from './config.js';
import * as BUS from './eventbus.js';

export const DEFAULT_ROUTE = '/home';
export const FILE_PATTERN = /^js\/modules\/[a-z0-9]+([_-][a-z0-9]+)*\.js$/;
export const ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
export const ROUTE_PATTERN = /^\/[a-z0-9]+(-[a-z0-9]+)*$/;

const REGISTRY_URL = 'data/modules.json';
const BLOCKED_STATUS = ['planned', 'disabled', 'hidden', 'retired'];
const ROUTE_EVENT = (CONFIG.EVENTS && CONFIG.EVENTS.ROUTE_CHANGED) || 'route:changed';

const state = {
  registry: null,
  byId: new Map(),
  byRoute: new Map(),
  builtins: new Map(),
  imports: new Map(),
  guard: null,
  running: false,
  opts: {},
  root: null,
  listener: null,
  current: null,
  last: null,
  view: null,
  rendered: null,
  token: 0
};

/* ---------- helpers ---------- */

function emit(name, payload) {
  try {
    if (typeof BUS.emit === 'function') BUS.emit(name, payload);
    else if (BUS.default && typeof BUS.default.emit === 'function') BUS.default.emit(name, payload);
  } catch (err) {
    console.warn('[router] emit failed', err);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePath(p) {
  let s = String(p == null ? '' : p).trim();
  s = s.replace(/^#/, '').split('?')[0];
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    /* keep raw */
  }
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
  return s === '' || s === '/' ? DEFAULT_ROUTE : s;
}

function toQuery(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const sp = new URLSearchParams();
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined && obj[k] !== null) sp.set(k, String(obj[k]));
  });
  return sp.toString();
}

function idsOf(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (typeof x === 'string' ? x : x && x.id))
    .filter(Boolean);
}

function resolveModule(ref) {
  if (!ref) return null;
  if (typeof ref === 'object') {
    if (ref.id && state.byId.has(ref.id)) return state.byId.get(ref.id);
    if (ref.route) return state.byRoute.get(normalizePath(ref.route)) || null;
    return null;
  }
  const s = String(ref);
  if (state.byId.has(s)) return state.byId.get(s);
  if (s[0] === '/' || s[0] === '#') return state.byRoute.get(normalizePath(s)) || null;
  return null;
}

function indexRegistry(reg) {
  state.byId = new Map();
  state.byRoute = new Map();
  reg.modules.forEach((m) => {
    state.byId.set(m.id, m);
    state.byRoute.set(m.route, m);
  });
}

/* ---------- registry ---------- */

export function validateRegistry(reg) {
  const errors = [];
  const finish = () => ({ valid: errors.length === 0, ok: errors.length === 0, errors });

  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    errors.push('registry must be an object');
    return finish();
  }
  if (!Array.isArray(reg.modules)) {
    errors.push('modules must be an array');
    return finish();
  }

  const stages = idsOf(reg.pdca_stages);
  const groups = idsOf(reg.groups);
  const seenIds = new Set();
  const seenRoutes = new Set();

  reg.modules.forEach((m, i) => {
    const label = m && m.id ? m.id : '#' + i;
    if (!m || typeof m !== 'object') {
      errors.push('module ' + label + ' must be an object');
      return;
    }
    if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) errors.push('module ' + label + ': bad id');
    else if (seenIds.has(m.id)) errors.push('module ' + label + ': duplicate id');
    else seenIds.add(m.id);

    if (typeof m.route !== 'string' || !ROUTE_PATTERN.test(m.route)) errors.push('module ' + label + ': bad route');
    else if (seenRoutes.has(m.route)) errors.push('module ' + label + ': duplicate route');
    else seenRoutes.add(m.route);

    if (m.builtin === true) {
      if (m.file !== null && m.file !== undefined) errors.push('module ' + label + ': builtin must have file null');
    } else if (typeof m.file !== 'string' || !FILE_PATTERN.test(m.file)) {
      errors.push('module ' + label + ': bad file path');
    }

    if (groups.length && m.group !== undefined && groups.indexOf(m.group) === -1) {
      errors.push('module ' + label + ': unknown group ' + m.group);
    }
    if (stages.length && m.pdca !== undefined && m.pdca !== null && stages.indexOf(m.pdca) === -1) {
      errors.push('module ' + label + ': unknown pdca ' + m.pdca);
    }
    if (m.id === 'home' && m.route !== DEFAULT_ROUTE) errors.push('home route must be ' + DEFAULT_ROUTE);
  });

  return finish();
}

export function setModuleRegistry(reg) {
  const result = validateRegistry(reg);
  if (!result.valid) throw new Error('Invalid module registry: ' + result.errors.join('; '));
  state.registry = clone(reg);
  indexRegistry(state.registry);
  return state.registry;
}

export function clearModuleRegistry() {
  state.registry = null;
  state.byId = new Map();
  state.byRoute = new Map();
  state.imports = new Map();
}

export async function loadModuleRegistry(url) {
  const res = await fetch(url || REGISTRY_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load module registry (HTTP ' + res.status + ')');
  const data = await res.json();
  return setModuleRegistry(data);
}

export function getRegistry() {
  return state.registry;
}

export function getModules() {
  return state.registry ? state.registry.modules.slice() : [];
}

export function getModule(id) {
  return state.byId.get(String(id)) || null;
}

export function getModuleByRoute(route) {
  if (route === undefined || route === null) return null;
  return state.byRoute.get(normalizePath(route)) || null;
}

export function isModuleOpenable(ref) {
  const m = resolveModule(ref);
  if (!m) return false;
  if (BLOCKED_STATUS.indexOf(m.status) !== -1) return false;
  if (m.builtin) return state.builtins.has(m.id) || m.id === 'more';
  return typeof m.file === 'string' && FILE_PATTERN.test(m.file);
}

export function getNavItems() {
  return getModules()
    .filter((m) => m.nav && isModuleOpenable(m))
    .slice()
    .sort((a, b) => (a.nav.order || 0) - (b.nav.order || 0))
    .map((m) => ({
      ...m,
      label: m.nav.label || m.title,
      href: hrefFor(m)
    }));
}

export function getModulesByGroup(group) {
  const list = getModules();
  if (group === undefined) {
    const out = {};
    list.forEach((m) => {
      (out[m.group] = out[m.group] || []).push(m);
    });
    return out;
  }
  return list.filter((m) => m.group === group);
}

export function getModulesByPdca(stage) {
  const list = getModules();
  if (stage === undefined) {
    const out = {};
    list.forEach((m) => {
      const key = m.pdca || 'none';
      (out[key] = out[key] || []).push(m);
    });
    return out;
  }
  return list.filter((m) => m.pdca === stage);
}

/* ---------- hash helpers ---------- */

export function parseHash(hash) {
  const input = hash === undefined ? (typeof location !== 'undefined' ? location.hash : '') : hash;
  let raw = String(input || '').replace(/^#/, '');
  const qi = raw.indexOf('?');
  const pathPart = qi >= 0 ? raw.slice(0, qi) : raw;
  const qs = qi >= 0 ? raw.slice(qi + 1) : '';
  const path = normalizePath(pathPart);
  const query = {};
  new URLSearchParams(qs).forEach((v, k) => {
    query[k] = v;
  });
  return {
    path,
    query,
    segments: path.split('/').filter(Boolean),
    hash: '#' + path + (qs ? '?' + qs : '')
  };
}

export function routePath(ref) {
  const m = resolveModule(ref);
  if (m) return m.route;
  if (typeof ref === 'string' && (ref[0] === '/' || ref[0] === '#')) return normalizePath(ref);
  return null;
}

export function hrefFor(ref, query) {
  const p = routePath(ref) || DEFAULT_ROUTE;
  const qs = toQuery(query);
  return '#' + p + (qs ? '?' + qs : '');
}

/* ---------- builtins and guard ---------- */

export function registerBuiltin(id, handler) {
  if (typeof id !== 'string' || !id) throw new Error('registerBuiltin needs a module id');
  if (typeof handler === 'function') handler = { render: handler };
  if (!handler || typeof handler !== 'object') throw new Error('registerBuiltin needs a handler');
  state.builtins.set(id, handler);
  return true;
}

export function setNavigationGuard(fn) {
  state.guard = typeof fn === 'function' ? fn : null;
  return state.guard;
}
/* ---------- module view adapter ---------- */

function firstParamName(fn) {
  let src = '';
  try {
    src = Function.prototype.toString.call(fn);
  } catch (e) {
    return null;
  }
  let m = src.match(/^\s*(?:async\s+)?(?:function\s*\*?\s*)?[A-Za-z_$][\w$]*\s*\(\s*([^),=\s]*)/);
  if (!m) m = src.match(/^\s*(?:async\s*)?\(\s*([^),=\s]*)/);
  if (!m) m = src.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/);
  return m ? m[1] : null;
}

function detectStyle(entryName, fn) {
  const p = firstParamName(fn);
  if (p) {
    if (/^(_?ctx|context|appctx|\$ctx|\{)/i.test(p)) return 'ctx';
    if (/^(_?el|_?root|container|host|node|mount|view|target|outlet|element|parent)$/i.test(p)) return 'el';
  }
  if (fn.length >= 2) return 'el';
  return entryName === 'mount' ? 'el' : 'ctx';
}

function pickEntry(mod) {
  if (!mod) return null;
  if (typeof mod.mount === 'function') return { name: 'mount', fn: mod.mount, owner: mod };
  if (typeof mod.render === 'function') return { name: 'render', fn: mod.render, owner: mod };
  const d = mod.default;
  if (d) {
    if (typeof d.mount === 'function') return { name: 'mount', fn: d.mount, owner: d };
    if (typeof d.render === 'function') return { name: 'render', fn: d.render, owner: d };
    if (typeof d === 'function') return { name: 'render', fn: d, owner: null };
  }
  return null;
}

function findTeardown(mod) {
  const holders = [mod, mod && mod.default].filter(Boolean);
  const names = ['unmount', 'destroy', 'teardown', 'cleanup'];
  for (const h of holders) {
    for (const n of names) {
      if (typeof h[n] === 'function') return h[n];
    }
  }
  return null;
}

export async function mountModuleView(mod, el, ctx) {
  const entry = pickEntry(mod);
  if (!entry) throw new Error('Module exports neither mount() nor render()');

  const context = ctx && typeof ctx === 'object' ? ctx : {};
  if (!context.root) context.root = el;
  try {
    if (!el.root) Object.defineProperty(el, 'root', { value: el, configurable: true, writable: true });
  } catch (e) {
    /* element property is a convenience only */
  }

  const first = detectStyle(entry.name, entry.fn);
  const attempts = first === 'ctx' ? ['ctx', 'el'] : ['el', 'ctx'];
  let result;
  let lastError = null;

  for (let i = 0; i < attempts.length; i += 1) {
    try {
      result = attempts[i] === 'el'
        ? await entry.fn.call(entry.owner, el, context)
        : await entry.fn.call(entry.owner, context);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const retryable = i === 0 && err instanceof TypeError && !el.firstChild;
      if (!retryable) throw err;
    }
  }
  if (lastError) throw lastError;

  const teardown = findTeardown(mod);
  return {
    async cleanup() {
      try {
        if (typeof result === 'function') await result();
        else if (result && typeof result.destroy === 'function') await result.destroy();
        else if (result && typeof result.unmount === 'function') await result.unmount();
        if (teardown) await teardown.call(null, el, context);
      } catch (err) {
        console.warn('[router] module cleanup failed', err);
      }
    }
  };
}

/* ---------- default builtin: All Modules ---------- */

function defaultMoreView(el, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'more-view';
  const h = document.createElement('h2');
  h.textContent = 'All Modules';
  wrap.appendChild(h);

  const groups = (state.registry && state.registry.groups) || [];
  groups
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach((g) => {
      const mods = getModulesByGroup(g.id).filter((m) => m.id !== 'more' && isModuleOpenable(m));
      if (!mods.length) return;
      const sec = document.createElement('section');
      const t = document.createElement('h3');
      t.textContent = (g.icon ? g.icon + ' ' : '') + g.title;
      sec.appendChild(t);
      const grid = document.createElement('div');
      grid.className = 'more-grid';
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;';
      mods.forEach((m) => {
        const a = document.createElement('a');
        a.className = 'more-card card';
        a.href = hrefFor(m);
        a.style.cssText = 'display:block;padding:12px;border-radius:12px;text-decoration:none;color:inherit;border:1px solid var(--border, rgba(128,128,128,.3));';
        const title = document.createElement('strong');
        title.textContent = (m.icon ? m.icon + ' ' : '') + m.title;
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:.85em;opacity:.75;margin-top:4px;';
        desc.textContent = m.description || '';
        a.appendChild(title);
        a.appendChild(desc);
        grid.appendChild(a);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
  el.replaceChildren(wrap);
}

const DEFAULT_BUILTINS = {
  more: { render: defaultMoreView }
};

/* ---------- rendering ---------- */

function resolveRoot(opts) {
  if (opts && opts.nodeType === 1) return opts;
  const c = opts && (opts.root || opts.container || opts.outlet || opts.el || opts.element || opts.target);
  if (c && c.nodeType === 1) return c;
  if (typeof c === 'string') {
    const found = document.querySelector(c);
    if (found) return found;
  }
  const selectors = ['[data-router-root]', '#app-root', '#view', '#app-view', '#router-view', '#main-view', '#app', 'main'];
  for (const sel of selectors) {
    const found = document.querySelector(sel);
    if (found) return found;
  }
  return null;
}

function buildContext(route, el) {
  const o = state.opts || {};
  let base = {};
  try {
    if (typeof o.context === 'function') base = o.context(route) || {};
    else if (o.context && typeof o.context === 'object') base = o.context;
    else if (typeof o.getContext === 'function') base = o.getContext(route) || {};
    else if (o.ctx && typeof o.ctx === 'object') base = o.ctx;
  } catch (err) {
    console.warn('[router] context factory failed', err);
  }
  return Object.assign({}, base, {
    root: el,
    el,
    container: el,
    route,
    path: route.path,
    params: route.params,
    query: route.query,
    module: route.module,
    moduleId: route.id,
    navigate,
    hrefFor,
    routePath
  });
}

function showMessage(root, title, text, actions) {
  const box = document.createElement('div');
  box.className = 'router-message card';
  box.style.cssText = 'padding:16px;margin:16px;border-radius:12px;border:1px solid var(--border, rgba(128,128,128,.3));';
  const h = document.createElement('h3');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(h);
  box.appendChild(p);
  (actions || []).forEach((a) => {
    const b = document.createElement(a.href ? 'a' : 'button');
    b.textContent = a.label;
    b.style.cssText = 'margin-right:8px;padding:8px 12px;';
    if (a.href) b.href = a.href;
    if (a.onClick) b.addEventListener('click', a.onClick);
    box.appendChild(b);
  });
  root.replaceChildren(box);
}

async function teardownView() {
  const view = state.view;
  state.view = null;
  if (view && view.instance && typeof view.instance.cleanup === 'function') {
    try {
      await view.instance.cleanup();
    } catch (err) {
      console.warn('[router] teardown failed', err);
    }
  }
}

function loadModuleCode(m) {
  if (m.builtin) {
    return Promise.resolve(state.builtins.get(m.id) || DEFAULT_BUILTINS[m.id] || null);
  }
  if (!state.imports.has(m.file)) {
    const href = new URL(m.file, document.baseURI).href;
    const p = import(/* @vite-ignore */ href).catch((err) => {
      state.imports.delete(m.file);
      throw err;
    });
    state.imports.set(m.file, p);
  }
  return state.imports.get(m.file);
}

function setHashQuiet(hash, replace) {
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

async function renderHash(rawHash, options) {
  const opts = options || {};
  const root = state.root;
  if (!root) return false;

  if (!String(rawHash || '').replace(/^#/, '') || String(rawHash).replace(/^#/, '') === '/') {
    rawHash = '#' + DEFAULT_ROUTE;
    setHashQuiet(rawHash, true);
  }

  const parsed = parseHash(rawHash);
  const mod = getModuleByRoute(parsed.path);
  const route = {
    id: mod ? mod.id : null,
    path: parsed.path,
    route: parsed.path,
    hash: parsed.hash,
    query: parsed.query,
    params: parsed.query,
    segments: parsed.segments,
    module: mod
  };

  if (state.guard && state.current) {
    let allowed = true;
    try {
      allowed = await state.guard(state.current, route);
    } catch (err) {
      console.warn('[router] navigation guard failed', err);
    }
    if (allowed === false) {
      if (state.current.hash) {
        state.rendered = state.current.hash;
        setHashQuiet(state.current.hash, true);
      }
      return false;
    }
  }

  const token = ++state.token;
  state.rendered = parsed.hash;
  if (opts.source === 'navigate') setHashQuiet(parsed.hash, opts.replace);

  await teardownView();
  if (token !== state.token) return false;

  root.setAttribute('aria-busy', 'true');
  const loading = document.createElement('div');
  loading.className = 'router-loading';
  loading.style.cssText = 'padding:16px;opacity:.7;';
  loading.textContent = 'Loading…';
  root.replaceChildren(loading);

  const finish = (ok) => {
    root.removeAttribute('aria-busy');
    return ok;
  };

  if (!mod) {
    state.last = state.current;
    state.current = route;
    showMessage(root, 'Page not found', 'There is no module for ' + parsed.path + '.', [
      { label: 'Go Home', href: hrefFor(DEFAULT_ROUTE) }
    ]);
    return finish(false);
  }

  if (!isModuleOpenable(mod)) {
    state.last = state.current;
    state.last = state.current;
    state.current = route;
    showMessage(root, mod.title, 'This module is not available yet.', [
      { label: 'Go Home', href: hrefFor(DEFAULT_ROUTE) }
    ]);
    return finish(false);
  }

  try {
    const code = await loadModuleCode(mod);
    if (token !== state.token) return finish(false);
    if (!code) throw new Error('No handler registered for builtin module ' + mod.id);

    const ctx = buildContext(route, root);
    root.replaceChildren();
    const instance = await mountModuleView(code, root, ctx);

    if (token !== state.token) {
      if (instance && instance.cleanup) await instance.cleanup();
      return finish(false);
    }

    state.view = { id: mod.id, root, module: code, instance };
    state.last = state.current;
    state.current = route;

    try {
      document.documentElement.setAttribute('data-route', route.path);
      document.title = mod.title + ' · NASUR';
      if (typeof root.scrollTo === 'function') root.scrollTo(0, 0);
      window.scrollTo(0, 0);
    } catch (e) {
      /* cosmetic only */
    }

    emit(ROUTE_EVENT, {
      route: route.path,
      path: route.path,
      id: mod.id,
      module: mod,
      params: route.params,
      query: route.query,
      previous: state.last ? state.last.path : null
    });
    return finish(true);
  } catch (err) {
    console.error('[router] failed to open ' + mod.id, err);
    state.last = state.current;
    state.current = route;
    showMessage(root, 'Could not open ' + mod.title, (err && err.message) || String(err), [
      { label: 'Retry', onClick: () => renderHash(parsed.hash, { source: 'retry' }) },
      { label: 'Go Home', href: hrefFor(DEFAULT_ROUTE) }
    ]);
    return finish(false);
  }
}

/* ---------- public control ---------- */

function onHashChange() {
  const raw = location.hash;
  if (raw && parseHash(raw).hash === state.rendered) return;
  renderHash(raw, { source: 'hashchange' });
}

export function startRouter(options) {
  let opts = options;
  if (typeof opts === 'function') opts = { context: opts };
  opts = opts || {};

  if (state.running) {
    return renderHash(location.hash, { source: 'restart' });
  }

  const root = resolveRoot(opts);
  if (!root) throw new Error('Router could not find a container element to render into');
  if (!state.registry) throw new Error('Router has no module registry; call loadModuleRegistry() first');

  state.opts = opts;
  state.root = root;
  state.running = true;
  state.listener = onHashChange;
  window.addEventListener('hashchange', state.listener);
  return renderHash(location.hash, { source: 'start' });
}

export function stopRouter() {
  if (state.listener) window.removeEventListener('hashchange', state.listener);
  state.listener = null;
  state.running = false;
  state.token += 1;
  const done = teardownView();
  state.current = null;
  state.last = null;
  state.rendered = null;
  state.root = null;
  return done.then(() => true);
}

export function isRouterRunning() {
  return state.running;
}

export async function navigate(target, options) {
  const opts = options || {};
  let parsed;

  if (typeof target === 'string' && (target === '#' || target === '/')) {
    parsed = parseHash(target);
  } else {
    const p = routePath(target);
    parsed = parseHash('#' + (p || DEFAULT_ROUTE));
  }

  const merged = Object.assign({}, parsed.query, opts.query || {});
  const qs = toQuery(merged);
  const hash = '#' + parsed.path + (qs ? '?' + qs : '');

  if (!state.running) {
    setHashQuiet(hash, opts.replace);
    return true;
  }
  if (hash === state.rendered && !opts.force) return true;
  return renderHash(hash, { source: 'navigate', replace: !!opts.replace });
}

export function getCurrentRoute() {
  return state.current ? Object.assign({}, state.current) : null;
}

export function getCurrentView() {
  return state.view ? { id: state.view.id, root: state.view.root, module: state.view.module } : null;
}

export function getLastRoute() {
  return state.last ? Object.assign({}, state.last) : null;
}
