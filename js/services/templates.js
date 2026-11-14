/* NASUR - Custom template store (Phase 4)
   Holds everything JARVIS or the user adds without code changes:
   custom observation columns, report templates, checklists / forms and local safety rules.
   Stored in the MEMORY_NOTES store with a `kind` field. Items proposed by JARVIS stay "pending"
   until the user says Okay. */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import * as repo from './repo.js';
import { cleanText } from './sanitize.js';

const NOTES = STORES.MEMORY_NOTES;

export const KINDS = ['custom_column', 'report_template', 'checklist', 'safety_rule'];
export const COLUMN_TYPES = ['text', 'long', 'select', 'date', 'number', 'yesno'];
export const SECTION_TYPES = ['summary', 'kpi', 'risk_table', 'contractor_table', 'category_table', 'observation_table', 'photo_cards', 'open_actions', 'text', 'signoff'];
export const CHECKLIST_PURPOSES = ['inspection', 'ptw', 'jsa', 'audit', 'tbt', 'equipment', 'other'];
export const MAX_CUSTOM_COLUMNS = 12;

const RESERVED = [
  'obs_no', 'date', 'time', 'project', 'contractor', 'location', 'activity', 'hazard_category', 'obs_type', 'risk_rating',
  'description', 'immediate_action', 'root_cause', 'corrective_action', 'responsible', 'target_date', 'closure_date', 'status',
  'verified_by', 'photo_before', 'photo_after', 'reported_by', 'shift_weather', 'legal_clause', 'hierarchy', 'residual_risk',
  'cost_impact', 'closure_remarks', 'id', 'recordedAt', 'projectId', 'clientId', 'country', 'createdAt', 'updatedAt', 'backfilled'
];

function txt(v, max) {
  return cleanText(v == null ? '' : String(v), { max: max || 200 });
}

export function slug(s, max) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max || 30);
}

function uid(kind, name) {
  return 'tpl_' + kind + '_' + (slug(name, 24) || 'item') + '_' + Date.now().toString(36).slice(-4);
}

/* ---------- Validation (everything JARVIS returns passes through here) ---------- */

function cleanOptions(list) {
  return (Array.isArray(list) ? list : []).map((o) => txt(o, 40)).filter(Boolean).filter((o, i, a) => a.indexOf(o) === i).slice(0, 12);
}

export function validatePayload(kind, p) {
  const errors = [];
  const src = p && typeof p === 'object' ? p : {};
  let clean = null;

  if (kind === 'custom_column') {
    const label = txt(src.label, 40);
    const type = COLUMN_TYPES.includes(src.type) ? src.type : 'text';
    const key = 'x_' + (slug(src.key || label, 24) || 'field');
    if (label.length < 2) errors.push('Column label is required');
    if (RESERVED.includes(key)) errors.push('Column key is reserved');
    const options = type === 'select' ? cleanOptions(src.options) : [];
    if (type === 'select' && options.length < 2) errors.push('Dropdown needs at least 2 options');
    clean = { key, label, type, options, help: txt(src.help, 200), width: Math.min(300, Math.max(100, parseInt(src.width, 10) || 160)) };
  } else if (kind === 'report_template') {
    const title = txt(src.title, 80);
    if (title.length < 3) errors.push('Report title is required');
    const sections = (Array.isArray(src.sections) ? src.sections : [])
      .filter((s) => s && SECTION_TYPES.includes(s.type))
      .slice(0, 16)
      .map((s) => ({
        type: s.type,
        title: txt(s.title, 80),
        text: s.type === 'text' ? txt(s.text, 1500) : '',
        columns: Array.isArray(s.columns) ? s.columns.map((c) => slug(c, 30)).filter(Boolean).slice(0, 10) : [],
        limit: Math.min(200, Math.max(1, parseInt(s.limit, 10) || 50))
      }));
    if (!sections.length) errors.push('Report needs at least one valid section');
    const roles = (Array.isArray(src.signoffRoles) ? src.signoffRoles : ['Prepared By', 'Reviewed By', 'Approved By']).map((r) => txt(r, 40)).filter(Boolean).slice(0, 5);
    clean = { title, subtitle: txt(src.subtitle, 120), sections, signoffRoles: roles.length ? roles : ['Prepared By', 'Reviewed By', 'Approved By'], orientation: src.orientation === 'landscape' ? 'landscape' : 'portrait' };
  } else if (kind === 'checklist') {
    const title = txt(src.title, 100);
    if (title.length < 3) errors.push('Checklist title is required');
    const items = (Array.isArray(src.items) ? src.items : [])
      .map((it, i) => {
        const o = typeof it === 'string' ? { text: it } : it || {};
        return {
          id: 'i' + (i + 1),
          text: txt(o.text, 240),
          type: ['yesno', 'text', 'number'].includes(o.type) ? o.type : 'yesno',
          critical: !!o.critical,
          reference: txt(o.reference, 120)
        };
      })
      .filter((it) => it.text)
      .slice(0, 80);
    if (items.length < 2) errors.push('Checklist needs at least 2 items');
    clean = { title, purpose: CHECKLIST_PURPOSES.includes(src.purpose) ? src.purpose : 'inspection', category: txt(src.category, 60), items };
  } else if (kind === 'safety_rule') {
    const title = txt(src.title, 140);
    const summary = txt(src.summary, 700);
    if (title.length < 3) errors.push('Rule title is required');
    if (summary.length < 10) errors.push('Rule summary is required');
    clean = {
      title,
      summary,
      clause: txt(src.clause, 200),
      source: txt(src.source, 200),
      region: txt(src.region || 'all', 20),
      industry: txt(src.industry || 'all', 20),
      category: txt(src.category, 60),
      appliesTo: cleanOptions(src.appliesTo)
    };
  } else {
    errors.push('Unknown template kind');
  }
  return { ok: !errors.length, errors, clean };
}

