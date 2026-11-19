/* =====================================================================
 * NASUR HSE OS — js/jarvis/drawer.js   (PHASE 1 FIX · v8)
 * One JARVIS: floating button + drawer, matched to css/jarvis.css (.jv-*),
 * one voice engine (js/jarvis/voice.js), one AI router, one offline engine.
 * Created by Nasur
 *
 * WHY THIS FILE CHANGED
 *   - index.html sets style-src 'self': styles injected from JavaScript are
 *     blocked. All styling now comes from css/jarvis.css (loaded here as a
 *     <link>, because index.html does not link it).
 *   - Home "Ask" used #jarvis-text / #jarvis-btn-send, which did not exist.
 *     Home now calls getJarvis().ask(text).
 *   - Module routes use hyphens (/machine-safety). Navigation goes through
 *     hrefFor() from js/core/router.js.
 *   - Voice uses voice.js (startListening / speak) instead of a second engine.
 *
 * AI ROUTER (honest labels on every answer)
 *   0. Offline engine (built-in HSE knowledge, always available)
 *   1. Your keys, in this order: js/services/settings.js providerOrder,
 *      then js/services/config.js apiKeys, then legacy localStorage keys
 *      (OpenRouter "openrouter/free", Gemini, Groq, OpenAI, DeepSeek, Mistral)
 *   2. Keyless free endpoint (Pollinations) — best effort, may be busy or limited
 *   3. Offline engine again if nothing online answers
 *   Online AI is used only when Settings → privacy "ai_enabled" is on; JARVIS
 *   asks once, inline, and one tap turns it on.
 *
 * BOOT-SAFE: no static imports. Every app module is loaded lazily and
 * defensively, so a missing file can never stop NASUR from starting.
 * ===================================================================== */

/* ------------------------------ LAZY MODULES ------------------------------ */
let _P = null;
let _M = null;
const lazy = async (p) => { try { return await import(p); } catch (e) { console.warn('[JARVIS] optional module unavailable:', p, e && e.message); return {}; } };
function mods() {
  if (_P) return _P;
  _P = (async () => {
    const [ev, cc, ob, ac, op, rg, rt, vc, sc, ss] = await Promise.all([
      lazy('../core/eventbus.js'), lazy('../core/config.js'), lazy('../services/observations.js'), lazy('../services/actions.js'),
      lazy('../services/opsstore.js'), lazy('../services/regions.js'), lazy('../core/router.js'), lazy('./voice.js'),
      lazy('../services/config.js'), lazy('../services/settings.js')]);
    const iso = (d) => d.toISOString().slice(0, 10);
    _M = {
      emit: ev.emit || null, EVENTS: cc.EVENTS || null,
      createObservation: ob.createObservation, createAction: ac.createAction,
      saveOps: op.saveOps, KINDS: op.KINDS || {}, getActiveRegionId: rg.getActiveRegionId,
      todayIso: op.todayIso || (() => iso(new Date())),
      addDaysIso: op.addDaysIso || ((d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return iso(x); }),
      hrefFor: rt.hrefFor || null, voice: vc, svcConfig: sc, svcSettings: ss,
    };
    return _M;
  })();
  return _P;
}

/* ------------------------------ CONSTANTS ------------------------------ */
const LS = {
  hist: 'nasur_jarvis_hist', lang: 'nasur_jarvis_lang', law: 'nasur_jarvis_law',
  hf: 'nasur_hf_token', hfRepo: 'nasur_hf_repo', core: 'nasur_allow_core',
  apiUrl: 'nasur_api_url', apiKey: 'nasur_api_key', apiModel: 'nasur_api_model',
  voice: 'nasur_jv_voice', speak: 'nasur_jv_autospeak',
};
const HF_DEFAULT_REPO = 'Nasurisai/Nasur';
const POLL_TEXT = 'https://text.pollinations.ai/openai';
const CONSENT_GAP_MS = 10 * 60 * 1000;

/* module id by spoken keyword; the real route comes from hrefFor(id) (routes use hyphens) */
const ROUTE_IDS = {
  home: 'home', jarvis: 'jarvis_studio', observations: 'observations', observation: 'observations',
  incidents: 'incidents', incident: 'incidents', rca: 'rca_coach', reports: 'reports', report: 'reports',
  history: 'history_search', activities: 'activity_encyclopedia', fire: 'fire_safety', ppe: 'ppe_guide',
  machine: 'machine_safety', permit: 'ptw_jsa', ptw: 'ptw_jsa', jsa: 'ptw_jsa', emergency: 'emergency',
  document: 'doc_control', audits: 'audits', audit: 'audits', client: 'clients', project: 'clients',
  workspace: 'workspace', career: 'career', settings: 'settings', more: 'more',
};
const LAWS = {
  IN: 'India: Factories Act 1948, BOCW Act 1996, state factory rules, OSH Code 2020, Indian Electricity Rules, ESIC/EPF',
  GULF: 'UAE/Saudi/Qatar: UAE Federal Labour Law, ADNOC HSE/CoP, Saudi Aramco SAES/SAEP, Saudi Labor Law, Qatar Law 14/2004, OSHAD (Abu Dhabi)',
  CA: 'Canada: provincial OHS Acts (e.g. Ontario OHSA), Canada Labour Code Part II, WHMIS 2015, CSA standards',
  US: 'USA: OSHA 29 CFR 1910 (general) / 1926 (construction), NFPA 70E, ANSI standards, General Duty Clause',
};

/* AI providers JARVIS can call with a user key (all OpenAI-compatible) */
const ENDPOINTS = {
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: ['openrouter/free'], visionModels: ['openrouter/free'] },
  gemini: { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: ['gemini-2.5-flash', 'gemini-2.0-flash'], visionModels: ['gemini-2.5-flash', 'gemini-2.0-flash'] },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: ['llama-3.3-70b-versatile'], visionModels: ['meta-llama/llama-4-scout-17b-16e-instruct'] },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4o-mini'], visionModels: ['gpt-4o-mini'] },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat'], visionModels: null },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', models: ['mistral-small-latest'], visionModels: null },
};
const normProvider = (id) => {
  const s = String(id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('openrouter')) return 'openrouter';
  if (s.includes('gemini') || s.includes('google')) return 'gemini';
  if (s.includes('groq')) return 'groq';
  if (s.includes('deepseek')) return 'deepseek';
  if (s.includes('mistral')) return 'mistral';
  if (s.includes('openai') || s === 'gpt' || s === 'chatgpt') return 'openai';
  return null;
};

