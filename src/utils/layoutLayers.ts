import type { Cell, Instance, PixelArray } from '../store/useStore.ts';
import type { CadenceOrientation } from './alignment.ts';
import { getPhysicalBounds } from './alignment.ts';
import { snapToGrid } from './grid.ts';

export type LayoutTextFontFamily = 'stick' | 'mono' | 'sans' | 'serif';
export type LayoutTextFontStyle = 'normal' | 'bold' | 'italic' | 'bold italic';

export const LAYOUT_TEXT_FONT_FAMILIES: ReadonlyArray<{ value: LayoutTextFontFamily; label: string; skillFont: 'stick' | 'fixed' | 'swiss' | 'roman' }> = [
  { value: 'stick', label: 'Stick (CAD)', skillFont: 'stick' },
  { value: 'sans', label: 'Sans', skillFont: 'swiss' },
  { value: 'mono', label: 'Mono', skillFont: 'fixed' },
  { value: 'serif', label: 'Serif', skillFont: 'roman' },
] as const;

export const LAYOUT_TEXT_FONT_STYLES: ReadonlyArray<{ value: LayoutTextFontStyle; label: string }> = [
  { value: 'normal', label: 'Regular' },
  { value: 'bold', label: 'Bold' },
  { value: 'italic', label: 'Italic' },
  { value: 'bold italic', label: 'Bold Italic' },
] as const;

export type LayoutShape = {
  id: string;
  /** `'rect'` (default when omitted) or `'text'` (standalone Virtuoso text label / dbCreateLabel). */
  kind?: 'rect' | 'text';
  /** Cadence Virtuoso layer name (e.g. 'text', 'prBoundary', 'M1', 'M2', 'PO', 'OD'). */
  layer: string;
  /** Cadence Virtuoso purpose name (e.g. 'drawing', 'pin', 'label', 'net', 'boundary'). */
  purpose: string;
  /** Lower-left X coordinate in the cellview's local (0, 0) frame (um), grid-snapped. */
  x: number;
  /** Lower-left Y coordinate in the cellview's local (0, 0) frame (um), grid-snapped. */
  y: number;
  /** Width in um (> 0, grid-snapped). For text labels, estimated text bounding width. */
  width: number;
  /** Height in um (> 0, grid-snapped). For text labels, physical font height in um. */
  height: number;
  /** Optional custom display color override. */
  color?: string;
  /** For rect: optional centered label. For text: the displayed label string. */
  label?: string;
  /** For text labels: font height in um (matches Virtuoso Create Label Height). */
  fontSize?: number;
  /** For text labels: font family preset ('stick' | 'mono' | 'sans' | 'serif'). */
  fontFamily?: LayoutTextFontFamily;
  /** For text labels: font weight/style ('normal' | 'bold' | 'italic' | 'bold italic'). */
  fontStyle?: LayoutTextFontStyle;
  /** For text labels: Cadence orientation ('R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'). */
  orientation?: CadenceOrientation;
  /** Locked shapes resist canvas drag, resize, and deletion until unlocked. */
  locked?: boolean;
};

export const isTextShape = (shape: Pick<LayoutShape, 'kind'>): boolean => shape.kind === 'text';

/**
 * Formats a Virtuoso Layer/Purpose Pair concisely for display labels, pills, and tooltips.
 * Omits the default `drawing` purpose (e.g. `text/drawing` -> `text`, `M1/drawing` -> `M1`)
 * while preserving non-default purposes (`M1/pin`, `text/label`).
 */
export const formatLppLabel = (layer: string, purpose?: string): string => {
  const cleanLayer = layer.trim() || 'text';
  const cleanPurpose = (purpose ?? '').trim();
  if (!cleanPurpose || cleanPurpose.toLowerCase() === 'drawing') {
    return cleanLayer;
  }
  return `${cleanLayer}/${cleanPurpose}`;
};

export const resolveTextFontFamilyCss = (family: LayoutTextFontFamily = 'stick'): string => {
  switch (family) {
    case 'sans':
      return "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', sans-serif";
    case 'mono':
      return "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace";
    case 'serif':
      return "Georgia, 'Times New Roman', Cambria, serif";
    case 'stick':
    default:
      return "'SF Mono', 'Consolas', 'Courier New', ui-monospace, monospace";
  }
};

