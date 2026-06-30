'use strict';

const NODE_COLORS = {
  request: '#6b7280',
  response: '#6b7280',
  middleware: '#ff7a45',
  controller: '#a78bfa',
  branch: '#f59e0b',
  loop: '#ff4d00',
  db: '#3b82f6',
  error: '#ef4444',
  ghost: '#4b5563',
};

const PATH_PALETTE = ['#ff4d00', '#a78bfa', '#60a5fa', '#f472b6', '#fb923c', '#34d399', '#fbbf24'];
const SURFACE_FILL = '#222222';
const SURFACE_STROKE = '#3a3a3a';

const NODE_W = 148;
const NODE_H = 42;
const DB_HUB_W = 228;
const DB_HUB_H = 84;
const DB_QUERY_W = 176;
const DB_QUERY_H = 52;
const DB_QUERY_GAP = 64;
const DB_LANE_OFFSET = 58;
const DB_HUB_GAP = 96;
const DECISION_W = 260;
const DECISION_H = 118;
const GHOST_W = 148;
const GHOST_H = 34;
const GAP_STD = 110;
const GAP_DECISION = 180;
const BRANCH_OFFSET = 92;
const MIN_EDGE_GAP = 48;
const OUTCOME_H = 19;
const CANVAS_PAD = 96;

/** @type {d3.ZoomBehavior | null} */
let activeZoom = null;

/** @type {d3.Selection | null} */
let activeSvg = null;

/** @type {d3.Selection | null} */
let activeRoot = null;

