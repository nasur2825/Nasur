/* NASUR - Observations service (Phase 4)
   28-column master schema (A to AB), instant auto-save, numbering, repeat-hazard alert,
   pocket-note batch parsing and CSV / Excel export. */
import { STORES } from '../core/config.js';
import * as repo from './repo.js';
import { getUserConfig } from './config.js';
import { getActiveRegion, getActiveRegionId } from './regions.js';
import { getActiveProject, getProjectContext } from './clients.js';
import { syncFromObservation } from './actions.js';
import { getCustomColumns } from './templates.js';

export const OBS_STORE = (STORES && STORES.OBSERVATIONS) || 'observations';

export const HAZARD_CATEGORIES = [
  'Fall from Height', 'Electrical', 'Fire & Explosion', 'Hot Work', 'Lifting & Cranes', 'Machinery & Guarding',
  'Housekeeping & Slips', 'Chemical & Hazardous Substances', 'PPE', 'Confined Space', 'Vehicles & Traffic',
  'Excavation', 'Scaffolding', 'Heat & Cold', 'Noise & Dust', 'Ergonomics', 'Environmental', 'Other'
];
export const OBS_TYPES = ['Unsafe Act', 'Unsafe Condition', 'Near Miss', 'Non-Conformance', 'Good Practice'];
export const RISK_RATINGS = [
  { id: 'Low', score: 1 },
  { id: 'Medium', score: 2 },
  { id: 'High', score: 3 },
  { id: 'Critical', score: 4 }
];
export const STATUSES = ['Open', 'In Progress', 'Closed', 'Verified'];
export const HIERARCHY = ['Elimination', 'Substitution', 'Engineering', 'Administrative', 'PPE'];
export const RESIDUAL = ['Low', 'Medium', 'High'];

/* A to AB, in the exact order of the master schema */
export const BASE_COLUMNS = [
  { key: 'obs_no', label: 'Observation No', type: 'readonly', width: 130 },
  { key: 'date', label: 'Date', type: 'date', width: 130 },
  { key: 'time', label: 'Time', type: 'time', width: 100 },
  { key: 'project', label: 'Project Name', type: 'text', width: 180 },
  { key: 'contractor', label: 'Contractor', type: 'text', width: 160 },
  { key: 'location', label: 'Exact Location', type: 'text', width: 180 },
  { key: 'activity', label: 'Activity', type: 'text', width: 160 },
  { key: 'hazard_category', label: 'Hazard Category', type: 'select', options: HAZARD_CATEGORIES, width: 190 },
  { key: 'obs_type', label: 'Type of Observation', type: 'select', options: OBS_TYPES, width: 170 },
  { key: 'risk_rating', label: 'Risk Rating', type: 'select', options: RISK_RATINGS.map((r) => r.id), width: 120 },
  { key: 'description', label: 'Observation Description', type: 'long', width: 260 },
  { key: 'immediate_action', label: 'Immediate Action Taken', type: 'long', width: 220 },
  { key: 'root_cause', label: 'Root Cause', type: 'long', width: 220 },
  { key: 'corrective_action', label: 'Corrective Action', type: 'long', width: 240 },
  { key: 'responsible', label: 'Responsible Person', type: 'text', width: 160 },
  { key: 'target_date', label: 'Target Date', type: 'date', width: 130 },
  { key: 'closure_date', label: 'Actual Closure Date', type: 'date', width: 150 },
  { key: 'status', label: 'Status', type: 'select', options: STATUSES, width: 130 },
  { key: 'verified_by', label: 'Verified By', type: 'text', width: 150 },
  { key: 'photo_before', label: 'Photo-Before', type: 'photo', width: 120 },
  { key: 'photo_after', label: 'Photo-After', type: 'photo', width: 120 },
  { key: 'reported_by', label: 'Reported By', type: 'text', width: 150 },
  { key: 'shift_weather', label: 'Shift & Weather/Temp', type: 'text', width: 190 },
  { key: 'legal_clause', label: 'Legal/Standard Clause', type: 'long', width: 260 },
  { key: 'hierarchy', label: 'Hierarchy of Control', type: 'select', options: HIERARCHY, width: 160 },
  { key: 'residual_risk', label: 'Residual Risk', type: 'select', options: RESIDUAL, width: 130 },
  { key: 'cost_impact', label: 'Man-Hours/Cost Impact', type: 'text', width: 170 },
  { key: 'closure_remarks', label: 'Final Closure Remarks', type: 'long', width: 240 }
];

