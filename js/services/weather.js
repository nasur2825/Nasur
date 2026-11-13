/**
 * NASUR – Weather Service (Open-Meteo, no API key)
 * File: js/services/weather.js
 *
 * Gets the current weather for the user's chosen place and prepares it for
 * the Home screen (Blueprint M):
 *   - place search by name (Open-Meteo geocoding), manual latitude and
 *     longitude, or the device location (only when the user asks for it)
 *   - current conditions, temperature, humidity, wind, today's high and low
 *     and UV index (the day's highest value)
 *   - "feels like" and general heat guidance, calculated by js/services/heat.js
 *   - the last good result is saved on the device (LocalStorage), so the
 *     Home screen can show it instantly and when offline, with its age
 *
 * The heat guidance is advisory and is kept separate from every formal risk
 * record. It is only returned when the reading is less than 3 hours old.
 *
 * ERRORS
 *   Failures throw WeatherError with a `code` and a message safe to show:
 *     offline, timeout, network, service, bad_response, aborted,
 *     invalid_input, unsupported, denied, unavailable
 *   getWeather() never throws for network problems: it returns a result with
 *   status "stale" (older saved data) or "unavailable" and an `error` field.
 *
 * RESULT OF getWeather() / getCachedWeather()
 *   {
 *     status:      "ok" | "stale" | "unavailable" | "no_location"
 *     location:    the saved place, or null
 *     reading:     the weather reading (see below), or null
 *     condition:   { code, text, icon, group }, or null
 *     heat:        assessHeat() result, or null (no data or older than 3 hours)
 *     fetchedAt:   ISO time when the reading was downloaded, or null
 *     ageMinutes:  whole minutes since then, or null
 *     fresh:       true when younger than 30 minutes
 *     source:      "network" | "cache" | null
 *     error:       { code, message } or null
 *   }
 *   reading: { observedAt, localDate, localTime, timezone, tempC, apparentC,
 *              humidity, windKmh, gustKmh, precipitationMm, weatherCode, isDay,
 *              tempMaxC, tempMinC, uvIndexMax }  (numbers are null when the
 *              service did not provide them; tempC is always a number)
 *
 * PRIVACY
 *   The place coordinates (and, as for any web request, the device's network
 *   address) are sent to open-meteo.com. Device location is rounded to two
 *   decimals (about 1 km) before it is used. Nothing else is sent.
 *
 * The weather place is stored in the "settings" store under the key
 * "weather_location", so it is included in backups.
 */

import { LS_KEYS } from '../core/config.js';
import { getSetting, setSetting } from './repo.js';
import { isValidTimeZone, parseDateKey } from './calendar.js';
import { assessHeat } from './heat.js';
import { cleanText, toAsciiDigits } from './sanitize.js';


/* ==========================================================================
   1. CONSTANTS AND ERROR TYPE
   ========================================================================== */

export const WEATHER_LOCATION_KEY = 'weather_location';

/** A saved reading younger than this is used without asking the network. */
export const FRESH_MS = 30 * 60 * 1000;

/** Heat guidance is only given for readings younger than this. */
export const HEAT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export const REQUEST_TIMEOUT_MS = 10000;

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_VERSION = 1;
const MAX_NAME = 80;
const MAX_PART = 60;
const LOCATION_SOURCES = Object.freeze(['search', 'manual', 'device']);
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const MESSAGES = Object.freeze({
  offline: 'You are offline, so the weather could not be updated.',
  timeout: 'The weather service took too long to answer.',
  network: 'The weather service could not be reached. Check your connection and try again.',
  service: 'The weather service could not give a result.',
  badResponse: 'The weather service sent data that NASUR could not read.',
  aborted: 'The request was cancelled.'
});

/** Thrown for weather and location problems. `code` is listed at the top of this file. */
export class WeatherError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WeatherError';
    this.code = code;
    if (details && details.status !== undefined) {
      this.status = details.status;
    }
    if (details && details.fields !== undefined) {
      this.fields = details.fields;
    }
  }
}


