'use strict';

const { getCurrentTracer } = require('../core/context');
const {
  decisionTitle,
  buildIfOutcomes,
  decisionSummary,
  applyElseTaken,
} = require('./natural-language');

/**
 * @param {string} label
 */
function parseProbeLabel(label) {
  // Labels are formatted as `kind|file|line` (pipe-delimited to be safe on Windows).
  // Legacy labels used `:` — fall back gracefully.
  const separator = label.includes('|') ? '|' : ':';
  const parts = String(label).split(separator);
  const kind = parts[0] || 'branch';
  const file = parts[1] || '';
  const line = Number(parts[2]) || null;

  return { kind, file, line };
}

/**
 * Runtime probe injected into transformed application modules.
 *
 * @param {string} label
 * @param {unknown} value
 * @param {string} [conditionText]
 * @param {boolean} [hasElse]
 * @returns {unknown}
 */
function __rg_probe(label, value, conditionText, hasElse = false) {
  const tracer = getCurrentTracer();

  if (!tracer) {
    return value;
  }

  const meta = parseProbeLabel(label);
  const isLoop = meta.kind === 'while' || meta.kind === 'for';
  const nodeType = isLoop ? 'loop' : 'branch';
  const title = decisionTitle(meta.kind, conditionText || null);
  const summary = decisionSummary(meta.kind, value, hasElse);

  if (isLoop) {
    // Collapse all iterations into a single node updated in place.
    const existingLoop = tracer.nodes.find(
      (n) =>
        n.type === 'loop' &&
        n.source?.file === meta.file &&
        n.source?.line === meta.line
    );

    if (existingLoop) {
      existingLoop.iterations = (existingLoop.iterations || 1) + 1;
      existingLoop.summary = `Looped ${existingLoop.iterations} times`;
      // Throttle onChange: notify at most every 10 iterations.
      if (existingLoop.iterations % 10 === 0) {
        tracer._notifyChange();
      }
      return value;
    }

    tracer.addNode({
      type: nodeType,
      label: title,
      summary: 'Looped 1 time',
      iterations: 1,
      condition: conditionText || undefined,
      duration_ms: null,
      source: meta.file ? { file: meta.file, line: meta.line, kind: meta.kind } : undefined,
    });

    return value;
  }

  const node = {
    type: nodeType,
    label: title,
    summary,
    value,
    condition: conditionText || undefined,
    has_else: hasElse || undefined,
    duration_ms: null,
    source: meta.file
      ? {
          file: meta.file,
          line: meta.line,
          kind: meta.kind,
        }
      : undefined,
  };

  if (meta.kind === 'if' || meta.kind === 'ternary') {
    node.outcomes = buildIfOutcomes(value, hasElse);
    node.taken_outcome = Boolean(value) ? 'then' : (meta.kind === 'ternary' ? 'else' : null);
  }

  const addedNode = tracer.addNode(node);

  if (meta.kind === 'if' && meta.file) {
    if (!tracer._ifNodeMap) tracer._ifNodeMap = new Map();
    tracer._ifNodeMap.set(`${meta.file}|${meta.line}`, addedNode);
  }

  return value;
}

/**
 * @param {string} label
 */
function __rg_else_probe(label) {
  const tracer = getCurrentTracer();

  if (!tracer) {
    return;
  }

  const meta = parseProbeLabel(label.replace(/^else/, 'if'));

  // Use tracer's keyed if-node map for O(1) lookup instead of O(n) reverse scan.
  const ifKey = `${meta.file}|${meta.line}`;
  if (!tracer._ifNodeMap) tracer._ifNodeMap = new Map();

  const lastIf = tracer._ifNodeMap.get(ifKey);

  if (lastIf) {
    Object.assign(lastIf, applyElseTaken(lastIf));
    if (typeof tracer._notifyChange === 'function') {
      tracer._notifyChange();
    }
    return;
  }

  tracer.addNode({
    type: 'branch',
    label: decisionTitle('if', null),
    summary: 'Ran the else branch',
    value: false,
    has_else: true,
    outcomes: [
      { key: 'then', label: 'Then block — skipped', taken: false },
      { key: 'else', label: 'Else block — ran', taken: true },
    ],
    taken_outcome: 'else',
    duration_ms: null,
    source: meta.file
      ? {
          file: meta.file,
          line: meta.line,
          kind: 'else',
        }
      : undefined,
  });
}

/**
 * @param {string} label
 * @param {unknown} error
 */
function __rg_catch_probe(label, error) {
  const tracer = getCurrentTracer();

  if (!tracer) {
    return error;
  }

  const meta = parseProbeLabel(label);
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);

  tracer.addNode({
    type: 'error',
    label: 'An error was caught',
    summary: message ? `Caught: ${message}` : 'Entered catch block',
    value: message,
    duration_ms: null,
    source: meta.file
      ? {
          file: meta.file,
          line: meta.line,
          kind: 'catch',
        }
      : undefined,
  });

  return error;
}

module.exports = {
  __rg_probe,
  __rg_else_probe,
  __rg_catch_probe,
  parseProbeLabel,
};
