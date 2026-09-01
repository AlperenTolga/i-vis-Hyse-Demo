/**
 * ============================================================================
 *  DOM — three helpers, used by every panel.
 * ============================================================================
 *
 *  Deliberately NOT a framework, and deliberately NOT `innerHTML`.
 *
 *  Everything this UI renders is user-authored content: part names, issue
 *  titles, supplier names, free-text notes. Building panels by concatenating
 *  strings into `innerHTML` would mean a part named
 *      <img src=x onerror=alert(1)>
 *  executes as soon as you click it. `el()` sets `textContent`, so text is
 *  always text. The only place raw markup is injected is `svg()`, which takes
 *  markup we generated ourselves in graph/icons.js.
 */

/**
 * Create an element.
 *
 * @param {string} tag                    'div', 'button', 'input', ...
 * @param {object} [props]                properties/attributes. Special keys:
 *          class    -> className
 *          text     -> textContent (escaped by definition)
 *          dataset  -> data-* attributes
 *          on       -> { click: fn, input: fn, ... } event listeners
 *          attrs    -> plain setAttribute pairs (aria-*, role, type, ...)
 * @param {Array<Node|string|null|false>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { class: cls, text, dataset, on, attrs, ...rest } = props;

  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null && v !== false) node.setAttribute(k, String(v));
  }
  if (on) for (const [evt, fn] of Object.entries(on)) node.addEventListener(evt, fn);
  Object.assign(node, rest);

  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Insert markup we generated ourselves (icon SVGs). Never user input. */
export function svg(markup, className) {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.innerHTML = markup;
  return span;
}

/** Replace a container's children in one go. */
export function fill(container, ...children) {
  container.replaceChildren(...children.flat().filter(Boolean));
  return container;
}
