/**
 * ============================================================================
 *  EDGE DRAWING — drag-to-connect construction.
 * ============================================================================
 *
 *  Uses cytoscape-edgehandles. Two design decisions worth stating:
 *
 *  1. DRAW MODE IS A MODE, NOT ALWAYS-ON.
 *     In edgehandles v4 "draw mode" turns the whole node body into a drag
 *     handle, which means you can no longer drag a node to reposition it. Both
 *     gestures matter while authoring a diagram, so drawing is a toggle (the
 *     Connect button, or the `E` key) and repositioning is the default. The
 *     context menu also offers "Draw edge from here…", which starts a single
 *     gesture without leaving normal mode.
 *
 *  2. EDGEHANDLES DOES NOT GET TO CREATE THE EDGE.
 *     The extension adds an edge itself the moment you release the mouse. But
 *     the spec requires properties to be entered *during construction*, and the
 *     endpoint/cycle/duplicate rules live in the store. So the auto-added edge
 *     is removed immediately and replaced by whatever the dialog + store
 *     produce — or by nothing, if the user cancels.
 *
 *  `canConnect` mirrors the schema, so illegal targets are greyed out *while
 *  dragging* rather than rejected after the fact.
 */

import { edgeTypesFor } from '../model/schema.js';
import { wouldCreateCycle } from '../graph/hierarchy.js';

export function createEdgeDrawing(cy, { dialogs, onToast, onModeChange = () => {} }) {
  const eh = cy.edgehandles({
    snap: true,
    snapThreshold: 40,
    snapFrequency: 15,
    hoverDelay: 120,
    noEdgeEventsInDraw: true,
    disableBrowserGestures: true,

    /**
     * Live legality check, evaluated per candidate target while dragging.
     * Returning false makes edgehandles refuse the target and lets the
     * stylesheet dim it (`node.eh-invalid-target`).
     */
    canConnect: (source, target) => {
      if (source.same(target)) return false;
      if (target.hasClass('cm-hidden')) return false;

      const types = edgeTypesFor(source.data('type'), target.data('type'));
      if (types.length === 0) return false;

      // If "contains" is the ONLY option, a cycle makes the whole drag illegal.
      // If other relationship types are also available, let it through — the
      // dialog will simply not offer "contains".
      if (types.length === 1 && types[0] === 'contains') {
        return !wouldCreateCycle(cy, source.id(), target.id());
      }
      return true;
    },

    // Marked so the placeholder can never be mistaken for a real relationship
    // in the split second before we remove it.
    edgeParams: () => ({ data: { type: '__eh_temp__' }, classes: 'eh-temp' }),
  });

  let drawMode = false;

  function setDrawMode(on) {
    drawMode = Boolean(on);
    if (drawMode) eh.enableDrawMode(); else eh.disableDrawMode();
    document.body.classList.toggle('draw-mode', drawMode);
    onModeChange(drawMode);
  }

  /* ------------------------------------------------------------------ */

  cy.on('ehcomplete', async (_event, source, target, addedEdge) => {
    // Take the extension's edge out before anything else can observe it.
    addedEdge.remove();
    await dialogs.openEdgeDialog(source, target);
  });

  cy.on('ehcancel', (_event, source, cancelledTargets) => {
    if (cancelledTargets && cancelledTargets.length) {
      onToast('That relationship is not part of the graph model.', 'info');
    }
  });

  // Belt and braces: if a temp edge ever survives (an exception mid-gesture),
  // never leave it in the model.
  cy.on('add', 'edge[type = "__eh_temp__"]', (e) => {
    setTimeout(() => { if (!e.target.removed()) e.target.remove(); }, 0);
  });

  /** Start a single connect gesture from one node, without entering the mode. */
  function startFrom(node) {
    eh.start(node);
  }

  // `E` toggles the mode; Escape leaves it. Ignored while typing in a form.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setDrawMode(!drawMode); }
    if (e.key === 'Escape' && drawMode) setDrawMode(false);
  });

  return {
    eh,
    setDrawMode,
    startFrom,
    get drawMode() { return drawMode; },
  };
}
