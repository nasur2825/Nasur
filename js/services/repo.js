/**
 * NASUR – Repository (record rules on top of db.js)
 * File: js/services/repo.js
 *
 * This is the layer modules should use to read and write records. It adds
 * the rules that db.js deliberately does not know about:
 *
 *   - COMMON FIELDS on every record: id, project_id, created_at, updated_at,
 *     rev (starts at 1, +1 per save), deleted_at, device_id, owner_scope,
 *     pdca_stage. Callers never set the managed ones (id on create is
 *     optional; created_at, updated_at, rev, deleted_at, device_id are
 *     always set by this file).
 *   - PROJECT ISOLATION: records in project-scoped stores can only be read,
 *     changed or deleted inside their own project. Reads and writes use the
 *     active project unless options.projectId is given. Cross-project access
 *     needs options.allProjects = true (used only for authorized analytics).
 *   - SOFT DELETE: remove() sets deleted_at; normal reads hide such records;
 *     restore() brings them back; purge() permanently erases one record.
 *   - SANITIZING: every incoming record passes through sanitizeDeep().
 *   - OPTIMISTIC LOCKING: options.expectedRev makes a write fail with code
 *     "conflict" if the record was changed after the caller loaded it.
 *   - AUDIT TRAIL: create/update/delete/restore/purge write a small entry
 *     (store, record id, action, revision, time, device; never record
 *     content) in the same transaction as the change. This is a convenience
 *     log, not tamper-proof evidence.
 *   - EVENTS: after a change is committed, record:saved or record:deleted
 *     is emitted on the event bus. Treat event payload records as read-only.
 *
 * Options accepted by the functions below (all optional):
 *   projectId     use this project instead of the active one
 *   allProjects   true = skip project isolation (read/write across projects)
 *   includeDeleted  true = also return soft-deleted records (get, list)
 *   expectedRev   write only if the stored record has exactly this rev
 *   list() only:  index, range, direction ('asc'|'desc'), orderBy, limit,
 *                 offset, filter (a function returning true to keep a record)
 *
 * Errors are DbError objects (re-exported from db.js). Codes added here:
 *   no_project, invalid_project, invalid_data, conflict
 * plus the codes from db.js (for example not_found, exists, quota).
 *
 * Updating: update() merges the changes you pass into the stored record
 * (set a field to null to clear it; undefined fields are ignored). save()
 * replaces the stored record with the one you pass (fields you leave out are
 * removed), and creates it if the id does not exist yet.
 */

import {
  DEFAULTS,
  EVENTS,
  LS_KEYS,
  OWNER_SCOPE,
  PDCA_STAGE,
  SCOPE,
  SETTINGS_KEYS,
  STORES,
  getStoreDef,
  isStoreName
} from '../core/config.js';
import {
  DbError,
  get as dbGet,
  getAll as dbGetAll,
  getAllByIndex,
  keyRange,
  query as dbQuery,
  requestToPromise,
  runTransaction
} from './db.js';
import { emit } from '../core/eventbus.js';
import { isSafeId, sanitizeDeep } from './sanitize.js';

export { DbError };


/* ==========================================================================
   1. CONSTANTS AND SMALL HELPERS
   ========================================================================== */

/** Fields owned by this file. Callers cannot set them. */
const MANAGED_FIELDS = Object.freeze(['id', 'created_at', 'updated_at', 'rev', 'deleted_at', 'device_id']);

/** Stores that do not get audit-trail entries (high volume or the log itself). */
const AUDIT_EXCLUDED = new Set([
  STORES.AUDIT_TRAIL,
  STORES.AI_LOG,
  STORES.KNOWLEDGE_CHUNKS,
  STORES.SETTINGS
]);

const OWNER_VALUES = new Set(Object.values(OWNER_SCOPE));
const PDCA_VALUES = new Set(Object.values(PDCA_STAGE));

let activeProjectId = null;
let deviceIdCache = null;

function nowIso() {
  return new Date().toISOString();
}

function notFound(message) {
  return new DbError('not_found', message || 'The record was not found.');
}

function invalidData(message) {
  return new DbError('invalid_data', message);
}

function defOf(storeName) {
  if (!isStoreName(storeName)) {
    throw new DbError('invalid_store', 'Unknown store "' + String(storeName) + '".');
  }
  return getStoreDef(storeName);
}

