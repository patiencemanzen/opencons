'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { wrapHandler } = require('../src/interceptors/express');
const { label } = require('../src/utils/label');

describe('middleware naming', () => {
  it('uses Opencons.label()', () => {
    function myMiddleware(_req, _res, next) {
      next();
    }

    const named = label('customCors', myMiddleware);
    const wrapped = wrapHandler(named);

    assert.equal(wrapped.__openconsName, 'customCors');
  });

  it('labels bound Nest middleware class methods', () => {
    class LoggerMiddleware {
      use(_req, _res, next) {
        next();
      }
    }

    const instance = new LoggerMiddleware();
    const wrapped = wrapHandler(label('LoggerMiddleware', instance.use.bind(instance)));

    assert.equal(wrapped.__openconsName, 'LoggerMiddleware');
  });
});
