/**
 * ============================================================================
 *  COMPLEXITY MANAGEMENT — collapse / expand up- and downstream.
 * ============================================================================
 *
 *  The spec asks for:
 *    - collapsing the downstream (all sub-parts) of a part
 *    - collapsing the upstream (the ancestors) of a part
 *    - expanding the up/downstream of a part by 1 level, 3 levels, or all
 *
 *  ==========================================================================
 *  1. THE STATE MODEL: a depth budget, not a boolean
 *  ==========================================================================
 *  A boolean "collapsed" flag cannot express "show me 3 levels". So each Part
 *  carries at most two numbers:
 *
 *      data.cutDown = k   show at most k levels of sub-parts below me
 *      data.cutUp   = k   show at most k levels of assemblies above me
 *                         (field absent = no limit)
 *
 *  Every operation in the spec is then one assignment:
 *      collapse downstream        cutDown = 0
 *      expand downstream 1 level  cutDown = 1
 *      expand downstream 3 levels cutDown = 3
 *      expand downstream all      cutDown = (removed)
 *  ...and the same for cutUp. Nothing else in the app hides anything.
 *
 *  ==========================================================================
 *  2. DOWNSTREAM: reachability, because a BoM is a DAG
 *  ==========================================================================
 *  A BoM is a DAG, not a tree: the M4 screw is a sub-part of the frame AND of
 *  the gearbox. If collapsing the frame simply hid "everything below the
 *  frame", the screw would vanish from under the *gearbox* too — a hole in a
 *  branch the user never touched, and the commonality analysis this tool exists
 *  for would be quietly broken.
 *
 *  So downstream visibility is a *best-budget reachability* pass from the
 *  roots. Each root starts with an unlimited budget; entering a node shrinks
 *  the budget to that node's own `cutDown` if it is tighter; children are
 *  entered with one less. A part is visible if ANY route reaches it with
 *  budget left. The screw survives because the gearbox route is untouched,
 *  which is precisely the behaviour a planner expects.
 *
 *  (This is a longest-path relaxation, not a shortest-path one: we keep the
 *  *largest* budget seen for each node, so a generous route always wins over a
 *  stingy one. With `Infinity` as the top element it settles in O(V·E) worst
 *  case and, in practice, one pass.)
 *
 *  ==========================================================================
 *  3. UPSTREAM: explicit, because reachability would make it a no-op
 *  ==========================================================================
 *  The mirror-image rule does NOT work upstream, and it is worth being clear
 *  about why. "Collapse the upstream of the Airframe" is a *focus* request:
 *  hide the assemblies above this part so I can work on it. But in a real BoM
 *  the products above it are also reachable from a dozen other leaves — so a
 *  symmetric reachability rule would keep every one of them and the command
 *  would appear to do nothing.
 *
 *  Downstream asks a structural question ("does anything still consume this
 *  part?"); upstream asks a viewport question ("do I still want to see the
 *  context above this part?"). Different questions, different rules. Upstream
 *  therefore hides exactly the ancestors beyond the requested depth, and any
 *  part left without a visible parent simply becomes a new top-level item.
 *
 *  ==========================================================================
 *  4. SATELLITES: anchored, not merely connected
 *  ==========================================================================
 *  See the ANCHORS block in model/schema.js. Short version: an Issue follows
 *  its Parts, an Action and a Report follow their Issues, and a User is shown
 *  while they still own visible work. Plain connectivity would drag a hidden
 *  part's issue back onto the canvas through a colleague who happens to be
 *  working on something else.
 */

import {
  HIER_SELECTOR, childrenOf, parentsOf, roots, descendants, ancestors,
} from './hierarchy.js';
import { NODE_TYPES, ANCHORS, anchorResolutionOrder } from '../model/schema.js';

/** Class applied to everything the visibility pass decides to hide. */
export const HIDDEN_CLASS = 'cm-hidden';

/** Depth presets offered in the UI, matching the spec's wording. */
export const EXPAND_LEVELS = [
  { levels: 1, label: '1 level' },
  { levels: 3, label: '3 levels' },
  { levels: Infinity, label: 'All' },
];

const SATELLITE_ORDER = anchorResolutionOrder();

