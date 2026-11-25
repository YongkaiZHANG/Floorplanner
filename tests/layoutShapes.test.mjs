import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import { resolveCanvasCursor } from '../src/utils/canvasCursor.ts';
import { findOverlapViolations } from '../src/utils/floorplanMetrics.ts';
import { composeCadenceTransform } from '../src/utils/hierarchy.ts';
import {
  computeCellContentBounds,
  estimateTextBoxSize,
  formatLppLabel,
  normalizeRectFromPoints,
  resolveLayerStyle,
  resolveTextSkillFont,
} from '../src/utils/layoutLayers.ts';
import { hitTestShapeEdgeOrCorner, selectShapeEdgesInBox } from '../src/utils/shapeStretch.ts';
import { generateSkillCode } from '../src/utils/skillExport.ts';
import { extractProjectFromSvg, generateSvgMarkup } from '../src/utils/svgExport.ts';
import { parseProjectDocument, serializeProjectDocument } from '../src/store/projectDocument.ts';
import { getProjectSnapshot, isCellEmpty, useStore } from '../src/store/useStore.ts';

const baseProject = {
  gridSize: 1,
  topWidth: 3000,
  topHeight: 2000,
  topLibName: 'xxxL_TOP',
  topCellName: 'top_asic',
  masterCells: {},
  instances: [],
  rulers: [],
};

test('normalizeRectFromPoints snaps corners, handles reverse drags, and rejects zero-area', () => {
  assert.deepEqual(normalizeRectFromPoints(300, 500, -400, 100, 10, 1), {
    x: -400,
    y: 100,
    width: 700,
    height: 400,
  });
  assert.equal(normalizeRectFromPoints(10, 20, 10, 80, 1), null);
  assert.equal(normalizeRectFromPoints(10, 20, 50, 20, 1), null);
  const zeroOrigin = normalizeRectFromPoints(-0.001, 0, 10, 5, 0.005);
  assert.ok(zeroOrigin);
  assert.equal(Object.is(zeroOrigin.x, -0), false);
});

test('resolveLayerStyle resolves Virtuoso presets including text/drawing and custom LPPs', () => {
  const textStyle = resolveLayerStyle('text', 'drawing');
  assert.equal(textStyle.color, '#06b6d4');
  assert.equal(textStyle.strokeDash, 'solid');

  const prStyle = resolveLayerStyle('prBoundary', 'drawing');
  assert.equal(prStyle.strokeDash, 'dashed');

  const custom = resolveLayerStyle('CUSTOM_FP', 'drawing', '#ff00aa');
  assert.equal(custom.color, '#ff00aa');

  // formatLppLabel omits redundant default 'drawing' purpose while preserving custom purposes
  assert.equal(formatLppLabel('text', 'drawing'), 'text');
  assert.equal(formatLppLabel('M1', 'DRAWING'), 'M1');
  assert.equal(formatLppLabel('prBoundary', ''), 'prBoundary');
  assert.equal(formatLppLabel('M1', 'pin'), 'M1/pin');
  assert.equal(formatLppLabel('text', 'label'), 'text/label');
});

test('getPhysicalBounds transforms non-zero (originX, originY) masters across all 8 orientations', () => {
  // Local box [-400..300] x [100..500] (originX = -400, originY = 100, width = 700, height = 400)
  const base = { id: 'ip', x: 0, y: 0, originX: -400, originY: 100, width: 700, height: 400 };
  assert.deepEqual(getPhysicalBounds({ ...base, orientation: 'R0' }), {
    left: -400, right: 300, bottom: 100, top: 500, centerX: -50, centerY: 300, width: 700, height: 400,
  });
  // R90: (u, v) -> (-v, u) => x in [-500..-100], y in [-400..300]
  const r90 = getPhysicalBounds({ ...base, orientation: 'R90' });
  assert.equal(r90.left, -500);
  assert.equal(r90.right, -100);
  assert.equal(r90.bottom, -400);
  assert.equal(r90.top, 300);
  // MY: (-u, v) => x in [-300..400], y in [100..500]
  const my = getPhysicalBounds({ ...base, orientation: 'MY' });
  assert.equal(my.left, -300);
  assert.equal(my.right, 400);
  assert.equal(my.bottom, 100);
  assert.equal(my.top, 500);
});

test('composeCadenceTransform supports native origin coordinateMode without legacy half-size shift', () => {
  const composed = composeCadenceTransform(
    { x: 0, y: 0, orientation: 'R0' },
    { x: -120, y: 80, orientation: 'R90' },
    400,
    300,
    'origin',
  );
  assert.deepEqual(composed, { x: -120, y: 80, orientation: 'R90' });
});

