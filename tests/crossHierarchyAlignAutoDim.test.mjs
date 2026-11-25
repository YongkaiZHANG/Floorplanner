import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import {
  boxesStrictlyOverlap,
  collectEipAncestorReferenceBoxes,
  collectInstanceDescendantBoxes,
  computeActiveToBaseTransform,
  getHierarchyUsageCounts,
  invertCadenceTransform,
  transformBoxByCadence,
} from '../src/utils/hierarchy.ts';
import { generateSkillCode } from '../src/utils/skillExport.ts';
import { getProjectSnapshot, makeShapeAlignmentId, useStore } from '../src/store/useStore.ts';

const baseProject = {
  gridSize: 0.005,
  topWidth: 1000,
  topHeight: 800,
  topLibName: 'chip_lib',
  topCellName: 'top_asic',
  masterCells: {},
  instances: [],
  rulers: [],
};

test('higher-level cell aligns accurately to lower-level sub-cell & mosaic tile inside a rotated hierarchical instance', () => {
  useStore.getState().loadProject(baseProject);

  // Create leaf PAD (20x10) and container PADRING with a 1x3 mosaic of PADs
  useStore.getState().createEmptyCell('chip_lib', 'PAD', '#f59e0b', true);
  const padId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 20, height: 10 });

  useStore.getState().createEmptyCell('chip_lib', 'PADRING', '#06b6d4', true);
  const padringId = useStore.getState().activeCellId;
  useStore.getState().placeInstanceMosaic(padId, 0, -250, 'R0', {
    namePrefix: 'M_BOT_PADS',
    rows: 1,
    cols: 3,
    deltaX: 30,
    deltaY: 30,
    asMosaic: true,
  });
  // Also place a top pad inside PADRING so PADRING's outer bbox spans y in [-250..250] and wraps CORE!
  useStore.getState().placeInstance(padId, 0, 240, 'R0', 'TOP_PAD');

  // Return to top_asic and place PADRING at (0, 0) + CORE (100x80) inside it at (-50, 0)
  useStore.getState().openCellView(null);
  useStore.getState().addMasterCell('chip_lib', 'CORE', 100, 80, '#2563eb');
  const coreMaster = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'CORE');

  useStore.getState().placeInstance(padringId, 0, 0, 'R0', 'U_PADRING');
  useStore.getState().placeInstance(coreMaster.id, -50, 0, 'R0', 'U_CORE');

  const state = useStore.getState();
  const descendants = collectInstanceDescendantBoxes(state.instances, state.masterCells, state.cellViews);

  // Verify lower-level TOP_PAD and mosaic tiles [0,0], [0,1], [0,2] were collected concisely without redundant `/text/drawing` or `(cellName)` clutter
  assert.equal(descendants.some(d => d.label.includes('drawing')), false, 'Expected no redundant /drawing labels in descendant boxes');
  const topPadRef = descendants.find(d => d.label === 'U_PADRING/TOP_PAD' && d.level === 'child');
  const tile2Ref = descendants.find(d => d.label === 'U_PADRING/M_BOT_PADS[0,2]');
  assert.ok(topPadRef, 'Expected concise U_PADRING/TOP_PAD reference box');
  assert.equal(topPadRef.isLeaf, true, 'Leaf PAD with single body rect should remain a leaf instance');
  assert.equal(topPadRef.detailLabel, 'U_PADRING/TOP_PAD (PAD)');
  assert.ok(tile2Ref, 'Expected concise U_PADRING/M_BOT_PADS[0,2] reference box');
  assert.equal(tile2Ref.isLeaf, true);
  assert.deepEqual(topPadRef.box, { minX: 0, maxX: 20, minY: 240, maxY: 250 });
  assert.deepEqual(tile2Ref.box, { minX: 60, maxX: 80, minY: -250, maxY: -240 });

  // Verify PADRING's outer bbox strictly overlaps CORE, while its lower-level leaf pads give positive clearances for Auto-Dim!
  const padringInst = state.instances.find(i => i.name === 'U_PADRING');
  const coreInst = state.instances.find(i => i.name === 'U_CORE');
  const padringMaster = state.masterCells[padringId];
  const padringBounds = getPhysicalBounds({ ...padringInst, width: padringMaster.width, height: padringMaster.height, originX: padringMaster.originX, originY: padringMaster.originY });
  const coreBounds = getPhysicalBounds({ ...coreInst, width: coreMaster.width, height: coreMaster.height });
  assert.equal(
    boxesStrictlyOverlap(
      { minX: padringBounds.left, maxX: padringBounds.right, minY: padringBounds.bottom, maxY: padringBounds.top },
      { minX: coreBounds.left, maxX: coreBounds.right, minY: coreBounds.bottom, maxY: coreBounds.top },
    ),
    true,
  );
  // Gap from CORE.top (80) to lower-level TOP_PAD.bottom (240) is +160 um; gap from CORE.bottom (0) to lower-level M_BOT_PADS.top (-240) is +240 um!
  assert.equal(topPadRef.box.minY - coreBounds.top, 160);
  assert.equal(coreBounds.bottom - tile2Ref.box.maxY, 240);

  // Align higher-level U_CORE.bottom to lower-level M_BOT_PADS[0,2].top with 15 um directional spacing!
  useStore.getState().setSelectedInstance(coreInst.id);
  useStore.getState().startEdgeAlignment(coreInst.id);
  useStore.getState().setEdgeAlignmentEdge(coreInst.id, 'bottom');
  useStore.getState().setEdgeAlignmentOffset('15');
  useStore.getState().completeEdgeAlignmentToCoordinate(tile2Ref.box.maxY, `${tile2Ref.label}.top`);

  const movedCore = useStore.getState().instances.find(i => i.id === coreInst.id);
  const movedCoreBounds = getPhysicalBounds({ ...movedCore, width: coreMaster.width, height: coreMaster.height });
  // U_CORE was above M_BOT_PADS (-240), so directional spacing places U_CORE.bottom = -240 + 15 = -225!
  assert.equal(movedCoreBounds.bottom, -225);

  // Align higher-level U_CORE.right to lower-level M_BOT_PADS[0,2].right with 0 spacing
  useStore.getState().startEdgeAlignment(coreInst.id);
  useStore.getState().setEdgeAlignmentEdge(coreInst.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToCoordinate(tile2Ref.box.right ?? tile2Ref.box.maxX, `${tile2Ref.label}.right`);
  const movedCore2 = useStore.getState().instances.find(i => i.id === coreInst.id);
  assert.equal(getPhysicalBounds({ ...movedCore2, width: coreMaster.width, height: coreMaster.height }).right, 80);

  // Undo restores previous alignment step cleanly
  useStore.getState().undo();
  assert.equal(useStore.getState().instances.find(i => i.id === coreInst.id).x, -50);
});

