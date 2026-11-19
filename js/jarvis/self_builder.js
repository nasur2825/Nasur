/* =====================================================================
 * NASUR HSE OS — js/jarvis/self_builder.js   (PHASE 2)
 * Autonomous self-coding and self-repair engine.
 *
 *   PLAN → INSPECT → BUILD → VALIDATE → REPAIR (max 3) → PREVIEW → APPROVE → DEPLOY → VERIFY
 *
 * What it really does (and does not):
 *   + plans files from a plain-language request, writes them with the AI router
 *   + checks every file WITHOUT running it (the page security policy blocks
 *     eval): bracket/string/template balance, forbidden patterns (inline
 *     styles, eval, external scripts, direct IndexedDB access), the module
 *     contract (export render), relative imports that must exist, imported
 *     names that must really be exported, repo.xxx / namespace members that
 *     must exist, JSON validity, CSS balance
 *   + feeds every error back to the model and retries, at most 3 repairs per file
 *   + NEVER deploys by itself: commit() needs an explicit approval from Nasur
 *   + core boot files are protected; existing files are only overwritten when
 *     Nasur approves the overwrite; a rollback pack is created before every commit
 *   + after commit, verifyDeployed() compares the live site with what was sent
 *   - it cannot execute the code or click through the UI, so "passed" means
 *     "structurally sound", not "tested in a browser". It says so.
 * Created by Nasur
 *
 * No static imports (boot-safe). Everything is injected:
 *   deps = { llm(messages, opts) -> {text, provider}, log(text),
 *            hfToken, hfRepo, allowCore }
 * ===================================================================== */

const BASE = new URL('../../', import.meta.url).href;

export const MAX_REPAIRS = 3;
export const MAX_FILES = 6;
export const MAX_FILE_CHARS = 90000;

/** Files the builder may never overwrite unless Nasur enables "core edits" in settings. */
export const PROTECTED = Object.freeze([
  /^index\.html$/, /^sw\.js$/, /^manifest\.webmanifest$/,
  /^js\/core\//,
  /^js\/services\/(db|repo|config|sanitize|settings|pin|jarvis_core)\.js$/,
  /^js\/jarvis\/(drawer|voice|context|self_builder|capabilities)\.js$/,
  /^css\/(tokens|base|components|jarvis)\.css$/,
]);

/** The only places generated files may go. */
export const ALLOWED = Object.freeze([
  /^js\/modules\/[a-z0-9_]+\.js$/,
  /^js\/services\/[a-z0-9_]+\.js$/,
  /^js\/jarvis\/[a-z0-9_]+\.js$/,
  /^css\/[a-z0-9_-]+\.css$/,
  /^data\/[a-z0-9_\/-]+\.json$/,
]);

/* ------------------------------ REMOTE FILES ------------------------------ */
const remoteCache = new Map();
async function fetchT(url, opt, ms = 20000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}
/** Text of a file from the live site (same origin), or null when it does not exist. */
export async function remoteText(path, fresh = false) {
  if (!fresh && remoteCache.has(path)) return remoteCache.get(path);
  let text = null;
  try {
    const r = await fetchT(BASE + path + (fresh ? '?v=' + Date.now() : ''), { cache: 'no-store' });
    if (r.ok) { const t = await r.text(); text = /^\s*<!doctype html/i.test(t) && !/\.html$/.test(path) ? null : t; }
  } catch { text = null; }
  if (!fresh) remoteCache.set(path, text);
  return text;
}

/* ------------------------------ PATH RULES ------------------------------ */
export function pathProblem(path, allowCore = false) {
  if (typeof path !== 'string' || !path) return 'empty path';
  if (path.startsWith('/') || path.includes('..') || /\s/.test(path) || path.includes('\\')) return 'unsafe path';
  if (path === 'data/modules.json') return 'data/modules.json is changed only through module registration';
  if (PROTECTED.some((r) => r.test(path))) return allowCore ? null : 'protected core file (enable core edits in JARVIS settings)';
  if (!ALLOWED.some((r) => r.test(path))) return 'path is outside the allowed folders';
  return null;
}
const resolvePath = (from, spec) => new URL(spec, 'https://nasur.local/' + from).pathname.slice(1);

