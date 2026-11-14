/* NASUR - Phase 4 tests (standalone: exports run(), also auto-runs when #phase4-results exists)
   Database tests create TEST_ records and delete them again. */
import { STORES } from '../js/core/config.js';
import * as repo from '../js/services/repo.js';
import {
  COLUMNS,
  colLetter,
  riskScore,
  validateStamp,
  parseBatchText,
  toCsv,
  suggestLegalClause,
  createObservation,
  updateField,
  flushAll,
  getObservation,
  deleteObservation,
  findRepeatHazards,
  todayIso
} from '../js/services/observations.js';
import { listActions, removeAction } from '../js/services/actions.js';
import { classify, severityOf, notificationHints, calcRates, createIncident, getIncident, updateIncident, removeIncident, generateCapa, closeIncident } from '../js/services/incidents.js';
import { classifyBehaviour, suggestCategory, suggestCapa, newChain, addWhy, phrase, INTERVIEW_STEPS } from '../js/services/rca.js';
import { validatePayload, slug } from '../js/services/templates.js';
import { parseQuery, search } from '../js/services/search.js';
import { renderReportHtml, buildReportData, DEFAULT_TEMPLATE } from '../js/services/reports.js';
import { detectIntent, extractJson, offlineDraft } from '../js/services/ai_extender.js';
import {
  saveMemory,
  proposeMemory,
  listProposals,
  rejectMemory,
  listMemories,
  deleteMemory,
  challengeCheck,
  buildAiContext,
  redact,
  saveEmployerData,
  listEmployerData,
  removeEmployerData,
  snapshotBefore,
  rollback,
  DEEP_LEVELS
} from '../js/services/jarvis_core.js';

const results = [];
const NOTES = STORES.MEMORY_NOTES;

function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? '' : detail || '' });
}

async function throws(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return true;
  }
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

/* ---------- Pure logic ---------- */

function testObservationSchema() {
  const keys = COLUMNS.map((c) => c.key);
  check('observations: 28 base columns (A to AB)', COLUMNS.length === 28, String(COLUMNS.length));
  check('observations: column A is obs_no and AB is closure_remarks', keys[0] === 'obs_no' && keys[27] === 'closure_remarks');
  check('observations: column order matches master schema', keys[1] === 'date' && keys[9] === 'risk_rating' && keys[17] === 'status' && keys[19] === 'photo_before' && keys[23] === 'legal_clause');
  check('observations: column letters A, Z, AA, AB', colLetter(0) === 'A' && colLetter(25) === 'Z' && colLetter(26) === 'AA' && colLetter(27) === 'AB');
  check('observations: risk scores', riskScore('Low') === 1 && riskScore('Critical') === 4 && riskScore('x') === 0);
  check('observations: future date is rejected', validateStamp('2999-01-01', '10:00').ok === false);
  const old = validateStamp('2020-01-01', '10:00');
  check('observations: past date allowed and flagged as past', old.ok === true && old.past === true);
  check('observations: US fall clause links OSHA 1926.501', suggestLegalClause('Fall from Height', 'usa').indexOf('1926.501') >= 0);
  check('observations: India default clause mentions OSH Code', suggestLegalClause('Other', 'india').indexOf('OSH Code') >= 0);
  const csv = toCsv([{ obs_no: 'OBS-2026-001', description: 'வெல்டிங் ஆபத்து, "quote"', photo_before: 'data:image/jpeg;base64,xx' }]);
  check('observations: CSV starts with UTF-8 BOM', csv.charCodeAt(0) === 0xfeff);
  check('observations: CSV keeps Tamil text and escapes quotes', csv.indexOf('வெல்டிங் ஆபத்து') >= 0 && csv.indexOf('""quote""') >= 0);
  check('observations: CSV marks photos as Attached, never embeds them', csv.indexOf('Attached') >= 0 && csv.indexOf('base64') < 0);
  check('observations: CSV header has 28 labels', toCsv([]).split('\r\n')[0].split('","').length === 28);
}

