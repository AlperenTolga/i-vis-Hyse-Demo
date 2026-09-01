/**
 * ============================================================================
 *  SAMPLE BoM — a small but honest product family.
 * ============================================================================
 *
 *  Chosen so that every feature has something to bite on:
 *
 *   - TWO products sharing sub-assemblies, so "commonality detection" finds
 *     something real (the M3x8 screw is consumed by five different parents, the
 *     bearing by two, and the whole propulsion module by both drones).
 *   - FOUR levels deep, so "expand 1 level / 3 levels / all" behave differently.
 *   - A genuine DIAMOND (Bearing reached via BLDC Motor and via Gimbal Motor),
 *     which is exactly the case where naive collapse implementations break.
 *   - Costs and lead times on the leaves, so the roll-up and critical-path
 *     analyses produce meaningful numbers.
 *   - All FIVE node types and all EIGHT edge types present at least once, so
 *     the legend and the stylesheet are exercised end to end.
 *
 *  It is built through the normal store API rather than hand-written JSON, so
 *  the sample can never drift out of sync with the validation rules — if a
 *  schema rule changes and the sample violates it, `loadSample` reports it.
 */

import { createNode, createEdge } from '../graph/store.js';

/* --------------------------------------------------------------------------
 * Parts: [key, name, partNo, unitCost, leadTimeDays, supplier, supplierRisk]
 * `unitCost` is the cost of the part *itself* (labour/casting/purchase); the
 * cost of its children is added by the roll-up, never typed in twice.
 * ------------------------------------------------------------------------ */
const PARTS = [
  ['droneS1',   'Survey Drone S1',      'DRN-S1-000',   180,  5,  'in-house',      'low'],
  ['droneD2',   'Delivery Drone D2',    'DRN-D2-000',   210,  5,  'in-house',      'low'],

  ['airframe',  'Airframe Assembly',    'AFR-1000',      60,  4,  'in-house',      'low'],
  ['propulsion','Propulsion Module',    'PRP-2000',      35,  6,  'in-house',      'medium'],
  ['avionics',  'Avionics Stack',       'AVX-3000',      90,  7,  'in-house',      'medium'],
  ['battery',   'Battery Pack',         'BAT-4000',     120, 21,  'CellWorks',     'high'],
  ['gimbal',    'Camera Gimbal',        'GMB-5000',     140, 12,  'OptiMech',      'medium'],
  ['cargo',     'Cargo Bay',            'CGO-6000',      70,  8,  'in-house',      'low'],

  ['arm',       'Carbon Arm',           'AFR-1010',      22, 18,  'CarbonTek',     'high'],
  ['plate',     'Center Plate',         'AFR-1020',      18,  9,  'CarbonTek',     'medium'],
  ['screw',     'M3x8 Screw',           'FST-0038',    0.04,  3,  'FastenAll',     'low'],
  ['bearing',   'Ball Bearing 8x4x3',   'BRG-0843',    0.85, 14,  'RollTech',      'medium'],

  ['motor',     'BLDC Motor 2207',      'MTR-2207',      19, 16,  'SkyMotor',      'medium'],
  ['esc',       'ESC 35A',              'ESC-0035',      12, 11,  'VoltDrive',     'medium'],
  ['prop',      'Propeller 9x4.5',      'PRP-0945',     2.4,  6,  'AeroBlade',     'low'],

  ['fc',        'Flight Controller',    'FCU-7000',      48, 24,  'NavCore',       'high'],
  ['gnss',      'GNSS Module',          'GNS-7100',      27, 19,  'NavCore',       'high'],
  ['radio',     'Radio Link 900MHz',    'RDL-7200',      31, 13,  'LinkWave',      'medium'],

  ['cell',      'Li-ion Cell 21700',    'CEL-2170',     4.2, 28,  'CellWorks',     'high'],
  ['bms',       'BMS Board',            'BMS-4100',      16, 15,  'CellWorks',     'high'],
  ['housing',   'Pack Housing',         'BAT-4200',     6.5,  7,  'PolyForm',      'low'],

  ['gmotor',    'Gimbal Motor GM40',    'MTR-0040',     8.9, 10,  'OptiMech',      'medium'],
  ['sensor',    'Camera Sensor 4K',     'CAM-4000',      95, 26,  'OptiSense',     'high'],
  ['gframe',    'Gimbal Frame',         'GMB-5100',      24,  9,  'OptiMech',      'low'],

  ['servo',     'Servo Latch',          'SRV-6100',     7.5,  8,  'ActuoTech',     'medium'],
  ['shell',     'Bay Shell',            'CGO-6200',      13,  6,  'PolyForm',      'low'],

  ['stator',    'Stator Winding',       'MTR-2207-S',     6, 12,  'SkyMotor',      'medium'],
  ['magnet',    'Rotor Magnet N52',     'MAG-N52',      0.6, 22,  'MagSource',     'high'],
  ['pcb',       'FCU Bare PCB',         'FCU-7000-P',   7.2, 20,  'PCBLine',       'medium'],
  ['imu',       'IMU Sensor',           'IMU-0600',      11, 30,  'NavCore',       'high'],
];

