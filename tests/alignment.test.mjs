import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignInstanceToTarget,
  alignInstances,
  distributeInstances,
  getPhysicalBounds,
} from '../src/utils/alignment.ts';

const options = { topWidth: 100, topHeight: 100, gridSize: 1 };
const block = (id, x, y, width = 10, height = 5, orientation = 'R0') => ({
  id, x, y, width, height, orientation,
});

test('computes physical bounds for all eight Cadence orientations', () => {
  const expected = {
    R0: [0, 10, 0, 5],
    R90: [-5, 0, 0, 10],
    R180: [-10, 0, -5, 0],
    R270: [0, 5, -10, 0],
    MX: [0, 10, -5, 0],
    MY: [-10, 0, 0, 5],
    MXR90: [0, 5, 0, 10],
    MYR90: [-5, 0, -10, 0],
  };
  for (const [orientation, edges] of Object.entries(expected)) {
    const bounds = getPhysicalBounds(block(orientation, 0, 0, 10, 5, orientation));
    assert.deepEqual(
      [bounds.left, bounds.right, bounds.bottom, bounds.top],
      edges,
      orientation,
    );
  }
});

test('aligns transformed left edges rather than instance origins', () => {
  const source = [
    block('normal', -20, 0, 10, 5, 'R0'),
    block('rotated', 20, 10, 10, 5, 'R90'),
    block('mirrored', 10, 20, 10, 5, 'MY'),
  ];
  const result = alignInstances(source, 'left', options);
  const moved = result.map(position => getPhysicalBounds({
    ...source.find(instance => instance.id === position.id),
    ...position,
  }));
  assert.deepEqual(moved.map(bounds => bounds.left), [-20, -20, -20]);
  assert.deepEqual(result.map(position => position.y), [0, 10, 20]);
});

test('aligns right and bottom edges for mirrored and rotated blocks', () => {
  const source = [
    block('normal', -20, -15, 10, 5, 'R0'),
    block('rotated', 20, 10, 10, 5, 'R270'),
    block('mirrored', 5, 20, 10, 5, 'MX'),
  ];
  const right = alignInstances(source, 'right', options);
  assert.deepEqual(
    right.map((position, index) => getPhysicalBounds({ ...source[index], ...position }).right),
    [-10, -10, -10],
  );
  const bottom = alignInstances(source, 'bottom', options);
  assert.deepEqual(
    bottom.map((position, index) => getPhysicalBounds({ ...source[index], ...position }).bottom),
    [-15, -15, -15],
  );
});

test('aligns tops and both center axes using displayed bounds', () => {
  const halfGridOptions = { ...options, gridSize: 0.5 };
  const source = [
    block('a', -30, -20, 10, 10),
    block('b', 20, 15, 8, 12, 'R90'),
  ];
  const top = alignInstances(source, 'top', halfGridOptions);
  assert.deepEqual(top.map((position, index) => getPhysicalBounds({ ...source[index], ...position }).top), [-10, -10]);

  const centerX = alignInstances(source, 'horizontal-center', halfGridOptions);
  assert.deepEqual(centerX.map((position, index) => getPhysicalBounds({ ...source[index], ...position }).centerX), [-25, -25]);

  const centerY = alignInstances(source, 'vertical-center', halfGridOptions);
  assert.deepEqual(centerY.map((position, index) => getPhysicalBounds({ ...source[index], ...position }).centerY), [-15, -15]);
});

test('keeps every result grid-snapped and inside the top cell', () => {
  const tight = { topWidth: 30, topHeight: 20, gridSize: 2 };
  const source = [
    block('small', -12, -8, 4, 4),
    block('wide', 4, 5, 20, 8),
  ];
  const result = alignInstances(source, 'left', tight);
  for (let index = 0; index < result.length; index += 1) {
    assert.ok(Number.isInteger(result[index].x / 2));
    assert.ok(Number.isInteger(result[index].y / 2));
    const bounds = getPhysicalBounds({ ...source[index], ...result[index] });
    assert.ok(bounds.left >= -15 && bounds.right <= 15);
    assert.ok(bounds.bottom >= -10 && bounds.top <= 10);
  }
});

test('uses the explicit primary block as the fixed alignment reference', () => {
  const source = [
    block('first', -30, 0, 10, 5),
    block('anchor', 12, 8, 8, 6, 'MY'),
    block('third', 30, -10, 5, 10, 'R90'),
  ];
  const result = alignInstances(source, 'left', { ...options, anchorId: 'anchor' });
  const bounds = result.map((position, index) => getPhysicalBounds({ ...source[index], ...position }));
  const anchorPosition = result.find(position => position.id === 'anchor');
  assert.deepEqual(anchorPosition, { id: 'anchor', x: 12, y: 8 });
  assert.deepEqual(bounds.map(item => item.left), [4, 4, 4]);
});

