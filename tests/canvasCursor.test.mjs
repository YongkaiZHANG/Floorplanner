import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeDisplayGridStep,
  resolveActiveSnapStep,
  resolveCanvasCursor,
  snapPointToGrid,
} from '../src/utils/canvasCursor.ts';
import { isOnGrid } from '../src/utils/grid.ts';

test('resolveCanvasCursor uses normal arrow in select mode and hand only while panning or holding Space', () => {
  assert.equal(
    resolveCanvasCursor({ appMode: 'select', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'default',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'select', edgeAlignmentActive: false, isPanning: false, isSpaceDown: true }),
    'grab',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'select', edgeAlignmentActive: false, isPanning: true, isSpaceDown: false }),
    'grabbing',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'place', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'measure', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'pixel-array', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'rect', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'stretch', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  assert.equal(
    resolveCanvasCursor({ appMode: 'select', edgeAlignmentActive: true, isPanning: false, isSpaceDown: false }),
    'crosshair',
  );
  // Active pan takes precedence over crosshair modes
  assert.equal(
    resolveCanvasCursor({ appMode: 'measure', edgeAlignmentActive: false, isPanning: true, isSpaceDown: true }),
    'grabbing',
  );
  // Active Cadence RMB region zoom uses zoom-in cursor
  assert.equal(
    resolveCanvasCursor({ appMode: 'select', edgeAlignmentActive: false, isPanning: false, isSpaceDown: false, isRegionZooming: true }),
    'zoom-in',
  );
});

test('computeDisplayGridStep stays fixed to the defined gridSize across all zoom levels', () => {
  for (const gridSize of [0.005, 0.01, 0.25, 3, 7.5, 25, 50]) {
    for (const stageScale of [0.02, 0.2, 1, 5, 40]) {
      const metrics = computeDisplayGridStep(gridSize, stageScale, 10, 3000, 2000);
      assert.equal(metrics.multiplier, 1);
      assert.equal(metrics.minorStep, gridSize);
      assert.equal(isOnGrid(metrics.minorStep, gridSize), true, `minorStep ${metrics.minorStep} off grid ${gridSize}`);
      assert.equal(isOnGrid(metrics.majorStep, gridSize), true, `majorStep ${metrics.majorStep} off grid ${gridSize}`);
      assert.ok(Math.abs(metrics.majorStep - gridSize * 5) <= 1e-9);
    }
  }

  // Zoomed out on fine 0.005 um grid: spacing stays 0.005 um while sub-pixel lines hide cleanly
  const zoomedOut = computeDisplayGridStep(0.005, 0.04, 10, 3000, 2000);
  assert.equal(zoomedOut.minorStep, 0.005);
  assert.equal(zoomedOut.majorStep, 0.025);
  assert.equal(zoomedOut.showMinorLines, false);
  assert.equal(zoomedOut.showMajorLines, false);
  assert.equal(zoomedOut.showFineDots, false);

  // Zoomed in closely on gridSize = 1 with SCALE_FACTOR = 10, stageScale = 4 -> 40 px per grid step
  const zoomedIn = computeDisplayGridStep(1, 4, 10, 100, 100);
  assert.equal(zoomedIn.multiplier, 1);
  assert.equal(zoomedIn.minorStep, 1);
  assert.equal(zoomedIn.majorStep, 5);
  assert.equal(zoomedIn.showMinorLines, true);
  assert.equal(zoomedIn.showMajorLines, true);
  assert.equal(zoomedIn.showFineDots, true);
});

test('snapPointToGrid locks points strictly onto the active grid and normalizes -0', () => {
  assert.deepEqual(snapPointToGrid(-0.001, 12.347, 0.005), { x: 0, y: 12.345 });
  assert.equal(Object.is(snapPointToGrid(-0.001, 0, 0.005).x, -0), false);
  assert.deepEqual(snapPointToGrid(37, -64, 25), { x: 25, y: -75 });
});

test('resolveActiveSnapStep always stays equal to the defined gridSize regardless of zoom or Vis toggle', () => {
  assert.equal(resolveActiveSnapStep(0.005, 0.005, false), 0.005);
  assert.equal(resolveActiveSnapStep(0.005, 100, true), 0.005);
  assert.equal(resolveActiveSnapStep(5, 50, true), 5);
  assert.equal(isOnGrid(resolveActiveSnapStep(0.005, 100, true), 0.005), true);
});
