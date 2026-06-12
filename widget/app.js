'use strict';

const WS_PORT = parseInt(window.location.port, 10) || 7331;
const WS_URL = `ws://${window.location.hostname}:${WS_PORT}`;

/** @type {Map<string, object>} */
const traces = new Map();

/** @type {string | null} */
let selectedTraceId = null;

/** @type {Set<string>} */
const highlightIds = new Set();

/** @type {WebSocket | null} */
let socket = null;

const els = {
  statusDot: document.querySelector('.status-dot'),
  statusText: document.querySelector('.status-text'),
  requestItems: document.getElementById('request-items'),
  requestCount: document.getElementById('request-count'),
  emptyState: document.getElementById('empty-state'),
  traceTitle: document.getElementById('trace-title'),
  nodeDetail: document.getElementById('node-detail'),
  nodeDetailContent: document.getElementById('node-detail-content'),
  sourcePeek: document.getElementById('source-peek'),
  sourcePeekPath: document.getElementById('source-peek-path'),
  sourcePeekContent: document.getElementById('source-peek-content'),
};

function connect() {
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    setConnectionStatus(true);
    els.emptyState.textContent = 'Listening for requests…';
    socket.send(JSON.stringify({ type: 'get_history', limit: 50 }));
  });

  socket.addEventListener('close', () => {
    setConnectionStatus(false);
    els.emptyState.textContent = 'Reconnecting…';
    setTimeout(connect, 2000);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case 'trace_start':
        upsertTrace(message.payload, { highlight: true, autoSelect: true });
        break;
      case 'trace_update':
        upsertTrace(message.payload, { refreshDetail: true });
        break;
      case 'trace':
        upsertTrace(message.payload, { highlight: true, refreshDetail: true });
        break;
      case 'history':
        message.payload.forEach((trace) => upsertTrace(trace));
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
  renderRequestList();

  if (options.highlight || isNew) {
    highlightRequest(trace.id);
  }

  if (options.autoSelect && (!selectedTraceId || trace.state === 'active')) {
    selectTrace(trace.id, { preserveHighlight: true });
  } else if (options.refreshDetail && trace.id === selectedTraceId) {
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

function renderRequestList() {
  const items = Array.from(traces.values()).sort((a, b) => b.timestamp - a.timestamp);

  els.requestCount.textContent = String(items.length);
  els.emptyState.style.display = items.length ? 'none' : 'block';
  els.requestItems.innerHTML = '';

  for (const trace of items) {
    const li = document.createElement('li');
    const classes = ['request-item'];

    if (trace.id === selectedTraceId) classes.push('active');
    if (trace.state === 'active') classes.push('in-flight');
    if (highlightIds.has(trace.id)) classes.push('highlight');

    li.className = classes.join(' ');
    li.dataset.id = trace.id;

    const statusClass = trace.state === 'active' ? 'status-pending' : statusBadgeClass(trace.status);
    const statusLabel = trace.state === 'active' ? '…' : (trace.status ?? '—');
    const durationLabel = trace.state === 'active' ? 'running' : `${trace.duration_ms}ms`;

    li.innerHTML = `
      <div>
        <span class="method method-${trace.method}">${trace.method}</span>
        <span class="url">${escapeHtml(trace.url)}</span>
        ${trace.state === 'active' ? '<span class="live-dot" title="In progress"></span>' : ''}
      </div>
      <div class="request-meta">
        <span class="status-badge ${statusClass}">${statusLabel}</span>
        <span>${durationLabel}</span>
        <span>${formatTime(trace.timestamp)}</span>
      </div>
    `;

    li.addEventListener('click', () => selectTrace(trace.id));
    els.requestItems.appendChild(li);
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

  renderTraceDetail(trace);
  renderRequestList();
}

/**
 * @param {object} trace
 */
function renderTraceDetail(trace) {
  const titleSuffix = trace.state === 'active' ? ' (in progress)' : '';
  els.traceTitle.textContent = `${trace.method} ${trace.url}${titleSuffix}`;

  if (window.OpenconsTimeline) {
    window.OpenconsTimeline.render(trace);
  }

  els.nodeDetail.classList.add('hidden');
  els.sourcePeek.classList.add('hidden');

  requestAnimationFrame(() => {
    renderGraph(trace);
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
  els.sourcePeekContent.textContent = 'Loading…';

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

function setConnectionStatus(connected) {
  els.statusDot.className = `status-dot${connected ? ' connected' : ''}`;
  els.statusText.textContent = connected ? 'Connected' : 'Disconnected';
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

connect();
