/**
 * NASUR – JARVIS Page Context (consent-based, read-only)
 * File: js/jarvis/context.js
 *
 * Decides what JARVIS may know about the page the user is on (Addendum 9).
 * Nothing here reads what a person TYPED into a form. JARVIS only ever sees:
 *   page      which module and page the user is on (never record ids)
 *   form      the title and field labels of a form that is open
 *   field     the label, type and help text of the field used last
 *   selected  text the user selected AND chose to send
 *
 * SHARING LEVELS (user setting privacy.context_level, in js/services/config.js)
 *   off        nothing is shared
 *   page       the page only
 *   field      page + form + field (labels and help text, never typed values)
 *   selection  also selected text, when the user chooses to send it
 * `forAi: true` (sending to an online AI service) also needs privacy.ai_enabled;
 * without it nothing is shared. The offline helper on this device is not
 * affected by that switch.
 *
 * HOW VIEWS TAKE PART
 *   1. When a form view opens, describe it once and keep the remover:
 *        const forget = registerForm({
 *          id: 'obs_new', title: 'New observation',
 *          fields: [{ name: 'likelihood', label: 'Likelihood', type: 'select',
 *                     required: true, help: 'How likely is it to happen?' }]
 *        });
 *      and call forget() in the view's cleanup function.
 *   2. In the markup, wrap the form in an element with
 *      data-jarvis-form="obs_new" and mark each control with
 *      data-jarvis-field="likelihood". The tracker notes which field was used
 *      last (use field names that match the registered ones).
 *   3. Anything private (a personal note, an ID number) gets
 *      data-jarvis-private on its element, or private: true in its field
 *      description. Private fields are never described, and text selected
 *      inside them is never remembered. Password fields are always private.
 *
 * TRACKING (startContextTracking, called by the JARVIS drawer code)
 *   - follows route changes (page), the last focused registered field and,
 *     ONLY at level "selection", the most recent text selection. A remembered
 *     selection is kept in memory for 2 minutes, lowered levels erase it and
 *     it is never written to the database.
 *   - text selected inside the JARVIS panel itself is ignored.
 *
 * The drawer calls captureContext() when it opens, so what JARVIS sees is a
 * frozen copy that cannot change while the person is talking to it, and shows
 * buildPreview(snapshot) so the person can see exactly what is shared.
 * Redaction of emails, phone-like numbers and names is best effort, which is
 * why the preview shows the final selected text before anything is sent.
 */

import { EVENTS } from '../core/config.js';
import { on } from '../core/eventbus.js';
import { getModule } from '../core/router.js';
import { CONTEXT_LEVELS, USER_CONFIG_DEFAULTS, getCachedUserConfig } from '../services/config.js';
import { LIMITS, cleanText, escapeRegExp, isSafeId, truncateText } from '../services/sanitize.js';


/* ==========================================================================
   1. CONSTANTS
   ========================================================================== */

/** The longest selected text that is shared (longer text is shortened, and the preview says so). */
export const MAX_SELECTION_CHARS = 1000;

/** How long a remembered selection stays valid. */
export const SELECTION_TTL_MS = 2 * 60 * 1000;

export const FIELD_TYPES = Object.freeze(['text', 'textarea', 'select', 'date', 'time', 'number', 'checkbox', 'radio', 'file', 'other']);

const PAGE_VIEWS = Object.freeze(['ok', 'planned', 'not_found', 'error']);
const MAX_FORM_FIELDS = 60;
const MAX_LISTED_LABELS = 30;
const MAX_OPTIONS = 30;
const MAX_TITLE = 80;
const MAX_HELP = 300;
const MAX_OPTION_TEXT = 60;
const MAX_NAMES = 200;

