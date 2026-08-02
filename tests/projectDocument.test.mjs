import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectDocument, serializeProjectDocument } from '../src/store/projectDocument.ts';

const project = {
  gridSize: 0.005,
  topWidth: 100,
  topHeight: 80,
  topLibName: 'lib',
  topCellName: 'top',
  masterCells: {
    m: { id: 'm', libName: 'lib', cellName: 'ip', width: 10, height: 20, color: '#abc' },
  },
  instances: [{ id: 'i', cellId: 'm', name: 'I0', x: 1, y: 2, orientation: 'R90' }],
  rulers: [{ id: 'r', startX: 0, startY: 0, endX: 1, endY: 2 }],
};

test('versioned .flp documents round trip', () => {
  assert.deepEqual(parseProjectDocument(serializeProjectDocument(project)), project);
});

test('legacy raw documents remain importable', () => {
  assert.deepEqual(parseProjectDocument(JSON.stringify(project)), project);
});

test('invalid references and non-finite coordinates are rejected', () => {
  const missingMaster = { ...project, instances: [{ ...project.instances[0], cellId: 'missing' }] };
  assert.throws(() => parseProjectDocument(JSON.stringify(missingMaster)), /missing master/);
  const infinite = JSON.stringify(project).replace('"x":1', '"x":1e999');
  assert.throws(() => parseProjectDocument(infinite), /Invalid instance/);
});

test('pad master behavior survives project serialization and rejects unknown kinds', () => {
  const padProject = structuredClone(project);
  padProject.masterCells.m.kind = 'pad';
  assert.deepEqual(parseProjectDocument(serializeProjectDocument(padProject)), padProject);

  padProject.masterCells.m.kind = 'mystery';
  assert.throws(() => parseProjectDocument(JSON.stringify(padProject)), /Invalid master cell/);
});

test('IP appearance survives serialization and invalid appearance is rejected', () => {
  const styledProject = structuredClone(project);
  styledProject.masterCells.m.opacity = 0.35;
  styledProject.masterCells.m.outlineStyle = 'dotted';
  assert.deepEqual(parseProjectDocument(serializeProjectDocument(styledProject)), styledProject);

  styledProject.masterCells.m.opacity = 1.2;
  assert.throws(() => parseProjectDocument(JSON.stringify(styledProject)), /Invalid master cell/);

  styledProject.masterCells.m.opacity = 0.5;
  styledProject.masterCells.m.outlineStyle = 'double';
  assert.throws(() => parseProjectDocument(JSON.stringify(styledProject)), /Invalid master cell/);
});

test('pixel array survives serialization and must remain inside the top cell', () => {
  const pixelProject = structuredClone(project);
  pixelProject.pixelArray = { x: -30, y: -20, width: 60, height: 40, visible: false };
  assert.deepEqual(parseProjectDocument(serializeProjectDocument(pixelProject)), pixelProject);

  pixelProject.pixelArray.x = 30;
  assert.throws(() => parseProjectDocument(JSON.stringify(pixelProject)), /Invalid pixel array/);
  pixelProject.pixelArray = { x: -50, y: -40, width: 100, height: 20, visible: true };
  assert.throws(() => parseProjectDocument(JSON.stringify(pixelProject)), /Invalid pixel array/);
});