test('IP cellview canvas draws text/drawing rectangles freely, auto-fits bounds, instantiates at (0,0), and exports exact SKILL & SVG', () => {
  useStore.getState().loadProject(baseProject);

  // Create a leaf sub-cell SUB_BLK (100x80) and a canvas IP cell CORE_IP (autoBounds = true, open immediately)
  useStore.getState().addMasterCell('xxxL_TOP', 'SUB_BLK', 100, 80, '#22c55e', 0.5, 'solid', false, false);
  const subBlk = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'SUB_BLK');

  useStore.getState().addMasterCell('xxxL_TOP', 'CORE_IP', 100, 100, '#3b82f6', 0.5, 'solid', true, true);
  const coreId = useStore.getState().activeCellId;
  assert.ok(coreId);
  assert.equal(useStore.getState().topCellName, 'CORE_IP');

  // Draw a rectangle on ("text" "drawing") far outside the initial 100x100 placeholder!
  const rectId = useStore.getState().addShape({
    layer: 'text',
    purpose: 'drawing',
    x: -400,
    y: 100,
    width: 700,
    height: 400,
    label: 'CORE_OUTLINE',
  });
  assert.equal(useStore.getState().shapes.length, 1);

  // Auto-bounds immediately fits CORE_IP to [-400..300] x [100..500]
  const coreAfterRect = useStore.getState().masterCells[coreId];
  assert.equal(coreAfterRect.originX, -400);
  assert.equal(coreAfterRect.originY, 100);
  assert.equal(coreAfterRect.width, 700);
  assert.equal(coreAfterRect.height, 400);

  // Also instantiate SUB_BLK freely inside CORE_IP at (-350, 150) — no artificial box clamp!
  useStore.getState().placeInstance(subBlk.id, -350, 150, 'R0', 'I_SUB');
  assert.equal(useStore.getState().instances.length, 1);
  assert.equal(useStore.getState().instances[0].x, -350);
  assert.equal(useStore.getState().instances[0].y, 150);

  // Verify shape edit, lock, and undo/redo
  useStore.getState().toggleShapeLock(rectId);
  assert.throws(() => useStore.getState().deleteShape(rectId), /locked/);
  useStore.getState().toggleShapeLock(rectId);

  // Switch up to top_asic and instantiate CORE_IP directly at (0, 0)
  useStore.getState().openCellView(null);
  assert.equal(useStore.getState().activeCellId, null);
  useStore.getState().placeInstance(coreId, 0, 0, 'R0', 'I_CORE');
  const coreInst = useStore.getState().instances[0];
  assert.equal(coreInst.x, 0);
  assert.equal(coreInst.y, 0);

  // Verify CORE_IP physical bounds in top_asic match exact drawn coordinates [-400..300] x [100..500]
  const coreMaster = useStore.getState().masterCells[coreId];
  const bounds = getPhysicalBounds({
    ...coreInst,
    width: coreMaster.width,
    height: coreMaster.height,
    originX: coreMaster.originX,
    originY: coreMaster.originY,
  });
  assert.equal(bounds.left, -400);
  assert.equal(bounds.right, 300);
  assert.equal(bounds.bottom, 100);
  assert.equal(bounds.top, 500);

  // Also draw a top-level shape on text/drawing
  useStore.getState().addShape({
    layer: 'text',
    purpose: 'drawing',
    x: 400,
    y: -200,
    width: 200,
    height: 150,
    label: 'TOP_NOTE',
  });

  // Verify snapshot serialization & SVG round-trip preserve all shapes and originX/originY
  const snapshot = getProjectSnapshot(useStore.getState());
  assert.equal(snapshot.shapes?.length, 1);
  assert.equal(snapshot.cellViews?.[coreId]?.shapes?.length, 1);
  assert.equal(snapshot.cellViews?.[coreId]?.coordinateMode, 'origin');

  const reparsed = parseProjectDocument(serializeProjectDocument(snapshot));
  assert.equal(reparsed.masterCells[coreId].originX, -400);
  assert.equal(reparsed.cellViews?.[coreId]?.shapes?.[0].layer, 'text');
  assert.equal(reparsed.cellViews?.[coreId]?.shapes?.[0].purpose, 'drawing');

  const svg = generateSvgMarkup(snapshot);
  const extracted = extractProjectFromSvg(svg);
  assert.ok(extracted);
  const fromSvg = parseProjectDocument(extracted);
  assert.equal(fromSvg.shapes?.length, 1);
  assert.equal(fromSvg.cellViews?.[coreId]?.shapes?.length, 1);

  // Verify SKILL export creates CORE_IP with exact ("text" "drawing") rectangle and instantiates it at 0:0 in top_asic
  const skill = generateSkillCode(
    snapshot.topLibName,
    snapshot.topCellName,
    snapshot.topWidth,
    snapshot.topHeight,
    snapshot.masterCells,
    snapshot.instances,
    snapshot.gridSize,
    snapshot.pixelArray,
    {
      hierarchyMode: 'zero-origin-direct',
      cellViews: snapshot.cellViews,
      topShapes: snapshot.shapes,
    },
  );
  // Content-driven autoBounds cell CORE_IP emits only its drawn shapes & sub-instances (no synthetic prBoundary)
  assert.doesNotMatch(skill, /dbCreatePRBoundary\(cv list\(-400:100 -400:500 300:500 300:100\)\)/);
  assert.match(skill, /dbCreatePRBoundary\(cv list\(-350:150 -350:230 -250:230 -250:150\)\)/);
  assert.match(skill, /dbCreatePRBoundary\(cv list\(-1500:-1000 -1500:1000 1500:1000 1500:-1000\)\)/);
  assert.match(skill, /dbCreateRect\(cv list\("text" "drawing"\) list\(-400:100 300:500\)\)/);
  assert.match(skill, /"CORE_OUTLINE"/);
  assert.match(skill, /dbCreateRect\(cv list\("text" "drawing"\) list\(400:-200 600:-50\)\)/);
  const topSection = skill.slice(skill.indexOf('STEP 3: Assemble'));
  assert.match(topSection, /dbCreateInst\(cv master "I_CORE" 0:0 "R0" 1\)/);

  // Also check computeCellContentBounds directly
  const computed = computeCellContentBounds(
    snapshot.cellViews[coreId].shapes,
    snapshot.cellViews[coreId].instances,
    snapshot.masterCells,
  );
  assert.deepEqual(computed, { originX: -400, originY: 100, width: 700, height: 400 });
});

