/* NASUR - Incidents & Near Misses + unified CAPA Action Tracker (Phase 4) */
import { EVENTS } from '../core/config.js';
import { emit, on, off } from '../core/eventbus.js';
import { hrefFor } from '../core/router.js';
import { loadRegions, formatDate, formatTime, getActiveRegionId } from '../services/regions.js';
import { getActiveProject } from '../services/clients.js';
import { processPhoto, pickPhoto } from '../services/photos.js';
import { sessionSet } from '../services/jarvis_core.js';
import { nowStamp, validateStamp } from '../services/observations.js';
import {
  SEVERITIES,
  INCIDENT_TYPES,
  INCIDENT_STATUSES,
  severityOf,
  classify,
  notificationHints,
  listIncidents,
  createIncident,
  updateIncident,
  removeIncident,
  generateCapa,
  closeIncident,
  summarizeIncidents,
  calcRates
} from '../services/incidents.js';
import {
  ACTION_STORE,
  ACTION_STATUSES,
  PRIORITIES,
  listActions,
  createAction,
  updateAction,
  completeAction,
  verifyAction,
  removeAction,
  summarizeActions,
  isOverdue,
  isClosed
} from '../services/actions.js';

export const id = 'incidents';

const HOURS_KEY = 'nasur.incidents.manhours';

let root = null;
let host = null;
let tab = 'incidents';
let incChip = '';
let actChip = 'open';
let query = '';
let projectId;
let incidents = [];
let actions = [];
let reloadTimer = null;
let handlers = [];
let activeRec = null;

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
  if (document.getElementById('in-style')) return;
  const s = document.createElement('style');
  s.id = 'in-style';
  s.textContent =
    '.in-tabs{display:flex;gap:6px}.in-tabs .st-btn{flex:1}' +
    '.in-card{border:1px solid rgba(127,127,127,.4);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;background:rgba(127,127,127,.08)}' +
    '.in-card.sev-lti,.in-card.sev-fatality{border-left:6px solid #dc2626}.in-card.sev-rwc,.in-card.sev-mtc{border-left:6px solid #f97316}.in-card.sev-first_aid{border-left:6px solid #eab308}.in-card.sev-near_miss{border-left:6px solid #16a34a}' +
    '.in-card.od{border-left:6px solid #dc2626}' +
    '.in-top{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:.85rem}.in-top b{font-size:.95rem}' +
    '.in-meta{font-size:.78rem;opacity:.75}.in-desc{font-size:.88rem;line-height:1.35}' +
    '.in-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.in-kpi{text-align:center;padding:8px 2px;border-radius:10px;background:rgba(127,127,127,.14)}' +
    '.in-kpi b{display:block;font-size:1.2rem}.in-kpi span{font-size:.68rem;opacity:.75}.in-kpi.bad b{color:#dc2626}' +
    '.in-photos{display:flex;gap:6px;flex-wrap:wrap}.in-photos img{width:72px;height:72px;object-fit:cover;border-radius:8px}' +
    '.in-check{display:flex;gap:10px;align-items:center;padding:6px 2px;font-size:.88rem}.in-check input{width:22px;height:22px}';
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

function stampText(date, time) {
  const d = new Date(date + 'T' + (time || '00:00') + ':00');
  return isNaN(d.getTime()) ? '-' : formatDate(d) + '  ' + formatTime(d);
}

function goTo(moduleId, fallback) {
  let href = fallback;
  try {
    href = hrefFor(moduleId);
  } catch (e) {
    /* use fallback */
  }
  window.location.assign(href);
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function inp(data, key, type, placeholder) {
  const i = h('input', { class: 'st-input', type: type || 'text', value: data[key] != null ? data[key] : '', placeholder: placeholder || '', autocomplete: 'off' });
  i.addEventListener('input', () => {
    data[key] = i.value;
  });
  return i;
}

function sel(data, key, options, onChange) {
  const s = h('select', { class: 'st-select' }, options.map((o) => h('option', { value: o.id, text: o.label })));
  s.value = data[key];
  s.addEventListener('change', () => {
    data[key] = s.value;
    if (onChange) onChange();
  });
  return s;
}

function area(data, key, placeholder, withMic) {
  const t = h('textarea', { class: 'st-input', rows: '3', placeholder: placeholder || '' });
  t.value = data[key] || '';
  t.addEventListener('input', () => {
    data[key] = t.value;
  });
  const row = h('div', { class: 'ob-field-row' }, t);
  if (withMic) {
    const b = h('button', { class: 'ob-mic', type: 'button', text: '🎙', 'aria-label': 'Dictate' });
    b.addEventListener('click', () => {
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
      rec.lang = 'en-IN';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            t.value = (t.value ? t.value + ' ' : '') + e.results[i][0].transcript.trim();
            data[key] = t.value;
          }
        }
      };
      rec.onend = () => {
        activeRec = null;
        b.classList.remove('on');
      };
      try {
        rec.start();
        activeRec = rec;
        b.classList.add('on');
      } catch (e) {
        activeRec = null;
      }
    });
    row.appendChild(b);
  }
  return row;
}

