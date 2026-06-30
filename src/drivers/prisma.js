'use strict';

const { traceDbCall, truncateQuery, safeParams } = require('./record');

/**
 * Return an accurate row count for the wide variety of Prisma result shapes.
 * @param {string} action
 * @param {unknown} result
 */
function prismaRowCount(action, result) {
  if (result == null) return 0;
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'number') return result;
  if (typeof result === 'object' && result !== null && 'count' in result) {
    return Number(result.count);
  }
  return 1;
}

/** @type {WeakSet<object>} */
const patchedClients = new WeakSet();

/**
 * @param {object} client
 */
function patchPrismaClient(client) {
  if (!client || patchedClients.has(client)) return client;

  if (typeof client.$use !== 'function') {
    return client;
  }

  client.$use(async (params, next) => {
    const query = `${params.model || 'raw'}.${params.action}`;
    const start = performance.now();

    try {
      const result = await next(params);
      const { recordDbQuery } = require('./record');

      recordDbQuery({
        driver: 'prisma',
        operation: params.action,
        collection: params.model,
        query: truncateQuery(query),
        params: safeParams(params.args),
        rows: prismaRowCount(params.action, result),
        duration_ms: Math.round((performance.now() - start) * 10) / 10,
      });

      return result;
    } catch (err) {
      const { recordDbQuery } = require('./record');

      recordDbQuery({
        driver: 'prisma',
        operation: params.action,
        collection: params.model,
        query: truncateQuery(query),
        params: safeParams(params.args),
        duration_ms: Math.round((performance.now() - start) * 10) / 10,
        error: err && err.message ? err.message : String(err),
      });

      throw err;
    }
  });

  patchedClients.add(client);
  return client;
}

let prismaModulePatched = false;

function patchPrisma() {
  if (prismaModulePatched) return false;

  let PrismaClient;

  try {
    const { createRequire } = require('module');
    const path = require('path');
    const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));
    ({ PrismaClient } = hostRequire('@prisma/client'));
  } catch {
    try {
      ({ PrismaClient } = require('@prisma/client'));
    } catch {
      return false;
    }
  }

  if (!PrismaClient?.prototype || PrismaClient.prototype.__openconsWrapped) {
    return false;
  }

  const Original = PrismaClient;

  const WrappedPrismaClient = function OpenconsPrismaClient(...args) {
    const client = new Original(...args);
    return patchPrismaClient(client);
  };

  WrappedPrismaClient.prototype = Original.prototype;
  Object.setPrototypeOf(WrappedPrismaClient, Original);
  Object.assign(WrappedPrismaClient, Original);

  try {
    const clientModule = require('@prisma/client');
    clientModule.PrismaClient = WrappedPrismaClient;
  } catch {
    // Host may load from a different path; constructor hook still helps new imports.
  }

  PrismaClient.prototype.constructor = WrappedPrismaClient;
  PrismaClient.prototype.__openconsWrapped = true;
  prismaModulePatched = true;
  return true;
}

module.exports = {
  patchPrisma,
  patchPrismaClient,
};