/* ------------------------------ JS LEXER (no eval) ------------------------------ */
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const REGEX_PREV = '(,=:[!&|?{};+-*%<>~^';

/** Finds unbalanced brackets and unterminated strings, comments, templates and regexes. */
export function lexJs(code) {
  const issues = []; const stack = []; const n = code.length;
  let i = 0, line = 1, prev = '', lastWord = '';
  const open = { '(': 1, '[': 1, '{': 1 };
  const close = { ')': '(', ']': '[', '}': '{' };

  function scanTemplate() {
    while (i < n) {
      const c = code[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') line += 1;
      if (c === '`') { i += 1; prev = '`'; return; }
      if (c === '$' && code[i + 1] === '{') { i += 2; stack.push({ ch: '${', line }); prev = '{'; return; }
      i += 1;
    }
    issues.push({ line, msg: 'unterminated template literal' });
  }

  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }
    if (c === '/' && d === '/') { while (i < n && code[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      const e = code.indexOf('*/', i + 2);
      if (e < 0) { issues.push({ line, msg: 'unterminated comment' }); break; }
      for (let k = i; k < e; k += 1) if (code[k] === '\n') line += 1;
      i = e + 2; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; i += 1; let ok = false;
      while (i < n) {
        const x = code[i];
        if (x === '\\') { i += 2; continue; }
        if (x === '\n') break;
        if (x === q) { ok = true; i += 1; break; }
        i += 1;
      }
      if (!ok) issues.push({ line, msg: 'unterminated string' });
      prev = '"'; lastWord = ''; continue;
    }
    if (c === '`') { i += 1; scanTemplate(); lastWord = ''; continue; }
    if (c === '/') {
      const regexOk = prev === '' || REGEX_PREV.includes(prev) || KEYWORDS_BEFORE_REGEX.has(lastWord);
      if (regexOk) {
        i += 1; let inClass = false, ok = false;
        while (i < n) {
          const x = code[i];
          if (x === '\\') { i += 2; continue; }
          if (x === '\n') break;
          if (x === '[') inClass = true; else if (x === ']') inClass = false;
          else if (x === '/' && !inClass) { ok = true; i += 1; break; }
          i += 1;
        }
        if (!ok) issues.push({ line, msg: 'unterminated regular expression' });
        while (i < n && /[a-z]/i.test(code[i])) i += 1;
        prev = '/'; lastWord = ''; continue;
      }
      i += 1; prev = '/'; lastWord = ''; continue;
    }
    if (open[c]) { stack.push({ ch: c, line }); i += 1; prev = c; lastWord = ''; continue; }
    if (c === '}' && stack.length && stack[stack.length - 1].ch === '${') { stack.pop(); i += 1; scanTemplate(); lastWord = ''; continue; }
    if (close[c]) {
      const top = stack.pop();
      if (!top || top.ch !== close[c]) issues.push({ line, msg: 'unexpected "' + c + '"' + (top ? ' (still open: "' + top.ch + '" from line ' + top.line + ')' : '') });
      i += 1; prev = c; lastWord = ''; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const s = i; while (i < n && /[\w$]/.test(code[i])) i += 1; lastWord = code.slice(s, i); prev = 'a'; continue; }
    if (/[0-9]/.test(c)) { while (i < n && /[\w.]/.test(code[i])) i += 1; prev = '0'; lastWord = ''; continue; }
    prev = c; lastWord = ''; i += 1;
  }
  stack.forEach((s) => issues.push({ line: s.line, msg: '"' + s.ch + '" opened here is never closed' }));
  return issues;
}

/* ------------------------------ IMPORT / EXPORT PARSING ------------------------------ */
export function parseImports(code) {
  const out = []; let m;
  const re = /^[ \t]*import\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  while ((m = re.exec(code))) {
    const clause = m[1].trim(); const names = []; let def = false; let ns = null;
    const brace = /\{([^}]*)\}/.exec(clause);
    if (brace) brace[1].split(',').forEach((p) => { const nm = p.trim().split(/\s+as\s+/)[0].trim(); if (nm) names.push(nm); });
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const nsm = /^\*\s*as\s+([\w$]+)/.exec(rest);
    if (nsm) ns = nsm[1]; else if (rest) def = true;
    out.push({ spec: m[2], names, def, ns });
  }
  const side = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
  while ((m = side.exec(code))) out.push({ spec: m[1], names: [], def: false, ns: null, side: true });
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(code))) out.push({ spec: m[1], names: [], def: false, ns: null, dynamic: true });
  return out;
}
export function parseExports(code) {
  const names = new Set(); let def = false, star = false, m;
  const decl = /^[ \t]*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/gm;
  while ((m = decl.exec(code))) names.add(m[1]);
  const list = /^[ \t]*export\s*\{([^}]*)\}/gm;
  while ((m = list.exec(code))) m[1].split(',').forEach((p) => { const parts = p.trim().split(/\s+as\s+/); const nm = (parts[1] || parts[0]).trim(); if (nm) names.add(nm); });
  if (/^[ \t]*export\s+default\b/m.test(code)) def = true;
  if (/^[ \t]*export\s*\*\s*from\b/m.test(code)) star = true;
  return { names, def, star };
}

