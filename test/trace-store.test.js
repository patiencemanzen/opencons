'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTraceStore } = require('../src/store/trace-store');

describe('trace store', () => {
  it('tracks active traces until complete', () => {
    const store = createTraceStore(10);
    const active = {
      id: 'req_abc',
      timestamp: Date.now(),
      method: 'GET',
      url: '/test',
      params: {},
      status: null,
      state: 'active',
      duration_ms: 1,
      nodes: [],
      edges: [],
    };

    store.start(active);
    assert.equal(store.getAll().length, 1);
    assert.equal(store.getAll()[0].state, 'active');

    store.complete({
      ...active,
      status: 200,
      state: 'complete',
      duration_ms: 5,
      nodes: [{ id: 'n1', type: 'request', label: 'GET /test', duration_ms: null }],
      edges: [],
    });

    const all = store.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].state, 'complete');
  });
});
