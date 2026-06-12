'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveOptions } = require('../src/lib/config');
const { ConfigurationError } = require('../src/lib/errors');

describe('resolveOptions', () => {
  it('merges defaults', () => {
    const options = resolveOptions({ port: 8000 });
    assert.equal(options.port, 8000);
    assert.equal(options.maxTraces, 100);
    assert.equal(options.drivers.pg, true);
  });

  it('rejects invalid port', () => {
    assert.throws(() => resolveOptions({ port: 0 }), ConfigurationError);
    assert.throws(() => resolveOptions({ port: '7331' }), ConfigurationError);
  });

  it('rejects invalid exclude', () => {
    assert.throws(() => resolveOptions({ exclude: [1] }), ConfigurationError);
  });
});
