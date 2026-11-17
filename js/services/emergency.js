/* NASUR - Emergency Preparedness service (Phase 6)
   Site emergency plan, contacts and rescue team, muster points, drill runner with timed events and
   headcount, findings log and equipment checklists. The official site emergency plan always takes priority. */
import { KINDS, listOps, getOps, saveOps, patchOps, removeOps, txt, todayIso, daysUntil, logEntry } from './opsstore.js';
import { createAction } from './actions.js';
import { createDraft, createObservation } from './observations.js';
import { getActiveRegion } from './regions.js';

const URL_DATA = 'data/emergency.json';
export const DRILL_INTERVAL_DAYS = 365;
export const PLAN_COMPLETE_MIN_CHARS = 20;

let data = null;

export async function loadEmergency() {
  if (data) return data;
  const res = await fetch(URL_DATA, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load emergency data (HTTP ' + res.status + ')');
  data = await res.json();
  return data;
}

export function emergencyData() {
  if (!data) throw new Error('Emergency data is not loaded');
  return data;
}

export const getScenario = (id) => emergencyData().scenarios.find((s) => s.id === id) || null;
export const getRole = (id) => emergencyData().roles.find((r) => r.id === id) || null;
export const getChecklist = (id) => emergencyData().equipment_checklists.find((c) => c.id === id) || null;

/* Emergency numbers for the active country pack */
export function countryNumbers() {
  const e = (getActiveRegion() || {}).emergency || {};
  const out = [];
  Object.keys(e).forEach((k) => {
    if (k !== 'note') out.push({ label: k.charAt(0).toUpperCase() + k.slice(1), number: e[k] });
  });
  return { numbers: out, note: e.note || '' };
}

/* ---------- Emergency response plan (one per project) ---------- */

export async function getPlan() {
  const rows = await listOps(KINDS.PLAN);
  return rows[0] || null;
}

export function planStatus(plan) {
  const sections = emergencyData().plan_sections;
  if (!plan) return { complete: 0, filled: 0, total: sections.length, reviewDue: null, reviewState: 'none' };
  const filled = sections.filter((s) => String((plan.sections || {})[s.id] || '').trim().length >= PLAN_COMPLETE_MIN_CHARS).length;
  const days = plan.review_date ? daysUntil(plan.review_date) : null;
  return { complete: Math.round((filled / sections.length) * 100), filled, total: sections.length, reviewDue: days, reviewState: days == null ? 'none' : days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok' };
}

export async function savePlan(sections, meta) {
  const cur = await getPlan();
  const m = meta || {};
  const clean = {};
  emergencyData().plan_sections.forEach((s) => {
    clean[s.id] = txt((sections || {})[s.id], 3000);
  });
  const payload = { sections: clean, review_date: txt(m.review_date, 10), approved_by: txt(m.approved_by, 100), revision: txt(m.revision || (cur && cur.revision) || '1', 20), title: 'Emergency Response Plan' };
  if (cur) return patchOps(cur.id, { ...payload, log: logEntry(cur, 'Plan updated', payload.approved_by) });
  return saveOps(KINDS.PLAN, payload);
}

export function planText(plan) {
  const lines = ['EMERGENCY RESPONSE PLAN', 'Revision: ' + (plan.revision || '') + '   Review date: ' + (plan.review_date || '') + '   Approved by: ' + (plan.approved_by || ''), 'The official site emergency plan always takes priority.', ''];
  emergencyData().plan_sections.forEach((s) => lines.push(s.title.toUpperCase(), (plan.sections || {})[s.id] || '(not filled in)', ''));
  return lines.join('\n');
}

/* ---------- Contacts and rescue team ---------- */

export function telHref(phone) {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  return d ? 'tel:' + d : '';
}

export async function listContacts() {
  const rows = await listOps(KINDS.CONTACT);
  rows.sort((a, b) => (Number(a.priority) || 9) - (Number(b.priority) || 9) || String(a.name).localeCompare(String(b.name)));
  return rows;
}

function cleanContact(c) {
  return {
    name: txt(c.name, 100),
    role_type: emergencyData().contact_types.includes(c.role_type) ? c.role_type : 'Other',
    role: txt(c.role, 100),
    org: txt(c.org, 100),
    phone: txt(c.phone, 40),
    alt_phone: txt(c.alt_phone, 40),
    email: txt(c.email, 120),
    available: txt(c.available || '24h', 40),
    rescue_team: !!c.rescue_team,
    priority: Math.min(9, Math.max(1, parseInt(c.priority, 10) || 5)),
    notes: txt(c.notes, 300)
  };
}

export async function addContact(c) {
  const clean = cleanContact(c);
  if (!clean.name) throw new Error('Enter the name');
  if (!clean.phone) throw new Error('Enter a phone number');
  return saveOps(KINDS.CONTACT, { ...clean, title: clean.name, detail: clean.role_type + ' ' + clean.phone });
}

export async function updateContact(id, patch) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Contact not found');
  const clean = cleanContact({ ...cur, ...patch });
  if (!clean.name || !clean.phone) throw new Error('Name and phone are required');
  return patchOps(id, { ...clean, title: clean.name });
}

export const removeContact = (id) => removeOps(id);

export async function rescueTeam() {
  return (await listContacts()).filter((c) => c.rescue_team);
}

export function contactsText(list) {
  const lines = ['EMERGENCY CONTACTS', ''];
  const nums = countryNumbers();
  nums.numbers.forEach((n) => lines.push(n.label + ': ' + n.number));
  if (nums.note) lines.push(nums.note);
  lines.push('');
  list.forEach((c) => lines.push((c.rescue_team ? '[RESCUE] ' : '') + c.name + (c.role ? ' (' + c.role + ')' : '') + ' · ' + c.role_type + ' · ' + c.phone + (c.alt_phone ? ' / ' + c.alt_phone : '') + ' · ' + c.available));
  return lines.join('\n');
}

/* ---------- Muster points ---------- */

export const listMusters = () => listOps(KINDS.MUSTER);

export async function addMuster(m) {
  const name = txt(m.name, 100);
  if (!name) throw new Error('Enter the muster point name');
  return saveOps(KINDS.MUSTER, { name, description: txt(m.description, 300), capacity: parseInt(m.capacity, 10) || 0, coordinator: txt(m.coordinator, 100), wind_note: txt(m.wind_note, 200), title: name, detail: txt(m.description, 120) });
}

export const removeMuster = (id) => removeOps(id);
export const updateMuster = (id, patch) => patchOps(id, patch);

/* ---------- Drill runner ---------- */

function round1(n) {
  return Math.round(n * 10) / 10;
}

export async function startDrill(scenarioId, init) {
  const sc = getScenario(scenarioId);
  if (!sc) throw new Error('Unknown scenario');
  const i = init || {};
  const rec = await saveOps(KINDS.DRILL, {
    scenario: sc.id,
    scenario_title: sc.title,
    title: sc.title + ' drill',
    status: 'running',
    started_at: new Date().toISOString(),
    controller: txt(i.controller, 100),
    location: txt(i.location, 160),
    events: sc.drill.events.map((e) => ({ id: e.id, label: e.label, target_min: e.target_min, at: '', minutes: null })),
    headcount: { expected: i.expected != null ? Number(i.expected) || 0 : 0, counted: 0, missing: [] },
    findings: [],
    notes: ''
  }, { prefix: 'DRILL' });
  return rec;
}

export function markEvent(id, eventId, on) {
  return patchOps(id, (r) => {
    const start = new Date(r.started_at).getTime();
    return {
      events: r.events.map((e) => (e.id === eventId ? (on === false ? { ...e, at: '', minutes: null } : { ...e, at: new Date().toISOString(), minutes: round1((Date.now() - start) / 60000) }) : e))
    };
  });
}

export function setHeadcount(id, hc) {
  return patchOps(id, (r) => ({ headcount: { expected: Math.max(0, Number(hc.expected) || 0), counted: Math.max(0, Number(hc.counted) || 0), missing: (Array.isArray(hc.missing) ? hc.missing : []).map((m) => txt(m, 80)).filter(Boolean) } }));
}

export function addFinding(id, f) {
  const text = txt(f.text, 400);
  if (!text) throw new Error('Describe the finding');
  const entry = { id: 'fd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, severity: ['low', 'medium', 'high'].includes(f.severity) ? f.severity : 'medium', category: txt(f.category || '', 60), action_id: '' };
  return patchOps(id, (r) => ({ findings: (r.findings || []).concat([entry]) }));
}

export function removeFinding(id, findingId) {
  return patchOps(id, (r) => ({ findings: (r.findings || []).filter((f) => f.id !== findingId) }));
}

export function drillMetrics(drill) {
  const events = drill.events || [];
  const done = events.filter((e) => e.minutes != null);
  const late = done.filter((e) => e.target_min != null && e.minutes > e.target_min);
  const hc = drill.headcount || { expected: 0, counted: 0, missing: [] };
  const hcOk = hc.expected > 0 && hc.counted === hc.expected && !(hc.missing || []).length;
  const weights = { low: 2, medium: 5, high: 10 };
  const findingPenalty = (drill.findings || []).reduce((s, f) => s + (weights[f.severity] || 5), 0);
  const notDone = events.length - done.length;
  let sc = 100 - late.length * 10 - findingPenalty - (hcOk ? 0 : 20) - notDone * 5;
  sc = Math.max(0, Math.min(100, sc));
  const last = done.length ? Math.max(...done.map((e) => e.minutes)) : 0;
  return { done: done.length, total: events.length, late: late.map((e) => e.id), lateCount: late.length, headcountOk: hcOk, findings: (drill.findings || []).length, score: sc, pass: sc >= 70 && hcOk, durationMin: round1(last) };
}

export async function completeDrill(id, by) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Drill not found');
  if (cur.status === 'completed') throw new Error('This drill is already completed');
  const m = drillMetrics(cur);
  return patchOps(id, (r) => ({ status: 'completed', completed_at: new Date().toISOString(), completed_by: txt(by, 100), metrics: m, log: logEntry(r, 'Drill completed, score ' + m.score, by) }));
}

export const getDrill = (id) => getOps(id);
export const listDrills = (filter) => listOps(KINDS.DRILL, filter);
export const removeDrill = (id) => removeOps(id);

export async function drillToActions(id) {
  const d = await getOps(id);
  if (!d) throw new Error('Drill not found');
  const findings = (d.findings || []).map((f) => ({ ...f }));
  const made = [];
  for (const f of findings) {
    if (f.action_id) continue;
    const a = await createAction({
      title: f.text,
      description: f.text + ' (' + d.scenario_title + ' drill ' + d.number + ')',
      source_type: 'manual',
      source_no: d.number,
      priority: f.severity === 'high' ? 'high' : f.severity === 'low' ? 'low' : 'medium',
      kind: 'corrective',
      projectId: d.projectId || null
    });
    f.action_id = a.id;
    made.push(a);
  }
  if (made.length) await patchOps(id, { findings });
  return made;
}

export async function findingToObservation(drill, finding, opts) {
  const o = opts || {};
  const base = await createDraft();
  const cat = drill.scenario === 'fire' ? 'Fire & Explosion' : ['chemical_spill', 'toxic_gas'].includes(drill.scenario) ? 'Chemical & Hazardous Substances' : drill.scenario === 'confined_space_rescue' ? 'Confined Space' : drill.scenario === 'flood_storm' ? 'Heat & Cold' : 'Other';
  return createObservation({ ...base, date: o.date || base.date, time: o.time || base.time, activity: 'Emergency drill: ' + drill.scenario_title, hazard_category: cat, risk_rating: finding.severity === 'high' ? 'High' : finding.severity === 'low' ? 'Low' : 'Medium', description: finding.text + ' (drill ' + drill.number + ')', location: drill.location || base.location });
}

export function drillText(d) {
  const m = d.metrics || drillMetrics(d);
  const lines = [d.number + ' · ' + d.scenario_title + ' drill', 'Started: ' + d.started_at, 'Controller: ' + (d.controller || ''), 'Location: ' + (d.location || ''), 'Score: ' + m.score + ' (' + (m.pass ? 'PASS' : 'NEEDS WORK') + ')', ''];
  (d.events || []).forEach((e) => lines.push((e.minutes != null ? e.minutes + ' min' : 'not done') + '  ' + e.label + (e.target_min != null ? ' (target ' + e.target_min + ' min)' : '')));
  const hc = d.headcount || {};
  lines.push('', 'Headcount: expected ' + hc.expected + ', counted ' + hc.counted + (hc.missing && hc.missing.length ? ', missing: ' + hc.missing.join(', ') : ''), '', 'FINDINGS');
  (d.findings || []).forEach((f, i) => lines.push((i + 1) + '. [' + f.severity + '] ' + f.text));
  if (!(d.findings || []).length) lines.push('None recorded');
  return lines.join('\n');
}

/* Scenario drill status: when was the last completed drill and is the next one due? */
export async function drillStatus() {
  const done = (await listDrills({ statuses: ['completed'] })) || [];
  return emergencyData().scenarios.map((s) => {
    const mine = done.filter((d) => d.scenario === s.id).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
    const last = mine[0] ? mine[0].completed_at.slice(0, 10) : '';
    const days = last ? daysUntil(last) : null;
    const dueIn = last ? DRILL_INTERVAL_DAYS + days : null;
    return { scenario: s.id, title: s.title, icon: s.icon, last, lastScore: mine[0] && mine[0].metrics ? mine[0].metrics.score : null, dueIn, state: !last ? 'never' : dueIn < 0 ? 'overdue' : dueIn <= 30 ? 'soon' : 'ok' };
  });
}

/* ---------- Equipment checklists ---------- */

export async function startEquipCheck(categoryId, by) {
  const c = getChecklist(categoryId);
  if (!c) throw new Error('Unknown checklist');
  return saveOps(KINDS.EQUIP, { category: c.id, category_title: c.title, title: c.title + ' check', status: 'running', by: txt(by, 100), started_at: new Date().toISOString(), answers: {} }, { prefix: 'EQUIP' });
}

export function answerEquip(id, itemId, value, note) {
  if (!['ok', 'fail', 'na'].includes(value)) throw new Error('Invalid answer');
  return patchOps(id, (r) => ({ answers: { ...r.answers, [itemId]: { v: value, note: txt(note, 200) } } }));
}

export async function completeEquipCheck(id, by) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Check not found');
  const c = getChecklist(cur.category);
  const unanswered = c.items.filter((i) => !cur.answers[i.id]);
  if (unanswered.length) throw new Error(unanswered.length + ' item(s) are not answered yet');
  const fails = c.items.filter((i) => cur.answers[i.id].v === 'fail');
  return patchOps(id, (r) => ({ status: 'completed', completed_at: new Date().toISOString(), by: txt(by || r.by, 100), fail_count: fails.length, result: fails.length ? 'fail' : 'pass', log: logEntry(r, 'Check completed: ' + (fails.length ? fails.length + ' failed' : 'all passed'), by) }));
}

