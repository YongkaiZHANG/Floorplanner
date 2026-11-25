import type { AppMode } from '../store/useStore.ts';
import { snapToGrid } from './grid.ts';

export type CanvasCursorState = {
  appMode: AppMode;
  edgeAlignmentActive: boolean;
  isPanning: boolean;
  isSpaceDown: boolean;
  isRegionZooming?: boolean;
};

/**
 * Resolves the native CSS cursor for the floorplan canvas.
 * Normal select mode uses the standard arrow pointer (`default`) instead of a hand;
 * hand cursors appear strictly while panning (`grabbing`) or holding Space (`grab`),
 * and `zoom-in` appears while dragging a Cadence right-mouse-button zoom region.
 */
export const resolveCanvasCursor = (state: CanvasCursorState): string => {
  if (state.isPanning) return 'grabbing';
  if (state.isRegionZooming) return 'zoom-in';
  if (state.isSpaceDown) return 'grab';
  if (
    state.edgeAlignmentActive
    || state.appMode === 'measure'
    || state.appMode === 'place'
    || state.appMode === 'pixel-array'
    || state.appMode === 'rect'
    || state.appMode === 'text'
    || state.appMode === 'stretch'
  ) {
    return 'crosshair';
  }
  return 'default';
};

export type DisplayGridMetrics = {
  /** Minor visual grid spacing in um; always equal to the user-defined `gridSize` (never changes on zoom). */
  minorStep: number;
  /** Major visual grid spacing in um (`5 * gridSize`); never changes on zoom. */
  majorStep: number;
  /** Integer multiplier `minorStep / gridSize` (always 1 — zoom-invariant). */
  multiplier: number;
  /** True when zoom is close enough to render minor `gridSize` lines cleanly (>= 6px apart). */
  showMinorLines: boolean;
  /** True when zoom is close enough to render major `5 * gridSize` lines cleanly (>= 8px apart). */
  showMajorLines: boolean;
  /** True when zoom is close enough to display fine Virtuoso dots at exact `gridSize` (>= 12px apart). */
  showFineDots: boolean;
};

/**
 * Computes Cadence Virtuoso-style fixed display grid metrics.
 * The grid spacing is ALWAYS fixed to the user-defined `gridSize` (and major `5 * gridSize`)
 * and never changes when zooming in or out; lines and dots simply hide when zoomed out
 * too far to render legibly without sub-pixel clutter.
 */
export const computeDisplayGridStep = (
  gridSize: number,
  stageScale: number,
  scaleFactor: number,
  _topWidth?: number,
  _topHeight?: number,
  minMinorSpacingPx = 6,
  minMajorSpacingPx = 8,
): DisplayGridMetrics => {
  void _topWidth;
  void _topHeight;
  const safeGrid = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 0.005;
  const safeScale = Number.isFinite(stageScale) && stageScale > 0 ? stageScale : 1;
  const safeFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  const minorStep = snapToGrid(safeGrid, safeGrid);
  const majorStep = snapToGrid(minorStep * 5, safeGrid);
  const minorSpacingPx = minorStep * safeFactor * safeScale;
  const majorSpacingPx = majorStep * safeFactor * safeScale;

  return {
    minorStep,
    majorStep,
    multiplier: 1,
    showMinorLines: minorSpacingPx >= minMinorSpacingPx,
    showMajorLines: majorSpacingPx >= minMajorSpacingPx,
    showFineDots: minorSpacingPx >= 12,
  };
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
 * Always locked to the user-defined `gridSize` regardless of zoom level.
 */
export const resolveActiveSnapStep = (
  gridSize: number,
  _displayMinorStep: number,
  _snapToVisibleGrid: boolean,
): number => {
  void _displayMinorStep;
  void _snapToVisibleGrid;
  return Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 0.005;
};
