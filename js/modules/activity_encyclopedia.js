/* NASUR - A-to-Z Activity Encyclopedia module (Phase 5) */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { hrefFor } from '../core/router.js';
import { loadRegions, formatDate, formatTime } from '../services/regions.js';
import { sessionGet, sessionSet, sessionDelete } from '../services/jarvis_core.js';
import { nowStamp, validateStamp } from '../services/observations.js';
import {
  loadEncyclopedia,
  getLoadError,
  listActivities,
  listIndustries,
  getActivity,
  legalForAll,
  walkthroughSteps,
  HIERARCHY_ORDER,
  typicalFindings,
  createObservationFromActivity,
  buildTbtText,
  saveTbt,
  saveInspectionChecklist,
  shareText
} from '../services/encyclopedia.js';

export const id = 'activity_encyclopedia';

let root = null;
let activeId = null;
let industry = '';
let query = '';

function toast(message, type) {
  emit(EVENTS.TOAST, { message, type: type || 'info' });
}

function ensureCss(href) {
  const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => (l.getAttribute('href') || '').indexOf(href) >= 0);
  if (has) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
  }
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    if (Array.isArray(c)) c.forEach((x) => x && el.appendChild(x.nodeType ? x : document.createTextNode(String(x))));
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function hrefSafe(moduleId, fallback) {
  try {
    return hrefFor(moduleId);
  } catch (e) {
    return fallback;
  }
}

function stampText(date, time) {
  const d = new Date(date + 'T' + (time || '00:00') + ':00');
  return isNaN(d.getTime()) ? '-' : formatDate(d) + '   ' + formatTime(d);
}

/* ---------- Modal: create observation with date and time confirmation ---------- */

function observationModal(a) {
  const st = nowStamp();
  const d = { date: st.date, time: st.time, finding: '', risk: (a.bridge && a.bridge.risk_rating) || 'High', location: '', contractor: '' };
  const stamp = h('div', { class: 'ob-stamp' });
  const warn = h('div', { class: 'ob-warn' });
  const save = h('button', { class: 'st-btn', type: 'button', text: 'Confirm date/time and save to Observations' });
  const upd = () => {
    stamp.textContent = 'Confirm: ' + stampText(d.date, d.time);
    const v = validateStamp(d.date, d.time);
    warn.textContent = !v.ok ? v.error : v.past ? 'Past entry. Check the date and time are correct.' : '';
    save.disabled = !v.ok;
  };
  const dI = h('input', { class: 'st-input', type: 'date', value: d.date });
  const tI = h('input', { class: 'st-input', type: 'time', value: d.time });
  dI.addEventListener('input', () => { d.date = dI.value; upd(); });
  tI.addEventListener('input', () => { d.time = tI.value; upd(); });
  const ta = h('textarea', { class: 'st-input', rows: '3', placeholder: 'What did you see? Be specific.' });
  ta.addEventListener('input', () => { d.finding = ta.value; });
  const chips = h('div', { class: 'rf-chips' }, typicalFindings(a).map((t) => h('button', { class: 'st-chip', type: 'button', text: t, onclick: () => { ta.value = t; d.finding = t; } })));
  const risk = h('select', { class: 'st-select' }, ['Low', 'Medium', 'High', 'Critical'].map((r) => h('option', { value: r, text: r })));
  risk.value = d.risk;
  risk.addEventListener('change', () => { d.risk = risk.value; });
  const loc = h('input', { class: 'st-input', type: 'text', placeholder: 'Exact location' });
  loc.addEventListener('input', () => { d.location = loc.value; });
  const con = h('input', { class: 'st-input', type: 'text', placeholder: 'Contractor (optional)' });
  con.addEventListener('input', () => { d.contractor = con.value; });
  const modal = h('div', { class: 'ob-modal', role: 'dialog' }, [
    h('h2', { text: 'Create observation · ' + a.title }),
    h('p', { class: 'rf-hint', text: 'Hazard category, activity and the legal clause for your country are filled in for you.' }),
    h('div', { class: 'ob-field' }, stamp, h('div', { class: 'ob-field-row' }, dI, tI), warn),
    h('span', { class: 'st-label', text: 'Quick findings' }),
    chips,
    ta,
    h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: 'Risk rating' }), risk),
    loc,
    con,
    save,
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => overlay.remove() })
  ]);
  const overlay = h('div', { class: 'ob-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } }, modal);
  document.body.appendChild(overlay);
  upd();
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const rec = await createObservationFromActivity(a, { finding: d.finding, risk: d.risk, location: d.location, contractor: d.contractor, date: d.date, time: d.time });
      overlay.remove();
      toast(rec.obs_no + ' added to the Observations sheet', 'success');
    } catch (e) {
      toast(e.message, 'error');
      save.disabled = false;
    }
  });
}

