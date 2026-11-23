import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFloorplanMetrics,
  findOverlapViolations,
  generateFloorplanCsv,
} from '../src/utils/floorplanMetrics.ts';

const sampleProject = {
  gridSize: 0.005,
  topWidth: 1000,
  topHeight: 500,
  topLibName: 'chip_lib',
  topCellName: 'top_sensor',
  padInset: 20,
  masterCells: {
    ipA: { id: 'ipA', libName: 'chip_lib', cellName: 'ADC', width: 100, height: 50, color: '#2563eb' },
    ipB: { id: 'ipB', libName: 'chip_lib', cellName: 'ISP', width: 100, height: 50, color: '#16a34a' },
    pad: { id: 'pad', libName: 'chip_lib', cellName: 'PAD', width: 20, height: 10, color: '#f59e0b', kind: 'pad' },
  },
  instances: [
    // Two touching IPs (x: 0..100 and 100..200) should NOT overlap
    { id: 'i0', cellId: 'ipA', name: 'I_ADC', x: 0, y: 0, orientation: 'R0' },
    { id: 'i1', cellId: 'ipB', name: 'I_ISP', x: 100, y: 0, orientation: 'R0' },
    // Top pad attached at y = 250 - 20 - 10 = 220 (top = 230)
    { id: 'p0', cellId: 'pad', name: 'PAD_0', x: -10, y: 220, orientation: 'R0' },
    // Left pad attached at x = -500 + 20 = -480 (R90 swaps width/height -> x=-470..-480 => left=-480)
    { id: 'p1', cellId: 'pad', name: 'PAD_1', x: -470, y: 0, orientation: 'R90' },
  ],
  rulers: [],
  pixelArray: { x: -200, y: -100, width: 400, height: 200, visible: true },
};

test('detects IP-IP, pad-pad, and IP-pad overlaps while ignoring touching edges and pixel array', () => {
  assert.equal(findOverlapViolations(sampleProject).length, 0);

  const overlapping = structuredClone(sampleProject);
  overlapping.instances[1].x = 80; // overlaps I_ADC by 20 x 50 = 1000 um^2
  overlapping.instances.push({ id: 'p2', cellId: 'pad', name: 'PAD_2', x: 0, y: 220, orientation: 'R0' }); // overlaps PAD_0 by 10 x 10

  const violations = findOverlapViolations(overlapping);
  assert.equal(violations.length, 2);
  assert.equal(violations[0].kind, 'ip-ip');
  assert.equal(violations[0].width, 20);
  assert.equal(violations[0].height, 50);
  assert.equal(violations[0].areaUm2, 1000);
  assert.equal(violations[1].kind, 'pad-pad');
  assert.equal(violations[1].width, 10);
  assert.equal(violations[1].height, 10);
});

test('computes die area, utilization, whitespace, pixel array, and pad side counts', () => {
  const metrics = computeFloorplanMetrics(sampleProject);
  assert.equal(metrics.dieAreaUm2, 500000);
  assert.equal(metrics.dieAreaMm2, 0.5);
  assert.equal(metrics.aspectRatio, 2);
  assert.equal(metrics.ipCount, 2);
  assert.equal(metrics.padCount, 2);
  assert.equal(metrics.ipAreaUm2, 10000);
  assert.equal(metrics.padAreaUm2, 400);
  assert.equal(metrics.ipUtilizationPct, 2);
  assert.equal(metrics.whitespaceUm2, 489600);
  assert.equal(metrics.pixelArrayAreaUm2, 80000);
  assert.equal(metrics.pixelArrayPct, 16);
  assert.deepEqual(metrics.padsBySide, { top: 1, right: 0, bottom: 0, left: 1 });
  assert.equal(metrics.overlaps.length, 0);
});

test('generates RFC-4180 CSV with transformed physical bounds and pad sides', () => {
  const csvProject = structuredClone(sampleProject);
  csvProject.instances[0].name = 'I_ADC, "main"';
  const csv = generateFloorplanCsv(csvProject);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 5); // header + 4 instances
  assert.match(lines[0], /^Instance,Master,Kind,Library,X \(um\),Y \(um\),Orientation/);
  assert.match(lines[1], /^"I_ADC, ""main""",ADC,ip,chip_lib,0,0,R0,100,50,0,0,100,50,50,25,$/);
  assert.match(lines[3], /^PAD_0,PAD,pad,chip_lib,-10,220,R0,20,10,-10,220,10,230,0,225,top$/);
  assert.match(lines[4], /^PAD_1,PAD,pad,chip_lib,-470,0,R90,20,10,-480,0,-470,20,-475,10,left$/);
});