function assertId(id) {
  if (!isSafeId(id)) {
    throw new DbError('invalid_query', 'A record id must be 1 to 64 letters, digits, underscores or hyphens.');
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Checks that incoming data is a plain object and returns a cleaned copy. */
function cleanInput(data) {
  if (!isPlainObject(data)) {
    throw invalidData('A record must be a plain object.');
  }
  try {
    return sanitizeDeep(data);
  } catch (error) {
    throw new DbError('invalid_data', 'This record contains data that is nested too deeply to save.', error);
  }
}

function stripManaged(clean) {
  const copy = { ...clean };
  for (const key of MANAGED_FIELDS) {
    delete copy[key];
  }
  return copy;
}

function pickOwner(provided, fallback) {
  if (provided === undefined) {
    return fallback;
  }
  if (!OWNER_VALUES.has(provided)) {
    throw invalidData('owner_scope must be "personal", "employer" or "client".');
  }
  return provided;
}

function pickPdca(provided, fallback) {
  if (provided === undefined) {
    return fallback;
  }
  if (provided !== null && !PDCA_VALUES.has(provided)) {
    throw invalidData('pdca_stage must be "plan", "do", "check", "act", "improve" or null.');
  }
  return provided;
}


/* ==========================================================================
   2. IDS AND DEVICE ID
   ========================================================================== */

/** Creates a new random UUID (version 4). */
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

/** Stable id for this browser profile ("dev_" plus 12 characters). */
export function getDeviceId() {
  if (deviceIdCache) {
    return deviceIdCache;
  }
  let id = null;
  try {
    id = localStorage.getItem(LS_KEYS.DEVICE_ID);
  } catch {
    id = null;
  }
  if (!isSafeId(id)) {
    id = 'dev_' + newId().replace(/-/g, '').slice(0, 12);
    try {
      localStorage.setItem(LS_KEYS.DEVICE_ID, id);
    } catch {
      /* storage is blocked; the id lasts until the page is closed */
    }
  }
  deviceIdCache = id;
  return id;
}


/* ==========================================================================
   3. ACTIVE PROJECT
   ========================================================================== */

/** The project that project-scoped reads and writes use by default (or null). */
export function getActiveProjectId() {
  return activeProjectId;
}

/** Forgets the active project in memory only (used by tests). */
export function resetRepoState() {
  activeProjectId = null;
}

/** Returns the project id to use for an operation, or throws no_project. */
function resolveProjectId(options) {
  const projectId = options.projectId !== undefined && options.projectId !== null
    ? options.projectId
    : activeProjectId;
  if (!projectId) {
    throw new DbError('no_project', 'No project is selected. Choose or create a project first.');
  }
  if (!isSafeId(projectId)) {
    throw invalidData('The project id is not valid.');
  }
  return projectId;
}

/** Throws not_found when a project-scoped record belongs to another project. */
function assertVisible(def, existing, options) {
  if (def.scope !== SCOPE.PROJECT || options.allProjects === true) {
    return;
  }
  if (existing.project_id !== resolveProjectId(options)) {
    throw notFound();
  }
}

function assertExpectedRev(existing, options) {
  if (options.expectedRev !== undefined && existing.rev !== options.expectedRev) {
    throw new DbError('conflict', 'This record was changed after you opened it. Reload it and apply your edit again.');
  }
}

async function assertProjectExists(tx, projectId) {
  const project = await requestToPromise(tx.objectStore(STORES.PROJECTS).get(projectId));
  if (!project || project.deleted_at) {
    throw new DbError('invalid_project', 'The selected project does not exist.');
  }
}


/* ==========================================================================
   4. RECORD BUILDERS (pure functions: no database access)
   ========================================================================== */

function buildNewRecord(def, clean, options, now) {
  const id = clean.id === undefined || clean.id === null ? newId() : clean.id;
  if (!isSafeId(id)) {
    throw invalidData('A record id must be 1 to 64 letters, digits, underscores or hyphens.');
  }

  let projectId = null;
  if (def.scope === SCOPE.PROJECT) {
    let requested = activeProjectId;
    if (clean.project_id !== undefined && clean.project_id !== null) {
      requested = clean.project_id;
    } else if (options.projectId !== undefined && options.projectId !== null) {
      requested = options.projectId;
    }
    if (!requested) {
      throw new DbError('no_project', 'No project is selected. Choose or create a project first.');
    }
    if (!isSafeId(requested)) {
      throw invalidData('The project id is not valid.');
    }
    projectId = requested;
  } else if (clean.project_id !== undefined && clean.project_id !== null) {
    throw invalidData('The "' + def.name + '" store is not project-scoped, so it cannot have a project_id.');
  }

  return {
    ...stripManaged(clean),
    id,
    project_id: projectId,
    created_at: now,
    updated_at: now,
    rev: 1,
    deleted_at: null,
    device_id: getDeviceId(),
    owner_scope: pickOwner(clean.owner_scope, def.owner),
    pdca_stage: pickPdca(clean.pdca_stage, def.pdca)
  };
}

function assertSameProject(existing, patch) {
  if (patch.project_id !== undefined && patch.project_id !== existing.project_id) {
    throw invalidData('A record cannot be moved to another project by editing it.');
  }
}

function buildUpdate(existing, clean, now) {
  const patch = stripManaged(clean);
  assertSameProject(existing, patch);
  return {
    ...existing,
    ...patch,
    id: existing.id,
    project_id: existing.project_id,
    created_at: existing.created_at,
    updated_at: now,
    rev: existing.rev + 1,
    deleted_at: existing.deleted_at,
    device_id: getDeviceId(),
    owner_scope: pickOwner(patch.owner_scope, existing.owner_scope),
    pdca_stage: pickPdca(patch.pdca_stage, existing.pdca_stage)
  };
}

function buildReplacement(existing, clean, now) {
  const body = stripManaged(clean);
  assertSameProject(existing, body);
  return {
    ...body,
    id: existing.id,
    project_id: existing.project_id,
    created_at: existing.created_at,
    updated_at: now,
    rev: existing.rev + 1,
    deleted_at: existing.deleted_at,
    device_id: getDeviceId(),
    owner_scope: pickOwner(body.owner_scope, existing.owner_scope),
    pdca_stage: pickPdca(body.pdca_stage, existing.pdca_stage)
  };
}


/* ==========================================================================
   5. TRANSACTION HELPERS, AUDIT TRAIL AND EVENTS
   Inside transaction callbacks only IndexedDB requests are awaited.
   ========================================================================== */

/** Store names a write transaction must include. */
function writeStores(def, needsProjects) {
  const names = [def.name];
  if (!AUDIT_EXCLUDED.has(def.name)) {
    names.push(STORES.AUDIT_TRAIL);
  }
  if (needsProjects && def.name !== STORES.PROJECTS) {
    names.push(STORES.PROJECTS);
  }
  return names;
}

/** Starts the audit-trail write for a change, or returns null when not audited. */
function writeAudit(tx, def, record, action, now) {
  if (AUDIT_EXCLUDED.has(def.name)) {
    return null;
  }
  const auditDef = getStoreDef(STORES.AUDIT_TRAIL);
  const entry = {
    id: newId(),
    project_id: null,
    created_at: now,
    updated_at: now,
    rev: 1,
    deleted_at: null,
    device_id: getDeviceId(),
    owner_scope: auditDef.owner,
    pdca_stage: auditDef.pdca,
    at: now,
    store: def.name,
    record_id: record.id,
    action,
    record_rev: record.rev,
    record_project_id: record.project_id === undefined ? null : record.project_id
  };
  return requestToPromise(tx.objectStore(STORES.AUDIT_TRAIL).add(entry));
}

/** Emits the event for a committed change. */
function announce(action, def, record, hard) {
  if (action === 'delete' || action === 'purge') {
    emit(EVENTS.RECORD_DELETED, {
      store: def.name,
      id: record.id,
      project_id: record.project_id,
      hard: hard === true,
      record
    });
    return;
  }
  emit(EVENTS.RECORD_SAVED, {
    store: def.name,
    id: record.id,
    project_id: record.project_id,
    action,
    record
  });
}


/* ==========================================================================
   6. CREATING AND SAVING
   ========================================================================== */

/**
 * Creates a new record and returns it (with all common fields filled in).
 * Fails with code "exists" if data.id is already used.
 */
export async function create(storeName, data, options = {}) {
  const def = defOf(storeName);
  const opts = options || {};
  const clean = cleanInput(data);
  const now = nowIso();
  const record = buildNewRecord(def, clean, opts, now);
  const scoped = def.scope === SCOPE.PROJECT;

  await runTransaction(writeStores(def, scoped), 'readwrite', async (tx) => {
    if (scoped) {
      await assertProjectExists(tx, record.project_id);
    }
    await requestToPromise(tx.objectStore(def.name).add(record));
    const audit = writeAudit(tx, def, record, 'create', now);
    if (audit) {
      await audit;
    }
  });

  announce('create', def, record, false);
  return record;
}

/**
 * Saves a whole record. If data.id is missing or not found, the record is
 * created. If it exists, the stored record is REPLACED by data (fields left
 * out are removed; created_at, project_id and rev history are kept).
 * Returns the saved record.
 */
export async function save(storeName, data, options = {}) {
  const def = defOf(storeName);
  const opts = options || {};
  const clean = cleanInput(data);
  const hasId = clean.id !== undefined && clean.id !== null;
  if (hasId) {
    assertId(clean.id);
  }
  const scoped = def.scope === SCOPE.PROJECT;
  const now = nowIso();

  const outcome = await runTransaction(writeStores(def, scoped), 'readwrite', async (tx) => {
    const objectStore = tx.objectStore(def.name);
    const existing = hasId ? await requestToPromise(objectStore.get(clean.id)) : undefined;

    let record;
    let action;
    if (!existing) {
      record = buildNewRecord(def, clean, opts, now);
      if (scoped) {
        await assertProjectExists(tx, record.project_id);
      }
      await requestToPromise(objectStore.add(record));
      action = 'create';
    } else {
      assertVisible(def, existing, opts);
      if (existing.deleted_at) {
        throw notFound('This record has been deleted. Restore it before saving changes.');
      }
      assertExpectedRev(existing, opts);
      record = buildReplacement(existing, clean, now);
      await requestToPromise(objectStore.put(record));
      action = 'update';
    }

    const audit = writeAudit(tx, def, record, action, now);
    if (audit) {
      await audit;
    }
    return { record, action };
  });

  announce(outcome.action, def, outcome.record, false);
  return outcome.record;
}


/* ==========================================================================
   7. CHANGING EXISTING RECORDS
   ========================================================================== */

/**
 * Shared read-modify-write inside one transaction.
 * build(existing, now) returns the new record, or null for "no change".
 */
async function mutateExisting(def, id, action, options, allowDeleted, build) {
  assertId(id);
  const opts = options || {};

  const outcome = await runTransaction(writeStores(def, false), 'readwrite', async (tx) => {
    const objectStore = tx.objectStore(def.name);
    const existing = await requestToPromise(objectStore.get(id));
    if (!existing) {
      throw notFound();
    }
    assertVisible(def, existing, opts);
    if (existing.deleted_at && !allowDeleted) {
      throw notFound('This record has been deleted.');
    }
    assertExpectedRev(existing, opts);

    const now = nowIso();
    const next = build(existing, now);
    if (next === null) {
      return { record: existing, changed: false };
    }
    await requestToPromise(objectStore.put(next));
    const audit = writeAudit(tx, def, next, action, now);
    if (audit) {
      await audit;
    }
    return { record: next, changed: true };
  });

  if (outcome.changed) {
    announce(action, def, outcome.record, false);
  }
  return outcome.record;
}

/**
 * Merges `changes` into the stored record and returns the updated record.
 * Fails with not_found if the record is missing, deleted, or in another project.
 */
export function update(storeName, id, changes, options = {}) {
  const def = defOf(storeName);
  const clean = cleanInput(changes);
  return mutateExisting(def, id, 'update', options, false, (existing, now) => buildUpdate(existing, clean, now));
}

/**
 * Soft-deletes a record (it is hidden, not erased). Deleting an already
 * deleted record changes nothing. Returns the record.
 */
export function remove(storeName, id, options = {}) {
  const def = defOf(storeName);
  return mutateExisting(def, id, 'delete', options, true, (existing, now) => {
    if (existing.deleted_at) {
      return null;
    }
    return {
      ...existing,
      deleted_at: now,
      updated_at: now,
      rev: existing.rev + 1,
      device_id: getDeviceId()
    };
  });
}

/** Brings a soft-deleted record back. Restoring a normal record changes nothing. */
export function restore(storeName, id, options = {}) {
  const def = defOf(storeName);
  return mutateExisting(def, id, 'restore', options, true, (existing, now) => {
    if (!existing.deleted_at) {
      return null;
    }
    return {
      ...existing,
      deleted_at: null,
      updated_at: now,
      rev: existing.rev + 1,
      device_id: getDeviceId()
    };
  });
}

/**
 * PERMANENTLY erases one record. Does not erase linked records (such as
 * attachments); the module that owns the data must do that. Resolves true.
 */
export async function purge(storeName, id, options = {}) {
  const def = defOf(storeName);
  assertId(id);
  const opts = options || {};

  const removed = await runTransaction(writeStores(def, false), 'readwrite', async (tx) => {
    const objectStore = tx.objectStore(def.name);
    const existing = await requestToPromise(objectStore.get(id));
    if (!existing) {
      throw notFound();
    }
    assertVisible(def, existing, opts);
    assertExpectedRev(existing, opts);
    await requestToPromise(objectStore.delete(id));
    const audit = writeAudit(tx, def, existing, 'purge', nowIso());
    if (audit) {
      await audit;
    }
    return existing;
  });

  announce('purge', def, removed, true);
  return true;
}


/* ==========================================================================
   8. READING
   ========================================================================== */

/**
 * Returns one record, or null when it does not exist, is soft-deleted
 * (unless includeDeleted), or belongs to another project.
 */
export async function get(storeName, id, options = {}) {
  const def = defOf(storeName);
  const opts = options || {};
  const record = await dbGet(def.name, id);
  if (record === null) {
    return null;
  }
  if (record.deleted_at && opts.includeDeleted !== true) {
    return null;
  }
  if (def.scope === SCOPE.PROJECT && opts.allProjects !== true
    && record.project_id !== resolveProjectId(opts)) {
    return null;
  }
  return record;
}

function sortRows(rows, orderBy, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  rows.sort((left, right) => {
    const a = left[orderBy];
    const b = right[orderBy];
    const aMissing = a === undefined || a === null;
    const bMissing = b === undefined || b === null;
    if (aMissing || bMissing) {
      if (aMissing && bMissing) {
        return left.id < right.id ? -1 : 1;
      }
      return aMissing ? 1 : -1; // missing values always last
    }
    if (a < b) {
      return -sign;
    }
    if (a > b) {
      return sign;
    }
    return left.id < right.id ? -1 : 1;
  });
}

/**
 * Returns an array of records. Soft-deleted records are hidden and
 * project-scoped stores only return the active (or given) project's records.
 *
 * Ordering:
 *   - without options.index: sorted by options.orderBy (default created_at),
 *     ascending or descending; records missing that field come last
 *   - with options.index: the order of that index (use options.range to
 *     limit it, for example keyRange.bound(['p1','2026-02-01'],['p1','2026-02-28'])
 *     on "project_date")
 * limit/offset are applied last. The whole matching set is read first, which
 * is fine for personal offline volumes (thousands of records).
 */
export async function list(storeName, options = {}) {
  const def = defOf(storeName);
  const opts = options || {};

  const direction = opts.direction === undefined ? 'asc' : opts.direction;
  if (direction !== 'asc' && direction !== 'desc') {
    throw new DbError('invalid_query', 'Direction must be "asc" or "desc".');
  }
  const limit = opts.limit === undefined || opts.limit === null ? null : opts.limit;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new DbError('invalid_query', 'The limit must be a whole number of 1 or more.');
  }
  const offset = opts.offset === undefined ? 0 : opts.offset;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DbError('invalid_query', 'The offset must be a whole number of 0 or more.');
  }
  const filter = opts.filter === undefined || opts.filter === null ? null : opts.filter;
  if (filter !== null && typeof filter !== 'function') {
    throw new DbError('invalid_query', 'The filter must be a function.');
  }
  const index = opts.index === undefined || opts.index === null ? null : opts.index;
  const range = opts.range === undefined ? null : opts.range;
  if (index === null && range !== null) {
    throw new DbError('invalid_query', 'A range can only be used together with an index.');
  }
  const orderBy = opts.orderBy === undefined ? 'created_at' : opts.orderBy;
  if (typeof orderBy !== 'string' || orderBy === '') {
    throw new DbError('invalid_query', 'orderBy must be a field name.');
  }

  const projectId = def.scope === SCOPE.PROJECT && opts.allProjects !== true
    ? resolveProjectId(opts)
    : null;
  const includeDeleted = opts.includeDeleted === true;

  let rows;
  if (index !== null) {
    rows = await dbQuery(def.name, { index, range, direction: direction === 'desc' ? 'prev' : 'next' });
  } else if (projectId !== null) {
    rows = await getAllByIndex(def.name, 'project_id', keyRange.only(projectId));
  } else {
    rows = await dbGetAll(def.name);
  }

  let result = rows.filter((record) =>
    (includeDeleted || !record.deleted_at) && (projectId === null || record.project_id === projectId));
  if (filter !== null) {
    result = result.filter((record) => filter(record));
  }
  if (index === null) {
    sortRows(result, orderBy, direction);
  }
  if (offset > 0 || limit !== null) {
    result = result.slice(offset, limit === null ? undefined : offset + limit);
  }
  return result;
}

