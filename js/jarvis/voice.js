/**
 * NASUR – JARVIS Voice (speech to text and text to speech)
 * File: js/jarvis/voice.js
 *
 * Wraps the browser's built-in speech features. It has no screens of its own;
 * the JARVIS drawer (File 6) and later modules (Daily Work voice notes,
 * Toolbox Talk) use it.
 *
 * VOICE INPUT (speech recognition)
 *   const session = startListening({ language: 'ta', onText: (text) => {...} });
 *   const outcome = await session.done;
 *   outcome = { transcript, confidence, reason, error }
 *   reason: "ended" (the person stopped talking), "stopped" (session.stop()),
 *           "aborted" (session.abort(), nothing is kept), "timeout" (time
 *           limit reached) or "error". `error` is a VoiceError or null.
 *   `done` NEVER rejects. Only one session runs at a time: starting another
 *   cancels the first. Call startListening from a tap, because the browser
 *   shows the microphone permission question at that moment.
 *   The transcript is only a draft for the person to review. It is never
 *   saved or sent by this file.
 *
 * VOICE OUTPUT (speech synthesis)
 *   const result = await speak('Wear your helmet.', { language: 'en' });
 *   result = { spoken, reason }: "done", "cancelled", "empty", "unsupported",
 *   "no_voice" (the phone has no voice for that language) or "error".
 *   Long text is read in short pieces because many phones stop on long text.
 *
 * LIMITS (also shown to the user, see VOICE_PRIVACY_NOTE)
 *   - Most browsers turn speech into text on an online service, so voice
 *     input usually needs a connection. Typing always works.
 *   - Inside the framed huggingface.co page the microphone is often blocked.
 *     Use the direct *.hf.space address.
 *   - Tamil, Hindi and Arabic quality and voices differ between phones.
 *   - NASUR does not record or store audio.
 *
 * Languages are NASUR's own codes ("en", "ta", "hi", "ar"); the speech
 * locale (for example "ta-IN") comes from js/services/config.js.
 * Imports: js/services/config.js (language info), js/services/sanitize.js.
 */

import { getLanguageInfo } from '../services/config.js';
import { cleanText } from '../services/sanitize.js';


/* ==========================================================================
   1. CONSTANTS, MESSAGES AND ERROR TYPE
   ========================================================================== */

export const VOICE_PRIVACY_NOTE = 'Voice typing sends what you say to your browser\'s online speech service to turn it into text. NASUR does not record or store audio. Spoken replies use the voices installed on your phone.';

export const DEFAULT_MAX_LISTEN_SECONDS = 30;
export const MAX_LISTEN_SECONDS = 120;

const STOP_GRACE_MS = 4000;
const VOICE_LOAD_MS = 1500;
const CANCEL_PAUSE_MS = 60;
const SPEECH_CHUNK_CHARS = 180;

/** Texts that are safe to show to the user, by error code. */
export const VOICE_MESSAGES = Object.freeze({
  unsupported: 'Voice input is not available in this browser. You can type instead.',
  offline: 'Voice input usually needs an internet connection. Type your message, or try again when you are online.',
  denied: 'Microphone permission was not given. Allow the microphone for this site in your browser settings, then try again.',
  no_microphone: 'No microphone was found, or another app is using it.',
  no_speech: 'No speech was heard. Tap the microphone and try again.',
  network: 'The speech service could not be reached. Check your connection and try again.',
  language: 'Voice input is not available for this language on this device. You can type instead.',
  unknown: 'Voice input stopped unexpectedly. You can type instead.'
});

/** Thrown for, and carried in, voice problems. `code` is a key of VOICE_MESSAGES. */
export class VoiceError extends Error {
  constructor(code) {
    super(VOICE_MESSAGES[code] || VOICE_MESSAGES.unknown);
    this.name = 'VoiceError';
    this.code = Object.prototype.hasOwnProperty.call(VOICE_MESSAGES, code) ? code : 'unknown';
  }
}

