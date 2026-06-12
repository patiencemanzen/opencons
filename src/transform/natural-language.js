'use strict';

/**
 * @param {string | null | undefined} expr
 */
function phraseCondition(expr) {
  if (!expr) return null;

  return expr
    .replace(/\s+/g, ' ')
    .replace(/===/g, ' equals ')
    .replace(/!==/g, ' does not equal ')
    .replace(/==/g, ' equals ')
    .replace(/!=/g, ' does not equal ')
    .replace(/<=/g, ' is at most ')
    .replace(/>=/g, ' is at least ')
    .replace(/</g, ' is less than ')
    .replace(/>/g, ' is greater than ')
    .replace(/&&/g, ' and ')
    .replace(/\|\|/g, ' or ')
    .replace(/\b!/g, 'not ')
    .trim();
}

/**
 * @param {string} kind
 * @param {string | null} condition
 */
function decisionTitle(kind, condition) {
  const phrase = phraseCondition(condition);

  if (kind === 'if' || kind === 'ternary') {
    return phrase ? `Checked whether ${phrase}` : 'Checked an if condition';
  }

  if (kind === 'switch') {
    return phrase ? `Switched on ${phrase}` : 'Evaluated a switch';
  }

  if (kind === 'while' || kind === 'for') {
    return phrase ? `Loop condition: ${phrase}` : 'Evaluated a loop condition';
  }

  if (kind === 'catch') {
    return 'Entered a catch block';
  }

  return phrase ? `Evaluated ${phrase}` : 'Evaluated a condition';
}

/**
 * @param {string} kind
 * @param {unknown} value
 * @param {boolean} hasElse
 */
function buildIfOutcomes(value, hasElse) {
  const truthy = Boolean(value);

  const outcomes = [
    {
      key: 'then',
      label: truthy ? 'Then block — ran' : 'Then block — skipped',
      taken: truthy,
    },
  ];

  if (hasElse) {
    outcomes.push({
      key: 'else',
      label: truthy ? 'Else block — skipped' : 'Else block — pending',
      taken: false,
    });
  }

  return outcomes;
}

/**
 * @param {string} kind
 * @param {unknown} value
 * @param {boolean} [hasElse]
 */
function decisionSummary(kind, value, hasElse = false) {
  const truthy = Boolean(value);

  if (kind === 'if' || kind === 'ternary') {
    if (truthy) return 'Yes — code inside the then branch ran';
    if (hasElse) return 'No — then branch skipped (else may run next)';
    return 'No — then branch skipped';
  }

  if (kind === 'switch') {
    return `Matched value ${formatValue(value)}`;
  }

  if (kind === 'while' || kind === 'for') {
    return truthy ? 'Yes — loop body will run' : 'No — loop finished';
  }

  return truthy ? 'Condition was true' : 'Condition was false';
}

/**
 * @param {unknown} value
 */
function formatValue(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * @param {object} node
 */
function applyElseTaken(node) {
  const outcomes = (node.outcomes || []).map((outcome) => {
    if (outcome.key === 'else') {
      return { ...outcome, label: 'Else block — ran', taken: true };
    }

    if (outcome.key === 'then') {
      return { ...outcome, label: 'Then block — skipped', taken: false };
    }

    return outcome;
  });

  return {
    ...node,
    outcomes,
    taken_outcome: 'else',
    summary: 'No — ran the else branch instead',
  };
}

module.exports = {
  phraseCondition,
  decisionTitle,
  buildIfOutcomes,
  decisionSummary,
  formatValue,
  applyElseTaken,
};
