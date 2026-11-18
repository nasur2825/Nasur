/* =====================================================================
 * NASUR HSE OS — js/jarvis/drawer.js  (PHASE 7 · FINAL · 1 MEGA FILE)
 * JARVIS Super-AI Brain · Multi-Expert Router · Photo Hazard Scanner ·
 * Manager Report Auditor · Poster Builder · Live Executor ·
 * Voice Mode · Hugging Face Auto-Coder/Deployer · Offline HSE Engine
 * Created by Nasur
 * ===================================================================== */
/* BOOT-SAFE: NO static imports. Every app module is loaded lazily & defensively. */
let _M = null;
const lazy = async (p) => { try { return await import(p); } catch (e) { console.warn('[JARVIS] optional module unavailable:', p, e && e.message); return {}; } };
async function mods() {
  if (_M) return _M;
  const [ev, ob, ac, op, rg] = await Promise.all([
    lazy('../core/eventbus.js'), lazy('../services/observations.js'), lazy('../services/actions.js'),
    lazy('../services/opsstore.js'), lazy('../services/regions.js')]);
  const iso = (d) => d.toISOString().slice(0, 10);
  _M = {
    emit: ev.emit || (() => {}), createObservation: ob.createObservation, createAction: ac.createAction,
    saveOps: op.saveOps, KINDS: op.KINDS || {}, getActiveRegionId: rg.getActiveRegionId,
    todayIso: op.todayIso || (() => iso(new Date())),
    addDaysIso: op.addDaysIso || ((d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return iso(x); }),
  };
  return _M;
}

/* ------------------------------ CONSTANTS ------------------------------ */
const LS = {
  hist: 'nasur_jarvis_hist', lang: 'nasur_jarvis_lang', law: 'nasur_jarvis_law',
  hf: 'nasur_hf_token', hfRepo: 'nasur_hf_repo', apiUrl: 'nasur_api_url',
  apiKey: 'nasur_api_key', apiModel: 'nasur_api_model', queue: 'nasur_build_queue',
  voiceLang: 'nasur_voice_lang', core: 'nasur_allow_core',
};
const HF_DEFAULT_REPO = 'Nasurisai/Nasur';
const POLL_TEXT = 'https://text.pollinations.ai/openai';
const POLL_IMG = 'https://image.pollinations.ai/prompt/';
const ROUTES = {
  home: '#/home', jarvis: '#/jarvis_studio', observations: '#/observations', observation: '#/observations',
  incidents: '#/incidents', incident: '#/incidents', rca: '#/rca_coach', reports: '#/reports', report: '#/reports',
  history: '#/history', activities: '#/activities', fire: '#/fire_safety', ppe: '#/ppe_guide',
  machine: '#/machine_safety', permit: '#/ptw_jsa', ptw: '#/ptw_jsa', jsa: '#/ptw_jsa', emergency: '#/emergency',
  document: '#/doc_control', audit: '#/audits', audits: '#/audits', client: '#/clients_projects',
  project: '#/clients_projects', workspace: '#/workspace', career: '#/career', settings: '#/settings', more: '#/more',
};
const LAWS = {
  IN: 'India: Factories Act 1948, BOCW Act 1996, state factory rules, OSH Code 2020, Indian Electricity Rules, ESIC/EPF',
  GULF: 'UAE/Saudi/Qatar: UAE Federal Labour Law, ADNOC HSE/CoP, Saudi Aramco SAES/SAEP, Saudi Labor Law, Qatar Law 14/2004, OSHAD (Abu Dhabi)',
  CA: 'Canada: provincial OHS Acts (e.g. Ontario OHSA), Canada Labour Code Part II, WHMIS 2015, CSA standards',
  US: 'USA: OSHA 29 CFR 1910 (general) / 1926 (construction), NFPA 70E, ANSI standards, General Duty Clause',
};

/* ------------------------------ UTILITIES ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const ESC_MAP = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>\u0022\u0027]/g, (c) => ESC_MAP[c.charCodeAt(0)]);
const lsGet = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const uid = () => Math.random().toString(36).slice(2, 10);
const isTamil = (t) => /[\u0B80-\u0BFF]/.test(t) || /\b(enna|epdi|eppadi|sollu|venum|pannu|seiya|iruku|illa|macha|vendum|panna|kaattu|thevai|eduthu)\b/i.test(t);
const toast = (m) => {
  let t = $('#nj-toast'); if (!t) { t = document.createElement('div'); t.id = 'nj-toast'; document.body.appendChild(t); }
  t.textContent = m; t.className = 'show'; clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), 2600);
};
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const fenceRe = /```([\w.+-]*)\n([\s\S]*?)```/g;
const safeJSON = (t) => {
  if (!t) return null;
  const m = String(t).replace(/```json|```/g, '').match(/[\[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const sevOf = (s) => { s = String(s || '').toLowerCase(); return /crit|high|major|severe/.test(s) ? 'high' : /low|minor/.test(s) ? 'low' : 'medium'; };

/* ------------------------------ STATE ------------------------------ */
const S = {
  open: false, busy: false, handsfree: false, rec: null, pendingPhoto: null,
  history: [], panels: [], inited: false,
};
try { S.history = JSON.parse(lsGet(LS.hist, '[]')); } catch { S.history = []; }
const saveHist = () => lsSet(LS.hist, JSON.stringify(S.history.slice(-40).map((m) => ({ ...m, text: String(m.text).length > 6000 ? String(m.text).slice(0, 6000) + '\n…(truncated in history)' : m.text, extra: m.extra && m.extra.persist ? m.extra : undefined }))));

