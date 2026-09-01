/**
 * ============================================================================
 *  SCHEMA — the single source of truth for the whole application.
 * ============================================================================
 *
 *  Everything else in this app is *generated* from this file:
 *    - the "Add node" / "Add edge" palettes            (ui/toolbar.js)
 *    - the property forms shown while constructing     (ui/createDialog.js)
 *    - the inspector panel on the right                (ui/inspector.js)
 *    - the Cytoscape stylesheet (colors, icons, edges) (graph/style.js)
 *    - endpoint-type validation for every new edge     (graph/store.js)
 *
 *  Add a node/edge type here and the entire UI grows a new option by itself.
 *  That is the point: the spec's graph model is *data*, not code sprinkled
 *  around the app.
 *
 *  ---------------------------------------------------------------------------
 *  The graph model required by the spec
 *  ---------------------------------------------------------------------------
 *  Nodes ......... Part, User, Issue, Action, Report
 *  Directed ...... Part -> Part               (whole-part / "contains")
 *  Undirected .... Part  - Issue              (issue is associated with the part)
 *                  Issue - User               (the user reported the issue)
 *                  Issue - Action             (the action was taken for the issue)
 *                  Issue - Report             (the report was written for the issue)
 *                  User  - Action             (the user created the action)
 *                  User  - Action             (the action was assigned to the user)
 *                  User  - Report             (the user completed the report)
 *
 *  Note that User-Action appears TWICE in the spec with two different meanings
 *  ("created" vs. "assigned"). They are modelled as two separate edge types so
 *  that they can carry different labels, styles and properties.
 *
 *  ---------------------------------------------------------------------------
 *  The `directed` flag and HySE
 *  ---------------------------------------------------------------------------
 *  HySE splits a mixed graph into a *central directed part* and *undirected
 *  satellites*. It decides which is which by reading `node.data('isDirected')`
 *  (1 = directed part, 0 = satellite) — see graph/layout.js.
 *  For a BoM the directed part is exactly the Part hierarchy, so `Part` is the
 *  only node type below with `directed: true`.
 */

/** Property field types understood by the form renderer (ui/fields.js). */
export const FIELD = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number',
  DATE: 'date',
  SELECT: 'select',
};

/* ==========================================================================
 * NODE TYPES
 * ==========================================================================
 * Each entry:
 *   key        internal id, also stored on the element as data.type
 *   label      human readable name
 *   directed   true  -> belongs to HySE's directed core (isDirected = 1)
 *              false -> undirected satellite            (isDirected = 0)
 *   color      base colour used by the stylesheet and the legend
 *   shape      Cytoscape node shape
 *   titleProp  which property is rendered as the node's on-canvas caption
 *   props      the construction form. At least one is `required: true`, which
 *              satisfies the spec's "each node type should have at least one
 *              property (input during construction)".
 */
