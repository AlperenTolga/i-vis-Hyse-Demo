/**
 * ============================================================================
 *  ANALYSIS — the "and analysis" half of "Visual construction & analysis".
 * ============================================================================
 *
 *  Three of the spec's motivating bullets are implemented here:
 *
 *   - "Interactive Impact & Change Analysis: instant visual tracing of how
 *      modifying or replacing a single node propagates up to parent assemblies
 *      and the end product."                            -> showImpact()
 *   - "Clear Multi-Level Lineage & Commonality Detection: exposes shared
 *      sub-assemblies across different product variants at a glance."
 *                                                       -> showCommonality()
 *   - "colour-code nodes by lead time, supplier risk, or cost thresholds, and
 *      quickly spot bottlenecks in deep multi-tier structures."
 *                                                       -> applyColourMode()
 *
 *  All three are *overlays*: they add classes and a `shade` data field and can
 *  be cleared with clearOverlays(). None of them mutates the model, so an
 *  analysis can never corrupt the BoM you are building.
 */

import { rollUp, criticalPath, sharedParts, pathsToRoots, ancestors, HIER_SELECTOR } from './hierarchy.js';
import { HIDDEN_CLASS } from './collapse.js';

const OVERLAY_CLASSES = ['impact', 'impact-source', 'dimmed', 'shared-part', 'critical-path', 'shaded'];

/** Remove every analysis overlay and restore the plain schema colours. */
export function clearOverlays(cy) {
  cy.batch(() => {
    cy.elements().removeClass(OVERLAY_CLASSES.join(' '));
    cy.nodes().removeData('shade');
  });
}

/* ==========================================================================
 * 1. Impact / change analysis
 * ========================================================================== */

/**
 * Highlight everything a change to `node` would ripple into: all of its
 * ancestor assemblies, up to and including the finished products, plus the
 * `contains` edges that carry the propagation. Everything else is dimmed.
 *
 * @returns {{affected:number, products:string[], paths:number}}
 */
export function showImpact(cy, node) {
  clearOverlays(cy);

  const up = ancestors(node);
  const affected = up.union(node);

  // Only the hierarchy edges *between* affected parts are on the path; an edge
  // from an affected part down to an untouched sibling is not propagation.
  const pathEdges = affected.edgesWith(affected).filter(HIER_SELECTOR);

  cy.batch(() => {
    cy.elements().not(`.${HIDDEN_CLASS}`).addClass('dimmed');
    affected.union(pathEdges).removeClass('dimmed').addClass('impact');
    node.removeClass('impact').addClass('impact-source');
  });

  const products = up.filter((n) => n.incomers(HIER_SELECTOR).empty())
    .map((n) => n.data('name') || n.id());

  return {
    affected: up.length,
    products,
    paths: pathsToRoots(node).length,
  };
}

/* ==========================================================================
 * 2. Commonality detection
 * ========================================================================== */

/**
 * Ring every part that is consumed by more than one parent assembly — the
 * standardisation and inventory-consolidation candidates.
 *
 * @returns {Array<{id, name, parents:number}>} sorted by reuse, most first
 */
export function showCommonality(cy) {
  clearOverlays(cy);
  const shared = sharedParts(cy);

  cy.batch(() => {
    shared.addClass('shared-part');
    shared.forEach((n) => n.incomers(HIER_SELECTOR).addClass('impact'));
  });

  return shared
    .map((n) => ({
      id: n.id(),
      name: n.data('name') || n.id(),
      parents: n.incomers(HIER_SELECTOR).sources().length,
    }))
    .sort((a, b) => b.parents - a.parents);
}

/* ==========================================================================
 * 3. Critical path (longest lead time)
 * ========================================================================== */

/**
 * Trace and highlight the longest-lead-time chain beneath `node` — the sequence
 * a planner has to attack to pull a delivery date in.
 */
export function showCriticalPath(cy, node) {
  clearOverlays(cy);

  const path = criticalPath(node);
  const ids = new Set(path.map((n) => n.id()));
  const nodes = cy.collection(path);
  const edges = nodes.edgesWith(nodes).filter(HIER_SELECTOR).filter(
    (e) => ids.has(e.data('source')) && ids.has(e.data('target')),
  );

  cy.batch(() => {
    cy.elements().not(`.${HIDDEN_CLASS}`).addClass('dimmed');
    nodes.union(edges).removeClass('dimmed').addClass('critical-path');
  });

  return {
    days: rollUp(node).leadTime,
    chain: path.map((n) => n.data('name') || n.id()),
  };
}