function openModal(children) {
  const modal = h('div', { class: 'ob-modal', role: 'dialog' }, children);
  const overlay = h('div', { class: 'ob-overlay' }, modal);
  const api = {
    el: modal,
    close() {
      if (activeRec) {
        try {
          activeRec.stop();
        } catch (e) {
          /* ignore */
        }
      }
      overlay.remove();
      if (api.onClose) api.onClose();
    }
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) api.close();
  });
  document.body.appendChild(overlay);
  return api;
}

/* ---------- Data ---------- */

async function load() {
  const p = await getActiveProject();
  projectId = p ? p.id : undefined;
  const f = projectId ? { projectId } : {};
  incidents = await listIncidents(f);
  actions = await listActions(f);
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    const a = document.activeElement;
    if (root && a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    await load();
    render();
  }, 500);
}

/* ---------- New incident ---------- */

async function newIncident() {
  const p = await getActiveProject();
  const st = nowStamp();
  const d = {
    date: st.date,
    time: st.time,
    type: 'Near Miss',
    severity: 'near_miss',
    location: p ? p.site || '' : '',
    contractor: p ? p.mainContractor || '' : '',
    activity: '',
    description: '',
    immediate_action: '',
    witnesses: '',
    medical_facility: '',
    lost_days: '',
    restricted_days: '',
    injured: { name: '', emp_id: '', role: '', contractor: '', body_part: '', nature: '' },
    photos: []
  };
  const flags = {};
  const stamp = h('div', { class: 'ob-stamp' });
  const warn = h('div', { class: 'ob-warn' });
  const updStamp = () => {
    stamp.textContent = 'Confirm: ' + stampText(d.date, d.time);
    const v = validateStamp(d.date, d.time);
    warn.textContent = !v.ok ? v.error : v.past ? 'Past entry. Please check the date and time are correct.' : '';
  };
  const dI = h('input', { class: 'st-input', type: 'date', value: d.date });
  const tI = h('input', { class: 'st-input', type: 'time', value: d.time });
  dI.addEventListener('input', () => { d.date = dI.value; updStamp(); });
  tI.addEventListener('input', () => { d.time = tI.value; updStamp(); });
  updStamp();

  const hints = h('ul', { class: 'st-list' });
  const personBox = h('div', { class: 'ob-field' });
  const daysBox = h('div', { class: 'ob-field' });
  const sevSel = sel(d, 'severity', SEVERITIES.map((s) => ({ id: s.id, label: s.label })), () => refreshSeverity());
  const refreshSeverity = () => {
    const sev = severityOf(d.severity);
    hints.replaceChildren(...notificationHints(getActiveRegionId(), d.severity).map((x) => h('li', { text: x })));
    personBox.replaceChildren();
    daysBox.replaceChildren();
    if (sev.weight >= 1) {
      personBox.append(h('span', { class: 'st-label', text: 'Person involved' }), field('Name', inp(d.injured, 'name')), field('Employee / ID no.', inp(d.injured, 'emp_id')), field('Role', inp(d.injured, 'role')), field('Employer / contractor', inp(d.injured, 'contractor')), field('Body part', inp(d.injured, 'body_part')), field('Nature of injury', inp(d.injured, 'nature')));
    }
    if (sev.id === 'lti' || sev.id === 'fatality') daysBox.append(field('Lost days', inp(d, 'lost_days', 'number')));
    if (sev.id === 'rwc') daysBox.append(field('Restricted work days', inp(d, 'restricted_days', 'number')));
  };
  const flagDefs = [
    ['firstAid', 'First aid was given'],
    ['medicalTreatment', 'Medical treatment beyond first aid'],
    ['restrictedDuty', 'Restricted or light duty'],
    ['lostTime', 'Lost time (days away from work)'],
    ['fatality', 'Fatality']
  ];
  const flagBox = h('div', { class: 'ob-field' }, h('span', { class: 'st-label', text: 'What happened to the person? (sets the severity)' }));
  flagDefs.forEach(([k, label]) => {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => {
      flags[k] = cb.checked;
      d.severity = classify(flags);
      sevSel.value = d.severity;
      d.type = d.severity === 'near_miss' ? 'Near Miss' : d.type === 'Near Miss' ? 'Injury / Illness' : d.type;
      typeSel.value = d.type;
      refreshSeverity();
    });
    flagBox.appendChild(h('label', { class: 'in-check' }, cb, h('span', { text: label })));
  });
  const typeSel = sel(d, 'type', INCIDENT_TYPES.map((t) => ({ id: t, label: t })));

  const photoRow = h('div', { class: 'in-photos' });
  const renderPhotos = () => {
    photoRow.replaceChildren(...d.photos.map((src, i) => h('img', { src, alt: 'Incident photo ' + (i + 1), onclick: () => { if (window.confirm('Remove this photo?')) { d.photos.splice(i, 1); renderPhotos(); } } })));
  };
  const addPhoto = async (capture) => {
    if (d.photos.length >= 6) return toast('Maximum 6 photos', 'error');
    const file = await pickPhoto(capture);
    if (!file) return;
    try {
      d.photos.push(await processPhoto(file, { label: 'INCIDENT', date: new Date(), location: d.location, project: p ? p.name : '' }));
      renderPhotos();
    } catch (e) {
      toast('Photo failed: ' + e.message, 'error');
    }
  };

  const save = h('button', { class: 'st-btn', type: 'button', text: 'Confirm date/time and save incident' });
  const m = openModal([
    h('h2', { text: 'Log incident or near miss' }),
    h('div', { class: 'ob-field' }, stamp, h('div', { class: 'ob-field-row' }, dI, tI), warn),
    field('Type', typeSel),
    flagBox,
    field('Severity', sevSel),
    hints,
    field('Location', inp(d, 'location')),
    field('Contractor', inp(d, 'contractor')),
    field('Activity at the time', inp(d, 'activity')),
    field('What happened', area(d, 'description', 'Facts only. What, where, who, what was happening.', true)),
    field('Immediate action taken', area(d, 'immediate_action', 'First aid, area isolated, supervisor informed…', true)),
    personBox,
    daysBox,
    field('Witnesses', inp(d, 'witnesses')),
    field('Hospital / clinic (if any)', inp(d, 'medical_facility')),
    h('div', { class: 'ob-field' }, h('span', { class: 'st-label', text: 'Photos (' + 'up to 6, date, time and location are stamped)' }), photoRow, h('div', { class: 'ob-field-row' }, h('button', { class: 'st-btn secondary', type: 'button', text: 'Camera', onclick: () => addPhoto(true) }), h('button', { class: 'st-btn secondary', type: 'button', text: 'Gallery', onclick: () => addPhoto(false) }))),
    save,
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => m.close() })
  ]);
  refreshSeverity();
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const rec = await createIncident({ ...d });
      m.close();
      incidents.unshift(rec);
      render();
      toast(rec.incident_no + ' logged', 'success');
      openDetail(rec);
    } catch (e) {
      toast(e.message, 'error');
      save.disabled = false;
    }
  });
}

