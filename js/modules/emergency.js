/* NASUR - Emergency Preparedness & Drill Hub module (Phase 6) */
import { loadRegions, formatDate, formatTime } from '../services/regions.js';
import { h, card, toast, ensureRefCss, ensureCss, missionBanner, walkBlock, tabsBar, openObservationModal, shareText } from '../services/safety_reference.js';
import {
  loadEmergency,
  emergencyData,
  getScenario,
  getRole,
  countryNumbers,
  getPlan,
  planStatus,
  savePlan,
  planText,
  telHref,
  listContacts,
  addContact,
  removeContact,
  updateContact,
  contactsText,
  listMusters,
  addMuster,
  removeMuster,
  startDrill,
  markEvent,
  setHeadcount,
  addFinding,
  removeFinding,
  drillMetrics,
  completeDrill,
  getDrill,
  listDrills,
  removeDrill,
  drillToActions,
  findingToObservation,
  drillText,
  drillStatus,
  startEquipCheck,
  answerEquip,
  completeEquipCheck,
  getEquipCheck,
  listEquipChecks,
  equipFailuresToActions,
  equipStatus,
  getChecklist,
  emergencySummary
} from '../services/emergency.js';

export const id = 'emergency';

const TABS = [
  { id: 'hub', label: 'Hub' },
  { id: 'plan', label: 'Plan' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'muster', label: 'Muster' },
  { id: 'drills', label: 'Drills' },
  { id: 'equip', label: 'Equipment' }
];

const WALK = {
  where_first: ['Exits and escape routes: clear, unlocked and signed', 'Muster points: signed, upwind and known to everyone', 'Alarm, radios and the phone tree: tested and working', 'Emergency equipment: eyewash, first aid, AED, spill kit and breathing apparatus', 'Who is on shift and who holds each emergency role tonight'],
  hidden: ['Locked or blocked exits and fire doors wedged open', 'Dead radios, flat batteries and out-of-date numbers', 'AED pads and escape sets out of date', 'Contractors and visitors who were never briefed', 'Lone workers nobody will miss in a headcount', 'A rescue plan that depends on someone entering without breathing apparatus'],
  protect: ['People who cannot leave quickly: visitors, contractors, anyone with a disability', 'Lone workers and night shift', 'Anyone in a confined space, trench or at height']
};

let root = null;
let tab = 'hub';
let scenarioId = '';
let drillId = '';
let equipId = '';
let plan = null;
let planTimer = null;
let planPill = null;
let tickTimer = null;

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

function badgeFor(state, textMap) {
  const cls = state === 'ok' ? 'op-b-ok' : state === 'soon' ? 'op-b-soon' : state === 'overdue' || state === 'never' ? 'op-b-over' : 'op-b-none';
  const t = textMap || { ok: 'OK', soon: 'Due soon', overdue: 'Overdue', never: 'Never done', none: '-' };
  return h('span', { class: 'op-badge ' + cls, text: t[state] || state });
}

function tick() {
  const now = Date.now();
  document.querySelectorAll('.op-clock[data-start]').forEach((el) => {
    const s = Math.max(0, Math.floor((now - new Date(el.getAttribute('data-start')).getTime()) / 1000));
    const p = (n) => String(n).padStart(2, '0');
    el.textContent = p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  });
}

/* ---------- Hub ---------- */

