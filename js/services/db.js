/**
 * NASUR – IndexedDB Data Layer (low level)
 * File: js/services/db.js
 *
 * A small promise-based wrapper around the browser's IndexedDB. It:
 *   - opens the database and creates/updates every store and index from
 *     STORE_DEFS in js/core/config.js (DB v1 is locked)
 *   - provides simple operations: get, getAll, getAllByIndex, query, count,
 *     put, add, putMany, deleteRecord, deleteMany, clearStore, clearAll
 *   - provides runTransaction() for atomic multi-store changes
 *   - provides exportAll(), wipeDatabase(), storage persistence/estimate helpers
 *   - turns browser errors into DbError objects with readable messages
 *
 * This file knows nothing about projects, timestamps or revisions. Those
 * rules live in js/services/repo.js (File 9). Modules should normally use
 * repo.js, not this file.
 *
 * Writing a runTransaction() callback:
 *   await runTransaction(['actions', 'observations'], 'readwrite', async (tx) => {
 *     const actions = tx.objectStore('actions');
 *     await requestToPromise(actions.put(record));
 *   });
 * Inside the callback, await ONLY IndexedDB requests (via requestToPromise).
 * Awaiting anything else (fetch, timers, user prompts) lets the browser
 * commit the transaction early and later requests will fail.
 *
 * Records are returned exactly as stored. Not-found results are null.
 */

import { DB, STORE_DEFS, STORE_NAMES, getStoreDef, isStoreName } from '../core/config.js';


/* ==========================================================================
   1. ERRORS
   ========================================================================== */

/**
 * Error thrown by every function in this file. `code` is one of:
 *   unsupported, unavailable, blocked, version, quota, exists, not_found,
 *   invalid_store, invalid_index, invalid_record, invalid_query,
 *   invalid_range, aborted, unknown
 */
export class DbError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Converts any thrown value into a DbError (DbErrors are returned unchanged). */
function wrapError(error) {
  if (error instanceof DbError) {
    return error;
  }
  const name = error && error.name ? error.name : '';
  const original = error && error.message ? error.message : '';

  switch (name) {
    case 'QuotaExceededError':
      return new DbError('quota', 'Not enough storage space on this device. Free some space or export a backup, then try again.', error);
    case 'ConstraintError':
      return new DbError('exists', 'A record with this id already exists.', error);
    case 'VersionError':
      return new DbError('version', 'This device already holds data from a newer version of NASUR. Reload the page to get the latest version.', error);
    case 'NotFoundError':
      return new DbError('not_found', 'The requested store or index was not found.', error);
    case 'DataCloneError':
      return new DbError('invalid_record', 'This record contains data that cannot be saved.', error);
    case 'AbortError':
      return new DbError('aborted', 'The operation was cancelled and no changes were made.', error);
    case 'InvalidStateError':
    case 'SecurityError':
      return new DbError('unavailable', 'The browser is not allowing offline storage right now. Private browsing or strict privacy settings can cause this.', error);
    default:
      return new DbError('unknown', original || 'Unexpected database error.', error);
  }
}


/* ==========================================================================
   2. CONNECTION STATE
   ========================================================================== */

let databaseName = DB.NAME;
let dbPromise = null;
let dbConnection = null;
let openToken = null;

/** True when this browser provides IndexedDB. */
export function isSupported() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/** Name of the database currently in use. */
export function getDatabaseName() {
  return databaseName;
}

/**
 * Switches to a different database name and closes the current connection.
 * Used by tests so they never touch real data. Names may contain letters,
 * digits, dot, underscore and hyphen (1 to 100 characters).
 */
export function setDatabaseName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    throw new DbError('invalid_query', 'The database name must be 1 to 100 letters, digits, dots, underscores or hyphens.');
  }
  closeDb();
  databaseName = name;
}

