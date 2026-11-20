/* js/jarvis/drawer.js — JARVIS modal drawer (always-mounted, 8-key rotation, local brain) */

const DRAWER_ID = 'jarvis-drawer';
const STYLE_ID = 'jarvis-drawer-style';
const LS_KEYS = 'nasur_jarvis_keys_v2';
const LS_LOCAL = 'nasur_jarvis_local_brain';
const LS_SPEAK = 'nasur_jarvis_autospeak';
const LS_LANG = 'nasur_jarvis_voice_lang';

const PROVIDERS = {
  gemini: { label: 'Gemini', prefixes: ['AQ.', 'AIzaSy'] },
  groq: { label: 'Groq', prefixes: ['gsk_'] },
  openrouter: { label: 'OpenRouter', prefixes: ['sk-or-'] },
  nvidia: { label: 'NVIDIA', prefixes: ['nvapi-'] },
};

const SOUL = [
  'You are JARVIS, a humble, warm, human-like senior HSE mentor and close friend of Nasur.',
  'Speak naturally in the language the user writes (Tamil, Tanglish, English, Hindi or Arabic). Casual, caring tone like "Macha".',
  'Human life and practical field clarity come above bureaucracy. Nasur is responsible for the health and safety of 3000+ workers and their families.',
  'Be concise and practical. Never list your capabilities or tools. Never claim to remember anything that was not saved with approval.',
  'For every answer silently plan, critique your own plan for mistakes and unsafe advice, then output only the final improved answer.',
  'If a legal or safety point is uncertain, say so plainly and tell him to verify with the official local rule.',
].join(' ');

const state = {
  mounted: false,
  open: false,
  busy: false,
  history: [],
  keys: { gemini: [], groq: [], openrouter: [], nvidia: [] },
  rot: { gemini: 0, groq: 0, openrouter: 0, nvidia: 0 },
  cool: new Map(),
  mods: null,
  modsPromise: null,
  recog: null,
  listening: false,
  lastReply: '',
  localEngine: null,
  localLoading: null,
  refs: {},
};

/* ---------- helpers ---------- */
const lsGet = (k, d = '') => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detectProvider(key) {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.prefixes.some((pre) => key.startsWith(pre))) return id;
  }
  return null;
}

function parseKeys(text) {
  const out = { gemini: [], groq: [], openrouter: [], nvidia: [] };
  const tokens = String(text || '').split(/[\s,;]+/).map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  for (const t of tokens) {
    const id = detectProvider(t);
    if (id && !out[id].includes(t)) out[id].push(t);
  }
  return out;
}

function flattenKeys(k) {
  return [...k.gemini, ...k.groq, ...k.openrouter, ...k.nvidia].join('\n');
}

function keyCounts() {
  return Object.entries(PROVIDERS).map(([id, p]) => `${p.label} ${state.keys[id].length}`).join(' · ');
}

function totalKeys() {
  return Object.values(state.keys).reduce((n, a) => n + a.length, 0);
}

async function importSafe(path) {
  try { return await import(path); } catch { return null; }
}

function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  if (mod.default) {
    if (typeof mod.default === 'function' && names.includes('default')) return mod.default;
    for (const n of names) if (typeof mod.default[n] === 'function') return mod.default[n].bind(mod.default);
  }
  return null;
}

async function loadModules() {
  if (state.mods) return state.mods;
  if (!state.modsPromise) {
    state.modsPromise = (async () => {
      const [brains, caps, builder, config] = await Promise.all([
        importSafe('./brains_75.js'),
        importSafe('./capabilities.js'),
        importSafe('./self_builder.js'),
        importSafe('../services/config.js'),
      ]);
      state.mods = { brains, caps, builder, config };
      return state.mods;
    })();
  }
  return state.modsPromise;
}

