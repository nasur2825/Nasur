/**
 * NASUR – Application Entry Point
 * File: js/core/app.js
 *
 * Loaded by index.html (the only <script>). On start-up it:
 *   1. applies the saved theme and language to the page
 *   2. wires the header: theme button, network status pill, skip link
 *   3. opens the database, prepares the default project, loads user settings
 *   4. loads the module list, builds the navigation, registers the built-in
 *      "All Modules" view, starts the JARVIS button and drawer (loaded lazily,
 *      so a problem in JARVIS can never block start-up), and starts the router
 *      (Home is a normal module file: js/modules/home.js)
 *   5. removes the boot screen, registers the service worker (offline
 *      caching) and asks the browser to protect NASUR's stored data
 * If anything fails before the first screen, the boot screen shows a clear
 * message with a Reload button instead of staying on the spinner. A failure
 * of the JARVIS assistant alone never stops the rest of the app.
 *
 * Layout variables (set on <html> and kept up to date by trackLayout()):
 *   --nav-h          real height of the bottom navigation bar (0 if not at the bottom)
 *   --kb             height covered by the on-screen keyboard
 *   --vvh            visible viewport height
 *   --drawer-bottom  where a floating panel (the JARVIS drawer) must stop:
 *                    just above the navigation bar, or above the keyboard
 *
 * Messages for other files: modules never import this file. To show a toast
 * they emit an event:
 *   emit(EVENTS.TOAST, { message: 'Saved', type: 'success' })
 *   type: 'info' (default) | 'success' | 'warning' | 'danger'
 *   duration: milliseconds (optional; 0 = stays until dismissed)
 *
 * Page rules for all views: never use plain in-page anchors such as
 * href="#section". NASUR uses the address hash for its own routes, so an
 * anchor would be treated as a page address. Use hrefFor() from router.js.
 */

import { APP, EVENTS, LS_KEYS, THEMES } from './config.js';
import { emit, on } from './eventbus.js';
import {
  getModules,
  getModulesByGroup,
  getModulesByPdca,
  getNavItems,
  hrefFor,
  loadModuleRegistry,
  registerBuiltin,
  startRouter
} from './router.js';
import { openDb, requestPersistentStorage } from '../services/db.js';
import * as repo from '../services/repo.js';
import {
  getCachedLanguage,
  getLanguageInfo,
  getTheme,
  loadUserConfig,
  nextTheme,
  setTheme
} from '../services/config.js';
import { cleanText, html, renderHtml } from '../services/sanitize.js';


/* ==========================================================================
   1. CONSTANTS AND PAGE ELEMENTS
   ========================================================================== */

const PERSIST_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TOAST_GAP_MS = 5000;
const MAX_TOASTS = 3;
const KEYBOARD_MIN_PX = 120;

const THEME_COLORS = Object.freeze({ light: '#0b6e5a', dark: '#0e1513' });

const THEME_UI = Object.freeze({
  [THEMES.AUTO]: Object.freeze({ glyph: '◐', name: 'Automatic' }),
  [THEMES.LIGHT]: Object.freeze({ glyph: '☀', name: 'Light' }),
  [THEMES.DARK]: Object.freeze({ glyph: '☾', name: 'Dark' })
});

/** Elements from index.html, filled in by cacheElements(). */
const els = {
  boot: null,
  skipLink: null,
  subtitle: null,
  networkPill: null,
  themeButton: null,
  themeGlyph: null,
  navList: null,
  main: null,
  viewRoot: null,
  toastRegion: null
};

let lastOnline = true;
let lastErrorToastAt = 0;
let updateAnnounced = false;

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error('NASUR cannot start because index.html is missing the element "' + id + '". Upload the latest index.html and reload.');
  }
  return element;
}

function cacheElements() {
  els.boot = document.getElementById('boot-screen');
  els.skipLink = document.querySelector('.skip-link');
  els.subtitle = document.getElementById('app-subtitle');
  els.networkPill = requireElement('status-network');
  els.themeButton = requireElement('btn-theme');
  els.themeGlyph = requireElement('btn-theme-glyph');
  els.navList = requireElement('main-nav-list');
  els.main = requireElement('app-main');
  els.viewRoot = requireElement('view-root');
  els.toastRegion = requireElement('toast-region');
}


/* ==========================================================================
   2. TOASTS
   ========================================================================== */

