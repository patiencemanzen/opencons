'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sourceCache = require('../src/store/source-cache');

describe('source-cache', () => {
  beforeEach(() => {
    sourceCache.setProjectRoot(path.join('/app', 'project'));
  });

  it('uses project-relative keys to avoid basename collisions', () => {
    const fileA = path.join('/app', 'project', 'routes', 'users.js');
    const fileB = path.join('/app', 'project', 'admin', 'users.js');

    sourceCache.store(fileA, 'route users', null);
    sourceCache.store(fileB, 'admin users', null);

    assert.equal(sourceCache.normalizeKey(fileA), 'routes/users.js');
    assert.equal(sourceCache.normalizeKey(fileB), 'admin/users.js');

    const snippetA = sourceCache.getSnippet('routes/users.js', 1);
    const snippetB = sourceCache.getSnippet('admin/users.js', 1);

    assert.match(snippetA.lines[0].text, /route users/);
    assert.match(snippetB.lines[0].text, /admin users/);
  });

  it('falls back to basename lookup for legacy probe labels', () => {
    const file = path.join('/app', 'project', 'handler.js');
    sourceCache.store(file, 'legacy handler', null);

    const snippet = sourceCache.getSnippet('handler.js', 1);
    assert.match(snippet.lines[0].text, /legacy handler/);
  });
});
