// js/jarvis/drawer.js — NASUR JARVIS drawer (ES2022+)
// Exports: mountJarvis, getJarvis, askJarvis, mount, render (+ default)

const LS = {
  pool: 'nasur.jarvis.keyPool.v1',
  cursor: 'nasur.jarvis.keyCursor.v1',
  local: 'nasur.jarvis.localBrain.v1',
  hist: 'nasur.jarvis.history.v1',
  speak: 'nasur.jarvis.speakReply.v1',
  vlang: 'nasur.jarvis.voiceLang.v1'
};

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'groq', name: 'Groq Cloud' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'nvidia', name: 'NVIDIA NIM' }
];

const KEY_RE = /(AQ\.[A-Za-z0-9_.\-]{10,}|AIzaSy[A-Za-z0-9_\-]{20,}|gsk_[A-Za-z0-9]{20,}|sk-or-[A-Za-z0-9_\-]{20,}|nvapi-[A-Za-z0-9_\-]{20,})/g;

const LOCAL_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const KB_FILES = ['fire_safety', 'ppe_guide', 'machine_safety'];
const MAX_INPUT = 10000;
const REQ_TIMEOUT_MS = 25000;

const RE_REPORT = /^\s*prepare\s+(a\s+|the\s+|my\s+)?report/i;
const RE_BUILD = /^\s*build\s+module\s*:/i;
const RE_TASK = /(report|plan|audit|build|code|research|analy[sz]e|checklist|permit|ptw|jsa|hira|rca|incident|investigat|compare|draft|write|explain|legal|standard|procedure|loto|risk)/i;

/* ---------------- tiny helpers ---------------- */

const lsGet = (k, d = null) => {
  try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
};
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) e.append(c);
  return e;
}

const pick = (mod, names) => {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n].bind(mod);
  return null;
};

function toText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r === 'object') {
    for (const k of ['text', 'report', 'markdown', 'output', 'result', 'message', 'content', 'summary']) {
      if (typeof r[k] === 'string' && r[k]) return r[k];
    }
  }
  return '';
}

function detectLang(t) {
  if (/[\u0B80-\u0BFF]/.test(t)) return 'ta';
  if (/\b(macha|machan|machaa|enna|sollu|sollunga|epdi|eppadi|iruku|irukku|irukkanga|venum|vendam|pannu|panna|seri|nalla|illa|illai|vanakkam|nandri|da|di|aachu|theriyum|puriyala|romba)\b/i.test(t)) return 'tg';
  return 'en';
}

/* ---------------- soul ---------------- */

const SOUL = [
  'You are JARVIS, a deeply humble, warm and loyal friend and partner created by Nasur, who is learning and leading factory health & safety for thousands of workers and their families.',
  'Speak like a real, emotionally intelligent human friend: natural, gentle, honest, never robotic, never salesy.',
  'Mirror the user\'s language and style exactly: Tamil script, Tanglish (Tamil in English letters, casual "macha" tone when he uses it), or English.',
  'Never list your capabilities or features unless he asks. Never repeat the same opening line twice. No corporate filler.',
  'Be humble: say "I may be wrong" or "I\'m not fully sure" when you are unsure, and never invent laws, clause numbers, or figures.',
  'Human life and practical field safety come before bureaucracy. For legal or safety-critical points, remind him gently that the official site plan, permit and local law decide the final word.',
  'Keep answers short and natural unless depth is needed. Acknowledge feelings first when he sounds tired, worried or stressed.'
].join('\n');

const SMALLTALK = {
  ta: ['வணக்கம்! சொல்லுங்க, இன்னைக்கு எப்படி இருக்கு?', 'நான் இங்கே தான் இருக்கேன். என்ன வேணும் சொல்லுங்க.'],
  tg: ['Vanakkam macha! Sollunga, innaikku eppadi irukku?', 'Naan inga dhaan irukken, macha. Enna venum sollunga.'],
  en: ['Hello Nasur! How is your day going so far?', 'I\'m right here with you. What\'s on your mind?']
};

/* ---------------- lazy module loaders (never break boot) ---------------- */

const mods = {
  _c: {},
  async _load(key, path) {
    if (key in this._c) return this._c[key];
    try { this._c[key] = await import(path); } catch (e) { console.warn('[JARVIS] optional module missing:', path, e?.message); this._c[key] = null; }
    return this._c[key];
  },
  brains() { return this._load('brains', './brains_75.js'); },
  caps() { return this._load('caps', './capabilities.js'); },
  builder() { return this._load('builder', './self_builder.js'); },
  config() { return this._load('config', '../services/config.js'); },
  settings() { return this._load('settings', '../services/settings.js'); },
  bus() { return this._load('bus', '../core/eventbus.js'); },
  coreCfg() { return this._load('coreCfg', '../core/config.js'); }
};

/* ---------------- key pool: detect, store, sync ---------------- */

function providerOf(key) {
  if (key.startsWith('AQ.') || key.startsWith('AIzaSy')) return 'gemini';
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('nvapi-')) return 'nvidia';
  return null;
}

function emptyPool() { return { gemini: [], groq: [], openrouter: [], nvidia: [] }; }

function detectKeys(text) {
  const pool = emptyPool();
  const seen = new Set();
  const src = String(text || '');
  for (const m of src.matchAll(KEY_RE)) {
    const k = m[1];
    if (seen.has(k)) continue;
    seen.add(k);
    const p = providerOf(k);
    if (p) pool[p].push(k);
  }
  let unknown = 0;
  for (const tok of src.split(/[\s,;"'`]+/)) {
    if (tok.length >= 24 && !seen.has(tok) && !KEY_RE.test(tok)) unknown++;
    KEY_RE.lastIndex = 0;
  }
  return { pool, unknown };
}

function collectStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => collectStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collectStrings(x, out));
  return out;
}