/* ------------------------------ OFFLINE HSE ENGINE ------------------------------ */
const KB = [
  { k: /ptw|permit|hot work|confined|height|work at height|lockout|loto/i,
    en: '**Permit to Work (PTW) essentials**\n• Valid only for the stated job, area, time & people; issuer ≠ receiver.\n• Pre-checks: JSA/risk assessment, isolation (LOTO), gas test (O2 19.5–23.5%, LEL <10%), fire watch for hot work, rescue plan for confined space.\n• Work at height: full-body harness, anchor ≥ 15 kN, 100% tie-off, scaffold tagged (green), no work in high wind/rain.\n• Close-out: area cleaned, isolation removed by the same authority, permit signed & filed.',
    ta: '**அனுமதி (PTW) முக்கியக் குறிப்புகள்**\n• குறிப்பிட்ட வேலை, இடம், நேரம், ஆட்களுக்கு மட்டும் செல்லும்; வழங்குபவர் ≠ பெறுபவர்.\n• முன் சோதனை: JSA, LOTO தனிமைப்படுத்தல், வாயு சோதனை (O2 19.5–23.5%, LEL <10%), Hot work-க்கு Fire watch, Confined space-க்கு மீட்புத் திட்டம்.\n• உயரத்தில் வேலை: Full-body harness, 100% tie-off, பச்சை tag உள்ள scaffold மட்டும்.\n• முடிவில்: இடம் சுத்தம், LOTO நீக்கம், permit கையொப்பம் & கோப்பு.' },
  { k: /fire|extinguisher|evacuat|flammable|nfpa/i,
    en: '**Fire safety**\n• Classes: A (solids) water/ABC, B (liquids) foam/CO2/DCP, C (gas) isolate + DCP, D (metals) dry powder, E (electrical) CO2, F (oils) wet chemical.\n• PASS: Pull, Aim, Squeeze, Sweep. Inspect monthly, service yearly, hydrotest per schedule.\n• Keep exits unlocked, travel distance ≤ 30 m (typ.), assembly points marked, drills at least 2×/year.',
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
    en: '**Key legal anchors**\n• India: Factories Act 1948 (s.7A duties, s.36 confined space, s.40A structural safety), BOCW 1996, OSH Code 2020.\n• Gulf: ADNOC CoP, Aramco SAES-B/SAEP, OSHAD-SF.\n• USA: OSHA 1910/1926, fall protection at 6 ft (construction), 4 ft (general industry).\n• Canada: provincial OHSA, WHMIS. Always confirm latest amendments with the competent authority.',
    ta: '**முக்கிய சட்டங்கள்**\n• இந்தியா: Factories Act 1948, BOCW 1996, OSH Code 2020.\n• வளைகுடா: ADNOC, Aramco, OSHAD.\n• USA: OSHA 1910/1926. Canada: OHSA, WHMIS.\nசமீபத்திய திருத்தங்களை அதிகாரியிடம் உறுதிப்படுத்தவும்.' },
  { k: /machine|guard|press|lathe|conveyor|interlock|e-stop|cnc/i,
    en: '**Machine safety**\n• Fixed guards for permanent hazards; interlocked guards where access is frequent; light curtains/two-hand control for presses.\n• E-stop red on yellow, latched, tested weekly. LOTO for maintenance (lock, tag, try).\n• Check nip points, rotating parts, stored energy (hydraulic, pneumatic, springs, gravity). Standards: ISO 12100, ISO 13849, IEC 62061.',
    ta: '**இயந்திரப் பாதுகாப்பு**\n• நிலையான guard, அடிக்கடி அணுகும் இடத்தில் interlock, press-க்கு light curtain.\n• E-stop வாராந்தர சோதனை; பராமரிப்புக்கு LOTO.\n• Nip point, சுழலும் பாகம், சேமிக்கப்பட்ட ஆற்றல் சரிபார்.' },
  { k: /interview|career|resume|cv|question/i,
    en: '**HSE interview prep**\nExpect: hierarchy of controls, PTW types, LOTO steps, incident rate formulas, RCA method used, how you handled a stop-work conflict, ISO 45001 clauses, legal duties, leading vs lagging KPIs. Use STAR (Situation-Task-Action-Result) with numbers: "reduced LTIs 40% across 3,000 workers by …".',
    ta: '**HSE நேர்காணல் தயாரிப்பு**\nகேள்விகள்: Hierarchy of controls, PTW வகைகள், LOTO, TRIR/LTIFR, RCA, ISO 45001. STAR முறையில் எண்களுடன் பதில்: "3,000 தொழிலாளர்களில் LTI 40% குறைத்தேன்…".' },
  { k: /toolbox|tbt|induction|training/i,
    en: '**Toolbox talk (10 min)**\nHook (real incident) → hazard of today\'s job → controls → PPE → emergency/assembly → questions → sign-off sheet. Rotate topics: LOTO, heat stress, housekeeping, manual handling, electrical, lifting.',
    ta: '**Toolbox talk (10 நிமிடம்)**\nஉண்மைச் சம்பவம் → இன்றைய வேலை ஆபத்து → கட்டுப்பாடு → PPE → அவசரநிலை → கேள்வி → கையொப்பம்.' },
];
const OFFLINE_DEFAULT = {
  en: 'I\'m in **offline mode** but can still help. Ask about PTW, LOTO, fire, PPE, machine safety, RCA, ISO 45001, laws, interviews, toolbox talks — or say "audit this report", "make a poster on …", "create observation: …", "open audits".',
  ta: 'நான் **offline mode**-ல் இருக்கேன், ஆனாலும் உதவ முடியும். PTW, LOTO, தீ, PPE, இயந்திரம், RCA, ISO 45001, சட்டம், நேர்காணல் பற்றி கேளுங்க — அல்லது "audit this report", "poster on …", "create observation: …", "open audits" சொல்லுங்க.',
};
function offlineAnswer(q) {
  const ta = isTamil(q) || lsGet(LS.lang) === 'ta';
  const hit = KB.find((e) => e.k.test(q));
  return hit ? (ta ? hit.ta : hit.en) : (ta ? OFFLINE_DEFAULT.ta : OFFLINE_DEFAULT.en);
}

/* ------------------------------ LLM LAYER ------------------------------ */
const SYS_BASE = () => `You are JARVIS, the senior HSE AI of the NASUR HSE Operating System, built for Nasur. Expert in ISO 45001/14001, OSHA, Factories Act, BOCW, ADNOC/Aramco, NFPA, ILO. Be precise, practical, cite standards. Reply in ${lsGet(LS.lang) === 'ta' ? 'Tamil (technical terms in English)' : 'the same language as the user (English, Tamil or Tanglish)'}. Jurisdiction focus: ${LAWS[lsGet(LS.law, 'IN')]}. Never invent legal clause numbers; say "verify" if unsure.`;

async function fetchT(url, opt, ms = 45000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}
async function llm(messages, { model = 'openai', temperature = 0.4, timeout = 45000 } = {}) {
  const url = lsGet(LS.apiUrl), key = lsGet(LS.apiKey);
  if (url && key) { // optional user key (OpenAI-compatible)
    try {
      const r = await fetchT(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: lsGet(LS.apiModel, 'gpt-4o-mini'), messages, temperature }) }, timeout);
      if (r.ok) { const j = await r.json(); const t = j.choices?.[0]?.message?.content; if (t) return t; }
    } catch { /* fall through to keyless */ }
  }
  for (const m of [model, 'openai']) { // keyless Pollinations
    try {
      const r = await fetchT(POLL_TEXT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, messages, temperature, private: true }) }, timeout);
      if (r.ok) { const j = await r.json(); const t = j.choices?.[0]?.message?.content; if (t) return t; }
    } catch { /* try next */ }
    if (m === 'openai') break;
  }
  throw new Error('offline');
}