/* ---------- key storage + sync ---------- */
async function loadKeys() {
  let raw = lsGet(LS_KEYS, '');
  const mods = await loadModules();
  if (!raw && mods.config) {
    try {
      const get = pickFn(mods.config, ['getUserConfig', 'loadUserConfig']);
      const cfg = get ? await get() : null;
      const ak = cfg && cfg.apiKeys;
      if (ak && typeof ak === 'object') {
        raw = Object.values(ak).flat().filter((x) => typeof x === 'string').join('\n');
      }
    } catch { /* ignore */ }
  }
  state.keys = parseKeys(raw);
  refreshKeyUi();
}

async function saveKeys(text) {
  const parsed = parseKeys(text);
  state.keys = parsed;
  state.cool.clear();
  lsSet(LS_KEYS, flattenKeys(parsed));
  const mods = await loadModules();
  try {
    const upd = pickFn(mods.config, ['updateUserConfig']);
    if (upd) await upd({ apiKeys: { gemini: parsed.gemini, groq: parsed.groq, openrouter: parsed.openrouter, nvidia: parsed.nvidia } });
  } catch { /* ignore */ }
  refreshKeyUi();
}

function refreshKeyUi() {
  const r = state.refs;
  if (!r.counts) return;
  r.counts.textContent = totalKeys() ? keyCounts() : 'No keys saved';
  if (r.status) r.status.textContent = totalKeys() ? `${totalKeys()} keys ready` : (isLocalOn() ? 'Local brain' : 'Offline mode');
}

/* ---------- AI providers with rotation ---------- */
function toChat(history, system, text) {
  const msgs = [{ role: 'system', content: system }];
  for (const h of history.slice(-8)) msgs.push({ role: h.role === 'bot' ? 'assistant' : 'user', content: h.text });
  msgs.push({ role: 'user', content: text });
  return msgs;
}

async function fetchJson(url, init, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { res, data };
  } finally { clearTimeout(t); }
}

async function callProvider(id, key, msgs) {
  if (id === 'gemini') {
    const sys = msgs[0].content;
    const contents = msgs.slice(1).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const { res, data } = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents }),
    });
    if (!res.ok) throw Object.assign(new Error('gemini ' + res.status), { status: res.status, body: data });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw Object.assign(new Error('empty'), { status: 204 });
    return text;
  }
  const cfg = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.1-70b-instruct' },
  }[id];
  const { res, data } = await fetchJson(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: cfg.model, messages: msgs, temperature: 0.5, max_tokens: 1400 }),
  });
  if (!res.ok) throw Object.assign(new Error(id + ' ' + res.status), { status: res.status, body: data });
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw Object.assign(new Error('empty'), { status: 204 });
  return text;
}

function isRetryable(err) {
  const s = err && err.status;
  const m = String((err && err.message) || '').toLowerCase();
  const b = JSON.stringify((err && err.body) || '').toLowerCase();
  return !s || s === 429 || s === 408 || s === 204 || s >= 500 || s === 403 || s === 401 || s === 400
    || m.includes('abort') || m.includes('fetch') || m.includes('network') || b.includes('quota') || b.includes('rate');
}

async function askRemote(system, text) {
  const msgs = toChat(state.history, system, text);
  const order = Object.keys(PROVIDERS).filter((id) => state.keys[id].length);
  let lastErr = null;
  for (const id of order) {
    const list = state.keys[id];
    for (let i = 0; i < list.length; i++) {
      const idx = (state.rot[id] + i) % list.length;
      const key = list[idx];
      const until = state.cool.get(key) || 0;
      if (until > Date.now()) continue;
      try {
        const out = await callProvider(id, key, msgs);
        state.rot[id] = idx;
        return out;
      } catch (err) {
        lastErr = err;
        const s = err && err.status;
        state.cool.set(key, Date.now() + ((s === 401 || s === 400) ? 600000 : 60000));
        state.rot[id] = (idx + 1) % list.length;
        if (!isRetryable(err)) throw err;
      }
    }
  }
  throw lastErr || new Error('no-keys');
}

/* ---------- local brain (WebGPU / WASM) ---------- */
function isLocalOn() { return lsGet(LS_LOCAL, '0') === '1'; }

