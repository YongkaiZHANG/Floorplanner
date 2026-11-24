import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMoveConstraint, getPhysicalBounds, isActiveMosaic } from '../src/utils/alignment.ts';
import { computeFloorplanMetrics, findBoundaryViolations, findOverlapViolations } from '../src/utils/floorplanMetrics.ts';
import { generateSkillCode } from '../src/utils/skillExport.ts';
import { extractProjectFromSvg, generateSvgMarkup } from '../src/utils/svgExport.ts';
import { parseProjectDocument, serializeProjectDocument } from '../src/store/projectDocument.ts';
import { getProjectSnapshot, useStore } from '../src/store/useStore.ts';

const baseProject = {
  gridSize: 0.005,
  topWidth: 400,
  topHeight: 300,
  topLibName: 'chip_lib',
  topCellName: 'top_asic',
  masterCells: {},
  instances: [],
  rulers: [],
};

test('applyMoveConstraint enforces orthogonal (default), free, horizontal, and vertical move modes', () => {
  assert.deepEqual(applyMoveConstraint(12, 4, 'orthogonal'), { dx: 12, dy: 0, activeAxis: 'horizontal' });
  assert.deepEqual(applyMoveConstraint(4, -15, 'orthogonal'), { dx: 0, dy: -15, activeAxis: 'vertical' });
  assert.deepEqual(applyMoveConstraint(-8, 8, 'orthogonal'), { dx: -8, dy: 0, activeAxis: 'horizontal' });
  assert.deepEqual(applyMoveConstraint(7, -9, 'free'), { dx: 7, dy: -9, activeAxis: 'free' });
  assert.deepEqual(applyMoveConstraint(7, -9, 'horizontal'), { dx: 7, dy: 0, activeAxis: 'horizontal' });
  assert.deepEqual(applyMoveConstraint(7, -9, 'vertical'), { dx: 0, dy: -9, activeAxis: 'vertical' });
  assert.ok(!Object.is(applyMoveConstraint(-0, -0, 'free').dx, -0));

  useStore.getState().loadProject(baseProject);
  assert.equal(useStore.getState().moveConstraint, 'orthogonal');
  useStore.getState().cycleMoveConstraint();
  assert.equal(useStore.getState().moveConstraint, 'free');
  useStore.getState().cycleMoveConstraint();
  assert.equal(useStore.getState().moveConstraint, 'horizontal');
  useStore.getState().cycleMoveConstraint();
  assert.equal(useStore.getState().moveConstraint, 'vertical');
  useStore.getState().cycleMoveConstraint();
  assert.equal(useStore.getState().moveConstraint, 'orthogonal');
});

test('getPhysicalBounds computes exact mosaic footprints across all 8 Cadence orientations and negative pitches', () => {
  const mosaic = { rows: 2, cols: 3, rowPitch: 15, colPitch: 25 };
  // Local box: x in [0 .. 10 + 2*25 = 60], y in [0 .. 8 + 1*15 = 23]
  const r0 = getPhysicalBounds({ id: 'm', x: 10, y: 20, width: 10, height: 8, orientation: 'R0', mosaic });
  assert.deepEqual({ left: r0.left, right: r0.right, bottom: r0.bottom, top: r0.top }, {
    left: 10, right: 70, bottom: 20, top: 43,
  });

  // R90: (x, y) -> (-y, x) => local x in [-23..0], y in [0..60]
  const r90 = getPhysicalBounds({ id: 'm', x: 10, y: 20, width: 10, height: 8, orientation: 'R90', mosaic });
  assert.deepEqual({ left: r90.left, right: r90.right, bottom: r90.bottom, top: r90.top }, {
    left: -13, right: 10, bottom: 20, top: 80,
  });

  // MY: (-x, y) => local x in [-60..0], y in [0..23]
  const my = getPhysicalBounds({ id: 'm', x: 10, y: 20, width: 10, height: 8, orientation: 'MY', mosaic });
  assert.deepEqual({ left: my.left, right: my.right, bottom: my.bottom, top: my.top }, {
    left: -50, right: 10, bottom: 20, top: 43,
  });

  // Negative pitch: cols=3, colPitch=-20 => local x in [-40 .. 10]
  const neg = getPhysicalBounds({
    id: 'mneg',
    x: 0,
    y: 0,
    width: 10,
    height: 5,
    originX: 2,
    originY: -1,
    orientation: 'R0',
    mosaic: { rows: 2, cols: 3, rowPitch: -10, colPitch: -20 },
  });
  assert.deepEqual({ left: neg.left, right: neg.right, bottom: neg.bottom, top: neg.top }, {
    left: -38, right: 12, bottom: -11, top: 4,
  });
});

