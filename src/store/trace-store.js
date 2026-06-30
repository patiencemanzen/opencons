'use strict';

const { logger } = require('../lib/logger');

const ACTIVE_TRACE_TTL_MS = 60_000;

/**
 * In-memory store for active and completed trace graphs.
 * @param {number} maxTraces
 */
function createTraceStore(maxTraces = 100) {
  /** @type {Map<string, import('../core/tracer').TraceGraph>} */
  const active = new Map();

  /** @type {Map<string, number>} */
  const activeStartTimes = new Map();

  /** @type {import('../core/tracer').TraceGraph[]} */
  const completed = [];

  /** @type {Set<import('ws').WebSocket>} */
  const subscribers = new Set();

  /**
   * @param {string} type
   * @param {import('../core/tracer').TraceGraph} trace
   */
  function broadcast(type, trace) {
    let message;

    try {
      message = JSON.stringify({ type, payload: trace });
    } catch (err) {
      logger.debug('Failed to serialize trace for broadcast (circular reference?)', err);
      return;
    }

    for (const client of subscribers) {
      if (client.readyState !== 1) continue;

      try {
        client.send(message);
      } catch (err) {
        logger.debug('WebSocket send failed; removing subscriber', err);
        subscribers.delete(client);
      }
    }
  }

  return {
    /**
     * Broadcast a newly discovered in-flight request.
     * @param {import('../core/tracer').TraceGraph} trace
     */
    start(trace) {
      active.set(trace.id, trace);
      activeStartTimes.set(trace.id, Date.now());
      broadcast('trace_start', trace);
    },

    /**
     * Stream live progress for an active request.
     * @param {import('../core/tracer').TraceGraph} trace
     */
    update(trace) {
      if (!active.has(trace.id)) return;
      active.set(trace.id, trace);
      broadcast('trace_update', trace);
    },

    /**
     * Finalise and archive a completed request trace.
     * @param {import('../core/tracer').TraceGraph} trace
     */
    complete(trace) {
      active.delete(trace.id);
      activeStartTimes.delete(trace.id);
      completed.unshift(trace);

      if (completed.length > maxTraces) {
        completed.length = maxTraces;
      }

      broadcast('trace', trace);
    },

    /**
     * @deprecated Use complete() — kept for internal compatibility.
     * @param {import('../core/tracer').TraceGraph} trace
     */
    add(trace) {
      this.complete(trace);
    },

    /**
     * @param {number} [limit]
     */
    getAll(limit = 100) {
      const now = Date.now();
      for (const [id, startTime] of activeStartTimes) {
        if (now - startTime > ACTIVE_TRACE_TTL_MS) {
          active.delete(id);
          activeStartTimes.delete(id);
        }
      }
      const activeTraces = Array.from(active.values());
      const merged = [...activeTraces, ...completed];
      return merged.slice(0, limit);
    },

    /**
     * @param {string} id
     * @returns {import('../core/tracer').TraceGraph | undefined}
     */
    getById(id) {
      if (active.has(id)) return active.get(id);
      return completed.find((trace) => trace.id === id);
    },

    /**
     * @param {import('ws').WebSocket} client
     */
    subscribe(client) {
      subscribers.add(client);
    },

    /**
     * @param {import('ws').WebSocket} client
     */
    unsubscribe(client) {
      subscribers.delete(client);
    },
  };
}

module.exports = {
  createTraceStore,
};
