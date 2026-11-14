/* NASUR - Incidents & Near Misses service (Phase 4) */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import * as repo from './repo.js';
import { cleanText } from './sanitize.js';
import { getProjectContext } from './clients.js';
import { getActiveRegionId } from './regions.js';
import { nowStamp, validateStamp, buildRecordedAt } from './observations.js';
import { createAction, listActions, isClosed } from './actions.js';
import { suggestCapa } from './rca.js';

export const INC_STORE = (STORES && STORES.INCIDENTS) || 'incidents';

export const SEVERITIES = [
  { id: 'near_miss', label: 'Near Miss', recordable: false, weight: 0 },
  { id: 'first_aid', label: 'First Aid', recordable: false, weight: 1 },
  { id: 'mtc', label: 'Medical Treatment Case (MTC)', recordable: true, weight: 2 },
  { id: 'rwc', label: 'Restricted Work Case (RWC)', recordable: true, weight: 3 },
  { id: 'lti', label: 'Lost Time Injury (LTI)', recordable: true, weight: 4 },
  { id: 'fatality', label: 'Fatality', recordable: true, weight: 5 }
];

export const INCIDENT_TYPES = [
  'Injury / Illness',
  'Near Miss',
  'Property Damage',
  'Fire / Explosion',
  'Environmental Release',
  'Vehicle / Equipment',
  'Security',
  'Other'
];

export const INCIDENT_STATUSES = [
  { id: 'reported', label: 'Reported' },
  { id: 'investigating', label: 'Investigating' },
  { id: 'capa_open', label: 'Actions Open' },
  { id: 'closed', label: 'Closed' }
];

function txt(v, max) {
  return cleanText(v == null ? '' : String(v), { max: max || 300 });
}

function uid() {
  return 'inc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function severityOf(id) {
  return SEVERITIES.find((s) => s.id === id) || SEVERITIES[0];
}

/* Classify from simple yes/no facts */
export function classify(f) {
  const x = f || {};
  if (x.fatality) return 'fatality';
  if (x.lostTime) return 'lti';
  if (x.restrictedDuty) return 'rwc';
  if (x.medicalTreatment) return 'mtc';
  if (x.firstAid) return 'first_aid';
  return 'near_miss';
}

export function notificationHints(regionId, severityId) {
  const sev = severityOf(severityId);
  const out = ['Inform the site HSE manager, project manager and client representative immediately.'];
  if (sev.weight >= 4 || sev.id === 'rwc') out.push('Preserve the scene and evidence. Do not disturb until cleared.');
  const r = regionId || getActiveRegionId();
  if (sev.weight >= 4) {
    if (r === 'usa') out.push('OSHA: report a fatality within 8 hours and an in-patient hospitalisation, amputation or eye loss within 24 hours (29 CFR 1904.39).');
    else if (r === 'india') out.push('Notify the Factory Inspectorate or state authority as required by the Factories Rules and OSH Code (verify timelines).');
    else if (r === 'gulf') out.push('Notify the labour authority, civil defence or police as required locally, plus the client incident system (verify timelines).');
    else if (r === 'canada') out.push('Notify the provincial regulator and the joint health and safety committee. Fatalities and critical injuries need immediate notice (verify provincial timelines).');
  }
  return out;
}

async function all() {
  const rows = await repo.list(INC_STORE);
  return Array.isArray(rows) ? rows : [];
}

let chain = Promise.resolve();

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => null);
  return run;
}

function changed(id) {
  emit(EVENTS.RECORD_SAVED, { store: INC_STORE, id });
}

