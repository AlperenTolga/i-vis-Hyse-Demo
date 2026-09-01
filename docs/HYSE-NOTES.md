# Working with `cytoscape.js-hyse`

Field notes from integrating HySE into this app. The library is a research
prototype published alongside the CGF 2026 paper; its README is in places ahead
of, and in places behind, the code. **Every constraint below fails silently** —
no exception, no warning, just a layout that does nothing or a drawing that
looks subtly wrong. They were all found by reading the source and then measuring
the result in a real browser.

Source referenced: `iVis-at-Bilkent/cytoscape.js-hyse@main`.

---

## 0. Installation

Not published to npm. Install from GitHub:

```json
"cytoscape-hyse": "github:iVis-at-Bilkent/cytoscape.js-hyse"
```

The repo commits its `dist/`, so no build step runs on install. It declares
`engines: { node: "16.x" }`; npm only warns, and the shipped bundle is plain ES
that runs fine on modern Node and in the browser.

---

## 1. `data.isDirected` selects the hierarchy

```js
// src/cytoscape-hyse.ts
let nodes = eles.nodes().filter(ele => ele.data("isDirected") == 1);
let edges = eles.edges().stdFilter(edge =>
      edge.source().data("isDirected") == 1 &&
      edge.target().data("isDirected") == 1);
```

A node is in the layered core **only** if `data.isDirected === 1`; an edge is in
it only if *both* endpoints are. Everything else is a satellite for the spring
embedder. Note the loose `== 1`: write the **number** `1`/`0`, not a boolean.

Here: `Part` → 1, `Issue`/`User`/`Action`/`Report` → 0.
See `src/graph/layout.js#tagDirectedness`.

**Symptom if you get it wrong:** with no directed node the ranking pass has
nothing to do and the result is an undifferentiated blob.

---

## 2. Element ids must be legal inside a `#id` selector

```js
// src/spring-embedder.ts
window['cy'].nodes('#' + n.id).scratch("force_directed_pos", { x: …, y: … });
```

Two separate constraints hide in that one line.

**2a — the id.** The coordinates are written back through a *string-built id
selector*. An id containing `#`, `.`, `:` or a space produces a selector that
matches nothing.

> This cost the most time here. The first id scheme in this project was
> `Part#1`, so the selector became `'#Part#1'`. Every write silently hit an
> empty collection, HySE's position callback then returned `undefined` for every
> node, and Cytoscape's `positions()` skips a node whose callback returns
> nothing. **The layout ran, reported a plausible execution time, threw nothing,
> and moved not a single node.**

Ids are now `[A-Za-z][A-Za-z0-9_]*` — enforced in `src/graph/store.js#nextId`
and on import, and asserted in `tools/selftest.mjs`.

**2b — the global.** It writes to `window.cy`, not `options.cy`. That instance
must be the one being laid out. `src/graph/cy.js` sets it and
`src/graph/layout.js` re-asserts it before every run.

---

## 3. `isForceDirected: true` is mandatory

Without it, HySE takes a branch that reads positions from `node.scratch().dagre`:

```js
let dModel = ele.scratch().dagre;
return constrainPos({ x: dModel.x, y: dModel.y });
```

That branch cannot work. The vendored dagre never copies coordinates back to the
input graph — `updateInputGraph(g, layoutGraph)` is commented out in
`src/dagre/layout.js` — so the scratch only ever holds
`{ width, height, name, isDirected }` and `.x` is `undefined`. For a satellite
node the scratch is missing entirely and Cytoscape throws
`Cannot read properties of undefined (reading 'x')`.

Every entry point in the library's own demo sets `isForceDirected = true`.
It is not mentioned in the README.

---

## 4. HySE only *applies* positions to the directed core

The spring embedder computes coordinates for **every** node and stores them in
each node's `force_directed_pos` scratch, but the final call is

```js
nodes.layoutPositions(this, options, fn)   // `nodes` = the directed subset
```

so the satellites' freshly computed positions never reach the canvas.

There is an accidental path that makes them appear to work: with
`animate` **and** `fit` both on, Cytoscape calls
`layoutEles.boundingBoxAt(getFinalPos)` over the *whole* element set, and its
`storeOldPos` stores the **new** position as the "old" one, so the restore step
leaves the nodes at their new coordinates. That combination is also what makes
the exception in §3 reachable. Do not rely on it.

This app instead reads the scratch and places the satellites itself —
`applySatellitePositions()` in `src/graph/layout.js`. It runs HySE with
`animate: false, fit: false` and animates the viewport separately.

---

## 5. `colorSwappedPair` is inverted, and paints on your nodes

```js
// src/spring-embedder.ts
l.colorSwappedPair = !opts.colorSwappedPair;
```

The flag is negated on the way in, so passing `false` — or omitting it — turns
the debug colouring **on**. It then writes *inline element styles*:

```js
this.cy.getElementById(id).css("border-color", "#eee29b");
n.css("border-color", ""); n.css("border-width", "0");
```

Inline style outranks the stylesheet in Cytoscape, so this survives every
subsequent restyle: some nodes keep a pale-gold ring, others lose their border
entirely, and the `:selected` highlight stops being visible — which would break
the "selection must highlight the element" requirement.

Pass `colorSwappedPair: true` to mean *off*, **and** strip the properties after
each run (`stripLayoutInlineStyles()`), so the stylesheet stays authoritative.

---

## 6. Undocumented options that are nonetheless required

These are read by the algorithm but appear in neither the README nor the
library's `DEFAULT_OPTIONS`. Left undefined they propagate as `NaN` and every
node lands on a non-finite coordinate:

| option | demo default |
|---|---|
| `coolingCoefficient` | `0.7` |
| `orderFlipPeriod` | `5` |
| `nodeRepulsionCalculationWidth` | `10` |
| `fullyCalcRep4Ticks` | `0.01` |
| `maxNodeDisplacement` | `300` |
| `expansionCoefficient` | `3` |
| `useFRGridVariant` | `true` |
| `isManuelRankAndOrder` | `true` |

Also note that the README documents `nodeRepulsion`, `idealEdgeLength` and
`edgeElasticity` as **functions** (`node => 55000`). The demo passes plain
numbers, and plain numbers are what this code path actually wants.

`HYSE_DEFAULTS` in `src/graph/layout.js` is the demo's own set, with three
deliberate changes (marked ◆ in that file) for label-bearing BoM nodes.

---

## 7. Options this app exposes

`rankGap` and `orderGap` are the two dials that matter most for a BoM: they
control the vertical distance between assembly levels and the horizontal
spacing inside a level, and the right values depend on how long your part names
are. They are on the ⚙ popover next to **Run HySE layout**, along with
`idealEdgeLength` and `nodeRepulsion`, which mostly govern how much room the
issue/action/report satellites get.

---

## 8. Reproducing the findings

```bash
npm run dev
npm i -D playwright && npx playwright install chromium
npm run test:browser
```

`tools/browser-smoke.mjs` asserts that HySE is the engine that actually ran,
that all 41 sample nodes end up positioned, that ids stay selector-safe, and
that no inline border styling survives a layout run.
