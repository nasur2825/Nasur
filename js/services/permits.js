/* NASUR - Permit to Work service (Phase 6)
   Digital permits with checks, isolation and gas-test sign-offs, status control, expiry countdown
   and a one-tap bridge into Observations and the Action Tracker. */
import { KINDS, listOps, getOps, saveOps, patchOps, removeOps, txt, uid, logEntry, formatDuration } from './opsstore.js';
import { createDraft, createObservation, suggestLegalClause } from './observations.js';
import { createAction } from './actions.js';

const URL_TYPES = 'data/ptw/permit_types.json';
export const GAS_VALID_MINUTES_DEFAULT = 240;
export const WARN_MINUTES = 60;
export const CRITICAL_MINUTES = 15;

let data = null;

export async function loadPermitTypes() {
  if (data) return data;
  const res = await fetch(URL_TYPES, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load permit types (HTTP ' + res.status + ')');
  data = await res.json();
  return data;
}

export function permitData() {
  if (!data) throw new Error('Permit types are not loaded');
  return data;
}

export const listTypes = () => permitData().types;
export const getType = (id) => permitData().types.find((t) => t.id === id) || null;
export const commonRules = () => permitData().common;

export function statusLabel(id) {
  const s = permitData().common.statuses.find((x) => x.id === id);
  return s ? s.label : id;
}

export function canMove(from, to) {
  return ((permitData().common.transitions[from]) || []).includes(to);
}

/* ---------- Gas test evaluation ---------- */

export function limitsFor(permit) {
  const t = getType(permit.type);
  const base = (t && t.gas_test && t.gas_test.limits) || { o2_min: 19.5, o2_max: 23.5, lel_max: 10, h2s_max: 10, co_max: 25 };
  return { ...base, ...(permit.gas_limits || {}) };
}

export function evaluateGas(reading, limits) {
  const l = limits || {};
  const fails = [];
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const o2 = num(reading.o2);
  const lel = num(reading.lel);
  const h2s = num(reading.h2s);
  const co = num(reading.co);
  if (o2 != null && (o2 < l.o2_min || o2 > l.o2_max)) fails.push('Oxygen ' + o2 + '% is outside ' + l.o2_min + ' to ' + l.o2_max + '%');
  if (lel != null && lel > l.lel_max) fails.push('Flammable gas ' + lel + '% LEL is above ' + l.lel_max + '%');
  if (h2s != null && h2s > l.h2s_max) fails.push('H2S ' + h2s + ' ppm is above ' + l.h2s_max + ' ppm');
  if (co != null && co > l.co_max) fails.push('CO ' + co + ' ppm is above ' + l.co_max + ' ppm');
  const measured = [o2, lel, h2s, co].filter((v) => v != null).length;
  return { ok: fails.length === 0 && measured > 0, fails, measured };
}

export function latestGasTest(permit) {
  const tests = permit.gas_tests || [];
  return tests.length ? tests[tests.length - 1] : null;
}

export function gasTestValid(permit, now) {
  const t = latestGasTest(permit);
  if (!t || !t.ok) return false;
  const mins = Number(permit.gas_valid_minutes) || GAS_VALID_MINUTES_DEFAULT;
  return (now || Date.now()) - new Date(t.at).getTime() <= mins * 60000;
}

/* ---------- Model ---------- */

function plusHours(iso, h) {
  return new Date(new Date(iso).getTime() + h * 3600000).toISOString();
}

export function newPermit(typeId, init) {
  const t = getType(typeId);
  if (!t) throw new Error('Unknown permit type');
  const i = init || {};
  const start = i.start_at || new Date().toISOString();
  const hours = Math.min(Number(i.hours) || t.default_hours, t.max_hours);
  const fields = {};
  (t.extra_fields || []).forEach((f) => {
    fields[f.id] = i.fields && i.fields[f.id] != null ? i.fields[f.id] : f.default != null ? f.default : '';
  });
  const precautions = {};
  t.precautions.forEach((p) => {
    precautions[p.id] = (i.precautions && i.precautions[p.id]) || '';
  });
  return {
    type: t.id,
    type_title: t.title,
    title: txt(i.title || t.title, 160),
    location: txt(i.location, 160),
    work_scope: txt(i.work_scope, 800),
    contractor: txt(i.contractor, 120),
    receiver_name: txt(i.receiver_name, 100),
    issuer_name: txt(i.issuer_name, 100),
    workers: (Array.isArray(i.workers) ? i.workers : []).map((w) => txt(w, 80)).filter(Boolean),
    start_at: start,
    valid_until: plusHours(start, hours),
    hours,
    jsa_id: i.jsa_id || '',
    jsa_no: txt(i.jsa_no, 40),
    fields,
    precautions,
    signoffs: t.signoffs.map((s) => ({ role: s.role, label: s.label, stage: s.stage, required: s.required, name: '', signed_at: '' })),
    gas_tests: [],
    gas_limits: {},
    gas_valid_minutes: GAS_VALID_MINUTES_DEFAULT,
    isolations: [],
    revalidations: [],
    status: 'draft',
    log: []
  };
}

export async function createPermit(typeId, init) {
  const p = newPermit(typeId, init);
  const rec = await saveOps(KINDS.PERMIT, { ...p, summary: p.work_scope }, { prefix: 'PERMIT', date: p.start_at.slice(0, 10) });
  return patchOps(rec.id, (r) => ({ log: logEntry(r, 'Permit created', p.receiver_name) }));
}

export const getPermit = (id) => getOps(id);
export const listPermits = (filter) => listOps(KINDS.PERMIT, filter);
export const removePermit = (id) => removeOps(id);

export function updatePermit(id, patch) {
  return patchOps(id, patch);
}

/* ---------- Readiness to issue ---------- */

export function permitReadiness(permit, now) {
  const t = getType(permit.type);
  const issues = [];
  if (!permit.location.trim()) issues.push('Enter the exact location');
  if (!permit.work_scope.trim()) issues.push('Describe the work');
  if (!permit.receiver_name.trim()) issues.push('Enter the permit receiver');
  if (!(permit.workers || []).length) issues.push('List the workers on the job');
  const missingCritical = [];
  const unanswered = [];
  t.precautions.forEach((p) => {
    const v = permit.precautions[p.id];
    if (!v) unanswered.push(p);
    else if (p.critical && v !== 'yes') missingCritical.push(p);
    else if (v === 'no') missingCritical.push(p);
  });
  if (unanswered.length) issues.push(unanswered.length + ' check(s) not answered');
  missingCritical.forEach((p) => issues.push('Not satisfied: ' + p.text));
  if (t.isolation_required && !(permit.isolations || []).length) issues.push('Record at least one isolation');
  const gasRule = t.gas_test && t.gas_test.required;
  if (gasRule === 'always' && !gasTestValid(permit, now)) issues.push('A passing gas test within the last ' + (Number(permit.gas_valid_minutes) || GAS_VALID_MINUTES_DEFAULT) / 60 + ' hours is needed');
  if (gasRule === 'if_flammables' && permit.fields && permit.fields.flammables === 'yes' && !gasTestValid(permit, now)) issues.push('Flammables are present: a passing gas test is needed');
  const needSign = permit.signoffs.filter((s) => s.stage === 'issue' && s.required && !s.name);
  needSign.forEach((s) => issues.push('Sign-off needed: ' + s.label));
  if (!permit.jsa_id) issues.push('Link an approved JSA');
  return { ready: !issues.length, issues, missingCritical, unanswered };
}

/* ---------- Time ---------- */

export function timeLeft(permit, now) {
  const end = new Date(permit.valid_until).getTime();
  const ms = end - (now || Date.now());
  if (permit.status !== 'active') return { ms, label: '--:--:--', level: 'none' };
  const mins = ms / 60000;
  const level = ms <= 0 ? 'expired' : mins <= CRITICAL_MINUTES ? 'critical' : mins <= WARN_MINUTES ? 'warn' : 'ok';
  return { ms, label: formatDuration(ms), level };
}

export function postWatchLeft(permit, now) {
  if (!permit.post_watch_until) return null;
  const ms = new Date(permit.post_watch_until).getTime() - (now || Date.now());
  return { ms, label: formatDuration(Math.max(0, ms)), done: ms <= 0 };
}

/* Marks active permits past their end time as expired. Returns the permits that changed. */
export async function expireOverdue(now) {
  const t = now || Date.now();
  const active = await listOps(KINDS.PERMIT, { status: 'active' });
  const out = [];
  for (const p of active) {
    if (new Date(p.valid_until).getTime() <= t) {
      out.push(await patchOps(p.id, (r) => ({ status: 'expired', log: logEntry(r, 'Permit expired automatically', 'system') })));
    }
  }
  return out;
}

export function summarizePermits(list, now) {
  const t = now || Date.now();
  const s = { total: list.length, waiting: 0, active: 0, expiringSoon: 0, expired: 0, suspended: 0 };
  list.forEach((p) => {
    if (p.status === 'submitted') s.waiting++;
    if (p.status === 'suspended') s.suspended++;
    if (p.status === 'expired') s.expired++;
    if (p.status === 'active') {
      s.active++;
      if (new Date(p.valid_until).getTime() - t <= WARN_MINUTES * 60000) s.expiringSoon++;
    }
  });
  return s;
}

/* ---------- Actions on a permit ---------- */

export function setPrecaution(id, precId, value) {
  if (!['yes', 'no', 'na', ''].includes(value)) throw new Error('Invalid answer');
  return patchOps(id, (r) => ({ precautions: { ...r.precautions, [precId]: value } }));
}

export function setField(id, fieldId, value) {
  return patchOps(id, (r) => ({ fields: { ...r.fields, [fieldId]: value } }));
}

export function addIsolation(id, entry) {
  const e = { point: txt(entry.point, 160), lock_id: txt(entry.lock_id, 60), by: txt(entry.by, 80), at: new Date().toISOString() };
  if (!e.point) throw new Error('Describe the isolation point');
  return patchOps(id, (r) => ({ isolations: (r.isolations || []).concat([e]), log: logEntry(r, 'Isolation recorded: ' + e.point, e.by) }));
}

export function removeIsolation(id, index) {
  return patchOps(id, (r) => ({ isolations: (r.isolations || []).filter((_, i) => i !== index) }));
}

export async function addGasTest(id, reading) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  const limits = limitsFor(cur);
  const ev = evaluateGas(reading, limits);
  if (!ev.measured) throw new Error('Enter at least one reading');
  const entry = { at: new Date().toISOString(), tester: txt(reading.tester, 80), o2: reading.o2 === '' ? null : Number(reading.o2), lel: reading.lel === '' ? null : Number(reading.lel), h2s: reading.h2s === '' ? null : Number(reading.h2s), co: reading.co === '' ? null : Number(reading.co), location: txt(reading.location, 100), ok: ev.ok, fails: ev.fails };
  const rec = await patchOps(id, (r) => ({ gas_tests: (r.gas_tests || []).concat([entry]), log: logEntry(r, 'Gas test ' + (ev.ok ? 'passed' : 'FAILED: ' + ev.fails.join('; ')), entry.tester) }));
  return { permit: rec, result: ev, entry };
}

