/**
 * NASUR – Adaptive Workspace Resolver
 * File: js/services/workspace.js
 *
 * Works out which Home widgets and quick actions a person sees, by combining
 * ROLE + INDUSTRY + EXPERIENCE + their own preferences (Addendum 2).
 * The widgets, quick actions and every preset live in
 * data/workspaces/base.json; this file only loads, checks and applies them.
 *
 * HOW A LAYOUT IS BUILT (resolution order, later layers win)
 *   base  ->  role  ->  industry  ->  experience band  ->  the person's own layout
 *   Each layer is an "overlay" with these optional operations, applied in this
 *   order inside one overlay: show, hide, order, sizes, quick_actions,
 *   quick_actions_add, options. The meaning of each is written in the data file.
 *   The person's own overlay is applied last, so manual customization always
 *   wins and nothing is ever locked. Nothing is hidden from a junior level
 *   except dashboard cards, and every card stays available to show again.
 *
 * STRICT DATA, FORGIVING USER LAYOUTS
 *   The shipped data file is checked strictly: any mistake fails with a clear
 *   "NASUR workspace data: ..." message. A person's saved layout is cleaned
 *   instead: unknown widgets, bad sizes or bad option values are dropped and
 *   reported in `userOverlayProblems`, and the rest still applies.
 *
 * STORAGE
 *   The person's own overlay is one record in the "workspace_profiles" store
 *   with the id "home_overlay" (field `overlay`). Experience years come from
 *   the first record of "career_profile" (field `experience_years`, written
 *   by the career screen in Phase 3). Role and industry come from the user
 *   configuration.
 *
 * Quick actions that point at modules which are not available yet are marked
 * `available: false` by describeQuickAction(), so Home can show "coming soon"
 * instead of a broken link.
 */

import { STORES } from '../core/config.js';
import { getModule, hrefFor } from '../core/router.js';
import { getUserConfig } from './config.js';
import * as repo from './repo.js';


/* ==========================================================================
   1. CONSTANTS, ERROR TYPE AND SMALL HELPERS
   ========================================================================== */

/** Id of the record that holds the person's own layout. */
export const USER_OVERLAY_ID = 'home_overlay';

const DATA_URL = new URL('../../data/workspaces/base.json', import.meta.url).href;
const SIZES = Object.freeze(['full', 'half']);
const OVERLAY_KEYS = Object.freeze(['title', 'show', 'hide', 'order', 'sizes', 'quick_actions', 'quick_actions_add', 'options']);
const RESOLUTION_ORDER = Object.freeze(['base', 'role', 'industry', 'experience', 'user']);
const OPTION_TYPES = Object.freeze(['boolean', 'integer', 'choice']);
const ACTION_KINDS = Object.freeze(['module', 'jarvis']);
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const SEGMENT_PATTERN = /^[a-z0-9-]+$/;

/** Thrown when a person's layout cannot be saved. `problems` lists every issue. */
export class WorkspaceError extends Error {
  constructor(code, message, problems) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.problems = Array.isArray(problems) ? problems : [];
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function shortText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const shown = text === undefined ? 'undefined' : text;
  return shown.length > 30 ? shown.slice(0, 30) + '…' : shown;
}

function dataFail(message) {
  throw new Error('NASUR workspace data: ' + message);
}


/* ==========================================================================
   2. OPTION VALUES
   ========================================================================== */

/** Checks one option value against its definition. Returns { ok, value }. */
function checkOptionValue(spec, value) {
  if (spec.type === 'boolean') {
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  }
  if (spec.type === 'integer') {
    return Number.isInteger(value) && value >= spec.min && value <= spec.max ? { ok: true, value } : { ok: false };
  }
  return typeof value === 'string' && spec.values.includes(value) ? { ok: true, value } : { ok: false };
}

