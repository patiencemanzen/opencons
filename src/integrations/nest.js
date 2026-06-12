'use strict';

const { createRouteGrapher } = require('../core');
const { patchExpressApp } = require('../interceptors/express');
const {
  patchNestGlobally,
  deferControllerTracingUntilReady,
} = require('./nest-lifecycle');

/**
 * @param {import('express').Application} expressApp
 * @param {import('express').RequestHandler} handler
 */
function prependMiddleware(expressApp, handler) {
  if (typeof expressApp.lazyrouter === 'function') {
    expressApp.lazyrouter();
  }

  const router = expressApp._router;

  if (!router || !Array.isArray(router.stack)) {
    expressApp.use(handler);
    return;
  }

  const Layer = require('express/lib/router/layer');
  const layer = new Layer('/', { sensitive: false, strict: false, end: false }, handler);
  router.stack.unshift(layer);
}

/**
 * @param {import('@nestjs/common').INestApplication} nestApp
 * @param {Parameters<typeof createRouteGrapher>[0]} [options]
 * @returns {ReturnType<typeof createRouteGrapher>}
 */
function applyToNest(nestApp, options) {
  patchNestGlobally();

  const middleware = createRouteGrapher(options);
  const httpAdapter = nestApp.getHttpAdapter();

  if (!httpAdapter || typeof httpAdapter.getInstance !== 'function') {
    const { RouteGrapherError } = require('../lib/errors');
    throw new RouteGrapherError(
      'Nest app must use the Express adapter (@nestjs/platform-express).',
      'NEST_ADAPTER_REQUIRED'
    );
  }

  const expressApp = httpAdapter.getInstance();
  patchExpressApp(expressApp);
  prependMiddleware(expressApp, middleware);

  if (typeof httpAdapter.setOnRequestHook === 'function') {
    const previousHook = httpAdapter.onRequestHook;

    httpAdapter.setOnRequestHook((req, res, next) => {
      middleware(req, res, () => {
        if (previousHook) {
          previousHook(req, res, next);
          return;
        }
        next();
      });
    });
  }

  // Register controller tracing after the app's own global interceptors (on listen/init).
  deferControllerTracingUntilReady(nestApp);

  const { logger } = require('../lib/logger');
  logger.info('Attached to Nest (middleware + guards + interceptors + controllers)');

  return middleware;
}

/**
 * @param {Parameters<typeof createRouteGrapher>[0]} [options]
 * @returns {ReturnType<typeof createRouteGrapher>}
 */
function createNestMiddleware(options) {
  return createRouteGrapher(options);
}

module.exports = {
  applyToNest,
  createNestMiddleware,
  prependMiddleware,
};
