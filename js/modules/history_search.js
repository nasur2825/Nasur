/* NASUR - Smart History Search module (Phase 4) */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { hrefFor } from '../core/router.js';
import { loadRegions, formatDate, formatTime } from '../services/regions.js';
import { getActiveProject } from '../services/clients.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { loadCustomColumns } from '../services/templates.js';
import { getColumns, colLetter } from '../services/observations.js';
import { search } from '../services/search.js';

export const id = 'history_search';

const SUGGESTIONS = [
  'When did that welding issue happen?',
  'Open high risk this month',
  'Near misses last week',
  'Overdue actions',
  'Scaffold problems last 30 days',
  'Incidents with injury this year'
];

const VOICE = [
  { id: 'ta', label: 'தமிழ்', bcp: 'ta-IN' },
  { id: 'en', label: 'English', bcp: 'en-IN' },
  { id: 'hi', label: 'हिन्दी', bcp: 'hi-IN' },
  { id: 'ar', label: 'العربية', bcp: 'ar-AE' }
];

let root = null;
let resultHost = null;
let inputEl = null;
let typeChip = '';
let scopeAll = false;
let last = null;
let timer = null;
let activeRec = null;
let project = null;

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

function ensureStyle() {
  if (document.getElementById('hs-style')) return;
  const s = document.createElement('style');
  s.id = 'hs-style';
  s.textContent =
    '.hs-answer{border:2px solid #0a84ff;background:rgba(10,132,255,.1);border-radius:12px;padding:12px;font-size:.92rem;line-height:1.45}' +
    '.hs-card{border:1px solid rgba(127,127,127,.4);border-radius:12px;padding:10px 12px;background:rgba(127,127,127,.08);cursor:pointer;display:flex;flex-direction:column;gap:4px}' +
    '.hs-top{display:flex;justify-content:space-between;gap:8px;font-size:.82rem;flex-wrap:wrap}.hs-top b{font-size:.92rem}' +
    '.hs-type{font-size:.68rem;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(127,127,127,.25);text-transform:uppercase;letter-spacing:.04em}' +
    '.hs-type.observation{background:rgba(10,132,255,.25)}.hs-type.incident{background:rgba(220,38,38,.25)}.hs-type.action{background:rgba(22,163,74,.25)}' +
    '.hs-title{font-size:.88rem;line-height:1.35}.hs-sub{font-size:.76rem;opacity:.75}' +
    '.hs-thumbs{display:flex;gap:6px}.hs-thumbs img{width:64px;height:48px;object-fit:cover;border-radius:6px}' +
    '.hs-ok{color:#16a34a;font-weight:700}.hs-open{color:#d97706;font-weight:700}.hs-od{color:#dc2626;font-weight:700}' +
    '.hs-kv{display:grid;grid-template-columns:120px 1fr;gap:4px 10px;font-size:.84rem}.hs-kv b{opacity:.75;font-weight:600}';
  document.head.appendChild(s);
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

function when(r) {
  const d = r.time ? new Date(r.date + 'T' + r.time + ':00') : null;
  return formatDate(r.date) + (d && !isNaN(d.getTime()) ? '  ' + formatTime(d) : '');
}

/* ---------- Search ---------- */

async function run(text) {
  const q = String(text || '').trim();
  if (!q) {
    resultHost.replaceChildren(h('p', { class: 'st-hint', text: 'Type a question or tap a suggestion.' }));
    return;
  }
  resultHost.replaceChildren(h('p', { class: 'st-hint', text: 'Searching…' }));
  try {
    await loadCustomColumns();
    last = await search(q, { projectId: scopeAll || !project ? undefined : project.id, limit: 80 });
    showResults();
  } catch (e) {
    resultHost.replaceChildren(h('p', { class: 'st-hint', text: 'Search failed: ' + e.message }));
  }
}

function showResults() {
  if (!last) return;
  const rows = last.results.filter((r) => !typeChip || r.type === typeChip);
  const nodes = [h('div', { class: 'hs-answer', text: last.answer })];
  if (!rows.length) {
    resultHost.replaceChildren(...nodes);
    return;
  }
  rows.forEach((r) => {
    const statusClass = r.overdue ? 'hs-od' : r.closed ? 'hs-ok' : 'hs-open';
    nodes.push(
      h(
        'div',
        { class: 'hs-card', onclick: () => openDetail(r) },
        h('div', { class: 'hs-top' }, h('span', null, h('span', { class: 'hs-type ' + r.type, text: r.type }), ' ', h('b', { text: r.no })), h('span', { text: when(r) })),
        h('div', { class: 'hs-title', text: String(r.title || '').slice(0, 180) }),
        h('div', { class: 'hs-sub', text: [r.subtitle, r.risk && 'Risk: ' + r.risk].filter(Boolean).join(' · ') }),
        h('div', { class: 'hs-sub' }, h('span', { class: statusClass, text: (r.overdue ? 'OVERDUE · ' : '') + r.status })),
        r.photos.length ? h('div', { class: 'hs-thumbs' }, r.photos.map((p) => h('img', { src: p, alt: 'Photo' }))) : null
      )
    );
  });
  resultHost.replaceChildren(...nodes);
}

function openDetail(r) {
  const rec = r.record;
  const pairs = [];
  if (r.type === 'observation') {
    getColumns().forEach((c, i) => {
      if (c.type === 'photo') return;
      const v = rec[c.key];
      if (v) pairs.push([colLetter(i) + ' · ' + c.label, c.type === 'date' ? formatDate(v) : v]);
    });
  } else if (r.type === 'incident') {
    [['Incident no', rec.incident_no], ['Date', when(rec)], ['Severity', r.risk], ['Type', rec.type], ['Location', rec.location], ['Contractor', rec.contractor], ['Activity', rec.activity], ['Description', rec.description], ['Immediate action', rec.immediate_action], ['Witnesses', rec.witnesses], ['Status', rec.status], ['Closure remarks', rec.closure_remarks]].forEach((p) => p[1] && pairs.push(p));
  } else {
    [['Action no', rec.action_no], ['Source', rec.source_no], ['Action', rec.title], ['Responsible', rec.responsible], ['Target date', rec.target_date && formatDate(rec.target_date)], ['Priority', rec.priority], ['Status', r.status], ['Closed on', rec.closure_date && formatDate(rec.closure_date)], ['Closure remarks', rec.closure_remarks]].forEach((p) => p[1] && pairs.push(p));
  }
  const photos = r.type === 'observation' ? [['Before', rec.photo_before], ['After', rec.photo_after]].filter((x) => x[1]) : (rec.photos || []).map((p, i) => ['Photo ' + (i + 1), p]);
  const modal = h('div', { class: 'ob-modal', role: 'dialog' }, [
    h('h2', { text: r.no }),
    h('div', { class: 'hs-kv' }, pairs.map((p) => [h('b', { text: p[0] }), h('span', { text: String(p[1]) })])),
    ...photos.map((p) => h('div', { class: 'ob-field' }, h('span', { text: p[0] }), h('img', { class: 'ob-bigphoto', src: p[1], alt: p[0] }))),
    r.type === 'incident' || r.type === 'action' ? h('a', { class: 'st-btn secondary', href: hrefSafe('incidents', '#/incidents'), style: 'text-align:center;text-decoration:none', text: 'Open in Incidents and Action Tracker' }) : h('a', { class: 'st-btn secondary', href: hrefSafe('observations', '#/observations'), style: 'text-align:center;text-decoration:none', text: 'Open in Observations sheet' }),
    h('button', { class: 'st-btn', type: 'button', text: 'Close', onclick: () => overlay.remove() })
  ]);
  const overlay = h('div', { class: 'ob-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } }, modal);
  document.body.appendChild(overlay);
}

function hrefSafe(moduleId, fallback) {
  try {
    return hrefFor(moduleId);
  } catch (e) {
    return fallback;
  }
}

/* ---------- Voice ---------- */

function voice(btn) {
  if (activeRec) {
    try {
      activeRec.stop();
    } catch (e) {
      /* ignore */
    }
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input is not supported in this browser', 'error');
  const rec = new SR();
  const lang = VOICE.find((v) => v.id === (getSettings().voiceLang || 'en'));
  rec.lang = lang ? lang.bcp : 'en-IN';
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript.trim();
    inputEl.value = t;
    run(t);
  };
  rec.onend = () => {
    activeRec = null;
    btn.classList.remove('on');
  };
  try {
    rec.start();
    activeRec = rec;
    btn.classList.add('on');
  } catch (e) {
    activeRec = null;
  }
}

/* ---------- Screen ---------- */

function render() {
  inputEl = h('input', { class: 'st-input', type: 'search', placeholder: 'Ask: When did that welding issue happen?', autocomplete: 'off', 'aria-label': 'Search history' });
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(inputEl.value), 450);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      run(inputEl.value);
    }
  });
  const mic = h('button', { class: 'ob-mic', type: 'button', text: '🎙', 'aria-label': 'Voice search' });
  mic.addEventListener('click', () => voice(mic));
  const langSel = h('select', { class: 'st-select', 'aria-label': 'Voice language' }, VOICE.map((v) => h('option', { value: v.id, text: v.label })));
  langSel.value = getSettings().voiceLang || 'en';
  langSel.addEventListener('change', () => saveSettings({ voiceLang: langSel.value }));

  const types = [['', 'All'], ['observation', 'Observations'], ['incident', 'Incidents'], ['action', 'Actions']];
  const typeRow = h('div', { class: 'ob-chips' }, types.map((t) => h('button', { class: 'st-chip', type: 'button', text: t[1], 'aria-pressed': typeChip === t[0] ? 'true' : 'false', onclick: () => { typeChip = t[0]; render(); if (last) showResults(); inputEl.value = last ? last.query.raw : ''; } })));
  const scopeBtn = h('button', { class: 'st-chip', type: 'button', text: scopeAll || !project ? 'All projects' : project.name, 'aria-pressed': 'true', onclick: () => { scopeAll = !scopeAll; render(); if (last) run(last.query.raw); } });

  const sug = h('div', { class: 'ob-chips' }, SUGGESTIONS.map((s) => h('button', { class: 'st-chip', type: 'button', text: s, onclick: () => { inputEl.value = s; run(s); } })));
  resultHost = h('div', { class: 'ob-search-results' }, h('p', { class: 'st-hint', text: 'Search across observations, incidents and actions. Ask in plain words: dates, risk, status and topics are understood.' }));

  root.replaceChildren(
    h(
      'div',
      { class: 'ob-wrap' },
      h('h1', { class: 'st-title', text: 'Smart History Search' }),
      h('div', { class: 'ob-field-row' }, inputEl, mic),
      h('div', { class: 'st-row' }, scopeBtn, langSel),
      typeRow,
      sug,
      resultHost
    )
  );
  if (last) {
    inputEl.value = last.query.raw;
    showResults();
  }
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  ensureStyle();
  await loadRegions();
  await loadCustomColumns();
  project = await getActiveProject();
  render();
  inputEl.focus();
}

export function unmount() {
  clearTimeout(timer);
  if (activeRec) {
    try {
      activeRec.stop();
    } catch (e) {
      /* ignore */
    }
  }
  activeRec = null;
  root = null;
  resultHost = null;
  inputEl = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