function checkOptionSpec(widgetId, name, spec) {
  const where = 'widget "' + widgetId + '" option "' + name + '"';
  if (!ID_PATTERN.test(name)) {
    dataFail(where + ' has an invalid name.');
  }
  if (!isPlainObject(spec) || !isText(spec.label)) {
    dataFail(where + ' needs a label.');
  }
  if (!OPTION_TYPES.includes(spec.type)) {
    dataFail(where + ' has an unknown type.');
  }
  if (spec.type === 'integer') {
    if (!Number.isInteger(spec.min) || !Number.isInteger(spec.max) || spec.min > spec.max) {
      dataFail(where + ' needs whole-number min and max values.');
    }
  }
  if (spec.type === 'choice') {
    if (!Array.isArray(spec.values) || spec.values.length < 2 || !spec.values.every(isText)) {
      dataFail(where + ' needs a list of at least two values.');
    }
    if (spec.labels !== undefined && (!Array.isArray(spec.labels) || spec.labels.length !== spec.values.length || !spec.labels.every(isText))) {
      dataFail(where + ' has labels that do not match its values.');
    }
  }
  if (!checkOptionValue(spec, spec.default).ok) {
    dataFail(where + ' has a default that does not fit its type.');
  }
}


/* ==========================================================================
   3. OVERLAYS
   ========================================================================== */

/** Keeps the known ids of a list (no repeats) and notes the problems. */
function cleanIdList(value, label, known, problems) {
  if (!Array.isArray(value)) {
    problems.push(label + ' must be a list.');
    return [];
  }
  const kept = [];
  for (const id of value) {
    if (typeof id !== 'string' || !known.has(id)) {
      problems.push(label + ' has an unknown item "' + shortText(id) + '".');
    } else if (!kept.includes(id)) {
      kept.push(id);
    }
  }
  return kept;
}

/**
 * Cleans one overlay. Returns { overlay, problems }: `overlay` holds only the
 * valid parts, `problems` lists everything that was dropped or wrong.
 */
function cleanOverlay(raw, context) {
  const overlay = {};
  const problems = [];
  if (raw === undefined || raw === null) {
    return { overlay, problems };
  }
  if (!isPlainObject(raw)) {
    return { overlay, problems: ['The layout must be an object.'] };
  }

  for (const key of Object.keys(raw)) {
    if (!OVERLAY_KEYS.includes(key)) {
      problems.push('Unknown setting "' + key + '".');
    }
  }
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    problems.push('title must be text.');
  }

  for (const key of ['show', 'hide', 'order']) {
    if (raw[key] !== undefined) {
      overlay[key] = cleanIdList(raw[key], key, context.widgets, problems);
    }
  }

  if (raw.sizes !== undefined) {
    overlay.sizes = {};
    if (!isPlainObject(raw.sizes)) {
      problems.push('sizes must be an object.');
    } else {
      for (const id of Object.keys(raw.sizes)) {
        const widget = context.widgets.get(id);
        if (!widget) {
          problems.push('sizes has an unknown widget "' + shortText(id) + '".');
        } else if (typeof raw.sizes[id] !== 'string' || !widget.sizes.includes(raw.sizes[id])) {
          problems.push('The size "' + shortText(raw.sizes[id]) + '" is not allowed for "' + id + '".');
        } else {
          overlay.sizes[id] = raw.sizes[id];
        }
      }
    }
  }

  if (raw.quick_actions !== undefined) {
    let list = cleanIdList(raw.quick_actions, 'quick_actions', context.actions, problems);
    if (list.length < context.min) {
      problems.push('quick_actions needs at least ' + context.min + ' action.');
    } else {
      if (list.length > context.max) {
        problems.push('quick_actions allows at most ' + context.max + ' actions.');
        list = list.slice(0, context.max);
      }
      overlay.quick_actions = list;
    }
  }

  if (raw.quick_actions_add !== undefined) {
    overlay.quick_actions_add = cleanIdList(raw.quick_actions_add, 'quick_actions_add', context.actions, problems);
  }

  if (raw.options !== undefined) {
    overlay.options = {};
    if (!isPlainObject(raw.options)) {
      problems.push('options must be an object.');
    } else {
      for (const id of Object.keys(raw.options)) {
        const widget = context.widgets.get(id);
        if (!widget) {
          problems.push('options has an unknown widget "' + shortText(id) + '".');
        } else if (!isPlainObject(raw.options[id])) {
          problems.push('The options of "' + id + '" must be an object.');
        } else {
          for (const name of Object.keys(raw.options[id])) {
            const spec = has(widget.options, name) ? widget.options[name] : null;
            const result = spec === null ? { ok: false } : checkOptionValue(spec, raw.options[id][name]);
            if (!result.ok) {
              problems.push('The option "' + shortText(name) + '" of "' + id + '" is not valid.');
            } else {
              overlay.options[id] = overlay.options[id] || {};
              overlay.options[id][name] = result.value;
            }
          }
        }
      }
    }
  }
  return { overlay, problems };
}

