import type { AppMode } from '../store/useStore.ts';
import { snapToGrid } from './grid.ts';

export type CanvasCursorState = {
  appMode: AppMode;
  edgeAlignmentActive: boolean;
  isPanning: boolean;
  isSpaceDown: boolean;
};

/**
 * Resolves the native CSS cursor for the floorplan canvas.
 * Normal select mode uses the standard arrow pointer (`default`) instead of a hand;
 * hand cursors appear strictly while panning (`grabbing`) or holding Space (`grab`).
 */
export const resolveCanvasCursor = (state: CanvasCursorState): string => {
  if (state.isPanning) return 'grabbing';
  if (state.isSpaceDown) return 'grab';
  if (
    state.edgeAlignmentActive
    || state.appMode === 'measure'
    || state.appMode === 'place'
    || state.appMode === 'pixel-array'
    || state.appMode === 'rect'
    || state.appMode === 'stretch'
  ) {
    return 'crosshair';
  }
  return 'default';
};

export type DisplayGridMetrics = {
  /** Minor visual grid spacing in um; always an exact integer multiple of `gridSize`. */
  minorStep: number;
  /** Major visual grid spacing in um (`5 * minorStep`); exact integer multiple of `gridSize`. */
  majorStep: number;
  /** Integer multiplier `minorStep / gridSize`. */
  multiplier: number;
  /** True when the zoom level is close enough to display fine Virtuoso dots at exact `gridSize`. */
  showFineDots: boolean;
};

const NICE_MULTIPLIERS = [1, 2, 5] as const;

const nextNiceIntegerMultiplier = (minMultiplier: number): number => {
  const clamped = Math.max(1, minMultiplier);
  if (clamped <= 1) return 1;
  const power = Math.floor(Math.log10(clamped));
  const base = 10 ** power;
  for (const factor of NICE_MULTIPLIERS) {
    const candidate = factor * base;
    if (candidate + 1e-12 >= clamped) return Math.max(1, Math.round(candidate));
  }
  return Math.max(1, Math.round(10 * base));
};

/**
 * Computes a visual grid step that is guaranteed to be an exact integer multiple
 * of the user-defined `gridSize`, keeping drawn grid lines strictly aligned with
 * the placement grid while preventing overcrowded lines on large dies.
 */
export const computeDisplayGridStep = (
  gridSize: number,
  stageScale: number,
  scaleFactor: number,
  topWidth: number,
  topHeight: number,
  targetScreenSpacing = 40,
  maxLinesPerAxis = 120,
): DisplayGridMetrics => {
  const safeGrid = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 0.005;
  const safeScale = Number.isFinite(stageScale) && stageScale > 0 ? stageScale : 1;
  const safeFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  const rawStepByZoom = targetScreenSpacing / (safeFactor * safeScale);
  const rawStepByCount = Math.max(topWidth, topHeight) / Math.max(1, maxLinesPerAxis);
  const minRequiredStep = Math.max(safeGrid, rawStepByZoom, rawStepByCount);

  const multiplier = nextNiceIntegerMultiplier(minRequiredStep / safeGrid);
  const minorStep = snapToGrid(multiplier * safeGrid, safeGrid);
  const majorStep = snapToGrid(minorStep * 5, safeGrid);
  const fineSpacingPx = safeGrid * safeFactor * safeScale;
  const showFineDots = multiplier === 1 && fineSpacingPx >= 12;

  return { minorStep, majorStep, multiplier, showFineDots };
};

/** Snaps a 2D coordinate strictly to `step`, normalizing `-0` to `0`. */
export const snapPointToGrid = (x: number, y: number, step: number): { x: number; y: number } => {
  const sx = snapToGrid(x, step);
  const sy = snapToGrid(y, step);
  return {
    x: Object.is(sx, -0) ? 0 : sx,
    y: Object.is(sy, -0) ? 0 : sy,
  };
};

/**
 * Resolves the active interactive snap step.
 * Both modes remain exact multiples of the project's defined `gridSize`.
 */
export const resolveActiveSnapStep = (
  gridSize: number,
  displayMinorStep: number,
  snapToVisibleGrid: boolean,
): number => {
  if (!snapToVisibleGrid) return gridSize;
  return Number.isFinite(displayMinorStep) && displayMinorStep > 0 ? displayMinorStep : gridSize;
};
