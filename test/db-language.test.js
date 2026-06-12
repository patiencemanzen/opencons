'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDbNodeLanguage,
  inferDbAction,
  extractTableFromSql,
} = require('../src/drivers/db-language');

describe('database human language', () => {
  it('describes a select query', () => {
    const language = buildDbNodeLanguage({
      driver: 'drizzle',
      operation: 'query',
      query: 'select "id", "name" from "categories" where "id" = $1',
      collection: 'categories',
      rows: 3,
      duration_ms: 4.2,
    });

    assert.equal(language.label, 'Fetch categories');
    assert.equal(language.db_intent, 'Fetching categories');
    assert.equal(language.db_result, 'Returned 3 records');
    assert.match(language.summary, /Returned 3 records · 4\.2ms/);
  });

  it('describes an insert query', () => {
    const language = buildDbNodeLanguage({
      driver: 'drizzle',
      operation: 'query',
      query: 'insert into categories (name) values ($1)',
      collection: 'categories',
      rows: 1,
      duration_ms: 2,
    });

    assert.equal(language.label, 'Save categories');
    assert.equal(language.db_intent, 'Saving to categories');
    assert.equal(language.db_result, 'Submitted 1 new row');
  });

  it('describes prisma findMany as a fetch', () => {
    const language = buildDbNodeLanguage({
      driver: 'prisma',
      operation: 'findMany',
      collection: 'Category',
      rows: 12,
      duration_ms: 8,
    });

    assert.equal(language.label, 'Fetch category');
    assert.equal(language.db_result, 'Returned 12 records');
  });

  it('describes empty select results', () => {
    const language = buildDbNodeLanguage({
      driver: 'drizzle',
      query: 'select * from items where id = $1',
      collection: 'items',
      rows: 0,
    });

    assert.equal(language.db_result, 'Nothing found');
  });

  it('extracts table names from SQL', () => {
    assert.equal(extractTableFromSql('SELECT * FROM categories'), 'categories');
    assert.equal(extractTableFromSql('INSERT INTO "items" (name) VALUES ($1)'), 'items');
  });

  it('infers update operations', () => {
    assert.equal(
      inferDbAction({ driver: 'drizzle', query: 'update categories set name = $1' }),
      'update'
    );
  });
});
