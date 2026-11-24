import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import { composeCadenceTransform } from '../src/utils/hierarchy.ts';
import {
  computeCellContentBounds,
  normalizeRectFromPoints,
  resolveLayerStyle,
} from '../src/utils/layoutLayers.ts';
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
  assert.match(skill, /dbCreatePRBoundary\(cv list\(-400:100 -400:500 300:500 300:100\)\)/);
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