/** Number of records list() would return (limit and offset are ignored). */
export async function count(storeName, options = {}) {
  const rows = await list(storeName, { ...(options || {}), limit: null, offset: 0 });
  return rows.length;
}


/* ==========================================================================
   9. SETTINGS (key/value records in the "settings" store)
   ========================================================================== */

/** Returns the stored value for a settings key, or `fallback` when none. */
export async function getSetting(key, fallback = null) {
  assertId(key);
  const record = await dbGet(STORES.SETTINGS, key);
  if (!record || record.deleted_at || !Object.prototype.hasOwnProperty.call(record, 'value')) {
    return fallback;
  }
  return record.value;
}

/** Stores a value (any JSON-like data; use null to clear). Returns the stored value. */
export async function setSetting(key, value) {
  assertId(key);
  if (value === undefined) {
    throw invalidData('A setting value cannot be undefined. Use null to clear it.');
  }
  const record = await save(STORES.SETTINGS, { id: key, value });
  return record.value;
}


/* ==========================================================================
   10. PROJECT SELECTION AND FIRST-LAUNCH SETUP
   ========================================================================== */

/**
 * Makes `projectId` the active project (it must exist and not be deleted),
 * remembers the choice, and emits project:changed when it actually changes.
 */
export async function setActiveProject(projectId) {
  if (!isSafeId(projectId)) {
    throw invalidData('The project id is not valid.');
  }
  const project = await dbGet(STORES.PROJECTS, projectId);
  if (!project || project.deleted_at) {
    throw new DbError('invalid_project', 'The selected project does not exist.');
  }
  const previous = activeProjectId;
  await setSetting(SETTINGS_KEYS.ACTIVE_PROJECT, projectId);
  activeProjectId = projectId;
  if (previous !== projectId) {
    emit(EVENTS.PROJECT_CHANGED, { project_id: projectId, previous_project_id: previous });
  }
}

