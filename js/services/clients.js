/* NASUR - Clients & Projects service (Phase 3)
   Clients and projects live in the PROJECTS store, told apart by record.type.
   Every project is bound to a country, industry and audit standard. */
import { STORES, EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import * as repo from './repo.js';
import { cleanText } from './sanitize.js';
import { setActiveRegion, setActiveSubRegion, setActiveIndustry, getRegion, listIndustries } from './regions.js';

export const AUDIT_STANDARDS = [
  { id: 'iso45001', label: 'ISO 45001' },
  { id: 'cor', label: 'COR (Canada)' },
  { id: 'osha', label: 'OSHA compliance (USA)' },
  { id: 'vpp', label: 'OSHA VPP' },
  { id: 'adnoc', label: 'ADNOC HSE' },
  { id: 'aramco', label: 'Saudi Aramco' },
  { id: 'factories', label: 'Factories Act / State Inspectorate (India)' },
  { id: 'client', label: 'Client-specific audit' },
  { id: 'contractor', label: 'Main contractor audit' }
];

export const PROJECT_STATUSES = [
  { id: 'planning', label: 'Planning' },
  { id: 'active', label: 'Active' },
  { id: 'onhold', label: 'On hold' },
  { id: 'closed', label: 'Closed' }
];

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function txt(v, max) {
  return cleanText(v == null ? '' : String(v), { max: max || 200 });
}

async function all() {
  const rows = await repo.list(STORES.PROJECTS);
  return Array.isArray(rows) ? rows : [];
}

function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''));
}

/* ---------- Clients ---------- */

export async function listClients(opts) {
  const includeArchived = !!(opts && opts.includeArchived);
  return (await all())
    .filter((r) => r.type === 'client' && (includeArchived || !r.archived))
    .sort(byName);
}

export async function getClient(id) {
  if (!id) return null;
  const rec = await repo.get(STORES.PROJECTS, id);
  return rec && rec.type === 'client' ? rec : null;
}

export async function saveClient(data) {
  const name = txt(data.name, 120);
  if (!name) throw new Error('Client name is required');
  const now = new Date().toISOString();
  const prev = data.id ? await getClient(data.id) : null;
  const region = getRegion(data.country);
  const subs = region.subRegions || [];
  const rec = {
    ...(prev || {}),
    id: prev ? prev.id : data.id || uid('cli'),
    type: 'client',
    name,
    country: region.id,
    subRegion: subs.some((s) => s.id === data.subRegion) ? data.subRegion : subs[0] ? subs[0].id : null,
    industry: listIndustries().some((i) => i.id === data.industry) ? data.industry : 'manufacturing',
    auditStandards: Array.isArray(data.auditStandards) ? data.auditStandards.filter((a) => AUDIT_STANDARDS.some((s) => s.id === a)) : [],
    contactName: txt(data.contactName, 100),
    contactEmail: txt(data.contactEmail, 120),
    notes: txt(data.notes, 1000),
    requirements: prev ? prev.requirements || [] : [],
    archived: !!(prev && prev.archived),
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now
  };
  await repo.save(STORES.PROJECTS, rec);
  return rec;
}

export async function archiveClient(id, flag) {
  const rec = await getClient(id);
  if (!rec) return null;
  rec.archived = flag !== false;
  rec.updatedAt = new Date().toISOString();
  await repo.save(STORES.PROJECTS, rec);
  return rec;
}

export async function removeClient(id) {
  const projects = await listProjects(id, { includeArchived: true });
  const active = await repo.getActiveProjectId();
  for (const p of projects) {
    await repo.remove(STORES.PROJECTS, p.id);
    if (p.id === active) await repo.setActiveProjectId(null);
  }
  await repo.remove(STORES.PROJECTS, id);
  return true;
}

/* ---------- Projects ---------- */

export async function listProjects(clientId, opts) {
  const includeArchived = !!(opts && opts.includeArchived);
  return (await all())
    .filter((r) => r.type === 'project' && (!clientId || r.clientId === clientId) && (includeArchived || !r.archived))
    .sort(byName);
}

export async function getProject(id) {
  if (!id) return null;
  const rec = await repo.get(STORES.PROJECTS, id);
  return rec && rec.type === 'project' ? rec : null;
}

export async function saveProject(data) {
  const name = txt(data.name, 120);
  if (!name) throw new Error('Project name is required');
  const client = await getClient(data.clientId);
  if (!client) throw new Error('Select a client first');
  const now = new Date().toISOString();
  const prev = data.id ? await getProject(data.id) : null;
  const region = getRegion(data.country || client.country);
  const subs = region.subRegions || [];
  const rec = {
    ...(prev || {}),
    id: prev ? prev.id : data.id || uid('prj'),
    type: 'project',
    clientId: client.id,
    name,
    projectNo: txt(data.projectNo, 60),
    site: txt(data.site, 160),
    mainContractor: txt(data.mainContractor, 120),
    country: region.id,
    subRegion: subs.some((s) => s.id === data.subRegion) ? data.subRegion : subs[0] ? subs[0].id : null,
    industry: listIndustries().some((i) => i.id === data.industry) ? data.industry : client.industry,
    auditStandard: AUDIT_STANDARDS.some((s) => s.id === data.auditStandard) ? data.auditStandard : (client.auditStandards || [])[0] || 'iso45001',
    status: PROJECT_STATUSES.some((s) => s.id === data.status) ? data.status : 'active',
    startDate: txt(data.startDate, 10),
    endDate: txt(data.endDate, 10),
    manpower: Math.max(0, parseInt(data.manpower, 10) || 0),
    archived: !!(prev && prev.archived),
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now
  };
  await repo.save(STORES.PROJECTS, rec);
  return rec;
}