export const resolveTextSkillFont = (family: LayoutTextFontFamily = 'stick'): 'stick' | 'fixed' | 'swiss' | 'roman' => (
  LAYOUT_TEXT_FONT_FAMILIES.find(item => item.value === family)?.skillFont ?? 'stick'
);

/**
 * Estimates the physical bounding width & height (in um) of a Virtuoso text label
 * so hit-testing, selection frames, and cell auto-bounds tightly fit the drawn text.
 */
export const estimateTextBoxSize = (
  text: string,
  fontSize: number,
  fontFamily: LayoutTextFontFamily = 'stick',
  fontStyle: LayoutTextFontStyle = 'normal',
  gridSize = 0.005,
): { width: number; height: number } => {
  const safeHeight = Math.max(gridSize, snapToGrid(fontSize, gridSize));
  const lines = text.split(/\r?\n/);
  const longestChars = Math.max(1, ...lines.map(line => line.length));
  const charRatio = fontFamily === 'sans'
    ? 0.58
    : fontFamily === 'serif'
      ? 0.56
      : 0.62;
  const boldFactor = fontStyle.includes('bold') ? 1.07 : 1;
  const rawWidth = Math.max(safeHeight * 0.6, longestChars * safeHeight * charRatio * boldFactor);
  const rawHeight = lines.length > 1 ? safeHeight * (1 + (lines.length - 1) * 1.2) : safeHeight;
  return {
    width: Math.max(gridSize, snapToGrid(rawWidth, gridSize)),
    height: Math.max(gridSize, snapToGrid(rawHeight, gridSize)),
  };
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
  { layer: 'text', purpose: 'drawing', shortLabel: 'text', color: '#06b6d4', fillOpacity: 0.22, strokeDash: 'solid' },
  { layer: 'text', purpose: 'label', shortLabel: 'text/lbl', color: '#0891b2', fillOpacity: 0.2, strokeDash: 'solid' },
  { layer: 'prBoundary', purpose: 'drawing', shortLabel: 'prBnd', color: '#6366f1', fillOpacity: 0.12, strokeDash: 'dashed' },
  { layer: 'M1', purpose: 'drawing', shortLabel: 'M1', color: '#2563eb', fillOpacity: 0.3, strokeDash: 'solid' },
  { layer: 'M2', purpose: 'drawing', shortLabel: 'M2', color: '#ef4444', fillOpacity: 0.28, strokeDash: 'solid' },
  { layer: 'M3', purpose: 'drawing', shortLabel: 'M3', color: '#16a34a', fillOpacity: 0.28, strokeDash: 'solid' },
  { layer: 'M4', purpose: 'drawing', shortLabel: 'M4', color: '#f59e0b', fillOpacity: 0.28, strokeDash: 'solid' },
  { layer: 'M5', purpose: 'drawing', shortLabel: 'M5', color: '#9333ea', fillOpacity: 0.26, strokeDash: 'solid' },
  { layer: 'AP', purpose: 'drawing', shortLabel: 'AP', color: '#ec4899', fillOpacity: 0.24, strokeDash: 'solid' },
  { layer: 'PO', purpose: 'drawing', shortLabel: 'PO', color: '#dc2626', fillOpacity: 0.3, strokeDash: 'solid' },
  { layer: 'OD', purpose: 'drawing', shortLabel: 'OD', color: '#059669', fillOpacity: 0.26, strokeDash: 'solid' },
  { layer: 'NW', purpose: 'drawing', shortLabel: 'NW', color: '#b45309', fillOpacity: 0.16, strokeDash: 'dashed' },
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
    if (shape.orientation && shape.orientation !== 'R0') {
      const bounds = getPhysicalBounds({
        id: shape.id,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        orientation: shape.orientation,
      });
      include(bounds.left, bounds.bottom, bounds.right, bounds.top);
    } else {
      include(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height);
    }
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
