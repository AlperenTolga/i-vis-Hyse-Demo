/**
 * ============================================================================
 *  LAYOUT — the HySE integration.
 * ============================================================================
 *
 *  HySE ("Hybrid Spring Embedder", Dogrusoz/Islam/Balci, CGF 2026) is built for
 *  exactly the graph shape this app produces: a mixed graph with a central
 *  directed part and undirected satellites hanging off it. It ranks the
 *  directed core with a dagre-style layered pass and relaxes the undirected
 *  parts with a spring embedder at the same time, so neither half wrecks the
 *  other.
 *
 *  The library is a research prototype and its README is ahead of / behind the
 *  code in a few places. Everything below was established by reading its source
 *  and by measuring the result in a real browser; each constraint is written
 *  down because none of them fail loudly.
 *
 *  ┌────────────────────────────────────────────────────────────────────────┐
 *  │ CONSTRAINT 1 — `data.isDirected` selects the hierarchy                 │
 *  └────────────────────────────────────────────────────────────────────────┘
 *      // cytoscape-hyse.ts
 *      let nodes = eles.nodes().filter(ele => ele.data("isDirected") == 1);
 *      let edges = eles.edges().stdFilter(edge =>
 *            edge.source().data("isDirected") == 1 &&
 *            edge.target().data("isDirected") == 1);
 *
 *  A node joins the layered core only if `data.isDirected === 1`; an edge joins
 *  it only if both endpoints do. For a BoM that is exactly the Part hierarchy.
 *  `tagDirectedness()` re-derives the flag from the schema before every run.
 *
 *  ┌────────────────────────────────────────────────────────────────────────┐
 *  │ CONSTRAINT 2 — element ids must be valid inside a `#id` selector       │
 *  └────────────────────────────────────────────────────────────────────────┘
 *      // spring-embedder.ts
 *      window['cy'].nodes('#' + n.id).scratch("force_directed_pos", {...})
 *
 *  HySE writes its computed coordinates back through a *string-built id
 *  selector* on the *global* `window.cy`. Two consequences:
 *    a) ids may only contain [A-Za-z0-9_] — see nextId() in graph/store.js;
 *    b) `window.cy` must be the instance being laid out. We set it in
 *       graph/cy.js and re-assert it below, because a wrong or missing global
 *       makes the layout silently no-op.
 *
 *  ┌────────────────────────────────────────────────────────────────────────┐
 *  │ CONSTRAINT 3 — `isForceDirected: true` is mandatory                    │
 *  └────────────────────────────────────────────────────────────────────────┘
 *  Without it HySE takes a branch that reads `node.scratch().dagre.x`. That
 *  branch cannot work: the vendored dagre never copies coordinates back to the
 *  input graph (`updateInputGraph` is commented out in src/dagre/layout.js), so
 *  the scratch holds only `{width, height, name}` and `.x` is undefined. For a
 *  satellite the scratch is missing entirely and Cytoscape throws. Every entry
 *  point in the library's own demo sets `isForceDirected = true`; so do we.
 *
 *  ┌────────────────────────────────────────────────────────────────────────┐
 *  │ CONSTRAINT 4 — the library only *applies* positions to the core        │
 *  └────────────────────────────────────────────────────────────────────────┘
 *  The spring embedder computes coordinates for every node, but the final
 *  `nodes.layoutPositions(...)` call is made on the directed subset, so the
 *  satellites' freshly computed positions are left sitting in scratch and never
 *  reach the canvas. (With `animate + fit` they do move — but only as a
 *  side-effect of Cytoscape's `boundingBoxAt`, which stores the *new* position
 *  as the "old" one and therefore fails to restore it. Relying on that is not
 *  acceptable.) `applySatellitePositions()` below reads the scratch and places
 *  them explicitly. Small shim, fully under our control, deterministic.
 *
 *  ┌────────────────────────────────────────────────────────────────────────┐
 *  │ CONSTRAINT 5 — `colorSwappedPair` is inverted, and paints on our nodes │
 *  └────────────────────────────────────────────────────────────────────────┘
 *      // spring-embedder.ts
 *      l.colorSwappedPair = !opts.colorSwappedPair;
 *
 *  The flag is negated on the way in, so passing `false` — or leaving it out —
 *  switches the debug colouring ON. It then writes *inline* styles straight
 *  onto our nodes:
 *
 *      this.cy.getElementById(id).css("border-color", "#eee29b")
 *      n.css("border-color", ""); n.css("border-width", "0")
 *
 *  Inline element style outranks the stylesheet in Cytoscape, so those survive
 *  forever: nodes keep a pale-gold ring or lose their border entirely, and the
 *  selection highlight the spec requires stops being visible. We therefore pass
 *  `colorSwappedPair: true` (to mean "off") AND strip the two properties after
 *  every run, so the stylesheet stays the single source of visual truth.
 *
 *  ┌────────────────────────────────────────────────────────────────────────┐
 *  │ CONSTRAINT 6 — several tuning options are undocumented but required    │
 *  └────────────────────────────────────────────────────────────────────────┘
 *  `coolingCoefficient`, `orderFlipPeriod`, `nodeRepulsionCalculationWidth`,
 *  `fullyCalcRep4Ticks`, `maxNodeDisplacement`, `expansionCoefficient` and
 *  `useFRGridVariant` are read by the algorithm but appear neither in the
 *  README nor in the library's DEFAULT_OPTIONS. Left undefined they propagate
 *  as NaN. The values in HYSE_DEFAULTS are the ones the library's own demo page
 *  ships as its form defaults.
 */

