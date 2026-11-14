/* NASUR - JARVIS Core "Bloodline" service
   3-scope memory manager, approval gate, one-click rollback, deep-context privacy filter,
   user understanding profile and industry / role context resolver.
   Every future module plugs into this file. It does not change any existing store. */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import * as repo from './repo.js';
import { getUserConfig, updateUserConfig } from './config.js';
import { cleanText } from './sanitize.js';
import { getActiveRegion, getActiveRegionId, getActiveIndustryId } from './regions.js';
import { getProjectContext } from './clients.js';
import { getActiveProviders } from './settings.js';

const NOTES = STORES.MEMORY_NOTES;
const CAREER = STORES.CAREER_PROFILE;
const BLUEPRINT_URL = 'data/nasur_master_blueprint.json';

function txt(v, max) {
  return cleanText(v == null ? '' : String(v), { max: max || 500 });
}

function uid(p) {
  return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function nowIso() {
  return new Date().toISOString();
}

async function allNotes() {
  const rows = await repo.list(NOTES);
  return Array.isArray(rows) ? rows : [];
}

function changed(id) {
  emit(EVENTS.RECORD_SAVED, { store: NOTES, id });
}

/* =========================================================
   SCOPE 1: TEMPORARY SESSION (RAM + sessionStorage, cleared on reset)
   ========================================================= */

const SESSION_PREFIX = 'nasur.session.';
const sessionMap = new Map();
let sessionLoaded = false;

function loadSession() {
  if (sessionLoaded) return;
  sessionLoaded = true;
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(SESSION_PREFIX) === 0) sessionMap.set(k.slice(SESSION_PREFIX.length), JSON.parse(sessionStorage.getItem(k)));
    }
  } catch (e) {
    /* session storage unavailable */
  }
}

export function sessionSet(key, value) {
  loadSession();
  sessionMap.set(key, value);
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    /* ignore quota errors */
  }
}

export function sessionGet(key, fallback) {
  loadSession();
  return sessionMap.has(key) ? sessionMap.get(key) : fallback;
}

export function sessionDelete(key) {
  loadSession();
  sessionMap.delete(key);
  try {
    sessionStorage.removeItem(SESSION_PREFIX + key);
  } catch (e) {
    /* ignore */
  }
}

export function sessionClear() {
  loadSession();
  Array.from(sessionMap.keys()).forEach(sessionDelete);
  approvals.clear();
  return true;
}

/* =========================================================
   SCOPE 2: APPROVED PERSONAL MEMORY (saved only after explicit approval)
   ========================================================= */

export const PERSONAL_CATEGORIES = [
  { id: 'name', label: 'Name' },
  { id: 'communication_style', label: 'Communication style' },
  { id: 'education', label: 'Education' },
  { id: 'career_timeline', label: 'Career timeline' },
  { id: 'industries_worked', label: 'Industries worked' },
  { id: 'difficult_topics', label: 'Difficult topics' },
  { id: 'completed_lessons', label: 'Completed lessons' },
  { id: 'repeated_questions', label: 'Repeated questions' },
  { id: 'lessons_learned', label: 'Safety lessons learned' },
  { id: 'preferred_languages_formats', label: 'Preferred languages and formats' }
];

export function isMemoryEnabled() {
  return ((getUserConfig() || {}).memoryEnabled) !== false;
}

export async function setMemoryEnabled(on) {
  await updateUserConfig({ memoryEnabled: !!on });
  return isMemoryEnabled();
}

/* JARVIS proposes; nothing is stored. The UI shows the proposal and the user approves or rejects it. */
export function proposeMemory(item) {
  if (!isMemoryEnabled()) return null;
  const category = PERSONAL_CATEGORIES.some((c) => c.id === item.category) ? item.category : 'lessons_learned';
  const proposal = { pid: uid('prop'), category, title: txt(item.title, 120), detail: txt(item.detail, 800), source: txt(item.source || 'JARVIS suggestion', 120), at: nowIso() };
  if (!proposal.title && !proposal.detail) return null;
  const list = sessionGet('pending_memory', []);
  list.push(proposal);
  sessionSet('pending_memory', list);
  return proposal;
}

export function listProposals() {
  return sessionGet('pending_memory', []);
}

export function rejectMemory(pid) {
  sessionSet('pending_memory', listProposals().filter((p) => p.pid !== pid));
  return true;
}

