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

  it('allows enableWidget boolean', () => {
    const opts = resolveOptions({ enableWidget: true });
    assert.equal(opts.enableWidget, true);
    const opts2 = resolveOptions({ enableWidget: false });
    assert.equal(opts2.enableWidget, false);
  });

  it('honours maxTraces option', () => {
    const opts = resolveOptions({ maxTraces: 50 });
    assert.equal(opts.maxTraces, 50);
  });

  it('accepts an exclude array of strings', () => {
    const opts = resolveOptions({ exclude: ['/health', '/metrics'] });
    assert.deepEqual(opts.exclude, ['/health', '/metrics']);
  });

  it('allows opting out individual drivers', () => {
    const opts = resolveOptions({ drivers: { pg: false, mysql2: false } });
    assert.equal(opts.drivers.pg, false);
    assert.equal(opts.drivers.mysql2, false);
    assert.equal(opts.drivers.mongoose, true);
  });
});
