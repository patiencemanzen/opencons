'use strict';

const { getCurrentTracer, getCurrentContext, runWithContext } = require('../core/context');
const { traceObservable } = require('../utils/observable');

let nestPatched = false;

/**
 * @param {import('../core/tracer').TraceTracer | null | undefined} tracer
 * @param {string} label
 * @param {number} entered
 * @param {boolean} [calledNext]
 * @param {string} [exitReason]
 * @param {'middleware' | 'controller'} [nodeType]
 */
function recordStep(tracer, label, entered, calledNext = true, exitReason, nodeType = 'middleware') {
  if (!tracer) return;

  const duration_ms = Math.round((performance.now() - entered) * 10) / 10;

  tracer.addNode({
    type: nodeType,
    label,
    duration_ms,
    called_next: calledNext,
    exit_reason: exitReason,
  });
}

/**
 * @param {import('../core/context').TraceContext | undefined} alsContext
 * @param {import('../core/tracer').TraceTracer | null} tracer
 * @param {string} label
 * @param {number} entered
 * @param {boolean} [calledNext]
 * @param {string} [exitReason]
 * @param {'middleware' | 'controller'} [nodeType]
 */
function recordStepSafe(alsContext, tracer, label, entered, calledNext, exitReason, nodeType) {
  if (alsContext) {
    const { runWithContext } = require('../core/context');
    runWithContext(alsContext, () =>
      recordStep(tracer, label, entered, calledNext, exitReason, nodeType)
    );
    return;
  }

  recordStep(tracer, label, entered, calledNext, exitReason, nodeType);
}

/**
 * @param {object} interceptor
 */
function wrapNestInterceptor(interceptor) {
  if (!interceptor || interceptor.__openconsWrapped) {
    return interceptor;
  }

  if (typeof interceptor.intercept !== 'function') {
    return interceptor;
  }

  const name = resolveNestComponentName(interceptor, 'Interceptor');
  const original = interceptor.intercept.bind(interceptor);

  interceptor.intercept = function OpenconsIntercept(context, next) {
    const tracer = getCurrentTracer();
    const alsContext = getCurrentContext();

    if (!tracer) {
      return original(context, next);
    }

    const entered = performance.now();

    try {
      const result = original(context, next);

      return traceObservable(
        result,
        (exitReason) => {
          recordStepSafe(alsContext, tracer, name, entered, true, exitReason);
        },
        alsContext
      );
    } catch (err) {
      recordStepSafe(alsContext, tracer, name, entered, false, `error: ${err.message}`);
      throw err;
    }
  };

  interceptor.__openconsWrapped = true;
  return interceptor;
}

/**
 * @param {object} guard
 */
function wrapNestGuard(guard) {
  if (!guard || guard.__openconsWrapped) {
    return guard;
  }

  if (typeof guard.canActivate !== 'function') {
    return guard;
  }

  const name = resolveNestComponentName(guard, 'Guard');
  const original = guard.canActivate.bind(guard);

  guard.canActivate = async function OpenconsCanActivate(context) {
    const tracer = getCurrentTracer();
    const alsContext = getCurrentContext();

    if (!tracer) {
      return original(context);
    }

    const entered = performance.now();

    try {
      const allowed = await original(context);
      recordStepSafe(alsContext, tracer, name, entered, Boolean(allowed), allowed ? undefined : 'denied');
      return allowed;
    } catch (err) {
      recordStepSafe(alsContext, tracer, name, entered, false, `error: ${err.message}`);
      throw err;
    }
  };

  guard.__openconsWrapped = true;
  return guard;
}

/**
 * @param {object} component
 * @param {string} fallbackSuffix
 */
function resolveNestComponentName(component, fallbackSuffix) {
  const ctor = component.constructor?.name;
  if (ctor && ctor !== 'Object' && ctor !== 'Function') {
    return ctor;
  }
  return `Anonymous${fallbackSuffix}`;
}

/**
 * @param {import('@nestjs/common').ExecutionContext} context
 */
function resolveControllerLabel(context) {
  const className = context.getClass()?.name || 'Controller';
  const handler = context.getHandler();
  const handlerName = handler?.name || handler?.displayName || 'handler';
  return `${className}.${handlerName}`;
}

/**
 * Trace controller handlers — must run as the innermost global interceptor.
 */