test('lower-level cell and drawn rectangle in rotated Edit-in-Place (X) align accurately to higher-level cells and boundaries', () => {
  useStore.getState().loadProject(baseProject);

  // Build SUB_CELL containing a child block SUB_BLK and a drawn rectangle, then place SUB_CELL rotated R90 in top_asic
  useStore.getState().addMasterCell('chip_lib', 'SUB_BLK', 20, 10, '#10b981');
  useStore.getState().addMasterCell('chip_lib', 'REF_TOP', 60, 40, '#3b82f6');
  const subBlk = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'SUB_BLK');
  const refTop = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'REF_TOP');

  useStore.getState().createEmptyCell('chip_lib', 'SUB_CELL', '#06b6d4', true);
  const subCellId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(subBlk.id, 0, 0, 'R0', 'U_CHILD');
  const rectId = useStore.getState().addShape({ layer: 'M1', purpose: 'drawing', x: 30, y: 0, width: 20, height: 10 });

  // Return to top_asic: place U_SUB at (100, 50) rotated R90, and U_REF at (-100, 120) R0
  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(subCellId, 100, 50, 'R90', 'U_SUB');
  useStore.getState().placeInstance(refTop.id, -100, 120, 'R0', 'U_REF');

  const subInst = useStore.getState().instances.find(i => i.name === 'U_SUB');
  // Descend Edit-in-Place (X) into rotated U_SUB
  useStore.getState().descendIntoInstance(subInst.id);

  const eipState = useStore.getState();
  const forward = computeActiveToBaseTransform(eipState.descendStack, eipState.activeCoordinateMode, eipState.topWidth, eipState.topHeight);
  const inverse = invertCadenceTransform(forward);
  const ancestorBoxes = collectEipAncestorReferenceBoxes(
    eipState.descendStack,
    eipState.rootView,
    eipState.masterCells,
    eipState.cellViews,
    inverse,
  );

  // Find higher-level U_REF mapped into rotated SUB_CELL local frame
  const refAnc = ancestorBoxes.find(b => b.label.includes('U_REF'));
  assert.ok(refAnc, 'Expected higher-level U_REF in EIP ancestor reference boxes');
  // Mapping refAnc.box back through forward transform must exactly recover U_REF's top_asic bounds [-100..-40] x [120..160]!
  const backInTop = transformBoxByCadence(refAnc.box, forward);
  assert.deepEqual(backInTop, { minX: -100, maxX: -40, minY: 120, maxY: 160 });

  // Align lower-level U_CHILD (inside rotated R90 SUB_CELL) to higher-level U_REF!
  // Under R90: local +X maps to top +Y, local +Y maps to top -X.
  // Aligning U_CHILD.left (local minX) to refAnc.box.minX (which corresponds to top_asic y = 120) with 0 spacing:
  const childInst = useStore.getState().instances.find(i => i.name === 'U_CHILD');
  useStore.getState().startEdgeAlignment(childInst.id);
  useStore.getState().setEdgeAlignmentEdge(childInst.id, 'left');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToCoordinate(refAnc.box.minX, `${refAnc.label}.left`);

  const movedChild = useStore.getState().instances.find(i => i.id === childInst.id);
  const movedChildBox = getPhysicalBounds({ ...movedChild, width: subBlk.width, height: subBlk.height });
  const movedChildInTop = transformBoxByCadence(
    { minX: movedChildBox.left, maxX: movedChildBox.right, minY: movedChildBox.bottom, maxY: movedChildBox.top },
    forward,
  );
  // U_CHILD's bottom edge in top_asic now equals U_REF's bottom edge (y = 120)!
  assert.equal(movedChildInTop.minY, 120);

  // Also align lower-level drawn rectangle (SHAPE_ALIGNMENT_PREFIX) to higher-level U_REF!
  const shapeAlignId = makeShapeAlignmentId(rectId);
  useStore.getState().startEdgeAlignment(shapeAlignId);
  useStore.getState().setEdgeAlignmentEdge(shapeAlignId, 'right');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToCoordinate(refAnc.box.maxX, `${refAnc.label}.right`);
  const movedShape = useStore.getState().shapes.find(s => s.id === rectId);
  const movedShapeInTop = transformBoxByCadence(
    { minX: movedShape.x, maxX: movedShape.x + movedShape.width, minY: movedShape.y, maxY: movedShape.y + movedShape.height },
    forward,
  );
  // Rectangle's top edge in top_asic now equals U_REF's top edge (y = 160)!
  assert.equal(movedShapeInTop.maxY, 160);

  // Also align lower-level drawn rectangle directly to top_asic top boundary (y = +400) via alignSelectedInstancesToBoundary
  useStore.getState().setSelectedShape(rectId);
  useStore.getState().alignSelectedInstancesToBoundary('top');
  const boundaryShape = useStore.getState().shapes.find(s => s.id === rectId);
  const boundaryShapeInTop = transformBoxByCadence(
    { minX: boundaryShape.x, maxX: boundaryShape.x + boundaryShape.width, minY: boundaryShape.y, maxY: boundaryShape.y + boundaryShape.height },
    forward,
  );
  assert.equal(boundaryShapeInTop.maxY, 400);
});

