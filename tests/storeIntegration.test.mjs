import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import { getProjectSnapshot, rotateOrientationByQuarterTurns, useStore } from '../src/store/useStore.ts';

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

test('edge alignment moves only the source and is one undoable store action', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'edgeBlock', 10, 5, '#ffffff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -30, 0, 'R90');
  useStore.getState().placeInstance(master.id, 20, 10, 'MY');
  const [sourceBefore, targetBefore] = structuredClone(useStore.getState().instances);
  const selectionBefore = {
    selectedInstanceId: useStore.getState().selectedInstanceId,
    selectedInstanceIds: [...useStore.getState().selectedInstanceIds],
  };
  const historyLength = useStore.getState().history.past.length;

  useStore.getState().alignInstanceEdges(sourceBefore.id, targetBefore.id, 'right', 'left', -5);
  const [sourceAfter, targetAfter] = useStore.getState().instances;
  const sourceBounds = getPhysicalBounds({ ...sourceAfter, width: master.width, height: master.height });
  const targetBounds = getPhysicalBounds({ ...targetAfter, width: master.width, height: master.height });
  assert.equal(sourceBounds.right, targetBounds.left - 5);
  assert.deepEqual(targetAfter, targetBefore);
  assert.deepEqual({
    selectedInstanceId: useStore.getState().selectedInstanceId,
    selectedInstanceIds: useStore.getState().selectedInstanceIds,
  }, selectionBefore);
  assert.equal(useStore.getState().history.past.length, historyLength + 1);

  useStore.getState().undo();
  assert.deepEqual(useStore.getState().instances, [sourceBefore, targetBefore]);
});

test('interactive edge-alignment session is transient and applies as one history entry', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'sessionBlock', 10, 5, '#ffffff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -30, 0, 'R0');
  useStore.getState().placeInstance(master.id, 20, 0, 'R0');
  const [source, target] = structuredClone(useStore.getState().instances);
  const historyLength = useStore.getState().history.past.length;

  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentEdge(target.id, 'left');
  useStore.getState().setEdgeAlignmentOffset('5');
  assert.equal(useStore.getState().history.past.length, historyLength);
  assert.equal(Object.hasOwn(getProjectSnapshot(useStore.getState()), 'edgeAlignmentSession'), false);

  useStore.getState().applyEdgeAlignment();
  assert.equal(useStore.getState().edgeAlignmentSession, null);
  assert.equal(useStore.getState().history.past.length, historyLength + 1);
  const [moved, fixed] = useStore.getState().instances;
  assert.equal(
    getPhysicalBounds({ ...moved, width: master.width, height: master.height }).right,
    getPhysicalBounds({ ...fixed, width: master.width, height: master.height }).left - 5,
  );
  assert.deepEqual(fixed, target);

  useStore.getState().undo();
  assert.deepEqual(useStore.getState().instances, [source, target]);
  useStore.getState().redo();
  assert.deepEqual(useStore.getState().instances, [moved, fixed]);
});

test('invalid interactive edge alignment keeps its session and does not add history', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'invalidSessionBlock', 10, 5, '#ffffff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -20, 0);
  useStore.getState().placeInstance(master.id, 20, 0);
  const [source, target] = useStore.getState().instances;
  const historyLength = useStore.getState().history.past.length;

  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentEdge(target.id, 'top');
  assert.throws(() => useStore.getState().applyEdgeAlignment(), /same axis/);
  assert.ok(useStore.getState().edgeAlignmentSession);
  assert.equal(useStore.getState().history.past.length, historyLength);

  useStore.getState().deleteInstance(target.id);
  assert.equal(useStore.getState().edgeAlignmentSession, null);
});

test('changing or loading a grid normalizes every instance to an exact multiple', () => {
  useStore.getState().loadProject({
    ...emptyProject,
    masterCells: {
      master: { id: 'master', libName: 'testLib', cellName: 'gridBlock', width: 2, height: 2, color: '#fff' },
    },
    instances: [
      { id: 'instance', cellId: 'master', name: 'I0', x: 1.234, y: -2.347, orientation: 'R0' },
    ],
  });
  assert.deepEqual(
    [useStore.getState().instances[0].x, useStore.getState().instances[0].y],
    [1.235, -2.345],
  );

  useStore.getState().setGridSize(0.01);
  assert.deepEqual(
    [useStore.getState().instances[0].x, useStore.getState().instances[0].y],
    [1.24, -2.35],
  );
});

