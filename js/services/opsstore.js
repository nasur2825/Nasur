/* NASUR - Operations record store (Phase 6)
   One safe place for permits, risk assessments, emergency records, documents, certificates and audits.
   Records live in the existing memory_notes store, told apart by the `kind` field, so no new
   IndexedDB store is needed. Every record is scoped to the active client / project when there is one. */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import * as repo from './repo.js';
import { cleanText } from './sanitize.js';
import { getProjectContext } from './clients.js';
import { getActiveRegionId } from './regions.js';

const NOTES = STORES.MEMORY_NOTES;

export const KINDS = {
  PERMIT: 'ptw_permit',
  RA: 'ra_jsa',
  PLAN: 'emergency_plan',
  CONTACT: 'emergency_contact',
  MUSTER: 'muster_point',
  DRILL: 'drill_record',
  EQUIP: 'equipment_check',
  DOC: 'doc_item',
  CERT: 'certificate',
  AUDIT: 'audit_run'
};

export const PREFIX = { PERMIT: 'PTW', RA: 'JSA', DRILL: 'DRL', EQUIP: 'EQC', DOC: 'DOC', CERT: 'CRT', AUDIT: 'AUD' };

export function txt(v, max) {
  return cleanText(v == null ? '' : String(v), { max: max || 500 });
}

export function uid(p) {
  return (p || 'ops') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayIso(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

export function addDaysIso(iso, n) {
  const d = new Date((iso || todayIso()) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayIso(d);
}

/* Whole days from today to the date. Negative means the date has passed. */
export function daysUntil(iso, from) {
  if (!iso) return null;
  const a = new Date((from || todayIso()) + 'T00:00:00').getTime();
  const b = new Date(iso + 'T00:00:00').getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function formatDuration(ms) {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (neg ? '-' : '') + pad(hh) + ':' + pad(mm) + ':' + pad(ss);
}

let chain = Promise.resolve();

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => null);
  return run;
}

function changed(id, kind) {
  emit(EVENTS.RECORD_SAVED, { store: NOTES, id, kind });
}

async function allOfKind(kind) {
  const rows = await repo.list(NOTES);
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.kind === kind);
}

/* ---------- Queries ---------- */

export async function listOps(kind, filter) {
  const f = filter || {};
  const active = f.all ? null : f.projectId !== undefined ? f.projectId : await repo.getActiveProjectId();
  const q = String(f.q || '').trim().toLowerCase();
  const rows = (await allOfKind(kind)).filter((r) => {
    if (active && r.projectId && r.projectId !== active) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.statuses && !f.statuses.includes(r.status)) return false;
    if (q && JSON.stringify(r).toLowerCase().indexOf(q) < 0) return false;
    if (typeof f.predicate === 'function' && !f.predicate(r)) return false;
    return true;
  });
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return rows;
}

export async function getOps(id) {
  if (!id) return null;
  const r = await repo.get(NOTES, id);
  return r && Object.values(KINDS).includes(r.kind) ? r : null;
}

export async function countOps(kind, filter) {
  return (await listOps(kind, filter)).length;
}

/* ---------- Numbering ---------- */

export async function nextNumber(prefixKey, dateIso, kind) {
  const prefix = PREFIX[prefixKey] || prefixKey;
  const year = /^\d{4}/.test(dateIso || '') ? dateIso.slice(0, 4) : String(new Date().getFullYear());
  const re = new RegExp('^' + prefix + '-' + year + '-(\\d+)$');
  let max = 0;
  (await allOfKind(kind)).forEach((r) => {
    const m = re.exec(r.number || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + year + '-' + String(max + 1).padStart(3, '0');
}

/* ---------- Writes ---------- */

/* Create or replace a record. opts.prefix numbers a new record (for example 'PERMIT'). */
export function saveOps(kind, data, opts) {
  const o = opts || {};
  return enqueue(async () => {
    const now = new Date().toISOString();
    const prev = data.id ? await getOps(data.id) : null;
    const ctx = prev ? null : await getProjectContext();
    const rec = {
      ...(prev || {}),
      ...data,
      id: prev ? prev.id : data.id || uid(kind.slice(0, 4)),
      kind,
      updatedAt: now
    };
    if (!prev) {
      rec.createdAt = now;
      rec.projectId = data.projectId !== undefined ? data.projectId : ctx ? ctx.projectId : null;
      rec.clientId = data.clientId !== undefined ? data.clientId : ctx ? ctx.clientId : null;
      rec.country = data.country || (ctx ? ctx.country : getActiveRegionId());
      if (o.prefix && !rec.number) rec.number = await nextNumber(o.prefix, o.date || todayIso(), kind);
    }
    rec.title = txt(rec.title || rec.number || kind, 160);
    rec.detail = txt(rec.detail || rec.summary || rec.description || '', 300);
    await repo.save(NOTES, rec);
    changed(rec.id, kind);
    return rec;
  });
}

/* Merge a change into an existing record. patch may be an object or a function (rec) => object. */
export function patchOps(id, patch) {
  return enqueue(async () => {
    const cur = await getOps(id);
    if (!cur) return null;
    const delta = typeof patch === 'function' ? patch(cur) : patch;
    const next = { ...cur, ...delta, updatedAt: new Date().toISOString() };
    await repo.save(NOTES, next);
    changed(id, cur.kind);
    return next;
  });
}

export function removeOps(id) {
  return enqueue(async () => {
    const cur = await getOps(id);
    if (!cur) return false;
    await repo.remove(NOTES, id);
    changed(id, cur.kind);
    return true;
  });
}

export function logEntry(rec, event, by) {
  const log = Array.isArray(rec.log) ? rec.log.slice(-199) : [];
  log.push({ at: new Date().toISOString(), event: txt(event, 200), by: txt(by || '', 80) });
  return log;
}