test('editable mosaic cells support creation, live rows/cols/pitch editing, rotation, flattening, autoBounds, SKILL, and SVG/JSON round-trip', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().addMasterCell('chip_lib', 'UNIT_CELL', 10, 8, '#3b82f6');
  const unit = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'UNIT_CELL');

  // Place editable mosaic (asMosaic: true) -> creates 1 instance with mosaic metadata
  useStore.getState().placeInstanceMosaic(unit.id, -50, -30, 'R0', {
    namePrefix: 'M_ARRAY',
    rows: 2,
    cols: 3,
    deltaX: 20,
    deltaY: 15,
    asMosaic: true,
  });
  assert.equal(useStore.getState().instances.length, 1);
  const mosaicInst = useStore.getState().instances[0];
  assert.equal(mosaicInst.name, 'M_ARRAY');
  assert.deepEqual(mosaicInst.mosaic, { rows: 2, cols: 3, rowPitch: 15, colPitch: 20 });
  assert.equal(isActiveMosaic(mosaicInst.mosaic), true);

  // Metrics count all 6 tiles of area (6 * 10 * 8 = 480)
  const snap = getProjectSnapshot(useStore.getState());
  const metrics = computeFloorplanMetrics(snap);
  assert.equal(metrics.ipAreaUm2, 480);
  assert.equal(findBoundaryViolations(snap).length, 0);

  // SKILL export emits native dbCreateSimpleMosaic in all hierarchy modes & never origin-anchors a mosaic master
  const directSkill = generateSkillCode(
    snap.topLibName, snap.topCellName, snap.topWidth, snap.topHeight,
    snap.masterCells, snap.instances, snap.gridSize, snap.pixelArray,
    { hierarchyMode: 'zero-origin-direct', cellViews: snap.cellViews, topShapes: snap.shapes },
  );
  assert.match(directSkill, /dbCreateSimpleMosaic\(cv master "M_ARRAY" -50:-30 "R0" 2 3 15 20\)/);
  assert.doesNotMatch(directSkill, /origin-anchored/);

  const wrappedSkill = generateSkillCode(
    snap.topLibName, snap.topCellName, snap.topWidth, snap.topHeight,
    snap.masterCells, snap.instances, snap.gridSize, snap.pixelArray,
    { hierarchyMode: 'wrapped', cellViews: snap.cellViews, topShapes: snap.shapes },
  );
  assert.match(wrappedSkill, /dbCreateSimpleMosaic\(cv master "M_ARRAY_MASTER" -50:-30 "R0" 2 3 15 20\)/);

  // JSON & SVG round-trip preserve mosaic cleanly
  const roundTrippedJson = parseProjectDocument(serializeProjectDocument(snap));
  assert.deepEqual(roundTrippedJson.instances[0].mosaic, { rows: 2, cols: 3, rowPitch: 15, colPitch: 20 });
  const svg = generateSvgMarkup(snap);
  assert.match(svg, /UNIT_CELL \[2×3\]/);
  const roundTrippedSvg = parseProjectDocument(extractProjectFromSvg(svg));
  assert.deepEqual(roundTrippedSvg.instances[0].mosaic, { rows: 2, cols: 3, rowPitch: 15, colPitch: 20 });

  // Live edit mosaic rows/cols/pitch -> updates bounds & is undoable
  useStore.getState().updateInstanceMosaic(mosaicInst.id, { rows: 3, cols: 4, rowPitch: 12, colPitch: 14 });
  assert.deepEqual(useStore.getState().instances[0].mosaic, { rows: 3, cols: 4, rowPitch: 12, colPitch: 14 });
  useStore.getState().undo();
  assert.deepEqual(useStore.getState().instances[0].mosaic, { rows: 2, cols: 3, rowPitch: 15, colPitch: 20 });

  // Rotate R90 and flatten mosaic -> exploded instances match rotated tile coordinates
  useStore.getState().updateInstanceOrientation(mosaicInst.id, 'R90');
  const rotated = useStore.getState().instances[0];
  const rotatedBoundsBeforeFlatten = getPhysicalBounds({
    ...rotated,
    width: unit.width,
    height: unit.height,
  });
  useStore.getState().flattenMosaicInstance(rotated.id);
  const exploded = useStore.getState().instances;
  assert.equal(exploded.length, 6);
  assert.ok(exploded.every(inst => !inst.mosaic && inst.orientation === 'R90'));
  const expBounds = exploded.map(inst => getPhysicalBounds({ ...inst, width: unit.width, height: unit.height }));
  assert.equal(Math.min(...expBounds.map(b => b.left)), rotatedBoundsBeforeFlatten.left);
  assert.equal(Math.max(...expBounds.map(b => b.right)), rotatedBoundsBeforeFlatten.right);
  assert.equal(Math.min(...expBounds.map(b => b.bottom)), rotatedBoundsBeforeFlatten.bottom);
  assert.equal(Math.max(...expBounds.map(b => b.top)), rotatedBoundsBeforeFlatten.top);

  // Undo flatten restores single mosaic cleanly
  useStore.getState().undo();
  assert.equal(useStore.getState().instances.length, 1);
  assert.deepEqual(useStore.getState().instances[0].mosaic, { rows: 2, cols: 3, rowPitch: 15, colPitch: 20 });

  // Resetting to 1x1 clears mosaic field
  useStore.getState().updateInstanceMosaic(useStore.getState().instances[0].id, { rows: 1, cols: 1, rowPitch: 15, colPitch: 20 });
  assert.equal(useStore.getState().instances[0].mosaic, undefined);
});