/* ------------------------------ EXPERT ROUTER ------------------------------ */
const AUTOBUILD_RE = /^\s*(please\s+|jarvis[, ]+)?(build|create|make|develop|implement|generate|code|add)\b[\s\S]{0,70}\b(module|feature|tool|page|screen|dashboard|calculator|tracker|builder|generator|studio|phase\s*\d+)\b|\bphase\s*(?:[7-9]|1[0-9])\b/i;
function route(text, hasPhoto) {
  if (hasPhoto) return 'photo';
  if (/^(create|add|log|raise|new)\s+(an?\s+)?(observation|action|permit|ptw)\b/i.test(text)) return 'exec';
  if (/^(open|go to|navigate|show me|take me)\b|^(திற|போ)\b/i.test(text) && Object.keys(ROUTES).some((k) => text.toLowerCase().includes(k))) return 'nav';
  if (AUTOBUILD_RE.test(text)) return 'autobuild';
  if (/(poster|banner|flyer|signage|safety slogan|பேனர்|போஸ்டர்)/i.test(text)) return 'poster';
  if (/(audit|review|check).{0,25}(report|dsr|daily|checklist)|daily (site )?report|\bDSR\b/i.test(text) || (text.length > 350 && /(permit|toolbox|ppe|manpower|workers|shift|site)/i.test(text) && /report|date|supervisor/i.test(text))) return 'audit';
  if (/(write|build|code|module|file|function|css|html|javascript|\.js\b|commit|deploy|hugging ?face)/i.test(text) && /(code|module|file|\.js|function|component|deploy|commit|script)/i.test(text)) return 'coder';
  if (/(iso|osha|factories act|bocw|adnoc|aramco|interview|standard|clause|regulation|study|explain|compare)/i.test(text)) return 'research';
  return 'general';
}
const EXPERT_LABEL = { photo: '📷 Hazard Scanner', exec: '⚡ Executor', nav: '🧭 Navigator', poster: '🎨 Poster Builder', audit: '🕵️ Report Auditor', coder: '💻 Autonomous Coder', autobuild: '🤖 Autonomous Builder', research: '📚 Research Expert', general: '🧠 JARVIS Brain' };

/* ------------------------------ EXECUTOR / NAV ------------------------------ */
function goTo(text) {
  const k = Object.keys(ROUTES).find((x) => text.toLowerCase().includes(x));
  if (!k) return false;
  location.hash = ROUTES[k];
  return ROUTES[k];
}
async function doCreateObservation(o) {
  const M = await mods();
  if (!M.createObservation) throw new Error('observations service unavailable');
  const rec = { title: o.title, description: o.description || o.title, severity: sevOf(o.severity), category: o.category || 'General',
    status: 'open', date: M.todayIso(), source: 'jarvis', photo: o.photo || null, regionId: safe(() => M.getActiveRegionId()) };
  const r = await M.createObservation(rec); M.emit('observation:created', r); return r;
}
async function doCreateAction(o) {
  const M = await mods();
  if (!M.createAction) throw new Error('actions service unavailable');
  const rec = { title: o.title, description: o.description || '', priority: sevOf(o.priority), status: 'open',
    dueDate: o.dueDate || M.addDaysIso(M.todayIso(), o.days ?? (sevOf(o.priority) === 'high' ? 1 : sevOf(o.priority) === 'medium' ? 7 : 30)),
    source: 'jarvis', regionId: safe(() => M.getActiveRegionId()) };
  const r = await M.createAction(rec); M.emit('action:created', r); return r;
}
function safe(f) { try { return f(); } catch { return null; } }
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
        const c = document.createElement('canvas'); c.width = img.width * sc; c.height = img.height * sc;
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
  const out = await llm([{ role: 'system', content: SYS_BASE() },
    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], { model: 'openai', temperature: 0.2 });
  return safeJSON(out);
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
  if (/ \d{2,}.*(workers|men|manpower)/i.test(text) && !/supervisor|foreman|engineer/i.test(text)) findings.push({ title: 'No supervisor/HSE staffing ratio evidence.', severity: 'low', corrective_action: 'State supervisor & safety officer on duty', type: 'missing' });
  const law = lsGet(LS.law, 'IN');
  return { summary: `Offline rule audit (${law}): ${findings.length} gap(s). Jurisdiction reference: ${LAWS[law]}`, score: Math.max(0, 100 - findings.length * 11), findings };
}
async function auditReport(text) {
  const law = LAWS[lsGet(LS.law, 'IN')];
  try {
    const out = await llm([{ role: 'system', content: SYS_BASE() },
      { role: 'user', content: `Audit this subordinate daily HSE site report as a strict HSE Manager. Find missing controls, false/weak/copy-paste entries, contradictions, and legal non-compliance against: ${law}. Return ONLY JSON: {"summary":"","score":0-100,"findings":[{"title":"","severity":"low|medium|high","type":"missing|weak|false|legal","legal_ref":"","corrective_action":""}]}\n\nREPORT:\n${text}` }], { model: 'openai', temperature: 0.2 });
    const j = safeJSON(out); if (j?.findings) return j;
  } catch { /* offline */ }
  return auditOffline(text);
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
function loadImg(src) { return new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); setTimeout(() => res(null), 12000); i.src = src; }); }
async function buildPoster({ headline, subtitle, points = [], theme = 'warning', footer = 'Created by Nasur · Safety First', imagePrompt }) {
  const [c1, c2, fg] = THEMES[theme] || THEMES.warning;
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350; const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1080, 1350); grd.addColorStop(0, c1); grd.addColorStop(1, c2); g.fillStyle = grd; g.fillRect(0, 0, 1080, 1350);
  if (imagePrompt) {
    const im = await loadImg(`${POLL_IMG}${encodeURIComponent(imagePrompt + ', flat vector safety illustration, no text')}?width=1024&height=640&nologo=true`);
    if (im) { g.globalAlpha = 0.35; g.drawImage(im, 28, 380, 1024, 560); g.globalAlpha = 1; }
  }
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
    const out = await llm([{ role: 'system', content: SYS_BASE() },
      { role: 'user', content: `Create content for a safety poster on: "${topic}". ONLY JSON: {"headline":"max 5 words","subtitle":"max 12 words","points":["max 8 words each, 4-5 items"],"theme":"danger|warning|mandatory|safe|fire","imagePrompt":"short visual description"}` }], { temperature: 0.7 });
    const j = safeJSON(out); if (j?.headline) return j;
  } catch { /* offline */ }
  const hit = KB.find((e) => e.k.test(topic)); const lines = hit ? hit.en.split('\n').filter((l) => l.startsWith('•')).map((l) => l.replace(/^•\s*/, '').slice(0, 60)) : [];
  return { headline: topic.slice(0, 30), subtitle: 'Work safe. Go home safe.', points: lines.length ? lines.slice(0, 4) : ['Wear your PPE', 'Report every hazard', 'Stop work if unsafe', 'Look out for each other'], theme: /fire/i.test(topic) ? 'fire' : /ppe|mandatory/i.test(topic) ? 'mandatory' : 'warning', imagePrompt: topic };
}

