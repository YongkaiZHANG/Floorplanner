import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import {
  applyCadenceOrientationVector,
  applyCadenceTransformPoint,
  computeActiveToBaseTransform,
  computeAncestorToActiveTransform,
  getOrientationMatrix,
  invertCadenceOrientation,
  invertCadenceTransform,
} from '../src/utils/hierarchy.ts';
import {
  computeStretchedShapes,
  countPartialSelectedEdges,
  hitTestShapeEdgeOrCorner,
  mergePartialSelections,
  selectShapeEdgesInBox,
} from '../src/utils/shapeStretch.ts';
import { useStore } from '../src/store/useStore.ts';

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

const applyTransform = (t, x, y) => {
  const m = getOrientationMatrix(t.orientation);
  return {
    x: t.x + m[0] * x + m[1] * y,
    y: t.y + m[2] * x + m[3] * y,
  };
};

test('invertCadenceTransform exactly inverts all 8 Cadence orientations and translations', () => {
  const orientations = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];
  for (const orientation of orientations) {
    const forward = { x: 135, y: -240, orientation };
    const inv = invertCadenceTransform(forward);
    assert.equal(invertCadenceOrientation(inv.orientation), orientation);
    const worldPt = applyTransform(forward, 37, -19);
    const recovered = applyTransform(inv, worldPt.x, worldPt.y);
    assert.equal(recovered.x, 37);
    assert.equal(recovered.y, -19);
  }
});

test('computeAncestorToActiveTransform maps multi-level EIP ancestor points into active cell frame', () => {
  // top_asic -> CLUSTER at (100, 50, R90) -> SUB_A at (20, 10, R0)
  // Point (5, 0) in SUB_A is (25, 10) in CLUSTER -> (-10+100, 25+50) = (90, 75) in top_asic
  const topToSub = computeAncestorToActiveTransform([
    { x: 100, y: 50, orientation: 'R90', parentWidth: 3000, parentHeight: 2000, parentCoordinateMode: 'origin' },
    { x: 20, y: 10, orientation: 'R0', parentWidth: 500, parentHeight: 400, parentCoordinateMode: 'origin' },
  ], 'origin', 100, 80);
  assert.deepEqual(applyTransform(topToSub, 90, 75), { x: 5, y: 0 });

  // Legacy centered active view (100x80 at (100, 50, R90)): centered (0,0) = local (50,40) -> top (60, 100)
  const topToCentered = computeAncestorToActiveTransform([
    { x: 100, y: 50, orientation: 'R90', parentWidth: 3000, parentHeight: 2000, parentCoordinateMode: 'origin' },
  ], 'centered', 100, 80);
  assert.deepEqual(applyTransform(topToCentered, 60, 100), { x: 0, y: 0 });
});

test('selectShapeEdgesInBox partially selects single edges, corners, multi-shape edges, and skips locked shapes', () => {
  const shapes = [
    { id: 'r1', layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 60 },
    { id: 'r2', layer: 'text', purpose: 'drawing', x: 0, y: 100, width: 100, height: 60 },
    { id: 'rLocked', layer: 'text', purpose: 'drawing', x: 0, y: 200, width: 100, height: 60, locked: true },
  ];

  // Cross only right edge of r1
  const rightOnly = selectShapeEdgesInBox(shapes, { minX: 90, maxX: 110, minY: 10, maxY: 50 });
  assert.deepEqual(rightOnly, { r1: ['right'] });

  // Enclose top-right corner of r1 -> both right and top edges selected
  const corner = selectShapeEdgesInBox(shapes, { minX: 90, maxX: 110, minY: 50, maxY: 70 });
  assert.deepEqual(corner, { r1: ['right', 'top'] });

  // Cross right edges of two overlapping-Y shapes without enclosing corners -> right-only on unlocked shapes, skips locked
  const parallelShapes = [
    { id: 'p1', layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 80 },
    { id: 'p2', layer: 'M1', purpose: 'drawing', x: 20, y: 0, width: 80, height: 80 },
    { id: 'pLocked', layer: 'M2', purpose: 'drawing', x: 10, y: 0, width: 90, height: 80, locked: true },
  ];
  const parallelRight = selectShapeEdgesInBox(parallelShapes, { minX: 95, maxX: 105, minY: 15, maxY: 65 });
  assert.deepEqual(parallelRight, { p1: ['right'], p2: ['right'] });
  assert.equal(countPartialSelectedEdges(parallelRight), 2);

  // Sweeping across stacked shapes encloses intermediate corners too (Virtuoso area partial select) and skips locked rLocked
  const multiSweep = selectShapeEdgesInBox(shapes, { minX: 95, maxX: 105, minY: 20, maxY: 240 });
  assert.deepEqual(multiSweep, { r1: ['right', 'top'], r2: ['right', 'bottom', 'top'] });
  assert.equal(countPartialSelectedEdges(multiSweep), 5);
});

