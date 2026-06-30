'use strict';

const WS_PORT = parseInt(window.location.port, 10) || 7331;
const WS_PROTO = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${window.location.hostname}:${WS_PORT}`;

let wsReconnectDelay = 1000;
const WS_RECONNECT_MAX = 30_000;

const CLIENT_MAX_TRACES = 100;

/** @type {Set<string>} IDs already rendered in the list — used to animate new arrivals */
const renderedTraceIds = new Set();

/** @type {Map<string, object>} */
const traces = new Map();

/** @type {string | null} */
let selectedTraceId = null;

/** @type {Set<string>} */
const highlightIds = new Set();

/** @type {WebSocket | null} */
let socket = null;

/** @type {boolean} */
let wsConnected = false;

/** @type {boolean} */
let historyLoaded = false;

/** @type {'home' | 'requests' | 'snapshots'} */
let activePanel = 'home';

/** @type {string | null} */
let selectedSnapshotId = null;

/** @type {Set<string>} */
const expandedGroups = new Set();

const snapshotStore = () => window.openconsSnapshotStore;

const els = {
  statusDot: document.querySelector('.status-dot'),
  statusText: document.querySelector('.status-text'),
  requestItems: document.getElementById('request-items'),
  requestCount: document.getElementById('request-count'),
  snapshotItems: document.getElementById('snapshot-items'),
  snapshotCount: document.getElementById('snapshot-count'),
  snapshotsEmpty: document.getElementById('snapshots-empty'),
  requestsSection: document.getElementById('requests-section'),
  snapshotsSection: document.getElementById('snapshots-section'),
  homeBody: document.getElementById('home-body'),
  homeDashboard: document.getElementById('home-dashboard'),
  headerEyebrow: document.getElementById('header-eyebrow'),
  traceHeaderActions: document.getElementById('trace-header-actions'),
  traceBody: document.getElementById('trace-body'),
  snapshotBody: document.getElementById('snapshot-body'),
  snapshotDetail: document.getElementById('snapshot-detail'),
  comparisonBanner: document.getElementById('comparison-banner'),
  emptyState: document.getElementById('empty-state'),
  traceTitle: document.getElementById('trace-title'),
  saveSnapshot: document.getElementById('save-snapshot'),
  exportTrace: document.getElementById('export-trace'),
  copyTrace: document.getElementById('copy-trace'),
  nodeDetail: document.getElementById('node-detail'),
  nodeDetailContent: document.getElementById('node-detail-content'),
  sourcePeek: document.getElementById('source-peek'),
  sourcePeekPath: document.getElementById('source-peek-path'),
  sourcePeekContent: document.getElementById('source-peek-content'),
};

function connect() {
  wsConnected = false;
  historyLoaded = false;
  setConnectionStatus(false, 'Connecting…');
  renderRequestList();

  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    wsConnected = true;
    wsReconnectDelay = 1000;
    setConnectionStatus(true);
    renderRequestList();
    socket.send(JSON.stringify({ type: 'get_history', limit: 50 }));
  });

  socket.addEventListener('close', () => {
    wsConnected = false;
    historyLoaded = false;
    setConnectionStatus(false, `Reconnecting in ${Math.round(wsReconnectDelay / 1000)}s…`);
    renderRequestList();
    setTimeout(connect, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_RECONNECT_MAX);
  });

  socket.addEventListener('message', (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (err) {
      console.debug('[opencons] Received malformed WebSocket message', err);
      return;
    }

    switch (message.type) {
      case 'trace_start':
        historyLoaded = true;
        upsertTrace(message.payload, { highlight: true, autoSelect: true });
        break;
      case 'trace_update':
        upsertTrace(message.payload, { refreshDetail: true });
        break;
      case 'trace':
        historyLoaded = true;
        upsertTrace(message.payload, { highlight: true, refreshDetail: true });
        break;
      case 'history':
        historyLoaded = true;
        message.payload.forEach((trace) => upsertTrace(trace));
        renderRequestList();
        refreshHomeIfVisible();
        break;
      default:
        break;
    }
  });
}

/**
 * @param {object} trace
 * @param {object} [options]
 */
function upsertTrace(trace, options = {}) {
  const previous = traces.get(trace.id);
  const isNew = !previous;
  traces.set(trace.id, trace);

  // Evict oldest completed traces once the client map exceeds the cap.
  if (isNew && traces.size > CLIENT_MAX_TRACES) {
    for (const [id, t] of traces) {
      if (t.state !== 'active') {
        traces.delete(id);
        renderedTraceIds.delete(id);
        if (traces.size <= CLIENT_MAX_TRACES) break;
      }
    }
  }

  renderRequestList();
  refreshHomeIfVisible();

  if (options.highlight || isNew) {
    highlightRequest(trace.id);
  }

  if (options.autoSelect && (!selectedTraceId || trace.state === 'active')) {
    selectTrace(trace.id, { preserveHighlight: true });
  } else if (options.refreshDetail && trace.id === selectedTraceId && activePanel === 'requests') {
    renderTraceDetail(trace);
  }
}

function highlightRequest(id) {
  highlightIds.add(id);
  renderRequestList();

  setTimeout(() => {
    highlightIds.delete(id);
    renderRequestList();
  }, 2000);
}

/**
 * @param {object} trace
 */
function traceEndpointKey(trace) {
  if (window.OpenconsSnapshots?.endpointKey) {
    return window.OpenconsSnapshots.endpointKey(trace.method, trace.url);
  }
  return `${trace.method} ${trace.url}`;
}

/**
 * @param {object[]} items
 */
function groupTracesByEndpoint(items) {
  /** @type {Map<string, object[]>} */
  const groups = new Map();

  for (const trace of items) {
    const key = traceEndpointKey(trace);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trace);
  }

  return Array.from(groups.entries())
    .map(([key, groupTraces]) => {
      groupTraces.sort((a, b) => b.timestamp - a.timestamp);
      const [method, ...urlParts] = key.split(' ');
      return {
        key,
        method,
        url: urlParts.join(' '),
        traces: groupTraces,
        latest: groupTraces[0],
      };
    })
    .sort((a, b) => b.latest.timestamp - a.latest.timestamp);
}

/**
 * @param {object} trace
 * @param {{ nested?: boolean }} [options]
 */
function createTraceListItem(trace, options = {}) {
  const li = document.createElement('li');
  const classes = ['request-item'];

  if (options.nested) classes.push('request-item-nested');
  if (trace.id === selectedTraceId) classes.push('active');
  if (trace.state === 'active') classes.push('in-flight');
  if (highlightIds.has(trace.id)) classes.push('highlight');

  li.className = classes.join(' ');
  li.dataset.id = trace.id;

  const statusClass = trace.state === 'active' ? 'status-pending' : statusBadgeClass(trace.status);
  const statusLabel = trace.state === 'active' ? '…' : (trace.status ?? '—');
  const durationLabel = trace.state === 'active' ? 'running' : `${trace.duration_ms}ms`;

  const safeMethod = sanitizeMethod(trace.method);
  li.innerHTML = `
    <div>
      ${options.nested ? '' : `<span class="method method-${safeMethod}">${safeMethod}</span>`}
      ${options.nested ? `<span class="request-run-label">${formatTime(trace.timestamp)}</span>` : `<span class="url">${escapeHtml(trace.url)}</span>`}
      ${trace.state === 'active' ? '<span class="live-dot" title="In progress"></span>' : ''}
    </div>
    <div class="request-meta">
      <span class="status-badge ${statusClass}">${escapeHtml(String(statusLabel))}</span>
      <span>${escapeHtml(durationLabel)}</span>
      ${options.nested ? '' : `<span>${formatTime(trace.timestamp)}</span>`}
    </div>
  `;

  li.addEventListener('click', (event) => {
    event.stopPropagation();
    selectTrace(trace.id);
  });

  return li;
}

function renderRequestList() {
  const items = Array.from(traces.values()).sort((a, b) => b.timestamp - a.timestamp);
  const groups = groupTracesByEndpoint(items);

  els.requestCount.textContent = String(items.length);
  els.emptyState.style.display = items.length ? 'none' : 'block';
  els.requestItems.innerHTML = '';

  if (items.length === 0) {
    if (!wsConnected || !historyLoaded) {
      // Show skeleton placeholder rows while connecting or loading history.
      const widths = ['medium', 'short', 'long', 'medium'];
      widths.forEach((w) => {
        const sk = document.createElement('li');
        sk.className = 'skeleton-request-item';
        sk.setAttribute('aria-hidden', 'true');
        sk.innerHTML = `
          <div class="sk-row">
            <span class="skeleton sk-method"></span>
            <span class="skeleton sk-url ${w}"></span>
          </div>
          <div class="sk-meta">
            <span class="skeleton sk-badge"></span>
            <span class="skeleton sk-dur"></span>
            <span class="skeleton sk-time"></span>
          </div>
        `;
        els.requestItems.appendChild(sk);
      });
      els.emptyState.style.display = 'none';
    } else {
      els.emptyState.textContent = 'Listening for requests…';
    }
    return;
  }

  for (const group of groups) {
    const hasSelected = group.traces.some((trace) => trace.id === selectedTraceId);
    const hasInFlight = group.traces.some((trace) => trace.state === 'active');
    const hasHighlight = group.traces.some((trace) => highlightIds.has(trace.id));

    if (hasSelected || hasInFlight || hasHighlight) {
      expandedGroups.add(group.key);
    }

    if (group.traces.length === 1) {
      const listItem = createTraceListItem(group.traces[0]);
      if (!renderedTraceIds.has(group.traces[0].id)) {
        listItem.classList.add('item-enter');
      }
      renderedTraceIds.add(group.traces[0].id);
      els.requestItems.appendChild(listItem);
      continue;
    }

    const isExpanded = expandedGroups.has(group.key);
    const groupLi = document.createElement('li');
    const headerClasses = ['request-group-header'];

    if (hasSelected) headerClasses.push('active');
    if (hasInFlight) headerClasses.push('in-flight');
    if (hasHighlight) headerClasses.push('highlight');

    groupLi.className = `request-group${isExpanded ? ' expanded' : ''}`;

    const latest = group.latest;
    const latestStatusClass =
      latest.state === 'active' ? 'status-pending' : statusBadgeClass(latest.status);
    const latestStatusLabel = latest.state === 'active' ? '…' : (latest.status ?? '—');
    const latestDuration =
      latest.state === 'active' ? 'running' : `${latest.duration_ms}ms`;

    const header = document.createElement('div');
    header.className = headerClasses.join(' ');
    const safeGroupMethod = sanitizeMethod(group.method);
    header.innerHTML = `
      <div class="request-group-title">
        <span class="group-chevron" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
        <span class="method method-${safeGroupMethod}">${safeGroupMethod}</span>
        <span class="url">${escapeHtml(group.url)}</span>
        <span class="group-count" title="${group.traces.length} requests">${group.traces.length}</span>
        ${hasInFlight ? '<span class="live-dot" title="In progress"></span>' : ''}
      </div>
      <div class="request-meta">
        <span class="status-badge ${latestStatusClass}">${escapeHtml(String(latestStatusLabel))}</span>
        <span>${escapeHtml(latestDuration)}</span>
        <span>latest</span>
      </div>
    `;

    header.addEventListener('click', () => {
      if (expandedGroups.has(group.key)) {
        expandedGroups.delete(group.key);
      } else {
        expandedGroups.add(group.key);
      }
      renderRequestList();
    });

    groupLi.appendChild(header);

    if (isExpanded) {
      const childList = document.createElement('ul');
      childList.className = 'request-group-list';

      for (const trace of group.traces) {
        childList.appendChild(createTraceListItem(trace, { nested: true }));
      }

      groupLi.appendChild(childList);
    }

    const isNewGroup = group.traces.every((t) => !renderedTraceIds.has(t.id));
    if (isNewGroup) groupLi.classList.add('item-enter');
    group.traces.forEach((t) => renderedTraceIds.add(t.id));

    els.requestItems.appendChild(groupLi);
  }
}

/**
 * @param {string} id
 * @param {object} [options]
 */
function selectTrace(id, options = {}) {
  selectedTraceId = id;
  const trace = traces.get(id);

  if (!trace) return;

  if (!options.preserveHighlight) {
    highlightIds.delete(id);
  }

  if (activePanel === 'requests') {
    renderTraceDetail(trace);
  }
  renderRequestList();
}

/**
 * @param {object} trace
 */
function renderTraceDetail(trace) {
  const titleSuffix = trace.state === 'active' ? ' (in progress)' : '';
  els.traceTitle.textContent = `${trace.method} ${trace.url}${titleSuffix}`;
  updateExportButtons(trace);
  renderComparisonBanner(trace);

  setViewLoading('graph-view', true, 'Rendering trace…');
  setViewLoading('timeline-view', true, 'Rendering trace…');

  if (window.OpenconsTimeline) {
    window.OpenconsTimeline.render(trace);
  }

  els.nodeDetail.classList.add('hidden');
  els.sourcePeek.classList.add('hidden');

  requestAnimationFrame(() => {
    renderGraph(trace);
    setViewLoading('graph-view', false);
    setViewLoading('timeline-view', false);
  });
}

/**
 * @param {object} trace
 */
function renderGraph(trace) {
  if (!window.OpenconsGraph) return;
  window.OpenconsGraph.render(trace, onNodeSelect);
}

/**
 * @param {object} node
 */
function onNodeSelect(node) {
  els.nodeDetail.classList.remove('hidden');
  els.nodeDetailContent.innerHTML = '';

  const fields = [
    ['Step', node.label || node.type],
    ['Type', node.type],
    ['Duration', node.duration_ms != null ? `${node.duration_ms}ms` : '—'],
  ];

  if (node.summary) {
    fields.splice(1, 0, ['What happened', node.summary]);
  }

  if (node.condition) {
    fields.push(['Condition', node.condition]);
  }

  if (node.called_next !== undefined) {
    fields.push(['Called next()', String(node.called_next)]);
  }

  if (node.exit_reason) {
    fields.push(['Exit reason', node.exit_reason]);
  }

  if (node.outcomes?.length) {
    fields.push([
      'Branches',
      node.outcomes.map((o) => `${o.taken ? '✓' : '○'} ${o.label}`).join('\n'),
    ]);
  } else if ((node.type === 'branch' || node.type === 'loop') && node.value != null) {
    fields.push(['Result', String(node.value)]);
  }

  if (node.type === 'db-hub') {
    fields.splice(1, 0, ['Role', 'Central database — all queries route through here']);
    if (node.drivers?.length) {
      fields.push(['Stack', node.drivers.join(' · ')]);
    }
    if (node.dbQueries?.length) {
      const lang = window.OpenconsDbLanguage;
      const lines = node.dbQueries.map((query) => {
        const title = lang ? lang.dbNodeTitle(query) : query.label;
        const result = lang ? lang.dbNodeResult(query) : query.db_result;
        return `${title} → ${result}`;
      });
      fields.push(['Queries in this request', lines.join('\n')]);
    }
  }

  if (node.type === 'db' || node.isDbQuery) {
    const lang = window.OpenconsDbLanguage;
    const intent = lang ? lang.dbNodeIntent(node) : node.db_intent;
    const result = lang ? lang.dbNodeResult(node) : node.db_result;

    if (node.parentLabel) fields.push(['From handler', node.parentLabel]);
    if (intent) fields.push(['Sent to database', intent]);
    if (result) fields.push(['Came back with', result]);
    if (node.query) fields.push(['SQL', node.query]);
    if (node.params) fields.push(['Parameters', JSON.stringify(node.params)]);
    if (node.rows != null) fields.push(['Rows', String(node.rows)]);
    if (node.driver) fields.push(['Driver', node.driver]);
  }

  if (node.source?.file) {
    const loc =
      node.source.line != null ? `${node.source.file}:${node.source.line}` : node.source.file;
    fields.push(['Source', loc]);
  }

  for (const [label, value] of fields) {
    els.nodeDetailContent.innerHTML += `<dt>${label}</dt><dd>${escapeHtml(String(value))}</dd>`;
  }

  if (node.source?.file && node.source.line != null) {
    loadSourcePeek(node.source.file, node.source.line);
  } else {
    els.sourcePeek.classList.add('hidden');
  }
}

/**
 * @param {string} file
 * @param {number} line
 */
async function loadSourcePeek(file, line) {
  els.sourcePeek.classList.remove('hidden');
  els.sourcePeekPath.textContent = `${file}:${line}`;
  els.sourcePeekContent.innerHTML = loaderHtml('Loading source…');

  try {
    const response = await fetch(`/api/source?file=${encodeURIComponent(file)}&line=${line}`);
    if (!response.ok) {
      els.sourcePeekContent.textContent = 'Source not available (file not transformed yet).';
      return;
    }

    const snippet = await response.json();
    els.sourcePeekPath.textContent = snippet.file || `${file}:${line}`;
    els.sourcePeekContent.innerHTML = snippet.lines
      .map((row) => {
        const cls = row.highlight ? 'source-line highlight' : 'source-line';
        const num = String(row.number).padStart(4, ' ');
        return `<span class="${cls}"><span class="line-num">${num}</span>${escapeHtml(row.text)}</span>`;
      })
      .join('\n');
  } catch {
    els.sourcePeekContent.textContent = 'Failed to load source.';
  }
}

/**
 * @param {string} [message]
 */
function loaderHtml(message = 'Loading…') {
  return `<div class="loader-state" role="status" aria-live="polite">
    <span class="loader-spinner" aria-hidden="true"></span>
    <span class="loader-text">${escapeHtml(message)}</span>
  </div>`;
}

/**
 * @param {string} viewId
 * @param {boolean} loading
 * @param {string} [message]
 */
function setViewLoading(viewId, loading, message = 'Loading…') {
  const view = document.getElementById(viewId);
  const card = view?.querySelector('.view-card');
  if (!card) return;

  let overlay = card.querySelector('.loading-overlay');

  if (loading) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'loading-overlay';
      card.appendChild(overlay);
    }
    overlay.innerHTML = loaderHtml(message);
    card.classList.add('is-loading');
  } else {
    overlay?.remove();
    card.classList.remove('is-loading');
  }
}

/**
 * @param {HTMLElement | null} el
 * @param {boolean} loading
 * @param {string} [message]
 */
function setElementLoading(el, loading, message = 'Loading…') {
  if (!el) return;

  if (loading) {
    el.innerHTML = loaderHtml(message);
  }
}

function setConnectionStatus(connected, label) {
  els.statusDot.className = `status-dot${connected ? ' connected' : ''}`;
  els.statusText.textContent = label || (connected ? 'Connected' : 'Disconnected');
}

/**
 * @param {number | null} status
 */
function statusBadgeClass(status) {
  if (!status) return '';
  if (status < 300) return 'status-2xx';
  if (status < 400) return 'status-3xx';
  if (status < 500) return 'status-4xx';
  return 'status-5xx';
}

/**
 * @param {number} ts
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

/**
 * @param {string} str
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const VALID_HTTP_METHOD = /^[A-Z]+$/;

function sanitizeMethod(method) {
  if (typeof method === 'string' && VALID_HTTP_METHOD.test(method)) {
    return method;
  }
  return 'UNKNOWN';
}

document.getElementById('graph-zoom-in')?.addEventListener('click', () => {
  window.OpenconsGraph?.zoomIn();
});

document.getElementById('graph-zoom-out')?.addEventListener('click', () => {
  window.OpenconsGraph?.zoomOut();
});

document.getElementById('graph-zoom-reset')?.addEventListener('click', () => {
  window.OpenconsGraph?.resetView();
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(`${tab.dataset.view}-view`).classList.add('active');
  });
});

/**
 * @param {object | undefined} trace
 */
function updateExportButtons(trace) {
  const enabled = Boolean(trace) && activePanel === 'requests';
  if (els.saveSnapshot) els.saveSnapshot.disabled = !enabled;
  if (els.exportTrace) els.exportTrace.disabled = !enabled;
  if (els.copyTrace) els.copyTrace.disabled = !enabled;
}

/**
 * @param {object} trace
 */
function renderComparisonBanner(trace) {
  const banner = els.comparisonBanner;
  if (!banner || !window.OpenconsSnapshots || !snapshotStore()) {
    return;
  }

  const result = snapshotStore().compareTraceToLatest(trace, window.OpenconsExport?.buildTraceExport);
  if (!result || trace.state === 'active') {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const { comparison, baseline } = result;
  const duration = comparison.delta.duration_ms;
  const dbCount = comparison.delta.db_query_count;
  const improved = comparison.improved;
  const tone = improved ? 'improved' : duration.change > 0 ? 'regressed' : 'neutral';

  banner.className = `comparison-banner comparison-${tone}`;
  banner.innerHTML = `
    <div class="comparison-copy">
      <strong>vs last snapshot</strong>
      <span class="comparison-baseline">${escapeHtml(baseline.label || formatSnapshotDate(baseline.saved_at))}</span>
      <span class="comparison-metric ${metricTone(duration.change, true)}">${formatDelta('Duration', duration)}</span>
      <span class="comparison-metric ${metricTone(dbCount.change, true)}">${formatDelta('DB queries', dbCount, '', true)}</span>
    </div>
  `;
}

/**
 * @param {number} change
 * @param {boolean} lowerIsBetter
 */
function metricTone(change, lowerIsBetter) {
  if (change === 0) return 'neutral';
  const improved = lowerIsBetter ? change < 0 : change > 0;
  return improved ? 'good' : 'bad';
}

/**
 * @param {string} label
 * @param {{ from: number, to: number, change: number, percent: number }} delta
 * @param {string} [unit]
 * @param {boolean} [integer]
 */
function formatDelta(label, delta, unit = 'ms', integer = false) {
  const sign = delta.change > 0 ? '+' : '';
  const value = integer ? `${sign}${delta.change}` : `${sign}${delta.change}${unit}`;
  const pct = delta.percent !== 0 ? ` (${sign}${delta.percent}%)` : '';
  return `${label}: ${delta.from}${unit} → ${delta.to}${unit} (${value}${integer ? '' : ''}${pct})`;
}

function renderSnapshotList() {
  const store = snapshotStore();
  if (!store || !els.snapshotItems) return;

  const snapshots = store.list();
  if (els.snapshotCount) els.snapshotCount.textContent = String(snapshots.length);
  els.snapshotsEmpty.style.display = snapshots.length ? 'none' : 'block';
  els.snapshotItems.innerHTML = '';

  for (const snapshot of snapshots) {
    const li = document.createElement('li');
    const classes = ['request-item', 'snapshot-item'];
    if (snapshot.id === selectedSnapshotId) classes.push('active');

    li.className = classes.join(' ');
    li.dataset.id = snapshot.id;

    const [method, ...urlParts] = snapshot.endpoint_key.split(' ');
    const url = urlParts.join(' ');
    const title = snapshot.label || formatSnapshotDate(snapshot.saved_at);
    const metrics = snapshot.metrics || {};

    const safeSnapMethod = sanitizeMethod(method);
    li.innerHTML = `
      <div>
        <span class="method method-${safeSnapMethod}">${safeSnapMethod}</span>
        <span class="url">${escapeHtml(url)}</span>
      </div>
      <div class="request-meta">
        <span>${escapeHtml(title)}</span>
        <span>${metrics.duration_ms ?? '—'}ms</span>
        <span>${metrics.db_query_count ?? '—'} db</span>
      </div>
    `;

    li.addEventListener('click', () => selectSnapshot(snapshot.id));
    els.snapshotItems.appendChild(li);
  }
}

/**
 * @param {string} id
 */
function selectSnapshot(id) {
  selectedSnapshotId = id;
  activePanel = 'snapshots';
  syncPanelUi();
  renderSnapshotList();
  setElementLoading(els.snapshotDetail, true, 'Loading snapshot…');
  requestAnimationFrame(() => renderSnapshotDetail(id));
}

/**
 * @param {string} id
 */
function renderSnapshotDetail(id) {
  const store = snapshotStore();
  if (!store || !els.snapshotDetail) return;

  const snapshot = store.get(id);
  if (!snapshot) {
    els.snapshotDetail.innerHTML = '<p class="empty-state">Snapshot not found.</p>';
    return;
  }

  const trend = store.getTrend(snapshot.endpoint_key);
  const comparison = store.compareWithPrevious(id);
  const [method, ...urlParts] = snapshot.endpoint_key.split(' ');
  const url = urlParts.join(' ');

  els.traceTitle.textContent = `${method} ${url}`;

  const comparisonHtml = comparison
    ? renderComparisonTable(comparison.comparison, comparison.previous.label || 'previous')
    : '<p class="snapshot-note">First snapshot for this endpoint — save another to track changes.</p>';

  const trendHtml = trend
    .map((entry, index) => {
      const metrics = entry.metrics || {};
      const prevMetrics = index > 0 ? trend[index - 1].metrics || {} : null;
      const durationDelta =
        prevMetrics && metrics.duration_ms != null && prevMetrics.duration_ms != null
          ? metrics.duration_ms - prevMetrics.duration_ms
          : null;
      const deltaClass =
        durationDelta == null ? '' : durationDelta < 0 ? 'trend-good' : durationDelta > 0 ? 'trend-bad' : '';
      const deltaLabel =
        durationDelta == null ? '—' : `${durationDelta > 0 ? '+' : ''}${durationDelta}ms`;

      return `
        <tr class="${entry.id === id ? 'active' : ''}">
          <td>${escapeHtml(entry.label || formatSnapshotDate(entry.saved_at))}</td>
          <td>${metrics.duration_ms ?? '—'}ms</td>
          <td>${metrics.db_query_count ?? '—'}</td>
          <td>${metrics.db_total_ms ?? '—'}ms</td>
          <td class="${deltaClass}">${deltaLabel}</td>
        </tr>
      `;
    })
    .join('');

  const metrics = snapshot.metrics || {};

  els.snapshotDetail.innerHTML = `
    <div class="snapshot-header">
      <div>
        <p class="eyebrow">Snapshot</p>
        <h2>${escapeHtml(snapshot.label || formatSnapshotDate(snapshot.saved_at))}</h2>
        ${snapshot.note ? `<p class="snapshot-note">${escapeHtml(snapshot.note)}</p>` : ''}
      </div>
      <button type="button" class="export-btn export-btn-ghost snapshot-delete" data-id="${snapshot.id}">Delete</button>
    </div>

    <div class="snapshot-grid">
      <div class="detail-card">
        <h3 class="card-title">Metrics</h3>
        <dl class="detail-grid">
          <dt>Duration</dt><dd>${metrics.duration_ms ?? '—'}ms</dd>
          <dt>DB queries</dt><dd>${metrics.db_query_count ?? '—'}</dd>
          <dt>DB time</dt><dd>${metrics.db_total_ms ?? '—'}ms (${metrics.db_percent ?? '—'}%)</dd>
          <dt>Middleware</dt><dd>${metrics.middleware_total_ms ?? '—'}ms</dd>
          <dt>Controller</dt><dd>${metrics.controller_total_ms ?? '—'}ms</dd>
          <dt>Recommendations</dt><dd>${metrics.recommendation_count ?? '—'}</dd>
        </dl>
      </div>

      <div class="detail-card">
        <h3 class="card-title">Change since previous</h3>
        ${comparisonHtml}
      </div>
    </div>

    <div class="detail-card">
      <h3 class="card-title">Trend for ${escapeHtml(snapshot.endpoint_key)}</h3>
      <table class="trend-table">
        <thead>
          <tr>
            <th>Snapshot</th>
            <th>Duration</th>
            <th>DB queries</th>
            <th>DB time</th>
            <th>Δ duration</th>
          </tr>
        </thead>
        <tbody>${trendHtml}</tbody>
      </table>
    </div>
  `;

  els.snapshotDetail.querySelector('.snapshot-delete')?.addEventListener('click', () => {
    store.remove(id);
    selectedSnapshotId = null;
    renderSnapshotList();
    els.snapshotDetail.innerHTML = '<p class="empty-state">Select a snapshot to see metrics and trends.</p>';
  });
}

/**
 * @param {object} comparison
 * @param {string} baselineLabel
 */
function renderComparisonTable(comparison, baselineLabel) {
  const rows = [
    ['Duration', comparison.delta.duration_ms, 'ms'],
    ['DB queries', comparison.delta.db_query_count, '', true],
    ['DB time', comparison.delta.db_total_ms, 'ms'],
    ['Recommendations', comparison.delta.recommendation_count, '', true],
  ];

  const body = rows
    .map(([label, delta, unit, integer]) => {
      const tone = metricTone(delta.change, true);
      const sign = delta.change > 0 ? '+' : '';
      const change = integer ? `${sign}${delta.change}` : `${sign}${delta.change}${unit}`;
      return `
        <tr>
          <td>${label}</td>
          <td>${delta.from}${unit}</td>
          <td>${delta.to}${unit}</td>
          <td class="trend-${tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'neutral'}">${change}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <p class="snapshot-note">Compared to ${escapeHtml(baselineLabel)}</p>
    <table class="trend-table">
      <thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