/** Closes the connection (the next operation opens it again). */
export function closeDb() {
  openToken = null;
  if (dbConnection) {
    dbConnection.close();
  }
  dbConnection = null;
  dbPromise = null;
}

function closeConnection(db) {
  db.close();
  if (dbConnection === db) {
    dbConnection = null;
    dbPromise = null;
  }
}


/* ==========================================================================
   3. SCHEMA CREATION AND UPGRADE
   Runs inside the upgrade transaction. It is written to be safe for any
   future version: missing stores are created, missing indexes are added,
   and indexes whose definition changed or that no longer exist are rebuilt
   or removed. Stores that are not in config are never deleted (no data loss).
   ========================================================================== */

function indexMatches(index, spec) {
  return JSON.stringify(index.keyPath) === JSON.stringify(spec.keyPath)
    && index.unique === spec.unique
    && index.multiEntry === spec.multiEntry;
}

function syncIndexes(store, def) {
  const wanted = new Map(def.indexes.map((spec) => [spec.name, spec]));

  for (const existingName of Array.from(store.indexNames)) {
    const spec = wanted.get(existingName);
    if (!spec || !indexMatches(store.index(existingName), spec)) {
      store.deleteIndex(existingName);
    }
  }

  for (const spec of def.indexes) {
    if (!store.indexNames.contains(spec.name)) {
      const keyPath = Array.isArray(spec.keyPath) ? Array.from(spec.keyPath) : spec.keyPath;
      store.createIndex(spec.name, keyPath, { unique: spec.unique, multiEntry: spec.multiEntry });
    }
  }
}

function upgradeSchema(db, transaction) {
  for (const def of STORE_DEFS) {
    const store = db.objectStoreNames.contains(def.name)
      ? transaction.objectStore(def.name)
      : db.createObjectStore(def.name, { keyPath: def.keyPath });
    syncIndexes(store, def);
  }
}


/* ==========================================================================
   4. OPENING THE DATABASE
   ========================================================================== */

/** Opens the database (once) and returns the connection. */
export function openDb() {
  if (dbPromise) {
    return dbPromise;
  }
  if (!isSupported()) {
    return Promise.reject(new DbError('unsupported', 'This browser does not support offline storage (IndexedDB), so NASUR cannot save data here.'));
  }

  const token = {};
  openToken = token;

  const attempt = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(databaseName, DB.VERSION);
    } catch (error) {
      reject(wrapError(error));
      return;
    }

    let upgradeError = null;

    request.onupgradeneeded = () => {
      try {
        upgradeSchema(request.result, request.transaction);
      } catch (error) {
        upgradeError = error;
        try {
          request.transaction.abort();
        } catch {
          /* the transaction has already ended */
        }
      }
    };

    request.onblocked = () => {
      console.warn('NASUR database: waiting for other NASUR tabs to close before it can update.');
    };

    request.onerror = () => {
      reject(wrapError(upgradeError || request.error));
    };

    request.onsuccess = () => {
      const db = request.result;
      if (openToken !== token) {
        db.close();
        reject(new DbError('aborted', 'The database was closed while it was opening.'));
        return;
      }
      db.onversionchange = () => closeConnection(db);
      db.onclose = () => {
        if (dbConnection === db) {
          dbConnection = null;
          dbPromise = null;
        }
      };
      dbConnection = db;
      resolve(db);
    };
  });

  dbPromise = attempt;
  attempt.catch(() => {
    if (dbPromise === attempt) {
      dbPromise = null;
    }
  });
  return attempt;
}

/** Returns { name, version, stores } for diagnostics and tests. */
export async function getDbInfo() {
  const db = await openDb();
  return {
    name: db.name,
    version: db.version,
    stores: Array.from(db.objectStoreNames).sort()
  };
}


/* ==========================================================================
   5. PROMISE HELPERS AND TRANSACTIONS
   ========================================================================== */

/** Turns an IDBRequest into a promise for its result. */
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(wrapError(request.error));
  });
}

