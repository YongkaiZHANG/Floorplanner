import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectDocument } from '../src/store/projectDocument.ts';
import { extractProjectFromSvg, generateSvgMarkup } from '../src/utils/svgExport.ts';

const baseProject = {
  gridSize: 0.0005,
  topWidth: 100,
  topHeight: 80,
  topLibName: 'chip_lib',
  topCellName: 'top<A&B>]]>',
  masterCells: {
    m1: {
      id: 'm1',
      libName: 'chip_lib',
      cellName: 'ADC&DAC<1>]]>',
      width: 12.5,
      height: 8.25,
      color: '#2563eb',
      opacity: 0.6,
      outlineStyle: 'dashed',
    },
  },
  instances: [
    {
      id: 'i1',
      cellId: 'm1',
      name: 'I0&"1"',
      x: 1.0005,
      y: -2.0005,
      orientation: 'R90',
    },
  ],
  rulers: [
    {
      id: 'r1',
      startX: 0,
      startY: 0,
      endX: 0.0015,
      endY: 0,
    },
  ],
  pixelArray: {
    x: -20,
    y: -15,
    width: 40,
    height: 30,
    visible: true,
  },
};

test('escapes XML entities and CDATA terminators and round-trips project metadata', () => {
  const svg = generateSvgMarkup(baseProject);

  assert.match(svg, /top&lt;A&amp;B&gt;\]\]&gt;/);
  assert.match(svg, /ADC&amp;DAC&lt;1&gt;\]\]&gt;/);
  assert.match(svg, /I0&amp;&quot;1&quot;/);
  assert.match(svg, /BL: \(-50, -40\)/);
  assert.match(svg, /L: 0\.0015/);

  const extracted = extractProjectFromSvg(svg);
  assert.ok(extracted);
  assert.deepEqual(parseProjectDocument(extracted), baseProject);
});

test('omits pixel array drawing when hidden while keeping it in embedded project metadata', () => {
  const hiddenProject = {
    ...baseProject,
    pixelArray: { ...baseProject.pixelArray, visible: false },
  };
  const svg = generateSvgMarkup(hiddenProject);

  assert.doesNotMatch(svg, /PIXEL ARRAY ·/);
  const extracted = extractProjectFromSvg(svg);
  assert.ok(extracted);
  assert.deepEqual(parseProjectDocument(extracted).pixelArray, hiddenProject.pixelArray);
});

test('extractProjectFromSvg ignores unrelated CDATA blocks outside floorplan metadata', () => {
  const svg = '<svg><style><![CDATA[.x { fill: red; }]]></style><metadata class="floorplan-data"><![CDATA[{"ok":true}]]></metadata></svg>';
  assert.equal(extractProjectFromSvg(svg), '{"ok":true}');
  assert.equal(extractProjectFromSvg('<svg><style><![CDATA[nope]]></style></svg>'), null);
});
