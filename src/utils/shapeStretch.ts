import { snapToGrid } from './grid.ts';
import type { LayoutShape } from './layoutLayers.ts';

export type RectEdge = 'left' | 'right' | 'bottom' | 'top';

export type PartialShapeSelection = Record<string, RectEdge[]>;

export type StretchHitResult = {
  shapeId: string;
  edges: RectEdge[];
  kind: 'corner' | 'edge';
};

export type ShapeGeometryUpdate = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const EDGE_ORDER: readonly RectEdge[] = ['left', 'right', 'bottom', 'top'];
const EPS = 1e-9;

const normalizeEdges = (edges: Iterable<RectEdge>): RectEdge[] => {
  const unique = new Set<RectEdge>(edges);
  return EDGE_ORDER.filter(edge => unique.has(edge));
};

const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

export const hasPartialSelection = (selection: PartialShapeSelection): boolean => (
  Object.values(selection).some(edges => edges.length > 0)
);

export const countPartialSelectedEdges = (selection: PartialShapeSelection): number => (
  Object.values(selection).reduce((sum, edges) => sum + edges.length, 0)
);

export const countPartialSelectedShapes = (selection: PartialShapeSelection): number => (
  Object.values(selection).filter(edges => edges.length > 0).length
);

/**
 * Cadence Virtuoso Partial Select marquee:
 * Selects every edge of every unlocked rectangle whose edge segment intersects
 * the selection box `[minX..maxX] x [minY..maxY]`.
 * - Crossing 1 edge selects that edge (1D stretch).
 * - Enclosing 1 corner crosses its 2 adjacent edges (2D corner stretch).
 * - Crossing edges across multiple shapes selects all of them for simultaneous stretch.
 * - Enclosing all 4 edges selects the full rectangle (translation).
 */
export const selectShapeEdgesInBox = (
  shapes: readonly LayoutShape[],
  box: { minX: number; minY: number; maxX: number; maxY: number },
): PartialShapeSelection => {
  const minX = Math.min(box.minX, box.maxX);
  const maxX = Math.max(box.minX, box.maxX);
  const minY = Math.min(box.minY, box.maxY);
  const maxY = Math.max(box.minY, box.maxY);
  const result: PartialShapeSelection = {};

  for (const shape of shapes) {
    if (shape.locked || shape.kind === 'text') continue;
    const x1 = shape.x;
    const x2 = shape.x + shape.width;
    const y1 = shape.y;
    const y2 = shape.y + shape.height;

    const edges: RectEdge[] = [];
    if (x1 >= minX - EPS && x1 <= maxX + EPS && y2 >= minY - EPS && y1 <= maxY + EPS) {
      edges.push('left');
    }
    if (x2 >= minX - EPS && x2 <= maxX + EPS && y2 >= minY - EPS && y1 <= maxY + EPS) {
      edges.push('right');
    }
    if (y1 >= minY - EPS && y1 <= maxY + EPS && x2 >= minX - EPS && x1 <= maxX + EPS) {
      edges.push('bottom');
    }
    if (y2 >= minY - EPS && y2 <= maxY + EPS && x2 >= minX - EPS && x1 <= maxX + EPS) {
      edges.push('top');
    }

    if (edges.length > 0) {
      result[shape.id] = edges;
    }
  }

  return result;
};

/**
 * Hit-tests unlocked shapes (topmost first) for a single corner or edge within
 * `toleranceUm` of `(pointX, pointY)`. Corners take priority over single edges
 * so dragging a corner stretches both X and Y smoothly.
 */
export const hitTestShapeEdgeOrCorner = (
  shapes: readonly LayoutShape[],
  pointX: number,
  pointY: number,
  toleranceUm: number,
): StretchHitResult | null => {
  const tol = Math.max(1e-6, toleranceUm);
  let bestEdge: { hit: StretchHitResult; dist: number } | null = null;

  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i];
    if (shape.locked || shape.kind === 'text') continue;
    const x1 = shape.x;
    const x2 = shape.x + shape.width;
    const y1 = shape.y;
    const y2 = shape.y + shape.height;

    // 1. Check the 4 corners first
    const corners: Array<{ x: number; y: number; edges: RectEdge[] }> = [
      { x: x1, y: y1, edges: ['left', 'bottom'] },
      { x: x2, y: y1, edges: ['right', 'bottom'] },
      { x: x2, y: y2, edges: ['right', 'top'] },
      { x: x1, y: y2, edges: ['left', 'top'] },
    ];
    let bestCorner: { edges: RectEdge[]; dist: number } | null = null;
    for (const corner of corners) {
      const dist = Math.hypot(pointX - corner.x, pointY - corner.y);
      if (dist <= tol && (!bestCorner || dist < bestCorner.dist)) {
        bestCorner = { edges: corner.edges, dist };
      }
    }
    if (bestCorner) {
      return { shapeId: shape.id, edges: bestCorner.edges, kind: 'corner' };
    }

    // 2. Check the 4 edges
    const edgeCandidates: Array<{ edge: RectEdge; dist: number; inSpan: boolean }> = [
      { edge: 'left', dist: Math.abs(pointX - x1), inSpan: pointY >= y1 - tol && pointY <= y2 + tol },
      { edge: 'right', dist: Math.abs(pointX - x2), inSpan: pointY >= y1 - tol && pointY <= y2 + tol },
      { edge: 'bottom', dist: Math.abs(pointY - y1), inSpan: pointX >= x1 - tol && pointX <= x2 + tol },
      { edge: 'top', dist: Math.abs(pointY - y2), inSpan: pointX >= x1 - tol && pointX <= x2 + tol },
    ];
    for (const candidate of edgeCandidates) {
      if (candidate.inSpan && candidate.dist <= tol) {
        if (!bestEdge || candidate.dist < bestEdge.dist) {
          bestEdge = {
            hit: { shapeId: shape.id, edges: [candidate.edge], kind: 'edge' },
            dist: candidate.dist,
          };
        }
      }
    }
  }

  return bestEdge ? bestEdge.hit : null;
};

