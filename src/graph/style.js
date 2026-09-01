/**
 * ============================================================================
 *  STYLESHEET — how every node and edge type is drawn.
 * ============================================================================
 *
 *  The spec asks for "distinct icons for each node type and distinctly styled
 *  edges (perhaps with varying labels)". Rather than hand-writing 5 node rules
 *  and 8 edge rules, the bulk of this file is *generated* from the schema, so a
 *  new type in schema.js is drawn correctly the moment it exists.
 *
 *  Each edge type is separated on THREE independent visual channels, because
 *  colour alone is not enough (colour-blind users, printed hand-outs, and edges
 *  that overlap):
 *      1. hue          — from EDGE_TYPES[].color
 *      2. line pattern — solid / dashed / dotted
 *      3. text label   — the relationship name, drawn on the edge
 *  Plus a fourth for the one directed type: `contains` is the only edge with an
 *  arrowhead, so the whole-part hierarchy reads as directed at a glance.
 *
 *  ORDER MATTERS: Cytoscape resolves conflicts by "last matching rule wins",
 *  so this file goes base -> per-type -> state (analysis, selection, hidden).
 */

import { NODE_TYPES, EDGE_TYPES, nodeCaption } from '../model/schema.js';
import { nodeIcon } from './icons.js';
import { HIDDEN_CLASS } from './collapse.js';

const INK = '#e8ecf4';
const PAPER = '#11141b';

/**
 * The caption drawn under a node.
 *
 * For Parts it also carries the collapse badge, so a folded node advertises
 * what it is hiding ("Frame Assembly  ▾7") instead of looking like a leaf.
 * Without this, collapsing is a destructive-looking operation.
 */
function captionFor(ele) {
  const data = ele.data();
  let text = nodeCaption(data);

  if (data.type === 'Part') {
    const below = data.hiddenBelow || 0;
    const above = data.hiddenAbove || 0;
    const badges = [];
    if (below) badges.push(`▾${below}`);
    if (above) badges.push(`▴${above}`);
    if (badges.length) text += `  ${badges.join(' ')}`;
  }
  return text;
}

/* -------------------------------------------------------------------------- *
 * Per-type rules, generated from the schema
 * -------------------------------------------------------------------------- */

const nodeTypeRules = Object.values(NODE_TYPES).map((def) => ({
  selector: `node[type = "${def.key}"]`,
  style: {
    shape: def.shape,
    'background-color': def.color,
    'border-color': def.color,
    // The glyph is drawn white on the type colour. `background-fit: none` with
    // an explicit width keeps every icon optically the same size regardless of
    // the node shape (a diamond has a smaller inscribed box than a rectangle).
    'background-image': nodeIcon(def.key, '#ffffff'),
    'background-image-containment': 'over',
    'background-fit': 'none',
    'background-width': def.key === 'Issue' ? '46%' : '56%',
    'background-height': def.key === 'Issue' ? '46%' : '56%',
    'background-position-x': '50%',
    'background-position-y': def.key === 'Issue' ? '58%' : '50%',
    'background-repeat': 'no-repeat',
  },
}));

/**
 * The text drawn on an edge.
 *
 * For the satellite relationships the type name *is* the information — "created"
 * and "assigned to" run between the same two node types and are otherwise only
 * told apart by line style, so the word has to be there.
 *
 * For `contains` it is the opposite. It is the only directed edge type, the
 * arrowheads already say so, and in a BoM of this size the word would be
 * repeated on ~40 edges that share the same taxi channel — a band of
 * overlapping "contains" across the middle of the drawing. What a planner
 * actually needs to read off a whole-part edge is the QUANTITY, so that is what
 * we draw, and only when it is not the trivial 1.
 */
function edgeLabel(def) {
  if (!def.directed) return def.label;
  return (ele) => {
    const q = Number(ele.data('quantity'));
    return Number.isFinite(q) && q !== 1 ? `×${q}` : '';
  };
}

const edgeTypeRules = Object.values(EDGE_TYPES).map((def) => ({
  selector: `edge[type = "${def.key}"]`,
  style: {
    'line-color': def.color,
    'line-style': def.lineStyle,
    width: def.width,
    label: edgeLabel(def),
    'font-weight': def.directed ? 700 : 400,
    'font-size': def.directed ? 11 : 9,
    color: def.directed ? '#cfe0ff' : '#aeb8cc',
    'target-arrow-color': def.color,
    'target-arrow-shape': def.directed ? 'triangle' : 'none',
    'source-arrow-shape': 'none',
    // The hierarchy uses taxi routing so ranks read as a clean layered tree;
    // satellites keep bezier curves so parallel edges (User "created" vs
    // "assigned to" the same Action) separate instead of overlapping.
    'curve-style': def.directed ? 'taxi' : 'bezier',
    'taxi-direction': 'downward',
    'taxi-turn': 24,
    'taxi-turn-min-distance': 8,
    'control-point-step-size': 46,
  },
}));

