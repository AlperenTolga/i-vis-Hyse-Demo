/**
 * ============================================================================
 *  INSPECTOR — the right panel required by the spec.
 * ============================================================================
 *
 *  "The user should be able to inspect any of the graph entities by selecting
 *   (left-clicking on them). Upon selection, the node/edge should be
 *   highlighted, and its properties should be shown on a right panel."
 *
 *  Highlighting is handled by the stylesheet (`node:selected` / `edge:selected`
 *  in graph/style.js) because Cytoscape already maintains selection state — a
 *  second, hand-rolled "highlight" class would only be able to disagree with it.
 *  This module owns the panel.
 *
 *  Beyond the letter of the requirement, the panel is *editable*: a property you
 *  can only read is of little use while you are constructing a BoM, and the
 *  validation path is already there in store.updateElement(). It also carries
 *  the rolled-up BoM figures for a Part, which is what turns "a graph editor"
 *  into "a BoM tool".
 */

import { NODE_TYPES, EDGE_TYPES } from '../model/schema.js';
import { renderForm } from './fields.js';
import { el, svg, fill } from './dom.js';
import { iconMarkup } from '../graph/icons.js';
import { updateElement, deleteElement } from '../graph/store.js';
import { rollUp, parentsOf, childrenOf } from '../graph/hierarchy.js';

