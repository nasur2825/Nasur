/* NASUR - Safety reference service (Phase 5)
   Data loaders, matchers, inspectors and shared UI helpers for fire_safety, ppe_guide and machine_safety.
   Every reference module shows the JARVIS mission, visual walk-steps, country legal standards and the
   one-tap bridge into the Phase 4 Observations sheet and Toolbox Talks. */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { getActiveRegionId, formatDate, formatTime } from './regions.js';
import { sessionGet, sessionSet, loadBlueprint, getBlueprint } from './jarvis_core.js';
import { createDraft, createObservation, nowStamp, validateStamp } from './observations.js';

/* ---------- Data loaders ---------- */

const cache = {};

async function loadJson(path) {
  if (cache[path]) return cache[path];
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
  cache[path] = await res.json();
  return cache[path];
}

export const loadFire = () => loadJson('data/fire_safety.json');
export const loadPpe = () => loadJson('data/ppe_guide.json');
export const loadMachines = () => loadJson('data/machine_safety.json');

export const REGION_LABELS = { india: 'India', gulf: 'Gulf (UAE / Saudi / Qatar)', canada: 'Canada', usa: 'USA' };

/* ---------- Legal standards ---------- */

export const FIRE_LEGAL = {
  india: 'Factories Act 1948 s.38 (precautions in case of fire); National Building Code 2016 Part 4 (fire and life safety); state Fire Service rules; IS 15683 (portable fire extinguishers) and IS 2190 (selection, installation and maintenance) (verify)',
  gulf: 'UAE Fire and Life Safety Code of Practice (Civil Defence) and UAE Cabinet Decision No. 33 of 2020; NFPA 10 and NFPA 101 widely adopted; Saudi Building Code fire protection requirements and Saudi Civil Defence; Qatar Civil Defence requirements (verify)',
  canada: 'National Fire Code of Canada and provincial fire codes; NFPA 10 maintenance practice and CAN/ULC extinguisher standards; provincial OHS regulations',
  usa: 'OSHA 29 CFR 1910.157 (portable fire extinguishers), 1910.38 (emergency action plans), 1910.39 (fire prevention plans); NFPA 10; NFPA 51B for hot work'
};

export const PPE_LEGAL = {
  india: 'Factories Act 1948 and state rules; OSH Code 2020 (employer duty to provide suitable PPE); BIS (IS) marking on PPE (verify)',
  gulf: 'UAE Cabinet Decision No. 33 of 2020 (employer duty to provide suitable PPE); client standards such as ADNOC and Aramco; EN standards commonly specified (verify)',
  canada: 'Provincial OHS regulations; CSA Z94 series (headwear, eye, hearing, respirators), CSA Z195 (footwear), CSA Z259 (fall protection)',
  usa: 'OSHA 29 CFR 1910 Subpart I (1910.132 general, .133 eye and face, .134 respiratory, .135 head, .136 foot, .138 hand); 29 CFR 1926 Subpart E for construction'
};

/* ---------- Visual walk-steps (where to look first, hidden hazards, who to protect) ---------- */

export const FIRE_WALK = {
  where_first: ['Exits and escape routes: clear, unlocked and signed', 'Extinguishers: right type, in place, gauge in the green', 'Ignition sources: hot work, heaters, electrical panels, smoking areas', 'Fuel: waste, packaging, flammable liquid and gas stores', 'Alarms, fire doors and sprinklers: working and not blocked'],
  hidden: ['Fire doors wedged open', 'Extinguishers blocked by stock or moved away', 'Overloaded sockets and extension cords', 'Oily rags and dust build-up', 'Gas cylinders stored with oxidisers or next to exits', 'Sprinkler heads painted over or covered by stock', 'Alarm panel faults that nobody acted on'],
  protect: ['People who cannot leave quickly: visitors, contractors, anyone with a disability', 'Workers alone or on night shift in remote areas', 'People in confined spaces or at height when the alarm sounds']
};

