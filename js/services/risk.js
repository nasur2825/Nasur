/* NASUR - Risk matrix and JSA / HIRA service (Phase 6) */
import { KINDS, listOps, getOps, saveOps, patchOps, removeOps, txt, uid, todayIso, addDaysIso, logEntry } from './opsstore.js';
import { createAction } from './actions.js';

const URL_LIB = 'data/ptw/risk_library.json';

const FALLBACK = {
  matrix: { likelihood: [1, 2, 3, 4, 5].map((n) => ({ n, label: String(n), desc: '' })), severity: [1, 2, 3, 4, 5].map((n) => ({ n, label: String(n) })), formula: 'Risk score = likelihood x severity' },
  bands: [
    { id: 'low', label: 'Low', min: 1, max: 4, color: '#16a34a', rank: 1, approver: 'Supervisor', action: 'Acceptable.' },
    { id: 'medium', label: 'Medium', min: 5, max: 9, color: '#eab308', rank: 1, approver: 'Supervisor', action: 'Reduce as far as reasonably practicable.' },
    { id: 'high', label: 'High', min: 10, max: 16, color: '#f97316', rank: 2, approver: 'Site / HSE Manager', action: 'Manager approval needed.' },
    { id: 'critical', label: 'Critical', min: 17, max: 25, color: '#dc2626', rank: 3, approver: 'Senior Management', action: 'Stop and redesign.' }
  ],
  approvers: [{ rank: 1, id: 'supervisor', label: 'Supervisor' }, { rank: 2, id: 'manager', label: 'Site / HSE Manager' }, { rank: 3, id: 'senior', label: 'Senior Management' }],
  hierarchy: ['Elimination', 'Substitution', 'Engineering', 'Administrative', 'PPE'],
  jsa_rules: [],
  briefing: [],
  templates: []
};

let lib = null;