test('hitTestShapeEdgeOrCorner prioritizes corners over edges and mergePartialSelections toggles cleanly', () => {
  const shapes = [
    { id: 's1', layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 80 },
  ];
  assert.deepEqual(hitTestShapeEdgeOrCorner(shapes, 100, 80, 5), {
    shapeId: 's1',
    edges: ['right', 'top'],
    kind: 'corner',
  });
  assert.deepEqual(hitTestShapeEdgeOrCorner(shapes, 101, 40, 5), {
    shapeId: 's1',
    edges: ['right'],
    kind: 'edge',
  });
  assert.equal(hitTestShapeEdgeOrCorner(shapes, 50, 40, 5), null);

  const added = mergePartialSelections({ s1: ['right'] }, { s1: ['top'] }, 'add');
  assert.deepEqual(added, { s1: ['right', 'top'] });
  const toggled = mergePartialSelections(added, { s1: ['right'] }, 'toggle');
  assert.deepEqual(toggled, { s1: ['top'] });
});

test('computeStretchedShapes stretches partial edges cleanly, supports multi-shape stretch, and avoids zero-area collapse', () => {
  const shapes = [
    { id: 'r1', layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 60 },
    { id: 'r2', layer: 'text', purpose: 'drawing', x: 20, y: 100, width: 80, height: 40 },
  ];

  // Stretch right edges of both r1 and r2 by dx=+50 (dy=+30 must be ignored on vertical right edges)
  const stretched = computeStretchedShapes(shapes, { r1: ['right'], r2: ['right'] }, 50, 30, 5, 1);
  assert.deepEqual(stretched, [
    { id: 'r1', x: 0, y: 0, width: 150, height: 60 },
    { id: 'r2', x: 20, y: 100, width: 130, height: 40 },
  ]);

  // Corner stretch (right + top) moves both axes
  const cornerStretched = computeStretchedShapes(shapes, { r1: ['right', 'top'] }, 25, -15, 5, 1);
  assert.deepEqual(cornerStretched, [
    { id: 'r1', x: 0, y: 0, width: 125, height: 45 },
  ]);

  // Pulling right edge exactly onto left edge (dx=-100 -> width=0) preserves valid width instead of vanishing
  const collapsed = computeStretchedShapes(shapes, { r1: ['right'] }, -100, 0, 1, 1);
  assert.deepEqual(collapsed, [
    { id: 'r1', x: 0, y: 0, width: 100, height: 60 },
  ]);

  // Pulling right edge past left edge (dx=-140 -> x in [-40..0]) flips cleanly to positive width 40
  const flipped = computeStretchedShapes(shapes, { r1: ['right'] }, -140, 0, 1, 1);
  assert.deepEqual(flipped, [
    { id: 'r1', x: -40, y: 0, width: 40, height: 60 },
  ]);
});

