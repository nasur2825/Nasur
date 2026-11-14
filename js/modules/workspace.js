/* NASUR - Workspace Layout module (Phase 3)
   Lets the user show/hide and reorder Home widgets and pin quick actions. */
import { EVENTS } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { getUserConfig, updateUserConfig } from '../services/config.js';
import { loadWorkspaceData, getWorkspaceData, getUserOverlay, saveUserOverlay, clearUserOverlay } from '../services/workspace.js';

export const id = 'workspace';

let root = null;
let layout = null;

function toast(message, type) {
  emit(EVENTS.TOAST, { message, type: type || 'info' });
}

function ensureCss(href) {
  const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => (l.getAttribute('href') || '').indexOf(href) >= 0);
  if (has) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
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

/* ---------- Reading workspace data defensively ---------- */

function toItems(src) {
  if (!src) return [];
  if (Array.isArray(src)) {
    return src
      .map((x) => (typeof x === 'string' ? { id: x, label: x } : x && x.id ? { id: x.id, label: x.label || x.title || x.name || x.id } : null))
      .filter(Boolean);
  }
  if (typeof src === 'object') {
    return Object.keys(src).map((k) => ({ id: (src[k] && src[k].id) || k, label: (src[k] && (src[k].label || src[k].title || src[k].name)) || k }));
  }
  return [];
}

function pretty(label) {
  return String(label).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function readData() {
  const d = getWorkspaceData() || {};
  const widgets = toItems(d.widgets);
  const actions = toItems(d.quick_actions || d.quickActions || d.actions);
  return { widgets, actions };
}

function baseLayout(items) {
  return {
    widget_order: items.widgets.map((w) => w.id),
    hidden_widgets: [],
    pinned_actions: items.actions.slice(0, 6).map((a) => a.id)
  };
}

async function loadLayout(items) {
  const def = baseLayout(items);
  let saved = null;
  try {
    saved = await getUserOverlay();
  } catch (e) {
    saved = null;
  }
  const cfg = getUserConfig() || {};
  const src = (saved && (saved.widget_order || saved.hidden_widgets || saved.pinned_actions) ? saved : null) || cfg.workspaceLayout || {};
  const ids = items.widgets.map((w) => w.id);
  const order = (Array.isArray(src.widget_order) ? src.widget_order : def.widget_order).filter((x) => ids.includes(x));
  ids.forEach((x) => {
    if (!order.includes(x)) order.push(x);
  });
  const actionIds = items.actions.map((a) => a.id);
  layout = {
    widget_order: order,
    hidden_widgets: (Array.isArray(src.hidden_widgets) ? src.hidden_widgets : []).filter((x) => ids.includes(x)),
    pinned_actions: (Array.isArray(src.pinned_actions) ? src.pinned_actions : def.pinned_actions).filter((x) => actionIds.includes(x))
  };
}

async function persist() {
  const base = {};
  try {
    const existing = await getUserOverlay();
    if (existing && typeof existing === 'object') Object.assign(base, existing);
  } catch (e) {
    /* no overlay yet */
  }
  const payload = { ...base, ...layout };
  try {
    await saveUserOverlay(payload);
  } catch (e) {
    await updateUserConfig({ workspaceLayout: { ...layout } });
  }
  emit(EVENTS.CONFIG_CHANGED, { key: 'workspaceLayout' });
}

/* ---------- UI ---------- */

function widgetCard(items) {
  const labels = {};
  items.widgets.forEach((w) => {
    labels[w.id] = w.label;
  });
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Home widgets' }), h('p', { class: 'st-hint', text: 'Show, hide and reorder what appears on your Home screen.' }));
  layout.widget_order.forEach((wid, idx) => {
    const hidden = layout.hidden_widgets.includes(wid);
    c.appendChild(
      h(
        'div',
        { class: 'st-provider' },
        h(
          'div',
          { class: 'st-provider-head' },
          h('b', { text: pretty(labels[wid] || wid) + (hidden ? ' (hidden)' : '') }),
          h(
            'span',
            null,
            h('button', {
              class: 'st-btn secondary small',
              type: 'button',
              text: '↑',
              'aria-label': 'Move up',
              disabled: idx === 0,
              onclick: async () => {
                layout.widget_order.splice(idx - 1, 0, layout.widget_order.splice(idx, 1)[0]);
                await persist();
                render();
              }
            }),
            ' ',
            h('button', {
              class: 'st-btn secondary small',
              type: 'button',
              text: '↓',
              'aria-label': 'Move down',
              disabled: idx === layout.widget_order.length - 1,
              onclick: async () => {
                layout.widget_order.splice(idx + 1, 0, layout.widget_order.splice(idx, 1)[0]);
                await persist();
                render();
              }
            }),
            ' ',
            h('button', {
              class: 'st-btn small' + (hidden ? '' : ' secondary'),
              type: 'button',
              text: hidden ? 'Show' : 'Hide',
              onclick: async () => {
                const k = layout.hidden_widgets.indexOf(wid);
                if (k >= 0) layout.hidden_widgets.splice(k, 1);
                else layout.hidden_widgets.push(wid);
                await persist();
                render();
              }
            })
          )
        )
      )
    );
  });
  return c;
}

function actionCard(items) {
  const c = h('section', { class: 'st-card' }, h('h2', { text: 'Pinned quick actions' }), h('p', { class: 'st-hint', text: 'Tap to pin or unpin shortcuts shown on Home.' }));
  const chips = h('div', { class: 'st-chips' });
  items.actions.forEach((a) => {
    chips.appendChild(
      h('button', {
        class: 'st-chip',
        type: 'button',
        text: pretty(a.label),
        'aria-pressed': layout.pinned_actions.includes(a.id) ? 'true' : 'false',
        onclick: async () => {
          const k = layout.pinned_actions.indexOf(a.id);
          if (k >= 0) layout.pinned_actions.splice(k, 1);
          else layout.pinned_actions.push(a.id);
          await persist();
          render();
        }
      })
    );
  });
  c.appendChild(chips);
  return c;
}

function resetCard(items) {
  return h(
    'section',
    { class: 'st-card' },
    h('h2', { text: 'Reset layout' }),
    h('button', {
      class: 'st-btn danger',
      type: 'button',
      text: 'Restore default Home layout',
      onclick: async () => {
        try {
          await clearUserOverlay();
        } catch (e) {
          /* ignore */
        }
        await updateUserConfig({ workspaceLayout: null });
        await loadLayout(items);
        emit(EVENTS.CONFIG_CHANGED, { key: 'workspaceLayout' });
        toast('Layout restored', 'success');
        render();
      }
    })
  );
}

function render() {
  if (!root || !layout) return;
  const items = readData();
  root.replaceChildren(
    h(
      'div',
      { class: 'st-wrap' },
      h('h1', { class: 'st-title', text: 'Workspace Layout' }),
      h('p', { class: 'st-sub', text: 'Customise your Home command center' }),
      widgetCard(items),
      actionCard(items),
      resetCard(items)
    )
  );
}

export async function mount(el) {
  root = el;
  ensureCss('css/settings.css');
  root.replaceChildren(h('div', { class: 'st-wrap' }, h('p', { class: 'st-sub', text: 'Loading…' })));
  try {
    await loadWorkspaceData();
    await loadLayout(readData());
    render();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'st-wrap' }, h('p', { class: 'st-hint', text: 'Could not load workspace data: ' + e.message })));
  }
}

export function unmount() {
  root = null;
  layout = null;
}

export default { id, mount, render: mount, unmount };
export { mount as render };
