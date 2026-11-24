import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import {
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

  // Cross right edges of r1, r2, and rLocked -> selects r1 & r2, skips locked rLocked
  const multiRight = selectShapeEdgesInBox(shapes, { minX: 95, maxX: 105, minY: 20, maxY: 240 });
  assert.deepEqual(multiRight, { r1: ['right'], r2: ['right'] });
  assert.equal(countPartialSelectedEdges(multiRight), 2);
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

  // Partially select right edges of BOTH shapes and stretch them +100 um in one atomic batch
  const partialSel = selectShapeEdgesInBox(useStore.getState().shapes, { minX: 195, maxX: 205, minY: 10, maxY: 190 });
  assert.deepEqual(partialSel, { [s1]: ['right'], [s2]: ['right'] });
  const updates = computeStretchedShapes(useStore.getState().shapes, partialSel, 100, 0, 1, 1);
  useStore.getState().batchUpdateShapes(updates);

  assert.equal(useStore.getState().shapes.find(s => s.id === s1).width, 300);
  assert.equal(useStore.getState().shapes.find(s => s.id === s2).width, 300);
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