/**
 * Merges an incoming partial selection with an existing partial selection.
 * - `'replace'`: replaces the entire selection.
 * - `'add'`: union of selected edges per shape.
 * - `'toggle'`: toggles each incoming edge on/off (standard Shift-select).
 */
export const mergePartialSelections = (
  current: PartialShapeSelection,
  incoming: PartialShapeSelection,
  mode: 'replace' | 'add' | 'toggle' = 'replace',
): PartialShapeSelection => {
  if (mode === 'replace') {
    const clean: PartialShapeSelection = {};
    for (const [id, edges] of Object.entries(incoming)) {
      const normalized = normalizeEdges(edges);
      if (normalized.length > 0) clean[id] = normalized;
    }
    return clean;
  }

  const next: PartialShapeSelection = {};
  const allIds = new Set([...Object.keys(current), ...Object.keys(incoming)]);
  for (const id of allIds) {
    const curSet = new Set<RectEdge>(current[id] ?? []);
    const incList = incoming[id] ?? [];
    if (mode === 'add') {
      for (const edge of incList) curSet.add(edge);
    } else {
      for (const edge of incList) {
        if (curSet.has(edge)) curSet.delete(edge);
        else curSet.add(edge);
      }
    }
    const merged = normalizeEdges(curSet);
    if (merged.length > 0) next[id] = merged;
  }
  return next;
};

/**
 * Computes updated rectangle geometries when stretching all partially selected
 * edges by `(dx, dy)` snapped to `snapStep` (aligned with `gridSize`).
 * If stretching one edge lands exactly on top of the opposite edge (zero width or
 * height), that axis keeps its previous valid span so no rectangle can vanish;
 * pulling past the opposite edge by at least `gridSize` cleanly flips the box.
 */
export const computeStretchedShapes = (
  shapes: readonly LayoutShape[],
  partialSelection: PartialShapeSelection,
  dx: number,
  dy: number,
  snapStep: number,
  gridSize = snapStep,
): ShapeGeometryUpdate[] => {
  const sdx = normalizeZero(snapToGrid(dx, snapStep));
  const sdy = normalizeZero(snapToGrid(dy, snapStep));
  const shapeById = new Map(shapes.map(shape => [shape.id, shape]));
  const updates: ShapeGeometryUpdate[] = [];

  for (const [shapeId, edges] of Object.entries(partialSelection)) {
    if (!edges || edges.length === 0) continue;
    const shape = shapeById.get(shapeId);
    if (!shape || shape.locked) continue;

    const moveLeft = edges.includes('left');
    const moveRight = edges.includes('right');
    const moveBottom = edges.includes('bottom');
    const moveTop = edges.includes('top');

    const rawX1 = moveLeft ? shape.x + sdx : shape.x;
    const rawX2 = moveRight ? shape.x + shape.width + sdx : shape.x + shape.width;
    const rawY1 = moveBottom ? shape.y + sdy : shape.y;
    const rawY2 = moveTop ? shape.y + shape.height + sdy : shape.y + shape.height;

    const minX = normalizeZero(snapToGrid(Math.min(rawX1, rawX2), gridSize));
    const maxX = normalizeZero(snapToGrid(Math.max(rawX1, rawX2), gridSize));
    const minY = normalizeZero(snapToGrid(Math.min(rawY1, rawY2), gridSize));
    const maxY = normalizeZero(snapToGrid(Math.max(rawY1, rawY2), gridSize));

    const nextW = snapToGrid(maxX - minX, gridSize);
    const nextH = snapToGrid(maxY - minY, gridSize);

    const validX = nextW >= gridSize - EPS;
    const validY = nextH >= gridSize - EPS;

    const finalX = validX ? minX : shape.x;
    const finalW = validX ? nextW : shape.width;
    const finalY = validY ? minY : shape.y;
    const finalH = validY ? nextH : shape.height;

    updates.push({
      id: shape.id,
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
    });
  }

  return updates;
};
