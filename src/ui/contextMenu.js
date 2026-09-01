/**
 * ============================================================================
 *  CONTEXT MENU — where the complexity-management operations live.
 * ============================================================================
 *
 *  The spec's complexity operations are all *per part* ("collapse the
 *  downstream of a part", "expand the up/downstream of a part"), so the natural
 *  home for them is the right-click menu on that part, not a toolbar where you
 *  would first have to select something and then hunt for the button.
 *
 *  Menus are CONTEXT-SENSITIVE via each item's `selector`: the collapse
 *  commands only exist on Parts, "Add sub-part" only on Parts, and the canvas
 *  itself gets a different menu (add a node here, run the layout, fit).
 *
 *  Items are also enabled/disabled live in `beforeShow`: offering "Expand
 *  downstream" on a part that has no sub-parts is a dead end, and offering
 *  "Collapse downstream" on one that is already collapsed is a no-op.
 */

import { NODE_TYPES } from '../model/schema.js';
import { EXPAND_LEVELS } from '../graph/collapse.js';
import { childrenOf, parentsOf } from '../graph/hierarchy.js';
import { showImpact, showCriticalPath, clearOverlays } from '../graph/analysis.js';
import { deleteElement, createEdge } from '../graph/store.js';

/** The extension's default submenu arrow is a relative file path that 404s
 *  under a bundler; supply our own inline one. */
const ARROW = {
  src: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12">'
    + '<path d="M4 2.5 8 6l-4 3.5z" fill="#9aa6bd"/></svg>'),
  width: 12,
  height: 12,
};