function showToast(options) {
  if (!els.toastRegion || options === null || typeof options !== 'object') {
    return;
  }
  const message = cleanText(options.message);
  if (message === '') {
    return;
  }
  const type = ['info', 'success', 'warning', 'danger'].includes(options.type) ? options.type : 'info';
  const urgent = type === 'danger' || type === 'warning';
  const duration = Number.isFinite(options.duration) ? options.duration : (urgent ? 8000 : 4000);

  const toast = document.createElement('div');
  toast.className = type === 'info' ? 'toast' : 'toast toast--' + type;
  if (urgent) {
    toast.setAttribute('role', 'alert');
  }

  const text = document.createElement('span');
  text.className = 'toast__msg';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast__close';
  close.setAttribute('aria-label', 'Dismiss message');
  close.textContent = '✕';

  let timer = null;
  const dismiss = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    toast.remove();
  };
  close.addEventListener('click', dismiss);

  toast.append(text, close);
  els.toastRegion.append(toast);
  while (els.toastRegion.children.length > MAX_TOASTS) {
    els.toastRegion.firstElementChild.remove();
  }
  if (duration > 0) {
    timer = setTimeout(dismiss, duration);
  }
}


/* ==========================================================================
   3. THEME, LANGUAGE AND NETWORK STATUS
   ========================================================================== */

function applyThemeColorMeta(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') || '';
    let color = media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    if (theme === THEMES.LIGHT) {
      color = THEME_COLORS.light;
    } else if (theme === THEMES.DARK) {
      color = THEME_COLORS.dark;
    }
    meta.setAttribute('content', color);
  }
}

function applyTheme(theme) {
  const ui = THEME_UI[theme] || THEME_UI[THEMES.AUTO];
  document.documentElement.setAttribute('data-theme', THEME_UI[theme] ? theme : THEMES.AUTO);
  els.themeGlyph.textContent = ui.glyph;
  els.themeButton.setAttribute('aria-label', 'Change colour theme. Current theme: ' + ui.name + '.');
  applyThemeColorMeta(theme);
}

function applyLanguage(code) {
  const info = getLanguageInfo(code);
  document.documentElement.setAttribute('lang', info.code);
  document.documentElement.setAttribute('dir', info.dir);
}

function updateNetwork(announce) {
  const online = navigator.onLine !== false;
  els.networkPill.setAttribute('data-state', online ? 'online' : 'offline');
  els.networkPill.textContent = online ? 'Online' : 'Offline';
  if (online === lastOnline) {
    return;
  }
  lastOnline = online;
  emit(EVENTS.NETWORK_CHANGED, { online });
  if (announce) {
    showToast(online
      ? { message: 'You are back online.', type: 'success', duration: 3000 }
      : { message: 'You are offline. NASUR keeps working and saves on this device.', type: 'warning', duration: 6000 });
  }
}

function wireStaticUi() {
  if (els.subtitle) {
    els.subtitle.textContent = APP.TAGLINE;
  }

  els.themeButton.addEventListener('click', () => {
    const theme = setTheme(nextTheme(getTheme()));
    showToast({ message: 'Theme: ' + THEME_UI[theme].name, type: 'info', duration: 1800 });
  });

  // The address hash is used for routes, so the skip link must not change it.
  if (els.skipLink) {
    els.skipLink.addEventListener('click', (event) => {
      event.preventDefault();
      els.main.focus();
    });
  }

  on(EVENTS.THEME_CHANGED, (payload) => applyTheme(payload.theme));
  on(EVENTS.CONFIG_CHANGED, (payload) => {
    if (payload.changed.includes('language')) {
      applyLanguage(payload.config.language);
    }
  });
  on(EVENTS.TOAST, (payload) => showToast(payload));

  lastOnline = navigator.onLine !== false;
  updateNetwork(false);
  window.addEventListener('online', () => updateNetwork(true));
  window.addEventListener('offline', () => updateNetwork(true));
}


/* ==========================================================================
   4. NAVIGATION
   ========================================================================== */

function buildNav() {
  const items = getNavItems();
  renderHtml(els.navList, html`${items.map((item) => html`<li class="main-nav__item">
    <a class="main-nav__link" href="${hrefFor(item.id)}" data-route="${item.route}">
      <span class="main-nav__icon" aria-hidden="true">${item.icon}</span>
      <span class="main-nav__label">${item.nav.label}</span>
    </a>
  </li>`)}`);
}