/* ---------- Incident detail ---------- */

function startRca(inc) {
  sessionSet('rca_incident', inc.id);
  goTo('rca_coach', '#/rca-coach');
}

async function openDetail(inc0) {
  const inc = (incidents.find((x) => x.id === inc0.id)) || inc0;
  const sev = severityOf(inc.severity);
  const linked = actions.filter((a) => a.source_id === inc.id);
  const open = linked.filter((a) => !isClosed(a)).length;
  const remarks = h('input', { class: 'st-input', type: 'text', placeholder: 'Closure remarks' });
  const m = openModal([
    h('h2', { text: inc.incident_no + ' · ' + sev.label }),
    h('p', { class: 'st-hint', text: stampText(inc.date, inc.time) + ' · ' + [inc.location, inc.contractor, inc.activity].filter(Boolean).join(' · ') }),
    h('p', { class: 'in-desc', text: inc.description }),
    inc.immediate_action ? h('p', { class: 'st-hint', text: 'Immediate action: ' + inc.immediate_action }) : null,
    inc.injured && inc.injured.name ? h('p', { class: 'st-hint', text: 'Person: ' + [inc.injured.name, inc.injured.emp_id, inc.injured.role, inc.injured.body_part, inc.injured.nature].filter(Boolean).join(' · ') }) : null,
    (inc.photos || []).length ? h('div', { class: 'in-photos' }, inc.photos.map((s) => h('img', { src: s, alt: 'Incident photo' }))) : null,
    h('span', { class: 'st-label', text: 'Notify' }),
    h('ul', { class: 'st-list' }, notificationHints(inc.country, inc.severity).map((x) => h('li', { text: x }))),
    h('p', { class: 'st-hint', text: 'Status: ' + (INCIDENT_STATUSES.find((s) => s.id === inc.status) || { label: inc.status }).label + ' · RCA: ' + (inc.rca && inc.rca.rootCauses && inc.rca.rootCauses.length ? inc.rca.rootCauses.length + ' root cause(s)' : 'not started') + ' · Actions: ' + (linked.length ? open + ' open of ' + linked.length : 'none') }),
    h('button', { class: 'st-btn', type: 'button', text: inc.rca ? 'Continue Just-Culture RCA' : 'Start Just-Culture RCA', onclick: () => { m.close(); startRca(inc); } }),
    inc.rca && (inc.rca.rootCauses || []).length ? h('button', { class: 'st-btn secondary', type: 'button', text: 'Create CAPA actions from RCA', onclick: async () => { try { const made = await generateCapa(inc.id); toast(made.length + ' action(s) created', 'success'); m.close(); await load(); render(); } catch (e) { toast(e.message, 'error'); } } }) : null,
    inc.status !== 'closed' ? h('div', { class: 'ob-field' }, remarks, h('button', { class: 'st-btn secondary', type: 'button', text: 'Close incident', onclick: async () => { try { await closeIncident(inc.id, remarks.value); toast('Incident closed', 'success'); m.close(); await load(); render(); } catch (e) { toast(e.message, 'error'); } } })) : null,
    h('button', { class: 'st-btn danger', type: 'button', text: 'Delete incident', onclick: async () => { if (!window.confirm('Delete ' + inc.incident_no + '?')) return; await removeIncident(inc.id); m.close(); await load(); render(); } }),
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Close window', onclick: () => m.close() })
  ]);
}