export function createComplexityManager(cy, { onChange = () => {} } = {}) {
  /** Node types switched off in the filter panel. */
  const mutedTypes = new Set();

  const cutDownOf = (n) => {
    const v = n.data('cutDown');
    return Number.isFinite(v) ? v : Infinity;
  };
  const cutUpOf = (n) => {
    const v = n.data('cutUp');
    return Number.isFinite(v) ? v : Infinity;
  };

  /* ==================================================================== *
   * Pass 1 — upstream: hide ancestors beyond each part's cutUp
   * ==================================================================== */

  /**
   * Ids of the parts explicitly folded away by an "upstream" request.
   *
   * When several parts carry a cutUp, the results are UNIONed: an explicit
   * request to hide something wins over another node's willingness to show it.
   * That keeps the operation predictable ("collapse upstream really did hide
   * the products") instead of subtly cancelling itself out.
   */
  function hiddenByUpstream() {
    const hidden = new Set();

    cy.nodes('[type = "Part"][cutUp]').forEach((n) => {
      const limit = cutUpOf(n);
      if (!Number.isFinite(limit)) return;

      // BFS upward, recording depth; anything deeper than the limit goes.
      const seen = new Map([[n.id(), 0]]);
      let frontier = [n];
      let depth = 0;

      while (frontier.length) {
        const next = [];
        for (const cur of frontier) {
          parentsOf(cur).forEach((p) => {
            if (seen.has(p.id())) return;
            seen.set(p.id(), depth + 1);
            if (depth + 1 > limit) hidden.add(p.id());
            next.push(p);
          });
        }
        frontier = next;
        depth += 1;
      }
    });

    return hidden;
  }

  /* ==================================================================== *
   * Pass 2 — downstream: best-budget reachability from the roots
   * ==================================================================== */

  /**
   * @param {Set<string>} blocked ids removed by the upstream pass
   * @returns {Set<string>} ids of visible Parts
   */
  function reachableDown(blocked) {
    /** id -> the largest remaining budget any route has delivered so far. */
    const best = new Map();
    const queue = [];

    /** A part is a seed when nothing visible sits above it any more. */
    const seeds = cy.nodes('[type = "Part"]').filter(
      (n) => !blocked.has(n.id())
        && parentsOf(n).every((p) => blocked.has(p.id())),
    );

    seeds.forEach((n) => {
      best.set(n.id(), Infinity);
      queue.push(n);
    });

    while (queue.length) {
      const node = queue.shift();
      // The budget that actually applies here is the tighter of what we
      // arrived with and this node's own limit.
      const budget = Math.min(best.get(node.id()), cutDownOf(node));
      if (budget < 1) continue;              // nothing further may be shown

      childrenOf(node).forEach((c) => {
        if (blocked.has(c.id())) return;
        const arriving = budget - 1;
        const known = best.get(c.id());
        // Relax only on a strictly better route, or the first time we arrive.
        if (known !== undefined && known >= arriving) return;
        best.set(c.id(), arriving);
        queue.push(c);
      });
    }

    return new Set(best.keys());
  }

  /* ==================================================================== *
   * Pass 3 — satellites follow their anchors
   * ==================================================================== */

  function visibleSatellites(visibleIds) {
    const visible = new Set(visibleIds);

    for (const type of SATELLITE_ORDER) {
      const anchorTypes = ANCHORS[type] || [];
      cy.nodes(`[type = "${type}"]`).forEach((n) => {
        const anchorNodes = n.connectedEdges().not(HIER_SELECTOR).connectedNodes()
          .filter((m) => m.id() !== n.id() && anchorTypes.includes(m.data('type')));

        // Not anchored to anything yet -> keep it, you are still building it.
        if (anchorNodes.empty()) { visible.add(n.id()); return; }

        if (anchorNodes.some((a) => visible.has(a.id()))) visible.add(n.id());
      });
    }

    return visible;
  }

  /* ==================================================================== *
   * The single write path
   * ==================================================================== */

  /** Recompute visibility for the whole graph and push it onto the elements. */
  function recompute() {
    const blocked = hiddenByUpstream();
    const parts = reachableDown(blocked);
    const visible = visibleSatellites(parts);

    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const show = visible.has(n.id()) && !mutedTypes.has(n.data('type'));
        n.toggleClass(HIDDEN_CLASS, !show);
      });

      // An edge is drawn only when both endpoints survived. Cytoscape would
      // mostly do this for us; being explicit keeps `:visible` selectors, the
      // element counter and the layout's element set honest.
      cy.edges().forEach((e) => {
        const show = !e.source().hasClass(HIDDEN_CLASS) && !e.target().hasClass(HIDDEN_CLASS);
        e.toggleClass(HIDDEN_CLASS, !show);
      });

      // Badges, so a folded node advertises what it is hiding instead of
      // looking like an ordinary leaf.
      //
      // Written only when the value actually changed: `data()` fires a Cytoscape
      // event per call, and this loop runs over every part on every recompute.
      // Blindly re-writing identical numbers would flood any listener (the
      // inspector re-renders on `data`) with hundreds of no-op events.
      cy.nodes('[type = "Part"]').forEach((n) => {
        const below = descendants(n).filter((d) => d.hasClass(HIDDEN_CLASS)).length;
        const above = ancestors(n).filter((a) => a.hasClass(HIDDEN_CLASS)).length;
        if (n.data('hiddenBelow') !== below) n.data('hiddenBelow', below);
        if (n.data('hiddenAbove') !== above) n.data('hiddenAbove', above);
      });
    });

    const s = stats();
    onChange(s);
    return s;
  }

  function stats() {
    const hiddenNodes = cy.nodes(`.${HIDDEN_CLASS}`).length;
    const hiddenEdges = cy.edges(`.${HIDDEN_CLASS}`).length;
    return {
      totalNodes: cy.nodes().length,
      totalEdges: cy.edges().length,
      visibleNodes: cy.nodes().length - hiddenNodes,
      visibleEdges: cy.edges().length - hiddenEdges,
      hiddenNodes,
      hiddenEdges,
      collapsedDown: cy.nodes('[type = "Part"][cutDown]').length,
      collapsedUp: cy.nodes('[type = "Part"][cutUp]').length,
    };
  }

  /* ==================================================================== *
   * Public operations — each one is a single assignment plus a recompute
   * ==================================================================== */

  const isPart = (n) => n && n.isNode && n.isNode() && n.data('type') === 'Part';

  /** Set (or clear) a depth limit. `Infinity` clears it = "show everything". */
  function setCut(node, field, levels) {
    if (!isPart(node)) return null;
    if (levels === Infinity || levels === null) node.removeData(field);
    else node.data(field, Math.max(0, Math.floor(levels)));
    return recompute();
  }

  const collapseDown = (node) => setCut(node, 'cutDown', 0);
  const collapseUp = (node) => setCut(node, 'cutUp', 0);
  const expandDown = (node, levels = Infinity) => setCut(node, 'cutDown', levels);
  const expandUp = (node, levels = Infinity) => setCut(node, 'cutUp', levels);

  /** True when the node is currently limiting the view in that direction. */
  const isCollapsedDown = (node) => isPart(node) && Number.isFinite(node.data('cutDown'));
  const isCollapsedUp = (node) => isPart(node) && Number.isFinite(node.data('cutUp'));

  /** Fold every assembly — the "show me only the finished products" view. */
  function collapseAllDown() {
    cy.batch(() => {
      cy.nodes('[type = "Part"]').forEach((n) => n.removeData('cutUp'));
      roots(cy).forEach((n) => n.data('cutDown', 0));
    });
    return recompute();
  }

  /** Clear every limit in the graph. */
  function expandAll() {
    cy.batch(() => {
      cy.nodes().forEach((n) => { n.removeData('cutDown'); n.removeData('cutUp'); });
    });
    return recompute();
  }

  /** Filter panel: mute/unmute a whole node type. */
  function setTypeMuted(type, muted) {
    if (!NODE_TYPES[type]) return null;
    if (muted) mutedTypes.add(type); else mutedTypes.delete(type);
    return recompute();
  }

  const isTypeMuted = (type) => mutedTypes.has(type);

  return {
    recompute,
    stats,
    collapseDown,
    collapseUp,
    expandDown,
    expandUp,
    isCollapsedDown,
    isCollapsedUp,
    collapseAllDown,
    expandAll,
    setTypeMuted,
    isTypeMuted,
    HIDDEN_CLASS,
    EXPAND_LEVELS,
  };
}