test('sub-grid cross-hierarchy target coordinates snap cleanly without throwing and mosaic usage counts multiply recursively', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().addMasterCell('chip_lib', 'BOND_PAD', 10, 10, '#f59e0b');
  const bondPad = Object.values(useStore.getState().masterCells).find(c => c.cellName === 'BOND_PAD');

  useStore.getState().createEmptyCell('chip_lib', 'PAD_WRAP', '#06b6d4', true);
  const padWrapId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(bondPad.id, 0, 0, 'R0', 'U_BOND');

  useStore.getState().openCellView(null);
  useStore.getState().placeInstanceMosaic(padWrapId, 0, 0, 'R0', {
    namePrefix: 'M_PADS',
    rows: 1,
    cols: 4,
    deltaX: 20,
    deltaY: 20,
    asMosaic: true,
  });

  const snap = getProjectSnapshot(useStore.getState());
  const counts = getHierarchyUsageCounts(snap.instances, snap.cellViews ?? {});
  assert.equal(counts.get(padWrapId), 4);
  assert.equal(counts.get(bondPad.id), 4);

  // In zero-origin-direct SKILL export, neither PAD_WRAP nor BOND_PAD should be origin-anchored because both are repeated 4x!
  const skill = generateSkillCode(
    snap.topLibName, snap.topCellName, snap.topWidth, snap.topHeight,
    snap.masterCells, snap.instances, snap.gridSize, snap.pixelArray,
    { hierarchyMode: 'zero-origin-direct', cellViews: snap.cellViews, topShapes: snap.shapes },
  );
  assert.doesNotMatch(skill, /origin-anchored/);
  assert.match(skill, /dbCreateSimpleMosaic\(cv master "M_PADS" 0:0 "R0" 1 4 20 20\)/);

  // Sub-grid target coordinate (e.g. 12.3425 on 0.005 grid) snaps cleanly to 12.345 without throwing
  const inst = useStore.getState().instances[0];
  useStore.getState().startEdgeAlignment(inst.id);
  useStore.getState().setEdgeAlignmentEdge(inst.id, 'left');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToCoordinate(12.3425, 'legacy/sub.left');
  assert.equal(useStore.getState().instances[0].x, 12.345);
});
