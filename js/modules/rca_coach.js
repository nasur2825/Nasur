/* NASUR - Just-Culture Worker RCA Coach module (Phase 4) */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { hrefFor } from '../core/router.js';
import { loadRegions, formatDate } from '../services/regions.js';
import { listIncidents, getIncident, updateIncident, generateCapa, severityOf } from '../services/incidents.js';
import { sessionGet, sessionDelete, sessionSet } from '../services/jarvis_core.js';
import { INTERVIEW_STEPS, LANGS, phrase, PHRASES, BEHAVIOUR_QUESTIONS, classifyBehaviour, WHY_CATEGORIES, newChain, addWhy, nextWhyQuestion, suggestCategory, suggestCapa, newRca, rcaSummaryText } from '../services/rca.js';

export const id = 'rca_coach';

const SPEECH = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN', ar: 'ar-SA' };
const STEPS = ['1 Prepare', '2 Interview', '3 Just-Culture', '4 5-Whys', '5 Actions'];
const HIERARCHY = ['Elimination', 'Substitution', 'Engineering', 'Administrative', 'PPE'];

let root = null;
let incident = null;
let rca = null;
let step = 0;
let lang = 'en';
let body = null;
let pill = null;
let saveTimer = null;
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
  if (document.getElementById('rc-style')) return;
  const s = document.createElement('style');
  s.id = 'rc-style';
  s.textContent =
    '.rc-phrase{border-left:5px solid #0a84ff;background:rgba(10,132,255,.1);border-radius:8px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start;justify-content:space-between}' +
    '.rc-phrase b{display:block;font-size:1rem;line-height:1.4}.rc-phrase small{display:block;opacity:.7;margin-top:2px}' +
    '.rc-check{display:flex;gap:10px;align-items:flex-start;padding:8px 6px;border-radius:8px;font-size:.88rem;line-height:1.4}' +
    '.rc-check input{width:22px;height:22px;flex:0 0 auto;margin-top:1px}' +
    '.rc-avoid{color:#d93025;font-size:.84rem;margin:2px 0}.rc-ok{color:#16a34a;font-weight:700}' +
    '.rc-result{border:2px solid #0a84ff;border-radius:12px;padding:12px;background:rgba(10,132,255,.08)}' +
    '.rc-yn{display:flex;gap:8px}.rc-yn button{flex:1}' +
    '.rc-nav{display:flex;gap:8px;justify-content:space-between}.rc-nav .st-btn{flex:1}' +
    '.rc-why{padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.12);font-size:.88rem}';
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

function link(moduleId, text) {
  let href = '#';
  try {
    href = hrefFor(moduleId);
  } catch (e) {
    /* router may not know the module yet */
  }
  return h('a', { href, class: 'st-btn secondary', style: 'text-align:center;text-decoration:none;display:block', text });
}

/* ---------- Save ---------- */

function setPill(text) {
  if (pill) pill.textContent = text;
}

function persist() {
  setPill('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!incident) return;
  try {
    const patch = { rca };
    if (incident.status === 'reported') patch.status = 'investigating';
    incident = (await updateIncident(incident.id, patch)) || incident;
    setPill('Saved ✓');
  } catch (e) {
    setPill('Save failed');
    toast('Could not save RCA: ' + e.message, 'error');
  }
}

/* ---------- Voice helpers ---------- */

function speak(text, l) {
  if (!('speechSynthesis' in window)) return toast('Speech is not supported on this device', 'error');
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH[l] || 'en-IN';
  u.rate = 0.85;
  window.speechSynthesis.speak(u);
}

function dictate(textarea, onChange) {
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
    rec.lang = SPEECH[lang] || 'en-IN';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          textarea.value = (textarea.value ? textarea.value + ' ' : '') + e.results[i][0].transcript.trim();
          onChange(textarea.value);
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
  return b;
}

function textBox(label, value, onChange, opts) {
  const o = opts || {};
  const ta = h('textarea', { class: 'st-input', rows: String(o.rows || 3), placeholder: o.placeholder || '' });
  ta.value = value || '';
  ta.addEventListener('input', () => onChange(ta.value));
  const row = h('div', { class: 'ob-field-row' }, ta, o.mic === false ? null : dictate(ta, onChange));
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), row);
}

