/**
 * NASUR – JARVIS Floating Button and Drawer (UI shell)
 * File: js/jarvis/drawer.js
 *
 * The JARVIS window you can open from every page without leaving it:
 *   - a floating button (bottom right)
 *   - a drawer: a bottom sheet on phones, a side panel on wide screens (the
 *     side panel leaves the page behind it usable, so unsaved form data is
 *     never touched)
 *   - a message box with voice typing (js/jarvis/voice.js)
 *   - a panel showing exactly what JARVIS can see (js/jarvis/context.js)
 *
 * THIS IS A SHELL. It has no brain yet. Until the AI layer arrives (Phase 10)
 * the default responder answers every message with a plain "cannot answer
 * yet" notice. It never makes up answers. Nothing typed here is saved or
 * sent anywhere, and the chat only lives in the open page.
 *
 * RESPONDER (how Phase 10 plugs in)
 *   controller.setResponder(async ({ text, context, aiContext, signal }) => {
 *     return { text: '…', source: 'General HSE knowledge', role: 'assistant' };
 *   });
 *   text       what the person wrote (cleaned, may span lines)
 *   context    frozen page context for use ON this device (captureContext)
 *   aiContext  frozen page context allowed to go to an ONLINE AI service
 *              (nothing unless privacy.ai_enabled is on)
 *   signal     AbortSignal, aborted when the chat is cleared or the drawer
 *              is removed
 *   returns a string, or { text, source?, role? } with role "assistant"
 *   (default) or "system". `source` is the label shown above the message
 *   (for example "General HSE knowledge" or "Your uploaded document").
 *   If the responder throws, the person sees a plain error message.
 *
 * WHAT THE PERSON SEES BEFORE SENDING
 *   "What JARVIS sees" lists the page, form, field and, if the person turns
 *   it on, selected text. It is captured when the drawer opens, when the page
 *   changes, when settings change, and when "Use selected text" is switched.
 *   Typed text in forms is never part of it.
 *
 * KEYBOARD AND FOCUS
 *   Escape closes the drawer. On phones the drawer is a dialog: focus stays
 *   inside it and returns to the button when it closes. Ctrl+Enter (or
 *   Cmd+Enter) sends; Enter adds a new line.
 *
 * Mount once at start-up: mountJarvis() (js/core/app.js does this). Later
 * modules use getJarvis() to talk to it. Everything is built with the
 * classes from css/components.css and index.html's #jarvis-root.
 */

import { APP, EVENTS } from '../core/config.js';
import { on } from '../core/eventbus.js';
import { getCachedUserConfig } from '../services/config.js';
import { cleanText, html, renderHtml, truncateText } from '../services/sanitize.js';
import { buildPreview, captureContext, getContextLevel, hasSelection, levelAtLeast, startContextTracking } from './context.js';
import { VOICE_PRIVACY_NOTE, getVoiceSupport, isRecognitionSupported, startListening, stopAll } from './voice.js';


/* ==========================================================================
   1. CONSTANTS AND SMALL HELPERS
   ========================================================================== */

const MAX_MESSAGES = 60;
const MAX_INPUT_CHARS = 2000;
const MAX_SOURCE_CHARS = 80;
const MAX_TEXTAREA_PX = 128;
const ROLES = Object.freeze(['user', 'assistant', 'system']);
const GENERIC_ERROR = 'JARVIS ran into a problem and could not answer. Please try again.';
const WIDE_QUERY = '(min-width: 48rem)';

let controller = null;

/** The notice shown by the default responder. */
async function defaultResponder() {
  return {
    role: 'system',
    text: 'JARVIS cannot answer questions yet. This version shows the assistant window, voice typing and what JARVIS can see. Answers arrive in a later update. Your message was not saved or sent anywhere.'
  };
}

function isNarrow() {
  return !window.matchMedia(WIDE_QUERY).matches;
}

function joinText(base, extra) {
  const start = base.trimEnd();
  if (start === '') {
    return extra;
  }
  return extra === '' ? start : start + ' ' + extra;
}

