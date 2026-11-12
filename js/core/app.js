/**
 * NASUR – Application Entry Point
 * File: js/core/app.js
 *
 * Loaded by index.html (the only <script>). On start-up it:
 *   1. applies the saved theme and language to the page
 *   2. wires the header: theme button, network status pill, skip link
 *   3. opens the database, prepares the default project, loads user settings
 *   4. loads the module list, builds the navigation, registers the two
 *      built-in views (Home and All Modules) and starts the router
 *   5. removes the boot screen, registers the service worker (offline
 *      caching) and asks the browser to protect NASUR's stored data
 * If anything fails before the first screen, the boot screen shows a clear
 * message with a Reload button instead of staying on the spinner.
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

import { APP, EVENTS, LS_KEYS, STORES, THEMES } from './config.js';
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
import { getStorageEstimate, openDb, requestPersistentStorage } from '../services/db.js';
import * as repo from '../services/repo.js';
import {
  getCachedLanguage,
  getEffectiveTimezone,
  getLanguageInfo,
  getTheme,
  getUserConfig,
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


/* ==========================================================================
   5. HELPERS FOR THE BUILT-IN VIEWS
   ========================================================================== */

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '–';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
  return shown + ' ' + units[unit];
}

function formatToday(config) {
  const locale = getLanguageInfo(config.language).speechLocale;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: getEffectiveTimezone(config)
    }).format(new Date());
  } catch {
    return new Date().toDateString();
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


/* ==========================================================================
   6. BUILT-IN VIEW: HOME
   Phase 1 shows only real information. The JARVIS command center, live clock
   and quick actions arrive in Phase 2.
   ========================================================================== */

async function homeView(ctx) {
  const config = await getUserConfig();
  const projectId = repo.getActiveProjectId();

  const [project, observationCount, actionCount, persisted, estimate] = await Promise.all([
    projectId ? repo.get(STORES.PROJECTS, projectId) : Promise.resolve(null),
    repo.count(STORES.OBSERVATIONS),
    repo.count(STORES.ACTIONS),
    readPersisted(),
    getStorageEstimate()
  ]);
  if (ctx.signal.aborted) {
    return;
  }

  const online = navigator.onLine !== false;
  const projectName = project && project.name ? project.name : 'None selected';

  const workBlock = observationCount + actionCount === 0
    ? html`<div class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">📋</div>
        <h3 class="empty-state__title">Nothing recorded yet</h3>
        <p class="empty-state__text">Observations, inspections and actions you save will appear here. NASUR never shows made-up numbers.</p>
        <div class="empty-state__actions">
          <a class="btn btn--primary" href="${hrefFor('more')}">See all modules</a>
        </div>
      </div>`
    : html`<div class="stat-grid">
        <div class="stat">
          <p class="stat__value">${observationCount}</p>
          <p class="stat__label">Observations</p>
        </div>
        <div class="stat">
          <p class="stat__value">${actionCount}</p>
          <p class="stat__label">Actions</p>
        </div>
      </div>`;

  const protectionBadge = persisted
    ? html`<span class="badge badge--success">Protected</span>`
    : html`<span class="badge badge--warning">Not guaranteed</span>`;
  const protectionNote = persisted
    ? 'The browser will keep NASUR data even when the device runs low on space.'
    : 'The browser may clear NASUR data if the device runs very low on space. Data backup will be available in a later update.';

  const usageItem = estimate.supported
    ? html`<li class="list__item">
        <div class="list__main">
          <p class="list__title">Storage used</p>
          <p class="list__meta">${formatBytes(estimate.usage)} of about ${formatBytes(estimate.quota)} available</p>
        </div>
      </li>`
    : '';

  renderHtml(ctx.root, html`
    <section class="hero">
      <h2 class="hero__title">Welcome to NASUR</h2>
      <p class="hero__text">${formatToday(config)}</p>
      <p class="hero__text">Your personal industrial HSE workspace. Everything you save stays on this device and works offline.</p>
    </section>

    <section class="section">
      <h3 class="section__title">Your work</h3>
      ${workBlock}
    </section>

    <section class="section">
      <h3 class="section__title">This device</h3>
      <ul class="list">
        <li class="list__item">
          <div class="list__main">
            <p class="list__title">Active project</p>
            <p class="list__meta">${projectName}</p>
          </div>
        </li>
        <li class="list__item">
          <div class="list__main">
            <p class="list__title">Network</p>
            <p class="list__meta">${online ? 'Connected. NASUR also works without a connection.' : 'Not connected. NASUR is working offline.'}</p>
          </div>
          <span class="badge ${online ? 'badge--success' : 'badge--warning'}">${online ? 'Online' : 'Offline'}</span>
        </li>
        <li class="list__item">
          <div class="list__main">
            <p class="list__title">Data protection</p>
            <p class="list__meta">${protectionNote}</p>
          </div>
          ${protectionBadge}
        </li>
        ${usageItem}
      </ul>
    </section>

    <section class="section">
      <div class="alert" role="note">
        <p class="alert__title">Support tool only</p>
        <p>NASUR helps you learn and keep records. It does not replace your site procedures, permits or the decisions of competent people.</p>
      </div>
    </section>
  `);
}


/* ==========================================================================
   7. BUILT-IN VIEW: ALL MODULES
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
   8. START-UP, FAILURE SCREEN AND BACKGROUND TASKS
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

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  const register = () => {
    navigator.serviceWorker
      .register(new URL('../../sw.js', import.meta.url).href)
      .catch((error) => console.warn('NASUR: offline caching is not available here.', error));
  };
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
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
  on(EVENTS.ROUTE_CHANGED, updateNavCurrent);
  registerBuiltin('home', homeView);
  registerBuiltin('more', moreView);
  await startRouter({ root: els.viewRoot, focusTarget: els.main });

  if (els.boot) {
    els.boot.remove();
  }
  watchForErrors();
  registerServiceWorker();
  void ensurePersistence();
}

startApp().catch(showBootFailure);