/**
 * Call once at start-up (after the database opens). It:
 *   - creates this browser's device id if needed
 *   - restores the previously active project, or picks the oldest project
 *   - on a brand-new install, creates the default personal project
 * Resolves { projectId, createdDefault }.
 */
export async function initRepo() {
  getDeviceId();

  const projects = await list(STORES.PROJECTS, { orderBy: 'created_at' });
  const storedId = await getSetting(SETTINGS_KEYS.ACTIVE_PROJECT, null);

  let project = null;
  if (typeof storedId === 'string') {
    project = projects.find((candidate) => candidate.id === storedId) || null;
  }
  if (!project && projects.length > 0) {
    project = projects[0];
  }

  let createdDefault = false;
  if (!project) {
    const old = await dbGet(STORES.PROJECTS, DEFAULTS.PROJECT_ID);
    if (old) {
      project = old.deleted_at ? await restore(STORES.PROJECTS, old.id) : old;
    } else {
      try {
        project = await create(STORES.PROJECTS, {
          id: DEFAULTS.PROJECT_ID,
          name: DEFAULTS.PROJECT_NAME,
          status: 'active',
          client_id: null,
          owner_scope: OWNER_SCOPE.PERSONAL
        });
        createdDefault = true;
      } catch (error) {
        if (error instanceof DbError && error.code === 'exists') {
          project = await dbGet(STORES.PROJECTS, DEFAULTS.PROJECT_ID); // another tab created it first
        } else {
          throw error;
        }
      }
    }
  }
  if (!project) {
    throw new DbError('unknown', 'NASUR could not set up the default project.');
  }

  activeProjectId = project.id;
  if (storedId !== project.id) {
    await setSetting(SETTINGS_KEYS.ACTIVE_PROJECT, project.id);
  }
  return { projectId: project.id, createdDefault };
}