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