/* ==========================================================================
   2. SMALL HELPERS
   ========================================================================== */

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A finite number inside [min, max], otherwise null. */
function num(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function optionalText(value, field, errors) {
  const text = cleanText(value);
  if (text === '') {
    return null;
  }
  if (text.length > MAX_PART) {
    errors[field] = 'This is too long (at most ' + MAX_PART + ' characters).';
    return null;
  }
  return text;
}

function toWeatherError(error) {
  return error instanceof WeatherError ? error : new WeatherError('network', MESSAGES.network);
}


/* ==========================================================================
   3. WEATHER CODES (WMO) AND DISPLAY TEXT
   ========================================================================== */

/** code -> [text, day icon, night icon, group] */
const CODE_TABLE = Object.freeze({
  0: ['Clear sky', '☀️', '🌙', 'clear'],
  1: ['Mainly clear', '🌤️', '🌙', 'clear'],
  2: ['Partly cloudy', '⛅', '☁️', 'cloud'],
  3: ['Overcast', '☁️', '☁️', 'cloud'],
  45: ['Fog', '🌫️', '🌫️', 'fog'],
  48: ['Freezing fog', '🌫️', '🌫️', 'fog'],
  51: ['Light drizzle', '🌦️', '🌧️', 'drizzle'],
  53: ['Drizzle', '🌦️', '🌧️', 'drizzle'],
  55: ['Heavy drizzle', '🌧️', '🌧️', 'drizzle'],
  56: ['Light freezing drizzle', '🌧️', '🌧️', 'drizzle'],
  57: ['Freezing drizzle', '🌧️', '🌧️', 'drizzle'],
  61: ['Light rain', '🌧️', '🌧️', 'rain'],
  63: ['Rain', '🌧️', '🌧️', 'rain'],
  65: ['Heavy rain', '🌧️', '🌧️', 'rain'],
  66: ['Light freezing rain', '🌧️', '🌧️', 'rain'],
  67: ['Freezing rain', '🌧️', '🌧️', 'rain'],
  71: ['Light snow', '🌨️', '🌨️', 'snow'],
  73: ['Snow', '🌨️', '🌨️', 'snow'],
  75: ['Heavy snow', '❄️', '❄️', 'snow'],
  77: ['Snow grains', '🌨️', '🌨️', 'snow'],
  80: ['Light rain showers', '🌦️', '🌧️', 'rain'],
  81: ['Rain showers', '🌦️', '🌧️', 'rain'],
  82: ['Violent rain showers', '🌧️', '🌧️', 'rain'],
  85: ['Light snow showers', '🌨️', '🌨️', 'snow'],
  86: ['Heavy snow showers', '❄️', '❄️', 'snow'],
  95: ['Thunderstorm', '⛈️', '⛈️', 'storm'],
  96: ['Thunderstorm with slight hail', '⛈️', '⛈️', 'storm'],
  99: ['Thunderstorm with heavy hail', '⛈️', '⛈️', 'storm']
});

/**
 * Describes a weather code: { code, text, icon, group }. group is one of
 * clear, cloud, fog, drizzle, rain, snow, storm or unknown. Unknown or missing
 * codes give "Unknown conditions".
 */
export function describeWeatherCode(code, isDay = true) {
  const entry = Number.isInteger(code) && Object.prototype.hasOwnProperty.call(CODE_TABLE, code)
    ? CODE_TABLE[code]
    : null;
  if (entry === null) {
    return { code: Number.isInteger(code) ? code : null, text: 'Unknown conditions', icon: '🌡️', group: 'unknown' };
  }
  return { code, text: entry[0], icon: isDay === false ? entry[2] : entry[1], group: entry[3] };
}


/* ==========================================================================
   4. COORDINATES AND LOCATIONS
   ========================================================================== */

function parseCoordinate(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = cleanText(toAsciiDigits(value));
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text) ? Number(text) : null;
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && cleanText(value) === '');
}

/**
 * Checks a latitude and longitude (numbers, or text typed by a person, with
 * 0-9, Tamil, Hindi or Arabic digits). Returns
 * { ok, latitude, longitude, errors } where errors may hold "latitude" and
 * "longitude" messages. Values are rounded to 4 decimals (about 10 metres).
 */
export function validateCoordinates(latitude, longitude) {
  const errors = {};
  let lat = null;
  let lon = null;

  if (isBlank(latitude)) {
    errors.latitude = 'Enter the latitude.';
  } else {
    lat = parseCoordinate(latitude);
    if (lat === null || lat < -90 || lat > 90) {
      errors.latitude = 'Latitude must be a number from -90 to 90.';
      lat = null;
    }
  }
  if (isBlank(longitude)) {
    errors.longitude = 'Enter the longitude.';
  } else {
    lon = parseCoordinate(longitude);
    if (lon === null || lon < -180 || lon > 180) {
      errors.longitude = 'Longitude must be a number from -180 to 180.';
      lon = null;
    }
  }

  const ok = lat !== null && lon !== null;
  return {
    ok,
    latitude: lat === null ? null : roundTo(lat, 4),
    longitude: lon === null ? null : roundTo(lon, 4),
    errors
  };
}

