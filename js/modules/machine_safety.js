/* NASUR - Machine Safety & LOTO Field Book module (Phase 5) */
import { hrefFor } from '../core/router.js';
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
  checklist,
  tabsBar,
  actionBar,
  openObservationModal,
  shareText,
  loadMachines,
  lotoSummary,
  machineTbtText
} from '../services/safety_reference.js';

export const id = 'machine_safety';

const TABS = [
  { id: 'machines', label: 'Machines' },
  { id: 'nip', label: 'Nip-point walk' },
  { id: 'loto', label: '7-Step LOTO' },
  { id: 'legal', label: 'Legal' }
];

let root = null;
let data = null;
let tab = 'machines';
let machineId = '';

const GENERIC_WALK = {
  where_first: ['Power off and isolate first, then look closely at the machine', 'Trace every moving part and ask what could catch a finger, sleeve or hair', 'Check each nip and pinch point has a guard or a safe distance', 'Check the emergency stop is in reach and works'],
  hidden: ['Guards that can be reached around, over, under or through', 'Interlocks bypassed or taped down', 'Gaps that open when a guard is adjusted', 'Hidden nip points behind covers and under conveyors', 'Stored energy that keeps moving after the power is off'],
  protect: ['Operators and cleaners who put hands in or near the machine', 'Maintenance staff and contractors exposed to unexpected start-up']
};

function selected() {
  return data.machines.find((m) => m.id === machineId) || null;
}

function obsCfg() {
  const m = selected();
  const region = getActiveRegionId();
  if (!m) {
    return {
      title: 'Machine safety',
      hazard_category: 'Machinery & Guarding',
      activity: 'Machine operation / maintenance',
      risk_rating: 'High',
      typical: ['Guard missing or bypassed', 'Emergency stop not working', 'No lockout during maintenance', 'Nip point exposed', 'Operator wearing loose clothing or gloves near rotating parts'],
      legal_clause: data.loto.legal[region]
    };
  }
  return { title: m.title, hazard_category: m.bridge.hazard_category, activity: m.bridge.activity, risk_rating: m.bridge.risk_rating, typical: m.bridge.typical, legal_clause: m.legal[region] };
}

function tbt() {
  const m = selected();
  if (m) return { title: 'Toolbox talk: ' + m.title, text: machineTbtText(m) };
  return {
    title: 'Toolbox talk: Machine safety and LOTO',
    text: ['TOOLBOX TALK: Machine safety and lockout', '', '1. Guards stay on. Never bypass a guard or interlock', '2. Never reach into a machine that can move', '3. Lock it, tag it, release stored energy, try to start it, then work', '4. Every worker uses their own lock', '5. Loose clothing, long hair and gloves are dangerous near rotating parts', '', 'ASK THE CREW: Who could start this machine while my hands are inside?', '', 'Attendance: names, signatures and date.'].join('\n')
  };
}

/* ---------- Machines ---------- */

