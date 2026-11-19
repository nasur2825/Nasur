/**
 * NASUR – User Configuration Service
 * File: js/services/config.js
 *
 * Reads, validates and saves the user's own configuration (Addendum 9):
 *   language, timezone, country, industry, role, units, date_format,
 *   week_start, privacy { ai_enabled, context_level, redact_names },
 *   apiKeys { <provider id>: "<key>" }   (added in the Phase 1 fix)
 * and the device-level colour theme.
 *
 * Not to be confused with js/core/config.js, which holds fixed app constants.
 *
 * Where values live:
 *   - user configuration: one record in the "settings" store (id "user_config")
 *   - language: also mirrored in LocalStorage so the page can pick its language
 *     before the database opens (getCachedLanguage)
 *   - theme: LocalStorage only (a per-device preference, read before the
 *     database opens)
 *
 * API keys (apiKeys):
 *   - Provider ids are lowercase words such as "openrouter", "gemini", "groq".
 *   - Saved in the database (IndexedDB), never in the page source.
 *   - updateUserConfig({ apiKeys: { openrouter: 'sk-or-...' } }) adds or changes
 *     keys and leaves the other keys alone. An empty string removes that key.
 *   - resetUserConfig() does NOT delete saved keys (they are credentials, not
 *     preferences). Use setApiKey(id, '') to remove one.
 *   - The JARVIS drawer reads keys from here AND from js/services/settings.js.
 *
 * Rules:
 *   - This file never touches the DOM. app.js listens for EVENTS.THEME_CHANGED
 *     and EVENTS.CONFIG_CHANGED and applies theme, lang and dir to the page.
 *   - Bad or missing stored values never crash the app: they fall back to the
 *     defaults. Bad values passed to updateUserConfig() are rejected with a
 *     DbError (code "invalid_data") whose `fields` property maps each bad
 *     field to a readable message. Nothing is saved when any field is bad.
 *   - Dates are always STORED as YYYY-MM-DD. date_format only controls how
 *     dates are SHOWN.
 *   - After restoring a backup, call loadUserConfig() so the in-memory copy
 *     is refreshed from the database.
 *   - role and industry are ids. Only their format is checked here; the
 *     career and industry data files (Phase 3) define which ids exist.
 *     Role ids for the eight career levels: beginner_learner, hse_assistant,
 *     safety_officer, hse_engineer, senior_hse_engineer, hse_supervisor,
 *     hse_manager, hse_consultant. Industry ids: construction, manufacturing,
 *     industrial_maintenance, facilities_management, warehousing_logistics,
 *     food_manufacturing, consultancy.
 */

import { DEFAULT_THEME, EVENTS, LS_KEYS, SETTINGS_KEYS, THEMES } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { DbError, getSetting, setSetting } from './repo.js';
import { cleanText } from './sanitize.js';


/* ==========================================================================
   1. ALLOWED VALUES AND DEFAULTS
   ========================================================================== */

/**
 * Supported interface languages. To add a language: add an entry here and
 * provide its translation data (Phase 9). `dir` is the text direction and
 * `speechLocale` is used for voice input and spoken output.
 */