/**
 * @param {string} iso
 */
function formatSnapshotDate(iso) {
  return new Date(iso).toLocaleString();
}

/**
 * @param {'home' | 'requests' | 'snapshots'} panel
 */
function animatePanelEnter(el) {
  if (!el) return;
  el.classList.remove('panel-enter');
  // Force reflow so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add('panel-enter');
}

function switchPanel(panel) {
  activePanel = panel;
  syncPanelUi();

  if (panel === 'home') {
    els.headerEyebrow.textContent = 'Overview';
    els.traceTitle.textContent = 'App analytics';
    els.comparisonBanner?.classList.add('hidden');
    renderHomeDashboard();
    animatePanelEnter(els.homeBody);
  } else if (panel === 'snapshots') {
    els.headerEyebrow.textContent = 'Snapshots';
    els.traceTitle.textContent = 'Snapshots';
    els.comparisonBanner?.classList.add('hidden');
    renderSnapshotList();
    animatePanelEnter(els.snapshotBody);
    if (selectedSnapshotId) {
      setElementLoading(els.snapshotDetail, true, 'Loading snapshot…');
      requestAnimationFrame(() => renderSnapshotDetail(selectedSnapshotId));
    }
  } else {
    els.headerEyebrow.textContent = 'Execution trace';
    animatePanelEnter(els.traceBody);
    if (selectedTraceId) {
      const trace = traces.get(selectedTraceId);
      if (trace) renderTraceDetail(trace);
    } else {
      els.traceTitle.textContent = 'Select a request';
      els.comparisonBanner?.classList.add('hidden');
      updateExportButtons(undefined);
    }
  }
}