function aiEnabled() {
  const config = getCachedUserConfig();
  return Boolean(config && config.privacy && config.privacy.ai_enabled);
}

function currentLanguage() {
  const config = getCachedUserConfig();
  return config && typeof config.language === 'string' ? config.language : 'en';
}

function createMessage(role, text, source) {
  const element = document.createElement('div');
  element.className = 'jarvis-msg';
  element.setAttribute('data-role', role);
  if (source) {
    const label = document.createElement('p');
    label.className = 'jarvis-msg__source';
    label.textContent = source;
    element.append(label);
  }
  const body = document.createElement('div');
  body.className = 'jarvis-msg__text';
  body.textContent = text;
  element.append(body);
  return element;
}

/** Turns whatever a responder returned into { role, text, source }. */
function normalizeReply(reply) {
  const data = typeof reply === 'string' ? { text: reply } : reply;
  if (data === null || typeof data !== 'object') {
    return { role: 'system', text: GENERIC_ERROR, source: null };
  }
  const text = cleanText(data.text, { multiline: true });
  if (text === '') {
    return { role: 'system', text: GENERIC_ERROR, source: null };
  }
  const source = truncateText(cleanText(data.source), MAX_SOURCE_CHARS);
  return { role: data.role === 'system' ? 'system' : 'assistant', text, source: source === '' ? null : source };
}


/* ==========================================================================
   2. PUBLIC ENTRY POINTS
   ========================================================================== */

/** The mounted JARVIS controller, or null. */
export function getJarvis() {
  return controller;
}

/** Removes JARVIS from the page (if mounted). */
export function unmountJarvis() {
  if (controller !== null) {
    controller.destroy();
  }
}

/**
 * Builds the floating button and drawer inside `options.root` (default: the
 * element #jarvis-root) and returns the controller:
 *   { open(), close(), toggle(), isOpen(), setResponder(fn), addMessage(m),
 *     clearMessages(), refreshContext(), getSnapshot(), destroy() }
 * Calling it again while mounted returns the same controller.
 * options: { root, responder }
 */