/** Applies a cleaned overlay to the working state. */
function applyOverlay(state, overlay, context) {
  if (overlay.show) {
    for (const id of overlay.show) {
      if (!state.visible.includes(id)) {
        state.visible.push(id);
      }
    }
  }
  if (overlay.hide) {
    state.visible = state.visible.filter((id) => !overlay.hide.includes(id));
  }
  if (overlay.order) {
    const front = overlay.order.filter((id) => state.visible.includes(id));
    state.visible = front.concat(state.visible.filter((id) => !front.includes(id)));
  }
  if (overlay.sizes) {
    Object.assign(state.sizes, overlay.sizes);
  }
  if (overlay.quick_actions) {
    state.quickActions = overlay.quick_actions.slice();
  }
  if (overlay.quick_actions_add) {
    for (const id of overlay.quick_actions_add) {
      if (!state.quickActions.includes(id) && state.quickActions.length < context.max) {
        state.quickActions.push(id);
      }
    }
  }
  if (overlay.options) {
    for (const id of Object.keys(overlay.options)) {
      state.options[id] = { ...state.options[id], ...overlay.options[id] };
    }
  }
}


/* ==========================================================================
   4. CHECKING THE DATA FILE
   ========================================================================== */

const compiled = new WeakMap();

/** Checks the data and builds the lookup tables. Throws a readable Error. Cached per data object. */
function compile(data) {
  if (isPlainObject(data) && compiled.has(data)) {
    return compiled.get(data);
  }
  if (!isPlainObject(data)) {
    dataFail('the file must contain an object.');
  }
  if (data.schema_version !== 1) {
    dataFail('schema_version must be 1.');
  }
  if (JSON.stringify(data.resolution_order) !== JSON.stringify(RESOLUTION_ORDER)) {
    dataFail('resolution_order must be ' + RESOLUTION_ORDER.join(', ') + '.');
  }
  if (!isPlainObject(data.limits) || !Number.isInteger(data.limits.quick_actions_min) || !Number.isInteger(data.limits.quick_actions_max)
    || data.limits.quick_actions_min < 1 || data.limits.quick_actions_max < data.limits.quick_actions_min) {
    dataFail('limits must give a quick_actions_min of 1 or more and a larger or equal quick_actions_max.');
  }
  for (const key of ['widgets', 'quick_action_catalog', 'experience_bands']) {
    if (!Array.isArray(data[key]) || data[key].length === 0) {
      dataFail('"' + key + '" must be a list with at least one entry.');
    }
  }
  for (const key of ['base', 'roles', 'industries', 'experience']) {
    if (!isPlainObject(data[key])) {
      dataFail('"' + key + '" must be an object.');
    }
  }

  const widgets = new Map();
  for (const widget of data.widgets) {
    if (!isPlainObject(widget) || typeof widget.id !== 'string' || !ID_PATTERN.test(widget.id)) {
      dataFail('every widget needs an id such as "open_actions".');
    }
    if (widgets.has(widget.id)) {
      dataFail('duplicate widget id "' + widget.id + '".');
    }
    const where = 'widget "' + widget.id + '"';
    if (!isText(widget.title) || !isText(widget.description) || !isText(widget.icon)) {
      dataFail(where + ' needs a title, description and icon.');
    }
    if (widget.module !== null && !(typeof widget.module === 'string' && ID_PATTERN.test(widget.module))) {
      dataFail(where + ' must have a module id or null.');
    }
    if (!Array.isArray(widget.sizes) || widget.sizes.length === 0 || !widget.sizes.every((size) => SIZES.includes(size))
      || new Set(widget.sizes).size !== widget.sizes.length) {
      dataFail(where + ' needs sizes chosen from: ' + SIZES.join(', ') + '.');
    }
    if (!widget.sizes.includes(widget.default_size)) {
      dataFail(where + ' has a default_size that is not one of its sizes.');
    }
    if (!isPlainObject(widget.options) || !isPlainObject(widget.data)) {
      dataFail(where + ' needs "options" and "data" objects.');
    }
    for (const name of Object.keys(widget.options)) {
      checkOptionSpec(widget.id, name, widget.options[name]);
    }
    widgets.set(widget.id, widget);
  }

  const actions = new Map();
  for (const action of data.quick_action_catalog) {
    if (!isPlainObject(action) || typeof action.id !== 'string' || !ID_PATTERN.test(action.id)) {
      dataFail('every quick action needs an id such as "new_observation".');
    }
    if (actions.has(action.id)) {
      dataFail('duplicate quick action id "' + action.id + '".');
    }
    const where = 'quick action "' + action.id + '"';
    if (!isText(action.label) || !isText(action.icon)) {
      dataFail(where + ' needs a label and an icon.');
    }
    if (!ACTION_KINDS.includes(action.kind)) {
      dataFail(where + ' must have the kind "module" or "jarvis".');
    }
    if (action.kind === 'module' && !(typeof action.module === 'string' && ID_PATTERN.test(action.module))) {
      dataFail(where + ' needs a module id.');
    }
    if (action.kind === 'jarvis' && action.module !== null) {
      dataFail(where + ' must have module set to null.');
    }
    if (!Array.isArray(action.segments) || !action.segments.every((part) => typeof part === 'string' && SEGMENT_PATTERN.test(part))) {
      dataFail(where + ' needs segments made of lowercase letters, digits and hyphens.');
    }
    actions.set(action.id, action);
  }

  const bands = data.experience_bands;
  const bandIds = new Set();
  bands.forEach((band, position) => {
    if (!isPlainObject(band) || typeof band.id !== 'string' || !ID_PATTERN.test(band.id) || !isText(band.title)
      || !Number.isFinite(band.min_years) || band.min_years < 0) {
      dataFail('every experience band needs an id, a title and a min_years of 0 or more.');
    }
    if (bandIds.has(band.id)) {
      dataFail('duplicate experience band "' + band.id + '".');
    }
    bandIds.add(band.id);
    if (position === 0 && band.min_years !== 0) {
      dataFail('the first experience band must start at 0 years.');
    }
    if (position > 0 && band.min_years <= bands[position - 1].min_years) {
      dataFail('experience bands must be listed from fewest to most years.');
    }
  });
  if (data.experience_unknown !== 'none') {
    dataFail('experience_unknown must be "none".');
  }
  const experienceKeys = Object.keys(data.experience);
  if (experienceKeys.length !== bandIds.size || !experienceKeys.every((key) => bandIds.has(key))) {
    dataFail('"experience" must have exactly one entry for each experience band.');
  }

  const context = { widgets, actions, min: data.limits.quick_actions_min, max: data.limits.quick_actions_max };

  const layers = [['base', data.base]];
  for (const section of ['roles', 'industries', 'experience']) {
    for (const key of Object.keys(data[section])) {
      if (section !== 'experience' && !ID_PATTERN.test(key)) {
        dataFail('"' + section + '" has an invalid id "' + key + '".');
      }
      layers.push([section + '.' + key, data[section][key]]);
    }
  }
  for (const [name, overlay] of layers) {
    const result = cleanOverlay(overlay, context);
    if (result.problems.length > 0) {
      dataFail('layer "' + name + '": ' + result.problems[0]);
    }
  }
  if (!Array.isArray(data.base.show) || data.base.show.length === 0 || !Array.isArray(data.base.quick_actions)) {
    dataFail('the base layout must list the widgets to show and the quick actions.');
  }

  compiled.set(data, context);
  return context;
}

