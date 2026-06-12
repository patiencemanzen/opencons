'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const opencons = require('../src/index');
const express = require('express');

const APP_PORT = 3456;

/** @type {import('http').Server | null} */
let server = null;

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
      server = app.listen(APP_PORT, resolve);
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
    assert.ok(traces.length >= 2);

    const hello = traces.find((t) => t.url === '/hello');
    const deny = traces.find((t) => t.url === '/deny');

    assert.ok(hello);
    assert.equal(hello.status, 200);

    const helloMiddleware = hello.nodes.filter((n) => n.type === 'middleware');
    assert.ok(helloMiddleware.some((n) => n.label === 'corsMiddleware' && n.called_next === true));

    assert.ok(deny);
    assert.equal(deny.status, 403);

    const routeHandler = deny.nodes.find((n) => n.type === 'middleware' && n.label !== 'corsMiddleware');
    assert.ok(routeHandler);
    assert.equal(routeHandler.called_next, false);
  });
});
