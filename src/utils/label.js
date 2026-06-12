'use strict';

/**
 * Assign a display name to a middleware/handler for Opencons traces.
 *
 * @example
 * app.use(Opencons.label('cors', corsFn));
 * app.use(Opencons.label('bullAuth', bullAuth));
 *
 * @param {string} name
 * @param {T} handler
 * @returns {T}
 * @template {Function} T
 */
function label(name, handler) {
  if (typeof handler !== 'function') {
    return handler;
  }

  handler.__openconsName = name;
  return handler;
}

module.exports = {
  label,
};
