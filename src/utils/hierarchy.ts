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
 * Returns the exact inverse Cadence orientation (`M^{-1} = M^T` in the dihedral group D4).
 */
export const invertCadenceOrientation = (orientation: string): CadenceOrientation => {
  const m = getOrientationMatrix(orientation);
  return matrixToOrientation([m[0], m[2], m[1], m[3]]);
};

/**
 * Inverts a 2D Cadence placement transform `p_parent = M * p_local + t` into
 * `p_local = M^{-1} * p_parent + (-M^{-1} * t)`.
 * Used by Edit-in-Place (X) to display dimmed parent/top context in the active cell's exact frame.
 */
export const invertCadenceTransform = (
  transform: { x: number; y: number; orientation: string },
): { x: number; y: number; orientation: CadenceOrientation } => {
  const invOrient = invertCadenceOrientation(transform.orientation);
  const invM = getOrientationMatrix(invOrient);
  const ix = -(invM[0] * transform.x + invM[1] * transform.y);
  const iy = -(invM[2] * transform.x + invM[3] * transform.y);
  return {
    x: Object.is(ix, -0) ? 0 : ix,
    y: Object.is(iy, -0) ? 0 : iy,
    orientation: invOrient,
  };
};

const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

/** Applies a 2D Cadence placement transform `(x, y, orientation)` to a local point `(px, py)`. */
export const applyCadenceTransformPoint = (
  transform: { x: number; y: number; orientation: string },
  px: number,
  py: number,
): { x: number; y: number } => {
  const m = getOrientationMatrix(transform.orientation);
  return {
    x: normalizeZero(transform.x + m[0] * px + m[1] * py),
    y: normalizeZero(transform.y + m[2] * px + m[3] * py),
  };
};

/** Applies the linear rotation/mirror matrix of a Cadence orientation to a delta vector `(dx, dy)`. */
export const applyCadenceOrientationVector = (
  orientation: string,
  dx: number,
  dy: number,
): { dx: number; dy: number } => {
  const m = getOrientationMatrix(orientation);
  return {
    dx: normalizeZero(m[0] * dx + m[1] * dy),
    dy: normalizeZero(m[2] * dx + m[3] * dy),
  };
};

/**
 * Given a chain of parent->child placement steps (starting at the base cellview and ending
 * at the currently edited EIP cell), returns the forward transform mapping points from the
 * active cellview's local coordinate frame directly into the base cellview's coordinate frame.
 */
export const computeActiveToBaseTransform = (
  chain: ReadonlyArray<{
    x: number;
    y: number;
    orientation: string;
    parentWidth: number;
    parentHeight: number;
    parentCoordinateMode: CellViewCoordinateMode;
  }>,
  activeCoordinateMode: CellViewCoordinateMode = 'origin',
  activeWidth = 0,
  activeHeight = 0,
): { x: number; y: number; orientation: CadenceOrientation } => {
  if (chain.length === 0) {
    return { x: 0, y: 0, orientation: 'R0' };
  }
  let activeToBase: { x: number; y: number; orientation: CadenceOrientation } = {
    x: 0,
    y: 0,
    orientation: 'R0',
  };
  for (let i = 0; i < chain.length; i += 1) {
    const step = chain[i];
    // For i === 0, step is placed directly inside the base view's coordinate frame (no extra parent half-shift).
    const stepMode: CellViewCoordinateMode = i === 0 ? 'origin' : step.parentCoordinateMode;
    activeToBase = composeCadenceTransform(
      activeToBase,
      { x: step.x, y: step.y, orientation: step.orientation },
      step.parentWidth,
      step.parentHeight,
      stepMode,
    );
  }
  // If the active cell itself uses legacy 'centered' coordinates, p_local_origin = p_centered + (activeW/2, activeH/2)
  if (activeCoordinateMode === 'centered') {
    const m = getOrientationMatrix(activeToBase.orientation);
    const ox = activeWidth / 2;
    const oy = activeHeight / 2;
    activeToBase = {
      x: normalizeZero(activeToBase.x + m[0] * ox + m[1] * oy),
      y: normalizeZero(activeToBase.y + m[2] * ox + m[3] * oy),
      orientation: activeToBase.orientation,
    };
  }
  return {
    x: normalizeZero(activeToBase.x),
    y: normalizeZero(activeToBase.y),
    orientation: activeToBase.orientation,
  };
};

/**
 * Given a chain of parent->child placement steps (starting at an ancestor level and ending
 * at the currently edited cell), returns the transform mapping points from that ancestor's
 * coordinate frame directly into the active cellview's local coordinate frame.
 */
export const computeAncestorToActiveTransform = (
  chain: ReadonlyArray<{
    x: number;
    y: number;
    orientation: string;
    parentWidth: number;
    parentHeight: number;
    parentCoordinateMode: CellViewCoordinateMode;
  }>,
  activeCoordinateMode: CellViewCoordinateMode = 'origin',
  activeWidth = 0,
  activeHeight = 0,
): { x: number; y: number; orientation: CadenceOrientation } => (
  invertCadenceTransform(
    computeActiveToBaseTransform(chain, activeCoordinateMode, activeWidth, activeHeight),
  )
);

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
