'use strict';

const { logger } = require('../lib/logger');

/**
 * In-memory store for active and completed trace graphs.
 * @param {number} maxTraces
 */
function createTraceStore(maxTraces = 100) {
  /** @type {Map<string, import('../core/tracer').TraceGraph>} */
  const active = new Map();

  /** @type {import('../core/tracer').TraceGraph[]} */
  const completed = [];

  /** @type {Set<import('ws').WebSocket>} */
  const subscribers = new Set();

  /**
   * @param {string} type
   * @param {import('../core/tracer').TraceGraph} trace
   */
  function broadcast(type, trace) {
    const message = JSON.stringify({ type, payload: trace });

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
      const activeTraces = Array.from(active.values()).sort((a, b) => b.timestamp - a.timestamp);
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