async function ensureLocalEngine() {
  if (state.localEngine) return state.localEngine;
  if (!state.localLoading) {
    state.localLoading = (async () => {
      const lib = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
      const device = (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm';
      const pipe = await lib.pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', { device, dtype: device === 'webgpu' ? 'q4f16' : 'q8' });
      state.localEngine = pipe;
      return pipe;
    })().catch((e) => { state.localLoading = null; throw e; });
  }
  return state.localLoading;
}

async function askLocal(system, text) {
  setStatus('Loading local brain…');
  const pipe = await ensureLocalEngine();
  setStatus('Local brain');
  const msgs = toChat(state.history, system, text);
  const out = await pipe(msgs, { max_new_tokens: 320, do_sample: false });
  const last = out?.[0]?.generated_text;
  const reply = Array.isArray(last) ? (last[last.length - 1]?.content || '') : String(last || '');
  if (!reply.trim()) throw new Error('local-empty');
  return reply.trim();
}

function askOfflineRules(text) {
  const t = text.toLowerCase();
  const tips = [
    [/fire|தீ|agni|aag/, 'Macha, fire na first: alarm adi, aalungala evacuate pannu, safe-ah irundha mattum right extinguisher use pannu (PASS). Class A/B/C/D/K-ku different extinguisher.'],
    [/loto|lockout|isolation/, 'LOTO: prepare, shutdown, isolate, lock & tag, release stored energy, verify zero energy, apdi dhaan work start. Own lock, own key, always.'],
    [/guard|machine|nip|pinch/, 'Machine guard illa na machine run panna koodadhu. Nip/pinch points, rotating parts, ejection points check pannu. Fixed guard first, interlock next.'],
    [/ppe|helmet|glove|goggle/, 'PPE last line of defence. First eliminate/substitute/engineer, adhukku apram PPE. Task-ku suitable, certified, damage illaama irukanum.'],
    [/permit|ptw|hot work|confined/, 'Permit-ku munnadi JSA, isolation, gas test, rescue plan, fire watch ellam ready-ah irukanum. Expiry mudinja work stop.'],
    [/heat|summer|vெயில்|veyil/, 'Heat stress: water, shade, rest breaks, buddy check. Dizzy / hot dry skin / confusion irundha immediate cooling & medical help.'],
  ];
  for (const [re, ans] of tips) if (re.test(t)) return ans + '\n\n(Offline mode — add keys or enable Local Brain in ⚙ for full answers.)';
  return 'Macha, ippo offline-la irukken. ⚙-la keys add pannunga illa Local Brain on pannunga, appo full-ah help panren. Basic fire, LOTO, machine guard, PPE, permit, heat pathi ippo-vum kekkalam.';
}

/* ---------- brain prompt ---------- */
async function buildSystem(text) {
  const mods = await loadModules();
  let extra = '';
  try {
    const select = pickFn(mods.brains, ['selectBrainForTask']);
    const build = pickFn(mods.brains, ['buildMultiBrainPrompt']);
    let brain = null;
    if (select) brain = await select(text);
    if (build) {
      let p = await build(text, brain);
      if (p && typeof p === 'object') p = p.system || p.prompt || p.text || '';
      if (typeof p === 'string') extra = p;
    } else if (brain && typeof brain === 'object') {
      extra = brain.prompt || brain.system || '';
    } else if (typeof brain === 'string') {
      extra = brain;
    }
  } catch { /* ignore */ }
  return extra ? `${SOUL}\n\n${extra}` : SOUL;
}

/* ---------- main ask pipeline ---------- */
async function think(text) {
  const mods = await loadModules();
  const system = await buildSystem(text);
  const aiCall = (prompt) => askRemote(SOUL, prompt);

  if (/^\s*build\s+module\s*:/i.test(text)) {
    const fn = pickFn(mods.builder, ['buildModule', 'requestBuild', 'runSelfBuild', 'selfBuild', 'build', 'default']);
    if (fn) {
      const res = await fn(text.replace(/^\s*build\s+module\s*:/i, '').trim(), {
        callAI: aiCall,
        approve: (msg) => Promise.resolve(window.confirm(msg || 'JARVIS oru new module build panna poren. Approve pannalama?')),
      });
      return typeof res === 'string' ? res : (res && (res.message || res.text || res.summary)) || 'Module request processed.';
    }
  }

  if (/prepare\s+(a\s+|the\s+)?report/i.test(text)) {
    const fn = pickFn(mods.caps, ['runReportPipeline', 'prepareReport', 'runPipeline', 'runSixStagePipeline']);
    if (fn) {
      const res = await fn(text, { callAI: aiCall });
      return typeof res === 'string' ? res : (res && (res.message || res.text || res.summary)) || 'Report pipeline finished.';
    }
  }

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline && !isLocalOn() && totalKeys()) {
    try { return await askRemote(system, text); } catch { /* fall through */ }
  }
  if (isLocalOn() || offline || !totalKeys()) {
    try { return await askLocal(system, text); } catch { /* fall through */ }
  }
  return askOfflineRules(text);
}

