'use strict';

const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');

/**
 * @param {string} packageName
 */
function isPackageInstalled(packageName) {
  const searchPaths = [
    process.cwd(),
    path.join(process.cwd(), 'node_modules'),
    ...(require.main?.paths || []),
  ];

  const hostRequire = createRequire(path.join(process.cwd(), 'package.json'));

  for (const base of searchPaths) {
    try {
      hostRequire.resolve(packageName, { paths: [base] });
      return true;
    } catch {
      // try next
    }
  }

  const localNodeModules = path.join(process.cwd(), 'node_modules', packageName);
  return fs.existsSync(localNodeModules);
}

/**
 * @param {Partial<Record<'mongoose' | 'pg' | 'prisma' | 'mysql2' | 'drizzle', boolean>>} [config]
 */
function resolveDriverConfig(config = {}) {
  const detected = {
    mongoose: isPackageInstalled('mongoose'),
    pg: isPackageInstalled('pg'),
    prisma: isPackageInstalled('@prisma/client'),
    mysql2: isPackageInstalled('mysql2'),
    drizzle: isPackageInstalled('drizzle-orm'),
  };

  const drizzle = config.drizzle !== false && detected.drizzle;

  // Drizzle uses pg/mysql2 underneath — patch at the ORM layer to avoid duplicate nodes.
  const pgExplicit = config.pg === true;
  const mysql2Explicit = config.mysql2 === true;

  return {
    mongoose: config.mongoose !== false && detected.mongoose,
    drizzle,
    pg: config.pg !== false && detected.pg && (!drizzle || pgExplicit),
    prisma: config.prisma !== false && detected.prisma,
    mysql2: config.mysql2 !== false && detected.mysql2 && (!drizzle || mysql2Explicit),
  };
}

module.exports = {
  isPackageInstalled,
  resolveDriverConfig,
};