/* ------------------------------ HUGGING FACE DEPLOYER ------------------------------ */
async function hfCommit(files, summary) {
  const token = lsGet(LS.hf), repo = lsGet(LS.hfRepo, HF_DEFAULT_REPO);
  if (!token) throw new Error('Add your Hugging Face WRITE token in JARVIS ⚙ settings first.');
  const lines = [JSON.stringify({ key: 'header', value: { summary: summary || 'JARVIS auto-commit' } })];
  files.forEach((f) => lines.push(JSON.stringify({ key: 'file', value: { path: f.path, content: b64(f.content), encoding: 'base64' } })));
  const r = await fetchT(`https://huggingface.co/api/spaces/${repo}/commit/main`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-ndjson' }, body: lines.join('\n') }, 60000);
  if (!r.ok) throw new Error(`HF ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return true;
}
function extractCode(text) {
  const out = []; let m; fenceRe.lastIndex = 0;
  while ((m = fenceRe.exec(text))) {
    const code = m[2]; const pm = code.match(/^\s*(?:\/\/|\/\*|#|<!--)\s*path:\s*([^\s*>]+)/i);
    out.push({ lang: m[1], code, path: pm ? pm[1] : null });
  }
  return out;
}
/* ------------------------------ AUTONOMOUS BUILDER ------------------------------ */
const ARCH = `NASUR is a vanilla-JS offline-first PWA on a Hugging Face Static Space (no bundler, no npm, ES modules with relative imports). Core: js/core/config.js (STORES, EVENTS, APP), js/core/eventbus.js (emit,on,off), js/core/router.js (hash routes #/route; a module exports mount(el,ctx) and/or render(ctx); navigate(), getModules(), getNavItems()). Services: js/services/repo.js (IndexedDB wrapper; STORES.MEMORY_NOTES), opsstore.js (KINDS,listOps,getOps,saveOps,patchOps,removeOps,todayIso,addDaysIso,daysUntil), observations.js (createDraft,createObservation), actions.js (createAction), regions.js (getActiveRegionId,formatDate). Modules are registered in data/modules.json. RULES: ONE self-contained file per feature; export default plus named mount & render; load app services with lazy dynamic await import() inside try/catch so nothing can ever block app boot; mobile-first dark UI, bottom tab bar is 76px tall; no API keys; Tamil + English friendly; production quality, no placeholders or TODOs.`;
const CORE_BLOCK = /^(js\/core\/|js\/jarvis\/drawer\.js$|index\.html$|sw\.js$|manifest\.json$)/i;
async function hfRaw(path) {
  const repo = lsGet(LS.hfRepo, HF_DEFAULT_REPO), token = lsGet(LS.hf);
  try {
    const r = await fetchT(`https://huggingface.co/spaces/${repo}/raw/main/${path}?t=${Date.now()}`, token ? { headers: { Authorization: 'Bearer ' + token } } : {}, 20000);
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
function syntaxCheck(code, path) {
  if (/\.json$/i.test(path)) { try { JSON.parse(code); return null; } catch (e) { return e.message; } }
  if (!/\.m?js$/i.test(path)) return null;
  const AF = Object.getPrototypeOf(async function () {}).constructor;
  const src = String(code)
    .replace(/^\s*import\s+[\s\S]*?from\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*import\s*['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*(from\s*['"][^'"]+['"])?\s*;?/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'void ')
    .replace(/^\s*export\s+(?=(async\s+function|function|class|const|let|var))/gm, '');
  try { new AF(src); return null; } catch (e) { return e instanceof EvalError ? null : e.message; }
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
        (err ? `\nYour previous attempt had this syntax error: ${err}\nReturn the complete corrected file.\nPREVIOUS ATTEMPT:\n${code.slice(0, 9000)}` : '') }];
    const out = await llm(msgs, { model: 'qwen-coder', temperature: 0.2, timeout: 150000 });
    const c = extractCode(out)[0]; code = c ? c.code : String(out).trim();
    err = syntaxCheck(code, path);
    if (!err) return code;
    log(`🔧 Syntax issue in ${path}: ${err} — self-repairing (${i + 1}/3)`);
  }
  throw new Error('could not produce syntax-valid code: ' + err);
}
async function planBuild(goal) {
  const out = await llm([
    { role: 'system', content: 'You are the NASUR chief architect. ' + ARCH + ' Return ONLY JSON.' },
    { role: 'user', content: `Request from Nasur: "${goal}"\nPlan the minimal set of files (prefer ONE self-contained file per feature). JSON shape: {"goal":"one line","module":{"id":"snake_case","title":"","icon":"emoji"} or null,"files":[{"path":"js/modules/<id>.js","spec":"very detailed spec: UI, data, behaviour, edge cases"}]}` }], { model: 'openai', temperature: 0.2, timeout: 90000 });
  const j = safeJSON(out);
  if (!j?.files?.length) throw new Error('planner returned no files');
  if (j.module && j.module.id) j.module.id = String(j.module.id).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return j;
}
async function registerModule(mod) {
  const raw = await hfRaw('data/modules.json'); if (!raw) return null;
  let j; try { j = JSON.parse(raw); } catch { return null; }
  const arr = Array.isArray(j) ? j : (Array.isArray(j.modules) ? j.modules : null);
  if (!arr || !arr.length || arr.some((m) => m && m.id === mod.id)) return null;
  const tpl = arr.find((m) => m && m.id === 'ppe_guide') || arr[arr.length - 1];
  let str = JSON.stringify(tpl); if (tpl.id) str = str.split(tpl.id).join(mod.id);
  const e = JSON.parse(str);
  for (const k of ['title', 'label', 'name']) if (k in e) e[k] = mod.title || mod.id;
  if ('icon' in e && mod.icon) e.icon = mod.icon;
  arr.push(e);
  return { path: 'data/modules.json', content: JSON.stringify(j, null, 2) };
}
async function buildAndShip(plan, log) {
  const allowCore = lsGet(LS.core) === '1'; const files = []; const skipped = [];
  for (const f of plan.files.slice(0, 10)) {
    const path = String(f.path || '').replace(/^\/+/, '');
    if (!path || path.includes('..') || /\s/.test(path)) { skipped.push(path || '(empty path)'); continue; }
    if (CORE_BLOCK.test(path) && !allowCore) { skipped.push(path + ' (core file — enable in ⚙)'); continue; }
    log('🔨 Writing ' + path + ' …');
    try { const code = await genFile(path, f.spec || plan.goal, plan, log); files.push({ path, content: code }); log(`✔ ${path} — ${code.length} chars, syntax OK`); }
    catch (e) { log('❌ ' + path + ': ' + e.message); }
  }
  if (skipped.length) log('⏭ Skipped: ' + skipped.join(', '));
  if (!files.length) return log('Nothing was generated.');
  let reg = null;
  if (plan.module && plan.module.id && files.some((f) => /^js\/modules\//.test(f.path))) { try { reg = await registerModule(plan.module); } catch { reg = null; } if (reg) files.push(reg); }
  if (!lsGet(LS.hf)) {
    files.forEach((f) => addMsg('ai', f.path + ' — add your HF token in ⚙ for automatic commit.\n```js\n// path: ' + f.path + '\n' + f.content + '\n```', null, 'autobuild'));
    return;
  }
  await hfCommit(files, 'JARVIS autonomous build: ' + String(plan.goal).slice(0, 60));
  const route = plan.module && plan.module.id ? '#/' + plan.module.id : null;
  addMsg('ai', `🚀 **Committed ${files.length} file(s) to ${lsGet(LS.hfRepo, HF_DEFAULT_REPO)}**\n` + files.map((f) => '• ' + f.path).join('\n') + '\n' +
    (reg ? '📌 Registered in data/modules.json' : '⚠ Not auto-registered in data/modules.json — add its entry if the module is missing from the menu.') +
    '\nThe Space rebuilds in ~30–60 s, then tap Reload.', { type: 'built', route }, 'autobuild');
}
async function handleAutoBuildRequest(text) {
  const log = (t) => addMsg('ai', t, null, 'autobuild');
  log('🧭 Planning the build …');
  let plan;
  try { plan = await planBuild(text); } catch (e) { return log('❌ Planner failed: ' + e.message + '. The AI may be busy — try again in a moment.'); }
  log('📐 Plan: ' + plan.files.map((f) => f.path).join(', '));
  try { await buildAndShip(plan, log); } catch (e) { log('❌ ' + e.message); }
}
async function autoBuild(log) {
  const q = lsGet(LS.queue, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!q.length) { const g = prompt('Tell JARVIS what to build (e.g. "Phase 8: Canva-style poster studio module")'); return g ? handleAutoBuildRequest(g) : log('Cancelled.'); }
  const plan = { goal: 'Queued build', files: q.map((l) => { const [pth, ...d] = l.split('|'); return { path: pth.trim(), spec: d.join('|').trim() || 'Complete production module' }; }) };
  try { await buildAndShip(plan, log); } catch (e) { log('❌ ' + e.message); }
}

/* ------------------------------ VOICE ------------------------------ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const clean = String(text).replace(/```[\s\S]*?```/g, ' code block ').replace(/[*_`#•✔✅⚠]/g, '').slice(0, 900);
  const u = new SpeechSynthesisUtterance(clean); u.lang = lsGet(LS.voiceLang, isTamil(clean) ? 'ta-IN' : 'en-IN'); u.rate = 1;
  u.onend = () => { if (S.handsfree) listen(); };
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function listen() {
  if (!SR) return toast('Speech recognition not supported in this browser');
  try { S.rec?.stop(); } catch { /* ignore */ }
  const r = new SR(); S.rec = r; r.lang = lsGet(LS.voiceLang, 'en-IN'); r.interimResults = false;
  r.onresult = (e) => { const t = e.results[0][0].transcript; send(t); };
  r.onerror = () => setMic(false); r.onend = () => { if (!S.handsfree) setMic(false); };
  r.start(); setMic(true);
}
function setMic(on) { document.querySelectorAll('.nj-mic').forEach((b) => b.classList.toggle('on', on || S.handsfree)); }
function toggleHandsfree() {
  S.handsfree = !S.handsfree; setMic(false);
  if (S.handsfree) { toast('Hands-free ON (works with Bluetooth headset)'); listen(); } else { try { S.rec?.stop(); } catch { /* ignore */ } speechSynthesis?.cancel(); toast('Hands-free OFF'); }
}

/* ------------------------------ SHARING ------------------------------ */
const plain = (t) => String(t).replace(/\*\*/g, '*').replace(/```[\w]*\n?/g, '').trim();
const shareWA = (t) => window.open('https://wa.me/?text=' + encodeURIComponent(plain(t) + '\n\n— JARVIS · NASUR HSE OS'), '_blank');
const shareMail = (t) => { location.href = 'mailto:?subject=' + encodeURIComponent('HSE — JARVIS report') + '&body=' + encodeURIComponent(plain(t)); };

/* ------------------------------ CHAT CORE ------------------------------ */
function addMsg(role, text, extra, expert) {
  const m = { id: uid(), role, text, extra, expert, ts: Date.now() };
  S.panels = S.panels.filter((p) => p.host && p.host.isConnected); S.history.push(m); saveHist(); S.panels.forEach((p) => p.append(m)); return m;
}
const setBusy = (b) => { S.busy = b; S.panels.forEach((p) => p.busy(b)); };

async function send(textIn) {
  const text = String(textIn ?? '').trim(); const photo = S.pendingPhoto;
  if (S.busy || (!text && !photo)) return;
  S.pendingPhoto = null; S.panels.forEach((p) => p.clearPhoto());
  addMsg('user', text || '(photo)', photo ? { photo, persist: false } : undefined);
  if (/^(ta|tamil|தமிழ்)$/i.test(text)) { lsSet(LS.lang, 'ta'); return addMsg('ai', 'சரி macha, இனி தமிழில் பதில் சொல்றேன் 👍', null, 'general'); }
  const expert = route(text, !!photo); setBusy(true);
  try {
    if (expert === 'photo') await handlePhoto(photo, text);
    else if (expert === 'exec') addMsg('ai', await execCommand(text), null, expert);
    else if (expert === 'nav') { const r = goTo(text); addMsg('ai', r ? `🧭 Opening **${esc(r)}** …` : 'Module not found.', null, expert); if (r) closeJarvisDrawer(); }
    else if (expert === 'poster') await handlePoster(text);
    else if (expert === 'audit') await handleAudit(text);
    else if (expert === 'autobuild') await handleAutoBuildRequest(text);
    else await handleChat(text, expert);
  } catch (e) {
    addMsg('ai', offlineAnswer(text) + '\n\n_(offline engine)_', null, expert);
  } finally { setBusy(false); }
}

async function handleChat(text, expert) {
  const sys = { coder: SYS_BASE() + '\nYou are the Autonomous Coder. Output complete files in fenced code blocks; put `// path: js/...` as the first line of each file.', research: SYS_BASE() + '\nYou are the Deep HSE Research expert: structured, cite clause/standard names, include practical checklists.' }[expert] || SYS_BASE();
  const ctx = S.history.filter((m) => m.role === 'user' || m.role === 'ai').slice(-8, -1).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.text).slice(0, 1500) }));
  let out;
  try { out = await llm([{ role: 'system', content: sys }, ...ctx, { role: 'user', content: text }], { model: expert === 'coder' ? 'qwen-coder' : 'openai' }); }
  catch { out = offlineAnswer(text) + '\n\n_(offline engine)_'; }
  const m = addMsg('ai', out, null, expert); if (S.handsfree) speak(m.text);
}
async function handlePhoto(photo, note) {
  let res = null; try { res = await scanPhoto(photo, note); } catch { /* offline */ }
  if (!res?.hazards) {
    return addMsg('ai', '📷 Photo saved, but AI vision is offline. Use the manual checklist: PPE (helmet/vest/shoes/harness)? Edge/height protection? Scaffold tag? Housekeeping? Electrical leads? Barricade/PTW? Tap **Save as Observation** to log it.',
      { type: 'photo', photo, data: { summary: note || 'Site photo observation', overall_risk: 'medium', hazards: [] } }, 'photo');
  }
  const md = `**📷 Hazard Scan — overall risk: ${esc(res.overall_risk || 'n/a').toUpperCase()}**\n${esc(res.summary || '')}\n\n` +
    res.hazards.map((h, i) => `**${i + 1}. ${esc(h.title)}** [${sevOf(h.severity)}]\n${esc(h.detail || '')}\n➜ ${esc(h.corrective_action || '')}`).join('\n\n') +
    (res.positives?.length ? '\n\n✅ Good: ' + res.positives.map(esc).join('; ') : '');
  const m = addMsg('ai', md, { type: 'photo', photo, data: res }, 'photo'); if (S.handsfree) speak(m.text);
}
async function handleAudit(text) {
  const res = await auditReport(text);
  const md = `**🕵️ Manager Audit — Score ${res.score ?? '?'}/100**\n${esc(res.summary || '')}\n\n` +
    (res.findings || []).map((f, i) => `**${i + 1}. [${sevOf(f.severity)}]** ${esc(f.title)}${f.legal_ref ? `\n⚖ ${esc(f.legal_ref)}` : ''}\n➜ ${esc(f.corrective_action || '')}`).join('\n\n');
  const m = addMsg('ai', md, { type: 'audit', data: res }, 'audit'); if (S.handsfree) speak(`Audit score ${res.score}. ${res.findings?.length || 0} findings.`);
  return m;
}
async function handlePoster(text) {
  const topic = text.replace(/(make|create|design|build|generate|a|an|safety|poster|banner|on|about|for)\b/gi, ' ').replace(/\s+/g, ' ').trim() || 'Work Safely';
  const spec = await posterSpec(topic); const url = await buildPoster(spec);
  addMsg('ai', `🎨 **Poster ready: ${esc(spec.headline)}** — tap download.`, { type: 'poster', url, name: spec.headline }, 'poster');
}

/* ------------------------------ UI ------------------------------ */
const CSS = `
#nj-fab{position:fixed;right:16px;bottom:calc(var(--nav-h,76px) + 12px);z-index:99999;background:linear-gradient(135deg,#00e5ff,#2979ff);color:#001;border:0;border-radius:28px;padding:12px 18px;font:700 15px system-ui;box-shadow:0 6px 24px rgba(0,229,255,.45);cursor:pointer}
#nj-drawer{position:fixed;top:0;right:0;bottom:var(--drawer-bottom,76px);width:min(480px,100vw);z-index:99999;background:#0b1220;color:#e8eefc;transform:translateX(105%);transition:transform .25s;display:flex;flex-direction:column;box-shadow:-8px 0 32px rgba(0,0,0,.5)}
#nj-drawer.open{transform:none}#jarvis-drawer,#jarvis-fab{display:none!important}
.nj-wrap{display:flex;flex-direction:column;height:100%;min-height:0;font:14px/1.5 system-ui,sans-serif;background:#0b1220;color:#e8eefc}
.nj-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#101a30;border-bottom:1px solid #1d2b4d}
.nj-head b{flex:1;font-size:16px;color:#00e5ff}.nj-head button,.nj-bar button,.nj-chips button,.nj-act button,.nj-set button{background:#18264a;color:#e8eefc;border:1px solid #27407a;border-radius:10px;padding:7px 10px;cursor:pointer;font:inherit}
.nj-chips{display:flex;gap:6px;overflow-x:auto;padding:8px 10px;border-bottom:1px solid #16223f}.nj-chips button{white-space:nowrap;font-size:12px}
.nj-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0}
.nj-m{max-width:94%;padding:10px 12px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}
.nj-m.user{align-self:flex-end;background:#1f4fd8}.nj-m.ai{align-self:flex-start;background:#15213d;border:1px solid #223463}
.nj-tag{font-size:11px;color:#7fdcff;margin-bottom:4px}.nj-m img{max-width:100%;border-radius:10px;margin-top:6px}
.nj-m pre{background:#060b16;padding:8px;border-radius:8px;overflow-x:auto;font-size:12px;white-space:pre}
.nj-act{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.nj-act button{font-size:12px;padding:5px 8px}
.nj-bar{display:flex;gap:6px;padding:8px;border-top:1px solid #1d2b4d;background:#101a30;align-items:flex-end}
.nj-bar textarea{flex:1;resize:none;max-height:110px;background:#0b1220;color:#fff;border:1px solid #27407a;border-radius:12px;padding:9px;font:inherit}
.nj-mic.on{background:#c62828!important;animation:njp 1s infinite}@keyframes njp{50%{opacity:.55}}
.nj-prev{padding:6px 10px;font-size:12px;color:#7fdcff;display:none}.nj-prev img{height:44px;border-radius:6px;vertical-align:middle;margin-right:6px}
.nj-set{display:none;padding:10px;overflow-y:auto;background:#0e1730;border-bottom:1px solid #1d2b4d;max-height:62%}.nj-set.show{display:block}
.nj-set label{display:block;margin:8px 0 3px;font-size:12px;color:#9fb4e6}.nj-set input,.nj-set select,.nj-set textarea{width:100%;box-sizing:border-box;background:#0b1220;color:#fff;border:1px solid #27407a;border-radius:8px;padding:7px;font:inherit}
.nj-dots span{display:inline-block;width:7px;height:7px;margin:0 2px;background:#00e5ff;border-radius:50%;animation:njp 1s infinite}
#nj-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#000c;color:#fff;padding:9px 16px;border-radius:20px;z-index:100001;opacity:0;transition:.2s;pointer-events:none}#nj-toast.show{opacity:1}`;

const CHIPS = [
  ['🎨 Poster', 'Make a safety poster on work at height'], ['🕵️ Audit', 'Audit this daily report:\n'], ['🔥 Fire', 'Explain fire extinguisher classes'],
  ['📝 PTW', 'Explain permit to work steps'], ['🎤 Interview', 'HSE interview questions for a factory safety officer'], ['💻 Code', 'Write code for a new module: '],
  ['⚖ Laws', 'Factories Act key duties for occupier'], ['🧭 Audits', 'open audits'], ['🤖 Build', 'Build module: '],
];

function md(t) {
  let h = esc(t);
  h = h.replace(/```([\w.+-]*)\n([\s\S]*?)```/g, (_, l, c) => `<pre data-lang="${l}">${c}</pre>`);
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_\((.+?)\)_/g, '<i>($1)</i>').replace(/\n/g, '<br>');
  return h.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (a) => a.replace(/<br>/g, '\n'));
}