function lineInput(label, value, onChange, type) {
  const i = h('input', { class: 'st-input', type: type || 'text', value: value || '', autocomplete: 'off' });
  i.addEventListener('input', () => onChange(i.value));
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), i);
}

function selectEl(options, value, onChange) {
  const s = h('select', { class: 'st-select' }, options.map((o) => h('option', { value: o.id, text: o.label })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/* ---------- Steps ---------- */

function stepPrepare() {
  const c = [];
  c.push(h('section', { class: 'st-card' }, h('h2', { text: 'Worker interview guide' }), h('p', { class: 'st-hint', text: 'Follow these steps in order. The goal is to understand the system, not to blame the worker. Choose the language you will speak.' }), h('div', { class: 'st-row' }, h('span', { class: 'st-label', text: 'Phrase language' }), selectEl(LANGS, lang, (v) => { lang = v; render(); }))));
  INTERVIEW_STEPS.forEach((s) => {
    const done = (rca.interview.done[s.id] = rca.interview.done[s.id] || []);
    const card = h('section', { class: 'st-card' }, h('h2', { text: s.title }), h('p', { class: 'st-hint', text: 'About ' + s.minutes + ' minutes' }));
    s.do.forEach((d, i) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = done.includes(i);
      cb.addEventListener('change', () => {
        const k = done.indexOf(i);
        if (cb.checked && k < 0) done.push(i);
        if (!cb.checked && k >= 0) done.splice(k, 1);
        persist();
      });
      card.appendChild(h('label', { class: 'rc-check' }, cb, h('span', { text: d })));
    });
    s.avoid.forEach((a) => card.appendChild(h('div', { class: 'rc-avoid', text: '✕ ' + a })));
    s.say.forEach((pid) => {
      card.appendChild(
        h(
          'div',
          { class: 'rc-phrase' },
          h('div', null, h('b', { text: phrase(pid, lang) }), lang !== 'en' ? h('small', { text: PHRASES[pid].en }) : null),
          h('button', { class: 'st-btn secondary small', type: 'button', text: '🔊', 'aria-label': 'Speak', onclick: () => speak(phrase(pid, lang), lang) })
        )
      );
    });
    c.push(card);
  });
  return c;
}

function stepInterview() {
  const iv = rca.interview;
  if (!iv.date) iv.date = new Date().toISOString().slice(0, 10);
  const c = [];
  c.push(
    h(
      'section',
      { class: 'st-card' },
      h('h2', { text: 'Interview record' }),
      lineInput('Worker name or ID', iv.worker, (v) => { iv.worker = v; persist(); }),
      lineInput('Interviewer', iv.interviewer, (v) => { iv.interviewer = v; persist(); }),
      lineInput('Date', iv.date, (v) => { iv.date = v; persist(); }, 'date'),
      textBox('Worker’s story in their own words', iv.notes, (v) => { iv.notes = v; persist(); }, { rows: 6, placeholder: 'Write or dictate. Keep their words. No blame words.' })
    )
  );
  const sys = INTERVIEW_STEPS.find((s) => s.id === 'system');
  const card = h('section', { class: 'st-card' }, h('h2', { text: 'System questions' }), h('p', { class: 'st-hint', text: 'Ask each question calmly and note the answer.' }));
  sys.do.forEach((q, i) => {
    card.appendChild(textBox(q, iv.systemAnswers[i] || '', (v) => { iv.systemAnswers[i] = v; persist(); }, { rows: 2 }));
  });
  c.push(card);
  return c;
}

function stepJustCulture() {
  const b = rca.behaviour;
  const c = [];
  const card = h('section', { class: 'st-card' }, h('h2', { text: 'Just-Culture check' }), h('p', { class: 'st-hint', text: 'Answer after the interview. Always check the system first. This classifies the behaviour, not the person.' }));
  const result = h('div');
  const showResult = () => {
    const r = classifyBehaviour(b.answers);
    b.result = r;
    result.replaceChildren(h('div', { class: 'rc-result' }, h('b', { text: r.label }), h('ul', { class: 'st-list' }, r.response.map((x) => h('li', { text: x }))), h('p', { class: 'st-hint', text: r.note })));
  };
  BEHAVIOUR_QUESTIONS.forEach((q) => {
    const yes = h('button', { class: 'st-btn secondary', type: 'button', text: 'Yes', 'aria-pressed': b.answers[q.id] === true ? 'true' : 'false' });
    const no = h('button', { class: 'st-btn secondary', type: 'button', text: 'No', 'aria-pressed': b.answers[q.id] === false ? 'true' : 'false' });
    const mark = () => {
      yes.style.outline = b.answers[q.id] === true ? '3px solid #0a84ff' : 'none';
      no.style.outline = b.answers[q.id] === false ? '3px solid #0a84ff' : 'none';
    };
    yes.addEventListener('click', () => { b.answers[q.id] = true; mark(); showResult(); persist(); });
    no.addEventListener('click', () => { b.answers[q.id] = false; mark(); showResult(); persist(); });
    mark();
    card.appendChild(h('div', { class: 'st-provider' }, h('span', { class: 'st-label', text: q.text }), h('div', { class: 'rc-yn' }, yes, no)));
  });
  c.push(card);
  if (Object.keys(b.answers).length) showResult();
  c.push(result);
  return c;
}

function whyCard(chain, ci) {
  const card = h('section', { class: 'st-card' }, h('h2', { text: 'Why chain ' + (ci + 1) }));
  card.appendChild(lineInput('Problem statement', chain.problem, (v) => { chain.problem = v; persist(); }));
  chain.whys.forEach((w, i) => card.appendChild(h('div', { class: 'rc-why' }, h('b', { text: 'Why ' + (i + 1) + ': ' }), w.a)));
  if (chain.whys.length < 5) {
    const ta = h('textarea', { class: 'st-input', rows: '2', placeholder: 'Answer with the system cause, not a person' });
    card.appendChild(h('p', { class: 'st-hint', text: nextWhyQuestion(chain) }));
    card.appendChild(h('div', { class: 'ob-field-row' }, ta, dictate(ta, () => {})));
    card.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Add Why ' + (chain.whys.length + 1), onclick: () => {
      if (!ta.value.trim()) return toast('Write the answer first', 'error');
      rca.chains[ci] = addWhy(chain, ta.value);
      persist();
      render();
    } }));
  }
  if (chain.whys.length) {
    const last = chain.whys[chain.whys.length - 1].a;
    const sug = suggestCategory(last) || chain.category || 'procedure';
    const cat = WHY_CATEGORIES.find((x) => x.id === sug);
    const catSel = selectEl(WHY_CATEGORIES, sug, (v) => { chain.category = v; });
    const txt = h('input', { class: 'st-input', type: 'text', value: chain.rootCause || last });
    card.appendChild(h('p', { class: 'st-hint', text: 'Think about: ' + (cat ? cat.prompts.join(' ') : '') }));
    card.appendChild(h('div', { class: 'st-provider' }, h('span', { class: 'st-label', text: 'Root cause category' }), catSel, h('span', { class: 'st-label', text: 'Root cause' }), txt));
    card.appendChild(h('button', { class: 'st-btn secondary', type: 'button', text: 'Save as root cause', onclick: () => {
      const text = txt.value.trim();
      if (!text) return;
      chain.rootCause = text;
      chain.category = catSel.value;
      rca.rootCauses.push({ category: catSel.value, text });
      persist();
      render();
    } }));
  }
  card.appendChild(h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete chain', onclick: () => { rca.chains.splice(ci, 1); persist(); render(); } }));
  return card;
}