export const NODE_TYPES = {
  Part: {
    key: 'Part',
    label: 'Part',
    directed: true,
    color: '#3b82f6',
    shape: 'round-rectangle',
    titleProp: 'name',
    description: 'A physical part, sub-assembly or finished product.',
    props: [
      { key: 'name', label: 'Name', type: FIELD.TEXT, required: true, placeholder: 'e.g. Frame Assembly' },
      { key: 'partNo', label: 'Part No', type: FIELD.TEXT, placeholder: 'e.g. FRM-1000' },
      { key: 'unitCost', label: 'Unit cost', type: FIELD.NUMBER, min: 0, step: 0.01, unit: '$',
        help: 'Cost of ONE piece of this part. Used by the roll-up analysis.' },
      { key: 'leadTimeDays', label: 'Lead time', type: FIELD.NUMBER, min: 0, step: 1, unit: 'days',
        help: 'Procurement/production time. Used by the critical-path analysis.' },
      { key: 'supplier', label: 'Supplier', type: FIELD.TEXT },
      { key: 'supplierRisk', label: 'Supplier risk', type: FIELD.SELECT,
        options: ['', 'low', 'medium', 'high'], help: 'Drives the "Colour by: risk" mode.' },
      { key: 'notes', label: 'Notes', type: FIELD.TEXTAREA },
    ],
  },

  Issue: {
    key: 'Issue',
    label: 'Issue',
    directed: false,
    color: '#ef4444',
    shape: 'round-diamond',
    titleProp: 'title',
    description: 'A logged problem attached to a part.',
    props: [
      { key: 'title', label: 'Title', type: FIELD.TEXT, required: true, placeholder: 'e.g. Weld porosity' },
      { key: 'severity', label: 'Severity', type: FIELD.SELECT, options: ['low', 'medium', 'high', 'critical'], default: 'medium' },
      { key: 'status', label: 'Status', type: FIELD.SELECT, options: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' },
      { key: 'openedOn', label: 'Opened on', type: FIELD.DATE },
      { key: 'description', label: 'Description', type: FIELD.TEXTAREA },
    ],
  },

  User: {
    key: 'User',
    label: 'User',
    directed: false,
    color: '#10b981',
    shape: 'ellipse',
    titleProp: 'name',
    description: 'A person: reporter, action owner or report author.',
    props: [
      { key: 'name', label: 'Name', type: FIELD.TEXT, required: true, placeholder: 'e.g. A. Yilmaz' },
      { key: 'role', label: 'Role', type: FIELD.SELECT, options: ['', 'engineer', 'quality', 'planner', 'supplier', 'manager'] },
      { key: 'email', label: 'E-mail', type: FIELD.TEXT },
    ],
  },

  Action: {
    key: 'Action',
    label: 'Action',
    directed: false,
    color: '#f59e0b',
    shape: 'round-tag',
    titleProp: 'title',
    description: 'A corrective action taken for an issue.',
    props: [
      { key: 'title', label: 'Title', type: FIELD.TEXT, required: true, placeholder: 'e.g. Re-qualify weld fixture' },
      { key: 'state', label: 'State', type: FIELD.SELECT, options: ['planned', 'in-progress', 'done', 'cancelled'], default: 'planned' },
      { key: 'dueDate', label: 'Due date', type: FIELD.DATE },
      { key: 'effortHours', label: 'Effort', type: FIELD.NUMBER, min: 0, step: 0.5, unit: 'h' },
    ],
  },

  Report: {
    key: 'Report',
    label: 'Report',
    directed: false,
    color: '#a855f7',
    shape: 'round-rectangle',
    titleProp: 'title',
    description: 'An inspection / resolution report written for an issue.',
    props: [
      { key: 'title', label: 'Title', type: FIELD.TEXT, required: true, placeholder: 'e.g. NDT inspection #42' },
      { key: 'reportType', label: 'Type', type: FIELD.SELECT, options: ['', 'inspection', 'root-cause', 'resolution', 'audit'] },
      { key: 'completedOn', label: 'Completed on', type: FIELD.DATE },
      { key: 'conclusion', label: 'Conclusion', type: FIELD.TEXTAREA },
    ],
  },
};

/* ==========================================================================
 * EDGE TYPES
 * ==========================================================================
 * Each entry:
 *   key         internal id, also stored on the element as data.type
 *   label       drawn on the edge, and used in menus
 *   directed    true  -> arrowhead + belongs to the HySE hierarchy
 *   source/target  the ALLOWED endpoint node types.
 *                  For undirected types the pair is matched in either order
 *                  (see isEndpointPairValid below) — you may draw
 *                  Issue -> User or User -> Issue, both are accepted.
 *   color/style  line styling so every relationship type is distinguishable
 *   props        construction form; at least one required property each.
 */
export const EDGE_TYPES = {
  contains: {
    key: 'contains',
    label: 'contains',
    directed: true,
    source: 'Part',
    target: 'Part',
    color: '#1d4ed8',
    lineStyle: 'solid',
    width: 3,
    description: 'Whole-part relationship: the parent assembly contains the child part.',
    props: [
      { key: 'quantity', label: 'Quantity', type: FIELD.NUMBER, required: true, default: 1, min: 0, step: 1,
        help: 'How many of the child go into ONE parent. Multiplies through the roll-up.' },
      { key: 'refDes', label: 'Reference designator', type: FIELD.TEXT, placeholder: 'e.g. R1, U3' },
      { key: 'findNo', label: 'Find no', type: FIELD.TEXT },
    ],
  },

  hasIssue: {
    key: 'hasIssue',
    label: 'has issue',
    directed: false,
    source: 'Part',
    target: 'Issue',
    color: '#ef4444',
    lineStyle: 'solid',
    width: 2,
    description: 'The issue is associated with the part.',
    props: [
      { key: 'detectedAt', label: 'Detected at', type: FIELD.SELECT, required: true,
        options: ['incoming-inspection', 'assembly', 'test', 'field'], default: 'assembly' },
      { key: 'affectedLots', label: 'Affected lots', type: FIELD.TEXT },
    ],
  },

  reportedBy: {
    key: 'reportedBy',
    label: 'reported by',
    directed: false,
    source: 'Issue',
    target: 'User',
    color: '#22d3ee',
    lineStyle: 'dashed',
    width: 2,
    description: 'The user reported the issue.',
    props: [
      { key: 'reportedOn', label: 'Reported on', type: FIELD.DATE, required: true },
      { key: 'channel', label: 'Channel', type: FIELD.SELECT, options: ['', 'shop-floor', 'e-mail', 'ERP', 'customer'] },
    ],
  },

  actionFor: {
    key: 'actionFor',
    label: 'action for',
    directed: false,
    source: 'Issue',
    target: 'Action',
    color: '#f59e0b',
    lineStyle: 'solid',
    width: 2,
    description: 'The action was taken for the issue.',
    props: [
      { key: 'priority', label: 'Priority', type: FIELD.SELECT, required: true,
        options: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
      { key: 'rationale', label: 'Rationale', type: FIELD.TEXTAREA },
    ],
  },

  reportFor: {
    key: 'reportFor',
    label: 'report for',
    directed: false,
    source: 'Issue',
    target: 'Report',
    color: '#a855f7',
    lineStyle: 'solid',
    width: 2,
    description: 'The report was written for the issue.',
    props: [
      { key: 'scope', label: 'Scope', type: FIELD.SELECT, required: true,
        options: ['partial', 'full'], default: 'full' },
      { key: 'revision', label: 'Revision', type: FIELD.TEXT },
    ],
  },

  createdAction: {
    key: 'createdAction',
    label: 'created',
    directed: false,
    source: 'User',
    target: 'Action',
    color: '#84cc16',
    lineStyle: 'dotted',
    width: 2,
    description: 'The user created the action to be taken.',
    props: [
      { key: 'createdOn', label: 'Created on', type: FIELD.DATE, required: true },
    ],
  },

  assignedAction: {
    key: 'assignedAction',
    label: 'assigned to',
    directed: false,
    source: 'User',
    target: 'Action',
    color: '#fb923c',
    lineStyle: 'dashed',
    width: 2,
    description: 'The action was assigned to the user.',
    props: [
      { key: 'assignedOn', label: 'Assigned on', type: FIELD.DATE, required: true },
      { key: 'accepted', label: 'Accepted', type: FIELD.SELECT, options: ['yes', 'no'], default: 'yes' },
    ],
  },

  completedReport: {
    key: 'completedReport',
    label: 'completed',
    directed: false,
    source: 'User',
    target: 'Report',
    color: '#c084fc',
    lineStyle: 'dotted',
    width: 2,
    description: 'The user completed the report.',
    props: [
      { key: 'completedOn', label: 'Completed on', type: FIELD.DATE, required: true },
      { key: 'hoursSpent', label: 'Hours spent', type: FIELD.NUMBER, min: 0, step: 0.5, unit: 'h' },
    ],
  },
};

/* ==========================================================================
 * SATELLITE ANCHORING
 * ==========================================================================
 * When a Part is folded away by the complexity-management operations, the
 * contextual metadata hanging off it has to follow — otherwise you collapse an
 * assembly and its issues stay behind as free-floating debris.
 *
 * "Follow" is not the same as "is connected to", though. The satellite graph is
 * densely cross-linked through Users (one engineer touches issues all over the
 * BoM), so plain connectivity would drag a hidden part's issue straight back
 * onto the canvas through some unrelated colleague.
 *
 * Instead each satellite type declares what it *exists because of*:
 *
 *   Issue  exists because of a Part   -> hide it when all its parts are hidden
 *   Action exists because of an Issue -> hide it when all its issues are hidden
 *   Report exists because of an Issue -> same
 *   User   exists on their own, but is only worth drawing while they own some
 *          visible work, so they follow their issues/actions/reports
 *
 * A satellite with NO anchor links at all is always shown — otherwise a User
 * you just created would vanish before you could connect them to anything.
 *
 * The map is evaluated in dependency order (see topoOrder below), so Issues are
 * resolved after Parts, Actions/Reports after Issues, and Users last.
 */
export const ANCHORS = {
  Issue: ['Part'],
  Action: ['Issue'],
  Report: ['Issue'],
  User: ['Issue', 'Action', 'Report'],
};

/**
 * Satellite types in an order where every type's anchors are already resolved.
 * Computed rather than hard-coded so ANCHORS stays the only thing to edit.
 * Falls back to declaration order if the anchor graph ever becomes cyclic.
 */
export function anchorResolutionOrder() {
  const pending = Object.keys(ANCHORS);
  const done = new Set(['Part']);   // the hierarchy pass resolves Parts first
  const order = [];

  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    for (let i = 0; i < pending.length; i += 1) {
      const t = pending[i];
      if (ANCHORS[t].every((a) => done.has(a))) {
        order.push(t);
        done.add(t);
        pending.splice(i, 1);
        break;
      }
    }
  }
  return [...order, ...pending];    // pending is non-empty only if cyclic
}

/* ==========================================================================
 * Derived helpers
 * ========================================================================== */

/** The one and only directed (hierarchy-forming) edge type: Part -> Part. */
export const HIERARCHY_EDGE = 'contains';

export const NODE_TYPE_KEYS = Object.keys(NODE_TYPES);
export const EDGE_TYPE_KEYS = Object.keys(EDGE_TYPES);

/** Node types that HySE should treat as its directed core. */
export const DIRECTED_NODE_TYPES = NODE_TYPE_KEYS.filter((k) => NODE_TYPES[k].directed);

/**
 * Is this endpoint pair legal for `edgeTypeKey`?
 *
 * Directed types must match source/target exactly (a BoM edge always points
 * parent -> child). Undirected types accept either order, because "undirected"
 * means the drawing direction carries no meaning — the user should not have to
 * remember whether to drag from the Issue or from the User.
 *
 * @returns {{ok: true, flip: boolean} | {ok: false, reason: string}}
 *          `flip: true` means the caller should swap source/target so that the
 *          stored edge always matches the schema's canonical orientation.
 */
export function isEndpointPairValid(edgeTypeKey, sourceType, targetType) {
  const def = EDGE_TYPES[edgeTypeKey];
  if (!def) return { ok: false, reason: `Unknown edge type "${edgeTypeKey}"` };

  if (sourceType === def.source && targetType === def.target) return { ok: true, flip: false };

  if (!def.directed && sourceType === def.target && targetType === def.source) {
    return { ok: true, flip: true };
  }

  return {
    ok: false,
    reason: `"${def.label}" connects ${def.source} ${def.directed ? '→' : '–'} ${def.target}, ` +
            `not ${sourceType} – ${targetType}.`,
  };
}

/** Every edge type that can legally connect the two given node types. */
export function edgeTypesFor(sourceType, targetType) {
  return EDGE_TYPE_KEYS.filter((k) => isEndpointPairValid(k, sourceType, targetType).ok);
}

/** The caption drawn under a node = its title property, with a sane fallback. */
export function nodeCaption(data) {
  const def = NODE_TYPES[data.type];
  if (!def) return data.id;
  return String(data[def.titleProp] ?? '').trim() || `(untitled ${def.label})`;
}

/** Default property values for a freshly created element of this type. */
export function defaultsFor(def) {
  const out = {};
  for (const p of def.props) {
    if (p.default !== undefined) out[p.key] = p.default;
  }
  return out;
}

/**
 * Validate a filled-in property form against a type definition.
 * @returns {{ok: boolean, errors: Record<string,string>, values: object}}
 */
export function validateProps(def, raw) {
  const errors = {};
  const values = {};

  for (const p of def.props) {
    let v = raw[p.key];

    if (typeof v === 'string') v = v.trim();

    const empty = v === undefined || v === null || v === '';

    if (empty) {
      if (p.required) errors[p.key] = `${p.label} is required`;
      continue; // never store empty strings — keeps exported JSON clean
    }

    if (p.type === FIELD.NUMBER) {
      const n = Number(v);
      if (!Number.isFinite(n)) { errors[p.key] = `${p.label} must be a number`; continue; }
      if (p.min !== undefined && n < p.min) { errors[p.key] = `${p.label} must be ≥ ${p.min}`; continue; }
      v = n;
    }

    if (p.type === FIELD.SELECT && p.options && !p.options.includes(String(v))) {
      errors[p.key] = `${p.label} must be one of: ${p.options.filter(Boolean).join(', ')}`;
      continue;
    }

    values[p.key] = v;
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}