/** Checks workspace data. Returns true or throws an Error that starts with "NASUR workspace data:". */
export function validateWorkspaceData(data) {
  compile(data);
  return true;
}


/* ==========================================================================
   5. LOADING THE DATA FILE
   ========================================================================== */

let workspaceData = null;
let loadPromise = null;

/** Validates and stores workspace data (used by loadWorkspaceData and by tests). */
export function setWorkspaceData(data) {
  compile(data);
  workspaceData = copy(data);
  return workspaceData;
}

/** Forgets the loaded data (used by tests). */
export function clearWorkspaceData() {
  workspaceData = null;
  loadPromise = null;
}

/** The loaded data, or null before it has loaded. Do not change it. */
export function getWorkspaceData() {
  return workspaceData;
}

/** Loads data/workspaces/base.json once (pass { force: true } to load again). */
export function loadWorkspaceData(options = {}) {
  const force = Boolean(options && options.force);
  if (workspaceData !== null && !force) {
    return Promise.resolve(workspaceData);
  }
  if (loadPromise !== null && !force) {
    return loadPromise;
  }

  const attempt = (async () => {
    let response;
    try {
      response = await fetch(DATA_URL);
    } catch (error) {
      throw new Error('NASUR could not load its workspace layout (data/workspaces/base.json). Check your connection and reload.', { cause: error });
    }
    if (!response.ok) {
      throw new Error('NASUR could not load its workspace layout (data/workspaces/base.json, status ' + response.status + '). Check that the file was uploaded.');
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('NASUR could not read its workspace layout. data/workspaces/base.json is not valid JSON.', { cause: error });
    }
    return setWorkspaceData(data);
  })();

  loadPromise = attempt;
  const clear = () => {
    if (loadPromise === attempt) {
      loadPromise = null;
    }
  };
  attempt.then(clear, clear);
  return attempt;
}