/** Plain-language description of each sharing level, for the privacy settings and the drawer. */
export const CONTEXT_LEVEL_INFO = Object.freeze([
  Object.freeze({ id: 'off', title: 'Off', description: 'JARVIS cannot see anything about the page you are on.' }),
  Object.freeze({ id: 'page', title: 'Page only', description: 'JARVIS knows which page you are on, such as Observations.' }),
  Object.freeze({ id: 'field', title: 'Page and form fields', description: 'Also the form you have open and the field you used last: its label and help text, never what you typed.' }),
  Object.freeze({ id: 'selection', title: 'Include selected text', description: 'Also text you select on the screen, only when you choose to send it. You see it before it is shared.' })
]);


/* ==========================================================================
   2. STATE (in memory only)
   ========================================================================== */

let page = null;
const forms = new Map();
let focus = null;
let selection = null;
let knownNames = [];
let trackingStop = null;


/* ==========================================================================
   3. SMALL HELPERS
   ========================================================================== */

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

function bad(message) {
  return new TypeError('NASUR JARVIS context: ' + message);
}

/** Position of a level in the order off < page < field < selection (-1 when unknown). */
export function levelRank(level) {
  return CONTEXT_LEVELS.indexOf(level);
}

/** True when `level` is the same as or higher than `minimum`. */
export function levelAtLeast(level, minimum) {
  const have = levelRank(level);
  const need = levelRank(minimum);
  return have !== -1 && need !== -1 && have >= need;
}

/** The description of a level (the "Off" description for an unknown level). */
export function getLevelInfo(level) {
  return CONTEXT_LEVEL_INFO.find((entry) => entry.id === level) || CONTEXT_LEVEL_INFO[0];
}

/** Fills in missing or invalid privacy values with the safe defaults. */
function normalizePrivacy(raw) {
  const defaults = USER_CONFIG_DEFAULTS.privacy;
  const source = isPlainObject(raw) ? raw : {};
  return {
    ai_enabled: typeof source.ai_enabled === 'boolean' ? source.ai_enabled : defaults.ai_enabled,
    context_level: CONTEXT_LEVELS.includes(source.context_level) ? source.context_level : defaults.context_level,
    redact_names: typeof source.redact_names === 'boolean' ? source.redact_names : defaults.redact_names
  };
}

function currentPrivacy() {
  const config = getCachedUserConfig();
  return normalizePrivacy(config ? config.privacy : null);
}

/** The sharing level from the user's settings (the default before settings have loaded). */
export function getContextLevel() {
  return currentPrivacy().context_level;
}


/* ==========================================================================
   4. THE CURRENT PAGE
   ========================================================================== */

/**
 * Sets the page JARVIS knows about. Input: { module, title, route, view }.
 *   module  module id such as "observations", or null
 *   title   readable page name (never a record name or number)
 *   route   "/observations", or null
 *   view    "ok" (default), "planned", "not_found" or "error"
 * The tracker calls this on every route change; tests can call it directly.
 */
export function setPageContext(info) {
  if (!isPlainObject(info)) {
    throw bad('the page description must be an object.');
  }
  const moduleId = info.module === undefined || info.module === null ? null : info.module;
  if (moduleId !== null && !isSafeId(moduleId)) {
    throw bad('the module id must be letters, digits, underscores or hyphens.');
  }
  const title = cleanText(info.title);
  if (title === '' || title.length > MAX_TITLE) {
    throw bad('the page title is required and must be at most ' + MAX_TITLE + ' characters.');
  }
  const route = info.route === undefined || info.route === null ? null : info.route;
  if (route !== null && (typeof route !== 'string' || !/^\/[a-z0-9-]*$/.test(route))) {
    throw bad('the route must look like "/observations".');
  }
  const view = info.view === undefined ? 'ok' : info.view;
  if (!PAGE_VIEWS.includes(view)) {
    throw bad('the view must be one of: ' + PAGE_VIEWS.join(', ') + '.');
  }
  page = { module: moduleId, title, route, view };
}

/** A copy of the current page information, or null before the first page. */
export function getPageContext() {
  return page === null ? null : { ...page };
}

