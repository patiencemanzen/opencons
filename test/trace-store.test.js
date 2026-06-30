'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTraceStore } = require('../src/store/trace-store');

function makeTrace(id, state = 'active') {
  return {
    id,
    timestamp: Date.now(),
    method: 'GET',
    url: '/test',
    params: {},
    status: state === 'complete' ? 200 : null,
    state,
    duration_ms: 1,
    nodes: [],
    edges: [],
  };
}

describe('trace store', () => {
  it('tracks active traces until complete', () => {
    const store = createTraceStore(10);
    const active = makeTrace('req_abc');

    store.start(active);
    assert.equal(store.getAll().length, 1);
    assert.equal(store.getAll()[0].state, 'active');

    store.complete({ ...active, status: 200, state: 'complete', nodes: [{ id: 'n1', type: 'request', label: 'GET /test', duration_ms: null }] });

    const all = store.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].state, 'complete');
  });

  it('evicts oldest completed traces when maxTraces is exceeded', () => {
    const store = createTraceStore(3);

    for (let i = 0; i < 5; i++) {
      const t = makeTrace(`req_${i}`, 'complete');
      store.start(t);
      store.complete(t);
    }

    const all = store.getAll();
    assert.equal(all.length, 3, 'should cap at maxTraces');
  });

  it('getById finds active and completed traces', () => {
    const store = createTraceStore(10);
    const t1 = makeTrace('req_active');
    const t2 = makeTrace('req_done', 'complete');

    store.start(t1);
    store.start(t2);
    store.complete({ ...t2, state: 'complete' });

    assert.ok(store.getById('req_active'));
    assert.ok(store.getById('req_done'));
    assert.equal(store.getById('req_missing'), undefined);
  });

  it('broadcasts to WebSocket subscribers without throwing on circular payload', () => {
    const store = createTraceStore(10);
    const messages = [];

    const fakeSocket = {
      readyState: 1,
      send: (msg) => messages.push(msg),
    };

    store.subscribe(fakeSocket);

    const t = makeTrace('req_broadcast');
    assert.doesNotThrow(() => store.start(t));
    assert.equal(messages.length, 1);

    const parsed = JSON.parse(messages[0]);
    assert.equal(parsed.type, 'trace_start');
  });

  it('does not throw when broadcast payload is circular', () => {
    const store = createTraceStore(10);
    const messages = [];

    const fakeSocket = {
      readyState: 1,
      send: (msg) => messages.push(msg),
    };

    store.subscribe(fakeSocket);

    const circular = makeTrace('req_circular');
    circular.circular = circular;

    assert.doesNotThrow(() => store.start(circular));
    assert.equal(messages.length, 0, 'circular payload should be silently dropped');
  });

  it('unsubscribes WebSocket clients correctly', () => {
    const store = createTraceStore(10);
    let called = false;

    const fakeSocket = {
      readyState: 1,
      send: () => { called = true; },
    };

    store.subscribe(fakeSocket);
    store.unsubscribe(fakeSocket);

    store.start(makeTrace('req_x'));
    assert.equal(called, false, 'unsubscribed client should not receive messages');
  });
});
