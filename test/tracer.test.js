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

  it('snapshot() returns independent copies of nodes and edges', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/snap' });
    tracer.addNode({ type: 'middleware', label: 'mw', duration_ms: 1, called_next: true });

    const snap1 = tracer.snapshot();
    const lenBefore = snap1.nodes.length;

    snap1.nodes.push({ id: 'injected' });
    tracer.addNode({ type: 'middleware', label: 'mw2', duration_ms: 2, called_next: false });

    const snap2 = tracer.snapshot();
    assert.equal(snap1.nodes.length, lenBefore + 1, 'mutating snap1 should not affect tracer');
    assert.equal(snap2.nodes.length, lenBefore + 1, 'snap2 should reflect new node but not the injected one');
  });

  it('updateNode patches an existing node in place', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/update' });
    const node = tracer.addNode({ type: 'middleware', label: 'mw', duration_ms: null, called_next: false });

    tracer.updateNode(node.id, { duration_ms: 10.5, called_next: true });

    const found = tracer.nodes.find((n) => n.id === node.id);
    assert.equal(found.duration_ms, 10.5);
    assert.equal(found.called_next, true);
  });

  it('addForkNode creates a parallel edge from the specified parent', () => {
    const tracer = new TraceTracer({ method: 'POST', url: '/fork' });
    const controller = tracer.addNode({ type: 'controller', label: 'ctrl', duration_ms: 1 });

    const fork = tracer.addForkNode(controller.id, { type: 'db', label: 'query', duration_ms: 5 });

    const edge = tracer.edges.find((e) => e.from === controller.id && e.to === fork.id);
    assert.ok(edge, 'parallel edge should exist');
    assert.equal(edge.parallel, true);
  });

  it('finish() appends a response node and seals the tracer', () => {
    const tracer = new TraceTracer({ method: 'DELETE', url: '/items/1' });
    const result = tracer.finish(204);

    assert.equal(result.state, 'complete');
    assert.equal(result.status, 204);
    assert.equal(result.nodes.at(-1).type, 'response');
    assert.equal(result.nodes.at(-1).label, '204');
  });
});