function stepWhys() {
  const c = [];
  c.push(h('section', { class: 'st-card' }, h('h2', { text: 'System-focused 5-Whys' }), h('p', { class: 'st-hint', text: 'Ask “why” up to five times. Stop when you reach something management or the system can fix. Use one chain per problem.' }), h('button', { class: 'st-btn', type: 'button', text: '+ Add why chain', onclick: () => { rca.chains.push(newChain(incident.description)); persist(); render(); } })));
  rca.chains.forEach((ch, i) => c.push(whyCard(ch, i)));
  if (rca.rootCauses.length) {
    c.push(
      h(
        'section',
        { class: 'st-card' },
        h('h2', { text: 'Root causes found' }),
        h('ul', { class: 'st-list' }, rca.rootCauses.map((r, i) => h('li', null, (WHY_CATEGORIES.find((x) => x.id === r.category) || { label: 'Other' }).label + ': ' + r.text, h('div', { class: 'st-row' }, h('button', { class: 'st-btn secondary small', type: 'button', text: 'Remove', onclick: () => { rca.rootCauses.splice(i, 1); persist(); render(); } }))))),
        textBox('Contributing factors (optional)', rca.contributing, (v) => { rca.contributing = v; persist(); }, { rows: 3 })
      )
    );
  }
  return c;
}

