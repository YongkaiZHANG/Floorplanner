import type { CadenceOrientation } from './alignment.ts';
import type { Instance, PixelArray, Ruler } from '../store/useStore.ts';
import type { LayoutShape } from './layoutLayers.ts';

export type CellViewCoordinateMode = 'origin' | 'centered';

export type CellViewContent = {
  instances: Instance[];
  rulers: Ruler[];
  shapes?: LayoutShape[];
  pixelArray?: PixelArray | null;
  padInset?: number;
  /**
   * `'origin'`: Native Virtuoso cell coordinates where (0, 0) in the cellview IS the cell's
   * (0, 0) origin when instantiated in parent cells.
   * `'centered'` (legacy default when omitted): coordinates stored in `[-W/2..W/2] x [-H/2..H/2]`.
   */
  coordinateMode?: CellViewCoordinateMode;
};

type Matrix2x2 = readonly [number, number, number, number]; // [a, b, c, d] -> (ax + by, cx + dy)

const ORIENTATION_MATRICES: Record<CadenceOrientation, Matrix2x2> = {
  R0: [1, 0, 0, 1],
  R90: [0, -1, 1, 0],
  R180: [-1, 0, 0, -1],
  R270: [0, 1, -1, 0],
  MX: [1, 0, 0, -1],
  MY: [-1, 0, 0, 1],
  MXR90: [0, 1, 1, 0],
  MYR90: [0, -1, -1, 0],
};

const multiplyMatrices = (p: Matrix2x2, c: Matrix2x2): Matrix2x2 => [
  p[0] * c[0] + p[1] * c[2],
  p[0] * c[1] + p[1] * c[3],
  p[2] * c[0] + p[3] * c[2],
  p[2] * c[1] + p[3] * c[3],
];

const matrixToOrientation = (m: Matrix2x2): CadenceOrientation => {
  for (const [orientation, candidate] of Object.entries(ORIENTATION_MATRICES) as Array<[CadenceOrientation, Matrix2x2]>) {
    if (
      candidate[0] === m[0]
      && candidate[1] === m[1]
      && candidate[2] === m[2]
      && candidate[3] === m[3]
    ) {
      return orientation;
    }
  }
  throw new Error(`Invalid composed orientation matrix: [${m.join(', ')}]`);
};

export const getOrientationMatrix = (orientation: string): Matrix2x2 => {
  const matrix = ORIENTATION_MATRICES[orientation as CadenceOrientation];
  if (!matrix) throw new Error(`Unsupported Cadence orientation: ${orientation}`);
  return matrix;
};

/**
 * Composes a parent's placement transform with a child's placement inside that parent.
 * - `'origin'`: Child coordinates are already in parent's native `(0, 0)` cell frame.
 * - `'centered'` (legacy default): Translates child from `[-parentW/2, parentW/2]` to `[0, parentW]`.
 */
export const composeCadenceTransform = (
  parent: { x: number; y: number; orientation: string },
  child: { x: number; y: number; orientation: string },
  parentWidth: number,
  parentHeight: number,
  coordinateMode: CellViewCoordinateMode = 'centered',
): { x: number; y: number; orientation: CadenceOrientation } => {
  const pm = getOrientationMatrix(parent.orientation);
  const cm = getOrientationMatrix(child.orientation);
  const localX = coordinateMode === 'origin' ? child.x : child.x + parentWidth / 2;
  const localY = coordinateMode === 'origin' ? child.y : child.y + parentHeight / 2;
  return {
    x: parent.x + pm[0] * localX + pm[1] * localY,
    y: parent.y + pm[2] * localX + pm[3] * localY,
    orientation: matrixToOrientation(multiplyMatrices(pm, cm)),
  };
};

/**
 * Returns true if instantiating `childCellId` inside `parentCellId` would form a
 * direct or indirect recursive hierarchy cycle.
 */
export const wouldCreateHierarchyCycle = (
  parentCellId: string | null,
  childCellId: string,
  cellViews: Record<string, CellViewContent>,
): boolean => {
  if (!parentCellId) return false;
  if (parentCellId === childCellId) return true;

  const visited = new Set<string>();
  const stack = [childCellId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === parentCellId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const view = cellViews[current];
    if (!view) continue;
    for (const inst of view.instances) {
      if (!visited.has(inst.cellId)) stack.push(inst.cellId);
    }
  }
  return false;
};

/**
 * Returns all referenced cell IDs in strict bottom-up topological order
 * (leaves first, intermediate sub-cells next, root-level children last).
 */
export const getTopologicalCellOrder = (
  allCellIds: Iterable<string>,
  cellViews: Record<string, CellViewContent>,
): string[] => {
  const state = new Map<string, 'visiting' | 'visited'>();
  const order: string[] = [];

  const visit = (cellId: string) => {
    const status = state.get(cellId);
    if (status === 'visited') return;
    if (status === 'visiting') {
      throw new Error(`Circular hierarchy detected involving cell ${cellId}.`);
    }
    state.set(cellId, 'visiting');
    const view = cellViews[cellId];
    if (view) {
      for (const inst of view.instances) {
        visit(inst.cellId);
      }
    }
    state.set(cellId, 'visited');
    order.push(cellId);
  };

  for (const id of allCellIds) {
    visit(id);
  }
  return order;
};

/**
 * Counts how many times each cell ID is instantiated globally across the complete
 * expanded hierarchy rooted at `rootInstances`.
 */
export const getHierarchyUsageCounts = (
  rootInstances: readonly Instance[],
  cellViews: Record<string, CellViewContent>,
): Map<string, number> => {
  const counts = new Map<string, number>();

  const walk = (instances: readonly Instance[], multiplier: number, path: Set<string>) => {
    for (const inst of instances) {
      if (path.has(inst.cellId)) {
        throw new Error(`Circular hierarchy detected involving cell ${inst.cellId}.`);
      }
      counts.set(inst.cellId, (counts.get(inst.cellId) ?? 0) + multiplier);
      const childView = cellViews[inst.cellId];
      if (childView && childView.instances.length > 0) {
        const nextPath = new Set(path);
        nextPath.add(inst.cellId);
        walk(childView.instances, multiplier, nextPath);
      }
    }
  };

  walk(rootInstances, 1, new Set());
  return counts;
};
