/* NASUR - Clients & Projects module (Phase 3) */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { listRegions, listIndustries, getRegion, loadRegions } from '../services/regions.js';
import {
  AUDIT_STANDARDS,
  PROJECT_STATUSES,
  listClients,
  getClient,
  saveClient,
  archiveClient,
  removeClient,
  listProjects,
  saveProject,
  archiveProject,
  removeProject,
  getActiveProject,
  setActiveProject,
  listRequirements,
  addRequirement,
  resolveRequirements,
  removeRequirement
} from '../services/clients.js';

export const id = 'clients';

let root = null;
let selectedClientId = null;
let form = null;

function toast(message, type) {
  emit(EVENTS.TOAST, { message, type: type || 'info' });
}

function ensureCss(href) {
  if (document.querySelector('link[data-nasur-css="' + href + '"]')) return;
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => (l.getAttribute('href') || '').indexOf(href) >= 0);
  if (existing) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.setAttribute('data-nasur-css', href);
  document.head.appendChild(l);
}

function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
  }
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    if (Array.isArray(c)) c.forEach((x) => x && el.appendChild(x.nodeType ? x : document.createTextNode(String(x))));
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function labelOf(list, id) {
  const f = list.find((x) => x.id === id);
  return f ? f.label : id || '-';
}

function field(label, control) {
  return h('label', { class: 'st-provider' }, h('span', { class: 'st-label', text: label }), control);
}

function textInput(data, key, placeholder, type) {
  const i = h('input', { class: 'st-input', type: type || 'text', placeholder: placeholder || '', value: data[key] != null ? data[key] : '', autocomplete: 'off' });
  i.addEventListener('input', () => {
    data[key] = i.value;
  });
  return i;
}

function selectInput(data, key, options, onChange) {
  const s = h('select', { class: 'st-select' });
  options.forEach((o) => {
    const opt = h('option', { value: o.id, text: o.label });
    if (o.id === data[key]) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => {
    data[key] = s.value;
    if (onChange) onChange();
  });
  return s;
}

/* ---------- Forms ---------- */

function clientForm() {
  const d = form.data;
  const region = getRegion(d.country);
  const subs = region.subRegions || [];
  if (!subs.some((s) => s.id === d.subRegion)) d.subRegion = subs[0] ? subs[0].id : null;
  d.auditStandards = d.auditStandards || [];

  const chips = h('div', { class: 'st-chips' });
  AUDIT_STANDARDS.forEach((a) => {
    const b = h('button', {
      class: 'st-chip',
      type: 'button',
      text: a.label,
      'aria-pressed': d.auditStandards.includes(a.id) ? 'true' : 'false',
      onclick: () => {
        const i = d.auditStandards.indexOf(a.id);
        if (i >= 0) d.auditStandards.splice(i, 1);
        else d.auditStandards.push(a.id);
        b.setAttribute('aria-pressed', d.auditStandards.includes(a.id) ? 'true' : 'false');
      }
    });
    chips.appendChild(b);
  });

  const notes = h('textarea', { class: 'st-input', rows: '3', placeholder: 'Client rules, special PPE, induction, reporting format…' });
  notes.value = d.notes || '';
  notes.addEventListener('input', () => {
    d.notes = notes.value;
  });

  return h(
    'section',
    { class: 'st-card' },
    h('h2', { text: d.id ? 'Edit client' : 'New client' }),
    field('Client name', textInput(d, 'name', 'e.g. ABC Industries')),
    field('Country / region', selectInput(d, 'country', listRegions().map((r) => ({ id: r.id, label: r.label })), render)),
    subs.length ? field('Sub-region', selectInput(d, 'subRegion', subs)) : null,
    field('Industry', selectInput(d, 'industry', listIndustries())),
    h('span', { class: 'st-label', text: 'Audit standards' }),
    chips,
    field('Client contact', textInput(d, 'contactName', 'Name')),
    field('Contact email', textInput(d, 'contactEmail', 'name@company.com', 'email')),
    field('Notes', notes),
    h(
      'div',
      { class: 'st-row' },
      h('button', {
        class: 'st-btn',
        type: 'button',
        text: 'Save client',
        onclick: async () => {
          try {
            const rec = await saveClient(d);
            selectedClientId = rec.id;
            form = null;
            toast('Client saved', 'success');
            render();
          } catch (e) {
            toast(e.message, 'error');
          }
        }
      }),
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => { form = null; render(); } })
    )
  );
}