function refreshHomeIfVisible() {
  if (activePanel === 'home') {
    renderHomeDashboard();
  }
}

function homeDashboardSkeletonHtml() {
  const statCards = Array.from({ length: 4 }, () => `
    <div class="skeleton-stat-card" aria-hidden="true">
      <span class="skeleton sk-label"></span>
      <span class="skeleton sk-value"></span>
      <span class="skeleton sk-hint"></span>
    </div>
  `).join('');

  const chartCards = Array.from({ length: 2 }, () => `
    <div class="skeleton-chart-card" aria-hidden="true">
      <span class="skeleton sk-title"></span>
      <span class="skeleton sk-chart"></span>
    </div>
  `).join('');

  return `
    <div class="stats-grid">${statCards}</div>
    <div class="charts-grid">${chartCards}</div>
  `;
}

function renderHomeDashboard() {
  if (!els.homeDashboard || !window.OpenconsAnalytics) return;

  const loading = traces.size === 0 && (!wsConnected || !historyLoaded);

  if (loading) {
    els.homeDashboard.innerHTML = homeDashboardSkeletonHtml();
    return;
  }

  const analytics = window.OpenconsAnalytics.computeAnalytics(traces, traceEndpointKey);

  window.OpenconsAnalytics.renderDashboard(els.homeDashboard, analytics, {
    onEndpointClick: (row) => {
      expandedGroups.add(row.key);
      switchPanel('requests');
      if (row.latestTraceId) {
        selectTrace(row.latestTraceId, { preserveHighlight: true });
      }
    },
  });
}