function createPanel(host) {
  host.innerHTML = `
  <div class="nj-wrap">
    <div class="nj-head"><b>✦ JARVIS</b><button class="nj-hf" title="Hands-free">🎧</button><button class="nj-gear" title="Settings">⚙</button><button class="nj-x" title="Close">✕</button></div>
    <div class="nj-set"></div>
    <div class="nj-chips"></div>
    <div class="nj-log"></div>
    <div class="nj-prev"></div>
    <div class="nj-bar">
      <button class="nj-cam" title="Camera / Photo">📷</button><input type="file" accept="image/*" capture="environment" hidden class="nj-file">
      <textarea rows="1" placeholder="Ask JARVIS… (Tamil / English)"></textarea>
      <button class="nj-mic" title="Voice">🎤</button><button class="nj-go">➤</button>
    </div>
  </div>`;
  const log = $('.nj-log', host), ta = $('textarea', host), prev = $('.nj-prev', host), set = $('.nj-set', host), file = $('.nj-file', host);
  const chips = $('.nj-chips', host);
  CHIPS.forEach(([l, p]) => { const b = document.createElement('button'); b.textContent = l; b.onclick = () => { if (p.endsWith('\n') || p.endsWith(': ')) { ta.value = p; ta.focus(); } else send(p); }; chips.appendChild(b); });

  const api = {
    append(m) { log.appendChild(renderMsg(m)); log.scrollTop = log.scrollHeight; },
    busy(b) { let d = $('.nj-dots', log); if (b && !d) { d = document.createElement('div'); d.className = 'nj-m ai nj-dots'; d.innerHTML = '<span></span><span></span><span></span>'; log.appendChild(d); log.scrollTop = log.scrollHeight; } if (!b && d) d.remove(); },
    clearPhoto() { prev.style.display = 'none'; prev.innerHTML = ''; },
    showPhoto(u) { prev.style.display = 'block'; prev.innerHTML = `<img src="${u}">Photo attached — add a note & send`; },
  };
  if (!S.history.length) addMsg('ai', 'Vanakkam Nasur! 👋 I\'m JARVIS — ask me anything on HSE (Tamil / English), 📷 scan a site photo, paste a site report to audit, make safety posters, create observations/actions, or build code. No API key needed.', null, 'general');
  S.history.forEach((m) => log.appendChild(renderMsg(m))); log.scrollTop = log.scrollHeight;

  $('.nj-go', host).onclick = () => { send(ta.value); ta.value = ''; };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta.value); ta.value = ''; } };
  $('.nj-mic', host).onclick = () => (S.rec && !S.handsfree && $('.nj-mic', host).classList.contains('on') ? (S.rec.stop(), setMic(false)) : listen());
  $('.nj-hf', host).onclick = toggleHandsfree;
  $('.nj-x', host).onclick = closeJarvisDrawer;
  $('.nj-cam', host).onclick = () => file.click();
  file.onchange = async () => { const f = file.files[0]; if (!f) return; try { S.pendingPhoto = await fileToDataUrl(f); S.panels.forEach((p) => p.showPhoto(S.pendingPhoto)); } catch { toast('Could not read photo'); } file.value = ''; };
  $('.nj-gear', host).onclick = () => { set.classList.toggle('show'); if (set.classList.contains('show')) renderSettings(set); };
  return api;
}