/* ---------- Storage ---------- */

async function allNotes() {
  const rows = await repo.list(NOTES);
  return Array.isArray(rows) ? rows : [];
}

function changed(id) {
  emit(EVENTS.RECORD_SAVED, { store: NOTES, id });
}

export async function listTemplates(kind, opts) {
  const o = opts || {};
  const status = o.status || 'approved';
  return (await allNotes())
    .filter((r) => r.kind === kind && (status === 'any' || (r.status || 'approved') === status))
    .filter((r) => !o.region || !r.payload || !r.payload.region || r.payload.region === 'all' || r.payload.region === o.region)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getTemplate(id) {
  const r = await repo.get(NOTES, id);
  return r && KINDS.includes(r.kind) ? r : null;
}

export async function saveTemplate(kind, payload, meta) {
  const m = meta || {};
  const v = validatePayload(kind, payload);
  if (!v.ok) throw new Error(v.errors.join('. '));
  if (kind === 'custom_column') {
    const existing = await listTemplates('custom_column', { status: 'any' });
    const dup = existing.find((r) => r.payload.key === v.clean.key && r.id !== m.id);
    if (dup) throw new Error('A column named "' + v.clean.label + '" already exists');
    const approved = existing.filter((r) => (r.status || 'approved') === 'approved' && r.id !== m.id);
    if (approved.length >= MAX_CUSTOM_COLUMNS && (m.status || 'approved') === 'approved') throw new Error('Maximum ' + MAX_CUSTOM_COLUMNS + ' custom columns reached');
  }
  const now = new Date().toISOString();
  const prev = m.id ? await getTemplate(m.id) : null;
  const name = v.clean.label || v.clean.title;
  const rec = {
    ...(prev || {}),
    id: prev ? prev.id : uid(kind, name),
    kind,
    title: name,
    detail: kind === 'checklist' ? v.clean.items.length + ' items' : kind === 'report_template' ? v.clean.sections.length + ' sections' : kind === 'safety_rule' ? v.clean.summary : v.clean.type,
    payload: v.clean,
    status: m.status === 'pending' ? 'pending' : 'approved',
    source: m.source === 'jarvis' ? 'jarvis' : 'user',
    reason: txt(m.reason, 300),
    version: prev ? (prev.version || 1) + 1 : 1,
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now
  };
  await repo.save(NOTES, rec);
  if (kind === 'custom_column') await loadCustomColumns();
  changed(rec.id);
  return rec;
}

/* JARVIS proposes; nothing is active until the user approves */
export function proposeTemplate(kind, payload, reason) {
  return saveTemplate(kind, payload, { status: 'pending', source: 'jarvis', reason });
}

export async function listPending() {
  return (await allNotes()).filter((r) => KINDS.includes(r.kind) && r.status === 'pending');
}

export async function approveTemplate(id) {
  const r = await getTemplate(id);
  if (!r) return null;
  const out = await saveTemplate(r.kind, r.payload, { id, status: 'approved', source: r.source, reason: r.reason });
  return out;
}

export async function rejectTemplate(id) {
  return removeTemplate(id);
}

export async function removeTemplate(id) {
  const r = await getTemplate(id);
  await repo.remove(NOTES, id);
  if (r && r.kind === 'custom_column') await loadCustomColumns();
  changed(id);
  return true;
}

/* ---------- Custom observation columns (cached so the sheet can read them synchronously) ---------- */

let columnCache = [];

export async function loadCustomColumns() {
  const rows = (await listTemplates('custom_column', { status: 'approved' })).slice().reverse();
  columnCache = rows.map((r) => ({
    key: r.payload.key,
    label: r.payload.label,
    type: r.payload.type === 'yesno' ? 'select' : r.payload.type,
    options: r.payload.type === 'yesno' ? ['Yes', 'No'] : r.payload.options || [],
    width: r.payload.width || 160,
    help: r.payload.help || '',
    custom: true,
    templateId: r.id
  }));
  return columnCache;
}

export function getCustomColumns() {
  return columnCache.slice();
}

/* ---------- Helpers for modules ---------- */

export async function getReportTemplates() {
  return listTemplates('report_template');
}

export async function getChecklists(purpose) {
  const rows = await listTemplates('checklist');
  return purpose ? rows.filter((r) => r.payload.purpose === purpose) : rows;
}

export async function getSafetyRules(region) {
  return listTemplates('safety_rule', { region });
}
