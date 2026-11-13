/**
 * NASUR – Phase 1 tests: constants, event bus, sanitizing, database,
 * repository, user settings, theme, module list and router.
 * File: tests/phase1.test.js
 * Loaded by tests/runner.html, which passes in the harness (tests/harness.js).
 */
export default function definePhase1(H) {
  const { suite, skip, sleep, assert, eq, deepEq, show, expectError, captureConsole, fetchJson, ROOT, TEST_DB, resetDb, recordEvents, M } = H;
  const { cfg, ev, router, san, db, repo, ucfg } = M;
  const S = cfg.STORES;
  const P = cfg.DEFAULTS.PROJECT_ID;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const byTag = (tag) => (record) => record.tag === tag;

  /* ---------------- config.js ---------------- */
  suite('App constants (js/core/config.js)', ({ test }) => {
    test('identity, database version and 51 unique stores', () => {
      eq(cfg.APP.NAME, 'NASUR');
      eq(cfg.APP.ASSISTANT_NAME, 'JARVIS');
      eq(cfg.DB.NAME, 'nasur-db');
      assert(Number.isInteger(cfg.DB.VERSION) && cfg.DB.VERSION >= 1, 'DB.VERSION must be a whole number.');
      eq(cfg.BACKUP.SCHEMA_VERSION, cfg.DB.VERSION);
      if (cfg.DB.VERSION === 1) { eq(cfg.STORE_NAMES.length, 51, 'store count'); }
      eq(new Set(cfg.STORE_NAMES).size, cfg.STORE_NAMES.length, 'unique names');
      for (const name of cfg.STORE_NAMES) {
        assert(/^[a-z][a-z0-9_]*$/.test(name), 'Bad store name ' + name);
        eq(S[name.toUpperCase()], name);
      }
      eq(Object.keys(S).length, cfg.STORE_NAMES.length);
    });
    test('every store definition is complete', () => {
      const owners = Object.values(cfg.OWNER_SCOPE);
      const stages = Object.values(cfg.PDCA_STAGE);
      for (const def of cfg.STORE_DEFS) {
        eq(def.keyPath, 'id', def.name + ' keyPath');
        assert(owners.includes(def.owner), def.name + ' owner');
        assert(def.pdca === null || stages.includes(def.pdca), def.name + ' pdca');
        const names = def.indexes.map((index) => index.name);
        assert(names.includes('updated_at'), def.name + ' needs an updated_at index');
        if (def.scope === cfg.SCOPE.PROJECT) { assert(names.includes('project_id'), def.name + ' needs a project_id index'); }
      }
    });
    test('project scoping helpers and unknown stores', async () => {
      eq(cfg.isProjectScoped('observations'), true);
      eq(cfg.isProjectScoped('actions'), true);
      eq(cfg.isProjectScoped('settings'), false);
      eq(cfg.isProjectScoped('lessons'), false);
      eq(cfg.isStoreName('nope'), false);
      await expectError(() => cfg.getStoreDef('nope'), Error);
    });
    test('constants are frozen, events and storage keys are unique and namespaced', async () => {
      await expectError(() => { cfg.APP.VERSION = '9'; }, TypeError);
      await expectError(() => { cfg.STORE_NAMES.push('x'); }, TypeError);
      const events = Object.values(cfg.EVENTS);
      eq(new Set(events).size, events.length, 'event names');
      const keys = Object.values(cfg.LS_KEYS);
      eq(new Set(keys).size, keys.length, 'localStorage keys');
      for (const key of keys) { assert(key.startsWith('nasur.'), key + ' must start with nasur.'); }
      deepEq(Object.values(cfg.PDCA_STAGE).sort(), ['act', 'check', 'do', 'improve', 'plan']);
    });
  });

  /* ---------------- eventbus.js ---------------- */
  suite('Event bus (js/core/eventbus.js)', ({ test }) => {
    const { createEventBus } = ev;
    test('subscribe, unsubscribe, once and off', () => {
      const bus = createEventBus();
      const seen = [];
      const stop = bus.on('x', (payload, name) => { seen.push([payload, name]); });
      eq(bus.emit('x', 1), 1);
      stop();
      eq(bus.emit('x', 2), 0);
      deepEq(seen, [[1, 'x']]);
      let once = 0;
      bus.once('y', () => { once += 1; });
      bus.emit('y');
      bus.emit('y');
      eq(once, 1);
      const handler = () => {};
      bus.on('z', handler);
      bus.off('z', handler);
      eq(bus.emit('z'), 0);
    });
    test('wildcard receives every event; direct handlers run first', () => {
      const bus = createEventBus();
      const order = [];
      bus.on('*', (payload, name) => { order.push('wild:' + name); });
      bus.on('k', () => { order.push('direct'); });
      bus.emit('k');
      bus.emit('other');
      deepEq(order, ['direct', 'wild:k', 'wild:other']);
      eq(ev.WILDCARD, '*');
    });
    test('failing handlers (sync and async) never stop the others', async () => {
      const cap = captureConsole();
      try {
        const bus = createEventBus();
        const seen = [];
        bus.on('e', () => { throw new Error('boom'); });
        bus.on('e', () => { seen.push('second'); });
        bus.on('a', () => Promise.reject(new Error('late')));
        eq(bus.emit('e'), 2);
        deepEq(seen, ['second']);
        bus.emit('a');
        await sleep(20);
        eq(cap.errors.length, 2, 'reported errors');
      } finally { cap.restore(); }
    });
    test('handlers added during an emit wait for the next emit; count and clear', () => {
      const bus = createEventBus();
      let late = 0;
      bus.on('s', () => { bus.on('s', () => { late += 1; }); });
      bus.emit('s');
      eq(late, 0);
      bus.emit('s');
      eq(late, 1);
      eq(bus.listenerCount('s'), 3);
      bus.clear('s');
      eq(bus.listenerCount('s'), 0);
    });
    test('bad input is rejected and the shared bus is exported', async () => {
      const bus = createEventBus();
      await expectError(() => bus.emit('*'), TypeError);
      await expectError(() => bus.emit(''), TypeError);
      await expectError(() => bus.on('x', 5), TypeError);
      for (const name of ['bus', 'on', 'once', 'off', 'emit', 'listenerCount', 'clear']) { assert(name in ev, name + ' must be exported'); }
    });
  });

  /* ---------------- sanitize.js ---------------- */
  suite('Sanitizing and safe output (js/services/sanitize.js)', ({ test }) => {
    test('cleanText: basics, control characters, multiline, scripts', () => {
      eq(san.cleanText(null), '');
      eq(san.cleanText({ a: 1 }), '');
      eq(san.cleanText(123), '123');
      eq(san.cleanText(NaN), '');
      eq(san.cleanText('  a \t b\n c  '), 'a b c');
      eq(san.cleanText('\u0000\u0007x\u007F'), 'x');
      eq(san.cleanText('a\u200Bb\u202Ec'), 'abc');
      eq(san.cleanText('a\u200Db'), 'a\u200Db', 'zero-width joiner is kept');
      eq(san.cleanText('e\u0301'), '\u00e9');
      eq(san.cleanText('Line1\r\nLine2\rLine3', { multiline: true }), 'Line1\nLine2\nLine3');
      eq(san.cleanText('temp < 5 and pressure > 2'), 'temp < 5 and pressure > 2');
      for (const word of ['பாதுகாப்பு', 'सुरक्षा', 'سلامة']) { eq(san.cleanText(word), word); }
    });
    test('length helpers and local digits', async () => {
      eq(san.isWithinLength('abc', 3), true);
      eq(san.isWithinLength('abcd', 3), false);
      eq(san.truncateText('ab\u{1F600}', 3), 'ab', 'must not cut an emoji in half');
      await expectError(() => san.truncateText('abc', -1), RangeError);
      eq(san.toAsciiDigits('\u0660\u0661\u0662'), '012');
      eq(san.toAsciiDigits('\u0966\u0967'), '01');
      eq(san.toAsciiDigits('\u0be7\u0be8\u0be9'), '123');
    });
    test('escapeHtml, html template, raw and renderHtml', async () => {
      eq(san.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
      eq(san.escapeHtml('"\'&`'), '&quot;&#39;&amp;&#96;');
      eq(san.escapeRegExp('a.b*c'), 'a\\.b\\*c');
      eq(san.html`<p>${'<b>'}</p>`.toString(), '<p>&lt;b&gt;</p>');
      eq(san.html`<a title="${'" onclick="x'}">`.toString(), '<a title="&quot; onclick=&quot;x">');
      eq(san.html`${null}${undefined}${false}${{ a: 1 }}`.toString(), '');
      const items = ['a', '<b>'].map((value) => san.html`<li>${value}</li>`);
      eq(san.html`<ul>${items}</ul>`.toString(), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
      eq(san.isSafeHtml(san.html`x`), true);
      eq(san.isSafeHtml('x'), false);
      await expectError(() => san.raw(5), TypeError);
      const box = document.createElement('div');
      san.renderHtml(box, san.html`<span>${'<i>'}</span>`);
      eq(box.querySelector('i'), null);
      eq(box.textContent, '<i>');
      await expectError(() => san.renderHtml(box, '<b>x</b>'), TypeError);
    });
    test('safeUrl, telHref, safeFilename, isSafeId and maskSecret', () => {
      eq(san.safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
      eq(san.safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
      for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'ftp://x.com', 'java\tscript:alert(1)', '', null]) { eq(san.safeUrl(bad), '', 'rejects ' + show(bad)); }
      eq(san.safeUrl('/x'), '');
      eq(san.safeUrl('/x', { allowRelative: true }), '/x');
      eq(san.safeUrl('//evil.com', { allowRelative: true }), '');
      eq(san.telHref('+971 50 123 4567'), 'tel:+971501234567');
      eq(san.telHref('\u0660\u0664\u0664 2345 6789'), 'tel:04423456789');
      eq(san.telHref('12'), '');
      eq(san.safeFilename('Report: Q1/2026?.pdf'), 'Report_Q1_2026_.pdf');
      eq(san.safeFilename('...', 'export'), 'export');
      eq(san.safeFilename('CON'), '_CON');
      eq(san.isSafeId('abc-123_X'), true);
      for (const bad of ['a b', '', 'a'.repeat(65), 123, null, 'x/y']) { eq(san.isSafeId(bad), false, show(bad)); }
      eq(san.maskSecret('sk-1234567890abcd'), '••••abcd');
      eq(san.maskSecret('abc'), '••••');
    });
    test('sanitizeDeep cleans text, drops unsafe keys and rejects deep data', async () => {
      eq(san.sanitizeDeep('  a\n '), '  a\n ');
      eq(san.sanitizeDeep('b\u0000c'), 'bc');
      deepEq(san.sanitizeDeep({ a: NaN, b: () => 1, c: undefined, d: [1, undefined, NaN], e: Infinity }), { a: null, d: [1, null, null], e: null });
      const clean = san.sanitizeDeep(JSON.parse('{"__proto__":{"polluted":true},"n":{"constructor":{"y":1},"ok":1}}'));
      eq(Object.prototype.hasOwnProperty.call(clean, '__proto__'), false);
      eq(Object.prototype.hasOwnProperty.call(clean.n, 'constructor'), false);
      eq(clean.n.ok, 1);
      eq(({}).polluted, undefined);
      const date = new Date('2026-02-28T10:00:00Z');
      eq(san.sanitizeDeep({ d: date }).d, date);
      let deep = {};
      const top = deep;
      for (let level = 0; level < 30; level += 1) { deep.n = {}; deep = deep.n; }
      await expectError(() => san.sanitizeDeep(top), RangeError);
      const loop = {};
      loop.self = loop;
      await expectError(() => san.sanitizeDeep(loop), RangeError);
    });
    test('CSV safety: neutralizeFormula and toCsvCell', () => {
      eq(san.neutralizeFormula('=SUM(A1)'), "'=SUM(A1)");
      eq(san.neutralizeFormula('-5 notes'), "'-5 notes");
      eq(san.neutralizeFormula(-5), -5);
      eq(san.toCsvCell('a,b'), '"a,b"');
      eq(san.toCsvCell('say "hi"'), '"say ""hi"""');
      eq(san.toCsvCell(null), '');
      eq(san.toCsvCell(-5), '-5');
      eq(san.toCsvCell(['a', 'b']), 'a; b');
      eq(san.toCsvCell('=1+1'), "'=1+1");
      eq(san.toCsvCell('=SUM(A1,B1)'), '"\'=SUM(A1,B1)"');
      eq(san.toCsvCell(new Date('2026-02-28T10:00:00Z')), '2026-02-28T10:00:00.000Z');
      eq(san.toCsvCell({ a: 1 }), '"{""a"":1}"');
    });
  });

  /* ---------------- db.js ---------------- */
  suite('Database layer (js/services/db.js)', ({ test, before }) => {
    before(async () => {
      db.setDatabaseName(TEST_DB);
      await resetDb();
    });
    test('scratch database is used; every store and index matches config.js', async () => {
      eq(db.isSupported(), true, 'IndexedDB support');
      assert(TEST_DB !== cfg.DB.NAME, 'The tests must never use the real database.');
      const info = await db.getDbInfo();
      eq(info.name, TEST_DB);
      eq(info.version, cfg.DB.VERSION);
      deepEq(info.stores, cfg.STORE_NAMES.slice().sort());
      await db.runTransaction(cfg.STORE_NAMES.slice(), 'readonly', async (tx) => {
        for (const def of cfg.STORE_DEFS) {
          const store = tx.objectStore(def.name);
          deepEq(Array.from(store.indexNames).sort(), def.indexes.map((index) => index.name).sort(), def.name + ' index names');
          for (const spec of def.indexes) {
            const index = store.index(spec.name);
            deepEq(index.keyPath, spec.keyPath, def.name + '.' + spec.name);
            eq(index.multiEntry, spec.multiEntry, def.name + '.' + spec.name + ' multiEntry');
          }
        }
      });
    });
    test('put, get, add and replace', async () => {
      eq(await db.put(S.SETTINGS, { id: 'k1', value: { a: 1 } }), 'k1');
      deepEq(await db.get(S.SETTINGS, 'k1'), { id: 'k1', value: { a: 1 } });
      eq(await db.get(S.SETTINGS, 'missing'), null);
      await db.put(S.SETTINGS, { id: 'k2', value: 1 });
      await db.put(S.SETTINGS, { id: 'k2', value: 2 });
      eq((await db.get(S.SETTINGS, 'k2')).value, 2);
      await expectError(() => db.add(S.SETTINGS, { id: 'k2', value: 3 }), 'exists');
      eq((await db.get(S.SETTINGS, 'k2')).value, 2, 'value must be unchanged');
    });
    test('bad input gives readable error codes', async () => {
      await expectError(() => db.put(S.SETTINGS, { value: 1 }), 'invalid_record');
      await expectError(() => db.put('nope', { id: 'x' }), 'invalid_store');
      await expectError(() => db.get(S.SETTINGS, ''), 'invalid_query');
      await expectError(() => db.getAllByIndex(S.OBSERVATIONS, 'nope'), 'invalid_index');
      await expectError(() => db.getAllByIndex(S.OBSERVATIONS, 'status', null, 0), 'invalid_query');
      await expectError(() => db.query(S.OBSERVATIONS, { direction: 'sideways' }), 'invalid_query');
      await expectError(() => db.runTransaction([], 'readonly', () => {}), 'invalid_store');
      await expectError(() => db.runTransaction([S.SETTINGS], 'sideways', () => {}), 'invalid_query');
      await expectError(() => db.setDatabaseName('bad name!'), 'invalid_query');
      await expectError(() => db.keyRange.bound(5, 1), 'invalid_range');
    });
    test('index queries: ranges, prefix, order, limit and offset', async () => {
      await db.putMany(S.OBSERVATIONS, [
        { id: 'o1', project_id: 'p1', date: '2026-02-01', status: 'OPEN', obs_number: 'OBS-001' },
        { id: 'o2', project_id: 'p1', date: '2026-02-15', status: 'OPEN', obs_number: 'OBS-002' },
        { id: 'o3', project_id: 'p1', date: '2026-03-01', status: 'CLOSED', obs_number: 'XYZ-1' },
        { id: 'o4', project_id: 'p2', date: '2026-02-10', status: 'OPEN' }
      ]);
      const ids = (rows) => rows.map((row) => row.id);
      deepEq(ids(await db.getAllByIndex(S.OBSERVATIONS, 'project_date', db.keyRange.bound(['p1', '2026-02-01'], ['p1', '2026-02-28']))), ['o1', 'o2']);
      deepEq(ids(await db.getAllByIndex(S.OBSERVATIONS, 'obs_number', db.keyRange.prefix('OBS-'))), ['o1', 'o2']);
      eq((await db.getAllByIndex(S.OBSERVATIONS, 'status', db.keyRange.only('OPEN'))).length, 3);
      deepEq(ids(await db.query(S.OBSERVATIONS, { index: 'date', direction: 'prev', limit: 2 })), ['o3', 'o2']);
      deepEq(ids(await db.query(S.OBSERVATIONS, { index: 'date', direction: 'prev', limit: 2, offset: 1 })), ['o2', 'o4']);
      eq(await db.count(S.OBSERVATIONS), 4);
      eq(await db.countByIndex(S.OBSERVATIONS, 'project_id', db.keyRange.only('p1')), 3);
    });
    test('putMany, deleteMany, clearStore and all-or-nothing writes', async () => {
      eq(await db.putMany(S.SETTINGS, [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]), 3);
      await db.deleteRecord(S.SETTINGS, 'm1');
      eq(await db.deleteMany(S.SETTINGS, ['m2', 'm3']), 2);
      eq(await db.get(S.SETTINGS, 'm2'), null);
      await db.putMany(S.LESSONS, [{ id: 'l1' }, { id: 'l2' }]);
      await db.clearStore(S.LESSONS);
      eq(await db.count(S.LESSONS), 0);
      await expectError(() => db.putMany(S.SETTINGS, [{ id: 'ok1' }, { value: 1 }]), 'invalid_record');
      eq(await db.get(S.SETTINGS, 'ok1'), null);
      const error = await expectError(() => db.runTransaction([S.SETTINGS], 'readwrite', async (tx) => {
        await db.requestToPromise(tx.objectStore(S.SETTINGS).put({ id: 'rb1', value: 1 }));
        throw new Error('boom');
      }), Error);
      eq(error.message, 'boom');
      eq(await db.get(S.SETTINGS, 'rb1'), null, 'rolled back record');
    });
    test('data survives reopening; exportAll, clearAll and wipeDatabase', async () => {
      await db.put(S.SETTINGS, { id: 'persist', value: 'still here' });
      db.closeDb();
      eq((await db.get(S.SETTINGS, 'persist')).value, 'still here');
      const snapshot = await db.exportAll();
      deepEq(Object.keys(snapshot).sort(), cfg.STORE_NAMES.slice().sort());
      assert(snapshot.settings.some((record) => record.id === 'persist'), 'The saved record is missing from the export.');
      await db.clearAll();
      eq(await db.count(S.SETTINGS), 0);
      await db.put(S.SETTINGS, { id: 'gone', value: 1 });
      await db.wipeDatabase();
      eq((await db.getDbInfo()).stores.length, cfg.STORE_NAMES.length);
      eq(await db.count(S.SETTINGS), 0);
      const estimate = await db.getStorageEstimate();
      eq(typeof estimate.supported, 'boolean');
    });
  });

  /* ---------------- repo.js ---------------- */
  suite('Repository: first launch and projects', ({ test, before }) => {
    before(resetDb);
    test('creates the default personal project on first launch', async () => {
      const first = await repo.initRepo();
      eq(first.projectId, P);
      eq(first.createdDefault, true);
      eq(repo.getActiveProjectId(), P);
      const project = await repo.get(S.PROJECTS, P);
      eq(project.name, cfg.DEFAULTS.PROJECT_NAME);
      eq(project.owner_scope, 'personal');
      eq(project.project_id, null);
      eq(await repo.getSetting(cfg.SETTINGS_KEYS.ACTIVE_PROJECT), P);
      eq((await repo.initRepo()).createdDefault, false);
      eq((await repo.list(S.PROJECTS)).length, 1);
    });
    test('restores the active project, or falls back when it was deleted', async () => {
      const other = await repo.create(S.PROJECTS, { name: 'Site B', status: 'active' });
      await repo.setActiveProject(other.id);
      repo.resetRepoState();
      eq((await repo.initRepo()).projectId, other.id);
      await repo.remove(S.PROJECTS, other.id);
      repo.resetRepoState();
      const result = await repo.initRepo();
      assert(result.projectId !== other.id, 'Must not pick the deleted project.');
      const project = await repo.get(S.PROJECTS, result.projectId);
      assert(project && !project.deleted_at, 'The chosen project must exist and not be deleted.');
    });
  });

  suite('Repository: records, rules and events', ({ test, before }) => {
    before(async () => {
      await resetDb();
      await repo.initRepo();
    });
    test('ids and device id', () => {
      assert(UUID.test(repo.newId()), 'newId must be a version 4 UUID.');
      assert(repo.newId() !== repo.newId(), 'ids must differ.');
      assert(/^dev_[0-9a-f]{12}$/.test(repo.getDeviceId()), 'Device id has the wrong format.');
      eq(repo.getDeviceId(), repo.getDeviceId());
    });
    test('create fills common fields; managed fields and bad input are refused', async () => {
      const record = await repo.create(S.OBSERVATIONS, { description: 'Test', date: '2026-02-28', rev: 99, created_at: '2000-01-01', deleted_at: '2000-01-01', device_id: 'evil' });
      assert(UUID.test(record.id), 'id');
      eq(record.project_id, P);
      eq(record.rev, 1);
      eq(record.deleted_at, null);
      assert(record.created_at !== '2000-01-01' && !Number.isNaN(Date.parse(record.created_at)), 'created_at is set by the repository');
      eq(record.created_at, record.updated_at);
      eq(record.device_id, repo.getDeviceId());
      eq(record.owner_scope, 'employer');
      eq(record.pdca_stage, 'do');
      deepEq(await repo.get(S.OBSERVATIONS, record.id), record);
      eq((await repo.create(S.OBSERVATIONS, { id: 'obs_fixed_1' })).id, 'obs_fixed_1');
      await expectError(() => repo.create(S.OBSERVATIONS, { id: 'obs_fixed_1' }), 'exists');
      await expectError(() => repo.create(S.OBSERVATIONS, { id: 'bad id!' }), 'invalid_data');
      await expectError(() => repo.create(S.OBSERVATIONS, 'text'), 'invalid_data');
      await expectError(() => repo.create(S.OBSERVATIONS, []), 'invalid_data');
      await expectError(() => repo.create('nope', {}), 'invalid_store');
      await expectError(() => repo.create(S.OBSERVATIONS, { owner_scope: 'bogus' }), 'invalid_data');
      await expectError(() => repo.create(S.OBSERVATIONS, { pdca_stage: 'x' }), 'invalid_data');
      eq((await repo.create(S.OBSERVATIONS, { pdca_stage: null })).pdca_stage, null);
    });
    test('records are cleaned when saved', async () => {
      const record = await repo.create(S.OBSERVATIONS, JSON.parse('{"__proto__":{"polluted":true},"description":"a\\u0000b","nested":{"constructor":{"x":1},"ok":1}}'));
      eq(record.description, 'ab');
      eq(Object.prototype.hasOwnProperty.call(record, '__proto__'), false);
      eq(Object.prototype.hasOwnProperty.call(record.nested, 'constructor'), false);
      eq(({}).polluted, undefined);
    });
    test('update merges; expectedRev detects conflicts; simultaneous updates are kept', async () => {
      const created = await repo.create(S.OBSERVATIONS, { description: 'keep me', status: 'OPEN' });
      const updated = await repo.update(S.OBSERVATIONS, created.id, { status: 'IN PROGRESS' });
      eq(updated.rev, 2);
      eq(updated.description, 'keep me');
      eq(updated.created_at, created.created_at);
      const cleared = await repo.update(S.OBSERVATIONS, created.id, { description: null, location: 'Gate 1', status: undefined });
      eq(cleared.description, null);
      eq(cleared.status, 'IN PROGRESS', 'undefined values are ignored');
      await expectError(() => repo.update(S.OBSERVATIONS, created.id, { status: 'CLOSED' }, { expectedRev: 1 }), 'conflict');
      await expectError(() => repo.save(S.OBSERVATIONS, { id: created.id, status: 'CLOSED' }, { expectedRev: 1 }), 'conflict');
      eq((await repo.update(S.OBSERVATIONS, created.id, { status: 'CLOSED' }, { expectedRev: 3 })).rev, 4);
      const second = await repo.create(S.OBSERVATIONS, { status: 'OPEN' });
      await Promise.all([repo.update(S.OBSERVATIONS, second.id, { fieldA: 1 }), repo.update(S.OBSERVATIONS, second.id, { fieldB: 2 })]);
      const final = await repo.get(S.OBSERVATIONS, second.id);
      eq(final.fieldA, 1);
      eq(final.fieldB, 2);
      eq(final.rev, 3);
    });
    test('save replaces a record, or creates it when the id is new', async () => {
      const created = await repo.create(S.OBSERVATIONS, { description: 'old', status: 'OPEN', date: '2026-01-01' });
      const replaced = await repo.save(S.OBSERVATIONS, { id: created.id, status: 'CLOSED' });
      eq('description' in replaced, false, 'fields left out are removed');
      eq(replaced.rev, 2);
      eq(replaced.created_at, created.created_at);
      eq((await repo.save(S.OBSERVATIONS, { id: 'obs_save_new', status: 'OPEN' })).rev, 1);
      eq((await repo.save(S.OBSERVATIONS, { status: 'OPEN' })).rev, 1);
    });
    test('soft delete, restore and purge', async () => {
      const created = await repo.create(S.OBSERVATIONS, { tag: 'soft', description: 'x' });
      const removed = await repo.remove(S.OBSERVATIONS, created.id);
      assert(removed.deleted_at, 'deleted_at must be set');
      eq(removed.rev, 2);
      eq(await repo.get(S.OBSERVATIONS, created.id), null);
      eq((await repo.get(S.OBSERVATIONS, created.id, { includeDeleted: true })).id, created.id);
      eq((await repo.list(S.OBSERVATIONS, { filter: byTag('soft') })).length, 0);
      eq((await repo.list(S.OBSERVATIONS, { filter: byTag('soft'), includeDeleted: true })).length, 1);
      eq((await repo.remove(S.OBSERVATIONS, created.id)).rev, 2, 'deleting twice changes nothing');
      await expectError(() => repo.update(S.OBSERVATIONS, created.id, { x: 1 }), 'not_found');
      const restored = await repo.restore(S.OBSERVATIONS, created.id);
      eq(restored.deleted_at, null);
      eq(restored.rev, 3);
      eq((await repo.restore(S.OBSERVATIONS, created.id)).rev, 3, 'restoring twice changes nothing');
      eq(await repo.purge(S.OBSERVATIONS, created.id), true);
      eq(await repo.get(S.OBSERVATIONS, created.id, { includeDeleted: true }), null);
      await expectError(() => repo.purge(S.OBSERVATIONS, created.id), 'not_found');
    });
    test('records stay inside their own project; project errors are clear', async () => {
      const other = await repo.create(S.PROJECTS, { name: 'Iso B', status: 'active' });
      const mine = await repo.create(S.OBSERVATIONS, { tag: 'iso', description: 'default project' });
      const theirs = await repo.create(S.OBSERVATIONS, { tag: 'iso', description: 'project B' }, { projectId: other.id });
      eq(theirs.project_id, other.id);
      eq(await repo.get(S.OBSERVATIONS, theirs.id), null);
      await expectError(() => repo.update(S.OBSERVATIONS, theirs.id, { description: 'hack' }), 'not_found');
      await expectError(() => repo.remove(S.OBSERVATIONS, theirs.id), 'not_found');
      await expectError(() => repo.purge(S.OBSERVATIONS, theirs.id), 'not_found');
      deepEq((await repo.list(S.OBSERVATIONS, { filter: byTag('iso') })).map((r) => r.id), [mine.id]);
      deepEq((await repo.list(S.OBSERVATIONS, { filter: byTag('iso'), projectId: other.id })).map((r) => r.id), [theirs.id]);
      eq((await repo.list(S.OBSERVATIONS, { filter: byTag('iso'), allProjects: true })).length, 2);
      const watcher = recordEvents();
      try {
        await repo.setActiveProject(other.id);
        const change = watcher.events.find((item) => item.name === cfg.EVENTS.PROJECT_CHANGED);
        assert(change, 'PROJECT_CHANGED was not emitted.');
        eq(change.payload.project_id, other.id);
        eq((await repo.get(S.OBSERVATIONS, theirs.id)).id, theirs.id);
      } finally {
        watcher.stop();
        await repo.setActiveProject(P);
      }
      repo.resetRepoState();
      try {
        await expectError(() => repo.create(S.OBSERVATIONS, {}), 'no_project');
        await expectError(() => repo.list(S.OBSERVATIONS), 'no_project');
      } finally { await repo.setActiveProject(P); }
      await expectError(() => repo.create(S.OBSERVATIONS, { project_id: 'ghost_project' }), 'invalid_project');
      await expectError(() => repo.setActiveProject('ghost_project'), 'invalid_project');
      await expectError(() => repo.create(S.LESSONS, { project_id: P, title: 'x' }), 'invalid_data');
      await expectError(() => repo.update(S.OBSERVATIONS, mine.id, { project_id: 'another_project' }), 'invalid_data');
    });
    test('list: ordering, missing values last, limit, offset, ranges and bad options', async () => {
      for (const date of ['2026-03-01', '2026-01-15', '2026-02-10', null]) { await repo.create(S.OBSERVATIONS, date === null ? { tag: 'ord' } : { tag: 'ord', date }); }
      const dates = (rows) => rows.map((row) => row.date ?? null);
      deepEq(dates(await repo.list(S.OBSERVATIONS, { orderBy: 'date', filter: byTag('ord') })), ['2026-01-15', '2026-02-10', '2026-03-01', null]);
      deepEq(dates(await repo.list(S.OBSERVATIONS, { orderBy: 'date', direction: 'desc', filter: byTag('ord') })), ['2026-03-01', '2026-02-10', '2026-01-15', null]);
      deepEq(dates(await repo.list(S.OBSERVATIONS, { orderBy: 'date', filter: byTag('ord'), limit: 2, offset: 1 })), ['2026-02-10', '2026-03-01']);
      eq(await repo.count(S.OBSERVATIONS, { filter: byTag('ord') }), 4);
      const rows = await repo.list(S.OBSERVATIONS, { index: 'project_date', range: db.keyRange.bound([P, '2026-02-01'], [P, '2026-02-28']), filter: byTag('ord') });
      deepEq(rows.map((row) => row.date), ['2026-02-10']);
      await expectError(() => repo.list(S.OBSERVATIONS, { direction: 'up' }), 'invalid_query');
      await expectError(() => repo.list(S.OBSERVATIONS, { limit: 0 }), 'invalid_query');
      await expectError(() => repo.list(S.OBSERVATIONS, { filter: 'x' }), 'invalid_query');
      await expectError(() => repo.list(S.OBSERVATIONS, { range: db.keyRange.only('x') }), 'invalid_query');
    });
    test('audit trail logs every change without record content', async () => {
      const created = await repo.create(S.OBSERVATIONS, { description: 'SECRET-TEXT-123' });
      await repo.update(S.OBSERVATIONS, created.id, { status: 'IN PROGRESS' });
      await repo.remove(S.OBSERVATIONS, created.id);
      await repo.restore(S.OBSERVATIONS, created.id);
      await repo.purge(S.OBSERVATIONS, created.id);
      const entries = await db.getAllByIndex(S.AUDIT_TRAIL, 'store_record', db.keyRange.only([S.OBSERVATIONS, created.id]));
      deepEq(entries.map((entry) => entry.action).sort(), ['create', 'delete', 'purge', 'restore', 'update']);
      assert(!JSON.stringify(entries).includes('SECRET-TEXT-123'), 'The audit trail must not contain record content.');
      const all = await db.getAll(S.AUDIT_TRAIL);
      eq(all.filter((entry) => entry.store === S.SETTINGS || entry.store === S.AUDIT_TRAIL).length, 0);
    });
    test('events are emitted after changes, and not for no-ops', async () => {
      const watcher = recordEvents();
      let created;
      try {
        created = await repo.create(S.OBSERVATIONS, { description: 'events' });
        await repo.update(S.OBSERVATIONS, created.id, { status: 'IN PROGRESS' });
        await repo.remove(S.OBSERVATIONS, created.id);
        await repo.remove(S.OBSERVATIONS, created.id);
        await repo.restore(S.OBSERVATIONS, created.id);
        await repo.purge(S.OBSERVATIONS, created.id);
      } finally { watcher.stop(); }
      const mine = watcher.events.filter((item) => item.payload && item.payload.id === created.id && item.payload.store === S.OBSERVATIONS);
      deepEq(mine.map((item) => item.name + ':' + (item.payload.action || (item.payload.hard ? 'purge' : 'delete'))),
        ['record:saved:create', 'record:saved:update', 'record:deleted:delete', 'record:saved:restore', 'record:deleted:purge']);
    });
    test('settings: read, write, fallback and validation', async () => {
      eq(await repo.getSetting('nope_key', 'fallback'), 'fallback');
      deepEq(await repo.setSetting('k_one', { a: 1 }), { a: 1 });
      deepEq(await repo.getSetting('k_one'), { a: 1 });
      eq(await repo.setSetting('k_one', null), null);
      eq(await repo.getSetting('k_one', 'fallback'), null, 'a stored null is a real value');
      await expectError(() => repo.setSetting('k_one', undefined), 'invalid_data');
      await expectError(() => repo.setSetting('bad key', 1), 'invalid_query');
    });
  });

  /* ---------------- services/config.js ---------------- */
  suite('User configuration and theme (js/services/config.js)', ({ test, before }) => {
    before(async () => {
      await resetDb();
      await repo.initRepo();
    });
    const defaults = () => ucfg.USER_CONFIG_DEFAULTS;
    test('a new install gets the defaults, and copies are independent', async () => {
      const config = await ucfg.getUserConfig();
      deepEq(config, { language: 'en', timezone: 'auto', country: null, industry: null, role: 'beginner_learner', units: 'metric', date_format: 'DD/MM/YYYY', week_start: 'monday', privacy: { ai_enabled: false, context_level: 'page', redact_names: true } });
      config.language = 'zz';
      config.privacy.ai_enabled = true;
      const again = await ucfg.getUserConfig();
      eq(again.language, 'en');
      eq(again.privacy.ai_enabled, false);
    });
    test('updates are saved, survive a reload, mirror the language and announce changes', async () => {
      const events = [];
      const stop = ev.on(cfg.EVENTS.CONFIG_CHANGED, (payload) => { events.push(payload); });
      try {
        await ucfg.updateUserConfig({ language: 'ta' });
        await ucfg.updateUserConfig({ language: 'ta' });
      } finally { stop(); }
      eq(events.length, 1, 'events');
      deepEq(events[0].changed, ['language']);
      ucfg.resetConfigCache();
      eq((await ucfg.loadUserConfig()).language, 'ta');
      eq(localStorage.getItem(cfg.LS_KEYS.LANGUAGE), 'ta');
      eq(ucfg.getCachedLanguage(), 'ta');
      const stored = await repo.getSetting(cfg.SETTINGS_KEYS.USER_CONFIG);
      eq(stored.config_version, 1);
      const config = await ucfg.updateUserConfig({ privacy: { ai_enabled: true } });
      eq(config.privacy.ai_enabled, true);
      eq(config.privacy.context_level, 'page');
    });
    test('invalid changes are rejected and nothing is saved', async () => {
      const before = await ucfg.getUserConfig();
      const error = await expectError(() => ucfg.updateUserConfig({ language: 'en', units: 'furlongs' }), 'invalid_data');
      eq(error.fields.units, 'Choose metric or imperial.');
      eq((await ucfg.getUserConfig()).language, before.language);
      assert((await expectError(() => ucfg.updateUserConfig({ foo: 1 }), 'invalid_data')).fields.foo, 'unknown setting is reported');
      assert((await expectError(() => ucfg.updateUserConfig({ privacy: { context_level: 'all' } }), 'invalid_data')).fields['privacy.context_level'], 'privacy field is reported');
      await expectError(() => ucfg.updateUserConfig({ privacy: 'x' }), 'invalid_data');
      await expectError(() => ucfg.updateUserConfig('x'), 'invalid_data');
    });
    test('time zone and value normalization', async () => {
      let config = await ucfg.updateUserConfig({ timezone: 'Asia/Kolkata' });
      assert(typeof config.timezone === 'string' && config.timezone !== 'auto', 'A fixed zone must be stored.');
      eq(ucfg.getEffectiveTimezone(config), config.timezone);
      config = await ucfg.updateUserConfig({ timezone: 'auto' });
      eq(ucfg.getEffectiveTimezone(config), ucfg.getDeviceTimezone());
      await expectError(() => ucfg.updateUserConfig({ timezone: 'Mars/Phobos' }), 'invalid_data');
      await expectError(() => ucfg.updateUserConfig({ timezone: '+05:30' }), 'invalid_data');
      config = await ucfg.updateUserConfig({ country: 'in', role: 'Safety_Officer', date_format: 'dd/mm/yyyy', week_start: 'SUNDAY', industry: 'Manufacturing', units: 'IMPERIAL' });
      eq(config.country, 'IN');
      eq(config.role, 'safety_officer');
      eq(config.date_format, 'DD/MM/YYYY');
      eq(config.week_start, 'sunday');
      eq(config.industry, 'manufacturing');
      eq(config.units, 'imperial');
      await expectError(() => ucfg.updateUserConfig({ country: 'India' }), 'invalid_data');
      await expectError(() => ucfg.updateUserConfig({ role: 'Safety Officer' }), 'invalid_data');
      config = await ucfg.updateUserConfig({ country: '', industry: null });
      eq(config.country, null);
      eq(config.industry, null);
    });
    test('validateConfigChanges and normalizeUserConfig', () => {
      const good = ucfg.validateConfigChanges({ units: 'METRIC', language: 'EN', units2: 'x', week_start: undefined });
      eq(good.value.units, 'metric');
      eq(good.value.language, 'en');
      assert(Object.keys(good.errors).length === 1 && good.errors.units2, 'Only the unknown key must be reported.');
      deepEq(ucfg.validateConfigChanges({ units: undefined }), { value: {}, errors: {} });
      deepEq(ucfg.normalizeUserConfig(null), defaults());
      deepEq(ucfg.normalizeUserConfig([]), defaults());
      const repaired = ucfg.normalizeUserConfig({ language: 'xx', units: 'imperial', privacy: { ai_enabled: 'yes', redact_names: false } });
      eq(repaired.language, 'en');
      eq(repaired.units, 'imperial');
      eq(repaired.privacy.ai_enabled, false);
      eq(repaired.privacy.redact_names, false);
    });
    test('reset, quick successive updates and corrupt stored values', async () => {
      await ucfg.updateUserConfig({ units: 'imperial', language: 'ar' });
      deepEq(await ucfg.resetUserConfig(), defaults());
      eq(localStorage.getItem(cfg.LS_KEYS.LANGUAGE), 'en');
      await Promise.all([ucfg.updateUserConfig({ language: 'hi' }), ucfg.updateUserConfig({ units: 'imperial' }), ucfg.updateUserConfig({ privacy: { redact_names: false } })]);
      ucfg.resetConfigCache();
      const config = await ucfg.loadUserConfig();
      eq(config.language, 'hi');
      eq(config.units, 'imperial');
      eq(config.privacy.redact_names, false);
      await repo.setSetting(cfg.SETTINGS_KEYS.USER_CONFIG, { language: 'zz', units: 'imperial', privacy: 'oops', timezone: 42 });
      ucfg.resetConfigCache();
      const corrupt = await ucfg.loadUserConfig();
      eq(corrupt.language, 'en');
      eq(corrupt.units, 'imperial');
      eq(corrupt.timezone, 'auto');
      deepEq(corrupt.privacy, defaults().privacy);
    });
    test('language helpers and option lists', () => {
      deepEq(ucfg.SUPPORTED_LANGUAGES.map((entry) => entry.code), ['en', 'ta', 'hi', 'ar']);
      eq(ucfg.getLanguageInfo('AR').dir, 'rtl');
      eq(ucfg.getLanguageInfo('ta').speechLocale, 'ta-IN');
      eq(ucfg.getLanguageInfo('zz').code, 'en');
      localStorage.setItem(cfg.LS_KEYS.LANGUAGE, 'zz');
      eq(ucfg.getCachedLanguage(), 'en');
      deepEq(ucfg.UNITS, ['metric', 'imperial']);
      deepEq(ucfg.DATE_FORMATS, ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']);
      deepEq(ucfg.WEEK_STARTS, ['monday', 'sunday', 'saturday']);
      deepEq(ucfg.CONTEXT_LEVELS, ['off', 'page', 'field', 'selection']);
    });
    test('theme: invalid value falls back, cycling, saving and announcing', async () => {
      localStorage.setItem(cfg.LS_KEYS.THEME, 'purple');
      eq(ucfg.getTheme(), 'auto');
      eq(ucfg.nextTheme('auto'), 'light');
      eq(ucfg.nextTheme('light'), 'dark');
      eq(ucfg.nextTheme('dark'), 'auto');
      const events = [];
      const stop = ev.on(cfg.EVENTS.THEME_CHANGED, (payload) => { events.push(payload); });
      try {
        eq(ucfg.setTheme('dark'), 'dark');
        ucfg.setTheme('dark');
      } finally { stop(); }
      eq(events.length, 1, 'events');
      deepEq(events[0], { theme: 'dark', previous: 'auto' });
      eq(localStorage.getItem(cfg.LS_KEYS.THEME), 'dark');
      await expectError(() => ucfg.setTheme('banana'), 'invalid_data');
    });
  });

  /* ---------------- router.js: module list and links ---------------- */
  suite('Module list and links (js/core/router.js)', ({ test }) => {
    let real;
    const copyOf = () => JSON.parse(JSON.stringify(real));
    const invalid = async (change, fragment) => {
      const data = copyOf();
      change(data);
      const error = await expectError(() => router.validateRegistry(data), Error);
      assert(error.message.startsWith('NASUR modules.json:') && error.message.includes(fragment), 'Message "' + error.message + '" should mention "' + fragment + '".');
    };
    test('data/modules.json is valid; Home is a module file and More is built in', async () => {
      real = await fetchJson('data/modules.json');
      eq(router.validateRegistry(real), true);
      assert(real.modules.length >= 38, 'Expected at least 38 modules.');
      deepEq(real.pdca_stages.map((stage) => stage.id).sort(), Object.values(cfg.PDCA_STAGE).sort());
      const routes = real.modules.map((mod) => mod.route);
      eq(new Set(routes).size, routes.length, 'unique routes');
      const home = real.modules.find((mod) => mod.id === 'home');
      assert(home.status === 'active' && home.builtin === false && home.file === 'js/modules/home.js', 'Home must be an active module file.');
      const more = real.modules.find((mod) => mod.id === 'more');
      assert(more.status === 'active' && more.builtin === true, 'More must be an active built-in module.');
    });
    test('registry validation rejects mistakes', async () => {
      await invalid((data) => { data.modules[1].id = data.modules[0].id; }, 'duplicate');
      await invalid((data) => { data.modules[0].route = '/wrong'; }, 'route');
      await invalid((data) => { data.modules[0].group = 'nope'; }, 'group');
      await invalid((data) => { data.modules[0].pdca = 'zzz'; }, 'PDCA');
      await invalid((data) => { data.modules[0].status = 'maybe'; }, 'status');
      await invalid((data) => { data.modules[0].phase = 0; }, 'phase');
      await invalid((data) => { data.modules.find((mod) => mod.file).file = 'js/other/x.js'; }, 'file path');
      await invalid((data) => { const mod = data.modules.find((item) => item.id === 'observations'); mod.status = 'active'; mod.file = null; }, 'no file');
      await invalid((data) => { data.modules[0].nav = { order: 'x', label: '' }; }, 'nav');
      await invalid((data) => { delete data.groups; }, 'groups');
      await expectError(() => router.validateRegistry(null), Error);
    });
    test('registry queries (modules, navigation, groups, PDCA)', async () => {
      const registry = router.setModuleRegistry(real);
      assert(Object.isFrozen(registry), 'The registry must be frozen.');
      await expectError(() => { router.getRegistry().modules.push({}); }, TypeError);
      eq(router.getModule('home').route, '/home');
      eq(router.getModuleByRoute('/report-check').id, 'report_check');
      eq(router.getModule('nope'), null);
      eq(router.isModuleOpenable(router.getModule('home')), true);
      eq(router.isModuleOpenable(router.getModule('policy')), false);
      const nav = router.getNavItems();
      assert(nav.every((item) => item.status === 'active' && item.nav !== null), 'Navigation lists only active modules with a nav entry.');
      deepEq(nav.map((item) => item.nav.order), nav.map((item) => item.nav.order).slice().sort((a, b) => a - b), 'navigation order');
      assert(nav.some((item) => item.id === 'home') && nav.some((item) => item.id === 'more'), 'Home and More must be in the navigation.');
      const groups = router.getModulesByGroup();
      deepEq(groups.map((entry) => entry.group.id), ['core', 'operations', 'learning', 'knowledge', 'insight', 'extensions']);
      eq(groups.reduce((sum, entry) => sum + entry.modules.length, 0), real.modules.length);
      const stages = router.getModulesByPdca();
      deepEq(stages.map((entry) => entry.stage.id), ['plan', 'do', 'check', 'act', 'improve']);
      for (const entry of stages) { assert(entry.modules.every((mod) => mod.pdca === entry.stage.id), 'PDCA grouping is wrong for ' + entry.stage.id); }
    });
    test('parseHash, routePath, hrefFor and navigate argument checks', async () => {
      const a = router.parseHash('#/observations/ab%20c?x=1');
      eq(a.valid, true);
      eq(a.path, '/observations/ab%20c');
      deepEq(a.segments, ['observations', 'ab c']);
      eq(a.query.get('x'), '1');
      deepEq(router.parseHash('').segments, []);
      eq(router.parseHash('#//a///b/').path, '/a/b');
      eq(router.parseHash('#/%E0%A4%A').valid, false, 'bad encoding');
      eq(router.parseHash('#/' + 'a'.repeat(2001)).valid, false, 'too long');
      eq(router.routePath('home'), '/home');
      eq(router.routePath('report_check', ['a b'], { q: '1 2' }), '/report-check/a%20b?q=1+2');
      eq(router.routePath('observations', ['a/b?c#d']), '/observations/a%2Fb%3Fc%23d');
      eq(router.routePath('actions', [], { status: 'open', page: 2, x: null, y: undefined }), '/actions?status=open&page=2');
      eq(router.hrefFor('observations', ['id1'], { a: 'b' }), '#/observations/id1?a=b');
      eq(router.DEFAULT_ROUTE, '/home');
      await expectError(() => router.routePath('Bad-Id'), TypeError);
      await expectError(() => router.routePath('home', ['']), TypeError);
      await expectError(() => router.navigate('no-slash'), TypeError);
      await expectError(() => router.navigate('/has space'), TypeError);
      await expectError(() => router.navigate('/a#b'), TypeError);
    });
  });

  suite('Manufacturing hook registry (data/hooks/manufacturing-hooks.json)', ({ test }) => {
    test('eleven hooks with complete fields; industries, modules and stores all exist', async () => {
      const hooks = await fetchJson('data/hooks/manufacturing-hooks.json');
      const moduleIds = new Set((await fetchJson('data/modules.json')).modules.map((mod) => mod.id));
      const stages = Object.values(cfg.PDCA_STAGE);
      const industries = ['construction', 'manufacturing', 'industrial_maintenance', 'facilities_management', 'warehousing_logistics', 'food_manufacturing', 'consultancy'];
      eq(hooks.hooks.length, 11);
      const ids = hooks.hooks.map((hook) => hook.id);
      eq(new Set(ids).size, ids.length, 'unique ids');
      const problems = [];
      for (const hook of hooks.hooks) {
        for (const field of ['id', 'title', 'summary', 'pdca', 'industries', 'related_modules', 'reuses_stores', 'ext_type', 'first_phase', 'awareness_topics', 'planned_fields', 'status']) { if (!(field in hook)) { problems.push(hook.id + ' is missing ' + field); } }
        if (!stages.includes(hook.pdca)) { problems.push(hook.id + ': bad pdca'); }
        if (!hooks.status_values.includes(hook.status)) { problems.push(hook.id + ': bad status'); }
        for (const industry of hook.industries) { if (!industries.includes(industry)) { problems.push(hook.id + ': unknown industry ' + industry); } }
        for (const id of hook.related_modules) { if (!moduleIds.has(id)) { problems.push(hook.id + ': unknown module ' + id); } }
        for (const store of hook.reuses_stores) { if (!cfg.isStoreName(store)) { problems.push(hook.id + ': unknown store ' + store); } }
      }
      assert(problems.length === 0, problems.join('\n'));
    });
  });

  /* ---------------- router.js: live view switching ---------------- */
  suite('Router (live view switching)', ({ test, before, after }) => {
    const original = { href: location.href, title: document.title, lastRoute: localStorage.getItem(cfg.LS_KEYS.LAST_ROUTE) };
    const log = [];
    let container;
    let focusTarget;
    let alphaSignal = null;
    const makeModule = (id, extra) => Object.assign({
      id, route: '/' + id.replace(/_/g, '-'), title: id.toUpperCase(), icon: '•', description: 'Test module ' + id,
      group: 'core', pdca: null, phase: 1, status: 'active', builtin: true, file: null, nav: null
    }, extra || {});
    const testRegistry = {
      schema_version: 1,
      pdca_stages: [{ id: 'plan', title: 'Plan', order: 1 }],
      groups: [{ id: 'core', title: 'Core', order: 1 }],
      modules: [
        makeModule('home'),
        makeModule('alpha', { nav: { order: 1, label: 'Alpha' } }),
        makeModule('beta_two'),
        makeModule('gamma', { status: 'planned', phase: 5, builtin: false }),
        makeModule('delta'),
        makeModule('epsilon', { builtin: false, file: 'js/modules/does-not-exist.js' })
      ]
    };
    function waitForRoute(predicate) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(new Error('The router did not show the expected page within 3 seconds.')); }, 3000);
        const stop = ev.on(cfg.EVENTS.ROUTE_CHANGED, (info) => { if (predicate(info)) { clearTimeout(timer); stop(); resolve(info); } });
      });
    }
    async function go(path, predicate) {
      const waiting = waitForRoute(predicate);
      router.navigate(path);
      return waiting;
    }
    before(() => {
      router.setModuleRegistry(testRegistry);
      container = document.createElement('div');
      container.hidden = true;
      focusTarget = document.createElement('div');
      focusTarget.tabIndex = -1;
      document.body.append(container, focusTarget);
      router.registerBuiltin('home', async (ctx) => { ctx.root.textContent = 'HOME VIEW'; });
      router.registerBuiltin('alpha', async (ctx) => {
        alphaSignal = ctx.signal;
        ctx.root.textContent = 'ALPHA ' + ctx.segments.join('|') + ' ' + (ctx.query.get('x') || '-');
        ctx.setTitle('Alpha title');
        return () => { log.push('alpha-cleanup'); };
      });
      router.registerBuiltin('beta_two', async (ctx) => {
        await sleep(80);
        if (ctx.signal.aborted) { return; }
        ctx.root.textContent = 'BETA VIEW';
      });
      router.registerBuiltin('delta', async () => { throw new Error('delta failed on purpose'); });
    });
    after(() => {
      if (router.isRouterRunning()) { router.stopRouter(); }
      router.clearModuleRegistry();
      if (container) { container.remove(); }
      if (focusTarget) { focusTarget.remove(); }
      history.replaceState(null, '', original.href);
      document.title = original.title;
      try {
        if (original.lastRoute === null) { localStorage.removeItem(cfg.LS_KEYS.LAST_ROUTE); } else { localStorage.setItem(cfg.LS_KEYS.LAST_ROUTE, original.lastRoute); }
      } catch { /* storage blocked */ }
    });
    test('starts and shows the view for the current address', async () => {
      history.replaceState(null, '', location.pathname + location.search + '#/alpha');
      await router.startRouter({ root: container, focusTarget });
      eq(router.isRouterRunning(), true);
      assert(container.textContent.includes('ALPHA'), 'The alpha view was not shown.');
      const info = router.getCurrentRoute();
      eq(info.module_id, 'alpha');
      eq(info.state, 'ok');
      assert(document.title.includes('Alpha title'), 'The view title was not applied.');
      await expectError(() => router.startRouter({ root: container }), Error);
    });
    test('passes segments and query, aborts and cleans up the old view', async () => {
      const firstSignal = alphaSignal;
      log.length = 0;
      const info = await go('/alpha/seg1/seg%202?x=5', (item) => item.path.startsWith('/alpha/seg1'));
      deepEq(info.segments, ['seg1', 'seg 2']);
      eq(info.previous_path, '/alpha');
      eq(container.textContent, 'ALPHA seg1|seg 2 5');
      assert(log.includes('alpha-cleanup'), 'The previous view was not cleaned up.');
      eq(firstSignal.aborted, true, 'previous view signal');
      eq(alphaSignal.aborted, false, 'current view signal');
    });
    test('unknown, planned and failing pages show clear states', async () => {
      const missing = await go('/zzz', (item) => item.state === 'not_found');
      assert(container.textContent.includes('Page not found'), 'The not-found page was not shown.');
      eq(missing.module_id, null);
      const planned = await go('/gamma', (item) => item.module_id === 'gamma');
      eq(planned.state, 'planned');
      assert(container.textContent.includes('build phase 5'), 'The planned page must mention the build phase.');
      const cap = captureConsole();
      try {
        const failed = await go('/delta', (item) => item.module_id === 'delta');
        eq(failed.state, 'error');
        assert(container.textContent.includes('could not be shown'), 'The error page was not shown.');
        const broken = await go('/epsilon', (item) => item.module_id === 'epsilon');
        eq(broken.state, 'error');
        assert(container.textContent.includes('could not be loaded'), 'The load-error page was not shown.');
        const button = container.querySelector('[data-router-action="retry"]');
        assert(button, 'The retry button is missing.');
        const waiting = waitForRoute((item) => item.module_id === 'epsilon');
        button.click();
        eq((await waiting).state, 'error');
      } finally { cap.restore(); }
    });
    test('the navigation guard can block leaving a page', async () => {
      await go('/alpha', (item) => item.module_id === 'alpha' && item.path === '/alpha');
      const here = location.hash;
      let seen = null;
      const remove = router.setNavigationGuard((change) => { seen = change; return false; });
      router.navigate('/beta-two');
      await sleep(200);
      eq(location.hash, here, 'address after a blocked navigation');
      eq(router.getCurrentRoute().module_id, 'alpha');
      assert(seen && seen.to === '#/beta-two' && seen.from === here, 'The guard must receive from and to.');
      remove();
      const info = await go('/beta-two', (item) => item.module_id === 'beta_two');
      eq(info.state, 'ok');
      eq(container.textContent, 'BETA VIEW');
    });
    test('fast navigation never shows a stale view', async () => {
      await go('/alpha', (item) => item.module_id === 'alpha' && item.path === '/alpha');
      router.navigate('/beta-two');
      await sleep(20);
      const waiting = waitForRoute((item) => item.module_id === 'alpha');
      router.navigate('/alpha/race');
      await waiting;
      await sleep(150);
      eq(container.textContent, 'ALPHA race -');
    });
    test('the last page is remembered (working pages only); stopping cleans up; empty address opens Home', async () => {
      await go('/alpha/last', (item) => item.path === '/alpha/last');
      eq(localStorage.getItem(cfg.LS_KEYS.LAST_ROUTE), '/alpha/last');
      eq(router.getLastRoute(), '/alpha/last');
      await go('/gamma', (item) => item.module_id === 'gamma');
      eq(localStorage.getItem(cfg.LS_KEYS.LAST_ROUTE), '/alpha/last', 'planned pages are not remembered');
      await go('/alpha/stop', (item) => item.path === '/alpha/stop');
      log.length = 0;
      router.stopRouter();
      eq(router.isRouterRunning(), false);
      assert(log.includes('alpha-cleanup'), 'The view cleanup did not run.');
      eq(container.childElementCount, 0, 'view container');
      history.replaceState(null, '', location.pathname + location.search);
      await router.startRouter({ root: container, focusTarget });
      eq(location.hash, '#/home');
      eq(container.textContent, 'HOME VIEW');
      router.stopRouter();
    });
  });

  /* ---------------- offline support ---------------- */
  suite('Offline support (skipped until the app has run once on this address)', ({ test }) => {
    test('the service worker is registered and active', async () => {
      if (!('serviceWorker' in navigator)) { skip('This browser has no service worker support.'); }
      const registration = await navigator.serviceWorker.getRegistration(ROOT.href);
      if (!registration) { skip('Not registered yet. Open the app once on this address, wait for it to load, then run the tests again.'); }
      assert(registration.active, 'The service worker is registered but not active yet.');
    });
    test('the offline cache holds the essential files', async () => {
      if (typeof caches === 'undefined') { skip('Cache storage is not available in this browser.'); }
      const names = (await caches.keys()).filter((name) => name.startsWith('nasur-')).sort();
      if (names.length === 0) { skip('No NASUR cache yet. Open the app once on this address first.'); }
      const cache = await caches.open(names[names.length - 1]);
      const missing = [];
      for (const path of ['index.html', 'js/core/app.js', 'js/modules/home.js', 'data/modules.json']) {
        if (!(await cache.match(new URL(path, ROOT).href))) { missing.push(path); }
      }
      assert(missing.length === 0, 'Not in the offline cache: ' + missing.join(', '));
    });
  });
}