const RECOGNITION_ERRORS = Object.freeze({
  'no-speech': 'no_speech',
  'audio-capture': 'no_microphone',
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  network: 'network',
  'language-not-supported': 'language'
});


/* ==========================================================================
   2. SMALL HELPERS
   ========================================================================== */

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clampNumber(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calls a callback and never lets a mistake in it stop the voice code. */
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') {
    return;
  }
  try {
    fn(...args);
  } catch (error) {
    console.error('NASUR voice: a callback failed.', error);
  }
}

function getRecognitionConstructor() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getSynthesis() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    return null;
  }
  return window.speechSynthesis;
}


/* ==========================================================================
   3. SUPPORT AND PERMISSION
   ========================================================================== */

/**
 * What this browser can do: { recognition, synthesis, secureContext, inFrame }.
 * `inFrame` is true when NASUR is shown inside another page (microphone and
 * location are often blocked there).
 */
export function getVoiceSupport() {
  let inFrame = false;
  try {
    inFrame = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    inFrame = true;
  }
  return {
    recognition: getRecognitionConstructor() !== null,
    synthesis: getSynthesis() !== null,
    secureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    inFrame
  };
}

/** True when voice input can be tried in this browser. */
export function isRecognitionSupported() {
  return getRecognitionConstructor() !== null;
}

/** True when spoken replies can be tried in this browser. */
export function isSynthesisSupported() {
  return getSynthesis() !== null;
}

/** The microphone permission: "granted", "denied", "prompt" or "unknown". Never asks the user. */
export async function getMicrophonePermission() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return 'unknown';
    }
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state === 'granted' || status.state === 'denied' || status.state === 'prompt' ? status.state : 'unknown';
  } catch {
    return 'unknown';
  }
}


/* ==========================================================================
   4. VOICE INPUT
   ========================================================================== */

let activeSession = null;

/** Reads every result of a recognition event into { finalText, interimText, confidence }. */
function readResults(results) {
  let finalText = '';
  let interimText = '';
  let confidenceTotal = 0;
  let confidenceCount = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const best = result[0];
    if (!best) {
      continue;
    }
    if (result.isFinal) {
      finalText += (finalText === '' ? '' : ' ') + best.transcript.trim();
      if (typeof best.confidence === 'number' && best.confidence > 0) {
        confidenceTotal += best.confidence;
        confidenceCount += 1;
      }
    } else {
      interimText += (interimText === '' ? '' : ' ') + best.transcript.trim();
    }
  }
  return {
    finalText,
    interimText,
    confidence: confidenceCount === 0 ? null : Math.round((confidenceTotal / confidenceCount) * 100) / 100
  };
}

/**
 * Starts voice input and returns the session at once.
 * options:
 *   language    "en" (default), "ta", "hi" or "ar"
 *   maxSeconds  time limit, 1 to 120 (default 30)
 *   continuous  keep listening through pauses (default false: stops at a pause)
 *   multiline   keep line breaks in the transcript (default false)
 *   onText(text)   called while the person speaks, with everything heard so far
 *   onState(state) "starting", "listening", "processing", "idle" or "error"
 * Returns { language, locale, state, stop(), abort(), done }.
 *   stop()   ends listening and keeps what was heard
 *   abort()  ends listening and keeps nothing
 */