/** Marks the current page's link. Modules without their own tab highlight "More". */
function updateNavCurrent(info) {
  const links = Array.from(els.navList.querySelectorAll('.main-nav__link'));
  let target = info.route;
  if (!links.some((link) => link.getAttribute('data-route') === target)) {
    target = info.state === 'not_found' ? null : '/more';
  }
  for (const link of links) {
    if (link.getAttribute('data-route') === target) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

/**
 * Measures the real navigation bar and the on-screen keyboard and publishes
 * them as CSS variables (see the file header). Floating panels such as the
 * JARVIS drawer use --drawer-bottom, so they always stop above the nav bar
 * and above the keyboard instead of being cut off.
 */
function trackLayout() {
  const root = document.documentElement;
  const nav = els.navList.closest('nav') || els.navList;
  let queued = false;

  const measure = () => {
    queued = false;
    const viewport = window.visualViewport;
    const viewHeight = viewport ? viewport.height : window.innerHeight;
    const viewTop = viewport ? viewport.offsetTop : 0;
    const rect = nav.getBoundingClientRect();
    const atBottom = rect.height > 0 && rect.top > window.innerHeight / 2;
    const navHeight = atBottom ? Math.max(0, Math.min(240, Math.round(window.innerHeight - rect.top))) : 0;
    const keyboard = Math.max(0, Math.round(window.innerHeight - viewHeight - viewTop));

    root.style.setProperty('--nav-h', navHeight + 'px');
    root.style.setProperty('--kb', keyboard + 'px');
    root.style.setProperty('--vvh', Math.round(viewHeight) + 'px');
    root.style.setProperty('--drawer-bottom', (keyboard > KEYBOARD_MIN_PX ? keyboard : navHeight) + 'px');
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      window.requestAnimationFrame(measure);
    }
  };

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(schedule).observe(nav);
  }
  on(EVENTS.ROUTE_CHANGED, schedule);
  measure();
}


/* ==========================================================================
   5. BUILT-IN VIEW: ALL MODULES
   ========================================================================== */

function moduleCard(mod) {
  const badge = mod.status === 'active'
    ? html`<span class="badge badge--success">Available</span>`
    : html`<span class="badge">${mod.phase === null ? 'Planned' : 'Planned · Phase ' + mod.phase}</span>`;

  return html`<a class="card card--interactive" href="${hrefFor(mod.id)}">
    <div class="card__body stack stack--sm">
      <div class="cluster cluster--between">
        <h4 class="card__title"><span aria-hidden="true">${mod.icon}</span> ${mod.title}</h4>
        ${badge}
      </div>
      <p class="text-sm text-muted">${mod.description}</p>
    </div>
  </a>`;
}

function moduleSection(title, description, modules) {
  return html`<section>
    <h3 class="section__title">${title}</h3>
    ${description === '' ? '' : html`<p class="text-sm text-muted">${description}</p>`}
    <div class="card-grid">${modules.map(moduleCard)}</div>
  </section>`;
}

function buildModuleList(mode) {
  if (mode === 'pdca') {
    const sections = getModulesByPdca().map((entry) =>
      moduleSection(entry.stage.title, entry.stage.description, entry.modules));
    const system = getModules().filter((mod) => mod.pdca === null);
    if (system.length > 0) {
      sections.push(moduleSection('System', 'Core tools that support every stage.', system));
    }
    return html`${sections}`;
  }
  return html`${getModulesByGroup().map((entry) => moduleSection(entry.group.title, '', entry.modules))}`;
}

function moreView(ctx) {
  let mode = ctx.query.get('view') === 'pdca' ? 'pdca' : 'group';

  renderHtml(ctx.root, html`
    <header class="page-header">
      <div>
        <h2 class="page-header__title">All Modules</h2>
        <p class="page-header__sub">Everything NASUR will offer. Modules marked Planned are not available yet.</p>
      </div>
    </header>
    <div class="segmented" role="group" aria-label="Group modules by">
      <button type="button" class="segmented__btn" data-mode="group" aria-pressed="${mode === 'group' ? 'true' : 'false'}">By area</button>
      <button type="button" class="segmented__btn" data-mode="pdca" aria-pressed="${mode === 'pdca' ? 'true' : 'false'}">By PDCA stage</button>
    </div>
    <div class="stack stack--lg section" id="more-list"></div>
  `);

  const listElement = ctx.root.querySelector('#more-list');
  const buttons = Array.from(ctx.root.querySelectorAll('.segmented__btn'));
  renderHtml(listElement, buildModuleList(mode));

  for (const button of buttons) {
    button.addEventListener('click', () => {
      mode = button.getAttribute('data-mode') === 'pdca' ? 'pdca' : 'group';
      for (const other of buttons) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      }
      renderHtml(listElement, buildModuleList(mode));
    });
  }
}


/* ==========================================================================
   6. START-UP, FAILURE SCREEN AND BACKGROUND TASKS
   ========================================================================== */

function describeFailure(error) {
  const message = error instanceof Error && error.message ? error.message : '';
  if (message === '') {
    return 'NASUR could not start. Reload the page to try again.';
  }
  return message.startsWith('NASUR') ? message : 'NASUR could not start: ' + message;
}