export function registerContextMenus(cy, { cm, dialogs, edges, onToast, onLayout, onFit }) {
  const levelItems = (id, run) => EXPAND_LEVELS.map((lvl) => ({
    id: `${id}-${lvl.levels}`,
    content: lvl.label,
    selector: 'node[type = "Part"]',
    onClickFunction: (e) => run(e.target, lvl.levels),
  }));

  const instance = cy.contextMenus({
    evtType: 'cxttap',
    submenuIndicator: ARROW,
    menuItemClasses: ['bom-menu-item'],
    contextMenuClasses: ['bom-menu'],
    menuItems: [
      /* ------------------------------------------------ complexity mgmt -- */
      {
        id: 'collapse-down',
        content: 'Collapse downstream (sub-parts)',
        tooltipText: 'Fold away everything this assembly contains',
        selector: 'node[type = "Part"]',
        onClickFunction: (e) => {
          const before = cm.stats().visibleNodes;
          cm.collapseDown(e.target);
          const after = cm.stats().visibleNodes;
          onToast(after === before
            ? 'Nothing folded — every sub-part is still reached through another assembly.'
            : `Folded ${before - after} element(s) away.`, after === before ? 'info' : 'ok');
        },
      },
      {
        id: 'collapse-up',
        content: 'Collapse upstream (ancestors)',
        tooltipText: 'Hide the assemblies this part goes into',
        selector: 'node[type = "Part"]',
        hasTrailingDivider: true,
        onClickFunction: (e) => {
          const before = cm.stats().visibleNodes;
          cm.collapseUp(e.target);
          onToast(`Hid ${before - cm.stats().visibleNodes} ancestor(s).`, 'ok');
        },
      },
      {
        id: 'expand-down',
        content: 'Expand downstream',
        selector: 'node[type = "Part"]',
        submenu: levelItems('expand-down', (n, levels) => {
          cm.expandDown(n, levels);
          onToast(levels === Infinity ? 'Expanded all sub-parts.' : `Showing ${levels} level(s) below.`, 'ok');
        }),
      },
      {
        id: 'expand-up',
        content: 'Expand upstream',
        selector: 'node[type = "Part"]',
        hasTrailingDivider: true,
        submenu: levelItems('expand-up', (n, levels) => {
          cm.expandUp(n, levels);
          onToast(levels === Infinity ? 'Expanded all ancestors.' : `Showing ${levels} level(s) above.`, 'ok');
        }),
      },

      /* ------------------------------------------------------- analysis -- */
      {
        id: 'impact',
        content: 'Impact analysis (trace upward)',
        tooltipText: 'Highlight every assembly a change here would reach',
        selector: 'node[type = "Part"]',
        onClickFunction: (e) => {
          const r = showImpact(cy, e.target);
          onToast(r.affected === 0
            ? 'This is already a top-level product — nothing above it.'
            : `Affects ${r.affected} assembl${r.affected === 1 ? 'y' : 'ies'}, reaching: ${r.products.join(', ')}.`,
          'ok');
        },
      },
      {
        id: 'critical-path',
        content: 'Critical path (longest lead time)',
        selector: 'node[type = "Part"]',
        onClickFunction: (e) => {
          const r = showCriticalPath(cy, e.target);
          onToast(`${r.days} days: ${r.chain.join(' → ')}`, 'ok');
        },
      },
      {
        id: 'clear-overlays',
        content: 'Clear analysis highlight',
        selector: 'node, edge',
        coreAsWell: true,
        hasTrailingDivider: true,
        onClickFunction: () => { clearOverlays(cy); onToast('Highlight cleared.', 'info'); },
      },

      /* --------------------------------------------------- construction -- */
      {
        id: 'add-subpart',
        content: 'Add sub-part here…',
        tooltipText: 'Create a Part and a "contains" edge to it in one step',
        selector: 'node[type = "Part"]',
        onClickFunction: async (e) => {
          const parent = e.target;
          const child = await dialogs.openNodeDialog('Part', { anchor: parent });
          if (!child) return;
          const res = createEdge(cy, 'contains', parent.id(), child.id(), { quantity: 1 });
          if (!res.ok) { onToast(res.error, 'error'); return; }
          cm.recompute();
          onToast(`Added “${child.data('name')}” under “${parent.data('name')}”.`, 'ok');
        },
      },
      {
        id: 'add-issue',
        content: 'Log an issue on this part…',
        selector: 'node[type = "Part"]',
        hasTrailingDivider: true,
        onClickFunction: async (e) => {
          const part = e.target;
          const issue = await dialogs.openNodeDialog('Issue', { anchor: part });
          if (!issue) return;
          const res = createEdge(cy, 'hasIssue', part.id(), issue.id(), { detectedAt: 'assembly' });
          if (!res.ok) { onToast(res.error, 'error'); return; }
          cm.recompute();
          onToast(`Issue logged on “${part.data('name')}”.`, 'ok');
        },
      },

      {
        id: 'draw-edge',
        content: 'Draw edge from here…',
        tooltipText: 'Start one connect gesture without switching to Connect mode',
        selector: 'node',
        hasTrailingDivider: true,
        onClickFunction: (e) => edges.startFrom(e.target),
      },

      /* ------------------------------------------------------- deletion -- */
      {
        id: 'delete-ele',
        content: 'Delete',
        selector: 'node, edge',
        onClickFunction: (e) => {
          const r = deleteElement(e.target);
          cm.recompute();
          onToast(`Deleted 1 element${r.removedEdges ? ` and ${r.removedEdges} edge(s)` : ''}.`, 'ok');
        },
      },

      /* ----------------------------------------------- canvas (no target) -- */
      ...Object.values(NODE_TYPES).map((def, i) => ({
        id: `core-add-${def.key}`,
        content: `Add ${def.label} here…`,
        // No `selector`: the extension reads a falsy selector as "no element
        // gets this item", which combined with coreAsWell makes it canvas-only.
        coreAsWell: true,
        hasTrailingDivider: i === Object.keys(NODE_TYPES).length - 1,
        onClickFunction: (e) => dialogs.openNodeDialog(def.key, { position: { ...e.position } }),
      })),
      {
        id: 'core-layout',
        content: 'Run HySE layout',
        coreAsWell: true,
        onClickFunction: () => onLayout(),
      },
      {
        id: 'core-expand-all',
        content: 'Expand everything',
        coreAsWell: true,
        onClickFunction: () => { cm.expandAll(); onToast('All parts expanded.', 'ok'); },
      },
      {
        id: 'core-fit',
        content: 'Fit to screen',
        coreAsWell: true,
        onClickFunction: () => onFit(),
      },
    ],
  });

  /**
   * Enable/disable per-element items right before the menu opens, so the user
   * is never offered an operation that would do nothing.
   */
  cy.on('cxttap', 'node', (e) => {
    const n = e.target;
    if (n.data('type') !== 'Part') return;

    const hasKids = childrenOf(n).nonempty();
    const hasParents = parentsOf(n).nonempty();

    setEnabled('collapse-down', hasKids && !cm.isCollapsedDown(n));
    setEnabled('collapse-up', hasParents && !cm.isCollapsedUp(n));
    setEnabled('expand-down', hasKids && cm.isCollapsedDown(n));
    setEnabled('expand-up', hasParents && cm.isCollapsedUp(n));
    setEnabled('critical-path', hasKids);
    setEnabled('impact', hasParents);
  });

  function setEnabled(id, on) {
    try { on ? instance.enableMenuItem(id) : instance.disableMenuItem(id); }
    catch { /* the item may not be mounted yet on the very first open */ }
  }

  return instance;
}
