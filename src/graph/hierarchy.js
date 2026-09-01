/**
 * ============================================================================
 *  HIERARCHY — everything that reasons about the Part -> Part DAG.
 * ============================================================================
 *
 *  The BoM's assembly structure is a *directed acyclic graph*, not a tree:
 *  one sub-assembly (an M4 screw, a bearing, a wire harness) is typically used
 *  by several different parents. Every function here is therefore written for a
 *  DAG — it de-duplicates on visit and never assumes a unique parent.
 *
 *  Nothing in this file touches visibility or styling. It is pure graph
 *  reasoning over `contains` edges, which makes it directly unit-testable
 *  (see tools/selftest.mjs).
 *
 *  IMPORTANT: these traversals deliberately ignore whether an element is
 *  currently hidden. Collapsing is a *view* concern; the model must stay whole,
 *  otherwise "expand all" could never find what it had hidden.
 */

import { HIERARCHY_EDGE } from '../model/schema.js';

/** Selector matching the directed whole-part edges only. */
export const HIER_SELECTOR = `edge[type = "${HIERARCHY_EDGE}"]`;

/** Direct children (sub-parts) of a part. */
export function childrenOf(node) {
  return node.outgoers(HIER_SELECTOR).targets();
}

/** Direct parents (the assemblies this part goes into). */
export function parentsOf(node) {
  return node.incomers(HIER_SELECTOR).sources();
}

/** Quantity on a `contains` edge, defaulting to 1 for hand-made edges. */
export function edgeQty(edge) {
  const q = Number(edge.data('quantity'));
  return Number.isFinite(q) && q >= 0 ? q : 1;
}

/**
 * Breadth-first walk over the DAG.
 *
 * @param {cytoscape.Collection} start  one or more seed nodes
 * @param {'down'|'up'} dir             follow children or parents
 * @param {number} maxDepth             how many levels to walk (Infinity = all)
 * @param {(node, depth) => boolean} [stopAt]
 *        called on every node *before* expanding it. Return true to visit the
 *        node but NOT walk past it — this is exactly what a collapsed node
 *        needs, and keeping it as a callback is what lets collapse.js reuse
 *        this one traversal instead of writing its own.
 * @returns {Map<string, number>} id -> depth from the seed (seeds are depth 0)
 */
export function walk(start, dir, maxDepth = Infinity, stopAt = null) {
  const step = dir === 'down' ? childrenOf : parentsOf;
  const depths = new Map();
  let frontier = [];

  start.forEach((n) => {
    depths.set(n.id(), 0);
    frontier.push(n);
  });

  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    const next = [];
    for (const node of frontier) {
      if (stopAt && stopAt(node, depth)) continue; // visited, but a dead end
      step(node).forEach((nb) => {
        if (depths.has(nb.id())) return;          // DAG: reachable by many paths
        depths.set(nb.id(), depth + 1);
        next.push(nb);
      });
    }
    frontier = next;
    depth += 1;
  }

  return depths;
}

/** All strict descendants (sub-parts at any depth). Excludes `node` itself. */
export function descendants(node, maxDepth = Infinity) {
  const d = walk(node, 'down', maxDepth);
  d.delete(node.id());
  return node.cy().collection(
    [...d.keys()].map((id) => node.cy().getElementById(id)),
  );
}

/** All strict ancestors (assemblies this part ends up in). Excludes `node`. */
export function ancestors(node, maxDepth = Infinity) {
  const d = walk(node, 'up', maxDepth);
  d.delete(node.id());
  return node.cy().collection(
    [...d.keys()].map((id) => node.cy().getElementById(id)),
  );
}

/** Parts with no parent — the finished products / top-level assemblies. */
export function roots(cy) {
  return cy.nodes('[type = "Part"]').filter((n) => parentsOf(n).empty());
}

/** Parts with no children — the purchased/raw items. */
export function leaves(cy) {
  return cy.nodes('[type = "Part"]').filter((n) => childrenOf(n).empty());
}

/**
 * Would adding `source -> target` close a cycle?
 *
 * A BoM must stay acyclic (a part cannot contain itself, directly or through
 * any chain) — and HySE's layered core is computed by a dagre-style ranking
 * pass, which does not terminate meaningfully on a cyclic graph. So we refuse
 * the edge at construction time instead of letting the layout misbehave later.
 *
 * The test: a cycle appears iff `source` is already reachable *downstream* of
 * `target`. Self-loops are the degenerate case of that.
 */
export function wouldCreateCycle(cy, sourceId, targetId) {
  if (sourceId === targetId) return true;
  const target = cy.getElementById(targetId);
  if (target.empty()) return false;
  return walk(target, 'down').has(sourceId);
}