export function signOff(id, index, name) {
  const n = txt(name, 100);
  if (!n) throw new Error('Enter the name');
  return patchOps(id, (r) => {
    const so = r.signoffs.map((s, i) => (i === index ? { ...s, name: n, signed_at: new Date().toISOString() } : s));
    return { signoffs: so, log: logEntry(r, 'Signed: ' + r.signoffs[index].label, n) };
  });
}

export function clearSignOff(id, index) {
  return patchOps(id, (r) => ({ signoffs: r.signoffs.map((s, i) => (i === index ? { ...s, name: '', signed_at: '' } : s)) }));
}

async function move(id, to, extra, event, by) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  if (!canMove(cur.status, to)) throw new Error('A ' + statusLabel(cur.status).toLowerCase() + ' permit cannot become ' + statusLabel(to).toLowerCase());
  return patchOps(id, (r) => ({ status: to, ...(extra || {}), log: logEntry(r, event, by) }));
}

export async function submitPermit(id) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  if (!cur.location.trim() || !cur.work_scope.trim() || !cur.receiver_name.trim()) throw new Error('Enter location, work and the permit receiver first');
  return move(id, 'submitted', null, 'Submitted to issuer', cur.receiver_name);
}

export async function issuePermit(id, issuerName) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  const name = txt(issuerName || cur.issuer_name, 100);
  if (!name) throw new Error('Enter the issuer name');
  const ready = permitReadiness({ ...cur, issuer_name: name });
  if (!ready.ready) throw new Error(ready.issues.join('. '));
  if (new Date(cur.valid_until).getTime() <= Date.now()) throw new Error('The permit end time has already passed. Extend it first.');
  return move(id, 'active', { issuer_name: name, issued_at: new Date().toISOString() }, 'Permit issued', name);
}

