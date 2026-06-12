'use strict';

/**
 * Opencons public entry point.
 *
 * Import-time side effects are intentional:
 * - Express prototype patching so handlers registered after setup are wrapped
 * - Optional AST require hook when OPENCONS_TRANSFORM is set
 *
 * Require this module before express() and call opencons() as the first middleware.
 */

const { createOpencons } = require('./core');
const { patchExpressGlobally } = require('./interceptors/express');
const { applyToNest, createNestMiddleware } = require('./integrations/nest');
const { label } = require('./utils/label');

require('./transform/register');
patchExpressGlobally();

const opencons = createOpencons;

opencons.applyToNest = applyToNest;
opencons.createNestMiddleware = createNestMiddleware;
opencons.label = label;

module.exports = opencons;
module.exports.default = opencons;