/* ---------- Detail view ---------- */

function section(title, hint, children) {
  const c = h('section', { class: 'rf-card' }, h('h2', { text: title }));
  if (hint) c.appendChild(h('p', { class: 'rf-hint', text: hint }));
  [].concat(children || []).forEach((x) => x && c.appendChild(x));
  return c;
}

function walkthrough(a) {
  const blocks = walkthroughSteps(a).map((s) => h('div', { class: 'rf-step ' + (s.tone === 'look' ? '' : s.tone) }, h('h3', { text: s.title }), h('ol', { class: 'rf-num' }, s.items.map((i) => h('li', { text: i })))));
  return section('Visual inspection walkthrough', 'Walk the job in this order. Stand where the worker stands.', h('div', { class: 'rf-walk' }, blocks));
}

function hierarchy(a) {
  const rows = HIERARCHY_ORDER.map((hlv) => {
    const items = (a.controls && a.controls[hlv.id]) || [];
    return h('div', null, h('b', null, hlv.label + ' ', h('small', { text: '· ' + hlv.note })), items.length ? h('ul', { class: 'rf-list' }, items.map((i) => h('li', { text: i }))) : h('span', { class: 'rf-hint', text: 'None practical for this task.' }));
  });
  return section('Hierarchy of controls', 'Start at the top. Use PPE only for what remains.', h('div', { class: 'rf-hier' }, rows));
}

function checklistCard(a) {
  const key = 'enc_chk_' + a.id;
  const done = new Set(sessionGet(key, []));
  const bar = h('i', { style: 'width:0%' });
  const label = h('p', { class: 'rf-hint' });
  const upd = () => {
    const pct = a.checklist.length ? Math.round((done.size / a.checklist.length) * 100) : 0;
    bar.style.width = pct + '%';
    label.textContent = done.size + ' of ' + a.checklist.length + ' checked';
  };
  const rows = a.checklist.map((t, i) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = done.has(i);
    const row = h('label', { class: 'rf-check' + (cb.checked ? ' done' : '') }, cb, h('span', { text: t }));
    cb.addEventListener('change', () => {
      if (cb.checked) done.add(i);
      else done.delete(i);
      row.classList.toggle('done', cb.checked);
      sessionSet(key, Array.from(done));
      upd();
    });
    return row;
  });
  upd();
  return section('Pre-start checklist', 'Tap each item as you verify it on site.', [
    h('div', { class: 'rf-bar-progress' }, bar),
    label,
    ...rows,
    h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn secondary small', type: 'button', text: 'Reset ticks', onclick: () => { sessionSet(key, []); render(); } }), h('button', { class: 'st-btn secondary small', type: 'button', text: 'Save as my checklist', onclick: async () => { try { await saveInspectionChecklist(a); toast('Checklist saved to JARVIS Studio library', 'success'); } catch (e) { toast(e.message, 'error'); } } }))
  ]);
}

function legalCard(a) {
  const rows = legalForAll(a).sort((x, y) => (y.active ? 1 : 0) - (x.active ? 1 : 0));
  return section('Country-specific legal standards', 'Your active country is shown first. Always verify the current text before audit use.', h('div', { class: 'rf-legal' }, rows.map((r) => h('div', { class: r.active ? 'on' : '' }, h('b', { text: r.label + (r.active ? ' · your country' : '') }), r.text))));
}

function tbtCard(a) {
  const t = a.tbt || {};
  return section('Toolbox talk: ' + (t.title || a.title), 'Two minutes. Say it, ask the question, sign the sheet.', [
    h('ol', { class: 'rf-num' }, (t.points || []).map((p) => h('li', { text: p }))),
    h('p', { class: 'st-label', text: 'Ask the crew: ' + (t.question || '') }),
    h(
      'div',
      { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '📤 Share TBT', onclick: async () => { try { const shared = await shareText('Toolbox talk: ' + (t.title || a.title), buildTbtText(a)); toast(shared ? 'Shared' : 'Copied to clipboard', 'success'); } catch (e) { toast(e.message, 'error'); } } }),
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Save TBT', onclick: async () => { try { await saveTbt(a); toast('TBT saved to JARVIS Studio library', 'success'); } catch (e) { toast(e.message, 'error'); } } })
    )
  ]);
}

