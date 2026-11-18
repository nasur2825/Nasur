/**
 * NASUR – Home Command Center (module view)
 * File: js/modules/home.js
 *
 * The first screen (Blueprint section 7). It builds the cards chosen by
 * js/services/workspace.js (role + industry + experience + the person's own
 * layout):
 *   jarvis         greeting for the time of day and an ask bar (text or voice)
 *   quick_actions  one-tap shortcuts (a shortcut whose module is not built yet
 *                  asks JARVIS to build it)
 *   date_time      live date and clock in the chosen time zone
 *   weather        current weather, place chooser and general heat guidance
 *   today_summary  counts of what was saved today
 *   open_actions   open, overdue and due-soon actions
 *   reminders      pending reminders due soon or overdue
 *   learning       lesson progress
 *
 * REAL DATA ONLY: every number comes from saved records. With no records a
 * card shows a clean empty state. Nothing is invented.
 *
 * VIEW CONTRACT (js/core/router.js): export async function render(ctx), which
 * returns a cleanup function. One card failing never breaks the others: each
 * card fills itself and shows a short message if it cannot.
 *
 * The cards refresh when records are saved or deleted, when the project
 * changes, when the page becomes visible again, and at midnight. Changing the
 * language, time zone, units, role, industry or date format rebuilds Home.
 *
 * The ask bar opens JARVIS (js/jarvis/drawer.js) and sends the text through
 * its normal flow with getJarvis().ask(text), so the same privacy rules apply.
 */

import { EVENTS, STORES } from '../core/config.js';
import { emit, on } from '../core/eventbus.js';
import { getModule, hrefFor } from '../core/router.js';
import {
  dateKeyOf, dayPart, daysUntil, formatDate, formatDateLong, formatDateTime, formatTime,
  getZonedParts, isValidDateKey, todayKey
} from '../services/calendar.js';
import { getEffectiveTimezone, getUserConfig } from '../services/config.js';
import { keyRange } from '../services/db.js';
import { formatTemperature } from '../services/heat.js';
import * as repo from '../services/repo.js';
import { cleanText, html, renderHtml, truncateText } from '../services/sanitize.js';
import {
  getCachedWeather, getDeviceLocation, getLocation, getWeather, locationLabel,
  searchPlaces, setLocation, validateCoordinates
} from '../services/weather.js';
import { describeQuickActions, getWorkspace } from '../services/workspace.js';
import { getJarvis } from '../jarvis/drawer.js';
import { isRecognitionSupported, startListening } from '../jarvis/voice.js';


/* ==========================================================================
   1. CONSTANTS AND PURE HELPERS
   ========================================================================== */

