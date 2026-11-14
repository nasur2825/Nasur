/* NASUR - JARVIS Studio module (Phase 4)
   Self-extension (columns, report templates, checklists, safety rules), approved memory,
   deep-context privacy, permissions and one-click rollback. */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { loadRegions } from '../services/regions.js';
import { limitInput, MAX_INPUT_CHARS, getSettings } from '../services/settings.js';
import { listTemplates, listPending, removeTemplate, loadCustomColumns } from '../services/templates.js';
import { proposeFromRequest, approve, reject, askToSaveText, detectIntent } from '../services/ai_extender.js';
import {
  PERSONAL_CATEGORIES,
  EXPERIENCE_BANDS,
  DEEP_LEVELS,
  PERMISSIONS,
  isMemoryEnabled,
  setMemoryEnabled,
  listProposals,
  approveMemory,
  rejectMemory,
  saveMemory,
  listMemories,
  updateMemory,
  deleteMemory,
  clearPersonalMemory,
  getUserProfile,
  saveUserProfile,
  getUserPreferences,
  saveUserPreferences,
  loadBlueprint,
  getBlueprint,
  getDeepContextLevel,
  setDeepContextLevel,
  listPermissions,
  grantPermission,
  revokePermission,
  listPendingApprovals,
  resolveApproval,
  snapshotBefore,
  listSnapshots,
  rollback,
  undoLast,
  getVaultStatus,
  sessionClear
} from '../services/jarvis_core.js';

export const id = 'jarvis_studio';

const NOTES = STORES.MEMORY_NOTES;
const KIND_CHIPS = [
  { id: 'auto', label: 'Auto' },
  { id: 'custom_column', label: 'Column' },
  { id: 'report_template', label: 'Report' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'safety_rule', label: 'Safety rule' }
];
const KIND_LABEL = { custom_column: 'Column', report_template: 'Report template', checklist: 'Checklist', safety_rule: 'Safety rule' };
const EXAMPLES = {
  auto: 'Example: Add a column for Permit Number. Or: Make a hot work checklist for welding in a workshop.',
  custom_column: 'Example: Add a yes/no column called Permit Available.',
  report_template: 'Example: Weekly contractor report with risk table, open actions and sign-off for the HSE manager.',
  checklist: 'Example: Daily forklift inspection checklist for a warehouse in the Gulf.',
  safety_rule: 'Example: What are the heat stress rules for outdoor work in Saudi Arabia?'
};

let root = null;
let tab = 'build';
let kind = 'auto';
let request = '';
let proposals = [];
let libKind = 'custom_column';
let busy = false;
let body = null;

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

