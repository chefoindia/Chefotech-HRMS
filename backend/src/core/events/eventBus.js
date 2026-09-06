"use strict";

const { logger } = require("../../config/logger");

/**
 * In-process event bus.
 *
 * Every notification the product raises passes through here as a named event
 * ("leave.approved", "payroll.completed") with its payload, so a module that
 * wants to react — outbound webhooks, an integration, a metric — subscribes
 * once rather than being wired into fifteen call sites.
 *
 * Deliberately small: handlers are awaited so a subscriber can finish its
 * work inside the tenant context the event was raised in, but a failing
 * handler is logged and never allowed to fail the operation that raised the
 * event. A webhook endpoint being down is not a reason a leave request
 * cannot be approved.
 */

const handlers = new Map(); // event -> Set<fn>

function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return () => handlers.get(event).delete(handler);
}

async function emit(event, payload = {}) {
  const targets = [...(handlers.get(event) || []), ...(handlers.get("*") || [])];
  if (!targets.length) return 0;

  let delivered = 0;
  for (const handler of targets) {
    try {
      await handler({ event, at: new Date(), ...payload });
      delivered += 1;
    } catch (err) {
      logger.error({ err, event }, "Event handler failed");
    }
  }
  return delivered;
}

function listenerCount(event) {
  return (handlers.get(event) || new Set()).size + (handlers.get("*") || new Set()).size;
}

/** Test affordance. */
function reset() {
  handlers.clear();
}

module.exports = { on, emit, listenerCount, reset };
