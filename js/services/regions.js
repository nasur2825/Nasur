/* NASUR - Region / Country pack service (Phase 3) */
import { getUserConfig, updateUserConfig } from './config.js';

const DATA_URL = 'data/regions.json';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const FALLBACK = {
  version: 1,
  defaultRegion: 'india',
  industries: [
    { id: 'manufacturing', label: 'Manufacturing' },
    { id: 'construction', label: 'Construction' },
    { id: 'oilgas', label: 'Oil & Gas' },
    { id: 'marine', label: 'Shipping / Marine' }
  ],
  regions: {
    india: {
      id: 'india',
      label: 'India',
      flag: 'IN',
      languages: ['ta', 'en', 'hi'],
      units: { system: 'metric', temp: 'C', length: 'm', weight: 'kg', pressure: 'bar' },
      format: { date: 'DD/MM/YYYY', time: '24h', currency: 'INR', currencySymbol: '₹', weekStart: 1 },
      timezone: 'Asia/Kolkata',
      emergency: { unified: '112', ambulance: '108', fire: '101', police: '100' },
      laws: [
        { id: 'oshcode', title: 'Occupational Safety, Health and Working Conditions Code, 2020', type: 'law' },
        { id: 'factories', title: 'Factories Act, 1948', type: 'law' }
      ],
      standards: ['ISO 45001:2018'],
      auditSystems: ['ISO 45001'],
      heat: { indexType: 'WBGT' },
      hazards: [],
      ptw: { systems: ['Hot Work', 'Confined Space', 'Work at Height'], tbtLanguages: ['ta', 'hi', 'en'] }
    }
  }
};

let cache = null;
let loading = null;

export async function loadRegions() {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json || !json.regions) throw new Error('Bad regions data');
      cache = json;
    } catch (err) {
      console.warn('[regions] using fallback pack:', err && err.message);
      cache = FALLBACK;
    }
    loading = null;
    return cache;
  })();
  return loading;
}

export function getRegionsData() {
  return cache || FALLBACK;
}

export function listRegions() {
  return Object.values(getRegionsData().regions);
}

export function listIndustries() {
  return getRegionsData().industries || [];
}

export function getRegion(id) {
  const data = getRegionsData();
  return data.regions[id] || data.regions[data.defaultRegion] || Object.values(data.regions)[0];
}

export function getActiveRegionId() {
  const cfg = getUserConfig() || {};
  const data = getRegionsData();
  return data.regions[cfg.region] ? cfg.region : data.defaultRegion;
}

export function getActiveRegion() {
  return getRegion(getActiveRegionId());
}

export function getActiveSubRegionId() {
  const cfg = getUserConfig() || {};
  const region = getActiveRegion();
  const subs = region.subRegions || [];
  if (!subs.length) return null;
  return subs.some((s) => s.id === cfg.subRegion) ? cfg.subRegion : subs[0].id;
}

export function getActiveIndustryId() {
  const cfg = getUserConfig() || {};
  const list = listIndustries();
  return list.some((i) => i.id === cfg.industry) ? cfg.industry : (list[0] && list[0].id) || 'manufacturing';
}

export async function setActiveRegion(id, subRegion) {
  const region = getRegion(id);
  const subs = region.subRegions || [];
  const sub = subs.some((s) => s.id === subRegion) ? subRegion : subs[0] ? subs[0].id : null;
  const cfg = getUserConfig() || {};
  const patch = { region: region.id, subRegion: sub };
  if (!cfg.language || !region.languages.includes(cfg.language)) patch.language = region.languages[0];
  await updateUserConfig(patch);
  return region;
}

export async function setActiveSubRegion(subRegion) {
  const region = getActiveRegion();
  const subs = region.subRegions || [];
  if (!subs.some((s) => s.id === subRegion)) return null;
  await updateUserConfig({ subRegion });
  return subRegion;
}

export async function setActiveIndustry(industry) {
  if (!listIndustries().some((i) => i.id === industry)) return null;
  await updateUserConfig({ industry });
  return industry;
}

export function getLaws() {
  return getActiveRegion().laws || [];
}

