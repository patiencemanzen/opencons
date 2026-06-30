(function (root) {
'use strict';

const SNAPSHOTS_VERSION = '1';
const STORAGE_KEY = 'opencons.snapshots.v1';
const MAX_SNAPSHOTS = 200;

const METRIC_KEYS = [
  'duration_ms',
  'db_query_count',
  'db_total_ms',
  'db_percent',
  'timed_step_count',
  'middleware_total_ms',
  'controller_total_ms',
  'recommendation_count',
];

/**
 * @param {string} method
 * @param {string} url
 */
function endpointKey(method, url) {
  return `${method} ${url}`;
}

/**
 * @param {object} exportPayload
 */
function extractMetrics(exportPayload) {
  const breakdown = exportPayload.summary.breakdown_by_type || {};

  return {
    duration_ms: exportPayload.summary.total_duration_ms,
    db_query_count: exportPayload.summary.db.query_count,
    db_total_ms: exportPayload.summary.db.total_ms,
    db_percent: exportPayload.summary.db.percent_of_total,
    timed_step_count: exportPayload.summary.timed_step_count,
    middleware_total_ms: breakdown.middleware?.total_ms ?? 0,
    controller_total_ms: breakdown.controller?.total_ms ?? 0,
    recommendation_count: exportPayload.recommendations.length,
  };
}

/**
 * @param {number} n
 */
function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} baseline
 * @param {object} current
 */
function compareMetrics(baseline, current) {
  /** @type {Record<string, { from: number, to: number, change: number, percent: number }>} */
  const delta = {};

  for (const key of METRIC_KEYS) {
    const from = baseline[key] ?? 0;
    const to = current[key] ?? 0;
    const change = round(to - from);
    const percent = from !== 0 ? round((change / from) * 100) : to !== 0 ? 100 : 0;
    delta[key] = { from, to, change, percent };
  }

  const improved =
    delta.duration_ms.change < 0 ||
    (delta.duration_ms.change === 0 && delta.db_query_count.change < 0);

  return {
    baseline,
    current,
    delta,
    improved,
  };
}

/**
 * @param {object | undefined} snapshot
 */
function normalizeSnapshot(snapshot) {
  if (!snapshot) return snapshot;

  if (!snapshot.metrics && snapshot.export) {
    return { ...snapshot, metrics: extractMetrics(snapshot.export) };
  }

  if (!snapshot.metrics) {
    return {
      ...snapshot,
      metrics: {
        duration_ms: 0,
        db_query_count: 0,
        db_total_ms: 0,
        db_percent: 0,
        timed_step_count: 0,
        middleware_total_ms: 0,
        controller_total_ms: 0,
        recommendation_count: 0,
      },
    };
  }

  return snapshot;
}

class SnapshotStore {
  /**
   * @param {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void } | null} [storage]
   */
  constructor(storage) {
    if (storage) {
      this.storage = storage;
    } else if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    } else {
      this.storage = new MemoryStorage();
    }
  }

  /**
   * @returns {object[]}
   */
  list() {
    return this._read().snapshots.map(normalizeSnapshot);
  }

  /**
   * @param {string} id
   * @returns {object | undefined}
   */
  get(id) {
    return this.list().find((snapshot) => snapshot.id === id);
  }

  /**
   * @param {string} key
   * @returns {object[]}
   */
  getByEndpoint(key) {
    return this.list()
      .filter((snapshot) => snapshot.endpoint_key === key)
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  }

  /**
   * @param {object} trace
   * @param {object} [options]
   * @param {string} [options.label]
   * @param {string} [options.note]
   * @param {() => object} [options.buildExport]
   * @returns {object}
   */
  save(trace, options = {}) {
    const buildExport = options.buildExport || globalThis.OpenconsExport?.buildTraceExport;
    if (!buildExport) {
      throw new Error('buildTraceExport is not available');
    }

    const exportPayload = buildExport(trace);
    const key = endpointKey(trace.method, trace.url);
    const data = this._read();
    const sequence = (data.next_sequence || 0) + 1;
    const snapshot = {
      id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      sequence,
      saved_at: new Date().toISOString(),
      label: options.label?.trim() || null,
      note: options.note?.trim() || null,
      endpoint_key: key,
      trace_id: trace.id,
      metrics: extractMetrics(exportPayload),
      export: exportPayload,
    };

    data.next_sequence = sequence;
    data.snapshots.unshift(snapshot);

    if (data.snapshots.length > MAX_SNAPSHOTS) {
      data.snapshots = data.snapshots.slice(0, MAX_SNAPSHOTS);
    }

    this._write(data);
    return snapshot;
  }

  /**
   * @param {string} id
   */
  remove(id) {
    const data = this._read();
    data.snapshots = data.snapshots.filter((snapshot) => snapshot.id !== id);
    this._write(data);
  }

  /**
   * @param {string} endpoint
   * @returns {object | undefined}
   */
  getLatestForEndpoint(endpoint) {
    const items = this.getByEndpoint(endpoint);
    return items.at(-1);
  }

  /**
   * @param {string} snapshotId
   * @returns {object | null}
   */
  compareWithPrevious(snapshotId) {
    const snapshot = this.get(snapshotId);
    if (!snapshot) return null;

    const history = this.getByEndpoint(snapshot.endpoint_key);
    const index = history.findIndex((item) => item.id === snapshotId);
    if (index <= 0) return null;

    return {
      endpoint_key: snapshot.endpoint_key,
      previous: history[index - 1],
      current: snapshot,
      comparison: compareMetrics(history[index - 1].metrics, snapshot.metrics),
    };
  }

  /**
   * @param {object} trace
   * @param {() => object} [buildExport]
   * @returns {object | null}
   */
  compareTraceToLatest(trace, buildExport) {
    const key = endpointKey(trace.method, trace.url);
    const latest = this.getLatestForEndpoint(key);
    if (!latest) return null;

    const build = buildExport || globalThis.OpenconsExport?.buildTraceExport;
    if (!build) return null;

    const currentMetrics = extractMetrics(build(trace));

    return {
      endpoint_key: key,
      baseline: latest,
      current_metrics: currentMetrics,
      comparison: compareMetrics(latest.metrics, currentMetrics),
    };
  }

  /**
   * @param {string} endpoint
   * @returns {{ saved_at: string, label: string | null, metrics: object }[]}
   */
  getTrend(endpoint) {
    return this.getByEndpoint(endpoint).map((snapshot) => ({
      id: snapshot.id,
      saved_at: snapshot.saved_at,
      label: snapshot.label,
      metrics: snapshot.metrics,
    }));
  }

  /**
   * @returns {Record<string, object[]>}
   */
  groupByEndpoint() {
    /** @type {Record<string, object[]>} */
    const groups = {};

    for (const snapshot of this.list()) {
      if (!groups[snapshot.endpoint_key]) {
        groups[snapshot.endpoint_key] = [];
      }
      groups[snapshot.endpoint_key].push(snapshot);
    }

    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }

    return groups;
  }

  _read() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return { version: SNAPSHOTS_VERSION, snapshots: [] };

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.snapshots)) {
        return { version: SNAPSHOTS_VERSION, snapshots: [] };
      }

      return parsed;
    } catch {
      return { version: SNAPSHOTS_VERSION, snapshots: [] };
    }
  }

  /**
   * @param {object} data
   */
  _write(data) {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: SNAPSHOTS_VERSION, ...data }));
    } catch (err) {
      if (err && err.name === 'QuotaExceededError') {
        console.warn('[opencons] localStorage quota exceeded — snapshot could not be saved.');
        if (typeof window !== 'undefined' && window.openconsShowStorageWarning) {
          window.openconsShowStorageWarning();
        }
      } else {
        throw err;
      }
    }
  }
}

class MemoryStorage {
  constructor() {
    /** @type {Record<string, string>} */
    this.data = {};
  }

  /**
   * @param {string} key
   */
  getItem(key) {
    return this.data[key] ?? null;
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  setItem(key, value) {
    this.data[key] = value;
  }
}

const snapshotsApi = {
  SNAPSHOTS_VERSION,
  METRIC_KEYS,
  endpointKey,
  extractMetrics,
  compareMetrics,
  normalizeSnapshot,
  SnapshotStore,
  MemoryStorage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = snapshotsApi;
} else {
  root.OpenconsSnapshots = snapshotsApi;
  root.openconsSnapshotStore = new SnapshotStore();
}
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