export function startListening(options = {}) {
  const settings = isPlainObject(options) ? options : {};
  const info = getLanguageInfo(typeof settings.language === 'string' ? settings.language : 'en');
  const maxSeconds = clampNumber(settings.maxSeconds, 1, MAX_LISTEN_SECONDS, DEFAULT_LISTEN_SECONDS_SAFE());
  const multiline = settings.multiline === true;

  if (activeSession !== null) {
    activeSession.abort();
  }

  let state = 'starting';
  let finished = false;
  let stopRequested = false;
  let abortRequested = false;
  let timedOut = false;
  let error = null;
  let latest = { finalText: '', interimText: '', confidence: null };
  let recognition = null;
  let limitTimer = null;
  let graceTimer = null;
  let resolveDone = () => {};
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  function setState(next) {
    if (state === next) {
      return;
    }
    state = next;
    safeCall(settings.onState, next);
  }

  function finish(reason) {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(limitTimer);
    clearTimeout(graceTimer);
    if (activeSession === session) {
      activeSession = null;
    }
    if (recognition !== null) {
      recognition.onstart = null;
      recognition.onspeechend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    }

    const kept = abortRequested ? '' : (latest.finalText !== '' ? latest.finalText : latest.interimText);
    const outcome = {
      transcript: cleanText(kept, { multiline }),
      confidence: abortRequested ? null : latest.confidence,
      reason,
      error
    };
    setState(reason === 'error' ? 'error' : 'idle');
    resolveDone(outcome);
  }

  function stop() {
    if (finished || stopRequested) {
      return;
    }
    stopRequested = true;
    setState('processing');
    try {
      recognition.stop();
    } catch {
      finish('stopped');
      return;
    }
    graceTimer = setTimeout(() => finish(timedOut ? 'timeout' : 'stopped'), STOP_GRACE_MS);
  }

  function abort() {
    if (finished) {
      return;
    }
    abortRequested = true;
    if (recognition !== null) {
      try {
        recognition.abort();
      } catch {
        /* the recognizer had already ended */
      }
    }
    finish('aborted');
  }

  const session = {
    language: info.code,
    locale: info.speechLocale,
    get state() {
      return state;
    },
    stop,
    abort,
    done
  };
  activeSession = session;
  setState('starting');

  const Recognition = getRecognitionConstructor();
  if (Recognition === null) {
    error = new VoiceError('unsupported');
    Promise.resolve().then(() => finish('error'));
    return session;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    error = new VoiceError('offline');
    Promise.resolve().then(() => finish('error'));
    return session;
  }

  try {
    recognition = new Recognition();
    recognition.lang = info.speechLocale;
    recognition.continuous = settings.continuous === true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setState('listening');
    recognition.onspeechend = () => {
      if (!stopRequested) {
        setState('processing');
      }
    };
    recognition.onresult = (event) => {
      latest = readResults(event.results);
      const combined = latest.finalText + (latest.interimText === '' ? '' : (latest.finalText === '' ? '' : ' ') + latest.interimText);
      safeCall(settings.onText, cleanText(combined, { multiline }));
    };
    recognition.onerror = (event) => {
      const code = event && typeof event.error === 'string' ? event.error : '';
      if (code === 'aborted') {
        return;
      }
      if (error === null) {
        error = new VoiceError(RECOGNITION_ERRORS[code] || 'unknown');
      }
    };
    recognition.onend = () => {
      if (error !== null) {
        finish('error');
      } else if (timedOut) {
        finish('timeout');
      } else if (stopRequested) {
        finish('stopped');
      } else {
        finish('ended');
      }
    };

    limitTimer = setTimeout(() => {
      timedOut = true;
      stop();
    }, maxSeconds * 1000);

    recognition.start();
  } catch (problem) {
    console.warn('NASUR voice: voice input could not start.', problem);
    error = new VoiceError(problem && problem.name === 'NotAllowedError' ? 'denied' : 'unknown');
    Promise.resolve().then(() => finish('error'));
  }

  return session;
}

/** Default listening time. A function so the constant is read in one place. */
function DEFAULT_LISTEN_SECONDS_SAFE() {
  return DEFAULT_MAX_LISTEN_SECONDS;
}

/** True while a voice input session is running. */
export function isListening() {
  return activeSession !== null;
}

/** Cancels the running voice input session, if any (nothing is kept). */
export function stopListening() {
  if (activeSession !== null) {
    activeSession.abort();
  }
}


