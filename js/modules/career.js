/* NASUR - Career & Competency tracker (Phase 3) */
import { EVENTS, STORES } from '../core/config.js';
import { emit, on, off } from '../core/eventbus.js';
import * as repo from '../services/repo.js';
import { getUserConfig } from '../services/config.js';
import { loadRegions, getActiveRegionId, getActiveIndustryId, listIndustries } from '../services/regions.js';

export const id = 'career';

const DATA_URL = 'data/competency.json';
const PROFILE_ID = 'me';
const CERT_STATUS = [
  { id: 'none', label: 'Not started' },
  { id: 'planned', label: 'Planned' },
  { id: 'studying', label: 'Studying' },
  { id: 'passed', label: 'Passed' }
];

let root = null;
let data = null;
let profile = null;
let saveTimer = null;
let projectHandler = null;

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
  if (document.getElementById('cr-style')) return;
  const s = document.createElement('style');
  s.id = 'cr-style';
  s.textContent =
    '.cr-bar{height:12px;border-radius:999px;background:rgba(127,127,127,.25);overflow:hidden}' +
    '.cr-bar>i{display:block;height:100%;border-radius:999px;background:var(--primary,#0a84ff)}' +
    '.cr-big{font-size:2.2rem;font-weight:800;line-height:1}' +
    '.cr-rate{display:flex;gap:4px;flex-wrap:nowrap}' +
    '.cr-rate button{appearance:none;font:inherit;color:inherit;flex:1;min-width:0;min-height:40px;border:1px solid var(--border,rgba(127,127,127,.4));background:transparent;border-radius:8px;cursor:pointer}' +
    '.cr-rate button[aria-pressed="true"]{background:var(--primary,#0a84ff);border-color:var(--primary,#0a84ff);color:#fff;font-weight:700}' +
    '.cr-rate button.req{border-color:#f59e0b;border-width:2px}' +
    '.cr-gap{color:#d97706;font-weight:700}' +
    '.cr-ok{color:#16a34a;font-weight:700}' +
    '.cr-plan{white-space:pre-line}';
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
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
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

/* ---------- Data & profile ---------- */

async function loadData() {
  if (data) return data;
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Cannot load competency data');
  data = await res.json();
  return data;
}