function onRouteChanged(info) {
  clearSelection();
  focus = null;
  const mod = info.module_id ? getModule(info.module_id) : null;
  const title = mod ? mod.title : (info.state === 'not_found' ? 'Page not found' : 'NASUR');
  const view = PAGE_VIEWS.includes(info.state) ? info.state : 'ok';
  try {
    setPageContext({ module: mod ? mod.id : null, title, route: mod ? mod.route : null, view });
  } catch (error) {
    console.warn('NASUR JARVIS context: the page could not be noted.', error);
    page = null;
  }
}


/* ==========================================================================
   5. FORMS AND FIELDS
   ========================================================================== */

function cleanLimited(value, label, max, required) {
  const text = cleanText(value);
  if (required && text === '') {
    throw bad(label + ' is required.');
  }
  if (text.length > max) {
    throw bad(label + ' is too long (at most ' + max + ' characters).');
  }
  return text;
}

function normalizeField(raw) {
  if (!isPlainObject(raw)) {
    throw bad('every field description must be an object.');
  }
  if (!isSafeId(raw.name)) {
    throw bad('a field name must be 1 to 64 letters, digits, underscores or hyphens.');
  }
  const type = raw.type === undefined ? 'text' : raw.type;
  if (!FIELD_TYPES.includes(type)) {
    throw bad('the field type "' + String(type) + '" is not one of: ' + FIELD_TYPES.join(', ') + '.');
  }

  const field = {
    name: raw.name,
    label: cleanLimited(raw.label, 'the label of field "' + raw.name + '"', MAX_TITLE, true),
    type,
    required: raw.required === true,
    help: cleanLimited(raw.help, 'the help text of field "' + raw.name + '"', MAX_HELP, false),
    options: [],
    private: raw.private === true
  };

  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || raw.options.length > MAX_OPTIONS) {
      throw bad('the options of field "' + raw.name + '" must be a list of at most ' + MAX_OPTIONS + ' items.');
    }
    field.options = raw.options.map((option) => cleanLimited(option, 'an option of field "' + raw.name + '"', MAX_OPTION_TEXT, true));
  }
  return Object.freeze(field);
}

/**
 * Describes a form for JARVIS. Input: { id, title, fields: [{ name, label,
 * type, required, help, options, private }] }. Registering the same id again
 * replaces the old description. Returns a function that removes the form
 * (call it from the view's cleanup). Throws TypeError for a mistake in the
 * description, which is a programming error and is never silently fixed.
 */
export function registerForm(definition) {
  if (!isPlainObject(definition)) {
    throw bad('a form description must be an object.');
  }
  if (!isSafeId(definition.id)) {
    throw bad('a form id must be 1 to 64 letters, digits, underscores or hyphens.');
  }
  const title = cleanLimited(definition.title, 'the form title', MAX_TITLE, true);
  if (!Array.isArray(definition.fields) || definition.fields.length === 0 || definition.fields.length > MAX_FORM_FIELDS) {
    throw bad('a form needs between 1 and ' + MAX_FORM_FIELDS + ' fields.');
  }

  const fields = new Map();
  for (const raw of definition.fields) {
    const field = normalizeField(raw);
    if (fields.has(field.name)) {
      throw bad('the field name "' + field.name + '" is used twice in form "' + definition.id + '".');
    }
    fields.set(field.name, field);
  }

  const entry = Object.freeze({ id: definition.id, title, fields });
  forms.set(entry.id, entry);

  return function unregister() {
    if (forms.get(entry.id) === entry) {
      forms.delete(entry.id);
      if (focus !== null && focus.formId === entry.id) {
        focus = null;
      }
    }
  };
}

/** Removes a form description by id. Returns true when there was one. */
export function unregisterForm(id) {
  const existed = forms.delete(id);
  if (focus !== null && focus.formId === id) {
    focus = null;
  }
  return existed;
}

