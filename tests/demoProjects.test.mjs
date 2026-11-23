import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectDocument, serializeProjectDocument } from '../src/store/projectDocument.ts';
import { useStore } from '../src/store/useStore.ts';
import { createCisDemoProject } from '../src/utils/demoProjects.ts';
import { computeFloorplanMetrics } from '../src/utils/floorplanMetrics.ts';
import { generateSkillCode } from '../src/utils/skillExport.ts';
import { extractProjectFromSvg, generateSvgMarkup } from '../src/utils/svgExport.ts';

test('built-in CIS demo floorplan is valid, overlap-free, and exports cleanly to SVG and SKILL', () => {
  const demo = createCisDemoProject();
  assert.deepEqual(parseProjectDocument(serializeProjectDocument(demo)), demo);

  const metrics = computeFloorplanMetrics(demo);
  assert.equal(metrics.ipCount, 8);
  assert.equal(metrics.padCount, 40);
  assert.deepEqual(metrics.padsBySide, { top: 12, right: 8, bottom: 12, left: 8 });
  assert.equal(metrics.overlaps.length, 0);

  const svg = generateSvgMarkup(demo);
  const extracted = extractProjectFromSvg(svg);
  assert.ok(extracted);
  assert.deepEqual(parseProjectDocument(extracted), demo);

  const skill = generateSkillCode(
    demo.topLibName,
    demo.topCellName,
    demo.topWidth,
    demo.topHeight,
    demo.masterCells,
    demo.instances,
    demo.gridSize,
    demo.pixelArray,
  );
  assert.match(skill, /cis_top_2mp_PAD_BANK/);
  assert.match(skill, /cis_top_2mp_PIXEL_ARRAY/);

  useStore.getState().loadProject(demo);
  assert.equal(useStore.getState().padInset, 25);
  assert.equal(useStore.getState().instances.length, 48);
});
