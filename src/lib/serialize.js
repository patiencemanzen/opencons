'use strict';

/**
 * Deep-clone a value for trace snapshots. Falls back to a placeholder when
 * JSON serialization fails (circular refs, BigInt, etc.).
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function safeClone(value) {
  if (value === undefined || value === null) return value;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return '[unserializable]';
  }
}

module.exports = {
  safeClone,
};
