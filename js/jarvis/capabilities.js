/* =====================================================================
 * NASUR HSE OS — js/jarvis/capabilities.js   (PHASE 2)
 * 1. Capability registry: every AI tool on Nasur's list is mapped to a REAL
 *    NASUR capability with an honest status (ready / partial / planned).
 *    Nothing here pretends a model is running when it is not.
 * 2. The 6-stage "Only Press Send" pipeline for field reports:
 *    (1) law/standard research + simple explanation
 *    (2) initial report / observation draft
 *    (3) senior HSE Manager audit + edit
 *    (4) photo hazard scan
 *    (5) A4 / visual formatting (PNG pages drawn on a canvas)
 *    (6) humanized proofread + spell-check (numbers are verified unchanged)
 *    then ready-to-send WhatsApp / Email text. NOTHING is sent automatically:
 *    Nasur taps Send.
 * Created by Nasur
 *
 * No static imports (boot-safe). All AI calls go through deps.llm(), the one
 * router in drawer.js, so provider, privacy consent and offline fallback are
 * shared with the rest of JARVIS.
 *
 * deps = { llm(messages, opts) -> {text, provider}, offlineAnswer(text),
 *          auditOffline(text), scanPhoto(dataUrl, note) -> {data, provider} }
 * ===================================================================== */

/* ------------------------------ REGISTRY ------------------------------ */

/** Every name on Nasur's list (the list holds 76 names, not 73). */
export const ALL_TOOL_NAMES = Object.freeze([
  // A. Software engineering
  'Codex', 'Claude Code', 'Cursor', 'Google Antigravity', 'GitHub Copilot', 'Devin', 'Windsurf', 'Replit Agent', 'Lovable', 'Bolt.new',
  'v0', 'Amazon Q Developer', 'Gemini Code Assist', 'OpenCode', 'Aider', 'Cline', 'Kilo Code', 'OpenHands', 'Amazon Kiro', 'JetBrains Junie',
  // B. Research and knowledge
  'Perplexity', 'NotebookLM', 'Elicit', 'Consensus', 'SciSpace', 'Julius AI', 'You.com', 'Phind', 'Tavily', 'Exa', 'Firecrawl', 'Obsidian',
  // C. Visual, video, voice
  'Canva', 'Midjourney', 'FLUX', 'ComfyUI', 'Adobe Firefly', 'Ideogram', 'Runway', 'Google Veo', 'Kling AI', 'ElevenLabs', 'Sora', 'Gamma',
  // D. Foundation models
  'Gemini', 'Claude', 'ChatGPT', 'Grok', 'DeepSeek', 'Microsoft Copilot', 'Meta AI', 'Le Chat', 'Llama', 'Qwen', 'Gemma', 'Phi',
  'Cohere Command', 'IBM Granite', 'Amazon Nova', 'Mistral AI',
  // E. Agents and orchestration
  'Manus', 'Genspark', 'Claude Cowork', 'LangChain', 'LangGraph', 'CrewAI', 'AutoGen', 'n8n', 'Zapier', 'Make', 'Open WebUI',
  // F. Local AI infrastructure
  'Hugging Face', 'PyTorch', 'Ollama', 'LM Studio', 'vLLM',
]);

export const STATUS_LABEL = Object.freeze({ ready: '✅ ready', partial: '🟡 partial', planned: '⏳ planned' });

/**
 * status: ready   = works today inside NASUR
 *         partial = works with stated limits
 *         planned = NOT built yet (reason given); never shown as working
 */