/* ==========================================================================
   6. RESOLVING A LAYOUT
   ========================================================================== */

/** The experience band id for a number of years, or null when the years are unknown. */
export function experienceBandFor(data, years) {
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0) {
    return null;
  }
  let found = null;
  for (const band of data.experience_bands) {
    if (years >= band.min_years) {
      found = band.id;
    }
  }
  return found;
}

/**
 * Builds the layout. Pure: it reads nothing but its arguments.
 * inputs: { role, industry, experienceYears, userOverlay }  (all optional)
 * Returns:
 *   widgets        visible widgets in order: { id, title, description, icon,
 *                  module, size, options, data }
 *   hidden         ids of widgets that are not shown
 *   quickActions   quick actions in order: { id, label, icon, kind, module, segments }
 *   layers         the layers that were applied, e.g.
 *                  ["base", "role:safety_officer", "industry:construction",
 *                   "experience:developing", "user"]
 *   inputs         { role, industry, experience_band } that were used
 *   userOverlayProblems  things dropped from the person's own layout
 * The result is a copy; changing it never changes the data.
 */
export function resolveWorkspace(data, inputs = {}) {
  const context = compile(data);
  const settings = isPlainObject(inputs) ? inputs : {};

  const state = { visible: [], sizes: {}, options: {}, quickActions: [] };
  for (const widget of data.widgets) {
    state.sizes[widget.id] = widget.default_size;
    state.options[widget.id] = {};
    for (const name of Object.keys(widget.options)) {
      state.options[widget.id][name] = widget.options[name].default;
    }
  }

  const layers = [];
  const apply = (label, raw) => {
    const result = cleanOverlay(raw, context);
    applyOverlay(state, result.overlay, context);
    layers.push(label);
    return result.problems;
  };

  apply('base', data.base);

  const role = typeof settings.role === 'string' && has(data.roles, settings.role) ? settings.role : null;
  if (role !== null) {
    apply('role:' + role, data.roles[role]);
  }
  const industry = typeof settings.industry === 'string' && has(data.industries, settings.industry) ? settings.industry : null;
  if (industry !== null) {
    apply('industry:' + industry, data.industries[industry]);
  }
  const band = experienceBandFor(data, settings.experienceYears);
  if (band !== null) {
    apply('experience:' + band, data.experience[band]);
  }

  let userOverlayProblems = [];
  if (settings.userOverlay !== undefined && settings.userOverlay !== null) {
    userOverlayProblems = apply('user', settings.userOverlay);
  }

  const widgets = state.visible.map((id) => {
    const definition = context.widgets.get(id);
    return copy({
      id,
      title: definition.title,
      description: definition.description,
      icon: definition.icon,
      module: definition.module,
      size: state.sizes[id],
      options: state.options[id],
      data: definition.data
    });
  });

  return {
    widgets,
    hidden: data.widgets.map((widget) => widget.id).filter((id) => !state.visible.includes(id)),
    quickActions: state.quickActions.map((id) => copy(context.actions.get(id))),
    layers,
    inputs: { role, industry, experience_band: band },
    userOverlayProblems
  };
}


