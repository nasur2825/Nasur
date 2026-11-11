/**
 * NASUR – Static Application Configuration
 * File: js/core/config.js
 *
 * Single source of truth for:
 *   - app identity and version
 *   - IndexedDB name, version and EVERY store definition (DB v1, locked)
 *   - LocalStorage keys, settings keys, event names, shared enumerations
 *
 * This file contains constants only. It has no imports and touches no
 * browser APIs. Other files must import names from here and never retype
 * a store name, index name, storage key or event name as a raw string.
 *
 * Note: js/services/config.js (File 10) is the separate service that reads
 * and writes the user's own configuration. This file holds app constants.
 */


/* ==========================================================================
   1. INTERNAL HELPERS
   ========================================================================== */

/**
 * Recursively freezes an object or array so configuration cannot be changed
 * by accident at runtime.
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}


/* ==========================================================================
   2. APP IDENTITY, DATABASE AND BACKUP
   ========================================================================== */

export const APP = deepFreeze({
  NAME: 'NASUR',
  ASSISTANT_NAME: 'JARVIS',
  TAGLINE: 'HSE Operating System',
  VERSION: '1.0.0'
});

export const DB = deepFreeze({
  NAME: 'nasur-db',
  VERSION: 1
});

export const BACKUP = deepFreeze({
  FORMAT: 'nasur-backup',
  SCHEMA_VERSION: DB.VERSION
});


/* ==========================================================================
   3. SHARED ENUMERATIONS
   ========================================================================== */

/** Whether a store's records belong to one project or are global/personal. */
export const SCOPE = deepFreeze({
  GLOBAL: 'global',
  PROJECT: 'project'
});

/** Who owns a record (Addendum 4: personal data is separate from employer data). */
export const OWNER_SCOPE = deepFreeze({
  PERSONAL: 'personal',
  EMPLOYER: 'employer',
  CLIENT: 'client'
});

/** HSE management system PDCA stages (Addendum 8). */
export const PDCA_STAGE = deepFreeze({
  PLAN: 'plan',
  DO: 'do',
  CHECK: 'check',
  ACT: 'act',
  IMPROVE: 'improve'
});

export const THEMES = deepFreeze({
  AUTO: 'auto',
  LIGHT: 'light',
  DARK: 'dark'
});

export const DEFAULT_THEME = THEMES.AUTO;

/**
 * Fields present on every record. repo.js (File 9) fills them in.
 *   id          UUID string
 *   project_id  project the record belongs to (null for global stores)
 *   created_at  ISO 8601 UTC timestamp
 *   updated_at  ISO 8601 UTC timestamp
 *   rev         integer, starts at 1, +1 on every save
 *   deleted_at  null, or ISO timestamp when soft-deleted
 *   device_id   device that last saved the record
 *   owner_scope one of OWNER_SCOPE
 *   pdca_stage  one of PDCA_STAGE, or null
 */
export const COMMON_FIELDS = deepFreeze([
  'id',
  'project_id',
  'created_at',
  'updated_at',
  'rev',
  'deleted_at',
  'device_id',
  'owner_scope',
  'pdca_stage'
]);

/**
 * Date convention used by every store: a field called `date` (or another
 * `*_date` field) is a LOCAL calendar date string in the form YYYY-MM-DD.
 * Fields ending in `_at` are ISO 8601 UTC timestamps.
 */

/** Defaults used when the app creates its first project. */
export const DEFAULTS = deepFreeze({
  PROJECT_ID: 'project_default',
  PROJECT_NAME: 'My Workspace'
});


/* ==========================================================================
   4. LOCALSTORAGE, SETTINGS KEYS AND EVENT NAMES
   ========================================================================== */

/** LocalStorage keys (small, fast-boot values only; records live in IndexedDB). */
export const LS_KEYS = deepFreeze({
  THEME: 'nasur.theme',
  LANGUAGE: 'nasur.language',
  LAST_ROUTE: 'nasur.last_route',
  DEVICE_ID: 'nasur.device_id',
  WEATHER_CACHE: 'nasur.weather_cache',
  AI_CONFIG: 'nasur.ai_config',
  LAST_BACKUP_AT: 'nasur.last_backup_at',
  STORAGE_PERSIST_ASKED: 'nasur.storage_persist_asked'
});