import cytoscape from 'cytoscape';
import hyse from 'cytoscape-hyse';
import { NODE_TYPES } from '../model/schema.js';
import { HIDDEN_CLASS } from './collapse.js';

let registered = false;

/** Register HySE with Cytoscape exactly once, before any instance is created. */
export function registerLayouts() {
  if (registered) return;
  cytoscape.use(hyse);   // adds the 'hyse' and 'force-directed' layouts
  registered = true;
}

/**
 * Stamp `isDirected` onto every node from the schema.
 * Cheap and idempotent, so we simply re-run it before every layout instead of
 * keeping the flag in sync from N different mutation sites.
 */
export function tagDirectedness(cy) {
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const def = NODE_TYPES[n.data('type')];
      // A number, not a boolean: HySE compares with `== 1`.
      n.data('isDirected', def && def.directed ? 1 : 0);
    });
  });
}

/**
 * The library's own demo defaults, with three deliberate changes for BoM data.
 * (Marked ◆.) Everything else is byte-for-byte what demo/index.html ships.
 */
export const HYSE_DEFAULTS = Object.freeze({
  name: 'hyse',

  // See CONSTRAINT 3.
  isForceDirected: true,

  // dagre ranking pass
  nodeSep: 40,
  edgeSep: 20,
  rankSep: 20,
  isManuelRankAndOrder: true,

  // ◆ 20 in the demo. Our Part nodes carry a caption *under* the icon, so at
  //   20 the labels of consecutive ranks overlap.
  rankGap: 70,
  // ◆ 80 in the demo — widened for the same reason, horizontally.
  orderGap: 100,

  // spring embedder
  idealEdgeLength: 50,
  edgeElasticity: 0.45,
  // ◆ 55000 in the demo. Raised because our satellite sub-graphs are dense
  //   (one User is attached to several Issues/Actions/Reports).
  nodeRepulsion: 70000,
  isFastCooling: true,
  coolingCoefficient: 0.7,
  orderFlipPeriod: 5,
  nodeRepulsionCalculationWidth: 10,
  fullyCalcRep4Ticks: 0.01,
  maxNodeDisplacement: 300,
  expansionCoefficient: 3,
  useFRGridVariant: true,
  // ◆ true in the demo. Our nodes carry captions of very different widths
  //   ("ESC 35A" vs "Ball Bearing 8x4x3"); treating them as uniform makes the
  //   ranking pass reserve too little room and the captions collide.
  uniformNodeDimensions: false,
  nodeDimensionsIncludeLabels: true,

  // hierarchy crossing reduction
  swapForceLimit: 15000,
  swapPeriod: 50,
  minPairSwapPeriod: 10,

  performPostProcessing: true,
  displayInitialPositions: false,
  randomizeInitialPositions: true,
  // Inverted inside the library — `true` here means "do NOT colour swapped
  // pairs". See CONSTRAINT 5.
  colorSwappedPair: true,

  // We drive animation and fitting ourselves — see runHyse().
  animate: false,
  fit: false,
  ticksPerFrame: 5,
  tickDelay: 10,
});

/** Used when there is no directed core for HySE to rank. */
const FALLBACK = Object.freeze({
  name: 'cose',
  animate: true,
  animationDuration: 500,
  fit: true,
  padding: 60,
  nodeRepulsion: 12000,
  idealEdgeLength: 90,
});

/** HySE options that the user is allowed to override from the toolbar. */
const TUNABLE = ['rankGap', 'orderGap', 'idealEdgeLength', 'nodeRepulsion', 'numIter'];

/**
 * Undo the inline border styling HySE paints onto nodes while it works.
 * See CONSTRAINT 5. Cheap, idempotent, and it keeps graph/style.js authoritative.
 */
function stripLayoutInlineStyles(nodes) {
  nodes.removeStyle('border-color');
  nodes.removeStyle('border-width');
}

/**
 * Copy the coordinates HySE computed for the satellites out of scratch and onto
 * the canvas. See CONSTRAINT 4.
 *
 * Only nodes the layout itself did not place are touched, and only when the
 * scratch holds finite numbers — a partial or failed run must never be able to
 * fling a node to NaN.
 *
 * @returns {number} how many nodes were placed by this shim
 */
