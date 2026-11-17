/* NASUR - Permit to Work & JSA / HIRA module (Phase 6) */
import { EVENTS } from '../core/config.js';
import { emit, on, off } from '../core/eventbus.js';
import { loadRegions, formatDate, formatTime } from '../services/regions.js';
import { h, card, toast, ensureRefCss, ensureCss, missionBanner, tabsBar, openObservationModal, shareText } from '../services/safety_reference.js';
import {
  loadPermitTypes,
  listTypes,
  getType,
  commonRules,
  statusLabel,
  createPermit,
  getPermit,
  listPermits,
  removePermit,
  updatePermit,
  permitReadiness,
  timeLeft,
  postWatchLeft,
  expireOverdue,
  summarizePermits,
  setPrecaution,
  setField,
  addIsolation,
  removeIsolation,
  addGasTest,
  signOff,
  clearSignOff,
  submitPermit,
  issuePermit,
  suspendPermit,
  resumePermit,
  extendPermit,
  closePermit,
  cancelPermit,
  permitToAction,
  permitText,
  limitsFor,
  gasTestValid,
  latestGasTest
} from '../services/permits.js';
import {
  loadRiskLibrary,
  getLibrary,
  score,
  bandFor,
  approvalFor,
  matrixGrid,
  newJsa,
  newStep,
  newControl,
  listTemplates,
  fromTemplate,
  validateStep,
  stepScores,
  jsaSummary,
  jsaReadiness,
  canApprove,
  saveJsa,
  getJsa,
  listJsas,
  removeJsa,
  approveJsa,
  reopenJsa,
  jsaToActions
} from '../services/risk.js';

export const id = 'ptw_jsa';

const TABS = [
  { id: 'permits', label: 'Permits' },
  { id: 'jsa', label: 'JSA / HIRA' },
  { id: 'matrix', label: 'Risk matrix' }
];

let root = null;
let tab = 'permits';
let filter = 'active';
let permitId = null;
let jsaId = null;
let newType = '';
let jsaMenu = false;
let jsaCur = null;
let saveTimer = null;
let savePill = null;
let tickTimer = null;
let expireTimer = null;
let handlers = [];

function fmt(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : formatDate(d) + ' ' + formatTime(d);
}

function pill(status) {
  return h('span', { class: 'op-pill op-s-' + status, text: statusLabel(status) });
}

function badge(sc) {
  const b = bandFor(sc);
  return h('span', { class: 'op-score', style: 'background:' + b.color, text: sc + ' ' + b.label });
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function input(value, onInput, type, placeholder) {
  const i = h('input', { class: 'st-input', type: type || 'text', value: value == null ? '' : value, placeholder: placeholder || '', autocomplete: 'off' });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

function area(value, onInput, placeholder, rows) {
  const t = h('textarea', { class: 'st-input', rows: String(rows || 3), placeholder: placeholder || '' });
  t.value = value || '';
  t.addEventListener('input', () => onInput(t.value));
  return t;
}

function select(options, value, onChange) {
  const s = h('select', { class: 'st-select' }, options.map((o) => h('option', { value: o.id, text: o.label })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/* ---------- Live timers ---------- */

function timerEl(endIso, label) {
  const el = h('span', { class: 'op-timer', 'data-end': endIso, text: '--:--:--' });
  if (label) el.setAttribute('data-label', label);
  return el;
}

function tick() {
  const now = Date.now();
  document.querySelectorAll('.op-timer[data-end]').forEach((el) => {
    const ms = new Date(el.getAttribute('data-end')).getTime() - now;
    const mins = ms / 60000;
    const level = ms <= 0 ? 'expired' : mins <= 15 ? 'critical' : mins <= 60 ? 'warn' : 'ok';
    const s = Math.floor(Math.abs(ms) / 1000);
    const p = (n) => String(n).padStart(2, '0');
    el.textContent = ms <= 0 ? (el.getAttribute('data-label') === 'watch' ? 'DONE' : 'EXPIRED') : p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
    el.className = 'op-timer t-' + level;
  });
}

async function checkExpiry() {
  try {
    const changed = await expireOverdue();
    if (changed.length) {
      toast(changed.length + ' permit(s) expired: ' + changed.map((p) => p.number).join(', '), 'error');
      if (tab === 'permits') render();
    }
  } catch (e) {
    /* best effort */
  }
}

/* ---------- Permits list ---------- */

const FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'expired', label: 'Expired' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' }
];

function matchFilter(p) {
  if (filter === 'all') return true;
  if (filter === 'waiting') return p.status === 'submitted' || p.status === 'draft';
  if (filter === 'closed') return p.status === 'closed' || p.status === 'cancelled';
  return p.status === filter;
}

async function permitsTab() {
  const all = await listPermits();
  const sum = summarizePermits(all);
  const kpis = h('div', { class: 'op-kpis' }, [['Active', sum.active, false], ['Expiring soon', sum.expiringSoon, sum.expiringSoon > 0], ['Waiting', sum.waiting, false], ['Expired', sum.expired, sum.expired > 0]].map((k) => h('div', { class: 'op-kpi' + (k[2] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] }))));
  const chips = h('div', { class: 'rf-chips' }, FILTERS.map((f) => h('button', { class: 'st-chip', type: 'button', text: f.label, 'aria-pressed': filter === f.id ? 'true' : 'false', onclick: () => { filter = f.id; render(); } })));
  const rows = all.filter(matchFilter).map((p) => {
    const t = getType(p.type) || { icon: '📄', color: '#64748b' };
    return h(
      'div',
      { class: 'op-card', style: '--pc:' + t.color, onclick: () => { permitId = p.id; render(); window.scrollTo(0, 0); } },
      h('div', { class: 'op-top' }, h('b', { text: t.icon + ' ' + p.number }), pill(p.status)),
      h('div', { class: 'op-line', text: p.title + ' · ' + (p.location || 'no location') }),
      h('div', { class: 'op-top' }, h('span', { class: 'rf-hint', text: (p.contractor ? p.contractor + ' · ' : '') + 'Until ' + fmt(p.valid_until) }), p.status === 'active' ? timerEl(p.valid_until) : null)
    );
  });
  return [
    kpis,
    h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '+ New permit', onclick: () => { permitId = 'new'; newType = ''; render(); window.scrollTo(0, 0); } })),
    chips,
    h('div', { class: 'op-list' }, rows.length ? rows : [h('div', { class: 'ob-empty', text: all.length ? 'No permits in this view.' : 'No permits yet. Tap + New permit.' })])
  ];
}

