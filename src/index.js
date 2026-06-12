'use strict';

/**
 * RouteGrapher public entry point.
 *
 * Import-time side effects are intentional:
 * - Express prototype patching so handlers registered after setup are wrapped
 * - Optional AST require hook when ROUTEGRAPHER_TRANSFORM is set
 *
 * Require this module before express() and call routegrapher() as the first middleware.
 */

const { createRouteGrapher } = require('./core');
const { patchExpressGlobally } = require('./interceptors/express');
const { applyToNest, createNestMiddleware } = require('./integrations/nest');
const { label } = require('./utils/label');

require('./transform/register');
patchExpressGlobally();

const routegrapher = createRouteGrapher;

routegrapher.applyToNest = applyToNest;
routegrapher.createNestMiddleware = createNestMiddleware;
routegrapher.label = label;

module.exports = routegrapher;
module.exports.default = routegrapher;