function capaRow(item, i) {
  const ta = h('textarea', { class: 'st-input', rows: '2' });
  ta.value = item.text;
  ta.addEventListener('input', () => { item.text = ta.value; persist(); });
  const kind = selectEl([{ id: 'corrective', label: 'Corrective' }, { id: 'preventive', label: 'Preventive' }], item.kind || 'corrective', (v) => { item.kind = v; persist(); });
  const hi = selectEl(HIERARCHY.map((x) => ({ id: x, label: x })), item.hierarchy || 'Administrative', (v) => { item.hierarchy = v; persist(); });
  const who = h('input', { class: 'st-input', type: 'text', placeholder: 'Responsible person', value: item.responsible || '' });
  who.addEventListener('input', () => { item.responsible = who.value; persist(); });
  const due = h('input', { class: 'st-input', type: 'date', value: item.target_date || '' });
  due.addEventListener('input', () => { item.target_date = due.value; persist(); });
  const del = h('button', { class: 'st-btn danger small', type: 'button', text: 'Remove', onclick: () => { rca.capa.splice(i, 1); persist(); render(); } });
  return h('div', { class: 'st-provider' }, h('b', { text: 'Action ' + (i + 1) + (item.actionId ? ' (tracked)' : '') }), ta, kind, hi, who, due, del);
}

function stepActions() {
  const sevW = severityOf(incident.severity).weight;
  const c = [];
  const card = h('section', { class: 'st-card' }, h('h2', { text: 'Corrective and preventive actions' }), h('p', { class: 'st-hint', text: 'Prefer controls higher in the hierarchy. Give every action an owner and a date.' }));
  if (!rca.capa.length && rca.rootCauses.length) {
    card.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Load suggested actions from root causes', onclick: () => { rca.capa = suggestCapa(rca.rootCauses, { severe: sevW >= 3 }); persist(); render(); } }));
  }
  rca.capa.forEach((it, i) => card.appendChild(capaRow(it, i)));
  card.appendChild(h('button', { class: 'st-btn secondary', type: 'button', text: '+ Add action', onclick: () => { rca.capa.push({ text: '', kind: 'corrective', hierarchy: 'Administrative', responsible: '', target_date: '' }); persist(); render(); } }));
  c.push(card);
  c.push(
    h(
      'section',
      { class: 'st-card' },
      h('h2', { text: 'Finish' }),
      h('button', {
        class: 'st-btn',
        type: 'button',
        text: 'Save and create tracked CAPA actions',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            rca.capa = rca.capa.filter((x) => x.text && x.text.trim());
            await flush();
            const made = await generateCapa(incident.id);
            incident = await getIncident(incident.id);
            rca = mergeRca(incident.rca);
            toast(made.length + ' action(s) added to the Action Tracker', 'success');
            render();
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            btn.disabled = false;
          }
        }
      }),
      h('button', {
        class: 'st-btn secondary',
        type: 'button',
        text: 'Copy RCA summary',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(rcaSummaryText(incident, rca));
            toast('Summary copied', 'success');
          } catch (e) {
            toast('Copy not available', 'error');
          }
        }
      }),
      link('incidents', 'Open Incidents and Action Tracker')
    )
  );
  return c;
}