/* ---------- New permit ---------- */

async function newPermitView() {
  const back = h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Permits', onclick: () => { permitId = null; render(); } });
  const tiles = h('div', { class: 'rf-grid' }, listTypes().map((t) => h('button', { class: 'rf-tile', type: 'button', 'aria-pressed': newType === t.id ? 'true' : 'false', onclick: () => { newType = t.id; render(); } }, h('span', { class: 'rf-ic', text: t.icon }), h('b', { text: t.title }), h('small', { text: 'Up to ' + t.max_hours + ' h' }))));
  const nodes = [back, card('Choose the permit type', commonRules().notice, tiles)];
  if (!newType) return nodes;
  const t = getType(newType);
  const jsas = (await listJsas()).filter((j) => j.status === 'approved');
  const d = { location: '', work_scope: '', contractor: '', receiver_name: '', workers: '', hours: t.default_hours, jsa_id: '' };
  const jsaSel = select([{ id: '', label: 'No JSA linked yet' }].concat(jsas.map((j) => ({ id: j.id, label: j.number + ' · ' + j.title }))), '', (v) => { d.jsa_id = v; });
  const create = h('button', { class: 'st-btn', type: 'button', text: 'Create permit (draft)' });
  const makeJsa = h('button', { class: 'st-btn secondary', type: 'button', text: 'Create a JSA from the ' + t.title + ' template' });
  const build = async (withJsa) => {
    try {
      let jsaId2 = d.jsa_id;
      let jsaNo = '';
      if (withJsa) {
        const j = await saveJsa(fromTemplate(t.jsa_template, { location: d.location, job: d.work_scope, prepared_by: d.receiver_name }));
        jsaId2 = j.id;
        jsaNo = j.number;
        jsaId = j.id;
      } else if (jsaId2) {
        const j = jsas.find((x) => x.id === jsaId2);
        jsaNo = j ? j.number : '';
      }
      const rec = await createPermit(t.id, { location: d.location, work_scope: d.work_scope, contractor: d.contractor, receiver_name: d.receiver_name, workers: d.workers.split(',').map((x) => x.trim()).filter(Boolean), hours: d.hours, jsa_id: jsaId2, jsa_no: jsaNo });
      toast(rec.number + ' created', 'success');
      if (withJsa) {
        permitId = null;
        tab = 'jsa';
        toast('Review and approve the JSA, then link it to the permit', 'info');
      } else {
        permitId = rec.id;
      }
      render();
      window.scrollTo(0, 0);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  create.addEventListener('click', () => build(false));
  makeJsa.addEventListener('click', () => build(true));
  nodes.push(
    card(t.icon + ' ' + t.title, t.description, [
      field('Exact location', input(d.location, (v) => { d.location = v; })),
      field('Description of the work', area(d.work_scope, (v) => { d.work_scope = v; }, 'What will be done, with what equipment', 3)),
      field('Contractor / company', input(d.contractor, (v) => { d.contractor = v; })),
      field('Permit receiver (work leader)', input(d.receiver_name, (v) => { d.receiver_name = v; })),
      field('Workers on the job (comma separated)', input(d.workers, (v) => { d.workers = v; })),
      field('Valid for (hours, maximum ' + t.max_hours + ')', input(d.hours, (v) => { d.hours = v; }, 'number')),
      field('Linked JSA', jsaSel),
      create,
      makeJsa
    ])
  );
  return nodes;
}

/* ---------- Permit detail ---------- */

async function permitDetail(id0) {
  let p = await getPermit(id0);
  if (!p) {
    permitId = null;
    return permitsTab();
  }
  const t = getType(p.type);
  const common = commonRules();
  const nodes = [];
  const reload = async () => {
    p = (await getPermit(id0)) || p;
    render();
  };
  const run = async (fn, ok) => {
    try {
      const r = await fn();
      if (ok) toast(ok, 'success');
      await reload();
      return r;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  };
  const editable = p.status === 'draft' || p.status === 'submitted';
  const live = ['active', 'suspended', 'expired'].includes(p.status);

  nodes.push(h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Permits', onclick: () => { permitId = null; render(); } }));
  const head = h('div', { class: 'rf-card', style: 'border-left:8px solid ' + t.color }, h('div', { class: 'op-top' }, h('b', { text: t.icon + ' ' + p.number }), pill(p.status)), h('h1', { class: 'rf-title', text: p.title }), h('p', { class: 'rf-sub', text: p.location + ' · ' + (p.contractor || 'no contractor') }), h('p', { class: 'rf-hint', text: 'From ' + fmt(p.start_at) + '  Until ' + fmt(p.valid_until) }));
  if (p.status === 'active' || p.status === 'expired') head.appendChild(h('div', { class: 'op-big' }, h('small', { text: p.status === 'active' ? 'Time left' : 'Permit expired' }), timerEl(p.valid_until)));
  const watch = postWatchLeft(p);
  if (watch) head.appendChild(h('div', { class: 'op-big' }, h('small', { text: 'Post-work fire watch' }), timerEl(p.post_watch_until, 'watch')));
  nodes.push(head);

  /* readiness */
  const jsa = p.jsa_id ? await getJsa(p.jsa_id) : null;
  const jsaApproved = !!(jsa && jsa.status === 'approved');
  if (editable) {
    const r = permitReadiness(p);
    const issues = r.issues.slice();
    if (p.jsa_id && !jsaApproved) issues.push('The linked JSA must be approved');
    nodes.push(h('div', { class: 'op-banner' + (!issues.length ? ' ok' : '') }, !issues.length ? h('b', { text: 'Ready to issue' }) : [h('b', { text: 'Not ready to issue yet' }), h('ul', { class: 'rf-list' }, issues.map((x) => h('li', { text: x })))]));
  }

  /* basics */
  if (editable) {
    nodes.push(
      card('Job details', '', [
        field('Location', input(p.location, (v) => updatePermit(id0, { location: v }))),
        field('Work description', area(p.work_scope, (v) => updatePermit(id0, { work_scope: v }), '', 3)),
        field('Receiver', input(p.receiver_name, (v) => updatePermit(id0, { receiver_name: v }))),
        field('Workers (comma separated)', input((p.workers || []).join(', '), (v) => updatePermit(id0, { workers: v.split(',').map((x) => x.trim()).filter(Boolean) })))
      ])
    );
  } else {
    nodes.push(card('Job', '', [h('p', { class: 'rf-sub', text: p.work_scope }), h('p', { class: 'rf-hint', text: 'Receiver: ' + p.receiver_name + ' · Issuer: ' + (p.issuer_name || '-') + ' · Workers: ' + (p.workers || []).join(', ') })]));
  }
  if ((t.extra_fields || []).length) {
    nodes.push(
      card('Permit details', '', t.extra_fields.map((f) => {
        const val = (p.fields || {})[f.id];
        if (f.type === 'select') return field(f.label, (() => { const s = select([{ id: '', label: 'Select' }].concat(f.options.map((o) => ({ id: o, label: o }))), val || '', (v) => setField(id0, f.id, v)); s.disabled = !editable && !live; return s; })());
        const i = input(val, (v) => setField(id0, f.id, f.type === 'number' ? v : v), f.type === 'number' ? 'number' : 'text');
        i.disabled = !editable && !live;
        return field(f.label, i);
      }))
    );
  }

  /* JSA link */
  nodes.push(
    card('Linked JSA / risk assessment', p.jsa_id ? '' : 'An approved JSA is needed before the permit can be issued.', jsa ? [h('div', { class: 'op-top' }, h('b', { text: jsa.number + ' · ' + jsa.title }), h('span', { class: 'op-pill op-s-' + (jsa.status === 'approved' ? 'active' : 'draft'), text: jsa.status })), (() => { const s = jsaSummary(jsa); return s.residualBand ? h('p', { class: 'rf-hint' }, 'Highest residual risk: ', badge(s.maxResidual)) : null; })(), h('button', { class: 'st-btn secondary small', type: 'button', text: 'Open JSA', onclick: () => { jsaId = jsa.id; tab = 'jsa'; permitId = null; render(); window.scrollTo(0, 0); } })] : null)
  );
  if (!jsa && editable) {
    const jsas = (await listJsas()).filter((j) => j.status === 'approved');
    const sel = select([{ id: '', label: 'Choose an approved JSA' }].concat(jsas.map((j) => ({ id: j.id, label: j.number + ' · ' + j.title }))), '', async (v) => { const j = jsas.find((x) => x.id === v); await run(() => updatePermit(id0, { jsa_id: v, jsa_no: j ? j.number : '' })); });
    nodes[nodes.length - 1].appendChild(sel);
  }

  /* precaution checks */
  const checks = card('Safety checks', 'Answer every check. Critical checks must be Yes.', t.precautions.map((c) => {
    const seg = h('div', { class: 'op-seg' });
    const cur = (p.precautions || {})[c.id] || '';
    ['yes', 'no', 'na'].forEach((v) => {
      const b = h('button', { type: 'button', class: 'op-seg-' + v, text: v === 'na' ? 'N/A' : v === 'yes' ? 'Yes' : 'No', 'aria-pressed': cur === v ? 'true' : 'false', disabled: !editable });
      b.addEventListener('click', async () => {
        const rec = await setPrecaution(id0, c.id, v);
        p = rec || p;
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      });
      seg.appendChild(b);
    });
    return h('div', { class: 'op-q' }, h('div', null, c.critical ? h('span', { class: 'rf-pill crit', text: 'CRITICAL' }) : null, ' ', c.text), seg);
  }));
  nodes.push(checks);

  /* isolations */
  if (t.isolation_required || (p.isolations || []).length) {
    const iso = { point: '', lock_id: '', by: p.receiver_name || '' };
    nodes.push(
      card('Isolations and locks', t.isolation_required ? 'Required for this permit type.' : '', [
        ...(p.isolations || []).map((x, i) => h('div', { class: 'op-row' }, h('span', { text: x.point + ' · lock ' + (x.lock_id || '-') + ' · ' + x.by + ' · ' + fmt(x.at) }), editable ? h('button', { class: 'st-btn danger small', type: 'button', text: 'Remove', onclick: () => run(() => removeIsolation(id0, i)) }) : null)),
        editable || live ? h('div', { class: 'op-form' }, input('', (v) => { iso.point = v; }, 'text', 'Isolation point'), input('', (v) => { iso.lock_id = v; }, 'text', 'Lock / tag ID'), input(iso.by, (v) => { iso.by = v; }, 'text', 'Isolated by'), h('button', { class: 'st-btn small', type: 'button', text: 'Record isolation', onclick: () => run(() => addIsolation(id0, iso), 'Isolation recorded') })) : null
      ])
    );
  }

  /* gas tests */
  if (t.gas_test && t.gas_test.required !== 'never') {
    const lim = limitsFor(p);
    const g = { o2: '', lel: '', h2s: '', co: '', tester: '', location: '' };
    const last = latestGasTest(p);
    const valid = gasTestValid(p);
    nodes.push(
      card('Gas tests', t.gas_test.note + ' Limits: O2 ' + lim.o2_min + ' to ' + lim.o2_max + '%, LEL max ' + lim.lel_max + '%, H2S max ' + lim.h2s_max + ' ppm, CO max ' + lim.co_max + ' ppm.', [
        h('div', { class: 'op-banner' + (valid ? ' ok' : '') }, h('b', { text: valid ? 'Gas test valid. Retest due within ' + ((Number(p.gas_valid_minutes) || 240) / 60) + ' h of the last test.' : last ? 'Last gas test is not valid. Test again.' : 'No gas test recorded yet.' })),
        ...(p.gas_tests || []).slice(-5).map((x) => h('div', { class: 'op-row' }, h('span', { text: fmt(x.at) + ' · O2 ' + x.o2 + ' · LEL ' + x.lel + ' · H2S ' + x.h2s + ' · CO ' + x.co + ' · ' + (x.tester || '') }), h('span', { class: 'op-pill ' + (x.ok ? 'op-s-active' : 'op-s-expired'), text: x.ok ? 'PASS' : 'FAIL' }))),
        h('div', { class: 'op-gas' }, input('', (v) => { g.o2 = v; }, 'number', 'O2 %'), input('', (v) => { g.lel = v; }, 'number', 'LEL %'), input('', (v) => { g.h2s = v; }, 'number', 'H2S ppm'), input('', (v) => { g.co = v; }, 'number', 'CO ppm')),
        input('', (v) => { g.tester = v; }, 'text', 'Tested by'),
        input('', (v) => { g.location = v; }, 'text', 'Where tested (top, middle, bottom)'),
        h('button', { class: 'st-btn small', type: 'button', text: 'Record gas test', onclick: async () => { try { const r = await addGasTest(id0, g); toast(r.result.ok ? 'Gas test PASSED' : 'Gas test FAILED: ' + r.result.fails.join('; '), r.result.ok ? 'success' : 'error'); await reload(); } catch (e) { toast(e.message, 'error'); } } })
      ])
    );
  }

  /* sign-offs */
  const signCard = (stage, title) => {
    const list = p.signoffs.map((s, i) => ({ s, i })).filter((x) => x.s.stage === stage);
    if (!list.length) return null;
    return card(title, '', list.map(({ s, i }) => {
      if (s.name) return h('div', { class: 'op-sign done' }, h('span', null, h('b', { text: s.label }), h('div', { class: 'rf-hint', text: s.name + ' · ' + fmt(s.signed_at) })), (stage === 'issue' ? editable : live) ? h('button', { class: 'st-btn secondary small', type: 'button', text: 'Clear', onclick: () => run(() => clearSignOff(id0, i)) }) : null);
      const nm = input('', () => {}, 'text', 'Full name');
      const can = stage === 'issue' ? editable : live;
      return h('div', { class: 'op-sign' }, h('span', null, h('b', { text: s.label + (s.required ? '' : ' (if needed)') })), can ? h('div', { class: 'op-form' }, nm, h('button', { class: 'st-btn small', type: 'button', text: 'Sign', onclick: () => run(() => signOff(id0, i, nm.value), 'Signed') })) : h('span', { class: 'rf-hint', text: 'Not signed' }));
    }));
  };
  nodes.push(signCard('issue', 'Sign-offs to issue'));
  nodes.push(signCard('closure', 'Sign-offs to close'));

  /* actions by status */
  const acts = h('div', { class: 'rf-actions' });
  if (p.status === 'draft') acts.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Submit to issuer', onclick: () => run(() => submitPermit(id0), 'Submitted') }));
  if (p.status === 'submitted') {
    const nm = input(p.issuer_name, () => {}, 'text', 'Issuer full name');
    nodes.push(card('Issue the permit', 'The issuer checks the site, the isolations and the sign-offs, then issues.', [nm, h('button', { class: 'st-btn', type: 'button', text: 'Issue permit', onclick: () => { if (!jsaApproved) return toast('The linked JSA must be approved before the permit can be issued', 'error'); run(() => issuePermit(id0, nm.value), 'Permit issued'); } })]));
    acts.appendChild(h('button', { class: 'st-btn secondary', type: 'button', text: 'Return to draft', onclick: () => run(async () => updatePermit(id0, { status: 'draft' })) }));
  }
  if (p.status === 'active') {
    acts.append(
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Suspend', onclick: () => { const r = window.prompt('Reason for suspending?', ''); if (r) run(() => suspendPermit(id0, r, p.receiver_name), 'Suspended'); } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Extend / revalidate', onclick: () => extendFlow(id0, p, run) }),
      h('button', { class: 'st-btn', type: 'button', text: 'Close permit', onclick: () => { const n = window.prompt('Your name (closing the permit)?', p.receiver_name || ''); if (n) run(() => closePermit(id0, n), 'Permit closed'); } })
    );
  }
  if (p.status === 'suspended') acts.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Resume', onclick: () => run(() => resumePermit(id0, p.receiver_name), 'Resumed') }));
  if (p.status === 'expired') acts.append(h('button', { class: 'st-btn', type: 'button', text: 'Revalidate / extend', onclick: () => extendFlow(id0, p, run) }), h('button', { class: 'st-btn secondary', type: 'button', text: 'Close permit', onclick: () => { const n = window.prompt('Your name?', p.receiver_name || ''); if (n) run(() => closePermit(id0, n), 'Permit closed'); } }));
  if (['draft', 'submitted', 'active', 'suspended'].includes(p.status)) acts.appendChild(h('button', { class: 'st-btn danger', type: 'button', text: 'Cancel permit', onclick: () => { const r = window.prompt('Reason for cancelling?', ''); if (r) run(() => cancelPermit(id0, r, p.receiver_name), 'Cancelled'); } }));
  nodes.push(card('Permit actions', '', acts));

  /* bridge */
  nodes.push(
    card('Observations, actions and sharing', '', h('div', { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Create observation', onclick: () => openObservationModal({ title: p.number, hazard_category: t.bridge.hazard_category, activity: t.bridge.activity + ' (' + p.number + ')', risk_rating: 'High', typical: ['Work outside the permit scope', 'Permit not displayed at the work site', 'Gas test expired during work', 'Isolation not as recorded', 'Fire watch not in place'], legal_clause: (t.legal && t.legal[p.country]) || '' }) }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '➕ Create action', onclick: async () => { const title = window.prompt('Action needed?', ''); if (!title) return; const who = window.prompt('Responsible person?', '') || ''; const due = window.prompt('Target date (YYYY-MM-DD)?', '') || ''; try { await permitToAction(p, { title, responsible: who, target_date: due }); toast('Action added to the Action Tracker', 'success'); } catch (e) { toast(e.message, 'error'); } } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share permit', onclick: () => shareText('Permit ' + p.number, permitText(p)) })))
  );

  /* conditions and log */
  nodes.push(card('General conditions', '', h('ul', { class: 'rf-list' }, common.general_conditions.map((x) => h('li', { text: x })))));
  if ((p.revalidations || []).length) nodes.push(card('Revalidations', '', h('ul', { class: 'rf-list' }, p.revalidations.map((r) => h('li', { text: fmt(r.at) + ': +' + r.hours + ' h · ' + r.receiver + ' / ' + r.issuer })))));
  nodes.push(card('Permit log', '', h('ul', { class: 'rf-list' }, (p.log || []).slice().reverse().slice(0, 30).map((l) => h('li', { text: fmt(l.at) + ' · ' + l.event + (l.by ? ' · ' + l.by : '') })))));
  if (p.status === 'draft' || p.status === 'cancelled') nodes.push(h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete permit', onclick: async () => { if (!window.confirm('Delete ' + p.number + '?')) return; await removePermit(id0); permitId = null; render(); } }));
  return nodes.filter(Boolean);
}

function extendFlow(id0, p, run) {
  const t = getType(p.type);
  const hours = window.prompt('Extend by how many hours? (maximum total ' + t.max_hours + ' h)', '2');
  if (!hours) return;
  const r = window.prompt('Permit receiver name?', p.receiver_name || '');
  if (!r) return;
  const i = window.prompt('Permit issuer name?', p.issuer_name || '');
  if (!i) return;
  run(() => extendPermit(id0, hours, r, i), 'Permit revalidated');
}

/* ---------- JSA ---------- */

function setSavePill(text) {
  if (savePill) savePill.textContent = text;
}

function scheduleSave() {
  setSavePill('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const rec = await saveJsa(jsaCur);
      jsaCur.id = rec.id;
      jsaCur.number = rec.number;
      setSavePill('Saved ✓');
    } catch (e) {
      setSavePill('Save failed');
      toast(e.message, 'error');
    }
  }, 600);
}