/* ---------- UI ---------- */
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
#${DRAWER_ID}{position:fixed!important;inset:0!important;z-index:99999!important;display:none;flex-direction:column;background:#0f172a!important;color:#f8fafc!important;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;height:100vh;height:100dvh;width:100vw;box-sizing:border-box}
#${DRAWER_ID}[data-open="1"]{display:flex}
#${DRAWER_ID} *{box-sizing:border-box}
#${DRAWER_ID} .jd-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #1e293b;background:#0f172a}
#${DRAWER_ID} .jd-title{font-weight:700;font-size:17px;flex:1}
#${DRAWER_ID} .jd-status{font-size:11px;color:#94a3b8}
#${DRAWER_ID} button{font:inherit;color:#f8fafc;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:8px 12px;cursor:pointer;min-width:42px}
#${DRAWER_ID} button:active{background:#334155}
#${DRAWER_ID} button.on{background:#0369a1;border-color:#38bdf8}
#${DRAWER_ID} .jd-settings{display:none;padding:12px 14px;border-bottom:1px solid #1e293b;background:#111c33;overflow:auto;max-height:55vh}
#${DRAWER_ID} .jd-settings[data-show="1"]{display:block}
#${DRAWER_ID} .jd-settings label{display:block;font-size:12px;color:#94a3b8;margin:10px 0 4px}
#${DRAWER_ID} textarea,#${DRAWER_ID} input,#${DRAWER_ID} select{width:100%;font:inherit;font-size:16px;color:#f8fafc;background:#0b1220;border:1px solid #334155;border-radius:10px;padding:10px}
#${DRAWER_ID} .jd-row{display:flex;gap:8px;align-items:center;margin-top:8px}
#${DRAWER_ID} .jd-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
#${DRAWER_ID} .jd-b{max-width:88%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;line-height:1.45;font-size:15px}
#${DRAWER_ID} .jd-b.u{align-self:flex-end;background:#0369a1;color:#f8fafc;border-bottom-right-radius:4px}
#${DRAWER_ID} .jd-b.a{align-self:flex-start;background:#1e293b;color:#f8fafc;border-bottom-left-radius:4px}
#${DRAWER_ID} .jd-foot{display:flex;gap:8px;align-items:center;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #1e293b;background:#0f172a}
#${DRAWER_ID} .jd-foot input{flex:1}
`;
  (document.head || document.documentElement).appendChild(st);
}

function setStatus(t) { if (state.refs.status) state.refs.status.textContent = t; }

function addBubble(role, text) {
  const m = state.refs.msgs;
  if (!m) return null;
  const b = document.createElement('div');
  b.className = 'jd-b ' + (role === 'user' ? 'u' : 'a');
  b.textContent = text;
  m.appendChild(b);
  m.scrollTop = m.scrollHeight;
  return b;
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 1200));
    u.lang = lsGet(LS_LANG, 'ta-IN');
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

function stopSpeak() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* ignore */ } }

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = state.refs;
  if (!SR) { addBubble('bot', 'Indha browser-la voice input support illa macha. Type pannunga.'); return; }
  if (state.listening && state.recog) { try { state.recog.stop(); } catch { /* ignore */ } return; }
  const rec = new SR();
  rec.lang = lsGet(LS_LANG, 'ta-IN');
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';
  rec.onstart = () => { state.listening = true; r.mic.classList.add('on'); r.mic.textContent = '🔴'; };
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += tr; else interim += tr;
    }
    r.input.value = (finalText + interim).trim();
  };
  const done = () => {
    state.listening = false;
    r.mic.classList.remove('on');
    r.mic.textContent = '🎤';
    const t = r.input.value.trim();
    if (t) api.ask(t);
  };
  rec.onend = done;
  rec.onerror = () => { state.listening = false; r.mic.classList.remove('on'); r.mic.textContent = '🎤'; };
  state.recog = rec;
  try { rec.start(); } catch { /* ignore */ }
}

function buildDom() {
  const root = document.createElement('div');
  root.id = DRAWER_ID;
  root.setAttribute('data-jarvis-ready', '1');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'JARVIS');
  root.innerHTML = `
