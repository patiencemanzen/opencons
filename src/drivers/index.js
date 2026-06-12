'use strict';

const { resolveDriverConfig } = require('./detect');
const { patchPg } = require('./pg');
const { patchMongoose } = require('./mongoose');
const { patchPrisma } = require('./prisma');
const { patchMysql2 } = require('./mysql2');
const { patchDrizzle } = require('./drizzle');

let installed = false;

/**
 * @param {Partial<Record<'mongoose' | 'pg' | 'prisma' | 'mysql2' | 'drizzle', boolean>>} [config]
 */
function installDrivers(config = {}) {
  if (installed) return { patched: [] };

  const resolved = resolveDriverConfig(config);
  const patched = [];

  if (resolved.drizzle) {
    const backends = patchDrizzle();
    if (backends.length) patched.push(`drizzle (${backends.join(', ')})`);
  }

  if (resolved.pg && patchPg()) patched.push('pg');
  if (resolved.mongoose && patchMongoose()) patched.push('mongoose');
  if (resolved.prisma && patchPrisma()) patched.push('prisma');
  if (resolved.mysql2 && patchMysql2()) patched.push('mysql2');

  installed = patched.length > 0;

  if (patched.length) {
    const { logger } = require('../lib/logger');
    logger.info(`Database drivers patched: ${patched.join(', ')}`);
  }

  return { patched, resolved };
}

module.exports = {
  installDrivers,
};