async function jsaTab() {
  if (jsaMenu) return jsaMenuView();
  if (jsaId) {
    if (!jsaCur || jsaCur.id !== jsaId) {
      jsaCur = await getJsa(jsaId);
      if (!jsaCur) {
        jsaId = null;
        return jsaTab();
      }
    }
    return jsaBuilder();
  }
  const list = await listJsas();
  const rows = list.map((j) => {
    const s = jsaSummary(j);
    return h('div', { class: 'op-card', style: '--pc:' + (s.residualBand ? s.residualBand.color : '#64748b'), onclick: () => { jsaId = j.id; jsaCur = null; render(); window.scrollTo(0, 0); } }, h('div', { class: 'op-top' }, h('b', { text: j.number }), h('span', { class: 'op-pill op-s-' + (j.status === 'approved' ? 'active' : 'draft'), text: j.status })), h('div', { class: 'op-line', text: j.title }), h('div', { class: 'op-top' }, h('span', { class: 'rf-hint', text: s.steps + ' steps · ' + s.openControls + ' control(s) open' }), s.maxResidual ? badge(s.maxResidual) : null));
  });
  return [h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '+ New JSA', onclick: () => { jsaMenu = true; render(); } })), h('div', { class: 'op-list' }, rows.length ? rows : [h('div', { class: 'ob-empty', text: 'No JSAs yet. Start from a template.' })])];
}

