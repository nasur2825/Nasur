/* NASUR - PPE Guide & Inspector module (Phase 5) */
import { loadRegions, getActiveRegionId } from '../services/regions.js';
import { sessionGet, sessionSet } from '../services/jarvis_core.js';
import {
  h,
  card,
  toast,
  ensureRefCss,
  missionBanner,
  walkBlock,
  legalBlock,
  tabsBar,
  actionBar,
  openObservationModal,
  shareText,
  loadPpe,
  ppeForTask,
  stdFor,
  inspectionVerdict,
  PPE_LEGAL,
  PPE_WALK,
  REGION_LABELS
} from '../services/safety_reference.js';

export const id = 'ppe_guide';

const TABS = [
  { id: 'select', label: 'Task selector' },
  { id: 'standards', label: 'Standards' },
  { id: 'inspect', label: 'Pre-use inspector' },
  { id: 'heat', label: 'Heat stress' },
  { id: 'legal', label: 'Legal' }
];

let root = null;
let ppe = null;
let tab = 'select';
let taskId = '';
let inspectId = '';

const PPE_TBT = [
  'TOOLBOX TALK: PPE is your last line of defence',
  '',
  '1. Choose PPE for the task hazard, not just for site entry',
  '2. Check it before every use: cracks, cuts, fading, loose straps',
  '3. Damaged PPE is tagged out and replaced, never used',
  '4. Respirators need a fit test and the right filter',
  '5. In heat, change the work method or time first. Do not remove protective PPE',
  '',
  'ASK THE CREW: What PPE does this job need and how do you know it is still good?',
  '',
  'Attendance: names, signatures and date.'
].join('\n');

function obsCfg(extra) {
  return () => ({
    title: 'PPE',
    hazard_category: 'PPE',
    activity: 'PPE use and inspection',
    risk_rating: 'High',
    typical: ['Worker without helmet', 'No harness when working at height', 'Wrong gloves for the chemical', 'Respirator not fit tested', 'Damaged PPE in use', 'Hearing protection not worn in noise area'],
    legal_clause: PPE_LEGAL[getActiveRegionId()],
    ...(extra || {})
  });
}

/* ---------- Task selector ---------- */

function selectTab() {
  const nodes = [walkBlock(PPE_WALK, 'Visual PPE walk-steps')];
  const grid = h('div', { class: 'rf-grid' }, ppe.tasks.map((t) => h('button', { class: 'rf-tile', type: 'button', 'aria-pressed': taskId === t.id ? 'true' : 'false', onclick: () => { taskId = t.id; render(); } }, h('span', { class: 'rf-ic', text: t.icon }), h('b', { text: t.label }), h('small', { text: t.ppe.length + ' items' }))));
  nodes.push(card('What is the task?', 'Pick the task to see the PPE it needs.', grid));
  if (!taskId) return nodes;

  const sel = ppeForTask(ppe, taskId);
  const key = 'ppe_worn_' + taskId;
  const worn = new Set(sessionGet(key, []));
  const region = getActiveRegionId();
  const summary = h('div');
  const upd = () => {
    const missing = sel.items.filter((i) => !worn.has(i.id));
    summary.replaceChildren(h('div', { class: 'rf-result' + (missing.length ? ' bad' : '') }, h('b', { text: missing.length ? 'Missing: ' + missing.map((m) => m.name).join(', ') : 'All required PPE is worn' })));
  };
  const rows = sel.items.map((it) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = worn.has(it.id);
    const label = h('label', { class: 'rf-check' + (cb.checked ? ' done' : '') }, cb, h('span', null, h('b', { text: it.icon + ' ' + it.name }), h('div', { class: 'rf-hint', text: REGION_LABELS[region] + ': ' + stdFor(it, region) }), h('div', { class: 'rf-hint', text: 'Protects against: ' + it.protects_against })));
    cb.addEventListener('change', () => {
      if (cb.checked) worn.add(it.id);
      else worn.delete(it.id);
      label.classList.toggle('done', cb.checked);
      sessionSet(key, Array.from(worn));
      upd();
    });
    return label;
  });
  upd();
  const tips = h('div', null, sel.items.map((it) => h('details', { class: 'rf-acc' }, h('summary', { text: it.icon + ' How to choose: ' + it.name }), h('div', null, h('ul', { class: 'rf-list' }, it.choose.map((c) => h('li', { text: c })))))));
  nodes.push(card(sel.task.icon + ' PPE for: ' + sel.task.label, sel.task.note + ' Tick what the worker is wearing.', [...rows, summary]));
  nodes.push(
    h(
      'div',
      { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Record missing PPE', onclick: () => {
        const missing = sel.items.filter((i) => !worn.has(i.id));
        if (!missing.length) return toast('Nothing missing. Well done.', 'info');
        openObservationModal({ ...obsCfg()(), title: sel.task.label, activity: sel.task.label, description: 'Missing PPE for ' + sel.task.label + ': ' + missing.map((m) => m.name).join(', ') });
      } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share PPE list', onclick: () => shareText('PPE for ' + sel.task.label, 'PPE FOR: ' + sel.task.label + '\n' + sel.items.map((i) => '- ' + i.name + ' (' + stdFor(i, region) + ')').join('\n') + '\n\n' + sel.task.note) })
    )
  );
  nodes.push(card('How to choose each item', '', tips));
  return nodes;
}

