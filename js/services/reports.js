/* NASUR - A4 Executive Report builder (Phase 4)
   Produces a formal, print-ready HTML document (Save as PDF from the print dialog, or share the file). */
import { getProjectContext } from './clients.js';
import { getActiveRegion, formatDate } from './regions.js';
import { getColumns, listObservations, summarize, isOverdue as obsOverdue, riskScore, todayIso } from './observations.js';
import { listActions, summarizeActions, isOverdue as actOverdue, isClosed } from './actions.js';
import { listIncidents, summarizeIncidents, calcRates, severityOf } from './incidents.js';

export const DEFAULT_TEMPLATE = {
  title: 'HSE Observation & Performance Report',
  subtitle: '',
  sections: [
    { type: 'summary', title: '1. Executive Summary' },
    { type: 'kpi', title: '2. Key Figures' },
    { type: 'risk_table', title: '3. Observations by Risk Rating' },
    { type: 'contractor_table', title: '4. Contractor Breakdown' },
    { type: 'category_table', title: '5. Hazard Categories' },
    { type: 'observation_table', title: '6. Observation Register', columns: ['obs_no', 'date', 'location', 'hazard_category', 'risk_rating', 'description', 'status'], limit: 60 },
    { type: 'photo_cards', title: '7. Before and After Photo Record', limit: 12 },
    { type: 'open_actions', title: '8. Open and Overdue Actions', limit: 40 },
    { type: 'signoff', title: 'Sign-off' }
  ],
  signoffRoles: ['Prepared By', 'Reviewed By', 'Approved By'],
  orientation: 'portrait'
};

/* ---------- Period helpers ---------- */

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function periodFor(kind, from, to) {
  const now = new Date();
  if (kind === 'daily') return { from: iso(now), to: iso(now), label: 'Daily Report' };
  if (kind === 'weekly') {
    const s = new Date(now);
    s.setDate(s.getDate() - 6);
    return { from: iso(s), to: iso(now), label: 'Weekly Report' };
  }
  if (kind === 'monthly') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: iso(s), to: iso(now), label: 'Monthly Report' };
  }
  return { from: from || iso(now), to: to || iso(now), label: 'HSE Report' };
}

/* ---------- Data ---------- */

export async function buildReportData(opts) {
  const o = opts || {};
  const period = periodFor(o.period || 'custom', o.from, o.to);
  const ctx = await getProjectContext(o.projectId);
  const pid = ctx ? ctx.projectId : o.projectId || undefined;
  const filter = { projectId: pid, from: period.from, to: period.to };
  const obs = await listObservations(filter);
  const incidents = await listIncidents(filter);
  const allActions = await listActions(pid ? { projectId: pid } : {});
  const sameSpan = (a) => !a.createdAt || a.createdAt.slice(0, 10) <= period.to;
  const actions = allActions.filter((a) => !isClosed(a) && sameSpan(a));
  const obsSum = summarize(obs);
  const incSum = summarizeIncidents(incidents);
  return {
    period,
    projectName: (ctx && ctx.project.name) || o.projectName || 'All projects',
    projectNo: (ctx && ctx.project.projectNo) || '',
    site: (ctx && ctx.project.site) || '',
    clientName: (ctx && ctx.client && ctx.client.name) || '',
    mainContractor: (ctx && ctx.project.mainContractor) || '',
    auditStandard: (ctx && ctx.auditStandard) || '',
    country: getActiveRegion().label,
    preparedBy: o.preparedBy || '',
    reportNo: 'HSE-RPT-' + period.from.replace(/-/g, '') + (period.to !== period.from ? '-' + period.to.replace(/-/g, '') : ''),
    generatedOn: todayIso(),
    observations: obs,
    incidents,
    actions,
    obsSum,
    incSum,
    actSum: summarizeActions(allActions),
    rates: o.manHours ? calcRates(incidents, o.manHours) : null
  };
}

/* ---------- Rendering ---------- */

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function d(v) {
  return v ? esc(formatDate(v)) : '';
}

function topOf(map) {
  let best = '';
  let n = 0;
  Object.keys(map).forEach((k) => {
    if (map[k] > n && k !== 'Unspecified') {
      best = k;
      n = map[k];
    }
  });
  return best ? { name: best, count: n } : null;
}

