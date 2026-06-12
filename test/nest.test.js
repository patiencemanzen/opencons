'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { prependMiddleware } = require('../src/integrations/nest');

describe('Nest integration', () => {
  it('prepends middleware so it runs before later handlers', async () => {
    const order = [];
    const app = express();

    app.use((_req, _res, next) => {
      order.push('existing');
      next();
    });

    prependMiddleware(app, (_req, _res, next) => {
      order.push('Opencons');
      next();
    });

    app.get('/ping', (_req, res) => {
      order.push('handler');
      res.send('ok');
    });

    const server = await new Promise((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });

    await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server.address().port}/ping`, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });

    await new Promise((resolve) => server.close(resolve));

    assert.deepEqual(order, ['Opencons', 'existing', 'handler']);
  });
});