export const CAPABILITIES = Object.freeze([
  { id: 'offline_hse', group: 'Foundation', title: 'Offline HSE engine', replaces: [], status: 'ready',
    how: 'Built-in PTW, LOTO, fire, PPE, machine, RCA, ISO 45001, law anchors, audit rules. Works with no internet.',
    limits: 'Fixed knowledge; always tell it to verify legal text.' },

  { id: 'code_generate', group: 'Software engineering', title: 'Natural language → ES-module code', status: 'ready',
    replaces: ['Codex', 'Claude Code', 'Cursor', 'GitHub Copilot', 'Windsurf', 'Amazon Q Developer', 'Gemini Code Assist', 'JetBrains Junie', 'OpenCode'],
    how: 'Self-builder (js/jarvis/self_builder.js) plans files, writes code, runs structural + dependency checks, repairs up to 3 times.',
    limits: 'Code cannot be executed in the browser (CSP blocks eval). Checks are static; you review before deploy.' },
  { id: 'ui_generate', group: 'Software engineering', title: 'App / screen generation', status: 'partial',
    replaces: ['Lovable', 'Bolt.new', 'v0', 'Replit Agent'],
    how: 'Self-builder generates whole NASUR modules (UI + CSS file + module registration).',
    limits: 'No live visual preview before deploy; quality depends on the free model.' },
  { id: 'autonomous_build', group: 'Software engineering', title: 'Plan → build → check → repair → approve → deploy → verify', status: 'partial',
    replaces: ['Devin', 'OpenHands', 'Aider', 'Cline', 'Kilo Code', 'Google Antigravity', 'Amazon Kiro'],
    how: 'Self-builder pipeline with rollback pack and post-deploy verification against the live site.',
    limits: 'One repository, no terminal, no real test runner. Core boot files are protected.' },

  { id: 'research_brief', group: 'Research', title: 'Research briefing with "verify" flags', status: 'partial',
    replaces: ['Perplexity', 'You.com', 'Phind', 'Tavily', 'Exa', 'Firecrawl'],
    how: 'Stage 1 of the pipeline and the Research Expert in the chat.',
    limits: 'No live web search or page scraping from the browser. Answers come from model knowledge — verify before relying on them.' },
  { id: 'literature_pdf', group: 'Research', title: 'PDF / paper knowledge extraction and citations', status: 'planned',
    replaces: ['NotebookLM', 'SciSpace', 'Elicit', 'Consensus'],
    how: 'Planned: import the HSE field book PDF into a searchable local index.',
    limits: 'Not built.' },
  { id: 'data_analysis', group: 'Research', title: 'Data analysis dashboards', status: 'planned',
    replaces: ['Julius AI'], how: 'Planned: Power BI-style HSE analytics (Phase 5).', limits: 'Not built.' },
  { id: 'knowledge_notes', group: 'Research', title: 'Searchable approved memory', status: 'partial',
    replaces: ['Obsidian'],
    how: 'Say "remember: …" to keep a fact; JARVIS Studio holds approved memory.',
    limits: 'Simple fact list, no graph or backlinks yet.' },

  { id: 'poster_studio', group: 'Visual', title: 'Safety poster generator', status: 'partial',
    replaces: ['Canva'],
    how: 'Say "make a safety poster on …": drawn on a canvas, downloadable PNG.',
    limits: 'Text posters only. Photo studio with arrows/labels and face blur is planned.' },
  { id: 'a4_report', group: 'Visual', title: 'A4 report pages', status: 'partial',
    replaces: ['Gamma'],
    how: 'Pipeline stage 5 draws A4 PNG pages with header, photo and sign-off block.',
    limits: 'No slide decks yet.' },
  { id: 'image_generation', group: 'Visual', title: 'AI image generation', status: 'planned',
    replaces: ['Midjourney', 'FLUX', 'ComfyUI', 'Adobe Firefly', 'Ideogram'],
    how: 'Planned.', limits: 'Needs an image model API and the page security policy blocks remote images today.' },
  { id: 'video_generation', group: 'Visual', title: 'AI video generation', status: 'planned',
    replaces: ['Runway', 'Google Veo', 'Kling AI', 'Sora'],
    how: 'Not planned for free use.', limits: 'Needs paid video models.' },
  { id: 'voice_io', group: 'Voice', title: 'Speech to text and text to speech', status: 'partial',
    replaces: ['ElevenLabs'],
    how: 'js/jarvis/voice.js uses the phone\'s own speech engine (Tamil and English).',
    limits: 'Device voices, not neural cloning; Tamil voice must be installed on the phone.' },

  { id: 'models_reachable', group: 'Foundation models', title: 'Models JARVIS can really call', status: 'ready',
    replaces: ['Gemini', 'ChatGPT', 'DeepSeek', 'Mistral AI', 'Le Chat', 'Llama', 'Qwen', 'Gemma'],
    how: 'Router in drawer.js: OpenRouter free models (Gemma, Llama, Qwen), plus your Gemini / Groq / OpenAI / DeepSeek / Mistral keys.',
    limits: 'Free models are rate-limited and can disappear; the badge shows which one answered.' },
  { id: 'models_conditional', group: 'Foundation models', title: 'Models only if your provider offers them', status: 'partial',
    replaces: ['Claude', 'Grok', 'Microsoft Copilot', 'Meta AI', 'Phi', 'Cohere Command', 'IBM Granite', 'Amazon Nova'],
    how: 'Reachable only when a provider you configured serves them.',
    limits: 'Not available by default; the apps themselves are not embedded.' },

  { id: 'multi_agent', group: 'Agents', title: '6-stage sequential agent pipeline', status: 'partial',
    replaces: ['LangChain', 'LangGraph', 'CrewAI', 'AutoGen', 'Manus', 'Genspark', 'Claude Cowork'],
    how: 'Say "prepare a report …" — research → draft → manager audit → photo scan → A4 format → proofread.',
    limits: 'Fixed sequence of roles, run on demand; no background jobs or parallel agents.' },
  { id: 'workflow_automation', group: 'Agents', title: 'Hand-off to WhatsApp / Email', status: 'partial',
    replaces: ['n8n', 'Zapier', 'Make'],
    how: 'Ready-to-send text; you tap Send in WhatsApp or your mail app.',
    limits: 'No unattended automation; sending is always your tap.' },
  { id: 'chat_ui', group: 'Agents', title: 'Chat interface with voice, photo and history', status: 'ready',
    replaces: ['Open WebUI'], how: 'The JARVIS drawer.', limits: 'Single user, history kept on this device.' },

  { id: 'hf_hosting', group: 'Infrastructure', title: 'Hosting and deployment on Hugging Face Spaces', status: 'partial',
    replaces: ['Hugging Face'],
    how: 'Self-builder commits approved files to your Space and verifies them live.',
    limits: 'Uses Spaces hosting only; Hugging Face model inference is not wired in.' },
  { id: 'local_inference', group: 'Infrastructure', title: 'Local model inference', status: 'planned',
    replaces: ['PyTorch', 'Ollama', 'LM Studio', 'vLLM'],
    how: 'Planned.', limits: 'The page security policy (connect-src https:) blocks http://localhost; a browser WebGPU model would be needed.' },
]);

