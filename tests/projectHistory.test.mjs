import assert from 'node:assert/strict';
import test from 'node:test';
import { recordHistory, redoHistory, undoHistory } from '../src/store/projectHistory.ts';

const snapshot = (x = 0) => ({
  gridSize: 0.005,
  topWidth: 100,
  topHeight: 100,
  topLibName: 'lib',
  topCellName: 'top',
  masterCells: {},
  instances: x === 0 ? [] : [{ id: 'i', cellId: 'm', name: 'I0', x, y: 0, orientation: 'R0' }],
  rulers: [],
});

test('undo and redo retain meaningful action labels', () => {
  const before = snapshot();
  const after = snapshot(5);
  const history = recordHistory({ past: [], future: [] }, 'Move I0', before, after);
  const undone = undoHistory(history, after);
  assert.ok(undone);
  assert.deepEqual(undone.snapshot, before);
  assert.equal(undone.label, 'Move I0');
  const redone = redoHistory(undone.history, undone.snapshot);
  assert.ok(redone);
  assert.deepEqual(redone.snapshot, after);
});

test('no-op edits do not create history and real edits clear redo', () => {
  const current = snapshot();
  const existing = { past: [], future: [{ label: 'Old edit', snapshot: snapshot(2) }] };
  assert.equal(recordHistory(existing, 'No-op', current, current), existing);
  const changed = recordHistory(existing, 'Resize top', current, { ...current, topWidth: 200 });
  assert.equal(changed.past.length, 1);
  assert.equal(changed.future.length, 0);
});
