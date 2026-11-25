import { getPhysicalBounds, isActiveMosaic } from './alignment.ts';
import type { CadenceOrientation } from './alignment.ts';
import type { Cell, DescendContextFrame, Instance, PixelArray, RootViewSnapshot, Ruler } from '../store/useStore.ts';
import { formatLppLabel } from './layoutLayers.ts';
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
      const tileCount = isActiveMosaic(inst.mosaic)
        ? Math.max(1, Math.floor(inst.mosaic.rows)) * Math.max(1, Math.floor(inst.mosaic.cols))
        : 1;
      const effectiveMultiplier = multiplier * tileCount;
      counts.set(inst.cellId, (counts.get(inst.cellId) ?? 0) + effectiveMultiplier);
      const childView = cellViews[inst.cellId];
      if (childView && childView.instances.length > 0) {
        const nextPath = new Set(path);
        nextPath.add(inst.cellId);
        walk(childView.instances, effectiveMultiplier, nextPath);
      }
    }
  };

  walk(rootInstances, 1, new Set());
  return counts;
};

export type HierarchyBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type HierarchyReferenceBox = {
  /** Stable unique identifier across hierarchy levels. */
  key: string;
  /** Compact hierarchical instance path, e.g. `I3/I9` or `I0` (no redundant cell/purpose noise). */
  label: string;
  /** Optional descriptive tooltip label including the leaf cell name when different, e.g. `I3/I9 (PAD)`. */
  detailLabel?: string;
  /** True when the underlying cell is a pad master (enables Auto-Dim pad-row collapsing). */
  isPad: boolean;
  /** Source hierarchy relationship relative to the active cellview. */
  level: 'child' | 'ancestor' | 'shape';
  /** Active-level instance ID that owns this descendant box (used to exclude self-children). */
  ownerInstanceId?: string;
  /** True when this box represents a physical leaf (single block/pad/tile/rect rather than a container wrapper). */
  isLeaf: boolean;
  /** Axis-aligned physical bounding box in the active cellview's local coordinate frame. */
  box: HierarchyBox;
};

/** Transforms an axis-aligned box by any Cadence placement transform `(x, y, orientation)`. */
export const transformBoxByCadence = (
  box: HierarchyBox,
  transform: { x: number; y: number; orientation: string },
): HierarchyBox => {
  const p1 = applyCadenceTransformPoint(transform, box.minX, box.minY);
  const p2 = applyCadenceTransformPoint(transform, box.maxX, box.maxY);
  return {
    minX: Math.min(p1.x, p2.x),
    maxX: Math.max(p1.x, p2.x),
    minY: Math.min(p1.y, p2.y),
    maxY: Math.max(p1.y, p2.y),
  };
};

export const boxesStrictlyOverlap = (a: HierarchyBox, b: HierarchyBox, epsilon = 1e-6): boolean => (
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > epsilon
  && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > epsilon
);

const resolveViewCoordModeForWalk = (view?: CellViewContent): CellViewCoordinateMode => (
  view?.coordinateMode
    ?? ((view?.instances.length ?? 0) > 0 && (view?.shapes?.length ?? 0) === 0 ? 'centered' : 'origin')
);

