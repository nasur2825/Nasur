/**
 * NASUR – Event Bus
 * File: js/core/eventbus.js
 *
 * A tiny publish/subscribe helper that lets modules talk to each other
 * without importing one another (for example: saving a finding emits an
 * event, and the Action service creates the linked action).
 *
 * Event names must come from EVENTS in js/core/config.js, never retyped.
 *
 * Behaviour:
 *   - emit() is synchronous: handlers run in the order they were added.
 *   - A handler that throws, or returns a promise that rejects, is reported
 *     with console.error and never stops the other handlers.
 *   - on() and once() return an "unsubscribe" function.
 *   - Subscribing to '*' receives every event.
 *   - Every handler is called as handler(payload, eventName).
 *
 * This file has no imports and touches no browser APIs other than console.
 */

/** Special event name that receives every emitted event. */
export const WILDCARD = '*';


/* ==========================================================================
   1. HELPERS
   ========================================================================== */

function assertEventName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('NASUR event bus: the event name must be a non-empty string.');
  }
}

function assertHandler(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('NASUR event bus: the handler must be a function.');
  }
}

function reportHandlerError(eventName, error) {
  console.error('NASUR event bus: a handler for "' + eventName + '" failed.', error);
}


/* ==========================================================================
   2. FACTORY
   Each call returns an independent bus. The app uses the shared `bus`
   exported below; tests create their own so they never affect each other.
   ========================================================================== */

export function createEventBus() {
  /** Map of event name -> array of { handler, once } entries. */
  const listeners = new Map();

  function addListener(name, handler, once) {
    assertEventName(name);
    assertHandler(handler);

    const entry = { handler, once };
    const list = listeners.get(name);
    if (list) {
      list.push(entry);
    } else {
      listeners.set(name, [entry]);
    }

    return function unsubscribe() {
      removeEntry(name, entry);
    };
  }

  function removeEntry(name, entry) {
    const list = listeners.get(name);
    if (!list) {
      return;
    }
    const position = list.indexOf(entry);
    if (position !== -1) {
      list.splice(position, 1);
    }
    if (list.length === 0) {
      listeners.delete(name);
    }
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  function on(name, handler) {
    return addListener(name, handler, false);
  }

  /** Subscribe for exactly one delivery. Returns an unsubscribe function. */
  function once(name, handler) {
    return addListener(name, handler, true);
  }

  /** Remove every subscription of `handler` for `name`. */
  function off(name, handler) {
    assertEventName(name);
    assertHandler(handler);
    const list = listeners.get(name);
    if (!list) {
      return;
    }
    const remaining = list.filter((entry) => entry.handler !== handler);
    if (remaining.length === 0) {
      listeners.delete(name);
    } else {
      listeners.set(name, remaining);
    }
  }

  /**
   * Emit an event to its subscribers and then to '*' subscribers.
   * Returns how many handlers were called.
   */
  function emit(name, payload) {
    assertEventName(name);
    if (name === WILDCARD) {
      throw new TypeError('NASUR event bus: "*" can only be subscribed to, not emitted.');
    }

    const direct = listeners.get(name) || [];
    const wildcard = listeners.get(WILDCARD) || [];

    // Work on copies so handlers may subscribe or unsubscribe while running.
    const deliveries = [];
    for (const entry of direct) {
      deliveries.push({ entry, key: name });
    }
    for (const entry of wildcard) {
      deliveries.push({ entry, key: WILDCARD });
    }

    let called = 0;
    for (const delivery of deliveries) {
      const { entry, key } = delivery;

      if (entry.once) {
        const current = listeners.get(key);
        if (!current || !current.includes(entry)) {
          continue; // already removed, or already delivered once
        }
        removeEntry(key, entry);
      }

      called += 1;
      try {
        const result = entry.handler(payload, name);
        if (result && typeof result.then === 'function') {
          result.then(undefined, (error) => reportHandlerError(name, error));
        }
      } catch (error) {
        reportHandlerError(name, error);
      }
    }
    return called;
  }

  /** Number of handlers subscribed to exactly this name. */
  function listenerCount(name) {
    assertEventName(name);
    const list = listeners.get(name);
    return list ? list.length : 0;
  }

  /** Remove all handlers for one event, or for every event when no name is given. */
  function clear(name) {
    if (name === undefined) {
      listeners.clear();
      return;
    }
    assertEventName(name);
    listeners.delete(name);
  }

  return { on, once, off, emit, listenerCount, clear };
}


/* ==========================================================================
   3. SHARED APP BUS
   ========================================================================== */

/** The one bus used by the whole app. */
export const bus = createEventBus();

export const on = bus.on;
export const once = bus.once;
export const off = bus.off;
export const emit = bus.emit;
export const listenerCount = bus.listenerCount;
export const clear = bus.clear;