/* NASUR - Phase 5 tests (standalone: exports run(), also auto-runs when #phase5-results exists)
   The observation round trip creates a TEST_ row and deletes it again. */
import { HAZARD_CATEGORIES, getObservation, deleteObservation } from '../js/services/observations.js';
import { removeAction } from '../js/services/actions.js';
import { validatePayload } from '../js/services/templates.js';
import {
  loadEncyclopedia,
  allActivities,
  listActivities,
  listIndustries,
  getActivity,
  getLegal,
  legalForAll,
  walkthroughSteps,
  buildObservationDraft,
  buildTbtText,
  tbtChecklistPayload,
  inspectionChecklistPayload,
  createObservationFromActivity,
  typicalFindings,
  HIERARCHY_ORDER
} from '../js/services/encyclopedia.js';
import {
  loadFire,
  loadPpe,
  loadMachines,
  matchExtinguishers,
  matchFireTypes,
  evaluateMonthly,
  ppeForTask,
  stdFor,
  inspectionVerdict,
  lotoSummary,
  machineTbtText,
  FIRE_LEGAL,
  PPE_LEGAL,
  FIRE_WALK,
  PPE_WALK
} from '../js/services/safety_reference.js';
import { loadBlueprint, getBlueprint } from '../js/services/jarvis_core.js';

const results = [];
const REGIONS = ['india', 'gulf', 'canada', 'usa'];
const RISKS = ['Low', 'Medium', 'High', 'Critical'];

function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? '' : detail || '' });
}

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return res.json();
}

async function getText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return res.text();
}

/* The services fetch "data/..." relative to the page. From tests/ that must become "../data/...". */
async function fromTests(fn) {
  const real = window.fetch;
  window.fetch = (u, o) => real(typeof u === 'string' && u.indexOf('data/') === 0 ? '../' + u : u, o);
  try {
    return await fn();
  } finally {
    window.fetch = real;
  }
}

/* ---------- Encyclopedia data ---------- */

async function testEncyclopediaData() {
  const all = await fromTests(() => loadEncyclopedia());
  check('encyclopedia: 20 or more activities', all.length >= 20, String(all.length));
  check('encyclopedia: ids are unique', new Set(all.map((a) => a.id)).size === all.length);
  const required = ['welding_hot_work', 'scaffolding', 'confined_space_entry', 'crane_rigging_lifting', 'excavation_trenching', 'work_at_height', 'electrical_loto', 'chemical_sds_handling', 'forklift_mhe', 'grinding_cutting', 'pressure_testing', 'sandblasting_painting', 'marine_mooring', 'working_aloft_marine', 'cold_room_ammonia'];
  required.forEach((id) => check('encyclopedia: has ' + id, !!getActivity(id)));

  let bad = [];
  all.forEach((a) => {
    const w = a.walkthrough || {};
    const problems = [];
    if ((w.where_first || []).length < 3) problems.push('where_first');
    if ((w.hidden_hazards || []).length < 3) problems.push('hidden');
    if ((w.protect_first || []).length < 1) problems.push('protect');
    if ((a.hazards || []).length < 3) problems.push('hazards');
    if (HIERARCHY_ORDER.some((h) => !Array.isArray((a.controls || {})[h.id]))) problems.push('controls');
    if ((a.ppe || []).length < 3) problems.push('ppe');
    if ((a.permits || []).length < 1) problems.push('permits');
    if ((a.checklist || []).length < 5) problems.push('checklist');
    if (REGIONS.some((r) => !String((a.legal || {})[r] || '').trim())) problems.push('legal');
    if (!a.tbt || (a.tbt.points || []).length < 3 || !a.tbt.question) problems.push('tbt');
    if (!a.bridge || !HAZARD_CATEGORIES.includes(a.bridge.hazard_category) || !RISKS.includes(a.bridge.risk_rating) || (a.bridge.typical || []).length < 3) problems.push('bridge');
    if (!a.icon || !a.title || !a.summary) problems.push('basics');
    if (problems.length) bad.push(a.id + ': ' + problems.join(','));
  });
  check('encyclopedia: every activity is complete (walkthrough, hazards, controls, PPE, permits, checklist, 4 countries, TBT, bridge)', !bad.length, bad.join(' | '));

  const inds = listIndustries().map((i) => i.id);
  ['construction', 'manufacturing', 'oilgas', 'marine', 'food_safety', 'warehouse_logistics'].forEach((i) => check('encyclopedia: industry ' + i + ' covered', inds.includes(i) && listActivities({ industry: i }).length >= 2));

  check('encyclopedia: search ranks welding first', listActivities({ q: 'welding' })[0].id === 'welding_hot_work');
  check('encyclopedia: search by hazard word', listActivities({ q: 'h2s' }).some((a) => a.id === 'h2s_gas_hazards'));
  check('encyclopedia: marine filter includes mooring', listActivities({ industry: 'marine' }).some((a) => a.id === 'marine_mooring'));
  check('encyclopedia: nonsense search returns nothing', listActivities({ q: 'zzzxqv' }).length === 0);
}

