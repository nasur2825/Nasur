/* NASUR - Fire Safety & Extinguishers module (Phase 5) */
import { loadRegions, getActiveRegionId, formatDate } from '../services/regions.js';
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
  loadFire,
  matchExtinguishers,
  matchFireTypes,
  evaluateMonthly,
  FIRE_LEGAL,
  FIRE_WALK
} from '../services/safety_reference.js';

export const id = 'fire_safety';

const TABS = [
  { id: 'walk', label: 'Classes & walk' },
  { id: 'match', label: 'Matcher' },
  { id: 'pass', label: 'PASS & RACE' },
  { id: 'monthly', label: 'Monthly check' },
  { id: 'hotwork', label: 'Hot work watch' },
  { id: 'drill', label: 'Drills' },
  { id: 'legal', label: 'Legal' }
];

let root = null;
let fire = null;
let tab = 'walk';
let matchMode = 'fire';
let pickedFire = 'solids';
let pickedExt = 'abc';

const FIRE_TBT = [
  'TOOLBOX TALK: Fire safety and extinguishers',
  '',
  '1. Know the nearest exit and the nearest extinguisher before you start work',
  '2. Use the right extinguisher. The wrong one makes it worse: water on oil or live electrics',
  '3. PASS: Pull the pin, Aim at the base, Squeeze the handle, Sweep side to side',
  '4. Fight only a small fire with your exit behind you. Otherwise raise the alarm and leave',
  '5. Hot work needs a permit and a fire watch for at least 30 minutes after',
  '',
  'ASK THE CREW: Which extinguisher is nearest to you, and what fire is it for?',
  '',
  'Attendance: names, signatures and date.'
].join('\n');

function obsCfg(extra) {
  return () => ({
    title: 'Fire safety',
    hazard_category: 'Fire & Explosion',
    activity: 'Fire safety / extinguishers',
    risk_rating: 'High',
    typical: ['Extinguisher blocked or missing', 'Wrong extinguisher type for the hazard', 'Fire door wedged open', 'Exit blocked', 'Extinguisher inspection overdue', 'No fire watch during hot work'],
    legal_clause: FIRE_LEGAL[getActiveRegionId()],
    ...(extra || {})
  });
}

/* ---------- Tabs ---------- */

function walkTab() {
  const nodes = [walkBlock(FIRE_WALK, 'Visual fire walk-steps')];
  nodes.push(card('Which letter system do you have?', 'Labels differ by country. Always read the label on the extinguisher.', h('div', { class: 'rf-legal' }, fire.label_systems.map((s) => h('div', null, h('b', { text: s.label }), s.note)))));
  const types = fire.fire_types.map((t) => h('div', { class: 'rf-class', style: '--fc:' + t.color }, h('div', null, h('span', { class: 'rf-letter', text: t.letter_eu === '-' ? '⚡' : t.letter_eu }), h('b', { text: t.name }), h('span', { class: 'rf-hint', text: '  EU: ' + t.letter_eu + ' · US/CA: ' + t.letter_us })), h('p', { class: 'rf-hint', text: t.materials + '. Examples: ' + t.examples }), h('p', { class: 'rf-hint', text: 'How: ' + t.how }), h('p', { class: 'rf-hint', style: 'color:#dc2626', text: 'Danger: ' + t.danger })));
  nodes.push(card('Fire classes', 'Know what is burning before you pick up an extinguisher.', types));
  return nodes;
}

function resultRow(r, label, note) {
  const row = h('div', { class: r === 'yes' ? 'ok' : r === 'no' ? 'bad' : '' }, h('b', { text: label + (r === 'yes' ? '  ✓ USE' : r === 'no' ? '  ✕ NEVER' : '  ⚠ CAUTION') }), note ? h('div', { class: 'rf-hint', text: note }) : null);
  if (r === 'caution') row.style.cssText = 'border-radius:10px;padding:8px 10px;font-size:.86rem;background:rgba(245,158,11,.14);border-left:5px solid #f59e0b';
  return row;
}

