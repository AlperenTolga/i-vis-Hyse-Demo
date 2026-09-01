/**
 * ============================================================================
 *  CY — creating the Cytoscape instance and registering its extensions.
 * ============================================================================
 *
 *  Extensions must be registered on the `cytoscape` *constructor* before any
 *  instance exists; registering twice throws a warning and registering after
 *  the fact silently does nothing. So all of it happens here, once, guarded.
 *
 *  Extensions used, and why:
 *    cytoscape-hyse            the required layout (registered in graph/layout.js,
 *                              kept there so the whole HySE contract lives in
 *                              one file)
 *    cytoscape-context-menus   right-click menus — the natural home for the
 *                              per-element complexity-management commands
 *    cytoscape-edgehandles     drag-from-node-to-node edge construction, which
 *                              is what makes this feel like a diagram editor
 *                              rather than a form
 */

import cytoscape from 'cytoscape';
import contextMenus from 'cytoscape-context-menus';
import edgehandles from 'cytoscape-edgehandles';

import 'cytoscape-context-menus/cytoscape-context-menus.css';

import { stylesheet } from './style.js';
import { registerLayouts } from './layout.js';

let extensionsReady = false;

function registerExtensions() {
  if (extensionsReady) return;
  registerLayouts();            // 'hyse' + 'force-directed'
  cytoscape.use(contextMenus);
  cytoscape.use(edgehandles);
  extensionsReady = true;
}

/**
 * @param {HTMLElement} container
 * @returns {cytoscape.Core}
 */
export function createCy(container) {
  registerExtensions();

  const cy = cytoscape({
    container,
    style: stylesheet,
    elements: [],

    // Interaction tuning. The defaults are built for exploring a fixed graph;
    // we are *authoring* one, so the priorities are different.
    // (`wheelSensitivity` is deliberately left at its default: Cytoscape warns
    //  that any custom value makes zooming behave badly on mainstream mice.)
    minZoom: 0.08,
    maxZoom: 4,
    boxSelectionEnabled: true,
    selectionType: 'single',   // click = inspect exactly one entity (per spec)
    autoungrabify: false,      // nodes must stay draggable during construction
    autounselectify: false,
  });

  // Keep the render canvases in step with the container.
  //
  // Cytoscape sizes its canvases once, from the container's measured box. Our
  // container is a CSS grid cell whose height depends on the toolbar and status
  // bar, so it can still be settling when Cytoscape first measures it — leaving
  // over-tall canvases that overlap the status bar. A ResizeObserver is the
  // reliable fix; the window listener covers browsers without one.
  if (typeof ResizeObserver !== 'undefined') {
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (frame) return;                       // coalesce a burst into one call
      frame = requestAnimationFrame(() => { frame = 0; cy.resize(); });
    });
    ro.observe(container);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => cy.resize());
  }

  // REQUIRED, not a convenience: cytoscape-hyse writes its computed coordinates
  // through `window['cy'].nodes('#' + id)` (see graph/layout.js, CONSTRAINT 2).
  // It doubles as the console handle used in the docs.
  if (typeof window !== 'undefined') window.cy = cy;

  return cy;
}