/* Base 28 columns (A to AB) */
export const COLUMNS = BASE_COLUMNS;

/* Base columns plus any custom columns JARVIS or the user added (AC onwards) */
export function getColumns() {
  return BASE_COLUMNS.concat(getCustomColumns());
}

export function colLetter(index) {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function riskScore(r) {
  const f = RISK_RATINGS.find((x) => x.id === r);
  return f ? f.score : 0;
}

/* ---------- Dates & times ---------- */

function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayIso(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}

export function nowTime(d) {
  const x = d || new Date();
  return pad(x.getHours()) + ':' + pad(x.getMinutes());
}

export function nowStamp() {
  const d = new Date();
  return { date: todayIso(d), time: nowTime(d) };
}

export function buildRecordedAt(date, time) {
  const t = /^\d{2}:\d{2}$/.test(time || '') ? time : '00:00';
  const d = new Date((date || todayIso()) + 'T' + t + ':00');
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function validateStamp(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: 'Enter a valid date' };
  if (!/^\d{2}:\d{2}$/.test(time || '')) return { ok: false, error: 'Enter a valid time' };
  const at = new Date(buildRecordedAt(date, time)).getTime();
  const future = at - Date.now() > 5 * 60 * 1000;
  const old = Date.now() - at > 24 * 3600 * 1000;
  return { ok: !future, error: future ? 'Date and time are in the future' : '', future, past: old };
}

export function shiftFor(time) {
  const m = /^(\d{2}):/.exec(time || '');
  const h = m ? parseInt(m[1], 10) : new Date().getHours();
  return h >= 6 && h < 18 ? 'Day shift' : 'Night shift';
}

export function buildShiftWeather(time, tempText, condition) {
  return [shiftFor(time), condition, tempText].filter(Boolean).join(' · ');
}

export function isOverdue(o, today) {
  if (!o || !o.target_date) return false;
  if (o.status === 'Closed' || o.status === 'Verified') return false;
  return o.target_date < (today || todayIso());
}

/* ---------- Legal / standard clause by active country ---------- */

const LEGAL = {
  india: {
    default: 'OSH Code 2020 / Factories Act 1948 (verify current applicability)',
    'Fall from Height': 'BOCW Central Rules 1998 (work at height) / Factories Act 1948 s.32',
    Electrical: 'CEA (Measures relating to Safety and Electric Supply) Regulations',
    'Fire & Explosion': 'Factories Act 1948 s.38 / NBC 2016 Part 4',
    'Lifting & Cranes': 'Factories Act 1948 s.28-29 (hoists, lifts, lifting machines)',
    'Machinery & Guarding': 'Factories Act 1948 s.21 (fencing of machinery)',
    'Chemical & Hazardous Substances': 'MSIHC Rules 1989 / Factories Act 1948 Chapter IVA',
    'Confined Space': 'Factories Act 1948 s.36 (dangerous fumes)',
    PPE: 'Factories Act 1948 s.35 (eye protection) / OSH Code 2020',
    Excavation: 'BOCW Central Rules 1998'
  },
  gulf: {
    default: 'UAE Cabinet Decision No. 33 of 2020 (OSH) / client HSE standard (verify)',
    'Fire & Explosion': 'UAE Fire and Life Safety Code of Practice (Civil Defence)',
    'Heat & Cold': 'National midday work ban notice (MoHRE / MHRSD / MoL) (verify year)'
  },
  canada: {
    default: 'Canada Labour Code Part II / provincial OHS Act and Regulation (verify)',
    'Chemical & Hazardous Substances': 'WHMIS 2015 (Hazardous Products Regulations)',
    'Fall from Height': 'CSA Z259 series + provincial fall protection regulation',
    Electrical: 'CSA Z462 / provincial electrical safety code',
    'Heat & Cold': 'Provincial OHS heat and cold stress provisions'
  },
  usa: {
    default: 'OSH Act s.5(a)(1) General Duty Clause / OSHA 29 CFR 1910 / 1926',
    'Fall from Height': 'OSHA 29 CFR 1926.501 (construction) / 1910 Subpart D',
    Electrical: 'OSHA 29 CFR 1910.303-.305 / 1926 Subpart K',
    'Fire & Explosion': 'OSHA 29 CFR 1910.157 / NFPA 10',
    'Hot Work': 'OSHA 29 CFR 1910.252 / 1926.352',
    'Lifting & Cranes': 'OSHA 29 CFR 1926 Subpart CC / 1910.179',
    'Machinery & Guarding': 'OSHA 29 CFR 1910.212 / 1910.147 (LOTO)',
    'Housekeeping & Slips': 'OSHA 29 CFR 1910.22 / 1926.25',
    'Chemical & Hazardous Substances': 'OSHA 29 CFR 1910.1200 (HazCom)',
    PPE: 'OSHA 29 CFR 1910.132 / 1926.95',
    'Confined Space': 'OSHA 29 CFR 1910.146 / 1926 Subpart AA',
    'Vehicles & Traffic': 'OSHA 29 CFR 1910.178 / 1926.601',
    Excavation: 'OSHA 29 CFR 1926 Subpart P (1926.651)',
    Scaffolding: 'OSHA 29 CFR 1926 Subpart L (1926.451)',
    'Noise & Dust': 'OSHA 29 CFR 1910.95 / 1910.1000 / 1926.1153 (silica)',
    'Heat & Cold': 'OSH Act s.5(a)(1) General Duty Clause (NIOSH criteria)'
  }
};

export function suggestLegalClause(category, regionId) {
  const map = LEGAL[regionId || getActiveRegionId()] || LEGAL.india;
  return map[category] || map.default;
}

/* ---------- Storage ---------- */

async function all() {
  const rows = await repo.list(OBS_STORE);
  return Array.isArray(rows) ? rows : [];
}

function uid() {
  return 'obs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function nextObservationNo(date) {
  const year = /^\d{4}/.test(date || '') ? date.slice(0, 4) : String(new Date().getFullYear());
  const re = new RegExp('^OBS-' + year + '-(\\d+)$');
  let max = 0;
  (await all()).forEach((r) => {
    const m = re.exec(r.obs_no || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'OBS-' + year + '-' + String(max + 1).padStart(3, '0');
}

export async function createDraft(overrides) {
  const st = nowStamp();
  const project = await getActiveProject();
  const cfg = getUserConfig() || {};
  const base = {
    date: st.date,
    time: st.time,
    project: project ? project.name : '',
    contractor: project ? project.mainContractor || '' : '',
    location: project ? project.site || '' : '',
    status: 'Open',
    reported_by: cfg.displayName || cfg.userName || '',
    shift_weather: shiftFor(st.time)
  };
  return { ...base, ...(overrides || {}) };
}

let writeChain = Promise.resolve();

function enqueue(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => null);
  return run;
}

export function createObservation(draft, opts) {
  return enqueue(async () => {
    const d = { ...(await createDraft()), ...(draft || {}) };
    const chk = validateStamp(d.date, d.time);
    if (!chk.ok && !(opts && opts.allowFuture)) throw new Error(chk.error);
    const ctx = await getProjectContext();
    const now = new Date().toISOString();
    const rec = {
      id: uid(),
      obs_no: await nextObservationNo(d.date),
      ...blankRow(),
      ...d,
      projectId: ctx ? ctx.projectId : null,
      clientId: ctx ? ctx.clientId : null,
      country: ctx ? ctx.country : getActiveRegionId(),
      recordedAt: buildRecordedAt(d.date, d.time),
      backfilled: !!(opts && opts.backfilled),
      createdAt: now,
      updatedAt: now
    };
    if (!rec.legal_clause && rec.hazard_category) rec.legal_clause = suggestLegalClause(rec.hazard_category, rec.country);
    await repo.save(OBS_STORE, rec);
    return rec;
  });
}

function blankRow() {
  const o = {};
  getColumns().forEach((c) => {
    o[c.key] = '';
  });
  return o;
}

export function getObservation(id) {
  return repo.get(OBS_STORE, id);
}

export async function deleteObservation(id) {
  await flushAll();
  return enqueue(() => repo.remove(OBS_STORE, id));
}

/* ---------- Instant auto-save (every keystroke / voice entry) ---------- */

const pending = new Map();
const listeners = new Set();
let timer = null;

export function onSaveStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(state, detail) {
  listeners.forEach((fn) => {
    try {
      fn(state, detail);
    } catch (e) {
      /* ignore listener errors */
    }
  });
}

export function updateField(id, key, value) {
  const patch = pending.get(id) || {};
  patch[key] = value;
  pending.set(id, patch);
  notify('saving');
  clearTimeout(timer);
  timer = setTimeout(flushAll, 120);
}

export function flushAll() {
  clearTimeout(timer);
  return enqueue(async () => {
    const entries = Array.from(pending.entries());
    pending.clear();
    if (!entries.length) {
      notify('saved');
      return;
    }
    try {
      for (const [id, patch] of entries) {
        const cur = await repo.get(OBS_STORE, id);
        if (!cur) continue;
        const next = applyPatch(cur, patch);
        await repo.save(OBS_STORE, next);
        const syncKeys = ['corrective_action', 'responsible', 'target_date', 'status', 'closure_date', 'risk_rating', 'closure_remarks'];
        if (Object.keys(patch).some((k) => syncKeys.includes(k))) await syncFromObservation(next);
      }
      notify('saved');
    } catch (e) {
      entries.forEach(([id, patch]) => pending.set(id, { ...patch, ...(pending.get(id) || {}) }));
      notify('error', e && e.message);
      throw e;
    }
  });
}

function applyPatch(cur, patch) {
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  if ('date' in patch || 'time' in patch) next.recordedAt = buildRecordedAt(next.date, next.time);
  if ('hazard_category' in patch && !(cur.legal_clause || '').trim()) next.legal_clause = suggestLegalClause(next.hazard_category, next.country);
  if ('status' in patch && (next.status === 'Closed' || next.status === 'Verified') && !next.closure_date) next.closure_date = todayIso();
  if ('status' in patch && next.status === 'Open') next.closure_date = '';
  return next;
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll().catch(() => null);
  });
  window.addEventListener('pagehide', () => {
    flushAll().catch(() => null);
  });
}

/* ---------- Listing, filtering and stats ---------- */

export async function listObservations(filter) {
  const f = filter || {};
  const q = String(f.q || '').trim().toLowerCase();
  const rows = (await all()).filter((r) => {
    if (f.projectId && r.projectId !== f.projectId) return false;
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.risk && r.risk_rating !== f.risk) return false;
    if (f.contractor && String(r.contractor || '').toLowerCase() !== String(f.contractor).toLowerCase()) return false;
    if (f.openOnly && (r.status === 'Closed' || r.status === 'Verified')) return false;
    if (q) {
      const hay = getColumns().filter((c) => c.type !== 'photo').map((c) => r[c.key] || '').join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  rows.sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')) || String(b.obs_no).localeCompare(String(a.obs_no)));
  return rows;
}

function bump(map, key) {
  const k = key || 'Unspecified';
  map[k] = (map[k] || 0) + 1;
}

export function summarize(rows) {
  const s = { total: rows.length, open: 0, closed: 0, overdue: 0, byRisk: {}, byContractor: {}, byCategory: {}, byType: {}, byStatus: {} };
  rows.forEach((r) => {
    const closed = r.status === 'Closed' || r.status === 'Verified';
    if (closed) s.closed++;
    else s.open++;
    if (isOverdue(r)) s.overdue++;
    bump(s.byRisk, r.risk_rating);
    bump(s.byContractor, r.contractor);
    bump(s.byCategory, r.hazard_category);
    bump(s.byType, r.obs_type);
    bump(s.byStatus, r.status);
  });
  s.closureRate = s.total ? Math.round((s.closed / s.total) * 100) : 0;
  return s;
}

/* ---------- Repeat-hazard alert ---------- */

export async function findRepeatHazards(draft, opts) {
  const days = (opts && opts.days) || 30;
  const minScore = (opts && opts.minScore) || 3;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const norm = (v) => String(v || '').trim().toLowerCase();
  const con = norm(draft.contractor);
  const act = norm(draft.activity);
  const cat = norm(draft.hazard_category);
  if (!con && !act) return [];
  const out = [];
  (await all()).forEach((r) => {
    if (draft.id && r.id === draft.id) return;
    if (riskScore(r.risk_rating) < minScore) return;
    if (new Date(r.recordedAt || 0).getTime() < cutoff) return;
    let score = 0;
    if (con && norm(r.contractor) === con) score += 1;
    if (act && norm(r.activity) === act) score += 1;
    if (cat && norm(r.hazard_category) === cat) score += 1;
    if (score >= 2 || ((con && norm(r.contractor) === con) && !act && score >= 1) || ((act && norm(r.activity) === act) && !con && score >= 1)) {
      out.push({ obs_no: r.obs_no, id: r.id, date: r.date, risk: r.risk_rating, contractor: r.contractor, activity: r.activity, category: r.hazard_category, status: r.status, description: String(r.description || '').slice(0, 140), score });
    }
  });
  out.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
  return out.slice(0, 5);
}

/* ---------- Pocket-note batch entry ---------- */

function parseDateText(txt) {
  const s = String(txt || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
  if (!m) return '';
  const monthFirst = String((getActiveRegion().format || {}).date || '').indexOf('MM') === 0;
  const a = +m[1];
  const b = +m[2];
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const day = monthFirst ? b : a;
  const mon = monthFirst ? a : b;
  return y + '-' + pad(mon) + '-' + pad(day);
}

function parseTimeText(txt) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i.exec(String(txt || '').trim());
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3] ? m[3].toLowerCase() : '';
  if (!m[2] && !ap) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { time: pad(h) + ':' + pad(min), rest: String(txt).trim().slice(m[0].length).replace(/^[\s\-–:,]+/, '') };
}

export function parseBatchText(text, defaults) {
  const d = defaults || {};
  let curDate = d.date || todayIso();
  const out = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const head = /^(?:#|date\s*[:=])\s*(.+)$/i.exec(line);
    if (head) {
      const iso = parseDateText(head[1]);
      if (iso) curDate = iso;
      return;
    }
    let time = d.time || '';
    let body = line;
    const t = parseTimeText(line);
    if (t) {
      time = t.time;
      body = t.rest;
    }
    let risk = '';
    const r = /[\s,;|]+(low|medium|med|high|critical)\s*$/i.exec(body);
    if (r) {
      risk = r[1].toLowerCase() === 'med' ? 'Medium' : r[1].charAt(0).toUpperCase() + r[1].slice(1).toLowerCase();
      body = body.slice(0, r.index);
    }
    const parts = body.split(/\s*[|;]\s*/);
    const draft = { date: curDate, time: time || nowTime(), risk_rating: risk };
    if (parts.length >= 3) {
      draft.location = parts[0];
      draft.activity = parts[1];
      draft.description = parts.slice(2).join(' | ');
    } else if (parts.length === 2) {
      draft.location = parts[0];
      draft.description = parts[1];
    } else {
      draft.description = parts[0];
    }
    if (draft.description) out.push(draft);
  });
  return out;
}

export async function saveBatch(drafts, common) {
  const saved = [];
  for (const d of drafts) {
    const rec = await createObservation({ ...(common || {}), ...clean(d), shift_weather: buildShiftWeather(d.time) }, { backfilled: true });
    saved.push(rec);
  }
  return saved;
}

function clean(d) {
  const o = {};
  Object.keys(d).forEach((k) => {
    if (d[k] !== '' && d[k] != null) o[k] = d[k];
  });
  return o;
}

/* ---------- CSV / Excel export (UTF-8 BOM so Tamil / Arabic open cleanly) ---------- */

function cell(col, row) {
  if (col.type === 'photo') return row[col.key] ? 'Attached' : '';
  return row[col.key] == null ? '' : String(row[col.key]);
}

export function toCsv(rows) {
  const esc = (v) => '"' + String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const cols = getColumns();
  const head = cols.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(cell(c, r))).join(','));
  return '\uFEFF' + [head].concat(body).join('\r\n');
}

function xmlEsc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toExcelHtml(rows) {
  const cols = getColumns();
  const th = cols.map((c, i) => '<th style="background:#1f3a5f;color:#fff;border:1px solid #999">' + colLetter(i) + ' · ' + xmlEsc(c.label) + '</th>').join('');
  const tr = rows
    .map((r) => '<tr>' + cols.map((c) => '<td style="border:1px solid #bbb;vertical-align:top">' + xmlEsc(cell(c, r)) + '</td>').join('') + '</tr>')
    .join('');
  return '\uFEFF<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table>' + '<tr>' + th + '</tr>' + tr + '</table></body></html>';
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export function downloadCsv(rows, name) {
  downloadFile((name || 'NASUR-Observations-' + todayIso()) + '.csv', toCsv(rows), 'text/csv;charset=utf-8');
}

export function downloadExcel(rows, name) {
  downloadFile((name || 'NASUR-Observations-' + todayIso()) + '.xls', toExcelHtml(rows), 'application/vnd.ms-excel;charset=utf-8');
}