test('aligns a rotated source edge to a mirrored target edge with a signed offset', () => {
  const source = block('source', 30, 10, 10, 5, 'R90');
  const target = block('target', 0, -10, 10, 6, 'MY');
  const position = alignInstanceToTarget(source, target, 'right', 'left', -3, options);
  const moved = getPhysicalBounds({ ...source, ...position });
  const fixed = getPhysicalBounds(target);
  assert.deepEqual(position, { id: 'source', x: -13, y: 10 });
  assert.equal(moved.right, fixed.left - 3);
  assert.deepEqual({ x: target.x, y: target.y }, { x: 0, y: -10 });
});

test('supports vertical edge-to-edge alignment without changing the perpendicular coordinate', () => {
  const source = block('source', 18, -20, 10, 5, 'MXR90');
  const target = block('target', -10, 5, 8, 12, 'R180');
  const position = alignInstanceToTarget(source, target, 'bottom', 'top', 2, options);
  const moved = getPhysicalBounds({ ...source, ...position });
  const fixed = getPhysicalBounds(target);
  assert.equal(position.x, source.x);
  assert.equal(moved.bottom, fixed.top + 2);
});

test('rejects cross-axis, off-grid, out-of-bounds, and self edge alignments', () => {
  const source = block('source', 0, 0, 10, 5);
  const offGridTarget = block('target', -9, 10, 10, 5);
  assert.throws(
    () => alignInstanceToTarget(source, offGridTarget, 'left', 'top', 0, options),
    /same axis/,
  );
  assert.throws(
    () => alignInstanceToTarget(source, offGridTarget, 'left', 'left', 0, { ...options, gridSize: 2 }),
    /on-grid and inside/,
  );
  const gridSafe = alignInstanceToTarget(source, offGridTarget, 'left', 'left', 1, { ...options, gridSize: 2 });
  assert.equal(gridSafe.x, -8);
  assert.throws(
    () => alignInstanceToTarget({ ...source, y: 0.5 }, offGridTarget, 'left', 'left', 1, options),
    /perpendicular coordinate/,
  );

  const boundaryTarget = block('boundary', 40, 0, 10, 5);
  assert.throws(
    () => alignInstanceToTarget(source, boundaryTarget, 'left', 'right', 2, options),
    /on-grid and inside/,
  );
  assert.throws(
    () => alignInstanceToTarget(source, source, 'left', 'right', 0, options),
    /different instances/,
  );
});

test('distributes equal horizontal physical gaps and preserves input order', () => {
  const source = [
    block('middle', -1, 10, 6, 5),
    block('right', 30, 0, 5, 10, 'R90'),
    block('left', -30, 0, 10, 5),
  ];
  const result = distributeInstances(source, 'horizontal', { ...options, gridSize: 0.5 });
  assert.deepEqual(result.map(position => position.id), ['middle', 'right', 'left']);
  const sortedBounds = result
    .map(position => {
      const original = source.find(instance => instance.id === position.id);
      return getPhysicalBounds({ ...original, ...position });
    })
    .sort((a, b) => a.centerX - b.centerX);
  assert.equal(sortedBounds[1].left - sortedBounds[0].right, 17);
  assert.equal(sortedBounds[2].left - sortedBounds[1].right, 17);
  assert.equal(sortedBounds[0].left, -30);
  assert.equal(sortedBounds[2].right, 30);
});

test('distributes equal vertical gaps and two-item distribution is a no-op', () => {
  const source = [
    block('bottom', 0, -40, 8, 10),
    block('middle', 20, -5, 12, 4, 'MX'),
    block('top', -20, 30, 10, 5),
  ];
  const result = distributeInstances(source, 'vertical', { ...options, gridSize: 0.5 });
  const bounds = result.map((position, index) => getPhysicalBounds({ ...source[index], ...position }));
  assert.equal(bounds[1].bottom - bounds[0].top, 28);
  assert.equal(bounds[2].bottom - bounds[1].top, 28);

  const pair = source.slice(0, 2);
  assert.deepEqual(distributeInstances(pair, 'horizontal', options), pair.map(({ id, x, y }) => ({ id, x, y })));
});

test('rejects a block that cannot fit on a legal grid point', () => {
  const source = [block('too-wide', 0, 0, 101, 5), block('other', 0, 10)];
  assert.throws(() => alignInstances(source, 'left', options), /larger than the top cell/);
});