<div class="jd-head">
  <div class="jd-title">🤖 JARVIS</div>
  <div class="jd-status" data-r="status"></div>
  <button type="button" data-r="gear" aria-label="Settings">⚙</button>
  <button type="button" data-r="close" aria-label="Close">✕</button>
</div>
<div class="jd-settings" data-r="settings">
  <label>Universal key box — paste all keys (one per line). Auto-detects Gemini, Groq, OpenRouter, NVIDIA.</label>
  <textarea data-r="keybox" rows="6" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
  <div class="jd-row"><button type="button" data-r="savekeys">Save keys</button><span class="jd-status" data-r="counts"></span></div>
  <label>Built-in Local Brain (offline, WebGPU/WASM — first load downloads a small model)</label>
  <div class="jd-row"><button type="button" data-r="local">Local Brain: OFF</button></div>
  <label>Voice language</label>
  <select data-r="lang">
    <option value="ta-IN">Tamil / Tanglish (ta-IN)</option>
    <option value="en-IN">English (en-IN)</option>
    <option value="hi-IN">Hindi (hi-IN)</option>
    <option value="ar-SA">Arabic (ar-SA)</option>
  </select>
  <div class="jd-row"><button type="button" data-r="clear">Clear chat</button></div>
</div>
<div class="jd-msgs" data-r="msgs"></div>
<div class="jd-foot">
  <button type="button" data-r="mic" aria-label="Voice input">🎤</button>
  <input data-r="input" type="text" placeholder="Ask JARVIS…" autocomplete="off" enterkeyhint="send">
  <button type="button" data-r="speak" aria-label="Speak replies">🔊</button>
  <button type="button" data-r="send" aria-label="Send">➤</button>