/* ==========================================================================
 * 4. Colour-by modes
 * ========================================================================== */

export const COLOUR_MODES = {
  none: { label: 'Type (default)' },
  leadTime: { label: 'Lead time (rolled up)', unit: 'days' },
  cost: { label: 'Cost (rolled up)', unit: '$' },
  risk: { label: 'Supplier risk' },
  issues: { label: 'Open issues' },
};

/** Perceptually ordered ramp: cool = good, warm = attention. */
const RAMP = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#dc2626'];

const RISK_COLOUR = { low: '#22c55e', medium: '#eab308', high: '#dc2626' };

/**
 * Recolour Part nodes by a metric.
 *
 * Continuous metrics (cost, lead time) are bucketed by *rank* rather than by
 * absolute value: BoM cost distributions are heavily skewed by one expensive
 * casting, and a linear min..max ramp would paint everything else the same
 * green and show nothing. Ranking guarantees the ramp is actually used.
 *
 * @returns {{mode:string, coloured:number, min?:number, max?:number, missing:number}}
 */
export function applyColourMode(cy, mode) {
  clearOverlays(cy);
  if (mode === 'none' || !COLOUR_MODES[mode]) return { mode: 'none', coloured: 0, missing: 0 };

  const parts = cy.nodes('[type = "Part"]');
  if (parts.empty()) return { mode, coloured: 0, missing: 0 };

  if (mode === 'risk') {
    let coloured = 0;
    let missing = 0;
    cy.batch(() => {
      parts.forEach((n) => {
        const c = RISK_COLOUR[n.data('supplierRisk')];
        if (!c) { missing += 1; return; }
        n.data('shade', c);
        n.addClass('shaded');
        coloured += 1;
      });
    });
    return { mode, coloured, missing };
  }

  const memo = new Map();
  const valueOf = (n) => {
    if (mode === 'leadTime') return rollUp(n, memo).leadTime;
    if (mode === 'cost') return rollUp(n, memo).cost;
    if (mode === 'issues') {
      return n.connectedEdges('[type = "hasIssue"]').connectedNodes('[type = "Issue"]')
        .filter((i) => i.data('status') !== 'resolved' && i.data('status') !== 'closed').length;
    }
    return 0;
  };

  const scored = parts.map((n) => ({ n, v: valueOf(n) })).filter((s) => Number.isFinite(s.v));
  const nonZero = scored.filter((s) => s.v > 0);

  if (nonZero.length === 0) {
    return { mode, coloured: 0, missing: parts.length };
  }

  // Rank-bucketing over the distinct values present.
  const distinct = [...new Set(nonZero.map((s) => s.v))].sort((a, b) => a - b);
  const bucketOf = (v) => {
    const idx = distinct.indexOf(v);
    if (distinct.length === 1) return RAMP.length - 1;
    return Math.round((idx / (distinct.length - 1)) * (RAMP.length - 1));
  };

  cy.batch(() => {
    scored.forEach(({ n, v }) => {
      n.data('shade', v > 0 ? RAMP[bucketOf(v)] : '#3f4757');
      n.addClass('shaded');
    });
  });

  return {
    mode,
    coloured: scored.length,
    missing: parts.length - scored.length,
    min: distinct[0],
    max: distinct[distinct.length - 1],
  };
}

/** Whole-graph figures for the status bar. */
export function graphSummary(cy) {
  const parts = cy.nodes('[type = "Part"]');
  const products = parts.filter((n) => n.incomers(HIER_SELECTOR).empty());
  const memo = new Map();

  let cost = 0;
  let lead = 0;
  products.forEach((p) => {
    const r = rollUp(p, memo);
    cost += r.cost;
    lead = Math.max(lead, r.leadTime);
  });

  return {
    parts: parts.length,
    products: products.length,
    issues: cy.nodes('[type = "Issue"]').length,
    openIssues: cy.nodes('[type = "Issue"]')
      .filter((i) => i.data('status') !== 'resolved' && i.data('status') !== 'closed').length,
    shared: sharedParts(cy).length,
    totalCost: cost,
    maxLeadTime: lead,
  };
}
