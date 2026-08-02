import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSkillCode } from '../src/utils/skillExport.ts';

const masterCells = {
  master: {
    id: 'master',
    libName: 'demoLib',
    cellName: 'block',
    width: 12.345,
    height: 6.789,
    color: '#ffffff',
  },
};

test('emits exact canvas dimensions and all Cadence orientations', () => {
  const orientations = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];
  const instances = orientations.map((orientation, index) => ({
    id: String(index),
    cellId: 'master',
    name: `I${index}`,
    x: index * 0.005,
    y: -index * 0.005,
    orientation,
  }));

  const code = generateSkillCode('demoLib', 'top', 101.25, 80.75, masterCells, instances, 0.005);

  assert.match(code, /dbCreatePRBoundary\(cv list\(0:0 0:6\.789 12\.345:6\.789 12\.345:0\)\)/);
  assert.match(code, /dbCreatePRBoundary\(cv list\(-50\.625:-40\.375 -50\.625:40\.375 50\.625:40\.375 50\.625:-40\.375\)\)/);
  assert.match(code, /dbCreateLabel\(cv list\("text" "drawing"\)/);
  assert.doesNotMatch(code, /list\("instance" "drawing"\)/);
  orientations.forEach((orientation, index) => {
    assert.match(code, new RegExp(`dbCreateInst\\(cv master "I${index}" [^\\n]+ "${orientation}" 1\\)`));
  });
});

test('rejects duplicate instance names before generating unsafe SKILL', () => {
  const instances = [0, 1].map(index => ({
    id: String(index),
    cellId: 'master',
    name: 'I0',
    x: index,
    y: 0,
    orientation: 'R0',
  }));

  assert.throws(
    () => generateSkillCode('demoLib', 'top', 100, 100, masterCells, instances, 0.005),
    /Duplicate instance name/
  );
});

test('escapes names before inserting them into SKILL strings', () => {
  const cells = {
    master: { ...masterCells.master, cellName: 'block"quoted' },
  };
  const code = generateSkillCode('demoLib', 'top', 100, 100, cells, [], 0.005);

  assert.match(code, /"block\\"quoted"/);
});

test('emits canonical grid coordinates and rejects off-grid geometry', () => {
  const instance = {
    id: 'large', cellId: 'master', name: 'I0', x: 3452, y: -0.005, orientation: 'R0',
  };
  const code = generateSkillCode('demoLib', 'top', 10000, 10000, masterCells, [instance], 0.005);
  assert.match(code, /dbCreateInst\(cv master "I0" 3452:-0\.005 "R0" 1\)/);

  assert.throws(
    () => generateSkillCode('demoLib', 'top', 10000, 10000, masterCells, [{ ...instance, y: 0.003 }], 0.005),
    /off the 0\.005 um placement grid/,
  );
});

test('emits a visible pixel array on the requested drawing layers', () => {
  const pixelArray = { x: -30, y: -20, width: 60, height: 40, visible: true };
  const code = generateSkillCode('demoLib', 'top', 100, 80, {}, [], 0.005, pixelArray);
  assert.match(code, /dbCreateRect\(cv list\("prBoundary" "drawing"\) list\(-30:-20 30:20\)\)/);
  assert.match(code, /dbCreateLabel\(cv list\("text" "drawing"\) 0:0 "PIXEL ARRAY 60x40um"/);

  const hiddenCode = generateSkillCode('demoLib', 'top', 100, 80, {}, [], 0.005, { ...pixelArray, visible: false });
  assert.doesNotMatch(hiddenCode, /PIXEL ARRAY/);
});

test('multiple pad instances reference one generated pad cellview', () => {
  const padCells = {
    pad: { id: 'pad', libName: 'demoLib', cellName: 'PAD', width: 10, height: 8, color: '#f59e0b', kind: 'pad' },
  };
  const padInstances = [
    { id: 'p0', cellId: 'pad', name: 'I0', x: -50, y: 42, orientation: 'R0' },
    { id: 'p1', cellId: 'pad', name: 'I1', x: 20, y: 40, orientation: 'R90' },
  ];
  const code = generateSkillCode('demoLib', 'top', 100, 100, padCells, padInstances, 0.005);
  assert.equal((code.match(/Creating master: %s\/%s/g) ?? []).length, 1);
  assert.equal((code.match(/dbCreateInst\(cv master/g) ?? []).length, 2);
  assert.match(code, /dbCreateInst\(cv master "I1" 20:40 "R90" 1\)/);
});

test('rejects a master outside the Top Cell library', () => {
  const cells = {
    ip: { id: 'ip', libName: 'otherLib', cellName: 'IP', width: 10, height: 10, color: '#fff' },
  };
  assert.throws(
    () => generateSkillCode('demoLib', 'top', 100, 100, cells, [], 0.005),
    /must use the Top Cell library demoLib/,
  );
});