function defaultProfile() {
  const ind = getActiveIndustryId();
  return {
    id: PROFILE_ID,
    currentLevel: 'assistant',
    targetLevel: 'officer',
    sectors: [ind],
    ratings: {},
    certs: {},
    idip: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function loadProfile() {
  let p = null;
  try {
    p = await repo.get(STORES.CAREER_PROFILE, PROFILE_ID);
  } catch (e) {
    p = null;
  }
  profile = { ...defaultProfile(), ...(p || {}) };
  profile.ratings = profile.ratings || {};
  profile.certs = profile.certs || {};
  profile.idip = profile.idip || {};
  profile.sectors = Array.isArray(profile.sectors) && profile.sectors.length ? profile.sectors : [getActiveIndustryId()];
}

function persist(immediate) {
  profile.updatedAt = new Date().toISOString();
  const run = () => repo.save(STORES.CAREER_PROFILE, profile).catch(() => toast('Could not save career profile', 'error'));
  if (immediate) return run();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(run, 250);
  return null;
}

/* ---------- Calculations ---------- */

function levelIndex(levelId) {
  const i = data.levels.findIndex((l) => l.id === levelId);
  return i < 0 ? 0 : i;
}

function scopeCompetencies() {
  const list = data.competencies.map((c) => ({ ...c, group: 'Core' }));
  data.sectors.forEach((s) => {
    if (profile.sectors.includes(s.id)) s.skills.forEach((k) => list.push({ ...k, group: s.label }));
  });
  return list;
}

function certApplies(cert) {
  const region = getActiveRegionId();
  if (cert.regions && !cert.regions.includes(region)) return false;
  if (cert.sectors && !cert.sectors.some((s) => profile.sectors.includes(s))) return false;
  return true;
}

function certStatus(certId) {
  return (profile.certs[certId] && profile.certs[certId].status) || 'none';
}

function readiness() {
  const ti = levelIndex(profile.targetLevel);
  const comps = scopeCompetencies();
  let need = 0;
  let have = 0;
  const gaps = [];
  comps.forEach((c) => {
    const req = c.req[ti];
    const r = Math.min(5, Math.max(0, parseInt(profile.ratings[c.id], 10) || 0));
    need += req;
    have += Math.min(r, req);
    if (r < req) gaps.push({ comp: c, rating: r, req, gap: req - r });
  });
  gaps.sort((a, b) => b.gap - a.gap || (a.comp.group === 'Core' ? -1 : 1));
  const compPct = need ? Math.round((have / need) * 100) : 100;

  const certDef = data.certsByLevel[profile.targetLevel] || { required: [], recommended: [] };
  const reqCerts = certDef.required.map((cid) => data.certs.find((c) => c.id === cid)).filter((c) => c && certApplies(c));
  const missingCerts = reqCerts.filter((c) => certStatus(c.id) !== 'passed');
  const certPct = reqCerts.length ? Math.round(((reqCerts.length - missingCerts.length) / reqCerts.length) * 100) : 100;
  const overall = reqCerts.length ? Math.round(compPct * 0.7 + certPct * 0.3) : compPct;

  let verdict = 'Developing';
  if (overall >= 85 && !missingCerts.length) verdict = 'Ready for promotion';
  else if (overall >= 85) verdict = 'Skills ready, finish certificates';
  else if (overall >= 65) verdict = 'Almost there';
  return { compPct, certPct, overall, verdict, gaps, missingCerts, reqCerts, certDef };
}

function opener() {
  const lang = (getUserConfig() || {}).language;
  if (lang === 'ta') return 'Macha, ';
  if (lang === 'hi') return 'Dost, ';
  if (lang === 'ar') return 'يا صديقي، ';
  return '';
}

function advisorPlan(r) {
  const target = data.levels[levelIndex(profile.targetLevel)];
  const lines = [];
  lines.push(opener() + 'your path to ' + target.title + ' is ' + r.overall + '% ready (' + r.verdict + ').');
  if (!r.gaps.length && !r.missingCerts.length) {
    lines.push('No gaps found. Next step: ' + target.nextStep);
    return lines.join('\n');
  }
  const pick = (from, to) => r.gaps.slice(from, to).map((g) => '• ' + g.comp.name + ' (' + g.rating + ' → ' + g.req + '): ' + (g.comp.actions[0] || '')).join('\n');
  if (r.gaps.length) {
    lines.push('\nDays 1-30 (biggest gaps):\n' + pick(0, 2));
    if (r.gaps.length > 2) lines.push('\nDays 31-60:\n' + pick(2, 4));
    if (r.gaps.length > 4) lines.push('\nDays 61-90:\n' + pick(4, 6));
  }
  if (r.missingCerts.length) lines.push('\nCertificates still needed: ' + r.missingCerts.map((c) => c.name).join('; ') + '. Book the next exam and set a weekly study block.');
  lines.push('\nEach week: do one real task for your top gap, get your supervisor to sign it off, then update your rating here honestly.');
  return lines.join('\n');
}

/* ---------- UI pieces ---------- */

function selectEl(options, value, onChange) {
  const s = h('select', { class: 'st-select' });
  options.forEach((o) => {
    const opt = h('option', { value: o.id, text: o.label });
    if (o.id === value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function headerCard() {
  const levelOpts = data.levels.map((l) => ({ id: l.id, label: l.title }));
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'My career path' }));
  c.appendChild(h('div', { class: 'st-row' }, h('span', { class: 'st-label', text: 'Current role' }), selectEl(levelOpts, profile.currentLevel, (v) => {
    profile.currentLevel = v;
    if (levelIndex(profile.targetLevel) <= levelIndex(v) && levelIndex(v) < data.levels.length - 1) profile.targetLevel = data.levels[levelIndex(v) + 1].id;
    persist(true);
    render();
  })));
  c.appendChild(h('div', { class: 'st-row' }, h('span', { class: 'st-label', text: 'Target role' }), selectEl(levelOpts, profile.targetLevel, (v) => {
    profile.targetLevel = v;
    persist(true);
    render();
  })));
  const chips = h('div', { class: 'st-chips' });
  listIndustries().forEach((i) => {
    chips.appendChild(
      h('button', {
        class: 'st-chip',
        type: 'button',
        text: i.label,
        'aria-pressed': profile.sectors.includes(i.id) ? 'true' : 'false',
        onclick: () => {
          const k = profile.sectors.indexOf(i.id);
          if (k >= 0 && profile.sectors.length > 1) profile.sectors.splice(k, 1);
          else if (k < 0) profile.sectors.push(i.id);
          persist(true);
          render();
        }
      })
    );
  });
  c.appendChild(h('span', { class: 'st-label', text: 'Sector skills to track' }));
  c.appendChild(chips);
  return c;
}

function readinessCard(r) {
  const target = data.levels[levelIndex(profile.targetLevel)];
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Promotion readiness → ' + target.title }));
  c.appendChild(h('div', { class: 'cr-big', text: r.overall + '%' }));
  c.appendChild(h('div', { class: 'cr-bar' }, h('i', { style: 'width:' + r.overall + '%' })));
  c.appendChild(h('p', { class: 'st-label', text: r.verdict }));
  c.appendChild(h('p', { class: 'st-hint', text: 'Skills ' + r.compPct + '% · Certificates ' + r.certPct + '% · Typical time in role: ' + data.levels[levelIndex(profile.currentLevel)].years + ' years' }));
  c.appendChild(h('span', { class: 'st-label', text: 'Promotion criteria' }));
  c.appendChild(h('ul', { class: 'st-list' }, target.promotion.map((p) => h('li', { text: p }))));
  return c;
}

function advisorCard(r) {
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'JARVIS skill-gap advisor' }));
  c.appendChild(h('p', { class: 'st-hint cr-plan', text: advisorPlan(r) }));
  c.appendChild(
    h('button', {
      class: 'st-btn secondary small',
      type: 'button',
      text: 'Save plan to memory notes',
      onclick: async () => {
        const now = new Date().toISOString();
        await repo.save(STORES.MEMORY_NOTES, { id: 'mem_career_plan', kind: 'career-plan', title: 'Career plan to ' + profile.targetLevel, detail: advisorPlan(r), createdAt: now, updatedAt: now });
        toast('Plan saved', 'success');
      }
    })
  );
  return c;
}