test('target edge click can complete interactive alignment in one atomic action', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'quickAlign', 10, 5, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -20, 0);
  useStore.getState().placeInstance(master.id, 20, 0);
  const [source, target] = useStore.getState().instances;
  const historyLength = useStore.getState().history.past.length;

  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignment(target.id, 'left');

  assert.equal(useStore.getState().edgeAlignmentSession, null);
  assert.equal(useStore.getState().history.past.length, historyLength + 1);
  const [moved, fixed] = useStore.getState().instances;
  assert.equal(
    getPhysicalBounds({ ...moved, width: master.width, height: master.height }).right,
    getPhysicalBounds({ ...fixed, width: master.width, height: master.height }).left,
  );
});

test('top-cell edges and orthogonal rulers can complete edge alignment', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'referenceAlign', 10, 5, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, 0, 0);
  const source = useStore.getState().instances[0];

  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'left');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignmentToBoundary('left');
  let moved = useStore.getState().instances[0];
  assert.equal(getPhysicalBounds({ ...moved, width: master.width, height: master.height }).left, -50);

  useStore.getState().addRuler(15, -20, 15, 20);
  const ruler = useStore.getState().rulers[0];
  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('5');
  useStore.getState().completeEdgeAlignmentToRuler(ruler.id);
  moved = useStore.getState().instances[0];
  assert.equal(getPhysicalBounds({ ...moved, width: master.width, height: master.height }).right, 10);

  useStore.getState().addRuler(-20, -20, 20, 20);
  const diagonal = useStore.getState().rulers[1];
  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'left');
  assert.throws(
    () => useStore.getState().completeEdgeAlignmentToRuler(diagonal.id),
    /orthogonal ruler/,
  );
});

test('positive spacing on a target right edge creates an outside gap without overlap', () => {
  useStore.getState().loadProject({ ...emptyProject, topWidth: 1000, topHeight: 500 });
  useStore.getState().addMasterCell('testLib', 'spacingBlock', 150, 20, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -300, 0);
  useStore.getState().placeInstance(master.id, 0, 0);
  const [source, target] = useStore.getState().instances;

  useStore.getState().startEdgeAlignment(source.id);
  // The first edge chooses the horizontal axis. A wide source must still be
  // placed wholly outside the target side rather than overlapping it.
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('100');
  useStore.getState().completeEdgeAlignment(target.id, 'right');

  const [moved, fixed] = useStore.getState().instances;
  const movedBounds = getPhysicalBounds({ ...moved, width: master.width, height: master.height });
  const fixedBounds = getPhysicalBounds({ ...fixed, width: master.width, height: master.height });
  assert.equal(movedBounds.left, fixedBounds.right + 100);
  assert.ok(movedBounds.left > fixedBounds.right);
});

test('interactive spacing rejects negative values instead of reversing across the target', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'negativeSpacing', 10, 10, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -20, 0);
  useStore.getState().placeInstance(master.id, 20, 0);
  const [source, target] = useStore.getState().instances;
  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('-1');
  assert.throws(
    () => useStore.getState().completeEdgeAlignment(target.id, 'left'),
    /greater than or equal to zero/,
  );
});

test('a valid alignment spacing is reused by the next alignment session', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'rememberSpacing', 10, 10, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, 0, 0);
  const source = useStore.getState().instances[0];

  useStore.getState().startEdgeAlignment(source.id);
  useStore.getState().setEdgeAlignmentOffset('12.5');
  useStore.getState().cancelEdgeAlignment();
  useStore.getState().startEdgeAlignment(source.id);
  assert.equal(useStore.getState().edgeAlignmentSession?.offset, '12.5');

  useStore.getState().setEdgeAlignmentOffset('-4');
  useStore.getState().cancelEdgeAlignment();
  useStore.getState().startEdgeAlignment(source.id);
  assert.equal(useStore.getState().edgeAlignmentSession?.offset, '12.5');
});
