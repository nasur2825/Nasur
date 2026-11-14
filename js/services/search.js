/* NASUR - Smart History Search (Phase 4)
   Natural-language search across observations, incidents and CAPA actions.
   Example: "When did that welding issue happen?" */
import { formatDate, formatTime } from './regions.js';
import { listObservations, isOverdue as obsOverdue } from './observations.js';
import { listIncidents, severityOf, SEVERITIES } from './incidents.js';
import { listActions, isOverdue as actOverdue, isClosed } from './actions.js';

const STOP = new Set([
  'when', 'did', 'that', 'the', 'a', 'an', 'issue', 'issues', 'happen', 'happened', 'show', 'me', 'find', 'all', 'any', 'of', 'in', 'on',
  'was', 'were', 'is', 'are', 'what', 'which', 'where', 'who', 'record', 'records', 'log', 'logs', 'about', 'for', 'with', 'and', 'to',
  'from', 'last', 'this', 'we', 'i', 'had', 'have', 'has', 'there', 'our', 'my', 'search', 'list', 'give', 'tell', 'please', 'it', 'at',
  'by', 'year', 'month', 'week', 'day', 'days', 'ago', 'recent', 'latest', 'first', 'time', 'did', 'do', 'does', 'problem', 'problems'
]);

const SYN = {
  welding: ['weld', 'welding', 'hot work', 'hotwork', 'gas cutting', 'arc'],
  weld: ['weld', 'welding', 'hot work', 'hotwork'],
  fall: ['fall', 'height', 'scaffold', 'ladder', 'harness'],
  height: ['height', 'fall', 'scaffold', 'ladder', 'harness'],
  fire: ['fire', 'extinguisher', 'flame', 'burn', 'explosion'],
  electrical: ['electrical', 'electric', 'shock', 'cable', 'wiring', 'live wire'],
  crane: ['crane', 'lifting', 'sling', 'hoist', 'rigging'],
  lifting: ['lifting', 'crane', 'sling', 'hoist', 'rigging'],
  chemical: ['chemical', 'acid', 'solvent', 'spill', 'sds', 'hazardous'],
  ppe: ['ppe', 'helmet', 'glove', 'goggle', 'harness', 'boots', 'respirator', 'mask'],
  forklift: ['forklift', 'truck', 'vehicle', 'reversing'],
  excavation: ['excavation', 'trench', 'digging', 'shoring'],
  confined: ['confined', 'tank', 'manhole', 'vessel', 'entry']
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function iso(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ---------- Query parsing ---------- */

export function parseQuery(input) {
  let text = String(input || '').toLowerCase().trim();
  const q = { raw: input, from: '', to: '', types: [], risks: [], severities: [], statuses: [], keywords: [], wantsWhen: /\bwhen\b|எப்போது|متى|कब/.test(text), wantsLast: /\b(latest|last time|most recent|recent)\b/.test(text) };
  const now = new Date();

  const take = (re, fn) => {
    const m = re.exec(text);
    if (m) {
      fn(m);
      text = text.replace(m[0], ' ');
    }
  };

  take(/\btoday\b/, () => { q.from = q.to = iso(now); });
  take(/\byesterday\b/, () => { q.from = q.to = iso(addDays(now, -1)); });
  take(/\blast\s+(\d{1,3})\s+days?\b/, (m) => { q.from = iso(addDays(now, -parseInt(m[1], 10))); q.to = iso(now); });
  take(/\bthis week\b/, () => { q.from = iso(addDays(now, -((now.getDay() + 6) % 7))); q.to = iso(now); });
  take(/\blast week\b/, () => { const s = addDays(now, -((now.getDay() + 6) % 7) - 7); q.from = iso(s); q.to = iso(addDays(s, 6)); });
  take(/\bthis month\b/, () => { q.from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); q.to = iso(now); });
  take(/\blast month\b/, () => { q.from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)); q.to = iso(new Date(now.getFullYear(), now.getMonth(), 0)); });
  take(/\bthis year\b/, () => { q.from = iso(new Date(now.getFullYear(), 0, 1)); q.to = iso(now); });
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { q.from = q.to = m[0]; });
  take(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/, (m) => {
    const mi = MONTHS.indexOf(m[1]);
    const y = m[2] ? parseInt(m[2], 10) : mi > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    q.from = iso(new Date(y, mi, 1));
    q.to = iso(new Date(y, mi + 1, 0));
  });

  take(/\bnear[\s-]?miss(es)?\b/, () => { q.severities.push('near_miss'); q.types.push('incident'); });
  take(/\bfirst[\s-]?aid\b/, () => { q.severities.push('first_aid'); });
  take(/\b(lti|lost time)\b/, () => { q.severities.push('lti'); });
  take(/\bfatalit(y|ies)\b/, () => { q.severities.push('fatality'); });
  take(/\bmtc\b/, () => { q.severities.push('mtc'); });
  take(/\brwc\b/, () => { q.severities.push('rwc'); });
  take(/\bcritical\b/, () => q.risks.push('Critical'));
  take(/\bhigh[\s-]?risk\b|\bhigh\b/, () => q.risks.push('High'));
  take(/\bmedium\b/, () => q.risks.push('Medium'));
  take(/\blow\b/, () => q.risks.push('Low'));
  take(/\boverdue\b|\blate\b/, () => q.statuses.push('overdue'));
  take(/\b(open|pending|not closed|unclosed)\b/, () => q.statuses.push('open'));
  take(/\b(closed|completed|done|resolved)\b/, () => q.statuses.push('closed'));
  take(/\bincidents?\b/, () => q.types.push('incident'));
  take(/\bobservations?\b/, () => q.types.push('observation'));
  take(/\b(actions?|capa)\b/, () => q.types.push('action'));

  text
    .replace(/[?.,;:!()"']/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && (w.length > 2 || /[^\x00-\x7F]/.test(w)))
    .forEach((w) => {
      const group = SYN[w] || [w.replace(/(ing|s)$/, '') || w, w];
      q.keywords.push(Array.from(new Set(group)));
    });
  return q;
}

/* ---------- Matching ---------- */

function hit(hay, group) {
  return group.some((w) => hay.indexOf(w) >= 0);
}

function scoreRecord(fields, q) {
  if (!q.keywords.length) return 1;
  let matched = 0;
  let score = 0;
  q.keywords.forEach((group) => {
    let best = 0;
    fields.forEach((f) => {
      if (f.text && hit(f.text, group)) best = Math.max(best, f.w);
    });
    if (best) {
      matched++;
      score += best;
    }
  });
  const need = q.keywords.length <= 2 ? q.keywords.length : Math.ceil(q.keywords.length * 0.6);
  return matched >= need ? score : 0;
}

function low(v) {
  return String(v == null ? '' : v).toLowerCase();
}

function inRange(date, q) {
  if (q.from && date < q.from) return false;
  if (q.to && date > q.to) return false;
  return true;
}

function fromObservation(o, q) {
  if (!inRange(o.date, q)) return null;
  if (q.risks.length && !q.risks.includes(o.risk_rating)) return null;
  const closed = o.status === 'Closed' || o.status === 'Verified';
  if (q.statuses.includes('closed') && !closed) return null;
  if (q.statuses.includes('open') && closed) return null;
  if (q.statuses.includes('overdue') && !obsOverdue(o)) return null;
  if (q.severities.length && !(q.severities.includes('near_miss') && o.obs_type === 'Near Miss')) return null;
  const s = scoreRecord(
    [
      { text: low(o.description), w: 4 },
      { text: low(o.activity), w: 3 },
      { text: low(o.hazard_category), w: 3 },
      { text: low(o.location), w: 2 },
      { text: low(o.contractor), w: 2 },
      { text: low(o.root_cause + ' ' + o.corrective_action + ' ' + o.immediate_action), w: 2 },
      { text: low(o.obs_type + ' ' + o.legal_clause + ' ' + o.responsible + ' ' + o.obs_no), w: 1 }
    ],
    q
  );
  if (!s) return null;
  return {
    type: 'observation',
    id: o.id,
    no: o.obs_no,
    date: o.date,
    time: o.time,
    title: o.description || o.hazard_category || 'Observation',
    subtitle: [o.location, o.contractor, o.activity].filter(Boolean).join(' · '),
    risk: o.risk_rating,
    status: o.status,
    closed,
    overdue: obsOverdue(o),
    photos: [o.photo_before, o.photo_after].filter(Boolean),
    score: s,
    record: o
  };
}

function fromIncident(r, q) {
  if (!inRange(r.date, q)) return null;
  if (q.severities.length && !q.severities.includes(r.severity)) return null;
  const closed = r.status === 'closed';
  if (q.statuses.includes('closed') && !closed) return null;
  if (q.statuses.includes('open') && closed) return null;
  if (q.statuses.includes('overdue')) return null;
  if (q.risks.length) return null;
  const s = scoreRecord(
    [
      { text: low(r.description), w: 4 },
      { text: low(r.activity + ' ' + r.type), w: 3 },
      { text: low(r.location + ' ' + r.contractor), w: 2 },
      { text: low(r.immediate_action + ' ' + (r.injured && r.injured.body_part) + ' ' + (r.injured && r.injured.nature)), w: 2 },
      { text: low(r.incident_no + ' ' + r.witnesses), w: 1 }
    ],
    q
  );
  if (!s) return null;
  return {
    type: 'incident',
    id: r.id,
    no: r.incident_no,
    date: r.date,
    time: r.time,
    title: r.description,
    subtitle: [severityOf(r.severity).label, r.location, r.contractor].filter(Boolean).join(' · '),
    risk: severityOf(r.severity).label,
    status: r.status,
    closed,
    overdue: false,
    photos: (r.photos || []).slice(0, 2),
    score: s,
    record: r
  };
}

function fromAction(a, q) {
  const date = (a.createdAt || '').slice(0, 10);
  if (!inRange(date, q)) return null;
  if (q.severities.length) return null;
  if (q.risks.length && !q.risks.includes(a.priority.charAt(0).toUpperCase() + a.priority.slice(1))) return null;
  const closed = isClosed(a);
  if (q.statuses.includes('closed') && !closed) return null;
  if (q.statuses.includes('open') && closed) return null;
  if (q.statuses.includes('overdue') && !actOverdue(a)) return null;
  const s = scoreRecord(
    [
      { text: low(a.title + ' ' + a.description), w: 4 },
      { text: low(a.responsible + ' ' + a.source_no + ' ' + a.action_no), w: 2 },
      { text: low(a.closure_remarks), w: 1 }
    ],
    q
  );
  if (!s) return null;
  return {
    type: 'action',
    id: a.id,
    no: a.action_no,
    date: a.target_date || date,
    time: '',
    title: a.title,
    subtitle: [a.responsible, a.source_no && 'from ' + a.source_no].filter(Boolean).join(' · '),
    risk: a.priority,
    status: a.status.replace('_', ' '),
    closed,
    overdue: actOverdue(a),
    photos: [],
    score: s,
    record: a
  };
}

/* ---------- Search and answer ---------- */

export async function search(input, opts) {
  const o = opts || {};
  const q = parseQuery(input);
  const want = (t) => !q.types.length || q.types.includes(t);
  const pf = o.projectId ? { projectId: o.projectId } : {};
  const out = [];
  if (want('observation')) (await listObservations(pf)).forEach((r) => { const x = fromObservation(r, q); if (x) out.push(x); });
  if (want('incident')) (await listIncidents(pf)).forEach((r) => { const x = fromIncident(r, q); if (x) out.push(x); });
  if (want('action')) (await listActions(pf)).forEach((r) => { const x = fromAction(r, q); if (x) out.push(x); });
  const byDate = q.wantsWhen || q.wantsLast || !q.keywords.length;
  out.sort((a, b) => (byDate ? String(b.date + (b.time || '')).localeCompare(String(a.date + (a.time || ''))) : b.score - a.score || String(b.date).localeCompare(String(a.date))));
  const limit = o.limit || 50;
  return { query: q, total: out.length, results: out.slice(0, limit), answer: describe(q, out) };
}

function when(r) {
  return formatDate(r.date) + (r.time ? ' at ' + formatTime(new Date('1970-01-01T' + r.time + ':00')) : '');
}

export function describe(q, results) {
  if (!results.length) return 'I could not find any matching record' + (q.from ? ' in that period' : '') + '. Try fewer words or a wider date range.';
  const byDate = results.slice().sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
  const latest = byDate[byDate.length - 1];
  const first = byDate[0];
  const kind = (r) => (r.type === 'observation' ? 'observation' : r.type === 'incident' ? 'incident' : 'action');
  let s = 'Found ' + results.length + ' record' + (results.length === 1 ? '' : 's') + '. ';
  if (results.length === 1) {
    s += 'It is ' + kind(latest) + ' ' + latest.no + ' on ' + when(latest) + (latest.subtitle ? ' (' + latest.subtitle + ')' : '') + ', status: ' + latest.status + '.';
  } else {
    s += 'The most recent is ' + kind(latest) + ' ' + latest.no + ' on ' + when(latest) + ' (status: ' + latest.status + '). The earliest is ' + first.no + ' on ' + when(first) + '.';
  }
  const open = results.filter((r) => !r.closed).length;
  if (open) s += ' ' + open + ' still open' + (results.some((r) => r.overdue) ? ', some overdue' : '') + '.';
  return s;
}

export { SEVERITIES };