test('interactive multi-object Copy (C) copies multiple cells (including mosaics) and shapes in one atomic undo step with rotation', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().addMasterCell('chip_lib', 'BLK_A', 20, 10, '#3b82f6');
  useStore.getState().addMasterCell('chip_lib', 'BLK_B', 10, 10, '#10b981');
  const masters = Object.values(useStore.getState().masterCells);
  const blkA = masters.find(c => c.cellName === 'BLK_A');
  const blkB = masters.find(c => c.cellName === 'BLK_B');

  useStore.getState().placeInstance(blkA.id, 0, 0, 'R0');
  useStore.getState().placeInstanceMosaic(blkB.id, 40, 10, 'R0', {
    rows: 1,
    cols: 2,
    deltaX: 15,
    deltaY: 15,
    asMosaic: true,
  });
  const [inst0, inst1] = useStore.getState().instances;

  // Select both objects and press C (startInteractiveCopy)
  useStore.getState().setSelection([inst0.id, inst1.id]);
  useStore.getState().setSelectedInstance(inst0.id); // primary = inst0 at (0, 0)
  assert.equal(useStore.getState().startInteractiveCopy(), true);
  assert.equal(useStore.getState().appMode, 'place');
  assert.equal(useStore.getState().pendingCopyGroup.instances.length, 2);

  // Stamp copies shifted +100 on X -> single Undo step, preserves relative offset & mosaic
  const historyBefore = useStore.getState().history.past.length;
  useStore.getState().placeCopyGroupAt(100, 0);
  assert.equal(useStore.getState().instances.length, 4);
  assert.equal(useStore.getState().history.past.length, historyBefore + 1);
  const [copy0, copy1] = useStore.getState().instances.slice(2);
  assert.deepEqual([copy0.x, copy0.y, copy0.orientation], [100, 0, 'R0']);
  assert.deepEqual([copy1.x, copy1.y, copy1.orientation], [140, 10, 'R0']);
  assert.deepEqual(copy1.mosaic, { rows: 1, cols: 2, rowPitch: 15, colPitch: 15 });

  // Rotate pending copy group +90 deg and stamp again
  useStore.getState().rotatePendingCopyGroup(1);
  useStore.getState().placeCopyGroupAt(-100, 0);
  assert.equal(useStore.getState().instances.length, 6);
  const [rot0, rot1] = useStore.getState().instances.slice(4);
  assert.deepEqual([rot0.x, rot0.y, rot0.orientation], [-100, 0, 'R90']);
  // Relative offset (40, 10) rotated +90 deg = (-10, 40)
  assert.deepEqual([rot1.x, rot1.y, rot1.orientation], [-110, 40, 'R90']);

  // Single undo removes both rotated copies
  useStore.getState().undo();
  assert.equal(useStore.getState().instances.length, 4);
  useStore.getState().undo();
  assert.equal(useStore.getState().instances.length, 2);

  // Also works for drawn shapes / text labels
  const textId = useStore.getState().addShape({
    kind: 'text',
    layer: 'text',
    purpose: 'drawing',
    x: 5,
    y: 5,
    width: 20,
    height: 10,
    label: 'VDD',
    fontSize: 10,
    fontFamily: 'stick',
    fontStyle: 'bold',
    orientation: 'R0',
  });
  useStore.getState().setSelectedShape(textId);
  assert.equal(useStore.getState().startInteractiveCopy(), true);
  useStore.getState().rotatePendingCopyGroup(1);
  useStore.getState().placeCopyGroupAt(50, 5);
  assert.equal(useStore.getState().shapes.length, 2);
  assert.equal(useStore.getState().shapes[1].orientation, 'R90');
  assert.equal(useStore.getState().shapes[1].x, 50);
  assert.equal(useStore.getState().shapes[1].label, 'VDD');
});

