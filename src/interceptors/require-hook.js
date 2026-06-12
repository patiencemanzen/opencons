'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { transformSource } = require('../transform/ast');
const sourceCache = require('../store/source-cache');

const OPENCONS_PKG = path.normalize(path.join(__dirname, '..', '..'));

/** @type {boolean} */
let hookInstalled = false;

/** @type {((filename: string) => boolean) | null} */
let shouldTransformFile = null;

/**
 * @param {object} options
 * @param {string[]} [options.exclude]
 * @param {string} [options.projectRoot]
 */
function installRequireHook(options = {}) {
  if (hookInstalled) return;
  hookInstalled = true;

  const projectRoot = options.projectRoot || process.cwd();
  sourceCache.setProjectRoot(projectRoot);

  shouldTransformFile = createFilter(projectRoot, options.exclude || []);

  const originalJsHandler = Module._extensions['.js'];

  Module._extensions['.js'] = function OpenconsJsExtension(module, filename) {
    if (!shouldTransformFile(filename)) {
      return originalJsHandler(module, filename);
    }

    let source;

    try {
      source = fs.readFileSync(filename, 'utf8');
    } catch (err) {
      return originalJsHandler(module, filename);
    }

    sourceCache.storeOriginal(filename);

    const result = transformSource(source, filename, { projectRoot });

    if (result.skipped) {
      sourceCache.store(filename, source, null);
      return module._compile(source, filename);
    }

    sourceCache.store(filename, source, result.map);

    return module._compile(result.code, filename);
  };

  const { logger } = require('../lib/logger');
  logger.info('Source transform hook installed (CommonJS .js)');
}

/**
 * @param {string} projectRoot
 * @param {string[]} excludePatterns
 */
function createFilter(projectRoot, excludePatterns) {
  const normalizedRoot = path.normalize(projectRoot);

  return function filter(filename) {
    const normalized = path.normalize(filename);

    if (normalized.includes(`${path.sep}node_modules${path.sep}`)) {
      return false;
    }

    if (normalized.startsWith(OPENCONS_PKG)) {
      return false;
    }

    if (!normalized.startsWith(normalizedRoot)) {
      return false;
    }

    if (!normalized.endsWith('.js')) {
      return false;
    }

    const relative = path.relative(normalizedRoot, normalized);

    return !excludePatterns.some((pattern) => matchGlob(relative, pattern));
  };
}

/**
 * @param {string} value
 * @param {string} pattern
 */
function matchGlob(value, pattern) {
  const regex = new RegExp(
    `^${pattern.replace(/\*/g, '.*').replace(/\//g, '[\\\\/]').replace(/\\/g, '\\\\')}$`
  );
  return regex.test(value);
}

module.exports = {
  installRequireHook,
};
