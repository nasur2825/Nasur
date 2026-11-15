/* NASUR - Activity Encyclopedia service (Phase 5)
   Loads the offline activity library and bridges it into Observations and Toolbox Talks. */
import { getActiveRegion, getActiveRegionId } from './regions.js';
import { createObservation, createDraft } from './observations.js';
import { saveTemplate } from './templates.js';

const FILES = ['data/encyclopedia/activities_core.json', 'data/encyclopedia/activities_more.json'];

export const INDUSTRY_LABELS = {
  manufacturing: 'Manufacturing',
  construction: 'Construction',
  oilgas: 'Oil & Gas',
  marine: 'Marine / Ship',
  food_safety: 'Food Safety',
  warehouse_logistics: 'Warehouse & Logistics',
  facilities_maintenance: 'Facilities & Maintenance'
};

export const REGION_LABELS = { india: 'India', gulf: 'Gulf (UAE / Saudi / Qatar)', canada: 'Canada', usa: 'USA' };

export const HIERARCHY_ORDER = [
  { id: 'elimination', label: '1. Elimination', note: 'Remove the hazard completely' },
  { id: 'substitution', label: '2. Substitution', note: 'Replace with something safer' },
  { id: 'engineering', label: '3. Engineering controls', note: 'Isolate people from the hazard' },
  { id: 'administrative', label: '4. Administrative controls', note: 'Procedures, training, permits (SSOW)' },
  { id: 'ppe', label: '5. PPE', note: 'Last line of defence' }
];

let cache = null;
let loading = null;
let loadError = '';

export async function loadEncyclopedia() {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    const out = [];
    const seen = new Set();
    const results = await Promise.allSettled(FILES.map((f) => fetch(f, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f + ' HTTP ' + r.status))))));
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value && Array.isArray(r.value.activities)) {
        r.value.activities.forEach((a) => {
          if (a && a.id && !seen.has(a.id)) {
            seen.add(a.id);
            out.push(a);
          }
        });
      } else if (r.status === 'rejected') {
        loadError = r.reason && r.reason.message ? r.reason.message : 'Could not load';
      }
    });
    cache = out;
    loading = null;
    return cache;
  })();
  return loading;
}

export function getLoadError() {
  return loadError;
}

export function allActivities() {
  return cache || [];
}

export function getActivity(id) {
  return allActivities().find((a) => a.id === id) || null;
}

export function listIndustries() {
  const used = new Set();
  allActivities().forEach((a) => (a.industries || []).forEach((i) => used.add(i)));
  return Object.keys(INDUSTRY_LABELS)
    .filter((i) => used.has(i))
    .map((i) => ({ id: i, label: INDUSTRY_LABELS[i] }));
}

export function listCategories() {
  return Array.from(new Set(allActivities().map((a) => a.category))).sort();
}

function score(a, words) {
  const hay = {
    title: String(a.title || '').toLowerCase(),
    cat: String(a.category || '').toLowerCase(),
    sum: String(a.summary || '').toLowerCase(),
    haz: (a.hazards || []).join(' ').toLowerCase(),
    hid: ((a.walkthrough && a.walkthrough.hidden_hazards) || []).join(' ').toLowerCase(),
    ppe: (a.ppe || []).join(' ').toLowerCase()
  };
  let s = 0;
  for (const w of words) {
    let hit = 0;
    if (hay.title.indexOf(w) >= 0) hit = Math.max(hit, 5);
    if (hay.cat.indexOf(w) >= 0) hit = Math.max(hit, 3);
    if (hay.haz.indexOf(w) >= 0) hit = Math.max(hit, 3);
    if (hay.sum.indexOf(w) >= 0) hit = Math.max(hit, 2);
    if (hay.hid.indexOf(w) >= 0 || hay.ppe.indexOf(w) >= 0) hit = Math.max(hit, 1);
    if (!hit) return 0;
    s += hit;
  }
  return s;
}

