'use strict';

const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const PROBE_MODULE = path.join(__dirname, 'probe.js');

/**
 * @param {string} filename
 * @param {number} line
 * @param {string} kind
 * @param {string} [projectRoot]
 */
function probeLabel(filename, line, kind, projectRoot) {
  const resolved = path.resolve(filename);
  let relative = path.basename(resolved);

  if (projectRoot) {
    const fromRoot = path.relative(projectRoot, resolved).replace(/\\/g, '/');
    if (fromRoot && !fromRoot.startsWith('..') && !path.isAbsolute(fromRoot)) {
      relative = fromRoot;
    }
  }

  return `${kind}|${relative}|${line}`;
}

/**
 * @param {string} source
 * @param {import('@babel/types').Node} node
 */
function sliceFromSource(source, node) {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return source.slice(node.start, node.end).trim();
  }

  return null;
}

/**
 * @param {string} label
 * @param {import('@babel/types').Expression} expression
 * @param {string | null} conditionText
 * @param {boolean} [hasElse]
 */
function probeCall(label, expression, conditionText, hasElse = false) {
  const args = [t.stringLiteral(label), expression];

  if (conditionText) {
    args.push(t.stringLiteral(conditionText));
  }

  args.push(t.booleanLiteral(hasElse));

  return t.callExpression(t.identifier('__rg_probe'), args);
}

/**
 * @param {string} label
 */
function elseProbeStatement(label) {
  return t.expressionStatement(
    t.callExpression(t.identifier('__rg_else_probe'), [t.stringLiteral(label)])
  );
}

/**
 * @param {string} source
 * @param {string} filename
 * @param {{ projectRoot?: string }} [options]
 * @returns {{ code: string, map: object | null, skipped: boolean, reason?: string }}
 */
function transformSource(source, filename, options = {}) {
  const projectRoot = options.projectRoot;
  if (source.includes('opencons-skip') || source.includes('routegrapher-skip')) {
    return { code: source, map: null, skipped: true, reason: 'opencons-skip' };
  }

  if (isLikelyMinified(source)) {
    return { code: source, map: null, skipped: true, reason: 'minified' };
  }

  let ast;

  try {
    ast = parser.parse(source, {
      sourceType: 'script',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
      errorRecovery: true,
      ranges: true,
    });
  } catch (err) {
    return { code: source, map: null, skipped: true, reason: `parse-error: ${err.message}` };
  }

  const probeImportPath = PROBE_MODULE.replace(/\\/g, '/');

  traverse(ast, {
    Program(programPath) {
      const body = programPath.node.body;

      if (!hasProbeImport(body)) {
        body.unshift(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.objectPattern([
                t.objectProperty(t.identifier('__rg_probe'), t.identifier('__rg_probe'), false, true),
                t.objectProperty(
                  t.identifier('__rg_else_probe'),
                  t.identifier('__rg_else_probe'),
                  false,
                  true
                ),
                t.objectProperty(
                  t.identifier('__rg_catch_probe'),
                  t.identifier('__rg_catch_probe'),
                  false,
                  true
                ),
              ]),
              t.callExpression(t.identifier('require'), [t.stringLiteral(probeImportPath)])
            ),
          ])
        );
      }
    },

    IfStatement(ifPath) {
      const line = ifPath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'if', projectRoot);
      const test = ifPath.node.test;
      const conditionText = sliceFromSource(source, test);
      const hasElse = Boolean(ifPath.node.alternate);
      ifPath.node.test = probeCall(label, test, conditionText, hasElse);

      if (ifPath.node.alternate) {
        if (t.isBlockStatement(ifPath.node.alternate)) {
          ifPath.node.alternate.body.unshift(elseProbeStatement(label));
        } else {
          ifPath.node.alternate = t.blockStatement([
            elseProbeStatement(label),
            t.isStatement(ifPath.node.alternate)
              ? ifPath.node.alternate
              : t.expressionStatement(ifPath.node.alternate),
          ]);
        }
      }
    },

    ConditionalExpression(condPath) {
      const line = condPath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'ternary', projectRoot);
      const test = condPath.node.test;
      condPath.node.test = probeCall(label, test, sliceFromSource(source, test), true);
    },

    SwitchStatement(switchPath) {
      const line = switchPath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'switch', projectRoot);
      const discriminant = switchPath.node.discriminant;
      switchPath.node.discriminant = probeCall(
        label,
        discriminant,
        sliceFromSource(source, discriminant),
        false
      );
    },

    WhileStatement(whilePath) {
      const line = whilePath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'while', projectRoot);
      const test = whilePath.node.test;
      whilePath.node.test = probeCall(label, test, sliceFromSource(source, test), false);
    },

    DoWhileStatement(doWhilePath) {
      const line = doWhilePath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'while', projectRoot);
      const test = doWhilePath.node.test;
      doWhilePath.node.test = probeCall(label, test, sliceFromSource(source, test), false);
    },

    ForStatement(forPath) {
      if (!forPath.node.test) return;
      const line = forPath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'for', projectRoot);
      const test = forPath.node.test;
      forPath.node.test = probeCall(label, test, sliceFromSource(source, test), false);
    },

    CatchClause(catchPath) {
      const line = catchPath.node.loc?.start.line || 0;
      const label = probeLabel(filename, line, 'catch', projectRoot);
      const paramName = t.isIdentifier(catchPath.node.param)
        ? catchPath.node.param.name
        : 'err';

      catchPath.node.body.body.unshift(
        t.expressionStatement(
          t.callExpression(t.identifier('__rg_catch_probe'), [
            t.stringLiteral(label),
            t.identifier(paramName),
          ])
        )
      );
    },
  });

  const output = generate(ast, {
    sourceMaps: true,
    sourceFileName: filename,
  }, source);

  return {
    code: output.code,
    map: output.map,
    skipped: false,
  };
}

/**
 * @param {import('@babel/types').Statement[]} body
 */
function hasProbeImport(body) {
  return body.some(
    (stmt) =>
      t.isVariableDeclaration(stmt) &&
      stmt.declarations.some(
        (decl) =>
          t.isObjectPattern(decl.id) &&
          decl.id.properties.some(
            (prop) => t.isObjectProperty(prop) && t.isIdentifier(prop.key, { name: '__rg_probe' })
          )
      )
  );
}

/**
 * @param {string} source
 */
function isLikelyMinified(source) {
  const lines = source.split('\n');
  if (lines.length < 3 && source.length > 500) return true;

  const avgLine = source.length / Math.max(lines.length, 1);
  return avgLine > 300;
}

module.exports = {
  transformSource,
  probeLabel,
};
