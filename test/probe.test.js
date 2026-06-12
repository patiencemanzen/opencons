'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runWithContext } = require('../src/core/context');
const { TraceTracer } = require('../src/core/tracer');
const { __rg_probe, __rg_else_probe } = require('../src/transform/probe');

describe('runtime probes', () => {
  it('records branch nodes with natural language and outcomes', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/branch' });
    const context = { id: tracer.id, startTime: tracer.startTime, tracer };

    runWithContext(context, () => {
      const value = __rg_probe('if:handler.js:12', true, 'user.isAdmin', true);
      assert.equal(value, true);
    });

    const branch = tracer.nodes.find((node) => node.type === 'branch');
    assert.ok(branch);
    assert.equal(branch.value, true);
    assert.match(branch.label, /Checked whether/);
    assert.equal(branch.summary, 'Yes — code inside the then branch ran');
    assert.equal(branch.condition, 'user.isAdmin');
    assert.deepEqual(branch.outcomes, [
      { key: 'then', label: 'Then block — ran', taken: true },
      { key: 'else', label: 'Else block — skipped', taken: false },
    ]);
    assert.deepEqual(branch.source, { file: 'handler.js', line: 12, kind: 'if' });
  });

  it('merges else branch into the matching if decision', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/else' });
    const context = { id: tracer.id, startTime: tracer.startTime, tracer };

    runWithContext(context, () => {
      __rg_probe('if:handler.js:20', false, 'items.length > 0', true);
      __rg_else_probe('if:handler.js:20');
    });

    const branches = tracer.nodes.filter((node) => node.type === 'branch');
    assert.equal(branches.length, 1);
    assert.equal(branches[0].taken_outcome, 'else');
    assert.equal(branches[0].summary, 'No — ran the else branch instead');
    assert.deepEqual(branches[0].outcomes, [
      { key: 'then', label: 'Then block — skipped', taken: false },
      { key: 'else', label: 'Else block — ran', taken: true },
    ]);
  });

  it('shows skipped then branch when if has no else', () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/no-else' });
    const context = { id: tracer.id, startTime: tracer.startTime, tracer };

    runWithContext(context, () => {
      __rg_probe('if:handler.js:8', false, 'token', false);
    });

    const branch = tracer.nodes.find((node) => node.type === 'branch');
    assert.ok(branch);
    assert.equal(branch.summary, 'No — then branch skipped');
    assert.deepEqual(branch.outcomes, [
      { key: 'then', label: 'Then block — skipped', taken: false },
    ]);
  });

  it('is a no-op outside an active trace context', () => {
    assert.equal(__rg_probe('if:handler.js:1', false), false);
  });
});