/** Replaces the boot spinner with a readable message and a Reload button. */
function showBootFailure(error) {
  console.error('NASUR start-up failed.', error);
  const boot = els.boot || document.getElementById('boot-screen');
  if (!boot) {
    showToast({ message: describeFailure(error), type: 'danger' });
    return;
  }

  const spinner = boot.querySelector('.boot__spinner');
  if (spinner) {
    spinner.hidden = true;
  }
  const stuck = boot.querySelector('.boot__stuck');
  if (stuck) {
    stuck.hidden = true;
  }
  const text = boot.querySelector('.boot__text');
  if (text) {
    text.className = 'boot__text alert alert--danger';
    text.setAttribute('role', 'alert');
    text.textContent = describeFailure(error);
  }
  if (!boot.querySelector('[data-boot-retry]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary';
    button.setAttribute('data-boot-retry', '');
    button.textContent = 'Reload';
    button.addEventListener('click', () => window.location.reload());
    boot.append(button);
  }
}

function reportUnexpected(reason) {
  console.error('NASUR: unexpected error.', reason);
  const now = Date.now();
  if (now - lastErrorToastAt < ERROR_TOAST_GAP_MS) {
    return;
  }
  lastErrorToastAt = now;
  const message = reason instanceof repo.DbError
    ? reason.message
    : 'Something unexpected went wrong. If it keeps happening, reload the page.';
  showToast({ message, type: 'danger' });
}

function watchForErrors() {
  window.addEventListener('error', (event) => {
    if (event.error) {
      reportUnexpected(event.error);
    }
  });
  window.addEventListener('unhandledrejection', (event) => reportUnexpected(event.reason));
}

/** Tells the user (once) that a newer version of NASUR is ready. */
function announceUpdate() {
  if (updateAnnounced) {
    return;
  }
  updateAnnounced = true;
  showToast({ message: 'NASUR was updated. Reload this page to use the new version.', type: 'info', duration: 0 });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  // On the very first visit there is no controller yet, so an "update" is not news.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (hadController && event.data && event.data.type === 'SW_ACTIVATED') {
      announceUpdate();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      announceUpdate();
    }
  });

  const register = () => {
    navigator.serviceWorker
      .register(new URL('../../sw.js', import.meta.url).href)
      .then((registration) => registration.update().catch(() => {}))
      .catch((error) => console.warn('NASUR: offline caching is not available here.', error));
  };
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

async function readPersisted() {
  try {
    return Boolean(navigator.storage
      && typeof navigator.storage.persisted === 'function'
      && await navigator.storage.persisted());
  } catch {
    return false;
  }
}

/**
 * Asks the browser to keep NASUR's data. If it was already asked in the last
 * 7 days and the answer was no, it does not ask again (some browsers show a
 * permission prompt).
 */
async function ensurePersistence() {
  if (await readPersisted()) {
    return;
  }
  let lastAsked = null;
  try {
    lastAsked = localStorage.getItem(LS_KEYS.STORAGE_PERSIST_ASKED);
  } catch {
    lastAsked = null;
  }
  const lastMs = lastAsked ? Date.parse(lastAsked) : Number.NaN;
  if (Number.isFinite(lastMs) && Date.now() - lastMs < PERSIST_RETRY_MS) {
    return;
  }
  await requestPersistentStorage();
  try {
    localStorage.setItem(LS_KEYS.STORAGE_PERSIST_ASKED, new Date().toISOString());
  } catch {
    /* storage is blocked; the question may be asked again next time */
  }
}

/**
 * Loads and starts the JARVIS button and drawer. It is imported lazily on
 * purpose: if js/jarvis/drawer.js is missing or broken, only JARVIS is lost;
 * NASUR itself still starts.
 */
async function mountAssistant() {
  try {
    const jarvis = await import('../jarvis/drawer.js');
    const start = jarvis.mountJarvis || jarvis.initJarvisDrawer;
    if (typeof start !== 'function') {
      throw new Error('drawer.js has no mountJarvis export');
    }
    start();
  } catch (error) {
    console.error('NASUR: the JARVIS assistant could not start.', error);
    showToast({ message: 'The JARVIS assistant could not start. The rest of NASUR works normally.', type: 'warning' });
  }
}

async function startApp() {
  cacheElements();
  applyTheme(getTheme());
  applyLanguage(getCachedLanguage());
  wireStaticUi();

  await openDb();
  await repo.initRepo();
  const config = await loadUserConfig();
  applyLanguage(config.language);

  await loadModuleRegistry();
  buildNav();
  trackLayout();
  on(EVENTS.ROUTE_CHANGED, updateNavCurrent);
  registerBuiltin('more', moreView);
  void mountAssistant();
  await startRouter({ root: els.viewRoot, focusTarget: els.main });

  if (els.boot) {
    els.boot.remove();
  }
  watchForErrors();
  registerServiceWorker();
  void ensurePersistence();
}

startApp().catch(showBootFailure);
