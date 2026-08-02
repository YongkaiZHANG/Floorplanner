export type SnapEdgeAxis = 'horizontal' | 'vertical';

export type RulerPoint = {
  x: number;
  y: number;
  snapEdgeAxis?: SnapEdgeAxis;
};

/**
 * Locks an orthogonal ruler to the normal of two matching snapped edges.
 * This lets two vertical edges report their X separation, and two horizontal
 * edges report their Y separation, even when the objects do not overlap.
 */
export const resolveOrthogonalRulerEnd = (
  start: RulerPoint,
  end: RulerPoint,
  orthogonal: boolean,
): Pick<RulerPoint, 'x' | 'y'> => {
  if (!orthogonal) return { x: end.x, y: end.y };

  if (start.snapEdgeAxis === 'vertical' && end.snapEdgeAxis === 'vertical') {
    return { x: end.x, y: start.y };
  }
  if (start.snapEdgeAxis === 'horizontal' && end.snapEdgeAxis === 'horizontal') {
    return { x: start.x, y: end.y };
  }

  return Math.abs(end.x - start.x) > Math.abs(end.y - start.y)
    ? { x: end.x, y: start.y }
    : { x: start.x, y: end.y };
};