/* ------------------------------ STATIC CHECKS ------------------------------ */
const FORBIDDEN = Object.freeze([
  [/\beval\s*\(/, 'eval() is blocked by the page security policy'],
  [/\bnew\s+Function\s*\(/, 'new Function() is blocked by the page security policy'],
  [/document\.write\s*\(/, 'document.write is not allowed'],
  [/<style[\s>]/i, 'inline <style> is blocked (style-src \'self\'): put CSS in css/<name>.css'],
  [/<script[\s>]/i, 'inline <script> is blocked (script-src \'self\')'],
  [/\sstyle\s*=\s*["'\\]/, 'style="" attributes are blocked: use CSS classes (JS may set element.style.x)'],
  [/\son(click|change|input|submit|load|error|keydown|keyup|focus|blur)\s*=\s*["'\\]/i, 'inline event attributes are blocked: use addEventListener'],
  [/\bfrom\s*['"]https?:/, 'external module imports are blocked (script-src \'self\')'],
  [/\bimport\s*\(\s*['"]https?:/, 'external dynamic imports are blocked (script-src \'self\')'],
  [/indexedDB\s*\.\s*(deleteDatabase|open)\s*\(/, 'never open or delete the NASUR database directly: use js/services/repo.js'],
  [/localStorage\s*\.\s*clear\s*\(/, 'localStorage.clear() would erase NASUR data'],
  [/\.\s*(clear|deleteAll)\s*\(\s*\)\s*;?\s*\/\/\s*stores?/i, 'do not clear data stores'],
]);

function pushIssue(list, msg, line) { list.push(line ? 'line ' + line + ': ' + msg : msg); }

export async function checkFile(path, code, ctx = {}) {
  const errors = []; const warnings = []; const info = { exports: [], imports: 0, bytes: String(code).length };
  const text = String(code);
  if (!text.trim()) return { errors: ['file is empty'], warnings, info };
  if (text.length > MAX_FILE_CHARS) errors.push('file is over ' + Math.round(MAX_FILE_CHARS / 1000) + ' KB — split it into smaller files');
  const files = ctx.files || new Map();

  if (/\.json$/i.test(path)) {
    try { JSON.parse(text); } catch (e) { errors.push('invalid JSON: ' + e.message); }
    return { errors, warnings, info };
  }

  if (/\.css$/i.test(path)) {
    const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const o = (bare.match(/\{/g) || []).length, c = (bare.match(/\}/g) || []).length;
    if (o !== c) errors.push('unbalanced braces: ' + o + ' "{" vs ' + c + ' "}"');
    if (/@import/i.test(bare)) errors.push('@import is not allowed: put everything in this one file');
    if (/url\(\s*['"]?(https?:)?\/\//i.test(bare)) errors.push('external url() is blocked by the page security policy');
    if (/expression\s*\(/i.test(bare)) errors.push('CSS expression() is not allowed');
    if (!/var\(--/.test(bare)) warnings.push('does not use the NASUR design tokens (var(--color-…)); light/dark themes may look wrong');
    return { errors, warnings, info };
  }

  // JavaScript
  lexJs(text).slice(0, 8).forEach((x) => pushIssue(errors, x.msg, x.line));
  const lines = text.split('\n');
  lines.forEach((ln, idx) => {
    if (/^\s*\/\//.test(ln)) return;
    FORBIDDEN.forEach(([re, msg]) => { if (re.test(ln)) pushIssue(errors, msg, idx + 1); });
    if (/\.innerHTML\s*[+]?=\s*[^'"`;]*\$\{|\.innerHTML\s*\+?=\s*\w+\s*\+/.test(ln)) pushIssue(warnings, 'innerHTML with dynamic text — use textContent, or html`` / renderHtml from sanitize.js', idx + 1);
    if (/localStorage\s*\.\s*setItem\s*\([^)]*(token|secret|password|apikey)/i.test(ln)) pushIssue(warnings, 'do not store secrets in localStorage', idx + 1);
  });

  const exp = parseExports(text);
  info.exports = Array.from(exp.names).concat(exp.def ? ['default'] : []);
  if (/^js\/modules\//.test(path)) {
    if (!/export\s+(async\s+)?function\s+render\b|export\s*\{[^}]*\brender\b|export\s+const\s+render\b/.test(text)) errors.push('a module must export render(ctx) (export async function render(ctx) { … return cleanup })');
    if (!/return\s+(function|\(\)\s*=>|\w+\s*;)/.test(text) && !/cleanup/i.test(text)) warnings.push('render() should return a cleanup function (remove timers and listeners)');
  }

  const imports = parseImports(text); info.imports = imports.length;
  for (const im of imports) {
    if (!im.spec.startsWith('.')) { errors.push('import "' + im.spec + '" is not a relative path (no bundler, external scripts blocked)'); continue; }
    const target = resolvePath(path, im.spec);
    if (/\.(json|css)$/.test(target)) { errors.push('import "' + im.spec + '": JSON/CSS cannot be imported — fetch the JSON, or add a <link> for CSS'); continue; }
    let src = files.has(target) ? files.get(target) : await remoteText(target);
    if (src == null) { errors.push('imports "' + im.spec + '" but ' + target + ' does not exist in the repo or this build'); continue; }
    const ex = parseExports(src);
    if (ex.star) continue;
    im.names.forEach((nm) => { if (!ex.names.has(nm)) errors.push('imports { ' + nm + ' } from "' + im.spec + '" but ' + target + ' does not export it'); });
    if (im.def && !ex.def) errors.push('default import from "' + im.spec + '" but ' + target + ' has no default export');
    if (im.ns) {
      const used = new Set(); let m; const re = new RegExp('(?<![\\w$./\'"-])' + im.ns.replace(/\$/g, '\\$') + '\\.([A-Za-z_$][\\w$]*)', 'g');
      while ((m = re.exec(text))) used.add(m[1]);
      used.forEach((nm) => { if (!ex.names.has(nm)) errors.push(im.ns + '.' + nm + ' is used but ' + target + ' does not export "' + nm + '"'); });
    }
  }
  return { errors: errors.slice(0, 14), warnings: warnings.slice(0, 8), info };
}

/* ------------------------------ GENERATION ------------------------------ */
const ARCH = `NASUR is a vanilla-JS offline-first PWA on a Hugging Face static Space: no bundler, no npm, ES modules with RELATIVE imports only. STRICT CSP: script-src 'self', style-src 'self' — NO inline <style>, NO style="" attributes in HTML strings, NO inline event attributes, NO eval, NO external scripts/CDNs. JS may set element.style.x and add listeners. Put styles in ONE css file css/<module_id>.css and load it from render() with a <link> (see ensureCss below).
MODULE CONTRACT (js/core/router.js): a file in js/modules/ exports  export async function render(ctx)  where ctx.root is the container element, ctx.signal an AbortSignal, ctx.navigate(path,{replace}), ctx.path, ctx.query (URLSearchParams). render() fills ctx.root and RETURNS a cleanup function (clear timers, remove listeners). Never use href="#section" anchors; link to other modules with hrefFor(id) from '../core/router.js'.
REAL APIS you may import (do not invent others): 
 - '../core/eventbus.js': emit, on (on() returns an unsubscribe function)
 - '../core/config.js': STORES, EVENTS (toast: emit(EVENTS.TOAST, {message, type:'success'|'info'|'warning'|'danger'}))
 - '../core/router.js': hrefFor(id), getModule(id)
 - '../services/sanitize.js': html (tagged template), renderHtml(el, html\`…\`), cleanText(value,{multiline}), truncateText
 - '../services/repo.js' as namespace: repo.list(store), repo.count(store), repo.getActiveProjectId(), repo.DbError
 - '../services/config.js': getUserConfig() (async), getCachedUserConfig(), updateUserConfig(changes)
 Prefer plain DOM (document.createElement, textContent) over html templates when unsure.
DATA SAFETY: never open/delete IndexedDB directly; for small module data use localStorage keys starting "nasur_<module_id>_"; never touch other modules' data.
DESIGN TOKENS (css variables): --color-bg --color-surface --color-surface-raised --color-border --color-text --color-text-muted --color-brand --color-brand-contrast --color-accent --color-danger --space-1..6 --radius-sm/md/lg --text-xs/sm/base/lg/xl --tap-min --font-sans. Mobile first (360px wide), touch targets >= var(--tap-min), works in light and dark.
ensureCss helper to paste into modules: function ensureCss(href){ if(!Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(l=>(l.getAttribute('href')||'').includes(href))){ const l=document.createElement('link'); l.rel='stylesheet'; l.href=new URL('../../'+href, import.meta.url).href; document.head.appendChild(l);} }
QUALITY: complete working code, no placeholders, no TODO, no "rest of code". Tamil + English friendly UI text. Keep each file under ~500 lines.`;

export function extractCode(text) {
  const t = String(text || '');
  const m = /```[\w.+-]*\n([\s\S]*?)```/.exec(t);
  if (m) return m[1].replace(/^\s*(\/\/|\/\*|#)\s*path:.*\n/i, '').trimEnd() + '\n';
  const open = /```[\w.+-]*\n([\s\S]*)$/.exec(t);
  return (open ? open[1] : t).replace(/^\s*(\/\/|\/\*|#)\s*path:.*\n/i, '').trimEnd() + '\n';
}
function safeJSON(t) {
  const m = String(t || '').replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

export async function planBuild(request, deps) {
  const mods = await remoteText('data/modules.json');
  let known = '';
  try { const j = JSON.parse(mods); known = (j.modules || []).map((x) => x.id).join(', '); } catch { known = '(unknown)'; }
  const r = await deps.llm([
    { role: 'system', content: 'You are the NASUR chief architect. ' + ARCH + ' Return ONLY JSON.' },
    { role: 'user', content: `Request from Nasur: "${request}"\nExisting module ids (do not reuse): ${known}\nPlan the SMALLEST set of files (max ${MAX_FILES}; prefer ONE js file + ONE css file for a module). Allowed paths: js/modules/<id>.js, js/services/<name>.js, js/jarvis/<name>.js, css/<name>.css, data/<name>.json. JSON shape: {"goal":"one line","module":{"id":"snake_case","title":"","icon":"emoji","description":"one line","group":"core|field|knowledge|execution|people|system","pdca":"plan|do|check|act"} or null,"files":[{"path":"","spec":"very detailed spec: UI sections, data, behaviour, edge cases, accessibility"}]}` },
  ], { temperature: 0.2, timeout: 90000, noCache: true, maxTokens: 2500 });
  const j = safeJSON(r.text);
  if (!j || !Array.isArray(j.files) || !j.files.length) throw new Error('the planner returned no usable plan');
  if (j.module && j.module.id) j.module.id = String(j.module.id).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  j.files = j.files.slice(0, MAX_FILES).map((f) => ({ path: String(f.path || '').replace(/^\/+/, ''), spec: String(f.spec || '') }));
  return { plan: j, provider: r.provider };
}

/** Writes one file, checks it, and repairs it up to MAX_REPAIRS times. */
export async function produceFile(f, plan, deps, files) {
  const log = deps.log || (() => {});
  let styleRef = null;
  if (/^js\/modules\//.test(f.path)) { const t = await remoteText('js/modules/ppe_guide.js') || await remoteText('js/modules/settings.js'); if (t) styleRef = t.slice(0, 3500); }
  let code = '', last = { errors: [], warnings: [], info: {} }, attempts = 0;
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
    attempts = attempt;
    const user = `File: ${f.path}\nOverall goal: ${plan.goal}\nThis file's spec: ${f.spec}\nAll files in this build: ${plan.files.map((x) => x.path).join(', ')}\n` +
      (styleRef ? `\nSTYLE REFERENCE (existing module; mimic its conventions, do not copy its content):\n${styleRef}\n` : '') +
      (attempt > 0 ? `\nYour previous version FAILED these automatic checks:\n- ${last.errors.join('\n- ')}\nReturn the COMPLETE corrected file (if it was cut off, write a shorter, simpler complete version).\nPREVIOUS VERSION:\n${code.slice(0, 12000)}` : '');
    const r = await deps.llm([
      { role: 'system', content: 'You are a principal JavaScript engineer. ' + ARCH + ' Output EXACTLY one fenced code block containing the complete file and nothing else.' },
      { role: 'user', content: user }], { temperature: attempt ? 0.1 : 0.2, timeout: 150000, noCache: true, maxTokens: 7000 });
    code = extractCode(r.text);
    last = await checkFile(f.path, code, { files });
    if (!last.errors.length) return { path: f.path, content: code, attempts, failed: false, errors: [], warnings: last.warnings, info: last.info, provider: r.provider };
    log(`🔧 ${f.path}: ${last.errors.length} problem(s) found — repair ${Math.min(attempt + 1, MAX_REPAIRS)}/${MAX_REPAIRS}`);
  }
  return { path: f.path, content: code, attempts, failed: true, errors: last.errors, warnings: last.warnings, info: last.info, provider: null };
}

/* ------------------------------ MODULE REGISTRATION ------------------------------ */
export async function buildRegistry(mod) {
  const raw = await remoteText('data/modules.json', true);
  if (!raw) return { error: 'data/modules.json could not be read' };
  let j; try { j = JSON.parse(raw); } catch { return { error: 'data/modules.json is not valid JSON' }; }
  const arr = Array.isArray(j.modules) ? j.modules : null;
  if (!arr) return { error: 'data/modules.json has no modules list' };
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(mod.id)) return { error: 'module id "' + mod.id + '" is not valid' };
  const route = '/' + mod.id.replace(/_/g, '-');
  if (arr.some((m) => m && (m.id === mod.id || m.route === route))) return { error: 'a module with id "' + mod.id + '" or route ' + route + ' already exists' };
  const groups = (j.groups || []).map((g) => g.id); const stages = (j.pdca_stages || []).map((s) => s.id);
  const entry = {
    id: mod.id, route, title: String(mod.title || mod.id).slice(0, 40), icon: mod.icon || '🧩', description: String(mod.description || mod.title || mod.id).slice(0, 140),
    group: groups.includes(mod.group) ? mod.group : 'execution', pdca: stages.includes(mod.pdca) ? mod.pdca : 'do',
    phase: (j.registry_phase || 6) + 1, status: 'active', builtin: false, file: 'js/modules/' + mod.id + '.js', nav: false,
  };
  const at = arr.findIndex((m) => m && m.id === 'more');
  if (at >= 0) arr.splice(at, 0, entry); else arr.push(entry);
  return { path: 'data/modules.json', content: JSON.stringify(j, null, 2) + '\n', entry };
}

/* ------------------------------ FULL BUILD (up to PREVIEW) ------------------------------ */
/** Plans, writes, checks and repairs. Never deploys. Resolves the pending package. */
export async function buildFromRequest(request, deps) {
  const log = deps.log || (() => {});
  log('🧭 **Plan** — reading the repo and planning the files …');
  const { plan } = await planBuild(request, deps);
  log('📐 Plan: ' + plan.files.map((f) => '`' + f.path + '`').join(', '));
  const blocked = []; const todo = [];
  for (const f of plan.files) {
    const problem = pathProblem(f.path, !!deps.allowCore);
    if (problem) blocked.push({ path: f.path || '(empty)', reason: problem }); else todo.push(f);
  }
  const files = new Map(); const out = [];
  for (const f of todo) {
    log('🔨 **Build** — writing `' + f.path + '` …');
    try {
      const r = await produceFile(f, plan, deps, files);
      files.set(f.path, r.content); out.push(r);
      log(r.failed ? `❌ \`${f.path}\` still has ${r.errors.length} problem(s) after ${MAX_REPAIRS} repairs` : `✔ \`${f.path}\` passed the checks (${r.attempts} repair${r.attempts === 1 ? '' : 's'})`);
    } catch (e) {
      if (e && e.message === 'ai_disabled') throw e;
      out.push({ path: f.path, content: '', attempts: 0, failed: true, errors: ['generation failed: ' + (e && e.message ? e.message : 'unknown error')], warnings: [], info: {} });
    }
  }
  for (const r of out) { r.overwrite = (await remoteText(r.path, true)) != null; }

  let registry = null; let registryError = null;
  if (plan.module && plan.module.id && out.some((r) => /^js\/modules\/[a-z0-9_]+\.js$/.test(r.path) && !r.failed)) {
    const jsFile = out.find((r) => r.path === 'js/modules/' + plan.module.id + '.js');
    if (!jsFile) registryError = 'plan did not include js/modules/' + plan.module.id + '.js, so the module was not registered';
    else { const reg = await buildRegistry(plan.module); if (reg.error) registryError = reg.error; else registry = reg; }
  }
  const ok = out.length > 0 && out.every((r) => !r.failed) && !registryError;
  return { id: 'build_' + Date.now().toString(36), goal: plan.goal, request, files: out, registry, registryError, blocked, moduleId: plan.module ? plan.module.id : null, route: registry ? registry.entry.route : null, ok, createdAt: Date.now() };
}

/** The review text shown to Nasur before he decides. */
export function describePending(p) {
  const L = [];
  L.push(p.ok ? '## 🧪 Build ready for your review' : '## ⚠ Build NOT ready — it cannot be deployed');
  L.push('**Goal:** ' + p.goal, '');
  p.files.forEach((f) => {
    L.push(`${f.failed ? '❌' : '✅'} **${f.path}** — ${f.info && f.info.bytes ? Math.round(f.info.bytes / 100) / 10 + ' KB' : 'empty'}${f.overwrite ? ' · ⚠ OVERWRITES an existing file' : ' · new file'}${f.attempts ? ' · repaired ' + f.attempts + '×' : ''}`);
    if (f.failed) f.errors.slice(0, 6).forEach((e) => L.push('   - ' + e));
    else if (f.warnings.length) f.warnings.slice(0, 3).forEach((w) => L.push('   - ⚠ ' + w));
  });
  if (p.registry) L.push('', '📌 Module entry for the menu prepared: `' + p.registry.entry.route + '` (not shown in the bottom bar; opens from All Modules).');
  if (p.registryError) L.push('', '❌ Registration problem: ' + p.registryError);
  if (p.blocked.length) { L.push('', '⏭ **Blocked paths:**'); p.blocked.forEach((b) => L.push('- ' + b.path + ' — ' + b.reason)); }
  L.push('', '**What was checked:** brackets/strings, forbidden patterns (inline styles, eval, external scripts, direct database access), the render(ctx) contract, imports that must exist, imported names that must be exported.',
    '**What was NOT checked:** the code was not executed or clicked through (the page security policy blocks running it). Read it, and test the module after deploy.');
  L.push(p.ok ? '\nTap **Approve & deploy** only if you are happy. A rollback pack is saved first.' : '\nFix the problems above (try the request again, in smaller steps).');
  return L.join('\n');
}

/* ------------------------------ DEPLOY ------------------------------ */
const b64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin); };

async function hfCommitRaw(deps, summary, putFiles, deletePaths) {
  if (!deps.hfToken) throw new Error('Add your Hugging Face WRITE token in JARVIS settings (⚙ → Advanced) first.');
  const repo = deps.hfRepo || 'Nasurisai/Nasur';
  const lines = [JSON.stringify({ key: 'header', value: { summary: String(summary).slice(0, 120) } })];
  putFiles.forEach((f) => lines.push(JSON.stringify({ key: 'file', value: { path: f.path, content: b64(f.content), encoding: 'base64' } })));
  (deletePaths || []).forEach((p) => lines.push(JSON.stringify({ key: 'deletedFile', value: { path: p } })));
  const r = await fetchT('https://huggingface.co/api/spaces/' + repo + '/commit/main', { method: 'POST', headers: { Authorization: 'Bearer ' + deps.hfToken, 'Content-Type': 'application/x-ndjson' }, body: lines.join('\n') }, 60000);
  if (!r.ok) { const t = await r.text(); throw new Error('Hugging Face refused the commit (' + r.status + '): ' + t.slice(0, 160)); }
  return true;
}

/**
 * Deploys an approved build. opts.approved must be true (the Approve button).
 * Re-checks paths, refuses failed builds, saves a rollback pack first.
 * Resolves { ok, files, rollback }.
 */
export async function commit(pending, deps, opts = {}) {
  if (opts.approved !== true) throw new Error('Not approved — nothing was deployed.');
  if (!pending || !pending.ok) throw new Error('This build did not pass the checks, so it cannot be deployed.');
  const put = pending.files.map((f) => ({ path: f.path, content: f.content }));
  if (pending.registry) put.push({ path: pending.registry.path, content: pending.registry.content });
  for (const f of put) {
    if (f.path === 'data/modules.json') continue;
    const problem = pathProblem(f.path, !!deps.allowCore);
    if (problem) throw new Error(f.path + ': ' + problem);
  }
  const restore = []; const remove = [];
  for (const f of put) { const old = await remoteText(f.path, true); if (old != null) restore.push({ path: f.path, content: old }); else remove.push(f.path); }
  const rollback = { repo: deps.hfRepo || 'Nasurisai/Nasur', createdAt: Date.now(), goal: pending.goal, restore, remove };
  await hfCommitRaw(deps, 'JARVIS approved build: ' + pending.goal, put, []);
  put.forEach((f) => remoteCache.delete(f.path));
  return { ok: true, files: put.map((f) => f.path), rollback };
}

/** Undoes a commit() using its rollback pack (restores old files, deletes new ones). */
export async function rollback(pack, deps) {
  if (!pack || (!pack.restore && !pack.remove)) throw new Error('No rollback pack available.');
  await hfCommitRaw(deps, 'JARVIS rollback: ' + (pack.goal || 'last build'), pack.restore || [], pack.remove || []);
  (pack.restore || []).concat((pack.remove || []).map((p) => ({ path: p }))).forEach((f) => remoteCache.delete(f.path));
  return true;
}

/** Polls the live site until every deployed file matches what was sent (or gives up). */
export async function verifyDeployed(files, { tries = 9, waitMs = 10000, onProgress = () => {} } = {}) {
  const norm = (s) => String(s).replace(/\r\n/g, '\n').trim();
  const pending = new Map(files.map((f) => [f.path, f.content])); const result = [];
  for (let t = 0; t < tries && pending.size; t += 1) {
    await new Promise((res) => setTimeout(res, t === 0 ? 4000 : waitMs));
    for (const [path, content] of Array.from(pending)) {
      const live = await remoteText(path, true);
      if (live != null && norm(live) === norm(content)) { pending.delete(path); result.push({ path, ok: true, note: 'live and identical' }); }
    }
    try { onProgress(files.length - pending.size, files.length, t + 1); } catch { /* ignore */ }
  }
  pending.forEach((_, path) => result.push({ path, ok: false, note: 'not live yet — the Space may still be rebuilding; reload in a minute' }));
  return result;
}