export async function loadRiskLibrary() {
  if (lib) return lib;
  try {
    const res = await fetch(URL_LIB, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lib = await res.json();
  } catch (e) {
    lib = FALLBACK;
  }
  return lib;
}

export function getLibrary() {
  return lib || FALLBACK;
}

/* ---------- Matrix ---------- */

export function clampLevel(n) {
  const v = parseInt(n, 10);
  return isNaN(v) ? 1 : Math.min(5, Math.max(1, v));
}

export function score(l, s) {
  return clampLevel(l) * clampLevel(s);
}

export function bandFor(sc) {
  const bands = getLibrary().bands;
  return bands.find((b) => sc >= b.min && sc <= b.max) || bands[bands.length - 1];
}

/* Same words used by the Observations sheet: Low, Medium, High, Critical */
export function ratingFor(sc) {
  return bandFor(sc).label;
}

export function approvalFor(sc) {
  const b = bandFor(sc);
  const approver = getLibrary().approvers.find((a) => a.rank === b.rank);
  return { band: b, rank: b.rank, role: approver ? approver.label : b.approver };
}

/* 5 rows (severity 5 down to 1) x 5 columns (likelihood 1 to 5) */
export function matrixGrid() {
  const rows = [];
  for (let s = 5; s >= 1; s--) {
    const row = [];
    for (let l = 1; l <= 5; l++) {
      const sc = l * s;
      row.push({ l, s, score: sc, band: bandFor(sc) });
    }
    rows.push(row);
  }
  return rows;
}

/* ---------- JSA model ---------- */

export function newControl(text) {
  return { text: txt(typeof text === 'string' ? text : text && text.text, 240), in_place: !!(text && text.in_place), action_id: (text && text.action_id) || '' };
}

export function newStep(init) {
  const i = init || {};
  return {
    id: i.id || uid('stp'),
    step: txt(i.step, 200),
    hazards: (Array.isArray(i.hazards) ? i.hazards : []).map((h) => txt(h, 200)).filter(Boolean),
    controls: (Array.isArray(i.controls) ? i.controls : []).map(newControl).filter((c) => c.text),
    hierarchy: getLibrary().hierarchy.includes(i.hierarchy) ? i.hierarchy : 'Administrative',
    initial: { l: clampLevel(i.initial && i.initial.l), s: clampLevel(i.initial && i.initial.s) },
    residual: { l: clampLevel(i.residual && i.residual.l), s: clampLevel(i.residual && i.residual.s) },
    responsible: txt(i.responsible, 100)
  };
}

export function newJsa(init) {
  const i = init || {};
  return {
    title: txt(i.title, 160),
    job: txt(i.job, 600),
    location: txt(i.location, 160),
    activity: txt(i.activity, 160),
    permit_id: i.permit_id || '',
    permit_no: txt(i.permit_no, 40),
    template_id: i.template_id || '',
    prepared_by: txt(i.prepared_by, 100),
    reviewed_by: txt(i.reviewed_by, 100),
    valid_until: txt(i.valid_until, 10),
    steps: (Array.isArray(i.steps) ? i.steps : []).map(newStep),
    briefed: (Array.isArray(i.briefed) ? i.briefed : []).map((b) => ({ name: txt(b.name, 100), at: b.at || '' })).filter((b) => b.name),
    status: 'draft'
  };
}

export function listTemplates() {
  return getLibrary().templates.map((t) => ({ id: t.id, title: t.title, steps: t.steps.length }));
}

export function fromTemplate(templateId, extra) {
  const t = getLibrary().templates.find((x) => x.id === templateId);
  if (!t) throw new Error('Template not found');
  return newJsa({ ...(extra || {}), title: (extra && extra.title) || t.title + ' JSA', template_id: t.id, activity: (extra && extra.activity) || t.title, steps: t.steps.map((s) => ({ ...s, controls: s.controls.map((c) => ({ text: c, in_place: false })) })) });
}

/* ---------- Validation ---------- */

export function stepScores(step) {
  const i = score(step.initial.l, step.initial.s);
  const r = score(step.residual.l, step.residual.s);
  return { initial: i, residual: r, initialBand: bandFor(i), residualBand: bandFor(r) };
}

export function validateStep(step) {
  const errors = [];
  const warnings = [];
  const sc = stepScores(step);
  if (!String(step.step || '').trim()) errors.push('Describe the step');
  if (!(step.hazards || []).length) errors.push('List at least one hazard');
  if (!(step.controls || []).length) errors.push('Add at least one control');
  if (sc.residual > sc.initial) errors.push('Residual risk cannot be higher than initial risk');
  if (sc.initial >= 10 && (step.controls || []).length < 2) warnings.push('High or Critical risk: add more than one control');
  if (sc.initial >= 10 && step.hierarchy === 'PPE') warnings.push('PPE alone is weak for High risk: add engineering or administrative controls');
  if (sc.residual >= 10) warnings.push('Residual risk is still High or Critical');
  return { ok: !errors.length, errors, warnings };
}

export function jsaSummary(jsa) {
  const steps = jsa.steps || [];
  let maxI = 0;
  let maxR = 0;
  let open = 0;
  steps.forEach((s) => {
    const sc = stepScores(s);
    maxI = Math.max(maxI, sc.initial);
    maxR = Math.max(maxR, sc.residual);
    open += (s.controls || []).filter((c) => !c.in_place).length;
  });
  return { steps: steps.length, maxInitial: maxI, maxResidual: maxR, initialBand: maxI ? bandFor(maxI) : null, residualBand: maxR ? bandFor(maxR) : null, openControls: open, requiredApprover: maxR ? approvalFor(maxR) : null };
}

/* What blocks approval right now */
export function jsaReadiness(jsa) {
  const issues = [];
  const steps = jsa.steps || [];
  if (!String(jsa.title || '').trim()) issues.push('Give the JSA a title');
  if (!String(jsa.job || '').trim()) issues.push('Describe the job');
  if (!steps.length) issues.push('Add at least one step');
  steps.forEach((s, i) => validateStep(s).errors.forEach((e) => issues.push('Step ' + (i + 1) + ': ' + e)));
  if (!String(jsa.prepared_by || '').trim()) issues.push('Enter who prepared it');
  if (!(jsa.briefed || []).length) issues.push('Brief the crew and record at least one name');
  const sum = jsaSummary(jsa);
  if (sum.openControls > 0) issues.push(sum.openControls + ' control(s) are not in place yet');
  return { ready: !issues.length, issues, summary: sum };
}

/* approverRank: 1 supervisor, 2 manager, 3 senior management */
export function canApprove(jsa, approverRank) {
  const r = jsaReadiness(jsa);
  const need = r.summary.requiredApprover ? r.summary.requiredApprover.rank : 1;
  const problems = r.issues.slice();
  if (approverRank < need) problems.push('Residual risk needs approval by ' + r.summary.requiredApprover.role);
  return { ok: !problems.length, problems, need };
}

/* ---------- Persistence ---------- */

export async function saveJsa(jsa) {
  const clean = newJsa(jsa);
  const rec = await saveOps(KINDS.RA, { ...jsa, ...clean, id: jsa.id, status: jsa.status || 'draft', summary: clean.job }, { prefix: 'RA', date: todayIso() });
  return rec;
}

export const getJsa = (id) => getOps(id);
export const listJsas = (filter) => listOps(KINDS.RA, filter);
export const removeJsa = (id) => removeOps(id);

export async function approveJsa(id, who) {
  const cur = await getOps(id);
  if (!cur) throw new Error('JSA not found');
  const rank = who && who.rank ? who.rank : 1;
  const check = canApprove(cur, rank);
  if (!check.ok) throw new Error(check.problems.join('. '));
  const name = txt(who && who.name, 100);
  if (!name) throw new Error('Enter the approver name');
  return patchOps(id, (r) => ({ status: 'approved', approved_by: name, approver_rank: rank, approved_at: new Date().toISOString(), log: logEntry(r, 'JSA approved', name) }));
}

export async function reopenJsa(id, by) {
  return patchOps(id, (r) => ({ status: 'draft', approved_by: '', approved_at: '', log: logEntry(r, 'JSA reopened for changes', by) }));
}

export function isExpired(jsa, now) {
  return !!(jsa.valid_until && jsa.valid_until < todayIso(now || new Date()));
}

/* Every control that is not in place becomes a tracked action (once) */
export async function jsaToActions(id, opts) {
  const o = opts || {};
  const jsa = await getOps(id);
  if (!jsa) throw new Error('JSA not found');
  const created = [];
  const steps = jsa.steps.map((s) => ({ ...s, controls: s.controls.map((c) => ({ ...c })) }));
  for (const s of steps) {
    const sc = stepScores(s);
    for (const c of s.controls) {
      if (c.in_place || c.action_id) continue;
      const a = await createAction({
        title: c.text,
        description: c.text + ' (JSA ' + jsa.number + ', step: ' + s.step + ')',
        source_type: 'manual',
        source_no: jsa.number,
        responsible: s.responsible || o.responsible || '',
        target_date: o.target_date || addDaysIso(todayIso(), sc.initial >= 10 ? 3 : 7),
        priority: sc.initial >= 17 ? 'critical' : sc.initial >= 10 ? 'high' : 'medium',
        kind: 'preventive',
        projectId: jsa.projectId || null
      });
      c.action_id = a.id;
      created.push(a);
    }
  }
  if (created.length) await patchOps(id, { steps });
  return created;
}