export const PPE_WALK = {
  where_first: ['Is the PPE right for this task hazard, not just site entry PPE?', 'Is it worn correctly: fitted, fastened and not modified?', 'Is it in good condition: no cracks, cuts or fading?', 'Is it compatible with the other PPE (glasses with respirator, helmet with ear muffs)?', 'Are replacements available on site?'],
  hidden: ['Cracked helmets and harness webbing hidden by dirt', 'Respirators with no fit test or the wrong filter', 'Gloves chosen for cuts when the hazard is chemical', 'Harness worn loose or the lanyard on a weak anchor', 'Expired filters and insulating gloves out of test date', 'Heat stress caused by the PPE itself'],
  protect: ['Workers on a new or non-routine task', 'New workers and contractors who bring their own PPE']
};

/* ---------- Fire matcher ---------- */

const ORDER = { yes: 0, caution: 1, no: 2 };

export function matchExtinguishers(fire, typeId) {
  const row = (fire.matrix && fire.matrix[typeId]) || {};
  return fire.extinguishers
    .map((e) => ({ ext: e, r: (row[e.id] && row[e.id].r) || 'no', note: (row[e.id] && row[e.id].note) || '' }))
    .sort((a, b) => ORDER[a.r] - ORDER[b.r]);
}

export function matchFireTypes(fire, extId) {
  return fire.fire_types
    .map((t) => {
      const c = (fire.matrix[t.id] && fire.matrix[t.id][extId]) || { r: 'no', note: '' };
      return { type: t, r: c.r, note: c.note };
    })
    .sort((a, b) => ORDER[a.r] - ORDER[b.r]);
}

export function evaluateMonthly(items, answers) {
  const failed = items.filter((i) => answers[i.id] === 'fail');
  const unanswered = items.filter((i) => !answers[i.id]);
  return { pass: failed.length === 0 && unanswered.length === 0, failed, unanswered };
}

/* ---------- PPE selector and inspector ---------- */

export function ppeForTask(ppe, taskId) {
  const t = ppe.tasks.find((x) => x.id === taskId);
  if (!t) return { task: null, items: [] };
  return { task: t, items: t.ppe.map((id) => ppe.items[id]).filter(Boolean) };
}

export function stdFor(item, regionId) {
  const s = item.standards || {};
  return s[regionId === 'gulf' ? 'eu' : regionId] || s.eu || '';
}

export function inspectionVerdict(entry, seen) {
  const hits = (entry.reject_if || []).filter((_, i) => seen[i]);
  return { reject: hits.length > 0, hits };
}

/* ---------- LOTO helpers ---------- */

export function lotoSummary(machineTitle, person, steps, state) {
  const d = new Date();
  const lines = ['LOTO VERIFICATION', 'Machine: ' + (machineTitle || 'not selected'), 'Person: ' + (person || ''), 'Date: ' + formatDate(d) + ' ' + formatTime(d), ''];
  steps.forEach((s) => lines.push(s.n + '. ' + s.title + ': ' + (state[s.n] === 'done' ? 'VERIFIED' : state[s.n] === 'fail' ? 'FAILED / NOT DONE' : 'not checked')));
  return lines.join('\n');
}

export function machineTbtText(m) {
  return [
    'TOOLBOX TALK: ' + m.title + ' safety',
    '',
    'WHERE THE DANGER IS',
    ...m.nip_points.slice(0, 4).map((x, i) => (i + 1) + '. ' + x),
    '',
    'NEVER',
    ...m.never.slice(0, 3).map((x) => '- ' + x),
    '',
    'ENERGY TO ISOLATE: ' + m.energy_sources.join(', '),
    'ASK THE CREW: If someone started this machine while my hands were inside, what would stop them?',
    '',
    'Attendance: names, signatures and date.'
  ].join('\n');
}

/* ---------- UI helpers ---------- */

export function toast(message, type) {
  emit(EVENTS.TOAST, { message, type: type || 'info' });
}

export function ensureCss(href) {
  const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => (l.getAttribute('href') || '').indexOf(href) >= 0);
  if (has) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

