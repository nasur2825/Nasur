/* NASUR - JARVIS self-extension engine (Phase 4)
   Uses the user's own API keys (Gemini, Groq, NVIDIA NIM, OpenRouter) with automatic fallback and an
   offline drafting engine to generate custom observation columns, report templates, checklists/forms and
   local safety rules. Everything is validated, proposed as "pending", and saved only after the user says Okay. */
import { STORES } from '../core/config.js';
import * as repo from './repo.js';
import { getUserConfig } from './config.js';
import { getActiveProviders, getApiKey, limitInput } from './settings.js';
import { getActiveRegion, getActiveIndustryId } from './regions.js';
import { getProjectContext } from './clients.js';
import { BASE_COLUMNS } from './observations.js';
import { validatePayload, proposeTemplate, approveTemplate, rejectTemplate, SECTION_TYPES, COLUMN_TYPES, CHECKLIST_PURPOSES } from './templates.js';

const AUDIT_STORE = (STORES && STORES.AUDIT_LOG) || 'audit_log';
const TIMEOUT_MS = 45000;

const PROVIDER_CFG = {
  gemini: { api: 'gemini', model: 'gemini-2.0-flash' },
  groq: { api: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
  nvidia: { api: 'openai', url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.1-70b-instruct' },
  openrouter: { api: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/auto' }
};

/* ---------- Intent detection (English + a few Tanglish / Tamil / Hindi / Arabic hints) ---------- */

export function detectIntent(text) {
  const t = String(text || '').toLowerCase();
  if (/(safety rule|\brule(s)?\b|\blaw(s)?\b|regulation|standard|sattam|சட்டம்|कानून|قانون|ptw procedure)/.test(t)) return 'safety_rule';
  if (/(column|field|kolum|new field)/.test(t)) return 'custom_column';
  if (/(report template|report format|weekly report|monthly report|report layout|template for report)/.test(t)) return 'report_template';
  if (/(checklist|check list|inspection list|ptw form|jsa form|\bform\b|permit form|audit form)/.test(t)) return 'checklist';
  return null;
}

/* ---------- Prompt building ---------- */

async function contextText() {
  const region = getActiveRegion();
  const ctx = await getProjectContext();
  const cfg = getUserConfig() || {};
  const lines = [
    'Country/region pack: ' + region.label + '.',
    'Industry: ' + getActiveIndustryId() + '.',
    'Preferred language of the user: ' + (cfg.language || 'en') + '.'
  ];
  if (ctx) {
    lines.push('Active project: ' + ctx.project.name + (ctx.project.site ? ' at ' + ctx.project.site : '') + '.');
    lines.push('Audit standard: ' + ctx.auditStandard + '.');
    if (ctx.client) lines.push('Client: ' + ctx.client.name + '.');
    if (ctx.requirements && ctx.requirements.length) lines.push('Saved client requirements: ' + ctx.requirements.map((r) => r.title).join('; ') + '.');
  }
  return lines.join(' ');
}

const SCHEMAS = {
  custom_column:
    '{"label":"short column name","type":"' + COLUMN_TYPES.join('|') + '","options":["only when type is select, 2 to 12 short options"],"help":"one short line"}',
  report_template:
    '{"title":"report title","subtitle":"optional","sections":[{"type":"' + SECTION_TYPES.join('|') + '","title":"section heading","columns":["only for observation_table; use these keys only: ' + BASE_COLUMNS.map((c) => c.key).join(', ') + '"],"limit":50,"text":"only for type text"}],"signoffRoles":["Prepared By","Reviewed By","Approved By"]}',
  checklist:
    '{"title":"checklist title","purpose":"' + CHECKLIST_PURPOSES.join('|') + '","category":"area or activity","items":[{"text":"clear yes/no check","type":"yesno|text|number","critical":false,"reference":"standard or law, optional"}]}',
  safety_rule:
    '{"rules":[{"title":"short title","summary":"what the rule requires in plain words","clause":"law or standard name and clause if you are sure, otherwise the law name only","source":"issuing body or document","region":"india|gulf|canada|usa|all","industry":"manufacturing|construction|oilgas|marine|all","category":"topic","appliesTo":["tasks or equipment"]}]}'
};

async function systemPrompt(kind) {
  return (
    'You are JARVIS, a veteran HSE director with 50 years of experience helping a safety professional configure a field safety app. ' +
    'Reply with ONE JSON object only. No markdown, no commentary, no emojis. ' +
    'Never invent law or clause numbers. If you are not sure of an exact clause, give the name of the law or standard only. ' +
    'Keep wording plain, practical and suitable for site use. ' +
    (kind === 'safety_rule' ? 'Return at most 6 rules. These come from your general knowledge and may be out of date, so keep them factual and brief. ' : '') +
    'Context: ' + (await contextText()) + ' ' +
    'JSON shape: ' + SCHEMAS[kind]
  );
}

/* ---------- Provider calls ---------- */

function withTimeout(ms) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(id) };
}

function modelFor(provider) {
  const cfg = getUserConfig() || {};
  return (cfg.aiModels && cfg.aiModels[provider]) || PROVIDER_CFG[provider].model;
}

async function callProvider(provider, system, user) {
  const p = PROVIDER_CFG[provider];
  const key = getApiKey(provider);
  if (!p || !key) throw new Error('No key for ' + provider);
  const t = withTimeout(TIMEOUT_MS);
  try {
    if (p.api === 'gemini') {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelFor(provider)) + ':generateContent?key=' + encodeURIComponent(key);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: t.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
      const j = await res.json();
      const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      return (parts || []).map((x) => x.text || '').join('');
    }
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = location.origin;
      headers['X-Title'] = 'NASUR';
    }
    const body = { model: modelFor(provider), temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (provider === 'groq') body.response_format = { type: 'json_object' };
    const res = await fetch(p.url, { method: 'POST', headers, signal: t.signal, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(provider + ' HTTP ' + res.status);
    const j = await res.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  } finally {
    t.done();
  }
}

export function extractJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

export async function testProvider(provider) {
  try {
    const out = await callProvider(provider, 'Reply with the JSON {"ok":true} only.', 'ping');
    const j = extractJson(out);
    return !!(j && j.ok);
  } catch (e) {
    return false;
  }
}

/* ---------- Offline drafting (works with no internet and no key) ---------- */

export function offlineDraft(kind, request) {
  const text = String(request || '').trim();
  if (kind === 'custom_column') {
    const m = /(?:column|field)\s*(?:called|named|for|:)?\s*["'“]?([^"'”.\n,]{2,40})/i.exec(text);
    if (!m) return null;
    const label = m[1].trim().replace(/^(a|an|the)\s+/i, '');
    const lower = text.toLowerCase();
    let type = 'text';
    let options = [];
    if (/\bdate\b/.test(lower)) type = 'date';
    else if (/(number|count|hours|cost|amount|quantity)/.test(lower)) type = 'number';
    else if (/yes\s*(\/|or)\s*no/.test(lower)) type = 'yesno';
    const opt = /(?:options?|choices?|values?)\s*[:\-]\s*([^\n.]+)/i.exec(text);
    if (opt) {
      options = opt[1].split(/[,/|]/).map((x) => x.trim()).filter(Boolean);
      if (options.length >= 2) type = 'select';
    }
    return { label, type, options, help: '' };
  }
  if (kind === 'checklist') {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter((l) => l.length > 3);
    const title = /checklist\s+(?:for|of)\s+([^\n.]{3,60})/i.exec(text);
    const items = lines.length > 2 ? lines.slice(title ? 1 : 0) : [];
    if (items.length < 2) return null;
    return { title: title ? 'Checklist: ' + title[1].trim() : lines[0].slice(0, 60), purpose: 'inspection', category: '', items: items.map((t) => ({ text: t, type: 'yesno', critical: false })) };
  }
  return null;
}

/* ---------- Generation ---------- */

export async function generate(kind, request) {
  const user = limitInput(request).trim();
  if (user.length < 3) throw new Error('Tell JARVIS what you need');
  if (!['custom_column', 'report_template', 'checklist', 'safety_rule'].includes(kind)) throw new Error('Unknown request type');
  const warnings = [];
  const providers = navigator.onLine === false ? [] : getActiveProviders();
  if (navigator.onLine === false) warnings.push('Offline: using the built-in drafting engine.');
  const system = providers.length ? await systemPrompt(kind) : '';

  for (const provider of providers) {
    try {
      const raw = await callProvider(provider, system, user);
      const json = extractJson(raw);
      if (!json) throw new Error('Not valid JSON');
      const payloads = [];
      if (kind === 'safety_rule') {
        (Array.isArray(json.rules) ? json.rules : []).forEach((r) => {
          const v = validatePayload('safety_rule', { ...r, source: (r.source ? r.source + ' ' : '') + '(JARVIS draft, verify with the official text)' });
          if (v.ok) payloads.push(v.clean);
        });
      } else {
        const v = validatePayload(kind, json);
        if (v.ok) payloads.push(v.clean);
        else warnings.push(provider + ': ' + v.errors.join('; '));
      }
      if (payloads.length) return { kind, payloads, provider, source: 'ai', warnings };
    } catch (e) {
      warnings.push(provider + ': ' + (e && e.name === 'AbortError' ? 'timed out' : e.message));
    }
  }

  const off = offlineDraft(kind, user);
  if (off) {
    const v = validatePayload(kind, off);
    if (v.ok) return { kind, payloads: [v.clean], provider: 'offline', source: 'offline', warnings };
    warnings.push('offline: ' + v.errors.join('; '));
  }
  const hint = providers.length ? 'All AI providers failed.' : 'Add an API key in Settings so JARVIS can build this.';
  throw new Error(hint + (warnings.length ? ' (' + warnings.join(' | ') + ')' : ''));
}

async function logAudit(action, detail) {
  try {
    await repo.save(AUDIT_STORE, { id: 'aud_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), action, detail, at: new Date().toISOString() });
  } catch (e) {
    /* audit logging is best effort */
  }
}

/* Generate and store as PENDING. Nothing becomes active until approve() */
export async function proposeFromRequest(kind, request) {
  const gen = await generate(kind, request);
  const records = [];
  for (const payload of gen.payloads) {
    records.push(await proposeTemplate(kind, payload, String(request).slice(0, 300)));
  }
  await logAudit('template_proposed', { kind, count: records.length, provider: gen.provider });
  return { ...gen, records };
}

export async function approve(id) {
  const rec = await approveTemplate(id);
  if (rec) await logAudit('template_approved', { id, kind: rec.kind, title: rec.title });
  return rec;
}

export async function reject(id) {
  await rejectTemplate(id);
  await logAudit('template_rejected', { id });
  return true;
}

export function askToSaveText(kind, records) {
  const lang = (getUserConfig() || {}).language;
  const opener = lang === 'ta' ? 'Macha, ' : lang === 'hi' ? 'Dost, ' : '';
  const n = records.length;
  if (kind === 'safety_rule') return opener + 'I found these new rules/standards (' + n + '). Shall I save them into your app?';
  if (kind === 'custom_column') return opener + 'I prepared a new observation column "' + records[0].title + '". Shall I add it to your sheet?';
  if (kind === 'report_template') return opener + 'I prepared a new report template "' + records[0].title + '". Shall I save it?';
  return opener + 'I prepared the checklist "' + records[0].title + '" with ' + (records[0].payload.items || []).length + ' items. Shall I save it into your app?';
}