export const SUPPORTED_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', name: 'English', nativeName: 'English', dir: 'ltr', speechLocale: 'en-US' }),
  Object.freeze({ code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', dir: 'ltr', speechLocale: 'ta-IN' }),
  Object.freeze({ code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr', speechLocale: 'hi-IN' }),
  Object.freeze({ code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl', speechLocale: 'ar-SA' })
]);

export const UNITS = Object.freeze(['metric', 'imperial']);
export const DATE_FORMATS = Object.freeze(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
export const WEEK_STARTS = Object.freeze(['monday', 'sunday', 'saturday']);

/**
 * How much page information JARVIS may read (Addendum 9). Each level adds
 * to the one before it:
 *   off        nothing is shared
 *   page       page and module names
 *   field      + form and field labels (never typed values)
 *   selection  + text the user selects and chooses to send
 */
export const CONTEXT_LEVELS = Object.freeze(['off', 'page', 'field', 'selection']);

export const DEFAULT_LANGUAGE = 'en';

/** The default configuration. `timezone: 'auto'` means "follow the device". */
export const USER_CONFIG_DEFAULTS = Object.freeze({
  language: DEFAULT_LANGUAGE,
  timezone: 'auto',
  country: null,
  industry: null,
  role: 'beginner_learner',
  units: 'metric',
  date_format: 'DD/MM/YYYY',
  week_start: 'monday',
  privacy: Object.freeze({
    ai_enabled: false,
    context_level: 'page',
    redact_names: true
  }),
  apiKeys: Object.freeze({})
});

const TOP_KEYS = Object.freeze(Object.keys(USER_CONFIG_DEFAULTS));
const PRIVACY_KEYS = Object.freeze(Object.keys(USER_CONFIG_DEFAULTS.privacy));

/** Version number written into the stored record, for future migrations. */
const STORED_CONFIG_VERSION = 1;

const LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((entry) => entry.code));
const ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]{1,29}$/;
const API_KEY_MAX_CHARS = 300;
const API_KEY_MAX_COUNT = 24;


/* ==========================================================================
   2. VALIDATION RULES
   Each rule takes a raw value and returns { ok: true, value } or
   { ok: false, message }.
   ========================================================================== */

function good(value) {
  return { ok: true, value };
}

function bad(message) {
  return { ok: false, message };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Returns the canonical IANA time zone name, or null when it is not valid. */
function canonicalTimeZone(text) {
  if (text === '' || text.startsWith('+') || text.startsWith('-')) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: text }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function pickFrom(list, normalize, message) {
  return (value) => {
    const text = normalize(cleanText(value));
    return list.includes(text) ? good(text) : bad(message);
  };
}

const ruleLanguage = (value) => {
  const code = cleanText(value).toLowerCase();
  return LANGUAGE_CODES.has(code) ? good(code) : bad('Choose one of the supported languages.');
};

const ruleTimezone = (value) => {
  const text = cleanText(value);
  if (text.toLowerCase() === 'auto') {
    return good('auto');
  }
  const canonical = canonicalTimeZone(text);
  return canonical ? good(canonical) : bad('Enter a valid time zone such as Asia/Kolkata, or choose Auto.');
};

const ruleCountry = (value) => {
  if (value === null || cleanText(value) === '') {
    return good(null);
  }
  const code = cleanText(value).toUpperCase();
  return COUNTRY_PATTERN.test(code) ? good(code) : bad('Use a two-letter country code such as IN or AE.');
};

const ruleIndustry = (value) => {
  if (value === null || cleanText(value) === '') {
    return good(null);
  }
  const id = cleanText(value).toLowerCase();
  return ID_PATTERN.test(id) ? good(id) : bad('The industry id must use lowercase letters, digits and underscores.');
};

const ruleRole = (value) => {
  const id = cleanText(value).toLowerCase();
  return ID_PATTERN.test(id) ? good(id) : bad('The role id must use lowercase letters, digits and underscores.');
};

const ruleUnits = pickFrom(UNITS, (text) => text.toLowerCase(), 'Choose metric or imperial.');
const ruleDateFormat = pickFrom(DATE_FORMATS, (text) => text.toUpperCase(), 'Choose DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD.');
const ruleWeekStart = pickFrom(WEEK_STARTS, (text) => text.toLowerCase(), 'Choose Monday, Sunday or Saturday.');

/**
 * API keys: an object of { providerId: key }. A key is a string of at most
 * 300 characters with no spaces or line breaks. An empty string is allowed
 * and means "remove this key".
 */
const ruleApiKeys = (value) => {
  if (!isPlainObject(value)) {
    return bad('API keys must be an object of provider ids and keys.');
  }
  const ids = Object.keys(value);
  if (ids.length > API_KEY_MAX_COUNT) {
    return bad('Too many API keys.');
  }
  const output = {};
  for (const id of ids) {
    const providerId = id.toLowerCase();
    if (!PROVIDER_ID_PATTERN.test(providerId)) {
      return bad('The provider id "' + id + '" must use lowercase letters, digits and underscores.');
    }
    const raw = value[id];
    if (raw === null || raw === undefined) {
      output[providerId] = '';
      continue;
    }
    if (typeof raw !== 'string') {
      return bad('The key for "' + id + '" must be text.');
    }
    const key = raw.trim();
    if (key.length > API_KEY_MAX_CHARS) {
      return bad('The key for "' + id + '" is too long.');
    }
    if (/\s/.test(key)) {
      return bad('The key for "' + id + '" must not contain spaces or line breaks.');
    }
    output[providerId] = key;
  }
  return good(output);
};

const PRIVACY_RULES = Object.freeze({
  ai_enabled: (value) => (typeof value === 'boolean' ? good(value) : bad('AI use must be on or off.')),
  context_level: pickFrom(CONTEXT_LEVELS, (text) => text.toLowerCase(), 'Choose off, page, field or selection.'),
  redact_names: (value) => (typeof value === 'boolean' ? good(value) : bad('Name hiding must be on or off.'))
});

const TOP_RULES = Object.freeze({
  language: ruleLanguage,
  timezone: ruleTimezone,
  country: ruleCountry,
  industry: ruleIndustry,
  role: ruleRole,
  units: ruleUnits,
  date_format: ruleDateFormat,
  week_start: ruleWeekStart,
  apiKeys: ruleApiKeys
});

/** Validates the privacy object (partial or complete). */
function validatePrivacyChanges(value) {
  if (!isPlainObject(value)) {
    return { value: {}, errors: { privacy: 'Privacy settings must be an object.' } };
  }
  const output = {};
  const errors = {};
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      continue;
    }
    if (!PRIVACY_KEYS.includes(key)) {
      errors['privacy.' + key] = 'Unknown privacy setting "' + key + '".';
      continue;
    }
    const result = PRIVACY_RULES[key](value[key]);
    if (result.ok) {
      output[key] = result.value;
    } else {
      errors['privacy.' + key] = result.message;
    }
  }
  return { value: output, errors };
}

/**
 * Validates a set of changes (any subset of the configuration).
 * Keys whose value is undefined are ignored. Resolves to
 * { value, errors } where `value` holds the cleaned valid fields and
 * `errors` maps each bad field name (or "privacy.<name>") to a message.
 */
export function validateConfigChanges(changes) {
  if (!isPlainObject(changes)) {
    return { value: {}, errors: { config: 'Settings must be an object.' } };
  }
  const value = {};
  const errors = {};

  for (const key of Object.keys(changes)) {
    if (changes[key] === undefined) {
      continue;
    }
    if (key === 'privacy') {
      const privacy = validatePrivacyChanges(changes.privacy);
      Object.assign(errors, privacy.errors);
      if (Object.keys(privacy.value).length > 0) {
        value.privacy = privacy.value;
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(TOP_RULES, key)) {
      errors[key] = 'Unknown setting "' + key + '".';
      continue;
    }
    const result = TOP_RULES[key](changes[key]);
    if (result.ok) {
      value[key] = result.value;
    } else {
      errors[key] = result.message;
    }
  }
  return { value, errors };
}


/* ==========================================================================
   3. NORMALIZING, COPYING AND COMPARING
   ========================================================================== */

function copyConfig(config) {
  return { ...config, privacy: { ...config.privacy }, apiKeys: { ...config.apiKeys } };
}

/** Returns a copy of a key map without the empty (removed) entries. */
function withoutEmptyKeys(map) {
  const output = {};
  for (const id of Object.keys(map)) {
    if (typeof map[id] === 'string' && map[id] !== '') {
      output[id] = map[id];
    }
  }
  return output;
}

function sameKeys(a, b) {
  const left = Object.keys(a).sort();
  const right = Object.keys(b).sort();
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, index) => id === right[index] && a[id] === b[id]);
}

/**
 * Turns anything stored in the database into a complete, valid configuration:
 * missing fields get defaults and invalid values are replaced by defaults.
 */
export function normalizeUserConfig(raw) {
  const output = copyConfig(USER_CONFIG_DEFAULTS);
  if (!isPlainObject(raw)) {
    return output;
  }
  for (const key of Object.keys(TOP_RULES)) {
    if (raw[key] === undefined) {
      continue;
    }
    const result = TOP_RULES[key](raw[key]);
    if (result.ok) {
      output[key] = key === 'apiKeys' ? withoutEmptyKeys(result.value) : result.value;
    }
  }
  if (isPlainObject(raw.privacy)) {
    for (const key of PRIVACY_KEYS) {
      if (raw.privacy[key] === undefined) {
        continue;
      }
      const result = PRIVACY_RULES[key](raw.privacy[key]);
      if (result.ok) {
        output.privacy[key] = result.value;
      }
    }
  }
  return output;
}

function applyChanges(current, partial) {
  const next = copyConfig(current);
  for (const key of Object.keys(partial)) {
    if (key === 'privacy') {
      next.privacy = { ...next.privacy, ...partial.privacy };
    } else if (key === 'apiKeys') {
      next.apiKeys = withoutEmptyKeys({ ...next.apiKeys, ...partial.apiKeys });
    } else {
      next[key] = partial[key];
    }
  }
  return next;
}

/** Lists the names of the fields that differ ("privacy.<name>" for privacy). */
function diffConfig(before, after) {
  const changed = [];
  for (const key of TOP_KEYS) {
    if (key === 'privacy') {
      for (const sub of PRIVACY_KEYS) {
        if (before.privacy[sub] !== after.privacy[sub]) {
          changed.push('privacy.' + sub);
        }
      }
    } else if (key === 'apiKeys') {
      if (!sameKeys(before.apiKeys, after.apiKeys)) {
        changed.push('apiKeys');
      }
    } else if (before[key] !== after[key]) {
      changed.push(key);
    }
  }
  return changed;
}


/* ==========================================================================
   4. LANGUAGE HELPERS
   ========================================================================== */

/** Returns the language entry for a code (English when the code is unknown). */
export function getLanguageInfo(code) {
  const wanted = typeof code === 'string' ? code.toLowerCase() : '';
  return SUPPORTED_LANGUAGES.find((entry) => entry.code === wanted) || SUPPORTED_LANGUAGES[0];
}

function mirrorLanguage(code) {
  try {
    localStorage.setItem(LS_KEYS.LANGUAGE, code);
  } catch {
    /* storage is blocked; the language still lives in the database */
  }
}

/**
 * The language to use before the database has opened (synchronous). Reads the
 * LocalStorage mirror and falls back to English.
 */
export function getCachedLanguage() {
  let stored = null;
  try {
    stored = localStorage.getItem(LS_KEYS.LANGUAGE);
  } catch {
    stored = null;
  }
  return typeof stored === 'string' && LANGUAGE_CODES.has(stored) ? stored : DEFAULT_LANGUAGE;
}


/* ==========================================================================
   5. TIME ZONE HELPERS
   ========================================================================== */

/** The device's own IANA time zone (UTC when it cannot be detected). */
export function getDeviceTimezone() {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The time zone the app should actually use (synchronous): the device zone
 * when the setting is "auto" or not loaded yet, otherwise the chosen zone.
 * Pass a configuration to resolve it explicitly.
 */
export function getEffectiveTimezone(config) {
  const source = config || cachedConfig;
  if (!source || source.timezone === 'auto') {
    return getDeviceTimezone();
  }
  return source.timezone;
}


/* ==========================================================================
   6. LOADING AND SAVING THE USER CONFIGURATION
   ========================================================================== */

let cachedConfig = null;
let writeQueue = Promise.resolve();

/** Runs saves one after another so two quick edits can never overwrite each other. */
function enqueue(work) {
  const run = writeQueue.then(work);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function buildValidationError(errors) {
  const first = Object.values(errors)[0] || 'Some settings are not valid.';
  const error = new DbError('invalid_data', first);
  error.fields = errors;
  return error;
}

async function persist(config) {
  await setSetting(SETTINGS_KEYS.USER_CONFIG, { ...copyConfig(config), config_version: STORED_CONFIG_VERSION });
}

/**
 * Reads the configuration from the database (always), refreshes the in-memory
 * copy and the language mirror, and returns a copy. Nothing is written.
 */
export async function loadUserConfig() {
  const raw = await getSetting(SETTINGS_KEYS.USER_CONFIG, null);
  cachedConfig = normalizeUserConfig(raw);
  mirrorLanguage(cachedConfig.language);
  return copyConfig(cachedConfig);
}

/** Returns a copy of the configuration (loads it on first use). */
export async function getUserConfig() {
  if (cachedConfig) {
    return copyConfig(cachedConfig);
  }
  return loadUserConfig();
}

/** Synchronous copy of the loaded configuration, or null before it has loaded. */
export function getCachedUserConfig() {
  return cachedConfig ? copyConfig(cachedConfig) : null;
}

/**
 * Saves changes to the configuration. Pass only the fields to change
 * (privacy may be partial: { privacy: { ai_enabled: true } };
 * apiKeys may be partial: { apiKeys: { groq: 'gsk_...' } }).
 * Rejects with DbError "invalid_data" (see `error.fields`) and saves nothing
 * if any field is not valid. Emits EVENTS.CONFIG_CHANGED with
 * { config, previous, changed } when something actually changed.
 * Resolves with a copy of the saved configuration.
 */
export function updateUserConfig(changes) {
  return enqueue(async () => {
    const checked = validateConfigChanges(changes);
    if (Object.keys(checked.errors).length > 0) {
      throw buildValidationError(checked.errors);
    }

    const previous = await getUserConfig();
    const next = applyChanges(previous, checked.value);
    const changed = diffConfig(previous, next);
    if (changed.length === 0) {
      return copyConfig(previous);
    }

    await persist(next);
    cachedConfig = next;
    if (changed.includes('language')) {
      mirrorLanguage(next.language);
    }
    emit(EVENTS.CONFIG_CHANGED, { config: copyConfig(next), previous, changed });
    return copyConfig(next);
  });
}

/**
 * Restores every setting to its default and saves it. Saved API keys are kept
 * (they are credentials, not preferences). Resolves with the new configuration.
 */
export function resetUserConfig() {
  return enqueue(async () => {
    const previous = await getUserConfig();
    const next = copyConfig(USER_CONFIG_DEFAULTS);
    next.apiKeys = { ...previous.apiKeys };
    const changed = diffConfig(previous, next);

    await persist(next);
    cachedConfig = next;
    mirrorLanguage(next.language);
    if (changed.length > 0) {
      emit(EVENTS.CONFIG_CHANGED, { config: copyConfig(next), previous, changed });
    }
    return copyConfig(next);
  });
}

/** Forgets the in-memory copy only (used by tests and after a data wipe). */
export function resetConfigCache() {
  cachedConfig = null;
}


/* ==========================================================================
   6b. API KEY HELPERS
   ========================================================================== */

/** Returns a copy of the saved API keys: { providerId: key }. */
export async function getApiKeys() {
  const config = await getUserConfig();
  return { ...config.apiKeys };
}

/** Saves (or, with an empty key, removes) one provider's API key. */
export function setApiKey(providerId, key) {
  return updateUserConfig({ apiKeys: { [String(providerId || '').toLowerCase()]: typeof key === 'string' ? key : '' } });
}


/* ==========================================================================
   7. THEME (per device, LocalStorage only)
   ========================================================================== */

const THEME_VALUES = Object.freeze(Object.values(THEMES));
let themeFallback = null;

function isTheme(value) {
  return typeof value === 'string' && THEME_VALUES.includes(value);
}

/** The saved theme: "auto", "light" or "dark" (works before the database opens). */
export function getTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(LS_KEYS.THEME);
  } catch {
    stored = null;
  }
  if (isTheme(stored)) {
    return stored;
  }
  return isTheme(themeFallback) ? themeFallback : DEFAULT_THEME;
}

/** The theme that follows `current` when the user taps the theme button. */
export function nextTheme(current) {
  if (current === THEMES.AUTO) {
    return THEMES.LIGHT;
  }
  if (current === THEMES.LIGHT) {
    return THEMES.DARK;
  }
  return THEMES.AUTO;
}

/**
 * Saves the theme and emits EVENTS.THEME_CHANGED { theme, previous } when it
 * changed. Applying it to the page (the data-theme attribute) is app.js's job.
 */
export function setTheme(theme) {
  if (!isTheme(theme)) {
    throw new DbError('invalid_data', 'The theme must be "auto", "light" or "dark".');
  }
  const previous = getTheme();
  themeFallback = theme;
  try {
    localStorage.setItem(LS_KEYS.THEME, theme);
  } catch {
    /* storage is blocked; the theme lasts until the page is closed */
  }
  if (previous !== theme) {
    emit(EVENTS.THEME_CHANGED, { theme, previous });
  }
  return theme;
}
