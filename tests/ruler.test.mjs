import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOrthogonalRulerEnd } from '../src/utils/ruler.ts';

test('measures X separation between vertical IP edges without projection overlap', () => {
  const end = resolveOrthogonalRulerEnd(
    { x: -30, y: 40, snapEdgeAxis: 'vertical' },
    { x: 15, y: -40, snapEdgeAxis: 'vertical' },
    true,
  );
  assert.deepEqual(end, { x: 15, y: 40, referenceX: 15, referenceY: -40 });
  assert.equal(Math.hypot(end.x - -30, end.y - 40), 45);
});

test('measures Y separation between horizontal IP edges without projection overlap', () => {
  const end = resolveOrthogonalRulerEnd(
    { x: -40, y: 25, snapEdgeAxis: 'horizontal' },
    { x: 40, y: -10, snapEdgeAxis: 'horizontal' },
    true,
  );
  assert.deepEqual(end, { x: -40, y: -10, referenceX: 40, referenceY: -10 });
  assert.equal(Math.hypot(end.x - -40, end.y - 25), 35);
});

test('keeps nearest-axis behavior for grid points and mixed edges', () => {
  assert.deepEqual(resolveOrthogonalRulerEnd({ x: 0, y: 0 }, { x: 12, y: 3 }, true), { x: 12, y: 0 });
  assert.deepEqual(resolveOrthogonalRulerEnd({ x: 0, y: 0 }, { x: 3, y: 12 }, true), { x: 0, y: 12 });
  assert.deepEqual(resolveOrthogonalRulerEnd({ x: 0, y: 0 }, { x: 3, y: 12 }, false), { x: 3, y: 12 });
});
