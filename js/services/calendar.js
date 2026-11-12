/**
 * NASUR – Calendar Engine
 * File: js/services/calendar.js
 *
 * Time-zone-aware date handling for daily, weekly, monthly and annual
 * filtering and reports (Blueprint L). Month lengths are always calculated,
 * never assumed: February has 28 or 29 days, other months 30 or 31.
 *
 * DATE KEYS
 *   A calendar day is a text "date key" in the form YYYY-MM-DD (for example
 *   "2028-02-29"). It is the LOCAL date, with no time zone attached. All
 *   `date` and `*_date` fields in NASUR records use date keys. Date keys sort
 *   correctly as plain text, so "2026-02-01" < "2026-02-15".
 *   Timestamps (`*_at` fields) are ISO 8601 UTC text. This file converts
 *   between the two.
 *
 * RULES
 *   - Functions never read the clock or the user's settings on their own
 *     unless a parameter says so. Pass the time zone explicitly: use
 *     getEffectiveTimezone() from js/services/config.js, or "auto".
 *   - `timeZone` accepts an IANA name such as "Asia/Kolkata", "auto" (the
 *     device's own zone), or nothing (also the device zone). An invalid name
 *     falls back to the device zone.
 *   - Bad dates or arguments throw CalendarError (code "invalid_date").
 *     Reading functions that return null for unusable text say so below.
 *   - Supported years: 1 to 9999. Gregorian calendar only (no Hijri or
 *     Tamil calendar). Month and day names follow the language you pass.
 *   - Dates are calculated on whole days, so daylight saving changes can
 *     never shift a date key or make a day 23 or 25 hours long in counts.
 *
 * Imports: only js/services/sanitize.js (to read Tamil, Hindi and Arabic
 * digits typed into date fields).
 */

import { toAsciiDigits } from './sanitize.js';


/* ==========================================================================
   1. CONSTANTS, ERROR TYPE AND SMALL HELPERS
   ========================================================================== */

const MIN_YEAR = 1;
const MAX_YEAR = 9999;
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;
const MAX_LIST_DAYS = 3660;
const MAX_CACHED_FORMATTERS = 24;

/** Week start choices and the weekday number (0 = Sunday) of the first day. */
export const WEEK_START_INDEX = Object.freeze({ sunday: 0, monday: 1, saturday: 6 });

const NUMERIC_FORMATS = Object.freeze(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
const PERIODS = Object.freeze(['day', 'week', 'month', 'year']);

/** Thrown for invalid dates and arguments. */
export class CalendarError extends RangeError {
  constructor(message) {
    super(message);
    this.name = 'CalendarError';
    this.code = 'invalid_date';
  }
}

function fail(message) {
  throw new CalendarError(message);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad4(value) {
  return String(value).padStart(4, '0');
}

function shortText(value) {
  const text = typeof value === 'string' ? value : String(value);
  return text.length > 30 ? text.slice(0, 30) + '…' : text;
}

function assertYear(year) {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    fail('The year must be a whole number from ' + MIN_YEAR + ' to ' + MAX_YEAR + '.');
  }
}

function assertMonth(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    fail('The month must be a whole number from 1 to 12.');
  }
}

function assertSteps(steps) {
  if (!Number.isInteger(steps)) {
    fail('The number of days, months or years must be a whole number.');
  }
}

/** Milliseconds at 00:00 UTC on the given calendar day (works for years 1 to 99). */
function utcMidnightMs(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function dayNumber(parts) {
  return Math.round(utcMidnightMs(parts.year, parts.month, parts.day) / MS_PER_DAY);
}

function keyFromDayNumber(number) {
  const date = new Date(number * MS_PER_DAY);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < MIN_YEAR || year > MAX_YEAR) {
    fail('That date is outside the supported years (' + MIN_YEAR + ' to ' + MAX_YEAR + ').');
  }
  return pad4(year) + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function weekStartIndex(weekStart) {
  if (weekStart === undefined || weekStart === null) {
    return WEEK_START_INDEX.monday;
  }
  if (!Object.prototype.hasOwnProperty.call(WEEK_START_INDEX, weekStart)) {
    fail('The week must start on "monday", "sunday" or "saturday".');
  }
  return WEEK_START_INDEX[weekStart];
}


/* ==========================================================================
   2. YEARS AND MONTHS
   ========================================================================== */

/** True for leap years (divisible by 4, except centuries not divisible by 400). */
export function isLeapYear(year) {
  assertYear(year);
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a month (month is 1 to 12). */
export function daysInMonth(year, month) {
  assertYear(year);
  assertMonth(month);
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0); // day 0 of the next month is the last day of this month
  return date.getUTCDate();
}

/** 365, or 366 in a leap year. */
export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}


