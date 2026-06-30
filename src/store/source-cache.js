'use strict';

const fs = require('fs');
const path = require('path');

const MAX_CACHE_ENTRIES = 500;

/** @type {Map<string, { source: string, map: object | null, filename: string }>} */
const cache = new Map();

/** @type {string | null} */
let projectRoot = null;

function evictOldestIfNeeded() {
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

/**
 * @param {string} root
 */
function setProjectRoot(root) {
  projectRoot = path.normalize(root);
}

/**
 * @param {string} filename
 * @param {string} source
 * @param {object | null} map
 */
function store(filename, source, map) {
  const key = normalizeKey(filename);
  cache.set(key, {
    filename,
    source,
    map,
  });
  evictOldestIfNeeded();
}

/**
 * @param {string} filename
 */
function storeOriginal(filename) {
  const key = normalizeKey(filename);

  if (cache.has(key)) return;

  try {
    const source = fs.readFileSync(filename, 'utf8');
    cache.set(key, { filename, source, map: null });
    evictOldestIfNeeded();
  } catch {
    // unreadable source — widget peek will return 404
  }
}

/**
 * Resolve a cache entry by project-relative path, absolute path, or basename.
 *
 * @param {string} fileKey
 */
function get(fileKey) {
  const direct = cache.get(fileKey);
  if (direct) return direct;

  const normalized = normalizeKey(fileKey);
  const byNormalized = cache.get(normalized);
  if (byNormalized) return byNormalized;

  const basename = path.basename(fileKey);
  if (basename !== normalized) {
    return cache.get(basename) || null;
  }

  return null;
}

/**
 * Prefer project-relative paths to avoid basename collisions across folders.
 *
 * @param {string} filename
 */
function normalizeKey(filename) {
  const resolved = path.resolve(filename);

  if (projectRoot) {
    const relative = path.relative(projectRoot, resolved).replace(/\\/g, '/');
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative;
    }
  }

  return path.basename(resolved);
}

/**
 * @param {string} fileKey
 * @param {number} line
 * @param {number} [contextLines]
 */
function getSnippet(fileKey, line, contextLines = 4) {
  const entry = get(fileKey);
  if (!entry) return null;

  const lines = entry.source.split('\n');
  const start = Math.max(0, line - contextLines - 1);
  const end = Math.min(lines.length, line + contextLines);

  return {
    file: entry.filename,
    line,
    startLine: start + 1,
    lines: lines.slice(start, end).map((text, index) => ({
      number: start + index + 1,
      text,
      highlight: start + index + 1 === line,
    })),
  };
}

module.exports = {
  setProjectRoot,
  store,
  storeOriginal,
  get,
  getSnippet,
  normalizeKey,
};
