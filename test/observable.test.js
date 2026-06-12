'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Observable } = require('rxjs');
const { traceObservable } = require('../src/utils/observable');
const { runWithContext } = require('../src/core/context');
const { TraceTracer } = require('../src/core/tracer');

describe('traceObservable', () => {
  it('returns a real RxJS Observable', () => {
    const source = new Observable((subscriber) => {
      subscriber.next('ok');
      subscriber.complete();
    });

    const wrapped = traceObservable(source, () => {});

    assert.equal(typeof wrapped.subscribe, 'function');
    assert.equal(typeof wrapped.pipe, 'function');
    assert.ok(wrapped instanceof Observable);
  });

  it('records finish on complete', async () => {
    const events = [];

    const source = new Observable((subscriber) => {
      subscriber.next('ok');
      subscriber.complete();
    });

    const wrapped = traceObservable(source, (reason) => {
      events.push(reason || 'done');
    });

    await new Promise((resolve) => {
      wrapped.subscribe({ complete: resolve });
    });

    assert.deepEqual(events, ['done']);
  });

  it('restores async context before onFinish runs', async () => {
    const tracer = new TraceTracer({ method: 'GET', url: '/ctx' });
    const alsContext = { id: tracer.id, startTime: tracer.startTime, tracer };
    const events = [];

    const source = new Observable((subscriber) => {
      setTimeout(() => {
        subscriber.complete();
      }, 5);
    });

    await runWithContext(alsContext, async () => {
      const wrapped = traceObservable(
        source,
        () => {
          events.push(require('../src/core/context').getCurrentTracer()?.id || 'missing');
        },
        alsContext
      );

      await new Promise((resolve) => {
        wrapped.subscribe({ complete: resolve });
      });
    });

    assert.deepEqual(events, [tracer.id]);
  });

  it('records finish on error', async () => {
    const events = [];

    const source = new Observable((subscriber) => {
      subscriber.error(new Error('boom'));
    });

    const wrapped = traceObservable(source, (reason) => {
      events.push(reason);
    });

    await new Promise((resolve) => {
      wrapped.subscribe({ error: resolve });
    });

    assert.equal(events[0], 'error: boom');
  });
});
