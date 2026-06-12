'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Observable } = require('rxjs');
const { runWithContext } = require('../src/core/context');
const { TraceTracer } = require('../src/core/tracer');
const { RouteGrapherControllerInterceptor } = require('../src/integrations/nest-lifecycle');

describe('Nest controller tracing', () => {
  it('records controller handler after async observable completes', async () => {
    const tracer = new TraceTracer({ method: 'POST', url: '/pos/v1/categories' });
    const context = { id: tracer.id, startTime: tracer.startTime, tracer };

    const executionContext = {
      getClass: () => ({ name: 'V1CategoriesController' }),
      getHandler: () => ({ name: 'create' }),
    };

    const interceptor = new RouteGrapherControllerInterceptor();

    await runWithContext(context, async () => {
      const stream = interceptor.intercept(executionContext, {
        handle: () =>
          new Observable((subscriber) => {
            setTimeout(() => {
              subscriber.next({ id: 1 });
              subscriber.complete();
            }, 5);
          }),
      });

      await new Promise((resolve, reject) => {
        stream.subscribe({ next: resolve, error: reject, complete: resolve });
      });
    });

    const controllerNode = tracer.nodes.find((node) => node.type === 'controller');
    assert.ok(controllerNode, 'expected controller node in trace');
    assert.equal(controllerNode.label, 'V1CategoriesController.create');
    assert.ok(controllerNode.duration_ms != null && controllerNode.duration_ms >= 0);
  });
});
