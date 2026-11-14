/* NASUR - Observations module (Phase 4): mobile-first live Excel sheet, A to AB + custom columns */
import { EVENTS } from '../core/config.js';
import { emit, on, off } from '../core/eventbus.js';
import { loadRegions, formatDate, formatTime } from '../services/regions.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { getActiveProject } from '../services/clients.js';
import { loadCustomColumns } from '../services/templates.js';
import { processPhoto, pickPhoto } from '../services/photos.js';
import { ACTION_STORE } from '../services/actions.js';
import {
  getColumns,
  colLetter,
  listObservations,
  createObservation,
  createDraft,
  deleteObservation,
  updateField,
  flushAll,
  onSaveStatus,
  findRepeatHazards,
  parseBatchText,
  saveBatch,
  validateStamp,
  nowStamp,
  todayIso,
  nowTime,
  shiftFor,
  buildShiftWeather,
  suggestLegalClause,
  isOverdue,
  downloadCsv,
  downloadExcel
} from '../services/observations.js';

export const id = 'observations';

const PAGE = 50;
const REPEAT_KEYS = ['contractor', 'activity', 'hazard_category', 'risk_rating'];
const VOICE_LANGS = [
  { id: 'ta', label: 'தமிழ்', bcp: 'ta-IN' },
  { id: 'en', label: 'English', bcp: 'en-IN' },
  { id: 'hi', label: 'हिन्दी', bcp: 'hi-IN' },
  { id: 'ar', label: 'العربية', bcp: 'ar-AE' }
];

let root = null;
let rows = [];
let chip = '';
let query = '';
let visible = PAGE;
let tableHost = null;
let alertHost = null;
let countEl = null;
let pill = null;
let unsubStatus = null;
let reloadTimer = null;
let repeatTimer = null;
let activeRec = null;
let handlers = [];
const dismissed = new Set();

/* ---------- Small helpers ---------- */

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

function stampText(date, time) {
  const d = new Date(date + 'T' + (time || '00:00') + ':00');
  return isNaN(d.getTime()) ? '-' : formatDate(d) + '   ' + formatTime(d);
}

function isClosedRow(r) {
  return r.status === 'Closed' || r.status === 'Verified';
}

/* ---------- Modal ---------- */

function openModal(children) {
  const modal = h('div', { class: 'ob-modal', role: 'dialog' }, children);
  const overlay = h('div', { class: 'ob-overlay' }, modal);
  const api = {
    el: modal,
    close() {
      stopVoice();
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

/* Date and time confirmation block */
function stampFields(initial) {
  const st = nowStamp();
  const data = { date: (initial && initial.date) || st.date, time: (initial && initial.time) || st.time };
  const stamp = h('div', { class: 'ob-stamp' });
  const warn = h('div', { class: 'ob-warn' });
  const dI = h('input', { class: 'st-input', type: 'date', value: data.date });
  const tI = h('input', { class: 'st-input', type: 'time', value: data.time });
  const listeners = [];
  const update = () => {
    data.date = dI.value;
    data.time = tI.value;
    stamp.textContent = 'Confirm: ' + stampText(data.date, data.time);
    const v = validateStamp(data.date, data.time);
    warn.textContent = !v.ok ? v.error : v.past ? 'Past entry (pocket note). Please check the date and time are correct.' : '';
    listeners.forEach((fn) => fn(v));
  };
  dI.addEventListener('input', update);
  tI.addEventListener('input', update);
  const el = h('div', { class: 'ob-field' }, stamp, h('div', { class: 'ob-field-row' }, dI, tI), warn);
  update();
  return { el, get: () => ({ ...data }), valid: () => validateStamp(data.date, data.time).ok, onChange: (fn) => listeners.push(fn) };
}

/* ---------- Voice ---------- */

function bcpFor(langId) {
  const f = VOICE_LANGS.find((l) => l.id === langId);
  return f ? f.bcp : 'en-IN';
}

function stopVoice() {
  if (activeRec) {
    try {
      activeRec.stop();
    } catch (e) {
      /* ignore */
    }
    activeRec = null;
  }
}

/* Starts dictation. onFinal(text) gets each finished phrase, onInterim(text) the live words. Returns stop(). */
function startVoice(onFinal, onInterim, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('Voice input is not supported in this browser', 'error');
    if (onEnd) onEnd();
    return null;
  }
  stopVoice();
  const rec = new SR();
  rec.lang = bcpFor(getSettings().voiceLang);
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) onFinal(t.trim());
      else interim += t;
    }
    if (onInterim) onInterim(interim);
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow microphone access to use voice', 'error');
  };
  rec.onend = () => {
    if (activeRec === rec) activeRec = null;
    if (onEnd) onEnd();
  };
  try {
    rec.start();
    activeRec = rec;
  } catch (e) {
    if (onEnd) onEnd();
    return null;
  }
  return () => {
    try {
      rec.stop();
    } catch (e) {
      /* ignore */
    }
  };
}