test('Virtuoso Edit-in-Place (X) descent tracks context stack, partial stretch updates cell & top bounds atomically, and Return pops context', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().createEmptyCell('xxxL_TOP', 'CORE_EIP', '#06b6d4', true);
  const coreId = useStore.getState().activeCellId;
  assert.ok(coreId);

  const s1 = useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 200, height: 100, label: 'CORE' });
  const s2 = useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 120, width: 200, height: 80, label: 'CTRL' });

  // Return to top_asic and instantiate CORE_EIP at (0, 0)
  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(coreId, 0, 0, 'R0', 'I_CORE');
  const inst = useStore.getState().instances[0];

  // Select and descend via Edit-in-Place (X)
  useStore.getState().descendIntoInstance(inst.id);
  assert.equal(useStore.getState().activeCellId, coreId);
  assert.equal(useStore.getState().descendStack.length, 1);
  assert.equal(useStore.getState().descendStack[0].instanceId, inst.id);
  assert.equal(useStore.getState().descendStack[0].parentCellId, null);

  // Partially select across the right side of BOTH stacked shapes and stretch horizontally +100 um in one atomic batch
  const partialSel = selectShapeEdgesInBox(useStore.getState().shapes, { minX: 195, maxX: 205, minY: 10, maxY: 190 });
  assert.deepEqual(partialSel, { [s1]: ['right', 'top'], [s2]: ['right', 'bottom'] });
  const updates = computeStretchedShapes(useStore.getState().shapes, partialSel, 100, 0, 1, 1);
  useStore.getState().batchUpdateShapes(updates);

  assert.equal(useStore.getState().shapes.find(s => s.id === s1).width, 300);
  assert.equal(useStore.getState().shapes.find(s => s.id === s1).height, 100);
  assert.equal(useStore.getState().shapes.find(s => s.id === s2).width, 300);
  assert.equal(useStore.getState().shapes.find(s => s.id === s2).height, 80);
  assert.equal(useStore.getState().masterCells[coreId].width, 300);

  // Return to top_asic -> descendStack cleared and I_CORE reflects stretched 300x200 bounds immediately
  useStore.getState().ascendToParent();
  assert.equal(useStore.getState().activeCellId, null);
  assert.equal(useStore.getState().descendStack.length, 0);
  const masterInTop = useStore.getState().masterCells[coreId];
  const bounds = getPhysicalBounds({
    ...useStore.getState().instances[0],
    width: masterInTop.width,
    height: masterInTop.height,
    originX: masterInTop.originX,
    originY: masterInTop.originY,
  });
  assert.equal(bounds.left, 0);
  assert.equal(bounds.right, 300);
  assert.equal(bounds.bottom, 0);
  assert.equal(bounds.top, 200);

  // Single undo rolls back the entire 2-shape stretch atomically
  useStore.getState().undo();
  assert.equal(useStore.getState().masterCells[coreId].width, 200);
});

test('undo inside Edit-in-Place refreshes or clears descendStack, deleteMasterCell clears EIP stack, and F4 switches out of conflicting modes', () => {
  useStore.getState().loadProject(baseProject);
  useStore.getState().createEmptyCell('xxxL_TOP', 'EIP_UNDO', '#3b82f6', true);
  const cellId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 80 });

  useStore.getState().openCellView(null);
  useStore.getState().placeInstance(cellId, 0, 0, 'R0', 'I0');
  const instId = useStore.getState().instances[0].id;
  useStore.getState().updateInstancePosition(instId, 50, 20);

  // Descend into moved I0 -> descendStack records (50, 20)
  useStore.getState().descendIntoInstance(instId);
  assert.equal(useStore.getState().descendStack[0].x, 50);
  assert.equal(useStore.getState().descendStack[0].y, 20);

  // Undo the move while inside EIP -> descendStack refreshes to (0, 0)
  useStore.getState().undo();
  assert.equal(useStore.getState().descendStack.length, 1);
  assert.equal(useStore.getState().descendStack[0].x, 0);
  assert.equal(useStore.getState().descendStack[0].y, 0);

  // Undo the placement itself while inside EIP -> descendStack clears cleanly instead of holding a dangling instanceId
  useStore.getState().undo();
  assert.equal(useStore.getState().descendStack.length, 0);

  // Redo restores placement; descend again, then deleteMasterCell clears descendStack and returns to top
  useStore.getState().redo();
  useStore.getState().openCellView(null);
  useStore.getState().descendIntoInstance(useStore.getState().instances[0].id);
  assert.equal(useStore.getState().descendStack.length, 1);
  useStore.getState().deleteMasterCell(cellId);
  assert.equal(useStore.getState().activeCellId, null);
  assert.equal(useStore.getState().descendStack.length, 0);

  // F4 (togglePartialSelectMode) switches out of 'rect' into 'select', but preserves 'stretch'
  useStore.getState().setAppMode('rect');
  if (useStore.getState().partialSelectMode) useStore.getState().togglePartialSelectMode();
  useStore.getState().togglePartialSelectMode();
  assert.equal(useStore.getState().partialSelectMode, true);
  assert.equal(useStore.getState().appMode, 'select');
  useStore.getState().togglePartialSelectMode();
  useStore.getState().setAppMode('stretch');
  useStore.getState().togglePartialSelectMode();
  assert.equal(useStore.getState().partialSelectMode, true);
  assert.equal(useStore.getState().appMode, 'stretch');
});

