/* NASUR - Settings module (Phase 3) */
import { EVENTS, THEMES } from '../core/config.js';
import { emit } from '../core/eventbus.js';
import { getTheme, setTheme, getUserConfig, updateUserConfig } from '../services/config.js';
import { cleanText } from '../services/sanitize.js';
import {
  loadRegions,
  listRegions,
  listIndustries,
  getActiveRegion,
  getActiveRegionId,
  getActiveSubRegionId,
  getActiveIndustryId,
  setActiveRegion,
  setActiveSubRegion,
  setActiveIndustry,
  getHazards,
  getEmergency,
  getHeatInfo,
  formatTemp,
  formatDate
} from '../services/regions.js';
import {
  LANGUAGES,
  PROVIDERS,
  MAX_INPUT_CHARS,
  getSettings,
  saveSettings,
  setApiKey,
  maskKey,
  moveProvider,
  hasPin,
  setPin,
  clearPin,
  verifyPin,
  isValidPin,
  lockNow,
  applyDisplayPrefs
} from '../services/settings.js';

export const id = 'settings';

let root = null;

function toast(message, type) {
  emit(EVENTS.TOAST, { message, type: type || 'info' });
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

function card(title, hint) {
  const c = h('section', { class: 'st-card' }, h('h2', { text: title }));
  if (hint) c.appendChild(h('p', { class: 'st-hint', text: hint }));
  return c;
}

function toggleRow(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', 'aria-label': label });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'st-row' }, h('span', { class: 'st-label', text: label }), h('label', { class: 'st-switch' }, input, h('i')));
}

function selectRow(label, options, value, onChange) {
  const sel = h('select', { class: 'st-select', 'aria-label': label });
  options.forEach((o) => {
    const opt = h('option', { value: o.id, text: o.label });
    if (o.id === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'st-row' }, h('span', { class: 'st-label', text: label }), sel);
}

/* ---------- Sections ---------- */

function regionSection() {
  const activeId = getActiveRegionId();
  const region = getActiveRegion();
  const c = card('Country / Region', 'Switch laws, standards, units and regional hazards instantly.');
  const grid = h('div', { class: 'st-grid' });
  listRegions().forEach((r) => {
    const b = h(
      'button',
      {
        class: 'st-region',
        type: 'button',
        'aria-pressed': r.id === activeId ? 'true' : 'false',
        onclick: async () => {
          await setActiveRegion(r.id);
          toast('Region: ' + r.label, 'success');
          render();
        }
      },
      h('b', { text: r.label }),
      h('small', { text: (r.units && r.units.system === 'imperial' ? 'Imperial' : 'Metric') + ' · ' + (r.format && r.format.currency) })
    );
    grid.appendChild(b);
  });
  c.appendChild(grid);

  const subs = region.subRegions || [];
  if (subs.length) {
    c.appendChild(selectRow('Sub-region', subs, getActiveSubRegionId(), async (v) => {
      await setActiveSubRegion(v);
      render();
    }));
  }

  const chips = h('div', { class: 'st-chips' });
  const ind = getActiveIndustryId();
  listIndustries().forEach((i) => {
    chips.appendChild(
      h('button', {
        class: 'st-chip',
        type: 'button',
        'aria-pressed': i.id === ind ? 'true' : 'false',
        text: i.label,
        onclick: async () => {
          await setActiveIndustry(i.id);
          render();
        }
      })
    );
  });
  c.appendChild(h('span', { class: 'st-label', text: 'Industry' }));
  c.appendChild(chips);
  return c;
}

function regionInfoSection() {
  const region = getActiveRegion();
  const c = card(region.label + ' rule pack', 'Starter data. JARVIS Rule Radar re-checks these with you before audit use.');

  const em = getEmergency();
  const emBox = h('div', { class: 'st-emerg' });
  Object.keys(em).forEach((k) => {
    if (k === 'note') return;
    emBox.appendChild(h('span', { text: k.charAt(0).toUpperCase() + k.slice(1) + ': ' + em[k] }));
  });
  c.appendChild(h('span', { class: 'st-label', text: 'Emergency numbers' }));
  c.appendChild(emBox);
  if (em.note) c.appendChild(h('p', { class: 'st-hint', text: em.note }));

  const heat = getHeatInfo();
  c.appendChild(h('p', { class: 'st-hint', text: 'Heat index: ' + heat.indexType + (heat.middayBan ? ' · Midday ban: ' + heat.middayBan : '') + ' · 35°C shows as ' + formatTemp(35) + ' · Today ' + formatDate(new Date()) }));

  c.appendChild(h('span', { class: 'st-label', text: 'Laws & codes' }));
  c.appendChild(h('ul', { class: 'st-list' }, (region.laws || []).map((l) => h('li', { text: l.title }))));

  c.appendChild(h('span', { class: 'st-label', text: 'Regional hazards (this month highlighted)' }));
  c.appendChild(
    h(
      'ul',
      { class: 'st-list' },
      getHazards(new Date()).map((hz) =>
        h('li', { class: hz.active ? 'on' : '' }, hz.label, hz.active ? h('span', { class: 'st-tag', text: 'NOW' }) : null, h('small', { text: hz.season + ' · ' + (hz.controls || []).join(' · ') }))
      )
    )
  );
  return c;
}

function preferencesSection() {
  const s = getSettings();
  const cfg = getUserConfig() || {};
  const region = getActiveRegion();
  const langs = LANGUAGES.filter((l) => region.languages.includes(l.id) || l.id === cfg.language);
  const c = card('Preferences');
  c.appendChild(selectRow('JARVIS language', langs, cfg.language || region.languages[0], async (v) => {
    await updateUserConfig({ language: v });
    toast('Language saved', 'success');
  }));
  c.appendChild(selectRow('Theme', [
    { id: THEMES.AUTO, label: 'Auto' },
    { id: THEMES.LIGHT, label: 'Light' },
    { id: THEMES.DARK, label: 'Dark' }
  ], getTheme(), (v) => setTheme(v)));
  c.appendChild(selectRow('Units', [
    { id: 'region', label: 'By region' },
    { id: 'metric', label: 'Metric' },
    { id: 'imperial', label: 'Imperial' }
  ], s.unitSystem, async (v) => {
    await saveSettings({ unitSystem: v });
    render();
  }));
  c.appendChild(selectRow('Text size', [
    { id: '0.9', label: 'Small' },
    { id: '1', label: 'Normal' },
    { id: '1.15', label: 'Large' },
    { id: '1.3', label: 'Extra large' }
  ], String(s.fontScale), async (v) => {
    await saveSettings({ fontScale: parseFloat(v) || 1 });
    applyDisplayPrefs();
  }));
  c.appendChild(toggleRow('Reduce motion', s.reduceMotion, async (v) => {
    await saveSettings({ reduceMotion: v });
    applyDisplayPrefs();
  }));
  c.appendChild(toggleRow('Compress photos automatically', s.autoCompressPhotos, (v) => saveSettings({ autoCompressPhotos: v })));
  c.appendChild(toggleRow('JARVIS speaks replies', s.voiceReplies, (v) => saveSettings({ voiceReplies: v })));
  return c;
}

function pinSection() {
  const enabled = hasPin();
  const c = card('Privacy PIN lock', 'Optional 4-digit PIN. Stored only as a salted hash on this device.');
  const pin = h('input', { class: 'st-input', type: 'password', inputmode: 'numeric', maxlength: '4', placeholder: enabled ? 'Current PIN' : 'New 4-digit PIN', autocomplete: 'off' });
  const pin2 = h('input', { class: 'st-input', type: 'password', inputmode: 'numeric', maxlength: '4', placeholder: 'Confirm new PIN', autocomplete: 'off' });
  c.appendChild(pin);
  if (!enabled) c.appendChild(pin2);

  const row = h('div', { class: 'st-row' });
  if (!enabled) {
    row.appendChild(
      h('button', {
        class: 'st-btn',
        type: 'button',
        text: 'Enable PIN',
        onclick: async () => {
          if (!isValidPin(pin.value)) return toast('PIN must be 4 digits', 'error');
          if (pin.value !== pin2.value) return toast('PINs do not match', 'error');
          await setPin(pin.value);
          toast('PIN lock enabled', 'success');
          render();
        }
      })
    );
  } else {
    row.appendChild(
      h('button', {
        class: 'st-btn danger',
        type: 'button',
        text: 'Remove PIN',
        onclick: async () => {
          const ok = await clearPin(pin.value);
          toast(ok ? 'PIN removed' : 'Wrong PIN', ok ? 'success' : 'error');
          if (ok) render();
        }
      })
    );
    row.appendChild(
      h('button', {
        class: 'st-btn secondary',
        type: 'button',
        text: 'Lock now',
        onclick: async () => {
          if (!(await verifyPin(pin.value))) return toast('Wrong PIN', 'error');
          lockNow();
          toast('Locked. Enter PIN on next open.', 'success');
        }
      })
    );
  }
  c.appendChild(row);
  return c;
}

function providersSection() {
  const s = getSettings();
  const c = card('JARVIS AI providers', 'Add your own keys. JARVIS tries them in this order, then falls back to the offline engine. Input limit: ' + MAX_INPUT_CHARS.toLocaleString() + ' characters.');
  s.providerOrder.forEach((pid, idx) => {
    const p = PROVIDERS.find((x) => x.id === pid);
    if (!p) return;
    const key = s.apiKeys[pid] || '';
    const input = h('input', { class: 'st-input', type: 'password', placeholder: key ? maskKey(key) : 'Paste API key', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const head = h(
      'div',
      { class: 'st-provider-head' },
      h('b', { text: idx + 1 + '. ' + p.label }),
      h(
        'span',
        null,
        h('button', { class: 'st-btn secondary small', type: 'button', text: '↑', 'aria-label': 'Move up', disabled: idx === 0, onclick: async () => { await moveProvider(pid, -1); render(); } }),
        ' ',
        h('button', { class: 'st-btn secondary small', type: 'button', text: '↓', 'aria-label': 'Move down', disabled: idx === s.providerOrder.length - 1, onclick: async () => { await moveProvider(pid, 1); render(); } })
      )
    );
    const keyRow = h(
      'div',
      { class: 'st-provider-keyrow' },
      input,
      h('button', {
        class: 'st-btn small',
        type: 'button',
        text: 'Save',
        onclick: async () => {
          const v = cleanText(input.value, { max: 300 });
          if (!v) return toast('Paste a key first', 'error');
          await setApiKey(pid, v);
          toast(p.label + ' key saved', 'success');
          render();
        }
      }),
      key
        ? h('button', {
            class: 'st-btn secondary small',
            type: 'button',
            text: 'Clear',
            onclick: async () => {
              await setApiKey(pid, '');
              render();
            }
          })
        : null
    );
    c.appendChild(h('div', { class: 'st-provider' }, head, keyRow, h('span', { class: 'st-status', text: (key ? 'Key saved on this device' : 'No key') + ' · ' + p.hint })));
  });
  c.appendChild(toggleRow('Offline engine fallback', s.offlineEngine, (v) => saveSettings({ offlineEngine: v })));
  return c;
}

/* ---------- Lifecycle ---------- */

function render() {
  if (!root) return;
  const wrap = h(
    'div',
    { class: 'st-wrap' },
    h('h1', { class: 'st-title', text: 'Settings' }),
    h('p', { class: 'st-sub', text: 'Region, language, privacy and AI providers' }),
    regionSection(),
    regionInfoSection(),
    preferencesSection(),
    pinSection(),
    providersSection()
  );
  root.replaceChildren(wrap);
}

export async function mount(el) {
  root = el;
  root.replaceChildren(h('div', { class: 'st-wrap' }, h('p', { class: 'st-sub', text: 'Loading…' })));
  await loadRegions();
  render();
}

export const render_ = mount;
export { mount as render };

export function unmount() {
  root = null;
}

export default { id, mount, render: mount, unmount };