/* ------------------------------ UTILITIES ------------------------------ */
const ESC_MAP = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c.charCodeAt(0)]);
const lsGet = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const uid = () => Math.random().toString(36).slice(2, 10);
const isTamilScript = (t) => /[\u0B80-\u0BFF]/.test(t);
const isTamil = (t) => isTamilScript(t) || /\b(enna|epdi|eppadi|sollu|venum|pannu|seiya|iruku|illa|macha|vendum|panna|kaattu|thevai|eduthu)\b/i.test(t);
const fenceRe = /```([\w.+-]*)\n([\s\S]*?)```/g;
const safeJSON = (t) => {
  if (!t) return null;
  const m = String(t).replace(/```json|```/g, '').match(/[\[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const sevOf = (s) => { s = String(s || '').toLowerCase(); return /crit|high|major|severe/.test(s) ? 'high' : /low|minor/.test(s) ? 'low' : 'medium'; };
const safe = (f) => { try { return f(); } catch { return null; } };
const b64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin); };

function toast(message, type) {
  try {
    if (_M && _M.emit && _M.EVENTS && _M.EVENTS.TOAST) { _M.emit(_M.EVENTS.TOAST, { message, type: type || 'info' }); return; }
  } catch { /* fall through */ }
  setStatus(message);
}

/* ------------------------------ STATE ------------------------------ */
const S = {
  inited: false, open: false, busy: false, handsfree: false, speaking: false, autoSpeak: lsGet(LS.speak, '1') !== '0',
  session: null, hfMiss: 0, pendingPhoto: null, pendingBuild: null, queue: [], ui: null,
  history: [], bad: new Set(), cool: {}, cache: new Map(), consentAt: 0, lastProvider: '', lastErrors: [],
};
try { S.history = JSON.parse(lsGet(LS.hist, '[]')); } catch { S.history = []; }
if (!Array.isArray(S.history)) S.history = [];
const saveHist = () => lsSet(LS.hist, JSON.stringify(S.history.slice(-40).map((m) => ({
  id: m.id, role: m.role, expert: m.expert, via: m.via, ts: m.ts,
  text: String(m.text).length > 6000 ? String(m.text).slice(0, 6000) + '\n…(truncated in history)' : m.text,
}))));

/* ------------------------------ OFFLINE HSE ENGINE ------------------------------ */
const KB = [
  { k: /ptw|permit|hot work|confined|height|work at height|lockout|loto/i,
    en: '**Permit to Work (PTW) essentials**\n• Valid only for the stated job, area, time & people; issuer ≠ receiver.\n• Pre-checks: JSA/risk assessment, isolation (LOTO), gas test (O2 19.5–23.5%, LEL <10%), fire watch for hot work, rescue plan for confined space.\n• Work at height: full-body harness, 100% tie-off, anchor point rated and approved for the load by a competent person (check OSHA 1926.502 / EN 795 or your site standard), scaffold tagged (green), no work in high wind/rain.\n• Close-out: area cleaned, isolation removed by the same authority, permit signed & filed.',
    ta: '**அனுமதி (PTW) முக்கியக் குறிப்புகள்**\n• குறிப்பிட்ட வேலை, இடம், நேரம், ஆட்களுக்கு மட்டும் செல்லும்; வழங்குபவர் ≠ பெறுபவர்.\n• முன் சோதனை: JSA, LOTO தனிமைப்படுத்தல், வாயு சோதனை (O2 19.5–23.5%, LEL <10%), Hot work-க்கு Fire watch, Confined space-க்கு மீட்புத் திட்டம்.\n• உயரத்தில் வேலை: Full-body harness, 100% tie-off, தகுதியானவர் அங்கீகரித்த anchor point, பச்சை tag உள்ள scaffold மட்டும்.\n• முடிவில்: இடம் சுத்தம், LOTO நீக்கம், permit கையொப்பம் & கோப்பு.' },
  { k: /fire|extinguisher|evacuat|flammable|nfpa/i,
    en: '**Fire safety**\n• Classes: A (solids) water/ABC, B (liquids) foam/CO2/DCP, C (gas) isolate + DCP, D (metals) dry powder, E (electrical) CO2, F (oils) wet chemical. (Class letters differ between EU/US systems — check your site standard.)\n• PASS: Pull, Aim, Squeeze, Sweep. Inspect monthly, service yearly, hydrotest per schedule.\n• Keep exits unlocked, assembly points marked, drills at least 2×/year. Travel distance limits depend on local code — verify.',
    ta: '**தீ பாதுகாப்பு**\n• வகைகள்: A (திடம்), B (திரவம்), C (வாயு), D (உலோகம்), E (மின்), F (எண்ணெய்).\n• PASS: இழு, குறி, அழுத்து, வீசு. மாதம் ஆய்வு, ஆண்டு சேவை.\n• வெளியேறும் வழி திறந்திருக்கணும், Assembly point குறியிடணும், ஆண்டுக்கு 2 drill.' },
  { k: /ppe|helmet|glove|harness|goggle|respirator|safety shoe/i,
    en: '**PPE selection**\n• Head: EN 397/ANSI Z89.1 helmet. Eyes: EN 166 / ANSI Z87.1. Hearing: >85 dB(A) 8-hr TWA → plugs/muffs.\n• Hands: cut (EN 388), chemical (EN 374), heat (EN 407). Feet: S3 safety shoes. Body: FR coverall for hot work.\n• Respirators: fit-test, correct filter (P2/P3, ABEK). PPE is the LAST line of the hierarchy of controls.',
    ta: '**PPE தேர்வு**\n• தலை: Helmet (EN 397). கண்: EN 166. காது: 85 dB(A)-க்கு மேல் plugs/muffs.\n• கை: cut/chemical/heat gloves. கால்: S3 shoes. உடல்: FR coverall.\n• Respirator: fit-test + சரியான filter. PPE கடைசி கட்டுப்பாடு.' },
  { k: /incident|rca|root cause|5 why|fishbone|investigation|near miss/i,
    en: '**Incident investigation / RCA**\n1. Secure scene, first aid, notify. 2. Collect evidence (photos, statements, logs). 3. Timeline. 4. 5-Why / Fishbone / TapRooT. 5. Root causes (system, not "operator error"). 6. CAPA with owner + date. 7. Share lessons, verify closure.\nMetrics: TRIR = (cases × 200,000) / hours; LTIFR = (LTIs × 1,000,000) / hours.',
    ta: '**சம்பவ விசாரணை / RCA**\n1. இடத்தைப் பாதுகாத்து முதலுதவி. 2. ஆதாரம் (படம், வாக்குமூலம்). 3. Timeline. 4. 5-Why / Fishbone. 5. அடிப்படைக் காரணம் (அமைப்பு சார்ந்தது). 6. CAPA – பொறுப்பாளர் + தேதி. 7. பாடம் பகிர்ந்து மூடல் சரிபார்.' },
  { k: /45001|iso|audit|clause|14001|management system/i,
    en: '**ISO 45001:2018 map**\n4 Context · 5 Leadership & worker participation · 6 Planning (hazards, risks, legal, objectives) · 7 Support (competence, communication, documented info) · 8 Operation (hierarchy of controls, MOC, procurement, emergency) · 9 Performance evaluation (monitoring, internal audit, management review) · 10 Improvement (incident, NC, CAPA).\nAudit tip: sample evidence, interview workers, trace a hazard from register → control → record.',
    ta: '**ISO 45001:2018 வரைபடம்**\n4 சூழல் · 5 தலைமை · 6 திட்டமிடல் (ஆபத்து, சட்டம்) · 7 ஆதரவு · 8 செயல்பாடு (Hierarchy of controls, MOC) · 9 மதிப்பீடு (Audit, Review) · 10 மேம்பாடு (CAPA).' },
  { k: /factories act|bocw|osha|adnoc|aramco|law|legal|statut/i,
    en: '**Key legal anchors (verify the latest text before relying on it)**\n• India: Factories Act 1948 (s.7A occupier duties, s.36 dangerous fumes/confined space, s.40A building safety), BOCW 1996, OSH Code 2020.\n• Gulf: ADNOC CoP, Aramco SAES/SAEP, OSHAD-SF.\n• USA: OSHA 1910/1926 — fall protection trigger 6 ft in construction, 4 ft in general industry.\n• Canada: provincial OHSA, WHMIS. Always confirm current amendments with the competent authority.',
    ta: '**முக்கிய சட்டங்கள் (சமீபத்திய உரையை சரிபார்க்கவும்)**\n• இந்தியா: Factories Act 1948, BOCW 1996, OSH Code 2020.\n• வளைகுடா: ADNOC, Aramco, OSHAD.\n• USA: OSHA 1910/1926. Canada: OHSA, WHMIS.\nசமீபத்திய திருத்தங்களை அதிகாரியிடம் உறுதிப்படுத்தவும்.' },
  { k: /machine|guard|press|lathe|conveyor|interlock|e-stop|cnc/i,
    en: '**Machine safety**\n• Fixed guards for permanent hazards; interlocked guards where access is frequent; light curtains/two-hand control for presses.\n• E-stop red on yellow, latched, tested regularly. LOTO for maintenance (lock, tag, try).\n• Check nip points, rotating parts, stored energy (hydraulic, pneumatic, springs, gravity). Standards: ISO 12100, ISO 13849, IEC 62061.',
    ta: '**இயந்திரப் பாதுகாப்பு**\n• நிலையான guard, அடிக்கடி அணுகும் இடத்தில் interlock, press-க்கு light curtain.\n• E-stop தொடர்ந்து சோதனை; பராமரிப்புக்கு LOTO.\n• Nip point, சுழலும் பாகம், சேமிக்கப்பட்ட ஆற்றல் சரிபார்.' },
  { k: /interview|career|resume|cv|question/i,
    en: '**HSE interview prep**\nExpect: hierarchy of controls, PTW types, LOTO steps, incident rate formulas, RCA method used, how you handled a stop-work conflict, ISO 45001 clauses, legal duties, leading vs lagging KPIs. Use STAR (Situation-Task-Action-Result) with real numbers from your own experience.',
    ta: '**HSE நேர்காணல் தயாரிப்பு**\nகேள்விகள்: Hierarchy of controls, PTW வகைகள், LOTO, TRIR/LTIFR, RCA, ISO 45001. STAR முறையில் உங்கள் சொந்த அனுபவ எண்களுடன் பதில் சொல்லுங்கள்.' },
  { k: /toolbox|tbt|induction|training/i,
    en: '**Toolbox talk (10 min)**\nHook (real incident) → hazard of today\'s job → controls → PPE → emergency/assembly → questions → sign-off sheet. Rotate topics: LOTO, heat stress, housekeeping, manual handling, electrical, lifting.',
    ta: '**Toolbox talk (10 நிமிடம்)**\nஉண்மைச் சம்பவம் → இன்றைய வேலை ஆபத்து → கட்டுப்பாடு → PPE → அவசரநிலை → கேள்வி → கையொப்பம்.' },
];
const OFFLINE_DEFAULT = {
  en: 'I\'m using the **offline engine** (no online AI answered). I can still help with PTW, LOTO, fire, PPE, machine safety, RCA, ISO 45001, laws, interviews and toolbox talks — or say "audit this report", "make a poster on …", "create observation: …", "open audits".',
  ta: 'நான் **offline engine**-ல் இருக்கேன் (online AI பதில் தரவில்லை). PTW, LOTO, தீ, PPE, இயந்திரம், RCA, ISO 45001, சட்டம் பற்றி கேளுங்க — அல்லது "audit this report", "poster on …", "create observation: …", "open audits" சொல்லுங்க.',
};
function offlineAnswer(q) {
  const ta = isTamil(q) || lsGet(LS.lang) === 'ta';
  const hit = KB.find((e) => e.k.test(q));
  return hit ? (ta ? hit.ta : hit.en) : (ta ? OFFLINE_DEFAULT.ta : OFFLINE_DEFAULT.en);
}

/* ------------------------------ AI ROUTER ------------------------------ */
const SYS_BASE = () => `You are JARVIS, the senior HSE AI of the NASUR HSE Operating System, built for Nasur. Expert in ISO 45001/14001, OSHA, Factories Act, BOCW, ADNOC/Aramco, NFPA, ILO. Be precise, practical, cite standards. Reply in ${lsGet(LS.lang) === 'ta' ? 'Tamil (technical terms in English)' : lsGet(LS.lang) === 'en' ? 'English' : 'the same language as the user (English, Tamil or Tanglish)'}. Keep answers short and clear for a phone screen. Jurisdiction focus: ${LAWS[lsGet(LS.law, 'IN')] || LAWS.IN}. Never invent legal clause numbers; say "verify" if unsure.`;

async function fetchT(url, opt, ms = 45000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}

async function aiAllowed() {
  const M = await mods();
  try {
    if (!M.svcConfig || !M.svcConfig.getUserConfig) return true;
    const c = (M.svcConfig.getCachedUserConfig && M.svcConfig.getCachedUserConfig()) || await M.svcConfig.getUserConfig();
    return !!(c && c.privacy && c.privacy.ai_enabled);
  } catch { return true; }
}

/** Every provider that has a saved key, in priority order. */
async function collectProviders() {
  const M = await mods(); const out = []; const seen = new Set();
  const add = (rawId, key, source) => {
    const id = normProvider(rawId); const k = String(key || '').trim();
    if (!id || !k || seen.has(id)) return;
    seen.add(id); out.push({ id, key: k, source, ...ENDPOINTS[id] });
  };
  safe(() => {
    const s = M.svcSettings && M.svcSettings.getSettings ? M.svcSettings.getSettings() : null;
    if (s && s.apiKeys) {
      const order = Array.isArray(s.providerOrder) ? s.providerOrder : [];
      order.concat(Object.keys(s.apiKeys)).forEach((id) => add(id, s.apiKeys[id], 'Settings'));
    }
  });
  safe(() => {
    const c = M.svcConfig && M.svcConfig.getCachedUserConfig ? M.svcConfig.getCachedUserConfig() : null;
    if (c && c.apiKeys) Object.keys(c.apiKeys).forEach((id) => add(id, c.apiKeys[id], 'JARVIS'));
  });
  ['openrouter', 'gemini', 'groq'].forEach((id) => add(id, lsGet('nasur_key_' + id), 'this device'));
  const url = lsGet(LS.apiUrl), key = lsGet(LS.apiKey);
  if (url && key && !seen.has('custom')) {
    seen.add('custom');
    out.push({ id: 'custom', key, source: 'this device', label: 'Custom API', url, models: [lsGet(LS.apiModel, 'gpt-4o-mini')], visionModels: null });
  }
  return out;
}

async function callProvider(p, messages, o) {
  const models = (o.vision ? p.visionModels : p.models) || p.models;
  let lastErr = new Error('no model');
  for (const model of models) {
    const r = await fetchT(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
      body: JSON.stringify({ model, messages, temperature: o.temperature ?? 0.4 }) }, o.timeout || 30000);
    if (r.ok) {
      const j = await r.json(); const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      const t = Array.isArray(c) ? c.map((x) => x.text || '').join('') : c;
      if (t && String(t).trim()) return String(t);
      lastErr = new Error('empty reply'); continue;
    }
    if (r.status === 401 || r.status === 403) { S.bad.add(p.id); throw new Error('key rejected (' + r.status + ')'); }
    if (r.status === 429) { S.cool[p.id] = Date.now() + 60000; throw new Error('rate limited'); }
    lastErr = new Error('HTTP ' + r.status);
  }
  throw lastErr;
}

/** Returns { text, provider }. Throws 'ai_disabled', 'offline' or 'unavailable'. */
async function llm(messages, o = {}) {
  if (!(await aiAllowed())) throw new Error('ai_disabled');
  if (navigator.onLine === false) throw new Error('offline');
  const vision = !!o.vision;
  const ckey = !vision && !o.noCache ? JSON.stringify(messages.slice(-3)) : null;
  if (ckey) { const hit = S.cache.get(ckey); if (hit && Date.now() - hit.t < 600000) return { text: hit.text, provider: hit.provider }; }
  const errors = [];
  const done = (text, provider) => {
    S.lastProvider = provider; setBadgeText('☁ ' + provider, 'online');
    if (ckey) { S.cache.set(ckey, { t: Date.now(), text, provider }); if (S.cache.size > 30) S.cache.delete(S.cache.keys().next().value); }
    return { text, provider };
  };
  const list = (await collectProviders()).filter((p) => !S.bad.has(p.id) && !(S.cool[p.id] > Date.now()) && (!vision || p.visionModels));
  for (const p of list) {
    try { return done(await callProvider(p, messages, o), p.label); } catch (e) { errors.push(p.label + ': ' + (e && e.name === 'AbortError' ? 'timeout' : e.message)); }
  }
  try { // keyless, best effort
    const r = await fetchT(POLL_TEXT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: o.model || 'openai', messages, temperature: o.temperature ?? 0.4, private: true }) }, o.timeout || 30000);
    if (r.ok) { const j = await r.json(); const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; if (t) return done(String(t), 'Free keyless AI'); }
    errors.push('Free keyless AI: HTTP ' + r.status);
  } catch (e) { errors.push('Free keyless AI: ' + (e && e.name === 'AbortError' ? 'timeout' : 'unreachable')); }
  S.lastErrors = errors;
  throw new Error('unavailable');
}

