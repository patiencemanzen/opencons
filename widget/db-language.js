'use strict';

const DB_ACTION_ICONS = {
  select: '↗',
  insert: '↳',
  update: '✎',
  delete: '✕',
  count: '#',
  transaction: '⟳',
  query: '◎',
};

/**
 * @param {object} node
 */
function dbActionIcon(node) {
  return DB_ACTION_ICONS[node.db_action] || '◎';
}

/**
 * @param {object} node
 */
function dbNodeTitle(node) {
  if (node.label && !node.label.includes('drizzle') && !node.label.includes('pg ')) {
    return node.label;
  }

  const action = node.db_action || 'query';
  const table = node.collection || 'records';
  const name = String(table).replace(/_/g, ' ').toLowerCase();

  switch (action) {
    case 'select':
      return `Fetch ${name}`;
    case 'insert':
      return `Save ${name}`;
    case 'update':
      return `Update ${name}`;
    case 'delete':
      return `Delete ${name}`;
    case 'count':
      return `Count ${name}`;
    default:
      return node.label || 'Database query';
  }
}

/**
 * @param {object} node
 */
function dbNodeIntent(node) {
  if (node.db_intent) return node.db_intent;

  const action = node.db_action || 'query';
  const table = node.collection || 'records';
  const name = String(table).replace(/_/g, ' ').toLowerCase();

  switch (action) {
    case 'select':
      return `Fetching ${name}`;
    case 'insert':
      return `Saving to ${name}`;
    case 'update':
      return `Updating ${name}`;
    case 'delete':
      return `Removing from ${name}`;
    default:
      return 'Running a database query';
  }
}

/**
 * @param {object} node
 */
function dbNodeResult(node) {
  if (node.db_result) return node.db_result;
  if (node.summary) return node.summary.replace(/\s·\s[\d.]+ms$/, '');
  if (node.exit_reason) return `Failed — ${node.exit_reason}`;
  if (node.rows === 0) return 'No rows';
  if (node.rows === 1) return '1 row';
  if (node.rows != null) return `${node.rows} rows`;
  return 'Completed';
}

window.RouteGrapherDbLanguage = {
  dbActionIcon,
  dbNodeTitle,
  dbNodeIntent,
  dbNodeResult,
};
