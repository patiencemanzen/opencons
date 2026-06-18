'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTraceExport } = require('../widget/export');
const { TraceTracer } = require('../src/core/tracer');

describe('buildTraceExport', () => {
  it('builds timeline with sequential offsets', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/users' });
    tracer.addNode({ type: 'middleware', label: 'cors', duration_ms: 2, called_next: true });
    tracer.addNode({ type: 'middleware', label: 'auth', duration_ms: 5, called_next: true });
    tracer.addNode({ type: 'controller', label: 'getUsers', duration_ms: 10 });
    const trace = tracer.finish(200);

    const payload = buildTraceExport(trace);

    assert.equal(payload.export_type, 'opencons.trace');
    assert.equal(payload.request.method, 'GET');
    assert.equal(payload.request.status, 200);
    assert.equal(payload.timeline.length, 3);
    assert.equal(payload.timeline[0].start_offset_ms, 0);
    assert.equal(payload.timeline[0].end_offset_ms, 2);
    assert.equal(payload.timeline[1].start_offset_ms, 2);
    assert.equal(payload.timeline[2].duration_ms, 10);
    assert.ok(payload.summary.breakdown_by_type.middleware);
    assert.equal(payload.graph.nodes.length, trace.nodes.length);
  });

  it('summarizes db queries and flags n+1 patterns', () => {
    const trace = {
      id: 'req_test',
      timestamp: Date.now(),
      method: 'GET',
      url: '/orders',
      params: {},
      status: 200,
      duration_ms: 120,
      state: 'complete',
      nodes: [
        { id: 'n1', type: 'request', label: 'GET /orders', duration_ms: null },
        { id: 'n2', type: 'db', label: 'SELECT orders', duration_ms: 20, operation: 'select', driver: 'pg' },
        { id: 'n3', type: 'db', label: 'SELECT items', duration_ms: 25, operation: 'select', driver: 'pg' },
        { id: 'n4', type: 'db', label: 'SELECT users', duration_ms: 30, operation: 'select', driver: 'pg' },
        { id: 'n5', type: 'db', label: 'SELECT addresses', duration_ms: 35, operation: 'select', driver: 'pg' },
        { id: 'n6', type: 'response', label: '200', duration_ms: null },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
        { from: 'n5', to: 'n6' },
      ],
    };

    const payload = buildTraceExport(trace);

    assert.equal(payload.summary.db.query_count, 4);
    assert.equal(payload.db_queries.length, 4);
    assert.ok(payload.recommendations.some((r) => r.kind === 'many_db_queries'));
    assert.ok(payload.recommendations.some((r) => r.kind === 'n_plus_one_suspect'));
    assert.equal(payload.summary.bottlenecks[0].label, 'SELECT addresses');
  });

  it('marks parallel db queries from edges', () => {
    const trace = {
      id: 'req_parallel',
      timestamp: Date.now(),
      method: 'GET',
      url: '/dashboard',
      params: {},
      status: 200,
      duration_ms: 50,
      state: 'complete',
      nodes: [
        { id: 'n1', type: 'request', label: 'GET /dashboard', duration_ms: null },
        { id: 'n2', type: 'controller', label: 'handler', duration_ms: 5 },
        { id: 'n3', type: 'db', label: 'SELECT a', duration_ms: 20, driver: 'pg', operation: 'select' },
        { id: 'n4', type: 'db', label: 'SELECT b', duration_ms: 22, driver: 'pg', operation: 'select' },
        { id: 'n5', type: 'response', label: '200', duration_ms: null },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3', parallel: true },
        { from: 'n2', to: 'n4', parallel: true },
        { from: 'n3', to: 'n5' },
      ],
    };

    const payload = buildTraceExport(trace);

    assert.equal(payload.summary.db.parallel_count, 2);
    assert.equal(payload.db_queries.filter((q) => q.parallel).length, 2);
  });
});
