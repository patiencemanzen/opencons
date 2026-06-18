'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTraceExport } = require('../widget/export');
const {
  SnapshotStore,
  MemoryStorage,
  endpointKey,
  extractMetrics,
  compareMetrics,
} = require('../widget/snapshots');
const { TraceTracer } = require('../src/core/tracer');

function makeStore() {
  return new SnapshotStore(new MemoryStorage());
}

function makeTrace() {
  const tracer = new TraceTracer({ method: 'GET', url: '/users' });
  tracer.addNode({ type: 'middleware', label: 'auth', duration_ms: 5, called_next: true });
  tracer.addNode({ type: 'controller', label: 'listUsers', duration_ms: 10 });
  return tracer.finish(200);
}

describe('snapshots', () => {
  it('extracts comparable metrics from export payload', () => {
    const trace = makeTrace();
    const payload = buildTraceExport(trace);
    const metrics = extractMetrics(payload);

    assert.equal(metrics.duration_ms, payload.summary.total_duration_ms);
    assert.equal(metrics.db_query_count, 0);
    assert.equal(metrics.middleware_total_ms, 5);
    assert.equal(metrics.controller_total_ms, 10);
  });

  it('saves and lists snapshots by endpoint', () => {
    const store = makeStore();
    const trace = makeTrace();

    const snapshot = store.save(trace, {
      label: 'baseline',
      buildExport: buildTraceExport,
    });

    assert.equal(snapshot.endpoint_key, 'GET /users');
    assert.equal(snapshot.label, 'baseline');
    assert.equal(store.list().length, 1);
    assert.equal(store.getByEndpoint('GET /users').length, 1);
  });

  it('compares snapshots to show improvement', () => {
    const store = makeStore();

    const slow = makeTrace();
    slow.duration_ms = 120;
    const fast = makeTrace();
    fast.duration_ms = 80;

    const baseline = store.save(slow, { buildExport: buildTraceExport });
    const improved = store.save(fast, { label: 'after cache', buildExport: buildTraceExport });

    const result = store.compareWithPrevious(improved.id);
    assert.ok(result);
    assert.equal(result.previous.id, baseline.id);
    assert.equal(result.current.id, improved.id);
    assert.equal(result.comparison.delta.duration_ms.change, -40);
    assert.ok(result.comparison.improved);
  });

  it('compares a live trace against the latest snapshot', () => {
    const store = makeStore();
    const baseline = store.save(makeTrace(), { buildExport: buildTraceExport });

    const live = makeTrace();
    live.duration_ms = 50;
    live.nodes.find((n) => n.type === 'controller').duration_ms = 40;

    const result = store.compareTraceToLatest(live, buildTraceExport);
    assert.ok(result);
    assert.equal(result.baseline.id, baseline.id);
    assert.ok(result.comparison.delta.duration_ms);
  });

  it('builds endpoint trend history in chronological order', () => {
    const store = makeStore();
    store.save(makeTrace(), { label: 'v1', buildExport: buildTraceExport });
    store.save(makeTrace(), { label: 'v2', buildExport: buildTraceExport });

    const trend = store.getTrend('GET /users');
    assert.equal(trend.length, 2);
    assert.equal(trend[0].label, 'v1');
    assert.equal(trend[1].label, 'v2');
  });

  it('reports metric deltas with percent change', () => {
    const comparison = compareMetrics(
      { duration_ms: 100, db_query_count: 4 },
      { duration_ms: 75, db_query_count: 2 }
    );

    assert.equal(comparison.delta.duration_ms.change, -25);
    assert.equal(comparison.delta.duration_ms.percent, -25);
    assert.equal(comparison.delta.db_query_count.change, -2);
    assert.ok(comparison.improved);
  });

  it('normalizes endpoint keys', () => {
    assert.equal(endpointKey('POST', '/api/orders'), 'POST /api/orders');
  });

  it('normalizes legacy snapshots missing metrics', () => {
    const store = makeStore();
    const trace = makeTrace();
    const payload = buildTraceExport(trace);
    const storage = new MemoryStorage();
    storage.setItem(
      'opencons.snapshots.v1',
      JSON.stringify({
        version: '1',
        snapshots: [
          {
            id: 'snap_legacy',
            saved_at: new Date().toISOString(),
            endpoint_key: 'GET /users',
            export: payload,
          },
        ],
      })
    );
    const legacyStore = new SnapshotStore(storage);
    const snapshot = legacyStore.get('snap_legacy');
    assert.ok(snapshot?.metrics);
    assert.equal(snapshot.metrics.duration_ms, payload.summary.total_duration_ms);
  });
});