function renderSettings(el) {
  el.innerHTML = `
  <label>Reply language</label><select id="nj-l"><option value="auto">Auto</option><option value="ta">தமிழ் (Tamil)</option><option value="en">English</option></select>
  <label>Voice language</label><select id="nj-v"><option value="en-IN">English (India)</option><option value="ta-IN">Tamil (India)</option><option value="en-US">English (US)</option><option value="ar-SA">Arabic</option></select>
  <label>Legal jurisdiction for audits</label><select id="nj-law"><option value="IN">India</option><option value="GULF">UAE / Saudi / Qatar</option><option value="CA">Canada</option><option value="US">USA</option></select>
  <label>Hugging Face WRITE token (optional)</label><input id="nj-hf" type="password" placeholder="hf_…">
  <label>HF Space repo</label><input id="nj-repo">
  <label>Optional AI key — OpenAI-compatible URL</label><input id="nj-au" placeholder="https://api.openai.com/v1/chat/completions">
  <label>API key</label><input id="nj-ak" type="password"><label>Model</label><input id="nj-am" placeholder="gpt-4o-mini">
  <label>Auto-build queue (one per line: path | spec)</label><textarea id="nj-q" rows="4"></textarea>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="nj-core" style="width:auto"> Allow JARVIS to edit core files (js/core, drawer.js, index.html) — risky</label>
  <div class="nj-act"><button id="nj-save">💾 Save</button><button id="nj-build">🚀 Auto-Build Remaining Phases</button><button id="nj-clear">🗑 Clear chat</button></div>
  <div style="font-size:11px;color:#7f93c9;margin-top:8px">Keys stay only in this device's localStorage. Created by Nasur.</div>`;
  const v = (id) => $('#' + id, el);
  v('nj-l').value = lsGet(LS.lang, 'auto'); v('nj-v').value = lsGet(LS.voiceLang, 'en-IN'); v('nj-law').value = lsGet(LS.law, 'IN');
  v('nj-hf').value = lsGet(LS.hf); v('nj-repo').value = lsGet(LS.hfRepo, HF_DEFAULT_REPO);
  v('nj-au').value = lsGet(LS.apiUrl); v('nj-ak').value = lsGet(LS.apiKey); v('nj-am').value = lsGet(LS.apiModel); v('nj-q').value = lsGet(LS.queue); v('nj-core').checked = lsGet(LS.core) === '1';
  const saveAll = () => { lsSet(LS.lang, v('nj-l').value); lsSet(LS.voiceLang, v('nj-v').value); lsSet(LS.law, v('nj-law').value); lsSet(LS.hf, v('nj-hf').value.trim());
    lsSet(LS.hfRepo, v('nj-repo').value.trim() || HF_DEFAULT_REPO); lsSet(LS.apiUrl, v('nj-au').value.trim()); lsSet(LS.apiKey, v('nj-ak').value.trim()); lsSet(LS.apiModel, v('nj-am').value.trim()); lsSet(LS.queue, v('nj-q').value); lsSet(LS.core, v('nj-core').checked ? '1' : '0'); };
  v('nj-save').onclick = () => { saveAll(); toast('Saved ✔'); el.classList.remove('show'); };
  v('nj-clear').onclick = () => { S.history = []; saveHist(); S.panels.forEach((p) => p.host.querySelector('.nj-log').innerHTML = ''); toast('Chat cleared'); };
  v('nj-build').onclick = async () => { saveAll(); el.classList.remove('show'); setBusy(true); await autoBuild((t) => addMsg('ai', t, null, 'coder')); setBusy(false); };
}