/* ------------------------------ EXPERT ROUTER ------------------------------ */
const AUTOBUILD_RE = /^\s*(please\s+|jarvis[, ]+)?(build|create|make|develop|implement|generate|code|add)\b[\s\S]{0,70}\b(module|feature|tool|page|screen|dashboard|calculator|tracker|builder|generator|studio|phase\s*\d+)\b|\bphase\s*(?:[7-9]|1[0-9])\b/i;
function route(text, hasPhoto) {
  if (hasPhoto) return 'photo';
  if (/^(create|add|log|raise|new)\s+(an?\s+)?(observation|action|permit|ptw)\b/i.test(text)) return 'exec';
  if ((/^(open|go to|navigate|show me|take me)\b/i.test(text) || /^(திற|போ)/.test(text)) && Object.keys(ROUTE_IDS).some((k) => text.toLowerCase().includes(k))) return 'nav';
  if (AUTOBUILD_RE.test(text)) return 'autobuild';
  if (/(poster|banner|flyer|signage|safety slogan|பேனர்|போஸ்டர்)/i.test(text)) return 'poster';
  if (/(audit|review|check).{0,25}(report|dsr|daily|checklist)|daily (site )?report|\bDSR\b/i.test(text) || (text.length > 350 && /(permit|toolbox|ppe|manpower|workers|shift|site)/i.test(text) && /report|date|supervisor/i.test(text))) return 'audit';
  if (/(write|build|code|module|file|function|css|html|javascript|\.js\b|commit|deploy|hugging ?face)/i.test(text) && /(code|module|file|\.js|function|component|deploy|commit|script)/i.test(text)) return 'coder';
  if (/(iso|osha|factories act|bocw|adnoc|aramco|interview|standard|clause|regulation|study|explain|compare)/i.test(text)) return 'research';
  return 'general';
}
const EXPERT_LABEL = { photo: '📷 Hazard Scanner', exec: '⚡ Executor', nav: '🧭 Navigator', poster: '🎨 Poster Builder', audit: '🕵️ Report Auditor', coder: '💻 Autonomous Coder', autobuild: '🤖 Autonomous Builder', research: '📚 Research Expert', general: '🧠 JARVIS Brain' };

/* ------------------------------ EXECUTOR / NAV ------------------------------ */
function hrefOf(moduleId) {
  const h = _M && _M.hrefFor ? safe(() => _M.hrefFor(moduleId)) : null;
  return h || ('#/' + String(moduleId).replace(/_/g, '-'));
}
function goTo(text) {
  const k = Object.keys(ROUTE_IDS).find((x) => text.toLowerCase().includes(x));
  if (!k) return false;
  const href = hrefOf(ROUTE_IDS[k]);
  location.hash = href.charAt(0) === '#' ? href : '#' + href;
  return href;
}
async function doCreateObservation(o) {
  const M = await mods();
  if (!M.createObservation) throw new Error('observations service unavailable');
  const rec = { title: o.title, description: o.description || o.title, severity: sevOf(o.severity), category: o.category || 'General',
    status: 'open', date: M.todayIso(), source: 'jarvis', photo: o.photo || null, regionId: safe(() => M.getActiveRegionId()) };
  const r = await M.createObservation(rec); if (M.emit) safe(() => M.emit('observation:created', r)); return r;
}
async function doCreateAction(o) {
  const M = await mods();
  if (!M.createAction) throw new Error('actions service unavailable');
  const rec = { title: o.title, description: o.description || '', priority: sevOf(o.priority), status: 'open',
    dueDate: o.dueDate || M.addDaysIso(M.todayIso(), o.days ?? (sevOf(o.priority) === 'high' ? 1 : sevOf(o.priority) === 'medium' ? 7 : 30)),
    source: 'jarvis', regionId: safe(() => M.getActiveRegionId()) };
  const r = await M.createAction(rec); if (M.emit) safe(() => M.emit('action:created', r)); return r;
}
async function execCommand(text) {
  const m = text.match(/^(?:create|add|log|raise|new)\s+(?:an?\s+)?(observation|action|permit|ptw)\s*[:\-]?\s*(.*)$/i);
  const kind = m[1].toLowerCase(), body = (m[2] || '').trim() || 'Untitled (created by JARVIS)';
  if (kind === 'observation') { await doCreateObservation({ title: body.slice(0, 90), description: body }); return `✅ Observation created: **${esc(body.slice(0, 90))}**`; }
  if (kind === 'action') { await doCreateAction({ title: body.slice(0, 90), description: body, priority: 'medium' }); return `✅ Action created (due in 7 days): **${esc(body.slice(0, 90))}**`; }
  try { const M = await mods(); await M.saveOps?.(M.KINDS?.PERMITS || M.KINDS?.PTW || 'permits', { title: body, status: 'draft', createdAt: M.todayIso(), source: 'jarvis' }); } catch { /* ignore */ }
  goTo('permit'); return `📝 Permit draft started: **${esc(body)}** — opened PTW/JSA module.`;
}

/* ------------------------------ PHOTO HAZARD SCANNER ------------------------------ */
function fileToDataUrl(file, max = 1024) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onerror = rej;
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.72));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function scanPhoto(dataUrl, note) {
  const prompt = `Inspect this industrial/construction site photo as a senior HSE officer. Detect: missing PPE (helmet, vest, harness, gloves, shoes, eye), unsafe scaffolding/ladders, work at height, housekeeping, electrical, machine guarding, fire, confined space, lifting, PTW/barricade/signage violations. ${note ? 'User note: ' + note : ''}
Return ONLY JSON: {"summary":"...","overall_risk":"low|medium|high","hazards":[{"title":"","severity":"low|medium|high","category":"","detail":"","corrective_action":""}],"positives":["..."]}`;
  const r = await llm([{ role: 'system', content: SYS_BASE() },
    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], { temperature: 0.2, vision: true, timeout: 45000 });
  return { data: safeJSON(r.text), provider: r.provider };
}