function projectForm(client) {
  const d = form.data;
  const region = getRegion(d.country);
  const subs = region.subRegions || [];
  if (!subs.some((s) => s.id === d.subRegion)) d.subRegion = subs[0] ? subs[0].id : null;
  const stdIds = AUDIT_STANDARDS.filter((a) => (client.auditStandards || []).includes(a.id) || a.id === d.auditStandard);
  const stds = stdIds.length ? stdIds : AUDIT_STANDARDS;

  return h(
    'section',
    { class: 'st-card' },
    h('h2', { text: d.id ? 'Edit project' : 'New project for ' + client.name }),
    field('Project name', textInput(d, 'name', 'e.g. Plant Expansion Phase 2')),
    field('Project no.', textInput(d, 'projectNo', 'Optional')),
    field('Site / location', textInput(d, 'site', 'Site or city')),
    field('Main contractor', textInput(d, 'mainContractor', 'Optional')),
    field('Country / region', selectInput(d, 'country', listRegions().map((r) => ({ id: r.id, label: r.label })), render)),
    subs.length ? field('Sub-region', selectInput(d, 'subRegion', subs)) : null,
    field('Industry', selectInput(d, 'industry', listIndustries())),
    field('Audit standard', selectInput(d, 'auditStandard', stds)),
    field('Status', selectInput(d, 'status', PROJECT_STATUSES)),
    field('Start date', textInput(d, 'startDate', '', 'date')),
    field('End date', textInput(d, 'endDate', '', 'date')),
    field('Manpower', textInput(d, 'manpower', 'Workers on site', 'number')),
    h(
      'div',
      { class: 'st-row' },
      h('button', {
        class: 'st-btn',
        type: 'button',
        text: 'Save project',
        onclick: async () => {
          try {
            await saveProject({ ...d, clientId: client.id });
            form = null;
            toast('Project saved', 'success');
            render();
          } catch (e) {
            toast(e.message, 'error');
          }
        }
      }),
      h('button', { class: 'st-btn secondary', type: 'button', text: 'Cancel', onclick: () => { form = null; render(); } })
    )
  );
}

/* ---------- Sections ---------- */

async function activeBanner() {
  const p = await getActiveProject();
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Active project' }));
  if (!p) {
    c.appendChild(h('p', { class: 'st-hint', text: 'No active project. Pick one below to isolate observations, reports and checklists.' }));
    return c;
  }
  const client = await getClient(p.clientId);
  c.appendChild(h('p', { class: 'st-label', text: (client ? client.name + ' · ' : '') + p.name }));
  c.appendChild(h('p', { class: 'st-hint', text: getRegion(p.country).label + ' · ' + labelOf(listIndustries(), p.industry) + ' · ' + labelOf(AUDIT_STANDARDS, p.auditStandard) + (p.site ? ' · ' + p.site : '') }));
  return c;
}

