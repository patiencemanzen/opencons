'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { logger } = require('../src/lib/logger');

describe('logger', () => {
  afterEach(() => {
    logger.setLevel('info');
  });

  it('filters debug messages at info level', () => {
    logger.setLevel('info');
    let called = false;

    const original = console.log;
    console.log = () => {
      called = true;
    };

    logger.debug('hidden');
    console.log = original;

    assert.equal(called, false);
  });
});
