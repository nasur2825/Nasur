/* NASUR - Site Inspection & Audit Engine service (Phase 6)
   Ready-to-run checklists (ISO 45001, OSHA, factory, construction, contractor), weighted scoring,
   photo evidence and one-tap conversion of failed items into Observations and corrective actions. */
import { KINDS, listOps, getOps, saveOps, patchOps, removeOps, txt, todayIso, addDaysIso, logEntry } from './opsstore.js';
import { createAction } from './actions.js';
import { createDraft, createObservation, nowTime } from './observations.js';

const URL_AUDITS = 'data/audits.json';
export const MAX_EVIDENCE = 3;

let data = null;

export async function loadAudits() {
  if (data) return data;
  const res = await fetch(URL_AUDITS, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load audit checklists (HTTP ' + res.status + ')');
  data = await res.json();
  return data;
}

export function auditData() {
  if (!data) throw new Error('Audit checklists are not loaded');
  return data;
}

export const listChecklists = () => auditData().checklists;
export const getChecklist = (id) => auditData().checklists.find((c) => c.id === id) || null;

/* ---------- Scoring ---------- */

function weightOf(q) {
  const s = auditData().scoring;
  return q.critical ? s.critical_weight : s.normal_weight;
}

export function ratingFor(percent) {
  const ratings = auditData().scoring.ratings;
  if (percent == null) return { id: 'none', label: 'Not scored', color: '#64748b', min: 0 };
  return ratings.find((r) => percent >= r.min) || ratings[ratings.length - 1];
}

export function computeScore(audit) {
  const cl = getChecklist(audit.checklist_id);
  const answers = audit.answers || {};
  let yesW = 0;
  let appW = 0;
  const counts = { yes: 0, no: 0, na: 0, unanswered: 0 };
  const criticalFails = [];
  const byArea = cl.areas.map((a) => ({ area: a.id, title: a.title, yesW: 0, appW: 0, fails: 0, answered: 0, total: 0 }));
  cl.questions.forEach((q) => {
    const a = answers[q.id];
    const ar = byArea.find((x) => x.area === q.area);
    ar.total++;
    if (!a || !a.v) {
      counts.unanswered++;
      return;
    }
    ar.answered++;
    counts[a.v]++;
    if (a.v === 'na') return;
    const w = weightOf(q);
    appW += w;
    ar.appW += w;
    if (a.v === 'yes') {
      yesW += w;
      ar.yesW += w;
    } else {
      ar.fails++;
      if (q.critical) criticalFails.push(q);
    }
  });
  const percent = appW > 0 ? Math.round((yesW / appW) * 100) : null;
  let rating = ratingFor(percent);
  const improve = auditData().scoring.ratings.find((r) => r.id === 'improve');
  if (criticalFails.length && percent != null && percent >= improve.min + 1 && rating.min > improve.min) rating = improve;
  const total = cl.questions.length;
  return {
    total,
    answered: total - counts.unanswered,
    counts,
    percent,
    rating,
    capped: criticalFails.length > 0 && percent != null && ratingFor(percent).id !== rating.id,
    criticalFails,
    byArea: byArea.map((a) => ({ ...a, percent: a.appW ? Math.round((a.yesW / a.appW) * 100) : null }))
  };
}

/* ---------- Audits ---------- */

export async function startAudit(init) {
  const i = init || {};
  const cl = getChecklist(i.checklist_id);
  if (!cl) throw new Error('Choose a checklist');
  const date = todayIso();
  return saveOps(KINDS.AUDIT, {
    checklist_id: cl.id,
    checklist_title: cl.title,
    title: txt(i.title, 160) || cl.title + ' ' + date,
    location: txt(i.location, 160),
    auditor: txt(i.auditor, 100),
    scope: txt(i.scope, 300),
    audit_date: date,
    started_at: new Date().toISOString(),
    status: 'in_progress',
    answers: {},
    evidence: {}
  }, { prefix: 'AUDIT', date });
}

export const getAudit = (id) => getOps(id);
export const listAudits = (filter) => listOps(KINDS.AUDIT, filter);
export const removeAudit = (id) => removeOps(id);

export function answerQuestion(id, qid, value, note) {
  if (!['yes', 'no', 'na', ''].includes(value)) throw new Error('Invalid answer');
  return patchOps(id, (r) => {
    const prev = (r.answers || {})[qid] || {};
    const next = { ...prev, v: value, at: new Date().toISOString() };
    if (note !== undefined) next.note = txt(note, 400);
    return { answers: { ...r.answers, [qid]: next } };
  });
}

export function setNote(id, qid, note) {
  return patchOps(id, (r) => ({ answers: { ...r.answers, [qid]: { ...((r.answers || {})[qid] || {}), note: txt(note, 400) } } }));
}

export function addEvidence(id, qid, dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) throw new Error('Not an image');
  return patchOps(id, (r) => {
    const list = ((r.evidence || {})[qid] || []).slice();
    if (list.length >= MAX_EVIDENCE) throw new Error('Maximum ' + MAX_EVIDENCE + ' photos per question');
    list.push(dataUrl);
    return { evidence: { ...r.evidence, [qid]: list } };
  });
}

