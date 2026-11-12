/**
 * NASUR – Heat Stress Guidance (advisory only)
 * File: js/services/heat.js
 *
 * Turns a weather reading (temperature, humidity and, when available, the
 * weather service's own "feels like" value) into a "feels like" figure, a heat
 * level and short general guidance. This file only does the calculation and
 * holds the text. js/services/weather.js supplies the readings and the Home
 * screen shows the result.
 *
 * IMPORTANT LIMITS (also shown to the user through `disclaimer` and `notes`)
 *   - This is general weather-based awareness. It is NOT a site risk
 *     assessment, a WBGT measurement or a legal limit, and it never replaces
 *     the site's heat stress plan, procedures or local rules. It is kept
 *     separate from all formal risk records on purpose.
 *   - The level bands follow the commonly used heat index categories, which
 *     assume shade and light activity. Direct sun, heavy work, protective
 *     clothing or still air make the real risk higher than the level shown.
 *   - No work/rest ratios or stop-work temperatures are given, because they
 *     depend on the site plan, acclimatization and local rules.
 *
 * FEELS LIKE
 *   The highest of: the air temperature, the weather service's "apparent
 *   temperature" (when given) and the heat index calculated here from
 *   temperature and humidity (NWS Rothfusz formula, when humidity is given).
 *   Taking the highest is deliberately cautious. Wind cooling is ignored.
 *
 * Temperatures are in degrees Celsius unless a name says otherwise. This file
 * has no imports and never touches the browser, the network or the clock.
 * Wording is English for now; translations come with the language engine
 * (Phase 9), which is why every level and action has a stable id.
 */


/* ==========================================================================
   1. CONSTANTS AND TEXT
   ========================================================================== */

const MIN_TEMP_C = -90;
const MAX_TEMP_C = 70;

export const HEAT_DISCLAIMER = 'Advisory only. This is based on the weather, not on a site risk assessment. It does not replace your site heat stress plan, procedures or local rules.';

const BASIS_NOTE = 'Levels use commonly used heat index bands for shade and light activity. Sun, heavy work, protective clothing or still air make the real risk higher.';

const UV_NOTE = 'The UV index is high. Use shade, cover up and wear sun protection when working outdoors.';

/**
 * Heat levels, lowest to highest. `minF` is the lowest "feels like"
 * temperature in Fahrenheit that belongs to the level (the original published
 * bands are in Fahrenheit). `riskBadge` is the matching data-level value of
 * the .risk-badge component in css/components.css.
 */
export const HEAT_LEVELS = Object.freeze([
  Object.freeze({
    id: 'low',
    order: 1,
    title: 'Low',
    riskBadge: 'low',
    minF: -Infinity,
    summary: 'The weather alone is not a high heat risk. Keep drinking water and watch for changes during the day.',
    actions: Object.freeze([
      'Drink water regularly, even if you do not feel thirsty.',
      'Wear light, breathable clothing and sun protection outdoors.'
    ])
  }),
  Object.freeze({
    id: 'caution',
    order: 2,
    title: 'Caution',
    riskBadge: 'medium',
    minF: 80,
    summary: 'Tiredness is possible with long exposure or hard physical work.',
    actions: Object.freeze([
      'Drink water often and take short breaks in shade or a cool place.',
      'Watch yourself and others for tiredness, headache or dizziness.',
      'New workers and people returning after a break need time to get used to the heat.'
    ])
  }),
  Object.freeze({
    id: 'high',
    order: 3,
    title: 'High',
    riskBadge: 'high',
    minF: 90,
    summary: 'Heat cramps and heat exhaustion are possible with continued exposure or hard work.',
    actions: Object.freeze([
      'Plan heavy or long outdoor tasks for cooler hours where possible.',
      'Provide shade, cool drinking water and more frequent rest breaks.',
      'Use a buddy system so people watch each other for signs of heat illness.',
      'Follow your site heat stress plan and local rules.'
    ])
  }),
  Object.freeze({
    id: 'danger',
    order: 4,
    title: 'Danger',
    riskBadge: 'extreme',
    minF: 103,
    summary: 'Heat exhaustion is likely and heat stroke is possible with continued exposure.',
    actions: Object.freeze([
      'Treat heat as a serious hazard. Follow your site heat stress plan and local rules.',
      'Limit heavy work, rest often in shade or a cool area, and keep drinking water available at all times.',
      'Check on each other often. Anyone with symptoms stops work and cools down.',
      'Tell your supervisor, who decides whether work is changed, delayed or stopped.'
    ])
  }),
  Object.freeze({
    id: 'extreme',
    order: 5,
    title: 'Extreme danger',
    riskBadge: 'extreme',
    minF: 125,
    summary: 'Heat stroke is highly likely with exposure.',
    actions: Object.freeze([
      'Do not start outdoor work without the approval of the responsible person and your site heat controls.',
      'Follow your site stop-work and emergency rules.',
      'Keep emergency contact numbers ready and make sure cooling and water are available.',
      'Anyone showing symptoms needs urgent attention.'
    ])
  })
]);

