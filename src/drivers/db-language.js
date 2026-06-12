'use strict';

/**
 * @param {string} sql
 */
function extractTableFromSql(sql) {
  const text = String(sql || '').replace(/\s+/g, ' ').trim();

  const patterns = [
    /\bfrom\s+["'`]?([a-zA-Z_][\w$]*)/i,
    /\binto\s+["'`]?([a-zA-Z_][\w$]*)/i,
    /\bupdate\s+["'`]?([a-zA-Z_][\w$]*)/i,
    /\bjoin\s+["'`]?([a-zA-Z_][\w$]*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return undefined;
}

/**
 * @param {string | undefined} name
 */
function humanizeName(name) {
  if (!name) return 'records';

  return String(name)
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/**
 * @param {object} meta
 * @param {string} [meta.driver]
 * @param {string} [meta.operation]
 * @param {string} [meta.query]
 */
function inferDbAction(meta) {
  const operation = String(meta.operation || '').toLowerCase();
  const query = String(meta.query || '').trim();
  const sql = query.toUpperCase();

  if (meta.driver === 'prisma') {
    if (/^find|aggregate|groupby/i.test(operation)) return 'select';
    if (/^create/i.test(operation)) return 'insert';
    if (/^update|upsert/i.test(operation)) return 'update';
    if (/^delete/i.test(operation)) return 'delete';
    if (operation === 'count') return 'count';
    if (operation === 'queryRaw' || operation === 'executeRaw') return 'query';
    return 'query';
  }

  if (meta.driver === 'mongoose') {
    if (/find|distinct|count/i.test(operation)) return operation.includes('count') ? 'count' : 'select';
    if (/insert|save|create/i.test(operation)) return 'insert';
    if (/update|replace/i.test(operation)) return 'update';
    if (/delete|remove/i.test(operation)) return 'delete';
    return 'query';
  }

  if (sql.startsWith('SELECT') || sql.startsWith('WITH')) return 'select';
  if (sql.startsWith('INSERT')) return 'insert';
  if (sql.startsWith('UPDATE')) return 'update';
  if (sql.startsWith('DELETE')) return 'delete';
  if (/\bCOUNT\s*\(/i.test(sql)) return 'count';
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(sql)) return 'transaction';

  return 'query';
}

/**
 * @param {'select' | 'insert' | 'update' | 'delete' | 'count' | 'transaction' | 'query'} action
 * @param {string | undefined} table
 */
function describeDbIntent(action, table) {
  const target = humanizeName(table);

  switch (action) {
    case 'select':
      return `Fetching ${target}`;
    case 'insert':
      return `Saving to ${target}`;
    case 'update':
      return `Updating ${target}`;
    case 'delete':
      return `Removing from ${target}`;
    case 'count':
      return `Counting ${target}`;
    case 'transaction':
      return 'Running a database transaction';
    default:
      return table ? `Querying ${target}` : 'Running a database query';
  }
}

/**
 * @param {'select' | 'insert' | 'update' | 'delete' | 'count' | 'transaction' | 'query'} action
 * @param {number | undefined} rows
 * @param {string | undefined} error
 */
function describeDbResult(action, rows, error) {
  if (error) {
    const short = error.length > 72 ? `${error.slice(0, 72)}…` : error;
    return `Failed — ${short}`;
  }

  switch (action) {
    case 'select':
      if (rows === 0) return 'Nothing found';
      if (rows === 1) return 'Returned 1 record';
      if (rows != null) return `Returned ${rows} records`;
      return 'Lookup finished';
    case 'insert':
      if (rows === 1) return 'Submitted 1 new row';
      if (rows != null && rows > 1) return `Submitted ${rows} new rows`;
      return 'Save completed';
    case 'update':
      if (rows === 0) return 'No rows changed';
      if (rows === 1) return 'Updated 1 row';
      if (rows != null) return `Updated ${rows} rows`;
      return 'Update completed';
    case 'delete':
      if (rows === 0) return 'Nothing removed';
      if (rows === 1) return 'Removed 1 row';
      if (rows != null) return `Removed ${rows} rows`;
      return 'Delete completed';
    case 'count':
      if (rows != null) return `Count is ${rows}`;
      return 'Count completed';
    case 'transaction':
      return 'Transaction step completed';
    default:
      if (rows === 0) return 'No rows affected';
      if (rows === 1) return '1 row affected';
      if (rows != null) return `${rows} rows affected`;
      return 'Query completed';
  }
}

/**
 * @param {'select' | 'insert' | 'update' | 'delete' | 'count' | 'transaction' | 'query'} action
 * @param {string | undefined} table
 */
function describeDbLabel(action, table) {
  const target = humanizeName(table);

  switch (action) {
    case 'select':
      return `Fetch ${target}`;
    case 'insert':
      return `Save ${target}`;
    case 'update':
      return `Update ${target}`;
    case 'delete':
      return `Delete ${target}`;
    case 'count':
      return `Count ${target}`;
    case 'transaction':
      return 'Transaction';
    default:
      return table ? `Query ${target}` : 'Database query';
  }
}

/**
 * @param {object} meta
 * @param {string} [meta.driver]
 * @param {string} [meta.operation]
 * @param {string} [meta.query]
 * @param {string} [meta.collection]
 * @param {number} [meta.rows]
 * @param {number} [meta.duration_ms]
 * @param {string} [meta.error]
 */
function buildDbNodeLanguage(meta) {
  const action = inferDbAction(meta);
  const table = meta.collection || extractTableFromSql(meta.query);
  const intent = describeDbIntent(action, table);
  const result = describeDbResult(action, meta.rows, meta.error);
  const label = describeDbLabel(action, table);
  const summary = meta.error
    ? result
    : `${result}${meta.duration_ms != null ? ` · ${meta.duration_ms}ms` : ''}`;

  return {
    label,
    summary,
    db_action: action,
    db_intent: intent,
    db_result: result,
  };
}

module.exports = {
  extractTableFromSql,
  humanizeName,
  inferDbAction,
  describeDbIntent,
  describeDbResult,
  describeDbLabel,
  buildDbNodeLanguage,
};