const GREETINGS = Object.freeze({ morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Hello' });
const REBUILD_KEYS = Object.freeze(['language', 'timezone', 'industry', 'role', 'units', 'date_format', 'week_start']);
const REFRESH_DELAY_MS = 250;
const ASK_MAX_CHARS = 2000;
const ACTION_TEXT_MAX = 90;
const TOP_ACTIONS = 3;

function skeleton() {
  return html`<span class="visually-hidden" role="status">Loading</span>
    <span class="skeleton skeleton--title skeleton--w60" aria-hidden="true"></span>
    <span class="skeleton skeleton--line skeleton--w80" aria-hidden="true"></span>
    <span class="skeleton skeleton--block" aria-hidden="true"></span>`;
}

function emptyHtml(icon, title, text, actions) {
  return html`<div class="empty-state">
    <div class="empty-state__icon" aria-hidden="true">${icon}</div>
    <h4 class="empty-state__title">${title}</h4>
    <p class="empty-state__text">${text}</p>
    ${actions ? html`<div class="empty-state__actions">${actions}</div>` : ''}
  </div>`;
}

function statHtml(stat) {
  const inner = html`<p class="stat__value">${stat.value}</p><p class="stat__label">${stat.label}</p>`;
  return stat.href
    ? html`<a class="stat" href="${stat.href}" data-tone="${stat.tone || ''}">${inner}</a>`
    : html`<div class="stat" data-tone="${stat.tone || ''}">${inner}</div>`;
}

function moduleHref(moduleId) {
  const mod = moduleId ? getModule(moduleId) : null;
  return mod && mod.status === 'active' ? hrefFor(mod.id) : null;
}

function ageText(minutes) {
  if (minutes === null || minutes === undefined) {
    return 'earlier';
  }
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return minutes + ' min ago';
  }
  if (minutes < 1440) {
    return Math.floor(minutes / 60) + ' h ago';
  }
  return 'more than a day ago';
}

function windText(kmh, units) {
  if (typeof kmh !== 'number') {
    return '–';
  }
  return units === 'imperial' ? Math.round(kmh * 0.621371) + ' mph' : Math.round(kmh) + ' km/h';
}

function shortText(value, fallback) {
  const text = cleanText(value);
  if (text === '') {
    return fallback;
  }
  const cut = truncateText(text, ACTION_TEXT_MAX);
  return cut.length < text.length ? cut + '…' : cut;
}

function joinText(base, extra) {
  const start = base.trimEnd();
  if (start === '') {
    return extra;
  }
  return extra === '' ? start : start + ' ' + extra;
}

/** The heat guidance card (advisory only; all text comes from js/services/heat.js). */
function heatHtml(heat, units) {
  if (!heat.valid) {
    return html`<p class="widget__note">${heat.summary}</p>`;
  }
  return html`<div class="heat" data-level="${heat.level}">
    <div class="heat__header">
      <h4 class="heat__title">Heat guidance</h4>
      <span class="risk-badge" data-level="${heat.riskBadge}">${heat.title}</span>
    </div>
    <p class="heat__summary">${heat.summary}</p>
    <p class="widget__note">Feels like ${formatTemperature(heat.feelsLikeC, units)}</p>
    <details class="heat__more">
      <summary>What to consider</summary>
      <ul class="heat__actions">${heat.actions.map((line) => html`<li>${line}</li>`)}</ul>
      ${heat.notes.map((line) => html`<p class="widget__note">${line}</p>`)}
    </details>
    <p class="heat__disclaimer">${heat.disclaimer}</p>
  </div>`;
}

function quickActionHtml(action) {
  const inner = html`<span class="quick-action__icon" aria-hidden="true">${action.icon}</span>
    <span class="quick-action__label">${action.label}</span>`;
  if (action.kind === 'jarvis') {
    return html`<button type="button" class="quick-action" data-qa="jarvis">${inner}</button>`;
  }
  if (action.available) {
    return html`<a class="quick-action" href="${action.href}">${inner}</a>`;
  }
  return html`<button type="button" class="quick-action" data-qa="soon" data-label="${action.label}">${inner}<span class="quick-action__note">Build with JARVIS</span></button>`;
}


/* ==========================================================================
   2. THE VIEW
   ========================================================================== */

export async function render(ctx) {
  /* ---- load the layout and settings ------------------------------------ */
  let workspace;
  let config;
  try {
    [workspace, config] = await Promise.all([getWorkspace(), getUserConfig()]);
  } catch (error) {
    console.error('NASUR Home: the layout could not be loaded.', error);
    if (ctx.signal.aborted) {
      return undefined;
    }
    renderHtml(ctx.root, emptyHtml('⚠️', 'Home could not be loaded', 'Your saved data is not affected. Try again, or open All Modules.',
      html`<button type="button" class="btn btn--primary" data-act="retry">Try again</button>
        <a class="btn" href="${hrefFor('more')}">All modules</a>`));
    const retry = ctx.root.querySelector('[data-act="retry"]');
    if (retry) {
      retry.addEventListener('click', () => ctx.navigate('/home', { replace: true }));
    }
    return undefined;
  }
  if (ctx.signal.aborted) {
    return undefined;
  }
  if (workspace.widgets.length === 0) {
    renderHtml(ctx.root, emptyHtml('🧩', 'All Home cards are hidden', 'Every card on this screen has been turned off. You can still reach everything from All Modules.',
      html`<a class="btn btn--primary" href="${hrefFor('more')}">All modules</a>`));
    return undefined;
  }

  /* ---- shared state ------------------------------------------------------ */
  const gone = () => ctx.signal.aborted;
  const tz = getEffectiveTimezone(config);
  const env = {
    tz,
    locale: config.language,
    units: config.units,
    dateFormat: config.date_format,
    today: todayKey(tz)
  };
  const widgetOf = (id) => workspace.widgets.find((widget) => widget.id === id) || null;
  const bodyOf = (id) => ctx.root.querySelector('[data-body="' + id + '"]');
  const micAvailable = isRecognitionSupported();
  const stops = [];
  let clockTimer = null;
  let refreshTimer = null;
  let micSession = null;
  let clockEls = null;
  let greetingEl = null;
  let weather = { status: 'loading', location: null };
  let chooser = null;
  let weatherBusy = false;

  function clockOptions() {
    const widget = widgetOf('date_time');
    const format = widget ? widget.options.hour_format : 'auto';
    return format === '12' ? { hour12: true } : (format === '24' ? { hour12: false } : {});
  }

  function toast(message, type) {
    emit(EVENTS.TOAST, { message, type: type || 'info' });
  }

  /** Opens JARVIS and, when there is text, sends it through JARVIS's normal flow. */
  function askJarvis(text) {
    const jarvis = getJarvis();
    if (jarvis === null || jarvis === undefined) {
      toast('JARVIS is not available right now.', 'warning');
      return;
    }
    if (text === '') {
      jarvis.open();
      return;
    }
    jarvis.ask(text);
  }

  /* ---- frames ------------------------------------------------------------ */
  function frameHtml(widget) {
    const href = moduleHref(widget.module);
    const header = widget.id === 'jarvis'
      ? ''
      : html`<header class="widget__header">
          <h3 class="widget__title"><span class="widget__icon" aria-hidden="true">${widget.icon}</span> ${widget.title}</h3>
          ${href ? html`<a class="widget__link" href="${href}">See all</a>` : ''}
        </header>`;
    return html`<section class="${widget.id === 'jarvis' ? 'widget widget--hero' : 'widget'}" data-widget="${widget.id}" data-size="${widget.size}">
      ${header}
      <div class="widget__body" data-body="${widget.id}">${skeleton()}</div>
    </section>`;
  }

  /* ---- greeting and ask bar --------------------------------------------- */
  function greetingText(now) {
    return GREETINGS[dayPart(getZonedParts(now, env.tz).hour)];
  }

  function fillJarvis(body) {
    renderHtml(body, html`
      <h2 class="jarvis-hero__greeting" data-greeting>${greetingText(new Date())}</h2>
      <p class="jarvis-hero__sub">Your HSE safety assistant. Ask in English, Tamil, Hindi or Arabic, by typing or speaking.</p>
      <form class="ask-bar" data-ask-form>
        <input class="ask-bar__input" type="text" name="ask" maxlength="${ASK_MAX_CHARS}" autocomplete="off" placeholder="Ask JARVIS…" aria-label="Ask JARVIS">
        ${micAvailable ? html`<button type="button" class="icon-btn" data-act="mic" aria-label="Speak your question" aria-pressed="false"><span class="icon-btn__glyph" data-mic-glyph aria-hidden="true">🎤</span></button>` : ''}
        <button type="submit" class="btn btn--primary">Ask</button>
      </form>
      <p class="widget__note" data-ask-status role="status"></p>`);
    greetingEl = body.querySelector('[data-greeting]');

    const form = body.querySelector('[data-ask-form]');
    const input = form.elements.ask;
    const status = body.querySelector('[data-ask-status]');
    const micButton = body.querySelector('[data-act="mic"]');
    const glyph = body.querySelector('[data-mic-glyph]');

    function setMicState(state) {
      const active = state === 'starting' || state === 'listening' || state === 'processing';
      if (glyph) {
        glyph.textContent = active ? '⏹' : '🎤';
      }
      if (micButton) {
        micButton.setAttribute('aria-pressed', active ? 'true' : 'false');
        micButton.setAttribute('aria-label', active ? 'Stop voice typing' : 'Speak your question');
      }
      if (state === 'listening') {
        status.textContent = 'Listening… tap the button to stop.';
      } else if (state === 'starting') {
        status.textContent = 'Starting the microphone…';
      }
    }

    async function toggleMic() {
      if (micSession !== null) {
        micSession.stop();
        return;
      }
      const base = input.value;
      const current = startListening({
        language: env.locale,
        onText: (text) => {
          input.value = joinText(base, text);
        },
        onState: setMicState
      });
      micSession = current;
      const outcome = await current.done;
      if (micSession === current) {
        micSession = null;
      }
      if (gone() || outcome.reason === 'aborted') {
        return;
      }
      setMicState('idle');
      if (outcome.transcript !== '') {
        input.value = joinText(base, outcome.transcript);
        status.textContent = 'Voice text added. Please check it, then tap Ask.';
      } else {
        status.textContent = '';
      }
      if (outcome.error) {
        status.textContent = outcome.error.message;
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = cleanText(input.value, { multiline: true });
      if (text === '') {
        input.focus();
        return;
      }
      input.value = '';
      status.textContent = '';
      askJarvis(text);
    });
    if (micButton) {
      micButton.addEventListener('click', () => {
        void toggleMic();
      });
    }
  }

  /* ---- quick actions ----------------------------------------------------- */
  function fillQuick(body) {
    const actions = describeQuickActions(workspace.quickActions);
    renderHtml(body, html`<div class="quick-actions">${actions.map((action) => quickActionHtml(action))}</div>`);
    body.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-qa]') : null;
      if (target === null) {
        return;
      }
      if (target.getAttribute('data-qa') === 'jarvis') {
        askJarvis('');
      } else {
        askJarvis('Build module: ' + (target.getAttribute('data-label') || 'new module'));
      }
    });
  }

  /* ---- date and clock ---------------------------------------------------- */
  function fillClock(body) {
    const now = new Date();
    renderHtml(body, html`
      <p class="clock__time" data-clock-time>${formatTime(now, env.tz, env.locale, clockOptions())}</p>
      <p class="clock__date" data-clock-date>${formatDateLong(env.today, env.locale)}</p>
      <p class="clock__zone">${env.tz}${config.timezone === 'auto' ? ' (this device)' : ''}</p>`);
    clockEls = { time: body.querySelector('[data-clock-time]'), date: body.querySelector('[data-clock-date]') };
  }

  function tick() {
    const now = new Date();
    if (clockEls !== null) {
      const text = formatTime(now, env.tz, env.locale, clockOptions());
      if (clockEls.time.textContent !== text) {
        clockEls.time.textContent = text;
      }
    }
    if (greetingEl !== null) {
      const text = greetingText(now);
      if (greetingEl.textContent !== text) {
        greetingEl.textContent = text;
      }
    }
    const key = todayKey(env.tz, now);
    if (key !== env.today) {
      env.today = key;
      if (clockEls !== null) {
        clockEls.date.textContent = formatDateLong(key, env.locale);
      }
      scheduleRefresh();
    }
  }

  /* ---- data cards -------------------------------------------------------- */
  async function fillToday(body, widget) {
    const projectId = repo.getActiveProjectId();
    const stats = await Promise.all(widget.data.items.map(async (item) => {
      const value = item.date_field === 'date' && projectId !== null
        ? await repo.count(item.store, { index: 'project_date', range: keyRange.only([projectId, env.today]) })
        : await repo.count(item.store, { filter: (record) => record[item.date_field] === env.today });
      return { label: item.label, value, href: moduleHref(item.module) };
    }));
    if (gone()) {
      return;
    }
    if (stats.every((stat) => stat.value === 0)) {
      renderHtml(body, emptyHtml('📅', 'Nothing recorded today', 'Observations, inspections, Toolbox Talks and work log entries you save today are counted here.'));
      return;
    }
    renderHtml(body, html`<div class="stat-grid">${stats.map((stat) => statHtml(stat))}</div>`);
  }

  function daysLeft(key) {
    return isValidDateKey(key) ? daysUntil(key, env.today) : null;
  }

  async function fillActions(body, widget) {
    const closed = new Set(widget.data.closed_statuses);
    const soon = widget.options.due_soon_days;
    const rows = await repo.list(widget.data.store);
    if (gone()) {
      return;
    }
    const open = rows
      .filter((record) => !closed.has(record.status))
      .map((record) => ({ record, left: daysLeft(record[widget.data.target_date_field]) }));
    if (open.length === 0) {
      renderHtml(body, emptyHtml('✅', 'No open actions', 'Actions you create from observations, inspections and audits will be listed here until they are closed.'));
      return;
    }
    const overdue = open.filter((entry) => entry.left !== null && entry.left < 0);
    const dueSoon = open.filter((entry) => entry.left !== null && entry.left >= 0 && entry.left <= soon);
    const top = open.slice().sort((a, b) => (a.left === null ? 1 : (b.left === null ? -1 : a.left - b.left))).slice(0, TOP_ACTIONS);

    renderHtml(body, html`
      <div class="stat-grid">
        ${statHtml({ label: 'Open', value: open.length })}
        ${statHtml({ label: 'Overdue', value: overdue.length, tone: overdue.length > 0 ? 'danger' : '' })}
        ${statHtml({ label: 'Due in ' + soon + ' days', value: dueSoon.length, tone: dueSoon.length > 0 ? 'warning' : '' })}
      </div>
      <ul class="list">${top.map((entry) => html`<li class="list__item">
        <div class="list__main">
          <p class="list__title">${shortText(entry.record.description, 'Action')}</p>
          <p class="list__meta">${entry.left === null ? 'No target date' : 'Target ' + formatDate(entry.record[widget.data.target_date_field], env.dateFormat)}</p>
        </div>
        ${entry.left !== null && entry.left < 0 ? html`<span class="badge badge--danger">Overdue</span>` : (entry.left !== null && entry.left <= soon ? html`<span class="badge badge--warning">Due soon</span>` : '')}
      </li>`)}</ul>`);
  }

  async function fillReminders(body, widget) {
    const pending = new Set(widget.data.pending_statuses);
    const windowDays = widget.options.window_days;
    const rows = await repo.list(widget.data.store);
    if (gone()) {
      return;
    }
    const due = rows
      .filter((record) => pending.has(record.status) && !Number.isNaN(Date.parse(record[widget.data.due_field])))
      .map((record) => {
        const date = new Date(record[widget.data.due_field]);
        return { record, date, left: daysUntil(dateKeyOf(date, env.tz), env.today) };
      })
      .filter((entry) => entry.left <= windowDays)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, widget.options.max_items);
    if (due.length === 0) {
      renderHtml(body, emptyHtml('🔔', 'No reminders due', 'Reminders due in the next ' + windowDays + ' days, and any that are overdue, appear here.'));
      return;
    }
    renderHtml(body, html`<ul class="list">${due.map((entry) => html`<li class="list__item">
      <div class="list__main">
        <p class="list__title">${shortText(entry.record.title, 'Reminder')}</p>
        <p class="list__meta">${formatDateTime(entry.date, env.tz, env.locale)}</p>
      </div>
      ${entry.left < 0 ? html`<span class="badge badge--danger">Overdue</span>` : ''}
    </li>`)}</ul>`);
  }

  async function fillLearning(body, widget) {
    const completed = new Set(widget.data.completed_statuses);
    const started = new Set(widget.data.in_progress_statuses);
    const [progress, total] = await Promise.all([repo.list(widget.data.store), repo.count(STORES.LESSONS)]);
    if (gone()) {
      return;
    }
    if (total === 0) {
      renderHtml(body, emptyHtml('🎓', 'No lessons yet', 'Lessons arrive with the Learn module. Your progress will be shown here.'));
      return;
    }
    const done = progress.filter((record) => completed.has(record.status)).length;
    const going = progress.filter((record) => started.has(record.status)).length;
    renderHtml(body, html`
      <div class="stat-grid">
        ${statHtml({ label: 'Completed', value: done, tone: done > 0 ? 'success' : '' })}
        ${statHtml({ label: 'In progress', value: going })}
      </div>
      <progress class="progress" max="${total}" value="${Math.min(done, total)}" aria-label="Lessons completed"></progress>
      <p class="widget__note">${Math.min(done, total)} of ${total} lessons completed</p>`);
  }

  const dataFillers = { today_summary: fillToday, open_actions: fillActions, reminders: fillReminders, learning: fillLearning };

  async function safeFill(widget, fill) {
    const body = bodyOf(widget.id);
    if (body === null) {
      return;
    }
    try {
      await fill(body, widget);
    } catch (error) {
      if (gone()) {
        return;
      }
      console.error('NASUR Home: the "' + widget.id + '" card failed.', error);
      renderHtml(body, html`<p class="widget__note">This card could not be loaded. Your saved data is not affected.</p>`);
    }
  }

  function refreshData() {
    if (gone()) {
      return Promise.resolve();
    }
    return Promise.all(workspace.widgets.filter((widget) => dataFillers[widget.id]).map((widget) => safeFill(widget, dataFillers[widget.id])));
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void refreshData();
    }, REFRESH_DELAY_MS);
  }

  /* ---- weather ------------------------------------------------------------ */
  function paintWeather() {
    const body = bodyOf('weather');
    if (body === null || gone()) {
      return;
    }
    if (chooser !== null) {
      paintChooser(body);
      return;
    }
    const result = weather;
    const widget = widgetOf('weather');

    if (result.status === 'no_location') {
      renderHtml(body, emptyHtml('🌤️', 'Set your weather place', 'Choose a place to see the weather and general heat guidance. Only the place coordinates are sent to the free Open-Meteo weather service.',
        html`<button type="button" class="btn btn--primary" data-act="change-place">Choose place</button>`));
      return;
    }
    if (result.status === 'loading') {
      renderHtml(body, skeleton());
      return;
    }
    if (!result.reading) {
      renderHtml(body, html`
        <div class="alert alert--warning" role="note">
          <p class="alert__title">Weather is not available</p>
          <p>${result.error ? result.error.message : 'The weather could not be loaded.'}</p>
        </div>
        <div class="widget__footer">
          <button type="button" class="btn btn--primary btn--sm" data-act="refresh">Try again</button>
          <button type="button" class="btn btn--sm" data-act="change-place">Change place</button>
        </div>`);
      return;
    }

    const reading = result.reading;
    const details = widget && widget.options.details === true
      ? html`<dl class="kv">
          <div class="kv__row"><dt class="kv__label">Humidity</dt><dd class="kv__value">${typeof reading.humidity === 'number' ? Math.round(reading.humidity) + '%' : '–'}</dd></div>
          <div class="kv__row"><dt class="kv__label">Wind</dt><dd class="kv__value">${windText(reading.windKmh, env.units)}</dd></div>
          <div class="kv__row"><dt class="kv__label">UV today (highest)</dt><dd class="kv__value">${typeof reading.uvIndexMax === 'number' ? Math.round(reading.uvIndexMax) : '–'}</dd></div>
          <div class="kv__row"><dt class="kv__label">High / low</dt><dd class="kv__value">${formatTemperature(reading.tempMaxC, env.units)} / ${formatTemperature(reading.tempMinC, env.units)}</dd></div>
        </dl>`
      : '';
    const heat = result.heat
      ? heatHtml(result.heat, env.units)
      : html`<p class="widget__note">Heat guidance is hidden because this weather reading is more than 3 hours old. Refresh it when you are online.</p>`;
    const statusLine = weatherBusy
      ? html`<span class="spinner spinner--sm" aria-hidden="true"></span> Updating…`
      : (result.status === 'stale'
        ? 'Showing saved weather (' + ageText(result.ageMinutes) + '). ' + (result.error ? result.error.message : '')
        : 'Updated ' + ageText(result.ageMinutes) + '.');

    renderHtml(body, html`
      <div class="weather__main">
        <span class="weather__icon" aria-hidden="true">${result.condition.icon}</span>
        <div>
          <p class="weather__temp">${formatTemperature(reading.tempC, env.units)}</p>
          <p class="weather__condition">${result.condition.text}</p>
        </div>
      </div>
      <p class="weather__place">${locationLabel(result.location)}</p>
      ${details}
      ${heat}
      <div class="widget__footer">
        <button type="button" class="btn btn--sm" data-act="refresh" ${weatherBusy ? 'disabled' : ''}>Refresh</button>
        <button type="button" class="btn btn--sm" data-act="change-place">Change place</button>
      </div>
      <p class="widget__status">${statusLine}</p>`);
  }

  function paintChooser(body) {
    const state = chooser;
    const off = state.busy ? 'disabled' : '';
    renderHtml(body, html`
      <p class="widget__note">Search for your city or site. Only the coordinates of the place you choose are used.</p>
      <form class="stack stack--sm" data-search-form>
        <div class="field">
          <label class="field__label" for="weather-place">Place name</label>
          <input class="input" id="weather-place" name="place" type="text" maxlength="80" autocomplete="off" value="${state.query}">
        </div>
        <div class="btn-group">
          <button type="submit" class="btn btn--primary btn--sm" ${off}>Search</button>
          <button type="button" class="btn btn--sm" data-act="use-device" ${off}>Use device location</button>
          ${weather.location ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="cancel">Cancel</button>` : ''}
        </div>
      </form>
      ${state.busy ? html`<p class="widget__status" role="status"><span class="spinner spinner--sm" aria-hidden="true"></span> Working…</p>` : ''}
      ${state.message === '' ? '' : html`<p class="widget__note" role="status">${state.message}</p>`}
      ${state.results.length === 0 ? '' : html`<ul class="list list--actions">${state.results.map((place, index) => html`<li class="list__item">
        <button type="button" class="list-button" data-act="pick" data-index="${index}">${place.label}</button>
      </li>`)}</ul>`}
      <details class="heat__more">
        <summary>Enter coordinates instead</summary>
        <form class="stack stack--sm" data-coords-form>
          <div class="field-row">
            <div class="field">
              <label class="field__label" for="weather-lat">Latitude</label>
              <input class="input" id="weather-lat" name="latitude" type="text" inputmode="decimal" autocomplete="off" placeholder="13.0827">
            </div>
            <div class="field">
              <label class="field__label" for="weather-lon">Longitude</label>
              <input class="input" id="weather-lon" name="longitude" type="text" inputmode="decimal" autocomplete="off" placeholder="80.2707">
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="weather-name">Place name (optional)</label>
            <input class="input" id="weather-name" name="name" type="text" maxlength="80" autocomplete="off">
          </div>
          <button type="submit" class="btn btn--sm" ${off}>Save coordinates</button>
        </form>
      </details>`);
  }

  async function loadWeather(force) {
    if (weatherBusy) {
      return;
    }
    weatherBusy = true;
    try {
      const location = await getLocation();
      if (gone()) {
        return;
      }
      if (location === null) {
        weather = getCachedWeather(null);
        return;
      }
      const cached = getCachedWeather(location);
      weather = cached.reading ? cached : { status: 'loading', location };
      paintWeather();
      weather = await getWeather({ force, signal: ctx.signal });
    } catch (error) {
      if (gone()) {
        return;
      }
      console.error('NASUR Home: the weather could not be loaded.', error);
      if (weather.status === 'loading') {
        weather = { status: 'unavailable', location: weather.location, reading: null, error: { code: 'network', message: 'The weather could not be loaded.' } };
      }
    } finally {
      weatherBusy = false;
      paintWeather();
    }
  }

  async function chooserWork(job) {
    chooser = { ...chooser, busy: true, message: '' };
    paintWeather();
    try {
      await job();
    } catch (error) {
      if (gone()) {
        return;
      }
      chooser = { ...chooser, message: error && error.message ? error.message : 'Something went wrong. Please try again.' };
    }
    if (chooser !== null) {
      chooser = { ...chooser, busy: false };
    }
    paintWeather();
  }

  async function savePlace(place) {
    await setLocation(place);
    chooser = null;
    clearTimeout(null);
    await loadWeather(true);
  }

  function fillWeather(body) {
    body.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-act]') : null;
      if (target === null) {
        return;
      }
      const act = target.getAttribute('data-act');
      if (act === 'refresh') {
        void loadWeather(true);
      } else if (act === 'change-place') {
        chooser = { query: weather.location ? weather.location.name : '', results: [], message: '', busy: false };
        paintWeather();
      } else if (act === 'cancel') {
        chooser = null;
        paintWeather();
      } else if (act === 'use-device') {
        void chooserWork(async () => {
          const spot = await getDeviceLocation();
          await savePlace({ name: 'My location', latitude: spot.latitude, longitude: spot.longitude, source: 'device' });
        });
      } else if (act === 'pick') {
        const place = chooser && chooser.results[Number(target.getAttribute('data-index'))];
        if (place) {
          void chooserWork(() => savePlace({ ...place, source: 'search' }));
        }
      }
    });

    body.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target;
      if (chooser === null || !(form instanceof HTMLFormElement)) {
        return;
      }
      if (form.matches('[data-search-form]')) {
        const query = cleanText(form.elements.place.value);
        chooser = { ...chooser, query };
        void chooserWork(async () => {
          const places = await searchPlaces(query, { language: env.locale, signal: ctx.signal });
          chooser = { ...chooser, results: places, message: places.length === 0 ? 'No places found. Try another spelling, or enter coordinates.' : '' };
        });
      } else if (form.matches('[data-coords-form]')) {
        const coords = validateCoordinates(form.elements.latitude.value, form.elements.longitude.value);
        if (!coords.ok) {
          chooser = { ...chooser, message: Object.values(coords.errors)[0] };
          paintWeather();
          return;
        }
        const name = form.elements.name.value;
        void chooserWork(() => savePlace({ name, latitude: coords.latitude, longitude: coords.longitude, source: 'manual' }));
      }
    });
  }

  /* ---- build the page ------------------------------------------------------ */
  renderHtml(ctx.root, html`<div class="home"><div class="home-grid">${workspace.widgets.map((widget) => frameHtml(widget))}</div></div>`);

  const jarvisBody = bodyOf('jarvis');
  if (jarvisBody) {
    fillJarvis(jarvisBody);
  }
  const quickBody = bodyOf('quick_actions');
  if (quickBody) {
    fillQuick(quickBody);
  }
  const clockBody = bodyOf('date_time');
  if (clockBody) {
    fillClock(clockBody);
  }
  const weatherBody = bodyOf('weather');
  if (weatherBody) {
    fillWeather(weatherBody);
  }

  void refreshData();
  if (weatherBody) {
    void loadWeather(false);
  }

  /* ---- live updates ---------------------------------------------------------- */
  clockTimer = setInterval(tick, 1000);
  const onOnline = () => {
    if (weatherBody) {
      void loadWeather(false);
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      tick();
      scheduleRefresh();
    }
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  stops.push(
    on(EVENTS.RECORD_SAVED, scheduleRefresh),
    on(EVENTS.RECORD_DELETED, scheduleRefresh),
    on(EVENTS.PROJECT_CHANGED, scheduleRefresh),
    on(EVENTS.CONFIG_CHANGED, (payload) => {
      if (payload && Array.isArray(payload.changed) && payload.changed.some((key) => REBUILD_KEYS.includes(key))) {
        ctx.navigate(ctx.path, { replace: true });
      }
    })
  );

  return function cleanup() {
    clearInterval(clockTimer);
    clearTimeout(refreshTimer);
    if (micSession !== null) {
      micSession.abort();
      micSession = null;
    }
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    for (const stop of stops) {
      stop();
    }
  };
}
