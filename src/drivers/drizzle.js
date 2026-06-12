'use strict';

const { traceDbCall, truncateQuery } = require('./record');
const { extractTableFromSql } = require('./db-language');

let patched = false;

/**
 * @param {Function} original
 * @param {'node-postgres' | 'mysql2'} dialect
 */
function wrapExecute(original, dialect) {
  return async function routegrapherDrizzleExecute(placeholderValues = {}) {
    const queryText =
      this.rawQueryConfig?.text ||
      this.rawQuery?.sql ||
      this.query?.sql ||
      this.queryString ||
      '';

    return traceDbCall(() => original.call(this, placeholderValues), {
      driver: 'drizzle',
      operation: dialect === 'mysql2' ? 'execute' : 'query',
      query: truncateQuery(queryText),
      params: this.params,
      collection: extractTableFromSql(queryText),
    });
  };
}

/**
 * @param {string} modulePath
 * @param {string} className
 * @param {'node-postgres' | 'mysql2'} dialect
 */
function patchPreparedQuery(modulePath, className, dialect) {
  let session;

  try {
    const { createRequire } = require('module');
    const path = require('path');
    const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));
    session = hostRequire(modulePath);
  } catch {
    try {
      session = require(modulePath);
    } catch {
      return false;
    }
  }

  const PreparedQuery = session[className];

  if (!PreparedQuery?.prototype?.execute || PreparedQuery.prototype.execute.__routegrapherWrapped) {
    return false;
  }

  const original = PreparedQuery.prototype.execute;
  PreparedQuery.prototype.execute = wrapExecute(original, dialect);
  PreparedQuery.prototype.execute.__routegrapherWrapped = true;

  return true;
}

function patchDrizzle() {
  if (patched) return [];

  const backends = [];

  if (patchPreparedQuery('drizzle-orm/node-postgres/session', 'NodePgPreparedQuery', 'node-postgres')) {
    backends.push('node-postgres');
  }

  if (patchPreparedQuery('drizzle-orm/mysql2/session', 'MySql2PreparedQuery', 'mysql2')) {
    backends.push('mysql2');
  }

  if (backends.length) {
    patched = true;
  }

  return backends;
}

module.exports = {
  patchDrizzle,
};
