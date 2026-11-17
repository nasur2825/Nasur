/* NASUR - HSE Document Control & Legal Register service (Phase 6)
   Revision-controlled documents, statutory certificate and calibration expiry tracker and a
   country legal register with compliance status. Records use the shared operations store. */
import { KINDS, listOps, getOps, saveOps, patchOps, removeOps, txt, todayIso, addDaysIso, daysUntil, logEntry } from './opsstore.js';
import { createAction } from './actions.js';

const URL_DOC = 'data/doc_control.json';
const URL_LEGAL = 'data/legal_register.json';

let doc = null;
let legal = null;

export async function loadDocControl() {
  if (doc) return doc;
  const res = await fetch(URL_DOC, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load document control data (HTTP ' + res.status + ')');
  doc = await res.json();
  return doc;
}

export async function loadLegalRegister() {
  if (legal) return legal;
  const res = await fetch(URL_LEGAL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load the legal register (HTTP ' + res.status + ')');
  legal = await res.json();
  return legal;
}

export function docData() {
  if (!doc) throw new Error('Document control data is not loaded');
  return doc;
}

export function legalData() {
  if (!legal) throw new Error('Legal register is not loaded');
  return legal;
}

export const getCategory = (id) => docData().categories.find((c) => c.id === id) || docData().categories[docData().categories.length - 1];
export const getCertType = (id) => docData().certificate_types.find((t) => t.id === id) || docData().certificate_types[docData().certificate_types.length - 1];

export function statusLabel(id) {
  const s = docData().statuses.find((x) => x.id === id);
  return s ? s.label : id;
}

/* ---------- Documents ---------- */

const isDoc = (r) => (r.entry || 'document') === 'document';

export async function listDocs(filter) {
  const f = filter || {};
  return (await listOps(KINDS.DOC, { status: f.status, q: f.q, predicate: (r) => isDoc(r) && (!f.category || r.category === f.category) && (!f.reviewState || docReviewState(r) === f.reviewState) })).sort((a, b) => String(a.doc_ref || a.number).localeCompare(String(b.doc_ref || b.number)));
}

export const getDoc = (id) => getOps(id);
export const removeDoc = (id) => removeOps(id);

export async function suggestDocRef(categoryId) {
  const c = getCategory(categoryId);
  const n = (await listDocs({ category: categoryId })).length + 1;
  return 'HSE-' + c.prefix + '-' + String(n).padStart(3, '0');
}

function reviewDateFor(categoryId, revDate) {
  const days = getCategory(categoryId).review_days;
  return days > 0 ? addDaysIso(revDate || todayIso(), days) : '';
}

export async function createDoc(d) {
  const title = txt(d.title, 160);
  if (!title) throw new Error('Enter the document title');
  const category = docData().categories.some((c) => c.id === d.category) ? d.category : 'other';
  const revDate = txt(d.rev_date, 10) || todayIso();
  const ref = txt(d.doc_ref, 40) || (await suggestDocRef(category));
  return saveOps(KINDS.DOC, {
    entry: 'document',
    title,
    category,
    doc_ref: ref,
    rev_no: txt(d.rev_no, 10) || '0',
    rev_date: revDate,
    owner: txt(d.owner, 100),
    review_date: txt(d.review_date, 10) || reviewDateFor(category, revDate),
    link: txt(d.link, 300),
    location: txt(d.location, 160),
    applies_to: txt(d.applies_to, 160),
    summary: txt(d.summary, 300),
    status: 'draft',
    rev_history: [],
    change_note: txt(d.change_note, 300)
  }, { prefix: 'DOC' });
}

export function updateDoc(id, patch) {
  const allowed = ['title', 'owner', 'review_date', 'link', 'location', 'applies_to', 'summary', 'change_note', 'doc_ref'];
  const clean = {};
  allowed.forEach((k) => {
    if (k in patch) clean[k] = txt(patch[k], k === 'link' ? 300 : 200);
  });
  return patchOps(id, clean);
}

export function docReviewState(d, now) {
  if (d.status !== 'approved' || !d.review_date) return 'none';
  const days = daysUntil(d.review_date, now);
  if (days == null) return 'none';
  return days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok';
}

export async function setDocStatus(id, to, by) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Document not found');
  if (!(docData().transitions[cur.status] || []).includes(to)) throw new Error('A ' + statusLabel(cur.status).toLowerCase() + ' document cannot become ' + statusLabel(to).toLowerCase());
  const name = txt(by, 100);
  if (!name) throw new Error('Enter your name');
  const extra = {};
  if (to === 'approved') {
    if (!cur.owner) throw new Error('Enter the document owner before approval');
    extra.approved_by = name;
    extra.approved_at = new Date().toISOString();
    // Approving a revision supersedes the older approved revision of the same document
    if (cur.doc_ref) {
      const older = (await listDocs({ status: 'approved' })).filter((x) => x.id !== id && x.doc_ref === cur.doc_ref);
      for (const o of older) await patchOps(o.id, (r) => ({ status: 'superseded', superseded_by: id, superseded_state: 'Superseded by revision ' + cur.rev_no, log: logEntry(r, 'Superseded by revision ' + cur.rev_no, name) }));
    }
  }
  return patchOps(id, (r) => ({ status: to, ...extra, log: logEntry(r, 'Status: ' + statusLabel(to), name) }));
}

/* New revision: a new draft record with the same document reference. The old revision stays approved until the new one is approved. */
export async function reviseDoc(id, rev) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Document not found');
  const newRev = txt(rev.rev_no, 10);
  if (!newRev) throw new Error('Enter the new revision number or letter');
  if (newRev === cur.rev_no) throw new Error('The new revision must be different');
  const history = (cur.rev_history || []).concat([{ rev: cur.rev_no, date: cur.rev_date, by: cur.approved_by || cur.owner || '', change: cur.change_note || '', state: cur.status }]);
  const revDate = txt(rev.rev_date, 10) || todayIso();
  return saveOps(KINDS.DOC, {
    entry: 'document',
    title: cur.title,
    category: cur.category,
    doc_ref: cur.doc_ref,
    rev_no: newRev,
    rev_date: revDate,
    owner: cur.owner,
    review_date: reviewDateFor(cur.category, revDate),
    link: txt(rev.link, 300) || cur.link,
    location: cur.location,
    applies_to: cur.applies_to,
    summary: cur.summary,
    status: 'draft',
    rev_history: history,
    previous_id: cur.id,
    change_note: txt(rev.change, 300)
  }, { prefix: 'DOC' });
}