export function listActivities(filter) {
  const f = filter || {};
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  let rows = allActivities().filter((a) => (!f.industry || (a.industries || []).includes(f.industry)) && (!f.category || a.category === f.category));
  if (words.length) {
    rows = rows
      .map((a) => ({ a, s: score(a, words) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
  } else {
    rows = rows.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }
  return rows;
}

/* ---------- Legal standards by country ---------- */

export function getLegal(activity, regionId) {
  const r = regionId || getActiveRegionId();
  return (activity.legal && (activity.legal[r] || activity.legal.india)) || '';
}

export function legalForAll(activity) {
  return Object.keys(REGION_LABELS).map((id) => ({ id, label: REGION_LABELS[id], text: (activity.legal && activity.legal[id]) || '', active: id === getActiveRegionId() }));
}

/* ---------- Visual walkthrough ---------- */

export function walkthroughSteps(activity) {
  const w = activity.walkthrough || {};
  return [
    { id: 'where_first', title: 'Where to look first', tone: 'look', items: w.where_first || [] },
    { id: 'hidden', title: 'Hidden hazards people miss', tone: 'hidden', items: w.hidden_hazards || [] },
    { id: 'protect', title: 'Who needs protection first', tone: 'protect', items: w.protect_first || [] }
  ];
}

/* ---------- Bridge into Phase 4 Observations ---------- */

export function typicalFindings(activity) {
  return (activity.bridge && activity.bridge.typical) || [];
}

export function buildObservationDraft(activity, opts) {
  const o = opts || {};
  const b = activity.bridge || {};
  return {
    activity: b.activity || activity.title,
    hazard_category: b.hazard_category || 'Other',
    risk_rating: o.risk || b.risk_rating || 'Medium',
    description: o.finding || '',
    location: o.location || '',
    contractor: o.contractor || '',
    legal_clause: getLegal(activity, o.region)
  };
}

/* Creates a real row in the Observations sheet. date and time are confirmed by the caller. */
export async function createObservationFromActivity(activity, opts) {
  const o = opts || {};
  const base = await createDraft();
  const draft = buildObservationDraft(activity, o);
  const clean = {};
  Object.keys(draft).forEach((k) => {
    if (draft[k] !== '' && draft[k] != null) clean[k] = draft[k];
  });
  if (!String(clean.description || '').trim()) throw new Error('Describe what you saw');
  return createObservation({ ...base, ...clean, date: o.date || base.date, time: o.time || base.time });
}

/* ---------- Bridge into Toolbox Talks ---------- */

export function buildTbtText(activity) {
  const t = activity.tbt || {};
  const lines = [];
  lines.push('TOOLBOX TALK: ' + (t.title || activity.title));
  lines.push('Activity: ' + activity.title + ' · ' + getActiveRegion().label);
  lines.push('');
  lines.push('KEY POINTS');
  (t.points || []).forEach((p, i) => lines.push((i + 1) + '. ' + p));
  lines.push('');
  lines.push('MAIN HAZARDS: ' + (activity.hazards || []).slice(0, 4).join(', '));
  lines.push('PPE: ' + (activity.ppe || []).slice(0, 4).join('; '));
  if ((activity.permits || []).length) lines.push('PERMITS: ' + activity.permits.join('; '));
  lines.push('');
  lines.push('ASK THE CREW: ' + (t.question || ''));
  lines.push('');
  lines.push('Attendance: names, signatures and date.');
  return lines.join('\n');
}

export function tbtChecklistPayload(activity) {
  const t = activity.tbt || {};
  const items = (t.points || []).map((p) => ({ text: p, type: 'yesno', critical: false }));
  if (t.question) items.push({ text: 'Question asked: ' + t.question, type: 'text', critical: false });
  items.push({ text: 'Attendance sheet signed', type: 'yesno', critical: false });
  return { title: 'TBT: ' + (t.title || activity.title), purpose: 'tbt', category: activity.title, items };
}

export function inspectionChecklistPayload(activity) {
  return { title: activity.title + ' checklist', purpose: 'inspection', category: activity.category, items: (activity.checklist || []).map((c) => ({ text: c, type: 'yesno', critical: false })) };
}

export function saveTbt(activity) {
  return saveTemplate('checklist', tbtChecklistPayload(activity), { source: 'user' });
}

export function saveInspectionChecklist(activity) {
  return saveTemplate('checklist', inspectionChecklistPayload(activity), { source: 'user' });
}

export async function shareText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return true;
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return false;
  }
  throw new Error('Sharing is not available');
}
