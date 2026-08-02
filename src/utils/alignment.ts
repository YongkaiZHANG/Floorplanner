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

export const HORIZONTAL_ALIGNMENT_EDGES = ['left', 'horizontal-center', 'right'] as const;
export const VERTICAL_ALIGNMENT_EDGES = ['bottom', 'vertical-center', 'top'] as const;

export interface AlignableInstance {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Runtime-validated so it can accept the store's current string field directly. */
  orientation: string;
}

export interface ArrangementOptions {
  topWidth: number;
  topHeight: number;
  gridSize: number;
  /** The reference block that must remain fixed while the others move. */
  anchorId?: string;
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
  const { width: w, height: h } = instance;
  switch (instance.orientation) {
    case 'R0': return { minX: 0, maxX: w, minY: 0, maxY: h };
    case 'R90': return { minX: -h, maxX: 0, minY: 0, maxY: w };
    case 'R180': return { minX: -w, maxX: 0, minY: -h, maxY: 0 };
    case 'R270': return { minX: 0, maxX: h, minY: -w, maxY: 0 };
    case 'MX': return { minX: 0, maxX: w, minY: -h, maxY: 0 };
    case 'MY': return { minX: -w, maxX: 0, minY: 0, maxY: h };
    case 'MXR90': return { minX: 0, maxX: h, minY: 0, maxY: w };
    case 'MYR90': return { minX: -h, maxX: 0, minY: -w, maxY: 0 };
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
  return step * grid;
};

const placeInsideTop = (
  instance: AlignableInstance,
  targetX: number,
  targetY: number,
  options: ArrangementOptions,
): InstancePosition => {
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

  const sourceBounds = getPhysicalBounds(source);
  const targetBounds = getPhysicalBounds(target);
  const desiredCoordinate = getEdgeCoordinate(targetBounds, targetEdge) + offset;
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
 * Aligns displayed (transformed) block bounds to one fixed reference block.
 * The explicit anchorId is used when provided; otherwise the first item is the anchor.
 */
export const alignInstances = (
  instances: readonly AlignableInstance[],
  operation: AlignmentOperation,
  options: ArrangementOptions,
): InstancePosition[] => {
  validateOptions(options);
  if (instances.length < 2) return instances.map(({ id, x, y }) => ({ id, x, y }));

  const entries = instances.map(instance => ({ instance, bounds: getPhysicalBounds(instance) }));
  const anchor = entries.find(entry => entry.instance.id === options.anchorId) ?? entries[0];
  // Validate that the fixed reference itself is physically compatible with the top cell.
  placeInsideTop(anchor.instance, anchor.instance.x, anchor.instance.y, options);
  let target = 0;
  if (operation === 'left') target = anchor.bounds.left;
  else if (operation === 'right') target = anchor.bounds.right;
  else if (operation === 'bottom') target = anchor.bounds.bottom;
  else if (operation === 'top') target = anchor.bounds.top;
  else if (operation === 'horizontal-center') target = anchor.bounds.centerX;
  else target = anchor.bounds.centerY;

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
