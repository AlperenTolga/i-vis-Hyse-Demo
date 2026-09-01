/**
 * ============================================================================
 *  STORE — the only place that mutates the graph.
 * ============================================================================
 *
 *  Every "add node", "add edge", "edit property" and "delete" in the UI goes
 *  through here. Centralising it buys three things:
 *
 *    1. VALIDATION HAPPENS ONCE. The schema's endpoint rules, the required-
 *       property rules and the acyclicity rule are enforced in one place, so a
 *       new UI affordance (context menu, drag-to-connect, JSON import) cannot
 *       accidentally create an illegal graph.
 *    2. IDs ARE STABLE AND READABLE. `Part#3`, `Issue#1` — you can read an
 *       exported file and a console log without cross-referencing UUIDs.
 *    3. ERRORS ARE VALUES, NOT EXCEPTIONS. Each function returns
 *       `{ok:true, element}` or `{ok:false, error}`. The construction UI needs
 *       to *show* the reason ("contains connects Part → Part, not Part – User"),
 *       so a thrown error would just have to be caught and unwrapped anyway.
 */

import {
  NODE_TYPES, EDGE_TYPES, HIERARCHY_EDGE,
  isEndpointPairValid, validateProps, defaultsFor,
} from '../model/schema.js';
import { wouldCreateCycle } from './hierarchy.js';
import { placeNear } from './layout.js';

/* -------------------------------------------------------------------------- *
 * Identity
 * -------------------------------------------------------------------------- */

/**
 * Next free id for a type: `Part_7`.
 *
 * Derived from what is already in the graph rather than from a module-level
 * counter, so importing a file and then adding a node cannot collide with an
 * id that came out of that file.
 *
 * THE SEPARATOR IS NOT COSMETIC. Ids here must be safe to interpolate into a
 * Cytoscape id selector, because HySE writes its computed coordinates back
 * through one:
 *
 *     // cytoscape.js-hyse/src/spring-embedder.ts
 *     window['cy'].nodes('#' + n.id).scratch("force_directed_pos", {...})
 *
 * An id containing '#' (or '.', ':', a space) turns that into a selector that
 * matches nothing — `'#' + 'Part#1'` is `'#Part#1'`. The scratch is then never
 * written, HySE's position callback returns undefined for every node, and
 * Cytoscape quietly leaves every node where it was. The layout appears to run,
 * reports a time, throws nothing, and does nothing at all. Keep ids to
 * [A-Za-z0-9_].
 */
