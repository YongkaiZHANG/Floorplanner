import type { Cell, Instance, PixelArray } from '../store/useStore.ts';
import { getPhysicalBounds } from './alignment.ts';
import { snapToGrid } from './grid.ts';

export type LayoutShape = {
  id: string;
  /** Cadence Virtuoso layer name (e.g. 'text', 'prBoundary', 'M1', 'M2', 'PO', 'OD'). */
  layer: string;
  /** Cadence Virtuoso purpose name (e.g. 'drawing', 'pin', 'label', 'net', 'boundary'). */
  purpose: string;
  /** Lower-left X coordinate in the cellview's local (0, 0) frame (um), grid-snapped. */
  x: number;
  /** Lower-left Y coordinate in the cellview's local (0, 0) frame (um), grid-snapped. */
  y: number;
  /** Width in um (> 0, grid-snapped). */
  width: number;
  /** Height in um (> 0, grid-snapped). */
  height: number;
  /** Optional custom display color override. */
  color?: string;
  /** Optional text label rendered centered on the rectangle and exported via dbCreateLabel. */
  label?: string;
  /** Locked shapes resist canvas drag, resize, and deletion until unlocked. */
  locked?: boolean;
};

export type LayerPreset = {
  layer: string;
  purpose: string;
  shortLabel: string;
  color: string;
  fillOpacity: number;
  strokeDash: 'solid' | 'dashed';
};

export const VIRTUOSO_LAYER_PRESETS: readonly LayerPreset[] = [
  { layer: 'text', purpose: 'drawing', shortLabel: 'text/drw', color: '#06b6d4', fillOpacity: 0.22, strokeDash: 'solid' },
  { layer: 'prBoundary', purpose: 'drawing', shortLabel: 'prBnd/drw', color: '#6366f1', fillOpacity: 0.12, strokeDash: 'dashed' },
  { layer: 'M1', purpose: 'drawing', shortLabel: 'M1/drw', color: '#2563eb', fillOpacity: 0.3, strokeDash: 'solid' },
  { layer: 'M2', purpose: 'drawing', shortLabel: 'M2/drw', color: '#ef4444', fillOpacity: 0.28, strokeDash: 'solid' },
  { layer: 'M3', purpose: 'drawing', shortLabel: 'M3/drw', color: '#16a34a', fillOpacity: 0.28, strokeDash: 'solid' },
  { layer: 'M4', purpose: 'drawing', shortLabel: 'M4/drw', color: '#f59e0b', fillOpacity: 0.28, strokeDash: 'solid' },
  { layer: 'M5', purpose: 'drawing', shortLabel: 'M5/drw', color: '#9333ea', fillOpacity: 0.26, strokeDash: 'solid' },
  { layer: 'AP', purpose: 'drawing', shortLabel: 'AP/drw', color: '#ec4899', fillOpacity: 0.24, strokeDash: 'solid' },
  { layer: 'PO', purpose: 'drawing', shortLabel: 'PO/drw', color: '#dc2626', fillOpacity: 0.3, strokeDash: 'solid' },
  { layer: 'OD', purpose: 'drawing', shortLabel: 'OD/drw', color: '#059669', fillOpacity: 0.26, strokeDash: 'solid' },
  { layer: 'NW', purpose: 'drawing', shortLabel: 'NW/drw', color: '#b45309', fillOpacity: 0.16, strokeDash: 'dashed' },
] as const;

const FALLBACK_COLORS = [
  '#0284c7', '#0891b2', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#9333ea', '#4f46e5',
];

export const resolveLayerStyle = (
  layer: string,
  purpose: string,
  customColor?: string,
): { color: string; fillOpacity: number; strokeDash: 'solid' | 'dashed' } => {
  const normalizedLayer = layer.trim().toLowerCase();
  const normalizedPurpose = purpose.trim().toLowerCase();
  const matched = VIRTUOSO_LAYER_PRESETS.find(
    preset => preset.layer.toLowerCase() === normalizedLayer && preset.purpose.toLowerCase() === normalizedPurpose,
  ) ?? VIRTUOSO_LAYER_PRESETS.find(preset => preset.layer.toLowerCase() === normalizedLayer);

  if (matched) {
    return {
      color: customColor?.trim() || matched.color,
      fillOpacity: matched.fillOpacity,
      strokeDash: matched.strokeDash,
    };
  }

  let hash = 0;
  const key = `${normalizedLayer}:${normalizedPurpose}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const color = customColor?.trim() || FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
  const strokeDash = normalizedLayer.includes('boundary') || normalizedPurpose === 'boundary' ? 'dashed' : 'solid';
  return { color, fillOpacity: 0.24, strokeDash };
};

/**
 * Converts any two corner points into a normalized, grid-snapped rectangle.
 * Returns null if the resulting rectangle has zero width or zero height.
 */
export const normalizeRectFromPoints = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  snapStep: number,
  gridSize = snapStep,
): { x: number; y: number; width: number; height: number } | null => {
  const sx1 = snapToGrid(x1, snapStep);
  const sy1 = snapToGrid(y1, snapStep);
  const sx2 = snapToGrid(x2, snapStep);
  const sy2 = snapToGrid(y2, snapStep);
  const minX = Object.is(Math.min(sx1, sx2), -0) ? 0 : Math.min(sx1, sx2);
  const maxX = Object.is(Math.max(sx1, sx2), -0) ? 0 : Math.max(sx1, sx2);
  const minY = Object.is(Math.min(sy1, sy2), -0) ? 0 : Math.min(sy1, sy2);
  const maxY = Object.is(Math.max(sy1, sy2), -0) ? 0 : Math.max(sy1, sy2);
  const width = snapToGrid(maxX - minX, gridSize);
  const height = snapToGrid(maxY - minY, gridSize);
  if (width <= 1e-12 || height <= 1e-12) return null;
  return {
    x: snapToGrid(minX, gridSize),
    y: snapToGrid(minY, gridSize),
    width,
    height,
  };
};

export type CellContentBounds = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

/**
 * Computes the exact bounding box `[originX..originX+width] x [originY..originY+height]`
 * covering all drawn shapes, sub-instances, and optional pixel array in a cellview.
 */
export const computeCellContentBounds = (
  shapes: readonly LayoutShape[],
  instances: readonly Instance[],
  masterCells: Record<string, Cell>,
  pixelArray?: PixelArray | null,
): CellContentBounds | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  };

  for (const shape of shapes) {
    include(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height);
  }

  for (const inst of instances) {
    const master = masterCells[inst.cellId];
    if (!master) continue;
    const bounds = getPhysicalBounds({
      ...inst,
      width: master.width,
      height: master.height,
      originX: master.originX,
      originY: master.originY,
    });
    include(bounds.left, bounds.bottom, bounds.right, bounds.top);
  }

  if (pixelArray?.visible) {
    include(pixelArray.x, pixelArray.y, pixelArray.x + pixelArray.width, pixelArray.y + pixelArray.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return null;
  }

  const normalizeZero = (value: number) => (Object.is(value, -0) ? 0 : value);
  return {
    originX: normalizeZero(minX),
    originY: normalizeZero(minY),
    width: maxX - minX,
    height: maxY - minY,
  };
};