async function clientListSection(clients) {
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Clients' }));
  if (!clients.length) c.appendChild(h('p', { class: 'st-hint', text: 'No clients yet. Add your first client to start.' }));
  const grid = h('div', { class: 'st-grid' });
  clients.forEach((cl) => {
    grid.appendChild(
      h(
        'button',
        {
          class: 'st-region',
          type: 'button',
          'aria-pressed': cl.id === selectedClientId ? 'true' : 'false',
          onclick: () => {
            selectedClientId = cl.id;
            form = null;
            render();
          }
        },
        h('b', { text: cl.name }),
        h('small', { text: getRegion(cl.country).label + ' · ' + labelOf(listIndustries(), cl.industry) })
      )
    );
  });
  c.appendChild(grid);
  c.appendChild(
    h('button', {
      class: 'st-btn',
      type: 'button',
      text: '+ Add client',
      onclick: () => {
        const r = getRegion();
        form = { kind: 'client', data: { country: r.id, industry: 'manufacturing', auditStandards: ['iso45001'] } };
        render();
      }
    })
  );
  return c;
}

async function requirementsSection(client) {
  const reqs = await listRequirements(client.id);
  const pending = reqs.filter((r) => r.status === 'pending');
  const approved = reqs.filter((r) => r.status === 'approved');
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Client requirements' }));

  if (pending.length) {
    c.appendChild(h('p', { class: 'st-hint', text: 'Macha, JARVIS found these client rules. Shall I save them into your app?' }));
    c.appendChild(
      h(
        'ul',
        { class: 'st-list' },
        pending.map((r) =>
          h(
            'li',
            { class: 'on' },
            r.title,
            h('small', { text: (r.detail ? r.detail + ' · ' : '') + r.source }),
            h(
              'div',
              { class: 'st-row' },
              h('button', { class: 'st-btn small', type: 'button', text: 'Okay, save', onclick: async () => { await resolveRequirements(client.id, [r.id], true); render(); } }),
              h('button', { class: 'st-btn secondary small', type: 'button', text: 'Skip', onclick: async () => { await resolveRequirements(client.id, [r.id], false); render(); } })
            )
          )
        )
      )
    );
  }

  c.appendChild(
    approved.length
      ? h(
          'ul',
          { class: 'st-list' },
          approved.map((r) =>
            h(
              'li',
              null,
              r.title,
              h('small', { text: (r.detail ? r.detail + ' · ' : '') + r.source }),
              h('button', { class: 'st-btn secondary small', type: 'button', text: 'Remove', onclick: async () => { await removeRequirement(client.id, r.id); render(); } })
            )
          )
        )
      : h('p', { class: 'st-hint', text: 'No saved requirements yet.' })
  );

  const t = h('input', { class: 'st-input', type: 'text', placeholder: 'Requirement (e.g. Full-body harness only, 2 lanyards)' });
  const dt = h('input', { class: 'st-input', type: 'text', placeholder: 'Detail / source (optional)' });
  c.appendChild(t);
  c.appendChild(dt);
  c.appendChild(
    h('button', {
      class: 'st-btn small',
      type: 'button',
      text: 'Add requirement',
      onclick: async () => {
        if (!t.value.trim()) return toast('Enter the requirement', 'error');
        await addRequirement(client.id, t.value, dt.value);
        render();
      }
    })
  );
  return c;
}