/** "13.08, 80.27" – used as the name of a place that has none. */
export function coordinatesLabel(latitude, longitude) {
  return roundTo(latitude, 2).toFixed(2) + ', ' + roundTo(longitude, 2).toFixed(2);
}

/**
 * Checks a place (for example one chosen from searchPlaces() or typed in).
 * Input: { name, region, country, latitude, longitude, timezone, source }.
 * Only latitude and longitude are required; a missing name becomes the
 * coordinates. Returns { ok, value, errors }; value is the cleaned place:
 * { name, region, country, latitude, longitude, timezone, source }.
 * Text is cleaned, never silently shortened: too-long text is an error.
 */
export function validateLocationInput(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, value: null, errors: { location: 'The place must be an object.' } };
  }

  const coords = validateCoordinates(raw.latitude, raw.longitude);
  const errors = { ...coords.errors };

  const name = cleanText(raw.name);
  if (name.length > MAX_NAME) {
    errors.name = 'The place name is too long (at most ' + MAX_NAME + ' characters).';
  }
  const region = optionalText(raw.region, 'region', errors);
  const country = optionalText(raw.country, 'country', errors);

  if (Object.keys(errors).length > 0) {
    return { ok: false, value: null, errors };
  }

  return {
    ok: true,
    value: {
      name: name === '' ? coordinatesLabel(coords.latitude, coords.longitude) : name,
      region,
      country,
      latitude: coords.latitude,
      longitude: coords.longitude,
      timezone: typeof raw.timezone === 'string' && isValidTimeZone(raw.timezone) ? raw.timezone : null,
      source: LOCATION_SOURCES.includes(raw.source) ? raw.source : 'manual'
    },
    errors: {}
  };
}

/** The cleaned place, or null when `raw` is not a usable place. */
export function normalizeLocation(raw) {
  const result = validateLocationInput(raw);
  return result.ok ? result.value : null;
}

/** "Chennai, Tamil Nadu, India" (repeated parts are shown once). */
export function locationLabel(location) {
  if (!isPlainObject(location)) {
    return '';
  }
  const parts = [];
  for (const part of [location.name, location.region, location.country]) {
    const text = typeof part === 'string' ? part.trim() : '';
    if (text !== '' && !parts.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
      parts.push(text);
    }
  }
  return parts.join(', ');
}

function sameSpot(a, b) {
  return Math.abs(a.latitude - b.latitude) < 0.00005 && Math.abs(a.longitude - b.longitude) < 0.00005;
}

/** The saved weather place, or null when none is set. */
export async function getLocation() {
  return normalizeLocation(await getSetting(WEATHER_LOCATION_KEY, null));
}

/**
 * Saves the weather place and returns it. Rejects with WeatherError
 * "invalid_input" (see `error.fields`) and saves nothing when it is not valid.
 */
export async function setLocation(input) {
  const result = validateLocationInput(input);
  if (!result.ok) {
    const message = Object.values(result.errors)[0] || 'The place is not valid.';
    throw new WeatherError('invalid_input', message, { fields: result.errors });
  }
  await setSetting(WEATHER_LOCATION_KEY, result.value);
  return { ...result.value };
}

/** Forgets the saved weather place. */
export async function clearLocation() {
  await setSetting(WEATHER_LOCATION_KEY, null);
}


/* ==========================================================================
   5. NETWORK REQUESTS
   ========================================================================== */

function classifyFetchError(error, timedOut) {
  if (error instanceof WeatherError) {
    return error;
  }
  if (error && error.name === 'AbortError') {
    return timedOut
      ? new WeatherError('timeout', MESSAGES.timeout)
      : new WeatherError('aborted', MESSAGES.aborted);
  }
  return new WeatherError('network', MESSAGES.network);
}

/**
 * Downloads and reads JSON, with a time limit. options: { signal, timeoutMs }.
 * Throws WeatherError. The weather service reports problems as JSON with
 * "error": true; those become "service" errors.
 */
