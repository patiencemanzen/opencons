'use strict';

const { createRequire } = require('module');
const path = require('path');
const { runWithContext } = require('../core/context');

/** @type {{ rxjs: typeof import('rxjs') } | null} */
let cachedRxjs = null;

/**
 * Load rxjs from the host application (Nest consumer), not from routegrapher.
 */
function loadRxjs() {
  if (cachedRxjs) return cachedRxjs;

  const searchPaths = [
    process.cwd(),
    ...(require.main?.paths || []),
    path.join(process.cwd(), 'node_modules'),
  ];

  const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));

  for (const base of searchPaths) {
    try {
      const rxjsPath = hostRequire.resolve('rxjs', { paths: [base] });
      cachedRxjs = { rxjs: hostRequire(rxjsPath) };
      return cachedRxjs;
    } catch {
      // try next base
    }
  }

  try {
    cachedRxjs = { rxjs: require('rxjs') };
    return cachedRxjs;
  } catch {
    return null;
  }
}

/**
 * Wrap a Nest/RxJS observable and record when the stream completes.
 *
 * @param {unknown} source
 * @param {(exitReason?: string) => void} onFinish
 * @param {import('../core/context').TraceContext} [alsContext]
 * @returns {unknown}
 */
function traceObservable(source, onFinish, alsContext) {
  const finish = (reason) => {
    if (alsContext) {
      runWithContext(alsContext, () => onFinish(reason));
      return;
    }
    onFinish(reason);
  };

  if (!source || typeof source.subscribe !== 'function') {
    finish();
    return source;
  }

  const loaded = loadRxjs();

  if (!loaded?.rxjs?.Observable) {
    return source;
  }

  const { Observable } = loaded.rxjs;

  return new Observable((subscriber) => {
    let innerSub;

    try {
      innerSub = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (err) => {
          finish(`error: ${err.message}`);
          subscriber.error(err);
        },
        complete: () => {
          finish();
          subscriber.complete();
        },
      });
    } catch (err) {
      finish(`error: ${err.message}`);
      subscriber.error(err);
    }

    return () => {
      if (innerSub && typeof innerSub.unsubscribe === 'function') {
        innerSub.unsubscribe();
      }
    };
  });
}

module.exports = {
  traceObservable,
  loadRxjs,
};