async function hubTab() {
  if (scenarioId) return scenarioView(getScenario(scenarioId));
  const sum = await emergencySummary();
  const nums = countryNumbers();
  const nodes = [h('div', { class: 'op-banner' }, h('b', { text: 'The official site emergency plan always takes priority.' }), h('p', { class: 'rf-hint', text: emergencyData().notice }))];
  nodes.push(
    card('Emergency numbers for your country', nums.note, h('div', { class: 'rf-actions' }, nums.numbers.map((n) => h('a', { class: 'st-btn', href: telHref(n.number), style: 'text-align:center;text-decoration:none', text: '📞 ' + n.label + ' ' + n.number }))))
  );
  const kp = [['Plan complete', sum.plan.complete + '%', sum.plan.complete < 80], ['Contacts', sum.contacts, sum.contacts === 0], ['Rescue team', sum.rescueTeam, sum.rescueTeam === 0], ['Muster points', sum.musters, sum.musters === 0], ['Drills due', sum.drillsOverdue, sum.drillsOverdue > 0], ['Equip overdue', sum.equipmentOverdue, sum.equipmentOverdue > 0]];
  nodes.push(h('div', { class: 'op-kpis', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, kp.map((k) => h('div', { class: 'op-kpi' + (k[2] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] })))));
  nodes.push(walkBlock(WALK, 'Visual emergency readiness walk'));
  nodes.push(card('Emergency scenario playbooks', 'First five minutes for each scenario.', h('div', { class: 'rf-grid' }, emergencyData().scenarios.map((s) => h('button', { class: 'rf-tile', type: 'button', onclick: () => { scenarioId = s.id; render(); window.scrollTo(0, 0); } }, h('span', { class: 'rf-ic', text: s.icon }), h('b', { text: s.title }), h('small', { text: 'Playbook and drill' }))))));
  return nodes;
}

function scenarioView(s) {
  const text = () => ['EMERGENCY PLAYBOOK: ' + s.title, '', 'FIRST MINUTES', ...s.first_minutes.map((x, i) => (i + 1) + '. ' + x), '', 'INFORM', ...s.inform.map((x) => '- ' + x), '', 'DO NOT', ...s.dont.map((x) => '- ' + x), '', 'The official site emergency plan always takes priority.'].join('\n');
  return [
    h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← All scenarios', onclick: () => { scenarioId = ''; render(); } }),
    h('div', { class: 'rf-card', style: 'border-left:8px solid ' + s.color }, h('div', { class: 'rf-hero' }, h('span', { class: 'rf-ic', text: s.icon }), h('h1', { class: 'rf-title', text: s.title })), h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '▶ Run a drill', onclick: () => beginDrill(s.id) }), h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share playbook', onclick: () => shareText('Emergency playbook: ' + s.title, text()) }))),
    card('First five minutes', '', h('ol', { class: 'rf-num' }, s.first_minutes.map((x) => h('li', { text: x })))),
    card('Who does what', '', h('div', null, s.roles.map((rid) => { const r = getRole(rid); return r ? h('details', { class: 'rf-acc' }, h('summary', { text: r.label }), h('div', null, h('ul', { class: 'rf-list' }, r.duties.map((d) => h('li', { text: d }))))) : null; }))),
    card('Who to inform', '', h('ul', { class: 'rf-list' }, s.inform.map((x) => h('li', { text: x })))),
    h('div', { class: 'rf-card', style: 'border-left:6px solid #dc2626' }, h('h2', { text: 'Do NOT' }), h('ul', { class: 'rf-list' }, s.dont.map((x) => h('li', { text: x })))),
    card('Equipment needed', '', h('ul', { class: 'rf-list' }, s.equipment.map((x) => h('li', { text: x }))))
  ];
}

/* ---------- Plan ---------- */