export function removeEvidence(id, qid, index) {
  return patchOps(id, (r) => ({ evidence: { ...r.evidence, [qid]: ((r.evidence || {})[qid] || []).filter((_, i) => i !== index) } }));
}

export async function completeAudit(id, by) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Audit not found');
  if (cur.status === 'completed') throw new Error('This audit is already completed');
  const sc = computeScore(cur);
  if (sc.counts.unanswered > 0) throw new Error(sc.counts.unanswered + ' question(s) are not answered. Answer or mark N/A.');
  const name = txt(by || cur.auditor, 100);
  if (!name) throw new Error('Enter the auditor name');
  const snap = { percent: sc.percent, rating: sc.rating.label, ratingId: sc.rating.id, yes: sc.counts.yes, no: sc.counts.no, na: sc.counts.na, criticalFails: sc.criticalFails.length };
  return patchOps(id, (r) => ({ status: 'completed', completed_at: new Date().toISOString(), auditor: name, score: snap, log: logEntry(r, 'Audit completed: ' + (snap.percent == null ? 'not scored' : snap.percent + '%'), name) }));
}

/* ---------- Failed items and conversion ---------- */

export function failedItems(audit) {
  const cl = getChecklist(audit.checklist_id);
  return cl.questions
    .filter((q) => ((audit.answers || {})[q.id] || {}).v === 'no')
    .map((q) => {
      const a = audit.answers[q.id];
      const area = cl.areas.find((x) => x.id === q.area);
      return { q, area, note: a.note || '', evidence: ((audit.evidence || {})[q.id] || []).length, observation_id: a.observation_id || '', action_id: a.action_id || '' };
    })
    .sort((x, y) => (y.q.critical ? 1 : 0) - (x.q.critical ? 1 : 0));
}

export function markLinked(id, qid, type, refId) {
  return patchOps(id, (r) => ({ answers: { ...r.answers, [qid]: { ...r.answers[qid], [type === 'observation' ? 'observation_id' : 'action_id']: refId } } }));
}