export async function approveMemory(pid, edits) {
  const p = listProposals().find((x) => x.pid === pid);
  if (!p) return null;
  const saved = await saveMemory({ ...p, ...(edits || {}) }, { approved: true });
  rejectMemory(pid);
  return saved;
}

/* The only function that writes personal memory. It refuses anything the user has not approved. */
export async function saveMemory(item, opts) {
  if (!opts || opts.approved !== true) throw new Error('Memory can only be saved after the user approves it');
  if (!isMemoryEnabled()) throw new Error('Memory is switched off');
  const now = nowIso();
  const rec = {
    id: item.id || uid('pm'),
    kind: 'personal_memory',
    scope: 'approved_personal_memory',
    category: PERSONAL_CATEGORIES.some((c) => c.id === item.category) ? item.category : 'lessons_learned',
    title: txt(item.title, 120),
    detail: txt(item.detail, 800),
    source: item.source ? txt(item.source, 120) : 'user_approved',
    approvedAt: now,
    createdAt: item.createdAt || now,
    updatedAt: now
  };
  if (!rec.title && !rec.detail) throw new Error('Nothing to save');
  await repo.save(NOTES, rec);
  changed(rec.id);
  return rec;
}

export async function listMemories(filter) {
  const f = filter || {};
  return (await allNotes())
    .filter((r) => r.kind === 'personal_memory' && (!f.category || r.category === f.category))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function updateMemory(id, patch) {
  const cur = await repo.get(NOTES, id);
  if (!cur || cur.kind !== 'personal_memory') return null;
  const next = { ...cur, updatedAt: nowIso() };
  if (patch.title != null) next.title = txt(patch.title, 120);
  if (patch.detail != null) next.detail = txt(patch.detail, 800);
  if (patch.category && PERSONAL_CATEGORIES.some((c) => c.id === patch.category)) next.category = patch.category;
  await repo.save(NOTES, next);
  changed(id);
  return next;
}

export async function deleteMemory(id) {
  const cur = await repo.get(NOTES, id);
  if (!cur || cur.kind !== 'personal_memory') return false;
  await repo.remove(NOTES, id);
  changed(id);
  return true;
}

export async function clearPersonalMemory(opts) {
  if (!opts || opts.confirm !== true) throw new Error('Confirmation required');
  const rows = await listMemories();
  for (const r of rows) await repo.remove(NOTES, r.id);
  changed('all');
  return rows.length;
}

/* JARVIS must never claim to remember anything that is not stored */
export async function recall(topic) {
  if (!isMemoryEnabled()) return { enabled: false, found: false, items: [] };
  const words = String(topic || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const items = (await listMemories()).filter((m) => {
    const hay = (m.title + ' ' + m.detail + ' ' + m.category).toLowerCase();
    return words.length ? words.some((w) => hay.indexOf(w) >= 0) : true;
  });
  return { enabled: true, found: items.length > 0, items };
}

export async function recallMessage(topic) {
  const r = await recall(topic);
  if (!r.enabled) return 'Memory is switched off, so I am not keeping anything about you. You can switch it on in Settings.';
  if (!r.found) return 'I do not have that saved. Would you like me to save it for you?';
  return 'Here is what you approved me to remember: ' + r.items.slice(0, 5).map((m) => m.title + (m.detail ? ' (' + m.detail + ')' : '')).join('; ') + '.';
}

/* =========================================================
   SCOPE 3: EMPLOYER CONFIDENTIAL DATA (isolated per client / project)
   ========================================================= */

export async function saveEmployerData(item) {
  let clientId = item.clientId || null;
  let projectId = item.projectId || null;
  if (!clientId && !projectId) {
    const ctx = await getProjectContext();
    if (ctx) {
      clientId = ctx.clientId;
      projectId = ctx.projectId;
    }
  }
  if (!clientId && !projectId) throw new Error('Employer data must belong to a client or project');
  const now = nowIso();
  const rec = {
    id: item.id || uid('ec'),
    kind: 'employer_data',
    scope: 'employer_confidential_data',
    clientId,
    projectId,
    title: txt(item.title, 120),
    detail: txt(item.detail, 1500),
    tags: (Array.isArray(item.tags) ? item.tags : []).map((t) => txt(t, 30)).filter(Boolean).slice(0, 8),
    createdAt: item.createdAt || now,
    updatedAt: now
  };
  if (!rec.title) throw new Error('Title is required');
  await repo.save(NOTES, rec);
  changed(rec.id);
  return rec;
}

/* Never returns data from another client or project */
export async function listEmployerData(scope) {
  const s = scope || {};
  if (!s.clientId && !s.projectId) throw new Error('Specify clientId or projectId');
  return (await allNotes()).filter((r) => r.kind === 'employer_data' && (!s.clientId || r.clientId === s.clientId) && (!s.projectId || r.projectId === s.projectId));
}

export async function removeEmployerData(id) {
  const cur = await repo.get(NOTES, id);
  if (!cur || cur.kind !== 'employer_data') return false;
  await repo.remove(NOTES, id);
  changed(id);
  return true;
}

export function confidentialityScan(text, names) {
  const t = String(text || '');
  const hits = [];
  (names || []).filter(Boolean).forEach((n) => {
    if (t.toLowerCase().indexOf(String(n).toLowerCase()) >= 0) hits.push('Contains the name "' + n + '"');
  });
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) hits.push('Contains an email address');
  if (/\d{6,}/.test(t)) hits.push('Contains a long number (ID, phone or contract number)');
  return hits;
}

/* Moving an employer item to the Career Portfolio: never automatic, always with a confidentiality reminder */
export async function prepareCareerPortfolioItem(employerId) {
  const src = await repo.get(NOTES, employerId);
  if (!src || src.kind !== 'employer_data') throw new Error('Employer item not found');
  const ctx = await getProjectContext(src.projectId || undefined);
  const names = [ctx && ctx.client && ctx.client.name, ctx && ctx.project && ctx.project.name];
  return {
    draft: { category: 'career_timeline', title: src.title, detail: src.detail },
    warnings: confidentialityScan(src.title + ' ' + src.detail, names),
    reminder: 'This came from employer confidential data. Remove client names, project names, people, figures and anything your employer would not want shared before you save it to your personal portfolio.'
  };
}

export async function commitPortfolioItem(draft, opts) {
  if (!opts || opts.confidentialityRemoved !== true) throw new Error('Confirm that confidential details were removed');
  return saveMemory({ category: 'career_timeline', title: draft.title, detail: draft.detail, source: 'career_portfolio' }, { approved: true });
}

/* =========================================================
   USER UNDERSTANDING PROFILE + PREFERENCES (entered by the user, so no approval step)
   ========================================================= */

const PROFILE_ID = 'user_profile';
const PREFS_ID = 'user_preferences';

export const EXPERIENCE_BANDS = ['new', 'developing', 'experienced', 'senior'];

const PROFILE_DEFAULTS = { whoAmI: '', currentRole: '', industry: '', experienceLevel: '', learning: '', learningStyle: '', nextGoal: '' };
const PREFS_DEFAULTS = { languages: [], answerLength: '', tone: '', formats: '', challengeStyle: 'respectful' };

export async function getUserProfile() {
  const r = await repo.get(NOTES, PROFILE_ID);
  return { ...PROFILE_DEFAULTS, ...((r && r.payload) || {}) };
}

export async function saveUserProfile(patch) {
  const cur = await getUserProfile();
  const next = { ...cur };
  Object.keys(PROFILE_DEFAULTS).forEach((k) => {
    if (k in (patch || {})) next[k] = txt(patch[k], 200);
  });
  if (next.experienceLevel && !EXPERIENCE_BANDS.includes(next.experienceLevel)) next.experienceLevel = '';
  const prev = await repo.get(NOTES, PROFILE_ID);
  const now = nowIso();
  await repo.save(NOTES, { id: PROFILE_ID, kind: 'user_profile', scope: 'approved_personal_memory', title: 'User profile', detail: next.currentRole || '', payload: next, createdAt: prev ? prev.createdAt : now, updatedAt: now });
  return next;
}

export async function getUserPreferences() {
  const r = await repo.get(NOTES, PREFS_ID);
  return { ...PREFS_DEFAULTS, ...((r && r.payload) || {}) };
}

export async function saveUserPreferences(patch) {
  const cur = await getUserPreferences();
  const p = patch || {};
  const next = {
    languages: Array.isArray(p.languages) ? p.languages.map((l) => txt(l, 20)).filter(Boolean).slice(0, 7) : cur.languages,
    answerLength: 'answerLength' in p ? txt(p.answerLength, 30) : cur.answerLength,
    tone: 'tone' in p ? txt(p.tone, 60) : cur.tone,
    formats: 'formats' in p ? txt(p.formats, 100) : cur.formats,
    challengeStyle: 'challengeStyle' in p ? txt(p.challengeStyle, 30) : cur.challengeStyle
  };
  const prev = await repo.get(NOTES, PREFS_ID);
  const now = nowIso();
  await repo.save(NOTES, { id: PREFS_ID, kind: 'user_preferences', scope: 'approved_personal_memory', title: 'User preferences', detail: '', payload: next, createdAt: prev ? prev.createdAt : now, updatedAt: now });
  return next;
}

/* =========================================================
   BLUEPRINT + INDUSTRY / ROLE CONTEXT RESOLVER
   ========================================================= */

let blueprint = null;

const BLUEPRINT_FALLBACK = {
  schema_version: 1,
  industry_hooks: {
    manufacturing: { label: 'Manufacturing', status: 'active', hazards: [], tbt_topics: [], checklists: [], legal_focus: [], kpis: [] },
    construction: { label: 'Construction', status: 'active', hazards: [], tbt_topics: [], checklists: [], legal_focus: [], kpis: [] },
    oilgas: { label: 'Oil and Gas', status: 'active', hazards: [], tbt_topics: [], checklists: [], legal_focus: [], kpis: [] },
    marine: { label: 'Shipping and Marine', status: 'active', hazards: [], tbt_topics: [], checklists: [], legal_focus: [], kpis: [] }
  },
  decision_flow: { steps: ['situation', 'what_i_see', 'what_to_check', 'possible_hazards', 'controls', 'who_to_inform', 'record_follow_up'], guidance_types: [] },
  deep_context_levels: [],
  career: { ladder: [] }
};

export async function loadBlueprint() {
  if (blueprint) return blueprint;
  try {
    const res = await fetch(BLUEPRINT_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    blueprint = await res.json();
  } catch (e) {
    blueprint = BLUEPRINT_FALLBACK;
  }
  return blueprint;
}

export function getBlueprint() {
  return blueprint || BLUEPRINT_FALLBACK;
}

export function getIndustryHook(industryId) {
  const hooks = getBlueprint().industry_hooks || {};
  return hooks[industryId] || null;
}

export function listIndustryHooks() {
  const hooks = getBlueprint().industry_hooks || {};
  return Object.keys(hooks).map((id) => ({ id, ...hooks[id] }));
}

const LEVEL_TO_BAND = { beginner: 'new', assistant: 'new', officer: 'developing', engineer: 'experienced', manager: 'senior' };

/* ROLE + INDUSTRY + EXPERIENCE + COUNTRY + LANGUAGE + PREFERENCES. Manual choices always win. */
export async function resolveContext() {
  await loadBlueprint();
  const cfg = getUserConfig() || {};
  const profile = await getUserProfile();
  const prefs = await getUserPreferences();
  let career = null;
  try {
    career = await repo.get(CAREER, 'me');
  } catch (e) {
    career = null;
  }
  const ctx = await getProjectContext();
  const sources = {};
  const pick = (name, manual, auto) => {
    if (manual) {
      sources[name] = 'manual';
      return manual;
    }
    sources[name] = 'auto';
    return auto;
  };
  const hooks = getBlueprint().industry_hooks || {};
  const role = pick('role', profile.currentRole, (career && career.currentLevel) || 'beginner');
  const industry = pick('industry', hooks[profile.industry] ? profile.industry : '', getActiveIndustryId());
  const levelKey = String(role).toLowerCase();
  const experience = pick('experience', profile.experienceLevel, LEVEL_TO_BAND[levelKey] || (career && LEVEL_TO_BAND[career.currentLevel]) || 'new');
  const language = pick('language', cfg.language, getActiveRegion().languages[0]);
  const resolved = {
    role,
    industry,
    experience,
    country: getActiveRegionId(),
    countryLabel: getActiveRegion().label,
    language,
    preferences: prefs,
    profile,
    projectId: ctx ? ctx.projectId : null,
    clientId: ctx ? ctx.clientId : null,
    auditStandard: ctx ? ctx.auditStandard : null,
    sources
  };
  resolved.hook = getIndustryHook(industry);
  return resolved;
}

/* Short text to put at the top of an AI prompt. Contains profile level facts only, never confidential records. */
export async function contextForPrompt() {
  const c = await resolveContext();
  const lines = ['Role: ' + c.role, 'Industry: ' + (c.hook ? c.hook.label : c.industry), 'Experience: ' + c.experience, 'Country: ' + c.countryLabel, 'Language: ' + c.language];
  if (c.preferences.answerLength) lines.push('Answer length: ' + c.preferences.answerLength);
  if (c.preferences.tone) lines.push('Tone: ' + c.preferences.tone);
  if (c.profile.learningStyle) lines.push('Learning style: ' + c.profile.learningStyle);
  return lines.join('. ') + '.';
}

/* =========================================================
   SAFETY DECISION SUPPORT + CONSTRUCTIVE CHALLENGE
   ========================================================= */

const STEP_PROMPTS = {
  situation: 'Describe the situation in one or two lines.',
  what_i_see: 'What can you see, hear or smell right now?',
  what_to_check: 'What must be checked first (permit, isolation, gas test, competence, weather)?',
  possible_hazards: 'What could go wrong and who could be hurt?',
  controls: 'Which controls apply, from elimination down to PPE?',
  who_to_inform: 'Who must be told (supervisor, permit issuer, HSE manager, client, emergency services)?',
  record_follow_up: 'What must be recorded and who owns the follow-up action?'
};

export function decisionFrame(situation) {
  const flow = (getBlueprint().decision_flow || {});
  return {
    situation: txt(situation, 400),
    steps: (flow.steps || Object.keys(STEP_PROMPTS)).map((id) => ({ id, label: id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), prompt: STEP_PROMPTS[id] || '' })),
    guidanceTypes: flow.guidance_types || [],
    reminder: 'Separate general guidance, the site procedure, the competent person decision and the emergency action. The official site procedure and emergency plan come first.'
  };
}

const UNSAFE = [
  { re: /(skip|bypass|without|no)\s+(the\s+)?(lockout|loto|isolation)/i, risk: 'Working without isolation can release stored energy and kill.', safer: 'Isolate, lock, tag and test for dead or zero energy before work starts.' },
  { re: /(without|no|skip)\s+(a\s+)?(permit|ptw)/i, risk: 'Work without a permit removes the check that hazards are controlled.', safer: 'Get the permit issued, even for short jobs, and brief the team on its conditions.' },
  { re: /(no|without|skip|remove)\s+(the\s+)?(harness|fall protection|guardrail|edge protection)/i, risk: 'Falls from height are a leading cause of fatalities.', safer: 'Fit guardrails or use a harness on a tested anchor, with a rescue plan.' },
  { re: /(remove|take off|bypass|disable)\s+(the\s+)?(guard|interlock|safety switch|e-?stop)/i, risk: 'Defeating a guard or interlock exposes people to moving parts.', safer: 'Keep guards fitted. Isolate the machine if access is needed and fix the root problem.' },
  { re: /(enter|go into|get into)\s+(the\s+)?(tank|confined space|manhole|vessel).*(without|no).*(gas|test|permit|standby)/i, risk: 'Confined spaces can have toxic gas or low oxygen with no warning.', safer: 'Test the atmosphere, issue an entry permit and keep a trained standby with a rescue plan.' },
  { re: /(hot work|welding|cutting).*(without|no).*(permit|fire watch|extinguisher|blanket)/i, risk: 'Sparks can ignite materials far from the work.', safer: 'Clear or cover combustibles, have an extinguisher ready and post a fire watch.' },
  { re: /(overload|over load|exceed).*(crane|sling|hoist|lift)/i, risk: 'Overloading lifting gear can cause dropped loads and collapse.', safer: 'Check the load weight and chart, use correctly rated gear and a lift plan.' },
  { re: /(no|without|skip)\s+(ppe|helmet|gloves|goggles|respirator|ear protection)/i, risk: 'PPE is the last line of defence and often the only one left.', safer: 'Select PPE for the task hazard and check fit and condition before starting.' }
];

export function challengeCheck(text) {
  const items = UNSAFE.filter((u) => u.re.test(String(text || ''))).map((u) => ({ risk: u.risk, safer: u.safer }));
  if (!items.length) return { flagged: false, items: [], message: '' };
  return {
    flagged: true,
    items,
    message: 'I hear you, and the decision is yours to make with your competent person. But I would not be honest if I stayed quiet. ' + items.map((i) => i.risk + ' Safer option: ' + i.safer).join(' ')
  };
}

/* =========================================================
   APPROVAL GATE + LEAST-PRIVILEGE PERMISSIONS
   ========================================================= */

const approvals = new Map();
const approvalListeners = new Set();

export function onApprovalRequest(fn) {
  approvalListeners.add(fn);
  return () => approvalListeners.delete(fn);
}

export function createApproval(spec) {
  const id = uid('apr');
  let resolver = null;
  const promise = new Promise((resolve) => {
    resolver = resolve;
  });
  const item = { id, type: txt(spec.type || 'action', 40), title: txt(spec.title, 140), detail: txt(spec.detail, 600), risk: ['low', 'medium', 'high'].includes(spec.risk) ? spec.risk : 'medium', payload: spec.payload || null, at: nowIso(), resolve: resolver };
  approvals.set(id, item);
  approvalListeners.forEach((fn) => {
    try {
      fn(publicApproval(item));
    } catch (e) {
      /* ignore listener errors */
    }
  });
  return { id, promise };
}

function publicApproval(a) {
  return { id: a.id, type: a.type, title: a.title, detail: a.detail, risk: a.risk, payload: a.payload, at: a.at };
}

export function listPendingApprovals() {
  return Array.from(approvals.values()).map(publicApproval);
}

export function resolveApproval(id, approved) {
  const a = approvals.get(id);
  if (!a) return false;
  approvals.delete(id);
  a.resolve(approved === true);
  return true;
}

/* Run an action only after the user says yes */
export async function gate(spec, executor) {
  const { promise } = createApproval(spec);
  const ok = await promise;
  if (!ok) return { approved: false, result: null };
  return { approved: true, result: await executor() };
}

export const PERMISSIONS = ['read_records', 'write_records', 'external_fetch', 'microphone', 'camera', 'speak', 'export_files', 'sync_backup'];

export function listPermissions() {
  const grants = (getUserConfig() || {}).permissions || {};
  return PERMISSIONS.map((p) => {
    const g = grants[p];
    const active = !!(g && (!g.expires || new Date(g.expires).getTime() > Date.now()));
    return { id: p, granted: active, expires: active && g.expires ? g.expires : '' };
  });
}

export function hasPermission(name) {
  const p = listPermissions().find((x) => x.id === name);
  return !!(p && p.granted);
}

export async function grantPermission(name, opts) {
  if (!PERMISSIONS.includes(name)) throw new Error('Unknown permission');
  if (!opts || opts.userApproved !== true) throw new Error('Permission must be approved by the user');
  const grants = { ...((getUserConfig() || {}).permissions || {}) };
  grants[name] = { at: nowIso(), expires: opts.ttlMinutes ? new Date(Date.now() + opts.ttlMinutes * 60000).toISOString() : '' };
  await updateUserConfig({ permissions: grants });
  return true;
}

export async function revokePermission(name) {
  const grants = { ...((getUserConfig() || {}).permissions || {}) };
  delete grants[name];
  await updateUserConfig({ permissions: grants });
  return true;
}

/* =========================================================
   ONE-CLICK ROLLBACK SNAPSHOTS (for any AI generated change)
   ========================================================= */

const MAX_SNAPSHOTS = 20;
const MAX_RECORD_BYTES = 1500000;

export async function snapshotBefore(label, targets) {
  const entries = [];
  for (const t of targets || []) {
    let rec = null;
    try {
      rec = await repo.get(t.store, t.id);
    } catch (e) {
      rec = null;
    }
    const tooBig = rec && JSON.stringify(rec).length > MAX_RECORD_BYTES;
    entries.push({ store: t.store, id: t.id, existed: !!rec, record: tooBig ? null : rec, skipped: !!tooBig });
  }
  const snap = { id: uid('rb'), kind: 'rollback_snapshot', scope: 'approved_personal_memory', title: txt(label, 120) || 'Change', detail: entries.length + ' item(s)', payload: { entries }, rolledBackAt: '', createdAt: nowIso(), updatedAt: nowIso() };
  await repo.save(NOTES, snap);
  await pruneSnapshots();
  return snap;
}

async function pruneSnapshots() {
  const snaps = (await allNotes()).filter((r) => r.kind === 'rollback_snapshot').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (let i = 0; i < snaps.length - MAX_SNAPSHOTS; i++) await repo.remove(NOTES, snaps[i].id);
}

export async function listSnapshots() {
  return (await allNotes()).filter((r) => r.kind === 'rollback_snapshot').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function rollback(snapshotId) {
  const snap = await repo.get(NOTES, snapshotId);
  if (!snap || snap.kind !== 'rollback_snapshot') throw new Error('Snapshot not found');
  if (snap.rolledBackAt) throw new Error('Already rolled back');
  let restored = 0;
  for (const e of snap.payload.entries) {
    if (e.skipped) continue;
    if (e.existed && e.record) await repo.save(e.store, e.record);
    else if (!e.existed) await repo.remove(e.store, e.id);
    restored++;
  }
  await repo.save(NOTES, { ...snap, rolledBackAt: nowIso(), updatedAt: nowIso() });
  try {
    const t = await import('./templates.js');
    await t.loadCustomColumns();
  } catch (e) {
    /* templates cache refresh is best effort */
  }
  changed(snapshotId);
  return { restored, skipped: snap.payload.entries.filter((e) => e.skipped).length };
}

export async function undoLast() {
  const next = (await listSnapshots()).find((s) => !s.rolledBackAt);
  if (!next) throw new Error('Nothing to undo');
  return rollback(next.id);
}

export async function withRollback(label, targets, fn) {
  const snap = await snapshotBefore(label, targets);
  const result = await fn();
  return { result, snapshotId: snap.id };
}

/* =========================================================
   DEEP CONTEXT CONSENT FILTER
   OFF -> PAGE CONTEXT ONLY -> FIELD METADATA -> USER-SELECTED TEXT
   ========================================================= */

export const DEEP_LEVELS = ['off', 'page_context_only', 'field_metadata', 'user_selected_text'];

export function getDeepContextLevel() {
  const l = (getUserConfig() || {}).deepContextLevel;
  return DEEP_LEVELS.includes(l) ? l : 'page_context_only';
}

export async function setDeepContextLevel(level) {
  if (!DEEP_LEVELS.includes(level)) throw new Error('Unknown level');
  await updateUserConfig({ deepContextLevel: level });
  return level;
}

export function redact(text) {
  return String(text == null ? '' : text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number removed]')
    .replace(/\b\d{6,}\b/g, '[number removed]');
}

/* input: { page, fields:[{key,label,type,value,confidential}], selectedText, approvedRaw }
   Typed values are never included. Selected text is included only at the highest level and is redacted unless approvedRaw is true. */
export function buildAiContext(input, levelOverride) {
  const level = levelOverride && DEEP_LEVELS.includes(levelOverride) ? levelOverride : getDeepContextLevel();
  const i = input || {};
  const out = { level };
  if (level === 'off') return out;
  out.page = txt(i.page, 80);
  if (level === 'page_context_only') return out;
  out.fields = (Array.isArray(i.fields) ? i.fields : [])
    .filter((f) => f && f.key && f.type !== 'password')
    .slice(0, 60)
    .map((f) => ({ key: txt(f.key, 40), label: txt(f.label, 60), type: txt(f.type, 20), filled: !!String(f.value == null ? '' : f.value).trim(), confidential: !!f.confidential }));
  if (level === 'field_metadata') return out;
  const sel = String(i.selectedText || '').slice(0, 2000);
  if (sel) out.selectedText = i.approvedRaw === true ? sel : redact(sel);
  return out;
}

/* =========================================================
   AI VAULT STATUS
   ========================================================= */

export function getVaultStatus() {
  const providers = getActiveProviders();
  return { mode: providers.length > 1 ? 'multi_key_fallback' : providers.length === 1 ? 'single_key' : 'free_offline', providers, offlineAvailable: true };
}

export default {
  sessionSet, sessionGet, sessionDelete, sessionClear,
  isMemoryEnabled, setMemoryEnabled, proposeMemory, listProposals, approveMemory, rejectMemory, saveMemory, listMemories, updateMemory, deleteMemory, clearPersonalMemory, recall, recallMessage,
  saveEmployerData, listEmployerData, removeEmployerData, prepareCareerPortfolioItem, commitPortfolioItem, confidentialityScan,
  getUserProfile, saveUserProfile, getUserPreferences, saveUserPreferences,
  loadBlueprint, getBlueprint, getIndustryHook, listIndustryHooks, resolveContext, contextForPrompt,
  decisionFrame, challengeCheck,
  onApprovalRequest, createApproval, listPendingApprovals, resolveApproval, gate, listPermissions, hasPermission, grantPermission, revokePermission,
  snapshotBefore, listSnapshots, rollback, undoLast, withRollback,
  getDeepContextLevel, setDeepContextLevel, redact, buildAiContext, getVaultStatus
};