/* ==========================================================================
   5. VOICE OUTPUT
   ========================================================================== */

let speechToken = 0;
let currentSpeech = null;

function normalizeLang(lang) {
  return String(lang || '').replace('_', '-').toLowerCase();
}

/**
 * Finds the best voice for a speech locale such as "ta-IN" among `voices`
 * (a list of { lang, default, localService }). An exact locale match wins,
 * otherwise a voice of the same language. Returns null when there is none.
 */
export function pickVoice(voices, locale) {
  if (!Array.isArray(voices)) {
    return null;
  }
  const wanted = normalizeLang(locale);
  const primary = wanted.split('-')[0];
  const exact = voices.filter((voice) => normalizeLang(voice.lang) === wanted);
  const sameLanguage = voices.filter((voice) => normalizeLang(voice.lang).split('-')[0] === primary);
  const pool = exact.length > 0 ? exact : sameLanguage;
  if (pool.length === 0) {
    return null;
  }
  return pool.find((voice) => voice.default) || pool.find((voice) => voice.localService) || pool[0];
}

/** The voices installed on the device (waits briefly, because phones load them late). */
export function listVoices(timeoutMs = VOICE_LOAD_MS) {
  const synthesis = getSynthesis();
  if (synthesis === null) {
    return Promise.resolve([]);
  }
  const ready = synthesis.getVoices();
  if (ready.length > 0) {
    return Promise.resolve(ready);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      synthesis.removeEventListener('voiceschanged', settle);
      resolve(synthesis.getVoices());
    };
    timer = setTimeout(settle, timeoutMs);
    synthesis.addEventListener('voiceschanged', settle);
  });
}

/** True when the device has a voice for the language ("en", "ta", "hi" or "ar"). */
export async function hasVoiceFor(language) {
  const info = getLanguageInfo(typeof language === 'string' ? language : 'en');
  return pickVoice(await listVoices(), info.speechLocale) !== null;
}

function splitLongSentence(sentence, maxLength) {
  const parts = [];
  let current = '';
  for (const word of sentence.split(' ')) {
    if (word.length > maxLength) {
      if (current !== '') {
        parts.push(current);
        current = '';
      }
      const characters = Array.from(word);
      for (let start = 0; start < characters.length; start += maxLength) {
        parts.push(characters.slice(start, start + maxLength).join(''));
      }
    } else if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= maxLength) {
      current += ' ' + word;
    } else {
      parts.push(current);
      current = word;
    }
  }
  if (current !== '') {
    parts.push(current);
  }
  return parts;
}

/**
 * Cuts text into pieces of at most `maxLength` characters for speaking,
 * breaking at the end of sentences (. ! ? । ؟ …) and, for very long
 * sentences, at spaces. A full stop inside a number such as 3.5 is kept.
 */
export function splitForSpeech(text, maxLength = SPEECH_CHUNK_CHARS) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('NASUR voice: maxLength must be a whole number of 1 or more.');
  }
  const flat = cleanText(text);
  if (flat === '') {
    return [];
  }
  const sentences = flat.match(/.+?(?:[.!?।؟…]+(?=\s|$)|$)/g) || [flat];

  const pieces = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence === '') {
      continue;
    }
    if (sentence.length <= maxLength) {
      pieces.push(sentence);
    } else {
      pieces.push(...splitLongSentence(sentence, maxLength));
    }
  }

  const chunks = [];
  for (const piece of pieces) {
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + 1 + piece.length <= maxLength) {
      chunks[last] += ' ' + piece;
    } else {
      chunks.push(piece);
    }
  }
  return chunks;
}

/**
 * Reads text aloud and resolves { spoken, reason } when it has finished or
 * stopped. Never rejects. Starting a new speech cancels the one before.
 * options: { language: "en", rate: 1 (0.5 to 2), pitch: 1 (0.5 to 2),
 *            volume: 1 (0 to 1), force: false, onStart }
 * When the phone has no voice for a non-English language the text is NOT
 * read with a wrong-language voice: the result is reason "no_voice", so the
 * screen can say so (set force: true to try anyway).
 */