async function testEncyclopediaService() {
  const w = getActivity('welding_hot_work');
  check('service: US legal for welding cites Subpart Q', getLegal(w, 'usa').indexOf('Subpart Q') >= 0);
  check('service: Canada legal for welding cites CSA W117.2', getLegal(w, 'canada').indexOf('W117.2') >= 0);
  check('service: legal for all four countries', legalForAll(w).length === 4);
  const steps = walkthroughSteps(w);
  check('service: walkthrough has 3 blocks in order', steps.length === 3 && steps[0].id === 'where_first' && steps[1].id === 'hidden' && steps[2].id === 'protect' && steps.every((s) => s.items.length > 0));
  const draft = buildObservationDraft(w, { finding: 'x', region: 'usa' });
  check('service: observation draft maps hazard category and activity', draft.hazard_category === 'Hot Work' && draft.activity === 'Welding / hot work' && draft.risk_rating === 'High');
  check('service: typical findings available', typicalFindings(w).length >= 3);
  check('service: TBT text has title, points and question', /TOOLBOX TALK/.test(buildTbtText(w)) && /ASK THE CREW/.test(buildTbtText(w)));
  check('service: TBT checklist passes template validation', validatePayload('checklist', tbtChecklistPayload(w)).ok);
  check('service: inspection checklist passes template validation', validatePayload('checklist', inspectionChecklistPayload(w)).ok);
}

async function testObservationBridge() {
  const w = getActivity('welding_hot_work');
  let rejected = false;
  try {
    await createObservationFromActivity(w, { finding: '   ' });
  } catch (e) {
    rejected = true;
  }
  check('bridge: empty finding is rejected', rejected);
  let rec = null;
  try {
    rec = await createObservationFromActivity(w, { finding: 'TEST P5 welding without fire watch', risk: 'High', location: 'TEST bay', region: 'usa' });
    check('bridge: observation number format', /^OBS-\d{4}-\d{3}$/.test(rec.obs_no), rec.obs_no);
    check('bridge: hazard category and activity filled', rec.hazard_category === 'Hot Work' && rec.activity === 'Welding / hot work');
    check('bridge: legal clause filled', String(rec.legal_clause || '').length > 5);
    const back = await getObservation(rec.id);
    check('bridge: row saved to the sheet store', !!back && back.description.indexOf('TEST P5') === 0);
  } catch (e) {
    check('bridge: round trip ran without error', false, e.message);
  } finally {
    if (rec) {
      try {
        await removeAction('act_' + rec.id);
      } catch (e) {
        /* no linked action */
      }
      await deleteObservation(rec.id).catch(() => null);
      check('bridge: cleanup removed test row', !(await getObservation(rec.id)));
    }
  }
}

/* ---------- Fire safety ---------- */