/** Promise that settles when a transaction commits or aborts. */
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(wrapError(transaction.error || new DOMException('Transaction aborted.', 'AbortError')));
  });
}

function assertStore(storeName) {
  if (!isStoreName(storeName)) {
    throw new DbError('invalid_store', 'Unknown store "' + String(storeName) + '".');
  }
}

function assertIndex(storeName, indexName) {
  assertStore(storeName);
  const known = getStoreDef(storeName).indexes.some((spec) => spec.name === indexName);
  if (!known) {
    throw new DbError('invalid_index', 'Store "' + storeName + '" has no index "' + String(indexName) + '".');
  }
}

function assertRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)
    || typeof record.id !== 'string' || record.id === '') {
    throw new DbError('invalid_record', 'A record must be an object with a non-empty text id.');
  }
}

function assertKey(key) {
  if (typeof key !== 'string' || key === '') {
    throw new DbError('invalid_query', 'A record key must be a non-empty text id.');
  }
}

function assertLimit(limit) {
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new DbError('invalid_query', 'The limit must be a whole number of 1 or more.');
  }
}

/**
 * Runs `work(transaction)` inside one transaction over the given stores.
 * If `work` throws or rejects, every change made in the transaction is
 * rolled back. Resolves with the value returned by `work` after the
 * transaction has committed.
 * mode: 'readonly' | 'readwrite'
 */
export async function runTransaction(storeNames, mode, work) {
  if (!Array.isArray(storeNames) || storeNames.length === 0) {
    throw new DbError('invalid_store', 'A transaction needs at least one store name.');
  }
  for (const name of storeNames) {
    assertStore(name);
  }
  if (mode !== 'readonly' && mode !== 'readwrite') {
    throw new DbError('invalid_query', 'Transaction mode must be "readonly" or "readwrite".');
  }
  if (typeof work !== 'function') {
    throw new DbError('invalid_query', 'A transaction needs a function to run.');
  }

  const db = await openDb();

  let transaction;
  try {
    transaction = db.transaction(Array.from(storeNames), mode);
  } catch (error) {
    throw wrapError(error);
  }

  const done = transactionDone(transaction);
  done.catch(() => {}); // prevents an "unhandled rejection" warning; `done` is awaited below

  let result;
  try {
    result = await work(transaction);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* the transaction has already ended */
    }
    try {
      await done;
    } catch {
      /* the abort error is replaced by the original error below */
    }
    throw wrapError(error);
  }

  await done;
  return result;
}


/* ==========================================================================
   6. KEY RANGES
   ========================================================================== */

function makeRange(factory) {
  if (typeof IDBKeyRange === 'undefined') {
    throw new DbError('unsupported', 'This browser does not support offline storage (IndexedDB).');
  }
  try {
    return factory();
  } catch (error) {
    throw new DbError('invalid_range', 'The search range is not valid.', error);
  }
}

/**
 * Helpers for index queries. For compound indexes pass arrays, e.g.
 *   keyRange.bound(['project_1', '2026-02-01'], ['project_1', '2026-02-28'])
 */
export const keyRange = Object.freeze({
  only: (value) => makeRange(() => IDBKeyRange.only(value)),
  bound: (lower, upper, lowerOpen = false, upperOpen = false) =>
    makeRange(() => IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)),
  lowerBound: (lower, open = false) => makeRange(() => IDBKeyRange.lowerBound(lower, open)),
  upperBound: (upper, open = false) => makeRange(() => IDBKeyRange.upperBound(upper, open)),
  /** All text values that start with `text`. */
  prefix: (text) => makeRange(() => IDBKeyRange.bound(text, text + '\uffff'))
});


/* ==========================================================================
   7. READING
   ========================================================================== */

