/**
 * ============================================================================
 *  CREATE DIALOG — interactive construction with property input.
 * ============================================================================
 *
 *  "The user should be able to interactively create BoMs and related contextual
 *   metadata using the previously defined node and edge types. To illustrate
 *   the concept, each node and each edge type should have at least one property
 *   (input during construction)!"
 *
 *  That last sentence is why construction goes through a dialog rather than
 *  dropping a blank node on the canvas: the properties are part of *creating*
 *  the entity, not an afterthought. The form is generated from the schema, so
 *  the required fields are exactly the ones the schema marks required.
 *
 *  For edges the dialog also solves a real ambiguity: User and Action are
 *  connected by TWO different relationship types in the spec ("created" and
 *  "assigned to"). When the user drags between them, the dialog asks which one
 *  — it cannot be guessed from the endpoints alone.
 */

import { NODE_TYPES, EDGE_TYPES, edgeTypesFor, defaultsFor } from '../model/schema.js';
import { createNode, createEdge } from '../graph/store.js';
import { renderForm } from './fields.js';
import { el, svg, fill } from './dom.js';
import { iconMarkup } from '../graph/icons.js';

export function createDialogHost(cy, { onToast, cm }) {
  const backdrop = el('div', { class: 'modal-backdrop', attrs: { hidden: true } });
  const box = el('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true' } });
  backdrop.append(box);
  document.body.append(backdrop);

  let closer = null;
  /** The submit handler of the dialog that is currently open, if any. */
  let currentSubmit = null;

  // Bound ONCE. Binding this inside open() would attach a new listener on every
  // dialog and, since `box` is reused, the Nth dialog would submit N times.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (currentSubmit) currentSubmit();
  });

  function close(result) {
    backdrop.hidden = true;
    fill(box);
    const c = closer;
    closer = null;
    currentSubmit = null;
    if (c) c(result);
  }

  // Esc closes; a click on the backdrop (but not inside the box) closes.
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) { e.preventDefault(); close(null); }
  });

  function open(title, subtitle, bodyNodes, onSubmit, submitLabel = 'Create') {
    return new Promise((resolve) => {
      closer = resolve;

      const errorSlot = el('p', { class: 'modal-error' });

      const submit = () => {
        const res = onSubmit();
        if (res && res.ok === false) {
          errorSlot.textContent = res.error || 'Could not create';
          if (res.showErrors) res.showErrors();
          return;
        }
        close(res ? res.element : null);
      };

      fill(box,
        el('div', { class: 'modal-head' }, [
          el('h2', { text: title }),
          subtitle ? el('p', { class: 'modal-sub', text: subtitle }) : null,
          el('button', { class: 'modal-x', text: '×', attrs: { 'aria-label': 'Close' }, on: { click: () => close(null) } }),
        ]),
        el('div', { class: 'modal-body' }, bodyNodes),
        errorSlot,
        el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn', text: 'Cancel', on: { click: () => close(null) } }),
          el('button', { class: 'btn primary', text: submitLabel, on: { click: submit } }),
        ]));

      // Enter anywhere in the form submits — construction should be fast.
      currentSubmit = submit;
      backdrop.hidden = false;
      const first = box.querySelector('.field-input');
      if (first) first.focus();
    });
  }

  /* ==================================================================== *
   * Nodes
   * ==================================================================== */

  /**
   * @param {string} type    key of NODE_TYPES
   * @param {{position?:{x,y}, anchor?:cytoscape.Singular}} [opts]
   * @returns {Promise<cytoscape.Singular|null>}
   */
  function openNodeDialog(type, opts = {}) {
    const def = NODE_TYPES[type];
    if (!def) return Promise.resolve(null);

    const form = renderForm(def, defaultsFor(def));

    return open(
      `New ${def.label}`,
      def.description,
      [
        el('div', { class: 'modal-type' }, [
          svg(iconMarkup(type, def.color, 22), 'modal-icon'),
          el('span', { text: def.label }),
        ]),
        ...form.rows,
      ],
      () => {
        const res = createNode(cy, type, form.values(), opts);
        if (!res.ok) return { ok: false, error: res.error, showErrors: () => form.showErrors(res.errors || {}) };
        cm.recompute();
        onToast(`Created ${def.label} “${res.element.data(def.titleProp)}”`, 'ok');
        return res;
      },
    );
  }

  /* ==================================================================== *
   * Edges
   * ==================================================================== */

  /**
   * @param {cytoscape.Singular} source  node the drag started on
   * @param {cytoscape.Singular} target  node the drag ended on
   * @returns {Promise<cytoscape.Singular|null>}
   */
  function openEdgeDialog(source, target) {
    const st = source.data('type');
    const tt = target.data('type');
    const candidates = edgeTypesFor(st, tt);

    if (candidates.length === 0) {
      onToast(`No relationship in the model connects ${st} and ${tt}.`, 'error');
      return Promise.resolve(null);
    }

    let chosen = candidates[0];
    const formSlot = el('div', { class: 'modal-form-slot' });
    let form = null;

    const paintForm = () => {
      const def = EDGE_TYPES[chosen];
      form = renderForm(def, defaultsFor(def));
      fill(formSlot,
        el('p', { class: 'modal-sub', text: def.description }),
        ...form.rows);
      const first = formSlot.querySelector('.field-input');
      if (first) first.focus();
    };

    // Only ask which relationship when there is genuinely a choice — the
    // User–Action pair is the case the spec creates.
    const picker = candidates.length > 1
      ? el('div', { class: 'type-picker' }, candidates.map((k) => {
          const def = EDGE_TYPES[k];
          return el('button', {
            class: `type-chip${k === chosen ? ' active' : ''}`,
            dataset: { key: k },
            on: {
              click: (e) => {
                chosen = k;
                [...e.currentTarget.parentElement.children]
                  .forEach((c) => c.classList.toggle('active', c.dataset.key === k));
                paintForm();
              },
            },
          }, [
            el('span', { class: 'chip-line', style: `--c:${def.color};--s:${def.lineStyle}` }),
            el('span', { text: def.label }),
          ]);
        }))
      : null;

    paintForm();

    const endpointLine = el('p', { class: 'modal-endpoints' }, [
      chipFor(source), el('span', { class: 'arrow', text: '→' }), chipFor(target),
    ]);

    return open(
      candidates.length > 1 ? 'New relationship' : `New “${EDGE_TYPES[chosen].label}” edge`,
      null,
      [endpointLine, picker, formSlot].filter(Boolean),
      () => {
        const res = createEdge(cy, chosen, source.id(), target.id(), form.values());
        if (!res.ok) return { ok: false, error: res.error, showErrors: () => form.showErrors(res.errors || {}) };
        cm.recompute();
        onToast(`Connected: ${EDGE_TYPES[chosen].label}`, 'ok');
        return res;
      },
      'Connect',
    );
  }

  function chipFor(node) {
    const t = node.data('type');
    const def = NODE_TYPES[t] || {};
    const caption = String(node.data(def.titleProp) || node.id());
    return el('span', { class: 'endpoint-chip' }, [
      svg(iconMarkup(t, def.color || '#888', 14)),
      el('span', { text: caption }),
    ]);
  }

  return { openNodeDialog, openEdgeDialog, close: () => close(null) };
}
