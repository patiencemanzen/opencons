'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { transformSource } = require('../src/transform/ast');

describe('transformSource', () => {
  it('injects __rg_probe around if conditions', () => {
    const source = [
      'function handler(req) {',
      '  if (req.ok) {',
      '    return 1;',
      '  } else {',
      '    return 0;',
      '  }',
      '}',
    ].join('\n');

    const result = transformSource(source, '/app/handler.js');

    assert.equal(result.skipped, false);
    assert.match(result.code, /__rg_probe\(/);
    assert.match(result.code, /__rg_else_probe\(/);
    assert.ok(result.map);
  });

  it('skips minified bundles', () => {
    const source = 'a'.repeat(600);
    const result = transformSource(source, '/app/bundle.js');

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'minified');
  });

  it('skips files marked with opencons-skip', () => {
    const source = '// opencons-skip\nif (x) {}';
    const result = transformSource(source, '/app/skip.js');

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'opencons-skip');
  });
});
