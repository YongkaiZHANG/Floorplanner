import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicalBounds } from '../src/utils/alignment.ts';
import { getProjectSnapshot, PIXEL_ARRAY_ALIGNMENT_ID, rotateOrientationByQuarterTurns, useStore } from '../src/store/useStore.ts';

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

test('master IP appearance is editable and rejects unsupported values', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'styled', 12, 8, '#38bdf8', 0.25, 'dashed');
  const master = Object.values(useStore.getState().masterCells)[0];
  assert.equal(master.opacity, 0.25);
  assert.equal(master.outlineStyle, 'dashed');

  useStore.getState().updateMasterCell(master.id, 'testLib', 'styled', 12, 8, '#38bdf8', 0.8, 'none');
  assert.equal(useStore.getState().masterCells[master.id].opacity, 0.8);
  assert.equal(useStore.getState().masterCells[master.id].outlineStyle, 'none');

  assert.throws(
    () => useStore.getState().addMasterCell('testLib', 'invalidOpacity', 1, 1, '#fff', 1.1, 'solid'),
    /opacity/,
  );
  assert.throws(
    () => useStore.getState().addMasterCell('testLib', 'invalidOutline', 1, 1, '#fff', 0.5, 'double'),
    /outline style/,
  );
});

test('pixel array placement is grid-snapped, bounded, hideable, and undoable', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().startPixelArrayPlacement(60.002, 40.001);
  assert.equal(useStore.getState().appMode, 'pixel-array');
  assert.deepEqual(useStore.getState().pendingPixelArraySize, { width: 60, height: 40 });

  useStore.getState().placePixelArray(0, 0);
  assert.deepEqual(useStore.getState().pixelArray, {
    x: -30,
    y: -20,
    width: 60,
    height: 40,
    visible: true,
  });
  assert.equal(useStore.getState().appMode, 'select');

  useStore.getState().updatePixelArrayPosition(100, 100);
  assert.equal(useStore.getState().pixelArray.x, -10);
  assert.equal(useStore.getState().pixelArray.y, 10);
  useStore.getState().setPixelArrayVisible(false);
  assert.equal(useStore.getState().pixelArray.visible, false);
  useStore.getState().undo();
  assert.equal(useStore.getState().pixelArray.visible, true);

  assert.throws(() => useStore.getState().startPixelArrayPlacement(100, 20), /smaller than the top cell/);
});

test('pixel array aligns by its selected edge and may overlap an IP', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().addMasterCell('testLib', 'sensor', 20, 20, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -10, -10);
  const target = useStore.getState().instances[0];
  useStore.getState().startPixelArrayPlacement(60, 40);
  useStore.getState().placePixelArray(20, 0);

  useStore.getState().startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID);
  useStore.getState().setEdgeAlignmentEdge(PIXEL_ARRAY_ALIGNMENT_ID, 'left');
  useStore.getState().setEdgeAlignmentOffset('0');
  useStore.getState().completeEdgeAlignment(target.id, 'left');
  assert.equal(useStore.getState().pixelArray.x, -10);
  assert.equal(useStore.getState().pixelArray.y, -20);
  assert.equal(useStore.getState().instances[0].x, -10);

  useStore.getState().startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID);
  useStore.getState().setEdgeAlignmentEdge(PIXEL_ARRAY_ALIGNMENT_ID, 'right');
  useStore.getState().setEdgeAlignmentOffset('5');
  useStore.getState().completeEdgeAlignmentToBoundary('right');
  assert.equal(useStore.getState().pixelArray.x + useStore.getState().pixelArray.width, 45);
});