async function testFire() {
  const fire = await fromTests(() => loadFire());
  check('fire: six fire types', fire.fire_types.length === 6);
  check('fire: label systems for Europe, USA/Canada and India', fire.label_systems.length === 3);
  const exts = fire.extinguishers.map((e) => e.id);
  check('fire: seven extinguisher types', exts.length === 7);
  let incomplete = [];
  fire.fire_types.forEach((t) => exts.forEach((e) => {
    const c = (fire.matrix[t.id] || {})[e];
    if (!c || !['yes', 'no', 'caution'].includes(c.r)) incomplete.push(t.id + '/' + e);
  }));
  check('fire: matcher matrix is complete (6 fire types x 7 extinguishers)', !incomplete.length, incomplete.join(','));
  const r = (t, e) => fire.matrix[t][e].r;
  check('fire: never water on burning liquid or live electrics', r('liquids', 'water') === 'no' && r('electrical', 'water') === 'no' && r('cooking', 'water') === 'no');
  check('fire: CO2 and powder suit live electrics', r('electrical', 'co2') === 'yes' && r('electrical', 'abc') === 'yes');
  check('fire: only special powder works on metals', r('metals', 'powderd') === 'yes' && ['water', 'foam', 'abc', 'bc', 'co2', 'wetchem'].every((e) => r('metals', e) === 'no'));
  check('fire: wet chemical is the cooking oil answer', r('cooking', 'wetchem') === 'yes');
  check('fire: gas fire needs caution (stop the supply)', r('gases', 'abc') === 'caution');
  const order = matchExtinguishers(fire, 'solids').map((m) => m.r);
  check('fire: matcher lists best first, never-use last', order[0] === 'yes' && order[order.length - 1] === 'no');
  check('fire: reverse matcher for CO2', matchFireTypes(fire, 'co2')[0].r === 'yes');
  check('fire: PASS spells Pull, Aim, Squeeze, Sweep', fire.pass.map((p) => p.letter).join('') === 'PASS' && fire.pass.map((p) => p.word).join() === 'Pull,Aim,Squeeze,Sweep');
  check('fire: RACE has four steps', fire.race.map((p) => p.letter).join('') === 'RACE');
  check('fire: 10 monthly inspection checks', fire.inspection.monthly.length === 10 && fire.inspection.monthly.every((i) => i.fail));
  const ans = {};
  fire.inspection.monthly.forEach((i) => { ans[i.id] = 'ok'; });
  check('fire: all OK passes the monthly check', evaluateMonthly(fire.inspection.monthly, ans).pass === true);
  ans.gauge = 'fail';
  const ev = evaluateMonthly(fire.inspection.monthly, ans);
  check('fire: a failed item fails the check', ev.pass === false && ev.failed.length === 1 && ev.failed[0].id === 'gauge');
  check('fire: unanswered items are not a pass', evaluateMonthly(fire.inspection.monthly, {}).pass === false);
  check('fire: hot work fire watch has before, during and after', fire.hot_work_fire_watch.before.length >= 5 && fire.hot_work_fire_watch.during.length >= 3 && fire.hot_work_fire_watch.after.length >= 3);
  check('fire: drill checklist and record fields', fire.drill.before.length >= 3 && fire.drill.during.length >= 4 && fire.drill.after.length >= 4 && fire.drill.record_fields.length >= 6);
  check('fire: legal text for all four countries', REGIONS.every((x) => FIRE_LEGAL[x] && FIRE_LEGAL[x].length > 20));
  check('fire: visual walk-steps defined', FIRE_WALK.where_first.length >= 4 && FIRE_WALK.hidden.length >= 5 && FIRE_WALK.protect.length >= 2);
}

/* ---------- PPE ---------- */

async function testPpe() {
  const ppe = await fromTests(() => loadPpe());
  const items = Object.values(ppe.items);
  check('ppe: 25 or more PPE items', items.length >= 25, String(items.length));
  check('ppe: every item has EN, USA, Canada and India standards', items.every((i) => ['eu', 'usa', 'canada', 'india'].every((k) => String(i.standards[k] || '').trim())));
  check('ppe: 15 or more tasks and every PPE id exists', ppe.tasks.length >= 15 && ppe.tasks.every((t) => t.ppe.length >= 2 && t.ppe.every((id) => !!ppe.items[id])));
  check('ppe: helmet cites EN 397 and ANSI Z89.1', ppe.items.helmet.standards.eu.indexOf('EN 397') >= 0 && ppe.items.helmet.standards.usa.indexOf('Z89.1') >= 0);
  check('ppe: harness cites EN 361 and IS 3521', ppe.items.harness.standards.eu.indexOf('EN 361') >= 0 && ppe.items.harness.standards.india.indexOf('3521') >= 0);
  check('ppe: Gulf uses the EN codes', stdFor(ppe.items.helmet, 'gulf') === ppe.items.helmet.standards.eu && stdFor(ppe.items.helmet, 'india') === ppe.items.helmet.standards.india);
  const weld = ppeForTask(ppe, 'welding');
  check('ppe: welding needs a welding helmet and fume respirator', weld.items.some((i) => i.id === 'welding_helmet') && weld.items.some((i) => i.id === 'respirator_particle'));
  check('ppe: work at height needs a harness', ppeForTask(ppe, 'work_at_height').items.some((i) => i.id === 'harness'));
  check('ppe: unknown task returns nothing', ppeForTask(ppe, 'nope').items.length === 0);
  check('ppe: 8 pre-use inspection guides with reject criteria', ppe.inspection.length === 8 && ppe.inspection.every((e) => e.before_use.length >= 3 && e.reject_if.length >= 3 && e.care.length >= 1));
  const harness = ppe.inspection.find((e) => e.id === 'harness');
  check('ppe: no defect ticked means no reject', inspectionVerdict(harness, {}).reject === false);
  check('ppe: one defect ticked rejects', inspectionVerdict(harness, { 0: true }).reject === true && inspectionVerdict(harness, { 0: true }).hits.length === 1);
  check('ppe: heat stress adjustments and rules', ppe.heat_stress.adjustments.length >= 6 && ppe.heat_stress.rules.length >= 4 && /last|never|before/i.test(ppe.heat_stress.principle));
  check('ppe: legal text for all four countries', REGIONS.every((x) => PPE_LEGAL[x] && PPE_LEGAL[x].length > 20));
  check('ppe: OSHA 1910.132 cited for the USA', PPE_LEGAL.usa.indexOf('1910.132') >= 0);
  check('ppe: visual walk-steps defined', PPE_WALK.where_first.length >= 4 && PPE_WALK.hidden.length >= 5);
}