/* ==========================================================================
   3. DATE KEYS (YYYY-MM-DD)
   ========================================================================== */

/**
 * Splits a date key into { year, month, day }. Returns null when the text is
 * not a real calendar date ("2026-02-30" and "2026-13-01" give null).
 */
export function parseDateKey(key) {
  if (typeof key !== 'string') {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

/** True when `key` is a real date key. */
export function isValidDateKey(key) {
  return parseDateKey(key) !== null;
}

function requireKey(key) {
  const parts = parseDateKey(key);
  if (!parts) {
    fail('Not a valid date: "' + shortText(key) + '". Use the form YYYY-MM-DD.');
  }
  return parts;
}

/** Builds a date key from numbers (month 1 to 12). Throws for impossible dates. */
export function makeDateKey(year, month, day) {
  assertYear(year);
  assertMonth(month);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    fail('Day ' + shortText(day) + ' does not exist in that month.');
  }
  return pad4(year) + '-' + pad2(month) + '-' + pad2(day);
}

/** Adds days (negative to go back). */
export function addDays(key, days) {
  const parts = requireKey(key);
  assertSteps(days);
  return keyFromDayNumber(dayNumber(parts) + days);
}

/**
 * Adds months. When the day does not exist in the target month it moves to
 * that month's last day (31 January + 1 month = 28 February, or 29 in a leap year).
 */
export function addMonths(key, months) {
  const parts = requireKey(key);
  assertSteps(months);
  const total = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  assertYear(year);
  return makeDateKey(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

/** Adds years (29 February + 1 year = 28 February). */
export function addYears(key, years) {
  assertSteps(years);
  return addMonths(key, years * 12);
}

/** Whole days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function diffDays(fromKey, toKey) {
  return dayNumber(requireKey(toKey)) - dayNumber(requireKey(fromKey));
}

/** Weekday of a date key: 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(key) {
  const parts = requireKey(key);
  return new Date(utcMidnightMs(parts.year, parts.month, parts.day)).getUTCDay();
}

/** Days from `todayKey` until `targetKey` (negative when the target has passed). */
export function daysUntil(targetKey, todayKey) {
  return diffDays(todayKey, targetKey);
}

/** True when the target date is before today. A missing target is not overdue. */
export function isOverdue(targetKey, todayKey) {
  if (targetKey === null || targetKey === undefined || targetKey === '') {
    return false;
  }
  return daysUntil(targetKey, todayKey) < 0;
}


/* ==========================================================================
   4. RANGES: DAY, WEEK, MONTH, YEAR
   Every range is { start, end, days } with start and end as date keys,
   both days included.
   ========================================================================== */

/** The single day `key`. */
export function dayRange(key) {
  requireKey(key);
  return { start: key, end: key, days: 1 };
}

/** The week containing `key`. weekStart: "monday" (default), "sunday" or "saturday". */
export function weekRange(key, weekStart = 'monday') {
  const first = weekStartIndex(weekStart);
  const offset = (dayOfWeek(key) - first + 7) % 7;
  const start = addDays(key, -offset);
  return { start, end: addDays(start, 6), days: 7 };
}

/** The whole month (month is 1 to 12). */
export function monthRange(year, month) {
  const days = daysInMonth(year, month);
  return { start: makeDateKey(year, month, 1), end: makeDateKey(year, month, days), days };
}

/** The whole year. */
export function yearRange(year) {
  const days = daysInYear(year);
  return { start: makeDateKey(year, 1, 1), end: makeDateKey(year, 12, 31), days };
}

/** The range of one period around `key`. period: "day", "week", "month" or "year". */
export function rangeFor(period, key, weekStart = 'monday') {
  const parts = requireKey(key);
  switch (period) {
    case 'day':
      return dayRange(key);
    case 'week':
      return weekRange(key, weekStart);
    case 'month':
      return monthRange(parts.year, parts.month);
    case 'year':
      return yearRange(parts.year);
    default:
      return fail('The period must be one of: ' + PERIODS.join(', ') + '.');
  }
}

/**
 * Moves a date key by whole periods, for "previous" and "next" buttons.
 * shiftKey('month', '2026-03-31', -1) is '2026-02-28'.
 */
export function shiftKey(period, key, steps) {
  assertSteps(steps);
  switch (period) {
    case 'day':
      return addDays(key, steps);
    case 'week':
      return addDays(key, steps * 7);
    case 'month':
      return addMonths(key, steps);
    case 'year':
      return addYears(key, steps);
    default:
      return fail('The period must be one of: ' + PERIODS.join(', ') + '.');
  }
}

/** Every date key from `start` to `end`, both included (at most 3660 days). */
export function listDates(start, end) {
  const count = diffDays(start, end) + 1;
  if (count < 1) {
    fail('The end date is before the start date.');
  }
  if (count > MAX_LIST_DAYS) {
    fail('That range is longer than ' + MAX_LIST_DAYS + ' days.');
  }
  const dates = [];
  for (let step = 0; step < count; step += 1) {
    dates.push(addDays(start, step));
  }
  return dates;
}

/** True when `key` falls inside `range` (a { start, end } object). */
export function isInRange(key, range) {
  requireKey(key);
  requireKey(range.start);
  requireKey(range.end);
  return key >= range.start && key <= range.end;
}


/* ==========================================================================
   5. TIME ZONES AND "TODAY"
   ========================================================================== */

const formatterCache = new Map();

/** The device's own IANA time zone ("UTC" when it cannot be found). */
export function getDeviceTimeZone() {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** True for a real IANA zone name such as "Asia/Kolkata" (not "auto", not "+05:30"). */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.trim() === '' || /^[+-]/.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Turns "auto", nothing or an invalid name into the device zone; keeps valid names. */
export function resolveTimeZone(timeZone) {
  if (typeof timeZone === 'string' && timeZone !== 'auto' && isValidTimeZone(timeZone)) {
    return timeZone;
  }
  return getDeviceTimeZone();
}

function partsFormatter(zone) {
  let formatter = formatterCache.get(zone);
  if (!formatter) {
    if (formatterCache.size >= MAX_CACHED_FORMATTERS) {
      formatterCache.clear();
    }
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatterCache.set(zone, formatter);
  }
  return formatter;
}

function assertDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    fail('A valid date and time is required.');
  }
}

/**
 * The wall-clock reading of an instant in a time zone:
 * { year, month, day, hour, minute, second }.
 */
export function getZonedParts(date, timeZone) {
  assertDate(date);
  const found = {};
  for (const part of partsFormatter(resolveTimeZone(timeZone)).formatToParts(date)) {
    if (part.type !== 'literal') {
      found[part.type] = Number(part.value);
    }
  }
  return {
    year: found.year,
    month: found.month,
    day: found.day,
    hour: found.hour === 24 ? 0 : found.hour,
    minute: found.minute,
    second: found.second
  };
}

/** The local date key of an instant in a time zone. */
export function dateKeyOf(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  return makeDateKey(parts.year, parts.month, parts.day);
}

/** Today's date key in a time zone. `now` is only for testing. */
export function todayKey(timeZone, now = new Date()) {
  return dateKeyOf(now, timeZone);
}

/** Minutes the zone is ahead of UTC at that instant (India is +330, New York is -300 or -240). */
export function timeZoneOffsetMinutes(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const shown = utcMidnightMs(parts.year, parts.month, parts.day)
    + parts.hour * MS_PER_HOUR + parts.minute * MS_PER_MINUTE + parts.second * 1000;
  const instant = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((shown - instant) / MS_PER_MINUTE);
}

/**
 * Converts a local date and time ("HH:MM", default "00:00") in a time zone to
 * the matching instant (a Date). A time that does not exist because clocks
 * jump forward resolves to a nearby valid instant.
 */
export function zonedTimeToUtc(key, time = '00:00', timeZone) {
  const parts = requireKey(key);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    fail('The time must be in the form HH:MM (00:00 to 23:59).');
  }
  const zone = resolveTimeZone(timeZone);
  const wall = utcMidnightMs(parts.year, parts.month, parts.day)
    + Number(match[1]) * MS_PER_HOUR + Number(match[2]) * MS_PER_MINUTE;

  const guess = timeZoneOffsetMinutes(new Date(wall), zone);
  let instant = wall - guess * MS_PER_MINUTE;
  const check = timeZoneOffsetMinutes(new Date(instant), zone);
  if (check !== guess) {
    instant = wall - check * MS_PER_MINUTE;
  }
  return new Date(instant);
}

/**
 * The UTC instants that bound one local day: { startIso, endIso }, where
 * endIso is the start of the NEXT local day (use "start <= value < end").
 * Use it to filter `*_at` timestamps by a local calendar day.
 */
export function localDayToUtcRange(key, timeZone) {
  return {
    startIso: zonedTimeToUtc(key, '00:00', timeZone).toISOString(),
    endIso: zonedTimeToUtc(addDays(key, 1), '00:00', timeZone).toISOString()
  };
}

/** Same as localDayToUtcRange for a whole { start, end } range of local days. */
export function localRangeToUtc(range, timeZone) {
  return {
    startIso: zonedTimeToUtc(range.start, '00:00', timeZone).toISOString(),
    endIso: zonedTimeToUtc(addDays(range.end, 1), '00:00', timeZone).toISOString()
  };
}


/* ==========================================================================
   6. FORMATTING AND READING DATES
   ========================================================================== */

function makeFormatter(locale, options) {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat('en', options);
  }
}