function narrative(data) {
  const s = data.obsSum;
  const parts = [];
  const hc = (s.byRisk.High || 0) + (s.byRisk.Critical || 0);
  parts.push('During the period ' + formatDate(data.period.from) + (data.period.to !== data.period.from ? ' to ' + formatDate(data.period.to) : '') + ', ' + s.total + ' safety observation' + (s.total === 1 ? ' was' : 's were') + ' recorded' + (data.projectName ? ' on ' + data.projectName : '') + '.');
  if (s.total) {
    parts.push(hc + ' ' + (hc === 1 ? 'was' : 'were') + ' rated High or Critical. ' + s.open + ' remain open' + (s.overdue ? ', of which ' + s.overdue + ' are overdue' : '') + '. The closure rate for the period is ' + s.closureRate + '%.');
    const cat = topOf(s.byCategory);
    const con = topOf(s.byContractor);
    if (cat) parts.push('The most frequent hazard category was ' + cat.name + ' (' + cat.count + ').');
    if (con) parts.push('The contractor with the most observations was ' + con.name + ' (' + con.count + ').');
  }
  const i = data.incSum;
  if (i.total) parts.push(i.total + ' incident' + (i.total === 1 ? '' : 's') + ' or near miss' + (i.total === 1 ? '' : 'es') + ' were reported: ' + i.recordable + ' recordable, ' + i.nearMisses + ' near miss' + (i.nearMisses === 1 ? '' : 'es') + (i.lti ? ', ' + i.lti + ' lost time' : '') + '.');
  else parts.push('No incidents or near misses were logged in the period.');
  return parts.join(' ');
}