/** Signs of heat illness, for guidance screens and Toolbox Talks. */
export const HEAT_ILLNESS_SIGNS = Object.freeze({
  exhaustion: Object.freeze([
    'Heavy sweating',
    'Weakness or tiredness',
    'Dizziness or headache',
    'Nausea',
    'Cool, damp skin'
  ]),
  stroke: Object.freeze([
    'Confusion or strange behaviour',
    'Fainting or collapse',
    'Very hot skin (dry or damp)',
    'Seizures',
    'No improvement after resting and cooling'
  ]),
  note: 'Heat stroke is a medical emergency. Call your site emergency number, move the person to a cool place and start cooling them while help comes.'
});

const UNKNOWN_SUMMARY = 'Temperature is not available, so heat guidance cannot be shown. Use your own judgement and your site procedures.';


/* ==========================================================================
   2. UNIT CONVERSION AND DISPLAY
   ========================================================================== */

export function celsiusToFahrenheit(celsius) {
  return celsius * 9 / 5 + 32;
}

export function fahrenheitToCelsius(fahrenheit) {
  return (fahrenheit - 32) * 5 / 9;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Shows a Celsius value in the user's units: "36°C" or, for units "imperial",
 * "97°F". Returns "–" when the value is missing or not a number.
 * options: { decimals: 0 } (default 0)
 */
export function formatTemperature(valueC, units = 'metric', options = {}) {
  if (typeof valueC !== 'number' || !Number.isFinite(valueC)) {
    return '–';
  }
  const decimals = options && Number.isInteger(options.decimals) && options.decimals >= 0 && options.decimals <= 2
    ? options.decimals
    : 0;
  if (units === 'imperial') {
    return roundTo(celsiusToFahrenheit(valueC), decimals).toFixed(decimals) + '°F';
  }
  return roundTo(valueC, decimals).toFixed(decimals) + '°C';
}


/* ==========================================================================
   3. INPUT CHECKING
   ========================================================================== */

/** Returns the temperature when it is a believable number, otherwise null. */
function validTemp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_TEMP_C && value <= MAX_TEMP_C
    ? value
    : null;
}

/** Returns the relative humidity (0 to 100) when valid, otherwise null. */
function validHumidity(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}


/* ==========================================================================
   4. HEAT INDEX
   ========================================================================== */

/**
 * The heat index in Celsius (NWS Rothfusz regression with its published
 * adjustments), or null when temperature or humidity is missing or not
 * believable. The result is never lower than the air temperature. In cool
 * weather the heat index is not meaningful and the temperature is returned.
 */