async function requestJson(url, options) {
  const settings = options && typeof options === 'object' ? options : {};
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new WeatherError('offline', MESSAGES.offline);
  }
  const outer = settings.signal || null;
  if (outer && outer.aborted) {
    throw new WeatherError('aborted', MESSAGES.aborted);
  }
  const timeoutMs = Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0
    ? settings.timeoutMs
    : REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const relay = () => controller.abort();
  if (outer) {
    outer.addEventListener('abort', relay, { once: true });
  }

  try {
    let response;
    let body = null;
    let parseFailed = false;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
      try {
        body = await response.json();
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw error;
        }
        parseFailed = true;
      }
    } catch (error) {
      throw classifyFetchError(error, timedOut);
    }

    const reported = isPlainObject(body) && body.error === true;
    if (!response.ok || reported) {
      const reason = isPlainObject(body) && typeof body.reason === 'string' ? cleanText(body.reason).slice(0, 120) : '';
      throw new WeatherError('service', MESSAGES.service + (reason === '' ? '' : ' (' + reason + ')'), { status: response.status });
    }
    if (parseFailed || !isPlainObject(body)) {
      throw new WeatherError('badResponse'.replace('R', '_r').toLowerCase(), MESSAGES.badResponse);
    }
    return body;
  } finally {
    clearTimeout(timer);
    if (outer) {
      outer.removeEventListener('abort', relay);
    }
  }
}


/* ==========================================================================
   6. READING THE WEATHER SERVICE ANSWER
   ========================================================================== */

/**
 * Cleans a flat reading (from the service or from the saved copy). Returns
 * the cleaned reading, or null when there is no believable temperature.
 */
function coerceReading(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const tempC = num(raw.tempC, -90, 70);
  if (tempC === null) {
    return null;
  }

  let observedAt = null;
  if (typeof raw.observedAt === 'string' && TIME_PATTERN.test(raw.observedAt)
    && parseDateKey(raw.observedAt.slice(0, 10)) !== null) {
    observedAt = raw.observedAt.slice(0, 16);
  }

  return {
    observedAt,
    localDate: observedAt === null ? null : observedAt.slice(0, 10),
    localTime: observedAt === null ? null : observedAt.slice(11, 16),
    timezone: typeof raw.timezone === 'string' && raw.timezone !== '' ? raw.timezone : null,
    tempC,
    apparentC: num(raw.apparentC, -90, 70),
    humidity: num(raw.humidity, 0, 100),
    windKmh: num(raw.windKmh, 0, 500),
    gustKmh: num(raw.gustKmh, 0, 500),
    precipitationMm: num(raw.precipitationMm, 0, 2000),
    weatherCode: Number.isInteger(raw.weatherCode) ? raw.weatherCode : null,
    isDay: raw.isDay === true || raw.isDay === false ? raw.isDay : null,
    tempMaxC: num(raw.tempMaxC, -90, 70),
    tempMinC: num(raw.tempMinC, -90, 70),
    uvIndexMax: num(raw.uvIndexMax, 0, 20)
  };
}

function firstOf(list) {
  return Array.isArray(list) ? list[0] : null;
}

/** Converts the Open-Meteo forecast answer into a reading. Throws "bad_response". */
function normalizeReading(data) {
  const current = isPlainObject(data) && isPlainObject(data.current) ? data.current : null;
  if (current === null) {
    throw new WeatherError('bad_response', MESSAGES.badResponse);
  }
  const daily = isPlainObject(data.daily) ? data.daily : {};

  const reading = coerceReading({
    observedAt: current.time,
    timezone: data.timezone,
    tempC: current.temperature_2m,
    apparentC: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windKmh: current.wind_speed_10m,
    gustKmh: current.wind_gusts_10m,
    precipitationMm: current.precipitation,
    weatherCode: current.weather_code,
    isDay: current.is_day === 1 ? true : (current.is_day === 0 ? false : null),
    tempMaxC: firstOf(daily.temperature_2m_max),
    tempMinC: firstOf(daily.temperature_2m_min),
    uvIndexMax: firstOf(daily.uv_index_max)
  });
  if (reading === null) {
    throw new WeatherError('bad_response', 'The weather service did not return a temperature.');
  }
  return reading;
}

/**
 * Downloads the current weather for a place (always from the network, nothing
 * is saved). `location` needs latitude and longitude. options: { signal,
 * timeoutMs }. Throws WeatherError.
 */