function testBatchParser() {
  const drafts = parseBatchText('# 2026-11-10\n07:30 | Bay 3 | Welding | No fire blanket under welding High\n9:15 am Worker without helmet near crane, Medium\n14.05 Spill near store');
  check('batch: three notes parsed', drafts.length === 3, String(drafts.length));
  check('batch: date header applied', drafts[0] && drafts[0].date === '2026-11-10');
  check('batch: time, location, activity, risk parsed', drafts[0] && drafts[0].time === '07:30' && drafts[0].location === 'Bay 3' && drafts[0].activity === 'Welding' && drafts[0].risk_rating === 'High');
  check('batch: am/pm time and trailing risk word', drafts[1] && drafts[1].time === '09:15' && drafts[1].risk_rating === 'Medium');
  check('batch: dotted time 14.05', drafts[2] && drafts[2].time === '14:05');
}

function testIncidentLogic() {
  check('incidents: classification order', classify({ firstAid: true }) === 'first_aid' && classify({ firstAid: true, lostTime: true }) === 'lti' && classify({ fatality: true }) === 'fatality' && classify({}) === 'near_miss');
  check('incidents: recordable flags', severityOf('mtc').recordable === true && severityOf('first_aid').recordable === false);
  const r = calcRates([{ severity: 'mtc', status: 'closed' }, { severity: 'lti', status: 'closed', lost_days: 3 }], 100000);
  check('incidents: TRIR per 200,000 hours', r.trir === 4, String(r.trir));
  check('incidents: LTIFR per 1,000,000 hours', r.ltifr === 10, String(r.ltifr));
  check('incidents: USA fatality hint mentions OSHA 8 hours', notificationHints('usa', 'fatality').join(' ').indexOf('8 hours') >= 0);
}

function testRca() {
  check('rca: human error classified', classifyBehaviour({ unintended: true }).type === 'human_error');
  check('rca: reckless only when no system pressure', classifyBehaviour({ consciousRisk: true, peersWouldDo: false, systemPressure: false }).type === 'reckless');
  check('rca: substitution test downgrades to at-risk', classifyBehaviour({ consciousRisk: true, peersWouldDo: true }).type === 'at_risk');
  check('rca: category suggestion from words', suggestCategory('the guard was broken and the machine was worn') === 'equipment');
  check('rca: Tamil comfort phrase available', phrase('sit', 'ta').indexOf('உட்காருங்கள்') >= 0 && phrase('thanks', 'ar').length > 5);
  check('rca: seven interview steps', INTERVIEW_STEPS.length === 7);
  let ch = newChain('Worker cut hand');
  for (let i = 0; i < 7; i++) ch = addWhy(ch, 'because ' + i);
  check('rca: why chain stops at five', ch.whys.length === 5);
  const capa = suggestCapa([{ category: 'equipment', text: 'guard missing' }], { severe: true });
  check('rca: CAPA gives corrective and preventive actions with dates', capa.length === 2 && capa[0].kind === 'corrective' && /^\d{4}-\d{2}-\d{2}$/.test(capa[0].target_date));
}

function testTemplates() {
  check('templates: slug makes safe keys', slug('Permit No. #1!') === 'permit_no_1');
  const col = validatePayload('custom_column', { label: 'Permit Number', type: 'text' });
  check('templates: custom column key is prefixed x_', col.ok && col.clean.key === 'x_permit_number');
  check('templates: dropdown needs 2 options', validatePayload('custom_column', { label: 'Shift', type: 'select', options: ['Day'] }).ok === false);
  check('templates: custom keys are always prefixed so they cannot clash with base columns', validatePayload('custom_column', { label: 'Status', key: 'status', type: 'text' }).clean.key === 'x_status');
  check('templates: report with no valid sections rejected', validatePayload('report_template', { title: 'My report', sections: [{ type: 'hacker' }] }).ok === false);
  check('templates: report keeps allowed sections only', validatePayload('report_template', { title: 'My report', sections: [{ type: 'summary' }, { type: 'bogus' }] }).clean.sections.length === 1);
  check('templates: checklist needs two items', validatePayload('checklist', { title: 'Forklift check', items: ['Brakes'] }).ok === false);
  const cl = validatePayload('checklist', { title: 'Forklift check', purpose: 'equipment', items: ['Brakes work', { text: 'Horn works', critical: true }] });
  check('templates: valid checklist cleaned', cl.ok && cl.clean.items.length === 2 && cl.clean.items[1].critical === true);
  check('templates: safety rule needs summary', validatePayload('safety_rule', { title: 'Heat rule' }).ok === false);
}