async function convertOne(audit, item, mode, opts) {
  const o = opts || {};
  const q = item.q;
  const text = 'Audit finding: ' + q.text + (item.note ? '. ' + item.note : '') + ' (' + audit.number + (q.ref ? ', ' + q.ref : '') + ')';
  if (mode === 'observation') {
    const base = await createDraft();
    const date = o.date || audit.audit_date || base.date;
    const photo = ((audit.evidence || {})[q.id] || [])[0] || '';
    const rec = await createObservation({
      ...base,
      date,
      time: o.time || nowTime(),
      activity: audit.checklist_title,
      hazard_category: item.area.hazard_category,
      risk_rating: q.critical ? 'High' : 'Medium',
      description: text,
      location: audit.location || base.location,
      legal_clause: q.ref && /CFR|ISO|Act|Code|Rule|Standard/i.test(q.ref) ? q.ref : '',
      photo_before: photo
    });
    return rec;
  }
  return createAction({
    title: 'Audit finding: ' + q.text,
    description: text,
    source_type: 'manual',
    source_no: audit.number,
    responsible: o.responsible || '',
    target_date: o.target_date || addDaysIso(todayIso(), q.critical ? 7 : 30),
    priority: q.critical ? 'high' : 'medium',
    kind: 'corrective',
    projectId: audit.projectId || null
  });
}

/* One-tap: every failed item not yet converted becomes an observation or an action */
export async function convertFindings(id, mode, opts) {
  const o = opts || {};
  let audit = await getOps(id);
  if (!audit) throw new Error('Audit not found');
  const items = failedItems(audit).filter((i) => (!o.onlyCritical || i.q.critical) && !(mode === 'observation' ? i.observation_id : i.action_id));
  const made = [];
  for (const it of items) {
    const rec = await convertOne(audit, it, mode, o);
    audit = (await markLinked(id, it.q.id, mode, rec.id)) || audit;
    made.push(rec);
  }
  return made;
}

export async function convertSingle(id, qid, mode, opts) {
  const audit = await getOps(id);
  if (!audit) throw new Error('Audit not found');
  const item = failedItems(audit).find((i) => i.q.id === qid);
  if (!item) throw new Error('This item did not fail');
  const rec = await convertOne(audit, item, mode, opts);
  await markLinked(id, qid, mode, rec.id);
  return rec;
}

/* ---------- Reports ---------- */

export function auditText(audit) {
  const sc = audit.score ? null : computeScore(audit);
  const snap = audit.score || { percent: sc.percent, rating: sc.rating.label, yes: sc.counts.yes, no: sc.counts.no, na: sc.counts.na, criticalFails: sc.criticalFails.length };
  const lines = [audit.number + ' · ' + audit.title, 'Checklist: ' + audit.checklist_title, 'Date: ' + audit.audit_date + '   Location: ' + (audit.location || ''), 'Auditor: ' + (audit.auditor || ''), 'Score: ' + (snap.percent == null ? 'not scored' : snap.percent + '%') + ' · ' + snap.rating + ' · Yes ' + snap.yes + ', No ' + snap.no + ', N/A ' + snap.na + ', critical fails ' + snap.criticalFails, ''];
  const items = failedItems(audit);
  lines.push('FINDINGS (' + items.length + ')');
  items.forEach((i, n) => lines.push((n + 1) + '. ' + (i.q.critical ? '[CRITICAL] ' : '') + i.q.text + (i.q.ref ? ' (' + i.q.ref + ')' : '') + (i.note ? ' - ' + i.note : '') + (i.observation_id ? ' [observation]' : '') + (i.action_id ? ' [action]' : '')));
  if (!items.length) lines.push('No failed items.');
  return lines.join('\n');
}

/* ---------- Summary and trend ---------- */

export async function auditSummary() {
  const all = await listAudits();
  const done = all.filter((a) => a.status === 'completed');
  const scored = done.filter((a) => a.score && a.score.percent != null);
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + a.score.percent, 0) / scored.length) : null;
  const openFindings = done.reduce((n, a) => n + failedItems(a).filter((i) => !i.observation_id && !i.action_id).length, 0);
  return { inProgress: all.filter((a) => a.status === 'in_progress').length, completed: done.length, averageScore: avg, openFindings };
}

export async function scoreTrend(checklistId) {
  const done = (await listAudits({ statuses: ['completed'] })).filter((a) => a.checklist_id === checklistId && a.score && a.score.percent != null);
  return done.sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at))).map((a) => ({ date: (a.completed_at || '').slice(0, 10), percent: a.score.percent, number: a.number }));
}