const enumerateMosaicTileIndices = (
  rows: number,
  cols: number,
  maxExpandedTiles: number,
): Array<{ r: number; c: number }> => {
  if (rows * cols <= maxExpandedTiles) {
    const out: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        out.push({ r, c });
      }
    }
    return out;
  }
  // For giant mosaics, still expose the 4 outer corner tiles so users can align/snap to array boundaries.
  const seen = new Set<string>();
  const corners = [
    { r: 0, c: 0 },
    { r: 0, c: cols - 1 },
    { r: rows - 1, c: 0 },
    { r: rows - 1, c: cols - 1 },
  ];
  return corners.filter(pt => {
    const k = `${pt.r}:${pt.c}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export type CollectDescendantOptions = {
  /** Base transform mapping `instances` into the target coordinate frame (default: identity). */
  frameTransform?: { x: number; y: number; orientation: string };
  /** Emit boxes for the root `instances` themselves as well as their lower-level children. */
  includeRootBoxes?: boolean;
  /** Tag assigned to all returned references (`'child'` or `'ancestor'`). */
  level?: 'child' | 'ancestor';
  /** Optional prefix prepended to human-readable labels (e.g. parent cell name). */
  labelPrefix?: string;
  /** Maximum depth of recursive hierarchy traversal (default: 6). */
  maxDepth?: number;
  /** Maximum tiles expanded per mosaic before falling back to corner tiles (default: 64). */
  maxMosaicExpandedTiles?: number;
  /** Hard cap on returned reference boxes so dense layouts remain responsive (default: 400). */
  maxBoxes?: number;
};

/**
 * Recursively collects exact physical bounding boxes of lower-level sub-instances,
 * mosaic tiles, and drawn layout rectangles across hierarchical cellviews.
 * Used by cross-hierarchy two-edge alignment (A), Auto-Dim, and Ruler edge snapping (K).
 */
export const collectInstanceDescendantBoxes = (
  instances: readonly Instance[],
  masterCells: Record<string, Cell>,
  cellViews: Record<string, CellViewContent>,
  options: CollectDescendantOptions = {},
): HierarchyReferenceBox[] => {
  const frameTransform = options.frameTransform ?? { x: 0, y: 0, orientation: 'R0' };
  const includeRootBoxes = options.includeRootBoxes ?? false;
  const level = options.level ?? 'child';
  const labelPrefix = options.labelPrefix ? `${options.labelPrefix}/` : '';
  const maxDepth = options.maxDepth ?? 6;
  const maxMosaicExpandedTiles = options.maxMosaicExpandedTiles ?? 64;
  const maxBoxes = options.maxBoxes ?? 400;
  const results: HierarchyReferenceBox[] = [];

  const pushBox = (entry: HierarchyReferenceBox) => {
    if (results.length >= maxBoxes) return;
    const { box } = entry;
    if (box.maxX - box.minX <= 1e-9 || box.maxY - box.minY <= 1e-9) return;
    results.push(entry);
  };

  const walkInstance = (
    inst: Instance,
    parentTransform: { x: number; y: number; orientation: string },
    parentWidth: number,
    parentHeight: number,
    parentCoordMode: CellViewCoordinateMode,
    ownerInstanceId: string | undefined,
    keyPath: string,
    labelPath: string,
    depth: number,
    emitSelf: boolean,
    visited: Set<string>,
  ) => {
    if (results.length >= maxBoxes || depth > maxDepth) return;
    const master = masterCells[inst.cellId];
    if (!master || master.width <= 0 || master.height <= 0) return;
    if (visited.has(inst.cellId)) return;

    const instTransform = composeCadenceTransform(
      parentTransform,
      { x: inst.x, y: inst.y, orientation: inst.orientation },
      parentWidth,
      parentHeight,
      parentCoordMode,
    );
    const view = cellViews[inst.cellId];
    const subInstances = view?.instances ?? [];
    const subRects = (view?.shapes ?? []).filter(shape => shape.kind !== 'text');
    const viewCoordMode = resolveViewCoordModeForWalk(view);
    const shapeShiftX = viewCoordMode === 'centered' ? master.width / 2 : 0;
    const shapeShiftY = viewCoordMode === 'centered' ? master.height / 2 : 0;
    const masterMinX = master.originX ?? 0;
    const masterMinY = master.originY ?? 0;
    const masterMaxX = masterMinX + master.width;
    const masterMaxY = masterMinY + master.height;
    // Skip any drawn rectangle whose bounds are identical to the cell's own bounding box
    // (e.g. a leaf PAD defined by a single text/drawing body rect) so the leaf stays the
    // cell instance itself instead of duplicating a verbose `/text/drawing` child box.
    const distinctSubRects = subRects.filter(rect => {
      const rMinX = rect.x + shapeShiftX;
      const rMinY = rect.y + shapeShiftY;
      const rMaxX = rMinX + rect.width;
      const rMaxY = rMinY + rect.height;
      return !(
        Math.abs(rMinX - masterMinX) <= 1e-6
        && Math.abs(rMinY - masterMinY) <= 1e-6
        && Math.abs(rMaxX - masterMaxX) <= 1e-6
        && Math.abs(rMaxY - masterMaxY) <= 1e-6
      );
    });
    const hasSubGeometry = subInstances.length > 0 || distinctSubRects.length > 0;
    const mosaic = isActiveMosaic(inst.mosaic) ? inst.mosaic : null;
    const withCellDetail = (pathLabel: string): string => (
      master.cellName && master.cellName.toLowerCase() !== inst.name.toLowerCase()
        ? `${pathLabel} (${master.cellName})`
        : pathLabel
    );

    if (emitSelf) {
      const bounds = getPhysicalBounds({
        id: inst.id,
        x: instTransform.x,
        y: instTransform.y,
        orientation: instTransform.orientation,
        width: master.width,
        height: master.height,
        originX: master.originX,
        originY: master.originY,
        mosaic: mosaic ?? undefined,
      });
      pushBox({
        key: keyPath,
        label: labelPath,
        detailLabel: withCellDetail(labelPath),
        isPad: master.kind === 'pad',
        level,
        ownerInstanceId,
        isLeaf: !hasSubGeometry && !mosaic,
        box: {
          minX: bounds.left,
          maxX: bounds.right,
          minY: bounds.bottom,
          maxY: bounds.top,
        },
      });
    }

    if (!hasSubGeometry && !mosaic) return;
    const nextVisited = new Set(visited);
    nextVisited.add(inst.cellId);

    const tiles = mosaic
      ? enumerateMosaicTileIndices(mosaic.rows, mosaic.cols, maxMosaicExpandedTiles)
      : [{ r: 0, c: 0 }];

    for (const { r, c } of tiles) {
      if (results.length >= maxBoxes) break;
      const tileOffset = mosaic
        ? applyCadenceOrientationVector(instTransform.orientation, c * mosaic.colPitch, r * mosaic.rowPitch)
        : { dx: 0, dy: 0 };
      const tileTransform = {
        x: instTransform.x + tileOffset.dx,
        y: instTransform.y + tileOffset.dy,
        orientation: instTransform.orientation,
      };
      const tileKey = mosaic ? `${keyPath}[${r},${c}]` : keyPath;
      const tileLabel = mosaic ? `${labelPath}[${r},${c}]` : labelPath;

      if (mosaic) {
        const tileBounds = getPhysicalBounds({
          id: `${inst.id}-${r}-${c}`,
          x: tileTransform.x,
          y: tileTransform.y,
          orientation: tileTransform.orientation,
          width: master.width,
          height: master.height,
          originX: master.originX,
          originY: master.originY,
        });
        pushBox({
          key: tileKey,
          label: tileLabel,
          detailLabel: withCellDetail(tileLabel),
          isPad: master.kind === 'pad',
          level,
          ownerInstanceId,
          isLeaf: !hasSubGeometry,
          box: {
            minX: tileBounds.left,
            maxX: tileBounds.right,
            minY: tileBounds.bottom,
            maxY: tileBounds.top,
          },
        });
      }

      for (const rect of distinctSubRects) {
        if (results.length >= maxBoxes) break;
        const localBox: HierarchyBox = {
          minX: rect.x + shapeShiftX,
          maxX: rect.x + rect.width + shapeShiftX,
          minY: rect.y + shapeShiftY,
          maxY: rect.y + rect.height + shapeShiftY,
        };
        const worldBox = transformBoxByCadence(localBox, tileTransform);
        const rectTag = rect.label?.trim() || formatLppLabel(rect.layer, rect.purpose);
        pushBox({
          key: `${tileKey}:shape:${rect.id}`,
          label: `${tileLabel}/${rectTag}`,
          isPad: master.kind === 'pad',
          level,
          ownerInstanceId,
          isLeaf: true,
          box: worldBox,
        });
      }

      for (const subInst of subInstances) {
        if (results.length >= maxBoxes) break;
        const subLabel = `${tileLabel}/${subInst.name}`;
        walkInstance(
          subInst,
          tileTransform,
          master.width,
          master.height,
          viewCoordMode,
          ownerInstanceId,
          `${tileKey}/${subInst.id}`,
          subLabel,
          depth + 1,
          true,
          nextVisited,
        );
      }
    }
  };

  for (const inst of instances) {
    if (results.length >= maxBoxes) break;
    const master = masterCells[inst.cellId];
    if (!master || master.width <= 0 || master.height <= 0) continue;
    const ownerId = level === 'child' ? inst.id : `ancestor:${inst.id}`;
    const rootLabel = `${labelPrefix}${inst.name}`;
    walkInstance(
      inst,
      frameTransform,
      0,
      0,
      'origin',
      ownerId,
      `${level}:${inst.id}`,
      rootLabel,
      0,
      includeRootBoxes,
      new Set(),
    );
  }

  return results;
};

/**
 * During Edit-in-Place (X), collects all visible higher-level sibling instances
 * (plus their lower-level children), higher-level drawn rectangles, and pixel arrays,
 * mapped into the active cellview's local coordinate frame so cross-hierarchy alignment,
 * Auto-Dim, and ruler snapping work seamlessly between lower-level and higher-level cells.
 */
export const collectEipAncestorReferenceBoxes = (
  liveEipChain: ReadonlyArray<DescendContextFrame>,
  rootView: RootViewSnapshot | null,
  masterCells: Record<string, Cell>,
  cellViews: Record<string, CellViewContent>,
  eipInverseTransform: { x: number; y: number; orientation: string },
  maxBoxes = 400,
): HierarchyReferenceBox[] => {
  if (liveEipChain.length === 0) return [];
  const results: HierarchyReferenceBox[] = [];

  for (let levelIdx = 0; levelIdx < liveEipChain.length; levelIdx += 1) {
    if (results.length >= maxBoxes) break;
    const frame = liveEipChain[levelIdx];
    const parentId = frame.parentCellId;
    const isRootLevel = parentId === null;
    const parentView = parentId ? cellViews[parentId] : undefined;
    const parentMaster = parentId ? masterCells[parentId] : undefined;
    const parentInstances = isRootLevel
      ? (rootView?.instances ?? [])
      : (parentView?.instances ?? []);
    const parentShapes = (isRootLevel
      ? (rootView?.shapes ?? [])
      : (parentView?.shapes ?? [])).filter(shape => shape.kind !== 'text');
    const parentPixelArray = isRootLevel
      ? (rootView?.pixelArray ?? null)
      : (parentView?.pixelArray ?? null);
    const parentW = isRootLevel ? (rootView?.topWidth ?? frame.parentWidth) : (parentMaster?.width ?? frame.parentWidth);
    const parentH = isRootLevel ? (rootView?.topHeight ?? frame.parentHeight) : (parentMaster?.height ?? frame.parentHeight);
    const parentCoordMode: CellViewCoordinateMode = isRootLevel
      ? 'origin'
      : resolveViewCoordModeForWalk(parentView);

    const levelToBase = levelIdx === 0
      ? { x: 0, y: 0, orientation: 'R0' as const }
      : computeActiveToBaseTransform(liveEipChain.slice(0, levelIdx), parentCoordMode, parentW, parentH);
    const levelToActive = composeCadenceTransform(eipInverseTransform, levelToBase, 0, 0, 'origin');

    const siblingInstances = parentInstances.filter(inst => inst.id !== frame.instanceId);
    const siblingBoxes = collectInstanceDescendantBoxes(
      siblingInstances,
      masterCells,
      cellViews,
      {
        frameTransform: levelToActive,
        includeRootBoxes: true,
        level: 'ancestor',
        maxBoxes: Math.max(0, maxBoxes - results.length),
      },
    );
    for (const item of siblingBoxes) {
      results.push({
        ...item,
        key: `eip-${levelIdx}-${item.key}`,
        ...(item.ownerInstanceId ? { ownerInstanceId: `eip-${levelIdx}-${item.ownerInstanceId}` } : {}),
      });
    }

    for (const shape of parentShapes) {
      if (results.length >= maxBoxes) break;
      const worldBox = transformBoxByCadence(
        { minX: shape.x, maxX: shape.x + shape.width, minY: shape.y, maxY: shape.y + shape.height },
        levelToActive,
      );
      results.push({
        key: `eip-${levelIdx}-shape-${shape.id}`,
        label: shape.label?.trim() || formatLppLabel(shape.layer, shape.purpose),
        isPad: false,
        level: 'ancestor',
        isLeaf: true,
        box: worldBox,
      });
    }

    if (parentPixelArray?.visible && results.length < maxBoxes) {
      const worldBox = transformBoxByCadence(
        {
          minX: parentPixelArray.x,
          maxX: parentPixelArray.x + parentPixelArray.width,
          minY: parentPixelArray.y,
          maxY: parentPixelArray.y + parentPixelArray.height,
        },
        levelToActive,
      );
      results.push({
        key: `eip-${levelIdx}-pixel-array`,
        label: 'Pixel Array',
        isPad: false,
        level: 'ancestor',
        isLeaf: true,
        box: worldBox,
      });
    }
  }

  return results;
};
