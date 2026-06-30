'use strict';

const { traceDbCall, truncateQuery } = require('./record');

let patched = false;

/**
 * @param {Function} original
 * @param {string} operation
 */
function wrapMysqlMethod(original, operation) {
  return function OpenconsMysql(...args) {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
    const params = typeof args[0] === 'object' && args[0]?.sql ? args[0].values : args[1];
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;

    if (callback) {
      const start = performance.now();
      const wrapped = args.slice(0, -1);

      wrapped.push((err, result) => {
        const { recordDbQuery } = require('./record');

        if (err) {
          recordDbQuery({
            driver: 'mysql2',
            operation,
            query: truncateQuery(sql || ''),
            params,
            duration_ms: Math.round((performance.now() - start) * 10) / 10,
            error: err.message,
          });
        } else {
          recordDbQuery({
            driver: 'mysql2',
            operation,
            query: truncateQuery(sql || ''),
            params,
            rows: Array.isArray(result) ? result[0]?.affectedRows ?? result[0]?.length : result?.affectedRows,
            duration_ms: Math.round((performance.now() - start) * 10) / 10,
          });
        }

        callback(err, result);
      });

      return original.apply(this, wrapped);
    }

    const result = original.apply(this, args);

    if (result && typeof result.then === 'function') {
      return traceDbCall(() => result, {
        driver: 'mysql2',
        operation,
        query: truncateQuery(sql || ''),
        params,
        // mysql2 promise API resolves to [rows, fields]; extract rows before counting.
        rowsFromResult: (res) => {
          const rows = Array.isArray(res) ? res[0] : res;
          if (Array.isArray(rows)) return rows.length;
          if (rows != null && typeof rows.affectedRows === 'number') return rows.affectedRows;
          return undefined;
        },
      });
    }

    return result;
  };
}

/**
 * @param {object} target
 */
function patchConnectionLike(target) {
  if (!target?.prototype) return;

  if (target.prototype.query && !target.prototype.query.__openconsWrapped) {
    target.prototype.query = wrapMysqlMethod(target.prototype.query, 'query');
    target.prototype.query.__openconsWrapped = true;
  }

  if (target.prototype.execute && !target.prototype.execute.__openconsWrapped) {
    target.prototype.execute = wrapMysqlMethod(target.prototype.execute, 'execute');
    target.prototype.execute.__openconsWrapped = true;
  }
}

function patchMysql2() {
  if (patched) return false;

  let mysql2;

  try {
    const { createRequire } = require('module');
    const path = require('path');
    const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));
    mysql2 = hostRequire('mysql2');
  } catch {
    try {
      mysql2 = require('mysql2');
    } catch {
      return false;
    }
  }

  patchConnectionLike(mysql2);
  if (mysql2.createPool) {
    const originalCreatePool = mysql2.createPool.bind(mysql2);
    mysql2.createPool = function OpenconsCreatePool(...args) {
      const pool = originalCreatePool(...args);
      patchConnectionLike(pool.constructor);
      return pool;
    };
  }

  patched = true;
  return true;
}

module.exports = {
  patchMysql2,
};