export function docSummary(list) {
  const s = { total: list.length, draft: 0, inReview: 0, approved: 0, reviewOverdue: 0, reviewSoon: 0 };
  list.forEach((d) => {
    if (d.status === 'draft') s.draft++;
    if (d.status === 'in_review') s.inReview++;
    if (d.status === 'approved') s.approved++;
    const rs = docReviewState(d);
    if (rs === 'overdue') s.reviewOverdue++;
    if (rs === 'soon') s.reviewSoon++;
  });
  return s;
}

export function docText(d) {
  const lines = [(d.doc_ref || d.number) + ' · ' + d.title, 'Category: ' + getCategory(d.category).label, 'Revision: ' + d.rev_no + ' (' + d.rev_date + ')', 'Status: ' + statusLabel(d.status) + (d.approved_by ? ' (approved by ' + d.approved_by + ')' : ''), 'Owner: ' + (d.owner || ''), 'Next review: ' + (d.review_date || 'none'), 'Location of controlled copy: ' + (d.location || d.link || ''), ''];
  (d.rev_history || []).forEach((h) => lines.push('Rev ' + h.rev + ' · ' + h.date + ' · ' + h.by + ' · ' + (h.change || '')));
  return lines.join('\n');
}

/* ---------- Certificates and calibration ---------- */

export function suggestExpiry(typeId, issueDate) {
  return addDaysIso(issueDate || todayIso(), getCertType(typeId).default_days);
}