test('computeActiveToBaseTransform, applyCadenceTransformPoint, and applyCadenceOrientationVector round-trip across all 8 orientations and multi-level chains', () => {
  const orientations = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];
  for (const orientation of orientations) {
    const chain = [
      { x: -468.49, y: -874.315, orientation, parentWidth: 3000, parentHeight: 2000, parentCoordinateMode: 'origin' },
    ];
    const forward = computeActiveToBaseTransform(chain, 'origin', 180.075, 125.685);
    const inverse = invertCadenceTransform(forward);
    const ptBase = applyCadenceTransformPoint(forward, 42.5, 17.25);
    const ptRecovered = applyCadenceTransformPoint(inverse, ptBase.x, ptBase.y);
    assert.ok(Math.abs(ptRecovered.x - 42.5) < 1e-9);
    assert.ok(Math.abs(ptRecovered.y - 17.25) < 1e-9);

    // Forward vector followed by inverse vector recovers the original screen delta
    const editVec = applyCadenceOrientationVector(inverse.orientation, 12, -5);
    const baseVec = applyCadenceOrientationVector(forward.orientation, editVec.dx, editVec.dy);
    assert.deepEqual(baseVec, { dx: 12, dy: -5 });
  }

  // Exact R180 bottom-pad check: moving +10 um right on screen moves -10 um in local PAD coordinates
  const r180Forward = computeActiveToBaseTransform([
    { x: -468.49, y: -874.315, orientation: 'R180', parentWidth: 3000, parentHeight: 2000, parentCoordinateMode: 'origin' },
  ], 'origin', 180.075, 125.685);
  const r180Inv = invertCadenceTransform(r180Forward);
  assert.deepEqual(applyCadenceOrientationVector(r180Inv.orientation, 10, 5), { dx: -10, dy: -5 });

  // Multi-level chain matches exact inverse of computeAncestorToActiveTransform (origin & legacy centered parent)
  const multiChain = [
    { x: 100, y: 200, orientation: 'R90', parentWidth: 3000, parentHeight: 2000, parentCoordinateMode: 'origin' },
    { x: -50, y: 10, orientation: 'MX', parentWidth: 400, parentHeight: 300, parentCoordinateMode: 'centered' },
  ];
  const fwdMulti = computeActiveToBaseTransform(multiChain, 'origin', 80, 60);
  const invMulti = computeAncestorToActiveTransform(multiChain, 'origin', 80, 60);
  const basePt = applyCadenceTransformPoint(fwdMulti, 13, 29);
  assert.deepEqual(applyCadenceTransformPoint(invMulti, basePt.x, basePt.y), { x: 13, y: 29 });
});