export function findCapability(toolName) {
  const n = String(toolName || '').trim().toLowerCase();
  return CAPABILITIES.find((c) => c.replaces.some((r) => r.toLowerCase() === n)) || null;
}

export function capabilityCounts() {
  const c = { ready: 0, partial: 0, planned: 0, total: ALL_TOOL_NAMES.length };
  ALL_TOOL_NAMES.forEach((name) => { const cap = findCapability(name); if (cap) c[cap.status] += 1; });
  return c;
}

/** Names on the list that no capability covers (should always be empty). */
export function uncoveredTools() { return ALL_TOOL_NAMES.filter((n) => !findCapability(n)); }

export function describeCapabilities() {
  const c = capabilityCounts();
  const lines = [`**NASUR capability status** — your list has ${c.total} names (not 73): ✅ ${c.ready} ready · 🟡 ${c.partial} partial · ⏳ ${c.planned} planned. Nothing below is a fake button.`];
  ['ready', 'partial', 'planned'].forEach((st) => {
    const rows = CAPABILITIES.filter((x) => x.status === st);
    if (!rows.length) return;
    lines.push('', STATUS_LABEL[st].toUpperCase());
    rows.forEach((x) => {
      const rep = x.replaces.length ? ' (' + x.replaces.slice(0, 4).join(', ') + (x.replaces.length > 4 ? ' +' + (x.replaces.length - 4) : '') + ')' : '';
      lines.push('• **' + x.title + '**' + rep + ' — ' + (st === 'planned' ? x.limits : x.limits));
    });
  });
  return lines.join('\n');
}