function jsaMenuView() {
  const start = async (tpl) => {
    try {
      const base = tpl ? fromTemplate(tpl, {}) : newJsa({ title: 'New JSA' });
      if (!tpl) base.steps = [newStep({ step: '', hazards: [], controls: [] })];
      const rec = await saveJsa(base);
      jsaId = rec.id;
      jsaCur = rec;
      jsaMenu = false;
      render();
      window.scrollTo(0, 0);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const tiles = h('div', { class: 'rf-grid' }, listTemplates().map((t) => h('button', { class: 'rf-tile', type: 'button', onclick: () => start(t.id) }, h('span', { class: 'rf-ic', text: '📋' }), h('b', { text: t.title }), h('small', { text: t.steps + ' steps ready' }))));
  return [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← JSAs', onclick: () => { jsaMenu = false; render(); } }), card('Start from a template', 'Templates give you steps, hazards and controls to edit for your job.', tiles), h('button', { class: 'st-btn secondary', type: 'button', text: 'Start with a blank JSA', onclick: () => start('') })];
}

function jsaText(j) {
  const sum = jsaSummary(j);
  const lines = [j.number + ' · ' + j.title, 'Job: ' + j.job, 'Location: ' + j.location, 'Prepared by: ' + j.prepared_by + '   Reviewed by: ' + (j.reviewed_by || ''), 'Status: ' + j.status + (j.approved_by ? ' (approved by ' + j.approved_by + ')' : ''), ''];
  j.steps.forEach((s, i) => {
    const sc = stepScores(s);
    lines.push((i + 1) + '. ' + s.step, '   Hazards: ' + s.hazards.join('; '), '   Controls: ' + s.controls.map((c) => (c.in_place ? '[x] ' : '[ ] ') + c.text).join('; '), '   Risk: ' + sc.initial + ' ' + sc.initialBand.label + ' -> ' + sc.residual + ' ' + sc.residualBand.label + '   Owner: ' + (s.responsible || ''));
  });
  lines.push('', 'Highest residual risk: ' + (sum.residualBand ? sum.maxResidual + ' ' + sum.residualBand.label : '-'), 'Briefed: ' + (j.briefed || []).map((b) => b.name).join(', '));
  return lines.join('\n');
}

function lvlSelect(label, cur, onChange) {
  const lib = getLibrary();
  const items = label === 'L' ? lib.matrix.likelihood : lib.matrix.severity;
  const s = h('select', { class: 'st-select' }, items.map((x) => h('option', { value: String(x.n), text: x.n + ' ' + x.label })));
  s.value = String(cur);
  s.addEventListener('change', () => onChange(parseInt(s.value, 10)));
  return s;
}

function stepCard(j, s, idx, rerender) {
  const wrap = h('div', { class: 'op-step' });
  const scoreHost = h('div', { class: 'op-scores' });
  const msgHost = h('div', { class: 'op-warn' });
  const upd = () => {
    const sc = stepScores(s);
    scoreHost.replaceChildren(h('span', { class: 'rf-hint', text: 'Initial ' }), badge(sc.initial), h('span', { class: 'rf-hint', text: '  Residual ' }), badge(sc.residual));
    const v = validateStep(s);
    msgHost.replaceChildren(...v.errors.map((e) => h('div', { class: 'op-err', text: '✕ ' + e })), ...v.warnings.map((e) => h('div', { class: 'op-wn', text: '⚠ ' + e })));
  };
  const change = () => { upd(); scheduleSave(); refreshSummary(); };
  const ctlHost = h('div');
  const drawCtl = () => {
    ctlHost.replaceChildren(
      ...s.controls.map((c, ci) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = !!c.in_place;
        cb.addEventListener('change', () => { c.in_place = cb.checked; change(); });
        const ti = h('input', { class: 'st-input', type: 'text', value: c.text });
        ti.addEventListener('input', () => { c.text = ti.value; change(); });
        return h('div', { class: 'op-ctl' }, h('label', { class: 'op-inplace' }, cb, h('span', { text: 'In place' })), ti, h('button', { class: 'st-btn danger small', type: 'button', text: '✕', 'aria-label': 'Remove control', onclick: () => { s.controls.splice(ci, 1); drawCtl(); change(); } }));
      }),
      h('button', { class: 'st-btn secondary small', type: 'button', text: '+ Add control', onclick: () => { s.controls.push(newControl('')); drawCtl(); } })
    );
  };
  drawCtl();
  wrap.append(
    h('div', { class: 'op-top' }, h('b', { text: 'Step ' + (idx + 1) }), h('span', null, h('button', { class: 'st-btn secondary small', type: 'button', text: '↑', onclick: () => { if (idx > 0) { j.steps.splice(idx - 1, 0, j.steps.splice(idx, 1)[0]); rerender(); scheduleSave(); } } }), ' ', h('button', { class: 'st-btn secondary small', type: 'button', text: '↓', onclick: () => { if (idx < j.steps.length - 1) { j.steps.splice(idx + 1, 0, j.steps.splice(idx, 1)[0]); rerender(); scheduleSave(); } } }), ' ', h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete', onclick: () => { if (window.confirm('Delete this step?')) { j.steps.splice(idx, 1); rerender(); scheduleSave(); } } }))),
    field('What is done in this step', input(s.step, (v) => { s.step = v; change(); })),
    field('Hazards (one per line)', area(s.hazards.join('\n'), (v) => { s.hazards = v.split('\n').map((x) => x.trim()).filter(Boolean); change(); }, 'What could hurt someone and how', 3)),
    h('span', { class: 'st-label', text: 'Controls' }),
    ctlHost,
    field('Main control level (hierarchy)', select(getLibrary().hierarchy.map((x) => ({ id: x, label: x })), s.hierarchy, (v) => { s.hierarchy = v; change(); })),
    h('div', { class: 'op-grid2' }, field('Initial likelihood', lvlSelect('L', s.initial.l, (v) => { s.initial.l = v; change(); })), field('Initial severity', lvlSelect('S', s.initial.s, (v) => { s.initial.s = v; change(); })), field('Residual likelihood', lvlSelect('L', s.residual.l, (v) => { s.residual.l = v; change(); })), field('Residual severity', lvlSelect('S', s.residual.s, (v) => { s.residual.s = v; change(); }))),
    scoreHost,
    field('Responsible person', input(s.responsible, (v) => { s.responsible = v; scheduleSave(); })),
    msgHost
  );
  upd();
  return wrap;
}

let summaryHost = null;

function refreshSummary() {
  if (!summaryHost || !jsaCur) return;
  const r = jsaReadiness(jsaCur);
  const s = r.summary;
  summaryHost.replaceChildren(
    h('div', { class: 'op-top' }, h('span', null, 'Highest initial: ', s.maxInitial ? badge(s.maxInitial) : '-'), h('span', null, 'Highest residual: ', s.maxResidual ? badge(s.maxResidual) : '-')),
    s.requiredApprover ? h('p', { class: 'rf-hint', text: 'Approval level needed: ' + s.requiredApprover.role + '. ' + s.requiredApprover.band.action }) : null,
    h('div', { class: 'op-banner' + (r.ready ? ' ok' : '') }, r.ready ? h('b', { text: 'Ready to approve' }) : [h('b', { text: 'Before approval' }), h('ul', { class: 'rf-list' }, r.issues.map((x) => h('li', { text: x })))])
  );
}

async function jsaBuilder() {
  const j = jsaCur;
  const back = h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← JSAs', onclick: async () => { clearTimeout(saveTimer); await saveJsa(j).catch(() => null); jsaId = null; jsaCur = null; render(); } });
  savePill = h('span', { class: 'ob-status saved', text: 'Saved ✓' });
  const locked = j.status === 'approved';
  const nodes = [back];
  nodes.push(h('div', { class: 'rf-card' }, h('div', { class: 'op-top' }, h('b', { text: j.number || 'New JSA' }), savePill), h('span', { class: 'op-pill op-s-' + (locked ? 'active' : 'draft'), text: locked ? 'Approved by ' + j.approved_by : 'Draft' })));
  if (locked) {
    nodes.push(card('This JSA is approved', 'Reopen it to make changes. It will need approval again.', h('button', { class: 'st-btn secondary', type: 'button', text: 'Reopen for changes', onclick: async () => { const n = window.prompt('Your name?', ''); if (!n) return; jsaCur = await reopenJsa(j.id, n); render(); } })));
  }
  nodes.push(
    card('Job details', '', [
      field('JSA title', input(j.title, (v) => { j.title = v; scheduleSave(); })),
      field('Job description', area(j.job, (v) => { j.job = v; scheduleSave(); }, 'What is the job, where and with what equipment', 3)),
      field('Location', input(j.location, (v) => { j.location = v; scheduleSave(); })),
      field('Prepared by', input(j.prepared_by, (v) => { j.prepared_by = v; scheduleSave(); })),
      field('Reviewed by (competent person)', input(j.reviewed_by, (v) => { j.reviewed_by = v; scheduleSave(); })),
      field('Valid until (optional)', input(j.valid_until, (v) => { j.valid_until = v; scheduleSave(); }, 'date'))
    ])
  );
  const stepsHost = h('div');
  const drawSteps = () => {
    stepsHost.replaceChildren(...j.steps.map((s, i) => stepCard(j, s, i, drawSteps)), h('button', { class: 'st-btn secondary', type: 'button', text: '+ Add step', onclick: () => { j.steps.push(newStep({})); drawSteps(); scheduleSave(); } }));
    refreshSummary();
  };
  nodes.push(h('p', { class: 'rf-hint', text: getLibrary().jsa_rules.join(' · ') }));
  nodes.push(stepsHost);
  summaryHost = h('div', { class: 'rf-card' });
  nodes.push(summaryHost);

  const brief = h('div');
  const drawBrief = () => brief.replaceChildren(...(j.briefed || []).map((b, i) => h('div', { class: 'op-row' }, h('span', { text: b.name + (b.at ? ' · ' + fmt(b.at) : '') }), h('button', { class: 'st-btn danger small', type: 'button', text: '✕', onclick: () => { j.briefed.splice(i, 1); drawBrief(); scheduleSave(); refreshSummary(); } }))));
  const nm = h('input', { class: 'st-input', type: 'text', placeholder: 'Worker name' });
  drawBrief();
  nodes.push(card('Crew briefing', 'Brief the crew on every step before work. Record each person.', [h('ul', { class: 'rf-list' }, getLibrary().briefing.map((x) => h('li', { text: x }))), brief, h('div', { class: 'op-form' }, nm, h('button', { class: 'st-btn small', type: 'button', text: 'Add to briefing', onclick: () => { if (!nm.value.trim()) return; j.briefed = (j.briefed || []).concat([{ name: nm.value.trim(), at: new Date().toISOString() }]); nm.value = ''; drawBrief(); scheduleSave(); refreshSummary(); } }))]));

  if (!locked) {
    const aname = h('input', { class: 'st-input', type: 'text', placeholder: 'Approver full name' });
    const arank = select(getLibrary().approvers.map((a) => ({ id: String(a.rank), label: a.label })), '1', () => {});
    nodes.push(card('Approve the JSA', 'The approver level must match the highest residual risk.', [aname, arank, h('button', { class: 'st-btn', type: 'button', text: 'Approve JSA', onclick: async () => { try { clearTimeout(saveTimer); await saveJsa(j); jsaCur = await approveJsa(j.id, { name: aname.value, rank: parseInt(arank.value, 10) }); toast('JSA approved', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } })]));
  }
  nodes.push(
    card('Actions', '', h('div', { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Actions for open controls', onclick: async () => { try { clearTimeout(saveTimer); await saveJsa(j); const made = await jsaToActions(j.id); toast(made.length ? made.length + ' action(s) added to the Action Tracker' : 'No open controls without actions', made.length ? 'success' : 'info'); jsaCur = await getJsa(j.id); render(); } catch (e) { toast(e.message, 'error'); } } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share JSA', onclick: () => shareText('JSA ' + (j.number || ''), jsaText(j)) }),
      h('button', { class: 'st-btn danger', type: 'button', text: 'Delete JSA', onclick: async () => { if (!window.confirm('Delete this JSA?')) return; clearTimeout(saveTimer); if (j.id) await removeJsa(j.id); jsaId = null; jsaCur = null; render(); } })))
  );
  drawSteps();
  return nodes;
}

/* ---------- Risk matrix ---------- */

function matrixTab() {
  const lib = getLibrary();
  const grid = h('div', { class: 'op-matrix' });
  grid.appendChild(h('div', { class: 'op-mhead', text: 'Severity ↓ / Likelihood →' }));
  lib.matrix.likelihood.forEach((l) => grid.appendChild(h('div', { class: 'op-mhead', text: l.n + ' ' + l.label })));
  matrixGrid().forEach((row) => {
    const sv = lib.matrix.severity.find((x) => x.n === row[0].s);
    grid.appendChild(h('div', { class: 'op-mhead', text: sv.n + ' ' + sv.label }));
    row.forEach((c) => grid.appendChild(h('div', { class: 'op-mcell', style: 'background:' + c.band.color, text: String(c.score), title: c.band.label })));
  });
  const calc = { l: 3, s: 3 };
  const out = h('div', { class: 'op-banner' });
  const showCalc = () => {
    const sc = score(calc.l, calc.s);
    const a = approvalFor(sc);
    out.replaceChildren(h('b', null, 'Risk score ', badge(sc)), h('p', { class: 'rf-hint', text: a.band.action + ' Approval: ' + a.role + '.' }));
  };
  showCalc();
  return [
    card('5 x 5 risk matrix', lib.matrix.formula + '. ' + lib.matrix.note, grid),
    card('Risk bands and who approves', '', h('div', { class: 'rf-legal' }, lib.bands.map((b) => h('div', { style: 'border-left:6px solid ' + b.color }, h('b', { text: b.label + ' (' + b.min + ' to ' + b.max + ') · ' + b.approver }), b.action)))),
    card('Try a rating', '', [field('Likelihood', lvlSelect('L', 3, (v) => { calc.l = v; showCalc(); })), field('Severity', lvlSelect('S', 3, (v) => { calc.s = v; showCalc(); })), out]),
    card('Likelihood scale', '', h('ul', { class: 'rf-list' }, lib.matrix.likelihood.map((l) => h('li', { text: l.n + ' ' + l.label + ': ' + l.desc })))),
    card('Severity scale', '', h('ul', { class: 'rf-list' }, lib.matrix.severity.map((s) => h('li', { text: s.n + ' ' + s.label + ': ' + s.injury + '. ' + s.property + '. ' + s.environment + '.' }))))
  ];
}

/* ---------- Screen ---------- */

async function render() {
  if (!root) return;
  summaryHost = null;
  let body;
  try {
    if (tab === 'permits') body = permitId === 'new' ? await newPermitView() : permitId ? await permitDetail(permitId) : await permitsTab();
    else if (tab === 'jsa') body = await jsaTab();
    else body = matrixTab();
  } catch (e) {
    body = [h('p', { class: 'rf-sub', text: 'Could not load: ' + e.message })];
  }
  const banner = await missionBanner();
  if (!root) return;
  root.replaceChildren(
    h('div', { class: 'rf-wrap' }, h('h1', { class: 'rf-title', text: '📝 Permit to Work & JSA / HIRA' }), h('p', { class: 'rf-sub', text: 'Digital permits, isolation and gas-test sign-offs, expiry countdown and risk assessment. The official site permit procedure always takes priority.' }), banner, tabsBar(TABS, tab, (t) => { tab = t; permitId = null; jsaMenu = false; render(); }), ...[].concat(body).filter(Boolean))
  );
  tick();
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  ensureCss('css/ops.css');
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading permits…' })));
  await loadRegions();
  try {
    await Promise.all([loadPermitTypes(), loadRiskLibrary()]);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load permit data: ' + e.message })));
    return;
  }
  await checkExpiry();
  await render();
  tickTimer = setInterval(tick, 1000);
  expireTimer = setInterval(checkExpiry, 30000);
  const onSaved = (p) => {
    if (p && p.kind === 'ptw_permit' && tab === 'permits' && !permitId) render();
  };
  on(EVENTS.RECORD_SAVED, onSaved);
  handlers = [[EVENTS.RECORD_SAVED, onSaved]];
}

export function unmount() {
  clearInterval(tickTimer);
  clearInterval(expireTimer);
  clearTimeout(saveTimer);
  handlers.forEach(([e, fn]) => off(e, fn));
  handlers = [];
  if (jsaCur && jsaCur.id) saveJsa(jsaCur).catch(() => null);
  root = null;
  jsaCur = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
