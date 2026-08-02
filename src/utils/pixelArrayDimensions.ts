export type AxisAlignedBox = { minX: number; maxX: number; minY: number; maxY: number };
export type PixelArrayDimensionDirection = 'right' | 'left' | 'top' | 'bottom';
export type PixelArrayDimensionKind = 'gap' | 'inside' | 'overlap';

export type PixelArrayEdgeMeasurement = {
  direction: PixelArrayDimensionDirection;
  distance: number;
  arrayCoordinate: number;
  projectionStart: number;
  projectionEnd: number;
  kind: PixelArrayDimensionKind;
};

const EPSILON = 1e-9;

const positiveEdgeMeasurement = (
  sourceMin: number,
  sourceMax: number,
  arrayMin: number,
  arrayMax: number,
) => {
  if (arrayMin >= sourceMax - EPSILON) {
    return { distance: Math.max(0, arrayMin - sourceMax), arrayCoordinate: arrayMin, kind: 'gap' as const };
  }
  // The source enters the array through its minimum boundary. Measure the
  // penetration depth to the source's embedded positive edge.
  if (sourceMin < arrayMin - EPSILON && sourceMax > arrayMin + EPSILON && sourceMax <= arrayMax + EPSILON) {
    return { distance: sourceMax - arrayMin, arrayCoordinate: arrayMin, kind: 'overlap' as const };
  }
  // The complete source span is inside the array on this axis.
  if (sourceMin >= arrayMin - EPSILON && sourceMax <= arrayMax + EPSILON) {
    return { distance: arrayMax - sourceMax, arrayCoordinate: arrayMax, kind: 'inside' as const };
  }
  return null;
};

const negativeEdgeMeasurement = (
  sourceMin: number,
  sourceMax: number,
  arrayMin: number,
  arrayMax: number,
) => {
  if (arrayMax <= sourceMin + EPSILON) {
    return { distance: Math.max(0, sourceMin - arrayMax), arrayCoordinate: arrayMax, kind: 'gap' as const };
  }
  // The source enters the array through its maximum boundary. Measure the
  // penetration depth to the source's embedded negative edge.
  if (sourceMax > arrayMax + EPSILON && sourceMin < arrayMax - EPSILON && sourceMin >= arrayMin - EPSILON) {
    return { distance: arrayMax - sourceMin, arrayCoordinate: arrayMax, kind: 'overlap' as const };
  }
  if (sourceMin >= arrayMin - EPSILON && sourceMax <= arrayMax + EPSILON) {
    return { distance: sourceMin - arrayMin, arrayCoordinate: arrayMin, kind: 'inside' as const };
  }
  return null;
};

export const getIpPixelArrayEdgeMeasurements = (
  source: AxisAlignedBox,
  pixelArray: AxisAlignedBox,
): PixelArrayEdgeMeasurement[] => {
  const verticalStart = Math.max(source.minY, pixelArray.minY);
  const verticalEnd = Math.min(source.maxY, pixelArray.maxY);
  const horizontalStart = Math.max(source.minX, pixelArray.minX);
  const horizontalEnd = Math.min(source.maxX, pixelArray.maxX);
  const measurements: PixelArrayEdgeMeasurement[] = [];

  if (verticalEnd - verticalStart > EPSILON) {
    const right = positiveEdgeMeasurement(source.minX, source.maxX, pixelArray.minX, pixelArray.maxX);
    if (right && right.distance > EPSILON) measurements.push({ direction: 'right', ...right, projectionStart: verticalStart, projectionEnd: verticalEnd });
    const left = negativeEdgeMeasurement(source.minX, source.maxX, pixelArray.minX, pixelArray.maxX);
    if (left && left.distance > EPSILON) measurements.push({ direction: 'left', ...left, projectionStart: verticalStart, projectionEnd: verticalEnd });
  }

  if (horizontalEnd - horizontalStart > EPSILON) {
    const top = positiveEdgeMeasurement(source.minY, source.maxY, pixelArray.minY, pixelArray.maxY);
    if (top && top.distance > EPSILON) measurements.push({ direction: 'top', ...top, projectionStart: horizontalStart, projectionEnd: horizontalEnd });
    const bottom = negativeEdgeMeasurement(source.minY, source.maxY, pixelArray.minY, pixelArray.maxY);
    if (bottom && bottom.distance > EPSILON) measurements.push({ direction: 'bottom', ...bottom, projectionStart: horizontalStart, projectionEnd: horizontalEnd });
  }

  return measurements;
};