test('align, distribute, boundary edge-align, and paste work unboundedly inside an IP cellview and sync master bounds', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().addMasterCell('xxxL_TOP', 'BLK', 100, 80, '#22c55e', 0.5, 'solid', false, false);
  const blk = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'BLK');

  useStore.getState().addMasterCell('xxxL_TOP', 'FREE_IP', 100, 100, '#3b82f6', 0.5, 'solid', true, true);
  const freeId = useStore.getState().activeCellId;
  assert.ok(freeId);

  // Place 3 sub-instances well outside any centered [-W/2..W/2] placeholder box
  useStore.getState().placeInstance(blk.id, 1200, 800, 'R0', 'I0');
  useStore.getState().placeInstance(blk.id, 1500, 900, 'R0', 'I1');
  useStore.getState().placeInstance(blk.id, 2000, 820, 'R0', 'I2');
  const [i0, i1, i2] = useStore.getState().instances;

  // Select with i0 last so i0 (y=800) is the alignment anchor
  useStore.getState().setSelection([i1.id, i2.id, i0.id]);
  useStore.getState().alignSelectedInstances('bottom');
  for (const inst of useStore.getState().instances) {
    assert.equal(inst.y, 800);
  }
  assert.equal(useStore.getState().masterCells[freeId].height, 80);

  // Horizontal distribution across [1200..2100] puts i1 cleanly at x=1600
  useStore.getState().distributeSelectedInstances('horizontal');
  const afterDist = Object.fromEntries(useStore.getState().instances.map(inst => [inst.name, inst]));
  assert.equal(afterDist.I0.x, 1200);
  assert.equal(afterDist.I1.x, 1600);
  assert.equal(afterDist.I2.x, 2000);

  // Draw a wider boundary shape [1000..2100] x [700..900] and edge-align I0.left to active left boundary (originX = 1000)
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 1000, y: 700, width: 1100, height: 200 });
  assert.equal(useStore.getState().masterCells[freeId].originX, 1000);
  useStore.getState().startEdgeAlignment(afterDist.I0.id);
  useStore.getState().setEdgeAlignmentEdge(afterDist.I0.id, 'left');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToBoundary('left');
  const i0AfterEdge = useStore.getState().instances.find(inst => inst.name === 'I0');
  assert.equal(i0AfterEdge.x, 1000);

  // Copy & paste rightmost instance I2 — must expand FREE_IP bounds beyond x=2100
  useStore.getState().setSelection([afterDist.I2.id]);
  useStore.getState().copySelection();
  useStore.getState().pasteClipboard();
  assert.equal(useStore.getState().instances.length, 4);
  const masterAfterPaste = useStore.getState().masterCells[freeId];
  assert.ok(masterAfterPaste.originX + masterAfterPaste.width > 2100);
});

test('generateSkillCode and loadProject default cellViews with shapes and omitted coordinateMode to native origin', () => {
  const doc = {
    ...baseProject,
    masterCells: {
      ip1: {
        id: 'ip1',
        libName: 'xxxL_TOP',
        cellName: 'SHAPE_IP',
        width: 500,
        height: 300,
        originX: -200,
        originY: 100,
        color: '#3b82f6',
        autoBounds: true,
      },
    },
    instances: [{ id: 'inst1', cellId: 'ip1', name: 'I0', x: 0, y: 0, orientation: 'R0' }],
    cellViews: {
      ip1: {
        instances: [],
        rulers: [],
        shapes: [{ id: 's1', layer: 'text', purpose: 'drawing', x: -200, y: 100, width: 500, height: 300 }],
      },
    },
  };

  const skill = generateSkillCode(
    doc.topLibName,
    doc.topCellName,
    doc.topWidth,
    doc.topHeight,
    doc.masterCells,
    doc.instances,
    doc.gridSize,
    null,
    { hierarchyMode: 'zero-origin-direct', cellViews: doc.cellViews },
  );
  // Must emit exact (-200:100 300:400) without legacy (+250/+150) centered shift
  assert.match(skill, /dbCreateRect\(cv list\("text" "drawing"\) list\(-200:100 300:400\)\)/);

  const parsed = parseProjectDocument(serializeProjectDocument(doc));
  useStore.getState().loadProject(parsed);
  useStore.getState().openCellView('ip1');
  assert.equal(useStore.getState().activeCoordinateMode, 'origin');
  assert.equal(useStore.getState().shapes[0].x, -200);
  assert.equal(useStore.getState().shapes[0].y, 100);
});