/* ------------------------------ REPORT AUDITOR ------------------------------ */
const AUDIT_RULES = [
  { id: 'ptw', test: /ptw|permit/i, msg: 'No Permit-to-Work reference (hot work / height / confined space / electrical).', act: 'Attach PTW numbers & issuer/receiver names to the daily report', sev: 'high' },
  { id: 'tbt', test: /toolbox|tbt|tool box/i, msg: 'Toolbox talk not recorded (topic, attendance, time).', act: 'Record daily TBT with topic and signed attendance', sev: 'medium' },
  { id: 'ppe', test: /ppe|helmet|harness|vest|gloves/i, msg: 'PPE compliance not stated or verified.', act: 'Add PPE audit result (count checked / non-compliant)', sev: 'medium' },
  { id: 'loto', test: /loto|lockout|isolation|lock out/i, msg: 'No isolation/LOTO mention for maintenance or energy-related work.', act: 'Document isolation points, lock numbers and verification', sev: 'medium' },
  { id: 'insp', test: /inspect|checklist|scaffold tag|tagged/i, msg: 'No equipment/scaffold/lifting inspection evidence.', act: 'Attach inspection checklists (scaffold tag, lifting gear, tools)', sev: 'medium' },
  { id: 'inc', test: /near miss|incident|injur|first aid|accident/i, msg: 'No incident / near-miss / first-aid statement (even "nil" must be verified).', act: 'State incident & near-miss count with verification method', sev: 'medium' },
  { id: 'hrs', test: /man ?hours|manpower|headcount|workers/i, msg: 'Manpower / man-hours missing — LTIFR/TRIR cannot be calculated.', act: 'Report headcount and man-hours daily', sev: 'low' },
  { id: 'emg', test: /emergency|drill|assembly|first aid box|fire extinguisher/i, msg: 'Emergency readiness (drill, first-aid, extinguishers) not evidenced.', act: 'Record emergency equipment checks and drill schedule', sev: 'low' },
];
const WEAK = /\b(all ok|everything ok|nil|no issues?|no problem|normal|as usual|satisfactory|same as yesterday|nothing to report|ok\b)/gi;
function auditOffline(text) {
  const findings = AUDIT_RULES.filter((r) => !r.test.test(text)).map((r) => ({ title: r.msg, severity: r.sev, corrective_action: r.act, type: 'missing' }));
  const weak = [...new Set((text.match(WEAK) || []).map((s) => s.toLowerCase()))];
  if (weak.length) findings.push({ title: `Weak / generic wording detected: "${weak.join('", "')}" — possible copy-paste or unverified entry.`, severity: 'medium', corrective_action: 'Require specific evidence (names, locations, numbers, photos) for every entry', type: 'weak' });
  const law = lsGet(LS.law, 'IN');
  return { summary: `Offline rule audit (${law}): ${findings.length} gap(s). Jurisdiction reference: ${LAWS[law] || LAWS.IN}`, score: Math.max(0, 100 - findings.length * 11), findings };
}
async function auditReport(text) {
  const law = LAWS[lsGet(LS.law, 'IN')] || LAWS.IN;
  try {
    const r = await llm([{ role: 'system', content: SYS_BASE() },
      { role: 'user', content: `Audit this subordinate daily HSE site report as a strict HSE Manager. Find missing controls, false/weak/copy-paste entries, contradictions, and legal non-compliance against: ${law}. Return ONLY JSON: {"summary":"","score":0-100,"findings":[{"title":"","severity":"low|medium|high","type":"missing|weak|false|legal","legal_ref":"","corrective_action":""}]}\n\nREPORT:\n${text}` }], { temperature: 0.2, timeout: 45000 });
    const j = safeJSON(r.text); if (j && j.findings) return { data: j, provider: r.provider };
  } catch { /* offline */ }
  return { data: auditOffline(text), provider: null };
}

/* ------------------------------ POSTER BUILDER ------------------------------ */
const THEMES = {
  danger: ['#b71c1c', '#ff5252', '#fff'], warning: ['#e65100', '#ffb300', '#1a1a1a'], mandatory: ['#0d47a1', '#42a5f5', '#fff'],
  safe: ['#1b5e20', '#66bb6a', '#fff'], fire: ['#bf360c', '#ff7043', '#fff'],
};
function wrapText(ctx, t, x, y, w, lh) {
  const words = String(t).split(/\s+/); let line = '', yy = y;
  for (const wd of words) { const tst = line + wd + ' '; if (ctx.measureText(tst).width > w && line) { ctx.fillText(line.trim(), x, yy); line = wd + ' '; yy += lh; } else line = tst; }
  ctx.fillText(line.trim(), x, yy); return yy + lh;
}
function buildPoster({ headline, subtitle, points = [], theme = 'warning', footer = 'Created by Nasur · Safety First' }) {
  const [c1, c2, fg] = THEMES[theme] || THEMES.warning;
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350; const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1080, 1350); grd.addColorStop(0, c1); grd.addColorStop(1, c2); g.fillStyle = grd; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, 1080, 170);
  g.fillStyle = '#ffd600'; for (let i = -1; i < 24; i++) { g.beginPath(); g.moveTo(i * 50, 170); g.lineTo(i * 50 + 25, 170); g.lineTo(i * 50 + 5, 195); g.lineTo(i * 50 - 20, 195); g.fill(); }
  g.fillStyle = fg; g.font = 'bold 54px system-ui, sans-serif'; g.fillText('⚠ SAFETY FIRST', 50, 105);
  g.font = '900 96px system-ui, sans-serif'; let y = wrapText(g, String(headline).toUpperCase(), 50, 330, 980, 108);
  g.font = '500 44px system-ui, sans-serif'; y = wrapText(g, subtitle || '', 50, y + 10, 980, 56) + 20;
  g.font = '600 46px system-ui, sans-serif';
  points.slice(0, 6).forEach((p) => { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(40, y - 44, 1000, 78); g.fillStyle = fg; y = wrapText(g, '✔  ' + p, 60, y, 960, 54) + 22; });
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, 1250, 1080, 100); g.fillStyle = fg; g.font = '600 38px system-ui, sans-serif'; g.fillText(footer, 50, 1312);
  return cv.toDataURL('image/png');
}
async function posterSpec(topic) {
  try {
    const r = await llm([{ role: 'system', content: SYS_BASE() },
      { role: 'user', content: `Create content for a safety poster on: "${topic}". ONLY JSON: {"headline":"max 5 words","subtitle":"max 12 words","points":["max 8 words each, 4-5 items"],"theme":"danger|warning|mandatory|safe|fire"}` }], { temperature: 0.7, timeout: 30000 });
    const j = safeJSON(r.text); if (j && j.headline) return { spec: j, provider: r.provider };
  } catch { /* offline */ }
  const hit = KB.find((e) => e.k.test(topic)); const lines = hit ? hit.en.split('\n').filter((l) => l.startsWith('•')).map((l) => l.replace(/^•\s*/, '').slice(0, 60)) : [];
  return { spec: { headline: topic.slice(0, 30), subtitle: 'Work safe. Go home safe.', points: lines.length ? lines.slice(0, 4) : ['Wear your PPE', 'Report every hazard', 'Stop work if unsafe', 'Look out for each other'], theme: /fire/i.test(topic) ? 'fire' : /ppe|mandatory/i.test(topic) ? 'mandatory' : 'warning' }, provider: null };
}

