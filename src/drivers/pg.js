'use strict';

const { traceDbCall, truncateQuery } = require('./record');

let patched = false;

/**
 * @param {unknown[]} args
 */
function parsePgQueryArgs(args) {
  if (!args.length) return { text: '', values: undefined };

  if (typeof args[0] === 'string') {
    return {
      text: args[0],
      values: args[1],
    };
  }

  if (typeof args[0] === 'object' && args[0]) {
    return {
      text: args[0].text || args[0].name || '',
      values: args[0].values,
    };
  }

  return { text: '', values: undefined };
}

/**
 * @param {Function} original
 */
function wrapQuery(original) {
  return function OpenconsPgQuery(...args) {
    const { text, values } = parsePgQueryArgs(args);
    const start = performance.now();
    const lastArg = args[args.length - 1];

    if (typeof lastArg === 'function') {
      const callback = lastArg;
      const wrappedArgs = args.slice(0, -1);

      wrappedArgs.push((err, result) => {
        const { recordDbQuery } = require('./record');

        if (err) {
          recordDbQuery({
            driver: 'pg',
            operation: 'query',
            query: truncateQuery(text),
            params: values,
            duration_ms: Math.round((performance.now() - start) * 10) / 10,
            error: err.message,
          });
        } else {
          recordDbQuery({
            driver: 'pg',
            operation: 'query',
            query: truncateQuery(text),
            params: values,
            rows: result?.rowCount,
            duration_ms: Math.round((performance.now() - start) * 10) / 10,
          });
        }

        callback(err, result);
      });

      return original.apply(this, wrappedArgs);
    }

    const result = original.apply(this, args);

    if (result && typeof result.then === 'function') {
      return traceDbCall(() => result, {
        driver: 'pg',
        operation: 'query',
        query: truncateQuery(text),
        params: values,
      });
    }

    return result;
  };
}

/**
 * @param {object} client
 */
function patchPgClientPrototype(client) {
  if (!client?.prototype?.query || client.prototype.query.__openconsWrapped) {
    return;
  }

  const original = client.prototype.query;
  client.prototype.query = wrapQuery(original);
  client.prototype.query.__openconsWrapped = true;
}

function patchPg() {
  if (patched) return false;

  let pg;

  try {
    const { createRequire } = require('module');
    const path = require('path');
    const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));
    pg = hostRequire('pg');
  } catch {
    try {
      pg = require('pg');
    } catch {
      return false;
    }
  }

  patchPgClientPrototype(pg.Client);

  if (pg.Pool?.prototype) {
    patchPgClientPrototype(pg.Pool);
  }

  patched = true;
  return true;
}

module.exports = {
  patchPg,
};
