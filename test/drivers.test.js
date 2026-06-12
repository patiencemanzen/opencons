'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runWithContext } = require('../src/core/context');
const { TraceTracer } = require('../src/core/tracer');
const { recordDbQuery } = require('../src/drivers/record');
const { resolveDriverConfig } = require('../src/drivers/detect');
const { patchPg } = require('../src/drivers/pg');
const { patchDrizzle } = require('../src/drivers/drizzle');
const { extractTableFromSql } = require('../src/drivers/db-language');

describe('database capture', () => {
  it('records parallel db nodes from the active scope', () => {
    const tracer = new TraceTracer({ method: 'POST', url: '/items' });
    const context = { id: tracer.id, startTime: tracer.startTime, tracer };

    runWithContext(context, () => {
      const controller = tracer.addNode({
        type: 'controller',
        label: 'ItemsController.create',
        duration_ms: 1,
      });
      context.scopeNodeId = controller.id;

      recordDbQuery({
        driver: 'pg',
        operation: 'query',
        query: 'INSERT INTO categories (name) VALUES ($1)',
        params: ['Beverages'],
        rows: 1,
        duration_ms: 4.2,
      });
    });

    const dbNode = tracer.nodes.find((node) => node.type === 'db');
    assert.ok(dbNode);
    assert.equal(dbNode.driver, 'pg');
    assert.equal(dbNode.label, 'Save categories');
    assert.equal(dbNode.db_intent, 'Saving to categories');
    assert.match(dbNode.query, /INSERT INTO categories/);
    assert.deepEqual(dbNode.params, ['Beverages']);
    assert.equal(dbNode.rows, 1);

    const controllerNode = tracer.nodes.find((node) => node.type === 'controller');
    const forkEdge = tracer.edges.find((edge) => edge.parallel && edge.to === dbNode.id);
    assert.ok(forkEdge);
    assert.equal(forkEdge.from, controllerNode.id);
  });

  it('resolves driver config from opt-out flags', () => {
    const resolved = resolveDriverConfig({
      pg: false,
      mongoose: false,
      prisma: false,
      mysql2: false,
      drizzle: false,
    });
    assert.equal(resolved.pg, false);
    assert.equal(resolved.mongoose, false);
    assert.equal(resolved.prisma, false);
    assert.equal(resolved.mysql2, false);
    assert.equal(resolved.drizzle, false);
  });

  it('prefers drizzle over raw pg when drizzle-orm is installed', () => {
    let hasDrizzle = false;

    try {
      require.resolve('drizzle-orm/node-postgres/session');
      hasDrizzle = true;
    } catch {
      // optional dependency
    }

    if (!hasDrizzle) return;

    const resolved = resolveDriverConfig({});
    assert.equal(resolved.drizzle, true);
    assert.equal(resolved.pg, false);
  });

  it('extracts table names from SQL', () => {
    assert.equal(extractTableFromSql('select * from categories where id = $1'), 'categories');
    assert.equal(extractTableFromSql('INSERT INTO "items" (name) VALUES ($1)'), 'items');
  });

  it('patches drizzle node-postgres when drizzle-orm is available', () => {
    let session;

    try {
      session = require('drizzle-orm/node-postgres/session');
    } catch {
      return;
    }

    const original = session.NodePgPreparedQuery.prototype.execute;
    const backends = patchDrizzle();
    assert.ok(backends.includes('node-postgres'));
    assert.notEqual(session.NodePgPreparedQuery.prototype.execute, original);
    assert.equal(session.NodePgPreparedQuery.prototype.execute.__routegrapherWrapped, true);
  });

  it('patches pg query when pg is available', () => {
    let pg;

    try {
      pg = require('pg');
    } catch {
      return;
    }

    const { Client } = pg;
    const original = Client.prototype.query;
    const patched = patchPg();
    assert.equal(patched, true);
    assert.notEqual(Client.prototype.query, original);
    assert.equal(Client.prototype.query.__routegrapherWrapped, true);
  });
});
