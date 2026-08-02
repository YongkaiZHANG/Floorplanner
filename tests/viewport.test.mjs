import assert from 'node:assert/strict';
import test from 'node:test';
import { panViewportByArrow } from '../src/utils/viewport.ts';

test('arrow keys pan the viewport toward all four view directions', () => {
  const origin = { x: 400, y: 300 };
  assert.deepEqual(panViewportByArrow(origin, 'arrowleft', 48), { x: 448, y: 300 });
  assert.deepEqual(panViewportByArrow(origin, 'arrowright', 48), { x: 352, y: 300 });
  assert.deepEqual(panViewportByArrow(origin, 'arrowup', 48), { x: 400, y: 348 });
  assert.deepEqual(panViewportByArrow(origin, 'arrowdown', 48), { x: 400, y: 252 });
});

test('pan distance is screen-based and supports the larger Shift step', () => {
  assert.deepEqual(panViewportByArrow({ x: 0, y: 0 }, 'arrowright', 160), { x: -160, y: 0 });
});