function machineDetail(m) {
  const region = getActiveRegionId();
  const nodes = [];
  nodes.push(h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← All machines', onclick: () => { machineId = ''; render(); window.scrollTo(0, 0); } }));
  nodes.push(h('div', { class: 'rf-card' }, h('div', { class: 'rf-hero' }, h('span', { class: 'rf-ic', text: m.icon }), h('div', null, h('h1', { class: 'rf-title', text: m.title }), h('p', { class: 'rf-sub', text: m.summary }))), h('div', null, m.hazards.map((x) => h('span', { class: 'rf-pill high', text: x })))));
  nodes.push(walkBlock({ where_first: m.nip_points, hidden: m.hidden_hazards, protect: GENERIC_WALK.protect }, 'Visual walk: nip and pinch points first'));
  nodes.push(card('Guarding and safety devices', 'What good looks like.', h('div', { class: 'rf-hier' }, m.guarding.map((g) => h('div', null, h('b', { text: g.type }), g.detail)))));
  nodes.push(checklist(m.before_start, 'mach_before_' + m.id, 'Before start-up', 'Tick each check on the machine.'));
  nodes.push(checklist(m.daily_checks, 'mach_daily_' + m.id, 'Daily inspection', 'Report and tag out any defect.'));
  nodes.push(h('div', { class: 'rf-card', style: 'border-left:6px solid #dc2626' }, h('h2', { text: 'NEVER' }), h('ul', { class: 'rf-list' }, m.never.map((x) => h('li', { text: x })))));
  nodes.push(card('Energy sources to isolate', 'Every one must be locked and verified before work.', [h('div', null, m.energy_sources.map((x) => h('span', { class: 'rf-pill crit', text: x }))), h('button', { class: 'st-btn', type: 'button', text: 'Open the 7-step LOTO verifier for this machine', onclick: () => { tab = 'loto'; const st = sessionGet('loto_state', { machine: '', person: '', steps: {} }); st.machine = m.id; sessionSet('loto_state', st); render(); window.scrollTo(0, 0); } })]));
  nodes.push(legalBlock(m.legal, m.title + ' legal standards'));
  nodes.push(card('Standards', '', h('div', null, m.standards.map((x) => h('span', { class: 'rf-pill', text: x })))));
  if (m.encyclopedia_link) {
    nodes.push(h('button', { class: 'st-btn secondary', type: 'button', text: 'Open the full activity guide', onclick: () => { sessionSet('encyclopedia_activity', m.encyclopedia_link); let href = '#/activity-encyclopedia'; try { href = hrefFor('activity_encyclopedia'); } catch (e) { /* fallback */ } window.location.assign(href); } }));
  }
  return nodes;
}

function machinesTab() {
  const m = selected();
  if (m) return machineDetail(m);
  const grid = h('div', { class: 'rf-grid' }, data.machines.map((x) => h('button', { class: 'rf-tile', type: 'button', onclick: () => { machineId = x.id; render(); window.scrollTo(0, 0); } }, h('span', { class: 'rf-ic', text: x.icon }), h('b', { text: x.title }), h('small', { text: x.nip_points.length + ' nip points' }))));
  return [walkBlock(GENERIC_WALK, 'Visual machine walk-steps'), card('Choose a machine', 'Machine-by-machine hazards, guarding, checks and legal standards.', grid)];
}

/* ---------- Nip-point walk ---------- */

function nipTab() {
  const n = data.nip_points;
  return [
    walkBlock(GENERIC_WALK, 'Visual nip-point walk'),
    card('Types of danger point', 'Learn to see them.', h('div', { class: 'rf-hier' }, n.types.map((t) => h('div', null, h('b', { text: t.name }), t.detail + ' Example: ' + t.example)))),
    checklist(n.walk_steps, 'mach_nip_walk', 'Nip-point walk checklist', 'Do this for every machine before you rely on it.'),
    card('Rules of thumb', '', h('ul', { class: 'rf-list' }, n.tips.map((x) => h('li', { text: x }))))
  ];
}

/* ---------- Interactive 7-step LOTO verifier ---------- */

function lotoTab() {
  const loto = data.loto;
  const st = sessionGet('loto_state', { machine: '', person: '', steps: {} });
  const save = () => sessionSet('loto_state', st);
  const m = data.machines.find((x) => x.id === st.machine) || null;
  const nodes = [];

  const machineSel = h('select', { class: 'st-select' }, [h('option', { value: '', text: 'Not selected' })].concat(data.machines.map((x) => h('option', { value: x.id, text: x.title }))));
  machineSel.value = st.machine || '';
  machineSel.addEventListener('change', () => { st.machine = machineSel.value; save(); render(); });
  const person = h('input', { class: 'st-input', type: 'text', placeholder: 'Your name', value: st.person || '' });
  person.addEventListener('input', () => { st.person = person.value; save(); });
  nodes.push(card(loto.title, loto.principle, [h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: 'Machine' }), machineSel), h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: 'Person locking out' }), person), m ? h('p', { class: 'rf-hint', text: 'Energy sources for this machine: ' + m.energy_sources.join(', ') }) : null]));

  const status = h('div');
  const bar = h('i', { style: 'width:0%' });
  const upd = () => {
    const done = loto.steps.filter((s) => st.steps[s.n] === 'done').length;
    const failed = loto.steps.filter((s) => st.steps[s.n] === 'fail');
    bar.style.width = Math.round((done / loto.steps.length) * 100) + '%';
    status.replaceChildren(h('div', { class: 'rf-result' + (done < loto.steps.length ? ' bad' : '') }, h('b', { text: done === loto.steps.length ? 'ISOLATION VERIFIED: all 7 steps done. It is safe to start work.' : failed.length ? 'STOP: ' + failed.length + ' step(s) not done. Do not start work.' : done + ' of 7 steps verified. Do not start work until all 7 are done.' })));
  };
  nodes.push(h('div', { class: 'rf-card' }, h('div', { class: 'rf-bar-progress' }, bar), status));

  const stepEls = loto.steps.map((s) => {
    const el = h('div', { class: 'rf-loto-step' });
    const ok = h('button', { class: 'st-btn small', type: 'button', text: '✓ Verified' });
    const no = h('button', { class: 'st-btn secondary small', type: 'button', text: '✕ Not done' });
    const mark = () => {
      el.classList.toggle('done', st.steps[s.n] === 'done');
      ok.style.outline = st.steps[s.n] === 'done' ? '3px solid #16a34a' : 'none';
      no.style.outline = st.steps[s.n] === 'fail' ? '3px solid #dc2626' : 'none';
    };
    ok.addEventListener('click', () => { st.steps[s.n] = 'done'; save(); mark(); upd(); });
    no.addEventListener('click', () => { st.steps[s.n] = 'fail'; save(); mark(); upd(); });
    el.append(
      h('div', { class: 'rf-loto-n', text: String(s.n) }),
      h('div', { style: 'flex:1;min-width:0' }, h('b', { text: s.title }), h('ul', { class: 'rf-list' }, s.do.map((x) => h('li', { text: x }))), h('small', { text: 'Verify: ' + s.verify }), h('details', { class: 'rf-acc', style: 'margin-top:6px' }, h('summary', { text: 'Common mistakes' }), h('div', null, h('ul', { class: 'rf-list' }, s.mistakes.map((x) => h('li', { text: x}))))), h('div', { class: 'rf-actions', style: 'margin-top:6px' }, ok, no))
    );
    mark();
    return el;
  });
  upd();
  nodes.push(h('div', { class: 'rf-loto' }, stepEls));

  nodes.push(
    h(
      'div',
      { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Record LOTO gap', onclick: () => {
        const failed = loto.steps.filter((s) => st.steps[s.n] === 'fail');
        if (!failed.length) return toast('No failed steps to record', 'info');
        openObservationModal({ ...obsCfg(), title: 'LOTO gap', activity: 'Lockout / tagout', risk_rating: 'Critical', description: 'LOTO steps not done' + (m ? ' on ' + m.title : '') + ': ' + failed.map((s) => s.n + '. ' + s.title).join('; ') });
      } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share LOTO record', onclick: () => shareText('LOTO verification', lotoSummary(m ? m.title : '', st.person, loto.steps, st.steps)) }),
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Reset', onclick: () => { st.steps = {}; save(); render(); } })
    )
  );
  nodes.push(checklist(loto.restoration, 'loto_restore', 'Restoration: after the work', 'Never restart until all of these are done.'));
  nodes.push(card('Lock rules', '', h('ul', { class: 'rf-list' }, loto.rules.map((x) => h('li', { text: x })))));
  nodes.push(card('Types of energy', '', h('div', null, loto.energy_types.map((e) => h('details', { class: 'rf-acc' }, h('summary', { text: e.type }), h('div', null, h('p', { class: 'rf-hint', text: 'Examples: ' + e.examples }), h('p', { class: 'rf-hint', text: 'Isolation: ' + e.isolation })))))));
  return nodes;
}

