import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGridValue, getGridPrecision, isOnGrid, snapToGrid } from '../src/utils/grid.ts';

test('uses the active grid precision and removes floating-point noise', () => {
  assert.equal(getGridPrecision(0.005), 3);
  assert.equal(getGridPrecision(0.0005), 4);
  assert.equal(formatGridValue(3452.0000000004, 0.005), '3452');
  assert.equal(formatGridValue(-0.004999999999, 0.005), '-0.005');
  assert.equal(snapToGrid(1.234, 0.005), 1.235);
});

test('recognizes exact grid multiples at large and small coordinates', () => {
  assert.equal(isOnGrid(3452, 0.005), true);
  assert.equal(isOnGrid(3452.005, 0.005), true);
  assert.equal(isOnGrid(3452.003, 0.005), false);
});
