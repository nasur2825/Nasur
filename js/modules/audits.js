/* NASUR - Site Inspections & Audit Engine module (Phase 6) */
import { loadRegions, formatDate, formatTime } from '../services/regions.js';
import { processPhoto, pickPhoto } from '../services/photos.js';
import { h, card, toast, ensureRefCss, ensureCss, missionBanner, walkBlock, tabsBar, openObservationModal, shareText } from '../services/safety_reference.js';
import {
  loadAudits,
  auditData,
  listChecklists,
  getChecklist,
  startAudit,
  getAudit,
  listAudits,
  removeAudit,
  answerQuestion,
  setNote,
  addEvidence,
  removeEvidence,
  computeScore,
  completeAudit,
  failedItems,
  markLinked,
  convertFindings,
  convertSingle,
  auditText,
  auditSummary,
  scoreTrend,
  MAX_EVIDENCE
} from '../services/audits.js';

export const id = 'audits';

const TABS = [
  { id: 'audits', label: 'Audits' },
  { id: 'library', label: 'Checklists' }
];

const WALK = {
  where_first: ['Walk the whole area first and look at the big picture before you open the checklist', 'Start with the highest risk work: lifting, work at height, energy isolation, confined spaces, hot work', 'Check records after you check the place: permits, certificates, training', 'Talk to workers and ask how the job is really done'],
  hidden: ['Guards removed or bypassed when nobody is watching', 'Paperwork that looks perfect but does not match the work', 'Repeat findings from the last audit that were never closed', 'Contractor workers and equipment outside the system'],
  protect: ['Workers exposed to a critical failure right now: stop the work first', 'People below or next to high-risk work']
};

let root = null;
let tab = 'audits';
let auditId = '';
let newFlow = false;
let pick = '';

function fmt(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : formatDate(d) + ' ' + formatTime(d);
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function input(value, onInput, type, placeholder) {
  const i = h('input', { class: 'st-input', type: type || 'text', value: value == null ? '' : value, placeholder: placeholder || '', autocomplete: 'off' });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

function ratingBadge(r) {
  return h('span', { class: 'op-score', style: 'background:' + r.color, text: r.label });
}

function meter(percent, color) {
  return h('div', { class: 'op-meter' }, h('i', { style: 'width:' + (percent || 0) + '%' + (color ? ';background:' + color : '') }));
}

/* ---------- Audits list ---------- */

async function auditsTab() {
  if (newFlow) return newAuditView();
  if (auditId) return auditView(auditId);
  const [all, sum] = await Promise.all([listAudits(), auditSummary()]);
  const running = all.filter((a) => a.status === 'in_progress');
  const done = all.filter((a) => a.status === 'completed');
  const nodes = [h('div', { class: 'op-kpis' }, [['In progress', sum.inProgress, false], ['Completed', sum.completed, false], ['Average score', sum.averageScore == null ? '-' : sum.averageScore + '%', false], ['Open findings', sum.openFindings, sum.openFindings > 0]].map((k) => h('div', { class: 'op-kpi' + (k[2] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] }))))];
  nodes.push(walkBlock(WALK, 'Visual audit walk'));
  nodes.push(h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '+ Start an audit', onclick: () => { newFlow = true; pick = ''; render(); window.scrollTo(0, 0); } })));
  if (running.length) nodes.push(card('Audits in progress', '', running.map((a) => { const sc = computeScore(a); return h('div', { class: 'op-doc soon', style: 'cursor:pointer', onclick: () => { auditId = a.id; render(); window.scrollTo(0, 0); } }, h('div', { class: 'op-top' }, h('b', { text: a.number + ' · ' + a.checklist_title }), h('span', { class: 'rf-hint', text: sc.answered + ' of ' + sc.total })), h('div', { class: 'rf-hint', text: a.title + (a.location ? ' · ' + a.location : '') }), meter(Math.round((sc.answered / sc.total) * 100))); })));
  const trends = {};
  for (const cl of listChecklists()) {
    const t = await scoreTrend(cl.id);
    if (t.length) trends[cl.id] = t.slice(-5).map((x) => x.percent + '%').join(' → ');
  }
  nodes.push(card('Completed audits', Object.keys(trends).length ? 'Trend: ' + Object.keys(trends).map((k) => getChecklist(k).title + ' ' + trends[k]).join(' · ') : '', done.length ? done.slice(0, 20).map((a) => { const r = auditData().scoring.ratings.find((x) => x.id === (a.score && a.score.ratingId)) || { label: '-', color: '#64748b' }; const open = failedItems(a).filter((i) => !i.observation_id && !i.action_id).length; return h('div', { class: 'op-row', style: 'cursor:pointer', onclick: () => { auditId = a.id; render(); window.scrollTo(0, 0); } }, h('span', null, h('b', { text: a.number + ' · ' + a.checklist_title }), h('div', { class: 'rf-hint', text: fmt(a.completed_at) + (open ? ' · ' + open + ' finding(s) not converted' : '') })), h('span', { class: 'op-score', style: 'background:' + r.color, text: a.score && a.score.percent != null ? a.score.percent + '%' : '-' })); }) : h('p', { class: 'rf-hint', text: 'No completed audits yet.' })));
  return nodes;
}