/* --------------------------------------------------------------------------
 * Whole-part edges: [parent, child, quantity, refDes?]
 * ------------------------------------------------------------------------ */
const CONTAINS = [
  ['droneS1', 'airframe',   1],
  ['droneS1', 'propulsion', 4],
  ['droneS1', 'avionics',   1],
  ['droneS1', 'battery',    1],
  ['droneS1', 'gimbal',     1],

  ['droneD2', 'airframe',   1],
  ['droneD2', 'propulsion', 4],
  ['droneD2', 'avionics',   1],
  ['droneD2', 'battery',    2],
  ['droneD2', 'cargo',      1],

  ['airframe',   'arm',     4],
  ['airframe',   'plate',   2],
  ['airframe',   'screw',  24],

  ['propulsion', 'motor',   1],
  ['propulsion', 'esc',     1],
  ['propulsion', 'prop',    1],
  ['propulsion', 'screw',   4],

  ['avionics',   'fc',      1],
  ['avionics',   'gnss',    1],
  ['avionics',   'radio',   1],
  ['avionics',   'screw',   6],

  ['battery',    'cell',   12],
  ['battery',    'bms',     1],
  ['battery',    'housing', 1],

  ['gimbal',     'gmotor',  3],
  ['gimbal',     'sensor',  1],
  ['gimbal',     'gframe',  1],
  ['gimbal',     'screw',   8],

  ['cargo',      'servo',   2],
  ['cargo',      'shell',   1],
  ['cargo',      'screw',   8],

  ['motor',      'stator',  1],
  ['motor',      'magnet', 14],
  ['motor',      'bearing', 2],   // \  the diamond: Bearing has two parents
  ['gmotor',     'bearing', 2],   // /

  ['fc',         'pcb',     1],
  ['fc',         'imu',     1],
];

/* --------------------------------------------------------------------------
 * The contextual metadata: the undirected satellite sub-graphs.
 * ------------------------------------------------------------------------ */
const USERS = [
  ['ayilmaz', { name: 'A. Yilmaz', role: 'quality',  email: 'a.yilmaz@example.com' }],
  ['mdemir',  { name: 'M. Demir',  role: 'engineer', email: 'm.demir@example.com' }],
  ['skaya',   { name: 'S. Kaya',   role: 'planner',  email: 's.kaya@example.com' }],
];

const ISSUES = [
  ['iArm',  { title: 'Delamination at arm root', severity: 'high',     status: 'in-progress',
              openedOn: '2026-06-14', description: 'Ply separation observed on 3 of 40 arms after vibration test.' }],
  ['iCell', { title: 'Cell swelling after 200 cycles', severity: 'critical', status: 'open',
              openedOn: '2026-07-02', description: 'Pouch deformation >2mm on the CellWorks B-lot.' }],
  ['iScrew',{ title: 'Thread galling on stainless batch', severity: 'medium', status: 'resolved',
              openedOn: '2026-05-08', description: 'Galling during torque-down on lot FA-2291.' }],
];

const ACTIONS = [
  ['aArm',  { title: 'Requalify layup process',    state: 'in-progress', dueDate: '2026-09-30', effortHours: 60 }],
  ['aCell', { title: 'Switch to A-grade cells',    state: 'planned',     dueDate: '2026-10-15', effortHours: 24 }],
  ['aScrew',{ title: 'Move to zinc-plated fasteners', state: 'done',     dueDate: '2026-06-01', effortHours: 8 }],
];

const REPORTS = [
  ['rArm',  { title: 'CT scan report #17',       reportType: 'inspection', completedOn: '2026-07-20',
              conclusion: 'Voids concentrated at the root radius; layup schedule is the likely cause.' }],
  ['rCell', { title: 'Cell cycling test report', reportType: 'root-cause', completedOn: '2026-08-11',
              conclusion: 'Swelling correlates with charge rate above 1.5C at >35 C.' }],
];