test('pixel array inside an origin-mode IP cellview with non-zero originX/originY survives placement, serialization, and SKILL export', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().addMasterCell('xxxL_TOP', 'PIX_IP', 100, 100, '#3b82f6', 0.5, 'solid', true, true);
  const pixId = useStore.getState().activeCellId;
  assert.ok(pixId);

  // Define PIX_IP bounds at [500..1100] x [200..600] (originX=500, originY=200, width=600, height=400)
  useStore.getState().addShape({ layer: 'prBoundary', purpose: 'drawing', x: 500, y: 200, width: 600, height: 400 });
  assert.equal(useStore.getState().masterCells[pixId].originX, 500);
  assert.equal(useStore.getState().masterCells[pixId].originY, 200);

  // Place a 200x150 pixel array centered at (700, 325) -> lower-left (600, 250)
  useStore.getState().startPixelArrayPlacement(200, 150);
  useStore.getState().placePixelArray(700, 325);
  assert.deepEqual(useStore.getState().pixelArray, {
    x: 600,
    y: 250,
    width: 200,
    height: 150,
    visible: true,
  });

  // Switch up to top_asic and instantiate PIX_IP at (0, 0)
  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(pixId, 0, 0, 'R0', 'I_PIX');

  const snapshot = getProjectSnapshot(useStore.getState());
  const reparsed = parseProjectDocument(serializeProjectDocument(snapshot));
  assert.equal(reparsed.cellViews?.[pixId]?.pixelArray?.x, 600);
  assert.equal(reparsed.cellViews?.[pixId]?.pixelArray?.y, 250);

  const skill = generateSkillCode(
    snapshot.topLibName,
    snapshot.topCellName,
    snapshot.topWidth,
    snapshot.topHeight,
    snapshot.masterCells,
    snapshot.instances,
    snapshot.gridSize,
    snapshot.pixelArray,
    { hierarchyMode: 'zero-origin-direct', cellViews: snapshot.cellViews },
  );
  assert.match(skill, /dbCreateRect\(cv list\("prBoundary" "drawing"\) list\(600:250 800:400\)\)/);
});

test('Virtuoso createEmptyCell starts empty with no size, blocks self/empty instantiation, auto-sizes from text/drawing, and round-trips cleanly', () => {
  useStore.getState().loadProject(baseProject);

  // Create a new IP cell with NO size input (Virtuoso File -> New -> Cell View)
  useStore.getState().createEmptyCell('xxxL_TOP', 'MY_IP', '#06b6d4', true);
  const myId = useStore.getState().activeCellId;
  assert.ok(myId);
  assert.equal(useStore.getState().topCellName, 'MY_IP');
  assert.equal(useStore.getState().topWidth, 0);
  assert.equal(useStore.getState().topHeight, 0);
  assert.equal(isCellEmpty(useStore.getState().masterCells[myId]), true);

  // Cannot instantiate a cell inside itself
  assert.throws(() => useStore.getState().setPlacement(myId), /inside itself/);
  assert.throws(() => useStore.getState().placeInstance(myId, 0, 0), /inside itself/);

  // Cannot instantiate an empty cell inside top_asic before drawing or placing sub-cells
  useStore.getState().openCellView(null);
  assert.throws(() => useStore.getState().setPlacement(myId), /empty cell/i);
  assert.throws(() => useStore.getState().placeInstance(myId, 0, 0), /empty cell/i);

  // Uninstantiated empty cell survives serialization, grid changes, and SKILL export
  useStore.getState().setGridSize(0.5);
  const emptySnapshot = getProjectSnapshot(useStore.getState());
  const reparsedEmpty = parseProjectDocument(serializeProjectDocument(emptySnapshot));
  assert.equal(reparsedEmpty.masterCells[myId].width, 0);
  assert.equal(reparsedEmpty.masterCells[myId].height, 0);
  const emptySkill = generateSkillCode(
    emptySnapshot.topLibName,
    emptySnapshot.topCellName,
    emptySnapshot.topWidth,
    emptySnapshot.topHeight,
    emptySnapshot.masterCells,
    emptySnapshot.instances,
    emptySnapshot.gridSize,
    null,
    { hierarchyMode: 'zero-origin-direct', cellViews: emptySnapshot.cellViews },
  );
  assert.match(emptySkill, /Creating empty cellview/);

  // Draw a text/drawing rectangle inside MY_IP -> size is decided strictly by its contents
  useStore.getState().openCellView(myId);
  const shapeId = useStore.getState().addShape({
    layer: 'text',
    purpose: 'drawing',
    x: -50,
    y: 20,
    width: 120,
    height: 80,
    label: 'MY_IP',
  });
  assert.equal(isCellEmpty(useStore.getState().masterCells[myId]), false);
  assert.equal(useStore.getState().masterCells[myId].originX, -50);
  assert.equal(useStore.getState().masterCells[myId].originY, 20);
  assert.equal(useStore.getState().masterCells[myId].width, 120);
  assert.equal(useStore.getState().masterCells[myId].height, 80);

  // Still cannot instantiate MY_IP inside itself even once non-empty
  assert.throws(() => useStore.getState().placeInstance(myId, 0, 0), /inside itself/);

  // Deleting the last rectangle returns MY_IP back to empty (0x0)
  useStore.getState().deleteShape(shapeId);
  assert.equal(isCellEmpty(useStore.getState().masterCells[myId]), true);
  assert.equal(useStore.getState().masterCells[myId].originX, undefined);
  assert.equal(useStore.getState().masterCells[myId].originY, undefined);
});