function newAuditView() {
  const d = { title: '', location: '', auditor: '', scope: '' };
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Audits', onclick: () => { newFlow = false; render(); } })];
  nodes.push(card('Choose a checklist', auditData().notice, h('div', { class: 'rf-grid' }, listChecklists().map((c) => h('button', { class: 'rf-tile', type: 'button', 'aria-pressed': pick === c.id ? 'true' : 'false', onclick: () => { pick = c.id; render(); } }, h('span', { class: 'rf-ic', text: c.icon }), h('b', { text: c.title }), h('small', { text: c.questions.length + ' questions · ' + c.standard }))))));
  if (!pick) return nodes;
  const cl = getChecklist(pick);
  nodes.push(card(cl.icon + ' ' + cl.title, cl.description, [
    field('Audit title (optional)', input('', (v) => { d.title = v; })),
    field('Location or area audited', input('', (v) => { d.location = v; })),
    field('Auditor', input('', (v) => { d.auditor = v; })),
    field('Scope or notes', input('', (v) => { d.scope = v; })),
    h('button', { class: 'st-btn', type: 'button', text: 'Start audit now', onclick: async () => { try { const a = await startAudit({ checklist_id: pick, ...d }); newFlow = false; auditId = a.id; toast(a.number + ' started', 'success'); render(); window.scrollTo(0, 0); } catch (e) { toast(e.message, 'error'); } } })
  ]));
  return nodes;
}

/* ---------- Audit runner and report ---------- */

async function auditView(id0) {
  const a = await getAudit(id0);
  if (!a) {
    auditId = '';
    return auditsTab();
  }
  return a.status === 'completed' ? reportView(a) : runnerView(a);
}

