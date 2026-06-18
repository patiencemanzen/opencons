(function (root) {
'use strict';

const TOP_ENDPOINTS = 8;

/**
 * @param {object} trace
 */
function countDbQueries(trace) {
  return trace.nodes?.filter((node) => node.type === 'db').length ?? 0;
}

/**
 * @param {object} trace
 * @param {(trace: object) => string} keyFn
 */
function endpointKeyFor(trace, keyFn) {
  return keyFn(trace);
}

/**
 * @param {number} n
 */
function round(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {object[] | Map<string, object>} traces
 * @param {(trace: object) => string} [endpointKeyFn]
 */
function computeAnalytics(traces, endpointKeyFn) {
  const keyFn = endpointKeyFn || ((trace) => `${trace.method} ${trace.url}`);
  const list = traces instanceof Map ? Array.from(traces.values()) : [...traces];

  /** @type {Map<string, object>} */
  const endpointMap = new Map();

  let totalDuration = 0;
  let completedCount = 0;
  let totalDbQueries = 0;
  let errorCount = 0;
  let activeCount = 0;

  const statusBuckets = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
    active: 0,
  };

  for (const trace of list) {
    const key = endpointKeyFor(trace, keyFn);
    const dbCount = countDbQueries(trace);
    const isActive = trace.state === 'active';
    const status = trace.status;

    if (isActive) {
      activeCount += 1;
      statusBuckets.active += 1;
    } else if (status != null) {
      if (status < 300) statusBuckets['2xx'] += 1;
      else if (status < 400) statusBuckets['3xx'] += 1;
      else if (status < 500) statusBuckets['4xx'] += 1;
      else statusBuckets['5xx'] += 1;

      if (status >= 400) errorCount += 1;
    }

    if (!isActive && trace.duration_ms != null) {
      totalDuration += trace.duration_ms;
      completedCount += 1;
    }

    totalDbQueries += dbCount;

    if (!endpointMap.has(key)) {
      const [method, ...urlParts] = key.split(' ');
      endpointMap.set(key, {
        key,
        method,
        url: urlParts.join(' '),
        label: shortenLabel(key),
        count: 0,
        durationTotal: 0,
        durationMax: 0,
        completedCount: 0,
        dbQueryTotal: 0,
        errorCount: 0,
        latestTraceId: trace.id,
        latestTimestamp: trace.timestamp,
      });
    }

    const entry = endpointMap.get(key);
    entry.count += 1;
    entry.dbQueryTotal += dbCount;
    if (!isActive && trace.duration_ms != null) {
      entry.durationTotal += trace.duration_ms;
      entry.completedCount += 1;
      entry.durationMax = Math.max(entry.durationMax, trace.duration_ms);
    }
    if (status != null && status >= 400) entry.errorCount += 1;
    if (trace.timestamp >= entry.latestTimestamp) {
      entry.latestTimestamp = trace.timestamp;
      entry.latestTraceId = trace.id;
    }
  }

  const byEndpoint = Array.from(endpointMap.values()).map((entry) => ({
    ...entry,
    avgDuration: entry.completedCount ? round(entry.durationTotal / entry.completedCount) : 0,
    avgDbQueries: entry.count ? round(entry.dbQueryTotal / entry.count) : 0,
    errorRate: entry.count ? round((entry.errorCount / entry.count) * 100) : 0,
  }));

  byEndpoint.sort((a, b) => b.avgDuration - a.avgDuration);

  const statusDistribution = Object.entries(statusBuckets)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => ({ bucket, count }));

  return {
    summary: {
      totalRequests: list.length,
      completedRequests: completedCount,
      activeRequests: activeCount,
      avgDurationMs: completedCount ? round(totalDuration / completedCount) : 0,
      maxDurationMs: completedCount
        ? round(Math.max(...list.filter((t) => t.state !== 'active').map((t) => t.duration_ms || 0)))
        : 0,
      totalDbQueries,
      avgDbQueries: list.length ? round(totalDbQueries / list.length) : 0,
      errorCount,
      errorRate: completedCount ? round((errorCount / completedCount) * 100) : 0,
      endpointCount: endpointMap.size,
    },
    byEndpoint,
    topByDuration: [...byEndpoint].sort((a, b) => b.avgDuration - a.avgDuration).slice(0, TOP_ENDPOINTS),
    topByVolume: [...byEndpoint].sort((a, b) => b.count - a.count).slice(0, TOP_ENDPOINTS),
    topByDbQueries: [...byEndpoint].sort((a, b) => b.avgDbQueries - a.avgDbQueries).slice(0, TOP_ENDPOINTS),
    statusDistribution,
  };
}

/**
 * @param {string} label
 * @param {number} [max]
 */
function shortenLabel(label, max = 32) {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

/**
 * @param {SVGElement | string} target
 * @param {object[]} data
 * @param {object} options
 */
function renderHorizontalBarChart(target, data, options) {
  if (typeof d3 === 'undefined' || !data.length) return;

  const svg = typeof target === 'string' ? d3.select(target) : d3.select(target);
  svg.selectAll('*').remove();

  const width = options.width || 480;
  const height = options.height || Math.max(180, data.length * 36 + 48);
  const margin = { top: 8, right: 48, bottom: 24, left: 128 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  svg.attr('viewBox', [0, 0, width, height]);

  const rootG = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.value) || 1])
    .nice()
    .range([0, innerWidth]);

  const y = d3
    .scaleBand()
    .domain(data.map((d) => d.label))
    .range([0, innerHeight])
    .padding(0.22);

  rootG
    .append('g')
    .attr('class', 'chart-axis')
    .call(d3.axisBottom(x).ticks(5).tickSize(-innerHeight))
    .attr('transform', `translate(0,${innerHeight})`);

  rootG.append('g').attr('class', 'chart-axis').call(d3.axisLeft(y).tickSize(0));

  const bars = rootG
    .selectAll('.chart-bar')
    .data(data)
    .join('g')
    .attr('class', 'chart-bar')
    .attr('transform', (d) => `translate(0,${y(d.label)})`)
    .style('cursor', options.onClick ? 'pointer' : null);

  bars
    .append('rect')
    .attr('height', y.bandwidth())
    .attr('width', (d) => x(d.value))
    .attr('fill', (d) => d.color || options.color || '#3b82f6')
    .attr('rx', 4);

  bars
    .append('text')
    .attr('class', 'chart-value')
    .attr('x', (d) => x(d.value) + 6)
    .attr('y', y.bandwidth() / 2)
    .attr('dy', '0.35em')
    .text((d) => `${d.value}${d.suffix || ''}`);

  if (options.onClick) {
    bars.on('click', (_event, d) => options.onClick(d));
  }
}