/** True when a form with this id is registered. */
export function hasForm(id) {
  return forms.has(id);
}

/**
 * Notes the field the user used last. Returns false (and changes nothing)
 * when the form or field is not registered.
 */
export function setFocusedField(formId, fieldName) {
  const form = forms.get(formId);
  if (!form || !form.fields.has(fieldName)) {
    return false;
  }
  focus = { formId, fieldName };
  return true;
}

/** Forgets the last used field. */
export function clearFocusedField() {
  focus = null;
}

/** { formId, fieldName } of the last used field, or null. */
export function getFocusedField() {
  return focus === null ? null : { ...focus };
}


/* ==========================================================================
   6. REDACTION (best effort)
   ========================================================================== */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const NUMBER_PATTERN = /\+?\d[\d\s().-]{5,}\d/g;
const DATE_ONLY = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/;

/**
 * Names to hide from selected text (people, companies, sites). Kept in memory
 * only. Returns how many names were stored (names shorter than 2 or longer
 * than 60 characters, and repeats, are skipped; at most 200 are kept).
 */
export function setKnownNames(names) {
  if (!Array.isArray(names)) {
    throw bad('the list of names must be an array.');
  }
  const seen = new Set();
  const kept = [];
  for (const raw of names) {
    const name = cleanText(raw);
    const key = name.toLowerCase();
    if (name.length >= 2 && name.length <= 60 && !seen.has(key)) {
      seen.add(key);
      kept.push(name);
    }
  }
  knownNames = kept.slice(0, MAX_NAMES).sort((a, b) => b.length - a.length);
  return knownNames.length;
}

/**
 * Hides email addresses ("[email]"), numbers with 7 or more digits such as
 * phone and ID numbers ("[number]", dates are kept) and every known name
 * ("[name]") in `text`. It cannot recognize names that are not in the list.
 */
export function redactText(text, names) {
  let output = typeof text === 'string' ? text : '';
  output = output.replace(EMAIL_PATTERN, '[email]');
  output = output.replace(NUMBER_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 7 && !DATE_ONLY.test(match.trim()) ? '[number]' : match;
  });

  const list = Array.isArray(names) ? names : knownNames;
  const sorted = list
    .map((name) => cleanText(name))
    .filter((name) => name.length >= 2 && name.length <= 60)
    .sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const pattern = new RegExp('(?<![\\p{L}\\p{M}\\p{N}])' + escapeRegExp(name) + '(?![\\p{L}\\p{M}\\p{N}])', 'giu');
    output = output.replace(pattern, '[name]');
  }
  return output;
}


/* ==========================================================================
   7. SELECTED TEXT
   ========================================================================== */

/**
 * Remembers selected text, only when the sharing level is "selection"
 * (options.level overrides the user's setting, for tests). Any other level
 * erases what was remembered. Returns true when text was stored.
 * options: { level, now }
 */
export function rememberSelection(text, options = {}) {
  const settings = isPlainObject(options) ? options : {};
  const level = settings.level !== undefined ? settings.level : getContextLevel();
  if (!levelAtLeast(level, 'selection')) {
    clearSelection();
    return false;
  }
  const cleaned = cleanText(text, { multiline: true });
  if (cleaned === '') {
    return false;
  }
  selection = {
    text: truncateText(cleaned, LIMITS.TEXT),
    at: Number.isFinite(settings.now) ? settings.now : Date.now()
  };
  return true;
}

/** The remembered selection, or "" when there is none or it is older than 2 minutes. */
export function getSelectionText(now = Date.now()) {
  if (selection === null) {
    return '';
  }
  if (now - selection.at > SELECTION_TTL_MS || now < selection.at) {
    selection = null;
    return '';
  }
  return selection.text;
}

/** True when a selection is remembered and still valid. */
export function hasSelection(now = Date.now()) {
  return getSelectionText(now) !== '';
}