test('hierarchical auto-bounds propagate bottom-up and drawing text/drawing inside a legacy cell shrinks its bounds to its drawn content', () => {
  useStore.getState().loadProject(baseProject);

  // Build two empty leaf Virtuoso cells with text/drawing rectangles
  useStore.getState().createEmptyCell('xxxL_TOP', 'LEAF_A', '#06b6d4', true);
  const leafAId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 80 });

  useStore.getState().createEmptyCell('xxxL_TOP', 'LEAF_B', '#22c55e', true);
  const leafBId = useStore.getState().activeCellId;
  const leafBShapeId = useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 150, y: 0, width: 100, height: 120 });

  // Compose CLUSTER from LEAF_A and LEAF_B at (0, 0)
  useStore.getState().createEmptyCell('xxxL_TOP', 'CLUSTER', '#3b82f6', true);
  const clusterId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(leafAId, 0, 0, 'R0', 'I_A');
  useStore.getState().placeInstance(leafBId, 0, 0, 'R0', 'I_B');
  assert.equal(useStore.getState().masterCells[clusterId].width, 250);
  assert.equal(useStore.getState().masterCells[clusterId].height, 120);

  // Indirect recursion (instantiating CLUSTER inside LEAF_A) is rejected
  useStore.getState().openCellView(leafAId);
  assert.throws(() => useStore.getState().placeInstance(clusterId, 0, 0), /hierarchy cycle/);

  // Resize LEAF_B's text/drawing rectangle -> CLUSTER auto-bounds propagate bottom-up immediately
  useStore.getState().openCellView(leafBId);
  useStore.getState().updateShape(leafBShapeId, { width: 200, height: 160 });
  assert.equal(useStore.getState().masterCells[clusterId].width, 350);
  assert.equal(useStore.getState().masterCells[clusterId].height, 160);

  // Legacy fixed-size cell (e.g. OLD_PAD 100x81) opened and given a text/drawing rect shrinks tightly to the drawn rect
  useStore.getState().openCellView(null);
  useStore.getState().addMasterCell('xxxL_TOP', 'OLD_PAD', 100, 81, '#f59e0b', 0.5, 'solid', true, false);
  const oldPadId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 10, y: 15, width: 40, height: 30 });
  assert.equal(useStore.getState().masterCells[oldPadId].autoBounds, true);
  assert.equal(useStore.getState().masterCells[oldPadId].originX, 10);
  assert.equal(useStore.getState().masterCells[oldPadId].originY, 15);
  assert.equal(useStore.getState().masterCells[oldPadId].width, 40);
  assert.equal(useStore.getState().masterCells[oldPadId].height, 30);
});

test('loadProject auto-shrinks legacy saved cells with drawn shapes, keeps R180 non-zero-origin pads flush on die edge, and omits wrapper boxes/labels in SVG & SKILL', () => {
  // Simulates a legacy saved workspace where PAD had stale bloated bounds (180.075 x 125.685, autoBounds omitted)
  // while its cellview actually contains only a smaller drawn text/drawing rectangle at (20, 30, 50x40).
  const legacySaved = {
    gridSize: 0.005,
    topWidth: 3000,
    topHeight: 2000,
    topLibName: 'chip_lib',
    topCellName: 'top_asic',
    masterCells: {
      pad1: {
        id: 'pad1',
        libName: 'chip_lib',
        cellName: 'PAD',
        width: 180.075,
        height: 125.685,
        color: '#f59e0b',
        kind: 'pad',
      },
      ip1: {
        id: 'ip1',
        libName: 'chip_lib',
        cellName: 'MY_IP',
        width: 400,
        height: 300,
        color: '#2563eb',
      },
    },
    instances: [
      { id: 'p0', cellId: 'pad1', name: 'I0', x: -100, y: -950, orientation: 'R180' },
      { id: 'p1', cellId: 'pad1', name: 'I1', x: 20, y: -950, orientation: 'R180' },
      { id: 'u0', cellId: 'ip1', name: 'I2', x: 0, y: 0, orientation: 'R0' },
    ],
    rulers: [],
    cellViews: {
      pad1: {
        instances: [],
        rulers: [],
        shapes: [{ id: 'ps1', layer: 'text', purpose: 'drawing', x: 20, y: 30, width: 50, height: 40 }],
        coordinateMode: 'origin',
      },
      ip1: {
        instances: [],
        rulers: [],
        shapes: [{ id: 'is1', layer: 'text', purpose: 'drawing', x: -100, y: 50, width: 120, height: 80, label: 'DRAWN_ONLY' }],
        coordinateMode: 'origin',
      },
    },
  };

  useStore.getState().loadProject(legacySaved);

  // Both legacy cells automatically promoted to content-driven autoBounds matching ONLY their drawn rectangles
  const padMaster = useStore.getState().masterCells.pad1;
  assert.equal(padMaster.autoBounds, true);
  assert.equal(padMaster.originX, 20);
  assert.equal(padMaster.originY, 30);
  assert.equal(padMaster.width, 50);
  assert.equal(padMaster.height, 40);

  const ipMaster = useStore.getState().masterCells.ip1;
  assert.equal(ipMaster.autoBounds, true);
  assert.equal(ipMaster.originX, -100);
  assert.equal(ipMaster.originY, 50);
  assert.equal(ipMaster.width, 120);
  assert.equal(ipMaster.height, 80);

  // R180 bottom pads with non-zero (originX=20, originY=30) must snap strictly flush with bottom edge y = -1000
  const padInst0 = useStore.getState().instances.find(i => i.id === 'p0');
  const padBounds0 = getPhysicalBounds({
    ...padInst0,
    width: padMaster.width,
    height: padMaster.height,
    originX: padMaster.originX,
    originY: padMaster.originY,
  });
  assert.equal(padBounds0.bottom, -1000);
  assert.equal(padBounds0.top, -960);

  // SVG export shows ONLY drawn shapes (no colored wrapper fill #f59e0b / #2563eb and no synthetic "120x80" label)
  const snapshot = getProjectSnapshot(useStore.getState());
  const svg = generateSvgMarkup(snapshot);
  const svgDrawingOnly = svg.slice(svg.indexOf('</metadata>'), svg.indexOf('Floorplan Data Summary'));
  assert.doesNotMatch(svgDrawingOnly, /fill="#f59e0b"/);
  assert.doesNotMatch(svgDrawingOnly, /fill="#2563eb"/);
  assert.doesNotMatch(svgDrawingOnly, />120x80</);
  assert.match(svgDrawingOnly, />DRAWN_ONLY</);

  // SKILL export emits drawn rect and user label without injecting synthetic "120 x 80 um" size text
  const skill = generateSkillCode(
    snapshot.topLibName,
    snapshot.topCellName,
    snapshot.topWidth,
    snapshot.topHeight,
    snapshot.masterCells,
    snapshot.instances,
    snapshot.gridSize,
    snapshot.pixelArray,
    { hierarchyMode: 'zero-origin-direct', cellViews: snapshot.cellViews },
  );
  assert.match(skill, /"DRAWN_ONLY"/);
  assert.doesNotMatch(skill, /"120 x 80 um"/);
});