/* ---------- Action modal ---------- */

function actionModal(existing) {
  const a = existing ? { ...existing } : { title: '', description: '', responsible: '', target_date: '', priority: 'medium', status: 'open', kind: 'corrective' };
  const save = h('button', { class: 'st-btn', type: 'button', text: 'Save action' });
  const m = openModal([
    h('h2', { text: existing ? existing.action_no : 'New action' }),
    field('Action', area(a, 'title', 'What must be done', true)),
    field('Responsible person', inp(a, 'responsible')),
    field('Target date', inp(a, 'target_date', 'date')),
    field('Priority', sel(a, 'priority', PRIORITIES.map((p) => ({ id: p.id, label: p.label })))),
    field('Status', sel(a, 'status', ACTION_STATUSES)),
    field('Type', sel(a, 'kind', [{ id: 'corrective', label: 'Corrective' }, { id: 'preventive', label: 'Preventive' }])),
    save,
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => m.close() })
  ]);
  save.addEventListener('click', async () => {
    try {
      if (existing) await updateAction(existing.id, { title: a.title, description: a.title, responsible: a.responsible, target_date: a.target_date, priority: a.priority, status: a.status, kind: a.kind });
      else await createAction({ ...a, description: a.title, source_type: 'manual', projectId: projectId || null });
      m.close();
      await load();
      render();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

/* ---------- Tabs ---------- */

function sevBadge(inc) {
  return severityOf(inc.severity).label;
}

function incidentsView() {
  const chips = [
    ['', 'All'],
    ['open', 'Open'],
    ['near_miss', 'Near Miss'],
    ['recordable', 'Recordable'],
    ['lti', 'LTI / Fatality']
  ];
  const q = query.trim().toLowerCase();
  const list = incidents.filter((r) => {
    const sev = severityOf(r.severity);
    if (incChip === 'open' && r.status === 'closed') return false;
    if (incChip === 'near_miss' && sev.id !== 'near_miss') return false;
    if (incChip === 'recordable' && !sev.recordable) return false;
    if (incChip === 'lti' && sev.weight < 4) return false;
    if (q && (r.incident_no + ' ' + r.description + ' ' + r.location + ' ' + r.contractor + ' ' + r.activity).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  const sum = summarizeIncidents(incidents);
  const search = h('input', { class: 'st-input ob-search', type: 'search', placeholder: 'Search incidents…', value: query });
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });
  const listHost = h('div', { class: 'ob-search-results' });
  const renderList = () => {
    const qq = query.trim().toLowerCase();
    const rows = incidents.filter((r) => {
      const sev = severityOf(r.severity);
      if (incChip === 'open' && r.status === 'closed') return false;
      if (incChip === 'near_miss' && sev.id !== 'near_miss') return false;
      if (incChip === 'recordable' && !sev.recordable) return false;
      if (incChip === 'lti' && sev.weight < 4) return false;
      if (qq && (r.incident_no + ' ' + r.description + ' ' + r.location + ' ' + r.contractor + ' ' + r.activity).toLowerCase().indexOf(qq) < 0) return false;
      return true;
    });
    listHost.replaceChildren(
      ...(rows.length
        ? rows.map((r) => {
            const open = actions.filter((a) => a.source_id === r.id && !isClosed(a)).length;
            return h(
              'div',
              { class: 'in-card sev-' + r.severity, onclick: () => openDetail(r), style: 'cursor:pointer' },
              h('div', { class: 'in-top' }, h('b', { text: r.incident_no + ' · ' + sevBadge(r) }), h('span', { text: stampText(r.date, r.time) })),
              h('div', { class: 'in-desc', text: r.description.slice(0, 160) }),
              h('div', { class: 'in-meta', text: [r.location, r.contractor, (INCIDENT_STATUSES.find((s) => s.id === r.status) || {}).label, open ? open + ' action(s) open' : ''].filter(Boolean).join(' · ') })
            );
          })
        : [h('div', { class: 'ob-empty', text: incidents.length ? 'No incidents match this filter.' : 'No incidents logged yet.' })])
    );
  };
  const hours = (() => {
    try {
      return localStorage.getItem(HOURS_KEY) || '';
    } catch (e) {
      return '';
    }
  })();
  const rateBox = h('div', { class: 'st-hint' });
  const hoursIn = h('input', { class: 'st-input', type: 'number', placeholder: 'Man-hours worked (for TRIR / LTIFR)', value: hours });
  const updRates = () => {
    try {
      localStorage.setItem(HOURS_KEY, hoursIn.value);
    } catch (e) {
      /* ignore */
    }
    const r = calcRates(incidents, parseFloat(hoursIn.value));
    rateBox.textContent = r.manHours ? 'TRIR (per 200,000 h): ' + r.trir + ' · LTIFR (per 1,000,000 h): ' + r.ltifr + ' · Recordables: ' + r.recordables : 'Enter man-hours to see TRIR and LTIFR.';
  };
  hoursIn.addEventListener('input', updRates);
  updRates();
  renderList();

  return [
    h('div', { class: 'in-kpis' }, [
      ['Total', sum.total],
      ['Open', sum.open],
      ['Near miss', sum.nearMisses],
      ['Recordable', sum.recordable],
      ['LTI', sum.lti + sum.fatalities]
    ].map((k, i) => h('div', { class: 'in-kpi' + (i === 4 && k[1] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] })))),
    h('div', { class: 'ob-tools' }, h('button', { class: 'st-btn', type: 'button', text: '+ Log Incident', onclick: newIncident }), h('a', { class: 'st-btn secondary', href: hrefSafe('history_search', '#/history-search'), style: 'text-decoration:none;text-align:center', text: '🔎 Smart Search' }), search),
    h('div', { class: 'ob-chips' }, chips.map((c) => h('button', { class: 'st-chip', type: 'button', text: c[1], 'aria-pressed': incChip === c[0] ? 'true' : 'false', onclick: () => { incChip = c[0]; render(); } }))),
    listHost,
    h('section', { class: 'st-card' }, h('h2', { text: 'Safety rates' }), hoursIn, rateBox)
  ];
}

function hrefSafe(moduleId, fallback) {
  try {
    return hrefFor(moduleId);
  } catch (e) {
    return fallback;
  }
}

function actionsView() {
  const sum = summarizeActions(actions);
  const chips = [
    ['open', 'Open'],
    ['overdue', 'Overdue'],
    ['done', 'Done'],
    ['all', 'All']
  ];
  const rows = actions.filter((a) => {
    if (actChip === 'open') return !isClosed(a);
    if (actChip === 'overdue') return isOverdue(a);
    if (actChip === 'done') return isClosed(a);
    return true;
  });
  const cards = rows.length
    ? rows.map((a) => {
        const od = isOverdue(a);
        return h(
          'div',
          { class: 'in-card' + (od ? ' od' : '') },
          h('div', { class: 'in-top' }, h('b', { text: a.action_no + (a.source_no ? ' · ' + a.source_no : '') }), h('span', { text: (od ? 'OVERDUE · ' : '') + a.priority })),
          h('div', { class: 'in-desc', text: a.title }),
          h('div', { class: 'in-meta', text: [a.responsible && 'Owner: ' + a.responsible, a.target_date && 'Due ' + formatDate(a.target_date), a.status.replace('_', ' ')].filter(Boolean).join(' · ') }),
          h(
            'div',
            { class: 'st-chips' },
            a.status === 'open' ? h('button', { class: 'st-btn secondary small', type: 'button', text: 'Start', onclick: async () => { await updateAction(a.id, { status: 'in_progress' }); await load(); render(); } }) : null,
            !isClosed(a) ? h('button', { class: 'st-btn small', type: 'button', text: 'Done', onclick: async () => { const r = window.prompt('Closure remarks (what was done)?', ''); if (r === null) return; await completeAction(a.id, r); await load(); render(); } }) : null,
            a.status === 'done' ? h('button', { class: 'st-btn small', type: 'button', text: 'Verify', onclick: async () => { const r = window.prompt('Verification remarks?', ''); if (r === null) return; await verifyAction(a.id, r); await load(); render(); } }) : null,
            h('button', { class: 'st-btn secondary small', type: 'button', text: 'Edit', onclick: () => actionModal(a) }),
            h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete', onclick: async () => { if (!window.confirm('Delete ' + a.action_no + '?')) return; await removeAction(a.id); await load(); render(); } })
          )
        );
      })
    : [h('div', { class: 'ob-empty', text: 'No actions here.' })];
  return [
    h('div', { class: 'in-kpis' }, [
      ['Open', sum.open],
      ['Overdue', sum.overdue],
      ['Due today', sum.dueToday],
      ['Due 3 days', sum.dueSoon],
      ['Critical', sum.critical]
    ].map((k, i) => h('div', { class: 'in-kpi' + (i === 1 && k[1] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] })))),
    h('div', { class: 'ob-tools' }, h('button', { class: 'st-btn', type: 'button', text: '+ New Action', onclick: () => actionModal(null) })),
    h('div', { class: 'ob-chips' }, chips.map((c) => h('button', { class: 'st-chip', type: 'button', text: c[1], 'aria-pressed': actChip === c[0] ? 'true' : 'false', onclick: () => { actChip = c[0]; render(); } }))),
    h('div', { class: 'ob-search-results' }, cards)
  ];
}

function render() {
  if (!root) return;
  const tabs = h(
    'div',
    { class: 'in-tabs' },
    h('button', { class: 'st-btn' + (tab === 'incidents' ? '' : ' secondary'), type: 'button', text: 'Incidents', onclick: () => { tab = 'incidents'; render(); } }),
    h('button', { class: 'st-btn' + (tab === 'actions' ? '' : ' secondary'), type: 'button', text: 'Action Tracker', onclick: () => { tab = 'actions'; render(); } })
  );
  host = h('div', { class: 'ob-wrap', style: 'padding:0' }, tab === 'incidents' ? incidentsView() : actionsView());
  root.replaceChildren(h('div', { class: 'ob-wrap' }, h('h1', { class: 'st-title', text: tab === 'incidents' ? 'Incidents & Near Misses' : 'CAPA Action Tracker' }), tabs, host));
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  ensureStyle();
  await loadRegions();
  await load();
  render();
  const onSaved = (p) => {
    if (p && (p.store === ACTION_STORE || p.store === 'incidents')) scheduleReload();
  };
  const onProject = () => scheduleReload();
  on(EVENTS.RECORD_SAVED, onSaved);
  on(EVENTS.PROJECT_CHANGED, onProject);
  handlers = [[EVENTS.RECORD_SAVED, onSaved], [EVENTS.PROJECT_CHANGED, onProject]];
}

export function unmount() {
  handlers.forEach(([e, fn]) => off(e, fn));
  handlers = [];
  clearTimeout(reloadTimer);
  if (activeRec) {
    try {
      activeRec.stop();
    } catch (e) {
      /* ignore */
    }
  }
  activeRec = null;
  root = null;
  host = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