export function mountJarvis(options = {}) {
  if (controller !== null) {
    return controller;
  }
  const settings = options !== null && typeof options === 'object' ? options : {};
  const root = settings.root || document.getElementById('jarvis-root');
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('NASUR JARVIS: there is no element to mount the assistant in.');
  }
  if (settings.responder !== undefined && typeof settings.responder !== 'function') {
    throw new TypeError('NASUR JARVIS: the responder must be a function.');
  }

  const name = APP.ASSISTANT_NAME;
  const voiceAvailable = isRecognitionSupported();

  /* ---- markup ---------------------------------------------------------- */
  renderHtml(root, html`
    <button type="button" class="jarvis-fab" id="jarvis-fab" aria-label="Ask ${name}" aria-haspopup="dialog" aria-expanded="false">
      <span aria-hidden="true">✦</span><span>${name}</span>
    </button>
    <div class="jarvis-scrim" id="jarvis-scrim" data-open="false"></div>
    <aside class="jarvis-drawer" id="jarvis-drawer" data-open="false" role="dialog" aria-modal="false" aria-labelledby="jarvis-title" tabindex="-1">
      <div class="jarvis-drawer__header">
        <div>
          <h2 class="jarvis-drawer__title" id="jarvis-title">${name}</h2>
          <p class="text-sm text-muted">Your safety assistant</p>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn--ghost btn--sm" id="jarvis-btn-clear">Clear</button>
          <button type="button" class="icon-btn" id="jarvis-btn-close" aria-label="Close ${name}">
            <span class="icon-btn__glyph" aria-hidden="true">✕</span>
          </button>
        </div>
      </div>
      <div class="jarvis-drawer__body" id="jarvis-body">
        <div class="alert" id="jarvis-context-panel" hidden></div>
        <div class="stack stack--sm" id="jarvis-log" role="log" aria-live="polite" aria-label="Conversation"></div>
      </div>
      <div class="jarvis-drawer__footer stack stack--sm">
        <div class="cluster">
          <button type="button" class="btn btn--ghost btn--sm" id="jarvis-btn-context" aria-expanded="false" aria-controls="jarvis-context-panel">What ${name} sees</button>
          <button type="button" class="chip" id="jarvis-btn-selection" aria-pressed="false" hidden>Use selected text</button>
        </div>
        <div class="jarvis-input">
          <textarea class="jarvis-input__field" id="jarvis-text" rows="1" maxlength="${MAX_INPUT_CHARS}" placeholder="Ask ${name}…" aria-label="Message to ${name}"></textarea>
          <button type="button" class="icon-btn" id="jarvis-btn-mic" aria-label="Speak your message" aria-pressed="false" hidden>
            <span class="icon-btn__glyph" id="jarvis-mic-glyph" aria-hidden="true">🎤</span>
          </button>
          <button type="button" class="btn btn--primary" id="jarvis-btn-send">Send</button>
        </div>
        <p class="text-sm text-muted" id="jarvis-status" role="status"></p>
      </div>
    </aside>
  `);

  const find = (id) => root.querySelector('#' + id);
  const fab = find('jarvis-fab');
  const scrim = find('jarvis-scrim');
  const drawer = find('jarvis-drawer');
  const bodyEl = find('jarvis-body');
  const panel = find('jarvis-context-panel');
  const log = find('jarvis-log');
  const textarea = find('jarvis-text');
  const btnClose = find('jarvis-btn-close');
  const btnClear = find('jarvis-btn-clear');
  const btnContext = find('jarvis-btn-context');
  const btnSelection = find('jarvis-btn-selection');
  const btnMic = find('jarvis-btn-mic');
  const micGlyph = find('jarvis-mic-glyph');
  const btnSend = find('jarvis-btn-send');
  const statusEl = find('jarvis-status');

  /* ---- state ----------------------------------------------------------- */
  let responder = typeof settings.responder === 'function' ? settings.responder : defaultResponder;
  let open = false;
  let snapshot = null;
  let aiSnapshot = null;
  let useSelection = false;
  let session = null;
  let busy = false;
  let inflight = null;
  let introShown = false;
  let returnFocus = null;
  const stops = [];

  /* ---- small UI helpers ------------------------------------------------ */
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function scrollToEnd() {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function autoGrow() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, MAX_TEXTAREA_PX) + 'px';
  }

  function updateButtons() {
    btnSend.disabled = busy || session !== null;
    btnMic.disabled = busy;
  }

  function appendMessage(role, text, source) {
    const element = createMessage(role, text, source);
    log.append(element);
    while (log.children.length > MAX_MESSAGES) {
      log.firstElementChild.remove();
    }
    scrollToEnd();
    return element;
  }

  function showIntro() {
    introShown = true;
    appendMessage('system', 'Hi, I am ' + name + ', your HSE assistant. This version shows the assistant window, voice typing and exactly what I can see on your screen. Answers arrive in a later update.', null);
  }

  /* ---- what JARVIS sees ------------------------------------------------ */
  function setContextShown(show) {
    panel.hidden = !show;
    btnContext.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      bodyEl.scrollTop = 0;
    }
  }

  function renderContext() {
    const rows = buildPreview(snapshot);
    const aiNote = aiEnabled()
      ? 'Online AI is on in your settings: only the items above could be sent with your message.'
      : 'Online AI is off: nothing leaves this device.';
    renderHtml(panel, html`
      <p class="alert__title">What ${name} can see</p>
      <ul class="list">${rows.map((row) => html`<li class="list__item">
        <div class="list__main">
          <p class="list__title">${row.label}</p>
          <p class="list__meta">${row.value}</p>
        </div>
      </li>`)}</ul>
      <p class="text-sm">${aiNote}</p>
      ${voiceAvailable ? html`<p class="text-sm text-muted">${VOICE_PRIVACY_NOTE}</p>` : ''}
    `);
  }

  function updateSelectionChip() {
    const available = levelAtLeast(getContextLevel(), 'selection') && hasSelection();
    btnSelection.hidden = !available;
    btnSelection.setAttribute('aria-pressed', useSelection && available ? 'true' : 'false');
  }

  function refreshContext() {
    snapshot = captureContext({ includeSelection: useSelection });
    aiSnapshot = captureContext({ includeSelection: useSelection, forAi: true });
    updateSelectionChip();
    renderContext();
  }

  /* ---- opening and closing --------------------------------------------- */
  function focusable() {
    return Array.from(drawer.querySelectorAll('button, textarea, [href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.disabled && !element.hidden && element.offsetParent !== null);
  }

  function onSelectionUi() {
    updateSelectionChip();
  }

  function openDrawer() {
    if (open) {
      return;
    }
    open = true;
    returnFocus = document.activeElement;
    refreshContext();
    if (!introShown) {
      showIntro();
    }

    const modal = isNarrow();
    drawer.setAttribute('aria-modal', modal ? 'true' : 'false');
    drawer.setAttribute('data-open', 'true');
    scrim.setAttribute('data-open', 'true');
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    if (modal) {
      document.body.classList.add('is-scroll-locked');
    }
    document.addEventListener('selectionchange', onSelectionUi);

    // On phones, focusing the message box would pop up the keyboard before the person has read anything.
    requestAnimationFrame(() => {
      if (open) {
        (modal ? drawer : textarea).focus();
      }
    });
  }

  function closeDrawer() {
    if (!open) {
      return;
    }
    open = false;
    stopAll();
    session = null;
    updateMicState('idle');
    drawer.setAttribute('data-open', 'false');
    scrim.setAttribute('data-open', 'false');
    document.body.classList.remove('is-scroll-locked');
    document.removeEventListener('selectionchange', onSelectionUi);
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');

    const target = returnFocus && returnFocus !== fab && document.contains(returnFocus) && !drawer.contains(returnFocus)
      ? returnFocus
      : fab;
    returnFocus = null;
    target.focus();
  }

  function onDocumentKeydown(event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
    }
  }

  function onDrawerKeydown(event) {
    if (event.key !== 'Tab' || !isNarrow()) {
      return;
    }
    const items = focusable();
    if (items.length === 0) {
      event.preventDefault();
      drawer.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === drawer)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---- voice typing ---------------------------------------------------- */
  function updateMicState(state) {
    const active = state === 'starting' || state === 'listening' || state === 'processing';
    micGlyph.textContent = active ? '⏹' : '🎤';
    btnMic.setAttribute('aria-pressed', active ? 'true' : 'false');
    btnMic.setAttribute('aria-label', active ? 'Stop voice typing' : 'Speak your message');
    if (state === 'starting') {
      setStatus('Starting the microphone…');
    } else if (state === 'listening') {
      setStatus('Listening… tap the button to stop.');
    } else if (state === 'processing') {
      setStatus('Finishing…');
    }
    updateButtons();
  }

  async function toggleMic() {
    if (session !== null) {
      session.stop();
      return;
    }
    const base = textarea.value;
    const current = startListening({
      language: currentLanguage(),
      onText: (text) => {
        textarea.value = joinText(base, text);
        autoGrow();
      },
      onState: updateMicState
    });
    session = current;
    updateButtons();

    const outcome = await current.done;
    if (session === current) {
      session = null;
    }
    updateMicState('idle');
    if (outcome.reason === 'aborted') {
      setStatus('');
      return;
    }
    if (outcome.transcript !== '') {
      textarea.value = joinText(base, outcome.transcript);
      autoGrow();
      setStatus('Voice text added. Please check it before you send.');
    } else {
      setStatus('');
    }
    if (outcome.error) {
      const hint = getVoiceSupport().inFrame && (outcome.error.code === 'denied' || outcome.error.code === 'unsupported')
        ? ' If NASUR is shown inside huggingface.co, open its direct .hf.space address.'
        : '';
      setStatus(outcome.error.message + hint);
    }
  }

  /* ---- sending ----------------------------------------------------------- */
  async function send() {
    if (busy || session !== null) {
      return;
    }
    const text = cleanText(textarea.value, { multiline: true });
    if (text === '') {
      setStatus('Type or say something first.');
      textarea.focus();
      return;
    }

    refreshContext(); // the person sees and sends the same context
    const context = snapshot;
    const aiContext = aiSnapshot;
    appendMessage('user', text, null);
    textarea.value = '';
    autoGrow();
    setStatus('');
    useSelection = false;
    refreshContext();

    busy = true;
    updateButtons();
    const waiting = appendMessage('assistant', 'Thinking…', null);
    const controllerForSend = new AbortController();
    inflight = controllerForSend;

    let reply;
    try {
      reply = normalizeReply(await responder({ text, context, aiContext, signal: controllerForSend.signal }));
    } catch (error) {
      if (!controllerForSend.signal.aborted) {
        console.error('NASUR JARVIS: the responder failed.', error);
      }
      reply = { role: 'system', text: GENERIC_ERROR, source: null };
    } finally {
      busy = false;
      if (inflight === controllerForSend) {
        inflight = null;
      }
      updateButtons();
    }

    if (controllerForSend.signal.aborted) {
      waiting.remove();
      return;
    }
    waiting.replaceWith(createMessage(reply.role, reply.text, reply.source));
    scrollToEnd();
  }

  function clearMessages() {
    if (inflight !== null) {
      inflight.abort();
      inflight = null;
    }
    busy = false;
    updateButtons();
    log.replaceChildren();
    setStatus('');
    showIntro();
  }

  /* ---- events ------------------------------------------------------------ */
  fab.addEventListener('click', openDrawer);
  scrim.addEventListener('click', closeDrawer);
  btnClose.addEventListener('click', closeDrawer);
  btnClear.addEventListener('click', clearMessages);
  btnContext.addEventListener('click', () => setContextShown(panel.hidden));
  btnSelection.addEventListener('click', () => {
    useSelection = !useSelection;
    refreshContext();
    if (useSelection) {
      setContextShown(true);
    }
  });
  btnMic.addEventListener('click', () => {
    void toggleMic();
  });
  btnSend.addEventListener('click', () => {
    void send();
  });
  textarea.addEventListener('input', autoGrow);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  });
  drawer.addEventListener('keydown', onDrawerKeydown);
  document.addEventListener('keydown', onDocumentKeydown);

  stops.push(startContextTracking()); // first, so the page is noted before this file reacts to it
  stops.push(on(EVENTS.ROUTE_CHANGED, () => {
    if (!open) {
      return;
    }
    if (isNarrow()) {
      closeDrawer();
    } else {
      refreshContext();
    }
  }));
  stops.push(on(EVENTS.CONFIG_CHANGED, () => {
    if (open) {
      refreshContext();
    }
  }));

  btnMic.hidden = !voiceAvailable;
  updateButtons();

  /* ---- controller -------------------------------------------------------- */
  function destroy() {
    stopAll();
    if (inflight !== null) {
      inflight.abort();
      inflight = null;
    }
    for (const stop of stops) {
      stop();
    }
    document.removeEventListener('keydown', onDocumentKeydown);
    document.removeEventListener('selectionchange', onSelectionUi);
    document.body.classList.remove('is-scroll-locked');
    root.replaceChildren();
    controller = null;
  }

  controller = Object.freeze({
    open: openDrawer,
    close: closeDrawer,
    toggle: () => (open ? closeDrawer() : openDrawer()),
    isOpen: () => open,
    setResponder(fn) {
      if (fn !== null && typeof fn !== 'function') {
        throw new TypeError('NASUR JARVIS: the responder must be a function or null.');
      }
      responder = fn === null ? defaultResponder : fn;
    },
    addMessage(message) {
      if (message === null || typeof message !== 'object' || !ROLES.includes(message.role)) {
        throw new TypeError('NASUR JARVIS: a message needs a role of "user", "assistant" or "system".');
      }
      const text = cleanText(message.text, { multiline: true });
      if (text === '') {
        return;
      }
      const source = truncateText(cleanText(message.source), MAX_SOURCE_CHARS);
      appendMessage(message.role, text, source === '' ? null : source);
    },
    clearMessages,
    refreshContext,
    getSnapshot: () => snapshot,
    destroy
  });
  return controller;
}