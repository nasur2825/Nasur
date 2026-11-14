/* NASUR - Settings service (Phase 3): preferences, PIN lock, AI provider keys */
import { getUserConfig, updateUserConfig } from './config.js';
import { cleanText } from './sanitize.js';

export const MAX_INPUT_CHARS = 10000;

export const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', hint: 'aistudio.google.com' },
  { id: 'nvidia', label: 'NVIDIA NIM', hint: 'build.nvidia.com' },
  { id: 'groq', label: 'Groq', hint: 'console.groq.com' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'openrouter.ai' }
];

export const LANGUAGES = [
  { id: 'ta', label: 'தமிழ் (Tamil)' },
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी (Hindi)' },
  { id: 'ar', label: 'العربية (Arabic)' },
  { id: 'fr', label: 'Français (French)' },
  { id: 'es', label: 'Español (Spanish)' }
];

export const DEFAULTS = {
  unitSystem: 'region',
  fontScale: 1,
  reduceMotion: false,
  autoCompressPhotos: true,
  photoMaxEdge: 1280,
  photoQuality: 0.7,
  voiceReplies: false,
  voiceLang: 'en',
  providerOrder: ['gemini', 'groq', 'nvidia', 'openrouter'],
  apiKeys: {},
  offlineEngine: true,
  pinHash: '',
  pinSalt: '',
  pinEnabled: false
};

const SESSION_KEY = 'nasur.unlocked';

export function getSettings() {
  const cfg = getUserConfig() || {};
  const out = { ...DEFAULTS, ...cfg };
  out.apiKeys = { ...(cfg.apiKeys || {}) };
  out.providerOrder = normalizeOrder(cfg.providerOrder);
  return out;
}

export async function saveSettings(patch) {
  const clean = {};
  Object.keys(patch || {}).forEach((k) => {
    const v = patch[k];
    clean[k] = typeof v === 'string' ? cleanText(v, { max: 200 }) : v;
  });
  await updateUserConfig(clean);
  return getSettings();
}

/* ---------- Provider keys & fallback order ---------- */

function normalizeOrder(order) {
  const ids = PROVIDERS.map((p) => p.id);
  const base = Array.isArray(order) ? order.filter((id) => ids.includes(id)) : [];
  ids.forEach((id) => {
    if (!base.includes(id)) base.push(id);
  });
  return base;
}

export function getApiKey(provider) {
  const keys = (getUserConfig() || {}).apiKeys || {};
  return keys[provider] || '';
}

export async function setApiKey(provider, key) {
  if (!PROVIDERS.some((p) => p.id === provider)) return false;
  const keys = { ...((getUserConfig() || {}).apiKeys || {}) };
  const value = String(key || '').replace(/\s+/g, '').slice(0, 300);
  if (value) keys[provider] = value;
  else delete keys[provider];
  await updateUserConfig({ apiKeys: keys });
  return true;
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 4) + '••••' + key.slice(-3);
}

export async function setProviderOrder(order) {
  await updateUserConfig({ providerOrder: normalizeOrder(order) });
  return getSettings().providerOrder;
}

export async function moveProvider(provider, delta) {
  const order = getSettings().providerOrder.slice();
  const i = order.indexOf(provider);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  order.splice(j, 0, order.splice(i, 1)[0]);
  return setProviderOrder(order);
}

/* Ordered list of providers that have a key (used by JARVIS fallback chain) */
export function getActiveProviders() {
  const s = getSettings();
  return s.providerOrder.filter((id) => !!s.apiKeys[id]);
}

export function limitInput(text) {
  return String(text == null ? '' : text).slice(0, MAX_INPUT_CHARS);
}

/* ---------- PIN privacy lock ---------- */

function randomSalt() {
  const arr = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin);
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data[i]) >>> 0;
  return 'x' + h.toString(16);
}

export function isValidPin(pin) {
  return /^\d{4}$/.test(String(pin || ''));
}

export function hasPin() {
  const cfg = getUserConfig() || {};
  return !!(cfg.pinEnabled && cfg.pinHash);
}

export async function setPin(pin) {
  if (!isValidPin(pin)) return false;
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  await updateUserConfig({ pinHash: hash, pinSalt: salt, pinEnabled: true });
  markUnlocked();
  return true;
}

export async function verifyPin(pin) {
  const cfg = getUserConfig() || {};
  if (!cfg.pinEnabled || !cfg.pinHash) return true;
  if (!isValidPin(pin)) return false;
  const hash = await hashPin(pin, cfg.pinSalt || '');
  const ok = hash === cfg.pinHash;
  if (ok) markUnlocked();
  return ok;
}

export async function clearPin(currentPin) {
  if (hasPin() && !(await verifyPin(currentPin))) return false;
  await updateUserConfig({ pinHash: '', pinSalt: '', pinEnabled: false });
  return true;
}

export function markUnlocked() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch (e) {
    /* ignore */
  }
}

export function lockNow() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    /* ignore */
  }
}

export function isLocked() {
  if (!hasPin()) return false;
  try {
    return sessionStorage.getItem(SESSION_KEY) !== '1';
  } catch (e) {
    return true;
  }
}

/* ---------- Display preferences ---------- */

export function applyDisplayPrefs() {
  const s = getSettings();
  const root = document.documentElement;
  root.style.setProperty('--nasur-font-scale', String(s.fontScale));
  root.style.fontSize = Math.round(16 * s.fontScale) + 'px';
  root.classList.toggle('reduce-motion', !!s.reduceMotion);
}