function legalTab() {
  const nodes = [legalBlock(data.loto.legal, 'LOTO legal standards')];
  const m = selected();
  if (m) nodes.push(legalBlock(m.legal, m.title + ' legal standards'));
  nodes.push(card('Machine-by-machine standards', 'Open a machine for its full legal list.', h('ul', { class: 'rf-list' }, data.machines.map((x) => h('li', { text: x.title + ': ' + x.standards.join(', ') })))));
  return nodes;
}

async function render() {
  if (!root || !data) return;
  const builders = { machines: machinesTab, nip: nipTab, loto: lotoTab, legal: legalTab };
  const banner = await missionBanner();
  if (!root) return;
  const t = tbt();
  root.replaceChildren(
    h(
      'div',
      { class: 'rf-wrap' },
      h('h1', { class: 'rf-title', text: '⚙️ Machine Safety & LOTO Field Book' }),
      h('p', { class: 'rf-sub', text: 'Machine-by-machine guarding, nip-point walk and the interactive 7-step LOTO verifier.' }),
      banner,
      tabsBar(TABS, tab, (x) => { tab = x; render(); }),
      builders[tab](),
      actionBar({ obs: obsCfg, tbtTitle: t.title, tbtText: () => tbt().text })
    )
  );
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading machine safety…' })));
  await loadRegions();
  try {
    data = await loadMachines();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load machine safety data: ' + e.message })));
    return;
  }
  await render();
}

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