function matchTab() {
  const modeBar = tabsBar([{ id: 'fire', label: 'I have a fire' }, { id: 'ext', label: 'I have an extinguisher' }], matchMode, (m) => { matchMode = m; render(); });
  const nodes = [h('div', null, modeBar)];
  if (matchMode === 'fire') {
    const tiles = h('div', { class: 'rf-match' }, fire.fire_types.map((t) => h('button', { type: 'button', 'aria-pressed': pickedFire === t.id ? 'true' : 'false', onclick: () => { pickedFire = t.id; render(); } }, t.icon + ' ' + t.name)));
    const t = fire.fire_types.find((x) => x.id === pickedFire);
    const rows = matchExtinguishers(fire, pickedFire).map((m) => resultRow(m.r, m.ext.name, m.note));
    const warn = pickedFire === 'gases' ? 'Stop the gas supply first. Never put out a leaking gas fire unless you can stop the leak.' : pickedFire === 'electrical' ? 'Isolate the power if it is safe. Never use water or foam on live equipment.' : pickedFire === 'metals' ? 'Use only a metal fire agent or dry sand. Water makes it worse.' : pickedFire === 'cooking' ? 'Turn off the heat if safe. Never use water on hot oil.' : '';
    nodes.push(card('What is burning?', 'Pick the fire type to see which extinguisher to use.', [tiles, warn ? h('div', { class: 'rf-result bad' }, warn) : null, h('p', { class: 'rf-hint', text: t.how }), h('div', { class: 'rf-defect' }, rows)]));
  } else {
    const tiles = h('div', { class: 'rf-match' }, fire.extinguishers.map((e) => h('button', { type: 'button', 'aria-pressed': pickedExt === e.id ? 'true' : 'false', onclick: () => { pickedExt = e.id; render(); } }, e.name)));
    const e = fire.extinguishers.find((x) => x.id === pickedExt);
    const rows = matchFireTypes(fire, pickedExt).map((m) => resultRow(m.r, m.type.icon + ' ' + m.type.name, m.note));
    nodes.push(card('What can this extinguisher put out?', 'Label colour: ' + e.label_colour, [tiles, h('p', { class: 'rf-hint', text: e.notes }), h('div', { class: 'rf-defect' }, rows)]));
  }
  return nodes;
}

function passTab() {
  const pass = h('div', { class: 'rf-pass' }, fire.pass.map((p) => h('div', null, h('b', { text: p.letter }), h('strong', { text: p.word }), h('div', { text: p.detail }))));
  const race = h('div', { class: 'rf-pass' }, fire.race.map((p) => h('div', null, h('b', { text: p.letter }), h('strong', { text: p.word }), h('div', { text: p.detail }))));
  return [
    card('PASS: using an extinguisher', 'Stay 2 to 3 metres back with the exit behind you.', pass),
    card('Before you fight a fire', '', h('ul', { class: 'rf-list' }, fire.before_fighting.map((x) => h('li', { text: x })))),
    h('div', { class: 'rf-card', style: 'border-left:6px solid #dc2626' }, h('h2', { text: 'Do NOT fight the fire if' }), h('ul', { class: 'rf-list' }, fire.do_not_fight.map((x) => h('li', { text: x })))),
    card('RACE: if you discover a fire', '', race)
  ];
}

function monthlyTab() {
  const key = 'fire_monthly';
  const st = sessionGet(key, { answers: {}, unit: '', location: '', inspector: '' });
  const save = () => sessionSet(key, st);
  const field = (label, k) => {
    const i = h('input', { class: 'st-input', type: 'text', value: st[k] || '', placeholder: label });
    i.addEventListener('input', () => { st[k] = i.value; save(); });
    return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), i);
  };
  const summary = h('div');
  const upd = () => {
    const r = evaluateMonthly(fire.inspection.monthly, st.answers);
    summary.replaceChildren(h('div', { class: 'rf-result' + (r.failed.length ? ' bad' : '') }, h('b', { text: r.failed.length ? r.failed.length + ' item(s) failed. Tag out or fix.' : r.unanswered.length ? r.unanswered.length + ' item(s) still to check' : 'All checks passed' })));
  };
  const rows = fire.inspection.monthly.map((it) => {
    const row = h('div', { class: 'rf-check', style: 'flex-direction:column;align-items:stretch' });
    const note = h('div', { class: 'rf-hint', style: 'color:#dc2626' });
    const ok = h('button', { class: 'st-btn secondary small', type: 'button', text: '✓ OK' });
    const bad = h('button', { class: 'st-btn secondary small', type: 'button', text: '✕ Fail' });
    const mark = () => {
      ok.style.outline = st.answers[it.id] === 'ok' ? '3px solid #16a34a' : 'none';
      bad.style.outline = st.answers[it.id] === 'fail' ? '3px solid #dc2626' : 'none';
      note.textContent = st.answers[it.id] === 'fail' ? 'Action: ' + it.fail : '';
    };
    ok.addEventListener('click', () => { st.answers[it.id] = 'ok'; save(); mark(); upd(); });
    bad.addEventListener('click', () => { st.answers[it.id] = 'fail'; save(); mark(); upd(); });
    mark();
    row.append(h('span', { text: it.text }), h('div', { class: 'rf-actions' }, ok, bad), note);
    return row;
  });
  upd();
  const record = () => {
    const r = evaluateMonthly(fire.inspection.monthly, st.answers);
    return ['MONTHLY EXTINGUISHER INSPECTION', 'Unit: ' + (st.unit || ''), 'Location: ' + (st.location || ''), 'Inspector: ' + (st.inspector || ''), 'Date: ' + formatDate(new Date()), '', ...fire.inspection.monthly.map((i) => (st.answers[i.id] === 'ok' ? '[OK]   ' : st.answers[i.id] === 'fail' ? '[FAIL] ' : '[ -- ] ') + i.text), '', r.failed.length ? 'FAILED: ' + r.failed.map((f) => f.text).join('; ') : 'Result: no failures recorded'].join('\n');
  };
  return [
    card('Monthly extinguisher check', fire.inspection.monthly_note, [field('Extinguisher unit number', 'unit'), field('Location', 'location'), field('Inspector name', 'inspector')]),
    card('Check each item', 'Mark OK or Fail. Failed items show the action to take.', rows),
    summary,
    h(
      'div',
      { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Record failures as observation', onclick: () => {
        const r = evaluateMonthly(fire.inspection.monthly, st.answers);
        if (!r.failed.length) return toast('No failed items to record', 'info');
        openObservationModal({ ...obsCfg()(), title: 'Extinguisher inspection', activity: 'Extinguisher monthly inspection', description: 'Extinguisher ' + (st.unit || '') + ' at ' + (st.location || '') + ' failed: ' + r.failed.map((f) => f.text).join('; ') });
      } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share record', onclick: () => shareText('Extinguisher inspection', record()) })
    ),
    card('Placement and annual requirements', '', [h('ul', { class: 'rf-list' }, fire.inspection.placement.map((x) => h('li', { text: x }))), h('ul', { class: 'rf-list' }, fire.inspection.annual.map((x) => h('li', { text: x })))])
  ];
}

