'use strict';

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

const LEVELS = /** @type {const} */ ({ debug: 0, info: 1, warn: 2, error: 3 });

/** @type {LogLevel} */
const logLevel = process.env.OPENCONS_LOG_LEVEL || process.env.ROUTEGRAPHER_LOG_LEVEL;
let minLevel = logLevel === 'debug' ? 'debug' : 'info';

const PREFIX = '[Opencons]';

/**
 * @param {LogLevel} level
 * @param {string} message
 * @param {unknown} [detail]
 */
function write(level, message, detail) {
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const line = `${PREFIX} ${message}`;
  const sink =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (detail !== undefined) {
    sink(line, detail);
    return;
  }

  sink(line);
}

const logger = {
  /**
   * @param {LogLevel} level
   */
  setLevel(level) {
    if (level in LEVELS) {
      minLevel = level;
    }
  },

  /** @returns {LogLevel} */
  getLevel() {
    return minLevel;
  },

  /** @param {string} message @param {unknown} [detail] */
  debug(message, detail) {
    write('debug', message, detail);
  },

  /** @param {string} message @param {unknown} [detail] */
  info(message, detail) {
    write('info', message, detail);
  },

  /** @param {string} message @param {unknown} [detail] */
  warn(message, detail) {
    write('warn', message, detail);
  },

  /** @param {string} message @param {unknown} [detail] */
  error(message, detail) {
    write('error', message, detail);
  },
};

module.exports = { logger };