/** Returns the record with this id, or null. */
export async function get(storeName, key) {
  assertStore(storeName);
  assertKey(key);
  const record = await runTransaction([storeName], 'readonly', (tx) =>
    requestToPromise(tx.objectStore(storeName).get(key)));
  return record === undefined ? null : record;
}

/** Returns every record in a store. */
export function getAll(storeName) {
  assertStore(storeName);
  return runTransaction([storeName], 'readonly', (tx) =>
    requestToPromise(tx.objectStore(storeName).getAll()));
}

/**
 * Returns records whose index value matches `range` (a value or keyRange.*;
 * null means every record that has the indexed field). `limit` is optional.
 */
export function getAllByIndex(storeName, indexName, range = null, limit = null) {
  assertIndex(storeName, indexName);
  assertLimit(limit);
  return runTransaction([storeName], 'readonly', (tx) =>
    requestToPromise(tx.objectStore(storeName).index(indexName).getAll(
      range === null ? undefined : range,
      limit === null ? undefined : limit
    )));
}

/**
 * Flexible read using a cursor.
 * options: {
 *   index:     index name (default: the primary key, id)
 *   range:     value or keyRange.* (default: everything)
 *   direction: 'next' (default, ascending) or 'prev' (descending)
 *   limit:     maximum number of records (default: no limit)
 *   offset:    records to skip first (default: 0)
 * }
 */
export function query(storeName, options = {}) {
  assertStore(storeName);
  const index = options.index === undefined || options.index === null ? null : options.index;
  const range = options.range === undefined ? null : options.range;
  const direction = options.direction === undefined ? 'next' : options.direction;
  const limit = options.limit === undefined ? null : options.limit;
  const offset = options.offset === undefined ? 0 : options.offset;

  if (index !== null) {
    assertIndex(storeName, index);
  }
  if (direction !== 'next' && direction !== 'prev') {
    throw new DbError('invalid_query', 'Direction must be "next" or "prev".');
  }
  assertLimit(limit);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DbError('invalid_query', 'The offset must be a whole number of 0 or more.');
  }

  return runTransaction([storeName], 'readonly', (tx) => new Promise((resolve, reject) => {
    const objectStore = tx.objectStore(storeName);
    const source = index === null ? objectStore : objectStore.index(index);
    const request = source.openCursor(range === null ? undefined : range, direction);
    const results = [];
    let offsetHandled = false;

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      if (!offsetHandled && offset > 0) {
        offsetHandled = true;
        cursor.advance(offset);
        return;
      }
      offsetHandled = true;
      results.push(cursor.value);
      if (limit !== null && results.length >= limit) {
        resolve(results);
        return;
      }
      cursor.continue();
    };
  }));
}

/** Number of records in a store. */
export function count(storeName) {
  assertStore(storeName);
  return runTransaction([storeName], 'readonly', (tx) =>
    requestToPromise(tx.objectStore(storeName).count()));
}

/** Number of records whose index value matches `range` (null = all indexed). */
export function countByIndex(storeName, indexName, range = null) {
  assertIndex(storeName, indexName);
  return runTransaction([storeName], 'readonly', (tx) =>
    requestToPromise(tx.objectStore(storeName).index(indexName).count(range === null ? undefined : range)));
}


/* ==========================================================================
   8. WRITING
   ========================================================================== */

/** Inserts or replaces a record. Resolves with the record id. */
export function put(storeName, record) {
  assertStore(storeName);
  assertRecord(record);
  return runTransaction([storeName], 'readwrite', (tx) =>
    requestToPromise(tx.objectStore(storeName).put(record)));
}

/** Inserts a new record. Fails with code "exists" if the id is already used. */
export function add(storeName, record) {
  assertStore(storeName);
  assertRecord(record);
  return runTransaction([storeName], 'readwrite', (tx) =>
    requestToPromise(tx.objectStore(storeName).add(record)));
}

