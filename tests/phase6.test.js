/* NASUR — Phase 6 tests
   Covers: data/modules.json, sw.js, js/core/router.js, Phase 6 services and data.
   Works with tests/harness.js when it exposes test()/it(); otherwise runs standalone
   and prints results into the runner page. */

let H = {};
try {
  H = await import('./harness.js');
} catch (e) {
  H = {};
}

const harnessRegister =
  (typeof H.test === 'function' && H.test) ||
  (typeof H.it === 'function' && H.it) ||
  null;

const localTests = [];

function def(name, fn) {
  if (harnessRegister) {
    harnessRegister(name, fn);
  } else {
    localTests.push({ name, fn });
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      (msg || 'Not equal') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)
    );
  }
}

const ROOT = new URL('../', import.meta.url);
const urlOf = (p) => new URL(p, ROOT).href;

async function getText(path) {
  const res = await fetch(urlOf(path), { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
  return res.text();
}

async function getJson(path) {
  return JSON.parse(await getText(path));
}

/* ---------- Expected data ---------- */

const CORE_FILES = [
  'index.html', 'manifest.webmanifest', 'icons/icon.svg',
  'css/tokens.css', 'css/base.css', 'css/components.css', 'css/home.css',
  'css/settings.css', 'css/observations.css', 'css/reference.css', 'css/ops.css',
  'js/core/config.js', 'js/core/eventbus.js', 'js/core/router.js', 'js/core/app.js'
];

const SERVICE_FILES = [
  'js/jarvis/drawer.js', 'js/jarvis/brain.js', 'js/jarvis/providers.js',
  'js/services/db.js', 'js/services/repo.js', 'js/services/config.js',
  'js/services/sanitize.js', 'js/services/regions.js', 'js/services/pin.js',
  'js/services/exporter.js', 'js/services/importer.js', 'js/services/client_repo.js',
  'js/services/workspace_repo.js', 'js/services/career_repo.js',
  'js/services/jarvis_core.js', 'js/services/observations.js',
  'js/services/incidents.js', 'js/services/rca.js', 'js/services/reports.js',
  'js/services/search.js', 'js/services/ai_extender.js',
  'js/services/encyclopedia.js', 'js/services/safety_reference.js',
  'js/services/opsstore.js', 'js/services/risk.js', 'js/services/permits.js',
  'js/services/emergency.js', 'js/services/doc_control.js', 'js/services/audits.js'
];

const DATA_FILES = [
  'data/nasur_master_blueprint.json', 'data/languages.json', 'data/regions.json',
  'data/encyclopedia/activities_core.json', 'data/encyclopedia/activities_more.json',
  'data/encyclopedia/fire_safety.json', 'data/encyclopedia/machine_safety.json',
  'data/encyclopedia/ppe_guide.json', 'data/ptw/permit_types.json',
  'data/ptw/risk_library.json', 'data/emergency.json', 'data/doc_control.json',
  'data/legal_register.json', 'data/audits.json'
];

const EXPECTED_MODULES = [
  ['home', '/home', 'js/modules/home.js'],
  ['observations', '/observations', 'js/modules/observations.js'],
  ['incidents', '/incidents', 'js/modules/incidents.js'],
  ['rca_coach', '/rca-coach', 'js/modules/rca_coach.js'],
  ['reports', '/reports', 'js/modules/reports.js'],
  ['history_search', '/history-search', 'js/modules/history_search.js'],
  ['jarvis_studio', '/jarvis-studio', 'js/modules/jarvis_studio.js'],
  ['activity_encyclopedia', '/activity-encyclopedia', 'js/modules/activity_encyclopedia.js'],
  ['fire_safety', '/fire-safety', 'js/modules/fire_safety.js'],
  ['ppe_guide', '/ppe-guide', 'js/modules/ppe_guide.js'],
  ['machine_safety', '/machine-safety', 'js/modules/machine_safety.js'],
  ['ptw_jsa', '/ptw-jsa', 'js/modules/ptw_jsa.js'],
  ['emergency', '/emergency', 'js/modules/emergency.js'],
  ['doc_control', '/doc-control', 'js/modules/doc_control.js'],
  ['audits', '/audits', 'js/modules/audits.js'],
  ['clients', '/clients', 'js/modules/clients.js'],
  ['workspace', '/workspace', 'js/modules/workspace.js'],
  ['career', '/career', 'js/modules/career.js'],
  ['settings', '/settings', 'js/modules/settings.js']
];

const MODULE_FILES = EXPECTED_MODULES.map((m) => m[2]);
const ALL_ASSETS = [...CORE_FILES, ...SERVICE_FILES, 'data/modules.json', ...DATA_FILES, ...MODULE_FILES];

const ROUTER_EXPORTS = [
  'DEFAULT_ROUTE', 'validateRegistry', 'setModuleRegistry', 'clearModuleRegistry',
  'loadModuleRegistry', 'getRegistry', 'getModules', 'getModule', 'getModuleByRoute',
  'isModuleOpenable', 'getNavItems', 'getModulesByGroup', 'getModulesByPdca',
  'parseHash', 'routePath', 'hrefFor', 'registerBuiltin', 'setNavigationGuard',
  'startRouter', 'stopRouter', 'isRouterRunning', 'navigate', 'getCurrentRoute',
  'getCurrentView', 'getLastRoute'
];

let routerPromise = null;
function loadRouter() {
  if (!routerPromise) routerPromise = import('../js/core/router.js');
  return routerPromise;
}

async function withRegistry(R, fn) {
  const saved = R.getRegistry();
  try {
    return await fn();
  } finally {
    try {
      if (saved) R.setModuleRegistry(saved);
      else R.clearModuleRegistry();
    } catch (e) {
      /* ignore restore errors */
    }
  }
}

/* ---------- data/modules.json ---------- */

def('modules.json: top-level schema', async () => {
  const reg = await getJson('data/modules.json');
  ok(typeof reg.schema_version === 'number', 'schema_version missing');
  ok(Array.isArray(reg.pdca_stages) && reg.pdca_stages.length === 4, 'pdca_stages must have 4 stages');
  ok(Array.isArray(reg.groups) && reg.groups.length > 0, 'groups missing');
  ok(Array.isArray(reg.modules), 'modules must be an array');
});

def('modules.json: registers all 19 file modules plus builtin more', async () => {
  const reg = await getJson('data/modules.json');
  eq(reg.modules.length, 20, 'module count');
  for (const [id, route, file] of EXPECTED_MODULES) {
    const m = reg.modules.find((x) => x.id === id);
    ok(m, 'missing module ' + id);
    eq(m.route, route, id + ' route');
    eq(m.file, file, id + ' file');
    eq(m.builtin, false, id + ' builtin flag');
  }
  const more = reg.modules.find((x) => x.id === 'more');
  ok(more, 'missing builtin more');
  eq(more.route, '/more', 'more route');
  eq(more.builtin, true, 'more builtin');
  eq(more.file, null, 'more file');
});

def('modules.json: ids unique with underscores, routes unique with hyphens', async () => {
  const reg = await getJson('data/modules.json');
  const ids = new Set();
  const routes = new Set();
  for (const m of reg.modules) {
    ok(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(m.id), 'bad id ' + m.id);
    ok(/^\/[a-z0-9]+(-[a-z0-9]+)*$/.test(m.route), 'bad route ' + m.route);
    ok(!ids.has(m.id), 'duplicate id ' + m.id);
    ok(!routes.has(m.route), 'duplicate route ' + m.route);
    ids.add(m.id);
    routes.add(m.route);
  }
  eq(reg.modules.find((m) => m.id === 'home').route, '/home', 'home route must be /home');
});

def('modules.json: groups and pdca references are valid', async () => {
  const reg = await getJson('data/modules.json');
  const groups = new Set(reg.groups.map((g) => g.id));
  const stages = new Set(reg.pdca_stages.map((s) => s.id));
  for (const m of reg.modules) {
    ok(groups.has(m.group), m.id + ' has unknown group ' + m.group);
    ok(m.pdca === null || stages.has(m.pdca), m.id + ' has unknown pdca ' + m.pdca);
    ok(typeof m.title === 'string' && m.title.length > 0, m.id + ' title');
    ok(typeof m.icon === 'string' && m.icon.length > 0, m.id + ' icon');
    ok(typeof m.nav === 'boolean', m.id + ' nav must be boolean');
  }
});

def('modules.json: every module file exists on disk', async () => {
  const missing = [];
  for (const file of MODULE_FILES) {
    const res = await fetch(urlOf(file), { cache: 'no-store' });
    if (!res.ok) missing.push(file);
  }
  ok(missing.length === 0, 'missing module files: ' + missing.join(', '));
});

/* ---------- sw.js ---------- */

def('sw.js: uses a v6 cache name', async () => {
  const text = await getText('sw.js');
  ok(/const\s+VERSION\s*=\s*'v6'/.test(text), 'VERSION must be v6');
  ok(text.includes("'nasur-' + VERSION"), 'cache name must be nasur-<version>');
});

def('sw.js: precache lists every Phase 1-6 file', async () => {
  const text = await getText('sw.js');
  const missing = ALL_ASSETS.filter((p) => !text.includes("'" + p + "'"));
  ok(missing.length === 0, 'sw.js missing: ' + missing.join(', '));
});

def('sw.js: install, activate and fetch handlers present', async () => {
  const text = await getText('sw.js');
  ok(text.includes("addEventListener('install'"), 'install handler');
  ok(text.includes("addEventListener('activate'"), 'activate handler');
  ok(text.includes("addEventListener('fetch'"), 'fetch handler');
  ok(text.includes('skipWaiting'), 'skipWaiting');
  ok(text.includes('clients.claim'), 'clients.claim');
});

def('sw.js: every precached asset is reachable', async () => {
  const missing = [];
  for (const path of ALL_ASSETS) {
    const res = await fetch(urlOf(path), { cache: 'no-store' });
    if (!res.ok) missing.push(path);
  }
  ok(missing.length === 0, 'unreachable assets: ' + missing.join(', '));
});

/* ---------- js/core/router.js ---------- */

def('router: exports every required function', async () => {
  const R = await loadRouter();
  const missing = ROUTER_EXPORTS.filter((n) => !(n in R));
  ok(missing.length === 0, 'router missing exports: ' + missing.join(', '));
  eq(R.DEFAULT_ROUTE, '/home', 'DEFAULT_ROUTE');
  for (const name of ROUTER_EXPORTS) {
    if (name !== 'DEFAULT_ROUTE') ok(typeof R[name] === 'function', name + ' must be a function');
  }
});

def('router: FILE_PATTERN accepts underscores and hyphens', async () => {
  const R = await loadRouter();
  const P = R.FILE_PATTERN;
  ok(P instanceof RegExp, 'FILE_PATTERN must be exported');
  ok(P.test('js/modules/rca_coach.js'), 'underscore name');
  ok(P.test('js/modules/history_search.js'), 'underscore name 2');
  ok(P.test('js/modules/home.js'), 'plain name');
  ok(P.test('js/modules/fire-safety.js'), 'hyphen name');
  ok(!P.test('js/modules/../evil.js'), 'must reject traversal');
  ok(!P.test('js/modules/Bad.js'), 'must reject uppercase');
  ok(!P.test('js/other/home.js'), 'must reject other folders');
});

def('router: validateRegistry accepts the real registry and rejects bad ones', async () => {
  const R = await loadRouter();
  const reg = await getJson('data/modules.json');
  const good = R.validateRegistry(reg);
  ok(good.valid === true, 'real registry invalid: ' + (good.errors || []).join('; '));
  const bad1 = R.validateRegistry({ modules: [{ id: 'Bad-Id', route: 'nope', file: 'x.js' }] });
  ok(bad1.valid === false && bad1.errors.length > 0, 'bad registry must be invalid');
  const bad2 = R.validateRegistry(null);
  ok(bad2.valid === false, 'null registry must be invalid');
  const dup = JSON.parse(JSON.stringify(reg));
  dup.modules.push(JSON.parse(JSON.stringify(dup.modules[0])));
  ok(R.validateRegistry(dup).valid === false, 'duplicates must be invalid');
});

def('router: registry lookups', async () => {
  const R = await loadRouter();
  const reg = await getJson('data/modules.json');
  await withRegistry(R, () => {
    R.setModuleRegistry(reg);
    eq(R.getModules().length, 20, 'getModules length');
    eq(R.getModule('rca_coach').route, '/rca-coach', 'getModule');
    eq(R.getModuleByRoute('/history-search').id, 'history_search', 'getModuleByRoute');
    eq(R.getModuleByRoute('#/ptw-jsa?x=1').id, 'ptw_jsa', 'getModuleByRoute with hash and query');
    eq(R.getModule('does_not_exist'), null, 'unknown id');
    ok(R.isModuleOpenable('home'), 'home openable');
    ok(R.isModuleOpenable('more'), 'more openable');
    ok(!R.isModuleOpenable('does_not_exist'), 'unknown not openable');
    ok(R.getRegistry() && Array.isArray(R.getRegistry().modules), 'getRegistry');
    R.clearModuleRegistry();
    eq(R.getModules().length, 0, 'cleared registry');
  });
});

def('router: parseHash, routePath and hrefFor', async () => {
  const R = await loadRouter();
  const reg = await getJson('data/modules.json');
  await withRegistry(R, () => {
    R.setModuleRegistry(reg);
    const p = R.parseHash('#/history-search?q=fire&x=1');
    eq(p.path, '/history-search', 'parseHash path');
    eq(p.query.q, 'fire', 'parseHash query q');
    eq(p.query.x, '1', 'parseHash query x');
    eq(R.parseHash('').path, '/home', 'empty hash goes home');
    eq(R.parseHash('#/').path, '/home', 'root hash goes home');
    eq(R.parseHash('#/fire-safety/').path, '/fire-safety', 'trailing slash trimmed');
    eq(R.routePath('rca_coach'), '/rca-coach', 'routePath by id');
    eq(R.hrefFor('rca_coach'), '#/rca-coach', 'hrefFor by id');
    eq(R.hrefFor('/audits'), '#/audits', 'hrefFor by route');
    eq(R.hrefFor('observations', { id: 'OBS-1' }), '#/observations?id=OBS-1', 'hrefFor with query');
  });
});

def('router: nav items, groups and PDCA lookups', async () => {
  const R = await loadRouter();
  const reg = await getJson('data/modules.json');
  await withRegistry(R, () => {
    R.setModuleRegistry(reg);
    const nav = R.getNavItems();
    ok(nav.length > 0, 'nav items exist');
    ok(nav.every((n) => n.href && n.href.startsWith('#/')), 'nav hrefs');
    ok(nav.some((n) => n.id === 'home'), 'home in nav');
    const exec = R.getModulesByGroup('execution').map((m) => m.id).sort();
    eq(exec.join(','), 'audits,doc_control,emergency,ptw_jsa', 'execution group');
    const check = R.getModulesByPdca('check').map((m) => m.id);
    ok(check.includes('audits'), 'audits in check stage');
  });
});

def('router: mountModuleView supports render(ctx), render(el, ctx) and mount(el, ctx)', async () => {
  const R = await loadRouter();
  ok(typeof R.mountModuleView === 'function', 'mountModuleView export');

  const make = () => {
    const el = document.createElement('div');
    return { el, ctx: { root: el } };
  };

  let t = make();
  await R.mountModuleView({ render(ctx) { ctx.root.replaceChildren(document.createTextNode('ctx-style')); } }, t.el, t.ctx);
  eq(t.el.textContent, 'ctx-style', 'render(ctx)');

  t = make();
  await R.mountModuleView({ render({ root }) { root.textContent = 'destructured'; } }, t.el, t.ctx);
  eq(t.el.textContent, 'destructured', 'render({root})');

  t = make();
  await R.mountModuleView({ render(el, ctx) { el.replaceChildren(document.createTextNode('el-style')); } }, t.el, t.ctx);
  eq(t.el.textContent, 'el-style', 'render(el, ctx)');

  t = make();
  await R.mountModuleView({ render(el, ctx = {}) { el.replaceChildren(document.createTextNode('el-default')); } }, t.el, t.ctx);
  eq(t.el.textContent, 'el-default', 'render(el, ctx = {})');

  t = make();
  await R.mountModuleView({ mount(el, ctx) { el.replaceChildren(document.createTextNode('mount-style')); } }, t.el, t.ctx);
  eq(t.el.textContent, 'mount-style', 'mount(el, ctx)');

  t = make();
  await R.mountModuleView({ render(x) { x.replaceChildren(document.createTextNode('ambiguous')); } }, t.el, t.ctx);
  eq(t.el.textContent, 'ambiguous', 'ambiguous first param falls back correctly');

  t = make();
  let cleaned = false;
  const view = await R.mountModuleView({ mount(el) { el.textContent = 'x'; return () => { cleaned = true; }; } }, t.el, t.ctx);
  ok(view && typeof view.cleanup === 'function', 'view cleanup function');
  await view.cleanup();
  ok(cleaned, 'cleanup callback runs');

  let threw = false;
  try {
    await R.mountModuleView({}, make().el, {});
  } catch (e) {
    threw = true;
  }
  ok(threw, 'module with no entry point must throw');
});

def('router: no router running by default', async () => {
  const R = await loadRouter();
  eq(R.isRouterRunning(), false, 'isRouterRunning');
  eq(R.getCurrentRoute(), null, 'getCurrentRoute');
  eq(R.getCurrentView(), null, 'getCurrentView');
});

/* ---------- Every module loads with the right entry point ---------- */

def('modules: every module file imports and exports mount() or render()', async () => {
  const problems = [];
  for (const file of MODULE_FILES) {
    try {
      const mod = await import(urlOf(file));
      const hasEntry =
        typeof mod.mount === 'function' ||
        typeof mod.render === 'function' ||
        (mod.default && (typeof mod.default === 'function' || typeof mod.default.mount === 'function' || typeof mod.default.render === 'function'));
      if (!hasEntry) problems.push(file + ' (no mount/render export)');
    } catch (e) {
      problems.push(file + ' (' + (e && e.message ? e.message : e) + ')');
    }
  }
  ok(problems.length === 0, 'module problems: ' + problems.join(' | '));
});

/* ---------- Phase 6 services and data ---------- */

def('phase 6 services import and expose functions', async () => {
  const files = [
    'js/services/opsstore.js', 'js/services/risk.js', 'js/services/permits.js',
    'js/services/emergency.js', 'js/services/doc_control.js', 'js/services/audits.js'
  ];
  const problems = [];
  for (const file of files) {
    try {
      const mod = await import(urlOf(file));
      const fnCount = Object.values(mod).filter((v) => typeof v === 'function').length;
      if (fnCount === 0) problems.push(file + ' (no exported functions)');
    } catch (e) {
      problems.push(file + ' (' + (e && e.message ? e.message : e) + ')');
    }
  }
  ok(problems.length === 0, 'service problems: ' + problems.join(' | '));
});

def('phase 6 data files are valid, non-empty JSON', async () => {
  const files = [
    'data/ptw/permit_types.json', 'data/ptw/risk_library.json', 'data/emergency.json',
    'data/doc_control.json', 'data/legal_register.json', 'data/audits.json'
  ];
  for (const file of files) {
    const data = await getJson(file);
    const size = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
    ok(size > 0, file + ' is empty');
  }
});

/* ---------- Runner ---------- */

export async function run() {
  const lines = [];
  let passed = 0;
  let failed = 0;
  for (const t of localTests) {
    try {
      await t.fn();
      passed += 1;
      lines.push('PASS  ' + t.name);
    } catch (e) {
      failed += 1;
      lines.push('FAIL  ' + t.name + '\n      ' + (e && e.message ? e.message : e));
    }
  }
  lines.push('');
  lines.push('Phase 6 tests: ' + passed + ' passed, ' + failed + ' failed');
  const report = lines.join('\n');
  console.log(report);
  if (typeof document !== 'undefined') {
    const host =
      document.getElementById('results') ||
      document.getElementById('output') ||
      document.getElementById('log');
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = report;
    (host || document.body).appendChild(pre);
  }
  return { passed, failed, report };
}

export default run;

if (!harnessRegister) {
  await run();
}