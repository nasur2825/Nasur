/* NASUR - Phase 3 tests (standalone: exports run(), also auto-runs when #phase3-results exists) */
import { isInSeason } from '../js/services/regions.js';
import { PROVIDERS, LANGUAGES, MAX_INPUT_CHARS, isValidPin, limitInput, maskKey } from '../js/services/settings.js';
import { AUDIT_STANDARDS, PROJECT_STATUSES, saveClient, saveProject, listClients, listProjects, removeClient } from '../js/services/clients.js';

const results = [];

function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? '' : detail || '' });
}

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return res.json();
}

async function testRegionsData() {
  const d = await getJson('../data/regions.json');
  const ids = Object.keys(d.regions);
  check('regions: 4 packs (india, gulf, canada, usa)', ['india', 'gulf', 'canada', 'usa'].every((x) => ids.includes(x)), ids.join(','));
  check('regions: default region exists', !!d.regions[d.defaultRegion]);
  check('regions: 4 industries', (d.industries || []).length === 4);
  ids.forEach((id) => {
    const r = d.regions[id];
    check('regions.' + id + ': laws, emergency, units, hazards present', r.laws.length > 0 && r.emergency && r.units && Array.isArray(r.hazards));
    check('regions.' + id + ': hazard seasons parse', r.hazards.every((hz) => typeof isInSeason(hz.season, new Date(2026, 5, 15)) === 'boolean'));
  });
  check('regions.usa uses imperial units', d.regions.usa.units.system === 'imperial');
  check('regions.gulf has 3 sub-regions', d.regions.gulf.subRegions.length === 3);
}

function testSeasons() {
  check('season: Nov-Mar wraps year (January)', isInSeason('Nov-Mar', new Date(2026, 0, 15)) === true);
  check('season: Nov-Mar excludes July', isInSeason('Nov-Mar', new Date(2026, 6, 15)) === false);
  check('season: Jun-Sep includes August', isInSeason('Jun-Sep', new Date(2026, 7, 1)) === true);
  check('season: All year always true', isInSeason('All year', new Date(2026, 2, 1)) === true);
}

function testSettings() {
  check('settings: input limit is 10000', MAX_INPUT_CHARS === 10000);
  check('settings: limitInput trims long text', limitInput('a'.repeat(12000)).length === 10000);
  check('settings: PIN must be 4 digits', isValidPin('1234') && !isValidPin('12a4') && !isValidPin('123') && !isValidPin('12345'));
  check('settings: 4 AI providers', PROVIDERS.map((p) => p.id).sort().join(',') === 'gemini,groq,nvidia,openrouter');
  check('settings: languages include ta, en, hi, ar', ['ta', 'en', 'hi', 'ar'].every((l) => LANGUAGES.some((x) => x.id === l)));
  check('settings: maskKey hides middle', maskKey('abcd1234efgh').indexOf('1234') < 0);
}

async function testCompetency() {
  const d = await getJson('../data/competency.json');
  check('competency: 4 career levels in order', d.levels.map((l) => l.id).join(',') === 'assistant,officer,engineer,manager');
  const all = d.competencies.concat(...d.sectors.map((s) => s.skills));
  check('competency: every skill has 4 required levels 0-5', all.every((c) => c.req.length === 4 && c.req.every((n) => n >= 0 && n <= 5)));
  check('competency: ids are unique', new Set(all.map((c) => c.id)).size === all.length);
  check('competency: ids use no hyphen-free underscores rule issue (non-empty)', all.every((c) => !!c.id));
  check('competency: 4 sectors', d.sectors.length === 4);
  check('competency: requirements never decrease with seniority', all.every((c) => c.req[0] <= c.req[1] && c.req[1] <= c.req[2] && c.req[2] <= c.req[3]));
  const certIds = d.certs.map((c) => c.id);
  const refs = [].concat(...Object.values(d.certsByLevel).map((l) => l.required.concat(l.recommended)));
  check('competency: certsByLevel references real certs', refs.every((r) => certIds.includes(r)));
  check('competency: NEBOSH IDIP required for manager', d.certsByLevel.manager.required.includes('nebosh-idip'));
}