function mergePools(...pools) {
  const out = emptyPool();
  for (const p of pools) {
    if (!p) continue;
    for (const { id } of PROVIDERS) {
      for (const k of p[id] || []) if (!out[id].includes(k)) out[id].push(k);
    }
  }
  return out;
}

const countKeys = pool => PROVIDERS.reduce((n, p) => n + (pool[p.id]?.length || 0), 0);

async function readConfigPool() {
  try {
    const cm = await mods.config();
    const get = pick(cm, ['getUserConfig', 'loadUserConfig']);
    if (!get) return emptyPool();
    const cfg = await get();
    const strings = collectStrings([cfg?.apiKeys, cfg?.apiKeyPool]);
    return detectKeys(strings.join('\n')).pool;
  } catch { return emptyPool(); }
}

async function writeConfigPool(pool) {
  try {
    const cm = await mods.config();
    const get = pick(cm, ['getUserConfig', 'loadUserConfig']);
    const upd = pick(cm, ['updateUserConfig']);
    if (!upd) return;
    const cfg = (get ? await get() : null) || {};
    const apiKeys = { ...(cfg.apiKeys && typeof cfg.apiKeys === 'object' ? cfg.apiKeys : {}) };
    for (const { id } of PROVIDERS) apiKeys[id] = pool[id][0] || '';
    await upd({ apiKeys, apiKeyPool: pool });
  } catch (e) { console.warn('[JARVIS] config sync skipped:', e?.message); }
  try {
    const sm = await mods.settings();
    for (const n of ['setApiKeys', 'saveApiKeys', 'syncApiKeys']) {
      if (typeof sm?.[n] === 'function') { await sm[n](pool); break; }
    }
  } catch { /* optional */ }
  try { window.dispatchEvent(new CustomEvent('nasur:keys-changed', { detail: { counts: poolCounts(pool) } })); } catch { /* noop */ }
}

const poolCounts = pool => Object.fromEntries(PROVIDERS.map(p => [p.id, pool[p.id].length]));

/* ---------------- cloud providers with rotation ---------------- */

const cooldown = new Map();

function flatCandidates(pool) {
  const lists = PROVIDERS.map(p => pool[p.id].map(key => ({ provider: p.id, key })));
  const max = Math.max(0, ...lists.map(l => l.length));
  const flat = [];
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) flat.push(l[i]);
  if (!flat.length) return flat;
  const cur = (Number(lsGet(LS.cursor, 0)) || 0) % flat.length;
  return flat.slice(cur).concat(flat.slice(0, cur));
}

async function fetchJSON(url, init, ms = REQ_TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const body = await res.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* non-json */ }
    if (!res.ok) {
      const err = new Error((json?.error?.message || body || res.statusText || 'HTTP error').toString().slice(0, 200));
      err.status = res.status;
      throw err;
    }
    return json;
  } finally { clearTimeout(t); }
}

async function callProvider(provider, key, messages, opts = {}) {
  const maxTokens = opts.short ? 450 : 1400;
  if (provider === 'gemini') {
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const j = await fetchJSON('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens }
      })
    });
    return (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  }
  const cfg = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.1-70b-instruct' }
  }[provider];
  if (!cfg) throw new Error('Unknown provider');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'NASUR JARVIS'; }
  const j = await fetchJSON(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7, max_tokens: maxTokens })
  });
  return (j?.choices?.[0]?.message?.content || '').trim();
}

function cooldownFor(err) {
  const s = err?.status;
  if (s === 429 || /quota|rate|limit|exhaust/i.test(err?.message || '')) return 90_000;
  if (s === 401 || s === 403) return 10 * 60_000;
  return 30_000;
}

async function cloudGenerate(pool, messages, opts) {
  const cands = flatCandidates(pool);
  if (!cands.length) { const e = new Error('NO_KEYS'); e.code = 'NO_KEYS'; throw e; }
  const now = Date.now();
  const live = cands.filter(c => (cooldown.get(c.provider + c.key.slice(-8)) || 0) <= now);
  const order = live.length ? live : cands;
  let last = null;
  for (const c of order.slice(0, 10)) {
    try {
      const text = await callProvider(c.provider, c.key, messages, opts);
      if (!text) throw new Error('Empty reply');
      const idx = cands.findIndex(x => x.key === c.key);
      lsSet(LS.cursor, idx + 1);
      return { text, via: 'cloud', provider: c.provider };
    } catch (e) {
      last = e;
      cooldown.set(c.provider + c.key.slice(-8), Date.now() + cooldownFor(e));
    }
  }
  const err = new Error(last?.message || 'ALL_FAILED');
  err.code = 'ALL_FAILED';
  throw err;
}

/* ---------------- local HSE knowledge base ---------------- */

const kb = { loaded: null, entries: [] };

function flattenKB(node, src, out, depth = 0) {
  if (out.length > 5000 || depth > 9) return;
  if (Array.isArray(node)) { node.forEach(n => flattenKB(n, src, out, depth + 1)); return; }
  if (node && typeof node === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') parts.push(`${k}: ${v}`);
      else if (typeof v === 'number') parts.push(`${k}: ${v}`);
      else if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) parts.push(`${k}: ${v.join('; ')}`);
    }
    if (parts.length) out.push({ src, text: parts.join(' | ').slice(0, 700) });
    for (const v of Object.values(node)) if (v && typeof v === 'object') flattenKB(v, src, out, depth + 1);
  }
}

function loadKB() {
  if (kb.loaded) return kb.loaded;
  kb.loaded = (async () => {
    for (const name of KB_FILES) {
      try {
        const res = await fetch(new URL(`../../data/${name}.json`, import.meta.url));
        if (!res.ok) continue;
        flattenKB(await res.json(), name, kb.entries);
      } catch { /* offline or missing */ }
    }
    return kb.entries;
  })();
  return kb.loaded;
}