/** Cheap intent detection used by the router. Returns a string or null. */
export function detectIntent(text) {
  const t = String(text || '');
  if (/^\s*forget\s+(all|everything)\b/i.test(t)) return 'forget';
  if (/^\s*(remember|ninaivu\s*vechuko|ninaivil\s*vai)\s*[:\-]?\s+\S+/i.test(t)) return 'remember';
  if (/(what (all )?can you do|your capabilit|capability (list|status)|73 (ai )?(tools|capabilit)|which (ai )?tools (do|can) you)/i.test(t)) return 'capabilities';
  if (/(only press send|full pipeline|6[- ]stage|end[- ]to[- ]end report|prepare (a |the |my )?(daily )?(report|observation)|make (a |the )?(report|observation) (for|from|about|on)|report (ready )?pannu)/i.test(t)) return 'pipeline';
  return null;
}

/* ------------------------------ PIPELINE ------------------------------ */

export const PIPELINE_STAGES = Object.freeze([
  { id: 'research', title: 'Law / standard research and simple explanation' },
  { id: 'draft', title: 'Initial report draft' },
  { id: 'audit', title: 'Senior HSE Manager audit and edit' },
  { id: 'photo', title: 'Photo hazard scan' },
  { id: 'format', title: 'A4 / visual formatting' },
  { id: 'proofread', title: 'Humanized proofread and spell-check' },
]);
const titleOf = (id) => (PIPELINE_STAGES.find((s) => s.id === id) || {}).title || id;

const S1 = 'You are a careful senior HSE researcher with NO web access. Identify the standards or legal provisions that apply to the task for the stated jurisdiction and explain them in simple words, in the language Nasur wrote in (Tamil, Tanglish or English). Mark every legal reference "(verify)" unless you are certain. Never invent clause numbers. Max 170 words.';
const S2 = 'You are an HSE officer writing the first draft of a site observation / report from rough notes. Use ONLY facts in the notes; write "[to confirm]" for anything unknown. Clear professional English. Start with a line "TITLE: ...", then: Location & date, Observation, Risk (Low/Medium/High with a one-line reason), Immediate action taken, Recommended corrective actions (owner + target date placeholders), Standard / legal basis (mark "(verify)" if unsure). Max 260 words.';
const S3 = 'You are a strict senior HSE Manager reviewing a subordinate\'s draft. First list at most 6 numbered issues (vague wording, missing evidence, wrong risk rating, no legal basis, missing owner/date). Then write a line exactly "### EDITED REPORT" and the full corrected report (keep the TITLE: line and all facts; do not invent facts, use "[to confirm]").';
const S6 = 'You are a careful human proofreader. Fix spelling, grammar and punctuation and make the text read naturally, as a thoughtful HSE professional would write it. Keep EVERY fact, number, name, date and "[to confirm]" marker exactly. Do not add facts. Return only the final text.';

const digitsOf = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).sort().join('|');

export function proofreadOffline(text) {
  return String(text)
    .replace(/[ \t]+/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/([,.;:!?])(?=[A-Za-z])/g, '$1 ')
    .replace(/^([a-z])/gm, (m) => m.toUpperCase()).replace(/([.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()).trim();
}

export function composeReport({ title, body, photoLines = [] }) {
  const parts = [String(title || 'HSE Observation Report').trim(), '', String(body || '').trim()];
  if (photoLines.length) parts.push('', 'Photo findings:', ...photoLines.map((l) => '- ' + l));
  parts.push('', 'Prepared by: ____________   Reviewed by: ____________   Date: ____________');
  return parts.join('\n');
}

/** Ready-to-send hand-off text. NASUR never sends anything by itself. */
export function buildDispatch(finalText, subject) {
  const body = String(finalText || '').replace(/\*\*/g, '*');
  return { whatsapp: body.length > 3500 ? body.slice(0, 3500) + '\n…(full report attached as A4 image)' : body, emailSubject: subject || 'HSE report', emailBody: body };
}

function wrapLines(ctx, text, maxWidth) {
  const out = []; let line = '';
  for (const word of String(text).split(/\s+/)) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; } else line = test;
  }
  if (line) out.push(line);
  return out;
}
function loadImage(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }

/** Draws the report onto A4 canvases (1240 x 1754) and returns PNG data URLs. */
export async function renderA4Pages(text, opts = {}) {
  if (typeof document === 'undefined') return [];
  const W = 1240, H = 1754, M = 90, dateStr = new Date().toLocaleDateString();
  const pages = []; let cv = null, g = null, y = 0;
  const newPage = () => {
    cv = document.createElement('canvas'); cv.width = W; cv.height = H; g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0b6e5a'; g.fillRect(0, 0, W, 110);
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText('NASUR · HSE Report', M, 70);
    g.textAlign = 'right'; g.font = '26px system-ui, sans-serif'; g.fillText(dateStr, W - M, 70); g.textAlign = 'left';
    y = 180; pages.push(cv);
  };
  newPage();
  const lines = String(text).split('\n');
  const first = lines.findIndex((l) => l.trim());
  let titleDone = false;
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/`/g, '');
    if (!raw.trim()) { y += 22; continue; }
    const isTitle = !titleDone && li === first;
    const isHead = isTitle || /^[A-Z][A-Za-z &/()-]{2,48}:\s*$/.test(raw.trim()) || /^(Location|Observation|Risk|Immediate action|Recommended|Standard|Photo findings)/i.test(raw.trim()) && raw.trim().length < 60 && /:\s*$/.test(raw.trim());
    const bullet = /^\s*[-•]\s+/.test(raw);
    g.fillStyle = isHead ? '#0b3d33' : '#1a1a1a';
    g.font = isTitle ? 'bold 44px system-ui, sans-serif' : isHead ? 'bold 31px system-ui, sans-serif' : '28px system-ui, sans-serif';
    const lh = isTitle ? 58 : 42, indent = bullet ? 36 : 0;
    const wrapped = wrapLines(g, raw.replace(/^\s*[-•]\s+/, ''), W - 2 * M - indent);
    if (isTitle) titleDone = true;
    for (let k = 0; k < wrapped.length; k++) {
      if (y > H - 150) { newPage(); g.fillStyle = '#1a1a1a'; g.font = '28px system-ui, sans-serif'; }
      if (bullet && k === 0) { g.fillText('•', M + 6, y); }
      g.fillText(wrapped[k], M + indent, y); y += lh;
    }
    if (isTitle && opts.photo) {
      const im = await loadImage(opts.photo);
      if (im) {
        const maxW = 520, maxH = 380, sc = Math.min(maxW / im.width, maxH / im.height, 1);
        const w = Math.round(im.width * sc), h = Math.round(im.height * sc);
        if (y + h > H - 150) { newPage(); }
        g.drawImage(im, M, y, w, h); g.strokeStyle = '#999'; g.strokeRect(M, y, w, h);
        g.fillStyle = '#666'; g.font = '22px system-ui, sans-serif'; g.fillText('Site photo', M, y + h + 30); y += h + 60;
      }
    }
  }
  pages.forEach((p, i) => {
    const c = p.getContext('2d'); c.fillStyle = '#777'; c.font = '22px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('Prepared with NASUR · page ' + (i + 1) + ' of ' + pages.length, W / 2, H - 50); c.textAlign = 'left';
  });
  return pages.map((p) => p.toDataURL('image/png'));
}

/**
 * Runs the 6 stages. Each stage falls back to offline logic when no online AI
 * answers, and the result says which provider (or "offline") produced it.
 * Resolves { stages:[{id,title,provider,note}], final, report, pages, subject, dispatch }.
 */
export async function runPipeline({ request, photo = null, deps, onStage = () => {}, lawText = '' }) {
  const stages = [];
  const mark = (id, provider, note) => { const s = { id, title: titleOf(id), provider: provider || 'offline', note: note || '' }; stages.push(s); try { onStage(s, stages.length); } catch { /* ignore */ } };
  const ask = (system, user, o = {}) => deps.llm([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.3, timeout: 45000, noCache: true, maxTokens: 900, ...o });

  // 1 research
  let research = '';
  try { const r = await ask(S1, `Jurisdiction focus: ${lawText || 'not specified'}\nNotes from Nasur:\n${request}`); research = r.text.trim(); mark('research', r.provider); }
  catch (e) { research = deps.offlineAnswer ? deps.offlineAnswer(request) : ''; mark('research', null, e && e.message === 'ai_disabled' ? 'online AI is off' : 'online AI unavailable'); }

  // 2 draft
  let draft = '';
  try { const r = await ask(S2, `Notes from Nasur:\n${request}\n\nBackground (for the legal basis only):\n${research.slice(0, 900)}`); draft = r.text.trim(); mark('draft', r.provider); }
  catch { draft = `TITLE: Site observation\nLocation & date: [to confirm]\nObservation: ${request}\nRisk: [to confirm]\nImmediate action taken: [to confirm]\nRecommended corrective actions: [to confirm owner and target date]\nStandard / legal basis: [to confirm]`; mark('draft', null, 'template used'); }

  // 3 manager audit
  let edited = draft, auditNotes = '';
  try {
    const r = await ask(S3, `DRAFT:\n${draft}`, { maxTokens: 1300 });
    const parts = r.text.split(/###\s*EDITED REPORT/i);
    auditNotes = parts[0].trim(); edited = (parts[1] || '').trim() || draft; mark('audit', r.provider, edited === draft ? 'no edit returned, kept draft' : '');
  } catch {
    const a = deps.auditOffline ? deps.auditOffline(draft) : { findings: [] };
    auditNotes = (a.findings || []).map((f, i) => (i + 1) + '. ' + f.title).join('\n');
    if (auditNotes) edited = draft + '\n\nOpen points to confirm:\n' + (a.findings || []).map((f) => '- ' + f.corrective_action).join('\n');
    mark('audit', null, 'offline rule audit');
  }

  // 4 photo scan
  const photoLines = [];
  if (photo && deps.scanPhoto) {
    try {
      const r = await deps.scanPhoto(photo, request);
      const d = r && r.data;
      if (d && Array.isArray(d.hazards)) { d.hazards.forEach((h) => photoLines.push(`${h.title} [${h.severity}] — ${h.corrective_action || 'action to confirm'}`)); mark('photo', r.provider, photoLines.length + ' finding(s)'); }
      else mark('photo', null, 'vision returned nothing usable');
    } catch { mark('photo', null, 'vision unavailable — check the photo manually'); }
  } else mark('photo', null, 'no photo attached');

  // 5 compose structure (pages are drawn after the proofread so they match the final text)
  const tm = /^\s*TITLE:\s*(.+)$/im.exec(edited);
  const title = tm ? tm[1].trim() : 'HSE Observation Report';
  const body = edited.replace(/^\s*TITLE:.*$/im, '').trim();
  const composed = composeReport({ title, body, photoLines });

  // 6 proofread (numbers must survive)
  let final = composed, proofProvider = null, proofNote = '';
  try {
    const r = await ask(S6, composed, { temperature: 0.2, maxTokens: 1200 });
    const cleaned = r.text.trim();
    if (cleaned && digitsOf(cleaned) === digitsOf(composed)) { final = cleaned; proofProvider = r.provider; }
    else { final = proofreadOffline(composed); proofNote = 'AI proofread changed numbers, so the safe offline proofread was used'; }
  } catch { final = proofreadOffline(composed); proofNote = 'offline proofread'; }

  let pages = [];
  try { pages = await renderA4Pages(final, { photo }); } catch { pages = []; }
  mark('format', null, pages.length ? pages.length + ' A4 page(s) drawn' : 'A4 pages could not be drawn');
  mark('proofread', proofProvider, proofNote);
  stages.sort((a, b) => PIPELINE_STAGES.findIndex((s) => s.id === a.id) - PIPELINE_STAGES.findIndex((s) => s.id === b.id));

  return { stages, final, report: final, auditNotes, research, pages, subject: title, dispatch: buildDispatch(final, title) };
}
