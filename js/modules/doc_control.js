/* NASUR - HSE Document Control & Legal Register module (Phase 6) */
import { loadRegions, getActiveRegionId, formatDate } from '../services/regions.js';
import { h, card, toast, ensureRefCss, ensureCss, missionBanner, walkBlock, tabsBar, openObservationModal, shareText } from '../services/safety_reference.js';
import { todayIso } from '../services/opsstore.js';
import {
  loadDocControl,
  loadLegalRegister,
  docData,
  legalData,
  getCategory,
  getCertType,
  statusLabel,
  listDocs,
  getDoc,
  removeDoc,
  suggestDocRef,
  createDoc,
  updateDoc,
  docReviewState,
  setDocStatus,
  reviseDoc,
  docSummary,
  docText,
  suggestExpiry,
  certState,
  createCert,
  listCerts,
  removeCert,
  renewCert,
  certSummary,
  certToAction,
  certsText,
  legalFor,
  setLegalStatus,
  legalSummary,
  legalGapToAction,
  legalText,
  docControlSummary
} from '../services/doc_control.js';

export const id = 'doc_control';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'docs', label: 'Documents' },
  { id: 'certs', label: 'Certificates' },
  { id: 'legal', label: 'Legal register' }
];

const WALK = {
  where_first: ['Is the controlled copy at the point of use the current revision?', 'Are certificates and calibration tags on site, readable and in date?', 'Do workers know where the SOP, SDS and emergency plan are kept?', 'Is the register of documents and certificates up to date?'],
  hidden: ['Old revisions and uncontrolled printed copies still pinned up', 'Expired lifting gear and gas detector certificates in the file but not checked', 'SDS missing for a chemical that was newly introduced', 'Procedures past their review date that nobody owns', 'Contractor equipment brought in without certificates'],
  protect: ['Workers following an old or wrong procedure', 'Operators using equipment with an expired examination']
};