function testAiExtender() {
  check('ai: intent detection column', detectIntent('Add a column for permit number') === 'custom_column');
  check('ai: intent detection checklist', detectIntent('make a hot work checklist') === 'checklist');
  check('ai: intent detection rule', detectIntent('what are the heat rules in Saudi Arabia') === 'safety_rule');
  check('ai: intent detection report', detectIntent('new weekly report format') === 'report_template');
  check('ai: JSON extracted from fenced text', extractJson('```json\n{"a":1}\n```').a === 1 && extractJson('noise {"b":2} noise').b === 2 && extractJson('no json') === null);
  const off = offlineDraft('custom_column', 'add a yes/no column called Permit Available');
  check('ai: offline column draft', off && off.label === 'Permit Available' && off.type === 'yesno', JSON.stringify(off));
}

function testSearchParsing() {
  const q = parseQuery('When did that welding issue happen?');
  check('search: "when" question detected', q.wantsWhen === true);
  check('search: welding expands to synonyms', q.keywords.length === 1 && q.keywords[0].indexOf('hot work') >= 0, JSON.stringify(q.keywords));
  const q2 = parseQuery('open high risk scaffold last 30 days');
  check('search: status, risk and date range parsed', q2.statuses.includes('open') && q2.risks.includes('High') && !!q2.from && !!q2.to);
  const q3 = parseQuery('near misses last week');
  check('search: near miss maps to incidents', q3.severities.includes('near_miss') && q3.types.includes('incident'));
}

/* ---------- JARVIS core ---------- */