export function ensureRefCss() {
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  ensureCss('css/reference.css');
}

export function h(tag, attrs) {
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

export function card(title, hint, children) {
  const c = h('section', { class: 'rf-card' });
  if (title) c.appendChild(h('h2', { text: title }));
  if (hint) c.appendChild(h('p', { class: 'rf-hint', text: hint }));
  [].concat(children || []).forEach((x) => x && c.appendChild(x));
  return c;
}

/* JARVIS mission banner shown at the top of every reference module */
export async function missionBanner() {
  try {
    await loadBlueprint();
  } catch (e) {
    /* fallback text below */
  }
  const m = (getBlueprint() || {}).mission;
  const workers = m && m.audience ? m.audience.workers : '3000+';
  const families = m && m.audience ? m.audience.families : '3000+';
  return h('div', { class: 'rf-card', style: 'border-left:6px solid #dc2626' }, h('b', { text: 'Mission: protect ' + workers + ' workers and ' + families + ' families' }), h('p', { class: 'rf-hint', text: 'Human life first. Prevention before reaction. Clear, practical and usable on the shop floor.' }));
}

export function walkBlock(walk, title) {
  const block = (cls, t, items) => h('div', { class: 'rf-step ' + cls }, h('h3', { text: t }), h('ol', { class: 'rf-num' }, items.map((i) => h('li', { text: i }))));
  return card(title || 'Visual inspection walk-steps', 'Walk it in this order. Stand where the worker stands.', h('div', { class: 'rf-walk' }, [block('', 'Where to look first', walk.where_first), block('hidden', 'Hidden hazards people miss', walk.hidden), block('protect', 'Who needs protection first', walk.protect)]));
}

export function legalBlock(legal, title) {
  const active = getActiveRegionId();
  const rows = Object.keys(REGION_LABELS)
    .map((id) => ({ id, label: REGION_LABELS[id], text: legal[id] || '' }))
    .sort((a, b) => (b.id === active ? 1 : 0) - (a.id === active ? 1 : 0));
  return card(title || 'Country-specific legal standards', 'Your active country is first. Verify the current text before audit use.', h('div', { class: 'rf-legal' }, rows.map((r) => h('div', { class: r.id === active ? 'on' : '' }, h('b', { text: r.label + (r.id === active ? ' · your country' : '') }), r.text))));
}

/* Interactive tick list that remembers ticks for the session */
export function checklist(items, key, title, hint) {
  const done = new Set(sessionGet(key, []));
  const bar = h('i', { style: 'width:0%' });
  const label = h('p', { class: 'rf-hint' });
  const upd = () => {
    bar.style.width = (items.length ? Math.round((done.size / items.length) * 100) : 0) + '%';
    label.textContent = done.size + ' of ' + items.length + ' checked';
  };
  const rows = items.map((t, i) => {
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
  return card(title, hint, [h('div', { class: 'rf-bar-progress' }, bar), label, ...rows]);
}

export function tabsBar(tabs, current, onSelect) {
  return h('div', { class: 'rf-chips' }, tabs.map((t) => h('button', { class: 'st-chip', type: 'button', text: t.label, 'aria-pressed': current === t.id ? 'true' : 'false', onclick: () => onSelect(t.id) })));
}

/* ---------- Bridge: Create Observation (Phase 4 sheet) ---------- */

export function openObservationModal(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const st = nowStamp();
    const d = { date: st.date, time: st.time, description: o.description || '', risk: o.risk_rating || 'High', location: '', contractor: '' };
    const stamp = h('div', { class: 'ob-stamp' });
    const warn = h('div', { class: 'ob-warn' });
    const save = h('button', { class: 'st-btn', type: 'button', text: 'Confirm date/time and save to Observations' });
    const stampText = () => {
      const x = new Date(d.date + 'T' + (d.time || '00:00') + ':00');
      return isNaN(x.getTime()) ? '-' : formatDate(x) + '   ' + formatTime(x);
    };
    const upd = () => {
      stamp.textContent = 'Confirm: ' + stampText();
      const v = validateStamp(d.date, d.time);
      warn.textContent = !v.ok ? v.error : v.past ? 'Past entry. Check the date and time are correct.' : '';
      save.disabled = !v.ok;
    };
    const dI = h('input', { class: 'st-input', type: 'date', value: d.date });
    const tI = h('input', { class: 'st-input', type: 'time', value: d.time });
    dI.addEventListener('input', () => { d.date = dI.value; upd(); });
    tI.addEventListener('input', () => { d.time = tI.value; upd(); });
    const ta = h('textarea', { class: 'st-input', rows: '4', placeholder: 'What did you see? Be specific.' });
    ta.value = d.description;
    ta.addEventListener('input', () => { d.description = ta.value; });
    const chips = h('div', { class: 'rf-chips' }, (o.typical || []).map((t) => h('button', { class: 'st-chip', type: 'button', text: t, onclick: () => { ta.value = t; d.description = t; } })));
    const risk = h('select', { class: 'st-select' }, ['Low', 'Medium', 'High', 'Critical'].map((r) => h('option', { value: r, text: r })));
    risk.value = d.risk;
    risk.addEventListener('change', () => { d.risk = risk.value; });
    const loc = h('input', { class: 'st-input', type: 'text', placeholder: 'Exact location' });
    loc.addEventListener('input', () => { d.location = loc.value; });
    const con = h('input', { class: 'st-input', type: 'text', placeholder: 'Contractor (optional)' });
    con.addEventListener('input', () => { d.contractor = con.value; });
    let overlay = null;
    const close = (val) => {
      if (overlay) overlay.remove();
      resolve(val);
    };
    const modal = h('div', { class: 'ob-modal', role: 'dialog' }, [
      h('h2', { text: 'Create observation · ' + (o.title || 'Safety') }),
      h('p', { class: 'rf-hint', text: 'Hazard category, activity and the legal clause for your country are filled in for you.' }),
      h('div', { class: 'ob-field' }, stamp, h('div', { class: 'ob-field-row' }, dI, tI), warn),
      (o.typical || []).length ? h('span', { class: 'st-label', text: 'Quick findings' }) : null,
      chips,
      ta,
      h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: 'Risk rating' }), risk),
      loc,
      con,
      save,
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => close(null) })
    ]);
    overlay = h('div', { class: 'ob-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, modal);
    document.body.appendChild(overlay);
    upd();
    save.addEventListener('click', async () => {
      if (!String(d.description || '').trim()) return toast('Describe what you saw', 'error');
      save.disabled = true;
      try {
        const base = await createDraft();
        const rec = await createObservation({
          ...base,
          date: d.date,
          time: d.time,
          activity: o.activity || '',
          hazard_category: o.hazard_category || 'Other',
          risk_rating: d.risk,
          description: d.description,
          location: d.location || base.location,
          contractor: d.contractor || base.contractor,
          legal_clause: o.legal_clause || ''
        });
        toast(rec.obs_no + ' added to the Observations sheet', 'success');
        close(rec);
      } catch (e) {
        toast(e.message, 'error');
        save.disabled = false;
      }
    });
  });
}

export async function shareText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      toast('Shared', 'success');
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return true;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
  } catch (e) {
    toast('Sharing is not available', 'error');
  }
  return false;
}

/* Persistent action bar: Create Observation and Share TBT */
export function actionBar(cfg) {
  return h(
    'div',
    { class: 'rf-card' },
    h('h2', { text: 'Take action' }),
    h(
      'div',
      { class: 'rf-actions' },
      h('button', { class: 'st-btn', type: 'button', text: '➕ Create observation', onclick: () => openObservationModal(typeof cfg.obs === 'function' ? cfg.obs() : cfg.obs) }),
      h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share TBT', onclick: () => shareText(cfg.tbtTitle, typeof cfg.tbtText === 'function' ? cfg.tbtText() : cfg.tbtText) })
    )
  );
}
