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

export type DistributionAxis = 'horizontal' | 'vertical';

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Aligns displayed (transformed) block bounds. The conventional group edge or
 * group-bounds center is used unless that target cannot fit every selected block,
 * in which case the closest common in-bounds target is used.
 */
export const alignInstances = (
  instances: readonly AlignableInstance[],
  operation: AlignmentOperation,
  options: ArrangementOptions,
): InstancePosition[] => {
  validateOptions(options);
  if (instances.length < 2) return instances.map(({ id, x, y }) => ({ id, x, y }));

  const entries = instances.map(instance => ({ instance, bounds: getPhysicalBounds(instance) }));
  const halfW = options.topWidth / 2;
  const halfH = options.topHeight / 2;
  const groupLeft = Math.min(...entries.map(entry => entry.bounds.left));
  const groupRight = Math.max(...entries.map(entry => entry.bounds.right));
  const groupBottom = Math.min(...entries.map(entry => entry.bounds.bottom));
  const groupTop = Math.max(...entries.map(entry => entry.bounds.top));

  let target = 0;
  if (operation === 'left') {
    target = clamp(groupLeft, -halfW, halfW - Math.max(...entries.map(entry => entry.bounds.width)));
  } else if (operation === 'right') {
    target = clamp(groupRight, -halfW + Math.max(...entries.map(entry => entry.bounds.width)), halfW);
  } else if (operation === 'bottom') {
    target = clamp(groupBottom, -halfH, halfH - Math.max(...entries.map(entry => entry.bounds.height)));
  } else if (operation === 'top') {
    target = clamp(groupTop, -halfH + Math.max(...entries.map(entry => entry.bounds.height)), halfH);
  } else if (operation === 'horizontal-center') {
    const minCenter = Math.max(...entries.map(entry => -halfW + entry.bounds.width / 2));
    const maxCenter = Math.min(...entries.map(entry => halfW - entry.bounds.width / 2));
    target = clamp((groupLeft + groupRight) / 2, minCenter, maxCenter);
  } else {
    const minCenter = Math.max(...entries.map(entry => -halfH + entry.bounds.height / 2));
    const maxCenter = Math.min(...entries.map(entry => halfH - entry.bounds.height / 2));
    target = clamp((groupBottom + groupTop) / 2, minCenter, maxCenter);
  }

  return entries.map(({ instance, bounds }) => {
    let x = instance.x;
    let y = instance.y;
    if (operation === 'left') x += target - bounds.left;
    else if (operation === 'right') x += target - bounds.right;
    else if (operation === 'bottom') y += target - bounds.bottom;
    else if (operation === 'top') y += target - bounds.top;
    else if (operation === 'horizontal-center') x += target - bounds.centerX;
    else y += target - bounds.centerY;
    return placeInsideTop(instance, x, y, options);
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