function syncPanelUi() {
  document.querySelectorAll('.nav-item[data-panel]').forEach((button) => {
    const isActive = button.dataset.panel === activePanel;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  els.requestsSection?.classList.toggle('hidden', activePanel !== 'requests');
  els.snapshotsSection?.classList.toggle('hidden', activePanel !== 'snapshots');
  els.homeBody?.classList.toggle('hidden', activePanel !== 'home');
  els.traceBody?.classList.toggle('hidden', activePanel !== 'requests');
  els.snapshotBody?.classList.toggle('hidden', activePanel !== 'snapshots');
  els.traceHeaderActions?.classList.toggle('hidden', activePanel !== 'requests');
}

els.exportTrace?.addEventListener('click', () => {
  const trace = selectedTraceId ? traces.get(selectedTraceId) : null;
  if (!trace || !window.OpenconsExport) return;
  window.OpenconsExport.downloadTraceExport(trace);
});

els.copyTrace?.addEventListener('click', async () => {
  const trace = selectedTraceId ? traces.get(selectedTraceId) : null;
  if (!trace || !window.OpenconsExport) return;

  const button = els.copyTrace;
  const original = button.textContent;

  try {
    await window.OpenconsExport.copyTraceExport(trace);
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  } catch {
    button.textContent = 'Copy failed';
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  }
});

els.saveSnapshot?.addEventListener('click', () => {
  const trace = selectedTraceId ? traces.get(selectedTraceId) : null;
  const store = snapshotStore();
  if (!trace || !store || !window.OpenconsExport) return;

  const label = window.prompt('Snapshot label (optional)', '');
  if (label === null) return;

  const note = window.prompt('Note — what changed? (optional)', '');
  if (note === null) return;

  const snapshot = store.save(trace, {
    label,
    note,
    buildExport: window.OpenconsExport.buildTraceExport,
  });

  selectedSnapshotId = snapshot.id;
  renderSnapshotList();
  renderComparisonBanner(trace);

  const button = els.saveSnapshot;
  const original = button.textContent;
  button.textContent = 'Saved!';
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
});

document.querySelectorAll('.nav-item[data-panel]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    switchPanel(button.dataset.panel);
    closeMobileSidebar();
  });
});

// Mobile sidebar toggle
(function initMobileSidebar() {
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  if (!toggleBtn || !sidebar || !backdrop) return;

  function openMobileSidebar() {
    sidebar.classList.add('sidebar-open');
    backdrop.classList.add('sidebar-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.setAttribute('aria-label', 'Close navigation');
    toggleBtn.textContent = '✕';
  }

  window.closeMobileSidebar = function closeMobileSidebar() {
    sidebar.classList.remove('sidebar-open');
    backdrop.classList.remove('sidebar-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-label', 'Open navigation');
    toggleBtn.textContent = '☰';
  };

  toggleBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('sidebar-open')) {
      window.closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  });

  backdrop.addEventListener('click', () => window.closeMobileSidebar());
})();

function closeMobileSidebar() {
  if (window.closeMobileSidebar) window.closeMobileSidebar();
}

renderSnapshotList();
syncPanelUi();
renderHomeDashboard();
connect();