function table(headers, rows, opts) {
  const o = opts || {};
  const head = '<tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>';
  const body = rows.length ? rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (o.right && o.right.includes(i) ? ' class="r"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '" class="none">None recorded</td></tr>';
  return '<table class="grid">' + head + body + '</table>';
}

function countRows(map, total) {
  return Object.keys(map)
    .sort((a, b) => map[b] - map[a])
    .map((k) => [esc(k), String(map[k]), total ? Math.round((map[k] / total) * 100) + '%' : '']);
}

function section(title, inner) {
  return '<section class="sec">' + (title ? '<h2>' + esc(title) + '</h2>' : '') + inner + '</section>';
}

function kpiBlock(data) {
  const s = data.obsSum;
  const i = data.incSum;
  const cells = [
    ['Observations', s.total],
    ['High / Critical', (s.byRisk.High || 0) + (s.byRisk.Critical || 0)],
    ['Open', s.open],
    ['Overdue', s.overdue],
    ['Closure rate', s.closureRate + '%'],
    ['Incidents', i.total],
    ['Recordable', i.recordable],
    ['Near misses', i.nearMisses]
  ];
  if (data.rates) {
    cells.push(['TRIR (per 200,000 h)', data.rates.trir == null ? '-' : data.rates.trir]);
    cells.push(['LTIFR (per 1,000,000 h)', data.rates.ltifr == null ? '-' : data.rates.ltifr]);
  }
  return '<div class="kpis">' + cells.map((c) => '<div class="kpi"><b>' + esc(c[1]) + '</b><span>' + esc(c[0]) + '</span></div>').join('') + '</div>';
}

function photoCards(data, limit) {
  const list = data.observations
    .filter((o) => o.photo_before || o.photo_after)
    .sort((a, b) => riskScore(b.risk_rating) - riskScore(a.risk_rating))
    .slice(0, limit || 12);
  if (!list.length) return '<p class="none">No photo records in this period.</p>';
  return list
    .map((o) => {
      const img = (src, label) => '<div class="ph"><div class="phl">' + label + '</div>' + (src ? '<img src="' + src + '" alt="' + label + '">' : '<div class="nophoto">No photo</div>') + '</div>';
      return (
        '<div class="card"><div class="cardh"><b>' + esc(o.obs_no) + '</b><span>' + d(o.date) + ' ' + esc(o.time) + '</span><span>Risk: ' + esc(o.risk_rating || '-') + '</span><span>Status: ' + esc(o.status || '-') + '</span></div>' +
        '<div class="pair">' + img(o.photo_before, 'BEFORE') + img(o.photo_after, 'AFTER') + '</div>' +
        '<div class="cardb"><div><b>Location:</b> ' + esc(o.location) + '</div><div><b>Observation:</b> ' + esc(o.description) + '</div>' +
        (o.corrective_action ? '<div><b>Corrective action:</b> ' + esc(o.corrective_action) + '</div>' : '') +
        (o.closure_remarks ? '<div><b>Closure remarks:</b> ' + esc(o.closure_remarks) + '</div>' : '') + '</div></div>'
      );
    })
    .join('');
}

function observationTable(data, sec) {
  const cols = getColumns();
  const keys = (sec.columns && sec.columns.length ? sec.columns : DEFAULT_TEMPLATE.sections[5].columns).filter((k) => cols.some((c) => c.key === k));
  const used = keys.length ? keys : ['obs_no', 'date', 'description', 'status'];
  const rows = data.observations.slice(0, sec.limit || 60).map((o) =>
    used.map((k) => {
      const col = cols.find((c) => c.key === k);
      const v = o[k];
      if (col && col.type === 'date') return d(v);
      return esc(v);
    })
  );
  const note = data.observations.length > (sec.limit || 60) ? '<p class="note">Showing ' + (sec.limit || 60) + ' of ' + data.observations.length + ' observations. The full register is available in the Excel export.</p>' : '';
  return table(used.map((k) => (cols.find((c) => c.key === k) || { label: k }).label), rows) + note;
}

function openActionsTable(data, limit) {
  const rows = data.actions.slice(0, limit || 40).map((a) => [esc(a.action_no), esc(a.source_no), esc(a.title), esc(a.responsible), d(a.target_date), actOverdue(a) ? '<b class="od">Overdue</b>' : esc(a.status.replace('_', ' '))]);
  return table(['Action No', 'Source', 'Action', 'Responsible', 'Target', 'Status'], rows);
}

function signoff(roles) {
  const head = '<tr><th>Role</th><th>Name</th><th>Designation</th><th>Signature</th><th>Date</th></tr>';
  const body = roles.map((r) => '<tr class="sig"><td><b>' + esc(r) + '</b></td><td></td><td></td><td></td><td></td></tr>').join('');
  return '<table class="grid signtab">' + head + body + '</table>';
}

function renderSection(sec, data, tpl) {
  const t = sec.title || '';
  switch (sec.type) {
    case 'summary':
      return section(t, '<p class="para">' + esc(narrative(data)) + '</p>');
    case 'kpi':
      return section(t, kpiBlock(data));
    case 'risk_table':
      return section(t, table(['Risk rating', 'Count', 'Share'], countRows(data.obsSum.byRisk, data.obsSum.total), { right: [1, 2] }));
    case 'contractor_table':
      return section(t, table(['Contractor', 'Observations', 'Share'], countRows(data.obsSum.byContractor, data.obsSum.total), { right: [1, 2] }));
    case 'category_table':
      return section(t, table(['Hazard category', 'Count', 'Share'], countRows(data.obsSum.byCategory, data.obsSum.total), { right: [1, 2] }));
    case 'observation_table':
      return section(t, observationTable(data, sec));
    case 'photo_cards':
      return section(t, photoCards(data, sec.limit));
    case 'open_actions':
      return section(t, openActionsTable(data, sec.limit));
    case 'text':
      return section(t, '<p class="para">' + esc(sec.text) + '</p>');
    case 'signoff':
      return '<section class="sec nobreak">' + (t ? '<h2>' + esc(t) + '</h2>' : '') + signoff(tpl.signoffRoles || DEFAULT_TEMPLATE.signoffRoles) + '</section>';
    default:
      return '';
  }
}

const CSS =
  '@page{size:A4 portrait;margin:14mm 12mm 18mm}' +
  '*{box-sizing:border-box}html,body{margin:0;padding:0}' +
  'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#1a1a1a;line-height:1.4;background:#fff}' +
  '.page{max-width:186mm;margin:0 auto;padding:6mm 0 14mm}' +
  '.hdr{border-bottom:2.5px solid #1f3a5f;padding-bottom:6px;margin-bottom:10px}' +
  '.hdr .org{font-size:9pt;letter-spacing:.08em;text-transform:uppercase;color:#555}' +
  '.hdr h1{font-size:17pt;margin:2px 0 0;color:#1f3a5f}.hdr .sub{font-size:10pt;color:#444}' +
  'table{border-collapse:collapse;width:100%}' +
  '.ctrl td{border:1px solid #9aa4b2;padding:4px 7px;font-size:9pt}.ctrl td.k{background:#eef1f5;font-weight:700;width:22%}' +
  '.sec{margin-top:14px}.sec h2{font-size:11.5pt;color:#1f3a5f;border-bottom:1px solid #9aa4b2;padding-bottom:3px;margin:0 0 7px}' +
  '.para{margin:0;text-align:justify}.note{font-size:8.5pt;color:#555;margin:4px 0 0}' +
  '.grid th{background:#1f3a5f;color:#fff;text-align:left;font-size:9pt;padding:4px 6px;border:1px solid #1f3a5f}' +
  '.grid td{border:1px solid #9aa4b2;padding:4px 6px;font-size:9pt;vertical-align:top;word-break:break-word}' +
  '.grid tr:nth-child(even) td{background:#f6f8fa}.r{text-align:right}.none{color:#666;font-style:italic;text-align:center}' +
  '.od{color:#b42318}' +
  '.kpis{display:flex;flex-wrap:wrap;gap:0;border:1px solid #9aa4b2}' +
  '.kpi{flex:1 1 25%;min-width:25%;padding:7px 8px;border-right:1px solid #9aa4b2;border-bottom:1px solid #9aa4b2;text-align:center}' +
  '.kpi b{display:block;font-size:15pt;color:#1f3a5f}.kpi span{font-size:8.5pt;color:#444}' +
  '.card{border:1px solid #9aa4b2;margin-bottom:10px;page-break-inside:avoid;break-inside:avoid}' +
  '.cardh{background:#eef1f5;padding:4px 8px;display:flex;gap:14px;flex-wrap:wrap;font-size:9pt;border-bottom:1px solid #9aa4b2}' +
  '.pair{display:flex;gap:0}.ph{flex:1;border-right:1px solid #9aa4b2;padding:4px;min-width:0}.ph:last-child{border-right:0}' +
  '.phl{font-size:8pt;font-weight:700;color:#1f3a5f;margin-bottom:3px;letter-spacing:.06em}' +
  '.ph img{width:100%;height:60mm;object-fit:contain;background:#f1f1f1;display:block}' +
  '.nophoto{height:60mm;display:flex;align-items:center;justify-content:center;background:#f1f1f1;color:#777;font-size:9pt}' +
  '.cardb{padding:5px 8px;font-size:9pt;border-top:1px solid #9aa4b2}.cardb div{margin-bottom:2px}' +
  '.signtab td{height:34px}.signtab tr.sig td:first-child{width:18%}' +
  '.nobreak{page-break-inside:avoid;break-inside:avoid}' +
  '.pfooter{position:fixed;left:0;right:0;bottom:0;font-size:8pt;color:#555;border-top:1px solid #9aa4b2;padding-top:3px;display:flex;justify-content:space-between;background:#fff}' +
  '@media screen{body{background:#e9edf1}.page{background:#fff;padding:12mm;margin:8px auto;box-shadow:0 1px 6px rgba(0,0,0,.2)}.pfooter{position:static;margin-top:12px}}' +
  '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';

export function renderReportHtml(data, template) {
  const tpl = template && template.sections ? template : DEFAULT_TEMPLATE;
  const ctrl = [
    ['Report No', data.reportNo, 'Report date', formatDate(data.generatedOn)],
    ['Project', data.projectName + (data.projectNo ? ' (' + data.projectNo + ')' : ''), 'Period', formatDate(data.period.from) + (data.period.to !== data.period.from ? ' to ' + formatDate(data.period.to) : '')],
    ['Client', data.clientName || '-', 'Site', data.site || '-'],
    ['Main contractor', data.mainContractor || '-', 'Country / standard', data.country + (data.auditStandard ? ' / ' + data.auditStandard.toUpperCase() : '')],
    ['Prepared by', data.preparedBy || '-', 'Document status', 'Issued for review']
  ];
  const ctrlHtml = '<table class="ctrl">' + ctrl.map((r) => '<tr><td class="k">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td class="k">' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>').join('') + '</table>';
  const title = tpl.title || DEFAULT_TEMPLATE.title;
  const body = tpl.sections.map((s) => renderSection(s, data, tpl)).join('');
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title + ' - ' + data.reportNo) + '</title><style>' + CSS + '</style></head><body><div class="page">' +
    '<div class="hdr"><div class="org">' + esc(data.clientName || data.projectName) + ' · Health, Safety &amp; Environment</div><h1>' + esc(title) + '</h1>' + (tpl.subtitle ? '<div class="sub">' + esc(tpl.subtitle) + '</div>' : '') + '</div>' +
    ctrlHtml + body +
    '<div class="pfooter"><span>' + esc(data.reportNo) + ' · ' + esc(data.projectName) + '</span><span>Confidential: prepared from site HSE records</span></div></div></body></html>'
  );
}