function btn(label, fn) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; }

function renderMsg(m) {
  const d = document.createElement('div'); d.className = 'nj-m ' + m.role;
  if (m.role === 'ai' && m.expert) d.innerHTML = `<div class="nj-tag">${EXPERT_LABEL[m.expert] || ''}</div>`;
  const body = document.createElement('div'); body.innerHTML = m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>') : md(m.text); d.appendChild(body);
  if (m.extra?.photo) { const i = document.createElement('img'); i.src = m.extra.photo; d.appendChild(i); }
  if (m.role === 'ai') {
    const act = document.createElement('div'); act.className = 'nj-act';
    const x = m.extra;
    if (x?.type === 'photo') {
      act.appendChild(btn('💾 Save as Observation', async () => {
        try { const hs = x.data.hazards?.length ? x.data.hazards : [{ title: x.data.summary || 'Site photo observation', severity: x.data.overall_risk, detail: x.data.summary }];
          for (const h of hs) { await doCreateObservation({ title: h.title, description: `${h.detail || ''}\nAction: ${h.corrective_action || ''}`, severity: h.severity, category: h.category, photo: x.photo });
            if (h.corrective_action) await doCreateAction({ title: h.corrective_action.slice(0, 90), description: h.title, priority: h.severity }); }
          toast(`Saved ${hs.length} observation(s) + actions ✔`); } catch (e) { toast('Save failed: ' + e.message); } }));
    }
    if (x?.type === 'audit') {
      act.appendChild(btn('✅ Create corrective actions', async () => {
        try { for (const f of x.data.findings || []) await doCreateAction({ title: (f.corrective_action || f.title).slice(0, 90), description: f.title + (f.legal_ref ? ' | ' + f.legal_ref : ''), priority: f.severity });
          toast(`${x.data.findings?.length || 0} actions created ✔`); } catch (e) { toast('Failed: ' + e.message); } }));
      act.appendChild(btn('📋 Open Actions', () => { goTo('audits'); closeJarvisDrawer(); }));
    }
    if (x?.type === 'built') {
      if (x.route) act.appendChild(btn('📂 Open module', () => { location.hash = x.route; closeJarvisDrawer(); }));
      act.appendChild(btn('↻ Reload app', () => location.reload()));
    }
    if (x?.type === 'poster') {
      const i = document.createElement('img'); i.src = x.url; d.appendChild(i);
      act.appendChild(btn('⬇ Download PNG', () => { const a = document.createElement('a'); a.href = x.url; a.download = (x.name || 'safety-poster').replace(/\W+/g, '_') + '.png'; a.click(); }));
      act.appendChild(btn('📤 Share image', async () => { try { const b = await (await fetch(x.url)).blob(); const f = new File([b], 'poster.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: x.name }); else toast('Use Download, then share'); } catch { /* cancelled */ } }));
    }
    extractCode(m.text).forEach((c) => {
      act.appendChild(btn('📋 Copy code', () => navigator.clipboard.writeText(c.code).then(() => toast('Copied'))));
      act.appendChild(btn('🚀 Commit to HF', async () => {
        const p = c.path || prompt('File path in Space (e.g. js/modules/x.js)'); if (!p) return;
        try { await hfCommit([{ path: p, content: c.code }], 'JARVIS commit ' + p); toast('Committed ✔ ' + p); } catch (e) { toast(e.message); } }));
    });
    act.appendChild(btn('💬 WhatsApp', () => shareWA(m.text))); act.appendChild(btn('✉ Email', () => shareMail(m.text)));
    act.appendChild(btn('🔊 Speak', () => speak(m.text)));
    d.appendChild(act);
  }
  return d;
}

/* ------------------------------ LEGACY PHASE-1 DRAWER PURGE ------------------------------ */
const LEGACY_SEL = '#jarvis-drawer,#jarvis-fab,#jarvis-bar,#jarvis-launcher,#jarvis-toggle,.jarvis-drawer,.jarvis-fab,.jarvis-launcher,[data-jarvis-drawer],[data-legacy-jarvis]';
function isFloating(el) { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'sticky'; }
function purgeLegacy() {
  try {
    document.querySelectorAll(LEGACY_SEL).forEach((el) => {
      if (el.id === 'nj-fab' || el.closest('#nj-drawer,.nj-wrap')) return;
      if (isFloating(el)) el.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('input[placeholder],textarea[placeholder]').forEach((i) => {
      if (!/tell jarvis/i.test(i.placeholder) || i.closest('.nj-wrap')) return;
      let n = i, top = null;
      while (n && n !== document.body) { if (isFloating(n)) top = n; n = n.parentElement; }
      if (top) top.style.setProperty('display', 'none', 'important');
    });
  } catch { /* never block the app */ }
}
let _purgeQ = false;
const schedPurge = () => { if (_purgeQ) return; _purgeQ = true; requestAnimationFrame(() => { _purgeQ = false; purgeLegacy(); }); };

/* ------------------------------ DRAWER API & EXPORTS ------------------------------ */
function ensureCss() { if ($('#nj-css')) return; const s = document.createElement('style'); s.id = 'nj-css'; s.textContent = CSS; document.head.appendChild(s); }

export function initJarvisDrawer() {
  if (S.inited) return;
  const go = () => {
    if (S.inited) return; S.inited = true;
    ensureCss(); purgeLegacy();
    ['nj-fab', 'nj-drawer'].forEach((id) => { const o = document.getElementById(id); if (o) o.remove(); });
    const fab = document.createElement('button'); fab.id = 'nj-fab'; fab.textContent = '✦ JARVIS'; fab.onclick = toggleJarvisDrawer; document.body.appendChild(fab);
    const dr = document.createElement('div'); dr.id = 'nj-drawer'; document.body.appendChild(dr);
    const p = createPanel(dr); p.host = dr; S.panels.push(p);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) closeJarvisDrawer(); });
    window.addEventListener('nasur:jarvis', (e) => { openJarvisDrawer(); if (e.detail && e.detail.prompt) send(e.detail.prompt); });
    window.addEventListener('hashchange', schedPurge);
    try { new MutationObserver(schedPurge).observe(document.body, { childList: true, subtree: true }); } catch { /* ignore */ }
    window.JARVIS = jarvisApi;
  };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
}
export function openJarvisDrawer() {
  if (!S.inited) initJarvisDrawer();
  const d = $('#nj-drawer'); if (!d) return;
  d.classList.add('open'); S.open = true; const f = $('#nj-fab'); if (f) f.style.display = 'none';
}
export function closeJarvisDrawer() { const d = $('#nj-drawer'); if (d) d.classList.remove('open'); S.open = false; const f = $('#nj-fab'); if (f) f.style.display = ''; }
export function toggleJarvisDrawer() { S.open ? closeJarvisDrawer() : openJarvisDrawer(); }

export function mount(el /*, ctx */) { // full-page JARVIS Studio
  ensureCss(); purgeLegacy();
  el.style.height = 'calc(100vh - 140px)'; el.style.minHeight = '420px';
  const p = createPanel(el); p.host = el;
  const x = $('.nj-x', el); if (x) x.style.display = 'none';
  S.panels.push(p);
  return () => { S.panels = S.panels.filter((q) => q !== p); };
}
export function afterRender() { const h = document.getElementById('nj-page-host'); if (h && !h.dataset.m) { h.dataset.m = '1'; mount(h); } }
export function render(/* ctx */) {
  let tries = 0;
  const t = () => { const h = document.getElementById('nj-page-host'); if (h) afterRender(); else if (tries++ < 40) setTimeout(t, 50); };
  setTimeout(t, 0);
  return '<div id="nj-page-host" style="height:calc(100vh - 140px);min-height:420px"></div>';
}

const jarvisApi = {
  init: initJarvisDrawer, open: openJarvisDrawer, close: closeJarvisDrawer, toggle: toggleJarvisDrawer,
  ask: (t) => { openJarvisDrawer(); return send(t); },
  build: (goal) => { openJarvisDrawer(); return handleAutoBuildRequest(goal); },
  speak, mount, render, afterRender, shareWhatsApp: shareWA, shareEmail: shareMail,
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
