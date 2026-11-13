/**
 * NASUR – Phase 2 tests: calendar, heat guidance, weather, workspace,
 * JARVIS context, voice, JARVIS drawer and the Home screen.
 * File: tests/phase2.test.js
 * Loaded by tests/runner.html, which passes in the harness (tests/harness.js).
 */
export default function definePhase2(H) {
  const { suite, skip, sleep, waitFor, assert, eq, deepEq, expectError, captureConsole, fetchJson, resetDb, withFetch, jsonResponse, INDUSTRY_IDS, M } = H;
  const { cfg, ev, router, repo, ucfg, cal, heat, weather, workspace, jctx, voice, drawer, home } = M;
  const S = cfg.STORES;
  const each = (cases, fn) => { for (const args of cases) { fn(...args); } };
  const fails = (fn, label) => expectError(fn, cal.CalendarError, label);
  const online = () => navigator.onLine !== false;

  /* ======================================================================
     CALENDAR
     ====================================================================== */
  suite('Calendar engine (js/services/calendar.js)', ({ test }) => {
    test('leap years and month lengths are calculated, never assumed', async () => {
      each([[2024, true], [2100, false], [2000, true], [2026, false], [1900, false]], (year, leap) => eq(cal.isLeapYear(year), leap, 'leap ' + year));
      each([[2028, 2, 29], [2027, 2, 28], [2026, 4, 30], [2026, 1, 31], [2026, 12, 31], [1900, 2, 28], [2000, 2, 29]], (year, month, days) => eq(cal.daysInMonth(year, month), days, year + '-' + month));
      for (const year of [2027, 2028]) {
        let total = 0;
        for (let month = 1; month <= 12; month += 1) { total += cal.daysInMonth(year, month); }
        eq(total, cal.daysInYear(year), 'sum of months ' + year);
      }
      eq(cal.daysInYear(2028), 366);
      await fails(() => cal.daysInMonth(2026, 13));
      await fails(() => cal.isLeapYear(0));
      await fails(() => cal.isLeapYear(10000));
    });
    test('date keys: parsing, building and validation', async () => {
      deepEq(cal.parseDateKey('2028-02-29'), { year: 2028, month: 2, day: 29 });
      for (const bad of ['2026-02-29', '2026-13-01', '2026-1-1', 'x', null, '0000-01-01', '2026-04-31', '2026-00-10']) { eq(cal.parseDateKey(bad), null, String(bad)); }
      eq(cal.isValidDateKey('2026-02-28'), true);
      eq(cal.makeDateKey(2026, 2, 28), '2026-02-28');
      await fails(() => cal.makeDateKey(2026, 2, 29));
      await fails(() => cal.addDays('2026-02-30', 1));
      await fails(() => cal.addDays('2026-02-28', 1.5));
      await fails(() => cal.dayRange('x'));
    });
    test('adding days, months and years; differences; weekdays; overdue', () => {
      each([['2026-02-28', 1, '2026-03-01'], ['2028-02-28', 1, '2028-02-29'], ['2026-01-01', -1, '2025-12-31'], ['2026-03-01', -1, '2026-02-28']], (key, days, result) => eq(cal.addDays(key, days), result, key + ' + ' + days));
      each([['2026-01-31', 1, '2026-02-28'], ['2028-01-31', 1, '2028-02-29'], ['2026-03-31', -1, '2026-02-28'], ['2026-12-15', 1, '2027-01-15'], ['2026-01-15', -1, '2025-12-15'], ['2026-01-31', 13, '2027-02-28']], (key, months, result) => eq(cal.addMonths(key, months), result, key + ' + ' + months + ' months'));
      eq(cal.addYears('2028-02-29', 1), '2029-02-28');
      eq(cal.addYears('2028-02-29', 4), '2032-02-29');
      eq(cal.diffDays('2026-02-01', '2026-03-01'), 28);
      eq(cal.diffDays('2028-02-01', '2028-03-01'), 29);
      eq(cal.diffDays('2026-03-01', '2026-02-01'), -28);
      eq(cal.dayOfWeek('2026-11-12'), 4, 'Thursday');
      eq(cal.dayOfWeek('2026-11-15'), 0, 'Sunday');
      eq(cal.dayOfWeek('2000-01-01'), 6, 'Saturday');
      eq(cal.daysUntil('2026-11-20', '2026-11-14'), 6);
      eq(cal.isOverdue('2026-11-13', '2026-11-14'), true);
      eq(cal.isOverdue('2026-11-14', '2026-11-14'), false);
      eq(cal.isOverdue(null, '2026-11-14'), false);
      eq(cal.isOverdue('', '2026-11-14'), false);
    });
    test('ranges: week, month, year, rangeFor, shiftKey, listDates, isInRange', async () => {
      deepEq(cal.weekRange('2026-02-28', 'monday'), { start: '2026-02-23', end: '2026-03-01', days: 7 });
      deepEq(cal.weekRange('2026-02-28', 'sunday'), { start: '2026-02-22', end: '2026-02-28', days: 7 });
      deepEq(cal.weekRange('2026-02-28', 'saturday'), { start: '2026-02-28', end: '2026-03-06', days: 7 });
      await fails(() => cal.weekRange('2026-02-28', 'friday'));
      deepEq(cal.monthRange(2028, 2), { start: '2028-02-01', end: '2028-02-29', days: 29 });
      deepEq(cal.yearRange(2027), { start: '2027-01-01', end: '2027-12-31', days: 365 });
      deepEq(cal.rangeFor('month', '2026-04-15'), { start: '2026-04-01', end: '2026-04-30', days: 30 });
      deepEq(cal.rangeFor('day', '2026-04-15'), { start: '2026-04-15', end: '2026-04-15', days: 1 });
      deepEq(cal.rangeFor('week', '2026-04-15', 'monday'), { start: '2026-04-13', end: '2026-04-19', days: 7 });
      await fails(() => cal.rangeFor('decade', '2026-04-15'));
      eq(cal.shiftKey('month', '2026-03-31', -1), '2026-02-28');
      eq(cal.shiftKey('week', '2026-03-01', -1), '2026-02-22');
      eq(cal.shiftKey('year', '2028-02-29', 1), '2029-02-28');
      eq(cal.shiftKey('day', '2026-02-28', 2), '2026-03-02');
      deepEq(cal.listDates('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
      await fails(() => cal.listDates('2026-03-02', '2026-02-27'));
      await fails(() => cal.listDates('2000-01-01', '2020-01-01'));
      eq(cal.isInRange('2026-02-15', { start: '2026-02-01', end: '2026-02-28' }), true);
      eq(cal.isInRange('2026-03-01', { start: '2026-02-01', end: '2026-02-28' }), false);
    });
    test('time zones: today, wall-clock parts, offsets and validation', () => {
      const instant = new Date('2026-11-12T19:00:00Z');
      eq(cal.todayKey('Asia/Kolkata', instant), '2026-11-13');
      eq(cal.todayKey('UTC', instant), '2026-11-12');
      eq(cal.todayKey('America/New_York', new Date('2026-11-12T03:00:00Z')), '2026-11-11');
      deepEq(cal.getZonedParts(instant, 'Asia/Kolkata'), { year: 2026, month: 11, day: 13, hour: 0, minute: 30, second: 0 });
      eq(cal.timeZoneOffsetMinutes(new Date('2026-11-12T00:00:00Z'), 'Asia/Kolkata'), 330);
      eq(cal.timeZoneOffsetMinutes(new Date('2026-11-12T00:00:00Z'), 'America/New_York'), -300);
      eq(cal.timeZoneOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'America/New_York'), -240);
      eq(cal.isValidTimeZone('Asia/Kolkata'), true);
      eq(cal.isValidTimeZone('auto'), false);
      eq(cal.isValidTimeZone('+05:30'), false);
      eq(cal.resolveTimeZone('auto'), cal.getDeviceTimeZone());
      eq(cal.resolveTimeZone('Mars/Phobos'), cal.getDeviceTimeZone());
      eq(cal.resolveTimeZone('Asia/Kolkata'), 'Asia/Kolkata');
      assert(cal.getDeviceTimeZone() !== '', 'The device time zone must not be empty.');
    });
    test('local days convert to exact UTC ranges, including 23 and 25 hour days', async () => {
      eq(cal.zonedTimeToUtc('2026-11-13', '00:30', 'Asia/Kolkata').toISOString(), '2026-11-12T19:00:00.000Z');
      deepEq(cal.localDayToUtcRange('2026-11-13', 'Asia/Kolkata'), { startIso: '2026-11-12T18:30:00.000Z', endIso: '2026-11-13T18:30:00.000Z' });
      const hours = (key) => { const range = cal.localDayToUtcRange(key, 'America/New_York'); return (Date.parse(range.endIso) - Date.parse(range.startIso)) / 3600000; };
      eq(hours('2026-03-08'), 23, 'clocks go forward');
      eq(hours('2026-11-01'), 25, 'clocks go back');
      eq(hours('2026-06-15'), 24);
      deepEq(cal.localRangeToUtc({ start: '2026-11-13', end: '2026-11-14' }, 'Asia/Kolkata'), { startIso: '2026-11-12T18:30:00.000Z', endIso: '2026-11-14T18:30:00.000Z' });
      await fails(() => cal.zonedTimeToUtc('2026-11-13', '25:00', 'UTC'));
      await fails(() => cal.zonedTimeToUtc('2026-11-13', '9:30', 'UTC'));
    });
    test('formatting and reading dates', async () => {
      eq(cal.formatDate('2026-02-05'), '05/02/2026');
      eq(cal.formatDate('2026-02-05', 'MM/DD/YYYY'), '02/05/2026');
      eq(cal.formatDate('2026-02-05', 'YYYY-MM-DD'), '2026-02-05');
      await fails(() => cal.formatDate('2026-02-05', 'D/M/Y'));
      const long = cal.formatDateLong('2026-11-12', 'en');
      assert(long.includes('Thursday') && long.includes('2026') && long.includes('12'), 'formatDateLong gave: ' + long);
      eq(cal.formatWeekday('2026-11-12', 'en'), 'Thursday');
      eq(cal.monthName(2, 'en'), 'February');
      const monthYear = cal.formatMonthYear(2028, 2, 'en');
      assert(monthYear.includes('February') && monthYear.includes('2028'), 'formatMonthYear gave: ' + monthYear);
      eq(typeof cal.formatDateLong('2026-11-12', 'ta'), 'string');
      const afternoon = new Date('2026-11-12T08:35:00Z');
      eq(cal.formatTime(afternoon, 'Asia/Kolkata', 'en', { hour12: false }), '14:05');
      const twelve = cal.formatTime(afternoon, 'Asia/Kolkata', 'en', { hour12: true });
      assert(twelve.includes('2:05') && twelve.includes('PM'), 'formatTime gave: ' + twelve);
      assert(cal.formatDateTime(afternoon, 'Asia/Kolkata', 'en').includes('2026'), 'formatDateTime must include the year');
      each([['28/02/2026', 'DD/MM/YYYY', '2026-02-28'], ['02/28/2026', 'MM/DD/YYYY', '2026-02-28'], ['2026-02-28', 'DD/MM/YYYY', '2026-02-28'], ['28.2.2026', 'DD/MM/YYYY', '2026-02-28'], ['\u0662\u0668/\u0660\u0662/\u0662\u0660\u0662\u0666', 'DD/MM/YYYY', '2026-02-28'], ['29/02/2026', 'DD/MM/YYYY', null], ['2/28/2026', 'DD/MM/YYYY', null], ['28/02/2026', 'YYYY-MM-DD', null], ['', 'DD/MM/YYYY', null], [5, 'DD/MM/YYYY', null]], (text, format, expected) => eq(cal.parseInputDate(text, format), expected, String(text)));
    });
    test('parts of the day', async () => {
      each([[0, 'night'], [4, 'night'], [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [16, 'afternoon'], [17, 'evening'], [20, 'evening'], [21, 'night']], (hour, part) => eq(cal.dayPart(hour), part, 'hour ' + hour));
      await fails(() => cal.dayPart(24));
      await fails(() => cal.dayPart(1.5));
    });
  });

  /* ======================================================================
     HEAT GUIDANCE
     ====================================================================== */
  suite('Heat guidance (js/services/heat.js)', ({ test }) => {
    test('temperature conversion and display', () => {
      eq(heat.celsiusToFahrenheit(100), 212);
      eq(heat.fahrenheitToCelsius(32), 0);
      eq(heat.formatTemperature(36), '36°C');
      eq(heat.formatTemperature(36, 'imperial'), '97°F');
      eq(heat.formatTemperature(36.4, 'metric', { decimals: 1 }), '36.4°C');
      eq(heat.formatTemperature(-0.2), '0°C');
      eq(heat.formatTemperature(null), '–');
      eq(heat.formatTemperature('x'), '–');
    });
    test('heat index follows the published formula and is never below the air temperature', () => {
      const hot = heat.heatIndexC(36, 60);
      assert(Math.abs(hot - 48.1) < 0.6, '36 °C at 60% should give about 48.1 °C, got ' + hot);
      const table = heat.heatIndexC(heat.fahrenheitToCelsius(90), 70);
      assert(Math.abs(table - 41.07) < 0.4, '90 °F at 70% should give about 105.9 °F (41.1 °C), got ' + table);
      eq(heat.heatIndexC(22, 50), 22);
      eq(heat.heatIndexC(10, 90), 10);
      eq(heat.heatIndexC(null, 50), null);
      eq(heat.heatIndexC(30, undefined), null);
      eq(heat.heatIndexC(30, 120), null);
      eq(heat.heatIndexC(100, 50), null);
    });
    test('feels-like takes the highest of temperature, provider and heat index', () => {
      deepEq(heat.feelsLike({ tempC: 30 }), { valueC: 30, source: 'temperature' });
      deepEq(heat.feelsLike({ tempC: 30, apparentC: 34 }), { valueC: 34, source: 'provider' });
      deepEq(heat.feelsLike({ tempC: 30, apparentC: 25 }), { valueC: 30, source: 'temperature' });
      const both = heat.feelsLike({ tempC: 36, humidity: 60, apparentC: 30 });
      eq(both.source, 'heat_index');
      assert(Math.abs(both.valueC - 48.1) < 0.6, 'feels-like value ' + both.valueC);
      eq(heat.feelsLike(null), null);
      eq(heat.feelsLike({ tempC: 'x' }), null);
    });
    test('levels switch at the published thresholds', () => {
      each([[20, 'low'], [26.6, 'low'], [26.7, 'caution'], [32.2, 'caution'], [32.3, 'high'], [39.4, 'high'], [39.5, 'danger'], [51.6, 'danger'], [51.7, 'extreme']], (value, level) => eq(heat.levelForFeelsLikeC(value).id, level, value + ' °C'));
      eq(heat.levelForFeelsLikeC(NaN), null);
      eq(heat.levelForFeelsLikeC('x'), null);
      eq(heat.getHeatLevel('high').riskBadge, 'high');
      eq(heat.getHeatLevel('caution').riskBadge, 'medium');
      eq(heat.getHeatLevel('danger').riskBadge, 'extreme');
      eq(heat.getHeatLevel('zzz'), null);
    });
    test('assessHeat: valid, unknown, copies, notes and frozen data', async () => {
      const result = heat.assessHeat({ tempC: 36, humidity: 60 });
      eq(result.valid, true);
      eq(result.level, 'danger');
      eq(result.riskBadge, 'extreme');
      eq(result.feelsLikeSource, 'heat_index');
      assert(Math.abs(result.feelsLikeC - 48.1) < 0.6, 'feelsLikeC ' + result.feelsLikeC);
      eq(result.tempC, 36);
      eq(result.humidity, 60);
      assert(result.actions.length > 0 && typeof result.disclaimer === 'string' && result.disclaimer.includes('Advisory only'), 'actions and disclaimer are required');
      eq(result.notes.length, 1);
      eq(heat.assessHeat({ tempC: 22, humidity: 50 }).level, 'low');
      eq(heat.assessHeat({ tempC: 30, uvIndex: 7 }).notes.length, 2);
      eq(heat.assessHeat({ tempC: 30, uvIndex: 3 }).notes.length, 1);
      for (const input of [{}, null, { tempC: 'x' }]) {
        const unknown = heat.assessHeat(input);
        eq(unknown.valid, false);
        eq(unknown.level, 'unknown');
        eq(unknown.riskBadge, null);
      }
      result.actions.push('changed');
      eq(heat.assessHeat({ tempC: 36, humidity: 60 }).actions.length, heat.getHeatLevel('danger').actions.length);
      await expectError(() => { heat.HEAT_LEVELS.push({}); }, TypeError);
    });
  });

  /* ======================================================================
     WEATHER
     ====================================================================== */
  const FORECAST = { timezone: 'Asia/Kolkata', current: { time: '2026-11-12T14:00', temperature_2m: 36, relative_humidity_2m: 60, apparent_temperature: 40, is_day: 1, precipitation: 0, weather_code: 2, wind_speed_10m: 12, wind_gusts_10m: 20 }, daily: { temperature_2m_max: [37], temperature_2m_min: [27], uv_index_max: [8] } };
  const CHENNAI = { latitude: 13.08, longitude: 80.27 };
  const cacheEntry = (fetchedAt, lat = 13.08, lon = 80.27, temp = 36) => JSON.stringify({ v: 1, fetchedAt, latitude: lat, longitude: lon, reading: { observedAt: '2026-11-12T14:00', timezone: 'Asia/Kolkata', tempC: temp, apparentC: 40, humidity: 60, windKmh: 12, weatherCode: 2, isDay: true, tempMaxC: 37, tempMinC: 27, uvIndexMax: 8 } });
  const NETWORK_DOWN = () => Promise.reject(new TypeError('Failed to fetch'));

  suite('Weather service: places, codes and saved copy (js/services/weather.js)', ({ test }) => {
    test('coordinates: numbers, text, local digits, ranges and rounding', () => {
      const ok = weather.validateCoordinates(13.123456, 80.27);
      eq(ok.ok, true);
      eq(ok.latitude, 13.1235);
      eq(weather.validateCoordinates('13.0827', '80.2707').ok, true);
      eq(weather.validateCoordinates('\u0661\u0663.\u0660\u0668', '\u0668\u0660.\u0662\u0667').latitude, 13.08);
      assert(weather.validateCoordinates(91, 0).errors.latitude, 'latitude above 90 must be rejected');
      assert(weather.validateCoordinates(0, 181).errors.longitude, 'longitude above 180 must be rejected');
      const blank = weather.validateCoordinates('', '');
      eq(blank.ok, false);
      eq(blank.errors.latitude, 'Enter the latitude.');
      assert(weather.validateCoordinates('abc', 1).errors.latitude, 'text must be rejected');
      assert(weather.validateCoordinates(NaN, 0).errors.latitude, 'NaN must be rejected');
      eq(weather.coordinatesLabel(13.0827, 80.2707), '13.08, 80.27');
    });
    test('places: validation, cleaning, labels and the saved weather place', async () => {
      const minimal = weather.validateLocationInput({ latitude: 13.08, longitude: 80.27 });
      eq(minimal.ok, true);
      eq(minimal.value.name, '13.08, 80.27');
      eq(minimal.value.source, 'manual');
      eq(minimal.value.timezone, null);
      const full = weather.validateLocationInput({ name: '  Plant   1 ', latitude: '13.08', longitude: '80.27', timezone: 'Asia/Kolkata', source: 'search' });
      eq(full.value.name, 'Plant 1');
      eq(full.value.timezone, 'Asia/Kolkata');
      eq(full.value.source, 'search');
      eq(weather.validateLocationInput({ latitude: 1, longitude: 1, source: 'x', timezone: 'Mars/Phobos' }).value.source, 'manual');
      assert(weather.validateLocationInput({ name: 'x'.repeat(81), latitude: 1, longitude: 1 }).errors.name, 'too-long name must be rejected');
      assert(weather.validateLocationInput('x').errors.location, 'non-object must be rejected');
      eq(weather.normalizeLocation(null), null);
      eq(weather.locationLabel({ name: 'Chennai', region: 'Tamil Nadu', country: 'India' }), 'Chennai, Tamil Nadu, India');
      eq(weather.locationLabel({ name: 'Delhi', region: 'Delhi', country: 'India' }), 'Delhi, India');
      eq(weather.locationLabel(null), '');
      await resetDb();
      await repo.initRepo();
      eq(await weather.getLocation(), null);
      const error = await expectError(() => weather.setLocation({ latitude: 200, longitude: 0 }), 'invalid_input');
      assert(error.fields.latitude, 'fields must be reported');
      eq((await weather.setLocation({ name: 'Test', ...CHENNAI })).name, 'Test');
      eq((await weather.getLocation()).latitude, 13.08);
      await weather.clearLocation();
      eq(await weather.getLocation(), null);
    });
    test('weather codes', () => {
      deepEq(weather.describeWeatherCode(0), { code: 0, text: 'Clear sky', icon: '☀️', group: 'clear' });
      eq(weather.describeWeatherCode(0, false).icon, '🌙');
      eq(weather.describeWeatherCode(95).group, 'storm');
      eq(weather.describeWeatherCode(999).text, 'Unknown conditions');
      eq(weather.describeWeatherCode(null).code, null);
    });
    test('saved copy: fresh, stale, too old for heat guidance, other place, corrupt', () => {
      const key = cfg.LS_KEYS.WEATHER_CACHE;
      const fetchedAt = '2026-11-12T08:30:00.000Z';
      eq(weather.getCachedWeather(null).status, 'no_location');
      localStorage.setItem(key, cacheEntry(fetchedAt));
      const fresh = weather.getCachedWeather(CHENNAI, new Date('2026-11-12T08:40:00Z'));
      eq(fresh.status, 'ok');
      eq(fresh.source, 'cache');
      eq(fresh.ageMinutes, 10);
      eq(fresh.fresh, true);
      eq(fresh.condition.text, 'Partly cloudy');
      eq(fresh.heat.level, 'danger');
      eq(fresh.heat.notes.length, 2);
      const stale = weather.getCachedWeather(CHENNAI, new Date('2026-11-12T09:10:00Z'));
      eq(stale.status, 'stale');
      eq(stale.fresh, false);
      assert(stale.heat !== null, 'heat guidance is still shown under 3 hours');
      eq(weather.getCachedWeather(CHENNAI, new Date('2026-11-12T12:00:00Z')).heat, null);
      eq(weather.getCachedWeather(CHENNAI, new Date('2026-11-12T08:00:00Z')).heat, null);
      eq(weather.getCachedWeather({ latitude: 13.5, longitude: 80.27 }, new Date('2026-11-12T08:40:00Z')).status, 'unavailable');
      localStorage.setItem(key, '{bad');
      eq(weather.getCachedWeather(CHENNAI).status, 'unavailable');
      localStorage.setItem(key, cacheEntry(fetchedAt).replace('"v":1', '"v":2'));
      eq(weather.getCachedWeather(CHENNAI).status, 'unavailable');
      localStorage.setItem(key, cacheEntry(fetchedAt, 13.08, 80.27, 999));
      eq(weather.getCachedWeather(CHENNAI).status, 'unavailable');
      weather.clearWeatherCache();
      eq(localStorage.getItem(key), null);
    });
  });

  suite('Weather service: network behaviour with a pretend server', ({ test, before }) => {
    before(async () => {
      await resetDb();
      await repo.initRepo();
    });
    test('fetchCurrentWeather asks for the right data and reads the answer', async () => {
      if (!online()) { skip('The device is offline, so the pretend-server checks are skipped.'); }
      let seen = null;
      const reading = await withFetch((url, init) => { seen = { url: String(url), init }; return Promise.resolve(jsonResponse(FORECAST)); }, () => weather.fetchCurrentWeather(CHENNAI));
      for (const part of ['api.open-meteo.com/v1/forecast', 'latitude=13.08', 'longitude=80.27', 'current=', 'forecast_days=1']) { assert(seen.url.includes(part), 'The request is missing ' + part); }
      eq(seen.init.credentials, 'omit');
      deepEq(reading, { observedAt: '2026-11-12T14:00', localDate: '2026-11-12', localTime: '14:00', timezone: 'Asia/Kolkata', tempC: 36, apparentC: 40, humidity: 60, windKmh: 12, gustKmh: 20, precipitationMm: 0, weatherCode: 2, isDay: true, tempMaxC: 37, tempMinC: 27, uvIndexMax: 8 });
    });
    test('errors are mapped to clear codes', async () => {
      if (!online()) { skip('The device is offline, so the pretend-server checks are skipped.'); }
      await expectError(() => weather.fetchCurrentWeather({}), 'invalid_input');
      await expectError(() => withFetch(NETWORK_DOWN, () => weather.fetchCurrentWeather(CHENNAI)), 'network');
      await expectError(() => withFetch(() => Promise.resolve(jsonResponse({ error: true, reason: 'Limit' }, 500)), () => weather.fetchCurrentWeather(CHENNAI)), 'service');
      await expectError(() => withFetch(() => Promise.resolve(new Response('oops', { status: 200 })), () => weather.fetchCurrentWeather(CHENNAI)), 'bad_response');
      await expectError(() => withFetch(() => Promise.resolve(jsonResponse({ timezone: 'UTC' })), () => weather.fetchCurrentWeather(CHENNAI)), 'bad_response');
      await expectError(() => withFetch(() => Promise.resolve(jsonResponse({ current: { time: '2026-11-12T14:00' } })), () => weather.fetchCurrentWeather(CHENNAI)), 'bad_response');
      const hang = (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); });
      await expectError(() => withFetch(hang, () => weather.fetchCurrentWeather(CHENNAI, { timeoutMs: 50 })), 'timeout');
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      await expectError(() => withFetch(hang, () => weather.fetchCurrentWeather(CHENNAI, { signal: controller.signal })), 'aborted');
    });
    test('searchPlaces cleans results and checks the query', async () => {
      if (!online()) { skip('The device is offline, so the pretend-server checks are skipped.'); }
      let url = '';
      const body = { results: [{ name: 'Chennai', admin1: 'Tamil Nadu', country: 'India', country_code: 'in', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' }, { name: '', latitude: 1, longitude: 1 }, { name: 'Bad', latitude: 200, longitude: 0 }] };
      const places = await withFetch((requested) => { url = String(requested); return Promise.resolve(jsonResponse(body)); }, () => weather.searchPlaces('Chennai'));
      eq(places.length, 1);
      eq(places[0].label, 'Chennai, Tamil Nadu, India');
      eq(places[0].countryCode, 'IN');
      eq(places[0].timezone, 'Asia/Kolkata');
      assert(url.includes('geocoding-api.open-meteo.com') && url.includes('name=Chennai') && url.includes('count=5'), 'Unexpected search request: ' + url);
      deepEq(await withFetch(() => Promise.resolve(jsonResponse({})), () => weather.searchPlaces('Nowhere')), []);
      await expectError(() => weather.searchPlaces('a'), 'invalid_input');
      await expectError(() => weather.searchPlaces('x'.repeat(81)), 'invalid_input');
    });
    test('getWeather: no place, network, saved copy, forcing, stale and unavailable', async () => {
      if (!online()) { skip('The device is offline, so the pretend-server checks are skipped.'); }
      weather.clearWeatherCache();
      eq((await weather.getWeather()).status, 'no_location');
      await weather.setLocation({ name: 'Test', ...CHENNAI });
      const t0 = new Date('2026-11-12T08:30:00Z');
      const minutes = (count) => new Date(t0.getTime() + count * 60000);
      let calls = 0;
      await withFetch(() => { calls += 1; return Promise.resolve(jsonResponse(FORECAST)); }, async () => {
        const first = await weather.getWeather({ now: t0 });
        eq(first.status, 'ok');
        eq(first.source, 'network');
        eq(calls, 1);
        const second = await weather.getWeather({ now: minutes(10) });
        eq(second.source, 'cache');
        eq(second.ageMinutes, 10);
        eq(calls, 1, 'a fresh saved copy needs no network');
        await weather.getWeather({ now: minutes(10), force: true });
        eq(calls, 2);
        await weather.getWeather({ now: minutes(40) });
        eq(calls, 3);
      });
      await withFetch(NETWORK_DOWN, async () => {
        const stale = await weather.getWeather({ now: minutes(100) });
        eq(stale.status, 'stale');
        eq(stale.error.code, 'network');
        assert(stale.reading !== null && stale.heat !== null, 'the older reading and heat guidance are kept');
        weather.clearWeatherCache();
        const none = await weather.getWeather({ now: minutes(100) });
        eq(none.status, 'unavailable');
        eq(none.reading, null);
        eq(none.error.code, 'network');
      });
      const controller = new AbortController();
      controller.abort();
      await expectError(() => weather.getWeather({ signal: controller.signal, force: true }), 'aborted');
    });
    test('device location: success and refusal (skipped if the browser cannot be simulated)', async () => {
      const stub = (behaviour) => ({ getCurrentPosition: behaviour });
      try {
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: stub((success) => success({ coords: { latitude: 13.0827, longitude: 80.2707, accuracy: 24.6 } })) });
      } catch { skip('This browser does not allow simulating the device location.'); }
      try {
        deepEq(await weather.getDeviceLocation(), { latitude: 13.08, longitude: 80.27, accuracyM: 25 });
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: stub((success, failure) => failure({ code: 1 })) });
        await expectError(() => weather.getDeviceLocation(), 'denied');
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: stub((success, failure) => failure({ code: 3 })) });
        await expectError(() => weather.getDeviceLocation(), 'timeout');
      } finally { delete navigator.geolocation; }
    });
  });

  /* ======================================================================
     WORKSPACE
     ====================================================================== */
  suite('Adaptive workspace (js/services/workspace.js)', ({ test, before }) => {
    let data;
    before(async () => {
      await resetDb();
      await repo.initRepo();
      data = await workspace.loadWorkspaceData();
      router.setModuleRegistry(await fetchJson('data/modules.json'));
    });
    test('the data file is valid and every reference in it exists', async () => {
      eq(workspace.validateWorkspaceData(data), true);
      const moduleIds = new Set((await fetchJson('data/modules.json')).modules.map((mod) => mod.id));
      eq(new Set(data.widgets.map((widget) => widget.id)).size, data.widgets.length, 'unique widgets');
      for (const widget of data.widgets) {
        if (widget.module !== null) { assert(moduleIds.has(widget.module), 'Widget ' + widget.id + ' points to unknown module ' + widget.module); }
        if (widget.data.store) { assert(cfg.isStoreName(widget.data.store), 'Widget ' + widget.id + ' uses unknown store ' + widget.data.store); }
        for (const item of widget.data.items || []) {
          assert(cfg.isStoreName(item.store), 'Unknown store ' + item.store);
          assert(moduleIds.has(item.module), 'Unknown module ' + item.module);
        }
      }
      for (const action of data.quick_action_catalog) { if (action.kind === 'module') { assert(moduleIds.has(action.module), 'Quick action ' + action.id + ' points to unknown module ' + action.module); } }
      deepEq(Object.keys(data.roles).sort(), ['beginner_learner', 'hse_assistant', 'safety_officer', 'hse_engineer', 'senior_hse_engineer', 'hse_supervisor', 'hse_manager', 'hse_consultant'].sort());
      deepEq(Object.keys(data.industries).sort(), INDUSTRY_IDS.slice().sort());
      deepEq(Object.keys(data.experience).sort(), data.experience_bands.map((band) => band.id).sort());
    });
    test('validation rejects mistakes with a readable message', async () => {
      const bad = async (change, fragment) => {
        const copy = JSON.parse(JSON.stringify(data));
        change(copy);
        const error = await expectError(() => workspace.validateWorkspaceData(copy), Error);
        assert(error.message.startsWith('NASUR workspace data:') && error.message.includes(fragment), 'Message "' + error.message + '" should mention "' + fragment + '".');
      };
      await bad((d) => { d.widgets[1].id = d.widgets[0].id; }, 'duplicate widget');
      await bad((d) => { d.base.show.push('nope'); }, 'unknown item');
      await bad((d) => { d.quick_action_catalog[0].kind = 'x'; }, 'kind');
      await bad((d) => { d.widgets[2].default_size = 'huge'; }, 'default_size');
      await bad((d) => { d.limits.quick_actions_max = 0; }, 'limits');
      await bad((d) => { d.experience.extra = {}; }, 'experience');
      await bad((d) => { d.resolution_order = ['user', 'base']; }, 'resolution_order');
      await bad((d) => { d.schema_version = 2; }, 'schema_version');
      await bad((d) => { d.widgets.find((w) => w.id === 'weather').options.details.default = 'yes'; }, 'default');
      await bad((d) => { d.roles.safety_officer.sizes = { reminders: 'huge' }; }, 'not allowed');
    });
    test('base layout, then role, industry and experience layers in order', () => {
      const base = workspace.resolveWorkspace(data, {});
      deepEq(base.widgets.map((w) => w.id), ['jarvis', 'quick_actions', 'date_time', 'weather', 'today_summary', 'open_actions', 'reminders']);
      deepEq(base.layers, ['base']);
      deepEq(base.quickActions.map((a) => a.id), ['start_day', 'new_observation', 'inspection', 'learn', 'ask_jarvis']);
      eq(base.widgets[0].size, 'full');
      eq(base.widgets[2].size, 'half');
      eq(base.widgets.find((w) => w.id === 'weather').options.details, false);
      eq(base.widgets.find((w) => w.id === 'reminders').options.max_items, 5);
      const full = workspace.resolveWorkspace(data, { role: 'beginner_learner', industry: 'construction', experienceYears: 0.5 });
      deepEq(full.widgets.map((w) => w.id), ['jarvis', 'quick_actions', 'learning', 'weather', 'date_time', 'reminders']);
      deepEq(full.quickActions.map((a) => a.id), ['learn', 'ask_jarvis', 'phrasebook', 'machines', 'new_observation', 'ptw']);
      deepEq(full.layers, ['base', 'role:beginner_learner', 'industry:construction', 'experience:new']);
      deepEq(full.hidden, ['today_summary', 'open_actions']);
      eq(full.widgets.find((w) => w.id === 'learning').size, 'full');
      eq(full.widgets.find((w) => w.id === 'weather').options.details, true);
      const ignored = workspace.resolveWorkspace(data, { role: 'nope', industry: 'x' });
      deepEq(ignored.layers, ['base']);
      eq(ignored.inputs.role, null);
    });
    test('experience bands', () => {
      each([[0, 'new'], [0.99, 'new'], [1, 'developing'], [2.9, 'developing'], [3, 'experienced'], [7.9, 'experienced'], [8, 'senior'], [-1, null], [null, null], [NaN, null], ['x', null]], (years, band) => eq(workspace.experienceBandFor(data, years), band, String(years)));
    });
    test('the person\'s own layout is applied last and bad parts are reported', () => {
      const own = workspace.resolveWorkspace(data, { role: 'safety_officer', userOverlay: { hide: ['weather', 'nope'], sizes: { reminders: 'full' } } });
      deepEq(own.widgets.map((w) => w.id), ['jarvis', 'quick_actions', 'today_summary', 'open_actions', 'date_time', 'reminders']);
      deepEq(own.hidden, ['weather', 'learning']);
      eq(own.widgets.find((w) => w.id === 'reminders').size, 'full');
      eq(own.userOverlayProblems.length, 1);
      eq(own.layers[own.layers.length - 1], 'user');
      const seven = ['start_day', 'new_observation', 'inspection', 'learn', 'ask_jarvis', 'toolbox_talk', 'new_action'];
      const trimmed = workspace.resolveWorkspace(data, { userOverlay: { quick_actions: seven } });
      eq(trimmed.quickActions.length, 6);
      eq(trimmed.userOverlayProblems.length, 1);
      const empty = workspace.resolveWorkspace(data, { userOverlay: { quick_actions: [] } });
      eq(empty.quickActions.length, 5, 'an empty list is ignored');
      eq(empty.userOverlayProblems.length, 1);
      const options = workspace.resolveWorkspace(data, { userOverlay: { options: { reminders: { max_items: 3, window_days: 99 }, weather: { details: 'yes' }, date_time: { hour_format: '24' } } } });
      eq(options.widgets.find((w) => w.id === 'reminders').options.max_items, 3);
      eq(options.widgets.find((w) => w.id === 'reminders').options.window_days, 7);
      eq(options.widgets.find((w) => w.id === 'date_time').options.hour_format, '24');
      eq(options.userOverlayProblems.length, 2);
      const result = workspace.resolveWorkspace(data, {});
      result.widgets[0].options.x = 1;
      result.widgets[1].data.x = 1;
      deepEq(workspace.resolveWorkspace(data, {}).widgets[0].options, {});
    });
    test('quick actions are marked available only when their module is active', () => {
      deepEq(workspace.describeQuickAction({ id: 'ask_jarvis', kind: 'jarvis', module: null, segments: [] }).available, true);
      const home = workspace.describeQuickAction({ id: 'x', label: 'Home', icon: 'h', kind: 'module', module: 'home', segments: [] });
      eq(home.available, true);
      eq(home.href, '#/home');
      const planned = workspace.describeQuickAction({ id: 'y', label: 'Obs', icon: 'o', kind: 'module', module: 'observations', segments: ['new'] });
      eq(planned.available, false);
      eq(planned.href, null);
      eq(workspace.describeQuickActions([{ id: 'ask_jarvis', kind: 'jarvis', module: null, segments: [] }]).length, 1);
    });
    test('getWorkspace reads settings, career profile and the saved layout', async () => {
      await ucfg.updateUserConfig({ role: 'safety_officer', industry: 'construction' });
      let ws = await workspace.getWorkspace();
      deepEq(ws.layers, ['base', 'role:safety_officer', 'industry:construction']);
      eq((await workspace.getWorkspaceInputs()).experienceYears, null);
      await repo.create(S.CAREER_PROFILE, { experience_years: 4 });
      eq((await workspace.getWorkspaceInputs()).experienceYears, 4);
      ws = await workspace.getWorkspace();
      assert(ws.layers.includes('experience:experienced'), 'The experience layer must apply once years are known.');
      deepEq(await workspace.saveUserOverlay({ hide: ['reminders'] }), { hide: ['reminders'] });
      deepEq(await workspace.getUserOverlay(), { hide: ['reminders'] });
      ws = await workspace.getWorkspace();
      assert(ws.hidden.includes('reminders'), 'The saved layout must hide reminders.');
      const error = await expectError(() => workspace.saveUserOverlay({ hide: ['bad'] }), 'invalid_overlay');
      eq(error.problems.length, 1);
      deepEq(await workspace.getUserOverlay(), { hide: ['reminders'] }, 'a rejected layout saves nothing');
      await workspace.clearUserOverlay();
      assert(!(await workspace.getWorkspace()).hidden.includes('reminders'), 'Clearing the layout must show reminders again.');
      assert((await workspace.getWorkspace({ role: 'hse_manager' })).layers.includes('role:hse_manager'), 'overrides must apply');
    });
  });

  /* ======================================================================
     JARVIS CONTEXT
     ====================================================================== */
  suite('JARVIS context (js/jarvis/context.js)', ({ test, before, after }) => {
    const setupForm = () => jctx.registerForm({
      id: 'obs_new',
      title: 'New observation',
      fields: [
        { name: 'likelihood', label: 'Likelihood', type: 'select', required: true, help: 'How likely is it to happen?', options: ['Rare', 'Possible', 'Likely'] },
        { name: 'severity', label: 'Severity', type: 'select' },
        { name: 'note', label: 'Private note', type: 'textarea', private: true }
      ]
    });
    const privacy = (level, extra) => ({ context_level: level, ai_enabled: true, redact_names: true, ...(extra || {}) });
    before(async () => {
      await resetDb();
      await repo.initRepo();
      jctx.resetContext();
    });
    after(() => { jctx.resetContext(); });
    test('levels and descriptions', () => {
      eq(jctx.levelRank('off'), 0);
      eq(jctx.levelRank('selection'), 3);
      eq(jctx.levelRank('x'), -1);
      eq(jctx.levelAtLeast('field', 'page'), true);
      eq(jctx.levelAtLeast('page', 'field'), false);
      eq(jctx.levelAtLeast('x', 'off'), false);
      eq(jctx.getLevelInfo('field').title, 'Page and form fields');
      eq(jctx.getLevelInfo('zzz').id, 'off');
      eq(jctx.CONTEXT_LEVEL_INFO.length, 4);
      ucfg.resetConfigCache();
      eq(jctx.getContextLevel(), 'page');
    });
    test('the page description is checked', async () => {
      jctx.setPageContext({ module: 'observations', title: 'Observations', route: '/observations' });
      deepEq(jctx.getPageContext(), { module: 'observations', title: 'Observations', route: '/observations', view: 'ok' });
      for (const bad of [null, { title: '' }, { title: 'x'.repeat(81) }, { title: 'T', route: 'bad' }, { title: 'T', view: 'zzz' }, { title: 'T', module: 'bad id' }]) { await expectError(() => jctx.setPageContext(bad), TypeError); }
    });
    test('forms: mistakes are rejected, remover only removes its own registration', async () => {
      const field = { name: 'a', label: 'A' };
      const rejects = [null, { id: 'bad id', title: 'T', fields: [field] }, { id: 'f1', title: '', fields: [field] }, { id: 'f1', title: 'T', fields: [] }, { id: 'f1', title: 'T', fields: [field, field] }, { id: 'f1', title: 'T', fields: [{ name: 'a', label: 'A', type: 'wat' }] }, { id: 'f1', title: 'T', fields: [{ name: 'a', label: 'x'.repeat(81) }] }, { id: 'f1', title: 'T', fields: [{ name: 'a', label: 'A', options: 'x' }] }];
      for (const definition of rejects) { await expectError(() => jctx.registerForm(definition), TypeError); }
      eq(jctx.hasForm('f1'), false);
      const removeA = jctx.registerForm({ id: 'f_dup', title: 'A', fields: [field] });
      const removeB = jctx.registerForm({ id: 'f_dup', title: 'B', fields: [field] });
      removeA();
      eq(jctx.hasForm('f_dup'), true);
      removeB();
      eq(jctx.hasForm('f_dup'), false);
      const forget = setupForm();
      eq(jctx.setFocusedField('obs_new', 'likelihood'), true);
      eq(jctx.setFocusedField('obs_new', 'nope'), false);
      eq(jctx.setFocusedField('nope', 'likelihood'), false);
      deepEq(jctx.getFocusedField(), { formId: 'obs_new', fieldName: 'likelihood' });
      forget();
      eq(jctx.getFocusedField(), null);
    });
    test('captureContext shares only what the level allows, never typed values', async () => {
      const forget = setupForm();
      jctx.setPageContext({ module: 'observations', title: 'Observations', route: '/observations' });
      jctx.setFocusedField('obs_new', 'likelihood');
      try {
        const off = jctx.captureContext({ privacy: privacy('off') });
        deepEq(off, { level: 'off' });
        const page = jctx.captureContext({ privacy: privacy('page') });
        eq(page.page.title, 'Observations');
        eq('form' in page, false);
        const field = jctx.captureContext({ privacy: privacy('field') });
        deepEq(field.form, { id: 'obs_new', title: 'New observation', fields: ['Likelihood', 'Severity'] });
        deepEq(field.field, { name: 'likelihood', label: 'Likelihood', type: 'select', required: true, help: 'How likely is it to happen?', options: ['Rare', 'Possible', 'Likely'] });
        for (const key of Object.keys(field)) { assert(['level', 'page', 'form', 'field'].includes(key), 'Unexpected key in the context: ' + key); }
        jctx.setFocusedField('obs_new', 'note');
        const hidden = jctx.captureContext({ privacy: privacy('field') });
        assert(hidden.form && !('field' in hidden), 'a private field must not be described');
        eq(jctx.captureContext({ privacy: privacy('field', { ai_enabled: false }), forAi: true }).level, 'off');
        eq(jctx.captureContext({ privacy: privacy('field'), forAi: true }).level, 'field');
        eq(jctx.captureContext({ privacy: privacy('field', { ai_enabled: false }) }).level, 'field');
        eq(Object.isFrozen(field), true);
        await expectError(() => { field.page.title = 'changed'; }, TypeError);
      } finally { forget(); }
    });
    test('selected text: only at the highest level, on request, redacted, shortened and expiring', () => {
      jctx.setKnownNames(['Ravi']);
      const text = 'Call Ravi on 98765 43210 about the leak';
      eq(jctx.rememberSelection(text, { level: 'page' }), false);
      eq(jctx.rememberSelection(text, { level: 'selection', now: 1000 }), true);
      const high = privacy('selection');
      const shared = jctx.captureContext({ privacy: high, includeSelection: true, now: 2000 });
      eq(shared.selected_text, 'Call [name] on [number] about the leak');
      eq(shared.selected_text_redacted, true);
      eq('selected_text' in jctx.captureContext({ privacy: high, now: 2000 }), false, 'needs includeSelection');
      eq(jctx.captureContext({ privacy: privacy('selection', { redact_names: false }), includeSelection: true, now: 2000 }).selected_text, text);
      eq('selected_text' in jctx.captureContext({ privacy: privacy('field'), includeSelection: true, now: 2000 }), false);
      const preview = jctx.buildPreview(shared).find((row) => row.key === 'selection').value;
      assert(preview.includes('Call [name] on [number] about the leak') && preview.includes('hidden'), 'The preview must show the final text and say it was hidden: ' + preview);
      eq('selected_text' in jctx.captureContext({ privacy: high, includeSelection: true, now: 1000 + jctx.SELECTION_TTL_MS + 1 }), false);
      eq(jctx.hasSelection(1000 + jctx.SELECTION_TTL_MS + 1), false);
      jctx.rememberSelection('word '.repeat(300), { level: 'selection', now: 1000 });
      const long = jctx.captureContext({ privacy: high, includeSelection: true, now: 2000 });
      eq(long.selected_text.length, jctx.MAX_SELECTION_CHARS);
      eq(long.selected_text_shortened, true);
      jctx.clearSelection();
      eq(jctx.hasSelection(), false);
    });
    test('redaction hides emails, long numbers and known names but keeps dates', () => {
      eq(jctx.redactText('Call Ravi on +91 98765 43210 or ravi@x.com on 2026-11-12', ['Ravi']), 'Call [name] on [number] or [email] on 2026-11-12');
      eq(jctx.redactText('Due 12/11/2026 and 12.11.2026', []), 'Due 12/11/2026 and 12.11.2026');
      eq(jctx.redactText('ravi and Ravindran', ['Ravi']), '[name] and Ravindran');
      eq(jctx.redactText('சுரேஷ் வந்தார்', ['சுரேஷ்']), '[name] வந்தார்');
      eq(jctx.setKnownNames(['Ravi', ' ravi ', 'A', 'x'.repeat(61), 'Kumar']), 2);
      eq(jctx.redactText('Kumar met Ravi'), '[name] met [name]');
      return expectError(() => jctx.setKnownNames('x'), TypeError);
    });
    test('the preview lists exactly what is shared', () => {
      deepEq(jctx.buildPreview({ level: 'off' }).map((row) => row.key), ['level', 'nothing']);
      const page = jctx.buildPreview({ level: 'page' });
      deepEq(page.map((row) => row.key), ['level', 'page']);
      eq(page[1].value, 'Not known yet');
      const field = jctx.buildPreview({ level: 'field', page: { title: 'Observations' }, form: { title: 'New observation' }, field: { label: 'Likelihood', type: 'select', required: true } });
      deepEq(field.map((row) => row.key), ['level', 'page', 'form', 'field', 'values']);
      eq(field.find((row) => row.key === 'values').value, 'Never shared');
      eq(field.find((row) => row.key === 'field').value, 'Likelihood (select, required)');
      eq(jctx.buildPreview({ level: 'selection', page: { title: 'P' } }).find((row) => row.key === 'selection').value, 'None chosen');
    });
    test('tracking follows page changes and the last used field', async () => {
      router.setModuleRegistry(await fetchJson('data/modules.json'));
      const forget = setupForm();
      const stop = jctx.startContextTracking();
      const box = document.createElement('div');
      box.innerHTML = '<div data-jarvis-form="obs_new"><input data-jarvis-field="likelihood"><input data-jarvis-field="severity"></div>';
      document.body.append(box);
      try {
        eq(jctx.isTracking(), true);
        eq(jctx.startContextTracking(), stop);
        ev.emit(cfg.EVENTS.ROUTE_CHANGED, { module_id: 'home', state: 'ok', route: '/home', path: '/home', segments: [] });
        deepEq(jctx.getPageContext(), { module: 'home', title: 'Home', route: '/home', view: 'ok' });
        box.querySelectorAll('input')[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        deepEq(jctx.getFocusedField(), { formId: 'obs_new', fieldName: 'severity' });
        ev.emit(cfg.EVENTS.ROUTE_CHANGED, { module_id: null, state: 'not_found', route: null, path: '/zzz', segments: [] });
        eq(jctx.getPageContext().title, 'Page not found');
        eq(jctx.getPageContext().module, null);
        eq(jctx.getFocusedField(), null);
      } finally {
        stop();
        box.remove();
        forget();
      }
      eq(jctx.isTracking(), false);
    });
    test('text selected in a field is remembered only at the highest level and never from private areas', async () => {
      const stop = jctx.startContextTracking();
      const box = document.createElement('div');
      box.innerHTML = '<input id="t1" value="hello world"><input id="t2" type="password" value="secret"><div data-jarvis-private><input id="t3" value="private note"></div>';
      document.body.append(box);
      const pick = (id) => {
        const element = box.querySelector('#' + id);
        element.setSelectionRange(0, 5);
        element.dispatchEvent(new Event('select', { bubbles: true }));
      };
      try {
        pick('t1');
        eq(jctx.hasSelection(), false, 'not remembered at the default level');
        await ucfg.updateUserConfig({ privacy: { context_level: 'selection' } });
        pick('t2');
        pick('t3');
        eq(jctx.hasSelection(), false, 'password and private fields are ignored');
        pick('t1');
        eq(jctx.getSelectionText(), 'hello');
        await ucfg.updateUserConfig({ privacy: { context_level: 'page' } });
        eq(jctx.hasSelection(), false, 'lowering the level erases it');
      } finally {
        stop();
        box.remove();
      }
    });
  });

  /* ======================================================================
     VOICE
     ====================================================================== */
  suite('JARVIS voice (js/jarvis/voice.js)', ({ test }) => {
    const makeFake = () => class FakeRecognition {
      constructor() { FakeRecognition.last = this; }
      start() { queueMicrotask(() => { if (this.onstart) { this.onstart(); } }); }
      stop() { queueMicrotask(() => { if (this.onend) { this.onend(); } }); }
      abort() { this.aborted = true; }
    };
    const results = (text, isFinal, confidence) => {
      const result = [{ transcript: text, confidence }];
      result.isFinal = isFinal;
      return [result];
    };
    async function withRecognition(Fake, fn) {
      const saved = { standard: window.SpeechRecognition, prefixed: window.webkitSpeechRecognition };
      window.SpeechRecognition = Fake;
      window.webkitSpeechRecognition = undefined;
      try { return await fn(); } finally {
        window.SpeechRecognition = saved.standard;
        window.webkitSpeechRecognition = saved.prefixed;
      }
    }
    test('speech is split into short pieces at sentence ends', async () => {
      deepEq(voice.splitForSpeech('One. Two! Three?', 8), ['One.', 'Two!', 'Three?']);
      deepEq(voice.splitForSpeech('One. Two! Three?', 100), ['One. Two! Three?']);
      deepEq(voice.splitForSpeech('It is 3.5 m long. Stay clear.', 100), ['It is 3.5 m long. Stay clear.']);
      deepEq(voice.splitForSpeech('   '), []);
      const words = 'a '.repeat(100).trim();
      const chunks = voice.splitForSpeech(words, 20);
      assert(chunks.every((chunk) => chunk.length <= 20) && chunks.join(' ') === words, 'long text must be cut at spaces without losing words');
      deepEq(voice.splitForSpeech('x'.repeat(50), 20).map((chunk) => chunk.length), [20, 20, 10]);
      eq(voice.splitForSpeech('सुरक्षा पहले। हेलमेट पहनें।', 15).length, 2);
      await expectError(() => voice.splitForSpeech('x', 0), RangeError);
    });
    test('voice choice, support, errors and permission', async () => {
      eq(voice.pickVoice([{ lang: 'en-US', default: true }, { lang: 'ta_IN', default: false, localService: true }, { lang: 'ta-LK' }], 'ta-IN').lang, 'ta_IN');
      eq(voice.pickVoice([{ lang: 'ta-LK' }], 'ta-IN').lang, 'ta-LK');
      eq(voice.pickVoice([{ lang: 'hi-IN' }], 'ta-IN'), null);
      eq(voice.pickVoice(null, 'en'), null);
      eq(voice.pickVoice([], 'en'), null);
      const support = voice.getVoiceSupport();
      for (const key of ['recognition', 'synthesis', 'secureContext', 'inFrame']) { eq(typeof support[key], 'boolean', key); }
      eq(new voice.VoiceError('denied').message, voice.VOICE_MESSAGES.denied);
      eq(new voice.VoiceError('nope').code, 'unknown');
      assert(['granted', 'denied', 'prompt', 'unknown'].includes(await voice.getMicrophonePermission()), 'permission value');
      eq((await voice.speak('   ')).reason, 'empty');
      voice.stopSpeaking();
      eq(voice.isSpeaking(), false);
    });
    test('listening: live text, stopping, states and the final transcript', async () => {
      const Fake = makeFake();
      await withRecognition(Fake, async () => {
        const heard = [];
        const states = [];
        const session = voice.startListening({ language: 'ta', onText: (text) => heard.push(text), onState: (state) => states.push(state) });
        await sleep(10);
        const recognition = Fake.last;
        eq(recognition.lang, 'ta-IN');
        eq(recognition.interimResults, true);
        eq(voice.isListening(), true);
        recognition.onresult({ results: results('wear', false, 0) });
        recognition.onresult({ results: results('wear your helmet', true, 0.9) });
        deepEq(heard, ['wear', 'wear your helmet']);
        session.stop();
        const outcome = await session.done;
        eq(outcome.transcript, 'wear your helmet');
        eq(outcome.reason, 'stopped');
        eq(outcome.confidence, 0.9);
        eq(outcome.error, null);
        assert(states.includes('listening'), 'state "listening" is expected');
        eq(states[states.length - 1], 'idle');
        eq(voice.isListening(), false);
      });
    });
    test('listening: interim text is kept, errors and aborts are reported, one session at a time', async () => {
      const Fake = makeFake();
      await withRecognition(Fake, async () => {
        const interim = voice.startListening({ language: 'en' });
        await sleep(10);
        Fake.last.onresult({ results: results('half a sentence', false, 0) });
        interim.stop();
        eq((await interim.done).transcript, 'half a sentence');
        const failing = voice.startListening({ language: 'en' });
        await sleep(10);
        Fake.last.onerror({ error: 'not-allowed' });
        Fake.last.onend();
        const failed = await failing.done;
        eq(failed.reason, 'error');
        eq(failed.error.code, 'denied');
        eq(failed.transcript, '');
        const aborted = voice.startListening({ language: 'en' });
        await sleep(10);
        Fake.last.onresult({ results: results('discard me', true, 0.8) });
        aborted.abort();
        const abortedOutcome = await aborted.done;
        eq(abortedOutcome.reason, 'aborted');
        eq(abortedOutcome.transcript, '');
        eq(Fake.last.aborted, true);
        const first = voice.startListening({ language: 'en' });
        const second = voice.startListening({ language: 'en' });
        eq((await first.done).reason, 'aborted');
        second.abort();
        await second.done;
      });
    });
    test('listening without support, or while offline, gives a clear error', async () => {
      await withRecognition(undefined, async () => {
        const outcome = await voice.startListening({ language: 'en' }).done;
        eq(outcome.reason, 'error');
        eq(outcome.error.code, 'unsupported');
        eq(outcome.error.message, voice.VOICE_MESSAGES.unsupported);
      });
      try {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      } catch { skip('This browser does not allow simulating being offline.'); }
      try {
        await withRecognition(makeFake(), async () => {
          const outcome = await voice.startListening({ language: 'en' }).done;
          eq(outcome.error.code, 'offline');
        });
      } finally { delete navigator.onLine; }
    });
  });

  /* ======================================================================
     JARVIS DRAWER
     ====================================================================== */
  suite('JARVIS drawer (js/jarvis/drawer.js)', ({ test, before, after }) => {
    let root;
    let jarvis;
    const q = (id) => root.querySelector('#' + id);
    const messages = () => Array.from(q('jarvis-log').children);
    const sendText = (text) => {
      q('jarvis-text').value = text;
      q('jarvis-btn-send').click();
    };
    before(() => {
      ucfg.resetConfigCache();
      root = document.createElement('div');
      document.body.append(root);
      jarvis = drawer.mountJarvis({ root });
    });
    after(() => {
      drawer.unmountJarvis();
      root.remove();
    });
    test('mounts once, builds every element and starts closed', () => {
      eq(drawer.getJarvis(), jarvis);
      eq(Object.isFrozen(jarvis), true);
      eq(drawer.mountJarvis({ root }), jarvis);
      for (const id of ['jarvis-fab', 'jarvis-scrim', 'jarvis-drawer', 'jarvis-body', 'jarvis-context-panel', 'jarvis-log', 'jarvis-text', 'jarvis-btn-close', 'jarvis-btn-clear', 'jarvis-btn-context', 'jarvis-btn-selection', 'jarvis-btn-mic', 'jarvis-btn-send', 'jarvis-status']) { assert(q(id), 'Missing element #' + id); }
      eq(q('jarvis-drawer').getAttribute('data-open'), 'false');
      eq(jarvis.isOpen(), false);
      eq(q('jarvis-btn-mic').hidden, !voice.isRecognitionSupported());
    });
    test('opens and closes with the button, the close button and Escape', () => {
      jarvis.open();
      eq(jarvis.isOpen(), true);
      eq(q('jarvis-drawer').getAttribute('data-open'), 'true');
      eq(q('jarvis-scrim').getAttribute('data-open'), 'true');
      eq(q('jarvis-fab').hidden, true);
      eq(messages().length, 1);
      eq(messages()[0].getAttribute('data-role'), 'system');
      q('jarvis-btn-close').click();
      eq(jarvis.isOpen(), false);
      eq(q('jarvis-fab').hidden, false);
      eq(document.body.classList.contains('is-scroll-locked'), false);
      q('jarvis-fab').click();
      eq(jarvis.isOpen(), true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      eq(jarvis.isOpen(), false);
    });
    test('"What JARVIS sees" shows the privacy panel', () => {
      jarvis.open();
      eq(q('jarvis-context-panel').hidden, true);
      q('jarvis-btn-context').click();
      eq(q('jarvis-context-panel').hidden, false);
      const text = q('jarvis-context-panel').textContent;
      assert(text.includes('Sharing level') && text.includes('Online AI is off'), 'The panel must show the level and the AI setting: ' + text);
      q('jarvis-btn-context').click();
      eq(q('jarvis-context-panel').hidden, true);
      assert(jarvis.getSnapshot() !== null, 'A snapshot must exist while open.');
      jarvis.close();
    });
    test('the default responder says plainly that it cannot answer yet', async () => {
      jarvis.open();
      sendText('hello');
      await waitFor(() => messages().length === 3 && !messages()[2].textContent.includes('Thinking'), 'the default reply');
      deepEq(messages().map((item) => item.getAttribute('data-role')), ['system', 'user', 'system']);
      eq(messages()[1].textContent, 'hello');
      assert(messages()[2].textContent.includes('cannot answer'), 'The reply must say it cannot answer yet.');
      eq(q('jarvis-text').value, '');
      sendText('   ');
      eq(q('jarvis-status').textContent, 'Type or say something first.');
      eq(messages().length, 3);
      jarvis.clearMessages();
      eq(messages().length, 1);
      jarvis.close();
    });
    test('a custom responder receives the question, the context and a cancel signal', async () => {
      let received = null;
      jarvis.setResponder(async (input) => { received = input; return { text: 'Reply to ' + input.text, source: 'General HSE knowledge' }; });
      jarvis.open();
      sendText('What is LOTO?');
      await waitFor(() => messages().length === 3 && !messages()[2].textContent.includes('Thinking'), 'the custom reply');
      eq(received.text, 'What is LOTO?');
      eq(received.context.level, 'page');
      eq(received.aiContext.level, 'off', 'nothing may go online while AI is off');
      assert(received.signal instanceof AbortSignal, 'a cancel signal is required');
      eq(messages()[2].getAttribute('data-role'), 'assistant');
      eq(messages()[2].querySelector('.jarvis-msg__source').textContent, 'General HSE knowledge');
      assert(messages()[2].textContent.includes('Reply to What is LOTO?'), 'The reply text is missing.');
      jarvis.clearMessages();
      jarvis.close();
    });
    test('a failing or empty responder never breaks the drawer', async () => {
      const cap = captureConsole();
      try {
        jarvis.open();
        jarvis.setResponder(async () => { throw new Error('boom'); });
        sendText('one');
        await waitFor(() => messages().length === 3 && !messages()[2].textContent.includes('Thinking'), 'the error reply');
        assert(messages()[2].textContent.includes('ran into a problem'), 'A plain error message is required.');
        jarvis.setResponder(async () => '');
        sendText('two');
        await waitFor(() => messages().length === 5 && !messages()[4].textContent.includes('Thinking'), 'the empty reply');
        assert(messages()[4].textContent.includes('ran into a problem'), 'An empty reply must show the plain error message.');
        await expectError(() => jarvis.setResponder('x'), TypeError);
        jarvis.setResponder(null);
        jarvis.clearMessages();
        jarvis.close();
      } finally { cap.restore(); }
    });
    test('addMessage checks its input, and destroy removes everything', async () => {
      await expectError(() => jarvis.addMessage({ role: 'robot', text: 'x' }), TypeError);
      jarvis.addMessage({ role: 'assistant', text: 'Added', source: 'Your uploaded document' });
      assert(messages().some((item) => item.textContent.includes('Added')), 'The added message is missing.');
      jarvis.destroy();
      eq(root.childElementCount, 0);
      eq(drawer.getJarvis(), null);
      eq(document.body.classList.contains('is-scroll-locked'), false);
    });
  });

  /* ======================================================================
     HOME
     ====================================================================== */
  suite('Home screen (js/modules/home.js)', ({ test, before, after }) => {
    const mounted = [];
    let today;
    before(async () => {
      await resetDb();
      await repo.initRepo();
      const config = await ucfg.loadUserConfig();
      today = cal.todayKey(ucfg.getEffectiveTimezone(config));
      router.setModuleRegistry(await fetchJson('data/modules.json'));
      await workspace.loadWorkspaceData();
    });
    after(() => {
      for (const item of mounted.splice(0)) { item.stop(); }
      router.clearModuleRegistry();
    });
    async function mountHome(signal) {
      const root = document.createElement('div');
      document.body.append(root);
      const controller = new AbortController();
      if (signal) { controller.abort(); }
      const cleanup = await home.render({ root, signal: controller.signal, navigate() {}, path: '/home', segments: [], query: new URLSearchParams(), setTitle() {} });
      const item = { root, stop() { controller.abort(); if (typeof cleanup === 'function') { cleanup(); } root.remove(); } };
      mounted.push(item);
      return item;
    }
    const stats = (root, id) => Object.fromEntries(Array.from(root.querySelectorAll('[data-widget="' + id + '"] .stat')).map((stat) => [stat.querySelector('.stat__label').textContent, stat.querySelector('.stat__value').textContent]));
    test('shows the cards chosen for the role, with real empty states', async () => {
      const expected = (await workspace.getWorkspace()).widgets.map((widget) => widget.id);
      const item = await mountHome();
      await waitFor(() => item.root.textContent.includes('Set your weather place'), 'the weather prompt');
      deepEq(Array.from(item.root.querySelectorAll('[data-widget]')).map((element) => element.getAttribute('data-widget')), expected);
      assert(['Good morning', 'Good afternoon', 'Good evening', 'Hello'].includes(item.root.querySelector('[data-greeting]').textContent), 'The greeting is not one of the expected phrases.');
      assert(/\d/.test(item.root.querySelector('[data-clock-time]').textContent), 'The clock must show a time.');
      assert(/\d{4}/.test(item.root.querySelector('[data-clock-date]').textContent), 'The date must show a year.');
      await waitFor(() => item.root.textContent.includes('No lessons yet') && item.root.textContent.includes('No reminders due'), 'the empty states');
      assert(item.root.querySelector('[data-qa="jarvis"]'), 'The Ask JARVIS quick action is missing.');
      assert(item.root.querySelector('[aria-disabled="true"]'), 'Modules that do not exist yet must show as coming soon.');
      item.stop();
    });
    test('coming-soon tiles and the ask bar explain themselves', async () => {
      const item = await mountHome();
      await waitFor(() => item.root.querySelector('[data-qa="soon"]'), 'a coming-soon tile');
      const messages = [];
      const stop = ev.on(cfg.EVENTS.TOAST, (payload) => { messages.push(payload.message); });
      try {
        item.root.querySelector('[data-qa="soon"]').click();
        assert(messages.some((message) => message.includes('coming soon')), 'A coming-soon message was expected: ' + messages.join(' | '));
        const form = item.root.querySelector('[data-ask-form]');
        form.elements.ask.value = 'hi there';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        assert(messages.some((message) => message.includes('JARVIS is not available')), 'The ask bar must explain that JARVIS is not mounted: ' + messages.join(' | '));
        eq(form.elements.ask.value, '');
      } finally { stop(); }
      item.stop();
    });
    test('counts come from real records and refresh when records are saved', async () => {
      await ucfg.updateUserConfig({ role: 'safety_officer' });
      await repo.create(S.OBSERVATIONS, { date: today, status: 'OPEN', description: 'Obs today' });
      await repo.create(S.OBSERVATIONS, { date: '2000-01-01', status: 'OPEN', description: 'Old' });
      await repo.create(S.ACTIONS, { description: 'Fix guard', status: 'OPEN', target_date: '2000-01-01' });
      await repo.create(S.ACTIONS, { description: 'Future task', status: 'OPEN', target_date: cal.addDays(today, 30) });
      await repo.create(S.ACTIONS, { description: 'Done task', status: 'CLOSED', target_date: '2000-01-01' });
      const item = await mountHome();
      await waitFor(() => stats(item.root, 'today_summary').Observations === '1', 'today\'s observation count');
      const actions = await (async () => { await waitFor(() => stats(item.root, 'open_actions').Open === '2', 'the open action count'); return stats(item.root, 'open_actions'); })();
      eq(actions.Overdue, '1');
      eq(actions['Due in 7 days'], '0');
      const list = item.root.querySelector('[data-widget="open_actions"]').textContent;
      assert(list.includes('Fix guard') && list.includes('Future task') && !list.includes('Done task'), 'Only open actions may be listed.');
      await repo.create(S.OBSERVATIONS, { date: today, status: 'OPEN', description: 'Second' });
      await waitFor(() => stats(item.root, 'today_summary').Observations === '2', 'the refreshed count');
      item.stop();
    });
    test('reminders due soon are listed', async () => {
      await ucfg.updateUserConfig({ role: 'beginner_learner' });
      await repo.create(S.REMINDERS, { title: 'Check fire extinguisher', status: 'pending', due_at: new Date().toISOString() });
      const item = await mountHome();
      await waitFor(() => item.root.querySelector('[data-widget="reminders"]').textContent.includes('Check fire extinguisher'), 'the reminder');
      item.stop();
    });
    test('a cancelled view draws nothing, cleanup can run twice, a failing layout shows a retry', async () => {
      const cancelled = await mountHome(true);
      eq(cancelled.root.childElementCount, 0);
      const item = await mountHome();
      item.stop();
      item.stop();
      const cap = captureConsole();
      try {
        workspace.clearWorkspaceData();
        const failed = await withFetch(NETWORK_DOWN, () => mountHome());
        assert(failed.root.textContent.includes('Home could not be loaded'), 'A clear error message is required.');
        assert(failed.root.querySelector('[data-act="retry"]'), 'The retry button is missing.');
        failed.stop();
      } finally {
        cap.restore();
        await workspace.loadWorkspaceData();
      }
    });
  });
}