/* ---------- Output ---------- */

export function printReport(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 60000);
    }
  };
  if (frame.contentWindow.document.readyState === 'complete') setTimeout(go, 400);
  else frame.onload = () => setTimeout(go, 400);
}

export function reportFileName(data) {
  return (data.reportNo + '_' + data.projectName).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) + '.html';
}

export function downloadReportHtml(html, name) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'HSE-Report.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/* Opens the phone share sheet (Gmail, WhatsApp, Drive...) with the report file attached */
export async function shareReport(html, name, subject) {
  const file = new File([html], name || 'HSE-Report.html', { type: 'text/html' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: subject || 'HSE Report', text: subject || 'HSE Report' });
    return true;
  }
  downloadReportHtml(html, name);
  return false;
}

export function mailtoLink(data, to) {
  const subject = 'HSE Report ' + data.reportNo + ' - ' + data.projectName;
  const body = 'Please find the HSE report for ' + data.projectName + ' (' + formatDate(data.period.from) + ' to ' + formatDate(data.period.to) + ').\n\nObservations: ' + data.obsSum.total + ', open: ' + data.obsSum.open + ', overdue: ' + data.obsSum.overdue + ', incidents: ' + data.incSum.total + '.\n\nRegards,\n' + (data.preparedBy || '');
  return 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

export { obsOverdue, severityOf };