/** Forgets the remembered selection. */
export function clearSelection() {
  selection = null;
}


/* ==========================================================================
   8. CAPTURING AND PREVIEWING THE CONTEXT
   ========================================================================== */

/**
 * Builds a frozen copy of what JARVIS may see right now.
 * options:
 *   privacy           { context_level, ai_enabled, redact_names } to use
 *                     instead of the user's settings (missing values use the
 *                     safe defaults)
 *   forAi             true when the context is going to an online AI service:
 *                     it then also needs ai_enabled, otherwise nothing is shared
 *   includeSelection  true to include the remembered selected text (only at
 *                     level "selection"; the user must have chosen to send it)
 *   now               time in milliseconds, for tests
 * The result always has `level`; other parts appear only when the level
 * allows them and the information exists:
 *   { level, page: { module, title, route, view },
 *     form: { id, title, fields: [labels] },
 *     field: { name, label, type, required, help, options? },
 *     selected_text, selected_text_shortened, selected_text_redacted }
 * Typed values are never part of it.
 */
export function captureContext(options = {}) {
  const settings = isPlainObject(options) ? options : {};
  const privacy = normalizePrivacy(settings.privacy !== undefined ? settings.privacy : currentPrivacy());
  const level = settings.forAi === true && privacy.ai_enabled !== true ? 'off' : privacy.context_level;

  const snapshot = { level };
  if (level === 'off') {
    return deepFreeze(snapshot);
  }

  if (page !== null) {
    snapshot.page = { ...page };
  }

  if (levelAtLeast(level, 'field') && focus !== null) {
    const form = forms.get(focus.formId);
    if (form) {
      snapshot.form = {
        id: form.id,
        title: form.title,
        fields: Array.from(form.fields.values())
          .filter((field) => !field.private)
          .slice(0, MAX_LISTED_LABELS)
          .map((field) => field.label)
      };
      const field = form.fields.get(focus.fieldName);
      if (field && !field.private) {
        snapshot.field = { name: field.name, label: field.label, type: field.type, required: field.required };
        if (field.help !== '') {
          snapshot.field.help = field.help;
        }
        if (field.options.length > 0) {
          snapshot.field.options = field.options.slice();
        }
      }
    }
  }

  if (levelAtLeast(level, 'selection') && settings.includeSelection === true) {
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    let text = getSelectionText(now);
    if (text !== '') {
      if (privacy.redact_names) {
        text = redactText(text);
      }
      const shortened = text.length > MAX_SELECTION_CHARS;
      snapshot.selected_text = shortened ? truncateText(text, MAX_SELECTION_CHARS) : text;
      snapshot.selected_text_shortened = shortened;
      snapshot.selected_text_redacted = privacy.redact_names;
    }
  }

  return deepFreeze(snapshot);
}

/**
 * Turns a snapshot into plain rows for the "What JARVIS can see" panel:
 * [{ key, label, value }]. The values are text; render them with textContent
 * or the html`` helper.
 */
export function buildPreview(snapshot) {
  const level = snapshot && typeof snapshot === 'object' ? snapshot.level : 'off';
  const info = getLevelInfo(level);
  const rows = [{ key: 'level', label: 'Sharing level', value: info.title }];

  if (info.id === 'off') {
    rows.push({ key: 'nothing', label: 'Shared', value: 'Nothing about this page.' });
    return rows;
  }

  rows.push({
    key: 'page',
    label: 'Page',
    value: snapshot.page ? snapshot.page.title : 'Not known yet'
  });

  if (levelAtLeast(info.id, 'field')) {
    rows.push({ key: 'form', label: 'Form', value: snapshot.form ? snapshot.form.title : 'No form open' });
    rows.push({
      key: 'field',
      label: 'Field',
      value: snapshot.field
        ? snapshot.field.label + ' (' + snapshot.field.type + (snapshot.field.required ? ', required' : '') + ')'
        : 'No field selected'
    });
    rows.push({ key: 'values', label: 'What you typed', value: 'Never shared' });
  }

  if (levelAtLeast(info.id, 'selection')) {
    let value = 'None chosen';
    if (typeof snapshot.selected_text === 'string' && snapshot.selected_text !== '') {
      value = snapshot.selected_text;
      if (snapshot.selected_text_shortened === true) {
        value += ' … (shortened to ' + MAX_SELECTION_CHARS + ' characters)';
      }
      if (snapshot.selected_text_redacted === true) {
        value += ' (emails, phone numbers and known names are hidden)';
      }
    }
    rows.push({ key: 'selection', label: 'Selected text', value });
  }
  return rows;
}


