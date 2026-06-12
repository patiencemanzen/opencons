'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TraceTracer } = require('../src/core/tracer');

describe('TraceTracer', () => {
  it('builds a sequential middleware chain graph', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/test' });

    tracer.addNode({ type: 'middleware', label: 'cors', duration_ms: 0.3, called_next: true });
    tracer.addNode({
      type: 'middleware',
      label: 'auth',
      duration_ms: 5,
      called_next: false,
      exit_reason: 'res.status(401)',
    });

    const trace = tracer.finish(401);

    assert.equal(trace.method, 'GET');
    assert.equal(trace.status, 401);
    assert.equal(trace.nodes.length, 4);
    assert.equal(trace.edges.length, 3);
    assert.equal(trace.nodes[0].type, 'request');
    assert.equal(trace.nodes.at(-1).type, 'response');
  });
});
