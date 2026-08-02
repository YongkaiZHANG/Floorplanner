export type ArrowPanKey = 'arrowleft' | 'arrowright' | 'arrowup' | 'arrowdown';

export type ViewportPosition = { x: number; y: number };

/** Pan toward the requested view direction using a screen-pixel distance. */
export const panViewportByArrow = (
  position: ViewportPosition,
  key: ArrowPanKey,
  distance: number,
): ViewportPosition => {
  if (key === 'arrowleft') return { x: position.x + distance, y: position.y };
  if (key === 'arrowright') return { x: position.x - distance, y: position.y };
  if (key === 'arrowup') return { x: position.x, y: position.y + distance };
  return { x: position.x, y: position.y - distance };
};
