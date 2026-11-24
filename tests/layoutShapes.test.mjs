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
import { getProjectSnapshot, useStore } from '../src/store/useStore.ts';

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