class OpenconsControllerInterceptor {
  intercept(context, next) {
    const tracer = getCurrentTracer();
    const alsContext = getCurrentContext();

    if (!tracer) {
      return next.handle();
    }

    const label = resolveControllerLabel(context);
    const entered = performance.now();

    const openController = () => {
      const node = tracer.addNode({
        type: 'controller',
        label,
        duration_ms: null,
        called_next: true,
      });
      if (alsContext) {
        alsContext.scopeNodeId = node.id;
      }
      return node.id;
    };

    const controllerNodeId = alsContext
      ? runWithContext(alsContext, openController)
      : openController();

    const completeController = (calledNext, exitReason) => {
      tracer.updateNode(controllerNodeId, {
        duration_ms: Math.round((performance.now() - entered) * 10) / 10,
        called_next: calledNext,
        exit_reason: exitReason,
      });
    };

    try {
      const result = next.handle();

      return traceObservable(
        result,
        (exitReason) => {
          if (alsContext) {
            runWithContext(alsContext, () => completeController(true, exitReason));
            return;
          }
          completeController(true, exitReason);
        },
        alsContext
      );
    } catch (err) {
      if (alsContext) {
        runWithContext(alsContext, () => completeController(false, `error: ${err.message}`));
      } else {
        completeController(false, `error: ${err.message}`);
      }
      throw err;
    }
  }
}

/**
 * Patch Nest application methods so globally registered components are traced.
 */
function patchNestGlobally() {
  if (nestPatched) return;
  nestPatched = true;

  try {
    const { NestApplication } = require('@nestjs/core/nest-application');

    const originalInterceptors = NestApplication.prototype.useGlobalInterceptors;
    NestApplication.prototype.useGlobalInterceptors = function (...interceptors) {
      return originalInterceptors.call(
        this,
        ...interceptors.map((item) => wrapNestInterceptor(item))
      );
    };

    const originalGuards = NestApplication.prototype.useGlobalGuards;
    NestApplication.prototype.useGlobalGuards = function (...guards) {
      return originalGuards.call(this, ...guards.map((item) => wrapNestGuard(item)));
    };

    const originalPipes = NestApplication.prototype.useGlobalPipes;
    NestApplication.prototype.useGlobalPipes = function (...pipes) {
      return originalPipes.call(this, ...pipes.map((pipe) => wrapNestPipe(pipe)));
    };
  } catch {
    // @nestjs/core not installed — Express-only mode.
  }
}

/**
 * Register the controller interceptor last so it wraps the route handler directly.
 * @param {import('@nestjs/common').INestApplication} nestApp
 */
function attachControllerTracing(nestApp) {
  nestApp.useGlobalInterceptors(new OpenconsControllerInterceptor());
}

/**
 * @param {import('@nestjs/common').INestApplication} nestApp
 */
function deferControllerTracingUntilReady(nestApp) {
  let attached = false;

  const attach = () => {
    if (attached) return;
    attached = true;
    attachControllerTracing(nestApp);
  };

  const originalListen = nestApp.listen.bind(nestApp);
  nestApp.listen = function OpenconsListen(...args) {
    attach();
    return originalListen(...args);
  };

  if (typeof nestApp.init === 'function') {
    const originalInit = nestApp.init.bind(nestApp);
    nestApp.init = async function OpenconsInit(...args) {
      attach();
      return originalInit(...args);
    };
  }
}

/** @deprecated Use OpenconsControllerInterceptor via deferControllerTracingUntilReady */
class OpenconsNestInterceptor {
  intercept(context, next) {
    return new OpenconsControllerInterceptor().intercept(context, next);
  }
}

/**
 * @param {object} pipe
 */
function wrapNestPipe(pipe) {
  if (!pipe || pipe.__openconsWrapped) {
    return pipe;
  }

  if (typeof pipe.transform !== 'function') {
    return pipe;
  }

  const name = resolveNestComponentName(pipe, 'Pipe');
  const original = pipe.transform.bind(pipe);

  pipe.transform = function OpenconsTransform(value, metadata) {
    const tracer = getCurrentTracer();
    const alsContext = getCurrentContext();

    if (!tracer) {
      return original(value, metadata);
    }

    const entered = performance.now();

    try {
      const result = original(value, metadata);

      if (result && typeof result.then === 'function') {
        return result
          .then((resolved) => {
            recordStepSafe(alsContext, tracer, name, entered);
            return resolved;
          })
          .catch((err) => {
            recordStepSafe(alsContext, tracer, name, entered, false, `error: ${err.message}`);
            throw err;
          });
      }

      recordStepSafe(alsContext, tracer, name, entered);
      return result;
    } catch (err) {
      recordStepSafe(alsContext, tracer, name, entered, false, `error: ${err.message}`);
      throw err;
    }
  };

  pipe.__openconsWrapped = true;
  return pipe;
}

module.exports = {
  patchNestGlobally,
  wrapNestInterceptor,
  wrapNestGuard,
  wrapNestPipe,
  attachControllerTracing,
  deferControllerTracingUntilReady,
  OpenconsControllerInterceptor,
  OpenconsNestInterceptor,
};