export function heatIndexC(tempC, humidity) {
  const celsius = validTemp(tempC);
  const rh = validHumidity(humidity);
  if (celsius === null || rh === null) {
    return null;
  }

  const t = celsiusToFahrenheit(celsius);
  let index = 0.5 * (t + 61.0 + ((t - 68.0) * 1.2) + (rh * 0.094));

  if ((index + t) / 2 >= 80) {
    index = -42.379
      + 2.04901523 * t
      + 10.14333127 * rh
      - 0.22475541 * t * rh
      - 0.00683783 * t * t
      - 0.05481717 * rh * rh
      + 0.00122874 * t * t * rh
      + 0.00085282 * t * rh * rh
      - 0.00000199 * t * t * rh * rh;

    if (rh < 13 && t >= 80 && t <= 112) {
      index -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (rh > 85 && t >= 80 && t <= 87) {
      index += ((rh - 85) / 10) * ((87 - t) / 5);
    }
  }

  return Math.max(fahrenheitToCelsius(index), celsius);
}

/**
 * The "feels like" value used for the heat level.
 * Input: { tempC, humidity, apparentC } (humidity and apparentC optional).
 * Returns { valueC, source } or null when there is no usable temperature.
 * source: "temperature", "provider" (the weather service's apparent
 * temperature) or "heat_index".
 */
export function feelsLike(input) {
  const data = input !== null && typeof input === 'object' ? input : {};
  const tempC = validTemp(data.tempC);
  if (tempC === null) {
    return null;
  }

  let best = { valueC: tempC, source: 'temperature' };

  const apparentC = validTemp(data.apparentC);
  if (apparentC !== null && apparentC > best.valueC) {
    best = { valueC: apparentC, source: 'provider' };
  }

  const index = heatIndexC(tempC, data.humidity);
  if (index !== null && index > best.valueC) {
    best = { valueC: index, source: 'heat_index' };
  }
  return best;
}


/* ==========================================================================
   5. LEVELS AND ASSESSMENT
   ========================================================================== */

/** One heat level by id ("low", "caution", "high", "danger", "extreme"), or null. */
export function getHeatLevel(id) {
  return HEAT_LEVELS.find((level) => level.id === id) || null;
}

/** The heat level for a "feels like" temperature in Celsius, or null when not a number. */
export function levelForFeelsLikeC(valueC) {
  if (typeof valueC !== 'number' || !Number.isFinite(valueC)) {
    return null;
  }
  const fahrenheit = celsiusToFahrenheit(valueC);
  for (let position = HEAT_LEVELS.length - 1; position >= 0; position -= 1) {
    if (fahrenheit >= HEAT_LEVELS[position].minF) {
      return HEAT_LEVELS[position];
    }
  }
  return HEAT_LEVELS[0];
}

function unknownAssessment() {
  return {
    valid: false,
    level: 'unknown',
    order: 0,
    title: 'Not available',
    riskBadge: null,
    summary: UNKNOWN_SUMMARY,
    actions: [],
    feelsLikeC: null,
    feelsLikeSource: null,
    tempC: null,
    humidity: null,
    notes: [],
    disclaimer: HEAT_DISCLAIMER
  };
}

/**
 * Builds the heat guidance for a weather reading.
 * Input: { tempC, humidity, apparentC, uvIndex } (only tempC is required).
 * Never throws. With no usable temperature it returns valid: false and
 * level "unknown". Otherwise it returns:
 *   { valid: true, level, order, title, riskBadge, summary, actions[],
 *     feelsLikeC (one decimal), feelsLikeSource, tempC, humidity, notes[],
 *     disclaimer }
 * `riskBadge` is the data-level value for the .risk-badge component. The
 * returned arrays are copies and can be changed freely.
 */
export function assessHeat(input) {
  const data = input !== null && typeof input === 'object' ? input : {};
  const feels = feelsLike(data);
  if (feels === null) {
    return unknownAssessment();
  }

  const level = levelForFeelsLikeC(feels.valueC);
  const notes = [BASIS_NOTE];
  if (typeof data.uvIndex === 'number' && Number.isFinite(data.uvIndex) && data.uvIndex >= 6) {
    notes.push(UV_NOTE);
  }

  return {
    valid: true,
    level: level.id,
    order: level.order,
    title: level.title,
    riskBadge: level.riskBadge,
    summary: level.summary,
    actions: level.actions.slice(),
    feelsLikeC: roundTo(feels.valueC, 1),
    feelsLikeSource: feels.source,
    tempC: validTemp(data.tempC),
    humidity: validHumidity(data.humidity),
    notes,
    disclaimer: HEAT_DISCLAIMER
  };
}