'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * @typedef {Object} TraceContext
 * @property {string} id
 * @property {number} startTime
 * @property {import('./tracer').TraceTracer} tracer
 * @property {string} [scopeNodeId]
 */

/**
 * Run a function within an isolated trace context.
 * @param {TraceContext} context
 * @param {() => void} fn
 */
function runWithContext(context, fn) {
  return storage.run(context, fn);
}

/**
 * @returns {TraceContext | undefined}
 */
function getCurrentContext() {
  return storage.getStore();
}

/**
 * @returns {import('./tracer').TraceTracer | null}
 */
function getCurrentTracer() {
  const ctx = getCurrentContext();
  return ctx ? ctx.tracer : null;
}

module.exports = {
  storage,
  runWithContext,
  getCurrentContext,
  getCurrentTracer,
};