async function testClientsRoundTrip() {
  check('clients: audit standards defined', AUDIT_STANDARDS.length >= 5);
  check('clients: project statuses defined', PROJECT_STATUSES.length === 4);
  let clientId = null;
  try {
    const c = await saveClient({ name: 'TEST_CLIENT_PHASE3', country: 'gulf', industry: 'oilgas', auditStandards: ['adnoc', 'iso45001'] });
    clientId = c.id;
    check('clients: saveClient returns record', c.type === 'client' && c.country === 'gulf');
    const p = await saveProject({ clientId: c.id, name: 'TEST_PROJECT_PHASE3', manpower: '120' });
    check('clients: project inherits client industry and audit standard', p.industry === 'oilgas' && p.auditStandard === 'adnoc');
    check('clients: manpower stored as number', p.manpower === 120);
    const clients = await listClients();
    check('clients: listClients finds test client', clients.some((x) => x.id === c.id));
    const projects = await listProjects(c.id);
    check('clients: listProjects isolates by client', projects.length === 1 && projects[0].clientId === c.id);
    let rejected = false;
    try {
      await saveClient({ name: '   ' });
    } catch (e) {
      rejected = true;
    }
    check('clients: empty name rejected', rejected);
  } catch (e) {
    check('clients: round trip ran without error', false, e.message);
  } finally {
    if (clientId) {
      try {
        await removeClient(clientId);
        const left = await listClients({ includeArchived: true });
        const proj = await listProjects(clientId, { includeArchived: true });
        check('clients: removeClient cascades to projects', !left.some((x) => x.id === clientId) && proj.length === 0);
      } catch (e) {
        check('clients: cleanup', false, e.message);
      }
    }
  }
}

async function testModulesRegistry() {
  try {
    const d = await getJson('../data/modules.json');
    const list = Array.isArray(d) ? d : d.modules || Object.values(d);
    ['settings', 'projects', 'career', 'workspace'].forEach((mid) => {
      const m = list.find((x) => x && x.id === mid);
      check('modules: ' + mid + ' is active with a file', !!m && m.status === 'active' && !!m.file, m ? JSON.stringify({ status: m.status, file: m.file }) : 'missing');
    });
    check('modules: home still active', list.some((x) => x && x.id === 'home' && x.status === 'active'));
    check('modules: all ids use underscores, no hyphens', list.every((x) => !x || !x.id || String(x.id).indexOf('-') < 0));
  } catch (e) {
    check('modules: data/modules.json readable', false, e.message);
  }
}

export async function run() {
  results.length = 0;
  const steps = [testSeasons, testSettings, testRegionsData, testCompetency, testClientsRoundTrip, testModulesRegistry];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      check('step ' + step.name + ' threw', false, e.message);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = { phase: 3, total: results.length, passed, failed, results: results.slice() };
  console.log('[Phase 3 tests] ' + passed + '/' + results.length + ' passed');
  results.filter((r) => !r.ok).forEach((r) => console.warn('FAIL: ' + r.name + (r.detail ? ' — ' + r.detail : '')));
  render(summary);
  return summary;
}

function render(summary) {
  const box = document.getElementById('phase3-results');
  if (!box) return;
  box.textContent = '';
  const head = document.createElement('h3');
  head.textContent = 'Phase 3: ' + summary.passed + '/' + summary.total + ' passed' + (summary.failed ? ' (' + summary.failed + ' failed)' : '');
  box.appendChild(head);
  const ul = document.createElement('ul');
  summary.results.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = (r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : '');
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

if (typeof document !== 'undefined' && document.getElementById('phase3-results')) run();

export default { run };
