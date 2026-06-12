'use strict';

const path = require('path');
const { installRequireHook } = require('../interceptors/require-hook');

/**
 * Install the require hook immediately. Import this module BEFORE your
 * application modules load:
 *
 *   require('routegrapher/register-transform');
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot]
 * @param {string[]} [options.exclude]
 */
function registerTransform(options = {}) {
  installRequireHook({
    projectRoot: options.projectRoot || process.env.ROUTEGRAPHER_ROOT || process.cwd(),
    exclude: options.exclude || splitEnvList(process.env.ROUTEGRAPHER_TRANSFORM_EXCLUDE),
  });
}

/**
 * @param {string | undefined} value
 */
function splitEnvList(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

if (process.env.ROUTEGRAPHER_TRANSFORM === '1' || process.env.ROUTEGRAPHER_TRANSFORM === 'true') {
  registerTransform();
}

module.exports = registerTransform;