export async function archiveProject(id, flag) {
  const rec = await getProject(id);
  if (!rec) return null;
  rec.archived = flag !== false;
  rec.updatedAt = new Date().toISOString();
  await repo.save(STORES.PROJECTS, rec);
  if (rec.archived && (await repo.getActiveProjectId()) === id) await repo.setActiveProjectId(null);
  return rec;
}

export async function removeProject(id) {
  if ((await repo.getActiveProjectId()) === id) await repo.setActiveProjectId(null);
  await repo.remove(STORES.PROJECTS, id);
  return true;
}

/* ---------- Active project, context binding & isolation ---------- */

export async function getActiveProject() {
  const id = await repo.getActiveProjectId();
  return id ? getProject(id) : null;
}

export async function getProjectContext(projectId) {
  const project = projectId ? await getProject(projectId) : await getActiveProject();
  if (!project) return null;
  const client = await getClient(project.clientId);
  return {
    project,
    client,
    projectId: project.id,
    clientId: project.clientId,
    country: project.country,
    subRegion: project.subRegion,
    industry: project.industry,
    auditStandard: project.auditStandard,
    requirements: ((client && client.requirements) || []).filter((r) => r.status === 'approved')
  };
}

export async function applyProjectContext(project) {
  if (!project) return;
  await setActiveRegion(project.country, project.subRegion);
  if (project.subRegion) await setActiveSubRegion(project.subRegion);
  await setActiveIndustry(project.industry);
}

export async function setActiveProject(id) {
  const project = id ? await getProject(id) : null;
  await repo.setActiveProjectId(project ? project.id : null);
  if (project) await applyProjectContext(project);
  emit(EVENTS.PROJECT_CHANGED, { projectId: project ? project.id : null, project });
  return project;
}

/* Isolation helpers: every other module stamps records with projectId and filters with these */
export async function stampScope(record) {
  const id = await repo.getActiveProjectId();
  const ctx = id ? await getProjectContext(id) : null;
  return {
    ...record,
    projectId: id || null,
    clientId: ctx ? ctx.clientId : null,
    country: ctx ? ctx.country : record.country || null,
    industry: ctx ? ctx.industry : record.industry || null
  };
}

export async function filterToActiveProject(records) {
  const id = await repo.getActiveProjectId();
  const rows = Array.isArray(records) ? records : [];
  return id ? rows.filter((r) => r.projectId === id) : rows;
}

/* ---------- Client requirements (Rule Radar proposals need approval) ---------- */

export async function listRequirements(clientId, status) {
  const c = await getClient(clientId);
  const rows = (c && c.requirements) || [];
  return status ? rows.filter((r) => r.status === status) : rows;
}

export async function proposeRequirements(clientId, items) {
  const c = await getClient(clientId);
  if (!c) return [];
  const list = (Array.isArray(items) ? items : []).map((it) => ({
    id: uid('req'),
    title: txt(it.title, 200),
    detail: txt(it.detail, 600),
    source: txt(it.source || 'JARVIS Rule Radar', 160),
    status: 'pending',
    createdAt: new Date().toISOString()
  })).filter((r) => r.title);
  c.requirements = (c.requirements || []).concat(list);
  c.updatedAt = new Date().toISOString();
  await repo.save(STORES.PROJECTS, c);
  return list;
}

export async function addRequirement(clientId, title, detail) {
  const added = await proposeRequirements(clientId, [{ title, detail, source: 'Entered by user' }]);
  if (!added.length) return null;
  const ids = [added[0].id];
  await resolveRequirements(clientId, ids, true);
  return added[0];
}

export async function resolveRequirements(clientId, ids, approve) {
  const c = await getClient(clientId);
  if (!c) return false;
  const set = new Set(ids);
  const now = new Date().toISOString();
  for (const r of c.requirements || []) {
    if (!set.has(r.id)) continue;
    r.status = approve ? 'approved' : 'rejected';
    r.resolvedAt = now;
    if (approve) {
      await repo.save(STORES.MEMORY_NOTES, {
        id: 'mem_' + r.id,
        kind: 'client-requirement',
        clientId: c.id,
        title: r.title,
        detail: r.detail,
        source: r.source,
        createdAt: now,
        updatedAt: now
      });
    }
  }
  c.updatedAt = now;
  await repo.save(STORES.PROJECTS, c);
  return true;
}

export async function removeRequirement(clientId, reqId) {
  const c = await getClient(clientId);
  if (!c) return false;
  c.requirements = (c.requirements || []).filter((r) => r.id !== reqId);
  c.updatedAt = new Date().toISOString();
  await repo.save(STORES.PROJECTS, c);
  await repo.remove(STORES.MEMORY_NOTES, 'mem_' + reqId);
  return true;
}
