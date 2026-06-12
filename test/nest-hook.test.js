'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const opencons = require('../src/index');

describe('Nest request hook integration', () => {
  it('traces requests through a Nest-style onRequestHook', async () => {
    const expressApp = express();
    const rg = opencons({ enableWidget: false });

    const httpAdapter = {
      onRequestHook: null,
      setOnRequestHook(hook) {
        this.onRequestHook = hook;
      },
      getInstance() {
        return expressApp;
      },
    };

    expressApp.use((req, res, next) => {
      if (httpAdapter.onRequestHook) {
        httpAdapter.onRequestHook(req, res, next);
        return;
      }
      next();
    });

    const previousHook = httpAdapter.onRequestHook;
    httpAdapter.setOnRequestHook((req, res, next) => {
      rg(req, res, () => {
        if (previousHook) {
          previousHook(req, res, next);
          return;
        }
        next();
      });
    });

    expressApp.get('/ping', (_req, res) => res.send('ok'));

    const server = await new Promise((resolve) => {
      const srv = expressApp.listen(0, () => resolve(srv));
    });

    await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server.address().port}/ping`, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => server.close(resolve));

    const traces = rg.getTraces();
    assert.equal(traces.length, 1);
    assert.equal(traces[0].url, '/ping');
    assert.equal(traces[0].status, 200);
  });
});