function voiceLangSelect() {
  const s = h('select', { class: 'st-select', 'aria-label': 'Voice language' });
  VOICE_LANGS.forEach((l) => {
    const o = h('option', { value: l.id, text: l.label });
    if (l.id === (getSettings().voiceLang || 'en')) o.selected = true;
    s.appendChild(o);
  });
  s.addEventListener('change', () => saveSettings({ voiceLang: s.value }));
  return s;
}

function micButton(onFinal) {
  let stop = null;
  const b = h('button', { class: 'ob-mic', type: 'button', text: '🎙', 'aria-label': 'Dictate' });
  const reset = () => {
    b.classList.remove('on');
    stop = null;
  };
  b.addEventListener('click', () => {
    if (stop) {
      stop();
      reset();
      return;
    }
    stop = startVoice(onFinal, null, reset);
    if (stop) b.classList.add('on');
  });
  return b;
}

/* ---------- Filtering ---------- */

function filtered() {
  const q = query.trim().toLowerCase();
  const cols = getColumns().filter((c) => c.type !== 'photo');
  const curShift = shiftFor(nowTime());
  const today = todayIso();
  return rows.filter((r) => {
    if (chip === 'open' && isClosedRow(r)) return false;
    if (chip === 'high' && !(r.risk_rating === 'High' || r.risk_rating === 'Critical')) return false;
    if (chip === 'overdue' && !isOverdue(r)) return false;
    if (chip === 'shift' && !(r.date === today && shiftFor(r.time) === curShift)) return false;
    if (q && cols.map((c) => r[c.key] || '').join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}

/* ---------- Cell editors ---------- */

function afterChange(row, key, value, scope) {
  row[key] = value;
  updateField(row.id, key, value);
  const find = (k) => (scope || root).querySelector('[data-id="' + row.id + '"][data-key="' + k + '"]');

  if (key === 'hazard_category' && !String(row.legal_clause || '').trim()) {
    const clause = suggestLegalClause(value, row.country);
    row.legal_clause = clause;
    updateField(row.id, 'legal_clause', clause);
    const el = find('legal_clause');
    if (el) el.value = clause;
  }
  if (key === 'status') {
    if (isClosedRow(row) && !row.closure_date) {
      row.closure_date = todayIso();
      const el = find('closure_date');
      if (el) el.value = row.closure_date;
    } else if (row.status === 'Open' && row.closure_date) {
      row.closure_date = '';
      const el = find('closure_date');
      if (el) el.value = '';
    }
  }
  if (key === 'status' || key === 'target_date') {
    const el = find('target_date');
    if (el) el.classList.toggle('ob-od', isOverdue(row));
  }
  if (key === 'risk_rating') {
    document.querySelectorAll('tr[data-row="' + row.id + '"]').forEach((tr) => {
      tr.className = 'ob-risk-' + (value || 'none');
    });
  }
  if (key === 'date' || key === 'time') {
    const v = validateStamp(row.date, row.time);
    if (!v.ok) toast(v.error, 'error');
  }
  if (REPEAT_KEYS.includes(key)) scheduleRepeat(row);
}

function autosize(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(180, t.scrollHeight) + 'px';
}

function editorFor(row, col, opts) {
  const o = opts || {};
  const attrs = { class: 'ob-cell', 'data-id': row.id, 'data-key': col.key, 'aria-label': col.label };
  let el;
  if (col.type === 'select') {
    el = h('select', attrs, h('option', { value: '', text: '' }), col.options.map((x) => h('option', { value: x, text: x })));
    el.value = row[col.key] || '';
    el.addEventListener('change', () => afterChange(row, col.key, el.value, o.scope));
  } else if (col.type === 'long') {
    el = h('textarea', { ...attrs, rows: '1' });
    el.value = row[col.key] || '';
    el.addEventListener('input', () => {
      autosize(el);
      afterChange(row, col.key, el.value, o.scope);
    });
    el.addEventListener('focus', () => autosize(el));
    if (o.sheet) setTimeout(() => autosize(el), 0);
  } else {
    const type = col.type === 'date' ? 'date' : col.type === 'time' ? 'time' : col.type === 'number' ? 'text' : 'text';
    el = h('input', { ...attrs, type, autocomplete: 'off' });
    if (col.type === 'number') el.setAttribute('inputmode', 'decimal');
    el.value = row[col.key] || '';
    el.addEventListener('input', () => afterChange(row, col.key, el.value, o.scope));
    el.addEventListener('change', () => afterChange(row, col.key, el.value, o.scope));
  }
  if (col.key === 'target_date' && isOverdue(row)) el.classList.add('ob-od');
  return el;
}

/* ---------- Photos ---------- */

async function doPhoto(row, key, capture, scope) {
  const file = await pickPhoto(capture);
  if (!file) return;
  toast('Processing photo…');
  try {
    const url = await processPhoto(file, {
      label: key === 'photo_before' ? 'BEFORE' : 'AFTER',
      date: new Date(),
      location: row.location,
      project: row.project,
      obsNo: row.obs_no
    });
    row[key] = url;
    updateField(row.id, key, url);
    refreshPhoto(row, key, scope);
    toast('Photo saved', 'success');
  } catch (e) {
    toast('Photo failed: ' + e.message, 'error');
  }
}

function photoInner(row, key) {
  return row[key] ? h('img', { src: row[key], alt: key }) : h('span', { text: '📷' });
}

function refreshPhoto(row, key, scope) {
  document.querySelectorAll('button.ob-photo[data-id="' + row.id + '"][data-key="' + key + '"]').forEach((b) => b.replaceChildren(photoInner(row, key)));
  const big = document.querySelector('img.ob-bigphoto[data-id="' + row.id + '"][data-key="' + key + '"]');
  if (big) {
    if (row[key]) big.src = row[key];
    else big.remove();
  }
}

function photoMenu(row, key) {
  const label = key === 'photo_before' ? 'Before photo' : 'After photo';
  const m = openModal([
    h('h2', { text: label + ' · ' + row.obs_no }),
    row[key] ? h('img', { class: 'ob-bigphoto', src: row[key], alt: label }) : null,
    h('button', { class: 'st-btn', type: 'button', text: 'Take photo (camera)', onclick: () => { m.close(); doPhoto(row, key, true); } }),
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Choose from gallery', onclick: () => { m.close(); doPhoto(row, key, false); } }),
    row[key] ? h('button', { class: 'st-btn danger', type: 'button', text: 'Remove photo', onclick: () => { row[key] = ''; updateField(row.id, key, ''); refreshPhoto(row, key); m.close(); } }) : null,
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => m.close() })
  ]);
}

/* ---------- Repeat-hazard alert ---------- */

function scheduleRepeat(row) {
  clearTimeout(repeatTimer);
  repeatTimer = setTimeout(async () => {
    const list = await findRepeatHazards(row);
    if (!list.length) return;
    const key = row.id + ':' + list[0].id;
    if (dismissed.has(key)) return;
    showAlert(row, list, key);
  }, 800);
}

function showAlert(row, list, key) {
  if (!alertHost) return;
  alertHost.replaceChildren(
    h(
      'div',
      { class: 'ob-alert' },
      h('b', { text: 'Repeat hazard alert · ' + row.obs_no }),
      h('div', { text: 'A similar high-risk observation was recorded recently for the same contractor or activity:' }),
      h('ul', null, list.map((x) => h('li', { text: x.obs_no + ' · ' + formatDate(x.date) + ' · ' + x.risk + ' · ' + [x.contractor, x.activity].filter(Boolean).join(' / ') + ' · ' + x.status + (x.description ? ' · ' + x.description : '') }))),
      h('button', { class: 'st-btn secondary small', type: 'button', text: 'Dismiss', onclick: () => { dismissed.add(key); alertHost.replaceChildren(); } })
    )
  );
}

/* ---------- Row detail sheet ---------- */

function openSheet(row) {
  const cols = getColumns();
  const fields = cols.map((col, idx) => {
    const label = colLetter(idx) + ' · ' + col.label;
    if (col.type === 'readonly') return h('div', { class: 'ob-field' }, h('span', { text: label }), h('div', { class: 'ob-stamp', text: row[col.key] }));
    if (col.type === 'photo') {
      const b = h('button', { class: 'ob-photo st-btn secondary', type: 'button', 'data-id': row.id, 'data-key': col.key, onclick: () => photoMenu(row, col.key) }, photoInner(row, col.key));
      return h('div', { class: 'ob-field' }, h('span', { text: label }), b);
    }
    const ed = editorFor(row, col, { sheet: true, scope: document });
    ed.classList.add('st-input');
    const wrap = h('div', { class: 'ob-field-row' }, ed);
    if (col.type === 'text' || col.type === 'long') {
      wrap.appendChild(
        micButton((text) => {
          const v = (ed.value ? ed.value + ' ' : '') + text;
          ed.value = v;
          if (col.type === 'long') autosize(ed);
          afterChange(row, col.key, v, document);
        })
      );
    }
    return h('div', { class: 'ob-field' }, h('span', { text: label }), wrap);
  });
  const m = openModal([
    h('div', { class: 'ob-field-row' }, h('h2', { text: row.obs_no, style: 'flex:1' }), voiceLangSelect()),
    fields,
    h('button', {
      class: 'st-btn danger',
      type: 'button',
      text: 'Delete row',
      onclick: async () => {
        if (!window.confirm('Delete ' + row.obs_no + '? This cannot be undone.')) return;
        await deleteObservation(row.id);
        rows = rows.filter((r) => r.id !== row.id);
        m.close();
        renderTable();
      }
    }),
    h('button', { class: 'st-btn', type: 'button', text: 'Done', onclick: () => m.close() })
  ]);
  m.onClose = () => renderTable();
}

/* ---------- Sheet table ---------- */

function buildHead(cols) {
  const tr = h('tr');
  cols.forEach((c, i) => {
    const th = h('th', { style: 'min-width:' + c.width + 'px', class: i === 0 ? 'ob-f1' : i === 1 ? 'ob-f2' : '' }, colLetter(i), h('small', { text: c.label }));
    tr.appendChild(th);
  });
  return h('thead', null, tr);
}

function buildRow(row, cols) {
  const tr = h('tr', { 'data-row': row.id, class: 'ob-risk-' + (row.risk_rating || 'none') });
  cols.forEach((c, i) => {
    const td = h('td', { class: i === 0 ? 'ob-f1' : i === 1 ? 'ob-f2' : '' });
    if (c.type === 'readonly') {
      td.appendChild(h('button', { class: 'ob-rowno', type: 'button', onclick: () => openSheet(row) }, row[c.key], row.backfilled ? h('small', { text: 'pocket note' }) : h('small', { text: 'tap to open' })));
    } else if (c.type === 'photo') {
      td.appendChild(h('button', { class: 'ob-photo', type: 'button', 'data-id': row.id, 'data-key': c.key, 'aria-label': c.label, onclick: () => photoMenu(row, c.key) }, photoInner(row, c.key)));
    } else {
      td.appendChild(editorFor(row, c));
    }
    tr.appendChild(td);
  });
  return tr;
}

function renderTable() {
  if (!tableHost) return;
  const cols = getColumns();
  const list = filtered();
  const scroll = tableHost.querySelector('.ob-scroll');
  const top = scroll ? scroll.scrollTop : 0;
  const left = scroll ? scroll.scrollLeft : 0;
  countEl.textContent = list.length + ' of ' + rows.length + ' rows';
  if (!list.length) {
    tableHost.replaceChildren(h('div', { class: 'ob-empty', text: rows.length ? 'No rows match this filter.' : 'No observations yet. Tap + New Row, Voice, or Pocket Notes.' }));
    return;
  }
  const tbody = h('tbody');
  list.slice(0, visible).forEach((r) => tbody.appendChild(buildRow(r, cols)));
  const table = h('table', { class: 'ob-table' }, buildHead(cols), tbody);
  const sc = h('div', { class: 'ob-scroll' }, table);
  const nodes = [sc];
  if (list.length > visible) nodes.push(h('button', { class: 'st-btn secondary ob-more', type: 'button', text: 'Show more (' + (list.length - visible) + ')', onclick: () => { visible += PAGE; renderTable(); } }));
  tableHost.replaceChildren(...nodes);
  sc.scrollTop = top;
  sc.scrollLeft = left;
  sc.querySelectorAll('textarea.ob-cell').forEach(autosize);
}

/* ---------- New row, voice row, pocket notes ---------- */

async function newRow() {
  const draft = await createDraft();
  const sf = stampFields({ date: draft.date, time: draft.time });
  const ok = h('button', { class: 'st-btn', type: 'button', text: 'Confirm and add row' });
  sf.onChange((v) => {
    ok.disabled = !v.ok;
  });
  const m = openModal([
    h('h2', { text: 'New observation' }),
    h('p', { class: 'st-hint', text: 'Check the date and time before the row is created.' }),
    sf.el,
    ok,
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => m.close() })
  ]);
  ok.addEventListener('click', async () => {
    if (!sf.valid()) return;
    const s = sf.get();
    try {
      const rec = await createObservation({ ...draft, date: s.date, time: s.time, shift_weather: buildShiftWeather(s.time) });
      rows.unshift(rec);
      chip = '';
      m.close();
      renderChips();
      renderTable();
      toast(rec.obs_no + ' added', 'success');
      const first = tableHost.querySelector('[data-id="' + rec.id + '"][data-key="location"]');
      if (first) first.focus();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function voiceRow() {
  createDraft().then((draft) => {
    const sf = stampFields({ date: draft.date, time: draft.time });
    const text = h('textarea', { class: 'st-input', placeholder: 'Tap the mic and speak the observation…' });
    let stop = null;
    const mic = h('button', { class: 'st-btn', type: 'button', text: '🎙 Start speaking' });
    const reset = () => {
      stop = null;
      mic.textContent = '🎙 Start speaking';
      mic.classList.remove('danger');
    };
    mic.addEventListener('click', () => {
      if (stop) {
        stop();
        reset();
        return;
      }
      stop = startVoice(
        (t) => {
          text.value = (text.value ? text.value + ' ' : '') + t;
        },
        null,
        reset
      );
      if (stop) {
        mic.textContent = '⏹ Stop';
        mic.classList.add('danger');
      }
    });
    const save = h('button', { class: 'st-btn', type: 'button', text: 'Confirm and save row' });
    sf.onChange((v) => {
      save.disabled = !v.ok;
    });
    const m = openModal([
      h('div', { class: 'ob-field-row' }, h('h2', { text: 'Voice to row', style: 'flex:1' }), voiceLangSelect()),
      mic,
      text,
      sf.el,
      save,
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => m.close() })
    ]);
    save.addEventListener('click', async () => {
      const spoken = text.value.trim();
      if (!spoken) return toast('Nothing recorded yet', 'error');
      if (!sf.valid()) return;
      const s = sf.get();
      const parsed = parseBatchText(spoken, { date: s.date, time: s.time })[0];
      try {
        const rec = await createObservation({
          ...draft,
          date: s.date,
          time: s.time,
          shift_weather: buildShiftWeather(s.time),
          description: parsed ? parsed.description : spoken,
          risk_rating: parsed && parsed.risk_rating ? parsed.risk_rating : '',
          location: (parsed && parsed.location) || draft.location,
          activity: (parsed && parsed.activity) || ''
        });
        rows.unshift(rec);
        m.close();
        renderTable();
        toast(rec.obs_no + ' saved from voice', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
}

function pocketNotes() {
  const sf = stampFields({});
  const ta = h('textarea', { class: 'st-input', placeholder: '07:30 | Bay 3 | Welding | No fire blanket under welding High\n09:10 Worker without helmet near crane, Medium\n# 12/11/2026\n14:00 Spill near store room' });
  const preview = h('ul', { class: 'ob-preview' });
  const save = h('button', { class: 'st-btn', type: 'button', text: 'Save entries' });
  let drafts = [];
  const refresh = () => {
    const d = sf.get();
    drafts = parseBatchText(ta.value, { date: d.date, time: d.time });
    preview.replaceChildren(...drafts.slice(0, 30).map((x) => h('li', { text: stampText(x.date, x.time) + ' · ' + (x.location ? x.location + ' · ' : '') + x.description + (x.risk_rating ? ' · ' + x.risk_rating : '') })));
    save.textContent = 'Save ' + drafts.length + ' entr' + (drafts.length === 1 ? 'y' : 'ies');
    save.disabled = !drafts.length;
  };
  ta.addEventListener('input', refresh);
  sf.onChange(refresh);
  const m = openModal([
    h('h2', { text: 'Pocket-note batch entry' }),
    h('p', { class: 'st-hint', text: 'Type one note per line, with the real time first. Use | to split location, activity and description. Put a risk word (Low, Medium, High, Critical) at the end. Start a line with # and a date to change the day. Default date and time below are used when a line has none.' }),
    sf.el,
    ta,
    preview,
    save,
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => m.close() })
  ]);
  save.addEventListener('click', async () => {
    if (!drafts.length) return;
    save.disabled = true;
    try {
      const base = await createDraft();
      const saved = await saveBatch(drafts, { project: base.project, contractor: base.contractor, reported_by: base.reported_by, location: base.location, status: 'Open' });
      rows = saved.slice().reverse().concat(rows);
      rows.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
      m.close();
      renderTable();
      toast(saved.length + ' pocket notes saved', 'success');
    } catch (e) {
      toast(e.message, 'error');
      save.disabled = false;
    }
  });
  refresh();
}

/* ---------- Screen ---------- */

const CHIPS = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'high', label: 'High Risk' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'shift', label: 'My Shift' }
];

let chipsHost = null;

function renderChips() {
  if (!chipsHost) return;
  chipsHost.replaceChildren(
    ...CHIPS.map((c) =>
      h('button', {
        class: 'st-chip',
        type: 'button',
        text: c.label,
        'aria-pressed': chip === c.id ? 'true' : 'false',
        onclick: () => {
          chip = c.id;
          visible = PAGE;
          renderChips();
          renderTable();
        }
      })
    )
  );
}

function setPill(state, detail) {
  if (!pill) return;
  pill.className = 'ob-status ' + state;
  if (state === 'saving') pill.textContent = 'Saving…';
  else if (state === 'saved') pill.textContent = 'Saved ✓ ' + nowTime();
  else pill.textContent = 'Save failed' + (detail ? ': ' + detail : '');
}

async function load() {
  const project = await getActiveProject();
  rows = await listObservations(project ? { projectId: project.id } : {});
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    const a = document.activeElement;
    if (root && a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    await flushAll().catch(() => null);
    await load();
    renderTable();
  }, 600);
}

function build() {
  pill = h('span', { class: 'ob-status saved', text: 'Saved ✓' });
  alertHost = h('div');
  chipsHost = h('div', { class: 'ob-chips' });
  tableHost = h('div');
  countEl = h('span', { class: 'ob-count' });
  const search = h('input', { class: 'st-input ob-search', type: 'search', placeholder: 'Search rows…', 'aria-label': 'Search rows' });
  search.addEventListener('input', () => {
    query = search.value;
    visible = PAGE;
    renderTable();
  });
  const exportRows = () => filtered();
  root.replaceChildren(
    h(
      'div',
      { class: 'ob-wrap' },
      h('div', { class: 'ob-head' }, h('h1', { text: 'Observations' }), pill),
      h(
        'div',
        { class: 'ob-tools' },
        h('button', { class: 'st-btn', type: 'button', text: '+ New Row', onclick: newRow }),
        h('button', { class: 'st-btn', type: 'button', text: '🎙 Voice Row', onclick: voiceRow }),
        h('button', { class: 'st-btn secondary', type: 'button', text: '📝 Pocket Notes', onclick: pocketNotes }),
        h('button', { class: 'st-btn secondary', type: 'button', text: 'CSV', onclick: () => downloadCsv(exportRows()) }),
        h('button', { class: 'st-btn secondary', type: 'button', text: 'Excel', onclick: () => downloadExcel(exportRows()) })
      ),
      h('div', { class: 'ob-tools' }, search, countEl),
      chipsHost,
      alertHost,
      tableHost
    )
  );
  renderChips();
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  root.replaceChildren(h('div', { class: 'ob-wrap' }, h('p', { class: 'st-sub', text: 'Loading sheet…' })));
  await loadRegions();
  await loadCustomColumns();
  await load();
  build();
  renderTable();
  unsubStatus = onSaveStatus((state, detail) => {
    setPill(state, detail);
    if (state === 'error') setTimeout(() => flushAll().catch(() => null), 3000);
  });
  const onProject = () => {
    scheduleReload();
  };
  const onSaved = (p) => {
    if (p && p.store === ACTION_STORE) scheduleReload();
  };
  on(EVENTS.PROJECT_CHANGED, onProject);
  on(EVENTS.RECORD_SAVED, onSaved);
  handlers = [
    [EVENTS.PROJECT_CHANGED, onProject],
    [EVENTS.RECORD_SAVED, onSaved]
  ];
}

export function unmount() {
  flushAll().catch(() => null);
  stopVoice();
  handlers.forEach(([e, fn]) => off(e, fn));
  handlers = [];
  if (unsubStatus) unsubStatus();
  unsubStatus = null;
  clearTimeout(reloadTimer);
  clearTimeout(repeatTimer);
  root = null;
  tableHost = alertHost = countEl = pill = chipsHost = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