/* ---------- Screen ---------- */

function mergeRca(saved) {
  const base = newRca();
  const s = saved || {};
  const out = { ...base, ...s };
  out.interview = { ...base.interview, ...(s.interview || {}) };
  out.interview.done = out.interview.done || {};
  out.interview.systemAnswers = out.interview.systemAnswers || {};
  out.behaviour = { ...base.behaviour, ...(s.behaviour || {}) };
  out.behaviour.answers = out.behaviour.answers || {};
  out.chains = Array.isArray(out.chains) ? out.chains : [];
  out.rootCauses = Array.isArray(out.rootCauses) ? out.rootCauses : [];
  out.capa = Array.isArray(out.capa) ? out.capa : [];
  return out;
}

function render() {
  if (!root || !incident) return;
  const builders = [stepPrepare, stepInterview, stepJustCulture, stepWhys, stepActions];
  const chips = h('div', { class: 'ob-chips' }, STEPS.map((s, i) => h('button', { class: 'st-chip', type: 'button', text: s, 'aria-pressed': i === step ? 'true' : 'false', onclick: () => { step = i; render(); window.scrollTo(0, 0); } })));
  const nav = h(
    'div',
    { class: 'rc-nav' },
    h('button', { class: 'st-btn secondary', type: 'button', text: 'Back', disabled: step === 0, onclick: () => { step--; render(); window.scrollTo(0, 0); } }),
    h('button', { class: 'st-btn', type: 'button', text: 'Next', disabled: step === STEPS.length - 1, onclick: () => { step++; render(); window.scrollTo(0, 0); } })
  );
  pill = h('span', { class: 'ob-status saved', text: 'Saved ✓' });
  const head = h('section', { class: 'st-card' }, h('div', { class: 'ob-head' }, h('b', { text: incident.incident_no + ' · ' + severityOf(incident.severity).label }), pill, h('button', { class: 'st-btn secondary small', type: 'button', text: 'Change incident', onclick: async () => { await flush(); incident = null; rca = null; showPicker(); } })), h('p', { class: 'st-hint', text: formatDate(incident.date) + ' ' + incident.time + ' · ' + (incident.location || '') + ' · ' + incident.description.slice(0, 140) }));
  body = h('div', { class: 'st-wrap', style: 'padding:0' }, builders[step]());
  root.replaceChildren(h('div', { class: 'st-wrap' }, h('h1', { class: 'st-title', text: 'Just-Culture RCA Coach' }), head, chips, body, nav));
}

async function showPicker() {
  const open = await listIncidents({ openOnly: true });
  const list = h('div', { class: 'st-wrap' }, h('h1', { class: 'st-title', text: 'Just-Culture RCA Coach' }), h('p', { class: 'st-sub', text: 'Choose the incident to investigate' }));
  if (!open.length) {
    list.appendChild(h('section', { class: 'st-card' }, h('p', { class: 'st-hint', text: 'No open incidents. Log an incident or near miss first.' }), link('incidents', 'Go to Incidents')));
  }
  open.forEach((inc) => {
    list.appendChild(
      h('button', { class: 'st-region', type: 'button', onclick: () => open_(inc.id) }, h('b', { text: inc.incident_no + ' · ' + severityOf(inc.severity).label }), h('small', { text: formatDate(inc.date) + ' · ' + (inc.location || '') + ' · ' + inc.description.slice(0, 80) }))
    );
  });
  root.replaceChildren(list);
}

async function open_(incId) {
  incident = await getIncident(incId);
  if (!incident) return showPicker();
  rca = mergeRca(incident.rca);
  step = 0;
  sessionSet('rca_incident', incId);
  render();
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  ensureStyle();
  await loadRegions();
  const wanted = sessionGet('rca_incident', null);
  sessionDelete('rca_incident');
  if (wanted) await open_(wanted);
  else await showPicker();
}

export function unmount() {
  if (incident && rca) flush();
  if (activeRec) {
    try {
      activeRec.stop();
    } catch (e) {
      /* ignore */
    }
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  activeRec = null;
  root = null;
  incident = null;
  rca = null;
  body = null;
  pill = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