export async function fetchCurrentWeather(location, options = {}) {
  const coords = isPlainObject(location) ? validateCoordinates(location.latitude, location.longitude) : null;
  if (coords === null || !coords.ok) {
    throw new WeatherError('invalid_input', 'A valid place (latitude and longitude) is needed to get the weather.');
  }

  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(coords.latitude));
  url.searchParams.set('longitude', String(coords.longitude));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_gusts_10m');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,uv_index_max');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');

  return normalizeReading(await requestJson(url.href, options));
}


/* ==========================================================================
   7. PLACE SEARCH AND DEVICE LOCATION
   ========================================================================== */

function normalizePlace(item) {
  if (!isPlainObject(item)) {
    return null;
  }
  const coords = validateCoordinates(item.latitude, item.longitude);
  const name = cleanText(item.name);
  if (!coords.ok || name === '' || name.length > MAX_NAME) {
    return null;
  }
  const region = cleanText(item.admin1);
  const country = cleanText(item.country);
  const place = {
    name,
    region: region === '' || region.length > MAX_PART ? null : region,
    country: country === '' || country.length > MAX_PART ? null : country,
    countryCode: typeof item.country_code === 'string' && /^[A-Za-z]{2}$/.test(item.country_code)
      ? item.country_code.toUpperCase()
      : null,
    latitude: coords.latitude,
    longitude: coords.longitude,
    timezone: typeof item.timezone === 'string' && isValidTimeZone(item.timezone) ? item.timezone : null
  };
  place.label = locationLabel(place);
  return place;
}

/**
 * Searches places by name. options: { language: "en", count: 5, signal,
 * timeoutMs }. Resolves to a list (possibly empty) of
 * { name, region, country, countryCode, latitude, longitude, timezone, label }.
 * Use setLocation({ ...place, source: "search" }) to save a chosen place.
 */
export async function searchPlaces(query, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const text = cleanText(query);
  if (text.length < 2) {
    throw new WeatherError('invalid_input', 'Type at least 2 letters of the place name.');
  }
  if (text.length > MAX_NAME) {
    throw new WeatherError('invalid_input', 'The place name is too long (at most ' + MAX_NAME + ' characters).');
  }
  const count = Number.isInteger(settings.count) && settings.count >= 1 && settings.count <= 10 ? settings.count : 5;
  const language = typeof settings.language === 'string' && /^[a-z]{2}$/.test(settings.language) ? settings.language : 'en';

  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', text);
  url.searchParams.set('count', String(count));
  url.searchParams.set('language', language);
  url.searchParams.set('format', 'json');

  const body = await requestJson(url.href, settings);
  const results = Array.isArray(body.results) ? body.results : [];
  return results.map(normalizePlace).filter((place) => place !== null);
}

/**
 * Asks the device for its position (the browser shows a permission prompt, so
 * only call this when the user taps a button for it). Coordinates are rounded
 * to two decimals (about 1 km). Resolves { latitude, longitude, accuracyM }.
 * Rejects with WeatherError: unsupported, denied, unavailable or timeout.
 * options: { timeoutMs }
 */
export function getDeviceLocation(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const timeoutMs = Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0 ? settings.timeoutMs : 10000;

  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new WeatherError('unsupported', 'This browser cannot give the device location. Search for a place or type coordinates instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = position.coords;
        resolve({
          latitude: roundTo(coords.latitude, 2),
          longitude: roundTo(coords.longitude, 2),
          accuracyM: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null
        });
      },
      (error) => {
        if (error && error.code === 1) {
          reject(new WeatherError('denied', 'Location permission was not given. Search for a place or type coordinates instead.'));
        } else if (error && error.code === 3) {
          reject(new WeatherError('timeout', 'The device took too long to find its location.'));
        } else {
          reject(new WeatherError('unavailable', 'The device location is not available right now.'));
        }
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}


/* ==========================================================================
   8. SAVED COPY (LocalStorage)
   ========================================================================== */

/** Returns the saved copy { fetchedAt, latitude, longitude, reading } or null. */
function readCache() {
  let text = null;
  try {
    text = localStorage.getItem(LS_KEYS.WEATHER_CACHE);
  } catch {
    return null;
  }
  if (typeof text !== 'string' || text === '') {
    return null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(data) || data.v !== CACHE_VERSION
    || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))) {
    return null;
  }
  const latitude = num(data.latitude, -90, 90);
  const longitude = num(data.longitude, -180, 180);
  const reading = coerceReading(data.reading);
  if (latitude === null || longitude === null || reading === null) {
    return null;
  }
  return { fetchedAt: data.fetchedAt, latitude, longitude, reading };
}

