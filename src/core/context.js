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

/**
 * Attach the trace context to a request object so it can be recovered
 * in callback-style async paths where AsyncLocalStorage is unavailable.
 * @param {object} req
 * @param {TraceContext} context
 */
function attachContextToReq(req, context) {
  req.__openconsContext = context;
}

/**
 * Recover a trace context from a request object (fallback when ALS is empty).
 * @param {object} [req]
 * @returns {TraceContext | undefined}
 */
function getContextFromReq(req) {
  return req?.__openconsContext;
}

module.exports = {
  storage,
  runWithContext,
  getCurrentContext,
  getCurrentTracer,
  attachContextToReq,
  getContextFromReq,
};
