/* NASUR - Unified CAPA Action Tracker service (Phase 4)
   One shared list of corrective / preventive actions from observations, incidents, RCA and manual entries.
   Home screen reads homeSnapshot() for open and overdue counts. */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import * as repo from './repo.js';
import { cleanText } from './sanitize.js';

export const ACTION_STORE = (STORES && STORES.ACTIONS) || 'actions';
const OBS_STORE = (STORES && STORES.OBSERVATIONS) || 'observations';

export const ACTION_STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
  { id: 'verified', label: 'Verified' }
];

export const PRIORITIES = [
  { id: 'low', label: 'Low', score: 1 },
  { id: 'medium', label: 'Medium', score: 2 },
  { id: 'high', label: 'High', score: 3 },
  { id: 'critical', label: 'Critical', score: 4 }
];

export const SOURCE_TYPES = ['observation', 'incident', 'rca', 'manual'];

function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayIso(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayIso(d);
}

function txt(v, max) {
  return cleanText(v == null ? '' : String(v), { max: max || 500 });
}

function uid() {
  return 'act_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function priorityScore(p) {
  const f = PRIORITIES.find((x) => x.id === p);
  return f ? f.score : 2;
}

export function priorityFromRisk(risk) {
  const r = String(risk || '').toLowerCase();
  return PRIORITIES.some((p) => p.id === r) ? r : 'medium';
}

export function isClosed(a) {
  return a && (a.status === 'done' || a.status === 'verified');
}

export function isOverdue(a, today) {
  return !!(a && !isClosed(a) && a.target_date && a.target_date < (today || todayIso()));
}

function changed(id) {
  emit(EVENTS.RECORD_SAVED, { store: ACTION_STORE, id });
}

async function all() {
  const rows = await repo.list(ACTION_STORE);
  return Array.isArray(rows) ? rows : [];
}

let chain = Promise.resolve();

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => null);
  return run;
}