/**
 * @param {SVGElement | string} target
 * @param {object[]} data
 * @param {object} options
 */
function renderVerticalBarChart(target, data, options) {
  if (typeof d3 === 'undefined' || !data.length) return;

  const svg = typeof target === 'string' ? d3.select(target) : d3.select(target);
  svg.selectAll('*').remove();

  const width = options.width || 360;
  const height = options.height || 220;
  const margin = { top: 12, right: 16, bottom: 36, left: 36 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  svg.attr('viewBox', [0, 0, width, height]);

  const rootG = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.label))
    .range([0, innerWidth])
    .padding(0.28);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.value) || 1])
    .nice()
    .range([innerHeight, 0]);

  rootG
    .append('g')
    .attr('class', 'chart-axis')
    .call(d3.axisLeft(y).ticks(4).tickSize(-innerWidth));

  rootG
    .append('g')
    .attr('class', 'chart-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x));

  const bucketColors = {
    '2xx': '#22c55e',
    '3xx': '#60a5fa',
    '4xx': '#fbbf24',
    '5xx': '#ef4444',
    active: '#ff7a45',
  };

  rootG
    .selectAll('.chart-bar-rect')
    .data(data)
    .join('rect')
    .attr('class', 'chart-bar-rect')
    .attr('x', (d) => x(d.label))
    .attr('y', (d) => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', (d) => innerHeight - y(d.value))
    .attr('fill', (d) => d.color || bucketColors[d.label] || options.color || '#3b82f6')
    .attr('rx', 4);
}

/**
 * @param {HTMLElement} container
 * @param {object} analytics
 * @param {object} [options]
 */
function renderDashboard(container, analytics, options = {}) {
  if (!container) return;

  const { summary, topByDuration, topByVolume, topByDbQueries, statusDistribution } = analytics;
  const onEndpointClick = options.onEndpointClick;

  if (!summary.totalRequests) {
    container.innerHTML = `
      <div class="home-empty">
        ${options.loading ? '' : '<p class="empty-state">No requests captured yet. Hit your app and traces will appear here.</p>'}
      </div>
    `;
    if (options.loading) {
      container.querySelector('.home-empty').innerHTML = options.loaderHtml || 'Loading…';
    }
    return;
  }

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Requests</span>
        <span class="stat-value">${summary.totalRequests}</span>
        <span class="stat-hint">${summary.activeRequests ? `${summary.activeRequests} in flight` : `${summary.endpointCount} endpoints`}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Avg duration</span>
        <span class="stat-value">${summary.avgDurationMs}<span class="stat-unit">ms</span></span>
        <span class="stat-hint">max ${summary.maxDurationMs}ms</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">DB queries</span>
        <span class="stat-value">${summary.totalDbQueries}</span>
        <span class="stat-hint">~${summary.avgDbQueries} per request</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Error rate</span>
        <span class="stat-value ${summary.errorRate > 0 ? 'stat-bad' : 'stat-good'}">${summary.errorRate}<span class="stat-unit">%</span></span>
        <span class="stat-hint">${summary.errorCount} failed</span>
      </div>
    </div>

    <div class="charts-grid">
      <section class="chart-card">
        <h3 class="chart-title">Slowest endpoints <span class="chart-sub">avg duration</span></h3>
        <svg id="chart-duration" class="chart-svg" role="img" aria-label="Average duration by endpoint"></svg>
      </section>
      <section class="chart-card">
        <h3 class="chart-title">Busiest endpoints <span class="chart-sub">request count</span></h3>
        <svg id="chart-volume" class="chart-svg" role="img" aria-label="Request count by endpoint"></svg>
      </section>
      <section class="chart-card">
        <h3 class="chart-title">DB-heavy endpoints <span class="chart-sub">avg queries / request</span></h3>
        <svg id="chart-db" class="chart-svg" role="img" aria-label="Database queries by endpoint"></svg>
      </section>
      <section class="chart-card">
        <h3 class="chart-title">Status mix</h3>
        <svg id="chart-status" class="chart-svg" role="img" aria-label="HTTP status distribution"></svg>
      </section>
    </div>
  `;

  const clickHandler = onEndpointClick
    ? (row) => onEndpointClick(row.raw)
    : null;

  renderHorizontalBarChart('#chart-duration', topByDuration.map((row) => ({
    label: row.label,
    value: row.avgDuration,
    suffix: 'ms',
    color: '#ff7a45',
    raw: row,
  })), {
    width: container.clientWidth > 600 ? Math.floor((container.clientWidth - 48) / 2) : container.clientWidth - 32,
    onClick: clickHandler,
  });

  renderHorizontalBarChart('#chart-volume', topByVolume.map((row) => ({
    label: row.label,
    value: row.count,
    color: '#60a5fa',
    raw: row,
  })), {
    width: container.clientWidth > 600 ? Math.floor((container.clientWidth - 48) / 2) : container.clientWidth - 32,
    onClick: clickHandler,
  });

  renderHorizontalBarChart('#chart-db', topByDbQueries.map((row) => ({
    label: row.label,
    value: row.avgDbQueries,
    color: '#3b82f6',
    raw: row,
  })), {
    width: container.clientWidth > 600 ? Math.floor((container.clientWidth - 48) / 2) : container.clientWidth - 32,
    onClick: clickHandler,
  });

  renderVerticalBarChart('#chart-status', statusDistribution.map((row) => ({
    label: row.bucket,
    value: row.count,
  })), {
    width: container.clientWidth > 600 ? Math.floor((container.clientWidth - 48) / 2) : container.clientWidth - 32,
  });
}

const analyticsApi = {
  computeAnalytics,
  countDbQueries,
  shortenLabel,
  renderDashboard,
  renderHorizontalBarChart,
  renderVerticalBarChart,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = analyticsApi;
} else {
  root.OpenconsAnalytics = analyticsApi;
}
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