test('manual separated pads reuse one master and accept arbitrary perimeter positions', () => {
  useStore.getState().loadProject(emptyProject);
  const config = { libName: 'ioLib', cellName: 'PAD', width: 10, height: 8, color: '#f59e0b' };
  useStore.getState().prepareManualPadPlacement(config);
  const master = Object.values(useStore.getState().masterCells)[0];
  assert.equal(master.kind, 'pad');
  useStore.getState().placeInstance(master.id, -31.125, 45);
  useStore.getState().placeInstance(master.id, 17.335, 45);
  assert.equal(Object.keys(useStore.getState().masterCells).length, 1);
  assert.equal(useStore.getState().instances.length, 2);
  assert.ok(useStore.getState().instances.every(instance => instance.cellId === master.id));
  assert.equal(useStore.getState().instances[0].y, 42);
  assert.equal(useStore.getState().instances[1].y, 42);

  useStore.getState().prepareManualPadPlacement(config);
  assert.equal(Object.keys(useStore.getState().masterCells).length, 1);
});

test('Top Cell library is inherited by every IP and pad and updates atomically', () => {
  useStore.getState().loadProject({
    ...emptyProject,
    topLibName: 'topLib',
    masterCells: {
      imported: { id: 'imported', libName: 'legacyLib', cellName: 'IMPORTED', width: 10, height: 10, color: '#fff' },
    },
  });
  assert.equal(useStore.getState().masterCells.imported.libName, 'topLib');

  useStore.getState().addMasterCell('ignoredLib', 'NEW_IP', 10, 10, '#fff');
  useStore.getState().prepareManualPadPlacement({ libName: 'ignoredPadLib', cellName: 'PAD', width: 5, height: 5, color: '#fff' });
  assert.ok(Object.values(useStore.getState().masterCells).every(master => master.libName === 'topLib'));

  const beforeHistory = useStore.getState().history.past.length;
  useStore.getState().setTopNames('renamedLib', 'top');
  assert.equal(useStore.getState().topLibName, 'renamedLib');
  assert.ok(Object.values(useStore.getState().masterCells).every(master => master.libName === 'renamedLib'));
  assert.equal(useStore.getState().history.past.length, beforeHistory + 1);
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

test('directional spacing preserves the selected and reference edge equation', () => {
  useStore.getState().loadProject({ ...emptyProject, topWidth: 1000, topHeight: 500 });
  useStore.getState().addMasterCell('testLib', 'spacingBlock', 150, 20, '#fff');
  const master = Object.values(useStore.getState().masterCells)[0];
  useStore.getState().placeInstance(master.id, -300, 0);
  useStore.getState().placeInstance(master.id, 0, 0);
  const [source, target] = useStore.getState().instances;

  useStore.getState().startEdgeAlignment(source.id);
  // The clicked source edge remains authoritative. Because it starts left of
  // the reference, source.right + spacing = target.right.
  useStore.getState().setEdgeAlignmentEdge(source.id, 'right');
  useStore.getState().setEdgeAlignmentOffset('100');
  useStore.getState().completeEdgeAlignment(target.id, 'right');

  const [moved, fixed] = useStore.getState().instances;
  const movedBounds = getPhysicalBounds({ ...moved, width: master.width, height: master.height });
  const fixedBounds = getPhysicalBounds({ ...fixed, width: master.width, height: master.height });
  assert.equal(movedBounds.right + 100, fixedBounds.right);
});

test('vertical directional spacing works below-to-above and above-to-below', () => {
  const runCase = (sourceY, targetY, sourceEdge, targetEdge, expectedEquation) => {
    useStore.getState().loadProject(emptyProject);
    useStore.getState().addMasterCell('testLib', 'verticalShift', 10, 10, '#fff');
    const master = Object.values(useStore.getState().masterCells)[0];
    useStore.getState().placeInstance(master.id, 0, sourceY);
    useStore.getState().placeInstance(master.id, 0, targetY);
    const [source, target] = useStore.getState().instances;
    useStore.getState().startEdgeAlignment(source.id);
    useStore.getState().setEdgeAlignmentEdge(source.id, sourceEdge);
    useStore.getState().setEdgeAlignmentOffset('7');
    useStore.getState().completeEdgeAlignment(target.id, targetEdge);
    const [moved, fixed] = useStore.getState().instances;
    const movedBounds = getPhysicalBounds({ ...moved, width: 10, height: 10 });
    const fixedBounds = getPhysicalBounds({ ...fixed, width: 10, height: 10 });
    expectedEquation(movedBounds, fixedBounds);
  };

  runCase(-30, 20, 'top', 'bottom', (moved, fixed) => assert.equal(moved.top + 7, fixed.bottom));
  runCase(20, -30, 'bottom', 'top', (moved, fixed) => assert.equal(fixed.top + 7, moved.bottom));
});

test('multi-selection alignment shifts every selected pad by one rigid delta', () => {
  useStore.getState().loadProject({
    ...emptyProject,
    topWidth: 200,
    masterCells: {
      pad: { id: 'pad', libName: 'testLib', cellName: 'PAD', width: 10, height: 5, color: '#f59e0b', kind: 'pad' },
      ref: { id: 'ref', libName: 'testLib', cellName: 'REF', width: 10, height: 10, color: '#fff' },
    },
    instances: [
      { id: 'p1', cellId: 'pad', name: 'I0', x: -80, y: 45, orientation: 'R0' },
      { id: 'p2', cellId: 'pad', name: 'I1', x: -60, y: 45, orientation: 'R0' },
      { id: 'ref1', cellId: 'ref', name: 'I2', x: 30, y: 0, orientation: 'R0' },
    ],
  });
  useStore.getState().setSelectedInstance('p1');
  useStore.getState().setSelectedInstance('p2', true);
  const before = structuredClone(useStore.getState().instances);
  const historyLength = useStore.getState().history.past.length;

  useStore.getState().startEdgeAlignment('p1');
  assert.deepEqual(useStore.getState().edgeAlignmentSession?.sourceIds, ['p1', 'p2']);
  useStore.getState().setEdgeAlignmentEdge('p2', 'right');
  assert.equal(useStore.getState().edgeAlignmentSession?.sourceId, 'p2');
  useStore.getState().setEdgeAlignmentOffset('10');
  useStore.getState().completeEdgeAlignment('ref1', 'left');

  const [p1, p2, reference] = useStore.getState().instances;
  assert.equal(p1.x - before[0].x, p2.x - before[1].x);
  assert.equal(p2.x + 10 + 10, reference.x);
  assert.equal(p1.y, 45);
  assert.equal(p2.y, 45);
  assert.deepEqual(reference, before[2]);
  assert.equal(useStore.getState().history.past.length, historyLength + 1);
  useStore.getState().undo();
  assert.deepEqual(useStore.getState().instances, before);
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

test('pad rows create one reusable master and exact pitched edge instances as one undo step', () => {
  useStore.getState().loadProject(emptyProject);
  const historyLength = useStore.getState().history.past.length;

  useStore.getState().createPadRow({
    libName: 'padLib',
    cellName: 'PAD',
    width: 10,
    height: 5,
    color: '#f59e0b',
    count: 4,
    pitch: 15,
    side: 'top',
    offset: 0,
  });

  const state = useStore.getState();
  const master = Object.values(state.masterCells)[0];
  assert.equal(master.cellName, 'PAD');
  assert.equal(master.kind, 'pad');
  assert.equal(state.instances.length, 4);
  assert.equal(state.history.past.length, historyLength + 1);
  assert.equal(state.selectedInstanceIds.length, 0);

  const bounds = state.instances.map(instance => getPhysicalBounds({
    ...instance,
    width: master.width,
    height: master.height,
  }));
  assert.deepEqual(bounds.map(item => item.top), [50, 50, 50, 50]);
  assert.deepEqual(bounds.map(item => item.centerX), [-22.5, -7.5, 7.5, 22.5]);
  assert.deepEqual(bounds.slice(1).map((item, index) => item.left - bounds[index].right), [5, 5, 5]);

  useStore.getState().undo();
  assert.equal(Object.keys(useStore.getState().masterCells).length, 0);
  assert.equal(useStore.getState().instances.length, 0);
});

test('pad movement stays attached and can switch to the nearest top-cell edge', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().createPadRow({
    libName: 'padLib', cellName: 'EDGE_PAD', width: 10, height: 5, color: '#fff',
    count: 1, pitch: 10, side: 'top', offset: 0,
  });
  const pad = useStore.getState().instances[0];

  useStore.getState().updateInstancePosition(pad.id, -49, 0);
  let moved = useStore.getState().instances[0];
  assert.deepEqual([moved.x, moved.y], [-50, 0]);

  useStore.getState().updateInstancePosition(pad.id, 0, -49);
  moved = useStore.getState().instances[0];
  assert.deepEqual([moved.x, moved.y], [0, -50]);

  useStore.getState().updateInstanceOrientation(pad.id, 'R90');
  moved = useStore.getState().instances[0];
  assert.equal(moved.orientation, 'R90');
  const rotatedBounds = getPhysicalBounds({ ...moved, width: 10, height: 5 });
  assert.ok([rotatedBounds.left, rotatedBounds.right, rotatedBounds.bottom, rotatedBounds.top].some(edge => Math.abs(Math.abs(edge) - 50) < 1e-9));
  assert.equal(rotatedBounds.right - rotatedBounds.left, 5);
  assert.equal(rotatedBounds.top - rotatedBounds.bottom, 10);
});

test('rotated automatic rows use the transformed pad footprint', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().createPadRow({
    libName: 'padLib', cellName: 'ROT_PAD', width: 10, height: 5, color: '#fff',
    count: 3, pitch: 8, side: 'top', offset: 0, orientation: 'R90',
  });
  const state = useStore.getState();
  const master = Object.values(state.masterCells)[0];
  const bounds = state.instances.map(instance => getPhysicalBounds({ ...instance, width: master.width, height: master.height }));
  assert.ok(state.instances.every(instance => instance.orientation === 'R90'));
  assert.deepEqual(bounds.map(bound => bound.top), [50, 50, 50]);
  assert.deepEqual(bounds.map(bound => bound.centerX), [-8, 0, 8]);
  assert.deepEqual(bounds.slice(1).map((bound, index) => bound.left - bounds[index].right), [3, 3]);
});

test('manual placement clicks create pitched groups while preserving arbitrary gaps', () => {
  useStore.getState().loadProject(emptyProject);
  useStore.getState().prepareManualPadPlacement({
    libName: 'padLib', cellName: 'GROUP_PAD', width: 10, height: 5, color: '#fff',
    count: 3, pitch: 8, orientation: 'R90',
  });
  const before = useStore.getState().history.past.length;
  useStore.getState().placeManualPadGroup(-25, 45);
  useStore.getState().placeManualPadGroup(20, 45);
  const state = useStore.getState();
  const master = Object.values(state.masterCells)[0];
  const bounds = state.instances.map(instance => getPhysicalBounds({ ...instance, width: master.width, height: master.height }));
  assert.equal(state.instances.length, 6);
  assert.ok(state.instances.every(instance => instance.cellId === master.id && instance.orientation === 'R90'));
  assert.deepEqual(bounds.slice(0, 3).map(bound => bound.centerX), [-33, -25, -17]);
  assert.deepEqual(bounds.slice(3).map(bound => bound.centerX), [12, 20, 28]);
  assert.ok(bounds.every(bound => bound.top === 50));
  assert.equal(state.history.past.length, before + 2);
});

test('pad rows reject overlapping pitch and rows that cannot fit', () => {
  useStore.getState().loadProject(emptyProject);
  const base = {
    libName: 'padLib', cellName: 'PAD', width: 10, height: 5, color: '#fff',
    count: 4, pitch: 15, side: 'top', offset: 0,
  };
  assert.throws(
    () => useStore.getState().createPadRow({ ...base, pitch: 9 }),
    /avoid overlap/,
  );
  assert.throws(
    () => useStore.getState().createPadRow({ ...base, count: 8 }),
    /exceeds the 100 um top-cell edge/,
  );
  assert.equal(useStore.getState().instances.length, 0);
});
