/**
 * NASUR – Sanitization and Safe Output Helpers
 * File: js/services/sanitize.js
 *
 * Security rules this file supports (Blueprint J):
 *   1. Text is STORED as the user typed it. Input cleaning removes only
 *      invisible or dangerous control characters and normalizes Unicode.
 *      It never strips words, tags or symbols, and it never truncates
 *      silently ("never silently overwrite user input").
 *   2. Text is made safe at OUTPUT time: escapeHtml(), the html`` template
 *      tag, or element.textContent. Never build markup by joining raw strings.
 *   3. Links built from user data must pass through safeUrl() or telHref().
 *   4. Exports to CSV/Excel must pass cells through toCsvCell() so a value
 *      such as =SUM(A1) cannot run as a spreadsheet formula.
 *
 * Rules for html`` templates:
 *   - Always wrap attribute values in double quotes: <a title="${value}">
 *   - Never put user data inside <script>, <style> or on* event attributes
 *     (the CSP blocks inline code anyway).
 *   - Put user URLs through safeUrl() before using them in href or src.
 *
 * This file has no imports and uses no browser APIs except URL (for links)
 * and, in renderHtml(), the element that is passed in.
 */


/* ==========================================================================
   1. CONSTANTS
   ========================================================================== */

/** Recommended maximum lengths (UTF-16 units) for validation messages. */
export const LIMITS = Object.freeze({
  SHORT: 120,
  LINE: 300,
  TEXT: 5000,
  LONG: 20000
});

/** C0 and C1 control characters, except tab (U+0009) and line feed (U+000A). */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Invisible characters used to disguise or reorder text:
 * zero-width space, bidirectional embedding/override marks, byte order mark.
 * Zero-width joiner and non-joiner (U+200C, U+200D) are KEPT because Hindi,
 * Arabic and other scripts need them to display correctly.
 */
const INVISIBLE_CHARS = /[\u200B\u202A-\u202E\uFEFF]/g;

/** Object keys that must never be copied (prototype pollution). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_DEPTH = 25;

const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
});

const DEFAULT_URL_PROTOCOLS = Object.freeze(['https:', 'http:', 'mailto:', 'tel:']);

/** First code point of the digit blocks: Arabic-Indic, Persian, Devanagari, Tamil. */
const DIGIT_BLOCK_STARTS = Object.freeze([0x0660, 0x06f0, 0x0966, 0x0be6]);

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;


/* ==========================================================================
   2. INTERNAL HELPERS
   ========================================================================== */

/** Converts string, finite number or boolean to a string; anything else to ''. */
function toStringSafe(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return '';
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}


/* ==========================================================================
   3. TEXT CLEANING (input)
   ========================================================================== */

/**
 * Cleans user-typed text without changing its meaning.
 *   - converts null/undefined/objects to '' and numbers/booleans to text
 *   - normalizes Unicode to NFC (same visible text, one consistent encoding)
 *   - converts all line endings to \n
 *   - removes control characters and invisible direction-spoofing characters
 *   - single-line mode (default): collapses all whitespace runs to one space
 *   - multiline mode ({ multiline: true }): keeps line breaks and tabs
 *   - trims both ends unless { trim: false }
 * It does NOT limit length: use isWithinLength() and show the user an error.
 */
export function cleanText(value, options = {}) {
  const multiline = options.multiline === true;
  const trim = options.trim !== false;

  let text = toStringSafe(value).normalize('NFC');
  text = text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n');
  text = text.replace(CONTROL_CHARS, '').replace(INVISIBLE_CHARS, '');

  if (!multiline) {
    text = text.replace(/\s+/g, ' ');
  }
  if (trim) {
    text = text.trim();
  }
  return text;
}

/** True when the text is no longer than maxLength (UTF-16 units). */
export function isWithinLength(value, maxLength) {
  return toStringSafe(value).length <= maxLength;
}

/**
 * Explicitly shortens text to maxLength without cutting an emoji or other
 * surrogate pair in half. Only call this when the user has agreed to it.
 */
export function truncateText(value, maxLength) {
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new RangeError('NASUR sanitize: maxLength must be a whole number of 0 or more.');
  }
  const text = toStringSafe(value);
  if (text.length <= maxLength) {
    return text;
  }
  let end = maxLength;
  if (end > 0) {
    const lastUnit = text.charCodeAt(end - 1);
    if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
      end -= 1;
    }
  }
  return text.slice(0, end);
}