function runnerView(a0) {
  let a = a0;
  const cl = getChecklist(a.checklist_id);
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Audits (saved)', onclick: () => { auditId = ''; render(); } })];
  const scoreHost = h('div', { class: 'rf-card' });
  const areaSummaries = {};
  const upd = () => {
    const sc = computeScore(a);
    scoreHost.replaceChildren(
      h('b', { text: a.number + ' · ' + cl.title }),
      h('div', { class: 'op-bigscore', style: 'color:' + sc.rating.color, text: sc.percent == null ? '-' : sc.percent + '%' }),
      h('div', { class: 'op-top' }, ratingBadge(sc.rating), h('span', { class: 'rf-hint', text: 'Yes ' + sc.counts.yes + ' · No ' + sc.counts.no + ' · N/A ' + sc.counts.na })),
      meter(Math.round((sc.answered / sc.total) * 100)),
      h('p', { class: 'rf-hint', text: sc.answered + ' of ' + sc.total + ' answered' + (sc.criticalFails.length ? ' · ' + sc.criticalFails.length + ' CRITICAL fail(s)' + (sc.capped ? ' (rating capped)' : '') : '') })
    );
    sc.byArea.forEach((ar) => { if (areaSummaries[ar.area]) areaSummaries[ar.area].textContent = ar.title + ' (' + ar.answered + '/' + ar.total + ')' + (ar.fails ? ' · ' + ar.fails + ' fail' : ''); });
  };
  nodes.push(scoreHost);

  cl.areas.forEach((area, ai) => {
    const qs = cl.questions.filter((q) => q.area === area.id);
    const sum = h('summary', { text: area.title });
    areaSummaries[area.id] = sum;
    const det = h('details', { class: 'rf-acc' }, sum);
    if (ai === 0) det.setAttribute('open', '');
    const body = h('div');
    qs.forEach((q) => {
      const ans = (a.answers || {})[q.id] || {};
      const row = h('div', { class: 'op-aq' + (ans.v === 'no' ? ' fail' : '') });
      const noteBox = h('div', { style: ans.v === 'no' || (a.evidence || {})[q.id] ? '' : 'display:none' });
      const note = h('input', { class: 'st-input', type: 'text', placeholder: 'What did you see?', value: ans.note || '' });
      note.addEventListener('change', async () => { a = (await setNote(a.id, q.id, note.value)) || a; });
      const thumbs = h('div', { class: 'in-photos', style: 'display:flex;gap:6px;flex-wrap:wrap' });
      const drawThumbs = () => thumbs.replaceChildren(...(((a.evidence || {})[q.id]) || []).map((src, i) => h('img', { src, alt: 'Evidence', style: 'width:72px;height:72px;object-fit:cover;border-radius:8px', onclick: async () => { if (!window.confirm('Remove this photo?')) return; a = (await removeEvidence(a.id, q.id, i)) || a; drawThumbs(); } })));
      const addPhoto = async (capture) => {
        if ((((a.evidence || {})[q.id]) || []).length >= MAX_EVIDENCE) return toast('Maximum ' + MAX_EVIDENCE + ' photos', 'error');
        const file = await pickPhoto(capture);
        if (!file) return;
        try {
          const url = await processPhoto(file, { label: 'AUDIT', date: new Date(), location: a.location, obsNo: a.number }, { maxEdge: 1000, quality: 0.6 });
          a = (await addEvidence(a.id, q.id, url)) || a;
          drawThumbs();
          noteBox.style.display = '';
        } catch (e) {
          toast(e.message, 'error');
        }
      };
      drawThumbs();
      noteBox.append(note, thumbs, h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn secondary small', type: 'button', text: '📷 Camera', onclick: () => addPhoto(true) }), h('button', { class: 'st-btn secondary small', type: 'button', text: 'Gallery', onclick: () => addPhoto(false) })));
      const seg = h('div', { class: 'op-seg' });
      [['yes', 'Yes', 'yes'], ['no', 'No', 'no'], ['na', 'N/A', 'na']].forEach(([v, label, cls]) => {
        const b = h('button', { type: 'button', class: 'op-seg-' + cls, text: label, 'aria-pressed': ans.v === v ? 'true' : 'false' });
        b.addEventListener('click', async () => {
          try {
            a = (await answerQuestion(a.id, q.id, v)) || a;
            seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
            row.classList.toggle('fail', v === 'no');
            noteBox.style.display = v === 'no' || ((a.evidence || {})[q.id] || []).length ? '' : 'none';
            upd();
          } catch (e) {
            toast(e.message, 'error');
          }
        });
        seg.appendChild(b);
      });
      row.append(h('div', null, q.critical ? h('span', { class: 'rf-pill crit', text: 'CRITICAL' }) : null, ' ', q.text), q.ref ? h('div', { class: 'op-ref', text: q.ref + (q.evidence ? ' · evidence: ' + q.evidence : '') }) : null, seg, noteBox);
      body.appendChild(row);
    });
    det.appendChild(body);
    nodes.push(det);
  });
  upd();
  cl.areas.forEach((area) => { const sc = computeScore(a).byArea.find((x) => x.area === area.id); areaSummaries[area.id].textContent = area.title + ' (' + sc.answered + '/' + sc.total + ')'; });

  nodes.push(card('Finish the audit', 'Every question needs an answer. Use N/A when it does not apply.', [
    h('button', { class: 'st-btn', type: 'button', text: 'Complete audit', onclick: async () => { const by = window.prompt('Auditor name?', a.auditor || ''); if (!by) return; try { await completeAudit(a.id, by); toast('Audit completed', 'success'); render(); window.scrollTo(0, 0); } catch (e) { toast(e.message, 'error'); } } }),
    h('button', { class: 'st-btn danger small', type: 'button', text: 'Discard audit', onclick: async () => { if (!window.confirm('Discard this audit?')) return; await removeAudit(a.id); auditId = ''; render(); } })
  ]));
  return nodes;
}

async function reportView(a) {
  const cl = getChecklist(a.checklist_id);
  const sc = computeScore(a);
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Audits', onclick: () => { auditId = ''; render(); } })];
  nodes.push(h('div', { class: 'rf-card', style: 'border-left:8px solid ' + sc.rating.color }, h('b', { text: a.number + ' · ' + a.title }), h('p', { class: 'rf-hint', text: cl.title + ' · ' + fmt(a.completed_at) + ' · ' + (a.auditor || '') + (a.location ? ' · ' + a.location : '') }), h('div', { class: 'op-bigscore', style: 'color:' + sc.rating.color, text: sc.percent == null ? '-' : sc.percent + '%' }), h('div', { class: 'op-top' }, ratingBadge(sc.rating), h('span', { class: 'rf-hint', text: 'Yes ' + sc.counts.yes + ' · No ' + sc.counts.no + ' · N/A ' + sc.counts.na })), sc.criticalFails.length ? h('p', { class: 'rf-hint', style: 'color:#dc2626', text: sc.criticalFails.length + ' critical item(s) failed. Fix these first.' + (sc.capped ? ' The rating is capped.' : '') }) : null));
  nodes.push(card('Score by area', '', sc.byArea.map((ar) => h('div', { class: 'op-row', style: 'flex-direction:column;align-items:stretch' }, h('div', { class: 'op-top' }, h('span', { text: ar.title }), h('b', { text: ar.percent == null ? 'N/A' : ar.percent + '%' })), meter(ar.percent, ar.percent != null && ar.percent < 60 ? '#dc2626' : ar.percent < 75 ? '#f59e0b' : '#16a34a')))));

  const items = failedItems(a);
  const findings = card('Findings (' + items.length + ')', 'Convert findings into observations or corrective actions with one tap.', items.length ? items.map((it) => h('div', { class: 'op-aq fail' },
    h('div', null, it.q.critical ? h('span', { class: 'rf-pill crit', text: 'CRITICAL' }) : null, ' ', it.q.text),
    h('div', { class: 'op-ref', text: [it.area.title, it.q.ref].filter(Boolean).join(' · ') + (it.note ? ' · ' + it.note : '') + (it.evidence ? ' · ' + it.evidence + ' photo(s)' : '') }),
    ((a.evidence || {})[it.q.id] || []).length ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, a.evidence[it.q.id].map((src) => h('img', { src, alt: 'Evidence', style: 'width:72px;height:72px;object-fit:cover;border-radius:8px' }))) : null,
    h('div', { class: 'rf-actions' },
      it.observation_id ? h('span', { class: 'op-badge op-b-ok', text: 'Observation created' }) : h('button', { class: 'st-btn small', type: 'button', text: '→ Observation', onclick: async () => { const rec = await openObservationModal({ title: a.number, hazard_category: it.area.hazard_category, activity: cl.title, risk_rating: it.q.critical ? 'High' : 'Medium', description: 'Audit finding: ' + it.q.text + (it.note ? '. ' + it.note : '') + ' (' + a.number + ')', legal_clause: it.q.ref || '' }); if (rec) { await markLinked(a.id, it.q.id, 'observation', rec.id); render(); } } }),
      it.action_id ? h('span', { class: 'op-badge op-b-ok', text: 'Action created' }) : h('button', { class: 'st-btn secondary small', type: 'button', text: '→ Action', onclick: async () => { try { await convertSingle(a.id, it.q.id, 'action'); toast('Action added to the Action Tracker', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } })))) : h('p', { class: 'rf-hint', text: 'No failed items. Well done.' }));
  nodes.push(findings);
  if (items.length) {
    const bulk = (mode) => async () => {
      const todo = items.filter((i) => !(mode === 'observation' ? i.observation_id : i.action_id)).length;
      if (!todo) return toast('Everything is already converted', 'info');
      const msg = mode === 'observation' ? 'Create ' + todo + ' observation(s) dated ' + formatDate(new Date(a.audit_date + 'T00:00:00')) + ' (the audit date)?' : 'Create ' + todo + ' corrective action(s)?';
      if (!window.confirm(msg)) return;
      try {
        const made = await convertFindings(a.id, mode);
        toast(made.length + (mode === 'observation' ? ' observation(s)' : ' action(s)') + ' created', 'success');
        render();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    nodes.push(card('Convert all findings', 'Observations go to the Phase 4 sheet. Actions go to the Action Tracker.', h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '➕ All to observations', onclick: bulk('observation') }), h('button', { class: 'st-btn secondary', type: 'button', text: '➕ All to actions', onclick: bulk('action') }))));
  }
  nodes.push(h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share report', onclick: () => shareText('Audit ' + a.number, auditText(a)) }), h('button', { class: 'st-btn danger', type: 'button', text: 'Delete audit', onclick: async () => { if (!window.confirm('Delete ' + a.number + '?')) return; await removeAudit(a.id); auditId = ''; render(); } })));
  return nodes;
}

/* ---------- Checklist library ---------- */

function libraryTab() {
  const s = auditData().scoring;
  return [
    card('How scoring works', s.formula, [h('ul', { class: 'rf-list' }, [h('li', { text: 'Critical items count ' + s.critical_weight + ' times as much as normal items.' }), h('li', { text: s.critical_rule })]), h('div', { class: 'rf-legal' }, s.ratings.map((r) => h('div', { style: 'border-left:6px solid ' + r.color }, h('b', { text: r.label }), r.min + '% and above'))) ]),
    ...listChecklists().map((c) => h('details', { class: 'rf-acc' }, h('summary', { text: c.icon + ' ' + c.title + ' (' + c.questions.length + ')' }), h('div', null, h('p', { class: 'rf-hint', text: c.description + ' Standard: ' + c.standard }), ...c.areas.map((ar) => h('div', null, h('h3', { text: ar.title }), h('ul', { class: 'rf-list' }, c.questions.filter((q) => q.area === ar.id).map((q) => h('li', { text: (q.critical ? '[CRITICAL] ' : '') + q.text + (q.ref ? ' (' + q.ref + ')' : '') }))))), h('button', { class: 'st-btn', type: 'button', text: 'Start this audit', onclick: () => { tab = 'audits'; newFlow = true; pick = c.id; render(); window.scrollTo(0, 0); } }))))
  ];
}

/* ---------- Screen ---------- */

async function render() {
  if (!root) return;
  let body;
  try {
    body = tab === 'audits' ? await auditsTab() : libraryTab();
  } catch (e) {
    body = [h('p', { class: 'rf-sub', text: 'Could not load: ' + e.message })];
  }
  const banner = await missionBanner();
  if (!root) return;
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('h1', { class: 'rf-title', text: '📋 Site Inspections & Audits' }), h('p', { class: 'rf-sub', text: 'Ready-to-run ISO 45001, OSHA, factory, construction and contractor audits with scoring, photo evidence and one-tap findings.' }), banner, tabsBar(TABS, tab, (t) => { tab = t; auditId = ''; newFlow = false; render(); }), ...[].concat(body).filter(Boolean)));
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  ensureCss('css/ops.css');
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading audits…' })));
  await loadRegions();
  try {
    await loadAudits();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load audit data: ' + e.message })));
    return;
  }
  await render();
}

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
