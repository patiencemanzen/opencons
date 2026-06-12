'use strict';

const { ConfigurationError } = require('./errors');

/** @typedef {import('../core/tracer').TraceGraph} TraceGraph */

/**
 * @typedef {Object} RouteGrapherOptions
 * @property {number} port
 * @property {boolean | undefined} enabled
 * @property {boolean} enableWidget
 * @property {string[]} exclude
 * @property {boolean} captureBody
 * @property {boolean} captureResponse
 * @property {number} maxTraces
 * @property {Record<'mongoose' | 'drizzle' | 'pg' | 'prisma' | 'mysql2', boolean>} drivers
 * @property {{ enabled: boolean, projectRoot: string | undefined, exclude: string[] }} transform
 * @property {number} [widgetPort]
 */

const DEFAULT_OPTIONS = {
  port: 7331,
  enabled: undefined,
  enableWidget: true,
  exclude: [],
  captureBody: false,
  captureResponse: false,
  maxTraces: 100,
  drivers: {
    mongoose: true,
    drizzle: true,
    pg: true,
    prisma: true,
    mysql2: true,
  },
  transform: {
    enabled: false,
    projectRoot: undefined,
    exclude: [],
  },
};

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function requirePositiveInt(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ConfigurationError(`${field} must be a positive integer`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string[]}
 */
function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ConfigurationError(`${field} must be an array of strings`);
  }
  return value;
}

/**
 * Merge user options with defaults and validate types.
 *
 * @param {Partial<RouteGrapherOptions>} [userOptions]
 * @returns {RouteGrapherOptions}
 */
function resolveOptions(userOptions = {}) {
  const options = {
    ...DEFAULT_OPTIONS,
    ...userOptions,
    drivers: {
      ...DEFAULT_OPTIONS.drivers,
      ...(userOptions.drivers || {}),
    },
    transform: {
      ...DEFAULT_OPTIONS.transform,
      ...(userOptions.transform || {}),
    },
  };

  options.port = requirePositiveInt(options.port, 'port');
  options.maxTraces = requirePositiveInt(options.maxTraces, 'maxTraces');
  options.exclude = requireStringArray(options.exclude, 'exclude');
  options.transform.exclude = requireStringArray(options.transform.exclude, 'transform.exclude');

  if (typeof options.enableWidget !== 'boolean') {
    throw new ConfigurationError('enableWidget must be a boolean');
  }

  if (typeof options.captureBody !== 'boolean') {
    throw new ConfigurationError('captureBody must be a boolean');
  }

  if (typeof options.captureResponse !== 'boolean') {
    throw new ConfigurationError('captureResponse must be a boolean');
  }

  if (options.enabled !== undefined && typeof options.enabled !== 'boolean') {
    throw new ConfigurationError('enabled must be a boolean when provided');
  }

  for (const [driver, enabled] of Object.entries(options.drivers)) {
    if (typeof enabled !== 'boolean') {
      throw new ConfigurationError(`drivers.${driver} must be a boolean`);
    }
  }

  if (typeof options.transform.enabled !== 'boolean') {
    throw new ConfigurationError('transform.enabled must be a boolean');
  }

  if (
    options.transform.projectRoot !== undefined &&
    typeof options.transform.projectRoot !== 'string'
  ) {
    throw new ConfigurationError('transform.projectRoot must be a string when provided');
  }

  return options;
}

/**
 * @returns {boolean}
 */
function isProductionDisabled(options) {
  return process.env.NODE_ENV === 'production' && options.enabled !== true;
}

module.exports = {
  DEFAULT_OPTIONS,
  resolveOptions,
  isProductionDisabled,
};
