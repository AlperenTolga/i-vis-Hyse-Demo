/**
 * ============================================================================
 *  ICONS — one distinct glyph per node type.
 * ============================================================================
 *
 *  LICENSING (the spec explicitly says "Make sure that icons are freely
 *  licensed"): every glyph below was drawn by hand for this project out of
 *  plain SVG primitives, and is released under CC0 1.0 (public domain).
 *  Nothing is copied from an icon set, so there is no attribution obligation
 *  and no third-party licence to track. See docs/LICENSES.md.
 *
 *  WHY DATA-URIs INSTEAD OF FILES?
 *  Cytoscape draws node images through `background-image`. Serving them as
 *  data-URIs means:
 *    - zero extra network requests, so a node never renders "blank then icon";
 *    - the icon colour can be recomputed at runtime (see `nodeIcon(type, fill)`),
 *      which is what makes the "Colour by lead time / cost / risk" mode able to
 *      recolour a node *and* keep the glyph legible on top of it;
 *    - the whole app still works when opened from `file://`.
 *
 *  Every glyph is drawn inside a 24x24 viewBox with `stroke-width: 1.7`, so
 *  they share an optical weight and look like one family.
 */

/**
 * SVG source -> data URI.
 *
 * We use `encodeURIComponent` rather than base64: it keeps the markup readable
 * in devtools, avoids btoa()'s unicode pitfalls, and is actually *shorter* for
 * SVG. `#` must be escaped by hand because it would otherwise be parsed as a
 * URL fragment and silently truncate the image.
 */
function svgToDataUri(svg) {
  const compact = svg.replace(/\s+/g, ' ').trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(compact)}`;
}

/** Shared wrapper so all glyphs get identical geometry and stroke weight. */
function glyph(inner, stroke) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
    fill="none" stroke="${stroke}" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/* --------------------------------------------------------------------------
 * The glyphs. Kept deliberately simple: at 46px on screen a node icon is ~26px,
 * so anything more detailed turns to mush.
 * ------------------------------------------------------------------------ */
const GLYPHS = {
  /** Part — an isometric cube: the universal "physical component" mark. */
  Part: `
    <path d="M12 2.6 21 7.3v9.4L12 21.4 3 16.7V7.3z"/>
    <path d="M3 7.3 12 12l9-4.7"/>
    <path d="M12 12v9.4"/>`,

  /** Issue — a warning triangle with a bang. */
  Issue: `
    <path d="M12 3.4 22 20H2z"/>
    <path d="M12 9.5v4.6"/>
    <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>`,

  /** User — head and shoulders. */
  User: `
    <circle cx="12" cy="8" r="3.6"/>
    <path d="M4.5 20.2a7.5 7.5 0 0 1 15 0"/>`,

  /** Action — a wrench: "something is being done about it". */
  User_placeholder: ``,
  Action: `
    <path d="M14.9 6.3a4.4 4.4 0 0 0 5.7 5.7l-8.2 8.2a2.4 2.4 0 0 1-3.4 0l-2.3-2.3a2.4 2.4 0 0 1 0-3.4z"/>
    <path d="M17.4 3.6 20.9 7"/>
    <path d="M6.2 16.6l1.5 1.5"/>`,

  /** Report — a sheet of paper with a folded corner and text lines. */
  Report: `
    <path d="M6 2.8h7.5L19 8.3v12.9H6z"/>
    <path d="M13.3 2.8v5.6H19"/>
    <path d="M9 13h7"/>
    <path d="M9 16.4h7"/>
    <path d="M9 9.6h2.6"/>`,
};
delete GLYPHS.User_placeholder;

/**
 * The icon for a node type, drawn in `stroke`.
 *
 * Results are memoised because Cytoscape re-evaluates a style mapper for every
 * node on every restyle; re-encoding 5 SVGs per node per repaint would be
 * pointless work.
 */
const cache = new Map();

export function nodeIcon(type, stroke = '#ffffff') {
  const key = `${type}|${stroke}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const inner = GLYPHS[type];
  if (!inner) return '';

  // `currentColor` inside a glyph resolves against the element's `color`, which
  // does not exist for a standalone data-URI, so bake the stroke colour in.
  const uri = svgToDataUri(glyph(inner.replace(/currentColor/g, stroke), stroke));
  cache.set(key, uri);
  return uri;
}

/** Same glyphs, sized for the legend / toolbar buttons (HTML, not canvas). */
export function iconMarkup(type, stroke, size = 16) {
  const inner = GLYPHS[type];
  if (!inner) return '';
  return glyph(inner.replace(/currentColor/g, stroke), stroke)
    .replace('width="24" height="24"', `width="${size}" height="${size}"`);
}

export const ICON_TYPES = Object.keys(GLYPHS);
