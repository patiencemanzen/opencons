'use strict';

window.OpenconsTimeline = {
  /**
   * @param {object} trace
   */
  render(trace) {
    const container = document.querySelector('#timeline-view .timeline-card');
    container.innerHTML = '';

    const totalDuration = trace.duration_ms || 1;
    let offset = 0;

    const timedNodes = trace.nodes.filter((n) => n.duration_ms != null && n.duration_ms > 0);

    if (timedNodes.length === 0) {
      container.innerHTML = '<p class="empty-state">No timed steps in this trace.</p>';
      return;
    }

    for (const node of timedNodes) {
      const row = document.createElement('div');
      row.className = `timeline-row type-${node.type}`;

      const leftPct = (offset / totalDuration) * 100;
      const widthPct = Math.max((node.duration_ms / totalDuration) * 100, 0.5);
      offset += node.duration_ms;

      row.innerHTML = `
        <span class="timeline-label" title="${escapeAttr(node.label)}">${escapeHtml(node.label)}</span>
        <div class="timeline-bar-track">
          <div class="timeline-bar" style="left:${leftPct}%;width:${widthPct}%"></div>
        </div>
        <span class="timeline-duration">${node.duration_ms}ms</span>
      `;

      container.appendChild(row);
    }
  },
};

/**
 * @param {string} str
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {string} str
 */
function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