async function nextActionNo(date) {
  const year = /^\d{4}/.test(date || '') ? date.slice(0, 4) : String(new Date().getFullYear());
  const re = new RegExp('^ACT-' + year + '-(\\d+)$');
  let max = 0;
  (await all()).forEach((a) => {
    const m = re.exec(a.action_no || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'ACT-' + year + '-' + String(max + 1).padStart(3, '0');
}

export function createAction(data) {
  return enqueue(async () => {
    const title = txt(data.title || data.description, 160);
    if (!title) throw new Error('Action description is required');
    const now = new Date().toISOString();
    const projectId = data.projectId !== undefined ? data.projectId : await repo.getActiveProjectId();
    const rec = {
      id: data.id || uid(),
      action_no: await nextActionNo(todayIso()),
      title,
      description: txt(data.description, 1500),
      source_type: SOURCE_TYPES.includes(data.source_type) ? data.source_type : 'manual',
      source_id: data.source_id || '',
      source_no: data.source_no || '',
      responsible: txt(data.responsible, 120),
      target_date: txt(data.target_date, 10),
      priority: PRIORITIES.some((p) => p.id === data.priority) ? data.priority : 'medium',
      status: ACTION_STATUSES.some((s) => s.id === data.status) ? data.status : 'open',
      closure_date: '',
      closure_remarks: '',
      kind: data.kind === 'preventive' ? 'preventive' : 'corrective',
      projectId: projectId || null,
      createdAt: now,
      updatedAt: now
    };
    await repo.save(ACTION_STORE, rec);
    changed(rec.id);
    return rec;
  });
}

export async function getAction(id) {
  return repo.get(ACTION_STORE, id);
}

export function updateAction(id, patch) {
  return enqueue(async () => {
    const cur = await repo.get(ACTION_STORE, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    if ('status' in patch) {
      if (isClosed(next) && !next.closure_date) next.closure_date = todayIso();
      if (!isClosed(next)) next.closure_date = '';
    }
    await repo.save(ACTION_STORE, next);
    if (isClosed(next) && !isClosed(cur)) await closeSource(next);
    changed(id);
    return next;
  });
}

export async function completeAction(id, remarks) {
  return updateAction(id, { status: 'done', closure_remarks: txt(remarks, 500) });
}

export async function verifyAction(id, remarks) {
  return updateAction(id, { status: 'verified', closure_remarks: txt(remarks, 500) });
}

export function removeAction(id) {
  return enqueue(async () => {
    await repo.remove(ACTION_STORE, id);
    changed(id);
    return true;
  });
}

async function closeSource(action) {
  if (action.source_type !== 'observation' || !action.source_id) return;
  try {
    const obs = await repo.get(OBS_STORE, action.source_id);
    if (!obs || obs.status === 'Closed' || obs.status === 'Verified') return;
    await repo.save(OBS_STORE, {
      ...obs,
      status: action.status === 'verified' ? 'Verified' : 'Closed',
      closure_date: obs.closure_date || action.closure_date || todayIso(),
      closure_remarks: obs.closure_remarks || action.closure_remarks || '',
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    /* source may be gone */
  }
}

/* Keeps one linked action in step with an observation's corrective action fields. */
export function syncFromObservation(obs) {
  return enqueue(async () => {
    const id = 'act_' + obs.id;
    const existing = await repo.get(ACTION_STORE, id);
    const text = String(obs.corrective_action || '').trim();
    if (!text) {
      if (existing) {
        await repo.remove(ACTION_STORE, id);
        changed(id);
      }
      return null;
    }
    const map = { Open: 'open', 'In Progress': 'in_progress', Closed: 'done', Verified: 'verified' };
    const now = new Date().toISOString();
    const rec = {
      ...(existing || {}),
      id,
      action_no: existing ? existing.action_no : await nextActionNo(obs.date),
      title: txt(text, 160),
      description: txt(text, 1500),
      source_type: 'observation',
      source_id: obs.id,
      source_no: obs.obs_no || '',
      responsible: txt(obs.responsible, 120),
      target_date: obs.target_date || '',
      priority: priorityFromRisk(obs.risk_rating),
      status: map[obs.status] || 'open',
      closure_date: obs.closure_date || '',
      closure_remarks: obs.closure_remarks || (existing && existing.closure_remarks) || '',
      kind: 'corrective',
      projectId: obs.projectId || null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    await repo.save(ACTION_STORE, rec);
    changed(id);
    return rec;
  });
}

/* ---------- Queries ---------- */

export function urgencySort(a, b) {
  const t = todayIso();
  const ao = isOverdue(a, t) ? 0 : 1;
  const bo = isOverdue(b, t) ? 0 : 1;
  if (ao !== bo) return ao - bo;
  const ad = a.target_date || '9999-12-31';
  const bd = b.target_date || '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return priorityScore(b.priority) - priorityScore(a.priority);
}

export async function listActions(filter) {
  const f = filter || {};
  const q = String(f.q || '').trim().toLowerCase();
  const rows = (await all()).filter((a) => {
    if (f.projectId && a.projectId !== f.projectId) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.source_type && a.source_type !== f.source_type) return false;
    if (f.source_id && a.source_id !== f.source_id) return false;
    if (f.openOnly && isClosed(a)) return false;
    if (f.overdueOnly && !isOverdue(a)) return false;
    if (f.responsible && String(a.responsible || '').toLowerCase().indexOf(String(f.responsible).toLowerCase()) < 0) return false;
    if (q && (a.title + ' ' + a.description + ' ' + a.responsible + ' ' + a.source_no + ' ' + a.action_no).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  rows.sort(urgencySort);
  return rows;
}

export function summarizeActions(rows) {
  const t = todayIso();
  const soon = addDays(t, 3);
  const s = { total: rows.length, open: 0, overdue: 0, dueToday: 0, dueSoon: 0, critical: 0, closed: 0 };
  rows.forEach((a) => {
    if (isClosed(a)) {
      s.closed++;
      return;
    }
    s.open++;
    if (isOverdue(a, t)) s.overdue++;
    else if (a.target_date === t) s.dueToday++;
    else if (a.target_date && a.target_date <= soon) s.dueSoon++;
    if (a.priority === 'critical' && !isClosed(a)) s.critical++;
  });
  return s;
}

/* For the Home "open_actions" widget */
export async function homeSnapshot(projectId) {
  const pid = projectId === undefined ? await repo.getActiveProjectId() : projectId;
  const rows = await listActions(pid ? { projectId: pid } : {});
  const open = rows.filter((a) => !isClosed(a));
  return { ...summarizeActions(rows), top: open.slice(0, 5) };
}

export async function countOverdue(projectId) {
  const rows = await listActions({ openOnly: true, projectId: projectId || undefined });
  return rows.filter((a) => isOverdue(a)).length;
}
