/* =====================================================================
 * NASUR HSE OS — js/jarvis/drawer.js  (PHASE 7 · FINAL · 1 MEGA FILE)
 * JARVIS Super-AI Brain · Multi-Expert Router · Photo Hazard Scanner ·
 * Manager Report Auditor · Poster Builder · Live Executor ·
 * Voice Mode · Hugging Face Auto-Coder/Deployer · Offline HSE Engine
 * Created by Nasur
 * ===================================================================== */
import { emit } from '../core/eventbus.js';
import { navigate } from '../core/router.js';
import { createObservation } from '../services/observations.js';
import { createAction } from '../services/actions.js';
import { saveOps, KINDS, todayIso, addDaysIso } from '../services/opsstore.js';
import { getActiveRegionId } from '../services/regions.js';

/* ------------------------------ CONSTANTS ------------------------------ */
const LS = {
  hist: 'nasur_jarvis_hist', lang: 'nasur_jarvis_lang', law: 'nasur_jarvis_law',
  hf: 'nasur_hf_token', hfRepo: 'nasur_hf_repo', apiUrl: 'nasur_api_url',
  apiKey: 'nasur_api_key', apiModel: 'nasur_api_model', queue: 'nasur_build_queue',
  voiceLang: 'nasur_voice_lang',
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
const saveHist = () => lsSet(LS.hist, JSON.stringify(S.history.slice(-40).map((m) => ({ ...m, extra: m.extra && m.extra.persist ? m.extra : undefined }))));

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
async function llm(messages, { model = 'openai', temperature = 0.4 } = {}) {
  const url = lsGet(LS.apiUrl), key = lsGet(LS.apiKey);
  if (url && key) { // optional user key (OpenAI-compatible)
    try {
      const r = await fetchT(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: lsGet(LS.apiModel, 'gpt-4o-mini'), messages, temperature }) });
      if (r.ok) { const j = await r.json(); const t = j.choices?.[0]?.message?.content; if (t) return t; }
    } catch { /* fall through to keyless */ }
  }
  for (const m of [model, 'openai']) { // keyless Pollinations
    try {
      const r = await fetchT(POLL_TEXT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, messages, temperature, private: true }) });
      if (r.ok) { const j = await r.json(); const t = j.choices?.[0]?.message?.content; if (t) return t; }
    } catch { /* try next */ }
    if (m === 'openai') break;
  }
  throw new Error('offline');
}

/* ------------------------------ EXPERT ROUTER ------------------------------ */
function route(text, hasPhoto) {
  if (hasPhoto) return 'photo';
  if (/^(create|add|log|raise|new)\s+(an?\s+)?(observation|action|permit|ptw)\b/i.test(text)) return 'exec';
  if (/^(open|go to|navigate|show me|take me)\b|^(திற|போ)\b/i.test(text) && Object.keys(ROUTES).some((k) => text.toLowerCase().includes(k))) return 'nav';
  if (/(poster|banner|flyer|signage|safety slogan|பேனர்|போஸ்டர்)/i.test(text)) return 'poster';
  if (/(audit|review|check).{0,25}(report|dsr|daily|checklist)|daily (site )?report|\bDSR\b/i.test(text) || (text.length > 350 && /(permit|toolbox|ppe|manpower|workers|shift|site)/i.test(text) && /report|date|supervisor/i.test(text))) return 'audit';
  if (/(write|build|code|module|file|function|css|html|javascript|\.js\b|commit|deploy|hugging ?face)/i.test(text) && /(code|module|file|\.js|function|component|deploy|commit|script)/i.test(text)) return 'coder';
  if (/(iso|osha|factories act|bocw|adnoc|aramco|interview|standard|clause|regulation|study|explain|compare)/i.test(text)) return 'research';
  return 'general';
}
const EXPERT_LABEL = { photo: '📷 Hazard Scanner', exec: '⚡ Executor', nav: '🧭 Navigator', poster: '🎨 Poster Builder', audit: '🕵️ Report Auditor', coder: '💻 Autonomous Coder', research: '📚 Research Expert', general: '🧠 JARVIS Brain' };

