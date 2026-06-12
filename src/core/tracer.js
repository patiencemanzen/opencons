'use strict';

const { randomBytes } = require('crypto');
const { getCurrentContext } = require('./context');

/**
 * @typedef {'request' | 'middleware' | 'controller' | 'branch' | 'loop' | 'db' | 'response' | 'error'} NodeType
 */

/**
 * @typedef {Object} TraceNode
 * @property {string} id
 * @property {NodeType} type
 * @property {string} label
 * @property {string} [summary]
 * @property {string} [condition]
 * @property {boolean} [has_else]
 * @property {{ key: string, label: string, taken: boolean }[]} [outcomes]
 * @property {string | null} [taken_outcome]
 * @property {number | null} duration_ms
 * @property {boolean} [called_next]
 * @property {string} [exit_reason]
 * @property {*} [value]
 * @property {number} [rows]
 * @property {string} [query]
 * @property {unknown} [params]
 * @property {string} [driver]
 * @property {string} [operation]
 * @property {string} [collection]
 * @property {'select' | 'insert' | 'update' | 'delete' | 'count' | 'transaction' | 'query'} [db_action]
 * @property {string} [db_intent]
 * @property {string} [db_result]
 * @property {{ file: string, line: number | null, kind?: string }} [source]
 */

/**
 * @typedef {Object} TraceEdge
 * @property {string} from
 * @property {string} to
 * @property {boolean} [parallel]
 */

/**
 * @typedef {Object} TraceGraph
 * @property {string} id
 * @property {number} timestamp
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} params
 * @property {unknown} [body]
 * @property {unknown} [response]
 * @property {number | null} status
 * @property {number} duration_ms
 * @property {'active' | 'complete'} [state]
 * @property {TraceNode[]} nodes
 * @property {TraceEdge[]} edges
 */

class TraceTracer {
  /**
   * @param {Object} meta
   * @param {string} meta.method
   * @param {string} meta.url
   * @param {Record<string, string>} [meta.params]
   * @param {unknown} [meta.body]
   */
  constructor(meta) {
    this.id = `req_${randomBytes(4).toString('hex')}`;
    this.timestamp = Date.now();
    this.method = meta.method;
    this.url = meta.url;
    this.params = meta.params || {};
    this.body = meta.body;
    this.status = null;
    this.startTime = performance.now();
    this._nodeCounter = 0;
    this._lastNodeId = null;

    const requestNode = this._createNode({
      type: 'request',
      label: `${meta.method} ${meta.url}`,
      duration_ms: null,
    });

    this.nodes = [requestNode];
    this.edges = [];
    this._lastNodeId = requestNode.id;
    this._finished = false;

    /** @type {(() => void) | null} */
    this.onChange = null;
  }

  _nextNodeId() {
    this._nodeCounter += 1;
    return `n${this._nodeCounter}`;
  }

  /**
   * @param {Omit<TraceNode, 'id'>} nodeData
   * @returns {TraceNode}
   */
  _createNode(nodeData) {
    return {
      id: this._nextNodeId(),
      ...nodeData,
    };
  }

  /**
   * @param {Omit<TraceNode, 'id'>} nodeData
   * @returns {TraceNode}
   */
  addNode(nodeData) {
    const node = this._createNode(nodeData);
    this.nodes.push(node);

    if (this._lastNodeId) {
      this.edges.push({ from: this._lastNodeId, to: node.id });
    }

    this._lastNodeId = node.id;
    this._setScopeNode(node);
    this._notifyChange();
    return node;
  }

  /**
   * Record a concurrent branch (e.g. database query) from the active handler scope.
   * @param {string | null | undefined} parentId
   * @param {Omit<TraceNode, 'id'>} nodeData
   * @returns {TraceNode}
   */
  addForkNode(parentId, nodeData) {
    const node = this._createNode(nodeData);
    const from = parentId || this._lastNodeId;

    this.nodes.push(node);

    if (from) {
      this.edges.push({ from, to: node.id, parallel: true });
    }

    this._notifyChange();
    return node;
  }

  /**
   * @param {string} nodeId
   * @param {Partial<TraceNode>} patch
   */
  updateNode(nodeId, patch) {
    const node = this.nodes.find((entry) => entry.id === nodeId);
    if (!node) return;
    Object.assign(node, patch);
    this._notifyChange();
  }

  /**
   * @returns {string | null}
   */
  getLastSequentialNodeId() {
    return this._lastNodeId;
  }

  /**
   * @param {TraceNode} node
   */
  _setScopeNode(node) {
    if (node.type === 'db') return;

    const ctx = getCurrentContext();
    if (ctx) {
      ctx.scopeNodeId = node.id;
    }
  }

  _notifyChange() {
    if (this.onChange && !this._finished) {
      this.onChange();
    }
  }

  /**
   * @returns {TraceGraph}
   */
  snapshot() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      method: this.method,
      url: this.url,
      params: this.params,
      body: this.body,
      status: this.status,
      state: 'active',
      duration_ms: Math.round((performance.now() - this.startTime) * 10) / 10,
      nodes: this.nodes,
      edges: this.edges,
    };
  }

  /**
   * @param {string} from
   * @param {string} to
   */
  addEdge(from, to) {
    this.edges.push({ from, to });
  }

  /**
   * @param {number} status
   * @param {unknown} [response]
   * @returns {TraceGraph}
   */
  finish(status, response) {
    this._finished = true;
    this.status = status;
    const duration_ms = Math.round((performance.now() - this.startTime) * 10) / 10;

    const responseNode = this._createNode({
      type: 'response',
      label: `${status}`,
      duration_ms: null,
    });

    this.nodes.push(responseNode);

    if (this._lastNodeId) {
      this.edges.push({ from: this._lastNodeId, to: responseNode.id });
    }

    return {
      id: this.id,
      timestamp: this.timestamp,
      method: this.method,
      url: this.url,
      params: this.params,
      body: this.body,
      response,
      status: this.status,
      state: 'complete',
      duration_ms,
      nodes: this.nodes,
      edges: this.edges,
    };
  }
}

module.exports = {
  TraceTracer,
};