/** A date key as a UTC noon instant, so formatting in UTC never shifts the day. */
function noonUtc(key) {
  const parts = requireKey(key);
  return new Date(utcMidnightMs(parts.year, parts.month, parts.day) + 12 * MS_PER_HOUR);
}

/** Shows a date key as DD/MM/YYYY (default), MM/DD/YYYY or YYYY-MM-DD, always with 0-9 digits. */
export function formatDate(key, format = 'DD/MM/YYYY') {
  const parts = requireKey(key);
  if (!NUMERIC_FORMATS.includes(format)) {
    fail('The date format must be one of: ' + NUMERIC_FORMATS.join(', ') + '.');
  }
  const year = pad4(parts.year);
  const month = pad2(parts.month);
  const day = pad2(parts.day);
  if (format === 'MM/DD/YYYY') {
    return month + '/' + day + '/' + year;
  }
  if (format === 'YYYY-MM-DD') {
    return year + '-' + month + '-' + day;
  }
  return day + '/' + month + '/' + year;
}

/** "Thursday, 12 November 2026" in the given language (for example "en", "ta", "hi", "ar"). */
export function formatDateLong(key, locale = 'en') {
  return makeFormatter(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(noonUtc(key));
}

/** Weekday name of a date key. style: "long" (default), "short" or "narrow". */
export function formatWeekday(key, locale = 'en', style = 'long') {
  return makeFormatter(locale, { weekday: style, timeZone: 'UTC' }).format(noonUtc(key));
}

/** Month name (month is 1 to 12). style: "long" (default), "short" or "narrow". */
export function monthName(month, locale = 'en', style = 'long') {
  assertMonth(month);
  return makeFormatter(locale, { month: style, timeZone: 'UTC' }).format(noonUtc(makeDateKey(2000, month, 15)));
}

/** "November 2026" in the given language. */
export function formatMonthYear(year, month, locale = 'en') {
  assertMonth(month);
  return makeFormatter(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(noonUtc(makeDateKey(year, month, 15)));
}

/**
 * The time of an instant in a time zone, for example "14:05" or "2:05 PM".
 * options: { seconds: true } adds seconds; { hour12: true or false } forces
 * the 12 or 24 hour style (otherwise the language decides).
 */
export function formatTime(date, timeZone, locale = 'en', options = {}) {
  assertDate(date);
  const settings = options && typeof options === 'object' ? options : {};
  const formatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: resolveTimeZone(timeZone)
  };
  if (settings.seconds === true) {
    formatOptions.second = '2-digit';
  }
  if (typeof settings.hour12 === 'boolean') {
    formatOptions.hour12 = settings.hour12;
  }
  return makeFormatter(locale, formatOptions).format(date);
}

/** Date and time of an instant in a time zone, for example "12 Nov 2026, 14:05". */
export function formatDateTime(date, timeZone, locale = 'en') {
  assertDate(date);
  return makeFormatter(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: resolveTimeZone(timeZone)
  }).format(date);
}