export function suspendPermit(id, reason, by) {
  return move(id, 'suspended', { suspend_reason: txt(reason, 300) }, 'Permit suspended: ' + txt(reason, 150), by);
}

export async function resumePermit(id, by) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  const t = getType(cur.type);
  if (t.gas_test.required === 'always' && !gasTestValid(cur)) throw new Error('Do a new passing gas test before resuming');
  return move(id, 'active', { suspend_reason: '' }, 'Permit resumed', by);
}

/* Extend or revalidate. Needs the receiver and issuer names. Total length is capped by the permit type. */
export async function extendPermit(id, hours, receiver, issuer) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  const t = getType(cur.type);
  const r = txt(receiver, 100);
  const i = txt(issuer, 100);
  if (!r || !i) throw new Error('Receiver and issuer must both sign the revalidation');
  const h = Math.max(1, Number(hours) || 1);
  const startMs = new Date(cur.issued_at || cur.start_at).getTime();
  const newEnd = Math.max(new Date(cur.valid_until).getTime(), Date.now()) + h * 3600000;
  if (newEnd - startMs > t.max_hours * 3600000) throw new Error('This permit type is limited to ' + t.max_hours + ' hours in total. Issue a new permit.');
  if (t.gas_test.required === 'always' && !gasTestValid(cur)) throw new Error('Do a new passing gas test before extending');
  const reval = { at: new Date().toISOString(), receiver: r, issuer: i, hours: h };
  const next = await patchOps(id, (x) => ({ valid_until: new Date(newEnd).toISOString(), status: x.status === 'expired' ? 'active' : x.status, revalidations: (x.revalidations || []).concat([reval]), log: logEntry(x, 'Revalidated for ' + h + ' h', r + ' / ' + i) }));
  return next;
}

