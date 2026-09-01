/**
 * ============================================================================
 *  MAIN — composition root.
 * ============================================================================
 *
 *  Nothing here contains graph logic; it wires the modules together and owns the
 *  handful of things that are genuinely application-wide: toasts, the status
 *  bar, file open/save, and the keyboard shortcuts.
 *
 *  Construction order matters and is not arbitrary:
 *
 *      cy                 the instance (registers the extensions)
 *        -> cm            complexity manager: the ONLY thing that hides elements
 *        -> dialogs       need `cm` so they can recompute after creating
 *        -> edges         need `dialogs` to turn a drag into a real edge
 *        -> contextMenu   needs all three
 *        -> inspector     needs `cm` (delete triggers a recompute)
 *        -> toolbar       needs everything, so it is built last
 */

import './styles.css';

import { createCy } from './graph/cy.js';
import { createComplexityManager } from './graph/collapse.js';
import { runHyse } from './graph/layout.js';
import { toJSON, fromJSON } from './graph/store.js';
import { clearOverlays, graphSummary } from './graph/analysis.js';
import { loadSample } from './model/sample.js';

import { createDialogHost } from './ui/createDialog.js';
import { createEdgeDrawing } from './ui/edgeDraw.js';
import { registerContextMenus } from './ui/contextMenu.js';
import { createInspector } from './ui/inspector.js';
import { createSidebar } from './ui/sidebar.js';
import { createToolbar } from './ui/toolbar.js';
import { el, fill } from './ui/dom.js';

/* -------------------------------------------------------------------------- *
 * Chrome: toasts + status bar
 * -------------------------------------------------------------------------- */

const toastHost = document.getElementById('toasts');
const statusBar = document.getElementById('status');

/**
 * Transient message. Every operation that can surprise the user reports through
 * here — especially the ones that legitimately do nothing ("nothing folded:
 * every sub-part is still reached through another assembly"), because silent
 * no-ops are what make a collapse feature feel broken.
 */
function toast(message, kind = 'info', ms = 4200) {
  const node = el('div', { class: `toast ${kind}`, text: message });
  toastHost.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, ms);
  while (toastHost.children.length > 4) toastHost.firstChild.remove();
}

let lastEngine = '—';

function renderStatus() {
  const s = cm.stats();
  const g = graphSummary(cy);
  const money = (n) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  fill(statusBar,
    el('span', {}, [el('b', { text: 'Nodes ' }), `${s.visibleNodes}/${s.totalNodes}`]),
    el('span', { class: 'sep', text: '|' }),
    el('span', {}, [el('b', { text: 'Edges ' }), `${s.visibleEdges}/${s.totalEdges}`]),
    el('span', { class: 'sep', text: '|' }),
    el('span', {}, [el('b', { text: 'Products ' }), String(g.products)]),
    el('span', { class: 'sep', text: '|' }),
    el('span', {}, [el('b', { text: 'Shared parts ' }), String(g.shared)]),
    el('span', { class: 'sep', text: '|' }),
    el('span', {}, [el('b', { text: 'Open issues ' }), `${g.openIssues}/${g.issues}`]),
    el('span', { class: 'sep', text: '|' }),
    el('span', {}, [el('b', { text: 'Rolled cost ' }), money(g.totalCost)]),
    el('span', { class: 'sep', text: '|' }),
    el('span', {}, [el('b', { text: 'Longest lead ' }), `${g.maxLeadTime} d`]),
    s.hiddenNodes
      ? el('span', {}, [el('span', { class: 'sep', text: '|' }), ` ${s.hiddenNodes} folded away`])
      : null,
    el('span', { class: 'engine', text: `layout: ${lastEngine}` }),
  );
}

/* -------------------------------------------------------------------------- *
 * The graph
 * -------------------------------------------------------------------------- */

const cy = createCy(document.getElementById('cy'));

const cm = createComplexityManager(cy, {
  onChange: () => { renderStatus(); sidebar && sidebar.refreshCounts(); },
});

const dialogs = createDialogHost(cy, { onToast: toast, cm });

const edges = createEdgeDrawing(cy, {
  dialogs,
  onToast: toast,
  onModeChange: (on) => toolbar && toolbar.setConnectActive(on),
});

/* -------------------------------------------------------------------------- *
 * Layout
 * -------------------------------------------------------------------------- */

let layoutRunning = false;