export async function speak(text, options = {}) {
  const settings = isPlainObject(options) ? options : {};
  const cleaned = cleanText(text, { multiline: true });
  if (cleaned === '') {
    return { spoken: false, reason: 'empty' };
  }
  const synthesis = getSynthesis();
  if (synthesis === null) {
    return { spoken: false, reason: 'unsupported' };
  }

  const info = getLanguageInfo(typeof settings.language === 'string' ? settings.language : 'en');
  const voice = pickVoice(await listVoices(), info.speechLocale);
  if (voice === null && info.code !== 'en' && settings.force !== true) {
    return { spoken: false, reason: 'no_voice' };
  }

  speechToken += 1;
  const token = speechToken;
  const hadSpeech = currentSpeech !== null || synthesis.speaking;
  stopSpeaking();
  if (hadSpeech) {
    await delay(CANCEL_PAUSE_MS); // some phones ignore a new speech that starts right after a cancel
  }
  if (token !== speechToken) {
    return { spoken: false, reason: 'cancelled' };
  }

  const rate = clampNumber(settings.rate, 0.5, 2, 1);
  const pitch = clampNumber(settings.pitch, 0.5, 2, 1);
  const volume = clampNumber(settings.volume, 0, 1, 1);
  const chunks = splitForSpeech(cleaned);

  return new Promise((resolve) => {
    let index = 0;
    let ended = false;
    let watchdog = null;

    const finishSpeech = (result) => {
      if (ended) {
        return;
      }
      ended = true;
      clearTimeout(watchdog);
      if (currentSpeech !== null && currentSpeech.token === token) {
        currentSpeech = null;
      }
      resolve(result);
    };

    currentSpeech = { token, finish: (reason) => finishSpeech({ spoken: false, reason }) };

    const speakNext = () => {
      if (ended) {
        return;
      }
      if (index >= chunks.length) {
        finishSpeech({ spoken: true, reason: 'done' });
        return;
      }
      const chunk = chunks[index];
      const first = index === 0;
      index += 1;

      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = info.speechLocale;
      if (voice !== null) {
        utterance.voice = voice;
      }
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;

      utterance.onstart = () => {
        if (first) {
          safeCall(settings.onStart);
        }
      };
      utterance.onend = speakNext;
      utterance.onerror = (event) => {
        const code = event && event.error;
        finishSpeech(code === 'canceled' || code === 'interrupted'
          ? { spoken: false, reason: 'cancelled' }
          : { spoken: false, reason: 'error' });
      };

      // Some phones never report the end of a piece, so do not wait forever.
      clearTimeout(watchdog);
      watchdog = setTimeout(() => finishSpeech({ spoken: false, reason: 'error' }), Math.round((chunk.length * 130 + 6000) / rate));

      try {
        synthesis.speak(utterance);
      } catch (error) {
        console.warn('NASUR voice: speaking failed.', error);
        finishSpeech({ spoken: false, reason: 'error' });
      }
    };

    speakNext();
  });
}

/** Stops any spoken reply at once. */
export function stopSpeaking() {
  const pending = currentSpeech;
  currentSpeech = null;
  if (pending !== null) {
    pending.finish('cancelled');
  }
  const synthesis = getSynthesis();
  if (synthesis !== null && (synthesis.speaking || synthesis.pending)) {
    try {
      synthesis.cancel();
    } catch {
      /* nothing was speaking */
    }
  }
}

/** True while a reply is being read aloud. */
export function isSpeaking() {
  const synthesis = getSynthesis();
  return currentSpeech !== null || (synthesis !== null && synthesis.speaking === true);
}

/** Stops voice input and spoken replies (for example when the JARVIS panel closes). */
export function stopAll() {
  stopListening();
  stopSpeaking();
}