export async function closePermit(id, name) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Permit not found');
  const n = txt(name, 100);
  if (!n) throw new Error('Enter the name of the person closing the permit');
  const missing = cur.signoffs.filter((s) => s.stage === 'closure' && s.required && !s.name);
  if (missing.length) throw new Error('Closure sign-off needed: ' + missing.map((m) => m.label).join(', '));
  const mins = Number(cur.fields && cur.fields.post_watch_minutes);
  const extra = { closed_at: new Date().toISOString(), closed_by: n };
  if (cur.type === 'hot_work' && mins > 0) extra.post_watch_until = new Date(Date.now() + mins * 60000).toISOString();
  return move(id, 'closed', extra, 'Permit closed', n);
}

export function cancelPermit(id, reason, by) {
  return move(id, 'cancelled', { cancel_reason: txt(reason, 300) }, 'Permit cancelled: ' + txt(reason, 150), by);
}

/* ---------- Bridges into Phase 4 ---------- */

export async function permitToObservation(permit, opts) {
  const o = opts || {};
  const t = getType(permit.type);
  const base = await createDraft();
  return createObservation({
    ...base,
    date: o.date || base.date,
    time: o.time || base.time,
    activity: t.bridge.activity + ' (' + permit.number + ')',
    hazard_category: t.bridge.hazard_category,
    risk_rating: o.risk || t.bridge.risk_rating,
    description: o.finding || '',
    location: permit.location || base.location,
    contractor: permit.contractor || base.contractor,
    legal_clause: (t.legal && t.legal[permit.country]) || suggestLegalClause(t.bridge.hazard_category, permit.country)
  });
}

export function permitToAction(permit, opts) {
  const o = opts || {};
  return createAction({
    title: o.title,
    description: (o.title || '') + ' (Permit ' + permit.number + ')',
    source_type: 'manual',
    source_no: permit.number,
    responsible: o.responsible || '',
    target_date: o.target_date || '',
    priority: o.priority || 'high',
    kind: 'corrective',
    projectId: permit.projectId || null
  });
}

/* Plain text copy of the permit for sharing */
export function permitText(permit) {
  const t = getType(permit.type);
  const lines = [permit.number + ' · ' + permit.title, 'Status: ' + statusLabel(permit.status), 'Location: ' + permit.location, 'Work: ' + permit.work_scope, 'From: ' + permit.start_at + '  Until: ' + permit.valid_until, 'Receiver: ' + permit.receiver_name + '   Issuer: ' + (permit.issuer_name || ''), 'JSA: ' + (permit.jsa_no || ''), ''];
  t.precautions.forEach((p) => lines.push('[' + (permit.precautions[p.id] || '--').toUpperCase() + '] ' + p.text));
  if ((permit.gas_tests || []).length) {
    lines.push('', 'GAS TESTS');
    permit.gas_tests.forEach((g) => lines.push(g.at + ' O2 ' + g.o2 + ' LEL ' + g.lel + ' H2S ' + g.h2s + ' CO ' + g.co + ' ' + (g.ok ? 'PASS' : 'FAIL') + ' (' + g.tester + ')'));
  }
  if ((permit.isolations || []).length) {
    lines.push('', 'ISOLATIONS');
    permit.isolations.forEach((x) => lines.push(x.point + ' lock ' + x.lock_id + ' (' + x.by + ')'));
  }
  lines.push('', 'SIGN-OFFS');
  permit.signoffs.forEach((s) => lines.push(s.stage + ': ' + s.label + ' - ' + (s.name || 'not signed')));
  return lines.join('\n');
}

export { uid };