export function getStandards() {
  return getActiveRegion().standards || [];
}

export function getAuditSystems() {
  return getActiveRegion().auditSystems || [];
}

export function getEmergency() {
  return getActiveRegion().emergency || {};
}

export function getPtwSystems() {
  const r = getActiveRegion();
  return (r.ptw && r.ptw.systems) || [];
}

export function getTbtLanguages() {
  const r = getActiveRegion();
  return (r.ptw && r.ptw.tbtLanguages) || r.languages || ['en'];
}

export function getHeatInfo() {
  const r = getActiveRegion();
  const heat = r.heat || {};
  const sub = getActiveSubRegionId();
  const ban = heat.middayBan && sub ? heat.middayBan[sub] : null;
  return { indexType: heat.indexType || 'WBGT', note: heat.note || '', middayBan: ban };
}

function monthIndex(token) {
  return MONTHS.indexOf(String(token || '').slice(0, 3).toLowerCase());
}

export function isInSeason(season, date) {
  if (!season || /all/i.test(season)) return true;
  const parts = String(season).split('-');
  const a = monthIndex(parts[0]);
  const b = monthIndex(parts[1] || parts[0]);
  if (a < 0 || b < 0) return true;
  const m = (date || new Date()).getMonth();
  return a <= b ? m >= a && m <= b : m >= a || m <= b;
}

export function getHazards(date) {
  return (getActiveRegion().hazards || []).map((h) => ({ ...h, active: isInSeason(h.season, date) }));
}

export function getSeasonalHazards(date) {
  return getHazards(date).filter((h) => h.active);
}

/* ---------- Units & formatting ---------- */

export function getUnits() {
  const cfg = getUserConfig() || {};
  const base = { ...(getActiveRegion().units || {}) };
  if (cfg.unitSystem === 'metric') return { system: 'metric', temp: 'C', length: 'm', weight: 'kg', pressure: 'bar' };
  if (cfg.unitSystem === 'imperial') return { system: 'imperial', temp: 'F', length: 'ft', weight: 'lb', pressure: 'psi' };
  return base;
}

function round(n, d) {
  const p = Math.pow(10, d == null ? 1 : d);
  return Math.round(n * p) / p;
}

export function formatTemp(celsius) {
  if (celsius == null || isNaN(celsius)) return '--';
  const u = getUnits();
  return u.temp === 'F' ? round(celsius * 9 / 5 + 32, 0) + '°F' : round(celsius, 0) + '°C';
}

export function formatLength(meters) {
  if (meters == null || isNaN(meters)) return '--';
  return getUnits().length === 'ft' ? round(meters * 3.28084, 1) + ' ft' : round(meters, 1) + ' m';
}

export function formatWeight(kg) {
  if (kg == null || isNaN(kg)) return '--';
  return getUnits().weight === 'lb' ? round(kg * 2.20462, 1) + ' lb' : round(kg, 1) + ' kg';
}

export function formatPressure(bar) {
  if (bar == null || isNaN(bar)) return '--';
  const u = getUnits().pressure;
  if (u === 'psi') return round(bar * 14.5038, 1) + ' psi';
  if (u === 'kPa') return round(bar * 100, 0) + ' kPa';
  return round(bar, 2) + ' bar';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '--';
  const f = (getActiveRegion().format || {}).date || 'DD/MM/YYYY';
  return f.replace('YYYY', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('DD', pad(d.getDate()));
}

export function formatTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '--';
  const f = (getActiveRegion().format || {}).time || '24h';
  if (f === '12h') {
    const h = d.getHours();
    return (h % 12 || 12) + ':' + pad(d.getMinutes()) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function formatDateTime(value) {
  return formatDate(value) + ' ' + formatTime(value);
}

export function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '--';
  const f = getActiveRegion().format || {};
  let txt;
  try {
    txt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount);
  } catch (e) {
    txt = String(Math.round(amount));
  }
  return (f.currencySymbol || f.currency || '') + ' ' + txt;
}

export function getWeekStart() {
  return (getActiveRegion().format || {}).weekStart || 0;
}

export function getTimezone() {
  return getActiveRegion().timezone || 'UTC';
}
