/**
 * Headless self-test for the graph engine.
 *
 *   node tools/selftest.mjs
 *
 * Runs the real Cytoscape core (headless mode) against the real store,
 * hierarchy, collapse and analysis modules — no mocks. It exists because the
 * DAG logic (shared sub-assemblies, collapse fixpoints, roll-up over diamonds)
 * is exactly the kind of thing that looks right in the browser until the one
 * graph shape you didn't try.
 */

// cytoscape-hyse's entry point does `typeof window["cytoscape"]`, which
// dereferences `window` before `typeof` can protect it. In a browser that is
// fine; under Node we have to provide the object.
globalThis.window = globalThis.window || {};
globalThis.performance = globalThis.performance || { now: () => 0 };

const cytoscape = (await import('cytoscape')).default;
const { loadSample } = await import('../src/model/sample.js');
const { createNode, createEdge, toJSON, fromJSON, updateElement, deleteElement } = await import('../src/graph/store.js');
const H = await import('../src/graph/hierarchy.js');
const { createComplexityManager, HIDDEN_CLASS } = await import('../src/graph/collapse.js');
const A = await import('../src/graph/analysis.js');
const { tagDirectedness } = await import('../src/graph/layout.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(`${name} ${detail}`); console.log(`  FAIL ${name} ${detail}`); }
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    `-> got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

const cy = cytoscape({ headless: true, styleEnabled: false });
// Fails loudly instead of returning an empty collection: an empty collection
// makes every `visible(...)` assertion silently pass.
const byName = (n) => {
  const hit = cy.nodes(`[type = "Part"]`).filter((x) => x.data('name') === n);
  if (hit.empty()) { fail += 1; failures.push(`byName("${n}") matched nothing`); console.log(`  FAIL byName("${n}") matched nothing`); }
  return hit.first();
};

/* ========================================================================== */
section('sample data');
const s = loadSample(cy);
check('sample built with no validation problems', s.ok, JSON.stringify(s.problems));
eq('node count', s.nodes, 30 + 3 + 3 + 3 + 2);
check('edge count > 50', cy.edges().length > 50, `got ${cy.edges().length}`);
eq('all 5 node types present',
  [...new Set(cy.nodes().map((n) => n.data('type')))].sort(),
  ['Action', 'Issue', 'Part', 'Report', 'User']);
eq('all 8 edge types present', [...new Set(cy.edges().map((e) => e.data('type')))].length, 8);

/* ========================================================================== */
section('HySE directedness contract');
tagDirectedness(cy);
const directed = cy.nodes().filter((n) => n.data('isDirected') === 1);
eq('only Parts are directed', [...new Set(directed.map((n) => n.data('type')))], ['Part']);
eq('every Part is directed', directed.length, cy.nodes('[type = "Part"]').length);
check('satellites are isDirected 0',
  cy.nodes('[type != "Part"]').every((n) => n.data('isDirected') === 0));
// HySE puts an edge in the hierarchy iff BOTH endpoints are directed.
const hierEdges = cy.edges().filter((e) => e.source().data('isDirected') === 1 && e.target().data('isDirected') === 1);
eq('directed-edge set == contains-edge set',
  hierEdges.length, cy.edges('[type = "contains"]').length);

/* ========================================================================== */
section('DAG structure');
const screw = byName('M3x8 Screw');
const bearing = byName('Ball Bearing 8x4x3');
const s1 = byName('Survey Drone S1');
const d2 = byName('Delivery Drone D2');
const airframe = byName('Airframe Assembly');
const motor = byName('BLDC Motor 2207');
const gmotor = byName('Gimbal Motor GM40');

eq('roots are the two products', H.roots(cy).map((n) => n.data('name')).sort(), ['Delivery Drone D2', 'Survey Drone S1']);
eq('screw has 5 parents', H.parentsOf(screw).length, 5);
eq('bearing is a diamond (2 parents)', H.parentsOf(bearing).map((n) => n.data('name')).sort(),
  ['BLDC Motor 2207', 'Gimbal Motor GM40']);
check('screw is a descendant of S1', H.descendants(s1).getElementById(screw.id()).nonempty());
check('bearing is a descendant of S1 via two routes', H.pathsToRoots(bearing).length >= 3);
eq('commonality finds shared parts',
  A.showCommonality(cy).map((x) => x.name).slice(0, 3),
  ['M3x8 Screw', 'Airframe Assembly', 'Propulsion Module']);
A.clearOverlays(cy);

section('cycle prevention');
check('self-loop refused', H.wouldCreateCycle(cy, s1.id(), s1.id()));
check('screw -> S1 would cycle', H.wouldCreateCycle(cy, screw.id(), s1.id()));
check('S1 -> screw does not cycle (already exists though)', !H.wouldCreateCycle(cy, s1.id(), screw.id()));
const cyc = createEdge(cy, 'contains', screw.id(), s1.id(), { quantity: 1 });
check('store refuses a cyclic contains edge', !cyc.ok, cyc.error);
check('cycle error mentions the BoM', /cyclic/i.test(cyc.error || ''), cyc.error);

section('endpoint + duplicate validation');
const bad = createEdge(cy, 'contains', s1.id(), cy.nodes('[type = "User"]').first().id(), { quantity: 1 });
check('Part -> User refused for "contains"', !bad.ok, bad.error);
const dupe = createEdge(cy, 'contains', s1.id(), airframe.id(), { quantity: 1 });
check('duplicate contains refused', !dupe.ok, dupe.error);
const issue1 = cy.nodes('[type = "Issue"]').first();
const user1 = cy.nodes('[type = "User"]').first();
const flipped = createEdge(cy, 'reportedBy', user1.id(), issue1.id(), { reportedOn: '2026-01-01' });
check('undirected edge accepted in reverse drag order (or already exists)',
  !flipped.ok ? /already connected/.test(flipped.error) : flipped.element.data('source') === issue1.id(),
  flipped.error || flipped.element.data('source'));
const missingReq = createNode(cy, 'Issue', { severity: 'high' });
check('required property enforced', !missingReq.ok, missingReq.error);

/* ========================================================================== */
section('roll-up analysis');
const rS1 = H.rollUp(s1);
const rD2 = H.rollUp(d2);
check('S1 rolled cost is positive', rS1.cost > 0, String(rS1.cost));
check('D2 costs more than S1 (2 battery packs)', rD2.cost > rS1.cost, `${rD2.cost} vs ${rS1.cost}`);
// hand-computed spot check on a small sub-tree:
//   Battery Pack = 120 + 12*4.2 + 1*16 + 1*6.5 = 192.9
eq('battery pack roll-up', Number(H.rollUp(byName('Battery Pack')).cost.toFixed(2)), 192.9);
//   lead time takes the MAX down a branch, not the sum: 21 + max(28,15,7) = 49
eq('battery pack lead time (max, not sum)', H.rollUp(byName('Battery Pack')).leadTime, 49);
//   pieces for Battery Pack = 12*(1+0) + 1*(1+0) + 1*(1+0) = 14
eq('battery pack pieces', H.rollUp(byName('Battery Pack')).pieces, 14);
check('diamond counted once in `distinct`',
  H.rollUp(byName('BLDC Motor 2207')).distinct === 4, String(H.rollUp(motor).distinct));

const cp = A.showCriticalPath(cy, s1);
check('critical path starts at S1', cp.chain[0] === 'Survey Drone S1', cp.chain.join(' > '));
eq('critical path days == rolled lead time', cp.days, rS1.leadTime);
A.clearOverlays(cy);

/* ========================================================================== */
section('complexity management');
const cm = createComplexityManager(cy);
cm.recompute();
const hidden = () => cy.nodes(`.${HIDDEN_CLASS}`).map((n) => n.data('name') || n.data('title') || n.id());
const visible = (n) => !n.hasClass(HIDDEN_CLASS);

eq('nothing hidden initially', cy.nodes(`.${HIDDEN_CLASS}`).length, 0);

/* --- the DAG case: shared sub-assemblies must survive a sibling's collapse -- */
cm.collapseDown(airframe);
check('collapsing Airframe hides its exclusive child (Carbon Arm)', !visible(byName('Carbon Arm')));
check('...but the SHARED screw stays (still reached via Propulsion)', visible(screw), hidden().join(', '));
check('Airframe itself stays visible', visible(airframe));
check('Airframe advertises a "hidden below" badge', airframe.data('hiddenBelow') > 0);
cm.expandAll();

cm.collapseDown(s1);
check('collapsing S1 does NOT hide the Airframe (D2 still consumes it)', visible(airframe));
check('collapsing S1 DOES hide its exclusive Camera Gimbal', !visible(byName('Camera Gimbal')));
check('...and the gimbal-only parts below it', !visible(byName('Camera Sensor 4K')));
check('Cargo Bay (D2-only) is untouched', visible(byName('Cargo Bay')));
cm.expandAll();

/* --- collapse every parent of the screw: only then may it disappear -------- */
H.parentsOf(screw).forEach((p) => cm.collapseDown(p));
check('screw hides once ALL five of its parents are collapsed', !visible(screw), hidden().join(', '));
cm.expandAll();

/* --- expand N levels ------------------------------------------------------ */
cm.collapseDown(s1);
cm.collapseDown(d2);
check('both products collapsed: level 1 hidden', !visible(airframe) && !visible(byName('Battery Pack')));

cm.expandDown(s1, 1);
check('expand 1 level reveals level 1 (Airframe)', visible(airframe));
check('expand 1 level stops before level 2 (Carbon Arm)', !visible(byName('Carbon Arm')), hidden().join(', '));

cm.expandDown(s1, 3);
check('expand 3 levels reveals level 2 (Carbon Arm)', visible(byName('Carbon Arm')));
check('expand 3 levels reveals level 3 (Stator Winding)', visible(byName('Stator Winding')));
check('expand 3 levels still stops at level 3 (D2-only Bay Shell unreachable)',
  !visible(byName('Cargo Bay')), 'D2 is still fully collapsed');

cm.expandDown(s1, Infinity);
check('expand all (downstream) reveals the whole S1 tree', visible(byName('Stator Winding')));
check('...and D2 stays collapsed — the operations are per-node',
  !visible(byName('Cargo Bay')));
cm.expandAll();

/* --- upstream ------------------------------------------------------------- */
cm.collapseUp(airframe);
check('collapse upstream hides BOTH products', !visible(s1) && !visible(d2), hidden().join(', '));
check('...keeps the part itself', visible(airframe));
check('...keeps its own sub-parts', visible(byName('Carbon Arm')));
check('...and a part orphaned by it becomes a new top-level item',
  visible(byName('Camera Gimbal')));
eq('Airframe advertises a "hidden above" badge', airframe.data('hiddenAbove'), 2);

cm.expandUp(airframe, 1);
check('expand upstream 1 level brings the products back', visible(s1) && visible(d2));
cm.expandAll();

/* --- satellites follow their anchors -------------------------------------- */
const armIssue = cy.nodes('[type = "Issue"]').filter((n) => /Delamination/.test(n.data('title'))).first();
const armAction = cy.nodes('[type = "Action"]').filter((n) => /layup/.test(n.data('title'))).first();
const armReport = cy.nodes('[type = "Report"]').filter((n) => /CT scan/.test(n.data('title'))).first();
const mdemir = cy.nodes('[type = "User"]').filter((n) => n.data('name') === 'M. Demir').first();

check('arm issue visible while the arm is', visible(armIssue));
cm.collapseDown(airframe);
check('arm hidden after collapsing the airframe', !visible(byName('Carbon Arm')));
check('its Issue follows the part', !visible(armIssue), hidden().join(', '));
check('the Action for that issue follows the issue', !visible(armAction));
check('the Report for that issue follows the issue', !visible(armReport));
check('a User who still owns other visible work stays visible', visible(mdemir),
  'M. Demir is also on the cell and screw issues');
cm.expandAll();
eq('everything back after expand all', cy.nodes(`.${HIDDEN_CLASS}`).length, 0);

/* --- a brand-new, unconnected satellite must not vanish -------------------- */
const lonely = createNode(cy, 'User', { name: 'Z. Fresh' });
check('fresh user created', lonely.ok, lonely.error);
cm.recompute();
check('an unconnected satellite stays visible', visible(lonely.element));
deleteElement(lonely.element);

/* --- type filters --------------------------------------------------------- */
cm.setTypeMuted('Report', true);
check('muting a type hides exactly those nodes',
  cy.nodes(`.${HIDDEN_CLASS}`).length > 0
  && cy.nodes(`.${HIDDEN_CLASS}`).every((n) => n.data('type') === 'Report'));
cm.setTypeMuted('Report', false);
eq('unmuting restores them', cy.nodes(`.${HIDDEN_CLASS}`).length, 0);

/* --- collapse-all / expand-all ------------------------------------------- */
cm.collapseAllDown();
check('collapse all leaves only the products', cy.nodes(`[type = "Part"]`).filter(visible).length === 2,
  String(cy.nodes(`[type = "Part"]`).filter(visible).length));
cm.expandAll();
eq('expand all restores every node', cy.nodes(`.${HIDDEN_CLASS}`).length, 0);

/* ========================================================================== */
section('colour modes');
for (const mode of ['leadTime', 'cost', 'risk', 'issues']) {
  const r = A.applyColourMode(cy, mode);
  check(`colour by ${mode} shades some parts`, r.coloured > 0, JSON.stringify(r));
  check(`colour by ${mode} writes a shade`, cy.nodes('.shaded').first().data('shade')?.startsWith('#'));
  A.clearOverlays(cy);
}
eq('clearOverlays removes shade data', cy.nodes('[shade]').length, 0);

section('impact analysis');
const imp = A.showImpact(cy, screw);
eq('screw impacts both products', imp.products.sort(), ['Delivery Drone D2', 'Survey Drone S1']);
check('impact classes applied', cy.elements('.impact').length > 0);
check('unrelated elements dimmed', cy.elements('.dimmed').length > 0);
A.clearOverlays(cy);
check('overlays cleared', cy.elements('.impact, .dimmed, .impact-source').length === 0);

/* ========================================================================== */
section('edit + delete');
const before = cy.edges().length;
const upd = updateElement(screw, { name: 'M3x8 Screw A2', partNo: 'FST-0038', unitCost: 0.05, supplierRisk: 'low' });
check('update accepted', upd.ok, upd.error);
eq('update wrote the value', screw.data('unitCost'), 0.05);
eq('cleared optional field removed', screw.data('leadTimeDays'), undefined);
const badUpd = updateElement(screw, { name: '' });
check('update rejects empty required field', !badUpd.ok, badUpd.error);

const victim = byName('Bay Shell');
const victimEdges = victim.connectedEdges().length;
deleteElement(victim);
eq('deleting a node cascades its edges', cy.edges().length, before - victimEdges);

/* ========================================================================== */
section('JSON round-trip');
const json = toJSON(cy);
check('exported format tag', json.format === 'ivis-bom-hyse');
check('every id is safe for a Cytoscape `#id` selector (HySE requirement)',
  cy.elements().every((e) => /^[A-Za-z][A-Za-z0-9_]*$/.test(e.id())),
  cy.elements().filter((e) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(e.id())).map((e) => e.id()).join(','));
check('runtime fields stripped', json.nodes.every((n) => n.data.isDirected === undefined && n.data.hiddenBelow === undefined));
const cy2 = cytoscape({ headless: true, styleEnabled: false });
const imported = fromJSON(cy2, json);
check('import ok', imported.ok, JSON.stringify(imported.warnings));
eq('import warns about nothing', imported.warnings.length, 0);
eq('node count round-trips', cy2.nodes().length, cy.nodes().length);
eq('edge count round-trips', cy2.edges().length, cy.edges().length);
eq('ids round-trip', cy2.nodes().map((n) => n.id()).sort().join(), cy.nodes().map((n) => n.id()).sort().join());
tagDirectedness(cy2);
eq('re-derived directedness matches',
  cy2.nodes().filter((n) => n.data('isDirected') === 1).length,
  cy.nodes('[type = "Part"]').length);
const badFile = fromJSON(cytoscape({ headless: true, styleEnabled: false }), { format: 'nope' });
check('unknown format rejected', !badFile.ok, badFile.error);

/* ========================================================================== */
console.log(`\n${'═'.repeat(64)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('═'.repeat(64));
process.exit(fail ? 1 : 0);