test('cutSelection (Ctrl+C / Ctrl+X) cuts unlocked multi-selections and shapes cleanly with paste & undo', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().addMasterCell('chip_lib', 'CUT_BLK', 20, 10, '#2563eb');
  const blk = Object.values(useStore.getState().masterCells)[0];

  useStore.getState().placeInstance(blk.id, -40, 0, 'R0');
  useStore.getState().placeInstance(blk.id, 0, 20, 'R90');
  useStore.getState().placeInstance(blk.id, 60, 0, 'R0');
  const [i0, i1, i2] = useStore.getState().instances;

  // Lock i2 so cutSelection protects locked blocks
  useStore.getState().toggleInstanceLock([i2.id]);
  useStore.getState().setSelection([i0.id, i1.id, i2.id]);

  const historyBeforeCut = useStore.getState().history.past.length;
  assert.equal(useStore.getState().cutSelection(), true);
  assert.equal(useStore.getState().history.past.length, historyBeforeCut + 1);
  assert.equal(useStore.getState().instances.length, 1);
  assert.equal(useStore.getState().instances[0].id, i2.id);
  assert.equal(useStore.getState().clipboard.length, 2);
  assert.equal(useStore.getState().clipboardWasCut, true);

  // Paste restores the two cut blocks at their exact unobstructed coordinates preserving relative spacing
  useStore.getState().pasteClipboard();
  assert.equal(useStore.getState().instances.length, 3);
  const pasted = useStore.getState().instances.slice(1);
  assert.deepEqual(
    pasted.map(inst => [inst.x, inst.y, inst.orientation]),
    [[-40, 0, 'R0'], [0, 20, 'R90']],
  );
  assert.equal(findOverlapViolations(getProjectSnapshot(useStore.getState())).length, 0);

  // Second paste shifts the whole group together preserving relative delta (+40, +20)
  useStore.getState().pasteClipboard();
  assert.equal(useStore.getState().instances.length, 5);
  const pasted2 = useStore.getState().instances.slice(3);
  assert.equal(pasted2[1].x - pasted2[0].x, 40);
  assert.equal(pasted2[1].y - pasted2[0].y, 20);

  // Cut & paste drawn rectangle shape
  const rectId = useStore.getState().addShape({ layer: 'M1', purpose: 'drawing', x: -10, y: -10, width: 20, height: 15 });
  useStore.getState().setSelectedShape(rectId);
  assert.equal(useStore.getState().cutSelection(), true);
  assert.equal(useStore.getState().shapes.length, 0);
  useStore.getState().pasteClipboard();
  assert.equal(useStore.getState().shapes.length, 1);
  assert.deepEqual([useStore.getState().shapes[0].x, useStore.getState().shapes[0].y], [-10, -10]);
  useStore.getState().undo();
  assert.equal(useStore.getState().shapes.length, 0);
  useStore.getState().undo();
  assert.equal(useStore.getState().shapes.length, 1);
});

test('mosaic inside an autoBounds sub-cell propagates master bounds and exports native SKILL dbCreateSimpleMosaic', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().createEmptyCell('chip_lib', 'PAD_TILE', '#06b6d4', true);
  const padTileId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 10, height: 20 });

  useStore.getState().createEmptyCell('chip_lib', 'PADRING', '#f59e0b', true);
  const padringId = useStore.getState().activeCellId;
  useStore.getState().placeInstanceMosaic(padTileId, 0, 0, 'R0', {
    namePrefix: 'M_PAD',
    rows: 1,
    cols: 4,
    deltaX: 25,
    deltaY: 25,
    asMosaic: true,
  });
  // 4 columns at pitch 25, width 10 => width = 3*25 + 10 = 85, height = 20
  assert.equal(useStore.getState().masterCells[padringId].width, 85);
  assert.equal(useStore.getState().masterCells[padringId].height, 20);

  // Adjusting mosaic columns live updates parent autoBounds immediately
  const mId = useStore.getState().instances[0].id;
  useStore.getState().updateInstanceMosaic(mId, { rows: 1, cols: 6, rowPitch: 25, colPitch: 25 });
  assert.equal(useStore.getState().masterCells[padringId].width, 135);

  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(padringId, 0, 0, 'R0');
  const snap = getProjectSnapshot(useStore.getState());
  const skill = generateSkillCode(
    snap.topLibName, snap.topCellName, snap.topWidth, snap.topHeight,
    snap.masterCells, snap.instances, snap.gridSize, snap.pixelArray,
    { hierarchyMode: 'zero-origin-direct', cellViews: snap.cellViews, topShapes: snap.shapes },
  );
  assert.match(skill, /dbCreateSimpleMosaic\(cv master "M_PAD" 0:0 "R0" 1 6 25 25\)/);
});
