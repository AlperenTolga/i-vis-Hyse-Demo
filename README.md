# BoM Studio — visual construction & analysis of Bills of Materials

A prototype for authoring and analysing a Bill of Materials as a **mixed graph**:
a directed `Part → Part` assembly hierarchy (a DAG) with undirected
issue / user / action / report satellites attached to it, laid out with the
**HySE** hybrid spring embedder.

Built against *"Visual construction & analysis of BoMs"* (i-Vis at Bilkent).

```bash
npm install     # cytoscape-hyse comes from GitHub, not npm
npm run dev     # http://localhost:5173
npm test        # 97 headless assertions over the graph engine
```

The sample BoM (two drones, 30 parts, four levels, shared sub-assemblies) loads
on startup. **New** gives you an empty canvas.

---

## What it does

### Graph model

| | |
|---|---|
| **Nodes** | Part, User, Issue, Action, Report — each with a distinct icon and shape |
| **Directed** | `Part → Part` ("contains", the whole-part hierarchy) |
| **Undirected** | Part–Issue, Issue–User, Issue–Action, Issue–Report, User–Action ×2 ("created" / "assigned to"), User–Report |

All thirteen types, their properties, their legal endpoints and their styling are
declared in one file — [`src/model/schema.js`](src/model/schema.js). The
palette, the construction forms, the inspector, the stylesheet, the legend and
the endpoint validation are all generated from it.

### Construction

* **Add node** — palette on the left, or right-click the canvas. A dialog
  collects the type's properties; the required ones are enforced.
* **Add edge** — press `E` (or **Connect**) and drag between two nodes, or
  right-click a node → *Draw edge from here*. Illegal targets grey out while you
  drag. On release a dialog asks for the relationship's properties — and, when
  the endpoints allow more than one relationship (User–Action does), which one.
* **Shortcuts** — right-click a part for *Add sub-part…* and *Log an issue…*,
  which create the node and the edge in one step.

Four rules are enforced centrally in [`src/graph/store.js`](src/graph/store.js):
endpoint types must match the schema, no duplicate relationship between the same
pair, required properties must be filled in, and **a `contains` edge may never
close a cycle** — a BoM is acyclic by definition and HySE's ranking pass has no
answer for a cyclic hierarchy.

### Inspection

Left-click any node or edge: it is highlighted on the canvas and its properties
appear in the right panel, **editable**. For a Part the panel also shows the
rolled-up figures — total cost, lead time, piece count, distinct parts, and how
many assemblies consume it.

### Layout

**Run HySE layout** (`L`). The ⚙ popover exposes rank gap, order gap, ideal edge
length and node repulsion. Only Parts are tagged `isDirected = 1`, so HySE ranks
the BoM hierarchy and relaxes the satellites around it.

Integrating the library correctly turned out to be the substantial part of this
project — see **[docs/HYSE-NOTES.md](docs/HYSE-NOTES.md)**.

### Complexity management

Right-click a part:

* **Collapse downstream** — fold away its sub-parts
* **Collapse upstream** — hide the assemblies above it
* **Expand downstream / upstream ▸ 1 level · 3 levels · All**

Plus **Collapse all** / **Expand all** in the toolbar, and per-type filters in
the sidebar.

> **A BoM is a DAG, not a tree**, and that changes what "collapse" means. The
> M3×8 screw is a sub-part of the airframe *and* of the propulsion module. This
> app therefore never hides descendants directly: collapsing sets a depth budget
> on one node and visibility is recomputed by reachability, so the screw stays
> visible through the route you did not collapse. Upstream deliberately uses a
> different rule. The reasoning is written out at the top of
> [`src/graph/collapse.js`](src/graph/collapse.js).

Collapsed parts carry a badge (`▾7`, `▴2`) so folding never looks like deletion.

### Analysis

* **Impact analysis** (right-click a part) — highlights every assembly a change
  here would propagate into, up to the finished products.
* **Critical path** — the longest lead-time chain beneath a part.
* **Commonality** (toolbar) — rings every sub-assembly used by more than one
  parent: the standardisation and inventory-consolidation candidates.
* **Colour by** — lead time, rolled-up cost, supplier risk or open issues.
  Continuous metrics are bucketed by rank, not by absolute value, so one
  expensive casting cannot flatten the whole ramp.

### Files

**Save** writes `bom.json` (elements + positions); **Open…** reads it back,
re-validating every element exactly as interactive construction does.

---

## Layout of the source

```
src/
  model/
    schema.js      ← single source of truth: node/edge types, properties,
                     endpoint rules, satellite anchoring
    sample.js      the demo BoM, built through the public store API
  graph/
    cy.js          the Cytoscape instance + extension registration
    icons.js       five hand-drawn CC0 glyphs as data-URIs
    style.js       stylesheet, generated from the schema
    store.js       the only place that mutates the graph; all validation
    hierarchy.js   DAG traversal, cycle detection, cost/lead-time roll-up
    collapse.js    complexity management (the interesting algorithm)
    layout.js      HySE integration and its documented constraints
    analysis.js    impact, commonality, critical path, colour modes
  ui/
    dom.js         3 helpers; no innerHTML for user content
    fields.js      one schema property → one form control
    createDialog.js  construction dialogs
    inspector.js   the right panel
    sidebar.js     palette, filters, legend
    toolbar.js     global commands + HySE parameters
    contextMenu.js right-click menus
    edgeDraw.js    drag-to-connect
  main.js          composition root
tools/
  selftest.mjs        97 assertions, headless Cytoscape, no browser
  browser-smoke.mjs   47 assertions driving a real Chromium
```

## Testing

```bash
npm test                                     # graph engine, no browser
npm i -D playwright && npx playwright install chromium
npm run dev & npm run test:browser           # real browser, real canvas
```

`selftest.mjs` runs the real modules against a headless Cytoscape core — the DAG
cases especially (shared sub-assemblies surviving a sibling's collapse, roll-up
across a diamond, expand-by-N-levels, cycle refusal, JSON round-trip).
`browser-smoke.mjs` covers what only exists on a canvas, and asserts the console
stays free of errors *and* warnings.

## Decisions worth knowing

* **No backend.** The spec is about visual construction and manipulation; a
  database would add setup friction without exercising anything it asks for.
  Persistence is JSON in / JSON out, behind a small `toJSON` / `fromJSON` seam
  that a server could replace.
* **No framework.** ~4,700 lines of plain ES modules (about a third of it
  comment). The schema-driven design
  does the work a component library would otherwise be doing.
* **Icons are self-drawn.** The spec requires freely licensed icons; drawing
  them removes the question entirely. See [docs/LICENSES.md](docs/LICENSES.md).
* **Panels never use `innerHTML` for user content.** Part names and issue titles
  are user input; `src/ui/dom.js` builds nodes with `textContent`.