/** Record ids used inside the `settings` store (one record per key). */
export const SETTINGS_KEYS = deepFreeze({
  USER_CONFIG: 'user_config',
  ACTIVE_PROJECT: 'active_project'
});

/** Event names for js/core/eventbus.js. */
export const EVENTS = deepFreeze({
  RECORD_SAVED: 'record:saved',
  RECORD_DELETED: 'record:deleted',
  ACTION_CREATED: 'action:created',
  PROJECT_CHANGED: 'project:changed',
  CONFIG_CHANGED: 'config:changed',
  THEME_CHANGED: 'theme:changed',
  NETWORK_CHANGED: 'network:changed',
  ROUTE_CHANGED: 'route:changed',
  TOAST: 'ui:toast'
});


/* ==========================================================================
   5. INDEXEDDB STORE DEFINITIONS (DB v1, locked)
   ========================================================================== */

/** Simple index: name defaults to the field name. */
function simpleIndex(keyPath, name) {
  return { name: name || keyPath, keyPath, unique: false, multiEntry: false };
}

/** Compound index over several fields (all must be present to be indexed). */
function compoundIndex(name, keyPaths) {
  return { name, keyPath: keyPaths, unique: false, multiEntry: false };
}

/** Index over an array field: one entry per array item. */
function multiIndex(keyPath) {
  return { name: keyPath, keyPath, unique: false, multiEntry: true };
}

/** Standard "records for one project on one date" index. */
function projectDateIndex() {
  return compoundIndex('project_date', ['project_id', 'date']);
}

/**
 * Builds one store definition. Common indexes are added automatically:
 *   project_id  (project-scoped stores only)
 *   updated_at  (every store; used by backup merge and sorting)
 *
 * Every store uses keyPath "id". `pdca` and `owner` are the defaults that
 * repo.js applies when a record does not set pdca_stage / owner_scope itself.
 */
function defineStore(options) {
  const indexes = [];
  if (options.scope === SCOPE.PROJECT) {
    indexes.push(simpleIndex('project_id'));
  }
  indexes.push(simpleIndex('updated_at'));
  for (const extra of options.indexes) {
    indexes.push(extra);
  }
  return {
    name: options.name,
    keyPath: 'id',
    group: options.group,
    scope: options.scope,
    pdca: options.pdca,
    owner: options.owner,
    indexes
  };
}

const G = SCOPE.GLOBAL;
const P = SCOPE.PROJECT;
const PLAN = PDCA_STAGE.PLAN;
const DO = PDCA_STAGE.DO;
const CHECK = PDCA_STAGE.CHECK;
const ACT = PDCA_STAGE.ACT;
const IMPROVE = PDCA_STAGE.IMPROVE;
const PERSONAL = OWNER_SCOPE.PERSONAL;
const EMPLOYER = OWNER_SCOPE.EMPLOYER;