async function projectsSection(client) {
  const projects = await listProjects(client.id, { includeArchived: true });
  const active = await getActiveProject();
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Projects · ' + client.name }));
  if (!projects.length) c.appendChild(h('p', { class: 'st-hint', text: 'No projects for this client yet.' }));

  projects.forEach((p) => {
    const isActive = active && active.id === p.id;
    c.appendChild(
      h(
        'div',
        { class: 'st-provider' },
        h(
          'div',
          { class: 'st-provider-head' },
          h('b', { text: p.name + (isActive ? ' ✓ active' : '') + (p.archived ? ' (archived)' : '') }),
          h('span', { class: 'st-status', text: labelOf(PROJECT_STATUSES, p.status) })
        ),
        h('span', { class: 'st-status', text: getRegion(p.country).label + ' · ' + labelOf(listIndustries(), p.industry) + ' · ' + labelOf(AUDIT_STANDARDS, p.auditStandard) + (p.site ? ' · ' + p.site : '') + (p.manpower ? ' · ' + p.manpower + ' workers' : '') }),
        h(
          'div',
          { class: 'st-chips' },
          !p.archived && !isActive
            ? h('button', { class: 'st-btn small', type: 'button', text: 'Make active', onclick: async () => { await setActiveProject(p.id); toast('Active: ' + p.name, 'success'); render(); } })
            : null,
          h('button', { class: 'st-btn secondary small', type: 'button', text: 'Edit', onclick: () => { form = { kind: 'project', data: { ...p } }; render(); } }),
          h('button', { class: 'st-btn secondary small', type: 'button', text: p.archived ? 'Restore' : 'Archive', onclick: async () => { await archiveProject(p.id, !p.archived); render(); } }),
          h('button', {
            class: 'st-btn danger small',
            type: 'button',
            text: 'Delete',
            onclick: async () => {
              if (!window.confirm('Delete project "' + p.name + '"? Linked records keep their project ID.')) return;
              await removeProject(p.id);
              render();
            }
          })
        )
      )
    );
  });

  c.appendChild(
    h('button', {
      class: 'st-btn',
      type: 'button',
      text: '+ Add project',
      onclick: () => {
        form = {
          kind: 'project',
          data: { country: client.country, subRegion: client.subRegion, industry: client.industry, auditStandard: (client.auditStandards || [])[0] || 'iso45001', status: 'active' }
        };
        render();
      }
    })
  );
  return c;
}

function clientActions(client) {
  return h(
    'section',
    { class: 'st-card' },
    h('h2', { text: client.name }),
    h('p', { class: 'st-hint', text: getRegion(client.country).label + ' · ' + labelOf(listIndustries(), client.industry) + ' · ' + ((client.auditStandards || []).map((a) => labelOf(AUDIT_STANDARDS, a)).join(', ') || 'No audit standard') + (client.contactName ? ' · ' + client.contactName : '') }),
    client.notes ? h('p', { class: 'st-hint', text: client.notes }) : null,
    h(
      'div',
      { class: 'st-chips' },
      h('button', { class: 'st-btn secondary small', type: 'button', text: 'Edit client', onclick: () => { form = { kind: 'client', data: { ...client } }; render(); } }),
      h('button', { class: 'st-btn secondary small', type: 'button', text: client.archived ? 'Restore' : 'Archive', onclick: async () => { await archiveClient(client.id, !client.archived); render(); } }),
      h('button', {
        class: 'st-btn danger small',
        type: 'button',
        text: 'Delete',
        onclick: async () => {
          if (!window.confirm('Delete "' + client.name + '" and ALL its projects?')) return;
          await removeClient(client.id);
          selectedClientId = null;
          render();
        }
      })
    )
  );
}

/* ---------- Lifecycle ---------- */

async function render() {
  if (!root) return;
  const clients = await listClients({ includeArchived: false });
  if (selectedClientId && !(await getClient(selectedClientId))) selectedClientId = null;
  if (!selectedClientId && clients.length) selectedClientId = clients[0].id;
  const client = selectedClientId ? await getClient(selectedClientId) : null;

  const wrap = h(
    'div',
    { class: 'st-wrap' },
    h('h1', { class: 'st-title', text: 'Clients & Projects' }),
    h('p', { class: 'st-sub', text: 'Each project keeps its own records, country, industry and audit standard' }),
    await activeBanner(),
    form && form.kind === 'client' ? clientForm() : null,
    await clientListSection(clients)
  );

  if (client) {
    wrap.appendChild(clientActions(client));
    if (form && form.kind === 'project') wrap.appendChild(projectForm(client));
    wrap.appendChild(await projectsSection(client));
    wrap.appendChild(await requirementsSection(client));
  }
  if (root) root.replaceChildren(wrap);
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  await loadRegions();
  await render();
}

export function unmount() {
  root = null;
  form = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