/* ==========================================================================
   9. TRACKING THE PAGE (browser events)
   ========================================================================== */

function elementOf(node) {
  if (node === null || node === undefined) {
    return null;
  }
  return typeof Element !== 'undefined' && node instanceof Element ? node : node.parentElement || null;
}

/** True inside the JARVIS panel, inside private areas and for password fields. */
function isPrivateNode(node) {
  const element = elementOf(node);
  return element !== null && element.closest('[data-jarvis-private], input[type="password"], #jarvis-root') !== null;
}

function onFocusIn(event) {
  const target = elementOf(event.target);
  if (target === null) {
    return;
  }
  const fieldElement = target.closest('[data-jarvis-field]');
  const formElement = fieldElement === null ? null : fieldElement.closest('[data-jarvis-form]');
  if (fieldElement !== null && formElement !== null) {
    setFocusedField(formElement.getAttribute('data-jarvis-form'), fieldElement.getAttribute('data-jarvis-field'));
  }
}

function onSelectionChange() {
  if (!levelAtLeast(getContextLevel(), 'selection')) {
    return;
  }
  const current = window.getSelection();
  if (!current || current.rangeCount === 0 || current.isCollapsed) {
    return;
  }
  if (isPrivateNode(current.anchorNode) || isPrivateNode(current.focusNode)) {
    return;
  }
  rememberSelection(current.toString());
}

function onSelect(event) {
  if (!levelAtLeast(getContextLevel(), 'selection')) {
    return;
  }
  const target = event.target;
  const isTextBox = (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement)
    || (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement);
  if (!isTextBox || target.type === 'password' || isPrivateNode(target)) {
    return;
  }
  let start = null;
  let end = null;
  try {
    start = target.selectionStart;
    end = target.selectionEnd;
  } catch {
    return; // some input types (such as email) do not allow reading the selection
  }
  if (typeof start === 'number' && typeof end === 'number' && end > start) {
    rememberSelection(target.value.slice(start, end));
  }
}

function onConfigChanged(payload) {
  if (payload && Array.isArray(payload.changed) && payload.changed.includes('privacy.context_level')
    && !levelAtLeast(getContextLevel(), 'selection')) {
    clearSelection();
  }
}

/**
 * Starts following the page (route changes, the last used field and, at level
 * "selection", selected text). Returns a stop function. Calling it again
 * while tracking is on returns the same stop function.
 */
export function startContextTracking() {
  if (trackingStop !== null) {
    return trackingStop;
  }
  const stops = [on(EVENTS.ROUTE_CHANGED, onRouteChanged), on(EVENTS.CONFIG_CHANGED, onConfigChanged)];
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('select', onSelect, true);

  trackingStop = function stopTracking() {
    for (const stop of stops) {
      stop();
    }
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('select', onSelect, true);
    trackingStop = null;
  };
  return trackingStop;
}

/** True while tracking is on. */
export function isTracking() {
  return trackingStop !== null;
}

/** Forgets everything held in memory: page, forms, last field, selection and names (used by tests and data wipe). */
export function resetContext() {
  page = null;
  forms.clear();
  focus = null;
  selection = null;
  knownNames = [];
}