/* NASUR - Reports module (Phase 4): A4 executive report preview, print / save PDF, one-tap share */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { getUserConfig } from '../services/config.js';
import { loadRegions } from '../services/regions.js';
import { loadCustomColumns, getReportTemplates } from '../services/templates.js';
import { DEFAULT_TEMPLATE, buildReportData, renderReportHtml, printReport, shareReport, downloadReportHtml, reportFileName, mailtoLink, periodFor } from '../services/reports.js';

export const id = 'reports';

const PREF_KEY = 'nasur.report.prefs';
const PERIODS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom', label: 'Custom' }
];

let root = null;
let st = null;
let previewHost = null;
let barHost = null;
let resizeFn = null;

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
  if (document.getElementById('rp-style')) return;
  const s = document.createElement('style');
  s.id = 'rp-style';
  s.textContent =
    '.rp-bar{position:sticky;top:0;z-index:6;display:flex;gap:6px;flex-wrap:wrap;padding:8px 0;background:Canvas}' +
    '.rp-bar .st-btn{min-height:42px;font-size:.85rem;padding:6px 12px}' +
    '.rp-preview{border:1px solid rgba(127,127,127,.45);border-radius:8px;overflow:hidden;background:#e9edf1;width:100%}' +
    '.rp-preview iframe{border:0;width:794px;transform-origin:0 0;background:#fff;display:block}' +
    '.rp-meta{font-size:.82rem;opacity:.8;margin:0}';
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

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ preparedBy: st.preparedBy, emailTo: st.emailTo, manHours: st.manHours, templateId: st.templateId }));
  } catch (e) {
    /* storage may be unavailable */
  }
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function input(key, type, placeholder) {
  const i = h('input', { class: 'st-input', type: type || 'text', placeholder: placeholder || '', value: st[key] || '', autocomplete: 'off' });
  i.addEventListener('input', () => {
    st[key] = i.value;
    savePrefs();
  });
  return i;
}

function currentTemplate() {
  if (st.templateId === 'default') return DEFAULT_TEMPLATE;
  const rec = st.templates.find((t) => t.id === st.templateId);
  return rec ? rec.payload : DEFAULT_TEMPLATE;
}

/* ---------- Preview ---------- */

function fitPreview(frame, wrap) {
  try {
    const doc = frame.contentDocument;
    const full = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    const width = wrap.clientWidth || 794;
    const scale = Math.min(1, width / 794);
    frame.style.height = full + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    wrap.style.height = Math.ceil(full * scale) + 'px';
  } catch (e) {
    /* ignore sizing errors */
  }
}

function showPreview() {
  previewHost.replaceChildren();
  const wrap = h('div', { class: 'rp-preview' });
  const frame = h('iframe', { title: 'A4 report preview', scrolling: 'no' });
  frame.addEventListener('load', () => {
    fitPreview(frame, wrap);
    setTimeout(() => fitPreview(frame, wrap), 500);
  });
  frame.srcdoc = st.html;
  wrap.appendChild(frame);
  previewHost.appendChild(wrap);
  resizeFn = () => fitPreview(frame, wrap);
}

function showBar() {
  const d = st.data;
  barHost.replaceChildren(
    h(
      'div',
      { class: 'rp-bar' },
      h('button', { class: 'st-btn', type: 'button', text: '🖨 Print / Save PDF', onclick: () => printReport(st.html) }),
      h('button', {
        class: 'st-btn',
        type: 'button',
        text: '📤 Share',
        onclick: async () => {
          try {
            const shared = await shareReport(st.html, reportFileName(d), 'HSE Report ' + d.reportNo + ' - ' + d.projectName);
            if (!shared) toast('Sharing is not available here, the report file was downloaded', 'info');
          } catch (e) {
            if (e && e.name !== 'AbortError') toast('Share failed: ' + e.message, 'error');
          }
        }
      }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '⬇ Download', onclick: () => downloadReportHtml(st.html, reportFileName(d)) }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '✉ Email draft', onclick: () => { window.location.href = mailtoLink(d, st.emailTo); } })
    ),
    h('p', { class: 'rp-meta', text: d.reportNo + ' · ' + d.observations.length + ' observations · ' + d.incidents.length + ' incidents · ' + d.actions.length + ' open actions' })
  );
}

async function generate(btn) {
  btn.disabled = true;
  btn.textContent = 'Building report…';
  try {
    await loadCustomColumns();
    const p = periodFor(st.period, st.from, st.to);
    const data = await buildReportData({
      period: st.period,
      from: p.from,
      to: p.to,
      preparedBy: st.preparedBy,
      manHours: parseFloat(st.manHours) || 0
    });
    st.data = data;
    st.html = renderReportHtml(data, currentTemplate());
    showBar();
    showPreview();
    toast('Report ready', 'success');
  } catch (e) {
    toast('Could not build report: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate report';
  }
}

/* ---------- Screen ---------- */

function render() {
  const periodChips = h('div', { class: 'st-chips' });
  PERIODS.forEach((p) => {
    periodChips.appendChild(
      h('button', {
        class: 'st-chip',
        type: 'button',
        text: p.label,
        'aria-pressed': st.period === p.id ? 'true' : 'false',
        onclick: () => {
          st.period = p.id;
          render();
        }
      })
    );
  });

  const tplSel = h('select', { class: 'st-select' }, h('option', { value: 'default', text: 'Standard executive report' }), st.templates.map((t) => h('option', { value: t.id, text: t.title })));
  tplSel.value = st.templateId;
  tplSel.addEventListener('change', () => {
    st.templateId = tplSel.value;
    savePrefs();
  });

  const gen = h('button', { class: 'st-btn', type: 'button', text: 'Generate report' });
  gen.addEventListener('click', () => generate(gen));

  barHost = h('div');
  previewHost = h('div');

  const controls = h(
    'section',
    { class: 'st-card' },
    h('h2', { text: 'Report settings' }),
    periodChips,
    st.period === 'custom' ? field('From', input('from', 'date')) : null,
    st.period === 'custom' ? field('To', input('to', 'date')) : null,
    field('Report template', tplSel),
    field('Prepared by', input('preparedBy', 'text', 'Your name and designation')),
    field('Man-hours worked (optional, for TRIR / LTIFR)', input('manHours', 'number', 'e.g. 125000')),
    field('Send email draft to', input('emailTo', 'email', 'manager@company.com')),
    gen
  );

  root.replaceChildren(h('div', { class: 'st-wrap' }, h('h1', { class: 'st-title', text: 'Reports' }), h('p', { class: 'st-sub', text: 'Formal A4 executive report with before and after photo proof' }), controls, barHost, previewHost));
  if (st.html) {
    showBar();
    showPreview();
  }
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureStyle();
  await loadRegions();
  await loadCustomColumns();
  const prefs = loadPrefs();
  const cfg = getUserConfig() || {};
  const templates = await getReportTemplates();
  st = {
    period: 'daily',
    from: periodFor('daily').from,
    to: periodFor('daily').to,
    preparedBy: prefs.preparedBy || cfg.displayName || cfg.userName || '',
    emailTo: prefs.emailTo || '',
    manHours: prefs.manHours || '',
    templateId: templates.some((t) => t.id === prefs.templateId) ? prefs.templateId : 'default',
    templates,
    html: '',
    data: null
  };
  render();
  resizeFn = null;
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (resizeFn) resizeFn();
}

export function unmount() {
  window.removeEventListener('resize', onResize);
  resizeFn = null;
  root = null;
  st = null;
  previewHost = null;
  barHost = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