/** Inserts or replaces many records in one all-or-nothing transaction. Resolves with the count. */
export function putMany(storeName, records) {
  assertStore(storeName);
  if (!Array.isArray(records)) {
    throw new DbError('invalid_record', 'putMany needs an array of records.');
  }
  for (const record of records) {
    assertRecord(record);
  }
  if (records.length === 0) {
    return Promise.resolve(0);
  }
  return runTransaction([storeName], 'readwrite', async (tx) => {
    const objectStore = tx.objectStore(storeName);
    await Promise.all(records.map((record) => requestToPromise(objectStore.put(record))));
    return records.length;
  });
}

/** Permanently removes one record (repo.js uses soft delete for normal data). */
export async function deleteRecord(storeName, key) {
  assertStore(storeName);
  assertKey(key);
  await runTransaction([storeName], 'readwrite', (tx) =>
    requestToPromise(tx.objectStore(storeName).delete(key)));
}

/** Permanently removes many records in one all-or-nothing transaction. Resolves with the count. */
export function deleteMany(storeName, keys) {
  assertStore(storeName);
  if (!Array.isArray(keys)) {
    throw new DbError('invalid_query', 'deleteMany needs an array of ids.');
  }
  for (const key of keys) {
    assertKey(key);
  }
  if (keys.length === 0) {
    return Promise.resolve(0);
  }
  return runTransaction([storeName], 'readwrite', async (tx) => {
    const objectStore = tx.objectStore(storeName);
    await Promise.all(keys.map((key) => requestToPromise(objectStore.delete(key))));
    return keys.length;
  });
}

/** Removes every record in one store. */
export async function clearStore(storeName) {
  assertStore(storeName);
  await runTransaction([storeName], 'readwrite', (tx) =>
    requestToPromise(tx.objectStore(storeName).clear()));
}

/** Removes every record in every store in one all-or-nothing transaction. */
export async function clearAll() {
  await runTransaction(STORE_NAMES, 'readwrite', async (tx) => {
    await Promise.all(STORE_NAMES.map((name) => requestToPromise(tx.objectStore(name).clear())));
  });
}


/* ==========================================================================
   9. EXPORT AND WIPE
   ========================================================================== */

/**
 * Reads every record of every store in one consistent snapshot.
 * Resolves with { storeName: [records…], … } (used by backup.js).
 */
export function exportAll() {
  return runTransaction(STORE_NAMES, 'readonly', async (tx) => {
    const snapshot = {};
    for (const name of STORE_NAMES) {
      snapshot[name] = await requestToPromise(tx.objectStore(name).getAll());
    }
    return snapshot;
  });
}

/**
 * Deletes the whole database from this device (the "wipe my data" action).
 * The next operation creates a fresh, empty database. If another NASUR tab
 * is open, the request waits until that tab lets go.
 */
export function wipeDatabase() {
  closeDb();
  if (!isSupported()) {
    return Promise.reject(new DbError('unsupported', 'This browser does not support offline storage (IndexedDB).'));
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.deleteDatabase(databaseName);
    } catch (error) {
      reject(wrapError(error));
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(wrapError(request.error));
    request.onblocked = () => {
      console.warn('NASUR database: waiting for other NASUR tabs to close before the data can be erased.');
    };
  });
}


/* ==========================================================================
   10. STORAGE PERSISTENCE AND SPACE
   ========================================================================== */

/**
 * Asks the browser not to evict NASUR's data when the device is low on
 * space. Resolves true when storage is (now) persistent. The browser may
 * refuse; that is normal and not an error.
 */
export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return false;
  }
  try {
    if (typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted()) {
      return true;
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Returns { supported: false } or
 * { supported: true, usage, quota, percentUsed } (bytes; percent 0 to 100).
 */
export async function getStorageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
    return { supported: false };
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    return {
      supported: true,
      usage,
      quota,
      percentUsed: quota > 0 ? Math.round((usage / quota) * 1000) / 10 : 0
    };
  } catch {
    return { supported: false };
  }
}