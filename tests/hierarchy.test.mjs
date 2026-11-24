import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import {
  composeCadenceTransform,
  getHierarchyUsageCounts,
  getTopologicalCellOrder,
  wouldCreateHierarchyCycle,
} from '../src/utils/hierarchy.ts';

test('composeCadenceTransform matches physical geometry across all 8 Cadence orientations', () => {
  const parentW = 40;
  const parentH = 20;
  const childW = 10;
  const childH = 6;
  const orientations = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];

  for (const parentOrient of orientations) {
    const parent = { x: 100, y: -50, orientation: parentOrient };
    const parentBounds = getPhysicalBounds({ id: 'p', ...parent, width: parentW, height: parentH });

    for (const childOrient of orientations) {
      // Child placed near the center of parent edit space (local (15, 10) inside 40x20),
      // leaving >= 10 um margin in every direction so 10x6 fits under all 8 orientations.
      const child = { x: -5, y: 0, orientation: childOrient };
      const composed = composeCadenceTransform(parent, child, parentW, parentH);
      const childBounds = getPhysicalBounds({
        id: 'c',
        x: composed.x,
        y: composed.y,
        orientation: composed.orientation,
        width: childW,
        height: childH,
      });

      assert.ok(childBounds.left >= parentBounds.left - 1e-9, `${parentOrient}/${childOrient} left`);
      assert.ok(childBounds.right <= parentBounds.right + 1e-9, `${parentOrient}/${childOrient} right`);
      assert.ok(childBounds.bottom >= parentBounds.bottom - 1e-9, `${parentOrient}/${childOrient} bottom`);
      assert.ok(childBounds.top <= parentBounds.top + 1e-9, `${parentOrient}/${childOrient} top`);
    }
  }

  // Exact numeric check: R90 parent at (50, 10) with R0 child at (-10, -5) in 40x20 parent
  // Local coords inside parent: (-10 + 20, -5 + 10) = (10, 5)
  // R90 maps (10, 5) -> (-5, 10), so global = (45, 20), orient = R90
  const exact = composeCadenceTransform(
    { x: 50, y: 10, orientation: 'R90' },
    { x: -10, y: -5, orientation: 'R0' },
    40,
    20,
  );
  assert.deepEqual(exact, { x: 45, y: 20, orientation: 'R90' });
});

test('wouldCreateHierarchyCycle detects direct and transitive cycles while allowing DAG sharing', () => {
  const cellViews = {
    A: { instances: [{ id: '1', cellId: 'B', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
    B: { instances: [{ id: '2', cellId: 'C', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
  };

  assert.equal(wouldCreateHierarchyCycle(null, 'A', cellViews), false);
  assert.equal(wouldCreateHierarchyCycle('A', 'A', cellViews), true);
  assert.equal(wouldCreateHierarchyCycle('B', 'A', cellViews), true);
  assert.equal(wouldCreateHierarchyCycle('C', 'A', cellViews), true);
  // DAG diamond: A also instantiating C directly is valid
  assert.equal(wouldCreateHierarchyCycle('A', 'C', cellViews), false);
});

test('getTopologicalCellOrder returns leaves before parents and rejects cycles', () => {
  const cellViews = {
    SUB_TOP: { instances: [{ id: '1', cellId: 'LEAF', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
    TOP_CHILD: { instances: [{ id: '2', cellId: 'SUB_TOP', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
  };

  const order = getTopologicalCellOrder(['TOP_CHILD', 'SUB_TOP', 'LEAF'], cellViews);
  assert.ok(order.indexOf('LEAF') < order.indexOf('SUB_TOP'));
  assert.ok(order.indexOf('SUB_TOP') < order.indexOf('TOP_CHILD'));

  const cyclic = {
    A: { instances: [{ id: '1', cellId: 'B', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
    B: { instances: [{ id: '2', cellId: 'A', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
  };
  assert.throws(() => getTopologicalCellOrder(['A', 'B'], cyclic), /Circular hierarchy/);
});

test('getHierarchyUsageCounts computes global expanded instance counts', () => {
  const rootInstances = [
    { id: 'r1', cellId: 'UNIQUE_SUB', name: 'I0', x: 0, y: 0, orientation: 'R0' },
    { id: 'r2', cellId: 'SHARED_SUB', name: 'I1', x: 10, y: 0, orientation: 'R0' },
    { id: 'r3', cellId: 'SHARED_SUB', name: 'I2', x: 20, y: 0, orientation: 'R0' },
  ];
  const cellViews = {
    UNIQUE_SUB: {
      instances: [{ id: 'c1', cellId: 'UNIQUE_LEAF', name: 'I0', x: 0, y: 0, orientation: 'R0' }],
      rulers: [],
    },
    SHARED_SUB: {
      instances: [{ id: 'c2', cellId: 'MULTI_LEAF', name: 'I0', x: 0, y: 0, orientation: 'R0' }],
      rulers: [],
    },
  };

  const counts = getHierarchyUsageCounts(rootInstances, cellViews);
  assert.equal(counts.get('UNIQUE_SUB'), 1);
  assert.equal(counts.get('UNIQUE_LEAF'), 1);
  assert.equal(counts.get('SHARED_SUB'), 2);
  // MULTI_LEAF is instantiated once inside SHARED_SUB, which is instantiated twice in root -> 2 globally!
  assert.equal(counts.get('MULTI_LEAF'), 2);
});