test('Virtuoso Create Text (L) supports font size, font family, bold/italic styles, text/drawing & custom layers, round-trip, SVG, and SKILL dbCreateLabel', () => {
  assert.equal(
    resolveCanvasCursor({ appMode: 'text', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  assert.equal(resolveTextSkillFont('stick'), 'stick');
  assert.equal(resolveTextSkillFont('sans'), 'swiss');
  assert.equal(resolveTextSkillFont('mono'), 'fixed');
  assert.equal(resolveTextSkillFont('serif'), 'roman');

  useStore.getState().loadProject(baseProject);
  useStore.getState().setAppMode('text');
  assert.equal(useStore.getState().appMode, 'text');
  assert.equal(useStore.getState().activeTextLayer, 'text');
  assert.equal(useStore.getState().activeTextPurpose, 'drawing');

  useStore.getState().setActiveTextConfig({
    content: 'VDD_IO',
    fontSize: 25,
    fontFamily: 'sans',
    fontStyle: 'bold italic',
    orientation: 'R90',
    layer: 'M1',
    purpose: 'label',
  });
  assert.equal(useStore.getState().activeTextContent, 'VDD_IO');
  assert.equal(useStore.getState().activeTextFontSize, 25);
  assert.equal(useStore.getState().activeTextFontFamily, 'sans');
  assert.equal(useStore.getState().activeTextFontStyle, 'bold italic');
  assert.equal(useStore.getState().activeTextLayer, 'M1');
  assert.equal(useStore.getState().activeTextPurpose, 'label');

  // Place top-level text on custom layer M1/label
  const sizeTop = estimateTextBoxSize('VDD_IO', 25, 'sans', 'bold italic', 1);
  const topTextId = useStore.getState().addShape({
    kind: 'text',
    layer: 'M1',
    purpose: 'label',
    x: 100,
    y: 200,
    width: sizeTop.width,
    height: sizeTop.height,
    label: 'VDD_IO',
    fontSize: 25,
    fontFamily: 'sans',
    fontStyle: 'bold italic',
    orientation: 'R90',
  });
  const topText = useStore.getState().shapes.find(s => s.id === topTextId);
  assert.equal(topText.kind, 'text');
  assert.equal(topText.fontSize, 25);
  assert.equal(topText.fontFamily, 'sans');
  assert.equal(topText.fontStyle, 'bold italic');
  assert.equal(topText.orientation, 'R90');

  // Stretch / partial select safely skips text labels
  assert.deepEqual(selectShapeEdgesInBox(useStore.getState().shapes, { minX: -500, maxX: 500, minY: -500, maxY: 500 }), {});
  assert.equal(hitTestShapeEdgeOrCorner(useStore.getState().shapes, 100, 200, 10), null);

  // Create an IP cell containing ONLY a text/drawing label -> auto-bounds sizes from text and instantiates cleanly
  useStore.getState().createEmptyCell('xxxL_TOP', 'TEXT_ONLY_CELL', '#06b6d4', true);
  const textCellId = useStore.getState().activeCellId;
  const subTextId = useStore.getState().addShape({
    kind: 'text',
    layer: 'text',
    purpose: 'drawing',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    label: 'PAD_SIG',
    fontSize: 30,
    fontFamily: 'stick',
    fontStyle: 'normal',
    orientation: 'R0',
  });
  assert.equal(isCellEmpty(useStore.getState().masterCells[textCellId]), false);
  assert.equal(useStore.getState().masterCells[textCellId].height, 30);

  // Edit text content, font size, style, and layer -> bounding box updates automatically
  useStore.getState().updateShape(subTextId, {
    label: 'PAD_SIG_LONG',
    fontSize: 40,
    fontFamily: 'serif',
    fontStyle: 'bold',
    layer: 'text',
    purpose: 'drawing',
  });
  const editedSub = useStore.getState().shapes.find(s => s.id === subTextId);
  assert.equal(editedSub.fontSize, 40);
  assert.equal(editedSub.fontFamily, 'serif');
  assert.equal(editedSub.fontStyle, 'bold');
  assert.equal(useStore.getState().masterCells[textCellId].height, 40);
  assert.ok(useStore.getState().masterCells[textCellId].width > 200);

  // Instantiate TEXT_ONLY_CELL in top_asic
  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(textCellId, -200, -100, 'R0', 'I_TXT');

  // Round-trip via projectDocument serialization & validation
  const snapshot = getProjectSnapshot(useStore.getState());
  const rawJson = serializeProjectDocument(snapshot);
  const parsed = parseProjectDocument(rawJson);
  assert.equal(parsed.shapes?.[0]?.kind, 'text');
  assert.equal(parsed.shapes?.[0]?.fontFamily, 'sans');
  assert.equal(parsed.shapes?.[0]?.fontStyle, 'bold italic');
  assert.equal(parsed.cellViews?.[textCellId]?.shapes?.[0]?.kind, 'text');
  assert.equal(parsed.cellViews?.[textCellId]?.shapes?.[0]?.fontSize, 40);

  // Reject malformed text metadata
  const badDoc = JSON.parse(rawJson);
  badDoc.project.shapes[0].fontFamily = 'comic-sans';
  assert.throws(() => parseProjectDocument(JSON.stringify(badDoc)), /Invalid layout shape/);

  // SVG export emits real <text> elements with bold/italic & font-size
  const svg = generateSvgMarkup(snapshot);
  assert.match(svg, /font-weight="bold" font-style="italic"[^>]*>VDD_IO<\/text>/);
  assert.match(svg, /font-weight="bold"[^>]*>PAD_SIG_LONG<\/text>/);

  // SKILL export emits native dbCreateLabel on custom M1/label & text/drawing with Virtuoso fonts (swiss / roman)
  const skill = generateSkillCode(
    snapshot.topLibName,
    snapshot.topCellName,
    snapshot.topWidth,
    snapshot.topHeight,
    snapshot.masterCells,
    snapshot.instances,
    snapshot.gridSize,
    snapshot.pixelArray,
    { hierarchyMode: 'preserve-master', cellViews: snapshot.cellViews, topShapes: snapshot.shapes },
  );
  assert.match(skill, /dbCreateLabel\(cv list\("M1" "label"\) 100:200 "VDD_IO" "lowerLeft" "R90" "swiss" 25\)/);
  assert.match(skill, /dbCreateLabel\(cv list\("text" "drawing"\) 0:0 "PAD_SIG_LONG" "lowerLeft" "R0" "roman" 40\)/);
});

test('alignSelectedInstancesToBoundary & completeEdgeAlignmentToCoordinate align blocks, pads, pixel arrays, and Edit-in-Place (X) sub-cells to die boundaries', () => {
  useStore.getState().loadProject(baseProject); // 3000 x 2000 => x in [-1500..1500], y in [-1000..1000]

  // Create IP block (200x100) and place at (100, 200)
  useStore.getState().addMasterCell('xxxL_TOP', 'BLK_A', 200, 100, '#3b82f6', 0.5, 'solid', false, false);
  const blkA = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'BLK_A');
  useStore.getState().placeInstance(blkA.id, 100, 200, 'R0', 'I_A');
  const instA = useStore.getState().instances[0];
  useStore.getState().setSelection([instA.id]);

  // Align single block to all 6 boundary references + undo
  useStore.getState().alignSelectedInstancesToBoundary('left');
  assert.equal(useStore.getState().instances[0].x, -1500);
  useStore.getState().alignSelectedInstancesToBoundary('right');
  assert.equal(useStore.getState().instances[0].x, 1300);
  useStore.getState().alignSelectedInstancesToBoundary('horizontal-center');
  assert.equal(useStore.getState().instances[0].x, -100);
  useStore.getState().alignSelectedInstancesToBoundary('bottom');
  assert.equal(useStore.getState().instances[0].y, -1000);
  useStore.getState().alignSelectedInstancesToBoundary('top');
  assert.equal(useStore.getState().instances[0].y, 900);
  useStore.getState().alignSelectedInstancesToBoundary('vertical-center');
  assert.equal(useStore.getState().instances[0].y, -50);
  useStore.getState().undo();
  assert.equal(useStore.getState().instances[0].y, 900);

  // Align Pixel Array to boundary
  useStore.getState().startPixelArrayPlacement(600, 400);
  useStore.getState().placePixelArray(0, 0);
  useStore.getState().setPixelArraySelected(true);
  useStore.getState().alignSelectedInstancesToBoundary('top');
  assert.equal(useStore.getState().pixelArray.y, 600); // 600 + 400 = 1000
  useStore.getState().alignSelectedInstancesToBoundary('left');
  assert.equal(useStore.getState().pixelArray.x, -1500);
  useStore.getState().setPixelArraySelected(false);

  // Edge-bound pad with seal-ring padInset=50 aligns to inner perimeter and rejects leaving perimeter
  useStore.getState().setPadInset(50);
  useStore.getState().prepareManualPadPlacement({ libName: 'xxxL_TOP', cellName: 'EDGE_PAD', width: 100, height: 80, color: '#f59e0b' });
  const padMaster = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'EDGE_PAD');
  useStore.getState().placeInstance(padMaster.id, 0, -900, 'R0', 'P_BOT');
  const padInst = useStore.getState().instances.find(i => i.name === 'P_BOT');
  useStore.getState().setSelection([padInst.id]);
  useStore.getState().alignSelectedInstancesToBoundary('left');
  assert.equal(useStore.getState().instances.find(i => i.id === padInst.id).x, -1450); // -1500 + 50 inset
  useStore.getState().alignSelectedInstancesToBoundary('horizontal-center');
  assert.equal(useStore.getState().instances.find(i => i.id === padInst.id).x, -50); // centered along bottom perimeter
  assert.throws(() => useStore.getState().alignSelectedInstancesToBoundary('vertical-center'), /perimeter/);

  // Edit-in-Place (X) inside rotated padring (R180): align sub-pad visually to top_asic bottom (y_base = -1000)
  useStore.getState().createEmptyCell('xxxL_TOP', 'PAD_UNIT', '#22c55e', true);
  const padUnitId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 100 });
  useStore.getState().createEmptyCell('xxxL_TOP', 'PADRING', '#06b6d4', true);
  const padringId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(padUnitId, 0, 800, 'R0', 'P0'); // Edit y:[800..900] -> in R180 base y:[-900..-800]
  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(padringId, 0, 0, 'R180', 'I_RING');
  const ringInst = useStore.getState().instances.find(i => i.name === 'I_RING');

  // Descend Edit-in-Place (X) into I_RING (R180)
  useStore.getState().descendIntoInstance(ringInst.id);
  const p0 = useStore.getState().instances.find(i => i.name === 'P0');
  useStore.getState().setSelection([p0.id]);
  // Visual bottom of top_asic is y_base = -1000, which corresponds to Edit y = +900..1000 under R180
  useStore.getState().alignSelectedInstancesToBoundary('bottom');
  assert.equal(useStore.getState().instances.find(i => i.name === 'P0').y, 900);

  // Interactive two-edge alignment (A) to coordinate in EIP: align P0.left to Edit x = 1500 (top_asic visual left under R180)
  useStore.getState().startEdgeAlignment(p0.id);
  useStore.getState().setEdgeAlignmentEdge(p0.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToCoordinate(1500, 'top_asic boundary');
  assert.equal(useStore.getState().instances.find(i => i.name === 'P0').x, 1400); // [1400..1500] in Edit -> [-1500..-1400] in R180 Base!
});