/* ---------- Machine safety and LOTO ---------- */

async function testMachines() {
  const d = await fromTests(() => loadMachines());
  const ids = d.machines.map((m) => m.id);
  ['conveyors', 'power_press', 'lathe_drill', 'grinder', 'forklift', 'compressor_boiler'].forEach((id) => check('machines: has ' + id, ids.includes(id)));
  let bad = [];
  d.machines.forEach((m) => {
    const p = [];
    if (m.nip_points.length < 3) p.push('nip');
    if (m.guarding.length < 3) p.push('guarding');
    if (m.before_start.length < 4) p.push('before');
    if (m.daily_checks.length < 4) p.push('daily');
    if (m.hidden_hazards.length < 3) p.push('hidden');
    if (m.never.length < 3) p.push('never');
    if (m.energy_sources.length < 2) p.push('energy');
    if (REGIONS.some((r) => !String(m.legal[r] || '').trim())) p.push('legal');
    if (!HAZARD_CATEGORIES.includes(m.bridge.hazard_category) || m.bridge.typical.length < 3) p.push('bridge');
    if (p.length) bad.push(m.id + ': ' + p.join(','));
  });
  check('machines: every machine is complete (nip points, guarding, checks, never, energy, 4 countries, bridge)', !bad.length, bad.join(' | '));
  const press = d.machines.find((m) => m.id === 'power_press');
  check('machines: press rules ban bypassing two-hand control', press.never.join(' ').toLowerCase().indexOf('two-hand') >= 0);
  const grinder = d.machines.find((m) => m.id === 'grinder');
  check('machines: grinder tool rest gap 3 mm and tongue guard 6 mm', JSON.stringify(grinder.guarding).indexOf('3 mm') >= 0 && JSON.stringify(grinder.guarding).indexOf('6 mm') >= 0);
  check('machines: forklift links to the encyclopedia activity', d.machines.find((m) => m.id === 'forklift').encyclopedia_link === 'forklift_mhe' && !!getActivity('forklift_mhe'));

  const steps = d.loto.steps;
  check('loto: exactly 7 steps numbered 1 to 7', steps.length === 7 && steps.map((s) => s.n).join() === '1,2,3,4,5,6,7');
  check('loto: step order is prepare, notify, shut down, isolate, lock, release, verify', steps.map((s) => s.title).join('|') === 'Prepare|Notify|Shut down|Isolate|Lock and tag|Release stored energy|Verify isolation');
  check('loto: every step has actions, a verify question and mistakes', steps.every((s) => s.do.length >= 2 && s.verify && s.mistakes.length >= 1));
  check('loto: verification step includes try-start and test-prove-test', JSON.stringify(steps[6]).toLowerCase().indexOf('try to start') >= 0 && JSON.stringify(steps[6]).toLowerCase().indexOf('test the tester') >= 0);
  check('loto: restoration steps and lock rules', d.loto.restoration.length >= 4 && d.loto.rules.length >= 4);
  check('loto: 7 energy types', d.loto.energy_types.length === 7);
  check('loto: legal for four countries incl. OSHA 1910.147 and CSA Z460', REGIONS.every((r) => d.loto.legal[r]) && d.loto.legal.usa.indexOf('1910.147') >= 0 && d.loto.legal.canada.indexOf('Z460') >= 0);
  const st = {};
  steps.forEach((s) => { st[s.n] = 'done'; });
  st[5] = 'fail';
  const txt = lotoSummary('Conveyor', 'Test Person', steps, st);
  check('loto: record shows verified and failed steps', txt.indexOf('LOTO VERIFICATION') === 0 && txt.indexOf('5. Lock and tag: FAILED') >= 0 && txt.indexOf('1. Prepare: VERIFIED') >= 0);
  check('machines: nip point types and 7-step walk', d.nip_points.types.length >= 5 && d.nip_points.walk_steps.length === 7);
  check('machines: machine TBT text', /TOOLBOX TALK/.test(machineTbtText(d.machines[0])));
}