const money = (n) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function createInspector(container, cy, { cm, onToast, onFocus }) {
  /** The element currently displayed, so we can re-render after edits. */
  let current = null;

  /* -------------------------------------------------------------- empty -- */

  function renderEmpty() {
    fill(container,
      el('div', { class: 'panel-head' }, [el('h2', { text: 'Inspector' })]),
      el('div', { class: 'empty' }, [
        el('p', { text: 'Left-click any node or edge to inspect it.' }),
        el('ul', { class: 'hint-list' }, [
          el('li', { text: 'Press E (or the Connect button) and drag between two nodes to create an edge.' }),
          el('li', { text: 'Right-click a part for collapse / expand and the analyses.' }),
          el('li', { text: 'L runs the HySE layout, F fits the view, C clears highlights.' }),
        ]),
      ]));
    current = null;
  }

  /* --------------------------------------------------------- an element -- */

  function render(ele) {
    if (!ele || ele.length === 0 || ele.removed()) return renderEmpty();
    current = ele;

    const isNode = ele.isNode();
    const type = ele.data('type');
    const def = isNode ? NODE_TYPES[type] : EDGE_TYPES[type];

    if (!def) {
      fill(container, el('div', { class: 'empty', text: `Unknown type "${type}"` }));
      return;
    }

    const colour = def.color;
    const form = renderForm(def, ele.data(), { onEnter: () => save(form, ele) });

    const head = el('div', { class: 'panel-head' }, [
      el('div', { class: 'insp-title' }, [
        isNode
          ? svg(iconMarkup(type, colour, 20), 'insp-icon')
          : el('span', { class: 'insp-edge-swatch', style: `--c:${colour}` }),
        el('div', {}, [
          el('h2', { text: isNode ? def.label : def.label }),
          el('span', { class: 'insp-sub', text: isNode ? ele.id() : endpointsLabel(ele, def) }),
        ]),
      ]),
      el('p', { class: 'insp-desc', text: def.description || '' }),
    ]);

    const actions = el('div', { class: 'insp-actions' }, [
      el('button', {
        class: 'btn primary', text: 'Save changes',
        on: { click: () => save(form, ele) },
      }),
      el('button', {
        class: 'btn', text: 'Focus',
        attrs: { title: 'Centre the view on this element' },
        on: { click: () => onFocus(ele) },
      }),
      el('button', {
        class: 'btn danger', text: 'Delete',
        on: {
          click: () => {
            const label = describe(ele);
            const res = deleteElement(ele);
            cm.recompute();
            onToast(`Deleted ${label}` + (res.removedEdges ? ` and ${res.removedEdges} edge(s)` : ''), 'ok');
            renderEmpty();
          },
        },
      }),
    ]);

    fill(container,
      head,
      el('div', { class: 'panel-body' }, [
        el('section', {}, [
          el('h3', { text: 'Properties' }),
          ...form.rows,
        ]),
        isNode && type === 'Part' ? partAnalysis(ele) : null,
        connections(ele),
      ]),
      actions);
  }

  function save(form, ele) {
    const res = updateElement(ele, form.values());
    if (!res.ok) {
      form.showErrors(res.errors || {});
      onToast(res.error, 'error');
      return;
    }
    form.showErrors({});
    cy.style().update();      // captions are function mappers; nudge a repaint
    onToast('Saved', 'ok');
    render(ele);              // re-render so derived figures refresh
  }

  /* ------------------------------------------------------ BoM roll-up --- */

  function partAnalysis(node) {
    const r = rollUp(node);
    const parents = parentsOf(node);
    const kids = childrenOf(node);

    const stat = (label, value, warn) => el('div', { class: 'stat' }, [
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: `stat-value${warn ? ' warn' : ''}`, text: value }),
    ]);

    return el('section', {}, [
      el('h3', { text: 'Rolled-up BoM figures' }),
      el('div', { class: 'stats' }, [
        stat('Total cost', money(r.cost), r.missingCost),
        stat('Lead time', `${r.leadTime} d`, r.missingLead),
        stat('Total pieces', String(r.pieces)),
        stat('Distinct parts', String(r.distinct)),
        stat('Used by', `${parents.length} assembl${parents.length === 1 ? 'y' : 'ies'}`),
        stat('Direct sub-parts', String(kids.length)),
      ]),
      (r.missingCost || r.missingLead)
        ? el('p', {
            class: 'note',
            text: 'Some parts in this sub-tree have no '
              + [r.missingCost && 'unit cost', r.missingLead && 'lead time'].filter(Boolean).join(' or ')
              + ' — the figures above are lower bounds.',
          })
        : null,
      parents.length > 1
        ? el('p', { class: 'note good', text: `Shared across ${parents.length} assemblies — a standardisation candidate.` })
        : null,
    ]);
  }

  /* ------------------------------------------------------- connections --- */

  function connections(ele) {
    if (ele.isEdge()) {
      return el('section', {}, [
        el('h3', { text: 'Endpoints' }),
        el('div', { class: 'conn-list' }, [
          connRow('from', ele.source()),
          connRow('to', ele.target()),
        ]),
      ]);
    }

    const rows = [];
    ele.connectedEdges().forEach((e) => {
      const other = e.source().id() === ele.id() ? e.target() : e.source();
      const dir = e.data('type') === 'contains'
        ? (e.source().id() === ele.id() ? 'contains' : 'used by')
        : (EDGE_TYPES[e.data('type')] || {}).label || e.data('type');
      rows.push(connRow(dir, other, e));
    });

    return el('section', {}, [
      el('h3', { text: `Connections (${rows.length})` }),
      rows.length
        ? el('div', { class: 'conn-list' }, rows)
        : el('p', { class: 'note', text: 'Not connected to anything yet.' }),
    ]);
  }

  function connRow(relation, other) {
    const t = other.data('type');
    const def = NODE_TYPES[t];
    return el('button', {
      class: 'conn',
      attrs: { title: 'Select this element' },
      on: {
        click: () => {
          cy.elements().unselect();
          other.select();
          onFocus(other);
        },
      },
    }, [
      el('span', { class: 'conn-rel', text: relation }),
      def ? svg(iconMarkup(t, def.color, 14), 'conn-icon') : null,
      el('span', { class: 'conn-name', text: captionOf(other) }),
    ]);
  }

  /* -------------------------------------------------------------- misc --- */

  const captionOf = (n) => {
    const def = NODE_TYPES[n.data('type')];
    return def ? (String(n.data(def.titleProp) || '').trim() || n.id()) : n.id();
  };

  const describe = (ele) => (ele.isNode()
    ? `${ele.data('type')} "${captionOf(ele)}"`
    : `edge "${(EDGE_TYPES[ele.data('type')] || {}).label || ele.data('type')}"`);

  const endpointsLabel = (edge, def) =>
    `${captionOf(edge.source())} ${def.directed ? '→' : '–'} ${captionOf(edge.target())}`;

  /* ------------------------------------------------------------ wiring --- */

  // Exactly the interaction the spec describes: left-click selects, selection
  // drives the panel. `unselect` fires when clicking empty canvas.
  cy.on('select', 'node, edge', (e) => render(e.target));
  cy.on('unselect', 'node, edge', () => {
    const sel = cy.$(':selected');
    if (sel.empty()) renderEmpty(); else render(sel.first());
  });
  cy.on('remove', 'node, edge', (e) => { if (current && current.id() === e.target.id()) renderEmpty(); });

  // Keep derived figures (roll-up, connection list) live while the graph is
  // edited — but carefully:
  //   * coalesced into one animation frame, because a single recompute() or a
  //     sample load emits hundreds of add/data events;
  //   * skipped while the user has focus inside the panel, otherwise re-rendering
  //     replaces the very <input> they are typing into and the caret jumps.
  let pendingRender = 0;
  const scheduleRerender = () => {
    if (pendingRender) return;
    pendingRender = requestAnimationFrame(() => {
      pendingRender = 0;
      if (!current || current.removed()) return;
      if (container.contains(document.activeElement)) return;
      render(current);
    });
  };
  cy.on('data', 'node, edge', (e) => { if (current && e.target.id() === current.id()) scheduleRerender(); });
  cy.on('add remove', 'node, edge', scheduleRerender);

  renderEmpty();

  return { render, renderEmpty, get current() { return current; } };
}