/* ------------------------------ EXECUTOR / NAV ------------------------------ */
function goTo(text) {
  const k = Object.keys(ROUTES).find((x) => text.toLowerCase().includes(x));
  if (!k) return false;
  try { navigate(ROUTES[k].replace('#', '')); } catch { location.hash = ROUTES[k]; }
  return ROUTES[k];
}
async function doCreateObservation(o) {
  const rec = { title: o.title, description: o.description || o.title, severity: sevOf(o.severity), category: o.category || 'General',
    status: 'open', date: todayIso(), source: 'jarvis', photo: o.photo || null, regionId: safe(() => getActiveRegionId()) };
  const r = await createObservation(rec); emit('observation:created', r); return r;
}
async function doCreateAction(o) {
  const rec = { title: o.title, description: o.description || '', priority: sevOf(o.priority), status: 'open',
    dueDate: o.dueDate || addDaysIso(todayIso(), o.days ?? (sevOf(o.priority) === 'high' ? 1 : sevOf(o.priority) === 'medium' ? 7 : 30)),
    source: 'jarvis', regionId: safe(() => getActiveRegionId()) };
  const r = await createAction(rec); emit('action:created', r); return r;
}
function safe(f) { try { return f(); } catch { return null; } }
async function execCommand(text) {
  const m = text.match(/^(?:create|add|log|raise|new)\s+(?:an?\s+)?(observation|action|permit|ptw)\s*[:\-]?\s*(.*)$/i);
  const kind = m[1].toLowerCase(), body = (m[2] || '').trim() || 'Untitled (created by JARVIS)';
  if (kind === 'observation') { await doCreateObservation({ title: body.slice(0, 90), description: body }); return `✅ Observation created: **${esc(body.slice(0, 90))}**`; }
  if (kind === 'action') { await doCreateAction({ title: body.slice(0, 90), description: body, priority: 'medium' }); return `✅ Action created (due in 7 days): **${esc(body.slice(0, 90))}**`; }
  try { await saveOps(KINDS?.PERMITS || KINDS?.PTW || 'permits', { title: body, status: 'draft', createdAt: todayIso(), source: 'jarvis' }); } catch { /* ignore */ }
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
async function autoBuild(log) {
  const q = lsGet(LS.queue, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!q.length) return log('⚠️ Build queue empty. Open ⚙ → "Auto-build queue" and add lines like `js/modules/foo.js | what it should do`.');
  if (!lsGet(LS.hf)) return log('⚠️ Add your Hugging Face write token in ⚙ first.');
  for (const line of q) {
    const [path, ...d] = line.split('|'); const desc = d.join('|').trim() || 'Complete production module';
    log(`🔨 Building **${esc(path.trim())}** …`);
    try {
      const out = await llm([{ role: 'system', content: 'You are a senior JS engineer for NASUR HSE PWA (vanilla ES modules, IndexedDB via js/services/repo.js, offline-first, router mount(el,ctx)/render(ctx)). Output ONE complete self-contained file in a single code block. No explanations.' },
        { role: 'user', content: `File: ${path.trim()}\nSpec: ${desc}` }], { model: 'qwen-coder', temperature: 0.2 });
      const c = extractCode(out)[0]; if (!c) throw new Error('no code returned');
      await hfCommit([{ path: path.trim(), content: c.code }], `JARVIS auto-build ${path.trim()}`);
      log(`✅ Committed **${esc(path.trim())}** (${c.code.length} chars)`);
    } catch (e) { log(`❌ ${esc(path.trim())}: ${esc(e.message)}`); }
  }
  log('🏁 Auto-build finished. Refresh the Space after it rebuilds.');
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
  S.history.push(m); saveHist(); S.panels.forEach((p) => p.append(m)); return m;
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
#nj-fab{position:fixed;right:16px;bottom:84px;z-index:9998;background:linear-gradient(135deg,#00e5ff,#2979ff);color:#001;border:0;border-radius:28px;padding:12px 18px;font:700 15px system-ui;box-shadow:0 6px 24px rgba(0,229,255,.45);cursor:pointer}
#nj-drawer{position:fixed;inset:0 0 0 auto;width:min(480px,100vw);z-index:9999;background:#0b1220;color:#e8eefc;transform:translateX(105%);transition:transform .25s;display:flex;flex-direction:column;box-shadow:-8px 0 32px rgba(0,0,0,.5)}
#nj-drawer.open{transform:none}
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
#nj-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#000c;color:#fff;padding:9px 16px;border-radius:20px;z-index:10001;opacity:0;transition:.2s;pointer-events:none}#nj-toast.show{opacity:1}`;

const CHIPS = [
  ['🎨 Poster', 'Make a safety poster on work at height'], ['🕵️ Audit', 'Audit this daily report:\n'], ['🔥 Fire', 'Explain fire extinguisher classes'],
  ['📝 PTW', 'Explain permit to work steps'], ['🎤 Interview', 'HSE interview questions for a factory safety officer'], ['💻 Code', 'Write code for a new module: '],
  ['⚖ Laws', 'Factories Act key duties for occupier'], ['🧭 Audits', 'open audits'],
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
  <div class="nj-act"><button id="nj-save">💾 Save</button><button id="nj-build">🚀 Auto-Build Remaining Phases</button><button id="nj-clear">🗑 Clear chat</button></div>
  <div style="font-size:11px;color:#7f93c9;margin-top:8px">Keys stay only in this device's localStorage. Created by Nasur.</div>`;
  const v = (id) => $('#' + id, el);
  v('nj-l').value = lsGet(LS.lang, 'auto'); v('nj-v').value = lsGet(LS.voiceLang, 'en-IN'); v('nj-law').value = lsGet(LS.law, 'IN');
  v('nj-hf').value = lsGet(LS.hf); v('nj-repo').value = lsGet(LS.hfRepo, HF_DEFAULT_REPO);
  v('nj-au').value = lsGet(LS.apiUrl); v('nj-ak').value = lsGet(LS.apiKey); v('nj-am').value = lsGet(LS.apiModel); v('nj-q').value = lsGet(LS.queue);
  const saveAll = () => { lsSet(LS.lang, v('nj-l').value); lsSet(LS.voiceLang, v('nj-v').value); lsSet(LS.law, v('nj-law').value); lsSet(LS.hf, v('nj-hf').value.trim());
    lsSet(LS.hfRepo, v('nj-repo').value.trim() || HF_DEFAULT_REPO); lsSet(LS.apiUrl, v('nj-au').value.trim()); lsSet(LS.apiKey, v('nj-ak').value.trim()); lsSet(LS.apiModel, v('nj-am').value.trim()); lsSet(LS.queue, v('nj-q').value); };
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

/* ------------------------------ DRAWER API & EXPORTS ------------------------------ */
function ensureCss() { if ($('#nj-css')) return; const s = document.createElement('style'); s.id = 'nj-css'; s.textContent = CSS; document.head.appendChild(s); }
export function initJarvisDrawer() {
  if (S.inited) return; S.inited = true; ensureCss();
  const fab = document.createElement('button'); fab.id = 'nj-fab'; fab.textContent = '✦ JARVIS'; fab.onclick = toggleJarvisDrawer; document.body.appendChild(fab);
  const dr = document.createElement('div'); dr.id = 'nj-drawer'; document.body.appendChild(dr);
  const p = createPanel(dr); p.host = dr; S.panels.push(p);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) closeJarvisDrawer(); });
  window.addEventListener('nasur:jarvis', (e) => { openJarvisDrawer(); if (e.detail?.prompt) send(e.detail.prompt); });
  window.JARVIS = { open: openJarvisDrawer, close: closeJarvisDrawer, ask: send };
}
export function openJarvisDrawer() { if (!S.inited) initJarvisDrawer(); $('#nj-drawer').classList.add('open'); S.open = true; const f = $('#nj-fab'); if (f) f.style.display = 'none'; }
export function closeJarvisDrawer() { const d = $('#nj-drawer'); if (d) d.classList.remove('open'); S.open = false; const f = $('#nj-fab'); if (f) f.style.display = ''; }
export function toggleJarvisDrawer() { S.open ? closeJarvisDrawer() : openJarvisDrawer(); }

export function mount(el /*, ctx */) { // full-page JARVIS Studio
  ensureCss(); el.style.height = 'calc(100vh - 120px)'; const p = createPanel(el); p.host = el;
  $('.nj-x', el).style.display = 'none'; S.panels.push(p);
  return () => { S.panels = S.panels.filter((x) => x !== p); };
}
export function render(/* ctx */) { return '<div id="nj-page-host" style="height:calc(100vh - 120px)"></div><script>0</script>'; }
export function afterRender() { const h = $('#nj-page-host'); if (h) mount(h); }

export default { initJarvisDrawer, openJarvisDrawer, closeJarvisDrawer, toggleJarvisDrawer, mount, render, afterRender };