function detail(a) {
  return h(
    'div',
    { class: 'rf-wrap' },
    h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← All activities', onclick: () => { activeId = null; render(); window.scrollTo(0, 0); } }),
    h('div', { class: 'rf-card' }, h('div', { class: 'rf-hero' }, h('span', { class: 'rf-ic', text: a.icon }), h('div', null, h('h1', { class: 'rf-title', text: a.title }), h('p', { class: 'rf-sub', text: a.category + ' · ' + (a.industries || []).join(', ').replace(/_/g, ' ') }))), h('p', { class: 'rf-sub', text: a.summary }), h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '➕ Create observation', onclick: () => observationModal(a) }), h('a', { class: 'st-btn secondary', href: hrefSafe('observations', '#/observations'), style: 'text-align:center;text-decoration:none', text: 'Open Observations sheet' }))),
    walkthrough(a),
    section('Main hazards', '', h('div', null, (a.hazards || []).map((x) => h('span', { class: 'rf-pill high', text: x })))),
    hierarchy(a),
    section('Required PPE', 'Standards: EN (Europe and Gulf), ANSI / ISEA (USA), CSA (Canada), IS (India).', h('ul', { class: 'rf-list' }, (a.ppe || []).map((x) => h('li', { text: x })))),
    section('Mandatory permits and records', '', h('ul', { class: 'rf-list' }, (a.permits || []).map((x) => h('li', { text: x })))),
    checklistCard(a),
    legalCard(a),
    tbtCard(a)
  );
}

/* ---------- List view ---------- */

function list() {
  const industries = listIndustries();
  const rows = listActivities({ industry, q: query });
  const grid = h('div', { class: 'rf-grid' });
  const count = h('span', { class: 'rf-count' });
  const draw = () => {
    const items = listActivities({ industry, q: query });
    count.textContent = items.length + ' activit' + (items.length === 1 ? 'y' : 'ies');
    grid.replaceChildren(
      ...(items.length
        ? items.map((a) => h('button', { class: 'rf-tile', type: 'button', onclick: () => { activeId = a.id; render(); window.scrollTo(0, 0); } }, h('span', { class: 'rf-ic', text: a.icon }), h('b', { text: a.title }), h('small', { text: a.category })))
        : [h('p', { class: 'rf-hint', text: 'No activity matches. Try another word.' })])
    );
  };
  const search = h('input', { class: 'st-input', type: 'search', placeholder: 'Search: welding, fall, gas, crane…', value: query, 'aria-label': 'Search activities' });
  search.addEventListener('input', () => { query = search.value; draw(); });
  const chips = h('div', { class: 'rf-chips' }, [{ id: '', label: 'All' }].concat(industries).map((i) => h('button', { class: 'st-chip', type: 'button', text: i.label, 'aria-pressed': industry === i.id ? 'true' : 'false', onclick: () => { industry = i.id; render(); } })));
  draw();
  return h(
    'div',
    { class: 'rf-wrap' },
    h('h1', { class: 'rf-title', text: 'A-to-Z Activity Encyclopedia' }),
    h('p', { class: 'rf-sub', text: 'Offline field guide: visual walkthrough, hazards, controls, PPE, permits and local legal standards for each activity.' }),
    search,
    chips,
    count,
    grid,
    rows.length ? null : null
  );
}

function render() {
  if (!root) return;
  const a = activeId ? getActivity(activeId) : null;
  root.replaceChildren(a ? detail(a) : list());
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  ensureCss('css/reference.css');
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading encyclopedia…' })));
  await loadRegions();
  const all = await loadEncyclopedia();
  if (!all.length) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('h1', { class: 'rf-title', text: 'Activity Encyclopedia' }), h('p', { class: 'rf-sub', text: 'Could not load the activity files. ' + getLoadError() })));
    return;
  }
  const wanted = sessionGet('encyclopedia_activity', null);
  if (wanted) {
    sessionDelete('encyclopedia_activity');
    if (getActivity(wanted)) activeId = wanted;
  }
  render();
}

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
