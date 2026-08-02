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