function writeCache(entry) {
  try {
    localStorage.setItem(LS_KEYS.WEATHER_CACHE, JSON.stringify({ v: CACHE_VERSION, ...entry }));
  } catch {
    /* storage is blocked or full; the weather still works, just not offline */
  }
}

/** Deletes the saved copy. */
export function clearWeatherCache() {
  try {
    localStorage.removeItem(LS_KEYS.WEATHER_CACHE);
  } catch {
    /* storage is blocked */
  }
}

/** The saved copy for this place, or null (a copy for another place is ignored). */
function cacheFor(location) {
  const entry = readCache();
  return entry !== null && sameSpot(entry, location) ? entry : null;
}


/* ==========================================================================
   9. RESULTS
   ========================================================================== */

function buildResult(parts) {
  const now = parts.now;
  const entry = parts.entry || null;

  let reading = null;
  let fetchedAt = null;
  let ageMs = null;
  if (entry !== null) {
    reading = entry.reading;
    fetchedAt = entry.fetchedAt;
    ageMs = now.getTime() - Date.parse(entry.fetchedAt);
  }

  const heatAllowed = reading !== null && ageMs >= 0 && ageMs <= HEAT_MAX_AGE_MS;
  return {
    status: parts.status,
    location: parts.location,
    reading,
    condition: reading === null ? null : describeWeatherCode(reading.weatherCode, reading.isDay !== false),
    heat: heatAllowed
      ? assessHeat({
        tempC: reading.tempC,
        humidity: reading.humidity,
        apparentC: reading.apparentC,
        uvIndex: reading.uvIndexMax
      })
      : null,
    fetchedAt,
    ageMinutes: ageMs === null ? null : Math.max(0, Math.round(ageMs / 60000)),
    fresh: ageMs !== null && ageMs >= 0 && ageMs < FRESH_MS,
    source: parts.source || null,
    error: parts.error ? { code: parts.error.code, message: parts.error.message } : null
  };
}

/**
 * Builds a result from the saved copy only (no network, instant). Use it to
 * paint the Home card at once, then call getWeather() to refresh.
 * status: "no_location" without a place, "ok" or "stale" with a saved copy
 * for this place, "unavailable" when there is none yet.
 */
export function getCachedWeather(location, now = new Date()) {
  const place = location === null || location === undefined ? null : normalizeLocation(location);
  const time = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  if (place === null) {
    return buildResult({ status: 'no_location', location: null, entry: null, now: time });
  }
  const entry = cacheFor(place);
  if (entry === null) {
    return buildResult({ status: 'unavailable', location: place, entry: null, now: time });
  }
  const result = buildResult({ status: 'ok', location: place, entry, now: time, source: 'cache' });
  if (!result.fresh) {
    result.status = 'stale';
  }
  return result;
}

/**
 * The main function: the weather for the saved place.
 * options: { force: false, now, signal, timeoutMs }
 *   - a saved copy younger than 30 minutes is returned without the network
 *     (unless force is true)
 *   - otherwise the weather is downloaded and saved
 *   - if the download fails, the older saved copy for this place is returned
 *     with status "stale" and the reason in `error`
 * Only a cancelled request (options.signal) throws.
 */
export async function getWeather(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const now = settings.now instanceof Date && !Number.isNaN(settings.now.getTime()) ? settings.now : new Date();

  const location = await getLocation();
  if (location === null) {
    return buildResult({ status: 'no_location', location: null, entry: null, now });
  }

  const cached = cacheFor(location);
  if (cached !== null && settings.force !== true) {
    const age = now.getTime() - Date.parse(cached.fetchedAt);
    if (age >= 0 && age < FRESH_MS) {
      return buildResult({ status: 'ok', location, entry: cached, now, source: 'cache' });
    }
  }

  try {
    const reading = await fetchCurrentWeather(location, { signal: settings.signal, timeoutMs: settings.timeoutMs });
    const entry = {
      fetchedAt: now.toISOString(),
      latitude: location.latitude,
      longitude: location.longitude,
      reading
    };
    writeCache(entry);
    return buildResult({ status: 'ok', location, entry, now, source: 'network' });
  } catch (error) {
    const problem = toWeatherError(error);
    if (problem.code === 'aborted') {
      throw problem;
    }
    if (cached !== null) {
      return buildResult({ status: 'stale', location, entry: cached, now, source: 'cache', error: problem });
    }
    return buildResult({ status: 'unavailable', location, entry: null, now, error: problem });
  }
}