function ratingRow(comp, ti) {
  const req = comp.req[ti];
  const cur = Math.min(5, Math.max(0, parseInt(profile.ratings[comp.id], 10) || 0));
  const rate = h('div', { class: 'cr-rate' });
  for (let n = 0; n <= 5; n++) {
    rate.appendChild(
      h('button', {
        type: 'button',
        text: String(n),
        class: n === req ? 'req' : '',
        'aria-pressed': n === cur ? 'true' : 'false',
        'aria-label': comp.name + ' level ' + n,
        onclick: () => {
          profile.ratings[comp.id] = n;
          persist(false);
          render();
        }
      })
    );
  }
  return h(
    'div',
    { class: 'st-provider' },
    h('div', { class: 'st-provider-head' }, h('b', { text: comp.name }), h('span', { class: cur >= req ? 'cr-ok' : 'cr-gap', text: cur + '/' + req })),
    rate
  );
}

function competencyCards() {
  const ti = levelIndex(profile.targetLevel);
  const groups = {};
  scopeCompetencies().forEach((c) => {
    (groups[c.group] = groups[c.group] || []).push(c);
  });
  return Object.keys(groups).map((g) => {
    const card = h('section', { class: 'st-card' }, h('h2', { text: g + ' competencies' }), h('p', { class: 'st-hint', text: 'Rate yourself honestly 0-5. Orange outline = level needed for ' + data.levels[ti].title + '.' }));
    groups[g].forEach((c) => card.appendChild(ratingRow(c, ti)));
    return card;
  });
}

function certCard(r) {
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Certificates & NEBOSH Level 6' }), h('p', { class: 'st-hint', text: data.verifyNote }));
  const needed = new Set(r.certDef.required);
  const rec = new Set(r.certDef.recommended);
  data.certs.filter(certApplies).forEach((cert) => {
    c.appendChild(
      h(
        'div',
        { class: 'st-provider' },
        h('div', { class: 'st-provider-head' }, h('b', { text: cert.name }), h('span', { class: 'st-status', text: needed.has(cert.id) ? 'Required' : rec.has(cert.id) ? 'Recommended' : 'Optional' })),
        h('span', { class: 'st-status', text: cert.note }),
        selectEl(CERT_STATUS, certStatus(cert.id), (v) => {
          profile.certs[cert.id] = { status: v, date: v === 'passed' ? new Date().toISOString().slice(0, 10) : '' };
          persist(true);
          render();
        })
      )
    );
  });
  c.appendChild(h('span', { class: 'st-label', text: 'NEBOSH IDIP progress' }));
  data.idipUnits.forEach((u) => {
    c.appendChild(
      h('div', { class: 'st-row' }, h('span', { class: 'st-hint', text: u.name }), selectEl(CERT_STATUS, profile.idip[u.id] || 'none', (v) => {
        profile.idip[u.id] = v;
        persist(true);
        render();
      }))
    );
  });
  return c;
}

function roadmapCard() {
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Career roadmap' }));
  c.appendChild(
    h(
      'ul',
      { class: 'st-list' },
      data.levels.map((l) =>
        h('li', { class: l.id === profile.currentLevel ? 'on' : '' }, l.title + ' (' + l.years + ' yrs)', l.id === profile.currentLevel ? h('span', { class: 'st-tag', text: 'YOU' }) : null, h('small', { text: l.scope + ' Next: ' + l.nextStep }))
      )
    )
  );
  return c;
}

/* ---------- Lifecycle ---------- */

function render() {
  if (!root || !data || !profile) return;
  const r = readiness();
  const wrap = h(
    'div',
    { class: 'st-wrap' },
    h('h1', { class: 'st-title', text: 'Career & Competency' }),
    h('p', { class: 'st-sub', text: 'Assistant → Officer → Engineer → Manager, with NEBOSH Level 6' }),
    headerCard(),
    readinessCard(r),
    advisorCard(r),
    competencyCards(),
    certCard(r),
    roadmapCard()
  );
  root.replaceChildren(wrap);
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  ensureStyle();
  root.replaceChildren(h('div', { class: 'st-wrap' }, h('p', { class: 'st-sub', text: 'Loading…' })));
  try {
    await loadRegions();
    await loadData();
    await loadProfile();
    render();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'st-wrap' }, h('p', { class: 'st-hint', text: 'Could not load career data: ' + e.message })));
    return;
  }
  projectHandler = () => {
    if (root) render();
  };
  on(EVENTS.PROJECT_CHANGED, projectHandler);
}

export function unmount() {
  clearTimeout(saveTimer);
  if (profile) persist(true);
  if (projectHandler) off(EVENTS.PROJECT_CHANGED, projectHandler);
  projectHandler = null;
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