/* ==========================================================================
 * BoM analysis
 * ==========================================================================
 * These are the numbers a planner actually opens a BoM for. They are computed
 * on demand from the live graph (no cached denormalised fields to go stale).
 * Each uses an explicit memo Map so a diamond-shaped DAG is not re-walked
 * exponentially.
 */

/**
 * Rolled-up figures for one part, over the whole sub-tree beneath it.
 *
 *   cost        unitCost(self) + Σ children  qty × cost(child)
 *   leadTime    leadTime(self) + max children leadTime(child)
 *               (an assembly cannot start before its slowest input lands, so
 *                lead times take the MAX down a branch, never the sum)
 *   pieces      Σ children qty × (1 + pieces(child))
 *               — total number of physical items consumed to build one of these
 *   distinct    number of distinct part types in the sub-tree, incl. self
 *
 * @returns {{cost:number, leadTime:number, pieces:number, distinct:number,
 *            missingCost:boolean, missingLead:boolean}}
 */
export function rollUp(node, memo = new Map()) {
  const id = node.id();
  const hit = memo.get(id);
  if (hit) return hit;

  // Placeholder guards against re-entering on a (schema-forbidden) cycle.
  const guard = { cost: 0, leadTime: 0, pieces: 0, distinct: 1, missingCost: false, missingLead: false };
  memo.set(id, guard);

  const unitCost = Number(node.data('unitCost'));
  const leadDays = Number(node.data('leadTimeDays'));

  let cost = Number.isFinite(unitCost) ? unitCost : 0;
  let missingCost = !Number.isFinite(unitCost);
  let missingLead = !Number.isFinite(leadDays);
  let maxChildLead = 0;
  let pieces = 0;

  const distinctSet = new Set([id]);

  childrenOf(node).forEach((child) => {
    const edge = node.edgesTo(child).filter(HIER_SELECTOR).first();
    const qty = edge.nonempty() ? edgeQty(edge) : 1;
    const sub = rollUp(child, memo);

    cost += qty * sub.cost;
    pieces += qty * (1 + sub.pieces);
    maxChildLead = Math.max(maxChildLead, sub.leadTime);
    missingCost = missingCost || sub.missingCost;
    missingLead = missingLead || sub.missingLead;

    // distinct part types: union of the sub-tree's ids
    for (const sid of subtreeIds(child, memo)) distinctSet.add(sid);
  });

  const out = {
    cost,
    leadTime: (Number.isFinite(leadDays) ? leadDays : 0) + maxChildLead,
    pieces,
    distinct: distinctSet.size,
    missingCost,
    missingLead,
  };
  memo.set(id, out);
  memo.set(`ids:${id}`, distinctSet);
  return out;
}

/** Ids of a part and everything under it — memoised alongside rollUp. */
function subtreeIds(node, memo) {
  const cached = memo.get(`ids:${node.id()}`);
  if (cached) return cached;
  const set = new Set([node.id()]);
  memo.set(`ids:${node.id()}`, set); // set before recursing (cycle guard)
  childrenOf(node).forEach((c) => {
    for (const id of subtreeIds(c, memo)) set.add(id);
  });
  return set;
}

/**
 * The longest lead-time chain below `node`, as an ordered array of nodes.
 * This is the "critical path" a planner has to attack to pull a date in.
 */
export function criticalPath(node, memo = new Map()) {
  const path = [node];
  let cur = node;
  const seen = new Set([node.id()]);

  for (;;) {
    let best = null;
    let bestLead = -1;
    childrenOf(cur).forEach((c) => {
      if (seen.has(c.id())) return;
      const lead = rollUp(c, memo).leadTime;
      if (lead > bestLead) { bestLead = lead; best = c; }
    });
    if (!best) break;
    seen.add(best.id());
    path.push(best);
    cur = best;
  }
  return path;
}

/**
 * Commonality detection: parts used by more than one parent assembly.
 * These are the standardisation / inventory-consolidation opportunities the
 * spec's "Clear Multi-Level Lineage & Commonality Detection" bullet is about.
 */
export function sharedParts(cy) {
  return cy.nodes('[type = "Part"]').filter((n) => parentsOf(n).length > 1);
}

/**
 * Every distinct path from `node` up to a root, as arrays of nodes.
 * Used by the impact analysis to explain *how* a change reaches a product.
 * Capped, because a wide DAG can have combinatorially many paths.
 */
export function pathsToRoots(node, cap = 50) {
  const out = [];
  const stack = [[node]];

  while (stack.length && out.length < cap) {
    const path = stack.pop();
    const head = path[path.length - 1];
    const ps = parentsOf(head);
    if (ps.empty()) { out.push(path); continue; }
    ps.forEach((p) => {
      if (path.some((n) => n.id() === p.id())) return; // defensive
      stack.push([...path, p]);
    });
  }
  return out;
}