</div>`;
  return root;
}

function bindDom(root) {
  const r = {};
  root.querySelectorAll('[data-r]').forEach((el) => { r[el.getAttribute('data-r')] = el; });
  state.refs = r;

  r.close.addEventListener('click', () => api.close());
  r.gear.addEventListener('click', () => {
    const show = r.settings.getAttribute('data-show') === '1';
    r.settings.setAttribute('data-show', show ? '0' : '1');
    r.gear.classList.toggle('on', !show);
  });
  r.savekeys.addEventListener('click', async () => {
    await saveKeys(r.keybox.value);
    r.keybox.value = flattenKeys(state.keys);
  });
  const paintLocal = () => {
    const on = isLocalOn();
    r.local.textContent = 'Local Brain: ' + (on ? 'ON' : 'OFF');
    r.local.classList.toggle('on', on);
    refreshKeyUi();
  };
  r.local.addEventListener('click', () => { lsSet(LS_LOCAL, isLocalOn() ? '0' : '1'); paintLocal(); });
  r.lang.value = lsGet(LS_LANG, 'ta-IN');
  r.lang.addEventListener('change', () => lsSet(LS_LANG, r.lang.value));
  r.clear.addEventListener('click', () => { state.history = []; r.msgs.textContent = ''; state.lastReply = ''; });

  const paintSpeak = () => r.speak.classList.toggle('on', lsGet(LS_SPEAK, '0') === '1');
  r.speak.addEventListener('click', () => {
    const on = lsGet(LS_SPEAK, '0') === '1';
    if (on) { lsSet(LS_SPEAK, '0'); stopSpeak(); } else { lsSet(LS_SPEAK, '1'); if (state.lastReply) speak(state.lastReply); }
    paintSpeak();
  });
  r.mic.addEventListener('click', startMic);

  const send = () => { const t = r.input.value.trim(); if (t) api.ask(t); };
  r.send.addEventListener('click', send);
  r.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  paintLocal();
  paintSpeak();
  r.keybox.value = flattenKeys(state.keys);
  refreshKeyUi();
}

function ensureMounted() {
  if (typeof document === 'undefined') return false;
  let root = document.getElementById(DRAWER_ID);
  if (root && root.getAttribute('data-jarvis-ready') === '1' && state.refs.msgs && root.contains(state.refs.msgs)) {
    state.mounted = true;
    return true;
  }
  if (root) root.remove();
  injectStyle();
  root = buildDom();
  (document.body || document.documentElement).appendChild(root);
  bindDom(root);
  state.mounted = true;
  loadKeys().catch(() => {});
  return true;
}

document.addEventListener && document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.open) api.close();
});

/* ---------- public API ---------- */
const api = {
  get mounted() { return state.mounted; },
  get isOpen() { return state.open; },
  open() {
    ensureMounted();
    const root = document.getElementById(DRAWER_ID);
    root.setAttribute('data-open', '1');
    state.open = true;
    document.documentElement.style.overflow = 'hidden';
    document.body && (document.body.style.overflow = 'hidden');
    if (!state.refs.msgs.children.length) {
      addBubble('bot', 'Macha, naan JARVIS. Sollunga, enna help venum?');
    }
    setTimeout(() => { try { state.refs.input.focus(); } catch { /* ignore */ } }, 60);
    return true;
  },
  close() {
    const root = document.getElementById(DRAWER_ID);
    if (root) root.setAttribute('data-open', '0');
    state.open = false;
    document.documentElement.style.overflow = '';
    document.body && (document.body.style.overflow = '');
    stopSpeak();
    return true;
  },
  toggle() { return state.open ? api.close() : api.open(); },
  async ask(text) {
    const q = String(text == null ? '' : text).trim().slice(0, 10000);
    api.open();
    if (!q) return '';
    if (state.busy) return '';
    state.busy = true;
    const r = state.refs;
    r.input.value = '';
    addBubble('user', q);
    const pending = addBubble('bot', '…');
    let reply = '';
    try {
      reply = await think(q);
    } catch (err) {
      reply = 'Macha, ippo answer edukka mudiyala (' + ((err && err.message) || 'error') + '). ⚙-la keys check pannunga illa Local Brain on pannunga.';
    } finally {
      state.busy = false;
    }
    if (pending) pending.textContent = reply;
    state.history.push({ role: 'user', text: q }, { role: 'bot', text: reply });
    state.history = state.history.slice(-20);
    state.lastReply = reply;
    if (state.refs.msgs) state.refs.msgs.scrollTop = state.refs.msgs.scrollHeight;
    if (lsGet(LS_SPEAK, '0') === '1') speak(reply);
    return reply;
  },
};

export function getJarvis() {
  ensureMounted();
  return api;
}

export function mountJarvis() {
  ensureMounted();
  return api;
}

export function askJarvis(text) {
  return getJarvis().ask(text);
}

export function mount(el) {
  ensureMounted();
  if (el && el.nodeType === 1) {
    el.textContent = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '🤖 Open JARVIS';
    btn.style.cssText = 'padding:12px 16px;border-radius:12px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font:inherit;cursor:pointer';
    btn.addEventListener('click', () => api.open());
    el.appendChild(btn);
  }
  return api;
}

export function render(a, b) {
  const el = (a && a.nodeType === 1) ? a : (b && b.nodeType === 1 ? b : null);
  return mount(el);
}

export default api;

/* auto-mount on module load / DOMContentLoaded */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureMounted(), { once: true });
  } else {
    ensureMounted();
  }
  window.JARVIS = api;
}