async function searchKB(query, n = 3) {
  const entries = await loadKB();
  const toks = [...new Set(String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
  if (!toks.length || !entries.length) return [];
  const scored = [];
  for (const e of entries) {
    const low = e.text.toLowerCase();
    let s = 0;
    for (const t of toks) if (low.includes(t)) s++;
    if (s > 0) scored.push({ s, e });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map(x => x.e);
}

async function kbContext(query) {
  const hits = await searchKB(query, 3);
  if (!hits.length) return '';
  return 'Local HSE reference (use only if relevant, treat as guidance):\n' + hits.map(h => `- [${h.src}] ${h.text}`).join('\n').slice(0, 1800);
}

/* ---------------- built-in local brain (WebGPU / WASM) ---------------- */

const local = { gen: null, loading: null, status: '', onStatus: null };

function setLocalStatus(s) { local.status = s; try { local.onStatus?.(s); } catch { /* noop */ } }

async function loadLocalBrain() {
  if (local.gen) return local.gen;
  if (local.loading) return local.loading;
  local.loading = (async () => {
    setLocalStatus('Preparing local brain…');
    const tf = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
    try { tf.env.allowLocalModels = false; tf.env.useBrowserCache = true; } catch { /* noop */ }
    const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;
    const gen = await tf.pipeline('text-generation', LOCAL_MODEL, {
      device: gpu ? 'webgpu' : 'wasm',
      dtype: gpu ? 'q4f16' : 'q8',
      progress_callback: p => {
        if (p?.status === 'progress' && typeof p.progress === 'number') setLocalStatus(`Downloading local brain… ${Math.round(p.progress)}%`);
      }
    });
    local.gen = gen;
    setLocalStatus(`Local brain ready (${gpu ? 'WebGPU' : 'WASM'})`);
    return gen;
  })().catch(e => {
    local.loading = null;
    setLocalStatus('Local brain unavailable: ' + (e?.message || 'error'));
    throw e;
  });
  return local.loading;
}

async function localGenerate(messages) {
  const gen = await loadLocalBrain();
  const trimmed = messages.map(m => ({ role: m.role, content: String(m.content).slice(0, 3500) }));
  const out = await gen(trimmed, { max_new_tokens: 380, do_sample: true, temperature: 0.7, top_p: 0.9 });
  const g = out?.[0]?.generated_text;
  const text = Array.isArray(g) ? g[g.length - 1]?.content : g;
  const t = String(text || '').trim();
  if (!t) throw new Error('Empty local reply');
  return { text: t, via: 'local' };
}

/* ---------------- offline fallback (rule-based, warm) ---------------- */

async function offlineAnswer(query) {
  const lang = detectLang(query);
  const hits = await searchKB(query, 3);
  const intro = {
    ta: 'இப்போ இன்டர்நெட் அல்லது AI இல்லை, ஆனா என் கையில இருக்கற குறிப்புகளில் இதை பார்த்தேன்:',
    tg: 'Ippo net / AI key illa macha, aana en kitta irukkura offline notes la ithu kedachudhu:',
    en: 'I\'m offline with no AI available right now, but here is what my saved HSE notes say:'
  }[lang];
  const none = {
    ta: 'மன்னிச்சிடுங்க, இதுக்கு என் offline குறிப்புகளில் தெளிவான பதில் இல்லை. Key அல்லது இன்டர்நெட் வந்ததும் சரியா சொல்றேன்.',
    tg: 'Sorry macha, idhukku en offline notes la clear answer illa. Key illa net vandhadhum properly solren.',
    en: 'I\'m sorry, my offline notes don\'t have a clear answer for this. Once a key or internet is available, I\'ll answer it properly.'
  }[lang];
  if (!hits.length) return none;
  const tail = {
    ta: 'இது வழிகாட்டுதல் மட்டும் தான்; உங்கள் site plan மற்றும் சட்டமே இறுதி.',
    tg: 'Idhu guidance mattum dhaan macha; unga site plan and local law dhaan final.',
    en: 'This is guidance only; your site plan and local law have the final word.'
  }[lang];
  return `${intro}\n\n${hits.map(h => `• ${h.text}`).join('\n')}\n\n${tail}`;
}

/* ---------------- state ---------------- */

const S = {
  mounted: false,
  open: false,
  embed: false,
  wired: false,
  busy: false,
  chain: Promise.resolve(),
  pool: emptyPool(),
  hist: lsGet(LS.hist, []).slice(-30),
  ui: {},
  inst: null,
  unsubs: []
};

const hasCloud = () => countKeys(S.pool) > 0 && (typeof navigator === 'undefined' || navigator.onLine !== false);
const localEnabled = () => lsGet(LS.local, false) === true;

/* ---------------- unified generation: cloud → local → offline ---------------- */

async function generate(messages, opts = {}) {
  if (hasCloud()) {
    try { return await cloudGenerate(S.pool, messages, opts); } catch (e) { console.warn('[JARVIS] cloud failed:', e?.message); }
  }
  if (localEnabled()) {
    try { return await localGenerate(messages); } catch (e) { console.warn('[JARVIS] local failed:', e?.message); }
  }
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  return { text: await offlineAnswer(lastUser), via: 'offline' };
}

async function askLLM(prompt, opts = {}) {
  const r = await generate([{ role: 'system', content: SOUL }, { role: 'user', content: String(prompt) }], opts);
  return r.text;
}

/* ---------------- brains_75 integration + reasoning loop ---------------- */

async function selectBrain(q) {
  try {
    const m = await mods.brains();
    const fn = pick(m, ['selectBrainForTask']);
    return fn ? await fn(q) : null;
  } catch { return null; }
}

async function brainPrompt(stage, q, brain, extra = {}) {
  try {
    const m = await mods.brains();
    const fn = pick(m, ['buildMultiBrainPrompt']);
    if (!fn) return '';
    const r = await fn(q, brain, { stage, query: q, brain, ...extra });
    if (typeof r === 'string') return r;
    return (r && (r.system || r.prompt || r.content)) || '';
  } catch { return ''; }
}

async function capabilityContext(q) {
  try {
    const m = await mods.caps();
    const fn = pick(m, ['getCapabilityContext', 'buildCapabilityContext', 'matchCapabilities']);
    if (!fn) return '';
    return toText(await fn(q)).slice(0, 800);
  } catch { return ''; }
}

const STAGE = {
  plan: 'STAGE 1 - PLAN: write a brief numbered plan (max 6 short lines) for how to answer well. Do NOT give the final answer.',
  critique: 'STAGE 2 - CRITIQUE: review the plan below. List gaps, wrong assumptions, safety or legal risks and missing facts (max 6 bullets).',
  final: 'STAGE 3 - FINALIZE: using the plan and critique, write the best final answer for the user in his own language and style. Never mention stages, plans or critiques.'
};

function histMessages() {
  return S.hist.slice(-10).map(h => ({ role: h.role === 'bot' ? 'assistant' : 'user', content: h.text }));
}

async function think(q, setStatus) {
  const small = q.split(/\s+/).length <= 8 && !RE_TASK.test(q);
  const [brain, ctx, capCtx] = await Promise.all([selectBrain(q), kbContext(q), capabilityContext(q)]);
  const baseCtx = [ctx, capCtx].filter(Boolean).join('\n\n');
  const history = histMessages();
  const sysFor = async (stage, extra) => {
    const bp = await brainPrompt(stage, q, brain, extra);
    return [SOUL, bp, STAGE[stage] || '', baseCtx].filter(Boolean).join('\n\n');
  };

  if (small || !hasCloud()) {
    const sys = await sysFor('final', {});
    const r = await generate([{ role: 'system', content: sys.replace(STAGE.final, '') }, ...history, { role: 'user', content: q }]);
    if (r.via === 'offline' && small) {
      const lang = detectLang(q);
      if (/^\s*(hi|hello|hey|vanakkam|good\s+(morning|evening|afternoon)|macha|machan|da)\b/i.test(q)) {
        const arr = SMALLTALK[lang];
        return arr[Math.floor(Math.random() * arr.length)];
      }
    }
    return r.text;
  }

  setStatus('Thinking it through…');
  const plan = (await generate([{ role: 'system', content: await sysFor('plan', {}) }, ...history, { role: 'user', content: q }], { short: true })).text;
  setStatus('Double-checking myself…');
  const crit = (await generate([
    { role: 'system', content: await sysFor('critique', { plan }) },
    { role: 'user', content: `Question:\n${q}\n\nPlan:\n${plan}` }
  ], { short: true })).text;
  setStatus('Writing it for you…');
  const fin = await generate([
    { role: 'system', content: await sysFor('final', { plan, critique: crit }) },
    ...history,
    { role: 'user', content: `${q}\n\n[Private notes - do not mention]\nPlan:\n${plan}\n\nCritique:\n${crit}` }
  ]);
  return fin.text;
}

/* ---------------- 6-stage report pipeline ---------------- */

const REPORT_STAGES = [
  ['Collecting facts', 'List every fact, assumption and missing input needed for this report. Be concise.'],
  ['Analysing hazards and risks', 'Analyse hazards, risks, legal/standard references and priorities from the facts. Do not invent figures; mark unknowns.'],
  ['Drafting', 'Draft the full report body with clear headings (Summary, Findings, Risk rating, Root causes, Corrective actions with owner and target date).'],
  ['Auditing', 'Audit the draft: find errors, unsupported claims, missing actions. Return a short list of fixes.'],
  ['Formatting', 'Apply the fixes and format as a clean A4 executive report with sign-off block placeholders.'],
  ['Final polish', 'Final polish: concise, human, accurate. Return only the finished report.']
];

async function runReport(q, setStatus) {
  const cap = await mods.caps();
  const fn = pick(cap, ['runReportPipeline', 'runSixStagePipeline', 'runPipeline', 'prepareReport']);
  if (fn) {
    try {
      const r = await fn(q, {
        ask: askLLM, llm: askLLM,
        onStage: s => setStatus(typeof s === 'string' ? s : (s?.name || s?.title || 'Working…')),
        onProgress: s => setStatus(typeof s === 'string' ? s : (s?.name || 'Working…'))
      });
      const t = toText(r);
      if (t) return t;
    } catch (e) { console.warn('[JARVIS] pipeline module failed, using built-in stages:', e?.message); }
  }
  const ctx = await kbContext(q);
  let carry = `Request: ${q}${ctx ? '\n\n' + ctx : ''}`;
  for (let i = 0; i < REPORT_STAGES.length; i++) {
    const [label, instr] = REPORT_STAGES[i];
    setStatus(`Stage ${i + 1} of 6: ${label}…`);
    carry = await askLLM(`${instr}\n\n${carry}`, { short: i < 4 });
  }
  return carry;
}

/* ---------------- self_builder with approval gate ---------------- */

function approvalGate(info) {
  return new Promise(resolve => {
    if (!S.ui.msgs) { resolve(false); return; }
    const preview = (toText(info) || (info ? JSON.stringify(info, null, 2) : 'Proposed change')).slice(0, 2500);
    const card = el('div', { class: 'nj-gate' }, [
      el('div', { class: 'nj-gate-t', text: 'Approval needed before I save anything' }),
      el('pre', { class: 'nj-gate-p', text: preview }),
      el('div', { class: 'nj-row' }, [
        el('button', { class: 'nj-btn nj-ok', type: 'button', text: 'Approve', onclick: () => { card.remove(); resolve(true); } }),
        el('button', { class: 'nj-btn nj-no', type: 'button', text: 'Reject', onclick: () => { card.remove(); resolve(false); } })
      ])
    ]);
    S.ui.msgs.append(card);
    scrollDown();
  });
}

async function runBuild(q, setStatus) {
  const spec = q.replace(RE_BUILD, '').trim();
  if (!spec) return 'Tell me which module you want after "build module:" and I\'ll prepare it for your approval.';
  const sb = await mods.builder();
  const fn = pick(sb, ['proposeModule', 'planModule', 'buildModule', 'generateModule', 'selfBuild', 'run']);
  if (!fn) return 'I couldn\'t load the self-builder file just now, so nothing was changed. Please check js/jarvis/self_builder.js is in the repo.';
  const r = await fn(spec, {
    ask: askLLM, llm: askLLM,
    approve: approvalGate, requestApproval: approvalGate, onApproval: approvalGate,
    onStage: s => setStatus(typeof s === 'string' ? s : (s?.name || 'Building…')),
    onProgress: s => setStatus(typeof s === 'string' ? s : (s?.name || 'Building…'))
  });
  return toText(r) || 'Done. Everything stayed behind your approval.';
}

/* ---------------- voice: speak reply + mic ---------------- */

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const voice = { rec: null, on: false };

const speakOn = () => lsGet(LS.speak, false) === true;

function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
}

function speak(text) {
  try {
    const ss = window.speechSynthesis;
    if (!ss || !text) return;
    ss.cancel();
    const clean = String(text).replace(/[*_`#>•]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = /[\u0B80-\u0BFF]/.test(clean) ? 'ta-IN' : 'en-IN';
    u.rate = 1;
    ss.speak(u);
  } catch { /* noop */ }
}

function stopListening() {
  try { voice.rec?.stop(); } catch { /* noop */ }
  voice.on = false;
  S.ui.mic?.classList.remove('nj-rec');
}

function startListening() {
  if (!SR) {
    if (S.ui.msgs) addMsg('bot', 'Voice input is not supported in this browser. Chrome on Android works best.');
    return;
  }
  if (voice.on) { stopListening(); return; }
  try {
    const r = new SR();
    r.lang = lsGet(LS.vlang, 'en-IN');
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      if (S.ui.input) S.ui.input.value = (finalText + interim).trim();
    };
    r.onerror = () => { voice.on = false; S.ui.mic?.classList.remove('nj-rec'); };
    r.onend = () => {
      voice.on = false;
      S.ui.mic?.classList.remove('nj-rec');
      const t = finalText.trim();
      if (t && S.ui.input) {
        S.ui.input.value = '';
        S.ui.input.style.height = 'auto';
        S.chain = S.chain.then(() => converse(t)).catch(() => {});
      }
    };
    voice.rec = r;
    voice.on = true;
    S.ui.mic?.classList.add('nj-rec');
    stopSpeaking();
    r.start();
  } catch {
    stopListening();
  }
}

/* ---------------- conversation runner ---------------- */

function remember(role, text) {
  S.hist.push({ role, text: String(text).slice(0, 4000) });
  S.hist = S.hist.slice(-30);
  lsSet(LS.hist, S.hist);
}

function friendlyError(q, e) {
  const lang = detectLang(q);
  return ({
    ta: 'மன்னிச்சிடுங்க, இப்போ ஏதோ தடங்கல் ஆச்சு. இன்னொரு முறை முயற்சி பண்ணலாமா?',
    tg: 'Sorry macha, ippo oru thadangal aachu. Marubadiyum try pannalama?',
    en: 'I\'m sorry, something got in the way just now. Shall we try once more?'
  })[lang] + (e?.message ? `\n(${String(e.message).slice(0, 120)})` : '');
}

async function converse(raw, { show = true } = {}) {
  const q = String(raw || '').trim().slice(0, MAX_INPUT);
  if (!q) return '';
  let holder = null;
  S.busy = true;
  setBusy(true);
  if (show && S.ui.msgs) { addMsg('user', q); holder = addMsg('bot', '…'); }
  const status = s => { if (holder) setMsg(holder, s); };
  try {
    let out;
    if (RE_BUILD.test(q)) out = await runBuild(q, status);
    else if (RE_REPORT.test(q)) out = await runReport(q, status);
    else out = await think(q, status);
    out = String(out || '').trim() || '…';
    if (holder) setMsg(holder, out);
    remember('user', q);
    remember('bot', out);
    if (show && speakOn()) speak(out);
    return out;
  } catch (e) {
    const msg = friendlyError(q, e);
    if (holder) setMsg(holder, msg);
    return msg;
  } finally {
    S.busy = false;
    setBusy(false);
  }
}

/* ---------------- UI ---------------- */

const CSS = `
.nj-root{position:fixed;inset:0;z-index:9990;pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.nj-back{position:absolute;inset:0;background:rgba(2,6,23,.6);opacity:0;transition:opacity .2s;pointer-events:none}
.nj-panel{position:absolute;top:0;right:0;bottom:0;width:min(440px,100vw);background:#0f172a;color:#f8fafc;opacity:1;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease;box-shadow:-8px 0 28px rgba(0,0,0,.55);pointer-events:auto;box-sizing:border-box}
.nj-root.nj-open{pointer-events:auto}
.nj-root.nj-open .nj-back{opacity:1;pointer-events:auto}
.nj-root.nj-open .nj-panel{transform:none}
.nj-root.nj-embed{position:relative;inset:auto;width:100%;height:calc(100dvh - 130px);min-height:420px;z-index:auto}
.nj-embed .nj-back{display:none}
.nj-embed .nj-panel{position:relative;top:auto;right:auto;bottom:auto;width:100%;height:100%;transform:none;transition:none;box-shadow:none;border-radius:16px;border:1px solid #1e293b}
.nj-embed .nj-close{display:none}
.nj-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #1e293b;background:#0f172a;border-radius:inherit;border-bottom-left-radius:0;border-bottom-right-radius:0}
.nj-title{flex:1;font-weight:700;font-size:16px;color:#f8fafc}
.nj-sub{font-size:11px;color:#94a3b8;font-weight:400;display:block}
.nj-ib{background:transparent;border:0;color:#f8fafc;font-size:20px;line-height:1;padding:8px 10px;cursor:pointer;border-radius:10px;min-width:40px;min-height:40px}
.nj-ib:active{background:#1e293b}
.nj-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;background:#0f172a}
.nj-m{max-width:86%;padding:10px 14px;border-radius:18px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;font-size:14.5px;line-height:1.5}
.nj-user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:6px}
.nj-bot{align-self:flex-start;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-bottom-left-radius:6px}
.nj-pending{opacity:.75;font-style:italic}
.nj-bar{display:flex;align-items:flex-end;gap:6px;padding:10px;border-top:1px solid #1e293b;background:#0f172a;border-radius:inherit;border-top-left-radius:0;border-top-right-radius:0}
.nj-vb{flex:none;width:42px;height:42px;border-radius:50%;border:1px solid #334155;background:#1e293b;color:#f8fafc;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.nj-vb:active{background:#334155}
.nj-vb.nj-rec{background:#dc2626;border-color:#dc2626;animation:njpulse 1s infinite}
.nj-vb.nj-on{background:#0e7490;border-color:#06b6d4}
.nj-vl{font-size:12px;font-weight:700}
@keyframes njpulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.6)}50%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}
.nj-in{flex:1;min-width:0;min-height:42px;max-height:120px;resize:none;border-radius:21px;border:1px solid #334155;background:#1e293b;color:#f8fafc;padding:10px 14px;font:inherit;font-size:15px;box-sizing:border-box;outline:none}
.nj-in::placeholder{color:#94a3b8}
.nj-in:focus{border-color:#3b82f6}
.nj-send{flex:none;height:42px;border:0;border-radius:21px;padding:0 18px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
.nj-send:disabled{opacity:.5}
.nj-set{display:none;flex:1;overflow-y:auto;padding:14px;flex-direction:column;gap:12px;background:#0f172a}
.nj-panel.nj-settings .nj-set{display:flex}
.nj-panel.nj-settings .nj-msgs,.nj-panel.nj-settings .nj-bar{display:none}
.nj-h{font-weight:700;font-size:14px;color:#f8fafc}
.nj-note{font-size:12px;color:#94a3b8;line-height:1.4}
.nj-keys{width:100%;min-height:130px;border-radius:12px;border:1px solid #334155;background:#1e293b;color:#f8fafc;padding:10px;font:12px/1.4 ui-monospace,Menlo,monospace;box-sizing:border-box}
.nj-chips{display:flex;flex-wrap:wrap;gap:6px}
.nj-chip{padding:4px 10px;border-radius:999px;background:#1e293b;border:1px solid #334155;color:#f8fafc;font-size:12px}
.nj-chip b{margin-left:6px;color:#38bdf8}
.nj-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.nj-btn{border:0;border-radius:12px;padding:10px 14px;background:#334155;color:#f8fafc;font-weight:600;cursor:pointer}
.nj-btn.nj-ok{background:#16a34a;color:#fff}
.nj-btn.nj-no{background:#dc2626;color:#fff}
.nj-btn.nj-pri{background:#2563eb;color:#fff}
.nj-gate{align-self:stretch;border:1px solid #854d0e;border-radius:14px;padding:12px;background:#1c1917;color:#f8fafc}
.nj-gate-t{font-weight:700;margin-bottom:6px}
.nj-gate-p{max-height:220px;overflow:auto;font-size:11.5px;white-space:pre-wrap;margin:0 0 8px;color:#e2e8f0}
.nj-sw{display:flex;align-items:center;gap:10px;color:#f8fafc;font-size:14px}
.nj-card{border:1px solid #334155;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;background:#111c33}
`;

function ensureStyle() {
  let s = document.getElementById('nj-style');
  if (!s) { s = el('style', { id: 'nj-style' }); document.head.append(s); }
  s.textContent = CSS;
}

function scrollDown() {
  const m = S.ui.msgs;
  if (m) m.scrollTop = m.scrollHeight;
}

function addMsg(role, text) {
  const d = el('div', { class: `nj-m nj-${role}` });
  d.textContent = text;
  if (text === '…') d.classList.add('nj-pending');
  S.ui.msgs.append(d);
  scrollDown();
  return d;
}

function setMsg(node, text) {
  node.textContent = text;
  node.classList.toggle('nj-pending', text === '…' || (/…$/.test(text) && text.length < 60));
  scrollDown();
}

function setBusy(b) {
  if (S.ui.send) S.ui.send.disabled = b;
}

function renderChips() {
  const box = S.ui.chips;
  if (!box) return;
  box.textContent = '';
  const c = poolCounts(S.pool);
  for (const p of PROVIDERS) box.append(el('span', { class: 'nj-chip' }, [p.name, el('b', { text: String(c[p.id]) })]));
  if (S.ui.total) S.ui.total.textContent = countKeys(S.pool) ? `${countKeys(S.pool)} key(s) active - rotating automatically` : 'No keys yet - local brain and offline notes still work';
}

function renderLocalStatus() {
  if (!S.ui.localStatus) return;
  const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  S.ui.localStatus.textContent = local.status || (localEnabled()
    ? `On. Model downloads once when first needed (about 400 MB, ${gpu ? 'WebGPU' : 'WASM'}).`
    : 'Off.');
}

function buildSettings() {
  const ta = el('textarea', { class: 'nj-keys', placeholder: 'Paste all your free keys here, one per line or together.\nAQ. / AIzaSy -> Gemini   gsk_ -> Groq   sk-or- -> OpenRouter   nvapi- -> NVIDIA', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
  const msg = el('div', { class: 'nj-note' });
  S.ui.chips = el('div', { class: 'nj-chips' });
  S.ui.total = el('div', { class: 'nj-note' });

  const save = el('button', { class: 'nj-btn nj-pri', type: 'button', text: 'Save keys', onclick: async () => {
    const { pool, unknown } = detectKeys(ta.value);
    const added = countKeys(pool);
    if (!added) { msg.textContent = unknown ? 'I could not recognise those keys. Check the prefixes.' : 'Nothing to save yet.'; return; }
    S.pool = mergePools(S.pool, pool);
    lsSet(LS.pool, S.pool);
    await writeConfigPool(S.pool);
    ta.value = '';
    msg.textContent = `Saved ${added} key(s)${unknown ? `, ${unknown} unrecognised skipped` : ''}.`;
    renderChips();
  } });
  const clear = el('button', { class: 'nj-btn', type: 'button', text: 'Remove all keys', onclick: async () => {
    if (!confirm('Remove all saved keys from JARVIS and Settings?')) return;
    S.pool = emptyPool();
    lsSet(LS.pool, S.pool);
    await writeConfigPool(S.pool);
    msg.textContent = 'All keys removed.';
    renderChips();
  } });

  const sw = el('input', { type: 'checkbox', id: 'nj-local-sw' });
  sw.checked = localEnabled();
  sw.addEventListener('change', () => {
    lsSet(LS.local, sw.checked);
    if (!sw.checked) setLocalStatus('');
    renderLocalStatus();
  });
  S.ui.localStatus = el('div', { class: 'nj-note' });
  const prep = el('button', { class: 'nj-btn', type: 'button', text: 'Prepare local brain now', onclick: () => {
    lsSet(LS.local, true);
    sw.checked = true;
    loadLocalBrain().catch(() => {}).finally(renderLocalStatus);
  } });
  local.onStatus = () => renderLocalStatus();

  return el('div', { class: 'nj-set' }, [
    el('div', { class: 'nj-card' }, [
      el('div', { class: 'nj-h', text: 'Universal key box' }),
      ta,
      el('div', { class: 'nj-row' }, [save, clear]),
      msg,
      S.ui.chips,
      S.ui.total
    ]),
    el('div', { class: 'nj-card' }, [
      el('div', { class: 'nj-h', text: 'Built-in Local Brain (No Key / Offline)' }),
      el('label', { class: 'nj-sw', for: 'nj-local-sw' }, [sw, el('span', { text: 'Use on-device AI when keys or internet are missing' })]),
      S.ui.localStatus,
      el('div', { class: 'nj-note', text: 'Runs inside your browser with WebGPU or WASM and works with the local HSE notes. Keys stay on this device.' }),
      prep
    ])
  ]);
}

function buildUI(container) {
  ensureStyle();
  document.getElementById('jarvis-drawer')?.remove();
  stopListening();

  const msgs = el('div', { class: 'nj-msgs', id: 'jarvis-messages' });
  const input = el('textarea', { class: 'nj-in', id: 'jarvis-input', rows: '1', placeholder: 'Sollunga, naan kekkuren…', maxlength: String(MAX_INPUT) });
  const send = el('button', { class: 'nj-send', id: 'jarvis-send', type: 'button', text: 'Send' });

  const mic = el('button', { class: 'nj-vb', id: 'jarvis-mic', type: 'button', 'aria-label': 'Voice input', title: 'Voice input', text: '🎤' });
  const spk = el('button', { class: 'nj-vb', id: 'jarvis-speak', type: 'button', 'aria-label': 'Speak reply', title: 'Speak reply' });
  const vl = el('button', { class: 'nj-vb nj-vl', id: 'jarvis-vlang', type: 'button', 'aria-label': 'Voice language', title: 'Voice language' });

  const paintVoice = () => {
    const on = speakOn();
    spk.textContent = on ? '🔊' : '🔇';
    spk.classList.toggle('nj-on', on);
    vl.textContent = lsGet(LS.vlang, 'en-IN') === 'ta-IN' ? 'த' : 'EN';
  };
  paintVoice();

  mic.addEventListener('click', startListening);
  spk.addEventListener('click', () => {
    const next = !speakOn();
    lsSet(LS.speak, next);
    if (!next) stopSpeaking();
    paintVoice();
  });
  vl.addEventListener('click', () => {
    lsSet(LS.vlang, lsGet(LS.vlang, 'en-IN') === 'ta-IN' ? 'en-IN' : 'ta-IN');
    paintVoice();
  });

  const settingsBtn = el('button', { class: 'nj-ib', type: 'button', 'aria-label': 'Settings', text: '⚙' });
  const closeBtn = el('button', { class: 'nj-ib nj-close', type: 'button', 'aria-label': 'Close', text: '✕' });
  const panel = el('div', { class: 'nj-panel', role: 'dialog', 'aria-label': 'JARVIS' }, [
    el('div', { class: 'nj-head' }, [
      el('div', { class: 'nj-title' }, ['JARVIS', el('span', { class: 'nj-sub', text: 'Your friend and partner' })]),
      settingsBtn, closeBtn
    ]),
    msgs,
    buildSettings(),
    el('div', { class: 'nj-bar' }, [mic, spk, vl, input, send])
  ]);
  const back = el('div', { class: 'nj-back' });
  const root = el('div', { class: 'nj-root', id: 'jarvis-drawer' }, [back, panel]);

  if (container) {
    container.textContent = '';
    root.classList.add('nj-embed', 'nj-open');
    container.append(root);
  } else {
    document.body.append(root);
  }
  S.embed = !!container;
  S.ui = { ...S.ui, root, panel, msgs, input, send, mic, spk };

  const doSend = () => {
    const v = input.value;
    if (!v.trim()) return;
    input.value = '';
    input.style.height = 'auto';
    panel.classList.remove('nj-settings');
    stopListening();
    S.chain = S.chain.then(() => converse(v)).catch(() => {});
  };
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', e => {
    const coarse = window.matchMedia?.('(pointer:coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !coarse) { e.preventDefault(); doSend(); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  settingsBtn.addEventListener('click', () => { panel.classList.toggle('nj-settings'); renderChips(); renderLocalStatus(); });
  closeBtn.addEventListener('click', () => inst().close());
  back.addEventListener('click', () => inst().close());

  for (const h of S.hist.slice(-12)) addMsg(h.role === 'bot' ? 'bot' : 'user', h.text);
  if (!S.hist.length) addMsg('bot', 'Vanakkam Nasur! I\'m right here with you. Sollunga, enna venum?');
  renderChips();
  renderLocalStatus();
}

/* ---------------- instance, wiring, exports ---------------- */

function escHandler(e) { if (e.key === 'Escape' && S.open && !S.embed) inst().close(); }

const OPEN_SEL = '[data-jarvis-open],#jarvis-btn,#jarvisBtn,#ask-jarvis,.jarvis-fab,[data-action="ask-jarvis"]';

function onDocClick(e) {
  const t = e.target?.closest?.(OPEN_SEL);
  if (t && S.mounted) { e.preventDefault(); inst().open(); }
}

function onOpenEvt(ev) {
  inst().open();
  const q = ev?.detail?.q || ev?.detail?.query;
  if (q) askJarvis(q);
}

const OPEN_EVENTS = ['jarvis:open', 'nasur:jarvis-open', 'nasur:open-jarvis'];

function onKeysChanged() { renderChips(); }

function inst() {
  if (S.inst) return S.inst;
  S.inst = {
    open() {
      if (!S.mounted || !S.ui.root) return;
      S.open = true;
      S.ui.root.classList.add('nj-open');
      S.ui.panel?.classList.remove('nj-settings');
      setTimeout(() => S.ui.input?.focus(), 250);
    },
    close() {
      if (S.embed) return;
      S.open = false;
      S.ui.root?.classList.remove('nj-open');
      stopListening();
    },
    toggle() { S.open && !S.embed ? this.close() : this.open(); },
    isOpen: () => S.open,
    openSettings() { this.open(); S.ui.panel?.classList.add('nj-settings'); renderChips(); renderLocalStatus(); },
    ask: (q, o) => askJarvis(q, o),
    keyCounts: () => poolCounts(S.pool),
    setKeysFromText: async text => {
      const { pool } = detectKeys(text);
      S.pool = mergePools(S.pool, pool);
      lsSet(LS.pool, S.pool);
      await writeConfigPool(S.pool);
      renderChips();
      return poolCounts(S.pool);
    },
    destroy() {
      S.unsubs.forEach(f => { try { f(); } catch { /* noop */ } });
      S.unsubs = [];
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', escHandler);
      OPEN_EVENTS.forEach(n => window.removeEventListener(n, onOpenEvt));
      window.removeEventListener('nasur:keys-changed', onKeysChanged);
      stopListening();
      stopSpeaking();
      S.ui.root?.remove();
      S.mounted = false;
      S.open = false;
      S.embed = false;
      S.wired = false;
    }
  };
  return S.inst;
}

async function refreshPool() {
  S.pool = mergePools(lsGet(LS.pool, null) || emptyPool(), await readConfigPool());
  lsSet(LS.pool, S.pool);
  renderChips();
}

function wireOnce() {
  if (S.wired) return;
  S.wired = true;
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', escHandler);
  OPEN_EVENTS.forEach(n => window.addEventListener(n, onOpenEvt));
  window.addEventListener('nasur:keys-changed', onKeysChanged);
  (async () => {
    try {
      const [bus, core] = await Promise.all([mods.bus(), mods.coreCfg()]);
      const evName = core?.EVENTS?.CONFIG_CHANGED;
      if (bus && typeof bus.on === 'function' && evName) {
        const off = bus.on(evName, () => refreshPool().catch(() => {}));
        if (typeof off === 'function') S.unsubs.push(off);
      }
    } catch { /* optional */ }
  })();
}

export async function mountJarvis(opts = {}) {
  if (typeof document === 'undefined') return inst();
  const o = opts && typeof opts === 'object' ? opts : {};
  const container = o.container && o.container.nodeType === 1 ? o.container : null;
  const root = document.getElementById('jarvis-drawer');

  if (S.mounted && root) {
    if (!container) { if (o.open) inst().open(); return inst(); }
    if (root.parentElement === container) { inst().open(); return inst(); }
  }

  S.pool = mergePools(lsGet(LS.pool, null) || emptyPool(), S.pool);
  buildUI(container);
  S.mounted = true;
  wireOnce();
  refreshPool().catch(() => {});

  if (container) {
    S.open = true;
    setTimeout(() => S.ui.input?.focus(), 200);
  } else {
    S.open = false;
    if (o.open) inst().open();
  }
  return inst();
}

export function getJarvis() { return S.inst && S.mounted ? S.inst : null; }

export async function askJarvis(question, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const i = await mountJarvis();
  if (o.open) i.open();
  const run = S.chain.then(() => converse(question, { show: o.show !== false }));
  S.chain = run.catch(() => {});
  return run;
}

export async function mount(container, ctx = {}) {
  const base = ctx && typeof ctx === 'object' ? ctx : {};
  return mountJarvis({ ...base, container: container && container.nodeType === 1 ? container : null, open: true });
}

export async function render(a, b) {
  const container = a && a.nodeType === 1 ? a : null;
  const ctx = container ? b : a;
  return mount(container, ctx);
}

export default { mountJarvis, getJarvis, askJarvis, mount, render };