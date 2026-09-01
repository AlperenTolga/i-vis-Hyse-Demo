/**
 * ============================================================================
 *  SIDEBAR — palette, legend and filters.
 * ============================================================================
 *
 *  Three jobs, all driven by the schema so none of them can go stale:
 *
 *   PALETTE  one button per node type — the entry point for construction.
 *   LEGEND   what every icon and every line style means. The spec asks for
 *            "distinct icons ... and distinctly styled edges (perhaps with
 *            varying labels)"; a legend is what makes those distinctions
 *            *readable* rather than merely present.
 *   FILTERS  "Visual Filtering": switch a whole node type off. This is the
 *            cheap complexity-management lever that complements the structural
 *            collapse/expand operations — turn off Reports and Actions and the
 *            BoM hierarchy stands alone.
 */

import { NODE_TYPES, EDGE_TYPES } from '../model/schema.js';
import { el, svg, fill } from './dom.js';
import { iconMarkup } from '../graph/icons.js';

export function createSidebar(container, cy, { cm, dialogs }) {
  /* ----------------------------------------------------------- palette -- */

  const palette = el('section', { class: 'side-block' }, [
    el('h3', { text: 'Add node' }),
    el('div', { class: 'palette' }, Object.values(NODE_TYPES).map((def) => el('button', {
      class: 'pal-btn',
      attrs: { title: def.description, style: `--c:${def.color}` },
      on: { click: () => dialogs.openNodeDialog(def.key) },
    }, [
      svg(iconMarkup(def.key, def.color, 18), 'pal-icon'),
      el('span', { text: def.label }),
    ]))),
    el('p', { class: 'side-hint' }, [
      'Connect them with ',
      el('kbd', { text: 'E' }),
      ' (Connect mode) or right-click a node → “Draw edge from here”.',
    ]),
  ]);

  /* ----------------------------------------------------------- filters -- */

  const filters = el('section', { class: 'side-block' }, [
    el('h3', { text: 'Show types' }),
    el('div', { class: 'filters' }, Object.values(NODE_TYPES).map((def) => {
      const box = el('input', {
        type: 'checkbox', checked: true,
        on: {
          change: (e) => {
            cm.setTypeMuted(def.key, !e.target.checked);
            refreshCounts();
          },
        },
      });
      return el('label', { class: 'filter' }, [
        box,
        svg(iconMarkup(def.key, def.color, 14)),
        el('span', { text: def.label }),
        el('span', { class: 'filter-count', dataset: { type: def.key } }),
      ]);
    })),
  ]);

  /* ------------------------------------------------------------ legend -- */

  const legendBlock = el('section', { class: 'side-block' }, [
    el('h3', { text: 'Relationships' }),
    el('div', { class: 'legend' }, Object.values(EDGE_TYPES).map((def) => el('div', {
      class: 'legend-row',
      attrs: { title: def.description },
    }, [
      el('span', {
        class: `legend-line ls-${def.lineStyle}${def.directed ? ' directed' : ''}`,
        attrs: { style: `--c:${def.color}` },
      }),
      el('span', { class: 'legend-label', text: def.label }),
      el('span', { class: 'legend-ends', text: `${def.source} ${def.directed ? '→' : '–'} ${def.target}` }),
    ]))),
    el('p', { class: 'side-hint', text: 'Only “contains” is directed — it is the whole-part hierarchy HySE lays out in ranks. Everything else is an undirected satellite relationship.' }),
  ]);

  fill(container, palette, filters, legendBlock);

  /* --------------------------------------------------------- live count -- */

  function refreshCounts() {
    for (const key of Object.keys(NODE_TYPES)) {
      const slot = container.querySelector(`.filter-count[data-type="${key}"]`);
      if (!slot) continue;
      const total = cy.nodes(`[type = "${key}"]`).length;
      const shown = cy.nodes(`[type = "${key}"]`).filter((n) => !n.hasClass(cm.HIDDEN_CLASS)).length;
      slot.textContent = total === 0 ? '' : (shown === total ? String(total) : `${shown}/${total}`);
    }
  }

  cy.on('add remove', 'node', refreshCounts);
  refreshCounts();

  return { refreshCounts };
}