const RAW_STORE_DEFS = [
  /* ---- System ---------------------------------------------------------- */
  defineStore({ name: 'settings', group: 'system', scope: G, pdca: null, owner: PERSONAL, indexes: [] }),
  defineStore({ name: 'profiles', group: 'system', scope: G, pdca: null, owner: PERSONAL, indexes: [] }),
  defineStore({ name: 'clients', group: 'system', scope: G, pdca: null, owner: EMPLOYER, indexes: [simpleIndex('name')] }),
  defineStore({
    name: 'projects', group: 'system', scope: G, pdca: null, owner: EMPLOYER,
    indexes: [simpleIndex('client_id'), simpleIndex('name'), simpleIndex('status')]
  }),
  defineStore({
    name: 'audit_trail', group: 'system', scope: G, pdca: null, owner: PERSONAL,
    indexes: [
      simpleIndex('store'), simpleIndex('record_id'), simpleIndex('action'), simpleIndex('at'),
      compoundIndex('store_record', ['store', 'record_id'])
    ]
  }),
  defineStore({
    name: 'ai_log', group: 'system', scope: G, pdca: null, owner: PERSONAL,
    indexes: [simpleIndex('at'), simpleIndex('provider')]
  }),

  /* ---- Operations ------------------------------------------------------ */
  defineStore({
    name: 'observations', group: 'operations', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [
      simpleIndex('date'), projectDateIndex(), simpleIndex('status'), simpleIndex('risk_rating'),
      simpleIndex('obs_number'), simpleIndex('hazard_category'), simpleIndex('target_date')
    ]
  }),
  defineStore({
    name: 'inspection_templates', group: 'operations', scope: G, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('industry_id'), simpleIndex('category'), simpleIndex('client_id')]
  }),
  defineStore({
    name: 'inspections', group: 'operations', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [
      simpleIndex('date'), projectDateIndex(), simpleIndex('status'),
      simpleIndex('template_id'), simpleIndex('inspection_type')
    ]
  }),
  defineStore({
    name: 'inspection_findings', group: 'operations', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('inspection_id'), simpleIndex('status'), simpleIndex('risk_rating')]
  }),
  defineStore({
    name: 'audits', group: 'operations', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('date'), projectDateIndex(), simpleIndex('status'), simpleIndex('audit_type')]
  }),
  defineStore({
    name: 'audit_findings', group: 'operations', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('audit_id'), simpleIndex('status')]
  }),
  defineStore({
    name: 'incidents', group: 'operations', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('date'), projectDateIndex(), simpleIndex('status'), simpleIndex('incident_type')]
  }),
  defineStore({
    name: 'investigations', group: 'operations', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('incident_id'), simpleIndex('status')]
  }),
  defineStore({
    name: 'risk_assessments', group: 'operations', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('ra_type'), simpleIndex('status'), simpleIndex('review_date')]
  }),
  defineStore({
    name: 'hazard_register', group: 'operations', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('category'), simpleIndex('risk_rating'), simpleIndex('status')]
  }),
  defineStore({
    name: 'controls', group: 'operations', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('risk_assessment_id'), simpleIndex('hazard_id')]
  }),
  defineStore({
    name: 'ptw_drafts', group: 'operations', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [simpleIndex('permit_type'), simpleIndex('status'), simpleIndex('date')]
  }),
  defineStore({
    name: 'daily_logs', group: 'operations', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [simpleIndex('date'), projectDateIndex(), simpleIndex('entry_type')]
  }),
  defineStore({
    name: 'reminders', group: 'operations', scope: P, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('due_at'), simpleIndex('status'), simpleIndex('source_store')]
  }),

  /* ---- Unified action tracker ------------------------------------------ */
  defineStore({
    name: 'actions', group: 'actions', scope: P, pdca: ACT, owner: EMPLOYER,
    indexes: [
      simpleIndex('status'), simpleIndex('priority'), simpleIndex('target_date'),
      simpleIndex('source_module'), compoundIndex('source', ['source_module', 'source_id']),
      simpleIndex('responsible_person'), compoundIndex('project_status', ['project_id', 'status'])
    ]
  }),

  /* ---- Media ----------------------------------------------------------- */
  defineStore({
    name: 'attachments', group: 'media', scope: P, pdca: null, owner: EMPLOYER,
    indexes: [
      simpleIndex('owner_id'), compoundIndex('owner', ['owner_store', 'owner_id']), simpleIndex('mime_type')
    ]
  }),

  /* ---- Learning -------------------------------------------------------- */
  defineStore({
    name: 'lessons', group: 'learning', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('category'), simpleIndex('level'), multiIndex('industry_ids')]
  }),
  defineStore({
    name: 'lesson_progress', group: 'learning', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('lesson_id'), simpleIndex('status')]
  }),
  defineStore({
    name: 'quiz_attempts', group: 'learning', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('lesson_id'), simpleIndex('date')]
  }),
  defineStore({
    name: 'flashcards', group: 'learning', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('deck'), simpleIndex('language'), simpleIndex('due_at')]
  }),
  defineStore({
    name: 'machines', group: 'learning', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('category'), multiIndex('industry_ids'), simpleIndex('name')]
  }),
  defineStore({
    name: 'phrasebook', group: 'learning', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('language'), simpleIndex('category')]
  }),
  defineStore({
    name: 'tbt_sessions', group: 'learning', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [simpleIndex('date'), projectDateIndex(), simpleIndex('topic'), simpleIndex('status')]
  }),
  defineStore({
    name: 'tbt_attendance', group: 'learning', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [simpleIndex('session_id')]
  }),

  /* ---- Knowledge ------------------------------------------------------- */
  defineStore({
    name: 'knowledge_docs', group: 'knowledge', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('source_type'), simpleIndex('title'), multiIndex('tags')]
  }),
  defineStore({
    name: 'knowledge_chunks', group: 'knowledge', scope: G, pdca: DO, owner: PERSONAL,
    indexes: [simpleIndex('doc_id')]
  }),
  defineStore({
    name: 'memory_notes', group: 'knowledge', scope: G, pdca: IMPROVE, owner: PERSONAL,
    indexes: [simpleIndex('category'), multiIndex('tags')]
  }),

  /* ---- Analytics and extension records --------------------------------- */
  defineStore({
    name: 'kpi_snapshots', group: 'analytics', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('kpi_id'), simpleIndex('period_key'), compoundIndex('kpi_period', ['kpi_id', 'period_key'])]
  }),
  defineStore({
    name: 'ext_records', group: 'analytics', scope: P, pdca: null, owner: EMPLOYER,
    indexes: [simpleIndex('type'), simpleIndex('status'), compoundIndex('project_type', ['project_id', 'type'])]
  }),

  /* ---- Career and competency (Addendum 1) ------------------------------ */
  defineStore({ name: 'career_profile', group: 'career', scope: G, pdca: IMPROVE, owner: PERSONAL, indexes: [] }),
  defineStore({
    name: 'skill_ratings', group: 'career', scope: G, pdca: IMPROVE, owner: PERSONAL,
    indexes: [simpleIndex('skill_id')]
  }),
  defineStore({
    name: 'competency_evidence', group: 'career', scope: G, pdca: IMPROVE, owner: PERSONAL,
    indexes: [
      simpleIndex('skill_id'), simpleIndex('status'), compoundIndex('linked', ['linked_store', 'linked_id'])
    ]
  }),
  defineStore({
    name: 'learning_roadmaps', group: 'career', scope: G, pdca: IMPROVE, owner: PERSONAL,
    indexes: [simpleIndex('target_role'), simpleIndex('status')]
  }),

  /* ---- Adaptive workspace (Addendum 2) --------------------------------- */
  defineStore({
    name: 'workspace_profiles', group: 'workspace', scope: G, pdca: null, owner: PERSONAL,
    indexes: [simpleIndex('role'), simpleIndex('industry_id')]
  }),

  /* ---- Decision support (Addendum 3) ----------------------------------- */
  defineStore({
    name: 'decision_sessions', group: 'decision', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [simpleIndex('flow_id'), simpleIndex('date'), compoundIndex('linked', ['linked_store', 'linked_id'])]
  }),

  /* ---- Career portfolio (Addendum 4) ----------------------------------- */
  defineStore({
    name: 'portfolio_entries', group: 'portfolio', scope: G, pdca: IMPROVE, owner: PERSONAL,
    indexes: [simpleIndex('type'), simpleIndex('date')]
  }),

  /* ---- Document control (Addendum 5) ----------------------------------- */
  defineStore({
    name: 'documents', group: 'document_control', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [
      simpleIndex('doc_id'), simpleIndex('category'), simpleIndex('status'),
      simpleIndex('review_date'), simpleIndex('owner')
    ]
  }),
  defineStore({
    name: 'document_revisions', group: 'document_control', scope: P, pdca: DO, owner: EMPLOYER,
    indexes: [simpleIndex('doc_id'), compoundIndex('project_doc', ['project_id', 'doc_id']), simpleIndex('rev_date')]
  }),

  /* ---- Emergency preparedness (Addendum 6) ----------------------------- */
  defineStore({
    name: 'emergency_contacts', group: 'emergency', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('category')]
  }),
  defineStore({
    name: 'emergency_procedures', group: 'emergency', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('emergency_type'), simpleIndex('status')]
  }),
  defineStore({
    name: 'muster_points', group: 'emergency', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('name')]
  }),
  defineStore({
    name: 'emergency_equipment', group: 'emergency', scope: P, pdca: PLAN, owner: EMPLOYER,
    indexes: [simpleIndex('equipment_type'), simpleIndex('next_check_date')]
  }),
  defineStore({
    name: 'equipment_checks', group: 'emergency', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('equipment_id'), simpleIndex('date')]
  }),
  defineStore({
    name: 'drills', group: 'emergency', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('date'), simpleIndex('drill_type'), simpleIndex('status')]
  }),
  defineStore({
    name: 'drill_findings', group: 'emergency', scope: P, pdca: CHECK, owner: EMPLOYER,
    indexes: [simpleIndex('drill_id'), simpleIndex('status')]
  })
];


