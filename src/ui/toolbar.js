/**
 * ============================================================================
 *  TOOLBAR — global commands.
 * ============================================================================
 *
 *  Per-element operations live in the context menu (they need a target); the
 *  toolbar holds the ones that act on the whole graph: run the layout, fold or
 *  unfold everything, recolour, load/save, and toggle Connect mode.
 *
 *  The HySE panel is deliberately exposed rather than hidden behind defaults.
 *  Layout quality on a mixed graph is genuinely sensitive to `rankGap` (how far
 *  apart the BoM levels sit) and `idealEdgeLength` (how much room the satellite
 *  sub-graphs get), and being able to turn those dials while looking at your
 *  own BoM is the difference between "it ran" and "I can read it".
 */

import { COLOUR_MODES, applyColourMode, showCommonality, clearOverlays, graphSummary } from '../graph/analysis.js';
import { HYSE_DEFAULTS } from '../graph/layout.js';
import { el, fill } from './dom.js';

export function createToolbar(container, cy, ctx) {
  const { cm, edges, onLayout, onToast, onFit, onNew, onSample, onSave, onOpen } = ctx;

  /** Live HySE options, seeded from the library defaults. */
  const hyseOptions = {
    rankGap: HYSE_DEFAULTS.rankGap,
    orderGap: HYSE_DEFAULTS.orderGap,
    idealEdgeLength: HYSE_DEFAULTS.idealEdgeLength,
    nodeRepulsion: HYSE_DEFAULTS.nodeRepulsion,
    animate: true,   // animates the viewport fit; see graph/layout.js
  };

  /* ------------------------------------------------------------ layout -- */

  const layoutBtn = el('button', {
    class: 'btn primary',
    attrs: { title: 'Lay the graph out with HySE (L)' },
    on: { click: () => onLayout(hyseOptions) },
  }, ['Run HySE layout']);

  const optionsPanel = el('div', { class: 'popover', attrs: { hidden: true } }, [
    el('h4', { text: 'HySE parameters' }),
    slider('Rank gap', 'rankGap', 20, 220, 5,
      'Vertical distance between BoM levels in the directed core.'),
    slider('Order gap', 'orderGap', 40, 300, 5,
      'Horizontal spacing between parts inside one level.'),
    slider('Ideal edge length', 'idealEdgeLength', 30, 220, 5,
      'Target spring length; mostly governs how much room the satellites get.'),
    slider('Node repulsion', 'nodeRepulsion', 5000, 150000, 1000,
      'How hard nodes push each other apart.'),
    el('label', { class: 'pop-check' }, [
      el('input', {
        type: 'checkbox', checked: hyseOptions.animate !== false,
        on: { change: (e) => { hyseOptions.animate = e.target.checked ? 'end' : false; } },
      }),
      el('span', { text: 'Animate to the new positions' }),
    ]),
    el('p', { class: 'pop-note', text: 'HySE ranks the Part→Part hierarchy and relaxes the Issue/User/Action/Report satellites at the same time. Only Parts carry isDirected = 1; everything else is a satellite.' }),
    el('button', {
      class: 'btn tiny', text: 'Reset to defaults',
      on: {
        click: () => {
          Object.assign(hyseOptions, {
            rankGap: HYSE_DEFAULTS.rankGap,
            orderGap: HYSE_DEFAULTS.orderGap,
            idealEdgeLength: HYSE_DEFAULTS.idealEdgeLength,
            nodeRepulsion: HYSE_DEFAULTS.nodeRepulsion,
          });
          optionsPanel.querySelectorAll('input[type=range]').forEach((i) => {
            i.value = String(hyseOptions[i.dataset.key]);
            i.parentElement.querySelector('.slider-value').textContent = i.value;
          });
        },
      },
    }),
  ]);

  function slider(label, key, min, max, step, help) {
    const out = el('span', { class: 'slider-value', text: String(hyseOptions[key]) });
    return el('label', { class: 'pop-slider', attrs: { title: help } }, [
      el('span', { class: 'pop-label' }, [label, out]),
      el('input', {
        type: 'range', min: String(min), max: String(max), step: String(step),
        value: String(hyseOptions[key]),
        dataset: { key },
        on: {
          input: (e) => {
            hyseOptions[key] = Number(e.target.value);
            out.textContent = e.target.value;
          },
        },
      }),
      el('span', { class: 'pop-help', text: help }),
    ]);
  }

  const optionsBtn = el('button', {
    class: 'btn icon',
    attrs: { title: 'HySE parameters', 'aria-expanded': 'false' },
    text: '⚙',
    on: {
      click: (e) => {
        optionsPanel.hidden = !optionsPanel.hidden;
        e.currentTarget.setAttribute('aria-expanded', String(!optionsPanel.hidden));
      },
    },
  });

  /* ------------------------------------------------------- colour mode -- */

  const colourSelect = el('select', {
    class: 'select',
    attrs: { title: 'Colour Part nodes by a metric' },
    on: {
      change: (e) => {
        const r = applyColourMode(cy, e.target.value);
        if (e.target.value === 'none') { onToast('Back to type colours.', 'info'); return; }
        onToast(r.coloured === 0
          ? 'No part carries that value yet — fill it in on the right panel.'
          : `Shaded ${r.coloured} part(s)` + (r.missing ? `, ${r.missing} without data` : '')
            + (r.min !== undefined ? ` · range ${fmt(r.min)}–${fmt(r.max)}` : ''),
        r.coloured === 0 ? 'info' : 'ok');
      },
    },
  }, Object.entries(COLOUR_MODES).map(([k, v]) => el('option', { value: k, text: v.label })));

  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  /* -------------------------------------------------------- connect mode -- */

  const connectBtn = el('button', {
    class: 'btn toggle',
    attrs: { title: 'Drag between nodes to create an edge (E)' },
    text: 'Connect',
    on: { click: () => edges.setDrawMode(!edges.drawMode) },
  });

  /* ---------------------------------------------------------------- DOM -- */

  fill(container,
    el('div', { class: 'tb-brand' }, [
      el('strong', { text: 'BoM Studio' }),
      el('span', { class: 'tb-sub', text: 'mixed-graph construction & analysis · HySE' }),
    ]),

    el('div', { class: 'tb-group' }, [
      el('span', { class: 'tb-label', text: 'File' }),
      el('button', { class: 'btn', text: 'Sample', attrs: { title: 'Load the demo drone BoM' }, on: { click: onSample } }),
      el('button', { class: 'btn', text: 'New', on: { click: onNew } }),
      el('button', { class: 'btn', text: 'Open…', on: { click: onOpen } }),
      el('button', { class: 'btn', text: 'Save', on: { click: onSave } }),
    ]),

    el('div', { class: 'tb-group' }, [
      el('span', { class: 'tb-label', text: 'Layout' }),
      layoutBtn,
      el('div', { class: 'popover-host' }, [optionsBtn, optionsPanel]),
      el('button', { class: 'btn', text: 'Fit', on: { click: onFit } }),
    ]),

    el('div', { class: 'tb-group' }, [
      el('span', { class: 'tb-label', text: 'Complexity' }),
      el('button', {
        class: 'btn', text: 'Collapse all',
        attrs: { title: 'Fold every assembly down to the finished products' },
        on: { click: () => { cm.collapseAllDown(); onToast('Collapsed to the top-level products.', 'ok'); } },
      }),
      el('button', {
        class: 'btn', text: 'Expand all',
        on: { click: () => { cm.expandAll(); onToast('Everything expanded.', 'ok'); } },
      }),
    ]),

    el('div', { class: 'tb-group' }, [
      el('span', { class: 'tb-label', text: 'Analyse' }),
      colourSelect,
      el('button', {
        class: 'btn', text: 'Commonality',
        attrs: { title: 'Ring the sub-assemblies used by more than one parent' },
        on: {
          click: () => {
            const shared = showCommonality(cy);
            onToast(shared.length === 0
              ? 'No part is shared between assemblies yet.'
              : `${shared.length} shared part(s). Most reused: ${shared.slice(0, 3).map((s) => `${s.name} (${s.parents}×)`).join(', ')}.`,
            'ok');
          },
        },
      }),
      el('button', {
        class: 'btn', text: 'Clear',
        on: { click: () => { clearOverlays(cy); colourSelect.value = 'none'; onToast('Highlight cleared.', 'info'); } },
      }),
    ]),

    el('div', { class: 'tb-group' }, [connectBtn]),
  );

  // Close the popover when clicking anywhere else.
  document.addEventListener('mousedown', (e) => {
    if (optionsPanel.hidden) return;
    if (!optionsPanel.parentElement.contains(e.target)) {
      optionsPanel.hidden = true;
      optionsBtn.setAttribute('aria-expanded', 'false');
    }
  });

  return {
    hyseOptions,
    setConnectActive: (on) => connectBtn.classList.toggle('active', on),
    resetColourMode: () => { colourSelect.value = 'none'; },
    summary: () => graphSummary(cy),
  };
}