/* ------------------------------ HUGGING FACE DEPLOYER (approval first) ------------------------------ */
async function hfCommit(files, summary) {
  const token = lsGet(LS.hf), repo = lsGet(LS.hfRepo, HF_DEFAULT_REPO);
  if (!token) throw new Error('Add your Hugging Face WRITE token in ⚙ settings first.');
  const lines = [JSON.stringify({ key: 'header', value: { summary: summary || 'JARVIS commit' } })];
  files.forEach((f) => lines.push(JSON.stringify({ key: 'file', value: { path: f.path, content: b64(f.content), encoding: 'base64' } })));
  const r = await fetchT(`https://huggingface.co/api/spaces/${repo}/commit/main`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-ndjson' }, body: lines.join('\n') }, 60000);
  if (!r.ok) throw new Error(`HF ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return true;
}
function extractCode(text) {
  const out = []; let m; const re = new RegExp(fenceRe.source, 'g');
  while ((m = re.exec(text))) {
    const code = m[2]; const pm = code.match(/^\s*(?:\/\/|\/\*|#|<!--)\s*path:\s*([^\s*>]+)/i);
    out.push({ lang: m[1], code, path: pm ? pm[1] : null });
  }
  return out;
}

const ARCH = `NASUR is a vanilla-JS offline-first PWA on a Hugging Face Static Space (no bundler, no npm, ES modules with relative imports). Strict CSP: script-src 'self' and style-src 'self' — NO inline <style>, NO style="" attributes, NO eval; put styles in css/*.css files. Core: js/core/config.js (STORES, EVENTS, APP), js/core/eventbus.js (emit,on,off), js/core/router.js (hash routes like #/machine-safety; a module exports async render(ctx) returning a cleanup function; hrefFor(id), getModule(id)). Services: js/services/repo.js (IndexedDB wrapper), config.js (user config), settings.js, opsstore.js, observations.js, regions.js. Modules are registered in data/modules.json (id with underscores, route with hyphens). RULES: ONE self-contained file per feature; load app services with lazy dynamic await import() inside try/catch so nothing can ever block app boot; mobile-first UI; no API keys; Tamil + English friendly; production quality, no placeholders or TODOs.`;
const CORE_BLOCK = /^(js\/core\/|js\/jarvis\/drawer\.js$|index\.html$|sw\.js$|manifest\.webmanifest$)/i;
async function hfRaw(path) {
  const repo = lsGet(LS.hfRepo, HF_DEFAULT_REPO), token = lsGet(LS.hf);
  try {
    const r = await fetchT(`https://huggingface.co/spaces/${repo}/raw/main/${path}?t=${Date.now()}`, token ? { headers: { Authorization: 'Bearer ' + token } } : {}, 20000);
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
/* The page's CSP blocks eval, so JavaScript cannot be machine-checked inside the browser. JSON can. */
function syntaxCheck(code, path) {
  if (/\.json$/i.test(path)) { try { JSON.parse(code); return null; } catch (e) { return e.message; } }
  return null;
}
async function genFile(path, spec, plan, log) {
  let ref = null;
  if (/^js\/modules\//.test(path)) for (const rp of ['js/modules/ppe_guide.js', 'js/modules/home.js']) { ref = await hfRaw(rp); if (ref) { ref = ref.slice(0, 5000); break; } }
  let code = '', err = null;
  for (let i = 0; i < 3; i++) {
    const msgs = [
      { role: 'system', content: 'You are a principal JavaScript engineer. ' + ARCH + ' Output EXACTLY one fenced code block containing the complete file, and nothing else.' },
      { role: 'user', content: `File: ${path}\nOverall goal: ${plan.goal}\nThis file's spec: ${spec}\nAll files in this build: ${plan.files.map((f) => f.path).join(', ')}\n` +
        (ref ? `STYLE REFERENCE (an existing module, mimic its conventions):\n${ref}\n` : '') +
        (err ? `\nYour previous attempt had this error: ${err}\nReturn the complete corrected file.\nPREVIOUS ATTEMPT:\n${code.slice(0, 9000)}` : '') }];
    const r = await llm(msgs, { model: 'qwen-coder', temperature: 0.2, timeout: 120000, noCache: true });
    const c = extractCode(r.text)[0]; code = c ? c.code : String(r.text).trim();
    err = syntaxCheck(code, path);
    if (!err) return code;
    log(`🔧 Problem in ${path}: ${err} — repairing (${i + 1}/3)`);
  }
  throw new Error('could not produce valid output: ' + err);
}
async function planBuild(goal) {
  const r = await llm([
    { role: 'system', content: 'You are the NASUR chief architect. ' + ARCH + ' Return ONLY JSON.' },
    { role: 'user', content: `Request from Nasur: "${goal}"\nPlan the minimal set of files (prefer ONE self-contained file per feature). JSON shape: {"goal":"one line","module":{"id":"snake_case","title":"","icon":"emoji","description":"one line"} or null,"files":[{"path":"js/modules/<id>.js","spec":"very detailed spec: UI, data, behaviour, edge cases"}]}` }], { temperature: 0.2, timeout: 90000, noCache: true });
  const j = safeJSON(r.text);
  if (!j || !j.files || !j.files.length) throw new Error('planner returned no files');
  if (j.module && j.module.id) j.module.id = String(j.module.id).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return j;
}
async function registerModule(mod) {
  const raw = await hfRaw('data/modules.json'); if (!raw) return null;
  let j; try { j = JSON.parse(raw); } catch { return null; }
  const arr = Array.isArray(j) ? j : (Array.isArray(j.modules) ? j.modules : null);
  if (!arr || !arr.length || arr.some((m) => m && m.id === mod.id)) return null;
  const tpl = arr.find((m) => m && m.id === 'ppe_guide') || arr[arr.length - 1];
  const e = { ...tpl, id: mod.id, route: '/' + mod.id.replace(/_/g, '-'), title: mod.title || mod.id, icon: mod.icon || tpl.icon,
    description: mod.description || mod.title || mod.id, file: `js/modules/${mod.id}.js`, status: 'active', nav: false, builtin: false };
  arr.push(e);
  return { path: 'data/modules.json', content: JSON.stringify(j, null, 2) + '\n' };
}
async function buildAndPrepare(plan, log) {
  const allowCore = lsGet(LS.core) === '1'; const files = []; const skipped = [];
  for (const f of plan.files.slice(0, 10)) {
    const path = String(f.path || '').replace(/^\/+/, '');
    if (!path || path.includes('..') || /\s/.test(path)) { skipped.push(path || '(empty path)'); continue; }
    if (CORE_BLOCK.test(path) && !allowCore) { skipped.push(path + ' (core file — enable in ⚙)'); continue; }
    log('🔨 Writing ' + path + ' …');
    try { const code = await genFile(path, f.spec || plan.goal, plan, log); files.push({ path, content: code }); log(`✔ ${path} — ${code.length} chars`); }
    catch (e) { log('❌ ' + path + ': ' + e.message); }
  }
  if (skipped.length) log('⏭ Skipped: ' + skipped.join(', '));
  if (!files.length) return log('Nothing was generated.');
  let reg = null;
  if (plan.module && plan.module.id && files.some((f) => /^js\/modules\//.test(f.path))) { try { reg = await registerModule(plan.module); } catch { reg = null; } if (reg) files.push(reg); }
  S.pendingBuild = { files, goal: plan.goal, route: plan.module && plan.module.id ? hrefOf(plan.module.id) : null };
  addMsg('ai', `🧪 **Build ready for your approval — nothing is deployed yet.**\n${files.map((f) => '• ' + f.path).join('\n')}\n` +
    (reg ? '📌 data/modules.json entry prepared.\n' : '⚠ No modules.json entry prepared — add one if the module must appear in the menu.\n') +
    '⚠ JavaScript could not be machine-checked in the browser (security policy blocks it). Copy the files and review before approving.',
  { type: 'approve_build', files: files.map((f) => ({ path: f.path, content: f.content })) }, 'autobuild', 'review');
}
async function handleAutoBuildRequest(text) {
  const log = (t) => addMsg('ai', t, null, 'autobuild');
  log('🧭 Planning the build …');
  let plan;
  try { plan = await planBuild(text); } catch (e) { return log(e.message === 'ai_disabled' ? '🔒 Online AI is off. Allow it (⚙ → or send a normal question first) and try again.' : '❌ Planner failed: ' + e.message + '. The AI may be busy — try again in a moment.'); }
  log('📐 Plan: ' + plan.files.map((f) => f.path).join(', '));
  try { await buildAndPrepare(plan, log); } catch (e) { log('❌ ' + e.message); }
}

/* ------------------------------ VOICE (js/jarvis/voice.js) ------------------------------ */
const speakable = (t) => String(t).replace(/```[\s\S]*?```/g, ' code block ').replace(/https?:\/\/\S+/g, ' ')
  .replace(/[*_`#]/g, '').replace(/[\u2022\u2714\u2705\u26A0\uFE0F\u279C]|\p{Extended_Pictographic}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
function voicePref() { const v = lsGet(LS.voice, 'auto'); return v === 'ta' || v === 'en' ? v : 'auto'; }
function listenLang() {
  const p = voicePref(); if (p !== 'auto') return p;
  const c = _M && _M.svcConfig && _M.svcConfig.getCachedUserConfig ? safe(() => _M.svcConfig.getCachedUserConfig()) : null;
  return c && c.language === 'ta' ? 'ta' : 'en';
}
function speechLang(text) { const p = voicePref(); if (p !== 'auto') return p; return isTamilScript(text) ? 'ta' : 'en'; }

function setStatus(text) {
  const u = S.ui; if (!u) return;
  u.status.textContent = text || ''; u.status.classList.toggle('is-on', !!text);
}
function setBadgeText(text, state) { const u = S.ui; if (!u) return; u.badge.textContent = text; u.badge.setAttribute('data-state', state || 'online'); }
async function refreshBadge() {
  if (!S.ui) return;
  if (navigator.onLine === false) return setBadgeText('⌂ Offline engine', 'offline');
  const list = await collectProviders();
  setBadgeText(list.length ? '☁ ' + list[0].label + (list.length > 1 ? ' +' + (list.length - 1) : '') : '☁ Free AI (keyless)', 'online');
}
function syncUi() {
  const u = S.ui; if (!u) return;
  u.mic.classList.toggle('is-on', !!S.session);
  u.mic.textContent = S.session ? '⏹' : '🎤';
  u.hf.classList.toggle('is-on', S.handsfree);
  u.spk.classList.toggle('is-on', S.speaking);
  u.spk.textContent = S.autoSpeak ? '🔊' : '🔇';
  u.spk.setAttribute('aria-pressed', S.autoSpeak ? 'true' : 'false');
}
function setMicState(st) {
  if (st === 'starting') setStatus('🎤 Starting microphone…');
  else if (st === 'listening') setStatus('🎤 Listening… speak now (tap ⏹ to stop)');
  else if (st === 'processing') setStatus('⏳ Processing your voice…');
  syncUi();
}
async function startMic() {
  const M = await mods(); const V = M.voice || {};
  if (!V.startListening || !V.isRecognitionSupported || !V.isRecognitionSupported()) {
    S.handsfree = false; syncUi();
    return setStatus('Voice typing is not supported in this browser. Type instead — Chrome on Android works best.');
  }
  if (S.session) { S.session.stop(); return; }
  if (V.stopSpeaking) V.stopSpeaking();
  try { const sup = V.getVoiceSupport && V.getVoiceSupport(); if (sup && sup.inFrame) toast('Microphone is often blocked inside the huggingface.co page. Open the direct *.hf.space address.', 'warning'); } catch { /* ignore */ }
  const session = V.startListening({ language: listenLang(), maxSeconds: 25, onText: (t) => { if (S.ui) { S.ui.input.value = t; autoGrow(); } }, onState: setMicState });
  S.session = session; syncUi();
  const out = await session.done;
  if (S.session === session) S.session = null;
  syncUi(); if (out.reason === 'aborted') return setStatus('');
  const retry = () => { if (S.handsfree && !S.busy && !S.speaking && S.hfMiss < 2) { S.hfMiss += 1; setTimeout(() => { if (S.handsfree && !S.busy && !S.speaking) startMic(); }, 500); return true; } return false; };
  if (out.error) {
    setStatus(out.error.message);
    if (out.error.code === 'no_speech' && retry()) return;
    S.handsfree = false; return syncUi();
  }
  const t = String(out.transcript || '').trim();
  if (!t) { setStatus(''); if (!retry()) { S.handsfree = false; syncUi(); } return; }
  S.hfMiss = 0; setStatus(''); S.ui.input.value = ''; autoGrow(); send(t);
}
async function speakReply(text) {
  const M = await mods(); const V = M.voice || {};
  const clean = speakable(text); if (!clean || !V.speak) return null;
  const lang = speechLang(clean);
  S.speaking = true; syncUi(); setStatus('🔊 Speaking… (tap 🔊 to stop)');
  let r = null;
  try { r = await V.speak(clean, { language: lang }); } catch { r = { spoken: false, reason: 'error' }; }
  S.speaking = false; syncUi();
  if (r.reason === 'no_voice') setStatus(`This phone has no ${lang === 'ta' ? 'Tamil' : 'English'} voice installed. Install it in phone Settings → Text-to-speech.`);
  else if (r.reason === 'unsupported') setStatus('Spoken replies are not supported in this browser.');
  else if (r.reason === 'error') setStatus('Could not speak the reply on this device.');
  else setStatus('');
  return r;
}
async function afterReply(m, spokenText) {
  if (!m) return;
  if (S.autoSpeak || S.handsfree) {
    await speakReply(spokenText || m.text);
    if (S.handsfree && !S.busy && !S.queue.length) setTimeout(() => { if (S.handsfree && !S.busy && !S.session) startMic(); }, 400);
  }
}
function toggleHandsfree() {
  S.handsfree = !S.handsfree; S.hfMiss = 0;
  if (S.handsfree) { S.autoSpeak = true; lsSet(LS.speak, '1'); toast('Hands-free ON — works with a Bluetooth headset', 'info'); startMic(); }
  else { if (S.session) S.session.abort(); stopVoiceNow(); toast('Hands-free OFF', 'info'); }
  syncUi();
}
function stopVoiceNow() { const V = _M && _M.voice; try { if (V && V.stopAll) V.stopAll(); } catch { /* ignore */ } S.session = null; S.speaking = false; syncUi(); setStatus(''); }
function toggleSpeaker() {
  if (S.speaking) { stopVoiceNow(); return; }
  S.autoSpeak = !S.autoSpeak; lsSet(LS.speak, S.autoSpeak ? '1' : '0'); syncUi();
  toast(S.autoSpeak ? 'JARVIS will speak replies' : 'Spoken replies off', 'info');
}

/* ------------------------------ SHARING ------------------------------ */
const plain = (t) => String(t).replace(/\*\*/g, '*').replace(/```[\w]*\n?/g, '').trim();
const shareWA = (t) => window.open('https://wa.me/?text=' + encodeURIComponent(plain(t) + '\n\n— JARVIS · NASUR HSE OS'), '_blank', 'noopener');
const shareMail = (t) => { location.href = 'mailto:?subject=' + encodeURIComponent('HSE — JARVIS report') + '&body=' + encodeURIComponent(plain(t)); };

/* ------------------------------ CHAT CORE ------------------------------ */
function addMsg(role, text, extra, expert, via) {
  const m = { id: uid(), role, text, extra, expert, via, ts: Date.now() };
  S.history.push(m); saveHist();
  if (S.ui) { S.ui.log.appendChild(renderMsg(m)); S.ui.log.scrollTop = S.ui.log.scrollHeight; }
  return m;
}
function setBusy(b) {
  S.busy = b; const u = S.ui; if (!u) return;
  let d = u.log.querySelector('.jv-dots');
  if (b && !d) { d = document.createElement('div'); d.className = 'jv-msg jv-ai jv-dots'; d.innerHTML = '<span></span><span></span><span></span>'; u.log.appendChild(d); u.log.scrollTop = u.log.scrollHeight; }
  if (!b && d) d.remove();
  u.send.disabled = b;
}
const viaOf = (provider) => (provider ? '☁ ' + provider : '⌂ offline engine');

function consentCard(retryText) {
  if (Date.now() - S.consentAt < CONSENT_GAP_MS) return;
  S.consentAt = Date.now();
  addMsg('ai', '🔒 Online AI is switched off in your privacy settings, so the offline engine answered. To get full AI answers, allow online AI: your question text is then sent to the AI service you configured (or a free keyless service). Photos are resized first. You can turn it off again in Settings.',
    { type: 'consent', retry: retryText }, 'general', viaOf(null));
}

async function send(textIn, opts = {}) {
  if (!S.inited) initJarvisDrawer();
  const text = String(textIn ?? '').trim();
  const photo = opts.repeat ? (opts.photo || null) : S.pendingPhoto;
  if (!text && !photo) return;
  if (S.busy) { S.queue.push({ text, photo, repeat: !!opts.repeat }); toast('JARVIS is busy — your message is queued.', 'info'); return; }
  if (!opts.repeat) {
    S.pendingPhoto = null; clearPhoto();
    addMsg('user', text || '(photo)');
  }
  if (S.session) { try { S.session.abort(); } catch { /* ignore */ } S.session = null; syncUi(); }
  if (/^(ta|tamil|தமிழ்)$/i.test(text)) { lsSet(LS.lang, 'ta'); addMsg('ai', 'சரி macha, இனி தமிழில் பதில் சொல்றேன் 👍', null, 'general', viaOf(null)); return; }
  if (/^(en|english)$/i.test(text)) { lsSet(LS.lang, 'en'); addMsg('ai', 'Okay, I will reply in English from now on 👍', null, 'general', viaOf(null)); return; }
  const expert = route(text, !!photo); setBusy(true);
  let m = null; let spoken = null;
  try {
    if (expert === 'photo') m = await handlePhoto(photo, text);
    else if (expert === 'exec') m = addMsg('ai', await execCommand(text), null, expert, viaOf(null));
    else if (expert === 'nav') {
      const r = goTo(text); m = addMsg('ai', r ? `🧭 Opening **${esc(r)}** …` : 'Module not found.', null, expert, viaOf(null));
      if (r) { spoken = 'Opening that for you.'; setTimeout(closeJarvisDrawer, 250); }
    } else if (expert === 'poster') m = await handlePoster(text);
    else if (expert === 'audit') { const a = await handleAudit(text); m = a.m; spoken = a.spoken; }
    else if (expert === 'autobuild') await handleAutoBuildRequest(text);
    else m = await handleChat(text, expert);
  } catch (e) {
    console.warn('[JARVIS] request failed:', e);
    m = addMsg('ai', offlineAnswer(text), null, expert, viaOf(null));
  } finally { setBusy(false); }
  if (m && expert !== 'autobuild') afterReply(m, spoken);
  const next = S.queue.shift();
  if (next) setTimeout(() => send(next.text, { repeat: next.repeat, photo: next.photo }), 50);
}

async function handleChat(text, expert) {
  const sys = { coder: SYS_BASE() + '\nYou are the Autonomous Coder. Output complete files in fenced code blocks; put `// path: js/...` as the first line of each file. The app has a strict CSP: no inline styles, no eval.', research: SYS_BASE() + '\nYou are the Deep HSE Research expert: structured, cite clause/standard names, include practical checklists.' }[expert] || SYS_BASE();
  const ctx = S.history.filter((m) => m.role === 'user' || m.role === 'ai').filter((m) => !(m.extra && m.extra.type === 'consent')).slice(-9, -1)
    .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.text).slice(0, 1500) }));
  let out, provider = null, why = '';
  try { const r = await llm([{ role: 'system', content: sys }, ...ctx, { role: 'user', content: text }], { model: expert === 'coder' ? 'qwen-coder' : 'openai' }); out = r.text; provider = r.provider; }
  catch (e) { why = e.message; out = offlineAnswer(text); }
  const m = addMsg('ai', out, null, expert, viaOf(provider));
  if (!provider) {
    if (why === 'ai_disabled') consentCard(text);
    else if (why === 'offline') setStatus('You are offline — answered by the offline engine.');
    else setStatus('No online AI answered' + (S.lastErrors.length ? ' (' + S.lastErrors.join('; ') + ')' : '') + ' — used the offline engine.');
  }
  return m;
}
async function handlePhoto(photo, note) {
  let res = null, provider = null, why = '';
  try { const r = await scanPhoto(photo, note); res = r.data; provider = r.provider; } catch (e) { why = e.message; }
  if (!res || !res.hazards) {
    const m = addMsg('ai', '📷 Photo saved, but AI vision is not available right now. Use the manual checklist: PPE (helmet/vest/shoes/harness)? Edge/height protection? Scaffold tag? Housekeeping? Electrical leads? Barricade/PTW? Tap **Save as Observation** to log it.',
      { type: 'photo', photo, data: { summary: note || 'Site photo observation', overall_risk: 'medium', hazards: [] } }, 'photo', viaOf(null));
    if (why === 'ai_disabled') consentCard(note || '(photo)');
    return m;
  }
  const md = `**📷 Hazard Scan — overall risk: ${esc(res.overall_risk || 'n/a').toUpperCase()}**\n${esc(res.summary || '')}\n\n` +
    res.hazards.map((h, i) => `**${i + 1}. ${esc(h.title)}** [${sevOf(h.severity)}]\n${esc(h.detail || '')}\n➜ ${esc(h.corrective_action || '')}`).join('\n\n') +
    (res.positives && res.positives.length ? '\n\n✅ Good: ' + res.positives.map(esc).join('; ') : '');
  return addMsg('ai', md, { type: 'photo', photo, data: res }, 'photo', viaOf(provider));
}
async function handleAudit(text) {
  const { data: res, provider } = await auditReport(text);
  const md = `**🕵️ Manager Audit — Score ${res.score ?? '?'}/100**\n${esc(res.summary || '')}\n\n` +
    (res.findings || []).map((f, i) => `**${i + 1}. [${sevOf(f.severity)}]** ${esc(f.title)}${f.legal_ref ? `\n⚖ ${esc(f.legal_ref)} (verify)` : ''}\n➜ ${esc(f.corrective_action || '')}`).join('\n\n');
  const m = addMsg('ai', md, { type: 'audit', data: res }, 'audit', viaOf(provider));
  return { m, spoken: `Audit score ${res.score}. ${(res.findings || []).length} findings.` };
}
async function handlePoster(text) {
  const topic = text.replace(/\b(make|create|design|build|generate|a|an|safety|poster|banner|on|about|for)\b/gi, ' ').replace(/\s+/g, ' ').trim() || 'Work Safely';
  const { spec, provider } = await posterSpec(topic); const url = buildPoster(spec);
  return addMsg('ai', `🎨 **Poster ready: ${esc(spec.headline)}** — tap download.`, { type: 'poster', url, name: spec.headline }, 'poster', viaOf(provider));
}

/* ------------------------------ UI ------------------------------ */
const CHIPS = [
  ['🎨 Poster', 'Make a safety poster on work at height'], ['🕵️ Audit', 'Audit this daily report:\n'], ['🔥 Fire', 'Explain fire extinguisher classes'],
  ['📝 PTW', 'Explain permit to work steps'], ['🎤 Interview', 'HSE interview questions for a factory safety officer'], ['💻 Code', 'Write code for a new module: '],
  ['⚖ Laws', 'Factories Act key duties for occupier'], ['🧭 Audits', 'open audits'], ['🤖 Build', 'Build module: '],
];

function md(t) {
  let h = esc(t);
  h = h.replace(/```([\w.+-]*)\n([\s\S]*?)```/g, (_, l, c) => '<pre>' + c + '</pre>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_\((.+?)\)_/g, '<i>($1)</i>');
  return h.replace(/<pre>[\s\S]*?<\/pre>|\n/g, (m) => (m === '\n' ? '<br>' : m));
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(label, fn, cls) { const b = el('button', cls || 'jv-btn', label); b.type = 'button'; b.addEventListener('click', fn); return b; }
function autoGrow() { const t = S.ui && S.ui.input; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 112) + 'px'; }
function clearPhoto() { const u = S.ui; if (!u) return; u.prev.classList.remove('is-on'); u.prev.textContent = ''; }
function showPhoto(url) { const u = S.ui; if (!u) return; u.prev.textContent = ''; const i = document.createElement('img'); i.src = url; i.alt = ''; u.prev.appendChild(i); u.prev.appendChild(document.createTextNode('Photo attached — add a note & send')); u.prev.classList.add('is-on'); }

function renderMsg(m) {
  const d = el('div', 'jv-msg ' + (m.role === 'user' ? 'jv-user' : 'jv-ai'));
  if (m.role === 'ai') { const tag = el('div', 'jv-tag', [EXPERT_LABEL[m.expert] || '', m.via || ''].filter(Boolean).join(' · ')); if (tag.textContent) d.appendChild(tag); }
  const body = el('div'); body.innerHTML = m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>') : md(m.text); d.appendChild(body);
  const x = m.extra;
  if (x && x.photo) { const i = document.createElement('img'); i.src = x.photo; i.alt = 'Site photo'; d.appendChild(i); }
  if (m.role !== 'ai') return d;
  const act = el('div', 'jv-actions');
  if (x && x.type === 'consent') {
    act.appendChild(btn('✅ Allow online AI', async () => {
      try {
        const M = await mods();
        if (!M.svcConfig || !M.svcConfig.updateUserConfig) throw new Error('Settings service unavailable');
        await M.svcConfig.updateUserConfig({ privacy: { ai_enabled: true } });
        toast('Online AI allowed', 'success'); refreshBadge();
        send(x.retry || '', { repeat: true });
      } catch (e) { toast('Could not change the setting: ' + e.message, 'danger'); }
    }, 'jv-btn jv-btn--primary'));
  }
  if (x && x.type === 'photo') {
    act.appendChild(btn('💾 Save as Observation', async () => {
      try {
        const hs = x.data.hazards && x.data.hazards.length ? x.data.hazards : [{ title: x.data.summary || 'Site photo observation', severity: x.data.overall_risk, detail: x.data.summary }];
        for (const h of hs) {
          await doCreateObservation({ title: h.title, description: `${h.detail || ''}\nAction: ${h.corrective_action || ''}`, severity: h.severity, category: h.category, photo: x.photo });
          if (h.corrective_action) await doCreateAction({ title: h.corrective_action.slice(0, 90), description: h.title, priority: h.severity });
        }
        toast(`Saved ${hs.length} observation(s) + actions ✔`, 'success');
      } catch (e) { toast('Save failed: ' + e.message, 'danger'); }
    }));
  }
  if (x && x.type === 'audit') {
    act.appendChild(btn('✅ Create corrective actions', async () => {
      try {
        for (const f of x.data.findings || []) await doCreateAction({ title: (f.corrective_action || f.title).slice(0, 90), description: f.title + (f.legal_ref ? ' | ' + f.legal_ref : ''), priority: f.severity });
        toast(`${(x.data.findings || []).length} actions created ✔`, 'success');
      } catch (e) { toast('Failed: ' + e.message, 'danger'); }
    }));
    act.appendChild(btn('📋 Open Audits', () => { goTo('audits'); closeJarvisDrawer(); }));
  }
  if (x && x.type === 'approve_build') {
    (x.files || []).forEach((f) => act.appendChild(btn('📋 Copy ' + f.path.split('/').pop(), () => navigator.clipboard.writeText(f.content).then(() => toast('Copied ' + f.path, 'success')))));
    act.appendChild(btn('🚀 Approve & commit to HF', async () => {
      const pb = S.pendingBuild;
      if (!pb) return toast('Nothing pending — ask for the build again.', 'warning');
      if (!window.confirm('Commit ' + pb.files.length + ' file(s) to ' + lsGet(LS.hfRepo, HF_DEFAULT_REPO) + '? This changes the live app.')) return;
      try {
        await hfCommit(pb.files, 'JARVIS approved build: ' + String(pb.goal).slice(0, 60)); S.pendingBuild = null;
        addMsg('ai', `🚀 **Committed ${pb.files.length} file(s).** The Space rebuilds in ~30–60 s, then reload the app.\n` + pb.files.map((f) => '• ' + f.path).join('\n'), { type: 'built', route: pb.route }, 'autobuild', 'deployed');
      } catch (e) { toast(e.message, 'danger'); }
    }, 'jv-btn jv-btn--primary'));
  }
  if (x && x.type === 'built') {
    if (x.route) act.appendChild(btn('📂 Open module', () => { location.hash = x.route.charAt(0) === '#' ? x.route : '#' + x.route; closeJarvisDrawer(); }));
    act.appendChild(btn('↻ Reload app', () => location.reload()));
  }
  if (x && x.type === 'poster') {
    const i = document.createElement('img'); i.src = x.url; i.alt = 'Safety poster'; d.appendChild(i);
    act.appendChild(btn('⬇ Download PNG', () => { const a = document.createElement('a'); a.href = x.url; a.download = (x.name || 'safety-poster').replace(/\W+/g, '_') + '.png'; a.click(); }));
    act.appendChild(btn('📤 Share image', async () => {
      try { const b = await (await fetch(x.url)).blob(); const f = new File([b], 'poster.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: x.name }); else toast('Use Download, then share', 'info'); } catch { /* cancelled */ } }));
  }
  extractCode(m.text).forEach((c) => {
    act.appendChild(btn('📋 Copy code', () => navigator.clipboard.writeText(c.code).then(() => toast('Copied', 'success'))));
  });
  act.appendChild(btn('💬 WhatsApp', () => shareWA(m.text))); act.appendChild(btn('✉ Email', () => shareMail(m.text)));
  act.appendChild(btn('🔊 Speak', () => { S.speaking = false; speakReply(m.text); }));
  d.appendChild(act);
  return d;
}

/* ---------- settings panel ---------- */
function field(panel, label, node) { panel.appendChild(el('label', null, label)); panel.appendChild(node); return node; }
function selectOf(options, value) { const s = el('select', 'jv-input'); options.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; s.appendChild(o); }); s.value = value; return s; }
function inputOf(type, value, ph) { const i = document.createElement('input'); i.type = type; i.value = value || ''; if (ph) i.placeholder = ph; i.autocomplete = 'off'; i.setAttribute('autocapitalize', 'off'); i.spellcheck = false; return i; }

async function saveKeys(vals) {
  const M = await mods(); const patch = {};
  Object.keys(vals).forEach((id) => { if (vals[id]) patch[id] = vals[id]; });
  if (!Object.keys(patch).length) return 0;
  if (M.svcConfig && M.svcConfig.updateUserConfig) await M.svcConfig.updateUserConfig({ apiKeys: patch });
  else { Object.keys(patch).forEach((id) => lsSet('nasur_key_' + id, patch[id])); toast('Settings service unavailable — keys saved on this device only.', 'warning'); }
  S.bad.clear(); S.cool = {};
  return Object.keys(patch).length;
}
async function testAi() {
  setStatus('⏳ Testing online AI…');
  try { const r = await llm([{ role: 'user', content: 'Reply with the single word: ready' }], { noCache: true, timeout: 25000 }); setStatus('✅ ' + r.provider + ' replied: ' + String(r.text).slice(0, 40)); }
  catch (e) {
    if (e.message === 'ai_disabled') { setStatus('🔒 Online AI is switched off. Send any question and tap “Allow online AI”.'); return; }
    setStatus('❌ No online AI reachable' + (S.lastErrors.length ? ': ' + S.lastErrors.join('; ') : e.message === 'offline' ? ' (you are offline)' : '') + '. The offline engine still works.');
  }
}
async function renderSettings(panel) {
  panel.textContent = '';
  const list = await collectProviders();
  const have = {}; list.forEach((p) => { have[p.id] = p; });

  const lang = field(panel, 'Reply language', selectOf([['auto', 'Auto (same as me)'], ['ta', 'தமிழ் (Tamil)'], ['en', 'English']], lsGet(LS.lang, 'auto')));
  const voice = field(panel, 'Voice — listening and speaking', selectOf([['auto', 'Auto'], ['ta', 'Tamil (ta-IN)'], ['en', 'English']], voicePref()));
  const law = field(panel, 'Legal focus for audits', selectOf([['IN', 'India'], ['GULF', 'UAE / Saudi / Qatar'], ['CA', 'Canada'], ['US', 'USA']], lsGet(LS.law, 'IN')));
  const spk = document.createElement('input'); spk.type = 'checkbox'; spk.checked = S.autoSpeak;
  const spkLabel = el('label', null, ' Speak replies automatically'); spkLabel.insertBefore(spk, spkLabel.firstChild); panel.appendChild(spkLabel);

  const keyInputs = {};
  [['openrouter', 'OpenRouter key (uses openrouter/free)'], ['gemini', 'Gemini key'], ['groq', 'Groq key']].forEach(([id, label]) => {
    const p = have[id];
    keyInputs[id] = field(panel, label + (p ? ' — saved ✓ (' + p.source + ')' : ''), inputOf('password', '', p ? 'Saved — type only to replace' : 'Paste key'));
  });
  panel.appendChild(el('p', 'jv-note', 'Keys you add in Settings → AI providers are used too. Keys saved here live in NASUR\'s database on this device, never in the app code. Without keys JARVIS uses a free keyless service (best effort) and the offline engine.'));

  const row = el('div', 'jv-actions');
  row.appendChild(btn('💾 Save', async () => {
    try {
      lsSet(LS.lang, lang.value); lsSet(LS.voice, voice.value); lsSet(LS.law, law.value); S.autoSpeak = spk.checked; lsSet(LS.speak, S.autoSpeak ? '1' : '0');
      const n = await saveKeys({ openrouter: keyInputs.openrouter.value.trim(), gemini: keyInputs.gemini.value.trim(), groq: keyInputs.groq.value.trim() });
      toast(n ? 'Saved ✔ — ' + n + ' key(s) stored' : 'Saved ✔', 'success'); syncUi(); refreshBadge(); renderSettings(panel);
    } catch (e) { toast('Could not save: ' + e.message, 'danger'); }
  }, 'jv-btn jv-btn--primary'));
  row.appendChild(btn('🧪 Test AI', testAi));
  row.appendChild(btn('🗑 Clear chat', () => { S.history = []; saveHist(); if (S.ui) S.ui.log.textContent = ''; toast('Chat cleared', 'info'); }, 'jv-btn jv-btn--danger'));
  panel.appendChild(row);

  const sources = list.length ? list.map((p) => p.label + ' (' + p.source + ')').join(', ') : 'none — keyless free AI + offline engine';
  panel.appendChild(el('p', 'jv-note', 'Providers with keys, in order: ' + sources));

  const det = document.createElement('details'); det.appendChild(el('summary', null, 'Advanced: deploy to Hugging Face'));
  const tok = field(det, 'Hugging Face WRITE token (stored on this device only)', inputOf('password', lsGet(LS.hf), 'hf_…'));
  const repo = field(det, 'Space repo', inputOf('text', lsGet(LS.hfRepo, HF_DEFAULT_REPO)));
  const core = document.createElement('input'); core.type = 'checkbox'; core.checked = lsGet(LS.core) === '1';
  const coreLabel = el('label', null, ' Allow JARVIS to propose edits to core files (risky)'); coreLabel.insertBefore(core, coreLabel.firstChild); det.appendChild(coreLabel);
  det.appendChild(btn('Save deploy settings', () => { lsSet(LS.hf, tok.value.trim()); lsSet(LS.hfRepo, repo.value.trim() || HF_DEFAULT_REPO); lsSet(LS.core, core.checked ? '1' : '0'); toast('Deploy settings saved', 'success'); }));
  panel.appendChild(det);
}

/* ---------- layout measuring (drawer stops above the nav bar and the keyboard) ---------- */
function measure() {
  try {
    const nav = document.getElementById('main-nav'); let bottom = 0;
    if (nav) { const r = nav.getBoundingClientRect(); const vh = window.innerHeight; if (r.height > 0 && r.top > vh / 2) bottom = Math.max(0, Math.round(vh - r.top)); }
    const vv = window.visualViewport;
    if (vv) { const kb = Math.round(window.innerHeight - vv.height - vv.offsetTop); if (kb > 80) bottom = kb; }
    document.documentElement.style.setProperty('--drawer-bottom', bottom + 'px');
  } catch { /* ignore */ }
}
function ensureCss() {
  const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => (l.getAttribute('href') || '').indexOf('css/jarvis.css') >= 0);
  if (has) return;
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = new URL('../../css/jarvis.css', import.meta.url).href; document.head.appendChild(l);
}

function buildUi() {
  ensureCss();
  const root = document.getElementById('jarvis-root') || document.body;
  root.querySelectorAll('.jv-fab,.jv-drawer').forEach((n) => n.remove());

  const fab = btn('✦ JARVIS', toggleJarvisDrawer, 'jv-fab'); fab.setAttribute('aria-label', 'Open JARVIS');
  const drawer = el('div', 'jv-drawer'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'JARVIS assistant');

  const head = el('div', 'jv-head');
  const title = el('h2', 'jv-title', '✦ JARVIS');
  const badge = btn('☁ …', () => togglePanel(), 'jv-badge'); badge.setAttribute('data-state', 'online'); badge.setAttribute('aria-label', 'AI provider status and settings');
  const spk = btn('🔊', toggleSpeaker, 'jv-iconbtn'); spk.setAttribute('aria-label', 'Spoken replies on or off');
  const hf = btn('🎧', toggleHandsfree, 'jv-iconbtn'); hf.setAttribute('aria-label', 'Hands-free voice conversation');
  const gear = btn('⚙', () => togglePanel(), 'jv-iconbtn'); gear.setAttribute('aria-label', 'JARVIS settings');
  const close = btn('✕', closeJarvisDrawer, 'jv-iconbtn'); close.setAttribute('aria-label', 'Close JARVIS');
  [title, badge, spk, hf, gear, close].forEach((n) => head.appendChild(n));

  const panel = el('div', 'jv-panel');
  const chips = el('div', 'jv-chips');
  CHIPS.forEach(([l, p]) => chips.appendChild(btn(l, () => { if (p.endsWith('\n') || p.endsWith(': ')) { S.ui.input.value = p; autoGrow(); S.ui.input.focus(); } else send(p); }, 'jv-chip')));
  const log = el('div', 'jv-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
  const status = el('div', 'jv-prev'); status.setAttribute('role', 'status');
  const prev = el('div', 'jv-prev');

  const composer = el('div', 'jv-composer');
  const cam = btn('📷', () => file.click(), 'jv-iconbtn'); cam.setAttribute('aria-label', 'Take or choose a site photo');
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.setAttribute('capture', 'environment'); file.hidden = true;
  const input = el('textarea', 'jv-input'); input.rows = 1; input.placeholder = 'Ask JARVIS… (தமிழ் / Tanglish / English)'; input.setAttribute('aria-label', 'Message to JARVIS');
  const mic = btn('🎤', () => startMic(), 'jv-iconbtn'); mic.setAttribute('aria-label', 'Speak to JARVIS');
  const sendBtn = btn('➤', () => { const t = input.value; input.value = ''; autoGrow(); send(t); }, 'jv-btn jv-btn--primary'); sendBtn.setAttribute('aria-label', 'Send');
  [cam, file, input, mic, sendBtn].forEach((n) => composer.appendChild(n));

  [head, panel, chips, log, status, prev, composer].forEach((n) => drawer.appendChild(n));
  S.ui = { fab, drawer, head, badge, spk, hf, gear, panel, chips, log, status, prev, input, mic, send: sendBtn, file };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = input.value; input.value = ''; autoGrow(); send(t); } });
  input.addEventListener('input', autoGrow);
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; if (!f) return;
    try { S.pendingPhoto = await fileToDataUrl(f); showPhoto(S.pendingPhoto); } catch { toast('Could not read the photo', 'warning'); }
    file.value = '';
  });

  if (!S.history.length) addMsg('ai', 'Vanakkam Nasur! 👋 I\'m JARVIS. Type or tap 🎤 and talk to me in Tamil, Tanglish or English. I can answer HSE questions, scan 📷 site photos, audit reports, make posters and create observations. The badge at the top shows whether an online AI or the offline engine is answering.', null, 'general', viaOf(null));
  else S.history.forEach((m) => log.appendChild(renderMsg(m)));
  log.scrollTop = log.scrollHeight;

  root.appendChild(fab); root.appendChild(drawer);
  syncUi(); measure();
  setBadgeText(navigator.onLine === false ? '⌂ Offline engine' : '☁ …', navigator.onLine === false ? 'offline' : 'online');
}
function togglePanel() {
  const u = S.ui; if (!u) return;
  const open = !u.panel.classList.contains('is-open');
  u.panel.classList.toggle('is-open', open);
  if (open) renderSettings(u.panel);
}

/* ------------------------------ DRAWER API & EXPORTS ------------------------------ */
export function initJarvisDrawer() {
  if (S.inited) return;
  S.inited = true;
  try {
    buildUi();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) closeJarvisDrawer(); });
    window.addEventListener('nasur:jarvis', (e) => { openJarvisDrawer(); if (e.detail && e.detail.prompt) send(e.detail.prompt); });
    window.addEventListener('resize', measure);
    window.addEventListener('online', () => refreshBadge());
    window.addEventListener('offline', () => refreshBadge());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', measure);
    window.JARVIS = jarvisApi;
    mods().then(() => { refreshBadge(); measure(); }).catch(() => {});
  } catch (e) { S.inited = false; console.error('[JARVIS] could not build the drawer:', e); throw e; }
}
export function openJarvisDrawer() {
  if (!S.inited) initJarvisDrawer();
  const u = S.ui; if (!u) return;
  measure(); u.drawer.classList.add('is-open'); u.fab.hidden = true; S.open = true;
  mods().then(() => refreshBadge()).catch(() => {});
}
export function closeJarvisDrawer() {
  const u = S.ui; if (!u) return;
  u.drawer.classList.remove('is-open'); u.fab.hidden = false; S.open = false;
  S.handsfree = false; if (S.session) { try { S.session.abort(); } catch { /* ignore */ } } stopVoiceNow();
}
export function toggleJarvisDrawer() { if (S.open) closeJarvisDrawer(); else openJarvisDrawer(); }

