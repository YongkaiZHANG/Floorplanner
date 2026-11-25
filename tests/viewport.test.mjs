import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRegionZoomViewport, panViewportByArrow } from '../src/utils/viewport.ts';

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

test('computeRegionZoomViewport frames and centers a dragged Cadence RMB zoom region cleanly', () => {
  // Region: x in [100..200] (100 um), y in [-50..0] (50 um), SCALE_FACTOR = 100, viewport = 1000x800
  const result = computeRegionZoomViewport(
    { minX: 200, maxX: 100, minY: 0, maxY: -50 }, // reversed drag corners
    1000,
    800,
    100,
    1e-5,
    200,
    0.94,
  );
  assert.ok(result);
  // Width limits scale: (1000 * 0.94) / (100 * 100) = 0.094
  assert.ok(Math.abs(result.scale - 0.094) < 1e-9);
  // Center of region is (150 um, -25 um) -> (15000, -2500) world px
  // Screen center (500, 400) with scaleY = -scale:
  const screenCenterX = result.position.x + 15000 * result.scale;
  const screenCenterY = result.position.y + (-2500) * (-result.scale);
  assert.ok(Math.abs(screenCenterX - 500) < 1e-6);
  assert.ok(Math.abs(screenCenterY - 400) < 1e-6);

  // Zero-area region returns null
  assert.equal(computeRegionZoomViewport({ minX: 10, maxX: 10, minY: 20, maxY: 20 }, 1000, 800, 100, 1e-5, 200), null);

  // Tiny region clamps to maxScale
  const clamped = computeRegionZoomViewport({ minX: 0, maxX: 0.001, minY: 0, maxY: 0.001 }, 1000, 800, 100, 1e-5, 200);
  assert.ok(clamped);
  assert.equal(clamped.scale, 200);
});