async function testJarvisCore() {
  check('core: memory refuses unapproved save', await throws(() => saveMemory({ title: 'TEST_MEM_P4', detail: 'x' }, {})));
  const prop = proposeMemory({ category: 'lessons_learned', title: 'TEST_PROP_P4', detail: 'proposal only' });
  const stored = (await listMemories()).some((m) => m.title === 'TEST_PROP_P4');
  check('core: proposals are not stored until approved', !!prop && !stored);
  if (prop) rejectMemory(prop.pid);
  check('core: rejected proposal removed', !listProposals().some((p) => p.title === 'TEST_PROP_P4'));
  let mem = null;
  try {
    mem = await saveMemory({ category: 'lessons_learned', title: 'TEST_MEM_P4', detail: 'approved' }, { approved: true });
    check('core: approved memory saved', !!mem && mem.scope === 'approved_personal_memory');
  } finally {
    if (mem) await deleteMemory(mem.id);
  }

  const a = await saveEmployerData({ clientId: 'cli_test_a', title: 'TEST_EC_A' });
  const b = await saveEmployerData({ clientId: 'cli_test_b', title: 'TEST_EC_B' });
  try {
    const la = await listEmployerData({ clientId: 'cli_test_a' });
    check('core: employer data isolated per client', la.some((r) => r.title === 'TEST_EC_A') && !la.some((r) => r.title === 'TEST_EC_B'));
    check('core: employer data needs a scope', await throws(() => listEmployerData({})));
  } finally {
    await removeEmployerData(a.id);
    await removeEmployerData(b.id);
  }

  check('core: challenge flags unsafe shortcut', challengeCheck('lets skip lockout and clean the machine').flagged === true);
  check('core: challenge stays quiet on safe text', challengeCheck('we will wear a harness and use a permit').flagged === false);

  check('core: four deep-context levels', DEEP_LEVELS.length === 4);
  check('core: level off sends nothing', Object.keys(buildAiContext({ page: 'observations' }, 'off')).join() === 'level');
  const meta = buildAiContext({ page: 'observations', fields: [{ key: 'desc', label: 'Description', type: 'text', value: 'secret123' }, { key: 'pw', type: 'password', value: 'pw' }] }, 'field_metadata');
  check('core: field metadata never contains typed values', JSON.stringify(meta).indexOf('secret123') < 0 && meta.fields.length === 1 && meta.fields[0].filled === true);
  const sel = buildAiContext({ page: 'p', selectedText: 'call 9876543210 or a@b.com' }, 'user_selected_text');
  check('core: selected text is redacted by default', sel.selectedText.indexOf('9876543210') < 0 && sel.selectedText.indexOf('a@b.com') < 0);
  check('core: raw text only with explicit approval', buildAiContext({ selectedText: 'ID 12345678', approvedRaw: true }, 'user_selected_text').selectedText.indexOf('12345678') >= 0);
  check('core: redact removes emails and long numbers', redact('mail me x@y.com 123456789').indexOf('@') < 0 && redact('123456789').indexOf('123456789') < 0);

  const rec = await saveEmployerData({ clientId: 'cli_test_rb', title: 'TEST_RB_ORIGINAL' });
  let snap = null;
  let snap2 = null;
  const ghostId = 'ec_ghost_p4';
  try {
    snap = await snapshotBefore('TEST rollback', [{ store: NOTES, id: rec.id }]);
    await repo.save(NOTES, { ...rec, title: 'TEST_RB_CHANGED' });
    await rollback(snap.id);
    const back = await repo.get(NOTES, rec.id);
    check('core: rollback restores the old record', back && back.title === 'TEST_RB_ORIGINAL');
    snap2 = await snapshotBefore('TEST rollback new item', [{ store: NOTES, id: ghostId }]);
    await repo.save(NOTES, { id: ghostId, kind: 'employer_data', clientId: 'cli_test_rb', title: 'TEST_GHOST', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await rollback(snap2.id);
    check('core: rollback removes items that did not exist before', !(await repo.get(NOTES, ghostId)));
    check('core: a snapshot cannot be rolled back twice', await throws(() => rollback(snap.id)));
  } finally {
    await removeEmployerData(rec.id);
    await repo.remove(NOTES, ghostId).catch(() => null);
    if (snap) await repo.remove(NOTES, snap.id).catch(() => null);
    if (snap2) await repo.remove(NOTES, snap2.id).catch(() => null);
  }
}

/* ---------- Database round trips ---------- */

async function testObservationRoundTrip() {
  const ids = [];
  const today = todayIso();
  try {
    const first = await createObservation({ contractor: 'TEST_CON_P4', activity: 'TEST welding p4', hazard_category: 'Hot Work', risk_rating: 'High', description: 'TEST obs one', corrective_action: 'TEST corrective', responsible: 'Tester', target_date: '2020-01-01', location: 'TEST bay' });
    ids.push(first.id);
    check('obs db: number format OBS-YYYY-NNN', /^OBS-\d{4}-\d{3}$/.test(first.obs_no), first.obs_no);
    check('obs db: legal clause auto-linked', !!String(first.legal_clause || '').trim());
    check('obs db: future entry is rejected', await throws(() => createObservation({ date: '2999-01-01', time: '10:00', description: 'TEST future' })));

    updateField(first.id, 'status', 'Closed');
    updateField(first.id, 'root_cause', 'TEST root');
    await flushAll();
    const back = await getObservation(first.id);
    check('obs db: auto-save persisted both edits', back.status === 'Closed' && back.root_cause === 'TEST root');
    check('obs db: closing sets closure date', back.closure_date === today, back.closure_date);

    const linked = await listActions({ source_id: first.id });
    check('obs db: corrective action synced to tracker', linked.length === 1 && linked[0].status === 'done' && linked[0].source_no === first.obs_no, JSON.stringify(linked.map((a) => a.status)));

    const second = await createObservation({ contractor: 'TEST_CON_P4', activity: 'TEST welding p4', hazard_category: 'Hot Work', risk_rating: 'High', description: 'TEST obs two' });
    ids.push(second.id);
    check('obs db: numbers increase', second.obs_no > first.obs_no);
    const repeats = await findRepeatHazards({ id: second.id, contractor: 'TEST_CON_P4', activity: 'TEST welding p4', hazard_category: 'Hot Work' });
    check('obs db: repeat-hazard alert finds the earlier high-risk row', repeats.length >= 1 && repeats[0].obs_no === first.obs_no);

    const found = await search('welding TEST');
    check('search db: finds observation by topic', found.results.some((r) => r.type === 'observation' && r.record.contractor === 'TEST_CON_P4'), String(found.total));
    check('search db: answer text mentions the record', found.answer.indexOf('OBS-') >= 0);

    const data = await buildReportData({ period: 'daily', preparedBy: 'Test Engineer', manHours: 100000 });
    const html = renderReportHtml(data, DEFAULT_TEMPLATE);
    check('report: contains sign-off roles', html.indexOf('Prepared By') >= 0 && html.indexOf('Reviewed By') >= 0 && html.indexOf('Approved By') >= 0);
    check('report: A4 page rule and report number', html.indexOf('size:A4') >= 0 && html.indexOf('HSE-RPT-') >= 0);
    check('report: includes test observation and KPIs', html.indexOf('TEST obs one') >= 0 && html.indexOf('TRIR') >= 0);
    check('report: HTML escaped', renderReportHtml({ ...data, projectName: '<script>x</script>' }, DEFAULT_TEMPLATE).indexOf('<script>x</script>') < 0);
  } catch (e) {
    check('obs db: round trip ran without error', false, e.message);
  } finally {
    for (const id of ids) {
      try {
        await removeAction('act_' + id);
        await deleteObservation(id);
      } catch (e) {
        /* cleanup best effort */
      }
    }
    const left = await Promise.all(ids.map((id) => getObservation(id)));
    check('obs db: cleanup removed test rows', left.every((r) => !r));
  }
}

async function testIncidentRoundTrip() {
  let inc = null;
  try {
    inc = await createIncident({ description: 'TEST incident p4 slip on wet floor', severity: 'first_aid', type: 'Injury / Illness', location: 'TEST store', injured: { name: 'Test Worker' } });
    check('incident db: number format INC-YYYY-NNN', /^INC-\d{4}-\d{3}$/.test(inc.incident_no), inc.incident_no);
    check('incident db: person stored', inc.injured.name === 'Test Worker');
    check('incident db: future date rejected', await throws(() => createIncident({ description: 'TEST future incident', date: '2999-01-01', time: '10:00' })));
    await updateIncident(inc.id, { rca: { rootCauses: [{ category: 'equipment', text: 'TEST floor drain blocked' }], capa: [] } });
    const made = await generateCapa(inc.id);
    check('incident db: RCA created tracked CAPA actions', made.length === 2, String(made.length));
    const after = await getIncident(inc.id);
    check('incident db: incident now has open actions', after.status === 'capa_open' && after.capa_ids.length === 2);
    check('incident db: cannot close while actions are open', await throws(() => closeIncident(inc.id, 'x')));
    const again = await generateCapa(inc.id);
    check('incident db: generating twice does not duplicate', again.length === 0, String(again.length));
  } catch (e) {
    check('incident db: round trip ran without error', false, e.message);
  } finally {
    if (inc) {
      const rows = await listActions({ source_id: inc.id });
      for (const a of rows) await removeAction(a.id);
      await removeIncident(inc.id);
      check('incident db: cleanup removed test data', !(await getIncident(inc.id)));
    }
  }
}

/* ---------- Static files ---------- */

async function testBlueprint() {
  const d = await getJson('../data/nasur_master_blueprint.json');
  check('blueprint: three memory scopes', d.memory_scopes.length === 3 && d.memory_scopes.map((s) => s.id).join() === 'temporary_session,approved_personal_memory,employer_confidential_data');
  check('blueprint: seven industry hooks', Object.keys(d.industry_hooks).length === 7);
  check('blueprint: four deep-context levels', d.deep_context_levels.length === 4);
  check('blueprint: mission protects workers and families', !!d.mission && d.mission.audience.workers.length > 0 && d.mission.priorities.length >= 3);
  check('blueprint: company profiler flow defined', d.company_profiler.flow.length >= 6 && d.company_profiler.generates.includes('report_template'));
  check('blueprint: companion check-in has Tamil and Tanglish greetings', d.companion_checkin.greetings.some((g) => g.lang === 'ta') && d.companion_checkin.greetings.some((g) => g.lang === 'tanglish'));
  check('blueprint: rule radar needs the user Okay', d.rule_radar.approval_words.includes('okay') && d.rule_radar.rules.join(' ').indexOf('Okay') >= 0);
  check('blueprint: language coach covers English, Hindi, Arabic', ['english', 'hindi', 'arabic'].every((l) => d.language_confidence_coach.target_languages.includes(l)));
  check('blueprint: iOS and Android PWA with Hey JARVIS', d.cross_platform.targets.includes('ios_safari_pwa') && d.cross_platform.voice_activation.phrase === 'Hey JARVIS');
}

async function testRegistryAndWorker() {
  const d = await getJson('../data/modules.json');
  const ids = d.modules.map((m) => m.id);
  check('modules: registry has schema, 4 PDCA stages and groups', !!d.schema_version && d.pdca_stages.length === 4 && d.groups.length > 0);
  check('modules: at least 38 modules, unique ids', d.modules.length >= 38 && new Set(ids).size === ids.length, String(d.modules.length));
  check('modules: ids use underscores, routes use hyphens', d.modules.every((m) => m.id.indexOf('-') < 0 && (m.id === 'home' || m.route === '/' + m.id.replace(/_/g, '-'))));
  const must = ['home', 'more', 'settings', 'projects', 'career', 'workspace', 'observations', 'reports', 'rca_coach', 'incidents', 'history_search', 'jarvis_studio'];
  must.forEach((m) => {
    const x = d.modules.find((y) => y.id === m);
    check('modules: ' + m + ' is active', !!x && x.status === 'active' && (m === 'more' || !!x.file), x ? JSON.stringify({ s: x.status, f: x.file }) : 'missing');
  });
  const groupIds = d.groups.map((g) => g.id);
  const stageIds = d.pdca_stages.map((s) => s.id);
  check('modules: groups and PDCA values are valid', d.modules.every((m) => groupIds.includes(m.group) && (m.pdca === null || stageIds.includes(m.pdca))));
  const sw = await getText('../sw.js');
  check('sw: cache version v4', sw.indexOf("CACHE_VERSION = 'v4'") >= 0);
  ['js/services/jarvis_core.js', 'data/nasur_master_blueprint.json', 'css/observations.css', 'js/modules/jarvis_studio.js', 'js/services/observations.js', 'js/services/search.js'].forEach((f) => check('sw: precaches ' + f, sw.indexOf(f) >= 0));
}

export async function run() {
  results.length = 0;
  const steps = [testObservationSchema, testBatchParser, testIncidentLogic, testRca, testTemplates, testAiExtender, testSearchParsing, testJarvisCore, testObservationRoundTrip, testIncidentRoundTrip, testBlueprint, testRegistryAndWorker];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      check('step ' + step.name + ' threw', false, e.message);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = { phase: 4, total: results.length, passed, failed, results: results.slice() };
  console.log('[Phase 4 tests] ' + passed + '/' + results.length + ' passed');
  results.filter((r) => !r.ok).forEach((r) => console.warn('FAIL: ' + r.name + (r.detail ? ' — ' + r.detail : '')));
  render(summary);
  return summary;
}

function render(summary) {
  const box = document.getElementById('phase4-results');
  if (!box) return;
  box.textContent = '';
  const head = document.createElement('h3');
  head.textContent = 'Phase 4: ' + summary.passed + '/' + summary.total + ' passed' + (summary.failed ? ' (' + summary.failed + ' failed)' : '');
  box.appendChild(head);
  const ul = document.createElement('ul');
  summary.results.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : '');
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

if (typeof document !== 'undefined' && document.getElementById('phase4-results')) run();

export default { run };