/* ==========================================================================
   7. QUICK ACTIONS FOR THE SCREEN
   ========================================================================== */

/**
 * Adds `available` and `href` to a quick action (from resolveWorkspace).
 *   kind "jarvis"  available, no href (the button opens the JARVIS drawer)
 *   kind "module"  available only when that module is active in the module
 *                  list (data/modules.json); then `href` is its link
 * Needs the module registry to be loaded (the app loads it at start-up).
 */
export function describeQuickAction(action) {
  if (action.kind === 'jarvis') {
    return { ...action, available: true, href: null };
  }
  const mod = getModule(action.module);
  if (!mod || mod.status !== 'active') {
    return { ...action, available: false, href: null };
  }
  return { ...action, available: true, href: hrefFor(action.module, action.segments) };
}

/** Same as describeQuickAction for a whole list. */
export function describeQuickActions(actions) {
  return actions.map(describeQuickAction);
}


/* ==========================================================================
   8. INPUTS AND THE PERSON'S OWN LAYOUT
   ========================================================================== */

/** The person's saved overlay, or null when they have not customized anything. */
export async function getUserOverlay() {
  const record = await repo.get(STORES.WORKSPACE_PROFILES, USER_OVERLAY_ID);
  return record !== null && isPlainObject(record.overlay) ? record.overlay : null;
}

/**
 * Saves the person's own layout (cleaned and checked first). Rejects with
 * WorkspaceError "invalid_overlay" (see `error.problems`) and saves nothing
 * if any part is not valid. Resolves with the saved overlay.
 */
export async function saveUserOverlay(overlay) {
  const data = await loadWorkspaceData();
  const result = cleanOverlay(overlay, compile(data));
  if (result.problems.length > 0) {
    throw new WorkspaceError('invalid_overlay', result.problems[0], result.problems);
  }
  await repo.save(STORES.WORKSPACE_PROFILES, { id: USER_OVERLAY_ID, overlay: result.overlay });
  return copy(result.overlay);
}

/** Removes the person's customization, so the role, industry and experience layout applies again. */
export async function clearUserOverlay() {
  await repo.save(STORES.WORKSPACE_PROFILES, { id: USER_OVERLAY_ID, overlay: {} });
}

/**
 * Reads { role, industry, experienceYears } from the user configuration and
 * the career profile. experienceYears is null when it has not been entered.
 */
export async function getWorkspaceInputs() {
  const config = await getUserConfig();
  const profiles = await repo.list(STORES.CAREER_PROFILE, { limit: 1 });
  const years = profiles.length > 0 ? profiles[0].experience_years : null;
  return {
    role: config.role,
    industry: config.industry,
    experienceYears: typeof years === 'number' && Number.isFinite(years) && years >= 0 ? years : null
  };
}

/**
 * The layout for the current person: loads the data, the settings and the
 * person's own overlay, then resolves them. Any input can be replaced by
 * passing it in `overrides` (for example to preview another role).
 */
export async function getWorkspace(overrides = {}) {
  const data = await loadWorkspaceData();
  const inputs = await getWorkspaceInputs();
  const userOverlay = await getUserOverlay();
  const extra = isPlainObject(overrides) ? overrides : {};
  return resolveWorkspace(data, {
    role: extra.role !== undefined ? extra.role : inputs.role,
    industry: extra.industry !== undefined ? extra.industry : inputs.industry,
    experienceYears: extra.experienceYears !== undefined ? extra.experienceYears : inputs.experienceYears,
    userOverlay: extra.userOverlay !== undefined ? extra.userOverlay : userOverlay
  });
}