/* ---------- Standards ---------- */

function standardsTab() {
  const items = Object.values(ppe.items);
  return [
    card('Selection rules', '', h('ul', { class: 'rf-list' }, ppe.selection_rules.map((x) => h('li', { text: x })))),
    card('Standard codes by country', ppe.verifyNote, h('div', null, items.map((it) => h('details', { class: 'rf-acc' }, h('summary', { text: it.icon + ' ' + it.name }), h('div', null, h('div', { class: 'rf-legal' }, [['EU / Gulf (EN)', it.standards.eu], ['USA', it.standards.usa], ['Canada', it.standards.canada], ['India', it.standards.india]].map((r) => h('div', null, h('b', { text: r[0] }), r[1] || '-'))), h('p', { class: 'rf-hint', text: 'Protects against: ' + it.protects_against }))))))
  ];
}

/* ---------- Pre-use inspector ---------- */

function inspectTab() {
  const grid = h('div', { class: 'rf-grid' }, ppe.inspection.map((e) => h('button', { class: 'rf-tile', type: 'button', 'aria-pressed': inspectId === e.id ? 'true' : 'false', onclick: () => { inspectId = e.id; render(); } }, h('span', { class: 'rf-ic', text: e.icon }), h('b', { text: e.name }), h('small', { text: 'Before use' }))));
  const nodes = [card('What are you inspecting?', 'Check PPE before every use. Reject it if any defect is found.', grid)];
  if (!inspectId) return nodes;
  const e = ppe.inspection.find((x) => x.id === inspectId);
  const key = 'ppe_seen_' + e.id;
  const seen = sessionGet(key, {});
  const verdict = h('div');
  const upd = () => {
    const v = inspectionVerdict(e, seen);
    verdict.replaceChildren(h('div', { class: 'rf-result' + (v.reject ? ' bad' : '') }, h('b', { text: v.reject ? 'REJECT: tag out and replace. ' + v.hits.length + ' defect(s) found.' : 'No defects ticked. Complete the checks above, then it can be used.' })));
  };
  const checks = e.before_use.map((t) => h('li', { text: t }));
  const rejects = e.reject_if.map((t, i) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!seen[i];
    const row = h('label', { class: 'rf-check' }, cb, h('span', { text: t }));
    cb.addEventListener('change', () => {
      seen[i] = cb.checked;
      sessionSet(key, seen);
      upd();
    });
    return row;
  });
  upd();
  nodes.push(card(e.icon + ' ' + e.name + ': before use', '', h('ol', { class: 'rf-num' }, checks)));
  nodes.push(card('Tick any defect you see', 'One defect is enough to reject it.', [...rejects, verdict]));
  nodes.push(card('Care and life', '', [h('ul', { class: 'rf-list' }, e.care.map((x) => h('li', { text: x }))), h('p', { class: 'rf-hint', text: e.life })]));
  nodes.push(
    h(
      'div',
      { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Record defective PPE', onclick: () => {
        const v = inspectionVerdict(e, seen);
        if (!v.reject) return toast('No defects ticked', 'info');
        openObservationModal({ ...obsCfg()(), title: e.name + ' defect', activity: e.name + ' pre-use inspection', description: e.name + ' rejected at pre-use inspection: ' + v.hits.join('; ') });
      } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Reset ticks', onclick: () => { sessionSet(key, {}); render(); } })
    )
  );
  return nodes;
}

/* ---------- Heat stress ---------- */

function heatTab() {
  const hs = ppe.heat_stress;
  return [
    h('div', { class: 'rf-card', style: 'border-left:6px solid #f59e0b' }, h('b', { text: 'Heat stress PPE adjustments' }), h('p', { class: 'rf-hint', text: hs.principle })),
    card('Adjustments by PPE problem', '', h('div', { class: 'rf-hier' }, hs.adjustments.map((a) => h('div', null, h('b', { text: a.issue }), a.adjust)))),
    card('Heat rules', '', h('ul', { class: 'rf-list' }, hs.rules.map((x) => h('li', { text: x }))))
  ];
}

function legalTab() {
  return [legalBlock(PPE_LEGAL, 'PPE legal standards')];
}

async function render() {
  if (!root || !ppe) return;
  const builders = { select: selectTab, standards: standardsTab, inspect: inspectTab, heat: heatTab, legal: legalTab };
  const banner = await missionBanner();
  if (!root) return;
  root.replaceChildren(
    h(
      'div',
      { class: 'rf-wrap' },
      h('h1', { class: 'rf-title', text: '🦺 PPE Guide & Inspector' }),
      h('p', { class: 'rf-sub', text: 'Task-to-PPE selector, EN / ANSI / CSA / IS standards, pre-use reject criteria and heat stress adjustments.' }),
      banner,
      tabsBar(TABS, tab, (t) => { tab = t; render(); }),
      builders[tab](),
      actionBar({ obs: obsCfg(), tbtTitle: 'Toolbox talk: PPE', tbtText: PPE_TBT })
    )
  );
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading PPE guide…' })));
  await loadRegions();
  try {
    ppe = await loadPpe();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load PPE data: ' + e.message })));
    return;
  }
  await render();
}

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
