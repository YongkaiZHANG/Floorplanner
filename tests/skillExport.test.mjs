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
  assert.match(code, /"top_block_PLACED"/);
  assert.match(code, /"top_block_PLACED_2"/);
  assert.doesNotMatch(code, /"top_I0_PLACED"/);
  orientations.forEach((orientation, index) => {
    assert.match(code, new RegExp(`dbCreateInst\\(cv master "I${index}_MASTER" [^\\n]+ "${orientation}" 1\\)`));
    assert.match(code, new RegExp(`dbCreateInst\\(cv master "I${index}" 0:0 "R0" 1\\)`));
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

test('placed IP wrappers receive centered adaptive name and size labels on text drawing', () => {
  const cells = {
    short: { id: 'short', libName: 'demoLib', cellName: 'IP', width: 100, height: 40, color: '#fff' },
    long: { id: 'long', libName: 'demoLib', cellName: 'VERY_LONG_ANALOG_PROCESSING_BLOCK', width: 100, height: 40, color: '#fff' },
  };
  const instances = [
    { id: 'short-inst', cellId: 'short', name: 'I3', x: -80, y: -20, orientation: 'R0' },
    { id: 'long-inst', cellId: 'long', name: 'I4', x: 50, y: -20, orientation: 'R0' },
  ];
  const code = generateSkillCode('demoLib', 'top', 300, 200, cells, instances, 0.005);
  const shortMatch = code.match(/dbCreateLabel\(cv list\("text" "drawing"\) -30:3\.6 "IP" "centerCenter" "R0" "roman" ([\d.]+)\)/);
  const longMatch = code.match(/dbCreateLabel\(cv list\("text" "drawing"\) 100:3\.6 "VERY_LONG_ANALOG_PROCESSING_BLOCK" "centerCenter" "R0" "roman" ([\d.]+)\)/);
  assert.ok(shortMatch);
  assert.ok(longMatch);
  assert.ok(Number(longMatch[1]) < Number(shortMatch[1]));
  assert.match(code, /-30:-3\.6 "100 x 40 um"/);
  assert.match(code, /100:-3\.6 "100 x 40 um"/);
  assert.match(code, /dbOpenCellViewByType\("demoLib" "top_IP_PLACED" "layout" "maskLayout" "w"\)/);
  assert.doesNotMatch(code, /top_I3_PLACED/);
});

test('rotated wrapper labels use the transformed physical IP center', () => {
  const cells = {
    adc: { id: 'adc', libName: 'demoLib', cellName: 'ADC', width: 20, height: 10, color: '#fff' },
  };
  const instances = [
    { id: 'adc-inst', cellId: 'adc', name: 'I3', x: 30, y: 40, orientation: 'R90' },
  ];
  const code = generateSkillCode('demoLib', 'top_asic', 200, 200, cells, instances, 0.005);
  assert.match(code, /top_asic_ADC_PLACED/);
  assert.doesNotMatch(code, /top_asic_I3_PLACED/);
  assert.match(code, /dbCreateLabel\(cv list\("text" "drawing"\) 25:51\.8 "ADC"/);
  assert.match(code, /dbCreateLabel\(cv list\("text" "drawing"\) 25:48\.2 "20 x 10 um"/);
});

test('pad masters keep one compact label instead of the two-line IP label', () => {
  const padCells = {
    pad: { id: 'pad', libName: 'demoLib', cellName: 'PAD', width: 10, height: 8, color: '#fff', kind: 'pad' },
  };
  const code = generateSkillCode('demoLib', 'top', 100, 100, padCells, [], 0.005);
  assert.equal((code.match(/dbCreateLabel\(cv list\("text" "drawing"\)/g) ?? []).length, 1);
  assert.doesNotMatch(code, /"10 x 8 um"/);
});

test('emits canonical grid coordinates and rejects off-grid geometry', () => {
  const instance = {
    id: 'large', cellId: 'master', name: 'I0', x: 3452, y: -0.005, orientation: 'R0',
  };
  const code = generateSkillCode('demoLib', 'top', 10000, 10000, masterCells, [instance], 0.005);
  assert.match(code, /dbCreateInst\(cv master "I0_MASTER" 3452:-0\.005 "R0" 1\)/);
  assert.match(code, /dbCreateInst\(cv master "I0" 0:0 "R0" 1\)/);

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
  assert.match(code, /dbOpenCellViewByType\("demoLib" "top_PIXEL_ARRAY" "layout" "maskLayout" "w"\)/);
  assert.match(code, /TOP-ORIGIN PIXEL ARRAY/);
  assert.match(code, /dbCreateInst\(cv master "PIXEL_ARRAY" 0:0 "R0" 1\)/);

  const hiddenCode = generateSkillCode('demoLib', 'top', 100, 80, {}, [], 0.005, { ...pixelArray, visible: false });
  assert.doesNotMatch(hiddenCode, /PIXEL ARRAY/);
});

test('multiple pads are collected into one origin-placed pad-bank cell', () => {
  const padCells = {
    pad: { id: 'pad', libName: 'demoLib', cellName: 'PAD', width: 10, height: 8, color: '#f59e0b', kind: 'pad' },
  };
  const padInstances = [
    { id: 'p0', cellId: 'pad', name: 'I0', x: -50, y: 42, orientation: 'R0' },
    { id: 'p1', cellId: 'pad', name: 'I1', x: 20, y: 40, orientation: 'R90' },
  ];
  const code = generateSkillCode('demoLib', 'top', 100, 100, padCells, padInstances, 0.005);
  assert.equal((code.match(/Creating master: %s\/%s/g) ?? []).length, 1);
  assert.equal((code.match(/dbCreateInst\(cv master/g) ?? []).length, 3);
  assert.match(code, /dbCreateInst\(cv master "I1" 20:40 "R90" 1\)/);
  assert.match(code, /dbOpenCellViewByType\("demoLib" "top_PAD_BANK" "layout" "maskLayout" "w"\)/);
  assert.match(code, /dbCreateInst\(cv master "PAD_BANK" 0:0 "R0" 1\)/);
});

test('top cell places every generated child at 0:0 while wrappers retain canvas transforms', () => {
  const cells = {
    ip: { ...masterCells.master, id: 'ip', cellName: 'IP' },
    pad: { id: 'pad', libName: 'demoLib', cellName: 'PAD', width: 8, height: 4, color: '#fff', kind: 'pad' },
  };
  const instances = [
    { id: 'ip0', cellId: 'ip', name: 'CORE', x: -12.5, y: 8.25, orientation: 'R270' },
    { id: 'p0', cellId: 'pad', name: 'P0', x: -50, y: 40, orientation: 'R0' },
  ];
  const pixelArray = { x: -20, y: -10, width: 40, height: 20, visible: true };
  const code = generateSkillCode('demoLib', 'top', 100, 100, cells, instances, 0.005, pixelArray);

  assert.match(code, /dbCreateInst\(cv master "CORE_MASTER" -12\.5:8\.25 "R270" 1\)/);
  assert.match(code, /dbCreateInst\(cv master "P0" -50:40 "R0" 1\)/);
  const topAssembly = code.slice(code.indexOf('STEP 3: Assemble'));
  const topPlacements = [...topAssembly.matchAll(/dbCreateInst\(cv master [^\n]+\)/g)].map(match => match[0]);
  assert.equal(topPlacements.length, 3);
  assert.ok(topPlacements.every(line => / 0:0 "R0" 1\)$/.test(line)), topPlacements.join('\n'));
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
