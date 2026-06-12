'use strict';

/**
 * Assign a display name to a middleware/handler for RouteGrapher traces.
 *
 * @example
 * app.use(routegrapher.label('cors', corsFn));
 * app.use(routegrapher.label('bullAuth', bullAuth));
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

  handler.__routegrapherName = name;
  return handler;
}

module.exports = {
  label,
};