test('non-fatal hierarchical overlaps (padring + asp_top) default showOverlapDrc off and export clean Virtuoso SKILL without synthetic prBoundary', () => {
  // Default showOverlapDrc should be false so padring/asp_top bounding-box overlaps do not plaster red cross-hatches over the canvas
  assert.equal(useStore.getState().showOverlapDrc, false);

  useStore.getState().loadProject(baseProject);

  // Create content-driven PAD cell (autoBounds = true)
  useStore.getState().createEmptyCell('xxxL_TOP', 'PAD', '#f59e0b', true);
  const padId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 100 });

  // Create 4-sided padring cell spanning the perimeter of top_asic
  useStore.getState().createEmptyCell('xxxL_TOP', 'padring', '#06b6d4', true);
  const padringId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(padId, -1500, -1000, 'R0', 'P_BL');
  useStore.getState().placeInstance(padId, 1400, -1000, 'R0', 'P_BR');
  useStore.getState().placeInstance(padId, -1500, 900, 'R0', 'P_TL');
  useStore.getState().placeInstance(padId, 1400, 900, 'R0', 'P_TR');

  // Create hierarchical asp_top containing inner IPs
  useStore.getState().createEmptyCell('xxxL_TOP', 'ADC', '#8b5cf6', true);
  const adcId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 400, height: 300 });
  useStore.getState().createEmptyCell('xxxL_TOP', 'asp_top', '#3b82f6', true);
  const aspTopId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(adcId, -600, -200, 'R0', 'I_ADC_L');
  useStore.getState().placeInstance(adcId, 200, -200, 'R0', 'I_ADC_R');

  // Place both padring and asp_top at (0, 0) in top_asic — their bounding boxes overlap, which is completely valid!
  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(padringId, 0, 0, 'R0', 'I_PADRING');
  useStore.getState().placeInstance(aspTopId, 0, 0, 'R0', 'I_ASP_TOP');

  const snapshot = getProjectSnapshot(useStore.getState());
  const overlaps = findOverlapViolations(snapshot);
  assert.equal(overlaps.length, 1);
  assert.deepEqual([overlaps[0].nameA, overlaps[0].nameB].sort(), ['I_ASP_TOP', 'I_PADRING']);

  // SKILL export must succeed cleanly without synthetic prBoundary on padring/asp_top/PAD/ADC and without any overlap warnings
  const skill = generateSkillCode(
    snapshot.topLibName,
    snapshot.topCellName,
    snapshot.topWidth,
    snapshot.topHeight,
    snapshot.masterCells,
    snapshot.instances,
    snapshot.gridSize,
    snapshot.pixelArray,
    { hierarchyMode: 'zero-origin-direct', cellViews: snapshot.cellViews, topShapes: snapshot.shapes },
  );
  const prBoundaryMatches = skill.match(/dbCreatePRBoundary\(/g) ?? [];
  // ONLY top_asic should emit dbCreatePRBoundary — none of the content-driven autoBounds cells!
  assert.equal(prBoundaryMatches.length, 1);
  assert.match(skill, /dbCreatePRBoundary\(cv list\(-1500:-1000 -1500:1000 1500:1000 1500:-1000\)\)/);
  assert.doesNotMatch(skill, /overlap/i);
  assert.match(skill, /dbCreateInst\(cv master "P_BL"/);
  assert.match(skill, /dbCreateInst\(cv master "I_PADRING" 0:0 "R0" 1\)/);
  assert.match(skill, /dbCreateInst\(cv master "I_ASP_TOP" 0:0 "R0" 1\)/);
});