function card(title, hint) {
  const c = h('section', { class: 'st-card' }, h('h2', { text: title }));
  if (hint) c.appendChild(h('p', { class: 'st-hint', text: hint }));
  return c;
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function selectOf(options, value, onChange) {
  const s = h('select', { class: 'st-select' }, options.map((o) => h('option', { value: o.id, text: o.label })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/* ---------- Preview of generated items ---------- */

function preview(rec) {
  const p = rec.payload;
  const box = h('div', { class: 'st-provider' }, h('b', { text: (KIND_LABEL[rec.kind] || rec.kind) + ': ' + rec.title }));
  if (rec.kind === 'custom_column') {
    box.appendChild(h('span', { class: 'st-hint', text: 'Type: ' + p.type + (p.options && p.options.length ? ' · Options: ' + p.options.join(', ') : '') + (p.help ? ' · ' + p.help : '') }));
  } else if (rec.kind === 'report_template') {
    box.appendChild(h('ul', { class: 'st-list' }, p.sections.map((s) => h('li', { text: (s.title || s.type) + ' (' + s.type + ')' }))));
    box.appendChild(h('span', { class: 'st-hint', text: 'Sign-off: ' + p.signoffRoles.join(', ') }));
  } else if (rec.kind === 'checklist') {
    box.appendChild(h('span', { class: 'st-hint', text: 'Purpose: ' + p.purpose + (p.category ? ' · ' + p.category : '') + ' · ' + p.items.length + ' items' }));
    box.appendChild(h('ul', { class: 'st-list' }, p.items.slice(0, 8).map((i) => h('li', { text: (i.critical ? '★ ' : '') + i.text }))));
    if (p.items.length > 8) box.appendChild(h('span', { class: 'st-hint', text: '+ ' + (p.items.length - 8) + ' more' }));
  } else if (rec.kind === 'safety_rule') {
    box.appendChild(h('span', { class: 'st-hint', text: p.summary }));
    box.appendChild(h('span', { class: 'st-hint', text: [p.clause && 'Clause: ' + p.clause, p.source && 'Source: ' + p.source, p.region !== 'all' ? 'Region: ' + p.region : ''].filter(Boolean).join(' · ') }));
  }
  return box;
}

async function saveProposal(rec) {
  try {
    await snapshotBefore('Save ' + rec.title, [{ store: NOTES, id: rec.id }]);
    await approve(rec.id);
    await loadCustomColumns();
    proposals = proposals.filter((r) => r.id !== rec.id);
    toast('Saved: ' + rec.title, 'success');
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function dropProposal(rec) {
  await reject(rec.id);
  proposals = proposals.filter((r) => r.id !== rec.id);
  render();
}

/* ---------- Tabs ---------- */

async function buildTab() {
  const out = [];
  const c = card('Ask JARVIS to extend NASUR', 'Describe a new column, report, checklist or local safety rule. JARVIS prepares it and asks before saving anything.');
  c.appendChild(h('div', { class: 'st-chips' }, KIND_CHIPS.map((k) => h('button', { class: 'st-chip', type: 'button', text: k.label, 'aria-pressed': kind === k.id ? 'true' : 'false', onclick: () => { kind = k.id; render(); } }))));
  const ta = h('textarea', { class: 'st-input', rows: '5', placeholder: EXAMPLES[kind], maxlength: String(MAX_INPUT_CHARS) });
  ta.value = request;
  const count = h('span', { class: 'st-hint', text: request.length + ' / ' + MAX_INPUT_CHARS });
  ta.addEventListener('input', () => {
    request = limitInput(ta.value);
    count.textContent = request.length + ' / ' + MAX_INPUT_CHARS;
  });
  const go = h('button', { class: 'st-btn', type: 'button', text: busy ? 'JARVIS is working…' : 'Ask JARVIS', disabled: busy });
  go.addEventListener('click', async () => {
    const text = limitInput(ta.value).trim();
    if (text.length < 3) return toast('Tell JARVIS what you need', 'error');
    let k = kind;
    if (k === 'auto') k = detectIntent(text);
    if (!k) return toast('Choose a type: Column, Report, Checklist or Safety rule', 'error');
    busy = true;
    render();
    try {
      const res = await proposeFromRequest(k, text);
      proposals = res.records.concat(proposals.filter((r) => !res.records.some((n) => n.id === r.id)));
      toast(res.source === 'offline' ? 'Drafted with the offline engine' : 'JARVIS prepared it using ' + res.provider, 'success');
      request = '';
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
      render();
    }
  });
  const prov = getSettings();
  c.appendChild(ta);
  c.appendChild(count);
  c.appendChild(h('p', { class: 'st-hint', text: Object.keys(prov.apiKeys || {}).length ? 'AI keys found. JARVIS will fall back automatically if one fails.' : 'No AI key added yet. Only simple drafts work offline. Add a key in Settings for full power.' }));
  c.appendChild(go);
  out.push(c);

  const waiting = await listPending();
  const seen = new Set(waiting.map((r) => r.id));
  const all = proposals.filter((r) => !seen.has(r.id)).concat(waiting);
  if (all.length) {
    const w = card('Waiting for your Okay', 'Nothing here is active until you save it.');
    const kinds = Array.from(new Set(all.map((r) => r.kind)));
    w.appendChild(h('p', { class: 'st-label', text: askToSaveText(kinds[0], all.filter((r) => r.kind === kinds[0])) }));
    all.forEach((rec) => {
      w.appendChild(preview(rec));
      w.appendChild(h('div', { class: 'st-chips' }, h('button', { class: 'st-btn small', type: 'button', text: 'Okay, save', onclick: () => saveProposal(rec) }), h('button', { class: 'st-btn secondary small', type: 'button', text: 'No', onclick: () => dropProposal(rec) })));
    });
    out.push(w);
  }
  return out;
}

async function libraryTab() {
  const chips = h('div', { class: 'ob-chips' }, Object.keys(KIND_LABEL).map((k) => h('button', { class: 'st-chip', type: 'button', text: KIND_LABEL[k], 'aria-pressed': libKind === k ? 'true' : 'false', onclick: () => { libKind = k; render(); } })));
  const rows = await listTemplates(libKind, { status: 'approved' });
  const c = card('Saved ' + KIND_LABEL[libKind].toLowerCase() + 's', 'These came from you or from JARVIS after you said Okay.');
  if (!rows.length) c.appendChild(h('p', { class: 'st-hint', text: 'Nothing saved yet.' }));
  rows.forEach((rec) => {
    c.appendChild(preview(rec));
    c.appendChild(
      h(
        'div',
        { class: 'st-chips' },
        h('span', { class: 'st-status', text: (rec.source === 'jarvis' ? 'Made by JARVIS' : 'Made by you') + ' · v' + (rec.version || 1) }),
        h('button', {
          class: 'st-btn danger small',
          type: 'button',
          text: 'Delete',
          onclick: async () => {
            if (!window.confirm('Delete "' + rec.title + '"? You can roll this back from the Safety tab.')) return;
            await snapshotBefore('Delete ' + rec.title, [{ store: NOTES, id: rec.id }]);
            await removeTemplate(rec.id);
            await loadCustomColumns();
            render();
          }
        })
      )
    );
  });
  return [chips, c];
}

async function memoryTab() {
  const out = [];
  const on = isMemoryEnabled();
  const sw = h('input', { type: 'checkbox' });
  sw.checked = on;
  sw.addEventListener('change', async () => {
    await setMemoryEnabled(sw.checked);
    render();
  });
  const head = card('Personal memory', 'JARVIS remembers only what you approve. It never claims to remember anything that is not listed here.');
  head.appendChild(h('div', { class: 'st-row' }, h('span', { class: 'st-label', text: 'Memory on' }), h('label', { class: 'st-switch' }, sw, h('i'))));
  out.push(head);

  const props = listProposals();
  if (props.length) {
    const c = card('JARVIS would like to remember');
    props.forEach((p) => {
      c.appendChild(h('div', { class: 'st-provider' }, h('b', { text: p.title }), h('span', { class: 'st-hint', text: p.detail }), h('div', { class: 'st-chips' }, h('button', { class: 'st-btn small', type: 'button', text: 'Approve', onclick: async () => { await approveMemory(p.pid); render(); } }), h('button', { class: 'st-btn secondary small', type: 'button', text: 'No', onclick: () => { rejectMemory(p.pid); render(); } }))));
    });
    out.push(c);
  }

  const mems = await listMemories();
  const list = card('Approved memories (' + mems.length + ')');
  if (!mems.length) list.appendChild(h('p', { class: 'st-hint', text: 'Nothing saved.' }));
  mems.forEach((m) => {
    const cat = PERSONAL_CATEGORIES.find((x) => x.id === m.category);
    list.appendChild(
      h(
        'div',
        { class: 'st-provider' },
        h('b', { text: m.title }),
        h('span', { class: 'st-hint', text: (cat ? cat.label + ' · ' : '') + m.detail }),
        h(
          'div',
          { class: 'st-chips' },
          h('button', { class: 'st-btn secondary small', type: 'button', text: 'Edit', onclick: async () => { const t = window.prompt('Title', m.title); if (t === null) return; const d = window.prompt('Detail', m.detail); if (d === null) return; await updateMemory(m.id, { title: t, detail: d }); render(); } }),
          h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete', onclick: async () => { await deleteMemory(m.id); render(); } })
        )
      )
    );
  });
  if (mems.length) list.appendChild(h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete all memories', onclick: async () => { if (!window.confirm('Delete ALL personal memories?')) return; await clearPersonalMemory({ confirm: true }); render(); } }));
  out.push(list);

  const add = { category: 'lessons_learned', title: '', detail: '' };
  const t = h('input', { class: 'st-input', type: 'text', placeholder: 'Title' });
  const d = h('textarea', { class: 'st-input', rows: '2', placeholder: 'Detail' });
  const addCard = card('Add a memory yourself');
  addCard.appendChild(selectOf(PERSONAL_CATEGORIES, add.category, (v) => { add.category = v; }));
  addCard.appendChild(t);
  addCard.appendChild(d);
  addCard.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Save memory', disabled: !on, onclick: async () => { try { await saveMemory({ ...add, title: t.value, detail: d.value }, { approved: true }); render(); } catch (e) { toast(e.message, 'error'); } } }));
  out.push(addCard);

  const prof = await getUserProfile();
  const pc = card('Who I am', 'Used to match guidance to you. Your manual choices always win over automatic guesses.');
  const pf = (label, key, ph) => {
    const i = h('input', { class: 'st-input', type: 'text', value: prof[key] || '', placeholder: ph || '' });
    i.addEventListener('input', () => { prof[key] = i.value; });
    pc.appendChild(field(label, i));
  };
  pf('Who am I', 'whoAmI', 'Short description');
  pf('Current role', 'currentRole', 'e.g. assistant, officer, engineer, manager');
  pf('Industry', 'industry', 'manufacturing, construction, oilgas, marine, food_safety…');
  pc.appendChild(field('Experience level', selectOf([{ id: '', label: 'Automatic' }].concat(EXPERIENCE_BANDS.map((b) => ({ id: b, label: b }))), prof.experienceLevel || '', (v) => { prof.experienceLevel = v; })));
  pf('What I am learning', 'learning');
  pf('Learning style', 'learningStyle', 'e.g. short videos, examples, quizzes');
  pf('Next career goal', 'nextGoal');
  pc.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Save profile', onclick: async () => { await saveUserProfile(prof); toast('Profile saved', 'success'); } }));
  out.push(pc);

  const pref = await getUserPreferences();
  const prc = card('How I like answers');
  const langs = h('input', { class: 'st-input', type: 'text', value: (pref.languages || []).join(', '), placeholder: 'ta, en, hi, ar' });
  langs.addEventListener('input', () => { pref.languages = langs.value.split(',').map((x) => x.trim()).filter(Boolean); });
  prc.appendChild(field('Preferred languages', langs));
  prc.appendChild(field('Answer length', selectOf([{ id: '', label: 'Default' }, { id: 'short', label: 'Short' }, { id: 'detailed', label: 'Detailed' }], pref.answerLength || '', (v) => { pref.answerLength = v; })));
  const tone = h('input', { class: 'st-input', type: 'text', value: pref.tone || '', placeholder: 'e.g. friendly mentor' });
  tone.addEventListener('input', () => { pref.tone = tone.value; });
  prc.appendChild(field('Tone', tone));
  prc.appendChild(field('When I suggest a shortcut', selectOf([{ id: 'respectful', label: 'Challenge me respectfully' }, { id: 'direct', label: 'Challenge me directly' }], pref.challengeStyle || 'respectful', (v) => { pref.challengeStyle = v; })));
  prc.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Save preferences', onclick: async () => { await saveUserPreferences(pref); toast('Preferences saved', 'success'); } }));
  out.push(prc);
  return out;
}

async function safetyTab() {
  await loadBlueprint();
  const out = [];
  const levels = getBlueprint().deep_context_levels || [];
  const cur = getDeepContextLevel();
  const dc = card('Deep context consent', 'Controls what JARVIS may see of your screen when it asks an AI. Typed confidential values are never sent automatically.');
  DEEP_LEVELS.forEach((lv) => {
    const info = levels.find((x) => x.id === lv) || { label: lv, sends: '' };
    dc.appendChild(h('button', { class: 'st-region', type: 'button', 'aria-pressed': cur === lv ? 'true' : 'false', onclick: async () => { await setDeepContextLevel(lv); render(); } }, h('b', { text: info.label }), h('small', { text: info.sends })));
  });
  out.push(dc);

  const pc = card('Permissions', 'Least privilege. Nothing is on until you allow it.');
  listPermissions().forEach((p) => {
    pc.appendChild(
      h(
        'div',
        { class: 'st-row' },
        h('span', { class: 'st-label', text: p.id.replace(/_/g, ' ') + (p.granted ? ' · allowed' : '') }),
        h('button', {
          class: 'st-btn small' + (p.granted ? ' secondary' : ''),
          type: 'button',
          text: p.granted ? 'Revoke' : 'Allow',
          onclick: async () => {
            if (p.granted) await revokePermission(p.id);
            else if (window.confirm('Allow JARVIS to use "' + p.id.replace(/_/g, ' ') + '"?')) await grantPermission(p.id, { userApproved: true });
            render();
          }
        })
      )
    );
  });
  out.push(pc);

  const pend = listPendingApprovals();
  if (pend.length) {
    const ac = card('Waiting for your approval');
    pend.forEach((a) => ac.appendChild(h('div', { class: 'st-provider' }, h('b', { text: a.title }), h('span', { class: 'st-hint', text: a.detail + ' · risk: ' + a.risk }), h('div', { class: 'st-chips' }, h('button', { class: 'st-btn small', type: 'button', text: 'Approve', onclick: () => { resolveApproval(a.id, true); render(); } }), h('button', { class: 'st-btn secondary small', type: 'button', text: 'Deny', onclick: () => { resolveApproval(a.id, false); render(); } })))));
    out.push(ac);
  }

  const snaps = await listSnapshots();
  const rc = card('Undo and rollback', 'Every change JARVIS makes is saved first. Roll back any change with one tap.');
  rc.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Undo last change', onclick: async () => { try { const r = await undoLast(); toast('Undone: ' + r.restored + ' item(s) restored', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } }));
  if (!snaps.length) rc.appendChild(h('p', { class: 'st-hint', text: 'No changes recorded yet.' }));
  snaps.slice(0, 15).forEach((s) => {
    rc.appendChild(
      h(
        'div',
        { class: 'st-provider' },
        h('b', { text: s.title }),
        h('span', { class: 'st-hint', text: new Date(s.createdAt).toLocaleString() + (s.rolledBackAt ? ' · rolled back' : '') }),
        s.rolledBackAt ? null : h('button', { class: 'st-btn secondary small', type: 'button', text: 'Roll back this change', onclick: async () => { try { await rollback(s.id); toast('Rolled back', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } })
      )
    );
  });
  out.push(rc);

  const v = getVaultStatus();
  const vc = card('AI vault', 'Mode: ' + v.mode.replace(/_/g, ' ') + ' · providers with keys: ' + (v.providers.length ? v.providers.join(', ') : 'none') + ' · offline mode always available.');
  vc.appendChild(h('button', { class: 'st-btn secondary', type: 'button', text: 'Clear temporary session', onclick: () => { sessionClear(); toast('Session cleared', 'success'); render(); } }));
  out.push(vc);
  return out;
}

/* ---------- Screen ---------- */

async function render() {
  if (!root) return;
  const tabs = [['build', 'Build'], ['library', 'Library'], ['memory', 'Memory'], ['safety', 'Safety']];
  const chips = h('div', { class: 'ob-chips' }, tabs.map((t) => h('button', { class: 'st-chip', type: 'button', text: t[1], 'aria-pressed': tab === t[0] ? 'true' : 'false', onclick: () => { tab = t[0]; render(); } })));
  const builder = tab === 'build' ? buildTab : tab === 'library' ? libraryTab : tab === 'memory' ? memoryTab : safetyTab;
  let nodes;
  try {
    nodes = await builder();
  } catch (e) {
    nodes = [h('p', { class: 'st-hint', text: 'Could not load: ' + e.message })];
  }
  if (!root) return;
  root.replaceChildren(h('div', { class: 'st-wrap' }, h('h1', { class: 'st-title', text: 'JARVIS Studio' }), h('p', { class: 'st-sub', text: 'Extend NASUR without code. Everything needs your approval.' }), chips, nodes));
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureCss('css/observations.css');
  await loadRegions();
  await loadCustomColumns();
  await loadBlueprint();
  await render();
}

export function unmount() {
  root = null;
  body = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