export const stylesheet = [
  /* ---------------------------------------------------------------- base -- */
  {
    selector: 'node',
    style: {
      width: 48,
      height: 48,
      'border-width': 2.5,
      'border-opacity': 1,
      label: captionFor,
      color: INK,
      'font-size': 11,
      'font-weight': 600,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'text-wrap': 'wrap',
      'text-max-width': 96,
      'text-outline-width': 3,
      'text-outline-color': PAPER,
      'text-outline-opacity': 0.95,
      'min-zoomed-font-size': 6,
      'overlay-opacity': 0,
      'transition-property': 'background-color, border-color, border-width, opacity',
      'transition-duration': '160ms',
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      width: 2,
      'font-size': 9,
      color: '#aeb8cc',
      'text-outline-width': 3,
      'text-outline-color': PAPER,
      'text-rotation': 'autorotate',
      'text-background-opacity': 0,
      // Stop labels turning into unreadable smudges when the whole BoM is
      // fitted on screen: below 7 effective pixels Cytoscape simply omits them.
      'min-zoomed-font-size': 7,
      'arrow-scale': 1.1,
      'target-distance-from-node': 3,
      'source-distance-from-node': 3,
      'overlay-opacity': 0,
      'transition-property': 'line-color, width, opacity',
      'transition-duration': '160ms',
    },
  },

  /* ------------------------------------------------------ per-type rules -- */
  ...nodeTypeRules,
  ...edgeTypeRules,

  /* -------------------------------------------------- analysis overlays -- */
  // Set by the "Colour by lead time / cost / risk" modes. A data-driven colour
  // needs to beat the per-type rule above, hence its position in this list.
  {
    selector: 'node.shaded',
    style: {
      'background-color': 'data(shade)',
      'border-color': 'data(shade)',
    },
  },
  // Commonality detection: a part used by more than one parent assembly.
  {
    selector: 'node.shared-part',
    style: {
      'border-color': '#fbbf24',
      'border-width': 5,
      'border-style': 'double',
    },
  },
  // Impact analysis: the change propagation path up to the finished products.
  {
    selector: '.impact',
    style: {
      'line-color': '#fbbf24',
      'target-arrow-color': '#fbbf24',
      'border-color': '#fbbf24',
      width: 5,
      'border-width': 5,
      'z-index': 20,
    },
  },
  {
    selector: '.impact-source',
    style: {
      'background-color': '#fbbf24',
      'border-color': '#fde68a',
      'border-width': 6,
    },
  },
  // Everything *not* involved in the current analysis is pushed back rather
  // than hidden, so the user keeps their spatial bearings.
  {
    selector: '.dimmed',
    style: { opacity: 0.13, 'z-index': 0 },
  },
  {
    selector: 'node.critical-path',
    style: { 'border-color': '#f87171', 'border-width': 5 },
  },
  {
    selector: 'edge.critical-path',
    style: { 'line-color': '#f87171', 'target-arrow-color': '#f87171', width: 5, 'z-index': 20 },
  },

  /* -------------------------------------------------- collapse affordance -- */
  {
    selector: 'node[cutDown], node[cutUp]',
    style: {
      'border-style': 'dashed',
      'border-width': 4,
    },
  },

  /* ---------------------------------------------------- edge construction -- */
  // cytoscape-edgehandles draws a temporary node + edge while you drag.
  {
    selector: '.eh-handle',
    style: {
      'background-color': '#22d3ee',
      width: 13, height: 13,
      shape: 'ellipse',
      'overlay-opacity': 0,
      'border-width': 8,
      'border-opacity': 0,
      label: '',
      'background-image': 'none',
    },
  },
  {
    selector: '.eh-hover',
    style: { 'border-color': '#22d3ee', 'border-width': 5 },
  },
  {
    selector: '.eh-source, .eh-target',
    style: { 'border-color': '#22d3ee', 'border-width': 5 },
  },
  {
    selector: '.eh-preview, .eh-ghost-edge',
    style: {
      'line-color': '#22d3ee',
      'target-arrow-color': '#22d3ee',
      'source-arrow-color': '#22d3ee',
      'line-style': 'dashed',
      width: 3,
      label: '',
    },
  },
  {
    selector: '.eh-ghost-edge.eh-preview-active',
    style: { opacity: 0 },
  },
  // The placeholder edge edgehandles adds on release. We delete it immediately
  // (see ui/edgeDraw.js) and hide it meanwhile so it never flashes as a real
  // relationship with the default styling.
  {
    selector: 'edge[type = "__eh_temp__"], .eh-temp',
    style: { opacity: 0, events: 'no', label: '' },
  },
  // Endpoints that would be illegal for the edge type being drawn.
  {
    selector: 'node.eh-invalid-target',
    style: { opacity: 0.2 },
  },

  /* ------------------------------------------------------------ selection -- */
  // Last, so selection always wins over analysis colouring: the spec requires
  // that clicking an entity visibly highlights it.
  {
    selector: 'node:selected',
    style: {
      'border-color': '#ffffff',
      'border-width': 6,
      'border-style': 'solid',
      'overlay-color': '#ffffff',
      'overlay-opacity': 0.12,
      'overlay-padding': 6,
      'z-index': 30,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#ffffff',
      'target-arrow-color': '#ffffff',
      width: 5,
      'z-index': 30,
      color: '#ffffff',
    },
  },

  /* --------------------------------------------------------------- hidden -- */
  // `display: none` (not `visibility`) so hidden elements are excluded from
  // :visible selectors, from the layout, and from hit-testing.
  {
    selector: `.${HIDDEN_CLASS}`,
    style: { display: 'none' },
  },
];

/** Legend rows for the sidebar, derived from the same definitions. */
export const legend = {
  nodes: Object.values(NODE_TYPES).map((d) => ({
    key: d.key, label: d.label, color: d.color, description: d.description,
  })),
  edges: Object.values(EDGE_TYPES).map((d) => ({
    key: d.key,
    label: d.label,
    color: d.color,
    lineStyle: d.lineStyle,
    directed: d.directed,
    endpoints: `${d.source} ${d.directed ? '→' : '–'} ${d.target}`,
    description: d.description,
  })),
};