export const listEquipChecks = (filter) => listOps(KINDS.EQUIP, filter);
export const getEquipCheck = (id) => getOps(id);
export const removeEquipCheck = (id) => removeOps(id);

export async function equipFailuresToActions(id) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Check not found');
  const c = getChecklist(cur.category);
  const answers = { ...cur.answers };
  const made = [];
  for (const it of c.items) {
    const a = answers[it.id];
    if (!a || a.v !== 'fail' || a.action_id) continue;
    const act = await createAction({
      title: c.title + ': ' + it.text + ' (' + it.fail + ')',
      description: it.fail + (a.note ? '. ' + a.note : ''),
      source_type: 'manual',
      source_no: cur.number,
      priority: 'high',
      kind: 'corrective',
      projectId: cur.projectId || null
    });
    answers[it.id] = { ...a, action_id: act.id };
    made.push(act);
  }
  if (made.length) await patchOps(id, { answers });
  return made;
}

/* Latest completed check per category and whether the next one is due */
export async function equipStatus() {
  const done = await listEquipChecks({ statuses: ['completed'] });
  return emergencyData().equipment_checklists.map((c) => {
    const mine = done.filter((d) => d.category === c.id).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
    const last = mine[0] ? mine[0].completed_at.slice(0, 10) : '';
    const age = last ? -daysUntil(last) : null;
    const dueIn = last ? c.frequency_days - age : null;
    return { id: c.id, title: c.title, icon: c.icon, frequency_days: c.frequency_days, last, result: mine[0] ? mine[0].result : '', dueIn, state: !last ? 'never' : dueIn < 0 ? 'overdue' : dueIn <= Math.ceil(c.frequency_days / 4) ? 'soon' : 'ok' };
  });
}

/* ---------- Summary for the Home screen and the hub ---------- */

export async function emergencySummary() {
  const [plan, contacts, musters, drills, equip] = await Promise.all([getPlan(), listContacts(), listMusters(), drillStatus(), equipStatus()]);
  const ps = planStatus(plan);
  return {
    plan: ps,
    contacts: contacts.length,
    rescueTeam: contacts.filter((c) => c.rescue_team).length,
    musters: musters.length,
    drillsOverdue: drills.filter((d) => d.state === 'overdue' || d.state === 'never').length,
    equipmentOverdue: equip.filter((e) => e.state === 'overdue' || e.state === 'never').length
  };
}

export { todayIso };