function nextId(cy, type) {
  let max = 0;
  cy.elements(`[type = "${type}"]`).forEach((el) => {
    const m = /_(\d+)$/.exec(el.id());
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `${type}_${max + 1}`;
}

/** Ids that are safe both as Cytoscape ids and inside a `#id` selector. */
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Keep a caller-supplied id (used when importing a file) only if it is free.
 * Returns null when the id is missing or taken, so the caller falls back to
 * `nextId` and an import can never silently merge two different entities.
 */
function freeId(cy, id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
  return cy.getElementById(id).empty() ? id : null;
}

/* -------------------------------------------------------------------------- *
 * Nodes
 * -------------------------------------------------------------------------- */

/**
 * Create a node of `type` from a raw property form.
 *
 * @param {cytoscape.Core} cy
 * @param {string} type              a key of NODE_TYPES
 * @param {object} raw               values straight out of the form inputs
 * @param {{position?: {x,y}, anchor?: cytoscape.Singular}} [opts]
 * @returns {{ok:true, element}|{ok:false, error, errors?}}
 */
export function createNode(cy, type, raw = {}, opts = {}) {
  const def = NODE_TYPES[type];
  if (!def) return { ok: false, error: `Unknown node type "${type}"` };

  const { ok, errors, values } = validateProps(def, { ...defaultsFor(def), ...raw });
  if (!ok) {
    return { ok: false, error: Object.values(errors)[0], errors };
  }

  const node = cy.add({
    group: 'nodes',
    data: {
      id: freeId(cy, opts.id) || nextId(cy, type),
      type,
      // HySE's directed/satellite split. Written as a number on purpose — see
      // the contract note at the top of graph/layout.js.
      isDirected: def.directed ? 1 : 0,
      ...values,
    },
  });

  if (opts.position) node.position(opts.position);
  else placeNear(cy, node, opts.anchor || null);

  return { ok: true, element: node };
}

/* -------------------------------------------------------------------------- *
 * Edges
 * -------------------------------------------------------------------------- */

/**
 * Create an edge of `type` between two existing nodes.
 *
 * Four rules are enforced, in this order (cheapest and most explanatory first):
 *   1. both endpoints exist;
 *   2. the endpoint *types* are legal for this edge type — undirected types are
 *      accepted in either drag direction and silently normalised to the
 *      schema's canonical orientation (`flip`), so the user never has to
 *      remember whether to start from the Issue or the User;
 *   3. no duplicate: the same relationship twice between the same two entities
 *      is meaningless and just clutters the drawing;
 *   4. for `contains` only: the edge must not close a cycle. A BoM is acyclic
 *      by definition, and HySE's layered pass has no meaningful answer for a
 *      cyclic "hierarchy".
 */
export function createEdge(cy, type, sourceId, targetId, raw = {}, opts = {}) {
  const def = EDGE_TYPES[type];
  if (!def) return { ok: false, error: `Unknown edge type "${type}"` };

  const source = cy.getElementById(sourceId);
  const target = cy.getElementById(targetId);
  if (source.empty() || target.empty()) return { ok: false, error: 'Both endpoints must exist' };

  // --- 2. endpoint types -----------------------------------------------
  const check = isEndpointPairValid(type, source.data('type'), target.data('type'));
  if (!check.ok) return { ok: false, error: check.reason };

  let from = sourceId;
  let to = targetId;
  if (check.flip) { from = targetId; to = sourceId; }

  // --- 3. duplicates ----------------------------------------------------
  if (findEdge(cy, type, from, to, !def.directed)) {
    return { ok: false, error: `These two are already connected by "${def.label}"` };
  }

  // --- 4. acyclicity (hierarchy edges only) -----------------------------
  if (type === HIERARCHY_EDGE) {
    if (from === to) return { ok: false, error: 'A part cannot contain itself' };
    if (wouldCreateCycle(cy, from, to)) {
      return {
        ok: false,
        error: `"${cy.getElementById(to).data('name') || to}" is already an assembly above ` +
               `"${cy.getElementById(from).data('name') || from}" — that would make the BoM cyclic.`,
      };
    }
  }

  const { ok, errors, values } = validateProps(def, { ...defaultsFor(def), ...raw });
  if (!ok) return { ok: false, error: Object.values(errors)[0], errors };

  const edge = cy.add({
    group: 'edges',
    data: {
      id: freeId(cy, opts.id) || nextId(cy, type),
      type,
      source: from,
      target: to,
      ...values,
    },
  });

  return { ok: true, element: edge };
}

/** Existing edge of `type` between two nodes; `either` ignores direction. */
function findEdge(cy, type, a, b, either) {
  const match = cy.edges(`[type = "${type}"]`).filter((e) => {
    const s = e.data('source');
    const t = e.data('target');
    return (s === a && t === b) || (either && s === b && t === a);
  });
  return match.nonempty() ? match.first() : null;
}

/* -------------------------------------------------------------------------- *
 * Updates & deletion
 * -------------------------------------------------------------------------- */

/**
 * Apply an edited property form to an existing element.
 *
 * Properties that were cleared in the form are *removed* rather than set to '',
 * which keeps the exported JSON free of empty keys and lets the inspector tell
 * "not filled in" apart from "deliberately zero".
 */
export function updateElement(ele, raw) {
  const def = ele.isNode() ? NODE_TYPES[ele.data('type')] : EDGE_TYPES[ele.data('type')];
  if (!def) return { ok: false, error: 'Element has no known type' };

  const { ok, errors, values } = validateProps(def, raw);
  if (!ok) return { ok: false, error: Object.values(errors)[0], errors };

  ele.cy().batch(() => {
    for (const p of def.props) {
      if (values[p.key] === undefined) ele.removeData(p.key);
      else ele.data(p.key, values[p.key]);
    }
  });

  return { ok: true, element: ele };
}

/**
 * Delete an element.
 *
 * Cytoscape already removes an edge when either endpoint goes, so a node
 * deletion cascades on its own. We report the count so the UI can say what
 * actually happened ("removed 1 node and 4 edges").
 */
export function deleteElement(ele) {
  const removedEdges = ele.isNode() ? ele.connectedEdges().length : 0;
  ele.remove();
  return { ok: true, removedNodes: ele.isNode() ? 1 : 0, removedEdges: removedEdges || (ele.isEdge() ? 1 : 0) };
}

/* -------------------------------------------------------------------------- *
 * Persistence
 * -------------------------------------------------------------------------- */

const FILE_VERSION = 1;

/**
 * Serialise the graph to a plain object.
 *
 * Positions are kept so a saved BoM reopens exactly as it was laid out — a
 * layout run is not free and the arrangement is often something the engineer
 * tuned by hand. Runtime-only fields (`isDirected`, the collapse badges) are
 * stripped: they are all derivable, and storing them would let a stale file
 * fight the schema.
 */
export function toJSON(cy) {
  const strip = (d) => {
    const { isDirected, hiddenBelow, hiddenAbove, shade, ...rest } = d;
    return rest;
  };

  return {
    format: 'ivis-bom-hyse',
    version: FILE_VERSION,
    nodes: cy.nodes().map((n) => ({ data: strip(n.data()), position: { ...n.position() } })),
    edges: cy.edges().map((e) => ({ data: strip(e.data()) })),
  };
}

/**
 * Replace the graph with the contents of a previously exported object.
 *
 * Import is validated as strictly as interactive construction: an unknown type
 * or a dangling endpoint is dropped and reported rather than poisoning the
 * canvas. Hierarchy edges are additionally re-checked for cycles, because a
 * hand-edited file can easily contain one.
 */
export function fromJSON(cy, json) {
  if (!json || typeof json !== 'object') return { ok: false, error: 'Not a valid file' };
  if (json.format !== 'ivis-bom-hyse') return { ok: false, error: 'Unrecognised file format' };

  const warnings = [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const edges = Array.isArray(json.edges) ? json.edges : [];

  const keptIds = new Set();
  const nodeDefs = [];

  for (const n of nodes) {
    const d = n && n.data;
    if (!d || !d.id || !NODE_TYPES[d.type]) { warnings.push('Skipped a node with unknown type'); continue; }
    if (!SAFE_ID.test(d.id)) {
      // See nextId(): an id with '#' or '.' breaks HySE's `'#' + id` selector.
      warnings.push(`Skipped node "${d.id}" — id must match [A-Za-z][A-Za-z0-9_]*`);
      continue;
    }
    if (keptIds.has(d.id)) { warnings.push(`Duplicate node id "${d.id}" skipped`); continue; }
    keptIds.add(d.id);
    nodeDefs.push({
      group: 'nodes',
      data: { ...d, isDirected: NODE_TYPES[d.type].directed ? 1 : 0 },
      position: n.position && Number.isFinite(n.position.x) ? { ...n.position } : undefined,
    });
  }

  cy.elements().remove();
  cy.add(nodeDefs);

  for (const e of edges) {
    const d = e && e.data;
    if (!d || !EDGE_TYPES[d.type]) { warnings.push('Skipped an edge with unknown type'); continue; }
    if (!keptIds.has(d.source) || !keptIds.has(d.target)) {
      warnings.push(`Skipped edge "${d.id}" — dangling endpoint`);
      continue;
    }
    const { type, source, target, id, ...props } = d;
    const res = createEdge(cy, type, source, target, props, { id });
    if (!res.ok) warnings.push(`Skipped edge "${id || '?'}": ${res.error}`);
  }

  return { ok: true, warnings, nodes: cy.nodes().length, edges: cy.edges().length };
}
