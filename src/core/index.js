'use strict';

const { runWithContext, getCurrentContext, attachContextToReq } = require('./context');
const { TraceTracer } = require('./tracer');
const { createTraceStore } = require('../store/trace-store');
const { createWebSocketServer } = require('../server/ws');
const { createStaticServer, closeStaticServer } = require('../server/static');
const { closeWebSocketServer } = require('../server/ws');
const { installRequireHook } = require('../interceptors/require-hook');
const { installDrivers } = require('../drivers');
const { resolveOptions, isProductionDisabled } = require('../lib/config');
const { logger } = require('../lib/logger');
const { safeClone } = require('../lib/serialize');

/** @typedef {import('../lib/config').OpenconsOptions} OpenconsOptions */

/** @type {ReturnType<import('../store/trace-store').createTraceStore> | null} */
let traceStore = null;

/** @type {boolean} */
let initialised = false;

/** @type {OpenconsOptions | null} */
let activeOptions = null;

/**
 * @param {Partial<OpenconsOptions>} [userOptions]
 * @returns {import('express').RequestHandler}
 */
function createOpencons(userOptions = {}) {
  let options;

  try {
    options = resolveOptions(userOptions);
  } catch (err) {
    logger.error(`Invalid configuration: ${err.message}`);
    throw err;
  }

  if (isProductionDisabled(options)) {
    logger.warn('Disabled in production. Opencons is intended for development only.');
    return (_req, _res, next) => next();
  }

  if (initialised) {
    logger.warn('Already initialised — additional call is ignored. Call opencons() only once.');
    return buildMiddleware(activeOptions);
  }

  initialised = true;
  activeOptions = options;
  traceStore = createTraceStore(options.maxTraces);

  if (options.transform?.enabled) {
    installRequireHook({
      projectRoot: options.transform.projectRoot || process.cwd(),
      exclude: options.transform.exclude || [],
    });
  }

  installDrivers(options.drivers);

  if (options.enableWidget) {
    createStaticServer(options.port)
      .then(({ port }) => {
        options.widgetPort = port;
        createWebSocketServer(traceStore);
      })
      .catch((err) => {
        logger.error(`Widget server failed to start: ${err.message}`, err);
      });
  }

  return buildMiddleware(options);
}

/**
 * @param {OpenconsOptions} options
 * @returns {import('express').RequestHandler}
 */
function buildMiddleware(options) {
  let loggedFirstRequest = false;

  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  function middleware(req, res, next) {
    if (!traceStore) {
      return next();
    }

    // Nest hook + prepend can both invoke this — trace once per request.
    if (getCurrentContext()) {
      return next();
    }

    if (shouldExclude(req, options.exclude)) {
      return next();
    }

    if (!loggedFirstRequest) {
      loggedFirstRequest = true;
      logger.info(`Tracing ${req.method} ${req.originalUrl || req.url}`);
    }

    /** @type {unknown} */
    let capturedResponse;

    if (options.captureResponse) {
      attachResponseCapture(res, (body) => {
        capturedResponse = safeClone(body);
      });
    }

    const tracer = new TraceTracer({
      method: req.method,
      url: req.originalUrl || req.url,
      params: req.params,
      body: options.captureBody ? safeClone(req.body) : undefined,
    });

    tracer.onChange = () => {
      traceStore.update(tracer.snapshot());
    };

    traceStore.start(tracer.snapshot());

    const context = {
      id: tracer.id,
      startTime: tracer.startTime,
      tracer,
    };

    let finished = false;

    const onFinish = () => {
      if (finished) return;
      finished = true;
      res.off('finish', onFinish);
      res.off('close', onFinish);
      // Flush any in-flight probe updates before sealing.
      traceStore.update(tracer.snapshot());
      tracer.onChange = null;
      traceStore.complete(tracer.finish(res.statusCode, capturedResponse));
    };

    res.on('finish', onFinish);
    res.on('close', onFinish);

    attachContextToReq(req, context);
    runWithContext(context, () => next());
  }

  middleware.getTraces = () => (traceStore ? traceStore.getAll() : []);
  middleware.options = options;
  middleware.__openconsEntry = true;

  return middleware;
}

/**
 * @param {import('express').Response} res
 * @param {(body: unknown) => void} onCapture
 */
function attachResponseCapture(res, onCapture) {
  const originalJson = res.json.bind(res);
  res.json = function patchedJson(body) {
    onCapture(body);
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = function patchedSend(body) {
    onCapture(body);
    return originalSend(body);
  };
}

/**
 * @param {import('express').Request} req
 * @param {string[]} excludePatterns
 */
/**
 * Escape special regex metacharacters except `*` which we expand to `.*`.
 * @param {string} str
 */
function escapeRegexExceptStar(str) {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function shouldExclude(req, excludePatterns) {
  const urlPath = (req.originalUrl || req.url).split('?')[0];

  return excludePatterns.some((pattern) => {
    if (pattern.includes('*')) {
      const escaped = escapeRegexExceptStar(pattern).replace(/\*/g, '.*');
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(urlPath);
    }
    // Anchor prefix matches to segment boundaries to avoid `/api` matching `/apiv2`
    const withTrailing = pattern.endsWith('/') ? pattern : `${pattern}/`;
    return urlPath === pattern || urlPath.startsWith(withTrailing);
  });
}

/**
 * Close the widget HTTP and WebSocket servers and release module state.
 * Useful in tests and hot-reload scenarios to avoid dangling listeners.
 * @returns {Promise<void>}
 */
async function shutdown() {
  await closeWebSocketServer();
  await closeStaticServer();
  traceStore = null;
  initialised = false;
  activeOptions = null;
}

module.exports = {
  createOpencons,
  shutdown,
};
