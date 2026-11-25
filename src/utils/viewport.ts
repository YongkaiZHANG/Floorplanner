export type ArrowPanKey = 'arrowleft' | 'arrowright' | 'arrowup' | 'arrowdown';

export type ViewportPosition = { x: number; y: number };

export type ZoomRegionBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type ZoomViewportResult = {
  scale: number;
  position: ViewportPosition;
};

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

/**
 * Computes the Konva Stage scale and Y-up position (`scaleY = -scale`) that frames
 * a Base-View region (`minX..maxX`, `minY..maxY` in micrometers) cleanly inside the canvas.
 * Matches Cadence Virtuoso right-mouse-button drag-to-zoom-region behavior.
 */
export const computeRegionZoomViewport = (
  region: ZoomRegionBox,
  viewportWidth: number,
  viewportHeight: number,
  scaleFactor: number,
  minScale: number,
  maxScale: number,
  paddingFraction = 0.94,
): ZoomViewportResult | null => {
  if (
    !Number.isFinite(viewportWidth) || viewportWidth <= 0
    || !Number.isFinite(viewportHeight) || viewportHeight <= 0
    || !Number.isFinite(scaleFactor) || scaleFactor <= 0
  ) {
    return null;
  }

  const minX = Math.min(region.minX, region.maxX);
  const maxX = Math.max(region.minX, region.maxX);
  const minY = Math.min(region.minY, region.maxY);
  const maxY = Math.max(region.minY, region.maxY);
  const boxW = (maxX - minX) * scaleFactor;
  const boxH = (maxY - minY) * scaleFactor;
  if (boxW <= 1e-9 && boxH <= 1e-9) return null;

  const pad = Math.max(0.1, Math.min(1, paddingFraction));
  const scaleX = boxW > 1e-9 ? (viewportWidth * pad) / boxW : maxScale;
  const scaleY = boxH > 1e-9 ? (viewportHeight * pad) / boxH : maxScale;
  const scale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));
  const centerX = ((minX + maxX) / 2) * scaleFactor;
  const centerY = ((minY + maxY) / 2) * scaleFactor;

  return {
    scale,
    position: {
      x: viewportWidth / 2 - centerX * scale,
      y: viewportHeight / 2 + centerY * scale,
    },
  };
};