async function planTab() {
  if (!plan) plan = (await getPlan()) || { sections: {}, review_date: '', approved_by: '', revision: '1' };
  const data = emergencyData();
  const st = planStatus(plan.id ? plan : null);
  planPill = h('span', { class: 'ob-status saved', text: 'Saved ✓' });
  const save = () => {
    planPill.textContent = 'Saving…';
    clearTimeout(planTimer);
    planTimer = setTimeout(async () => {
      try {
        const rec = await savePlan(plan.sections, { review_date: plan.review_date, approved_by: plan.approved_by, revision: plan.revision });
        plan = { ...plan, id: rec.id };
        planPill.textContent = 'Saved ✓';
      } catch (e) {
        planPill.textContent = 'Save failed';
        toast(e.message, 'error');
      }
    }, 700);
  };
  const nodes = [h('div', { class: 'op-banner' + (st.complete >= 80 ? ' ok' : '') }, h('div', { class: 'op-top' }, h('b', { text: 'Plan ' + st.complete + '% complete (' + st.filled + ' of ' + st.total + ' sections)' }), planPill), h('div', { class: 'op-meter' }, h('i', { style: 'width:' + st.complete + '%' })), st.reviewState === 'overdue' ? h('p', { class: 'rf-hint', style: 'color:#dc2626', text: 'Plan review is overdue.' }) : st.reviewState === 'soon' ? h('p', { class: 'rf-hint', text: 'Plan review due in ' + st.reviewDue + ' days.' }) : null)];
  nodes.push(h('p', { class: 'rf-hint', text: 'Write the site plan here, or summarise the official plan. The official site emergency plan always takes priority.' }));
  data.plan_sections.forEach((s) => {
    const ta = h('textarea', { class: 'st-input', rows: '4', placeholder: s.hint });
    ta.value = (plan.sections || {})[s.id] || '';
    ta.addEventListener('input', () => { plan.sections = { ...(plan.sections || {}), [s.id]: ta.value }; save(); });
    nodes.push(card(s.title, s.hint, ta));
  });
  nodes.push(card('Review and approval', '', [field('Revision', input(plan.revision, (v) => { plan.revision = v; save(); })), field('Review date', input(plan.review_date, (v) => { plan.review_date = v; save(); }, 'date')), field('Approved by', input(plan.approved_by, (v) => { plan.approved_by = v; save(); })), h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share plan', onclick: () => shareText('Emergency Response Plan', planText(plan)) })]));
  return nodes;
}

/* ---------- Contacts ---------- */

async function contactsTab() {
  const list = await listContacts();
  const c = { name: '', role: '', role_type: 'Emergency services', org: '', phone: '', alt_phone: '', available: '24h', rescue_team: false, priority: 5 };
  const rows = list.map((x) =>
    h('div', { class: 'op-doc ' + (x.rescue_team ? 'ok' : '') }, h('div', { class: 'op-top' }, h('b', { text: x.name }), x.rescue_team ? h('span', { class: 'op-badge op-b-ok', text: 'Rescue team' }) : null), h('div', { class: 'rf-hint', text: [x.role, x.role_type, x.org, 'Available: ' + x.available].filter(Boolean).join(' · ') }), h('div', { class: 'rf-actions' }, h('a', { class: 'st-btn', href: telHref(x.phone), style: 'text-align:center;text-decoration:none', text: '📞 ' + x.phone }), x.alt_phone ? h('a', { class: 'st-btn secondary', href: telHref(x.alt_phone), style: 'text-align:center;text-decoration:none', text: '📞 ' + x.alt_phone }) : null), h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn secondary small', type: 'button', text: x.rescue_team ? 'Remove from rescue team' : 'Add to rescue team', onclick: async () => { await updateContact(x.id, { rescue_team: !x.rescue_team }); render(); } }), h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete', onclick: async () => { if (!window.confirm('Delete ' + x.name + '?')) return; await removeContact(x.id); render(); } })))
  );
  const typeSel = h('select', { class: 'st-select' }, emergencyData().contact_types.map((t) => h('option', { value: t, text: t })));
  typeSel.addEventListener('change', () => { c.role_type = typeSel.value; });
  const rescue = h('input', { type: 'checkbox' });
  rescue.addEventListener('change', () => { c.rescue_team = rescue.checked; });
  return [
    h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share contact list', onclick: () => shareText('Emergency contacts', contactsText(list)) })),
    h('div', { class: 'op-list' }, rows.length ? rows : [h('div', { class: 'ob-empty', text: 'No contacts yet. Add the site manager, first aiders, rescue team, hospital and client.' })]),
    card('Add a contact', '', [
      field('Name', input('', (v) => { c.name = v; })),
      field('Role or title', input('', (v) => { c.role = v; })),
      field('Type', typeSel),
      field('Company', input('', (v) => { c.org = v; })),
      field('Phone', input('', (v) => { c.phone = v; }, 'tel')),
      field('Second phone', input('', (v) => { c.alt_phone = v; }, 'tel')),
      field('Available', input('24h', (v) => { c.available = v; })),
      h('label', { class: 'rf-check' }, rescue, h('span', { text: 'Member of the rescue team' })),
      h('button', { class: 'st-btn', type: 'button', text: 'Save contact', onclick: async () => { try { await addContact(c); toast('Contact saved', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } })
    ])
  ];
}

/* ---------- Muster ---------- */

async function musterTab() {
  const list = await listMusters();
  const m = { name: '', description: '', capacity: '', coordinator: '', wind_note: '' };
  return [
    h('div', { class: 'op-list' }, list.length ? list.map((x) => h('div', { class: 'op-doc ok' }, h('div', { class: 'op-top' }, h('b', { text: '📍 ' + x.name }), x.capacity ? h('span', { class: 'rf-hint', text: 'Capacity ' + x.capacity }) : null), h('div', { class: 'rf-hint', text: x.description }), h('div', { class: 'rf-hint', text: [x.coordinator && 'Coordinator: ' + x.coordinator, x.wind_note].filter(Boolean).join(' · ') }), h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete', onclick: async () => { if (!window.confirm('Delete ' + x.name + '?')) return; await removeMuster(x.id); render(); } }))) : [h('div', { class: 'ob-empty', text: 'No muster points yet.' })]),
    card('Add a muster point', '', [field('Name', input('', (v) => { m.name = v; })), field('Where and how to get there', input('', (v) => { m.description = v; })), field('Capacity (people)', input('', (v) => { m.capacity = v; }, 'number')), field('Coordinator', input('', (v) => { m.coordinator = v; })), field('Wind and hazard note', input('', (v) => { m.wind_note = v; }, 'text', 'Upwind of the process area')), h('button', { class: 'st-btn', type: 'button', text: 'Save muster point', onclick: async () => { try { await addMuster(m); toast('Muster point saved', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } })]),
    card('Muster point guidelines', '', h('ul', { class: 'rf-list' }, emergencyData().muster_guidelines.map((x) => h('li', { text: x }))))
  ];
}

/* ---------- Drills ---------- */

async function beginDrill(sid) {
  const sc = getScenario(sid);
  const controller = window.prompt('Drill leader name?', '');
  if (controller === null) return;
  const expected = window.prompt('How many people are expected at the muster point?', '0');
  if (expected === null) return;
  try {
    const d = await startDrill(sid, { controller, expected });
    drillId = d.id;
    tab = 'drills';
    scenarioId = '';
    toast(sc.title + ' drill started', 'success');
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function drillsTab() {
  if (drillId) {
    const d = await getDrill(drillId);
    if (d) return d.status === 'running' ? drillRunner(d) : drillReport(d);
    drillId = '';
  }
  const [status, all] = await Promise.all([drillStatus(), listDrills()]);
  const running = all.filter((d) => d.status === 'running');
  const done = all.filter((d) => d.status === 'completed');
  const nodes = [];
  if (running.length) nodes.push(card('Drills in progress', '', running.map((d) => h('div', { class: 'op-doc soon', onclick: () => { drillId = d.id; render(); }, style: 'cursor:pointer' }, h('b', { text: d.number + ' · ' + d.scenario_title }), h('span', { class: 'rf-hint', text: 'Started ' + fmt(d.started_at) })))));
  nodes.push(card('Drill status by scenario', 'Run each drill at least once a year, or as your site plan and the law require.', status.map((s) => h('div', { class: 'op-row' }, h('span', null, s.icon + ' ' + s.title, h('div', { class: 'rf-hint', text: s.last ? 'Last: ' + s.last + (s.lastScore != null ? ' · score ' + s.lastScore : '') : 'Never done' })), h('span', null, badgeFor(s.state), ' ', h('button', { class: 'st-btn small', type: 'button', text: 'Run', onclick: () => beginDrill(s.scenario) }))))));
  nodes.push(card('Drill history', '', done.length ? done.slice(0, 20).map((d) => h('div', { class: 'op-row', onclick: () => { drillId = d.id; render(); }, style: 'cursor:pointer' }, h('span', { text: d.number + ' · ' + d.scenario_title + ' · ' + fmt(d.completed_at) }), h('span', { class: 'op-badge ' + (d.metrics && d.metrics.pass ? 'op-b-ok' : 'op-b-over'), text: d.metrics ? d.metrics.score : '-' }))) : h('p', { class: 'rf-hint', text: 'No completed drills yet.' })));
  return nodes;
}

async function drillRunner(d) {
  const sc = getScenario(d.scenario);
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Drills', onclick: () => { drillId = ''; render(); } })];
  nodes.push(h('div', { class: 'rf-card', style: 'border-left:8px solid ' + sc.color }, h('b', { text: sc.icon + ' ' + d.number + ' · ' + d.scenario_title }), h('p', { class: 'rf-hint', text: 'Leader: ' + (d.controller || '-') + ' · ' + sc.drill.objective }), h('div', { class: 'op-clock', 'data-start': d.started_at, text: '00:00:00' })));
  nodes.push(card('Timed events', 'Tap each event the moment it happens. Late events show in red.', d.events.map((e) => {
    const done = e.minutes != null;
    const late = done && e.target_min != null && e.minutes > e.target_min;
    return h('div', { class: 'op-event' + (done ? ' done' : '') }, h('div', null, h('b', { text: e.label }), h('div', { class: 'rf-hint', text: e.target_min != null ? 'Target within ' + e.target_min + ' min' : 'No target' })), done ? h('span', null, h('span', { class: 'when' + (late ? ' late' : ''), text: e.minutes + ' min' }), ' ', h('button', { class: 'st-btn secondary small', type: 'button', text: 'Undo', onclick: async () => { await markEvent(d.id, e.id, false); render(); } })) : h('button', { class: 'st-btn small', type: 'button', text: 'Done now', onclick: async () => { await markEvent(d.id, e.id, true); render(); } }));
  })));
  const hc = d.headcount;
  const missing = h('textarea', { class: 'st-input', rows: '2', placeholder: 'Names of missing people, comma separated' });
  missing.value = (hc.missing || []).join(', ');
  missing.addEventListener('change', async () => { await setHeadcount(d.id, { ...hc, missing: missing.value.split(',').map((x) => x.trim()).filter(Boolean) }); render(); });
  const expected = h('input', { class: 'st-input', type: 'number', value: hc.expected, placeholder: 'Expected' });
  expected.addEventListener('change', async () => { await setHeadcount(d.id, { ...hc, expected: expected.value }); render(); });
  nodes.push(card('Headcount', 'Count everyone at the muster point. Contractors and visitors too.', [field('People expected', expected), h('div', { class: 'op-count' }, h('button', { class: 'st-btn secondary', type: 'button', text: '−', onclick: async () => { await setHeadcount(d.id, { ...hc, counted: Math.max(0, hc.counted - 1) }); render(); } }), h('div', { style: 'text-align:center' }, h('b', { text: String(hc.counted) }), h('div', { class: 'rf-hint', text: 'counted of ' + hc.expected })), h('button', { class: 'st-btn', type: 'button', text: '+', onclick: async () => { await setHeadcount(d.id, { ...hc, counted: hc.counted + 1 }); render(); } })), field('Missing', missing), hc.expected > 0 && hc.counted === hc.expected && !(hc.missing || []).length ? h('div', { class: 'op-banner ok' }, h('b', { text: 'Headcount matches. Everyone accounted for.' })) : h('div', { class: 'op-banner' }, h('b', { text: 'Headcount not complete yet.' }))]));
  const f = { text: '', severity: 'medium' };
  const sev = h('select', { class: 'st-select' }, ['low', 'medium', 'high'].map((s) => h('option', { value: s, text: s })));
  sev.value = 'medium';
  sev.addEventListener('change', () => { f.severity = sev.value; });
  nodes.push(card('Findings', 'Write what went wrong or could be better.', [h('ul', { class: 'rf-list' }, sc.drill.prompts.map((p) => h('li', { text: p }))), ...(d.findings || []).map((x) => h('div', { class: 'op-row' }, h('span', { text: '[' + x.severity + '] ' + x.text }), h('button', { class: 'st-btn danger small', type: 'button', text: '✕', onclick: async () => { await removeFinding(d.id, x.id); render(); } }))), input('', (v) => { f.text = v; }, 'text', 'What did you find?'), sev, h('button', { class: 'st-btn small', type: 'button', text: 'Add finding', onclick: async () => { try { await addFinding(d.id, f); render(); } catch (e) { toast(e.message, 'error'); } } })]));
  nodes.push(card('Finish the drill', 'Completing the drill locks the timings and calculates the score.', [h('button', { class: 'st-btn', type: 'button', text: 'Complete drill', onclick: async () => { const by = window.prompt('Your name?', d.controller || ''); if (!by) return; try { await completeDrill(d.id, by); toast('Drill completed', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } }), h('button', { class: 'st-btn danger small', type: 'button', text: 'Discard drill', onclick: async () => { if (!window.confirm('Discard this drill?')) return; await removeDrill(d.id); drillId = ''; render(); } })]));
  return nodes;
}

function drillReport(d) {
  const m = d.metrics || drillMetrics(d);
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Drills', onclick: () => { drillId = ''; render(); } })];
  nodes.push(h('div', { class: 'rf-card', style: 'border-left:8px solid ' + (m.pass ? '#16a34a' : '#dc2626') }, h('b', { text: d.number + ' · ' + d.scenario_title }), h('div', { class: 'op-bigscore', text: String(m.score) }), h('div', { class: 'op-meter' }, h('i', { style: 'width:' + m.score + '%;background:' + (m.pass ? '#16a34a' : '#dc2626') })), h('p', { class: 'rf-hint', text: (m.pass ? 'PASS' : 'NEEDS WORK') + ' · ' + m.done + ' of ' + m.total + ' events · ' + m.lateCount + ' late · ' + m.findings + ' finding(s) · headcount ' + (m.headcountOk ? 'matched' : 'not matched') })));
  nodes.push(card('Event times', '', d.events.map((e) => h('div', { class: 'op-row' }, h('span', { text: e.label }), h('span', { class: 'rf-hint', text: (e.minutes != null ? e.minutes + ' min' : 'not done') + (e.target_min != null ? ' (target ' + e.target_min + ')' : '') })))));
  nodes.push(card('Findings', '', (d.findings || []).length ? d.findings.map((f) => h('div', { class: 'op-row' }, h('span', { text: '[' + f.severity + '] ' + f.text + (f.action_id ? ' · action created' : '') }), h('button', { class: 'st-btn secondary small', type: 'button', text: '→ Observation', onclick: () => openObservationModal({ title: d.number, hazard_category: 'Other', activity: 'Emergency drill: ' + d.scenario_title, risk_rating: f.severity === 'high' ? 'High' : f.severity === 'low' ? 'Low' : 'Medium', description: f.text + ' (drill ' + d.number + ')' }) }))) : h('p', { class: 'rf-hint', text: 'No findings recorded.' })));
  nodes.push(h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '➕ Actions from findings', onclick: async () => { try { const made = await drillToActions(d.id); toast(made.length ? made.length + ' action(s) added to the Action Tracker' : 'No new actions to create', made.length ? 'success' : 'info'); render(); } catch (e) { toast(e.message, 'error'); } } }), h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share drill record', onclick: () => shareText('Drill ' + d.number, drillText(d)) }), h('button', { class: 'st-btn danger', type: 'button', text: 'Delete record', onclick: async () => { if (!window.confirm('Delete this drill record?')) return; await removeDrill(d.id); drillId = ''; render(); } })));
  return nodes;
}

/* ---------- Equipment ---------- */

async function equipTab() {
  if (equipId) {
    const rec = await getEquipCheck(equipId);
    if (rec) return rec.status === 'running' ? equipRunner(rec) : equipReport(rec);
    equipId = '';
  }
  const status = await equipStatus();
  const history = (await listEquipChecks({ statuses: ['completed'] })).slice(0, 15);
  const running = await listEquipChecks({ statuses: ['running'] });
  const nodes = [];
  if (running.length) nodes.push(card('Checks in progress', '', running.map((r) => h('div', { class: 'op-doc soon', style: 'cursor:pointer', onclick: () => { equipId = r.id; render(); } }, h('b', { text: r.number + ' · ' + r.category_title })))));
  nodes.push(card('Equipment checklists', 'Check each group on its schedule. Failures become actions.', status.map((s) => h('div', { class: 'op-row' }, h('span', null, s.icon + ' ' + s.title, h('div', { class: 'rf-hint', text: (s.last ? 'Last: ' + s.last + (s.result ? ' · ' + s.result : '') : 'Never checked') + ' · every ' + s.frequency_days + ' days' })), h('span', null, badgeFor(s.state), ' ', h('button', { class: 'st-btn small', type: 'button', text: 'Check', onclick: async () => { const by = window.prompt('Your name?', ''); if (by === null) return; try { const rec = await startEquipCheck(s.id, by); equipId = rec.id; render(); window.scrollTo(0, 0); } catch (e) { toast(e.message, 'error'); } } }))))));
  nodes.push(card('Recent checks', '', history.length ? history.map((r) => h('div', { class: 'op-row', style: 'cursor:pointer', onclick: () => { equipId = r.id; render(); } }, h('span', { text: r.number + ' · ' + r.category_title + ' · ' + fmt(r.completed_at) }), h('span', { class: 'op-badge ' + (r.result === 'pass' ? 'op-b-ok' : 'op-b-over'), text: r.result }))) : h('p', { class: 'rf-hint', text: 'No completed checks yet.' })));
  return nodes;
}

function equipRunner(rec) {
  const c = getChecklist(rec.category);
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Equipment', onclick: () => { equipId = ''; render(); } })];
  nodes.push(h('div', { class: 'rf-card' }, h('b', { text: c.icon + ' ' + rec.number + ' · ' + c.title }), h('p', { class: 'rf-hint', text: 'Checked by ' + (rec.by || '-') })));
  nodes.push(card('Check each item', '', c.items.map((it) => {
    const cur = (rec.answers || {})[it.id] || {};
    const seg = h('div', { class: 'op-seg' });
    const note = h('input', { class: 'st-input', type: 'text', placeholder: 'Note (what is wrong)', value: cur.note || '' });
    const noteBox = h('div', { style: cur.v === 'fail' ? '' : 'display:none' }, note, h('p', { class: 'rf-hint', style: 'color:#dc2626', text: 'Action: ' + it.fail }));
    [['ok', 'OK', 'yes'], ['fail', 'Fail', 'no'], ['na', 'N/A', 'na']].forEach(([v, label, cls]) => {
      const b = h('button', { type: 'button', class: 'op-seg-' + cls, text: label, 'aria-pressed': cur.v === v ? 'true' : 'false' });
      b.addEventListener('click', async () => {
        await answerEquip(rec.id, it.id, v, note.value);
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        noteBox.style.display = v === 'fail' ? '' : 'none';
      });
      seg.appendChild(b);
    });
    note.addEventListener('change', async () => { const a = ((await getEquipCheck(rec.id)).answers || {})[it.id]; if (a) await answerEquip(rec.id, it.id, a.v, note.value); });
    return h('div', { class: 'op-q' }, h('div', { text: it.text }), seg, noteBox);
  })));
  nodes.push(card('Finish', '', [h('button', { class: 'st-btn', type: 'button', text: 'Complete check', onclick: async () => { try { const by = rec.by || window.prompt('Your name?', '') || ''; await completeEquipCheck(rec.id, by); toast('Check completed', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } }), h('button', { class: 'st-btn danger small', type: 'button', text: 'Discard', onclick: async () => { if (!window.confirm('Discard this check?')) return; const m = await import('../services/emergency.js'); await m.removeEquipCheck(rec.id); equipId = ''; render(); } })]));
  return nodes;
}

function equipReport(rec) {
  const c = getChecklist(rec.category);
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Equipment', onclick: () => { equipId = ''; render(); } })];
  nodes.push(h('div', { class: 'rf-card', style: 'border-left:8px solid ' + (rec.result === 'pass' ? '#16a34a' : '#dc2626') }, h('b', { text: c.icon + ' ' + rec.number + ' · ' + c.title }), h('p', { class: 'rf-hint', text: fmt(rec.completed_at) + ' · ' + (rec.by || '') + ' · ' + (rec.result === 'pass' ? 'All passed' : rec.fail_count + ' failed') })));
  nodes.push(card('Results', '', c.items.map((it) => { const a = (rec.answers || {})[it.id] || {}; return h('div', { class: 'op-row' }, h('span', { text: it.text + (a.note ? ' (' + a.note + ')' : '') }), h('span', { class: 'op-badge ' + (a.v === 'fail' ? 'op-b-over' : a.v === 'ok' ? 'op-b-ok' : 'op-b-none'), text: a.v || '-' })); })));
  if (rec.fail_count) nodes.push(h('button', { class: 'st-btn', type: 'button', text: '➕ Actions for failed items', onclick: async () => { try { const made = await equipFailuresToActions(rec.id); toast(made.length ? made.length + ' action(s) added' : 'No new actions to create', made.length ? 'success' : 'info'); render(); } catch (e) { toast(e.message, 'error'); } } }));
  return nodes;
}

/* ---------- Screen ---------- */

async function render() {
  if (!root) return;
  let body;
  try {
    body = tab === 'hub' ? await hubTab() : tab === 'plan' ? await planTab() : tab === 'contacts' ? await contactsTab() : tab === 'muster' ? await musterTab() : tab === 'drills' ? await drillsTab() : await equipTab();
  } catch (e) {
    body = [h('p', { class: 'rf-sub', text: 'Could not load: ' + e.message })];
  }
  const banner = await missionBanner();
  if (!root) return;
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('h1', { class: 'rf-title', text: '🚨 Emergency Preparedness & Drill Hub' }), h('p', { class: 'rf-sub', text: 'Site emergency plan, contacts and rescue team, muster points, timed drills with headcount and equipment checklists.' }), banner, tabsBar(TABS, tab, (t) => { tab = t; scenarioId = ''; drillId = ''; equipId = ''; render(); }), ...[].concat(body).filter(Boolean)));
  tick();
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  ensureCss('css/ops.css');
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading emergency hub…' })));
  await loadRegions();
  try {
    await loadEmergency();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load emergency data: ' + e.message })));
    return;
  }
  plan = null;
  await render();
  tickTimer = setInterval(tick, 1000);
}

export function unmount() {
  clearInterval(tickTimer);
  clearTimeout(planTimer);
  root = null;
  plan = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