/* ---------- Mission, registry and worker ---------- */

async function testMissionAndRegistry() {
  await fromTests(() => loadBlueprint());
  const m = getBlueprint().mission;
  check('mission: 3000+ workers and 3000+ families', !!m && m.audience.workers === '3000+' && m.audience.families === '3000+', JSON.stringify(m && m.audience));

  const d = await getJson('../data/modules.json');
  const home = d.modules.find((x) => x.id === 'home');
  check('registry: home route is /home', home && home.route === '/home', home && home.route);
  const phase5 = ['activity_encyclopedia', 'fire_safety', 'ppe_guide', 'machine_safety'];
  phase5.forEach((id) => {
    const x = d.modules.find((y) => y.id === id);
    check('registry: ' + id + ' active with hyphenated route and file', !!x && x.status === 'active' && x.route === '/' + id.replace(/_/g, '-') && x.file === 'js/modules/' + id + '.js', x ? JSON.stringify({ s: x.status, r: x.route, f: x.file }) : 'missing');
  });
  const routes = d.modules.map((x) => x.route);
  check('registry: all routes unique', new Set(routes).size === routes.length);
  check('registry: ids use underscores and routes use hyphens', d.modules.every((x) => x.id.indexOf('-') < 0 && x.route.indexOf('_') < 0));
  const active = d.modules.filter((x) => x.status === 'active' && x.file);
  check('registry: active file paths match js/modules/<name>.js (underscores allowed)', active.every((x) => /^js\/modules\/[a-z0-9_]+\.js$/.test(x.file)));
  const missing = [];
  for (const x of active) {
    try {
      await getText('../' + x.file);
    } catch (e) {
      missing.push(x.file);
    }
  }
  check('registry: every active module file exists', !missing.length, missing.join(', '));
  check('registry: 16 modules active', d.modules.filter((x) => x.status === 'active').length === 16, String(d.modules.filter((x) => x.status === 'active').length));

  const sw = await getText('../sw.js');
  check('sw: cache version v5', sw.indexOf("CACHE_VERSION = 'v5'") >= 0);
  const listed = (sw.split('const CORE_FILES = [')[1] || '').split('];')[0].match(/'([^']+)'/g) || [];
  const files = listed.map((s) => s.slice(1, -1)).filter((f) => f !== './');
  check('sw: precaches the Phase 5 files', ['css/reference.css', 'js/services/encyclopedia.js', 'js/services/safety_reference.js', 'js/modules/fire_safety.js', 'js/modules/ppe_guide.js', 'js/modules/machine_safety.js', 'js/modules/activity_encyclopedia.js', 'data/fire_safety.json', 'data/ppe_guide.json', 'data/machine_safety.json', 'data/encyclopedia/activities_core.json', 'data/encyclopedia/activities_more.json'].every((f) => files.includes(f)));
  const gone = [];
  for (const f of files) {
    try {
      await getText('../' + f);
    } catch (e) {
      gone.push(f);
    }
  }
  check('sw: every precached file exists (no 404 in the cache list)', !gone.length, gone.join(', '));
}

export async function run() {
  results.length = 0;
  const steps = [testEncyclopediaData, testEncyclopediaService, testObservationBridge, testFire, testPpe, testMachines, testMissionAndRegistry];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      check('step ' + step.name + ' threw', false, e.message);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = { phase: 5, total: results.length, passed, failed, results: results.slice() };
  console.log('[Phase 5 tests] ' + passed + '/' + results.length + ' passed');
  results.filter((r) => !r.ok).forEach((r) => console.warn('FAIL: ' + r.name + (r.detail ? ' — ' + r.detail : '')));
  render(summary);
  return summary;
}

function render(summary) {
  const box = document.getElementById('phase5-results');
  if (!box) return;
  box.textContent = '';
  const head = document.createElement('h3');
  head.textContent = 'Phase 5: ' + summary.passed + '/' + summary.total + ' passed' + (summary.failed ? ' (' + summary.failed + ' failed)' : '');
  box.appendChild(head);
  const ul = document.createElement('ul');
  summary.results.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : '');
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

if (typeof document !== 'undefined' && document.getElementById('phase5-results')) run();

export default { run };
