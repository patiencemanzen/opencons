'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  phraseCondition,
  decisionTitle,
  decisionSummary,
} = require('../src/transform/natural-language');

describe('natural language branch labels', () => {
  it('phrases common operators readably', () => {
    assert.match(phraseCondition('user.role === "admin"'), /equals/);
    assert.match(phraseCondition('a && b'), /and/);
  });

  it('builds decision titles from conditions', () => {
    assert.equal(
      decisionTitle('if', 'user.isActive'),
      'Checked whether user.isActive'
    );
  });

  it('summarizes taken and skipped branches', () => {
    assert.equal(decisionSummary('if', true, true), 'Yes — code inside the then branch ran');
    assert.equal(decisionSummary('if', false, false), 'No — then branch skipped');
  });
});
