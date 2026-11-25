import { snapToGrid } from './grid.ts';

export type CadenceOrientation =
  | 'R0'
  | 'R90'
  | 'R180'
  | 'R270'
  | 'MX'
  | 'MY'
  | 'MXR90'
  | 'MYR90';

export type AlignmentOperation =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'horizontal-center'
  | 'vertical-center';

export type AlignmentEdge = AlignmentOperation;

export type DistributionAxis = 'horizontal' | 'vertical';

export type MoveConstraintMode = 'orthogonal' | 'free' | 'horizontal' | 'vertical';

export interface ConstrainedDelta {
  dx: number;
  dy: number;
  activeAxis: 'horizontal' | 'vertical' | 'free';
}

export interface InstanceMosaic {
  /** Number of rows (>= 1, repeated along local Y axis by rowPitch). */
  rows: number;
  /** Number of columns (>= 1, repeated along local X axis by colPitch). */
  cols: number;
  /** Center-to-center / origin-to-origin row pitch ΔY in local master coordinates (um). */
  rowPitch: number;
  /** Center-to-center / origin-to-origin column pitch ΔX in local master coordinates (um). */
  colPitch: number;
}

export const isActiveMosaic = (mosaic?: InstanceMosaic | null): mosaic is InstanceMosaic => (
  Boolean(mosaic && (mosaic.rows > 1 || mosaic.cols > 1))
);

/**
 * Applies a Cadence Virtuoso move snap constraint to a raw displacement vector (dx, dy).
 * - `'orthogonal'` (Virtuoso default): locks motion to whichever axis has the larger displacement.
 * - `'horizontal'`: allows only X movement (dy = 0).
 * - `'vertical'`: allows only Y movement (dx = 0).
 * - `'free'`: unconstrained diagonal/any-angle movement.
 */
export const applyMoveConstraint = (
  dx: number,
  dy: number,
  mode: MoveConstraintMode,
): ConstrainedDelta => {
  const clean = (value: number) => (Object.is(value, -0) ? 0 : value);
  if (mode === 'free') {
    return { dx: clean(dx), dy: clean(dy), activeAxis: 'free' };
  }
  if (mode === 'horizontal') {
    return { dx: clean(dx), dy: 0, activeAxis: 'horizontal' };
  }
  if (mode === 'vertical') {
    return { dx: 0, dy: clean(dy), activeAxis: 'vertical' };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { dx: clean(dx), dy: 0, activeAxis: 'horizontal' };
  }
  return { dx: 0, dy: clean(dy), activeAxis: 'vertical' };
};

export const HORIZONTAL_ALIGNMENT_EDGES = ['left', 'horizontal-center', 'right'] as const;
export const VERTICAL_ALIGNMENT_EDGES = ['bottom', 'vertical-center', 'top'] as const;

export interface AlignableInstance {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional local X origin of master bounding box relative to (0, 0). Defaults to 0. */
  originX?: number;
  /** Optional local Y origin of master bounding box relative to (0, 0). Defaults to 0. */
  originY?: number;
  /** Runtime-validated so it can accept the store's current string field directly. */
  orientation: string;
  /** Optional Virtuoso mosaic array metadata (rows × cols with local rowPitch/colPitch). */
  mosaic?: InstanceMosaic;
}

export interface ArrangementOptions {
  topWidth: number;
  topHeight: number;
  gridSize: number;
  /** The reference block that must remain fixed while the others move. */
  anchorId?: string;
  /** When true (e.g. inside an unbounded Virtuoso IP cellview canvas), snap to grid without clamping to [-topW/2..topW/2]. */
  unbounded?: boolean;
}

export interface InstancePosition {
  id: string;
  x: number;
  y: number;
}

export interface PhysicalBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface LocalBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const EPSILON = 1e-9;

const assertFinitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero`);
  }
};

const assertInstance = (instance: AlignableInstance) => {
  if (!instance.id) throw new Error('Every instance must have a non-empty id');
  assertFinitePositive(instance.width, `Width for ${instance.id}`);
  assertFinitePositive(instance.height, `Height for ${instance.id}`);
  if (!Number.isFinite(instance.x) || !Number.isFinite(instance.y)) {
    throw new RangeError(`Position for ${instance.id} must be finite`);
  }
};

const getLocalBounds = (instance: AlignableInstance): LocalBounds => {
  const ox = instance.originX ?? 0;
  const oy = instance.originY ?? 0;
  let minColOffset = 0;
  let maxColOffset = 0;
  let minRowOffset = 0;
  let maxRowOffset = 0;
  if (instance.mosaic) {
    const rows = Math.max(1, Math.floor(instance.mosaic.rows));
    const cols = Math.max(1, Math.floor(instance.mosaic.cols));
    const colSpan = (cols - 1) * instance.mosaic.colPitch;
    const rowSpan = (rows - 1) * instance.mosaic.rowPitch;
    minColOffset = Math.min(0, colSpan);
    maxColOffset = Math.max(0, colSpan);
    minRowOffset = Math.min(0, rowSpan);
    maxRowOffset = Math.max(0, rowSpan);
  }
  const x1 = ox + minColOffset;
  const y1 = oy + minRowOffset;
  const x2 = ox + instance.width + maxColOffset;
  const y2 = oy + instance.height + maxRowOffset;
  switch (instance.orientation) {
    case 'R0': return { minX: x1, maxX: x2, minY: y1, maxY: y2 };
    case 'R90': return { minX: -y2, maxX: -y1, minY: x1, maxY: x2 };
    case 'R180': return { minX: -x2, maxX: -x1, minY: -y2, maxY: -y1 };
    case 'R270': return { minX: y1, maxX: y2, minY: -x2, maxY: -x1 };
    case 'MX': return { minX: x1, maxX: x2, minY: -y2, maxY: -y1 };
    case 'MY': return { minX: -x2, maxX: -x1, minY: y1, maxY: y2 };
    case 'MXR90': return { minX: y1, maxX: y2, minY: x1, maxY: x2 };
    case 'MYR90': return { minX: -y2, maxX: -y1, minY: -x2, maxY: -x1 };
    default: throw new Error(`Unsupported orientation for ${instance.id}`);
  }
};

export const getPhysicalBounds = (instance: AlignableInstance): PhysicalBounds => {
  assertInstance(instance);
  const local = getLocalBounds(instance);
  const left = instance.x + local.minX;
  const right = instance.x + local.maxX;
  const bottom = instance.y + local.minY;
  const top = instance.y + local.maxY;
  return {
    left,
    right,
    bottom,
    top,
    centerX: (left + right) / 2,
    centerY: (bottom + top) / 2,
    width: right - left,
    height: top - bottom,
  };
};

export const getAlignmentEdgeAxis = (edge: AlignmentEdge): DistributionAxis => (
  edge === 'left' || edge === 'right' || edge === 'horizontal-center'
    ? 'horizontal'
    : 'vertical'
);

export const getEdgeCoordinate = (bounds: PhysicalBounds, edge: AlignmentEdge) => {
  if (edge === 'left') return bounds.left;
  if (edge === 'right') return bounds.right;
  if (edge === 'bottom') return bounds.bottom;
  if (edge === 'top') return bounds.top;
  if (edge === 'horizontal-center') return bounds.centerX;
  return bounds.centerY;
};

const validateOptions = (options: ArrangementOptions) => {
  assertFinitePositive(options.topWidth, 'Top-cell width');
  assertFinitePositive(options.topHeight, 'Top-cell height');
  assertFinitePositive(options.gridSize, 'Grid size');
};

const snapWithin = (value: number, min: number, max: number, grid: number) => {
  const minStep = Math.ceil((min - EPSILON) / grid);
  const maxStep = Math.floor((max + EPSILON) / grid);
  if (minStep > maxStep) {
    throw new RangeError('No grid-snapped position fits inside the top-cell bounds');
  }
  const step = Math.max(minStep, Math.min(Math.round(value / grid), maxStep));
  return snapToGrid(step * grid, grid);
};

const placeInsideTop = (
  instance: AlignableInstance,
  targetX: number,
  targetY: number,
  options: ArrangementOptions,
): InstancePosition => {
  if (options.unbounded) {
    const sx = snapToGrid(targetX, options.gridSize);
    const sy = snapToGrid(targetY, options.gridSize);
    return {
      id: instance.id,
      x: Object.is(sx, -0) ? 0 : sx,
      y: Object.is(sy, -0) ? 0 : sy,
    };
  }
  const local = getLocalBounds(instance);
  const halfTopWidth = options.topWidth / 2;
  const halfTopHeight = options.topHeight / 2;
  const minX = -halfTopWidth - local.minX;
  const maxX = halfTopWidth - local.maxX;
  const minY = -halfTopHeight - local.minY;
  const maxY = halfTopHeight - local.maxY;
  if (minX > maxX + EPSILON || minY > maxY + EPSILON) {
    throw new RangeError(`Instance ${instance.id} is larger than the top cell`);
  }
  return {
    id: instance.id,
    x: snapWithin(targetX, minX, maxX, options.gridSize),
    y: snapWithin(targetY, minY, maxY, options.gridSize),
  };
};

/**
 * Moves one source block by constraining one of its physical edges to an edge
 * on a fixed target block. Edges must be on the same axis. The signed offset is
 * expressed in world coordinates: positive is right for horizontal edges and
 * up for vertical edges.
 *
 * The equation is exact: sourceEdge = targetEdge + offset. If that coordinate
 * cannot be represented by a grid-snapped source origin inside the top cell,
 * this function throws instead of silently rounding to a different alignment.
 */
export const alignInstanceToTarget = (
  source: AlignableInstance,
  target: AlignableInstance,
  sourceEdge: AlignmentEdge,
  targetEdge: AlignmentEdge,
  offset: number,
  options: ArrangementOptions,
): InstancePosition => {
  validateOptions(options);
  if (source.id === target.id) {
    throw new Error('Source and target must be different instances');
  }
  if (!Number.isFinite(offset)) {
    throw new RangeError('Alignment offset must be finite');
  }
  const axis = getAlignmentEdgeAxis(sourceEdge);
  if (axis !== getAlignmentEdgeAxis(targetEdge)) {
    throw new Error('Source and target edges must be on the same axis');
  }
  const targetBounds = getPhysicalBounds(target);
  return alignInstanceToCoordinate(
    source,
    sourceEdge,
    getEdgeCoordinate(targetBounds, targetEdge),
    offset,
    options,
  );
};

/** Aligns one physical source edge to an explicit X or Y reference coordinate. */
export const alignInstanceToCoordinate = (
  source: AlignableInstance,
  sourceEdge: AlignmentEdge,
  targetCoordinate: number,
  offset: number,
  options: ArrangementOptions,
): InstancePosition => {
  validateOptions(options);
  if (!Number.isFinite(targetCoordinate)) throw new RangeError('Alignment reference coordinate must be finite');
  if (!Number.isFinite(offset)) throw new RangeError('Alignment offset must be finite');
  const axis = getAlignmentEdgeAxis(sourceEdge);
  const sourceBounds = getPhysicalBounds(source);
  const desiredCoordinate = targetCoordinate + offset;
  const sourceCoordinate = getEdgeCoordinate(sourceBounds, sourceEdge);
  const delta = desiredCoordinate - sourceCoordinate;
  const position = placeInsideTop(
    source,
    axis === 'horizontal' ? source.x + delta : source.x,
    axis === 'vertical' ? source.y + delta : source.y,
    options,
  );
  const perpendicularWasChanged = axis === 'horizontal'
    ? Math.abs(position.y - source.y) > EPSILON
    : Math.abs(position.x - source.x) > EPSILON;
  if (perpendicularWasChanged) {
    throw new RangeError(
      `Cannot align ${source.id} without changing its perpendicular coordinate to satisfy grid or top-cell bounds`,
    );
  }
  const movedBounds = getPhysicalBounds({ ...source, ...position });
  const actualCoordinate = getEdgeCoordinate(movedBounds, sourceEdge);
  if (Math.abs(actualCoordinate - desiredCoordinate) > EPSILON) {
    throw new RangeError(
      `Cannot place ${source.id} at the requested edge offset while keeping it on-grid and inside the top cell`,
    );
  }
  return position;
};

/**
 * Aligns displayed (transformed) block bounds to one fixed reference block,
 * optionally offset by `distance` (default 0):
 * - `left` / `bottom`: target = anchorEdge + distance (inward / positive)
 * - `right` / `top`: target = anchorEdge - distance (inward from max edge)
 * - `horizontal-center` / `vertical-center`: target = anchorCenter + distance
 * The explicit anchorId is used when provided; otherwise the first item is the anchor.
 */
export const alignInstances = (
  instances: readonly AlignableInstance[],
  operation: AlignmentOperation,
  options: ArrangementOptions,
  distance = 0,
): InstancePosition[] => {
  validateOptions(options);
  if (!Number.isFinite(distance)) {
    throw new RangeError('Alignment distance must be a finite number');
  }
  if (instances.length < 2) return instances.map(({ id, x, y }) => ({ id, x, y }));

  const entries = instances.map(instance => ({ instance, bounds: getPhysicalBounds(instance) }));
  const anchor = entries.find(entry => entry.instance.id === options.anchorId) ?? entries[0];
  // Validate that the fixed reference itself is physically compatible with the top cell.
  placeInsideTop(anchor.instance, anchor.instance.x, anchor.instance.y, options);
  let target = 0;
  if (operation === 'left') target = anchor.bounds.left + distance;
  else if (operation === 'right') target = anchor.bounds.right - distance;
  else if (operation === 'bottom') target = anchor.bounds.bottom + distance;
  else if (operation === 'top') target = anchor.bounds.top - distance;
  else if (operation === 'horizontal-center') target = anchor.bounds.centerX + distance;
  else target = anchor.bounds.centerY + distance;

  return entries.map(({ instance, bounds }) => {
    if (instance.id === anchor.instance.id) {
      return { id: instance.id, x: instance.x, y: instance.y };
    }
    let x = instance.x;
    let y = instance.y;
    if (operation === 'left') x += target - bounds.left;
    else if (operation === 'right') x += target - bounds.right;
    else if (operation === 'bottom') y += target - bounds.bottom;
    else if (operation === 'top') y += target - bounds.top;
    else if (operation === 'horizontal-center') x += target - bounds.centerX;
    else y += target - bounds.centerY;
    const position = placeInsideTop(instance, x, y, options);
    const alignedBounds = getPhysicalBounds({ ...instance, ...position });
    const actual = operation === 'left' ? alignedBounds.left
      : operation === 'right' ? alignedBounds.right
      : operation === 'bottom' ? alignedBounds.bottom
      : operation === 'top' ? alignedBounds.top
      : operation === 'horizontal-center' ? alignedBounds.centerX
      : alignedBounds.centerY;
    if (Math.abs(actual - target) > 1e-6) {
      throw new RangeError(`Cannot align ${instance.id} to the reference edge while keeping it on-grid and inside the top cell`);
    }
    return position;
  });
};

/**
 * Places two or more blocks sequentially along `axis` with an exact edge-to-edge
 * spacing `gap` (default 0 = abut flush). The anchor block (`options.anchorId`,
 * or the leading block if omitted) remains fixed while neighbors pack cleanly
 * outward on both sides of it.
 */
export const spaceInstances = (
  instances: readonly AlignableInstance[],
  axis: DistributionAxis,
  options: ArrangementOptions,
  gap = 0,
): InstancePosition[] => {
  validateOptions(options);
  if (!Number.isFinite(gap)) {
    throw new RangeError('Spacing distance must be a finite number');
  }
  if (instances.length < 2) return instances.map(({ id, x, y }) => ({ id, x, y }));

  const horizontal = axis === 'horizontal';
  const entries = instances
    .map(instance => ({ instance, bounds: getPhysicalBounds(instance) }))
    .sort((a, b) => {
      const aMin = horizontal ? a.bounds.left : a.bounds.bottom;
      const bMin = horizontal ? b.bounds.left : b.bounds.bottom;
      if (Math.abs(aMin - bMin) > EPSILON) return aMin - bMin;
      const aCenter = horizontal ? a.bounds.centerX : a.bounds.centerY;
      const bCenter = horizontal ? b.bounds.centerX : b.bounds.centerY;
      return aCenter - bCenter || a.instance.id.localeCompare(b.instance.id);
    });

  const anchorIndex = Math.max(
    0,
    entries.findIndex(entry => entry.instance.id === options.anchorId),
  );
  const anchor = entries[anchorIndex];
  placeInsideTop(anchor.instance, anchor.instance.x, anchor.instance.y, options);

  const positions = new Map<string, InstancePosition>();
  positions.set(anchor.instance.id, { id: anchor.instance.id, x: anchor.instance.x, y: anchor.instance.y });

  // Place blocks after anchor moving forward (+X / +Y)
  let prevMax = horizontal ? anchor.bounds.right : anchor.bounds.top;
  for (let i = anchorIndex + 1; i < entries.length; i += 1) {
    const { instance, bounds } = entries[i];
    const desiredMin = prevMax + gap;
    const currentMin = horizontal ? bounds.left : bounds.bottom;
    const delta = desiredMin - currentMin;
    const position = placeInsideTop(
      instance,
      horizontal ? instance.x + delta : instance.x,
      horizontal ? instance.y : instance.y + delta,
      options,
    );
    const movedBounds = getPhysicalBounds({ ...instance, ...position });
    const actualMin = horizontal ? movedBounds.left : movedBounds.bottom;
    if (Math.abs(actualMin - desiredMin) > 1e-6) {
      throw new RangeError(`Cannot space ${instance.id} at ${gap} um while keeping it on-grid and inside the top cell`);
    }
    positions.set(instance.id, position);
    prevMax = horizontal ? movedBounds.right : movedBounds.top;
  }

  // Place blocks before anchor moving backward (-X / -Y)
  let nextMin = horizontal ? anchor.bounds.left : anchor.bounds.bottom;
  for (let i = anchorIndex - 1; i >= 0; i -= 1) {
    const { instance, bounds } = entries[i];
    const desiredMax = nextMin - gap;
    const currentMax = horizontal ? bounds.right : bounds.top;
    const delta = desiredMax - currentMax;
    const position = placeInsideTop(
      instance,
      horizontal ? instance.x + delta : instance.x,
      horizontal ? instance.y : instance.y + delta,
      options,
    );
    const movedBounds = getPhysicalBounds({ ...instance, ...position });
    const actualMax = horizontal ? movedBounds.right : movedBounds.top;
    if (Math.abs(actualMax - desiredMax) > 1e-6) {
      throw new RangeError(`Cannot space ${instance.id} at ${gap} um while keeping it on-grid and inside the top cell`);
    }
    positions.set(instance.id, position);
    nextMin = horizontal ? movedBounds.left : movedBounds.bottom;
  }

  return instances.map(instance => positions.get(instance.id)!);
};

/**
 * Distributes physical gaps as equally as the grid allows while preserving the
 * two outermost blocks (assuming their existing anchors are already grid-snapped).
 * Overlapping selections receive an equal negative gap. With fewer than three
 * blocks distribution is intentionally a no-op.
 */
export const distributeInstances = (
  instances: readonly AlignableInstance[],
  axis: DistributionAxis,
  options: ArrangementOptions,
): InstancePosition[] => {
  validateOptions(options);
  if (instances.length < 3) return instances.map(({ id, x, y }) => ({ id, x, y }));

  const horizontal = axis === 'horizontal';
  const entries = instances
    .map(instance => ({ instance, bounds: getPhysicalBounds(instance) }))
    .sort((a, b) => {
      const aCenter = horizontal ? a.bounds.centerX : a.bounds.centerY;
      const bCenter = horizontal ? b.bounds.centerX : b.bounds.centerY;
      return aCenter - bCenter || a.instance.id.localeCompare(b.instance.id);
    });
  const firstEdge = horizontal ? entries[0].bounds.left : entries[0].bounds.bottom;
  const lastEdge = horizontal
    ? entries[entries.length - 1].bounds.right
    : entries[entries.length - 1].bounds.top;
  const totalSize = entries.reduce(
    (sum, entry) => sum + (horizontal ? entry.bounds.width : entry.bounds.height),
    0,
  );
  const gap = (lastEdge - firstEdge - totalSize) / (entries.length - 1);
  let cursor = firstEdge;
  const positions = new Map<string, InstancePosition>();

  entries.forEach(({ instance, bounds }) => {
    const currentLeadingEdge = horizontal ? bounds.left : bounds.bottom;
    const delta = cursor - currentLeadingEdge;
    const position = placeInsideTop(
      instance,
      horizontal ? instance.x + delta : instance.x,
      horizontal ? instance.y : instance.y + delta,
      options,
    );
    positions.set(instance.id, position);
    cursor += (horizontal ? bounds.width : bounds.height) + gap;
  });

  return instances.map(instance => positions.get(instance.id)!);
};