function applySatellitePositions(nodes) {
  let placed = 0;
  nodes.forEach((n) => {
    if (n.data('isDirected') === 1) return;          // already placed by HySE
    const p = n.scratch('force_directed_pos');
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    n.position({ x: p.x, y: p.y });
    placed += 1;
  });
  return placed;
}

/**
 * Run HySE over the currently *visible* graph.
 *
 * Visible-only because collapsed parts are still in the model (that is what
 * makes "expand all" possible), but laying them out would reserve screen space
 * for nodes nobody can see and push visible siblings apart for no reason.
 * Hidden nodes keep their old coordinates and slot back in when expanded.
 *
 * @param {cytoscape.Core} cy
 * @param {object} overrides   any key from HYSE_DEFAULTS (the toolbar sends the
 *                             TUNABLE ones) plus `animate` / `padding`
 * @returns {Promise<{engine:string, nodes:number, satellites:number, ms:number}>}
 */
export function runHyse(cy, overrides = {}) {
  tagDirectedness(cy);

  // CONSTRAINT 2b: the library writes through the global, so make sure it
  // points at this instance even if something else on the page reassigned it.
  if (typeof window !== 'undefined') window.cy = cy;

  const eles = cy.elements().not(`.${HIDDEN_CLASS}`);
  const nodes = eles.nodes();
  if (nodes.length === 0) {
    return Promise.resolve({ engine: 'none', nodes: 0, satellites: 0, ms: 0 });
  }

  const animate = overrides.animate !== false;
  const padding = overrides.padding ?? 60;

  // HySE hands its directed half to a ranking pass; with zero directed nodes
  // there is nothing to rank, so fall back rather than rely on undefined
  // behaviour.
  const directedCount = nodes.filter((n) => n.data('isDirected') === 1).length;
  if (directedCount === 0) return runFallback(cy, eles, nodes, padding);

  const options = { ...HYSE_DEFAULTS };
  for (const k of TUNABLE) {
    if (overrides[k] !== undefined && Number.isFinite(Number(overrides[k]))) {
      options[k] = Number(overrides[k]);
    }
  }

  const started = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (engine, satellites) => {
      if (settled) return;
      settled = true;
      resolve({
        engine, nodes: nodes.length, satellites,
        ms: Math.round(performance.now() - started),
      });
    };

    const afterLayout = () => {
      stripLayoutInlineStyles(nodes);
      const satellites = applySatellitePositions(nodes);
      // We asked HySE not to fit (its fit path is the one that trips over the
      // satellites), so do it here — and animate the *viewport*, which is
      // smooth without needing per-node animations the library cannot drive.
      if (animate) {
        cy.animate({ fit: { eles, padding }, duration: 500, easing: 'ease-out' });
      } else {
        cy.fit(eles, padding);
      }
      finish('hyse', satellites);
    };

    try {
      const layout = eles.layout(options);
      // With `animate: false` HySE emits layoutstop synchronously inside run(),
      // so bind first.
      layout.one('layoutstop', afterLayout);
      layout.run();
      // Safety net for a version that never emits it.
      setTimeout(() => { if (!settled) afterLayout(); }, 15000);
    } catch (err) {
      console.error('[layout] HySE failed; falling back to cose:', err);
      runFallback(cy, eles, nodes, padding).then((r) => finish(`${r.engine} (fallback)`, 0));
    }
  });
}

function runFallback(cy, eles, nodes, padding) {
  const started = performance.now();
  return new Promise((resolve) => {
    const layout = eles.layout({ ...FALLBACK, padding });
    layout.one('layoutstop', () => resolve({
      engine: 'cose', nodes: nodes.length, satellites: 0,
      ms: Math.round(performance.now() - started),
    }));
    layout.run();
    setTimeout(() => resolve({ engine: 'cose', nodes: nodes.length, satellites: 0, ms: 0 }), 8000);
  });
}

/**
 * Place a handful of freshly created nodes without disturbing the rest.
 *
 * A full re-layout after every "Add node" click would make construction
 * unusable — the graph would jump under the cursor. New nodes are dropped near
 * their first neighbour (or in open space) and the user runs the layout when
 * they actually want one.
 */
export function placeNear(cy, node, anchor = null) {
  const ref = anchor || node.neighborhood().nodes().not(node).first();

  if (ref && ref.nonempty && ref.nonempty()) {
    const p = ref.position();
    const angle = (Math.PI * 2 * (hashId(node.id()) % 360)) / 360;
    node.position({ x: p.x + Math.cos(angle) * 160, y: p.y + Math.sin(angle) * 160 });
    return;
  }

  const ext = cy.extent();
  node.position({
    x: (ext.x1 + ext.x2) / 2 + ((hashId(node.id()) % 200) - 100),
    y: (ext.y1 + ext.y2) / 2 + ((hashId(`${node.id()}y`) % 200) - 100),
  });
}

/** Small deterministic hash so placement is stable across reloads. */
function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
