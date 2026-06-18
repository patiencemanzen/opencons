(function (root) {
'use strict';

const EXPORT_VERSION = '1';
const OPENCONS_VERSION = '0.1.0';

/**
 * Build a structured export payload for a single request trace.
 * Optimized for performance analysis (latency breakdown, DB patterns, bottlenecks).
 *
 * @param {object} trace
 * @returns {object}
 */
function buildTraceExport(trace) {
  const totalDuration = trace.duration_ms || 0;
  const timedNodes = trace.nodes.filter((n) => n.duration_ms != null && n.duration_ms > 0);

  let offset = 0;
  const timeline = timedNodes.map((node, order) => {
    const startOffset = offset;
    const endOffset = offset + node.duration_ms;
    offset = endOffset;

    const percent = totalDuration > 0 ? round((node.duration_ms / totalDuration) * 100) : 0;

    return {
      order,
      id: node.id,
      type: node.type,
      label: node.label,
      summary: node.summary || null,
      duration_ms: node.duration_ms,
      start_offset_ms: round(startOffset),
      end_offset_ms: round(endOffset),
      percent_of_total: percent,
      ...(node.type === 'middleware' && {
        called_next: node.called_next,
        exit_reason: node.exit_reason || null,
      }),
      ...(node.type === 'db' && pickDbFields(node)),
      ...(node.source?.file && {
        source: { file: node.source.file, line: node.source.line ?? null },
      }),
    };
  });

  const breakdownByType = buildBreakdownByType(timedNodes, totalDuration);
  const dbQueries = extractDbQueries(trace);
  const parallelDbIds = findParallelDbNodeIds(trace.edges);
  const bottlenecks = findBottlenecks(timedNodes, totalDuration);
  const recommendations = buildRecommendations({
    trace,
    totalDuration,
    timedNodes,
    dbQueries,
    parallelDbIds,
    breakdownByType,
  });

  return {
    opencons_export_version: EXPORT_VERSION,
    opencons_version: OPENCONS_VERSION,
    export_type: 'opencons.trace',
    exported_at: new Date().toISOString(),
    request: {
      id: trace.id,
      method: trace.method,
      url: trace.url,
      params: trace.params || {},
      status: trace.status ?? null,
      state: trace.state || 'complete',
      duration_ms: totalDuration,
      timestamp: trace.timestamp,
      ...(trace.body !== undefined && { body: trace.body }),
      ...(trace.response !== undefined && { response: trace.response }),
    },
    summary: {
      total_duration_ms: totalDuration,
      timed_step_count: timedNodes.length,
      node_count: trace.nodes.length,
      edge_count: trace.edges.length,
      breakdown_by_type: breakdownByType,
      db: summarizeDb(dbQueries, parallelDbIds, totalDuration),
      bottlenecks,
    },
    timeline,
    db_queries: dbQueries.map((q) => ({
      ...q,
      parallel: parallelDbIds.has(q.id),
    })),
    graph: {
      nodes: trace.nodes,
      edges: trace.edges,
    },
    recommendations,
  };
}

/**
 * @param {object[]} timedNodes
 * @param {number} totalDuration
 */
function buildBreakdownByType(timedNodes, totalDuration) {
  /** @type {Record<string, { count: number, total_ms: number, percent: number }>} */
  const breakdown = {};

  for (const node of timedNodes) {
    if (!breakdown[node.type]) {
      breakdown[node.type] = { count: 0, total_ms: 0, percent: 0 };
    }
    breakdown[node.type].count += 1;
    breakdown[node.type].total_ms = round(breakdown[node.type].total_ms + node.duration_ms);
  }

  for (const entry of Object.values(breakdown)) {
    entry.total_ms = round(entry.total_ms);
    entry.percent = totalDuration > 0 ? round((entry.total_ms / totalDuration) * 100) : 0;
  }

  return breakdown;
}

/**
 * @param {object} trace
 */
function extractDbQueries(trace) {
  return trace.nodes
    .filter((n) => n.type === 'db')
    .map((node) => ({
      id: node.id,
      label: node.label,
      duration_ms: node.duration_ms ?? null,
      driver: node.driver || null,
      operation: node.operation || node.db_action || null,
      collection: node.collection || null,
      query: node.query || null,
      params: node.params ?? null,
      rows: node.rows ?? null,
      db_intent: node.db_intent || null,
      db_result: node.db_result || null,
    }));
}

/**
 * @param {object[]} edges
 * @returns {Set<string>}
 */
function findParallelDbNodeIds(edges) {
  const parallelTargets = new Set();
  for (const edge of edges) {
    if (edge.parallel) parallelTargets.add(edge.to);
  }
  return parallelTargets;
}

/**
 * @param {object[]} timedNodes
 * @param {number} totalDuration
 */
function findBottlenecks(timedNodes, totalDuration) {
  return [...timedNodes]
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 5)
    .map((node, rank) => ({
      rank: rank + 1,
      id: node.id,
      type: node.type,
      label: node.label,
      duration_ms: node.duration_ms,
      percent_of_total: totalDuration > 0 ? round((node.duration_ms / totalDuration) * 100) : 0,
    }));
}

/**
 * @param {object[]} dbQueries
 * @param {Set<string>} parallelDbIds
 * @param {number} totalDuration
 */
function summarizeDb(dbQueries, parallelDbIds, totalDuration) {
  const totalMs = round(dbQueries.reduce((sum, q) => sum + (q.duration_ms || 0), 0));
  const drivers = [...new Set(dbQueries.map((q) => q.driver).filter(Boolean))];
  const operations = {};

  for (const q of dbQueries) {
    const op = q.operation || 'unknown';
    operations[op] = (operations[op] || 0) + 1;
  }

  return {
    query_count: dbQueries.length,
    total_ms: totalMs,
    percent_of_total: totalDuration > 0 ? round((totalMs / totalDuration) * 100) : 0,
    parallel_count: dbQueries.filter((q) => parallelDbIds.has(q.id)).length,
    drivers,
    operations,
  };
}

/**
 * @param {object} ctx
 */
function buildRecommendations(ctx) {
  const { trace, totalDuration, timedNodes, dbQueries, parallelDbIds, breakdownByType } = ctx;
  /** @type {{ kind: string, severity: 'low' | 'medium' | 'high', message: string }[]} */
  const items = [];

  if (trace.state === 'active') {
    items.push({
      kind: 'incomplete_trace',
      severity: 'low',
      message: 'Request was still in progress when exported — timings may change.',
    });
  }

  const dbBreakdown = breakdownByType.db;
  if (dbBreakdown && dbBreakdown.percent >= 50) {
    items.push({
      kind: 'db_dominated',
      severity: dbBreakdown.percent >= 75 ? 'high' : 'medium',
      message: `Database time is ${dbBreakdown.percent}% of total request duration (${dbBreakdown.total_ms}ms). Focus on query optimization, indexing, or caching.`,
    });
  }

  if (dbQueries.length >= 4) {
    const sequentialCount = dbQueries.length - parallelDbIds.size;
    items.push({
      kind: 'many_db_queries',
      severity: dbQueries.length >= 8 ? 'high' : 'medium',
      message: `${dbQueries.length} database queries in one request (${sequentialCount} sequential, ${parallelDbIds.size} parallel). Consider batching, joins, or a data loader.`,
    });
  }

  const selectQueries = dbQueries.filter(
    (q) => (q.operation || q.db_action) === 'select' || q.label?.toLowerCase().includes('select')
  );
  if (selectQueries.length >= 3) {
    items.push({
      kind: 'n_plus_one_suspect',
      severity: selectQueries.length >= 6 ? 'high' : 'medium',
      message: `${selectQueries.length} SELECT queries detected — possible N+1 pattern. Review loops that fetch related records per row.`,
    });
  }

  const slowMiddleware = timedNodes.filter(
    (n) => n.type === 'middleware' && totalDuration > 0 && n.duration_ms / totalDuration >= 0.2
  );
  for (const mw of slowMiddleware) {
    items.push({
      kind: 'slow_middleware',
      severity: mw.duration_ms / totalDuration >= 0.4 ? 'high' : 'medium',
      message: `Middleware "${mw.label}" took ${mw.duration_ms}ms (${round((mw.duration_ms / totalDuration) * 100)}% of total). Check for blocking I/O or heavy logic in middleware.`,
    });
  }

  if (totalDuration >= 1000) {
    items.push({
      kind: 'slow_request',
      severity: totalDuration >= 3000 ? 'high' : 'medium',
      message: `Request took ${totalDuration}ms end-to-end. Use the timeline breakdown to find the largest contributors.`,
    });
  }

  return items;
}

/**
 * @param {object} node
 */
function pickDbFields(node) {
  return {
    driver: node.driver || null,
    operation: node.operation || node.db_action || null,
    query: node.query || null,
    rows: node.rows ?? null,
    db_intent: node.db_intent || null,
    db_result: node.db_result || null,
  };
}

/**
 * @param {number} n
 */
function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} trace
 * @returns {string}
 */
function exportFilename(trace) {
  const pathPart = (trace.url || 'request')
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 40);
  return `${trace.method}-${pathPart || 'request'}-${trace.id}.opencons.json`;
}

/**
 * @param {object} trace
 */
function downloadTraceExport(trace) {
  const payload = buildTraceExport(trace);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(trace);
  anchor.click();

  URL.revokeObjectURL(url);
}

/**
 * @param {object} trace
 * @returns {Promise<void>}
 */
async function copyTraceExport(trace) {
  const payload = buildTraceExport(trace);
  const json = JSON.stringify(payload, null, 2);
  await navigator.clipboard.writeText(json);
}

const exportApi = {
  buildTraceExport,
  exportFilename,
  downloadTraceExport,
  copyTraceExport,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exportApi;
} else {
  root.OpenconsExport = exportApi;
}
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