/* ==========================================================================
   6. VALIDATION (runs once when this file loads)
   A mistake in the definitions above fails immediately with a clear message
   instead of causing a confusing database error later.
   ========================================================================== */

function assertValidConfig(defs) {
  const storeNames = new Set();
  const scopes = Object.values(SCOPE);
  const stages = Object.values(PDCA_STAGE);
  const owners = Object.values(OWNER_SCOPE);

  for (const def of defs) {
    if (typeof def.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(def.name)) {
      throw new Error('NASUR config: invalid store name "' + def.name + '".');
    }
    if (storeNames.has(def.name)) {
      throw new Error('NASUR config: duplicate store name "' + def.name + '".');
    }
    storeNames.add(def.name);

    if (!scopes.includes(def.scope)) {
      throw new Error('NASUR config: store "' + def.name + '" has an invalid scope.');
    }
    if (def.pdca !== null && !stages.includes(def.pdca)) {
      throw new Error('NASUR config: store "' + def.name + '" has an invalid PDCA stage.');
    }
    if (!owners.includes(def.owner)) {
      throw new Error('NASUR config: store "' + def.name + '" has an invalid owner scope.');
    }
    if (typeof def.group !== 'string' || def.group === '') {
      throw new Error('NASUR config: store "' + def.name + '" has no group.');
    }

    const indexNames = new Set();
    for (const index of def.indexes) {
      if (typeof index.name !== 'string' || index.name === '') {
        throw new Error('NASUR config: store "' + def.name + '" has an index without a name.');
      }
      if (indexNames.has(index.name)) {
        throw new Error('NASUR config: store "' + def.name + '" has duplicate index "' + index.name + '".');
      }
      indexNames.add(index.name);

      const paths = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath];
      if (paths.length === 0 || paths.some((path) => typeof path !== 'string' || path === '')) {
        throw new Error('NASUR config: index "' + index.name + '" in store "' + def.name + '" has an invalid key path.');
      }
      if (Array.isArray(index.keyPath) && index.multiEntry) {
        throw new Error('NASUR config: index "' + index.name + '" in store "' + def.name + '" cannot be both compound and multiEntry.');
      }
    }
  }
}