let root = null;
let tab = 'overview';
let docId = '';
let newDoc = false;
let docFilter = '';
let docCat = '';
let certFilter = '';
let certType = '';
let certAdd = false;
let legalCountry = '';
let legalIndustry = '';
let legalQ = '';

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d.getTime()) ? iso : formatDate(d);
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function input(value, onInput, type, placeholder) {
  const i = h('input', { class: 'st-input', type: type || 'text', value: value == null ? '' : value, placeholder: placeholder || '', autocomplete: 'off' });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

function select(options, value, onChange) {
  const s = h('select', { class: 'st-select' }, options.map((o) => h('option', { value: o.id, text: o.label })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function stateBadge(state, label) {
  const cls = state === 'ok' ? 'op-b-ok' : state === 'soon' ? 'op-b-soon' : state === 'overdue' ? 'op-b-over' : 'op-b-none';
  return h('span', { class: 'op-badge ' + cls, text: label });
}

const certClass = (st) => (st === 'overdue' ? 'over' : st === 'soon' ? 'soon' : 'ok');

async function prompted(fn) {
  try {
    await fn();
    await render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Overview ---------- */

async function overviewTab() {
  const country = legalCountry || getActiveRegionId();
  const sum = await docControlSummary(country);
  const certs = (await listCerts()).filter((c) => certState(c).state !== 'ok').slice(0, 8);
  const docs = (await listDocs({ status: 'approved' })).filter((d) => docReviewState(d) === 'overdue').slice(0, 5);
  const kp = [['Approved docs', sum.docsApproved, false], ['In review', sum.docsInReview, false], ['Review overdue', sum.docsReviewOverdue, sum.docsReviewOverdue > 0], ['Certs overdue', sum.certsOverdue, sum.certsOverdue > 0], ['Certs due soon', sum.certsSoon, sum.certsSoon > 0], ['Legal gaps', sum.legalGaps, sum.legalGaps > 0]];
  const nodes = [h('div', { class: 'op-kpis', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, kp.map((k) => h('div', { class: 'op-kpi' + (k[2] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] }))))];
  nodes.push(walkBlock(WALK, 'Visual document control walk'));
  nodes.push(card('Certificates needing attention', 'Overdue first, then due soon.', certs.length ? certs.map((c) => { const st = certState(c); return h('div', { class: 'op-doc ' + certClass(st.state) }, h('div', { class: 'op-top' }, h('b', { text: c.type_title }), stateBadge(st.state, st.label)), h('div', { class: 'rf-hint', text: c.title + (c.asset_tag ? ' [' + c.asset_tag + ']' : '') + ' · expires ' + fmtDate(c.expiry_date) }), h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn small', type: 'button', text: 'Renew', onclick: () => renew(c) }), h('button', { class: 'st-btn secondary small', type: 'button', text: '➕ Action', onclick: () => prompted(async () => { await certToAction(c.id); toast('Action added to the Action Tracker', 'success'); }) }))); }) : h('p', { class: 'rf-hint', text: 'Nothing overdue or due soon. Good.' })));
  nodes.push(card('Documents past their review date', '', docs.length ? docs.map((d) => h('div', { class: 'op-row', style: 'cursor:pointer', onclick: () => { docId = d.id; tab = 'docs'; render(); } }, h('span', { text: (d.doc_ref || d.number) + ' · ' + d.title }), stateBadge('overdue', 'Review ' + fmtDate(d.review_date)))) : h('p', { class: 'rf-hint', text: 'All approved documents are within their review period.' })));
  nodes.push(h('div', { class: 'op-banner' }, h('b', { text: 'Controlled copies' }), h('p', { class: 'rf-hint', text: docData().notice })));
  return nodes;
}

/* ---------- Documents ---------- */

async function docsTab() {
  if (newDoc) return newDocView();
  if (docId) return docDetail(docId);
  const all = await listDocs();
  const s = docSummary(all);
  const rows = all.filter((d) => (!docFilter || (docFilter === 'review' ? docReviewState(d) === 'overdue' || docReviewState(d) === 'soon' : d.status === docFilter)) && (!docCat || d.category === docCat));
  const chips = h('div', { class: 'rf-chips' }, [['', 'All'], ['draft', 'Draft'], ['in_review', 'In review'], ['approved', 'Approved'], ['review', 'Review due'], ['superseded', 'Superseded']].map((c) => h('button', { class: 'st-chip', type: 'button', text: c[1], 'aria-pressed': docFilter === c[0] ? 'true' : 'false', onclick: () => { docFilter = c[0]; render(); } })));
  const cat = select([{ id: '', label: 'All categories' }].concat(docData().categories.map((c) => ({ id: c.id, label: c.label }))), docCat, (v) => { docCat = v; render(); });
  return [
    h('div', { class: 'op-kpis' }, [['Approved', s.approved], ['In review', s.inReview], ['Draft', s.draft], ['Review due', s.reviewOverdue + s.reviewSoon]].map((k) => h('div', { class: 'op-kpi' }, h('b', { text: String(k[1]) }), h('span', { text: k[0] })))),
    h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: '+ New document', onclick: () => { newDoc = true; render(); } })),
    chips,
    cat,
    h('div', { class: 'op-list' }, rows.length ? rows.map((d) => { const rs = docReviewState(d); const c = getCategory(d.category); return h('div', { class: 'op-doc ' + (rs === 'overdue' ? 'over' : rs === 'soon' ? 'soon' : d.status === 'approved' ? 'ok' : ''), style: 'cursor:pointer', onclick: () => { docId = d.id; render(); window.scrollTo(0, 0); } }, h('div', { class: 'op-top' }, h('b', { text: c.icon + ' ' + (d.doc_ref || d.number) + ' · Rev ' + d.rev_no }), h('span', { class: 'op-pill op-s-' + (d.status === 'approved' ? 'active' : d.status === 'in_review' ? 'submitted' : d.status === 'draft' ? 'draft' : 'closed'), text: statusLabel(d.status) })), h('div', { class: 'rf-sub', text: d.title }), h('div', { class: 'rf-hint', text: c.label + ' · owner ' + (d.owner || '-') + (d.review_date ? ' · review ' + fmtDate(d.review_date) : '') }), rs === 'overdue' ? stateBadge('overdue', 'Review overdue') : rs === 'soon' ? stateBadge('soon', 'Review soon') : null); }) : [h('div', { class: 'ob-empty', text: 'No documents here. Add your policy, SOPs, risk assessments and SDS.' })])
  ];
}

async function newDocView() {
  const d = { title: '', category: 'sop', doc_ref: '', rev_no: '0', rev_date: todayIso(), owner: '', link: '', location: '', applies_to: '', summary: '' };
  const refInput = h('input', { class: 'st-input', type: 'text', value: '', placeholder: 'Document ID' });
  refInput.addEventListener('input', () => { d.doc_ref = refInput.value; });
  const suggest = async () => { refInput.value = await suggestDocRef(d.category); d.doc_ref = refInput.value; };
  await suggest();
  return [
    h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Documents', onclick: () => { newDoc = false; render(); } }),
    card('New controlled document', docData().numbering_tip, [
      field('Title', input('', (v) => { d.title = v; })),
      field('Category', select(docData().categories.map((c) => ({ id: c.id, label: c.label })), d.category, async (v) => { d.category = v; await suggest(); })),
      field('Document ID', refInput),
      field('Revision', input(d.rev_no, (v) => { d.rev_no = v; })),
      field('Revision date', input(d.rev_date, (v) => { d.rev_date = v; }, 'date')),
      field('Owner', input('', (v) => { d.owner = v; })),
      field('Where the controlled copy is kept (folder, cabinet or link)', input('', (v) => { d.location = v; })),
      field('Link or file name', input('', (v) => { d.link = v; })),
      field('Applies to (area, activity or project)', input('', (v) => { d.applies_to = v; })),
      field('Short summary', input('', (v) => { d.summary = v; })),
      h('button', { class: 'st-btn', type: 'button', text: 'Create document (draft)', onclick: async () => { try { const rec = await createDoc(d); newDoc = false; docId = rec.id; toast(rec.number + ' created', 'success'); render(); window.scrollTo(0, 0); } catch (e) { toast(e.message, 'error'); } } })
    ])
  ];
}

async function docDetail(id0) {
  const d = await getDoc(id0);
  if (!d) {
    docId = '';
    return docsTab();
  }
  const c = getCategory(d.category);
  const locked = d.status === 'approved' || d.status === 'superseded' || d.status === 'obsolete';
  const nodes = [h('button', { class: 'st-btn secondary small rf-back', type: 'button', text: '← Documents', onclick: () => { docId = ''; render(); } })];
  const rs = docReviewState(d);
  nodes.push(h('div', { class: 'rf-card' }, h('div', { class: 'op-top' }, h('b', { text: c.icon + ' ' + (d.doc_ref || d.number) + ' · Rev ' + d.rev_no }), h('span', { class: 'op-pill op-s-' + (d.status === 'approved' ? 'active' : d.status === 'in_review' ? 'submitted' : d.status === 'draft' ? 'draft' : 'closed'), text: statusLabel(d.status) })), h('h1', { class: 'rf-title', text: d.title }), h('p', { class: 'rf-hint', text: c.label + ' · revision date ' + fmtDate(d.rev_date) + (d.approved_by ? ' · approved by ' + d.approved_by : '') }), rs === 'overdue' ? stateBadge('overdue', 'Review overdue') : rs === 'soon' ? stateBadge('soon', 'Review due soon') : null, d.superseded_state ? h('p', { class: 'rf-hint', text: d.superseded_state }) : null));
  const upd = (k) => (v) => updateDoc(id0, { [k]: v });
  nodes.push(card('Document details', locked ? 'Approved documents are changed by issuing a new revision.' : '', [
    field('Title', (() => { const i = input(d.title, upd('title')); i.disabled = locked; return i; })()),
    field('Owner', input(d.owner, upd('owner'))),
    field('Review date', input(d.review_date, upd('review_date'), 'date')),
    field('Controlled copy location', input(d.location, upd('location'))),
    field('Link or file name', input(d.link, upd('link'))),
    field('Applies to', (() => { const i = input(d.applies_to, upd('applies_to')); i.disabled = locked; return i; })()),
    field('What changed in this revision', (() => { const i = input(d.change_note, upd('change_note')); i.disabled = locked; return i; })())
  ]));
  const acts = h('div', { class: 'rf-actions' });
  if (d.status === 'draft') acts.appendChild(h('button', { class: 'st-btn', type: 'button', text: 'Send for review', onclick: () => { const n = window.prompt('Your name?', d.owner || ''); if (n) prompted(() => setDocStatus(id0, 'in_review', n)); } }));
  if (d.status === 'in_review') acts.append(h('button', { class: 'st-btn', type: 'button', text: 'Approve', onclick: () => { const n = window.prompt('Approver full name?', ''); if (n) prompted(async () => { await setDocStatus(id0, 'approved', n); toast('Approved. Older revisions of ' + (d.doc_ref || 'this document') + ' are superseded.', 'success'); }); } }), h('button', { class: 'st-btn secondary', type: 'button', text: 'Return to draft', onclick: () => { const n = window.prompt('Your name?', ''); if (n) prompted(() => setDocStatus(id0, 'draft', n)); } }));
  if (d.status === 'approved') acts.append(h('button', { class: 'st-btn', type: 'button', text: 'Issue a new revision', onclick: () => { const rev = window.prompt('New revision number or letter? (current ' + d.rev_no + ')', ''); if (!rev) return; const ch = window.prompt('What changed?', '') || ''; prompted(async () => { const nd = await reviseDoc(id0, { rev_no: rev, change: ch }); docId = nd.id; toast('Revision ' + rev + ' created as a draft', 'success'); }); } }), h('button', { class: 'st-btn secondary', type: 'button', text: 'Mark obsolete', onclick: () => { const n = window.prompt('Your name?', ''); if (n) prompted(() => setDocStatus(id0, 'obsolete', n)); } }));
  if (d.status === 'superseded') acts.appendChild(h('button', { class: 'st-btn secondary', type: 'button', text: 'Mark obsolete', onclick: () => { const n = window.prompt('Your name?', ''); if (n) prompted(() => setDocStatus(id0, 'obsolete', n)); } }));
  acts.appendChild(h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share record', onclick: () => shareText('Document ' + (d.doc_ref || d.number), docText(d)) }));
  nodes.push(card('Actions', '', acts));
  if ((d.rev_history || []).length) nodes.push(card('Revision history', '', d.rev_history.slice().reverse().map((x) => h('div', { class: 'op-row' }, h('span', { text: 'Rev ' + x.rev + ' · ' + fmtDate(x.date) + ' · ' + (x.by || '') + (x.change ? ' · ' + x.change : '') }), h('span', { class: 'rf-hint', text: statusLabel(x.state) })))));
  if ((d.log || []).length) nodes.push(card('Log', '', h('ul', { class: 'rf-list' }, d.log.slice().reverse().slice(0, 15).map((l) => h('li', { text: fmtDate(l.at) + ' · ' + l.event + (l.by ? ' · ' + l.by : '') })))));
  if (d.status === 'draft' || d.status === 'obsolete') nodes.push(h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete document', onclick: async () => { if (!window.confirm('Delete ' + (d.doc_ref || d.number) + '?')) return; await removeDoc(id0); docId = ''; render(); } }));
  return nodes;
}

/* ---------- Certificates ---------- */

function renew(c) {
  const issue = window.prompt('New issue date (YYYY-MM-DD)?', todayIso());
  if (!issue) return;
  const def = suggestExpiry(c.type_id, issue);
  const expiry = window.prompt('New expiry date? Default for this type: ' + def, def);
  if (!expiry) return;
  const no = window.prompt('New certificate number?', c.cert_no || '') || '';
  const by = window.prompt('Issued by (examiner or body)?', c.issued_by || '') || '';
  prompted(async () => { await renewCert(c.id, { issue_date: issue, expiry_date: expiry, cert_no: no, issued_by: by }); toast('Certificate renewed', 'success'); });
}

async function certsTab() {
  const region = getActiveRegionId();
  const all = await listCerts();
  const sum = certSummary(all);
  const rows = all.filter((c) => (!certFilter || certState(c).state === certFilter) && (!certType || c.type_id === certType));
  const nodes = [h('div', { class: 'op-kpis', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, [['Valid', sum.ok, false], ['Due soon', sum.soon, sum.soon > 0], ['Overdue', sum.overdue, sum.overdue > 0]].map((k) => h('div', { class: 'op-kpi' + (k[2] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] }))))];
  nodes.push(h('div', { class: 'rf-actions' }, h('button', { class: 'st-btn', type: 'button', text: certAdd ? 'Close form' : '+ Add certificate', onclick: () => { certAdd = !certAdd; render(); } }), h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share register', onclick: () => shareText('Certificate register', certsText(all)) })));
  if (certAdd) nodes.push(certForm(region));
  nodes.push(h('div', { class: 'rf-chips' }, [['', 'All'], ['overdue', 'Overdue'], ['soon', 'Due soon'], ['ok', 'Valid']].map((c) => h('button', { class: 'st-chip', type: 'button', text: c[1], 'aria-pressed': certFilter === c[0] ? 'true' : 'false', onclick: () => { certFilter = c[0]; render(); } }))));
  nodes.push(select([{ id: '', label: 'All types' }].concat(docData().certificate_types.map((t) => ({ id: t.id, label: t.title }))), certType, (v) => { certType = v; render(); }));
  nodes.push(h('div', { class: 'op-list' }, rows.length ? rows.map((c) => {
    const st = certState(c);
    const t = getCertType(c.type_id);
    return h('div', { class: 'op-doc ' + certClass(st.state) },
      h('div', { class: 'op-top' }, h('b', { text: t.icon + ' ' + c.type_title }), stateBadge(st.state, st.label)),
      h('div', { class: 'rf-sub', text: c.title + (c.asset_tag ? ' [' + c.asset_tag + ']' : '') }),
      h('div', { class: 'rf-hint', text: [c.location, c.cert_no && 'Cert ' + c.cert_no, c.issued_by, 'Expires ' + fmtDate(c.expiry_date)].filter(Boolean).join(' · ') }),
      h('div', { class: 'rf-actions' },
        h('button', { class: 'st-btn small', type: 'button', text: 'Renew', onclick: () => renew(c) }),
        h('button', { class: 'st-btn secondary small', type: 'button', text: '➕ Action', onclick: () => prompted(async () => { await certToAction(c.id); toast('Action added to the Action Tracker', 'success'); }) }),
        st.state === 'overdue' ? h('button', { class: 'st-btn secondary small', type: 'button', text: '➕ Observation', onclick: () => openObservationModal({ title: c.type_title, hazard_category: c.hazard_category || 'Other', activity: c.type_title + ' certificate', risk_rating: 'High', description: 'Certificate expired: ' + c.title + (c.asset_tag ? ' [' + c.asset_tag + ']' : '') + ' (expired ' + c.expiry_date + ')', typical: ['Equipment in use with an expired certificate', 'Calibration overdue', 'Certificate not available on site'], legal_clause: t.legal[region] }) }) : null,
        h('button', { class: 'st-btn danger small', type: 'button', text: 'Delete', onclick: async () => { if (!window.confirm('Delete this certificate record?')) return; await removeCert(c.id); render(); } })),
      (c.history || []).length ? h('details', { class: 'rf-acc' }, h('summary', { text: 'Previous certificates (' + c.history.length + ')' }), h('div', null, c.history.slice().reverse().map((x) => h('div', { class: 'rf-hint', text: (x.cert_no || '-') + ' · ' + fmtDate(x.issue_date) + ' to ' + fmtDate(x.expiry_date) + ' · ' + (x.issued_by || '') })))) : null);
  }) : [h('div', { class: 'ob-empty', text: 'No certificates yet. Add cranes, lifting gear, gas detectors, pressure vessels, licences and more.' })]));
  return nodes;
}

function certForm(region) {
  const d = { type_id: 'crane', title: '', asset_tag: '', location: '', cert_no: '', issued_by: '', issue_date: todayIso(), expiry_date: '', notes: '' };
  const expiryInput = h('input', { class: 'st-input', type: 'date', value: suggestExpiry(d.type_id, d.issue_date) });
  d.expiry_date = expiryInput.value;
  expiryInput.addEventListener('input', () => { d.expiry_date = expiryInput.value; });
  const info = h('div', { class: 'rf-hint' });
  const refreshInfo = () => {
    const t = getCertType(d.type_id);
    info.replaceChildren(h('b', { text: 'Legal hint for your country: ' }), t.legal[region] || '', h('br'), h('b', { text: 'Record: ' }), t.evidence.join(', '), t.note ? h('div', { text: t.note }) : null, h('div', { text: 'Suggested interval: ' + t.default_days + ' days. Warning ' + t.warn_days + ' days before expiry.' }));
  };
  const autoExpiry = () => { expiryInput.value = suggestExpiry(d.type_id, d.issue_date); d.expiry_date = expiryInput.value; };
  refreshInfo();
  return card('Add a certificate or calibration', '', [
    field('Type', select(docData().certificate_types.map((t) => ({ id: t.id, label: t.title })), d.type_id, (v) => { d.type_id = v; autoExpiry(); refreshInfo(); })),
    info,
    field('Item or person name', input('', (v) => { d.title = v; }, 'text', 'e.g. Mobile crane MC-04')),
    field('Asset tag or ID', input('', (v) => { d.asset_tag = v; })),
    field('Location', input('', (v) => { d.location = v; })),
    field('Certificate number', input('', (v) => { d.cert_no = v; })),
    field('Issued by (examiner or body)', input('', (v) => { d.issued_by = v; })),
    field('Issue date', input(d.issue_date, (v) => { d.issue_date = v; autoExpiry(); }, 'date')),
    field('Expiry date', expiryInput),
    field('Notes', input('', (v) => { d.notes = v; })),
    h('button', { class: 'st-btn', type: 'button', text: 'Save certificate', onclick: async () => { try { await createCert(d); toast('Certificate saved', 'success'); certAdd = false; render(); } catch (e) { toast(e.message, 'error'); } } })
  ]);
}

/* ---------- Legal register ---------- */

async function legalTab() {
  const lg = legalData();
  const country = legalCountry || getActiveRegionId();
  legalCountry = country;
  const sum = await legalSummary(country);
  const rows = await legalFor(country, { industry: legalIndustry, q: legalQ });
  const countrySel = select(Object.keys(lg.countries).map((k) => ({ id: k, label: lg.countries[k].label })), country, (v) => { legalCountry = v; render(); });
  const inds = [['', 'All industries'], ['manufacturing', 'Manufacturing'], ['construction', 'Construction'], ['oilgas', 'Oil & Gas'], ['marine', 'Marine'], ['food_safety', 'Food'], ['warehouse_logistics', 'Warehouse'], ['facilities_maintenance', 'Facilities']];
  const search = h('input', { class: 'st-input', type: 'search', placeholder: 'Search the register…', value: legalQ });
  search.addEventListener('change', () => { legalQ = search.value; render(); });
  const nodes = [
    h('div', { class: 'op-banner' }, h('b', { text: 'Verify before audit use' }), h('p', { class: 'rf-hint', text: lg.notice })),
    countrySel,
    h('div', { class: 'op-kpis', style: 'grid-template-columns:repeat(4,minmax(0,1fr))' }, [['Compliant', sum.compliant, false], ['Partial', sum.partial, false], ['Gaps', sum.gap, sum.gap > 0], ['Not reviewed', sum.unreviewed, false]].map((k) => h('div', { class: 'op-kpi' + (k[2] ? ' bad' : '') }, h('b', { text: String(k[1]) }), h('span', { text: k[0] })))),
    h('div', { class: 'rf-chips' }, inds.map((i) => h('button', { class: 'st-chip', type: 'button', text: i[1], 'aria-pressed': legalIndustry === i[0] ? 'true' : 'false', onclick: () => { legalIndustry = i[0]; render(); } }))),
    search,
    h('button', { class: 'st-btn secondary', type: 'button', text: '📤 Share register', onclick: async () => shareText('Legal register', await legalText(country)) })
  ];
  rows.forEach((e) => {
    const rec = { compliance: e.compliance, owner: (e.record && e.record.owner) || '', note: (e.record && e.record.note) || '', next_review: (e.record && e.record.next_review) || '' };
    const save = async () => { try { await setLegalStatus(e.id, country, rec); } catch (err) { toast(err.message, 'error'); } };
    const seg = h('div', { class: 'op-seg' });
    [['compliant', 'Yes', 'yes'], ['partial', 'Part', 'na'], ['gap', 'Gap', 'no'], ['na', 'N/A', 'na']].forEach(([v, label, cls]) => {
      const b = h('button', { type: 'button', class: 'op-seg-' + cls, text: label, 'aria-pressed': rec.compliance === v ? 'true' : 'false' });
      b.addEventListener('click', async () => { rec.compliance = v; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); await save(); render(); });
      seg.appendChild(b);
    });
    const owner = input(rec.owner, (v) => { rec.owner = v; }, 'text', 'Owner');
    owner.addEventListener('change', save);
    const note = h('textarea', { class: 'st-input', rows: '2', placeholder: 'Evidence or note' });
    note.value = rec.note;
    note.addEventListener('input', () => { rec.note = note.value; });
    note.addEventListener('change', save);
    const next = input(rec.next_review, (v) => { rec.next_review = v; }, 'date');
    next.addEventListener('change', save);
    nodes.push(h('details', { class: 'rf-acc', style: e.compliance === 'gap' ? 'border-color:#dc2626' : '' }, h('summary', { text: e.title + '  ·  ' + e.compliance.toUpperCase() }), h('div', null,
      h('p', { class: 'rf-hint', text: e.type + ' · ' + e.scope + ' · ' + e.authority }),
      h('ul', { class: 'rf-list' }, e.duties.map((x) => h('li', { text: x }))),
      h('span', { class: 'st-label', text: 'Our compliance' }), seg,
      field('Owner', owner), field('Evidence or note', note), field('Next review', next),
      e.compliance === 'gap' ? h('button', { class: 'st-btn', type: 'button', text: '➕ Action to close the gap', onclick: () => prompted(async () => { await legalGapToAction(e.id, country, { responsible: rec.owner }); toast('Action added to the Action Tracker', 'success'); }) }) : null)));
  });
  if (!rows.length) nodes.push(h('div', { class: 'ob-empty', text: 'Nothing matches. Clear the filters.' }));
  return nodes;
}

/* ---------- Screen ---------- */

async function render() {
  if (!root) return;
  let body;
  try {
    body = tab === 'overview' ? await overviewTab() : tab === 'docs' ? await docsTab() : tab === 'certs' ? await certsTab() : await legalTab();
  } catch (e) {
    body = [h('p', { class: 'rf-sub', text: 'Could not load: ' + e.message })];
  }
  const banner = await missionBanner();
  if (!root) return;
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('h1', { class: 'rf-title', text: '🗄️ HSE Document Control & Legal Register' }), h('p', { class: 'rf-sub', text: 'Revision-controlled documents, certificate and calibration expiry alerts, and your country legal register.' }), banner, tabsBar(TABS, tab, (t) => { tab = t; docId = ''; newDoc = false; render(); }), ...[].concat(body).filter(Boolean)));
}

export async function mount(el) {
  root = el;
  ensureRefCss();
  ensureCss('css/ops.css');
  root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Loading document control…' })));
  await loadRegions();
  try {
    await Promise.all([loadDocControl(), loadLegalRegister()]);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'rf-wrap' }, h('p', { class: 'rf-sub', text: 'Could not load data: ' + e.message })));
    return;
  }
  legalCountry = getActiveRegionId();
  await render();
}

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
