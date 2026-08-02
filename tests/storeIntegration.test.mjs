import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import { rotateOrientationByQuarterTurns, useStore } from '../src/store/useStore.ts';

const emptyProject = {
  gridSize: 0.005,
  topWidth: 100,
  topHeight: 100,
  topLibName: 'testLib',
  topCellName: 'top',
  masterCells: {},
  instances: [],
  rulers: [],
};

test('store integrates unique naming, full undo/redo, multi-selection, and alignment', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'block', 10, 5, '#ffffff');
  const master = Object.values(useStore.getState().masterCells)[0];

  useStore.getState().placeInstance(master.id, -30, -10, 'R0');
  useStore.getState().placeInstance(master.id, 0, 5, 'R90');
  useStore.getState().placeInstance(master.id, 25, 15, 'MY');
  const ids = useStore.getState().instances.map(instance => instance.id);
  assert.deepEqual(useStore.getState().instances.map(instance => instance.name), ['I0', 'I1', 'I2']);

  useStore.getState().setSelectedInstance(ids[0]);
  useStore.getState().setSelectedInstance(ids[1], true);
  useStore.getState().setSelectedInstance(ids[2], true);
  useStore.getState().setSelectedInstance(ids[0]);
  assert.equal(useStore.getState().selectedInstanceIds.length, 3);
  assert.equal(useStore.getState().selectedInstanceId, ids[0]);
  const beforeAlign = structuredClone(useStore.getState().instances);
  useStore.getState().alignSelectedInstances('left');

  const aligned = useStore.getState().instances.map(instance => getPhysicalBounds({
    ...instance,
    width: master.width,
    height: master.height,
  }));
  assert.equal(new Set(aligned.map(bounds => bounds.left)).size, 1);

  useStore.getState().undo();
  assert.deepEqual(useStore.getState().instances, beforeAlign);
  useStore.getState().redo();
  assert.equal(new Set(useStore.getState().instances.map(instance => getPhysicalBounds({
    ...instance,
    width: master.width,
    height: master.height,
  }).left)).size, 1);

  useStore.getState().deleteInstance(ids[1]);
  useStore.getState().placeInstance(master.id, 0, 0, 'R0');
  assert.equal(useStore.getState().instances.at(-1).name, 'I1');
});

test('quarter-turn rotation preserves the displayed center and mirrored family', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'rectangular', 12, 5, '#2563eb');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, 10, 7, 'R0');
  const instance = useStore.getState().instances[0];
  const before = getPhysicalBounds({ ...instance, width: master.width, height: master.height });

  useStore.getState().updateInstanceOrientation(instance.id, rotateOrientationByQuarterTurns(instance.orientation, 1));
  const rotated = useStore.getState().instances[0];
  const after = getPhysicalBounds({ ...rotated, width: master.width, height: master.height });
  assert.equal(rotated.orientation, 'R90');
  assert.equal(after.centerX, before.centerX);
  assert.equal(after.centerY, before.centerY);

  assert.equal(rotateOrientationByQuarterTurns('MX', 1), 'MXR90');
  assert.equal(rotateOrientationByQuarterTurns('MXR90', 1), 'MY');
  assert.equal(rotateOrientationByQuarterTurns('MY', 1), 'MYR90');
  assert.equal(rotateOrientationByQuarterTurns('MYR90', 1), 'MX');
});
