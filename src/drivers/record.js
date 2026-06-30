'use strict';

const { getCurrentTracer, getCurrentContext, runWithContext } = require('../core/context');
const { buildDbNodeLanguage } = require('./db-language');

const MAX_QUERY_LEN = 500;
const MAX_PARAMS = 12;

/**
 * @param {unknown} value
 */
function safeParams(value) {
  if (value == null) return undefined;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_PARAMS).map((item) => safeParamValue(item));
  }

  if (typeof value === 'object') {
    const out = {};
    const entries = Object.entries(value).slice(0, MAX_PARAMS);
    for (const [key, item] of entries) {
      out[key] = safeParamValue(item);
    }
    return out;
  }

  return safeParamValue(value);
}

/**
 * @param {unknown} value
 */
function safeParamValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return '[unserializable]';
  }
}

/**
 * @param {string} query
 */
function truncateQuery(query) {
  const text = String(query || '').replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_QUERY_LEN) return text;
  return `${text.slice(0, MAX_QUERY_LEN)}…`;
}

/**
 * @param {unknown} result
 */
function countRows(result) {
  if (result == null) return undefined;
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'object') {
    if ('rowCount' in result && result.rowCount != null) return Number(result.rowCount);
    if ('count' in result && result.count != null) return Number(result.count);
    if ('length' in result && typeof result.length === 'number') return result.length;
    if ('affectedRows' in result) return Number(result.affectedRows);
  }
  return undefined;
}

/**
 * @param {object} payload
 * @param {string} payload.driver
 * @param {string} [payload.operation]
 * @param {string} [payload.query]
 * @param {unknown} [payload.params]
 * @param {number} [payload.rows]
 * @param {number} payload.duration_ms
 * @param {string} [payload.collection]
 * @param {string} [payload.error]
 */
function recordDbQuery(payload) {
  const tracer = getCurrentTracer();
  const ctx = getCurrentContext();

  if (!tracer) return;

  const record = () => {
    const parentId = ctx?.scopeNodeId || tracer.getLastSequentialNodeId();
    const operation = payload.operation || 'query';
    const language = buildDbNodeLanguage({
      driver: payload.driver,
      operation,
      query: payload.query,
      collection: payload.collection,
      rows: payload.rows,
      duration_ms: payload.duration_ms,
      error: payload.error,
    });

    tracer.addForkNode(parentId, {
      type: 'db',
      label: language.label,
      summary: language.summary,
      db_action: language.db_action,
      db_intent: language.db_intent,
      db_result: language.db_result,
      query: payload.query ? truncateQuery(payload.query) : undefined,
      params: safeParams(payload.params),
      rows: payload.rows,
      duration_ms: payload.duration_ms,
      driver: payload.driver,
      operation,
      collection: payload.collection,
      exit_reason: payload.error,
    });
  };

  if (ctx) {
    runWithContext(ctx, record);
  } else {
    record();
  }
}

/**
 * @param {() => Promise<unknown> | unknown} fn
 * @param {object} meta
 */
async function traceDbCall(fn, meta) {
  const start = performance.now();

  try {
    const result = await fn();
    const rows =
      meta.rows != null
        ? meta.rows
        : typeof meta.rowsFromResult === 'function'
          ? meta.rowsFromResult(result)
          : countRows(result);
    recordDbQuery({
      ...meta,
      rows,
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
    });
    return result;
  } catch (err) {
    recordDbQuery({
      ...meta,
      duration_ms: Math.round((performance.now() - start) * 10) / 10,
      error: err && err.message ? err.message : String(err),
    });
    throw err;
  }
}

module.exports = {
  recordDbQuery,
  traceDbCall,
  truncateQuery,
  safeParams,
  countRows,
};