test('True Edit-in-Place (X) keeps openViewIds on current cellview tab, supports standalone switch, background close, and nested IP descent', () => {
  useStore.getState().loadProject(baseProject);

  // Create LEAF (PAD) and CLUSTER containing LEAF
  useStore.getState().createEmptyCell('xxxL_TOP', 'PAD_EIP', '#f59e0b', true);
  const padId = useStore.getState().activeCellId;
  useStore.getState().addShape({ layer: 'text', purpose: 'drawing', x: 0, y: 0, width: 100, height: 80, label: 'PAD' });

  useStore.getState().createEmptyCell('xxxL_TOP', 'CLUSTER_EIP', '#10b981', true);
  const clusterId = useStore.getState().activeCellId;
  useStore.getState().placeInstance(padId, 20, 30, 'R180', 'I_PAD');
  const subPadInstId = useStore.getState().instances[0].id;

  // Return to top_asic and close IP tabs so only top_asic is open
  useStore.getState().openCellView(null);
  useStore.getState().closeCellViewTab(padId);
  useStore.getState().closeCellViewTab(clusterId);
  assert.deepEqual(useStore.getState().openViewIds, [null]);

  useStore.getState().placeInstance(clusterId, 200, 100, 'R0', 'I_CLUS');
  const clusterInstId = useStore.getState().instances[0].id;

  // Press X on I_CLUS in top_asic -> edits CLUSTER_EIP in place WITHOUT opening a new tab!
  useStore.getState().descendIntoInstance(clusterInstId);
  assert.equal(useStore.getState().activeCellId, clusterId);
  assert.equal(useStore.getState().descendStack.length, 1);
  assert.equal(useStore.getState().descendStack[0].parentCellId, null);
  assert.deepEqual(useStore.getState().openViewIds, [null]);

  // Press X again on I_PAD inside CLUSTER_EIP -> 2-level EIP still anchored to top_asic tab!
  useStore.getState().descendIntoInstance(subPadInstId);
  assert.equal(useStore.getState().activeCellId, padId);
  assert.equal(useStore.getState().descendStack.length, 2);
  assert.equal(useStore.getState().descendStack[0].parentCellId, null);
  assert.deepEqual(useStore.getState().openViewIds, [null]);

  // Explicitly opening PAD_EIP as standalone tab exits EIP and adds PAD_EIP tab
  useStore.getState().openCellView(padId);
  assert.equal(useStore.getState().activeCellId, padId);
  assert.equal(useStore.getState().descendStack.length, 0);
  assert.deepEqual(useStore.getState().openViewIds, [null, padId]);

  // Switch back to top_asic, descend into CLUSTER -> PAD while PAD tab is open in background,
  // then close the background PAD tab -> must stay in top_asic EIP!
  useStore.getState().openCellView(null);
  useStore.getState().descendIntoInstance(clusterInstId);
  useStore.getState().descendIntoInstance(subPadInstId);
  assert.equal(useStore.getState().activeCellId, padId);
  assert.equal(useStore.getState().descendStack.length, 2);
  useStore.getState().closeCellViewTab(padId);
  assert.equal(useStore.getState().activeCellId, padId);
  assert.equal(useStore.getState().descendStack.length, 2);
  assert.deepEqual(useStore.getState().openViewIds, [null]);

  // Open standalone CLUSTER_EIP tab and descend via X into I_PAD -> stays on CLUSTER_EIP tab!
  useStore.getState().openCellView(clusterId);
  assert.deepEqual(useStore.getState().openViewIds, [null, clusterId]);
  assert.equal(useStore.getState().descendStack.length, 0);
  useStore.getState().descendIntoInstance(subPadInstId);
  assert.equal(useStore.getState().activeCellId, padId);
  assert.equal(useStore.getState().descendStack.length, 1);
  assert.equal(useStore.getState().descendStack[0].parentCellId, clusterId);
  assert.deepEqual(useStore.getState().openViewIds, [null, clusterId]);

  // navigateBreadcrumb(0) from standalone CLUSTER_EIP -> PAD_EIP cleanly pops descendStack to []
  useStore.getState().navigateBreadcrumb(0);
  assert.equal(useStore.getState().activeCellId, clusterId);
  assert.equal(useStore.getState().descendStack.length, 0);
});