/** [edgeType, fromKey, toKey, props] — keys refer to the tables above. */
const SATELLITE_EDGES = [
  ['hasIssue', 'arm',   'iArm',   { detectedAt: 'test',                 affectedLots: 'CA-118, CA-119' }],
  ['hasIssue', 'cell',  'iCell',  { detectedAt: 'incoming-inspection',  affectedLots: 'B-lot' }],
  ['hasIssue', 'screw', 'iScrew', { detectedAt: 'assembly',             affectedLots: 'FA-2291' }],

  ['reportedBy', 'iArm',   'mdemir',  { reportedOn: '2026-06-14', channel: 'shop-floor' }],
  ['reportedBy', 'iCell',  'ayilmaz', { reportedOn: '2026-07-02', channel: 'ERP' }],
  ['reportedBy', 'iScrew', 'skaya',   { reportedOn: '2026-05-08', channel: 'shop-floor' }],

  ['actionFor', 'iArm',   'aArm',   { priority: 'high',   rationale: 'Structural margin is at risk on the arm root.' }],
  ['actionFor', 'iCell',  'aCell',  { priority: 'urgent', rationale: 'Safety-critical; blocks D2 certification.' }],
  ['actionFor', 'iScrew', 'aScrew', { priority: 'normal', rationale: 'Assembly rework cost.' }],

  ['reportFor', 'iArm',  'rArm',  { scope: 'full',    revision: 'B' }],
  ['reportFor', 'iCell', 'rCell', { scope: 'partial', revision: 'A' }],

  ['createdAction', 'mdemir',  'aArm',   { createdOn: '2026-06-16' }],
  ['createdAction', 'ayilmaz', 'aCell',  { createdOn: '2026-07-03' }],
  ['createdAction', 'skaya',   'aScrew', { createdOn: '2026-05-09' }],

  // Deliberately different from the "created" edges: this is the second,
  // distinct User-Action relationship the spec asks for.
  ['assignedAction', 'ayilmaz', 'aArm',   { assignedOn: '2026-06-17', accepted: 'yes' }],
  ['assignedAction', 'mdemir',  'aCell',  { assignedOn: '2026-07-04', accepted: 'yes' }],
  ['assignedAction', 'mdemir',  'aScrew', { assignedOn: '2026-05-10', accepted: 'no' }],

  ['completedReport', 'ayilmaz', 'rArm',  { completedOn: '2026-07-20', hoursSpent: 6 }],
  ['completedReport', 'mdemir',  'rCell', { completedOn: '2026-08-11', hoursSpent: 14 }],
];

/**
 * Wipe the graph and build the sample.
 * @returns {{ok:boolean, nodes:number, edges:number, problems:string[]}}
 */
export function loadSample(cy) {
  cy.elements().remove();

  const problems = [];
  const id = new Map(); // sample key -> real element id

  const add = (key, type, props) => {
    const res = createNode(cy, type, props, { position: { x: 0, y: 0 } });
    if (!res.ok) { problems.push(`node ${key}: ${res.error}`); return; }
    id.set(key, res.element.id());
  };

  cy.batch(() => {
    for (const [key, name, partNo, unitCost, leadTimeDays, supplier, supplierRisk] of PARTS) {
      add(key, 'Part', { name, partNo, unitCost, leadTimeDays, supplier, supplierRisk });
    }
    USERS.forEach(([k, p]) => add(k, 'User', p));
    ISSUES.forEach(([k, p]) => add(k, 'Issue', p));
    ACTIONS.forEach(([k, p]) => add(k, 'Action', p));
    REPORTS.forEach(([k, p]) => add(k, 'Report', p));

    for (const [parent, child, quantity, refDes] of CONTAINS) {
      const res = createEdge(cy, 'contains', id.get(parent), id.get(child), { quantity, refDes });
      if (!res.ok) problems.push(`contains ${parent}->${child}: ${res.error}`);
    }

    for (const [type, from, to, props] of SATELLITE_EDGES) {
      const res = createEdge(cy, type, id.get(from), id.get(to), props);
      if (!res.ok) problems.push(`${type} ${from}-${to}: ${res.error}`);
    }
  });

  return { ok: problems.length === 0, nodes: cy.nodes().length, edges: cy.edges().length, problems };
}