/** Legacy full-page entry points: JARVIS is the drawer, so these just open it. */
export function mount(el0) {
  openJarvisDrawer();
  if (el0 && el0.replaceChildren) { const p = document.createElement('p'); p.textContent = 'JARVIS is open in the drawer.'; el0.replaceChildren(p); }
  return () => {};
}
export function afterRender() { openJarvisDrawer(); }
export function render(ctx) { return mount(ctx && ctx.root); }

const jarvisApi = {
  init: initJarvisDrawer, open: openJarvisDrawer, close: closeJarvisDrawer, toggle: toggleJarvisDrawer,
  ask: (t) => { openJarvisDrawer(); return send(t); },
  build: (goal) => { openJarvisDrawer(); return handleAutoBuildRequest(goal); },
  speak: (t) => speakReply(t), mount, render, afterRender, shareWhatsApp: shareWA, shareEmail: shareMail,
  get isOpen() { return S.open; },
};
['send', 'prompt', 'say', 'chat', 'run', 'openWith'].forEach((k) => { jarvisApi[k] = jarvisApi.ask; });

export function getJarvis() { try { if (!S.inited) initJarvisDrawer(); } catch (e) { console.error('[JARVIS] init failed (app continues):', e); } return jarvisApi; }
export const getJarvisDrawer = getJarvis;
export const jarvis = jarvisApi;
export const openJarvis = openJarvisDrawer;
export const closeJarvis = closeJarvisDrawer;
export const toggleJarvis = toggleJarvisDrawer;
export const askJarvis = (t) => jarvisApi.ask(t);
export const sendToJarvis = askJarvis;
export const mountJarvis = (...args) => { try { return initJarvisDrawer(...args); } catch (e) { console.error('[JARVIS] init failed (app continues):', e); } };

export default { initJarvisDrawer, mountJarvis, getJarvis, openJarvisDrawer, closeJarvisDrawer, toggleJarvisDrawer, mount, render, afterRender };
