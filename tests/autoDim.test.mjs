import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseCollinearPadCandidates, labelRectsOverlap } from '../src/utils/autoDim.ts';

test('collapses collinear equal-distance pad rows into one group candidate while preserving IPs', () => {
  const candidates = [
    {
      id: 'p1', name: 'I3', isPad: true, occludes: true, distance: 243.35,
      overlap: { start: -300, end: -250 },
      box: { minX: -300, maxX: -250, minY: -1000, maxY: -940 },
    },
    {
      id: 'p2', name: 'I4', isPad: true, occludes: true, distance: 243.35,
      overlap: { start: -200, end: -150 },
      box: { minX: -200, maxX: -150, minY: -1000, maxY: -940 },
    },
    {
      id: 'p3', name: 'I5', isPad: true, occludes: true, distance: 243.35,
      overlap: { start: -100, end: -50 },
      box: { minX: -100, maxX: -50, minY: -1000, maxY: -940 },
    },
    {
      id: 'ip1', name: 'I1', isPad: false, occludes: true, distance: 85.3,
      overlap: { start: 0, end: 100 },
      box: { minX: 0, maxX: 100, minY: -800, maxY: -700 },
    },
  ];

  const collapsed = collapseCollinearPadCandidates(candidates);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].id, 'ip1');
  assert.equal(collapsed[1].name, '3 pads');
  assert.equal(collapsed[1].padCount, 3);
  assert.deepEqual(collapsed[1].overlap, { start: -300, end: -50 });
});

test('detects overlapping screen-space label pills accurately', () => {
  const a = { cx: 100, cy: 50, halfWidth: 30, halfHeight: 10 };
  const overlapping = { cx: 145, cy: 55, halfWidth: 30, halfHeight: 10 };
  const separated = { cx: 170, cy: 50, halfWidth: 30, halfHeight: 10 };

  assert.equal(labelRectsOverlap(a, overlapping), true);
  assert.equal(labelRectsOverlap(a, separated), false);
});