/**
 * Reads a date typed by a person and returns a date key, or null when the
 * text is not a real date. Accepts 0-9, Tamil, Hindi and Arabic digits, and
 * "/", "-" or "." between the parts. An ISO date (2026-02-28) is always
 * accepted; otherwise the parts are read in the order of `format`.
 */
export function parseInputDate(text, format = 'DD/MM/YYYY') {
  if (typeof text !== 'string') {
    return null;
  }
  const value = toAsciiDigits(text).trim();

  let year;
  let month;
  let day;
  const iso = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(value);
  if (iso) {
    year = iso[1];
    month = iso[2];
    day = iso[3];
  } else {
    const local = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(value);
    if (!local || format === 'YYYY-MM-DD') {
      return null;
    }
    year = local[3];
    if (format === 'MM/DD/YYYY') {
      month = local[1];
      day = local[2];
    } else {
      day = local[1];
      month = local[2];
    }
  }

  const key = pad4(Number(year)) + '-' + pad2(Number(month)) + '-' + pad2(Number(day));
  return parseDateKey(key) === null ? null : key;
}


/* ==========================================================================
   7. PARTS OF THE DAY
   ========================================================================== */

/**
 * "morning" (05:00 to 11:59), "afternoon" (12:00 to 16:59), "evening"
 * (17:00 to 20:59) or "night" (21:00 to 04:59), for greetings.
 */
export function dayPart(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    fail('The hour must be a whole number from 0 to 23.');
  }
  if (hour >= 5 && hour < 12) {
    return 'morning';
  }
  if (hour >= 12 && hour < 17) {
    return 'afternoon';
  }
  if (hour >= 17 && hour < 21) {
    return 'evening';
  }
  return 'night';
}