/**
 * Converts Arabic-Indic, Persian, Devanagari and Tamil digits to 0-9, so
 * numbers typed on a Tamil, Hindi or Arabic keyboard can be validated.
 */
export function toAsciiDigits(value) {
  return toStringSafe(value).replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u0be6-\u0bef]/g, (character) => {
    const code = character.charCodeAt(0);
    for (const start of DIGIT_BLOCK_STARTS) {
      if (code >= start && code <= start + 9) {
        return String(code - start);
      }
    }
    return character;
  });
}


/* ==========================================================================
   4. HTML OUTPUT
   ========================================================================== */

/** Escapes text so it is safe inside HTML content and quoted attributes. */
export function escapeHtml(value) {
  return toStringSafe(value).replace(/[&<>"'`]/g, (character) => HTML_ESCAPES[character]);
}

/** Same as escapeHtml(); the name documents that the target is an attribute value. */
export function escapeAttr(value) {
  return escapeHtml(value);
}

/** Escapes text for use inside a RegExp pattern (for search highlighting). */
export function escapeRegExp(value) {
  return toStringSafe(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SAFE_TOKEN = Symbol('nasur-safe-html');

/** Markup that is known to be safe. Only html`` and raw() can create one. */
class SafeHtml {
  constructor(token, value) {
    if (token !== SAFE_TOKEN) {
      throw new TypeError('NASUR sanitize: create safe markup with html`` or raw().');
    }
    this.value = value;
    Object.freeze(this);
  }

  toString() {
    return this.value;
  }
}

/** True when the value was created by html`` or raw(). */
export function isSafeHtml(value) {
  return value instanceof SafeHtml;
}

/**
 * Marks a developer-written, constant markup string as safe.
 * NEVER pass user data, stored records or AI output to raw().
 */
export function raw(markup) {
  if (typeof markup !== 'string') {
    throw new TypeError('NASUR sanitize: raw() needs a string.');
  }
  return new SafeHtml(SAFE_TOKEN, markup);
}

function renderTemplateValue(value) {
  if (value instanceof SafeHtml) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(renderTemplateValue).join('');
  }
  if (value === null || value === undefined || typeof value === 'boolean') {
    return '';
  }
  return escapeHtml(value);
}

/**
 * Template tag that escapes every inserted value automatically.
 *   html`<p>${userText}</p>`
 * Values may be text, numbers, other html`` results, or arrays of them
 * (for lists). null, undefined, true and false render nothing, so
 * ${condition && html`...`} works. Plain objects are not rendered.
 */
export function html(strings, ...values) {
  let output = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    output += renderTemplateValue(values[index]) + strings[index + 1];
  }
  return new SafeHtml(SAFE_TOKEN, output);
}

/**
 * Replaces the content of an element with safe markup.
 * Rejects plain strings on purpose, so unsafe markup cannot slip in.
 */
export function renderHtml(element, markup) {
  if (!element || typeof element.innerHTML !== 'string') {
    throw new TypeError('NASUR sanitize: renderHtml needs a DOM element.');
  }
  if (!(markup instanceof SafeHtml)) {
    throw new TypeError('NASUR sanitize: renderHtml needs markup built with html`` or raw().');
  }
  element.innerHTML = markup.value;
}


/* ==========================================================================
   5. LINKS, PHONE NUMBERS, FILE NAMES AND IDS
   ========================================================================== */

function isRelativeUrl(text) {
  if (text.startsWith('//') || text.includes('\\')) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    return false;
  }
  return text.startsWith('#') || text.startsWith('/') || text.startsWith('./') || text.startsWith('../');
}

/**
 * Returns a safe URL string, or '' when the link is not allowed.
 * Allowed by default: https:, http:, mailto:, tel:. Everything else
 * (javascript:, data:, vbscript:, blob:, file: ...) is rejected.
 * Options: { protocols: ['https:'], allowRelative: true }
 */
export function safeUrl(value, options = {}) {
  const protocols = Array.isArray(options.protocols) ? options.protocols : DEFAULT_URL_PROTOCOLS;
  const text = cleanText(value);
  if (text === '') {
    return '';
  }
  if (options.allowRelative === true && isRelativeUrl(text)) {
    return text;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  return protocols.includes(parsed.protocol) ? parsed.href : '';
}

/**
 * Builds a tel: link from a typed phone number, or '' if it does not look
 * like one (3 to 15 digits; a leading + is kept). Accepts local digits.
 */
export function telHref(value) {
  const text = cleanText(toAsciiDigits(value));
  const digits = text.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 15) {
    return '';
  }
  return 'tel:' + (text.startsWith('+') ? '+' : '') + digits;
}

/**
 * Makes a safe file name for downloads and exports. Keeps letters from any
 * language, replaces path and reserved characters, and never returns ''.
 */
export function safeFilename(value, fallback = 'file') {
  let name = cleanText(value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');

  name = truncateText(name, 120);
  if (name === '') {
    return fallback;
  }
  if (WINDOWS_RESERVED_NAME.test(name)) {
    name = '_' + name;
  }
  return name;
}

/**
 * True for ids that are safe in URLs and attributes: 1 to 64 characters of
 * letters, digits, underscore or hyphen. Every NASUR id (UUID or fixed id)
 * passes this check.
 */
export function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** Shows only the end of a secret (such as an API key), e.g. ••••3f9a. */
export function maskSecret(value, visible = 4) {
  const text = cleanText(value);
  if (text === '') {
    return '';
  }
  if (text.length <= visible * 2) {
    return '••••';
  }
  return '••••' + text.slice(-visible);
}


/* ==========================================================================
   6. RECORD SANITIZING (before saving or restoring data)
   ========================================================================== */

/**
 * Returns a cleaned copy of any record, array or value, ready to store:
 *   - strings: control and invisible characters removed, line breaks kept,
 *     NO trimming and NO truncation
 *   - numbers that are not finite (NaN, Infinity) become null
 *   - plain objects: copied key by key; keys __proto__, constructor and
 *     prototype are dropped (prototype pollution protection); keys whose
 *     value is undefined, a function or a symbol are dropped
 *   - arrays: cleaned item by item (an unusable item becomes null)
 *   - Date, Blob, File, ArrayBuffer and similar values are passed through
 * Throws RangeError when data is nested deeper than 25 levels (or loops).
 */
export function sanitizeDeep(value) {
  return sanitizeValue(value, 0);
}

function sanitizeValue(value, depth) {
  if (depth > MAX_DEPTH) {
    throw new RangeError('NASUR sanitize: data is nested too deeply.');
  }
  if (typeof value === 'string') {
    return cleanText(value, { multiline: true, trim: false });
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const cleaned = sanitizeValue(item, depth + 1);
      return cleaned === undefined ? null : cleaned;
    });
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) {
        continue;
      }
      const cleaned = sanitizeValue(value[key], depth + 1);
      if (cleaned !== undefined) {
        output[key] = cleaned;
      }
    }
    return output;
  }
  return value;
}


/* ==========================================================================
   7. CSV / EXCEL EXPORT SAFETY
   ========================================================================== */

/**
 * Stops spreadsheet formula injection. A text value that starts with
 * = + - @ tab or carriage return gets a leading apostrophe, so Excel and
 * Power BI show it as text. Numbers and non-text values are returned as is.
 */
export function neutralizeFormula(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

/**
 * Converts one value to a safe CSV cell (RFC 4180 quoting).
 *   null/undefined -> empty; numbers keep their value; booleans -> true/false;
 *   dates -> ISO text; arrays -> items joined with "; "; objects -> JSON.
 * Text is formula-neutralized, then quoted when it contains a comma, quote
 * or line break.
 */
export function toCsvCell(value) {
  let text;
  if (value === null || value === undefined) {
    text = '';
  } else if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : '';
  } else if (typeof value === 'boolean') {
    text = value ? 'true' : 'false';
  } else if (value instanceof Date) {
    text = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else if (Array.isArray(value)) {
    text = value.map((item) => toStringSafe(item)).join('; ');
  } else {
    text = JSON.stringify(value) ?? '';
  }

  if (typeof value !== 'number') {
    text = neutralizeFormula(text);
  }
  if (/[",\n\r]/.test(text)) {
    text = '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}