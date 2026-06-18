'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeAnalytics, countDbQueries } = require('../widget/analytics');
const { TraceTracer } = require('../src/core/tracer');

describe('computeAnalytics', () => {
  it('aggregates endpoint duration and db metrics', () => {
    const slow = new TraceTracer({ method: 'GET', url: '/users' });
    slow.addNode({ type: 'db', label: 'select users', duration_ms: 40 });
    slow.addNode({ type: 'controller', label: 'list', duration_ms: 10 });
    const slowTrace = slow.finish(200);
    slowTrace.duration_ms = 80;

    const fast = new TraceTracer({ method: 'GET', url: '/users' });
    fast.addNode({ type: 'controller', label: 'list', duration_ms: 5 });
    const fastTrace = fast.finish(200);
    fastTrace.duration_ms = 20;

    const busy = new TraceTracer({ method: 'POST', url: '/save' });
    busy.addNode({ type: 'db', label: 'insert', duration_ms: 12 });
    busy.addNode({ type: 'db', label: 'insert audit', duration_ms: 8 });
    const busyTrace = busy.finish(201);
    busyTrace.duration_ms = 45;

    const analytics = computeAnalytics([slowTrace, fastTrace, busyTrace]);

    assert.equal(analytics.summary.totalRequests, 3);
    assert.equal(analytics.summary.endpointCount, 2);
    assert.equal(analytics.summary.totalDbQueries, 3);
    assert.equal(analytics.byEndpoint.length, 2);

    const users = analytics.byEndpoint.find((row) => row.url === '/users');
    assert.equal(users.count, 2);
    assert.equal(users.avgDuration, 50);
    assert.equal(users.avgDbQueries, 0.5);

    const save = analytics.byEndpoint.find((row) => row.url === '/save');
    assert.equal(save.avgDbQueries, 2);
    assert.equal(analytics.topByVolume[0].url, '/users');
  });

  it('tracks status distribution and errors', () => {
    const ok = new TraceTracer({ method: 'GET', url: '/ok' }).finish(200);
    ok.duration_ms = 10;
    const fail = new TraceTracer({ method: 'GET', url: '/fail' }).finish(500);
    fail.duration_ms = 30;

    const analytics = computeAnalytics([ok, fail]);

    assert.equal(analytics.summary.errorCount, 1);
    assert.equal(analytics.summary.errorRate, 50);
    assert.deepEqual(
      analytics.statusDistribution.map((row) => row.bucket).sort(),
      ['2xx', '5xx']
    );
  });

  it('counts db nodes on a trace', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/x' });
    tracer.addNode({ type: 'db', label: 'q1', duration_ms: 1 });
    tracer.addNode({ type: 'db', label: 'q2', duration_ms: 1 });
    const trace = tracer.finish(200);
    assert.equal(countDbQueries(trace), 2);
  });
});
