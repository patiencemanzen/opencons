'use strict';

const { getCurrentTracer } = require('../core/context');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'];

let globalPatchApplied = false;

/**
 * Patch Express Application and Router prototypes so every handler
 * registered after Opencons initialises is automatically wrapped.
 */
function patchExpressGlobally() {
  if (globalPatchApplied) return;
  globalPatchApplied = true;

  const express = require('express');

  patchLayer(express.application);
  patchRouterPrototype(express.Router.prototype);
}

/**
 * @deprecated Use patchExpressGlobally — kept for explicit per-app attachment.
 * @param {import('express').Application} app
 */
function patchExpressApp(app) {
  patchExpressGlobally();
  patchLayer(app);
}

/**
 * @param {import('express').Application | import('express').Router} target
 */
function patchLayer(target) {
  if (target.__openconsLayerPatched) return;
  target.__openconsLayerPatched = true;

  const originalUse = target.use;
  target.use = function patchedUse(...args) {
    const wrapped = wrapHandlers(args);

    for (const fn of wrapped) {
      if (fn && fn.__openconsEntry) {
        patchLayer(this);
      }
    }

    return originalUse.apply(this, wrapped);
  };

  for (const method of HTTP_METHODS) {
    if (typeof target[method] !== 'function') continue;

    const original = target[method];
    target[method] = function patchedMethod(...args) {
      const wrapped = wrapHandlers(args);
      return original.apply(this, wrapped);
    };
  }
}

/**
 * @param {Function} Router
 */
function patchRouterPrototype(Router) {
  if (Router.__openconsPatched) return;
  Router.__openconsPatched = true;

  const originalUse = Router.use;
  Router.use = function patchedRouterUse(...args) {
    const wrapped = wrapHandlers(args);
    return originalUse.apply(this, wrapped);
  };

  for (const method of HTTP_METHODS) {
    if (typeof Router[method] !== 'function') continue;

    const original = Router[method];
    Router[method] = function patchedRouterMethod(...args) {
      const wrapped = wrapHandlers(args);
      return original.apply(this, wrapped);
    };
  }
}

/**
 * @param {unknown[]} args
 * @returns {unknown[]}
 */
function wrapHandlers(args) {
  const result = [...args];
  const startIndex = typeof result[0] === 'string' || result[0] instanceof RegExp ? 1 : 0;

  for (let i = startIndex; i < result.length; i += 1) {
    const handler = result[i];

    if (typeof handler === 'function') {
      result[i] = wrapHandler(handler);
    } else if (Array.isArray(handler)) {
      result[i] = handler.map((fn) =>
        typeof fn === 'function' ? wrapHandler(fn) : fn
      );
    }
  }

  return result;
}

/**
 * @param {Function} handler
 * @returns {Function}
 */
function wrapHandler(handler) {
  if (handler.__openconsWrapped) return handler;

  const name = resolveHandlerName(handler);

  function wrapped(req, res, next) {
    const tracer = getCurrentTracer();

    if (!tracer) {
      return handler(req, res, next);
    }

    const entered = performance.now();
    let calledNext = false;
    let exitReason = null;
    let exited = false;

    const wrappedNext = (...nextArgs) => {
      calledNext = true;

      if (!exited) {
        exited = true;
        recordMiddlewareExit();
      }

      return next(...nextArgs);
    };

    const recordMiddlewareExit = () => {
      const duration_ms = Math.round((performance.now() - entered) * 10) / 10;

      tracer.addNode({
        type: 'middleware',
        label: name,
        duration_ms,
        called_next: calledNext,
        exit_reason: exitReason || undefined,
      });
    };

    const originalStatus = res.status.bind(res);
    res.status = function patchedStatus(code) {
      if (!calledNext && !exited) {
        exitReason = `res.status(${code})`;
      }
      return originalStatus(code);
    };

    const originalJson = res.json.bind(res);
    res.json = function patchedJson(body) {
      if (!calledNext && !exited) {
        exitReason = 'res.json(...)';
      }
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = function patchedSend(body) {
      if (!calledNext && !exited) {
        exitReason = 'res.send(...)';
      }
      return originalSend(body);
    };

    const originalEnd = res.end.bind(res);
    res.end = function patchedEnd(...endArgs) {
      if (!calledNext && !exited) {
        exitReason = 'res.end(...)';
        exited = true;
        recordMiddlewareExit();
      }
      return originalEnd(...endArgs);
    };

    try {
      const result = handler(req, res, wrappedNext);

      if (result && typeof result.then === 'function') {
        result
          .catch((err) => {
            if (!exited) {
              exitReason = `error: ${err.message}`;
              exited = true;
              recordMiddlewareExit();
            }
            if (!calledNext) next(err);
          })
          .finally(() => {
            if (!exited) {
              exited = true;
              recordMiddlewareExit();
            }
          });
      } else if (!exited && !res.headersSent && !calledNext) {
        // Synchronous handler that did not call next or send a response yet.
        // Defer exit recording until response is sent or next is called.
      }

      return result;
    } catch (err) {
      if (!exited) {
        exitReason = `error: ${err.message}`;
        exited = true;
        recordMiddlewareExit();
      }
      throw err;
    }
  }

  wrapped.__openconsWrapped = true;
  wrapped.__openconsName = name;

  return wrapped;
}

/**
 * @param {Function} handler
 */
function resolveHandlerName(handler) {
  if (handler.__openconsName) return handler.__openconsName;

  const ctor = handler.constructor?.name;
  let method = handler.name;

  if (method && method.startsWith('bound ')) {
    method = method.slice('bound '.length);
  }

  if (ctor && ctor !== 'Function' && ctor !== 'Object') {
    if (method && method !== 'constructor' && method !== 'anonymous') {
      if (method === 'use' || method === 'handle' || method === 'handleRequest') {
        return ctor;
      }
      return `${ctor}.${method}`;
    }
    return ctor;
  }

  if (method && method !== 'anonymous') {
    return method;
  }

  const str = Function.prototype.toString.call(handler);
  const match =
    str.match(/^async\s+function\s+(\w+)/) ||
    str.match(/^function\s+(\w+)/) ||
    str.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\()/);
  if (match) return match[1];

  return 'anonymous';
}

module.exports = {
  patchExpressGlobally,
  patchExpressApp,
  wrapHandler,
};