window.OpenconsGraph = {
  /**
   * @param {object} trace
   * @param {(node: object) => void} onNodeSelect
   */
  render(trace, onNodeSelect) {
    const svg = d3.select('#graph-svg');
    svg.selectAll('*').remove();

    const container = document.getElementById('graph-view');
    const width = container.clientWidth;
    const height = container.clientHeight;

    const displayNodes = prepareDisplayNodes(trace.nodes);
    const spine = buildExecutionPath(displayNodes, trace.edges);
    const layout = layoutGraph(displayNodes, trace.edges, spine, width, height);

    svg.attr('viewBox', [0, 0, layout.width, layout.height]);

    const tooltip = document.getElementById('node-tooltip');
    const g = svg.append('g').attr('class', 'graph-root');

    const zoom = d3
      .zoom()
      .scaleExtent([0.02, 16])
      .filter((event) => {
        if (event.type === 'wheel') return true;
        if (event.type.startsWith('touch')) return !event.target.closest?.('.graph-node');
        if (event.button && event.button !== 0) return false;
        if (event.type === 'mousedown') return !event.target.closest?.('.graph-node');
        return true;
      })
      .on('zoom', (event) => g.attr('transform', event.transform));

    svg.call(zoom);
    activeZoom = zoom;
    activeSvg = svg;
    activeRoot = g;

    const defs = svg.append('defs');

    const dotPattern = defs
      .append('pattern')
      .attr('id', 'dot-grid')
      .attr('width', 22)
      .attr('height', 22)
      .attr('patternUnits', 'userSpaceOnUse');
    dotPattern.append('circle').attr('cx', 1).attr('cy', 1).attr('r', 1).attr('fill', '#2a3042');

    const shadow = defs.append('filter').attr('id', 'node-shadow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
    shadow.append('feDropShadow').attr('dx', 0).attr('dy', 2).attr('stdDeviation', 3).attr('flood-color', '#000').attr('flood-opacity', 0.35);

    g.insert('rect', ':first-child')
      .attr('class', 'graph-bg')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', layout.width)
      .attr('height', layout.height)
      .attr('fill', 'url(#dot-grid)');

    g.selectAll('.graph-link')
      .data(layout.links)
      .join('path')
      .attr('class', (d) =>
        ['graph-link', d.active ? 'active' : 'inactive', d.kind || ''].filter(Boolean).join(' ')
      )
      .attr('stroke', (d) => linkColor(d))
      .attr('d', (d) => mindMapLink(d.source, d.target, d.kind));

    const drag = d3
      .drag()
      .clickDistance(5)
      .on('start', function onDragStart(event) {
        event.sourceEvent.stopPropagation();
        d3.select(this).raise().classed('is-dragging', true);
      })
      .on('drag', function onDrag(event, d) {
        const transform = d3.zoomTransform(svg.node());
        d.x += event.dx / transform.k;
        d.y += event.dy / transform.k;
        d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
        refreshGraphLinks(g);
      })
      .on('end', function onDragEnd(event, d) {
        d3.select(this).classed('is-dragging', false);
        if (event.sourceEvent.defaultPrevented) return;
        const dx = event.x - event.subject.x;
        const dy = event.y - event.subject.y;
        if (Math.hypot(dx, dy) < 4 && !d.isGhost) {
          onNodeSelect(d);
        }
      });

    const nodeGroups = g
      .selectAll('.graph-node')
      .data(layout.nodes, (d) => d.id)
      .join(
        (enter) => enter.append('g').classed('node-enter', true),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('class', (d) =>
        [
          'graph-node',
          `type-${d.type}`,
          d.isDecision ? 'is-decision' : '',
          d.isGhost ? 'is-ghost' : '',
          d.onSpine === false ? 'is-stub' : '',
          d.isDbHub ? 'is-db-hub' : '',
          d.isDbQuery ? 'is-db-query' : '',
        ]
          .filter(Boolean)
          .join(' ')
      )
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .call(drag)
      .on('mouseenter', (event, d) => showTooltip(event, d, tooltip))
      .on('mousemove', (event) => moveTooltip(event, tooltip))
      .on('mouseleave', () => hideTooltip(tooltip));

    nodeGroups.each(function drawNode(d) {
      const group = d3.select(this);

      if (d.isGhost) {
        renderGhostNode(group, d);
      } else if (d.isDecision) {
        renderDecisionNode(group, d);
      } else if (d.isDbHub) {
        renderDbHub(group, d);
      } else if (d.type === 'db' || d.isDbQuery) {
        renderDbQueryNode(group, d);
      } else {
        renderStandardNode(group, d);
      }
    });

    requestAnimationFrame(() => {
      fitGraphToView(svg, zoom, g, width, height);
    });
  },

  zoomIn() {
    if (!activeSvg || !activeZoom) return;
    activeSvg.transition().duration(180).call(activeZoom.scaleBy, 1.35);
  },

  zoomOut() {
    if (!activeSvg || !activeZoom) return;
    activeSvg.transition().duration(180).call(activeZoom.scaleBy, 0.74);
  },

  resetView() {
    if (!activeSvg || !activeZoom || !activeRoot) return;
    const container = document.getElementById('graph-view');
    fitGraphToView(activeSvg, activeZoom, activeRoot, container.clientWidth, container.clientHeight);
  },
};

/**
 * @param {object[]} nodes
 */
function prepareDisplayNodes(nodes) {
  return nodes
    .filter((node) => {
      if (node.source?.kind !== 'else') return true;
      return !node.outcomes;
    })
    .map((node) => finalizeBranchOutcomes(node));
}

/**
 * @param {object} node
 */
function finalizeBranchOutcomes(node) {
  if (!node.outcomes?.length) return node;

  if (node.value === false && node.has_else && node.taken_outcome !== 'else') {
    return {
      ...node,
      outcomes: node.outcomes.map((outcome) =>
        outcome.key === 'else'
          ? { ...outcome, label: 'Else block — skipped', taken: false }
          : outcome
      ),
    };
  }

  return node;
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 */
function buildExecutionPath(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  const adjacency = new Map();

  for (const edge of edges) {
    if (edge.parallel) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }

  const start =
    nodes.find((n) => n.type === 'request') ||
    nodes.find((n) => !edges.some((e) => e.to === n.id));

  if (!start) return nodes.map((n) => ({ ...n }));

  const path = [];
  const visited = new Set();
  let current = start.id;

  while (current && !visited.has(current)) {
    visited.add(current);
    const node = byId.get(current);
    if (node) path.push(node);
    const nextIds = adjacency.get(current) || [];
    current = nextIds[0];
  }

  return path;
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {object[]} spine
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 */
function layoutGraph(nodes, edges, spine, viewportWidth, viewportHeight) {
  const base = layoutHorizontalTree(spine, viewportWidth, viewportHeight);
  layoutDbHub(nodes, edges, base);

  const maxY = Math.max(...base.nodes.map((node) => node.y + node.nodeHeight / 2), 0);
  const minY = Math.min(...base.nodes.map((node) => node.y - node.nodeHeight / 2), 0);
  base.height = Math.max(base.height, maxY - minY + CANVAS_PAD * 2);

  return base;
}

/**
 * Route every DB query through one global Database hub:
 * handler → query card → hub → query card → handler
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {{ nodes: object[], links: object[], height: number }} base
 */
function layoutDbHub(nodes, edges, base) {
  const dbNodes = nodes.filter((node) => node.type === 'db');
  if (!dbNodes.length) return;

  const byId = new Map(base.nodes.map((node) => [node.id, node]));
  const parallelEdges = edges.filter((edge) => edge.parallel);
  const spineNodes = base.nodes.filter((node) => node.onSpine);
  const minX = Math.min(...spineNodes.map((node) => node.x), CANVAS_PAD);
  const maxX = Math.max(...spineNodes.map((node) => node.x), CANVAS_PAD + 200);
  const spineY = spineNodes[0]?.y || base.height / 2;
  const hubX = (minX + maxX) / 2;

  const drivers = [...new Set(dbNodes.map((node) => node.driver).filter(Boolean))];
  const parentQueryCount = new Map();
  const layoutQueries = [];

  for (const dbNode of dbNodes) {
    const edge = parallelEdges.find((entry) => entry.to === dbNode.id);
    const parent = edge?.from ? byId.get(edge.from) : null;
    if (!parent) continue;

    const laneIndex = parentQueryCount.get(parent.id) || 0;
    parentQueryCount.set(parent.id, laneIndex + 1);

    layoutQueries.push({
      dbNode,
      parent,
      laneIndex,
    });
  }

  if (!layoutQueries.length) return;

  let maxQueryBottom = spineY;

  for (const entry of layoutQueries) {
    const { dbNode, parent, laneIndex } = entry;
    const queryY = parent.y + parent.nodeHeight / 2 + DB_LANE_OFFSET + laneIndex * DB_QUERY_GAP;
    maxQueryBottom = Math.max(maxQueryBottom, queryY + DB_QUERY_H / 2);

    const layoutQuery = {
      ...dbNode,
      x: parent.x,
      y: queryY,
      lane: laneIndex,
      depth: parent.depth + 0.2,
      onSpine: false,
      isDbQuery: true,
      isDbHub: false,
      isDecision: false,
      isGhost: false,
      parentNodeId: parent.id,
      parentLabel: parent.label,
      nodeWidth: DB_QUERY_W,
      nodeHeight: DB_QUERY_H,
      pathColor: '#3b82f6',
    };

    base.nodes.push(layoutQuery);
    entry.layoutQuery = layoutQuery;
  }

  const hubY = maxQueryBottom + DB_HUB_GAP;
  const hubNode = {
    id: '__db_hub__',
    type: 'db-hub',
    label: 'Database',
    isDbHub: true,
    isDbQuery: false,
    queryCount: layoutQueries.length,
    drivers,
    dbQueries: layoutQueries.map((entry) => entry.dbNode),
    x: hubX,
    y: hubY,
    lane: 0,
    depth: 999,
    onSpine: false,
    isDecision: false,
    isGhost: false,
    nodeWidth: DB_HUB_W,
    nodeHeight: DB_HUB_H,
    pathColor: '#2563eb',
  };

  base.nodes.push(hubNode);

  for (const entry of layoutQueries) {
    const { parent, layoutQuery } = entry;

    base.links.push({ source: parent, target: layoutQuery, active: true, kind: 'db-out' });
    base.links.push({ source: layoutQuery, target: hubNode, active: true, kind: 'db-to-hub' });
    base.links.push({ source: hubNode, target: layoutQuery, active: true, kind: 'db-from-hub' });
    base.links.push({ source: layoutQuery, target: parent, active: true, kind: 'db-return' });
  }
}

/**
 * Horizontal decision-tree layout: flat spine left→right, branches fork locally.
 * @param {object[]} spine
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 */
function layoutHorizontalTree(spine, viewportWidth, viewportHeight) {
  const spineNodes = [];
  const links = [];
  let xCursor = CANVAS_PAD;

  const graphHeight = Math.max(
    viewportHeight,
    BRANCH_OFFSET * 2 + DECISION_H + GHOST_H + CANVAS_PAD * 2
  );
  const spineY = graphHeight / 2;

  spine.forEach((node, depth) => {
    const isDecision = Boolean(node.outcomes?.length);
    const dims = nodeDimensions(node, isDecision);
    const prev = spineNodes[spineNodes.length - 1];
    const gap = prev ? edgeGap(prev.isDecision, isDecision) : 0;

    xCursor += gap;
    const x = xCursor + dims.nodeWidth / 2;

    const layoutNode = {
      ...node,
      x,
      y: spineY,
      lane: 0,
      depth,
      onSpine: true,
      isDecision,
      isGhost: false,
      pathColor: PATH_PALETTE[depth % PATH_PALETTE.length],
      ...dims,
    };

    spineNodes.push(layoutNode);
    xCursor += dims.nodeWidth / 2;

    if (prev) {
      links.push({
        source: prev,
        target: layoutNode,
        active: true,
        kind: 'spine',
      });
    }
  });

  resolveSpineCollisions(spineNodes);

  const layoutNodes = [...spineNodes];

  for (const layoutNode of spineNodes) {
    if (!layoutNode.isDecision) continue;

    for (const outcome of layoutNode.outcomes) {
      if (outcome.taken) continue;

      const above = outcome.key === 'then';
      const branchY = above
        ? spineY - layoutNode.nodeHeight / 2 - BRANCH_OFFSET - GHOST_H / 2
        : spineY + layoutNode.nodeHeight / 2 + BRANCH_OFFSET + GHOST_H / 2;

      const ghost = {
        id: `${layoutNode.id}__ghost__${outcome.key}`,
        type: 'ghost',
        label: outcome.label,
        summary: 'Not taken',
        x: layoutNode.x,
        y: branchY,
        lane: 0,
        depth: layoutNode.depth + 0.35,
        onSpine: false,
        isGhost: true,
        isDecision: false,
        nodeWidth: GHOST_W,
        nodeHeight: GHOST_H,
        outcomeKey: outcome.key,
        branchAbove: above,
        pathColor: layoutNode.pathColor,
      };

      layoutNodes.push(ghost);
      links.push({
        source: layoutNode,
        target: ghost,
        active: false,
        kind: 'branch',
        branchKey: outcome.key,
        branchAbove: above,
      });
    }
  }

  const last = spineNodes[spineNodes.length - 1];
  const graphWidth = last
    ? Math.max(viewportWidth, last.x + last.nodeWidth / 2 + CANVAS_PAD)
    : viewportWidth;

  return {
    nodes: layoutNodes,
    links,
    width: graphWidth,
    height: graphHeight,
  };
}

/**
 * Empty space between the right edge of one node and the left edge of the next.
 * @param {boolean} prevIsDecision
 * @param {boolean} nextIsDecision
 */
function edgeGap(prevIsDecision, nextIsDecision) {
  const preferred = prevIsDecision || nextIsDecision ? GAP_DECISION : GAP_STD;
  return preferred + MIN_EDGE_GAP;
}

/**
 * Push spine nodes apart so bounding boxes never overlap.
 * @param {object[]} spineNodes
 */
function resolveSpineCollisions(spineNodes) {
  for (let i = 1; i < spineNodes.length; i += 1) {
    const prev = spineNodes[i - 1];
    const curr = spineNodes[i];
    const requiredGap = edgeGap(prev.isDecision, curr.isDecision);
    const actualGap = curr.x - prev.x - prev.nodeWidth / 2 - curr.nodeWidth / 2;
    const shift = requiredGap - actualGap;

    if (shift > 0) {
      for (let j = i; j < spineNodes.length; j += 1) {
        spineNodes[j].x += shift;
      }
    }
  }
}

/**
 * @param {object} node
 * @param {boolean} isDecision
 */
function nodeDimensions(node, isDecision) {
  if (isDecision) {
    return { nodeWidth: DECISION_W, nodeHeight: DECISION_H };
  }

  return { nodeWidth: NODE_W, nodeHeight: NODE_H };
}

/**
 * @param {object} link
 */
function linkColor(link) {
  if (link.kind?.startsWith('db-')) return NODE_COLORS.db;
  if (!link.active) return link.target.pathColor || '#4b5563';
  return link.target.pathColor || link.source.pathColor || PATH_PALETTE[0];
}

/**
 * Smooth mind-map style connectors.
 * @param {object} source
 * @param {object} target
 * @param {string} [kind]
 */
function mindMapLink(source, target, kind) {
  const sw = source.nodeWidth / 2;
  const tw = target.nodeWidth / 2;

  if (kind === 'branch') {
    const above = target.y < source.y;
    const startY = above ? source.y - source.nodeHeight / 2 : source.y + source.nodeHeight / 2;
    const endY = above ? target.y + target.nodeHeight / 2 : target.y - target.nodeHeight / 2;
    const bulge = 56;
    return `M${source.x},${startY} C${source.x + bulge},${startY} ${target.x + bulge},${endY} ${target.x},${endY}`;
  }

  if (kind === 'db-out') {
    const x1 = source.x;
    const y1 = source.y + source.nodeHeight / 2;
    const x2 = target.x;
    const y2 = target.y - target.nodeHeight / 2;
    const midY = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
  }

  if (kind === 'db-to-hub') {
    const x1 = source.x + 10;
    const y1 = source.y + source.nodeHeight / 2;
    const x2 = target.x + 14;
    const y2 = target.y - target.nodeHeight / 2;
    const bend = Math.abs(x2 - x1) * 0.35 + 36;
    return `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
  }

  if (kind === 'db-from-hub') {
    const x1 = source.x - 10;
    const y1 = source.y - source.nodeHeight / 2;
    const x2 = target.x - 14;
    const y2 = target.y + target.nodeHeight / 2;
    const bend = Math.abs(x2 - x1) * 0.25 + 28;
    return `M${x1},${y1} C${x1},${y1 - bend} ${x2},${y2 + bend} ${x2},${y2}`;
  }

  if (kind === 'db-return') {
    const x1 = source.x;
    const y1 = source.y - source.nodeHeight / 2;
    const x2 = target.x;
    const y2 = target.y - target.nodeHeight / 2;
    const lift = Math.max(42, Math.abs(y2 - y1) * 0.45);
    return `M${x1},${y1} C${x1 - 28},${y1 - lift} ${x2 + 28},${y2 - lift} ${x2},${y2}`;
  }

  const x1 = source.x + sw;
  const x2 = target.x - tw;
  const y1 = source.y;
  const y2 = target.y;
  const curve = Math.max(50, (x2 - x1) * 0.5);

  return `M${x1},${y1} C${x1 + curve},${y1} ${x2 - curve},${y2} ${x2},${y2}`;
}

function renderStandardNode(group, d) {
  const halfW = NODE_W / 2;
  const halfH = NODE_H / 2;
  const accent = d.pathColor || NODE_COLORS[d.type] || NODE_COLORS.middleware;
  const isRoot = d.type === 'request';
  const w = isRoot ? NODE_W + 12 : NODE_W;
  const h = isRoot ? NODE_H + 6 : NODE_H;
  const hw = w / 2;
  const hh = h / 2;

  group.attr('filter', 'url(#node-shadow)');

  group
    .append('rect')
    .attr('x', -hw)
    .attr('y', -hh)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', hh)
    .attr('fill', SURFACE_FILL)
    .attr('stroke', isRoot ? accent : SURFACE_STROKE)
    .attr('stroke-width', isRoot ? 2.5 : 1.5);

  group
    .append('rect')
    .attr('x', -hw)
    .attr('y', -hh)
    .attr('width', 5)
    .attr('height', h)
    .attr('rx', 2)
    .attr('fill', accent);

  group
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#e8eaf0')
    .attr('font-size', isRoot ? 12 : 11)
    .attr('font-weight', 600)
    .text(truncate(shortNodeTitle(d), 20));

  const caption = typeCaption(d);
  if (caption) {
    group
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', hh + 14)
      .attr('fill', '#8b90a5')
      .attr('font-size', 9.5)
      .text(caption);
  }
}

/**
 * @param {d3.Selection} group
 * @param {object} d
 */
function renderDecisionNode(group, d) {
  const halfW = DECISION_W / 2;
  const halfH = DECISION_H / 2;
  const accent = d.pathColor || NODE_COLORS.branch;

  group.attr('filter', 'url(#node-shadow)');

  group
    .append('rect')
    .attr('class', 'decision-card')
    .attr('x', -halfW)
    .attr('y', -halfH)
    .attr('width', DECISION_W)
    .attr('height', DECISION_H)
    .attr('rx', 14)
    .attr('fill', SURFACE_FILL)
    .attr('stroke', accent)
    .attr('stroke-width', 2.5);

  group
    .append('text')
    .attr('class', 'decision-eyebrow')
    .attr('text-anchor', 'middle')
    .attr('x', 0)
    .attr('y', -halfH + 16)
    .attr('fill', accent)
    .attr('font-size', 9)
    .attr('font-weight', 700)
    .attr('letter-spacing', '0.06em')
    .text('DECISION');

  group
    .append('text')
    .attr('class', 'decision-title')
    .attr('text-anchor', 'middle')
    .attr('x', 0)
    .attr('y', -halfH + 34)
    .attr('fill', '#f3f4f6')
    .attr('font-size', 11)
    .attr('font-weight', 600)
    .call(wrapText, DECISION_W - 22, 2);

  group.select('.decision-title').text(shortNodeTitle(d));

  const summary = d.summary || '';
  if (summary) {
    group
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('x', 0)
      .attr('y', -halfH + 56)
      .attr('fill', '#9ca3af')
      .attr('font-size', 10)
      .text(truncate(summary, 38));
  }

  const outcomes = d.outcomes || [];
  const startY = -halfH + (summary ? 72 : 64);

  outcomes.forEach((outcome, index) => {
    const y = startY + index * OUTCOME_H;
    const taken = Boolean(outcome.taken);
    const chipColor = taken ? '#22c55e' : '#4b5563';

    group
      .append('rect')
      .attr('class', `outcome-pill${taken ? ' taken' : ''}`)
      .attr('x', -halfW + 10)
      .attr('y', y - 12)
      .attr('width', DECISION_W - 20)
      .attr('height', 16)
      .attr('rx', 8)
      .attr('fill', taken ? 'rgba(34, 197, 94, 0.15)' : 'rgba(75, 85, 99, 0.12)')
      .attr('stroke', chipColor)
      .attr('stroke-width', 1)
      .attr('opacity', taken ? 1 : 0.65);

    group
      .append('text')
      .attr('x', -halfW + 16)
      .attr('y', y)
      .attr('fill', taken ? '#bbf7d0' : '#9ca3af')
      .attr('font-size', 9.5)
      .attr('font-weight', taken ? 700 : 500)
      .text(`${taken ? '✓' : '○'} ${truncate(outcome.label, 32)}`);
  });
}

/**
 * @param {d3.Selection} group
 * @param {object} d
 */
function renderDbHub(group, d) {
  const halfW = DB_HUB_W / 2;
  const halfH = DB_HUB_H / 2;
  const driverLabel = describeDbDrivers(d.drivers);
  const queryLabel = d.queryCount === 1 ? '1 query' : `${d.queryCount} queries`;

  group.attr('filter', 'url(#node-shadow)');

  group
    .append('rect')
    .attr('x', -halfW)
    .attr('y', -halfH)
    .attr('width', DB_HUB_W)
    .attr('height', DB_HUB_H)
    .attr('rx', 16)
    .attr('fill', 'rgba(37, 99, 235, 0.18)')
    .attr('stroke', '#2563eb')
    .attr('stroke-width', 2.5);

  group
    .append('rect')
    .attr('x', -halfW)
    .attr('y', -halfH)
    .attr('width', DB_HUB_W)
    .attr('height', 8)
    .attr('rx', 16)
    .attr('fill', '#3b82f6');

  group
    .append('ellipse')
    .attr('cx', -halfW + 28)
    .attr('cy', -6)
    .attr('rx', 16)
    .attr('ry', 5)
    .attr('fill', 'rgba(147, 197, 253, 0.35)')
    .attr('stroke', '#93c5fd')
    .attr('stroke-width', 1.2);

  group
    .append('rect')
    .attr('x', -halfW + 12)
    .attr('y', -2)
    .attr('width', 32)
    .attr('height', 28)
    .attr('rx', 4)
    .attr('fill', 'rgba(30, 58, 138, 0.55)')
    .attr('stroke', '#60a5fa')
    .attr('stroke-width', 1.5);

  group
    .append('text')
    .attr('x', -halfW + 56)
    .attr('y', -14)
    .attr('fill', '#eff6ff')
    .attr('font-size', 13)
    .attr('font-weight', 700)
    .text('Database');

  group
    .append('text')
    .attr('x', -halfW + 56)
    .attr('y', 2)
    .attr('fill', '#bfdbfe')
    .attr('font-size', 9.5)
    .text(truncate(driverLabel, 24));

  group
    .append('text')
    .attr('x', -halfW + 56)
    .attr('y', 18)
    .attr('fill', '#93c5fd')
    .attr('font-size', 9)
    .text(queryLabel);

  group
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('y', halfH - 12)
    .attr('fill', '#7dd3fc')
    .attr('font-size', 8.5)
    .attr('font-weight', 600)
    .text('All queries route here');
}

/**
 * @param {string[]} [drivers]
 */
function describeDbDrivers(drivers) {
  if (!drivers?.length) return 'SQL datastore';

  const labels = drivers.map((driver) => {
    if (driver === 'drizzle') return 'Drizzle';
    if (driver === 'pg') return 'PostgreSQL';
    if (driver === 'mysql2') return 'MySQL';
    if (driver === 'prisma') return 'Prisma';
    if (driver === 'mongoose') return 'MongoDB';
    return driver;
  });

  return labels.join(' · ');
}

function renderDbQueryNode(group, d) {
  const halfW = DB_QUERY_W / 2;
  const halfH = DB_QUERY_H / 2;
  const lang = window.OpenconsDbLanguage;
  const icon = lang ? lang.dbActionIcon(d) : '◎';
  const title = lang ? lang.dbNodeTitle(d) : d.label || 'Query';
  const intent = lang ? lang.dbNodeIntent(d) : 'Database query';
  const result = lang ? lang.dbNodeResult(d) : d.summary || '';
  const failed = Boolean(d.exit_reason);

  group.attr('filter', 'url(#node-shadow)');

  group
    .append('rect')
    .attr('x', -halfW)
    .attr('y', -halfH)
    .attr('width', DB_QUERY_W)
    .attr('height', DB_QUERY_H)
    .attr('rx', 11)
    .attr('fill', failed ? 'rgba(239, 68, 68, 0.12)' : 'rgba(59, 130, 246, 0.12)')
    .attr('stroke', failed ? NODE_COLORS.error : '#60a5fa')
    .attr('stroke-width', 1.8);

  group
    .append('text')
    .attr('x', -halfW + 12)
    .attr('y', -10)
    .attr('fill', '#93c5fd')
    .attr('font-size', 10)
    .attr('font-weight', 700)
    .text(icon);

  group
    .append('text')
    .attr('x', -halfW + 26)
    .attr('y', -10)
    .attr('fill', '#eff6ff')
    .attr('font-size', 10)
    .attr('font-weight', 700)
    .text(truncate(title, 18));

  group
    .append('text')
    .attr('x', -halfW + 12)
    .attr('y', 6)
    .attr('fill', '#bfdbfe')
    .attr('font-size', 8.8)
    .text(truncate(intent, 26));

  const footer = [];
  if (result) footer.push(truncate(result, 22));
  if (d.duration_ms != null) footer.push(`${d.duration_ms}ms`);

  group
    .append('text')
    .attr('x', -halfW + 12)
    .attr('y', 20)
    .attr('fill', failed ? '#fca5a5' : '#7dd3fc')
    .attr('font-size', 8.5)
    .attr('font-weight', 600)
    .text(footer.join(' · '));
}

function renderGhostNode(group, d) {
  const halfW = GHOST_W / 2;
  const halfH = GHOST_H / 2;
  const accent = d.pathColor || '#4b5563';

  group
    .append('rect')
    .attr('x', -halfW)
    .attr('y', -halfH)
    .attr('width', GHOST_W)
    .attr('height', GHOST_H)
    .attr('rx', halfH)
    .attr('fill', 'rgba(30, 34, 48, 0.6)')
    .attr('stroke', accent)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 4')
    .attr('opacity', 0.85);

  group
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#9ca3af')
    .attr('font-size', 9.5)
    .attr('font-weight', 500)
    .text(truncate(d.label, 28));
}

/**
 * @param {object} node
 */
function shortNodeTitle(node) {
  if (node.condition) {
    const text = node.condition.length > 56 ? `${node.condition.slice(0, 56)}…` : node.condition;
    return text;
  }

  return displayNodeTitle(node);
}

/**
 * @param {object} node
 */
function displayNodeTitle(node) {
  if (node.label) return node.label;
  return node.type;
}

/**
 * @param {object} node
 */
function typeCaption(node) {
  if (node.duration_ms != null) return `${node.duration_ms}ms`;
  if (node.summary) return truncate(node.summary, 22);
  return node.type;
}

/**
 * @param {MouseEvent} event
 * @param {object} node
 * @param {HTMLElement} tooltip
 */
function showTooltip(event, node, tooltip) {
  if (node.isGhost) {
    tooltip.innerHTML = `<dt>Skipped branch</dt><dd>${escapeHtml(node.label)}</dd>`;
    tooltip.classList.remove('hidden');
    moveTooltip(event, tooltip);
    return;
  }

  const lines = [`<dt>Step</dt><dd>${escapeHtml(displayNodeTitle(node))}</dd>`];

  if (node.summary) {
    lines.push(`<dt>What happened</dt><dd>${escapeHtml(node.summary)}</dd>`);
  }

  if (node.condition) {
    lines.push(`<dt>Condition</dt><dd>${escapeHtml(node.condition)}</dd>`);
  }

  if (node.duration_ms != null) {
    lines.push(`<dt>Duration</dt><dd>${node.duration_ms}ms</dd>`);
  }

  if (node.outcomes?.length) {
    const outcomeText = node.outcomes
      .map((outcome) => `${outcome.taken ? '✓' : '○'} ${escapeHtml(outcome.label)}`)
      .join('<br>');
    lines.push(`<dt>Branches</dt><dd>${outcomeText}</dd>`);
  }

  if (node.type === 'db-hub') {
    lines.push(`<dt>Role</dt><dd>Central database — every query routes through here</dd>`);
    lines.push(`<dt>Stack</dt><dd>${escapeHtml(describeDbDrivers(node.drivers))}</dd>`);
    if (node.dbQueries?.length) {
      const queryLines = node.dbQueries
        .map((query) => {
          const lang = window.OpenconsDbLanguage;
          const title = lang ? lang.dbNodeTitle(query) : query.label;
          const result = lang ? lang.dbNodeResult(query) : query.db_result;
          return `${escapeHtml(title)} → ${escapeHtml(result)}`;
        })
        .join('<br>');
      lines.push(`<dt>Queries</dt><dd>${queryLines}</dd>`);
    }
  }

  if (node.type === 'db' || node.isDbQuery) {
    const lang = window.OpenconsDbLanguage;
    const intent = lang ? lang.dbNodeIntent(node) : node.db_intent;
    const result = lang ? lang.dbNodeResult(node) : node.db_result;

    if (node.parentLabel) {
      lines.push(`<dt>From</dt><dd>${escapeHtml(node.parentLabel)}</dd>`);
    }
    if (intent) lines.push(`<dt>Sent to database</dt><dd>${escapeHtml(intent)}</dd>`);
    if (result) lines.push(`<dt>Came back with</dt><dd>${escapeHtml(result)}</dd>`);
    if (node.query) lines.push(`<dt>SQL</dt><dd>${escapeHtml(node.query)}</dd>`);
    if (node.params) {
      lines.push(`<dt>Parameters</dt><dd>${escapeHtml(JSON.stringify(node.params))}</dd>`);
    }
    if (node.rows != null) lines.push(`<dt>Rows</dt><dd>${node.rows}</dd>`);
    if (node.driver) lines.push(`<dt>Driver</dt><dd>${escapeHtml(node.driver)}</dd>`);
  }

  if (node.source?.file) {
    const loc =
      node.source.line != null ? `${node.source.file}:${node.source.line}` : node.source.file;
    lines.push(`<dt>Source</dt><dd>${escapeHtml(loc)}</dd>`);
  }

  tooltip.innerHTML = lines.join('');
  tooltip.classList.remove('hidden');
  moveTooltip(event, tooltip);
}

/**
 * @param {d3.Selection} root
 */
function refreshGraphLinks(root) {
  root.selectAll('.graph-link').attr('d', (link) => mindMapLink(link.source, link.target, link.kind));
}

/**
 * @param {d3.Selection} svg
 * @param {d3.ZoomBehavior} zoom
 * @param {d3.Selection} g
 * @param {number} width
 * @param {number} height
 */
function fitGraphToView(svg, zoom, g, width, height) {
  const bounds = g.node()?.getBBox?.();
  if (!bounds || bounds.width === 0) return;

  const padding = 48;
  const scaleX = (width - padding * 2) / bounds.width;
  const scaleY = (height - padding * 2) / bounds.height;
  let scale = Math.min(scaleX, scaleY);

  // Keep text readable — don't shrink the whole graph into a blur.
  const MIN_READABLE_SCALE = 0.72;
  scale = Math.max(MIN_READABLE_SCALE, Math.min(scale, 1));

  let tx;
  if (bounds.width * scale > width - padding * 2) {
    tx = padding - bounds.x * scale;
  } else {
    tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
  }

  const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;

  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

/**
 * @param {d3.Selection} text
 * @param {number} width
 * @param {number} maxLines
 */
function wrapText(text, width, maxLines) {
  text.each(function wrap() {
    const self = d3.select(this);
    const words = self.text().split(/\s+/).filter(Boolean);
    let line = [];
    let lineNumber = 0;
    let tspan = self.text(null).append('tspan').attr('x', 0).attr('dy', 0);

    for (const word of words) {
      line.push(word);
      tspan.text(line.join(' '));
      if (tspan.node().getComputedTextLength() > width) {
        line.pop();
        tspan.text(line.join(' '));
        line = [word];
        lineNumber += 1;
        if (lineNumber >= maxLines) break;
        tspan = self.append('tspan').attr('x', 0).attr('dy', '1.1em').text(word);
      }
    }
  });
}

/**
 * @param {MouseEvent} event
 * @param {HTMLElement} tooltip
 */
function moveTooltip(event, tooltip) {
  const container = document.getElementById('graph-view');
  const rect = container.getBoundingClientRect();

  tooltip.style.left = `${event.clientX - rect.left + 12}px`;
  tooltip.style.top = `${event.clientY - rect.top + 12}px`;
}

/**
 * @param {HTMLElement} tooltip
 */
function hideTooltip(tooltip) {
  tooltip.classList.add('hidden');
}

/**
 * @param {string} str
 * @param {number} max
 */
function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * @param {string} str
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
