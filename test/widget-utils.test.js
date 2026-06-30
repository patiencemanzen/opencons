'use strict';

/**
 * Unit tests for widget pure utility functions.
 * Since the widget runs in a browser environment we cannot require app.js
 * directly, so we re-implement and test the core logic here.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// escapeHtml — copied from widget/app.js (and all widget escapeHtml variants)
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// sanitizeMethod — copied from widget/app.js
// ---------------------------------------------------------------------------

const VALID_HTTP_METHOD = /^[A-Z]+$/;

function sanitizeMethod(method) {
  if (typeof method === 'string' && VALID_HTTP_METHOD.test(method)) {
    return method;
  }
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// groupTracesByEndpoint — adapted from widget/app.js (no window dependency)
// ---------------------------------------------------------------------------

function traceEndpointKey(trace) {
  return `${trace.method} ${trace.url}`;
}

function groupTracesByEndpoint(items) {
  const groups = new Map();

  for (const trace of items) {
    const key = traceEndpointKey(trace);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trace);
  }

  return Array.from(groups.entries())
    .map(([key, groupTraces]) => {
      groupTraces.sort((a, b) => b.timestamp - a.timestamp);
      const [method, ...urlParts] = key.split(' ');
      return {
        key,
        method,
        url: urlParts.join(' '),
        traces: groupTraces,
        latest: groupTraces[0],
      };
    })
    .sort((a, b) => b.latest.timestamp - a.latest.timestamp);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('widget escapeHtml', () => {
  it('escapes ampersand, angle brackets and quotes', () => {
    assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  });

  it('returns empty string for null', () => {
    assert.equal(escapeHtml(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(escapeHtml(undefined), '');
  });

  it('coerces numbers to string', () => {
    assert.equal(escapeHtml(42), '42');
  });

  it('does not double-escape safe strings', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });

  it('prevents XSS via method injection by escaping critical characters', () => {
    const payload = 'GET"><img src=x onerror=alert(1)>';
    const escaped = escapeHtml(payload);
    // The < and " chars that would start a tag or break attribute context must be escaped.
    assert.ok(!escaped.includes('<img'), 'literal <img should not appear in output');
    assert.ok(!escaped.includes('"<'), 'attribute-injection sequence should not appear');
    assert.ok(escaped.includes('&lt;'), 'less-than should be entity-encoded');
    assert.ok(escaped.includes('&quot;'), 'double-quote should be entity-encoded');
  });
});

describe('widget sanitizeMethod', () => {
  it('passes through valid uppercase HTTP methods', () => {
    assert.equal(sanitizeMethod('GET'), 'GET');
    assert.equal(sanitizeMethod('POST'), 'POST');
    assert.equal(sanitizeMethod('DELETE'), 'DELETE');
    assert.equal(sanitizeMethod('PATCH'), 'PATCH');
  });

  it('rejects methods with HTML injection characters', () => {
    assert.equal(sanitizeMethod('GET"><img>'), 'UNKNOWN');
    assert.equal(sanitizeMethod('<script>'), 'UNKNOWN');
  });

  it('rejects lowercase methods', () => {
    assert.equal(sanitizeMethod('get'), 'UNKNOWN');
    assert.equal(sanitizeMethod('Get'), 'UNKNOWN');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(sanitizeMethod(null), 'UNKNOWN');
    assert.equal(sanitizeMethod(undefined), 'UNKNOWN');
    assert.equal(sanitizeMethod(''), 'UNKNOWN');
  });
});

describe('widget groupTracesByEndpoint', () => {
  const makeTrace = (method, url, timestamp = Date.now(), id = Math.random().toString(36)) => ({
    id,
    method,
    url,
    timestamp,
    state: 'complete',
    status: 200,
    duration_ms: 10,
    nodes: [],
    edges: [],
  });

  it('groups traces by method + url', () => {
    const traces = [
      makeTrace('GET', '/users', 100),
      makeTrace('GET', '/users', 200),
      makeTrace('POST', '/users', 150),
    ];

    const groups = groupTracesByEndpoint(traces);
    assert.equal(groups.length, 2);

    const getGroup = groups.find((g) => g.key === 'GET /users');
    assert.ok(getGroup);
    assert.equal(getGroup.traces.length, 2);
    assert.equal(getGroup.method, 'GET');
    assert.equal(getGroup.url, '/users');

    const postGroup = groups.find((g) => g.key === 'POST /users');
    assert.ok(postGroup);
    assert.equal(postGroup.traces.length, 1);
  });

  it('returns groups sorted by most-recent trace first', () => {
    const traces = [
      makeTrace('GET', '/old', 100),
      makeTrace('GET', '/new', 999),
    ];

    const groups = groupTracesByEndpoint(traces);
    assert.equal(groups[0].url, '/new');
    assert.equal(groups[1].url, '/old');
  });

  it('sets latest to the most recent trace in each group', () => {
    const older = makeTrace('GET', '/api', 1000, 'a');
    const newer = makeTrace('GET', '/api', 2000, 'b');
    const groups = groupTracesByEndpoint([older, newer]);

    assert.equal(groups[0].latest.id, 'b');
  });

  it('handles an empty list', () => {
    assert.deepEqual(groupTracesByEndpoint([]), []);
  });

  it('handles a single trace', () => {
    const groups = groupTracesByEndpoint([makeTrace('DELETE', '/items/1', 500)]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].method, 'DELETE');
    assert.equal(groups[0].url, '/items/1');
    assert.equal(groups[0].traces.length, 1);
  });
});