export function certState(c, now) {
  if (!c.expiry_date) return { state: 'none', days: null, label: 'No expiry date' };
  const days = daysUntil(c.expiry_date, now);
  const warn = getCertType(c.type_id).warn_days || docData().alerts.default_warn_days;
  if (days == null) return { state: 'none', days: null, label: 'No expiry date' };
  if (days < 0) return { state: 'overdue', days, label: 'Expired ' + Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') + ' ago' };
  if (days === 0) return { state: 'soon', days, label: 'Expires today' };
  if (days <= warn) return { state: 'soon', days, label: days + ' day' + (days === 1 ? '' : 's') + ' left' };
  return { state: 'ok', days, label: days + ' days left' };
}

export async function createCert(d) {
  const type = getCertType(d.type_id);
  const title = txt(d.title, 160);
  if (!title) throw new Error('Enter the item name');
  const issue = txt(d.issue_date, 10);
  const expiry = txt(d.expiry_date, 10) || (issue ? suggestExpiry(type.id, issue) : '');
  if (!expiry) throw new Error('Enter the expiry date or the issue date');
  return saveOps(KINDS.CERT, {
    type_id: type.id,
    type_title: type.title,
    title,
    asset_tag: txt(d.asset_tag, 60),
    location: txt(d.location, 160),
    cert_no: txt(d.cert_no, 60),
    issued_by: txt(d.issued_by, 120),
    issue_date: issue,
    expiry_date: expiry,
    notes: txt(d.notes, 300),
    hazard_category: type.hazard_category,
    history: [],
    action_id: '',
    status: 'active'
  }, { prefix: 'CERT' });
}

export const getCert = (id) => getOps(id);
export const removeCert = (id) => removeOps(id);

export async function listCerts(filter) {
  const f = filter || {};
  const rows = await listOps(KINDS.CERT, { q: f.q, predicate: (r) => (!f.type_id || r.type_id === f.type_id) && (!f.state || certState(r).state === f.state) });
  rows.sort((a, b) => {
    const da = certState(a).days;
    const db = certState(b).days;
    return (da == null ? 99999 : da) - (db == null ? 99999 : db);
  });
  return rows;
}

export async function renewCert(id, r) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Certificate not found');
  const issue = txt(r.issue_date, 10) || todayIso();
  const expiry = txt(r.expiry_date, 10) || suggestExpiry(cur.type_id, issue);
  if (expiry <= issue) throw new Error('The expiry date must be after the issue date');
  const entry = { cert_no: cur.cert_no, issue_date: cur.issue_date, expiry_date: cur.expiry_date, issued_by: cur.issued_by, renewed_at: new Date().toISOString() };
  return patchOps(id, (x) => ({ history: (x.history || []).concat([entry]), issue_date: issue, expiry_date: expiry, cert_no: txt(r.cert_no, 60) || x.cert_no, issued_by: txt(r.issued_by, 120) || x.issued_by, action_id: '', log: logEntry(x, 'Renewed until ' + expiry, r.by) }));
}

export function certSummary(list) {
  const s = { total: list.length, ok: 0, soon: 0, overdue: 0 };
  list.forEach((c) => {
    const st = certState(c).state;
    if (st === 'ok') s.ok++;
    if (st === 'soon') s.soon++;
    if (st === 'overdue') s.overdue++;
  });
  return s;
}

export async function certToAction(id, opts) {
  const cur = await getOps(id);
  if (!cur) throw new Error('Certificate not found');
  if (cur.action_id) throw new Error('An action was already created for this certificate');
  const st = certState(cur);
  const o = opts || {};
  const target = st.days != null && st.days > 7 ? addDaysIso(todayIso(), st.days - 7) : addDaysIso(todayIso(), 3);
  const a = await createAction({
    title: 'Renew ' + cur.type_title + ': ' + cur.title,
    description: 'Certificate ' + (cur.cert_no || cur.number) + ' expires ' + cur.expiry_date + '. ' + (st.state === 'overdue' ? 'Do not use the item until it is re-examined.' : ''),
    source_type: 'manual',
    source_no: cur.number,
    responsible: o.responsible || '',
    target_date: o.target_date || target,
    priority: st.state === 'overdue' ? 'critical' : st.state === 'soon' ? 'high' : 'medium',
    kind: 'corrective',
    projectId: cur.projectId || null
  });
  await patchOps(id, { action_id: a.id });
  return a;
}

