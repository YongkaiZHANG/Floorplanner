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

test('supports multi-library masters and checks every referenced library', () => {
  const cells = {
    ip: { id: 'ip', libName: 'analogLib', cellName: 'ADC', width: 20, height: 10, color: '#fff' },
  };
  const instances = [
    { id: 'ip0', cellId: 'ip', name: 'I_ADC', x: 10, y: -5, orientation: 'R0' },
  ];
  const code = generateSkillCode('demoLib', 'top', 100, 100, cells, instances, 0.005, null, {
    hierarchyMode: 'zero-origin-direct',
  });
  assert.match(code, /unless\(ddGetObj\("demoLib"\)/);
  assert.match(code, /unless\(ddGetObj\("analogLib"\)/);
  assert.match(code, /dbOpenCellViewByType\("analogLib" "ADC" "layout" "maskLayout" "w"\)/);
  assert.match(code, /dbCreatePRBoundary\(cv list\(10:-5 10:5 30:5 30:-5\)\)/);
  assert.doesNotMatch(code, /top_ADC_PLACED/);
  const topAssembly = code.slice(code.indexOf('STEP 3: Assemble'));
  assert.match(topAssembly, /dbOpenCellViewByType\("analogLib" "ADC" "layout" "maskLayout" "r"\)/);
  assert.match(topAssembly, /dbCreateInst\(cv master "I_ADC" 0:0 "R0" 1\)/);
});

test('zero-origin-direct mode emits multi-level multi-library hierarchy bottom-up with exact global positions', () => {
  const cells = {
    ana: { id: 'ana', libName: 'analog_lib', cellName: 'ANALOG_TOP', width: 400, height: 300, color: '#3b82f6' },
    sar: { id: 'sar', libName: 'adc_lib', cellName: 'SAR_ADC', width: 100, height: 80, color: '#22c55e' },
    bias: { id: 'bias', libName: 'std_lib', cellName: 'BIAS_UNIT', width: 40, height: 40, color: '#f59e0b' },
  };
  const topInstances = [
    { id: 'i_ana', cellId: 'ana', name: 'I_ANA', x: 50, y: -100, orientation: 'R0' },
  ];
  const cellViews = {
    ana: {
      instances: [
        // Inside ANALOG_TOP (400x300, centered [-200..200] x [-150..150]):
        // local SAR = (-120 + 200, -60 + 150) = (80, 90) -> chip = (50 + 80, -100 + 90) = (130, -10)
        { id: 'i_sar', cellId: 'sar', name: 'I_SAR', x: -120, y: -60, orientation: 'R0' },
        // BIAS_UNIT is reused twice -> stays local 0..40, placed at chip (350, -50) R0 and (350, 70) MY
        { id: 'i_b0', cellId: 'bias', name: 'I_BIAS0', x: 100, y: -100, orientation: 'R0' },
        { id: 'i_b1', cellId: 'bias', name: 'I_BIAS1', x: 100, y: 20, orientation: 'MY' },
      ],
      rulers: [],
    },
  };

  const code = generateSkillCode('chip_lib', 'top_asic', 1000, 800, cells, topInstances, 0.005, null, {
    hierarchyMode: 'zero-origin-direct',
    cellViews,
  });

  // Strict bottom-up topological order: leaves before ANALOG_TOP before top_asic
  const idxBias = code.indexOf('Creating master: %s/%s\\n" "std_lib" "BIAS_UNIT"');
  const idxSar = code.indexOf('Creating master: %s/%s\\n" "adc_lib" "SAR_ADC"');
  const idxAna = code.indexOf('Creating master: %s/%s\\n" "analog_lib" "ANALOG_TOP"');
  const idxTop = code.indexOf('Assembling top cell: %s/%s\\n" "chip_lib" "top_asic"');
  assert.ok(idxBias > 0 && idxSar > 0 && idxAna > 0 && idxTop > 0);
  assert.ok(idxBias < idxAna && idxSar < idxAna && idxAna < idxTop);

  // BIAS_UNIT (reused 2x) keeps local 0:0..40:40 prBoundary
  assert.match(code, /dbCreatePRBoundary\(cv list\(0:0 0:40 40:40 40:0\)\)/);
  // SAR_ADC (unique 1x) gets its exact chip-level prBoundary [130..230] x [-10..70]
  assert.match(code, /dbCreatePRBoundary\(cv list\(130:-10 130:70 230:70 230:-10\)\)/);
  // ANALOG_TOP (unique 1x) gets [50..450] x [-100..200], places SAR_ADC at 0:0 R0, and BIAS at global coords
  assert.match(code, /dbCreatePRBoundary\(cv list\(50:-100 50:200 450:200 450:-100\)\)/);
  const anaSection = code.slice(idxAna, idxTop);
  assert.match(anaSection, /dbCreateInst\(cv master "I_SAR" 0:0 "R0" 1\)/);
  assert.match(anaSection, /dbCreateInst\(cv master "I_BIAS0" 350:-50 "R0" 1\)/);
  assert.match(anaSection, /dbCreateInst\(cv master "I_BIAS1" 350:70 "MY" 1\)/);
  // top_asic places ANALOG_TOP directly at 0:0 R0 with zero wrappers
  const topSection = code.slice(idxTop);
  assert.match(topSection, /dbCreateInst\(cv master "I_ANA" 0:0 "R0" 1\)/);
  assert.doesNotMatch(code, /_PLACED/);
});

test('zero-origin-direct mode rejects cyclic cellViews', () => {
  const cells = {
    a: { id: 'a', libName: 'libA', cellName: 'A', width: 20, height: 20, color: '#fff' },
    b: { id: 'b', libName: 'libB', cellName: 'B', width: 10, height: 10, color: '#fff' },
  };
  const cellViews = {
    a: { instances: [{ id: '1', cellId: 'b', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
    b: { instances: [{ id: '2', cellId: 'a', name: 'I0', x: 0, y: 0, orientation: 'R0' }], rulers: [] },
  };
  assert.throws(
    () => generateSkillCode('chip', 'top', 100, 100, cells, [], 0.005, null, {
      hierarchyMode: 'zero-origin-direct',
      cellViews,
    }),
    /Circular hierarchy/,
  );
});

test('wrapper size labels preserve exact drawn master dimensions regardless of grid step', () => {
  const cells = {
    ip: { id: 'ip', libName: 'demoLib', cellName: 'ANALOG', width: 12.3, height: 6.7, color: '#fff' },
  };
  const instances = [
    { id: 'ip0', cellId: 'ip', name: 'I0', x: 0, y: 0, orientation: 'R0' },
  ];
  const code = generateSkillCode('demoLib', 'top', 100, 100, cells, instances, 1);
  assert.match(code, /"12\.3 x 6\.7 um"/);
});

test('supports non-destructive master preservation and direct top-cell IP placement options', () => {
  const cells = {
    ip: { id: 'ip', libName: 'demoLib', cellName: 'ADC', width: 20, height: 10, color: '#fff' },
  };
  const instances = [
    { id: 'ip0', cellId: 'ip', name: 'I_ADC', x: 10, y: -5, orientation: 'R90' },
  ];
  const code = generateSkillCode('demoLib', 'top', 100, 100, cells, instances, 0.005, null, {
    preserveExistingMasters: true,
    useIpWrappers: false,
  });

  assert.match(code, /if\(ddGetObj\("demoLib" "ADC" "layout"\) then/);
  assert.match(code, /Preserving existing master/);
  assert.doesNotMatch(code, /top_ADC_PLACED/);
  assert.match(code, /dbCreateInst\(cv master "I_ADC" 10:-5 "R90" 1\)/);
});