async function runLayout(options = {}) {
  if (layoutRunning) return;
  if (cy.nodes().length === 0) { toast('Nothing to lay out yet.', 'info'); return; }

  layoutRunning = true;
  lastEngine = 'running…';
  renderStatus();

  try {
    const r = await runHyse(cy, { ...(toolbar ? toolbar.hyseOptions : {}), ...options });
    lastEngine = `${r.engine} · ${r.nodes} nodes · ${r.ms} ms`;
    if (r.engine === 'cose') {
      toast('No Part in view, so HySE has no hierarchy to rank — used a plain force layout instead.', 'info');
    }
  } catch (err) {
    lastEngine = 'failed';
    toast(`Layout failed: ${err.message}`, 'error');
  } finally {
    layoutRunning = false;
    renderStatus();
  }
}

const fit = () => cy.animate({ fit: { eles: cy.elements(':visible'), padding: 60 }, duration: 260 });

/* -------------------------------------------------------------------------- *
 * File operations
 * -------------------------------------------------------------------------- */

const fileInput = document.getElementById('file-input');

function newGraph() {
  if (cy.elements().nonempty()
      && !confirm('Clear the current BoM? Unsaved changes will be lost.')) return;
  cy.elements().remove();
  cm.expandAll();
  toolbar.resetColourMode();
  toast('Empty BoM. Add a Part from the left palette to start.', 'info');
}

async function sample() {
  if (cy.elements().nonempty()
      && !confirm('Replace the current BoM with the sample drone product family?')) return;
  const r = loadSample(cy);
  if (!r.ok) toast(`Sample loaded with ${r.problems.length} problem(s): ${r.problems[0]}`, 'error');
  clearOverlays(cy);
  toolbar.resetColourMode();
  cm.expandAll();
  await runLayout();
  toast(`Sample loaded: ${r.nodes} nodes, ${r.edges} edges.`, 'ok');
}

function save() {
  const blob = new Blob([JSON.stringify(toJSON(cy), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'bom.json' });
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Saved as bom.json', 'ok');
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const r = fromJSON(cy, json);
    if (!r.ok) { toast(r.error, 'error'); return; }
    cm.expandAll();
    toolbar.resetColourMode();
    // Imported files carry positions; only lay out if they clearly do not.
    const needsLayout = cy.nodes().every((n) => n.position('x') === 0 && n.position('y') === 0);
    if (needsLayout) await runLayout();
    else cy.fit(cy.elements(':visible'), 60);
    toast(`Opened ${file.name}: ${r.nodes} nodes, ${r.edges} edges.`
      + (r.warnings.length ? ` ${r.warnings.length} item(s) skipped.` : ''),
    r.warnings.length ? 'info' : 'ok');
    r.warnings.slice(0, 3).forEach((w) => toast(w, 'info'));
  } catch (err) {
    toast(`Could not read that file: ${err.message}`, 'error');
  } finally {
    fileInput.value = '';   // so re-opening the same file fires `change` again
  }
});

/* -------------------------------------------------------------------------- *
 * Panels
 * -------------------------------------------------------------------------- */

const inspector = createInspector(document.getElementById('inspector'), cy, {
  cm,
  onToast: toast,
  onFocus: (ele) => cy.animate({ center: { eles: ele }, duration: 220 }),
});

const sidebar = createSidebar(document.getElementById('sidebar'), cy, { cm, dialogs });

const toolbar = createToolbar(document.getElementById('toolbar'), cy, {
  cm,
  edges,
  onLayout: runLayout,
  onToast: toast,
  onFit: fit,
  onNew: newGraph,
  onSample: sample,
  onSave: save,
  onOpen: () => fileInput.click(),
});

registerContextMenus(cy, {
  cm,
  dialogs,
  edges,
  onToast: toast,
  onLayout: runLayout,
  onFit: fit,
});

/* -------------------------------------------------------------------------- *
 * Global shortcuts
 * -------------------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.metaKey || e.ctrlKey) return;

  switch (e.key) {
    case 'l': case 'L': e.preventDefault(); runLayout(); break;
    case 'f': case 'F': e.preventDefault(); fit(); break;
    case 'c': case 'C': e.preventDefault(); clearOverlays(cy); toolbar.resetColourMode(); break;
    case 'Delete': case 'Backspace': {
      const sel = cy.$(':selected');
      if (sel.empty()) return;
      e.preventDefault();
      sel.remove();
      cm.recompute();
      toast(`Deleted ${sel.length} element(s).`, 'ok');
      break;
    }
    default: break;
  }
});

/* -------------------------------------------------------------------------- *
 * Boot
 * -------------------------------------------------------------------------- */

cm.recompute();
renderStatus();
sample();