export function certsText(list) {
  const lines = ['CERTIFICATE AND CALIBRATION REGISTER', ''];
  list.forEach((c) => lines.push(certState(c).state.toUpperCase().padEnd(8) + ' ' + c.expiry_date + '  ' + c.type_title + ' · ' + c.title + (c.asset_tag ? ' [' + c.asset_tag + ']' : '') + ' · ' + (c.cert_no || 'no cert no')));
  return lines.join('\n');
}

/* ---------- Legal register ---------- */

export async function listLegalRecords() {
  return listOps(KINDS.DOC, { predicate: (r) => r.entry === 'legal' });
}

export async function legalFor(country, opts) {
  const o = opts || {};
  const q = String(o.q || '').trim().toLowerCase();
  const records = await listLegalRecords();
  return (legalData().register[country] || [])
    .filter((e) => (!o.industry || e.applies.includes(o.industry)) && (!q || (e.title + ' ' + e.scope + ' ' + e.duties.join(' ')).toLowerCase().indexOf(q) >= 0))
    .map((e) => {
      const rec = records.find((r) => r.ref_id === e.id && r.country === country);
      return { ...e, record: rec || null, compliance: rec ? rec.compliance : 'unreviewed' };
    });
}

export async function setLegalStatus(refId, country, data) {
  const status = legalData().statuses.some((s) => s.id === data.compliance) ? data.compliance : 'unreviewed';
  const entry = (legalData().register[country] || []).find((e) => e.id === refId);
  if (!entry) throw new Error('Unknown register entry');
  const records = await listLegalRecords();
  const cur = records.find((r) => r.ref_id === refId && r.country === country);
  const payload = { entry: 'legal', ref_id: refId, country, title: entry.title, compliance: status, owner: txt(data.owner, 100), note: txt(data.note, 400), reviewed_at: new Date().toISOString().slice(0, 10), next_review: txt(data.next_review, 10) || addDaysIso(todayIso(), 365) };
  if (cur) return patchOps(cur.id, payload);
  return saveOps(KINDS.DOC, { ...payload, country }, {});
}

export async function legalSummary(country) {
  const rows = await legalFor(country);
  const s = { total: rows.length, unreviewed: 0, compliant: 0, partial: 0, gap: 0, na: 0, reviewOverdue: 0 };
  rows.forEach((r) => {
    s[r.compliance] = (s[r.compliance] || 0) + 1;
    if (r.record && r.record.next_review && daysUntil(r.record.next_review) < 0) s.reviewOverdue++;
  });
  return s;
}

export async function legalGapToAction(refId, country, opts) {
  const rows = await legalFor(country);
  const e = rows.find((r) => r.id === refId);
  if (!e) throw new Error('Unknown register entry');
  const o = opts || {};
  return createAction({
    title: 'Close compliance gap: ' + e.title,
    description: (e.record && e.record.note) || 'Review the requirement and close the gap.',
    source_type: 'manual',
    source_no: 'LEGAL',
    responsible: o.responsible || (e.record && e.record.owner) || '',
    target_date: o.target_date || addDaysIso(todayIso(), 30),
    priority: 'high',
    kind: 'corrective'
  });
}

export async function legalText(country) {
  const rows = await legalFor(country);
  const lines = ['LEGAL REGISTER: ' + (legalData().countries[country] || { label: country }).label, legalData().notice, ''];
  rows.forEach((e) => lines.push('[' + e.compliance.toUpperCase() + '] ' + e.title + ' (' + e.type + ')' + (e.record && e.record.owner ? ' · owner ' + e.record.owner : '') + (e.record && e.record.note ? ' · ' + e.record.note : '')));
  return lines.join('\n');
}

/* ---------- Summary for the Home screen and the overview ---------- */

export async function docControlSummary(country) {
  const [docs, certs, lg] = await Promise.all([listDocs(), listCerts(), legalSummary(country)]);
  const ds = docSummary(docs);
  const cs = certSummary(certs);
  return { docsApproved: ds.approved, docsInReview: ds.inReview, docsReviewOverdue: ds.reviewOverdue, certsOverdue: cs.overdue, certsSoon: cs.soon, certsTotal: cs.total, legalGaps: lg.gap, legalUnreviewed: lg.unreviewed };
}
