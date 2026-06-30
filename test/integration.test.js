'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const opencons = require('../src/index');
const express = require('express');

/** @type {import('http').Server | null} */
let server = null;

/** @type {number} */
let APP_PORT = 0;

/** @type {import('express').RequestHandler & { getTraces: () => object[] }} */
let rgMiddleware = null;

function fireRequest(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port: APP_PORT, path }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

describe('Opencons integration', () => {
  before(async () => {
    const app = express();
    rgMiddleware = opencons({ enableWidget: false });

    app.use(rgMiddleware);

    app.use(function corsMiddleware(_req, _res, next) {
      next();
    });

    app.get('/hello', (_req, res) => {
      res.json({ ok: true });
    });

    app.get('/deny', (_req, res) => {
      res.status(403).json({ error: 'nope' });
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        APP_PORT = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('records middleware chain with next() and early exit', async () => {
    await fireRequest('/hello');
    await fireRequest('/deny');

    const traces = rgMiddleware.getTraces();
    const hello = traces.find((t) => t.url === '/hello');
    const deny = traces.find((t) => t.url === '/deny');

    assert.ok(hello, 'hello trace should exist');
    assert.equal(hello.status, 200);

    const helloMiddleware = hello.nodes.filter((n) => n.type === 'middleware');
    assert.ok(helloMiddleware.some((n) => n.label === 'corsMiddleware' && n.called_next === true));

    assert.ok(deny, 'deny trace should exist');
    assert.equal(deny.status, 403);

    const routeHandler = deny.nodes.find((n) => n.type === 'middleware' && n.label !== 'corsMiddleware');
    assert.ok(routeHandler);
    assert.equal(routeHandler.called_next, false);
  });

  it('getTraces() returns a fresh array each call', async () => {
    await fireRequest('/hello');

    const traces1 = rgMiddleware.getTraces();
    const traces2 = rgMiddleware.getTraces();

    assert.notStrictEqual(traces1, traces2, 'getTraces() should return a new array each call');
    assert.ok(traces1.some((t) => t.url === '/hello'), 'traces should contain /hello');
  });
});

describe('Opencons WebSocket integration', () => {
  let wsPort = 0;

  before(async () => {
    const { createTraceStore } = require('../src/store/trace-store');
    const { createStaticServer } = require('../src/server/static');
    const { createWebSocketServer } = require('../src/server/ws');

    const store = createTraceStore(10);
    ({ port: wsPort } = await createStaticServer(0));

    createWebSocketServer(store);

    // Push a completed trace into the store so history is non-empty.
    store.complete({
      id: 'test_ws_001',
      timestamp: Date.now(),
      method: 'GET',
      url: '/ws-test',
      params: {},
      status: 200,
      state: 'complete',
      duration_ms: 5,
      nodes: [],
      edges: [],
    });
  });

  after(async () => {
    const { closeWebSocketServer } = require('../src/server/ws');
    const { closeStaticServer } = require('../src/server/static');
    await closeWebSocketServer();
    await closeStaticServer();
  });

  it('sends history in response to get_history message', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket test timed out'));
      }, 5000);

      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'get_history', limit: 10 }));
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'history') {
            clearTimeout(timeout);
            ws.close();

            assert.ok(Array.isArray(msg.payload), 'history payload should be an array');
            assert.ok(
              msg.payload.some((t) => t.id === 'test_ws_001'),
              'history should include the seeded trace'
            );

            resolve();
          }
        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  it('ignores malformed WebSocket messages without crashing', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket malformed-message test timed out'));
      }, 3000);

      ws.once('open', () => {
        // Send garbage followed by a valid message to ensure server keeps working.
        ws.send('not valid json }{{{');
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'get_history', limit: 1 }));
        }, 50);
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'history') {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