export async function nextIncidentNo(date) {
  const year = /^\d{4}/.test(date || '') ? date.slice(0, 4) : String(new Date().getFullYear());
  const re = new RegExp('^INC-' + year + '-(\\d+)$');
  let max = 0;
  (await all()).forEach((r) => {
    const m = re.exec(r.incident_no || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'INC-' + year + '-' + String(max + 1).padStart(3, '0');
}

function cleanPerson(p) {
  const o = p || {};
  return {
    name: txt(o.name, 100),
    emp_id: txt(o.emp_id, 40),
    role: txt(o.role, 80),
    contractor: txt(o.contractor, 100),
    body_part: txt(o.body_part, 80),
    nature: txt(o.nature, 100)
  };
}

export function createIncident(data) {
  return enqueue(async () => {
    const st = nowStamp();
    const date = data.date || st.date;
    const time = data.time || st.time;
    const chk = validateStamp(date, time);
    if (!chk.ok) throw new Error(chk.error);
    const description = txt(data.description, 2000);
    if (description.length < 5) throw new Error('Describe what happened');
    const sev = severityOf(data.severity);
    const ctx = await getProjectContext();
    const now = new Date().toISOString();
    const rec = {
      id: uid(),
      incident_no: await nextIncidentNo(date),
      date,
      time,
      recordedAt: buildRecordedAt(date, time),
      project: txt(data.project || (ctx && ctx.project.name), 120),
      contractor: txt(data.contractor, 120),
      location: txt(data.location, 160),
      activity: txt(data.activity, 160),
      type: INCIDENT_TYPES.includes(data.type) ? data.type : sev.id === 'near_miss' ? 'Near Miss' : 'Injury / Illness',
      severity: sev.id,
      description,
      immediate_action: txt(data.immediate_action, 1000),
      injured: cleanPerson(data.injured),
      witnesses: txt(data.witnesses, 300),
      lost_days: Math.max(0, parseInt(data.lost_days, 10) || 0),
      restricted_days: Math.max(0, parseInt(data.restricted_days, 10) || 0),
      medical_facility: txt(data.medical_facility, 160),
      reported_by: txt(data.reported_by, 100),
      photos: (Array.isArray(data.photos) ? data.photos : []).filter((p) => typeof p === 'string' && p.indexOf('data:image/') === 0).slice(0, 6),
      rca: data.rca || null,
      capa_ids: [],
      status: 'reported',
      projectId: ctx ? ctx.projectId : null,
      clientId: ctx ? ctx.clientId : null,
      country: ctx ? ctx.country : getActiveRegionId(),
      createdAt: now,
      updatedAt: now
    };
    await repo.save(INC_STORE, rec);
    changed(rec.id);
    return rec;
  });
}

export function getIncident(id) {
  return repo.get(INC_STORE, id);
}

export function updateIncident(id, patch) {
  return enqueue(async () => {
    const cur = await repo.get(INC_STORE, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    if ('severity' in patch) next.severity = severityOf(patch.severity).id;
    if ('date' in patch || 'time' in patch) next.recordedAt = buildRecordedAt(next.date, next.time);
    if ('injured' in patch) next.injured = cleanPerson(patch.injured);
    await repo.save(INC_STORE, next);
    changed(id);
    return next;
  });
}

export async function removeIncident(id) {
  return enqueue(async () => {
    await repo.remove(INC_STORE, id);
    changed(id);
    return true;
  });
}

export async function saveRca(id, rca) {
  const inc = await updateIncident(id, { rca, status: 'investigating' });
  return inc;
}

/* One click: turn the RCA's actions (or suggestions from root causes) into tracked CAPA actions */
export async function generateCapa(id) {
  const inc = await getIncident(id);
  if (!inc) throw new Error('Incident not found');
  const rca = inc.rca || {};
  let items = (rca.capa || []).filter((c) => c && c.text);
  if (!items.length) items = suggestCapa(rca.rootCauses || [], { severe: severityOf(inc.severity).weight >= 3 });
  if (!items.length) throw new Error('Add at least one root cause or action first');
  const existing = new Set(inc.capa_ids || []);
  const created = [];
  for (const it of items) {
    if (it.actionId && existing.has(it.actionId)) continue;
    const a = await createAction({
      title: it.text,
      description: it.text + (it.hierarchy ? ' [Control: ' + it.hierarchy + ']' : ''),
      source_type: 'incident',
      source_id: inc.id,
      source_no: inc.incident_no,
      responsible: it.responsible || '',
      target_date: it.target_date || '',
      priority: severityOf(inc.severity).weight >= 4 ? 'critical' : severityOf(inc.severity).weight >= 2 ? 'high' : 'medium',
      kind: it.kind === 'preventive' ? 'preventive' : 'corrective',
      projectId: inc.projectId || null
    });
    it.actionId = a.id;
    created.push(a);
  }
  const ids = (inc.capa_ids || []).concat(created.map((a) => a.id));
  const nextRca = { ...rca, capa: items };
  await updateIncident(id, { capa_ids: ids, rca: nextRca, status: 'capa_open' });
  return created;
}

export async function incidentActionState(id) {
  const rows = await listActions({ source_id: id });
  const open = rows.filter((a) => !isClosed(a)).length;
  return { total: rows.length, open, done: rows.length - open };
}

export async function closeIncident(id, remarks) {
  const st = await incidentActionState(id);
  if (st.open > 0) throw new Error(st.open + ' action(s) still open. Close them first.');
  return updateIncident(id, { status: 'closed', closure_remarks: txt(remarks, 500), closed_at: new Date().toISOString() });
}

/* ---------- Queries & statistics ---------- */

export async function listIncidents(filter) {
  const f = filter || {};
  const q = String(f.q || '').trim().toLowerCase();
  const rows = (await all()).filter((r) => {
    if (f.projectId && r.projectId !== f.projectId) return false;
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    if (f.severity && r.severity !== f.severity) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.openOnly && r.status === 'closed') return false;
    if (q && (r.incident_no + ' ' + r.description + ' ' + r.location + ' ' + r.contractor + ' ' + r.activity + ' ' + (r.injured && r.injured.name)).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  rows.sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')));
  return rows;
}

export function summarizeIncidents(rows) {
  const s = { total: rows.length, open: 0, recordable: 0, lti: 0, fatalities: 0, nearMisses: 0, lostDays: 0, bySeverity: {} };
  rows.forEach((r) => {
    const sev = severityOf(r.severity);
    if (r.status !== 'closed') s.open++;
    if (sev.recordable) s.recordable++;
    if (sev.id === 'lti') s.lti++;
    if (sev.id === 'fatality') s.fatalities++;
    if (sev.id === 'near_miss') s.nearMisses++;
    s.lostDays += r.lost_days || 0;
    s.bySeverity[sev.label] = (s.bySeverity[sev.label] || 0) + 1;
  });
  return s;
}

/* Rates need man-hours worked in the same period */
export function calcRates(rows, manHours) {
  const s = summarizeIncidents(rows);
  const h = Number(manHours) || 0;
  const per = (n, base) => (h > 0 ? Math.round(((n * base) / h) * 100) / 100 : null);
  return {
    manHours: h,
    recordables: s.recordable,
    trir: per(s.recordable, 200000),
    trirPerMillion: per(s.recordable, 1000000),
    ltifr: per(s.lti + s.fatalities, 1000000),
    severityRate: per(s.lostDays, 1000000),
    nearMissRatio: s.recordable ? Math.round((s.nearMisses / s.recordable) * 10) / 10 : null
  };
}
