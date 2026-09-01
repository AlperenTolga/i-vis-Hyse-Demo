/**
 * End-to-end smoke test — drives the REAL app in a REAL browser.
 *
 *   npm run dev                       # in one terminal (serves on :5173)
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/browser-smoke.mjs
 *
 * Playwright is deliberately NOT a dependency of this project: the app itself
 * has no build-time need for it, and a 100 MB browser download should be an
 * explicit choice. tools/selftest.mjs covers the graph engine with no browser
 * at all and is the one to run in CI by default.
 *
 * What this adds over selftest.mjs is everything that only exists on a canvas:
 * that HySE really moves the nodes, that right-click opens the right menu, that
 * dragging between two nodes opens the edge dialog, and that the console stays
 * clean. Several genuine bugs in this project were only findable here.
 *
 * Env: SMOKE_URL to point at another origin, SMOKE_SHOTS for the screenshot dir.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.SMOKE_URL || 'http://localhost:5173/';
const OUT = process.env.SMOKE_SHOTS || 'tools/screenshots';
mkdirSync(OUT, { recursive: true });
const errors = [];
const warnings = [];
let pass = 0, fail = 0;
const ck = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${d}`); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (m.type() === 'warning') warnings.push(t);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0,4).join('\n')));
page.on('requestfailed', (r) => errors.push(`REQFAIL ${r.url()} — ${r.failure()?.errorText}`));

console.log('── boot ─────────────────────────────────────');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.cy && window.cy.nodes().length > 0, { timeout: 20000 });
// wait for the boot layout to actually finish before touching coordinates
await page.waitForFunction(() => !document.querySelector('#status').textContent.includes('running'), { timeout: 30000 });
await page.waitForTimeout(1200); // viewport fit animation

const counts = await page.evaluate(() => ({
  nodes: cy.nodes().length, edges: cy.edges().length,
  hidden: cy.nodes('.cm-hidden').length,
  types: [...new Set(cy.nodes().map(n => n.data('type')))].sort(),
  edgeTypes: [...new Set(cy.edges().map(e => e.data('type')))].sort(),
  positioned: cy.nodes().filter(n => n.position('x') !== 0 || n.position('y') !== 0).length,
  isDirected: cy.nodes().filter(n => n.data('isDirected') === 1).length,
}));
console.log('  ', JSON.stringify(counts));
ck('sample auto-loaded', counts.nodes === 41, `nodes=${counts.nodes}`);
ck('ids are Cytoscape-selector safe', await page.evaluate(() => cy.elements().every(e => /^[A-Za-z][A-Za-z0-9_]*$/.test(e.id()))));
ck('all 5 node types', counts.types.length === 5, counts.types.join(','));
ck('all 8 edge types', counts.edgeTypes.length === 8, counts.edgeTypes.join(','));
ck('HySE laid nodes out (not all at 0,0)', counts.positioned > 35, `positioned=${counts.positioned}`);
ck('only Parts flagged isDirected', counts.isDirected === 30, `n=${counts.isDirected}`);
ck('status bar rendered', (await page.textContent('#status')).includes('Nodes'));
ck('layout engine reported as hyse', (await page.textContent('#status')).includes('hyse'),
   await page.textContent('#status'));
ck('sidebar legend rendered', (await page.locator('.legend-row').count()) === 8);
// HySE paints inline border styles on nodes it swaps (its colorSwappedPair flag
// is inverted); layout.js must strip them or the stylesheet loses control.
const borders = await page.evaluate(() => {
  const cols = cy.nodes('[type="Part"]').map(n => n.renderedStyle('border-color'));
  const widths = new Set(cy.nodes('[type="Part"]').map(n => n.renderedStyle('border-width')));
  return { distinctColours: [...new Set(cols)], distinctWidths: [...widths] };
});
ck('no leftover inline border styling from HySE',
   borders.distinctColours.length === 1 && borders.distinctWidths.length === 1,
   JSON.stringify(borders));
ck('palette has 5 buttons', (await page.locator('.pal-btn').count()) === 5);
await page.screenshot({ path: `${OUT}/01-boot.png` });

console.log('\n── inspector (left-click selection) ──────────');
await page.evaluate(() => {
  const n = cy.nodes('[type="Part"]').filter(x => x.data('name') === 'Battery Pack').first();
  cy.center(n); n.select();
});
await page.waitForTimeout(400);
const insp = await page.textContent('#inspector');
ck('inspector shows the type', insp.includes('Part'));
ck('inspector shows the name field value',
   (await page.locator('#inspector .field-input').first().inputValue()) === 'Battery Pack');
ck('inspector shows rolled-up figures', insp.includes('Rolled-up BoM figures'));
ck('roll-up cost is the hand-computed 192.9', insp.includes('192.9'), insp.match(/\$[\d.,]+/)?.[0]);
ck('lead time uses max not sum (49 d)', insp.includes('49 d'));
ck('connection list rendered', (await page.locator('#inspector .conn').count()) >= 4);
ck('selected node is highlighted',
   await page.evaluate(() => cy.$(':selected').length === 1));
await page.screenshot({ path: `${OUT}/02-inspector.png` });

console.log('\n── complexity management ────────────────────');
const before = await page.evaluate(() => cy.nodes('.cm-hidden').length);
await page.evaluate(() => {
  const n = cy.nodes('[type="Part"]').filter(x => x.data('name') === 'Airframe Assembly').first();
  n.data('cutDown', 0);
});
// drive it through the real UI path instead: use the exposed manager if present
const collapsed = await page.evaluate(() => {
  const n = cy.nodes('[type="Part"]').filter(x => x.data('name') === 'Airframe Assembly').first();
  n.removeData('cutDown');
  return true;
});
// right-click the node and use the real context menu
await page.evaluate(() => {
  const n = cy.nodes('[type="Part"]').filter(x => x.data('name') === 'Airframe Assembly').first();
  cy.zoom(1); cy.center(n);
});
await page.waitForTimeout(900);
const box = await page.locator('#cy').boundingBox();
const pos = await page.evaluate(() => {
  const n = cy.nodes('[type="Part"]').filter(x => x.data('name') === 'Airframe Assembly').first();
  return n.renderedPosition();
});
await page.mouse.click(box.x + pos.x, box.y + pos.y, { button: 'right' });
await page.waitForTimeout(500);
const menuVisible = await page.locator('.cy-context-menus-cxt-menu:visible').count();
ck('context menu opens on right-click', menuVisible > 0);
await page.screenshot({ path: `${OUT}/03-contextmenu.png` });

const menuText = await page.locator('.cy-context-menus-cxt-menu:visible').first().innerText().catch(() => '');
ck('menu offers "Collapse downstream"', /Collapse downstream/.test(menuText), menuText.slice(0,200));
ck('menu offers "Expand upstream"', /Expand upstream/.test(menuText));
ck('menu offers impact analysis', /Impact analysis/.test(menuText));

await page.getByText('Collapse downstream (sub-parts)').first().click();
await page.waitForTimeout(700);
const afterCollapse = await page.evaluate(() => ({
  hidden: cy.nodes('.cm-hidden').map(n => n.data('name') || n.data('title')),
  screwVisible: !cy.nodes('[type="Part"]').filter(n => n.data('name') === 'M3x8 Screw').first().hasClass('cm-hidden'),
  armVisible: !cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Carbon Arm').first().hasClass('cm-hidden'),
  badge: cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Airframe Assembly').first().data('hiddenBelow'),
}));
ck('collapse hid the exclusive Carbon Arm', afterCollapse.armVisible === false);
ck('collapse KEPT the shared M3x8 Screw', afterCollapse.screwVisible === true, JSON.stringify(afterCollapse.hidden));
ck('badge counts what was folded', afterCollapse.badge > 0, String(afterCollapse.badge));
ck('a toast explained the result', (await page.locator('.toast').count()) > 0);
await page.screenshot({ path: `${OUT}/04-collapsed.png` });

console.log('\n── toolbar: expand all / colour / commonality ');
await page.getByRole('button', { name: 'Expand all' }).click();
await page.waitForTimeout(400);
ck('expand all restores everything', (await page.evaluate(() => cy.nodes('.cm-hidden').length)) === 0);

await page.selectOption('.select', 'leadTime');
await page.waitForTimeout(400);
ck('colour-by shades parts', (await page.evaluate(() => cy.nodes('.shaded').length)) > 0);
await page.screenshot({ path: `${OUT}/05-colour-leadtime.png` });

await page.selectOption('.select', 'none');
await page.getByRole('button', { name: 'Commonality' }).click();
await page.waitForTimeout(400);
ck('commonality rings shared parts', (await page.evaluate(() => cy.nodes('.shared-part').length)) >= 3);
await page.screenshot({ path: `${OUT}/06-commonality.png` });
await page.getByRole('button', { name: 'Clear', exact: true }).click();

console.log('\n── construction: add a node through the dialog ');
await page.locator('.pal-btn', { hasText: 'Part' }).first().click();
await page.waitForTimeout(300);
ck('dialog opened', (await page.locator('.modal:visible').count()) === 1);
ck('dialog shows required marker', (await page.locator('.modal .req').count()) >= 1);
await page.screenshot({ path: `${OUT}/07-dialog.png` });

// submit empty -> must be refused
await page.locator('.modal .btn.primary').click();
await page.waitForTimeout(250);
ck('empty required field refused', (await page.locator('.modal:visible').count()) === 1);
ck('error message shown', (await page.textContent('.modal-error')).length > 0,
   await page.textContent('.modal-error'));

await page.locator('.modal .field-input').first().fill('Test Bracket');
await page.locator('.modal .field-input').nth(2).fill('12.5');
await page.locator('.modal .btn.primary').click();
await page.waitForTimeout(400);
ck('dialog closed after valid submit', (await page.locator('.modal:visible').count()) === 0);
ck('node created with its property',
   await page.evaluate(() => cy.nodes('[type="Part"]').some(n => n.data('name') === 'Test Bracket' && n.data('unitCost') === 12.5)));
ck('new node total is 42', (await page.evaluate(() => cy.nodes().length)) === 42);

console.log('\n── construction: draw an edge ────────────────');
await page.evaluate(() => {
  const src = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Airframe Assembly').first();
  const dst = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Test Bracket').first();
  dst.position({ x: src.position('x') + 220, y: src.position('y') + 160 });
  cy.fit(cy.collection([src, dst]), 120);
});
await page.waitForTimeout(400);
const p2 = await page.evaluate(() => {
  const src = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Airframe Assembly').first();
  const dst = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Test Bracket').first();
  return { s: src.renderedPosition(), t: dst.renderedPosition() };
});
await page.keyboard.press('e');           // Connect mode
await page.waitForTimeout(250);
ck('connect mode engaged', await page.evaluate(() => document.body.classList.contains('draw-mode')));

// The drag itself is the flaky part of THIS harness (edgehandles snapping is
// time-based), not of the app — retry the gesture rather than the assertion.
for (let attempt = 0; attempt < 4; attempt++) {
  const p = await page.evaluate(() => {
    const src = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Airframe Assembly').first();
    const dst = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Test Bracket').first();
    return { s: src.renderedPosition(), t: dst.renderedPosition() };
  });
  await page.mouse.move(box.x + p.s.x, box.y + p.s.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(box.x + (p.s.x + p.t.x) / 2, box.y + (p.s.y + p.t.y) / 2, { steps: 15 });
  await page.mouse.move(box.x + p.t.x, box.y + p.t.y, { steps: 15 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.waitForTimeout(700);
  if ((await page.locator('.modal:visible').count()) === 1) break;
}
ck('edge dialog opened after the drag', (await page.locator('.modal:visible').count()) === 1);
await page.screenshot({ path: `${OUT}/08-edge-dialog.png` });
const edgeModal = await page.textContent('.modal').catch(() => '');
ck('edge dialog shows the endpoints', /Airframe Assembly/.test(edgeModal) && /Test Bracket/.test(edgeModal));
ck('edge dialog asks for the quantity property', /Quantity/.test(edgeModal));
const modalErrBefore = await page.textContent('.modal-error').catch(() => '');
await page.locator('.modal .btn.primary').click();
await page.waitForTimeout(700);
const edgeDiag = await page.evaluate(() => ({
  made: cy.edges('[type="contains"]').some(e =>
     e.source().data('name') === 'Airframe Assembly' && e.target().data('name') === 'Test Bracket'),
  bracketEdges: cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Test Bracket')
     .first().connectedEdges().map(e => `${e.data('type')}:${e.source().data('name')}->${e.target().data('name')}`),
  modalOpen: !document.querySelector('.modal-backdrop').hidden,
  modalErr: document.querySelector('.modal-error')?.textContent || '',
}));
ck('contains edge created', edgeDiag.made, JSON.stringify(edgeDiag) + ' preErr=' + modalErrBefore);
await page.keyboard.press('Escape');

console.log('\n── construction: illegal edges are refused ───');
const cycle = await page.evaluate(async () => {
  const m = await import('/src/graph/store.js');
  const child = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Test Bracket').first();
  const parent = cy.nodes('[type="Part"]').filter(n => n.data('name') === 'Airframe Assembly').first();
  return m.createEdge(cy, 'contains', child.id(), parent.id(), { quantity: 1 });
});
ck('cyclic contains refused in the browser too', cycle.ok === false, cycle.error);

console.log('\n── User–Action: two distinct relationships ───');
const twoTypes = await page.evaluate(async () => {
  const s = await import('/src/model/schema.js');
  return s.edgeTypesFor('User', 'Action');
});
ck('User–Action offers both created and assigned',
   twoTypes.length === 2 && twoTypes.includes('createdAction') && twoTypes.includes('assignedAction'),
   twoTypes.join(','));

console.log('\n── layout re-run + save/open ────────────────');
await page.getByRole('button', { name: 'Run HySE layout' }).click();
await page.waitForFunction(() => !document.querySelector('#status').textContent.includes('running'), { timeout: 30000 });
await page.waitForTimeout(1200);
ck('layout re-ran without error', (await page.textContent('#status')).includes('hyse'),
   await page.textContent('#status'));
await page.screenshot({ path: `${OUT}/09-relayout.png` });

const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.getByRole('button', { name: 'Save', exact: true }).click();
const download = await dl;
ck('Save produced a download', Boolean(download), download ? await download.suggestedFilename() : 'none');

console.log('\n── HySE parameter popover ───────────────────');
await page.locator('.btn.icon').first().click();
await page.waitForTimeout(250);
ck('HySE options popover opens', await page.locator('.popover:visible').count() === 1);
ck('popover exposes rankGap', (await page.textContent('.popover')).includes('Rank gap'));
await page.screenshot({ path: `${OUT}/10-hyse-options.png` });
await page.mouse.click(box.x + 40, box.y + 40);

await page.screenshot({ path: `${OUT}/11-final.png`, fullPage: false });

console.log('\n════════════════════════════════════════════');
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`  console errors: ${errors.length}`);
errors.slice(0, 12).forEach(e => console.log('   ! ' + e.slice(0, 300)));
const relevantWarnings = warnings.filter(w => !/vite|hmr|Download the React/i.test(w));
console.log(`  console warnings: ${relevantWarnings.length}`);
relevantWarnings.slice(0, 8).forEach(w => console.log('   ~ ' + w.slice(0, 220)));
console.log('════════════════════════════════════════════');

await browser.close();
process.exit(fail || errors.length ? 1 : 0);