assertValidConfig(RAW_STORE_DEFS);


/* ==========================================================================
   7. PUBLIC STORE API
   ========================================================================== */

/** All store definitions, in creation order (frozen). */
export const STORE_DEFS = deepFreeze(RAW_STORE_DEFS);

/** All store names (frozen array of strings). */
export const STORE_NAMES = deepFreeze(STORE_DEFS.map((def) => def.name));

/**
 * Store name constants, e.g. STORES.OBSERVATIONS === 'observations'.
 * Keys are the store name in upper case ('ai_log' becomes AI_LOG).
 */
export const STORES = deepFreeze(
  Object.fromEntries(STORE_DEFS.map((def) => [def.name.toUpperCase(), def.name]))
);

/** Names of stores whose records must carry a project_id. */
export const PROJECT_SCOPED_STORES = deepFreeze(
  STORE_DEFS.filter((def) => def.scope === SCOPE.PROJECT).map((def) => def.name)
);

const DEFS_BY_NAME = new Map(STORE_DEFS.map((def) => [def.name, def]));

/** True when `name` is a known store. */
export function isStoreName(name) {
  return DEFS_BY_NAME.has(name);
}

/** Returns the definition for a store. Throws a clear error for unknown names. */
export function getStoreDef(name) {
  const def = DEFS_BY_NAME.get(name);
  if (!def) {
    throw new Error('NASUR: unknown store "' + String(name) + '".');
  }
  return def;
}

/** True when records in this store must carry a project_id. */
export function isProjectScoped(name) {
  return getStoreDef(name).scope === SCOPE.PROJECT;
}