function hotworkTab() {
  const hw = fire.hot_work_fire_watch;
  return [
    card('Hot work fire watch', 'No fire watch means no hot work.', h('ul', { class: 'rf-list' }, hw.rules.map((x) => h('li', { text: x })))),
    checklist(hw.before, 'fire_hw_before', 'Before hot work', 'Tick as you verify on site.'),
    checklist(hw.during, 'fire_hw_during', 'During hot work', ''),
    checklist(hw.after, 'fire_hw_after', 'After hot work', 'The fire watch continues after the last spark.')
  ];
}

function drillTab() {
  const d = fire.drill;
  const text = () => ['FIRE DRILL CHECKLIST', '', 'BEFORE', ...d.before.map((x) => '- ' + x), '', 'DURING', ...d.during.map((x) => '- ' + x), '', 'AFTER', ...d.after.map((x) => '- ' + x), '', 'RECORD: ' + d.record_fields.join(', ')].join('\n');
  return [
    card('Fire drill', d.frequency, h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share drill checklist', onclick: () => shareText('Fire drill checklist', text()) })),
    checklist(d.before, 'fire_dr_before', 'Before the drill', ''),
    checklist(d.during, 'fire_dr_during', 'During the drill', ''),
    checklist(d.after, 'fire_dr_after', 'After the drill', 'Raise actions in the Action Tracker.'),
    card('Drill record fields', 'Keep these for every drill.', h('ul', { class: 'rf-list' }, d.record_fields.map((x) => h('li', { text: x }))))
  ];
}

function legalTab() {
  return [legalBlock(FIRE_LEGAL, 'Fire safety legal standards')];
}

async function render() {
  if (!root || !fire) return;
  const builders = { walk: walkTab, match: matchTab, pass: passTab, monthly: monthlyTab, hotwork: hotworkTab, drill: drillTab, legal: legalTab };
  const banner = await missionBanner();
  if (!root) return;
  root.replaceChildren(
    h(
      'div',
      { class: 'rf-wrap' },
      h('h1', { class: 'rf-title', text: '🧯 Fire Safety & Extinguishers' }),
      h('p', { class: 'rf-sub', text: 'Fire classes, extinguisher matcher, PASS, monthly check, hot work fire watch and drills.' }),
      banner,
      tabsBar(TABS, tab, (t) => { tab = t; render(); }),
      builders[tab](),
      actionBar({ obs: obsCfg(), tbtTitle: 'Toolbox talk: Fire safety', tbtText: FIRE_TBT })
    )
  );
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading fire safety…' })));
  await loadRegions();
  try {
    fire = await loadFire();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load fire safety data: ' + e.message })));
    return;
  }
  await render();
}

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
