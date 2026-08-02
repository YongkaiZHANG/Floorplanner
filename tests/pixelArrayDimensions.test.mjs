import test from 'node:test';
import assert from 'node:assert/strict';
import { getIpPixelArrayEdgeMeasurements } from '../src/utils/pixelArrayDimensions.ts';

const array = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

test('measures penetration depth for every partially overlapped IP edge', () => {
  const fromLeft = getIpPixelArrayEdgeMeasurements({ minX: -20, maxX: 15, minY: 20, maxY: 40 }, array)
    .filter(item => item.kind === 'overlap');
  assert.deepEqual(fromLeft, [{
    direction: 'right', distance: 15, arrayCoordinate: 0,
    projectionStart: 20, projectionEnd: 40, kind: 'overlap',
  }]);

  const fromTop = getIpPixelArrayEdgeMeasurements({ minX: 20, maxX: 40, minY: 85, maxY: 120 }, array)
    .filter(item => item.kind === 'overlap');
  assert.deepEqual(fromTop, [{
    direction: 'bottom', distance: 15, arrayCoordinate: 100,
    projectionStart: 20, projectionEnd: 40, kind: 'overlap',
  }]);
});

test('keeps outside gaps and all four inside clearances distinct', () => {
  const outside = getIpPixelArrayEdgeMeasurements({ minX: -30, maxX: -10, minY: 20, maxY: 40 }, array);
  assert.deepEqual(outside, [{
    direction: 'right', distance: 10, arrayCoordinate: 0,
    projectionStart: 20, projectionEnd: 40, kind: 'gap',
  }]);

  const inside = getIpPixelArrayEdgeMeasurements({ minX: 20, maxX: 40, minY: 30, maxY: 50 }, array);
  assert.deepEqual(inside.map(item => [item.direction, item.distance, item.kind]), [
    ['right', 60, 'inside'], ['left', 20, 'inside'],
    ['top', 50, 'inside'], ['bottom', 30, 'inside'],
  ]);
});

test('does not emit a zero dimension when an IP only touches the array', () => {
  assert.deepEqual(
    getIpPixelArrayEdgeMeasurements({ minX: -20, maxX: 0, minY: 20, maxY: 40 }, array),
    [],
  );
});
