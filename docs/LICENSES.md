# Licences

## Icons — CC0 1.0 (public domain)

The spec requires that icons be freely licensed. Rather than track a third-party
icon set's attribution terms, all five node glyphs (Part, Issue, User, Action,
Report) were **drawn for this project** out of plain SVG primitives and are
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
No attribution is required and there is no upstream licence to comply with.

They live in [`src/graph/icons.js`](../src/graph/icons.js) as SVG source, are
emitted as `data:` URIs, and are used both on the canvas (Cytoscape
`background-image`) and in the HTML panels (legend, palette, inspector) — one
definition, two renderers.

## Third-party runtime dependencies

| Package | Licence | Why |
|---|---|---|
| [cytoscape](https://github.com/cytoscape/cytoscape.js) | MIT | graph rendering & model |
| [cytoscape-hyse](https://github.com/iVis-at-Bilkent/cytoscape.js-hyse) | ISC | the required layout |
| [cytoscape-context-menus](https://github.com/iVis-at-Bilkent/cytoscape.js-context-menus) | MIT | right-click menus |
| [cytoscape-edgehandles](https://github.com/cytoscape/cytoscape.js-edgehandles) | MIT | drag-to-connect edge construction |
| [vite](https://github.com/vitejs/vite) | MIT | dev server & bundler |

`playwright` is used only by `tools/browser-smoke.mjs` and is intentionally not
a project dependency.

## Citation

If you use the layout, the library asks that you cite:

> U. Dogrusoz, H. Islam, and H. Balci, "HySE: a force-directed layout algorithm
> for directed and mixed graphs," *Computer Graphics Forum*, 2026, to appear.
