import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { alignInstanceToCoordinate, alignInstanceToTarget, alignInstances, distributeInstances, getAlignmentEdgeAxis, getEdgeCoordinate, getPhysicalBounds, isActiveMosaic } from '../utils/alignment.ts';
import type { AlignmentEdge, AlignmentOperation, CadenceOrientation, DistributionAxis, InstanceMosaic, MoveConstraintMode } from '../utils/alignment.ts';
import type { ProjectSnapshot } from './projectDocument.ts';
import { recordHistory, redoHistory, undoHistory } from './projectHistory.ts';
import type { ProjectHistory } from './projectHistory.ts';
import { snapToGrid } from '../utils/grid.ts';
import {
  applyCadenceOrientationVector,
  applyCadenceTransformPoint,
  computeActiveToBaseTransform,
  invertCadenceTransform,
  wouldCreateHierarchyCycle,
} from '../utils/hierarchy.ts';
import type { CellViewContent, CellViewCoordinateMode } from '../utils/hierarchy.ts';
import { computeCellContentBounds, estimateTextBoxSize, formatLppLabel } from '../utils/layoutLayers.ts';
import type { LayoutShape, LayoutTextFontFamily, LayoutTextFontStyle } from '../utils/layoutLayers.ts';

export type { InstanceMosaic, MoveConstraintMode } from '../utils/alignment.ts';
export type { LayoutShape, LayoutTextFontFamily, LayoutTextFontStyle } from '../utils/layoutLayers.ts';

export type Instance = {
  id: string;
  cellId: string;
  name: string;
  x: number;
  y: number;
  orientation: string;
  /** Locked instances cannot be moved, rotated, aligned, or deleted until unlocked. */
  locked?: boolean;
  /** Optional Virtuoso mosaic array (rows × cols with local rowPitch ΔY and colPitch ΔX). */
  mosaic?: InstanceMosaic;
};

export type Cell = {
  id: string;
  libName: string;
  cellName: string;
  /** Local X coordinate of the cell's lower-left bounding box relative to cell origin (0, 0). Defaults to 0. */
  originX?: number;
  /** Local Y coordinate of the cell's lower-left bounding box relative to cell origin (0, 0). Defaults to 0. */
  originY?: number;
  width: number;
  height: number;
  color: string;
  /** Pads remain attached to the nearest top-cell edge when moved. */
  kind?: 'ip' | 'pad';
  /** Canvas/SVG planning appearance; Cadence display colors remain technology-controlled. */
  opacity?: number;
  outlineStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  /** When true, bounding box (originX, originY, width, height) automatically fits its drawn shapes & sub-instances. */
  autoBounds?: boolean;
};

export type Ruler = {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Optional snapped endpoint reached by a perpendicular display extension. */
  referenceX?: number;
  referenceY?: number;
};

export type PixelArray = {
  /** Bottom-left origin in top-cell coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type PixelArraySize = Pick<PixelArray, 'width' | 'height'>;
export type AppMode = 'select' | 'measure' | 'place' | 'pixel-array' | 'rect' | 'stretch' | 'text';

export type DescendContextFrame = {
  /** Parent cellview ID where the descended instance lives (`null` = root top cell). */
  parentCellId: string | null;
  /** Exact instance ID descended through (omitted from the dimmed backdrop so it isn't double-drawn). */
  instanceId: string;
  /** Child master cell ID opened by this descent step. */
  cellId: string;
  instanceName: string;
  x: number;
  y: number;
  orientation: string;
  parentCoordinateMode: CellViewCoordinateMode;
  parentWidth: number;
  parentHeight: number;
};

export type PadSide = 'top' | 'bottom' | 'left' | 'right';

export type PadRowConfig = {
  libName: string;
  cellName: string;
  width: number;
  height: number;
  color: string;
  count: number;
  pitch: number;
  side: PadSide;
  orientation?: string;
  /** Distance along the selected top-cell edge. */
  offset: number;
  /** `start` measures offset from the top-cell left/bottom edge to the first pad edge. */
  offsetReference?: 'center' | 'start';
};

export type PadMasterConfig = Pick<PadRowConfig, 'libName' | 'cellName' | 'width' | 'height' | 'color'> & {
  count?: number;
  pitch?: number;
  orientation?: string;
};

export type PendingManualPadGroup = {
  masterId: string;
  count: number;
  pitch: number;
};

export const PIXEL_ARRAY_ALIGNMENT_ID = '__pixel_array__';
export const SHAPE_ALIGNMENT_PREFIX = '__shape__:';
export const makeShapeAlignmentId = (shapeId: string): string => `${SHAPE_ALIGNMENT_PREFIX}${shapeId}`;
export const parseShapeAlignmentId = (alignmentId: string): string | null => (
  alignmentId.startsWith(SHAPE_ALIGNMENT_PREFIX)
    ? alignmentId.slice(SHAPE_ALIGNMENT_PREFIX.length)
    : null
);

export type EdgeAlignmentSession = {
  /** Every object that moves together. sourceId identifies the member whose edge was picked. */
  sourceIds: string[];
  sourceId: string;
  sourceEdge: AlignmentEdge | null;
  targetId: string | null;
  targetEdge: AlignmentEdge | null;
  /** Kept as text so intermediate decimal input remains editable. */
  offset: string;
};

export type PendingInstanceArray = {
  /** Optional custom name or prefix (e.g. "U_ADC" -> "U_ADC", or "U_ADC_0_0" for exploded arrays). */
  namePrefix?: string;
  rows: number;
  cols: number;
  deltaX: number;
  deltaY: number;
  /** When true, creates a single editable Virtuoso mosaic (dbCreateSimpleMosaic) instead of exploded instances. */
  asMosaic?: boolean;
};

export type PendingCopyGroup = {
  /** Anchor coordinate in active cellview space (also used for orthogonal copy guide & stepping). */
  anchorX: number;
  anchorY: number;
  /** Captured instances with offsets relative to (anchorX, anchorY). */
  instances: Array<{
    cellId: string;
    dx: number;
    dy: number;
    orientation: string;
    mosaic?: InstanceMosaic;
  }>;
  /** Captured rectangles & text labels with offsets relative to (anchorX, anchorY). */
  shapes: Array<Omit<LayoutShape, 'id' | 'locked' | 'x' | 'y'> & { dx: number; dy: number }>;
};

export type RootViewSnapshot = {
  topWidth: number;
  topHeight: number;
  topLibName: string;
  topCellName: string;
  padInset: number;
  instances: Instance[];
  rulers: Ruler[];
  shapes: LayoutShape[];
  pixelArray: PixelArray | null;
};

export type ProjectState = {
  gridSize: number;
  appMode: AppMode;
  
  topWidth: number;
  topHeight: number;
  topLibName: string;
  topCellName: string;
  /** Optional perimeter margin (um) reserved for seal ring / scribe line before edge pads. */
  padInset: number;
  /** All Virtuoso libraries defined in this project (including empty libraries). */
  libraries: string[];
  
  masterCells: Record<string, Cell>;
  instances: Instance[];
  rulers: Ruler[];
  /** Drawn rectangles on Virtuoso layer/purpose pairs inside the currently active cellview. */
  shapes: LayoutShape[];
  /** Coordinate frame of the active IP cellview ('origin' = native (0,0) Virtuoso canvas; 'centered' = legacy). */
  activeCoordinateMode: CellViewCoordinateMode;
  pixelArray: PixelArray | null;
  pendingPixelArraySize: PixelArraySize | null;
  /** Internal layouts for hierarchical master cells (keyed by master cell ID). */
  cellViews: Record<string, CellViewContent>;
  /** Currently open master cell ID on canvas, or null when editing the Top Cell. */
  activeCellId: string | null;
  /** Open Virtuoso cell view windows/tabs (null represents the Top Cell). */
  openViewIds: Array<string | null>;
  /** Single tabbed window vs side-by-side split Virtuoso cellview windows. */
  windowLayoutMode: 'tabs' | 'split';
  /** Hierarchy navigation stack of master cell IDs from top child to activeCellId. */
  viewBreadcrumb: string[];
  /** Virtuoso Edit-in-Place (X) instance descent stack recording parent context & transforms. */
  descendStack: DescendContextFrame[];
  /** When descended via X, render dimmed parent/top context behind the active cellview. */
  showEditInPlaceContext: boolean;
  /** Cadence Virtuoso Partial Select mode (F4): marquee & clicks select individual shape edges/corners. */
  partialSelectMode: boolean;
  /** Saved Top Cell state while descended into a master cell layout view. */
  rootView: RootViewSnapshot | null;
  
  selectedInstanceId: string | null;
  selectedInstanceIds: string[];
  selectedShapeId: string | null;
  pixelArraySelected: boolean;
  /** Active Virtuoso layer/purpose palette state for Create Rectangle tool. */
  activeDrawLayer: string;
  activeDrawPurpose: string;
  activeDrawLabel: string;
  activeDrawColor: string;
  /** Active Virtuoso Create Label (L) tool settings (default layer: text/drawing). */
  activeTextContent: string;
  activeTextFontSize: number;
  activeTextFontFamily: LayoutTextFontFamily;
  activeTextFontStyle: LayoutTextFontStyle;
  activeTextOrientation: CadenceOrientation;
  activeTextLayer: string;
  activeTextPurpose: string;
  activeTextColor: string;
  showCreateModal: boolean;
  showInstantiateModal: boolean;
  leftSidebarPinned: boolean;
  rightSidebarPinned: boolean;
  orthogonalRuler: boolean;
  /** Virtuoso Move constraint mode (`'orthogonal'` default, `'free'`, `'horizontal'`, `'vertical'`). */
  moveConstraint: MoveConstraintMode;
  showAutoDim: boolean;
  showOverlapDrc: boolean;
  showGrid: boolean;
  /** Transient HUD preference for displaying the fixed-grid snap badge as Vis vs Snap (always equal to gridSize). */
  snapToVisibleGrid: boolean;
  
  placementMasterId: string | null;
  placementOrientation: string;
  pendingInstanceArray: PendingInstanceArray | null;
  pendingManualPadGroup: PendingManualPadGroup | null;
  pendingCopyGroup: PendingCopyGroup | null;
  history: ProjectHistory;
  edgeAlignmentSession: EdgeAlignmentSession | null;
  lastAlignmentSpacing: string;
  clipboard: Instance[];
  shapeClipboard: LayoutShape[];
  clipboardWasCut: boolean;
  
  setGridSize: (size: number) => void;
  setAppMode: (mode: AppMode) => void;
  setTopDimensions: (w: number, h: number) => void;
  setTopNames: (lib: string, cell: string) => void;
  setTopConfig: (lib: string, cell: string, w: number, h: number, padInset?: number) => void;
  setPadInset: (inset: number) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowInstantiateModal: (show: boolean) => void;
  setLeftSidebarPinned: (pinned: boolean) => void;
  setRightSidebarPinned: (pinned: boolean) => void;
  setPlacement: (masterId: string | null, orientation?: string, arrayConfig?: PendingInstanceArray | null) => void;
  setPlacementOrientation: (orientation: string) => void;
  createLibrary: (libName: string, moveAllCells?: boolean) => void;
  renameLibrary: (oldName: string, newName: string) => void;
  deleteLibrary: (libName: string) => void;
  moveCellToLibrary: (cellId: string | null, targetLib: string) => void;
  moveAllCellsToLibrary: (targetLib: string) => void;
  openCellView: (cellId: string | null) => void;
  openCellViewInNewWindow: (cellId: string | null) => void;
  setWindowLayoutMode: (mode: 'tabs' | 'split') => void;
  closeCellViewTab: (cellId: string | null) => void;
  descendIntoInstance: (instanceId: string) => void;
  ascendToParent: () => void;
  navigateBreadcrumb: (index: number) => void;
  
  addMasterCell: (libName: string, cellName: string, w: number, h: number, color: string, opacity?: number, outlineStyle?: Cell['outlineStyle'], openAfterCreate?: boolean, autoBounds?: boolean) => void;
  createEmptyCell: (libName: string, cellName: string, color?: string, openAfterCreate?: boolean) => void;
  updateMasterCell: (id: string, libName: string, cellName: string, w: number, h: number, color: string, opacity?: number, outlineStyle?: Cell['outlineStyle']) => void;
  deleteMasterCell: (id: string) => void;
  setActiveDrawLpp: (layer: string, purpose: string, color?: string) => void;
  setActiveDrawLabel: (label: string) => void;
  setActiveTextConfig: (patch: {
    content?: string;
    fontSize?: number;
    fontFamily?: LayoutTextFontFamily;
    fontStyle?: LayoutTextFontStyle;
    orientation?: CadenceOrientation;
    layer?: string;
    purpose?: string;
    color?: string;
  }) => void;
  setSelectedShape: (id: string | null) => void;
  addShape: (shape: Omit<LayoutShape, 'id'>) => string;
  updateShape: (id: string, patch: Partial<Omit<LayoutShape, 'id'>>) => void;
  batchUpdateShapes: (updates: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number }>, actionLabel?: string) => void;
  deleteShape: (id: string) => void;
  toggleShapeLock: (id: string) => void;
  nudgeSelectedShape: (dx: number, dy: number) => void;
  fitActiveCellBoundsToContents: () => void;
  setCellAutoBounds: (cellId: string, autoBounds: boolean) => void;
  placeInstance: (cellId: string, x?: number, y?: number, orientation?: string, customName?: string) => void;
  placeInstanceMosaic: (cellId: string, originX: number, originY: number, orientation: string, config: PendingInstanceArray) => void;
  createPadRow: (config: PadRowConfig) => void;
  prepareManualPadPlacement: (config: PadMasterConfig) => void;
  placeManualPadGroup: (x: number, y: number) => void;
  startPixelArrayPlacement: (width: number, height: number) => void;
  placePixelArray: (centerX: number, centerY: number) => void;
  updatePixelArrayPosition: (x: number, y: number) => void;
  updatePixelArrayGeometry: (x: number, y: number, width: number, height: number) => void;
  setPixelArrayVisible: (visible: boolean) => void;
  setPixelArraySelected: (selected: boolean) => void;
  deletePixelArray: () => void;
  
  updateInstancePosition: (instanceId: string, x: number, y: number) => void;
  moveInstancesByDelta: (instanceIds: string[], deltaX: number, deltaY: number) => void;
  renameInstance: (instanceId: string, name: string) => void;
  toggleInstanceLock: (instanceIds: string[]) => void;
  updateInstanceOrientation: (instanceId: string, orientation: string) => void;
  updateInstanceMosaic: (instanceId: string, mosaic: InstanceMosaic | null) => void;
  flattenMosaicInstance: (instanceId: string) => void;
  setSelectedInstance: (id: string | null, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  selectAllInstances: () => void;
  deleteInstance: (id: string) => void;
  deleteSelectedInstances: () => void;
  nudgeSelection: (dx: number, dy: number) => void;
  copySelection: () => void;
  cutSelection: () => boolean;
  pasteClipboard: () => void;
  startInteractiveCopy: () => boolean;
  rotatePendingCopyGroup: (quarterTurns: number) => void;
  placeCopyGroupAt: (targetX: number, targetY: number) => void;
  cancelPendingCopyGroup: () => void;
  setMoveConstraint: (mode: MoveConstraintMode) => void;
  cycleMoveConstraint: () => void;

  
  addRuler: (startX: number, startY: number, endX: number, endY: number, referenceX?: number, referenceY?: number) => void;
  deleteRuler: (id: string) => void;
  clearRulers: () => void;
  
  undo: () => void;
  redo: () => void;
  alignSelectedInstances: (operation: AlignmentOperation) => void;
  alignSelectedInstancesToBoundary: (edge: AlignmentEdge) => void;
  alignInstanceEdges: (sourceId: string, targetId: string, sourceEdge: AlignmentEdge, targetEdge: AlignmentEdge, offset?: number) => void;
  startEdgeAlignment: (sourceId: string) => void;
  setEdgeAlignmentEdge: (instanceId: string, edge: AlignmentEdge) => void;
  setEdgeAlignmentOffset: (value: string) => void;
  completeEdgeAlignment: (targetId: string, targetEdge: AlignmentEdge) => void;
  completeEdgeAlignmentToBoundary: (targetEdge: 'left' | 'right' | 'bottom' | 'top') => void;
  completeEdgeAlignmentToCoordinate: (coordinate: number, referenceLabel?: string) => void;
  completeEdgeAlignmentToRuler: (rulerId: string) => void;
  cancelEdgeAlignment: () => void;
  applyEdgeAlignment: () => void;
  distributeSelectedInstances: (axis: DistributionAxis) => void;
  toggleOrthogonalRuler: () => void;
  toggleAutoDim: () => void;
  toggleOverlapDrc: () => void;
  toggleGrid: () => void;
  toggleSnapToVisibleGrid: () => void;
  toggleEditInPlaceContext: () => void;
  togglePartialSelectMode: () => void;
  loadProject: (data: ProjectSnapshot) => void;
};

export const getTransformProps = (orientation: string) => {
  let rotation = 0;
  let scaleX = 1;
  let scaleY = 1;
  switch (orientation) {
    case 'R0': break;
    case 'R90': rotation = 90; break;
    case 'R180': rotation = 180; break;
    case 'R270': rotation = 270; break;
    case 'MX': scaleY = -1; break;
    case 'MY': scaleX = -1; break;
    case 'MXR90': scaleY = -1; rotation = 90; break;
    case 'MYR90': scaleX = -1; rotation = 90; break;
  }
  return { rotation, scaleX, scaleY };
};

export const clampInstancePosition = (
  x: number, 
  y: number, 
  orientation: string, 
  w: number, 
  h: number, 
  topW: number, 
  topH: number,
  gridSize: number,
  originX = 0,
  originY = 0,
) => {
  const t = getTransformProps(orientation);
  const rad = t.rotation * Math.PI / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));

  const transformPoint = (px: number, py: number) => {
    const sx = px * t.scaleX;
    const sy = py * t.scaleY;
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    return { x: rx, y: ry };
  };

  const p1 = transformPoint(originX, originY);
  const p2 = transformPoint(originX + w, originY);
  const p3 = transformPoint(originX + w, originY + h);
  const p4 = transformPoint(originX, originY + h);

  const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

  const minAllowedX = -topW / 2 - minX;
  const maxAllowedX = topW / 2 - maxX;
  const minAllowedY = -topH / 2 - minY;
  const maxAllowedY = topH / 2 - maxY;

  const snapWithin = (value: number, min: number, max: number) => {
    const minStep = Math.ceil((min - 1e-9) / gridSize);
    const maxStep = Math.floor((max + 1e-9) / gridSize);
    if (minStep > maxStep) throw new RangeError('No grid-snapped position fits inside the top cell');
    const step = Math.max(minStep, Math.min(Math.round(value / gridSize), maxStep));
    return snapToGrid(step * gridSize, gridSize);
  };

  const clampedX = snapWithin(x, minAllowedX, maxAllowedX);
  const clampedY = snapWithin(y, minAllowedY, maxAllowedY);

  return { x: clampedX, y: clampedY };
};

const normalizePadInset = (inset: number, topWidth: number, topHeight: number, gridSize: number) => {
  if (!Number.isFinite(inset) || inset < 0) {
    throw new RangeError('Pad inset must be a finite number greater than or equal to zero');
  }
  const snapped = snapToGrid(inset, gridSize);
  if (snapped === 0) return 0;
  if (snapped * 2 >= topWidth || snapped * 2 >= topHeight) {
    throw new RangeError('Pad inset must leave a positive interior inside the top cell');
  }
  return snapped;
};

export const snapPadToNearestEdge = (
  x: number,
  y: number,
  width: number,
  height: number,
  topWidth: number,
  topHeight: number,
  gridSize: number,
  orientation = 'R0',
  padInset = 0,
  originX = 0,
  originY = 0,
) => {
  const innerW = topWidth - padInset * 2;
  const innerH = topHeight - padInset * 2;
  if (innerW <= 0 || innerH <= 0) {
    throw new RangeError('Pad inset leaves no room inside the top cell');
  }
  const localBounds = getPhysicalBounds({ id: 'pad-preview', x: 0, y: 0, orientation, width, height, originX, originY });
  const inside = clampInstancePosition(x, y, orientation, width, height, innerW, innerH, gridSize, originX, originY);
  const edgeCoordinates = {
    left: -innerW / 2 - localBounds.left,
    right: innerW / 2 - localBounds.right,
    bottom: -innerH / 2 - localBounds.bottom,
    top: innerH / 2 - localBounds.top,
  };
  const onGrid = (value: number) => Math.abs(snapToGrid(value, gridSize) - value) <= 1e-9;
  const candidates = [
    onGrid(edgeCoordinates.left) ? { x: edgeCoordinates.left, y: inside.y, distance: Math.abs(x - edgeCoordinates.left), side: 'left' as PadSide } : null,
    onGrid(edgeCoordinates.right) ? { x: edgeCoordinates.right, y: inside.y, distance: Math.abs(x - edgeCoordinates.right), side: 'right' as PadSide } : null,
    onGrid(edgeCoordinates.bottom) ? { x: inside.x, y: edgeCoordinates.bottom, distance: Math.abs(y - edgeCoordinates.bottom), side: 'bottom' as PadSide } : null,
    onGrid(edgeCoordinates.top) ? { x: inside.x, y: edgeCoordinates.top, distance: Math.abs(y - edgeCoordinates.top), side: 'top' as PadSide } : null,
  ].filter((candidate): candidate is { x: number; y: number; distance: number; side: PadSide } => candidate !== null);
  const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (!closest) throw new RangeError('No top-cell edge is compatible with the active placement grid');
  return { x: snapToGrid(closest.x, gridSize), y: snapToGrid(closest.y, gridSize), side: closest.side };
};

export const PAD_ORIENTATION_BY_SIDE: Record<PadSide, string> = {
  top: 'R0',
  right: 'R270',
  bottom: 'R180',
  left: 'R90',
};

/** Resolve the nearest perimeter edge and its Cadence orientation as one operation. */
export const snapPadToAutoOrientedEdge = (
  x: number,
  y: number,
  width: number,
  height: number,
  topWidth: number,
  topHeight: number,
  gridSize: number,
  padInset = 0,
  originX = 0,
  originY = 0,
) => {
  const innerW = topWidth - padInset * 2;
  const innerH = topHeight - padInset * 2;
  if (innerW <= 0 || innerH <= 0) {
    throw new RangeError('Pad inset leaves no room inside the top cell');
  }
  const candidates = (Object.keys(PAD_ORIENTATION_BY_SIDE) as PadSide[]).map(side => {
    const orientation = PAD_ORIENTATION_BY_SIDE[side];
    const local = getPhysicalBounds({ id: 'auto-pad-preview', x: 0, y: 0, orientation, width, height, originX, originY });
    const inside = clampInstancePosition(x, y, orientation, width, height, innerW, innerH, gridSize, originX, originY);
    const target = {
      x: side === 'left'
        ? -innerW / 2 - local.left
        : side === 'right'
          ? innerW / 2 - local.right
          : inside.x,
      y: side === 'bottom'
        ? -innerH / 2 - local.bottom
        : side === 'top'
          ? innerH / 2 - local.top
          : inside.y,
    };
    const snapped = { x: snapToGrid(target.x, gridSize), y: snapToGrid(target.y, gridSize) };
    const physical = getPhysicalBounds({ id: 'auto-pad-candidate', ...snapped, orientation, width, height, originX, originY });
    const attached = side === 'left' ? Math.abs(physical.left + innerW / 2) <= 1e-9
      : side === 'right' ? Math.abs(physical.right - innerW / 2) <= 1e-9
        : side === 'bottom' ? Math.abs(physical.bottom + innerH / 2) <= 1e-9
          : Math.abs(physical.top - innerH / 2) <= 1e-9;
    return attached ? { ...snapped, side, orientation, distance: Math.hypot(x - snapped.x, y - snapped.y) } : null;
  }).filter((candidate): candidate is { x: number; y: number; side: PadSide; orientation: string; distance: number } => candidate !== null);

  const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (!nearest) throw new RangeError('No top-cell edge is compatible with the active placement grid');
  return nearest;
};

type PadGroupGeometry = {
  width: number;
  height: number;
  originX?: number;
  originY?: number;
  count: number;
  pitch: number;
  side: PadSide;
  centerAlong: number;
  orientation: string;
  topWidth: number;
  topHeight: number;
  gridSize: number;
  padInset?: number;
  clampAlong?: boolean;
};

export const computePadGroupPositions = (config: PadGroupGeometry) => {
  const padInset = config.padInset ?? 0;
  const originX = config.originX ?? 0;
  const originY = config.originY ?? 0;
  const innerW = config.topWidth - padInset * 2;
  const innerH = config.topHeight - padInset * 2;
  if (innerW <= 0 || innerH <= 0) {
    throw new RangeError('Pad inset leaves no room inside the top cell');
  }
  const local = getPhysicalBounds({ id: 'pad-group-preview', x: 0, y: 0, orientation: config.orientation, width: config.width, height: config.height, originX, originY });
  const horizontal = config.side === 'top' || config.side === 'bottom';
  const padAlong = horizontal ? local.right - local.left : local.top - local.bottom;
  if (config.pitch + 1e-9 < padAlong) {
    throw new RangeError(`Pad pitch must be at least the rotated pad ${horizontal ? 'width' : 'height'} (${padAlong} um) to avoid overlap`);
  }
  const span = (config.count - 1) * config.pitch + padAlong;
  const available = horizontal ? innerW : innerH;
  if (span > available + 1e-9) throw new RangeError(`Pad group span ${span} um exceeds the ${available} um top-cell edge`);

  const minCenter = -available / 2 + span / 2;
  const maxCenter = available / 2 - span / 2;
  if (config.clampAlong === false && (config.centerAlong < minCenter - 1e-9 || config.centerAlong > maxCenter + 1e-9)) {
    throw new RangeError(`Pad row coordinate places the ${span} um row outside the ${available} um top-cell edge`);
  }
  const centerAlong = snapToGrid(
    config.clampAlong === false ? config.centerAlong : Math.max(minCenter, Math.min(config.centerAlong, maxCenter)),
    config.gridSize,
  );
  const firstCenter = centerAlong - ((config.count - 1) * config.pitch) / 2;

  return Array.from({ length: config.count }, (_, index) => {
    const along = firstCenter + index * config.pitch;
    const targetX = horizontal
      ? along - local.centerX
      : config.side === 'left' ? -innerW / 2 - local.left : innerW / 2 - local.right;
    const targetY = horizontal
      ? config.side === 'bottom' ? -innerH / 2 - local.bottom : innerH / 2 - local.top
      : along - local.centerY;
    const position = clampInstancePosition(targetX, targetY, config.orientation, config.width, config.height, innerW, innerH, config.gridSize, originX, originY);
    if (Math.abs(position.x - targetX) > 1e-8 || Math.abs(position.y - targetY) > 1e-8) {
      throw new RangeError('Pad group must fit inside the top cell and land exactly on the placement grid');
    }
    return position;
  });
};

const normalizePixelArray = (
  pixelArray: PixelArray,
  topWidth: number,
  topHeight: number,
  gridSize: number,
  containerOriginX = -topWidth / 2,
  containerOriginY = -topHeight / 2,
): PixelArray => {
  const maxWidth = snapToGrid(Math.floor((topWidth - 1e-9) / gridSize) * gridSize, gridSize);
  const maxHeight = snapToGrid(Math.floor((topHeight - 1e-9) / gridSize) * gridSize, gridSize);
  if (maxWidth <= 0 || maxHeight <= 0) throw new RangeError('The top cell is too small for a pixel array');
  const width = Math.min(maxWidth, Math.max(gridSize, snapToGrid(pixelArray.width, gridSize)));
  const height = Math.min(maxHeight, Math.max(gridSize, snapToGrid(pixelArray.height, gridSize)));
  const snapWithin = (value: number, min: number, max: number) => {
    const minStep = Math.ceil((min - 1e-9) / gridSize);
    const maxStep = Math.floor((max + 1e-9) / gridSize);
    if (minStep > maxStep) throw new RangeError('No grid-snapped position fits inside the cell');
    const step = Math.max(minStep, Math.min(Math.round(value / gridSize), maxStep));
    const snapped = snapToGrid(step * gridSize, gridSize);
    return Object.is(snapped, -0) ? 0 : snapped;
  };
  const x = snapWithin(pixelArray.x, containerOriginX, containerOriginX + topWidth - width);
  const y = snapWithin(pixelArray.y, containerOriginY, containerOriginY + topHeight - height);
  return { ...pixelArray, x, y, width, height };
};

const resolveStoredCoordinateMode = (
  view?: Pick<CellViewContent, 'coordinateMode' | 'shapes'>,
): CellViewCoordinateMode => (
  view?.coordinateMode ?? ((view?.shapes?.length ?? 0) > 0 ? 'origin' : 'centered')
);

const getActiveContainerOrigin = (
  state: Pick<ProjectState, 'activeCellId' | 'activeCoordinateMode' | 'masterCells' | 'topWidth' | 'topHeight'>,
): { originX: number; originY: number } => {
  if (state.activeCellId && state.activeCoordinateMode === 'origin') {
    const activeMaster = state.masterCells[state.activeCellId];
    if (activeMaster) {
      return { originX: activeMaster.originX ?? 0, originY: activeMaster.originY ?? 0 };
    }
  }
  return { originX: -state.topWidth / 2, originY: -state.topHeight / 2 };
};

const getNextInstanceName = (instances: Instance[]) => {
  const usedNames = new Set(instances.map(instance => instance.name));
  let index = 0;
  while (usedNames.has(`I${index}`)) index += 1;
  return `I${index}`;
};

const normalizeCellAppearance = (opacity: number, outlineStyle: Cell['outlineStyle']) => {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError('IP opacity must be between 0 and 1');
  }
  if (!outlineStyle || !(['solid', 'dashed', 'dotted', 'none'] as const).includes(outlineStyle)) {
    throw new Error('IP outline style must be solid, dashed, dotted, or none');
  }
  return { opacity, outlineStyle };
};

const ORIENTATION_ROTATION_CYCLES = [
  ['R0', 'R90', 'R180', 'R270'],
  ['MX', 'MXR90', 'MY', 'MYR90'],
] as const;

export const rotateOrientationByQuarterTurns = (orientation: string, quarterTurns: number) => {
  const cycle = ORIENTATION_ROTATION_CYCLES.find(values => values.includes(orientation as never));
  if (!cycle) return orientation;
  const currentIndex = cycle.indexOf(orientation as never);
  const nextIndex = ((currentIndex + quarterTurns) % cycle.length + cycle.length) % cycle.length;
  return cycle[nextIndex];
};

const getRootIdentity = (state: Pick<ProjectState, 'topLibName' | 'topCellName' | 'activeCellId' | 'rootView'>) => (
  state.activeCellId !== null && state.rootView
    ? { topLibName: state.rootView.topLibName, topCellName: state.rootView.topCellName }
    : { topLibName: state.topLibName, topCellName: state.topCellName }
);

const buildCellViewContent = (
  instances: Instance[],
  rulers: Ruler[],
  pixelArray: PixelArray | null,
  padInset: number,
  shapes: LayoutShape[] = [],
  coordinateMode?: CellViewCoordinateMode,
): CellViewContent => ({
  instances,
  rulers,
  ...(shapes.length > 0 ? { shapes } : {}),
  ...(coordinateMode ? { coordinateMode } : {}),
  ...(pixelArray ? { pixelArray } : {}),
  ...(padInset > 0 ? { padInset } : {}),
});

const isEmptyCellView = (view: CellViewContent): boolean => (
  view.instances.length === 0
  && view.rulers.length === 0
  && (view.shapes?.length ?? 0) === 0
  && !view.pixelArray
  && !(view.padInset && view.padInset > 0)
);

const normalizeShapesForGrid = (shapes: readonly LayoutShape[], gridSize: number): LayoutShape[] => (
  shapes.map(shape => ({
    ...shape,
    x: snapToGrid(shape.x, gridSize),
    y: snapToGrid(shape.y, gridSize),
    width: Math.max(gridSize, snapToGrid(shape.width, gridSize)),
    height: Math.max(gridSize, snapToGrid(shape.height, gridSize)),
  }))
);

const normalizeCellViews = (
  views: Record<string, CellViewContent>,
  masterCells: Record<string, Cell>,
): Record<string, CellViewContent> => {
  const result: Record<string, CellViewContent> = {};
  for (const [cellId, view] of Object.entries(views)) {
    if (!masterCells[cellId]) continue;
    const normalized = buildCellViewContent(
      view.instances,
      view.rulers,
      view.pixelArray ?? null,
      view.padInset ?? 0,
      view.shapes ?? [],
      view.coordinateMode,
    );
    if (!isEmptyCellView(normalized)) {
      result[cellId] = normalized;
    }
  }
  return result;
};

const mergeActiveViewIntoCellViews = (
  state: Pick<ProjectState, 'activeCellId' | 'masterCells' | 'cellViews' | 'instances' | 'rulers' | 'shapes' | 'activeCoordinateMode' | 'pixelArray' | 'padInset'>,
): Record<string, CellViewContent> => {
  const merged: Record<string, CellViewContent> = { ...state.cellViews };
  if (state.activeCellId && state.masterCells[state.activeCellId]) {
    const activeView = buildCellViewContent(
      state.instances,
      state.rulers,
      state.pixelArray,
      state.padInset,
      state.shapes,
      state.activeCoordinateMode,
    );
    if (isEmptyCellView(activeView)) {
      delete merged[state.activeCellId];
    } else {
      merged[state.activeCellId] = activeView;
    }
  }
  return normalizeCellViews(merged, state.masterCells);
};

const snapUnboundedPosition = (x: number, y: number, gridSize: number): { x: number; y: number } => {
  const sx = snapToGrid(x, gridSize);
  const sy = snapToGrid(y, gridSize);
  return {
    x: Object.is(sx, -0) ? 0 : sx,
    y: Object.is(sy, -0) ? 0 : sy,
  };
};

const normalizeMosaicForGrid = (mosaic: InstanceMosaic | undefined, gridSize: number): InstanceMosaic | undefined => {
  if (!isActiveMosaic(mosaic)) return undefined;
  const rp = snapToGrid(mosaic.rowPitch, gridSize);
  const cp = snapToGrid(mosaic.colPitch, gridSize);
  return {
    rows: Math.max(1, Math.floor(mosaic.rows)),
    cols: Math.max(1, Math.floor(mosaic.cols)),
    rowPitch: Object.is(rp, -0) ? 0 : rp,
    colPitch: Object.is(cp, -0) ? 0 : cp,
  };
};

const clampInstancesToContainer = (
  instances: Instance[],
  masterCells: Record<string, Cell>,
  containerW: number,
  containerH: number,
  gridSize: number,
  padInset: number,
  onlyCellId?: string,
  unbounded = false,
): Instance[] => instances.map(instance => {
  if (onlyCellId && instance.cellId !== onlyCellId) return instance;
  const master = masterCells[instance.cellId];
  if (!master) return instance;
  const normalizedMosaic = normalizeMosaicForGrid(instance.mosaic, gridSize);
  if (unbounded || master.kind !== 'pad') {
    const snapped = snapUnboundedPosition(instance.x, instance.y, gridSize);
    const next: Instance = { ...instance, x: snapped.x, y: snapped.y };
    if (normalizedMosaic) next.mosaic = normalizedMosaic;
    else delete next.mosaic;
    return next;
  }
  const position = snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, containerW, containerH, gridSize, instance.orientation, padInset, master.originX ?? 0, master.originY ?? 0);
  const next: Instance = { ...instance, x: position.x, y: position.y };
  if (normalizedMosaic) next.mosaic = normalizedMosaic;
  else delete next.mosaic;
  return next;
});

/** Returns true when a Virtuoso cellview has no geometry yet (empty 0x0 auto-bounds cell). */
export const isCellEmpty = (cell: Pick<Cell, 'width' | 'height'>): boolean => (
  !(Number.isFinite(cell.width) && Number.isFinite(cell.height) && cell.width > 0 && cell.height > 0)
);

/**
 * Recomputes bounding boxes bottom-up for every `autoBounds` cell in the hierarchy
 * so editing a leaf cell automatically updates any parent cells that instantiate it.
 */
const propagateAutoBounds = (
  masterCells: Record<string, Cell>,
  cellViews: Record<string, CellViewContent>,
): Record<string, Cell> => {
  const next: Record<string, Cell> = { ...masterCells };
  const ids = Object.keys(next);
  for (let pass = 0; pass < Math.max(1, ids.length); pass += 1) {
    let changed = false;
    for (const id of ids) {
      const master = next[id];
      if (!master?.autoBounds) continue;
      const view = cellViews[id];
      const bounds = view
        ? computeCellContentBounds(view.shapes ?? [], view.instances ?? [], next, view.pixelArray)
        : null;
      const targetW = bounds ? bounds.width : 0;
      const targetH = bounds ? bounds.height : 0;
      const targetOx = bounds && Math.abs(bounds.originX) > 1e-9 ? bounds.originX : undefined;
      const targetOy = bounds && Math.abs(bounds.originY) > 1e-9 ? bounds.originY : undefined;
      const curOx = master.originX ?? 0;
      const curOy = master.originY ?? 0;
      if (
        Math.abs((targetOx ?? 0) - curOx) > 1e-9
        || Math.abs((targetOy ?? 0) - curOy) > 1e-9
        || Math.abs(targetW - master.width) > 1e-9
        || Math.abs(targetH - master.height) > 1e-9
      ) {
        const updated: Cell = {
          ...master,
          width: targetW,
          height: targetH,
          ...(targetOx !== undefined ? { originX: targetOx } : {}),
          ...(targetOy !== undefined ? { originY: targetOy } : {}),
        };
        if (targetOx === undefined) delete updated.originX;
        if (targetOy === undefined) delete updated.originY;
        next[id] = updated;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
};

/**
 * Updates the active IP master cell's `(originX, originY, width, height)` when shapes
 * or sub-instances are drawn/modified inside its cellview, and propagates updated
 * auto-bounds upward to any parent cells instantiating this cell.
 * - If `master.autoBounds` is true (or `promoteAutoBounds` is true): tightly fits the exact bounding box of its contents (or resets to empty 0x0 if all contents are deleted).
 * - Otherwise: expands only when new content extends outside the existing bounding box.
 */
const syncMasterBoundsForActiveCell = (
  state: Pick<ProjectState, 'activeCellId' | 'masterCells' | 'cellViews' | 'rulers' | 'padInset' | 'activeCoordinateMode' | 'topWidth' | 'topHeight' | 'gridSize'>,
  nextShapes: readonly LayoutShape[],
  nextInstances: readonly Instance[],
  nextPixelArray: PixelArray | null,
  forceTightFit = false,
  promoteAutoBounds = false,
): { masterCells: Record<string, Cell>; topWidth: number; topHeight: number } | null => {
  if (!state.activeCellId) return null;
  const master = state.masterCells[state.activeCellId];
  if (!master) return null;
  const shouldAutoFit = Boolean(master.autoBounds) || forceTightFit || promoteAutoBounds;
  const contentBounds = computeCellContentBounds(nextShapes, nextInstances, state.masterCells, nextPixelArray);

  const curOx = master.originX ?? 0;
  const curOy = master.originY ?? 0;
  const curMaxX = curOx + master.width;
  const curMaxY = curOy + master.height;

  let nextOx: number;
  let nextOy: number;
  let nextW: number;
  let nextH: number;

  if (!contentBounds) {
    if (!shouldAutoFit) return null;
    nextOx = 0;
    nextOy = 0;
    nextW = 0;
    nextH = 0;
  } else if (shouldAutoFit) {
    nextOx = contentBounds.originX;
    nextOy = contentBounds.originY;
    nextW = contentBounds.width;
    nextH = contentBounds.height;
  } else {
    const minX = Math.min(curOx, contentBounds.originX);
    const minY = Math.min(curOy, contentBounds.originY);
    const maxX = Math.max(curMaxX, contentBounds.originX + contentBounds.width);
    const maxY = Math.max(curMaxY, contentBounds.originY + contentBounds.height);
    nextOx = minX;
    nextOy = minY;
    nextW = maxX - minX;
    nextH = maxY - minY;
  }

  const nextAutoBounds = promoteAutoBounds ? true : master.autoBounds;
  const unchanged = Math.abs(nextOx - curOx) <= 1e-9
    && Math.abs(nextOy - curOy) <= 1e-9
    && Math.abs(nextW - master.width) <= 1e-9
    && Math.abs(nextH - master.height) <= 1e-9
    && Boolean(nextAutoBounds) === Boolean(master.autoBounds);
  if (unchanged) {
    return null;
  }

  const nextMaster: Cell = {
    ...master,
    width: nextW,
    height: nextH,
    ...(nextAutoBounds ? { autoBounds: true } : {}),
    ...(Math.abs(nextOx) > 1e-9 ? { originX: nextOx } : { originX: undefined }),
    ...(Math.abs(nextOy) > 1e-9 ? { originY: nextOy } : { originY: undefined }),
  };
  if (nextMaster.originX === undefined) delete nextMaster.originX;
  if (nextMaster.originY === undefined) delete nextMaster.originY;

  const updatedViews = mergeActiveViewIntoCellViews({
    activeCellId: state.activeCellId,
    masterCells: { ...state.masterCells, [state.activeCellId]: nextMaster },
    cellViews: state.cellViews,
    instances: [...nextInstances],
    rulers: state.rulers,
    shapes: [...nextShapes],
    activeCoordinateMode: state.activeCoordinateMode,
    pixelArray: nextPixelArray,
    padInset: state.padInset,
  });
  const propagatedMasterCells = propagateAutoBounds(
    { ...state.masterCells, [state.activeCellId]: nextMaster },
    updatedViews,
  );
  const finalActive = propagatedMasterCells[state.activeCellId] ?? nextMaster;

  return {
    masterCells: propagatedMasterCells,
    topWidth: finalActive.width,
    topHeight: finalActive.height,
  };
};

const deriveLibraries = (
  rootTopLibName: string,
  masterCells: Record<string, Cell>,
  existingLibraries: readonly string[] = [],
): string[] => {
  const libs = new Set<string>();
  if (rootTopLibName.trim()) libs.add(rootTopLibName.trim());
  for (const master of Object.values(masterCells)) {
    if (master.libName.trim()) libs.add(master.libName.trim());
  }
  for (const lib of existingLibraries) {
    if (lib.trim()) libs.add(lib.trim());
  }
  return [...libs].sort((a, b) => a.localeCompare(b));
};

const ensureOpenViewTab = (
  openViewIds: ReadonlyArray<string | null>,
  targetCellId: string | null,
  masterCells: Record<string, Cell>,
): Array<string | null> => {
  const filtered = openViewIds.filter(id => id === null || Boolean(masterCells[id]));
  if (!filtered.includes(targetCellId)) {
    filtered.push(targetCellId);
  }
  return filtered.length > 0 ? filtered : [null];
};

export const getProjectSnapshot = (
  state: Pick<
    ProjectState,
    | 'gridSize'
    | 'topWidth'
    | 'topHeight'
    | 'topLibName'
    | 'topCellName'
    | 'padInset'
    | 'libraries'
    | 'masterCells'
    | 'instances'
    | 'rulers'
    | 'shapes'
    | 'activeCoordinateMode'
    | 'pixelArray'
    | 'cellViews'
    | 'activeCellId'
    | 'rootView'
  >,
): ProjectSnapshot => {
  const mergedCellViews = mergeActiveViewIntoCellViews(state);
  const root = state.activeCellId !== null && state.rootView
    ? state.rootView
    : {
        topWidth: state.topWidth,
        topHeight: state.topHeight,
        topLibName: state.topLibName,
        topCellName: state.topCellName,
        padInset: state.padInset,
        instances: state.instances,
        rulers: state.rulers,
        shapes: state.shapes,
        pixelArray: state.pixelArray,
      };
  const requiredLibs = new Set([root.topLibName, ...Object.values(state.masterCells).map(m => m.libName)]);
  const allLibraries = deriveLibraries(root.topLibName, state.masterCells, state.libraries);
  const hasExplicitExtraLibs = allLibraries.some(lib => !requiredLibs.has(lib));
  return {
    gridSize: state.gridSize,
    topWidth: root.topWidth,
    topHeight: root.topHeight,
    topLibName: root.topLibName,
    topCellName: root.topCellName,
    masterCells: state.masterCells,
    instances: root.instances,
    rulers: root.rulers,
    ...(root.shapes.length > 0 ? { shapes: root.shapes } : {}),
    pixelArray: root.pixelArray,
    ...(root.padInset > 0 ? { padInset: root.padInset } : {}),
    ...(hasExplicitExtraLibs ? { libraries: allLibraries } : {}),
    ...(Object.keys(mergedCellViews).length > 0 ? { cellViews: mergedCellViews } : {}),
  };
};

type CommitPatch = Partial<ProjectSnapshot> & {
  rootView?: RootViewSnapshot | null;
  activeCellId?: string | null;
  activeCoordinateMode?: CellViewCoordinateMode;
  openViewIds?: Array<string | null>;
  viewBreadcrumb?: string[];
  descendStack?: DescendContextFrame[];
};

const commitProjectPatch = (
  state: ProjectState,
  label: string,
  patch: CommitPatch,
) => {
  const before = getProjectSnapshot(state);
  const nextMasterCells = patch.masterCells ?? state.masterCells;
  const nextActiveCellId = patch.activeCellId !== undefined ? patch.activeCellId : state.activeCellId;
  const nextRootView = patch.rootView !== undefined ? patch.rootView : state.rootView;
  const nextRootLib = nextActiveCellId !== null && nextRootView
    ? nextRootView.topLibName
    : (patch.topLibName ?? state.topLibName);
  const nextLibraries = deriveLibraries(nextRootLib, nextMasterCells, patch.libraries ?? state.libraries);
  const nextStateLike: ProjectState = {
    ...state,
    ...patch,
    shapes: patch.shapes !== undefined ? patch.shapes : state.shapes,
    activeCoordinateMode: patch.activeCoordinateMode !== undefined ? patch.activeCoordinateMode : state.activeCoordinateMode,
    libraries: nextLibraries,
    padInset: patch.padInset !== undefined ? patch.padInset : state.padInset,
    pixelArray: patch.pixelArray !== undefined ? patch.pixelArray : state.pixelArray,
    cellViews: patch.cellViews !== undefined ? patch.cellViews : state.cellViews,
    rootView: nextRootView,
    activeCellId: nextActiveCellId,
    viewBreadcrumb: patch.viewBreadcrumb !== undefined ? patch.viewBreadcrumb : state.viewBreadcrumb,
    descendStack: patch.descendStack !== undefined ? patch.descendStack : state.descendStack,
  };
  const syncedCellViews = mergeActiveViewIntoCellViews(nextStateLike);
  const after = getProjectSnapshot({ ...nextStateLike, cellViews: syncedCellViews });
  return {
    ...patch,
    libraries: nextLibraries,
    cellViews: syncedCellViews,
    history: recordHistory(state.history, label, before, after),
  };
};

const applyCanonicalSnapshot = (
  state: ProjectState,
  snapshot: ProjectSnapshot,
  history: ProjectHistory,
) => {
  const cellViews = normalizeCellViews(snapshot.cellViews ?? {}, snapshot.masterCells);
  const libraries = deriveLibraries(snapshot.topLibName, snapshot.masterCells, snapshot.libraries ?? []);
  if (state.activeCellId && snapshot.masterCells[state.activeCellId]) {
    const activeMaster = snapshot.masterCells[state.activeCellId];
    const activeView = cellViews[state.activeCellId];
    const instances = activeView?.instances ?? [];
    const shapes = activeView?.shapes ?? [];
    const filteredBreadcrumb = state.viewBreadcrumb.filter(id => Boolean(snapshot.masterCells[id]));
    const viewBreadcrumb = filteredBreadcrumb.at(-1) === state.activeCellId
      ? filteredBreadcrumb
      : [...filteredBreadcrumb, state.activeCellId];
    // Re-validate Edit-in-Place descendStack against the restored snapshot so undone/moved ancestor instances stay accurate
    let nextDescendStack: DescendContextFrame[] = [];
    if (state.descendStack.length > 0 && state.descendStack.at(-1)?.cellId === state.activeCellId) {
      const rebuilt: DescendContextFrame[] = [];
      let valid = true;
      for (const frame of state.descendStack) {
        if (!snapshot.masterCells[frame.cellId]) {
          valid = false;
          break;
        }
        if (frame.parentCellId === null) {
          const restoredInst = snapshot.instances.find(i => i.id === frame.instanceId && i.cellId === frame.cellId);
          if (!restoredInst) {
            valid = false;
            break;
          }
          rebuilt.push({
            ...frame,
            instanceName: restoredInst.name,
            x: restoredInst.x,
            y: restoredInst.y,
            orientation: restoredInst.orientation,
            parentCoordinateMode: 'origin',
            parentWidth: snapshot.topWidth,
            parentHeight: snapshot.topHeight,
          });
        } else {
          const parentMaster = snapshot.masterCells[frame.parentCellId];
          const parentView = cellViews[frame.parentCellId];
          const restoredInst = parentView?.instances.find(i => i.id === frame.instanceId && i.cellId === frame.cellId);
          if (!parentMaster || !restoredInst) {
            valid = false;
            break;
          }
          rebuilt.push({
            ...frame,
            instanceName: restoredInst.name,
            x: restoredInst.x,
            y: restoredInst.y,
            orientation: restoredInst.orientation,
            parentCoordinateMode: resolveStoredCoordinateMode(parentView),
            parentWidth: parentMaster.width,
            parentHeight: parentMaster.height,
          });
        }
      }
      if (valid) nextDescendStack = rebuilt;
    }
    return {
      gridSize: snapshot.gridSize,
      libraries,
      masterCells: snapshot.masterCells,
      cellViews,
      rootView: {
        topWidth: snapshot.topWidth,
        topHeight: snapshot.topHeight,
        topLibName: snapshot.topLibName,
        topCellName: snapshot.topCellName,
        padInset: snapshot.padInset ?? 0,
        instances: snapshot.instances,
        rulers: snapshot.rulers,
        shapes: snapshot.shapes ?? [],
        pixelArray: snapshot.pixelArray ?? null,
      },
      topWidth: activeMaster.width,
      topHeight: activeMaster.height,
      topLibName: activeMaster.libName,
      topCellName: activeMaster.cellName,
      padInset: activeView?.padInset ?? 0,
      instances,
      rulers: activeView?.rulers ?? [],
      shapes,
      activeCoordinateMode: activeView?.coordinateMode ?? ((activeView?.instances.length ?? 0) > 0 && shapes.length === 0 ? 'centered' : 'origin') as CellViewCoordinateMode,
      pixelArray: activeView?.pixelArray ?? null,
      activeCellId: state.activeCellId,
      openViewIds: ensureOpenViewTab(
        state.openViewIds,
        nextDescendStack.length > 0 ? nextDescendStack[0].parentCellId : state.activeCellId,
        snapshot.masterCells,
      ),
      viewBreadcrumb,
      descendStack: nextDescendStack,
      history,
      ...selectionAfterInstancesChange(state, instances),
      selectedShapeId: state.selectedShapeId && shapes.some(s => s.id === state.selectedShapeId) ? state.selectedShapeId : null,
      edgeAlignmentSession: null,
      pendingPixelArraySize: null,
      placementMasterId: null,
      pendingInstanceArray: null,
      pendingManualPadGroup: null,
      pendingCopyGroup: null,
      appMode: 'select' as AppMode,
      pixelArraySelected: false,
    };
  }
  const rootShapes = snapshot.shapes ?? [];
  return {
    gridSize: snapshot.gridSize,
    topWidth: snapshot.topWidth,
    topHeight: snapshot.topHeight,
    topLibName: snapshot.topLibName,
    topCellName: snapshot.topCellName,
    padInset: snapshot.padInset ?? 0,
    libraries,
    masterCells: snapshot.masterCells,
    instances: snapshot.instances,
    rulers: snapshot.rulers,
    shapes: rootShapes,
    activeCoordinateMode: 'origin' as CellViewCoordinateMode,
    pixelArray: snapshot.pixelArray ?? null,
    cellViews,
    activeCellId: null,
    openViewIds: ensureOpenViewTab(state.openViewIds, null, snapshot.masterCells),
    viewBreadcrumb: [],
    descendStack: [],
    rootView: null,
    history,
    ...selectionAfterInstancesChange(state, snapshot.instances),
    selectedShapeId: state.selectedShapeId && rootShapes.some(s => s.id === state.selectedShapeId) ? state.selectedShapeId : null,
    edgeAlignmentSession: null,
    pendingPixelArraySize: null,
    placementMasterId: null,
    pendingInstanceArray: null,
    pendingManualPadGroup: null,
    pendingCopyGroup: null,
    appMode: 'select' as AppMode,
    pixelArraySelected: false,
  };
};

const switchToCellView = (
  state: ProjectState,
  targetCellId: string | null,
  nextBreadcrumb: string[],
  nextDescendStack: DescendContextFrame[] = [],
) => {
  const sameDescendStack = nextDescendStack.length === state.descendStack.length
    && nextDescendStack.every((frame, idx) => (
      frame.instanceId === state.descendStack[idx]?.instanceId
      && frame.cellId === state.descendStack[idx]?.cellId
    ));
  if (targetCellId === state.activeCellId && sameDescendStack) return state;
  if (targetCellId !== null && !state.masterCells[targetCellId]) return state;

  const flushedCellViews = mergeActiveViewIntoCellViews(state);
  const savedRoot: RootViewSnapshot = state.activeCellId === null
    ? {
        topWidth: state.topWidth,
        topHeight: state.topHeight,
        topLibName: state.topLibName,
        topCellName: state.topCellName,
        padInset: state.padInset,
        instances: state.instances,
        rulers: state.rulers,
        shapes: state.shapes,
        pixelArray: state.pixelArray,
      }
    : (state.rootView ?? {
        topWidth: state.topWidth,
        topHeight: state.topHeight,
        topLibName: state.topLibName,
        topCellName: state.topCellName,
        padInset: state.padInset,
        instances: state.instances,
        rulers: state.rulers,
        shapes: state.shapes,
        pixelArray: state.pixelArray,
      });

  const resetInteraction = {
    selectedInstanceId: null,
    selectedInstanceIds: [],
    selectedShapeId: null,
    pixelArraySelected: false,
    edgeAlignmentSession: null,
    placementMasterId: null,
    pendingInstanceArray: null,
    pendingManualPadGroup: null,
    pendingCopyGroup: null,
    pendingPixelArraySize: null,
    appMode: 'select' as AppMode,
  };

  // True Virtuoso Edit-in-Place (X) keeps the user inside the current cellview tab
  // instead of opening/switching to a separate tab for the descended child cell.
  const tabAnchorCellId = nextDescendStack.length > 0
    ? nextDescendStack[0].parentCellId
    : targetCellId;
  const openViewIds = ensureOpenViewTab(state.openViewIds, tabAnchorCellId, state.masterCells);

  if (targetCellId === null) {
    return {
      ...savedRoot,
      activeCoordinateMode: 'origin' as CellViewCoordinateMode,
      cellViews: flushedCellViews,
      activeCellId: null,
      openViewIds,
      viewBreadcrumb: [],
      descendStack: [],
      rootView: null,
      ...resetInteraction,
    };
  }

  const targetMaster = state.masterCells[targetCellId];
  const targetView = flushedCellViews[targetCellId];
  const targetShapes = targetView?.shapes ?? [];
  const targetInstances = targetView?.instances ?? [];
  const targetCoordMode: CellViewCoordinateMode = targetView?.coordinateMode
    ?? (targetInstances.length > 0 && targetShapes.length === 0 ? 'centered' : 'origin');
  return {
    topWidth: targetMaster.width,
    topHeight: targetMaster.height,
    topLibName: targetMaster.libName,
    topCellName: targetMaster.cellName,
    padInset: targetView?.padInset ?? 0,
    instances: targetInstances,
    rulers: targetView?.rulers ?? [],
    shapes: targetShapes,
    activeCoordinateMode: targetCoordMode,
    pixelArray: targetView?.pixelArray ?? null,
    cellViews: flushedCellViews,
    activeCellId: targetCellId,
    openViewIds,
    viewBreadcrumb: nextBreadcrumb,
    descendStack: nextDescendStack,
    rootView: savedRoot,
    ...resetInteraction,
  };
};

const selectionAfterInstancesChange = (state: ProjectState, instances: Instance[]) => {
  const existingIds = new Set(instances.map(instance => instance.id));
  const selectedInstanceIds = state.selectedInstanceIds.filter(id => existingIds.has(id));
  const selectedInstanceId = state.selectedInstanceId && existingIds.has(state.selectedInstanceId)
    ? state.selectedInstanceId
    : selectedInstanceIds.at(-1) ?? null;
  return { selectedInstanceId, selectedInstanceIds };
};

const edgeAlignmentAfterInstancesChange = (
  state: ProjectState,
  instances: Instance[],
  shapes: LayoutShape[] = state.shapes,
) => {
  const session = state.edgeAlignmentSession;
  if (!session) return null;
  const existingIds = new Set(instances.map(instance => instance.id));
  const existingShapeIds = new Set(shapes.filter(shape => shape.kind !== 'text').map(shape => shape.id));
  const exists = (id: string) => {
    if (existingIds.has(id)) return true;
    if (id === PIXEL_ARRAY_ALIGNMENT_ID) return Boolean(state.pixelArray?.visible);
    const shapeId = parseShapeAlignmentId(id);
    return shapeId !== null && existingShapeIds.has(shapeId);
  };
  return session.sourceIds.every(exists) && exists(session.sourceId) && (!session.targetId || exists(session.targetId))
    ? session
    : null;
};

const getAlignable = (state: ProjectState, id: string) => {
  if (id === PIXEL_ARRAY_ALIGNMENT_ID) {
    const array = state.pixelArray;
    if (!array?.visible) throw new Error('The pixel array is hidden or no longer exists');
    return {
      id,
      name: 'Pixel Array',
      x: array.x,
      y: array.y,
      width: array.width,
      height: array.height,
      orientation: 'R0',
    };
  }
  const shapeId = parseShapeAlignmentId(id);
  if (shapeId !== null) {
    const shape = state.shapes.find(item => item.id === shapeId && item.kind !== 'text');
    if (!shape) throw new Error('The alignment shape no longer exists');
    return {
      id,
      name: shape.label?.trim() || formatLppLabel(shape.layer, shape.purpose),
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      orientation: 'R0',
    };
  }
  const instance = state.instances.find(item => item.id === id);
  if (!instance) throw new Error('The alignment instance no longer exists');
  const master = state.masterCells[instance.cellId];
  if (!master) throw new Error('The alignment master cell no longer exists');
  return { ...instance, width: master.width, height: master.height, originX: master.originX, originY: master.originY };
};

const alignmentPositionPatch = (
  state: ProjectState,
  sourceId: string,
  x: number,
  y: number,
): Pick<ProjectSnapshot, 'instances' | 'pixelArray'> & { shapes?: LayoutShape[] } => {
  if (sourceId === PIXEL_ARRAY_ALIGNMENT_ID) {
    if (!state.pixelArray) throw new Error('The pixel array no longer exists');
    return { instances: state.instances, pixelArray: { ...state.pixelArray, x, y } };
  }
  const shapeId = parseShapeAlignmentId(sourceId);
  if (shapeId !== null) {
    const shape = state.shapes.find(item => item.id === shapeId);
    if (!shape) throw new Error('The alignment shape no longer exists');
    if (shape.locked) throw new Error('Cannot align because this shape is locked');
    const snapped = snapUnboundedPosition(x, y, state.gridSize);
    return {
      instances: state.instances,
      pixelArray: state.pixelArray,
      shapes: state.shapes.map(item => (item.id === shapeId ? { ...item, x: snapped.x, y: snapped.y } : item)),
    };
  }
  return {
    instances: state.instances.map(instance => (
      instance.id === sourceId ? { ...instance, x, y } : instance
    )),
    pixelArray: state.pixelArray,
  };
};

const OVERLAP_EPSILON = 1e-9;

export const boundsOverlap = (
  a: { left: number; right: number; bottom: number; top: number },
  b: { left: number; right: number; bottom: number; top: number },
): boolean => (
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > OVERLAP_EPSILON
  && Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > OVERLAP_EPSILON
);

/**
 * Finds the first existing instance whose physical footprint strictly overlaps
 * `candidate` (touching/abutting edges with zero interior area are not overlaps).
 * Used for non-blocking DRC preview hints — cells are allowed to overlap in Virtuoso.
 */
export const findOverlappingInstance = (
  candidate: { id?: string; x: number; y: number; orientation: string; width: number; height: number; originX?: number; originY?: number; mosaic?: InstanceMosaic },
  instances: readonly Instance[],
  masterCells: Record<string, Cell>,
  ignoreIds?: ReadonlySet<string>,
): Instance | null => {
  if (!(Number.isFinite(candidate.width) && Number.isFinite(candidate.height) && candidate.width > 0 && candidate.height > 0)) {
    return null;
  }
  const candidateBounds = getPhysicalBounds({
    id: candidate.id ?? '__candidate__',
    x: candidate.x,
    y: candidate.y,
    orientation: candidate.orientation,
    width: candidate.width,
    height: candidate.height,
    originX: candidate.originX,
    originY: candidate.originY,
    mosaic: candidate.mosaic,
  });
  for (const existing of instances) {
    if (candidate.id && existing.id === candidate.id) continue;
    if (ignoreIds?.has(existing.id)) continue;
    const master = masterCells[existing.cellId];
    if (!master || master.width <= 0 || master.height <= 0) continue;
    const existingBounds = getPhysicalBounds({
      ...existing,
      width: master.width,
      height: master.height,
      originX: master.originX,
      originY: master.originY,
    });
    if (boundsOverlap(candidateBounds, existingBounds)) {
      return existing;
    }
  }
  return null;
};

const isPadTouchingPerimeter = (
  bounds: { left: number; right: number; bottom: number; top: number },
  topWidth: number,
  topHeight: number,
  padInset = 0,
) => {
  const halfW = topWidth / 2 - padInset;
  const halfH = topHeight / 2 - padInset;
  return (
    bounds.left >= -halfW - 1e-9
    && bounds.right <= halfW + 1e-9
    && bounds.bottom >= -halfH - 1e-9
    && bounds.top <= halfH + 1e-9
    && (
      Math.abs(bounds.left + halfW) <= 1e-9
      || Math.abs(bounds.right - halfW) <= 1e-9
      || Math.abs(bounds.bottom + halfH) <= 1e-9
      || Math.abs(bounds.top - halfH) <= 1e-9
    )
  );
};

const alignmentGroupPositionPatch = (
  state: ProjectState,
  sourceIds: readonly string[],
  pivotId: string,
  pivotX: number,
  pivotY: number,
): Pick<ProjectSnapshot, 'instances' | 'pixelArray'> & { shapes?: LayoutShape[] } => {
  if (pivotId === PIXEL_ARRAY_ALIGNMENT_ID) {
    if (sourceIds.length !== 1) throw new Error('The pixel array cannot be part of an instance alignment group');
    return alignmentPositionPatch(state, pivotId, pivotX, pivotY);
  }
  if (parseShapeAlignmentId(pivotId) !== null) {
    if (sourceIds.length !== 1) throw new Error('A drawn shape cannot be part of an instance alignment group');
    return alignmentPositionPatch(state, pivotId, pivotX, pivotY);
  }
  const pivot = state.instances.find(instance => instance.id === pivotId);
  if (!pivot) throw new Error('The alignment source no longer exists');
  const deltaX = pivotX - pivot.x;
  const deltaY = pivotY - pivot.y;
  const sourceSet = new Set(sourceIds);
  const instances = state.instances.map(instance => {
    if (!sourceSet.has(instance.id)) return instance;
    if (instance.locked) {
      throw new Error(`Cannot align because ${instance.name} is locked`);
    }
    const master = state.masterCells[instance.cellId];
    if (!master) throw new Error(`The master for ${instance.name} no longer exists`);
    const requestedX = instance.x + deltaX;
    const requestedY = instance.y + deltaY;
    const checked = state.activeCellId || master.kind !== 'pad'
      ? snapUnboundedPosition(requestedX, requestedY, state.gridSize)
      : clampInstancePosition(
          requestedX, requestedY, instance.orientation, master.width, master.height,
          state.topWidth, state.topHeight, state.gridSize, master.originX ?? 0, master.originY ?? 0,
        );
    if (Math.abs(checked.x - requestedX) > 1e-9 || Math.abs(checked.y - requestedY) > 1e-9) {
      throw new RangeError(`Cannot shift the selected group without moving ${instance.name} off-grid or outside the top cell`);
    }
    if (master.kind === 'pad' && !state.activeCellId) {
      const bounds = getPhysicalBounds({
        ...instance, x: checked.x, y: checked.y, width: master.width, height: master.height,
        originX: master.originX, originY: master.originY,
      });
      if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
        throw new RangeError(`Cannot shift the group because pad ${instance.name} would leave the top-cell perimeter`);
      }
    }
    return { ...instance, x: checked.x, y: checked.y };
  });
  return { instances, pixelArray: state.pixelArray };
};

const edgeAlignmentPatch = (
  state: ProjectState,
  sourceId: string,
  targetId: string,
  sourceEdge: AlignmentEdge,
  targetEdge: AlignmentEdge,
  offset: number,
  displaySpacing?: number,
  sourceIds: readonly string[] = [sourceId],
) => {
  if (sourceIds.includes(targetId)) throw new Error('The reference must not be part of the moving selection');
  const source = getAlignable(state, sourceId);
  const target = getAlignable(state, targetId);

  const position = alignInstanceToTarget(
    source,
    target,
    sourceEdge,
    targetEdge,
    offset,
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize, unbounded: Boolean(state.activeCellId) || sourceId !== PIXEL_ARRAY_ALIGNMENT_ID },
  );
  const patch = alignmentGroupPositionPatch(state, sourceIds, sourceId, position.x, position.y);
  const nextShapes = patch.shapes ?? state.shapes;
  const boundsSync = state.activeCellId
    ? syncMasterBoundsForActiveCell(state, nextShapes, patch.instances, patch.pixelArray ?? null, false, Boolean(patch.shapes))
    : null;
  const offsetLabel = displaySpacing === undefined
    ? (offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset} um`)
    : (displaySpacing === 0 ? '' : ` gap ${displaySpacing} um`);
  return commitProjectPatch(
    state,
    `Align ${sourceIds.length > 1 ? `${sourceIds.length} objects via ` : ''}${source.name}.${sourceEdge} to ${target.name}.${targetEdge}${offsetLabel}`,
    { ...patch, ...(boundsSync ?? {}) },
  );
};

const edgeAlignmentCoordinatePatch = (
  state: ProjectState,
  sourceId: string,
  sourceEdge: AlignmentEdge,
  targetCoordinate: number,
  offset: number,
  referenceLabel: string,
  displaySpacing?: number,
  sourceIds: readonly string[] = [sourceId],
) => {
  const source = getAlignable(state, sourceId);
  const position = alignInstanceToCoordinate(
    source,
    sourceEdge,
    targetCoordinate,
    offset,
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize, unbounded: Boolean(state.activeCellId) || sourceId !== PIXEL_ARRAY_ALIGNMENT_ID },
  );
  const patch = alignmentGroupPositionPatch(state, sourceIds, sourceId, position.x, position.y);
  const nextShapes = patch.shapes ?? state.shapes;
  const boundsSync = state.activeCellId
    ? syncMasterBoundsForActiveCell(state, nextShapes, patch.instances, patch.pixelArray ?? null, false, Boolean(patch.shapes))
    : null;
  const offsetLabel = displaySpacing === undefined
    ? (offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset} um`)
    : (displaySpacing === 0 ? '' : ` gap ${displaySpacing} um`);
  return commitProjectPatch(
    state,
    `Align ${sourceIds.length > 1 ? `${sourceIds.length} objects via ` : ''}${source.name}.${sourceEdge} to ${referenceLabel}${offsetLabel}`,
    { ...patch, ...(boundsSync ?? {}) },
  );
};

const parseEdgeAlignmentSpacing = (session: EdgeAlignmentSession) => {
  const trimmedOffset = session.offset.trim();
  const spacing = trimmedOffset === '' ? Number.NaN : Number(trimmedOffset);
  if (!Number.isFinite(spacing) || spacing < 0) {
    throw new RangeError('Alignment spacing must be a finite number greater than or equal to zero');
  }
  return spacing;
};

const directionalSpacingOffset = (
  source: ReturnType<typeof getAlignable>,
  sourceEdge: AlignmentEdge,
  targetCoordinate: number,
  spacing: number,
) => {
  const bounds = getPhysicalBounds(source);
  const sourceCoordinate = getEdgeCoordinate(bounds, sourceEdge);
  // A source before/below the reference satisfies sourceEdge + spacing = referenceEdge.
  // A source after/above it satisfies referenceEdge + spacing = sourceEdge.
  const sourceComesFirst = Math.abs(sourceCoordinate - targetCoordinate) <= 1e-9
    ? (getAlignmentEdgeAxis(sourceEdge) === 'horizontal' ? bounds.centerX : bounds.centerY) < targetCoordinate
    : sourceCoordinate < targetCoordinate;
  return spacing * (sourceComesFirst ? -1 : 1);
};

const ALIGNMENT_SPACING_STORAGE_KEY = 'ic-floorplanner:alignment-spacing:v1';

const readStoredAlignmentSpacing = () => {
  if (typeof window === 'undefined') return '0';
  try {
    const value = window.localStorage.getItem(ALIGNMENT_SPACING_STORAGE_KEY)?.trim();
    if (value && Number.isFinite(Number(value)) && Number(value) >= 0) return value;
  } catch {
    // Browser storage is optional; the in-memory preference still works.
  }
  return '0';
};

const storeAlignmentSpacing = (value: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ALIGNMENT_SPACING_STORAGE_KEY, value);
  } catch {
    // Keep alignment usable when storage is blocked or unavailable.
  }
};

export const useStore = create<ProjectState>((set) => ({
  gridSize: 0.005,
  appMode: 'select',
  
  topWidth: 100, 
  topHeight: 100,
  topLibName: 'chip_lib',
  topCellName: 'top_asic',
  padInset: 0,
  libraries: ['chip_lib'],
  
  masterCells: {},
  instances: [],
  rulers: [],
  shapes: [],
  activeCoordinateMode: 'origin',
  pixelArray: null,
  pendingPixelArraySize: null,
  cellViews: {},
  activeCellId: null,
  openViewIds: [null],
  windowLayoutMode: 'tabs',
  viewBreadcrumb: [],
  descendStack: [],
  showEditInPlaceContext: true,
  partialSelectMode: false,
  rootView: null,
  selectedInstanceId: null,
  selectedInstanceIds: [],
  selectedShapeId: null,
  pixelArraySelected: false,
  activeDrawLayer: 'text',
  activeDrawPurpose: 'drawing',
  activeDrawLabel: '',
  activeDrawColor: '',
  activeTextContent: 'LABEL',
  activeTextFontSize: 20,
  activeTextFontFamily: 'stick',
  activeTextFontStyle: 'normal',
  activeTextOrientation: 'R0',
  activeTextLayer: 'text',
  activeTextPurpose: 'drawing',
  activeTextColor: '',
  showCreateModal: false,
  showInstantiateModal: false,
  leftSidebarPinned: false,
  rightSidebarPinned: false,
  
  placementMasterId: null,
  placementOrientation: 'R0',
  pendingInstanceArray: null,
  pendingManualPadGroup: null,
  pendingCopyGroup: null,
  history: { past: [], future: [] },
  edgeAlignmentSession: null,
  lastAlignmentSpacing: readStoredAlignmentSpacing(),
  orthogonalRuler: false,
  moveConstraint: 'orthogonal',
  showAutoDim: false,
  showOverlapDrc: false,
  showGrid: true,
  snapToVisibleGrid: false,
  clipboard: [],
  shapeClipboard: [],
  clipboardWasCut: false,

  setGridSize: (size) => set((state) => {
    if (!Number.isFinite(size) || size <= 0) return state;
    const padInset = normalizePadInset(state.padInset, state.topWidth, state.topHeight, size);
    const instances = clampInstancesToContainer(state.instances, state.masterCells, state.topWidth, state.topHeight, size, padInset, undefined, Boolean(state.activeCellId));
    const shapes = normalizeShapesForGrid(state.shapes, size);
    const activeOrigin = getActiveContainerOrigin(state);
    const pixelArray = state.pixelArray
      ? normalizePixelArray(state.pixelArray, state.topWidth, state.topHeight, size, activeOrigin.originX, activeOrigin.originY)
      : null;

    const nextRootView = state.rootView ? (() => {
      const rootInset = normalizePadInset(state.rootView.padInset, state.rootView.topWidth, state.rootView.topHeight, size);
      return {
        ...state.rootView,
        padInset: rootInset,
        instances: clampInstancesToContainer(state.rootView.instances, state.masterCells, state.rootView.topWidth, state.rootView.topHeight, size, rootInset),
        shapes: normalizeShapesForGrid(state.rootView.shapes, size),
        pixelArray: state.rootView.pixelArray
          ? normalizePixelArray(state.rootView.pixelArray, state.rootView.topWidth, state.rootView.topHeight, size)
          : null,
      };
    })() : state.rootView;

    const nextCellViews: Record<string, CellViewContent> = {};
    for (const [cellId, view] of Object.entries(state.cellViews)) {
      if (cellId === state.activeCellId) continue;
      const container = state.masterCells[cellId];
      if (!container) continue;
      const viewInset = normalizePadInset(view.padInset ?? 0, container.width, container.height, size);
      const isOriginView = resolveStoredCoordinateMode(view) === 'origin';
      const viewInstances = clampInstancesToContainer(view.instances, state.masterCells, container.width, container.height, size, viewInset, undefined, isOriginView);
      const viewShapes = normalizeShapesForGrid(view.shapes ?? [], size);
      const viewOriginX = isOriginView ? (container.originX ?? 0) : -container.width / 2;
      const viewOriginY = isOriginView ? (container.originY ?? 0) : -container.height / 2;
      const viewPixelArray = view.pixelArray
        ? normalizePixelArray(view.pixelArray, container.width, container.height, size, viewOriginX, viewOriginY)
        : null;
      nextCellViews[cellId] = buildCellViewContent(viewInstances, view.rulers, viewPixelArray, viewInset, viewShapes, view.coordinateMode);
    }

    return commitProjectPatch(state, 'Change grid', {
      gridSize: size,
      padInset,
      instances,
      shapes,
      pixelArray,
      ...(nextRootView !== state.rootView ? { rootView: nextRootView } : {}),
      cellViews: nextCellViews,
    });
  }),
  setAppMode: (mode) => set({
    appMode: mode,
    edgeAlignmentSession: null,
    ...(mode === 'pixel-array' ? {} : { pendingPixelArraySize: null }),
    ...(mode === 'place' ? {} : { pendingManualPadGroup: null, pendingCopyGroup: null }),
    ...(mode === 'text' || mode === 'rect' ? { partialSelectMode: false } : {}),
  }),
  setTopDimensions: (w, h) => set((state) => {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new RangeError('Cell width and height must be positive finite numbers');
    }
    const padInset = normalizePadInset(state.padInset, w, h, state.gridSize);
    const instances = clampInstancesToContainer(state.instances, state.masterCells, w, h, state.gridSize, padInset, undefined, Boolean(state.activeCellId));
    const activeOrigin = state.activeCellId && state.activeCoordinateMode === 'origin'
      ? { originX: state.masterCells[state.activeCellId]?.originX ?? 0, originY: state.masterCells[state.activeCellId]?.originY ?? 0 }
      : { originX: -w / 2, originY: -h / 2 };
    const pixelArray = state.pixelArray
      ? normalizePixelArray(state.pixelArray, w, h, state.gridSize, activeOrigin.originX, activeOrigin.originY)
      : null;

    if (state.activeCellId && state.masterCells[state.activeCellId]) {
      const activeId = state.activeCellId;
      const masterCells = {
        ...state.masterCells,
        [activeId]: { ...state.masterCells[activeId], width: w, height: h },
      };
      const rootView = state.rootView
        ? {
            ...state.rootView,
            instances: clampInstancesToContainer(state.rootView.instances, masterCells, state.rootView.topWidth, state.rootView.topHeight, state.gridSize, state.rootView.padInset, activeId),
          }
        : state.rootView;
      const nextCellViews: Record<string, CellViewContent> = {};
      for (const [cellId, view] of Object.entries(state.cellViews)) {
        if (cellId === activeId) continue;
        const container = masterCells[cellId];
        if (!container) continue;
        nextCellViews[cellId] = {
          ...view,
          instances: clampInstancesToContainer(view.instances, masterCells, container.width, container.height, state.gridSize, view.padInset ?? 0, activeId, resolveStoredCoordinateMode(view) === 'origin'),
        };
      }
      return commitProjectPatch(state, `Resize ${masterCells[activeId].cellName}`, {
        topWidth: w,
        topHeight: h,
        padInset,
        masterCells,
        instances,
        pixelArray,
        rootView,
        cellViews: nextCellViews,
      });
    }

    return commitProjectPatch(state, 'Resize top cell', { topWidth: w, topHeight: h, padInset, instances, pixelArray });
  }),
  setTopNames: (lib, cell) => set((state) => {
    const nextLibName = lib.trim();
    const nextCellName = cell.trim();
    if (!nextLibName || !nextCellName) throw new Error('Library and cell names are required');

    if (state.activeCellId && state.masterCells[state.activeCellId]) {
      const activeId = state.activeCellId;
      const rootId = getRootIdentity(state);
      if (nextLibName === rootId.topLibName && nextCellName === rootId.topCellName) {
        throw new Error('The top cell cannot also be used as a master cell');
      }
      if (Object.values(state.masterCells).some(m => m.id !== activeId && m.libName === nextLibName && m.cellName === nextCellName)) {
        throw new Error(`Cell ${nextLibName}/${nextCellName} already exists`);
      }
      const masterCells = {
        ...state.masterCells,
        [activeId]: { ...state.masterCells[activeId], libName: nextLibName, cellName: nextCellName },
      };
      return commitProjectPatch(state, `Rename ${nextCellName}`, { topLibName: nextLibName, topCellName: nextCellName, masterCells });
    }

    if (Object.values(state.masterCells).some(m => m.libName === nextLibName && m.cellName === nextCellName)) {
      throw new Error(`Cell ${nextLibName}/${nextCellName} already exists as a master cell`);
    }
    return commitProjectPatch(state, 'Rename top cell', { topLibName: nextLibName, topCellName: nextCellName });
  }),
  setTopConfig: (lib, cell, w, h, rawPadInset) => set((state) => {
    const nextLibName = lib.trim();
    const nextCellName = cell.trim();
    if (!nextLibName || !nextCellName) throw new Error('Library and cell names are required');
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new RangeError('Cell width and height must be positive finite numbers');
    }
    const padInset = normalizePadInset(rawPadInset ?? state.padInset, w, h, state.gridSize);

    if (state.activeCellId && state.masterCells[state.activeCellId]) {
      const activeId = state.activeCellId;
      const rootId = getRootIdentity(state);
      if (nextLibName === rootId.topLibName && nextCellName === rootId.topCellName) {
        throw new Error('The top cell cannot also be used as a master cell');
      }
      if (Object.values(state.masterCells).some(m => m.id !== activeId && m.libName === nextLibName && m.cellName === nextCellName)) {
        throw new Error(`Cell ${nextLibName}/${nextCellName} already exists`);
      }
      const masterCells = {
        ...state.masterCells,
        [activeId]: { ...state.masterCells[activeId], libName: nextLibName, cellName: nextCellName, width: w, height: h },
      };
      const instances = clampInstancesToContainer(state.instances, masterCells, w, h, state.gridSize, padInset, undefined, true);
      const activeOrigin = state.activeCoordinateMode === 'origin'
        ? { originX: masterCells[activeId].originX ?? 0, originY: masterCells[activeId].originY ?? 0 }
        : { originX: -w / 2, originY: -h / 2 };
      const pixelArray = state.pixelArray
        ? normalizePixelArray(state.pixelArray, w, h, state.gridSize, activeOrigin.originX, activeOrigin.originY)
        : null;
      const rootView = state.rootView
        ? {
            ...state.rootView,
            instances: clampInstancesToContainer(state.rootView.instances, masterCells, state.rootView.topWidth, state.rootView.topHeight, state.gridSize, state.rootView.padInset, activeId),
          }
        : state.rootView;
      const nextCellViews: Record<string, CellViewContent> = {};
      for (const [cellId, view] of Object.entries(state.cellViews)) {
        if (cellId === activeId) continue;
        const container = masterCells[cellId];
        if (!container) continue;
        nextCellViews[cellId] = {
          ...view,
          instances: clampInstancesToContainer(view.instances, masterCells, container.width, container.height, state.gridSize, view.padInset ?? 0, activeId, resolveStoredCoordinateMode(view) === 'origin'),
        };
      }
      return commitProjectPatch(state, `Update ${nextCellName}`, {
        topLibName: nextLibName,
        topCellName: nextCellName,
        topWidth: w,
        topHeight: h,
        padInset,
        masterCells,
        instances,
        pixelArray,
        rootView,
        cellViews: nextCellViews,
      });
    }

    if (Object.values(state.masterCells).some(m => m.libName === nextLibName && m.cellName === nextCellName)) {
      throw new Error(`Cell ${nextLibName}/${nextCellName} already exists as a master cell`);
    }
    const instances = clampInstancesToContainer(state.instances, state.masterCells, w, h, state.gridSize, padInset);
    const pixelArray = state.pixelArray
      ? normalizePixelArray(state.pixelArray, w, h, state.gridSize)
      : null;
    return commitProjectPatch(state, 'Update top cell', {
      topLibName: nextLibName,
      topCellName: nextCellName,
      topWidth: w,
      topHeight: h,
      padInset,
      instances,
      pixelArray,
    });
  }),
  setPadInset: (rawInset) => set((state) => {
    const padInset = normalizePadInset(rawInset, state.topWidth, state.topHeight, state.gridSize);
    const instances = state.instances.map(instance => {
      const master = state.masterCells[instance.cellId];
      if (!master || master.kind !== 'pad') return instance;
      const position = snapPadToNearestEdge(
        instance.x,
        instance.y,
        master.width,
        master.height,
        state.topWidth,
        state.topHeight,
        state.gridSize,
        instance.orientation,
        padInset,
        master.originX ?? 0,
        master.originY ?? 0,
      );
      return { ...instance, x: position.x, y: position.y };
    });
    return commitProjectPatch(state, `Set pad inset ${padInset} um`, { padInset, instances });
  }),
  setShowCreateModal: (show) => set({ showCreateModal: show }),
  setShowInstantiateModal: (show) => set({ showInstantiateModal: show }),
  setLeftSidebarPinned: (pinned) => set({ leftSidebarPinned: pinned }),
  setRightSidebarPinned: (pinned) => set({ rightSidebarPinned: pinned }),
  setPlacement: (masterId, orientation = 'R0', arrayConfig = null) => set((state) => {
    if (masterId) {
      const master = state.masterCells[masterId];
      if (!master) return state;
      if (state.activeCellId === masterId) {
        throw new Error(`Cannot instantiate ${master.libName}/${master.cellName} inside itself (recursive hierarchy cycle).`);
      }
      if (state.activeCellId) {
        const mergedViews = mergeActiveViewIntoCellViews(state);
        if (wouldCreateHierarchyCycle(state.activeCellId, masterId, mergedViews)) {
          throw new Error(`Cannot instantiate ${master.libName}/${master.cellName} inside ${state.topLibName}/${state.topCellName} because it would create a recursive hierarchy cycle.`);
        }
      }
      if (isCellEmpty(master)) {
        throw new Error(`Cannot instantiate empty cell ${master.libName}/${master.cellName}: open it and draw a rectangle (e.g. text/drawing) or instantiate a sub-cell first.`);
      }
    }
    return {
      placementMasterId: masterId,
      placementOrientation: orientation,
      pendingInstanceArray: masterId ? arrayConfig : null,
      appMode: masterId ? 'place' : 'select',
      pendingPixelArraySize: null,
      pendingManualPadGroup: null,
      pendingCopyGroup: null,
      edgeAlignmentSession: null,
    };
  }),
  setPlacementOrientation: (orientation) => set({ placementOrientation: orientation }),
  createLibrary: (rawLibName, moveAllCells = false) => set((state) => {
    const libName = rawLibName.trim();
    if (!libName) throw new Error('Library name is required');
    if (state.libraries.includes(libName)) {
      throw new Error(`Library ${libName} already exists`);
    }
    const libraries = [...state.libraries, libName].sort((a, b) => a.localeCompare(b));
    if (!moveAllCells) {
      return commitProjectPatch(state, `Create library ${libName}`, { libraries });
    }
    const rootId = getRootIdentity(state);
    const seenNames = new Set<string>([rootId.topCellName]);
    for (const master of Object.values(state.masterCells)) {
      if (seenNames.has(master.cellName)) {
        throw new Error(`Cannot move all cells into ${libName}: duplicate cell name "${master.cellName}" across libraries.`);
      }
      seenNames.add(master.cellName);
    }
    const masterCells = Object.fromEntries(
      Object.entries(state.masterCells).map(([id, master]) => [id, { ...master, libName }]),
    );
    const rootView = state.rootView ? { ...state.rootView, topLibName: libName } : state.rootView;
    return commitProjectPatch(state, `Create library ${libName} and move all cells`, {
      libraries,
      masterCells,
      topLibName: libName,
      ...(rootView !== state.rootView ? { rootView } : {}),
    });
  }),
  renameLibrary: (rawOldName, rawNewName) => set((state) => {
    const oldName = rawOldName.trim();
    const newName = rawNewName.trim();
    if (!oldName || !newName) throw new Error('Library name is required');
    if (oldName === newName) return state;
    if (!state.libraries.includes(oldName)) throw new Error(`Library ${oldName} does not exist`);
    if (state.libraries.includes(newName)) throw new Error(`Library ${newName} already exists`);

    const masterCells = Object.fromEntries(
      Object.entries(state.masterCells).map(([id, master]) => [
        id,
        master.libName === oldName ? { ...master, libName: newName } : master,
      ]),
    );
    const libraries = state.libraries
      .map(lib => (lib === oldName ? newName : lib))
      .sort((a, b) => a.localeCompare(b));
    const rootView = state.rootView && state.rootView.topLibName === oldName
      ? { ...state.rootView, topLibName: newName }
      : state.rootView;
    const topLibName = state.topLibName === oldName ? newName : state.topLibName;

    return commitProjectPatch(state, `Rename library ${oldName} to ${newName}`, {
      libraries,
      masterCells,
      topLibName,
      ...(rootView !== state.rootView ? { rootView } : {}),
    });
  }),
  deleteLibrary: (rawLibName) => set((state) => {
    const libName = rawLibName.trim();
    if (!state.libraries.includes(libName)) return state;
    const rootId = getRootIdentity(state);
    if (rootId.topLibName === libName) {
      throw new Error(`Cannot delete library ${libName} while Top Cell ${rootId.topCellName} belongs to it.`);
    }
    if (Object.values(state.masterCells).some(master => master.libName === libName)) {
      throw new Error(`Cannot delete library ${libName} because it still contains cells. Delete or move its cells first.`);
    }
    const libraries = state.libraries.filter(lib => lib !== libName);
    return commitProjectPatch(state, `Delete library ${libName}`, { libraries });
  }),
  moveCellToLibrary: (cellId, rawTargetLib) => set((state) => {
    const targetLib = rawTargetLib.trim();
    if (!targetLib) throw new Error('Target library name is required');
    const rootId = getRootIdentity(state);
    const libraries = state.libraries.includes(targetLib)
      ? state.libraries
      : [...state.libraries, targetLib].sort((a, b) => a.localeCompare(b));

    if (cellId === null) {
      if (rootId.topLibName === targetLib) return state;
      if (Object.values(state.masterCells).some(m => m.libName === targetLib && m.cellName === rootId.topCellName)) {
        throw new Error(`Cell ${targetLib}/${rootId.topCellName} already exists.`);
      }
      if (state.activeCellId !== null && state.rootView) {
        return commitProjectPatch(state, `Move ${rootId.topCellName} to ${targetLib}`, {
          libraries,
          rootView: { ...state.rootView, topLibName: targetLib },
        });
      }
      return commitProjectPatch(state, `Move ${rootId.topCellName} to ${targetLib}`, {
        libraries,
        topLibName: targetLib,
      });
    }

    const master = state.masterCells[cellId];
    if (!master || master.libName === targetLib) return state;
    if (targetLib === rootId.topLibName && master.cellName === rootId.topCellName) {
      throw new Error(`Cell ${targetLib}/${master.cellName} collides with Top Cell.`);
    }
    if (Object.values(state.masterCells).some(m => m.id !== cellId && m.libName === targetLib && m.cellName === master.cellName)) {
      throw new Error(`Cell ${targetLib}/${master.cellName} already exists.`);
    }
    const masterCells = {
      ...state.masterCells,
      [cellId]: { ...master, libName: targetLib },
    };
    return commitProjectPatch(state, `Move ${master.cellName} to ${targetLib}`, {
      libraries,
      masterCells,
      ...(state.activeCellId === cellId ? { topLibName: targetLib } : {}),
    });
  }),
  moveAllCellsToLibrary: (rawTargetLib) => set((state) => {
    const targetLib = rawTargetLib.trim();
    if (!targetLib) throw new Error('Target library name is required');
    const rootId = getRootIdentity(state);
    const seenNames = new Set<string>([rootId.topCellName]);
    for (const master of Object.values(state.masterCells)) {
      if (seenNames.has(master.cellName)) {
        throw new Error(`Cannot move all cells into ${targetLib}: duplicate cell name "${master.cellName}" across libraries.`);
      }
      seenNames.add(master.cellName);
    }
    const libraries = state.libraries.includes(targetLib)
      ? state.libraries
      : [...state.libraries, targetLib].sort((a, b) => a.localeCompare(b));
    const masterCells = Object.fromEntries(
      Object.entries(state.masterCells).map(([id, master]) => [id, { ...master, libName: targetLib }]),
    );
    const rootView = state.rootView ? { ...state.rootView, topLibName: targetLib } : state.rootView;
    return commitProjectPatch(state, `Move all cells into ${targetLib}`, {
      libraries,
      masterCells,
      topLibName: targetLib,
      ...(rootView !== state.rootView ? { rootView } : {}),
    });
  }),
  openCellView: (cellId) => set((state) => (
    switchToCellView(state, cellId, cellId ? [cellId] : [])
  )),
  openCellViewInNewWindow: (cellId) => set((state) => {
    if (cellId !== null && !state.masterCells[cellId]) return state;
    const nextOpenViewIds = ensureOpenViewTab(state.openViewIds, cellId, state.masterCells);
    if (cellId === state.activeCellId && state.descendStack.length === 0) {
      return {
        openViewIds: nextOpenViewIds,
        windowLayoutMode: nextOpenViewIds.length >= 2 ? 'split' : state.windowLayoutMode,
      };
    }
    const switched = switchToCellView(
      { ...state, openViewIds: nextOpenViewIds },
      cellId,
      cellId ? [cellId] : [],
    );
    return {
      ...switched,
      openViewIds: nextOpenViewIds,
      windowLayoutMode: nextOpenViewIds.length >= 2 ? 'split' : 'tabs',
    };
  }),
  setWindowLayoutMode: (mode) => set((state) => ({
    windowLayoutMode: mode === 'split' && state.openViewIds.length < 2 ? 'tabs' : mode,
  })),
  closeCellViewTab: (cellId) => set((state) => {
    if (state.openViewIds.length <= 1) return state;
    const idx = state.openViewIds.indexOf(cellId);
    if (idx === -1) return state;
    const nextOpenViewIds = state.openViewIds.filter(id => id !== cellId);
    const nextLayoutMode = nextOpenViewIds.length < 2 ? 'tabs' : state.windowLayoutMode;
    const displayedTabId = state.descendStack.length > 0 ? state.descendStack[0].parentCellId : state.activeCellId;
    if (displayedTabId !== cellId) {
      return { openViewIds: nextOpenViewIds, windowLayoutMode: nextLayoutMode };
    }
    const fallbackTarget = nextOpenViewIds[Math.max(0, idx - 1)] ?? null;
    const switched = switchToCellView(
      { ...state, openViewIds: nextOpenViewIds },
      fallbackTarget,
      fallbackTarget ? [fallbackTarget] : [],
    );
    return { ...switched, openViewIds: nextOpenViewIds, windowLayoutMode: nextLayoutMode };
  }),
  descendIntoInstance: (instanceId) => set((state) => {
    const inst = state.instances.find(item => item.id === instanceId);
    if (!inst || !state.masterCells[inst.cellId]) return state;
    const frame: DescendContextFrame = {
      parentCellId: state.activeCellId,
      instanceId: inst.id,
      cellId: inst.cellId,
      instanceName: inst.name,
      x: inst.x,
      y: inst.y,
      orientation: inst.orientation,
      parentCoordinateMode: state.activeCellId === null ? 'origin' : state.activeCoordinateMode,
      parentWidth: state.topWidth,
      parentHeight: state.topHeight,
    };
    return switchToCellView(
      state,
      inst.cellId,
      [...state.viewBreadcrumb, inst.cellId],
      [...state.descendStack, frame],
    );
  }),
  ascendToParent: () => set((state) => {
    if (state.activeCellId === null) return state;
    if (state.viewBreadcrumb.length <= 1) {
      return switchToCellView(state, null, [], []);
    }
    const nextBreadcrumb = state.viewBreadcrumb.slice(0, -1);
    const parentId = nextBreadcrumb[nextBreadcrumb.length - 1] ?? null;
    const nextDescendStack = state.descendStack.length > 0
      ? state.descendStack.slice(0, -1)
      : [];
    return switchToCellView(state, parentId, nextBreadcrumb, nextDescendStack);
  }),
  navigateBreadcrumb: (index) => set((state) => {
    if (index < 0) return switchToCellView(state, null, [], []);
    const nextBreadcrumb = state.viewBreadcrumb.slice(0, index + 1);
    const targetId = nextBreadcrumb[nextBreadcrumb.length - 1] ?? null;
    const baseDepthOffset = Math.max(0, state.viewBreadcrumb.length - state.descendStack.length);
    const nextDescendCount = Math.max(0, index + 1 - baseDepthOffset);
    const nextDescendStack = state.descendStack.slice(0, nextDescendCount);
    return switchToCellView(state, targetId, nextBreadcrumb, nextDescendStack);
  }),
  
  addMasterCell: (rawLibName, rawCellName, w, h, color, opacity = 0.5, outlineStyle = 'solid', openAfterCreate = false, autoBounds = false) => set((state) => {
    const rootId = getRootIdentity(state);
    const libName = rawLibName.trim() || rootId.topLibName;
    const cellName = rawCellName.trim();
    if (!libName || !cellName) throw new Error('Master library and cell name are required');
    if (libName === rootId.topLibName && cellName === rootId.topCellName) {
      throw new Error('The top cell cannot also be used as a master cell');
    }
    const isEmptyAutoCell = autoBounds && w === 0 && h === 0;
    if (!isEmptyAutoCell && (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)) {
      throw new RangeError('Master width and height must be positive finite numbers');
    }
    const existing = Object.values(state.masterCells).find(c => c.libName === libName && c.cellName === cellName);
    if (existing) {
      throw new Error(`Cell name ${cellName} is already used in ${libName}`);
    }
    const appearance = normalizeCellAppearance(opacity, outlineStyle);
    const id = uuidv4();
    const committed = commitProjectPatch(state, `Create ${libName}/${cellName}`, {
      masterCells: {
        ...state.masterCells,
        [id]: { id, libName, cellName, width: w, height: h, color, ...appearance, ...(autoBounds ? { autoBounds: true } : {}) }
      },
    });
    if (!openAfterCreate) return committed;
    const switched = switchToCellView({ ...state, ...committed }, id, [id]);
    return {
      ...committed,
      ...switched,
      history: committed.history,
    };
  }),

  createEmptyCell: (rawLibName, rawCellName, color = '#3b82f6', openAfterCreate = true) => set((state) => {
    const rootId = getRootIdentity(state);
    const libName = rawLibName.trim() || rootId.topLibName;
    const cellName = rawCellName.trim();
    if (!libName || !cellName) throw new Error('Library and cell name are required');
    if (libName === rootId.topLibName && cellName === rootId.topCellName) {
      throw new Error('The top cell cannot also be used as a master cell');
    }
    const existing = Object.values(state.masterCells).find(c => c.libName === libName && c.cellName === cellName);
    if (existing) {
      throw new Error(`Cell name ${cellName} is already used in ${libName}`);
    }
    const id = uuidv4();
    const committed = commitProjectPatch(state, `Create ${libName}/${cellName}`, {
      masterCells: {
        ...state.masterCells,
        [id]: {
          id,
          libName,
          cellName,
          width: 0,
          height: 0,
          color,
          opacity: 0.5,
          outlineStyle: 'solid',
          autoBounds: true,
        },
      },
    });
    if (!openAfterCreate) return committed;
    const switched = switchToCellView({ ...state, ...committed }, id, [id]);
    return {
      ...committed,
      ...switched,
      history: committed.history,
    };
  }),

  updateMasterCell: (id, rawLibName, rawCellName, w, h, color, opacity = 0.5, outlineStyle = 'solid') => set((state) => {
    const existing = state.masterCells[id];
    if (!existing) return state;
    const rootId = getRootIdentity(state);
    const libName = rawLibName.trim() || existing.libName;
    const cellName = rawCellName.trim();
    if (!libName || !cellName) throw new Error('Master library and cell name are required');
    if (libName === rootId.topLibName && cellName === rootId.topCellName) {
      throw new Error('The top cell cannot also be used as a master cell');
    }
    const nextW = existing.autoBounds ? existing.width : w;
    const nextH = existing.autoBounds ? existing.height : h;
    if (!existing.autoBounds && (!Number.isFinite(nextW) || !Number.isFinite(nextH) || nextW <= 0 || nextH <= 0)) {
      throw new RangeError('Master width and height must be positive finite numbers');
    }
    if (Object.values(state.masterCells).some(master => master.id !== id && master.libName === libName && master.cellName === cellName)) {
      throw new Error(`Cell name ${cellName} is already used in ${libName}`);
    }
    const appearance = normalizeCellAppearance(opacity, outlineStyle);
    const masterCells = {
      ...state.masterCells,
      [id]: { ...existing, libName, cellName, width: nextW, height: nextH, color, ...appearance },
    };

    const editingActiveView = state.activeCellId === id;
    const activePadInset = editingActiveView
      ? normalizePadInset(state.padInset, nextW, nextH, state.gridSize)
      : state.padInset;
    const instances = editingActiveView
      ? clampInstancesToContainer(state.instances, masterCells, nextW, nextH, state.gridSize, activePadInset, undefined, true)
      : clampInstancesToContainer(state.instances, masterCells, state.topWidth, state.topHeight, state.gridSize, state.padInset, id, Boolean(state.activeCellId));
    const editingOriginX = state.activeCoordinateMode === 'origin' ? (existing.originX ?? 0) : -nextW / 2;
    const editingOriginY = state.activeCoordinateMode === 'origin' ? (existing.originY ?? 0) : -nextH / 2;
    const pixelArray = editingActiveView && state.pixelArray
      ? normalizePixelArray(state.pixelArray, nextW, nextH, state.gridSize, editingOriginX, editingOriginY)
      : state.pixelArray;
    const rootView = state.rootView
      ? {
          ...state.rootView,
          instances: clampInstancesToContainer(state.rootView.instances, masterCells, state.rootView.topWidth, state.rootView.topHeight, state.gridSize, state.rootView.padInset, id),
        }
      : state.rootView;
    const nextCellViews: Record<string, CellViewContent> = {};
    for (const [viewCellId, view] of Object.entries(state.cellViews)) {
      if (viewCellId === state.activeCellId) continue;
      const container = masterCells[viewCellId];
      if (!container) continue;
      if (viewCellId === id) {
        const viewInset = normalizePadInset(view.padInset ?? 0, nextW, nextH, state.gridSize);
        const isOriginView = resolveStoredCoordinateMode(view) === 'origin';
        const viewOriginX = isOriginView ? (existing.originX ?? 0) : -nextW / 2;
        const viewOriginY = isOriginView ? (existing.originY ?? 0) : -nextH / 2;
        nextCellViews[viewCellId] = buildCellViewContent(
          clampInstancesToContainer(view.instances, masterCells, nextW, nextH, state.gridSize, viewInset, undefined, isOriginView),
          view.rulers,
          view.pixelArray ? normalizePixelArray(view.pixelArray, nextW, nextH, state.gridSize, viewOriginX, viewOriginY) : null,
          viewInset,
          view.shapes ?? [],
          view.coordinateMode,
        );
      } else {
        const isOriginView = resolveStoredCoordinateMode(view) === 'origin';
        nextCellViews[viewCellId] = {
          ...view,
          instances: clampInstancesToContainer(view.instances, masterCells, container.width, container.height, state.gridSize, view.padInset ?? 0, id, isOriginView),
        };
      }
    }

    return commitProjectPatch(state, `Edit ${libName}/${cellName}`, {
      masterCells,
      instances,
      pixelArray,
      padInset: activePadInset,
      ...(editingActiveView ? { topLibName: libName, topCellName: cellName, topWidth: nextW, topHeight: nextH } : {}),
      ...(rootView !== state.rootView ? { rootView } : {}),
      cellViews: nextCellViews,
    });
  }),

  deleteMasterCell: (id) => set((state) => {
    const deleted = state.masterCells[id];
    if (!deleted) return state;
    const newMasterCells = { ...state.masterCells };
    delete newMasterCells[id];

    const flushedViews = mergeActiveViewIntoCellViews(state);
    const cleanedCellViews: Record<string, CellViewContent> = {};
    for (const [viewCellId, view] of Object.entries(flushedViews)) {
      if (viewCellId === id || !newMasterCells[viewCellId]) continue;
      const filteredInstances = view.instances.filter(inst => inst.cellId !== id);
      const nextView = buildCellViewContent(
        filteredInstances,
        view.rulers,
        view.pixelArray ?? null,
        view.padInset ?? 0,
        view.shapes ?? [],
        view.coordinateMode,
      );
      if (!isEmptyCellView(nextView)) {
        cleanedCellViews[viewCellId] = nextView;
      }
    }

    const propagatedMasterCells = propagateAutoBounds(newMasterCells, cleanedCellViews);
    const clearingPlacement = state.placementMasterId === id
      || state.pendingManualPadGroup?.masterId === id
      || Boolean(state.pendingCopyGroup?.instances.some(item => item.cellId === id));
    const deletingOpenPath = state.activeCellId === id || state.viewBreadcrumb.includes(id);
    const cleanedOpenViewIds = ensureOpenViewTab(
      state.openViewIds.filter(tabId => tabId !== id),
      deletingOpenPath ? null : state.activeCellId,
      propagatedMasterCells,
    );

    if (deletingOpenPath && state.rootView) {
      const rootInstances = state.rootView.instances.filter(inst => inst.cellId !== id);
      return {
        ...commitProjectPatch(state, `Delete ${deleted.cellName}`, {
          topWidth: state.rootView.topWidth,
          topHeight: state.rootView.topHeight,
          topLibName: state.rootView.topLibName,
          topCellName: state.rootView.topCellName,
          padInset: state.rootView.padInset,
          instances: rootInstances,
          rulers: state.rootView.rulers,
          shapes: state.rootView.shapes,
          activeCoordinateMode: 'origin',
          pixelArray: state.rootView.pixelArray,
          masterCells: propagatedMasterCells,
          cellViews: cleanedCellViews,
          activeCellId: null,
          openViewIds: cleanedOpenViewIds,
          viewBreadcrumb: [],
          descendStack: [],
          rootView: null,
        }),
        selectedInstanceId: null,
        selectedInstanceIds: [],
        selectedShapeId: null,
        pixelArraySelected: false,
        edgeAlignmentSession: null,
        placementMasterId: null,
        pendingInstanceArray: null,
        pendingManualPadGroup: null,
        pendingCopyGroup: null,
        pendingPixelArraySize: null,
        appMode: 'select',
      };
    }

    const newInstances = state.instances.filter(inst => inst.cellId !== id);
    const nextRootView = state.rootView
      ? { ...state.rootView, instances: state.rootView.instances.filter(inst => inst.cellId !== id) }
      : state.rootView;
    const updatedActiveMaster = state.activeCellId ? propagatedMasterCells[state.activeCellId] : null;
    return {
      ...commitProjectPatch(state, `Delete ${deleted.cellName}`, {
        masterCells: propagatedMasterCells,
        instances: newInstances,
        cellViews: cleanedCellViews,
        openViewIds: cleanedOpenViewIds,
        ...(updatedActiveMaster ? { topWidth: updatedActiveMaster.width, topHeight: updatedActiveMaster.height } : {}),
        ...(nextRootView !== state.rootView ? { rootView: nextRootView } : {}),
      }),
      ...selectionAfterInstancesChange(state, newInstances),
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, newInstances),
      ...(clearingPlacement ? {
        placementMasterId: null,
        pendingInstanceArray: null,
        pendingManualPadGroup: null,
        pendingCopyGroup: null,
        appMode: state.appMode === 'place' ? 'select' : state.appMode,
      } : {}),
    };
  }),

  setActiveDrawLpp: (layer, purpose, color = '') => set({
    activeDrawLayer: layer.trim() || 'text',
    activeDrawPurpose: purpose.trim() || 'drawing',
    activeDrawColor: color,
  }),

  setActiveDrawLabel: (label) => set({ activeDrawLabel: label }),

  setActiveTextConfig: (patch) => set((state) => ({
    ...(patch.content !== undefined ? { activeTextContent: patch.content } : {}),
    ...(patch.fontSize !== undefined && Number.isFinite(patch.fontSize) && patch.fontSize > 0
      ? { activeTextFontSize: patch.fontSize }
      : {}),
    ...(patch.fontFamily !== undefined ? { activeTextFontFamily: patch.fontFamily } : {}),
    ...(patch.fontStyle !== undefined ? { activeTextFontStyle: patch.fontStyle } : {}),
    ...(patch.orientation !== undefined ? { activeTextOrientation: patch.orientation } : {}),
    ...(patch.layer !== undefined ? { activeTextLayer: patch.layer } : {}),
    ...(patch.purpose !== undefined ? { activeTextPurpose: patch.purpose } : {}),
    ...(patch.color !== undefined ? { activeTextColor: patch.color } : {}),
    ...(patch.layer === undefined && patch.purpose === undefined ? {} : {
      activeTextLayer: (patch.layer ?? state.activeTextLayer),
      activeTextPurpose: (patch.purpose ?? state.activeTextPurpose),
    }),
  })),

  setSelectedShape: (id) => set((state) => {
    if (!id || !state.shapes.some(shape => shape.id === id)) {
      return { selectedShapeId: null };
    }
    return {
      selectedShapeId: id,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      pixelArraySelected: false,
      edgeAlignmentSession: null,
    };
  }),

  addShape: (rawShape) => {
    const id = uuidv4();
    set((state) => {
      const layer = rawShape.layer.trim() || 'text';
      const purpose = rawShape.purpose.trim() || 'drawing';
      const isText = rawShape.kind === 'text';
      if (!Number.isFinite(rawShape.x) || !Number.isFinite(rawShape.y)) {
        throw new RangeError('Shape coordinates must be finite numbers.');
      }
      const x = snapToGrid(rawShape.x, state.gridSize);
      const y = snapToGrid(rawShape.y, state.gridSize);

      let shape: LayoutShape;
      let actionLabel: string;
      if (isText) {
        const text = (rawShape.label ?? '').trim();
        if (!text) {
          throw new Error('Text label cannot be empty.');
        }
        const rawSize = rawShape.fontSize ?? rawShape.height;
        if (!Number.isFinite(rawSize) || rawSize <= 0) {
          throw new RangeError('Font size must be a positive finite number.');
        }
        const fontSize = Math.max(state.gridSize, snapToGrid(rawSize, state.gridSize));
        const fontFamily: LayoutTextFontFamily = rawShape.fontFamily ?? 'stick';
        const fontStyle: LayoutTextFontStyle = rawShape.fontStyle ?? 'normal';
        const orientation: CadenceOrientation = rawShape.orientation ?? 'R0';
        const box = estimateTextBoxSize(text, fontSize, fontFamily, fontStyle, state.gridSize);
        shape = {
          id,
          kind: 'text',
          layer,
          purpose,
          x: Object.is(x, -0) ? 0 : x,
          y: Object.is(y, -0) ? 0 : y,
          width: box.width,
          height: box.height,
          label: text,
          fontSize,
          fontFamily,
          fontStyle,
          orientation,
          ...(rawShape.color?.trim() ? { color: rawShape.color.trim() } : {}),
          ...(rawShape.locked ? { locked: true } : {}),
        };
        actionLabel = `Place text "${text}" (${formatLppLabel(layer, purpose)})`;
      } else {
        if (!Number.isFinite(rawShape.width) || !Number.isFinite(rawShape.height)) {
          throw new RangeError('Rectangle coordinates and dimensions must be finite numbers.');
        }
        const width = snapToGrid(rawShape.width, state.gridSize);
        const height = snapToGrid(rawShape.height, state.gridSize);
        if (width <= 1e-12 || height <= 1e-12) {
          throw new RangeError('Rectangle width and height must be positive.');
        }
        shape = {
          id,
          layer,
          purpose,
          x: Object.is(x, -0) ? 0 : x,
          y: Object.is(y, -0) ? 0 : y,
          width,
          height,
          ...(rawShape.color?.trim() ? { color: rawShape.color.trim() } : {}),
          ...(rawShape.label?.trim() ? { label: rawShape.label.trim() } : {}),
          ...(rawShape.locked ? { locked: true } : {}),
        };
        actionLabel = `Draw ${formatLppLabel(layer, purpose)} rect`;
      }

      const shapes = [...state.shapes, shape];
      const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true);
      const shouldSwitchToOrigin = Boolean(state.activeCellId) && (state.activeCoordinateMode === 'origin' || state.instances.length === 0);
      return {
        ...commitProjectPatch(state, actionLabel, {
          shapes,
          ...(shouldSwitchToOrigin ? { activeCoordinateMode: 'origin' as CellViewCoordinateMode } : {}),
          ...(boundsSync ?? {}),
        }),
        selectedShapeId: id,
        selectedInstanceId: null,
        selectedInstanceIds: [],
        pixelArraySelected: false,
      };
    });
    return id;
  },

  updateShape: (id, patch) => set((state) => {
    const existing = state.shapes.find(s => s.id === id);
    if (!existing) return state;
    if (existing.locked && patch.locked === undefined) {
      throw new Error('This shape is locked. Unlock it before editing.');
    }
    const nextLayer = patch.layer !== undefined ? (patch.layer.trim() || existing.layer) : existing.layer;
    const nextPurpose = patch.purpose !== undefined ? (patch.purpose.trim() || existing.purpose) : existing.purpose;
    const rawX = patch.x !== undefined ? patch.x : existing.x;
    const rawY = patch.y !== undefined ? patch.y : existing.y;
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      throw new RangeError('Shape coordinates must be finite numbers.');
    }
    const x = snapToGrid(rawX, state.gridSize);
    const y = snapToGrid(rawY, state.gridSize);
    const nextColor = patch.color !== undefined ? patch.color.trim() : existing.color;
    const nextLocked = patch.locked !== undefined ? patch.locked : existing.locked;

    let updated: LayoutShape;
    let actionLabel: string;
    if (existing.kind === 'text') {
      const nextLabel = patch.label !== undefined ? patch.label.trim() : (existing.label ?? '');
      if (!nextLabel) {
        throw new Error('Text label cannot be empty.');
      }
      const rawFontSize = patch.fontSize !== undefined
        ? patch.fontSize
        : (patch.height !== undefined ? patch.height : (existing.fontSize ?? existing.height));
      if (!Number.isFinite(rawFontSize) || rawFontSize <= 0) {
        throw new RangeError('Font size must be a positive finite number.');
      }
      const fontSize = Math.max(state.gridSize, snapToGrid(rawFontSize, state.gridSize));
      const fontFamily: LayoutTextFontFamily = patch.fontFamily ?? existing.fontFamily ?? 'stick';
      const fontStyle: LayoutTextFontStyle = patch.fontStyle ?? existing.fontStyle ?? 'normal';
      const orientation: CadenceOrientation = patch.orientation ?? existing.orientation ?? 'R0';
      const box = estimateTextBoxSize(nextLabel, fontSize, fontFamily, fontStyle, state.gridSize);
      updated = {
        id: existing.id,
        kind: 'text',
        layer: nextLayer,
        purpose: nextPurpose,
        x: Object.is(x, -0) ? 0 : x,
        y: Object.is(y, -0) ? 0 : y,
        width: box.width,
        height: box.height,
        label: nextLabel,
        fontSize,
        fontFamily,
        fontStyle,
        orientation,
        ...(nextColor ? { color: nextColor } : {}),
        ...(nextLocked ? { locked: true } : {}),
      };
      actionLabel = `Edit text "${nextLabel}"`;
    } else {
      const rawW = patch.width !== undefined ? patch.width : existing.width;
      const rawH = patch.height !== undefined ? patch.height : existing.height;
      if (!Number.isFinite(rawW) || !Number.isFinite(rawH)) {
        throw new RangeError('Rectangle coordinates and dimensions must be finite numbers.');
      }
      const width = snapToGrid(rawW, state.gridSize);
      const height = snapToGrid(rawH, state.gridSize);
      if (width <= 1e-12 || height <= 1e-12) {
        throw new RangeError('Rectangle width and height must be positive.');
      }
      const nextLabel = patch.label !== undefined ? patch.label.trim() : existing.label;
      updated = {
        id: existing.id,
        layer: nextLayer,
        purpose: nextPurpose,
        x: Object.is(x, -0) ? 0 : x,
        y: Object.is(y, -0) ? 0 : y,
        width,
        height,
        ...(nextColor ? { color: nextColor } : {}),
        ...(nextLabel ? { label: nextLabel } : {}),
        ...(nextLocked ? { locked: true } : {}),
      };
      actionLabel = `Edit ${formatLppLabel(nextLayer, nextPurpose)} rect`;
    }

    const shapes = state.shapes.map(s => (s.id === id ? updated : s));
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true);
    return commitProjectPatch(state, actionLabel, {
      shapes,
      ...(boundsSync ?? {}),
    });
  }),

  batchUpdateShapes: (updates, actionLabel) => set((state) => {
    if (updates.length === 0) return state;
    const byId = new Map(updates.map(u => [u.id, u]));
    let changedCount = 0;
    const shapes = state.shapes.map(existing => {
      const next = byId.get(existing.id);
      if (!next || existing.locked) return existing;
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.width) || !Number.isFinite(next.height)) {
        throw new RangeError('Rectangle coordinates and dimensions must be finite numbers.');
      }
      const x = snapToGrid(next.x, state.gridSize);
      const y = snapToGrid(next.y, state.gridSize);
      const width = snapToGrid(next.width, state.gridSize);
      const height = snapToGrid(next.height, state.gridSize);
      if (width <= 1e-12 || height <= 1e-12) {
        throw new RangeError('Rectangle width and height must be positive.');
      }
      const cleanX = Object.is(x, -0) ? 0 : x;
      const cleanY = Object.is(y, -0) ? 0 : y;
      if (
        Math.abs(cleanX - existing.x) <= 1e-9
        && Math.abs(cleanY - existing.y) <= 1e-9
        && Math.abs(width - existing.width) <= 1e-9
        && Math.abs(height - existing.height) <= 1e-9
      ) {
        return existing;
      }
      changedCount += 1;
      return { ...existing, x: cleanX, y: cleanY, width, height };
    });
    if (changedCount === 0) return state;
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true);
    const label = actionLabel ?? `Stretch ${changedCount} shape${changedCount === 1 ? '' : 's'}`;
    return commitProjectPatch(state, label, {
      shapes,
      ...(boundsSync ?? {}),
    });
  }),

  deleteShape: (id) => set((state) => {
    const existing = state.shapes.find(s => s.id === id);
    if (!existing) return state;
    if (existing.locked) {
      throw new Error('This shape is locked. Unlock it before deleting.');
    }
    const shapes = state.shapes.filter(s => s.id !== id);
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true);
    return {
      ...commitProjectPatch(state, `Delete ${formatLppLabel(existing.layer, existing.purpose)} rect`, {
        shapes,
        ...(boundsSync ?? {}),
      }),
      selectedShapeId: state.selectedShapeId === id ? null : state.selectedShapeId,
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, state.instances, shapes),
    };
  }),

  toggleShapeLock: (id) => set((state) => {
    const existing = state.shapes.find(s => s.id === id);
    if (!existing) return state;
    const shouldLock = !existing.locked;
    const shapes = state.shapes.map(s => {
      if (s.id !== id) return s;
      if (shouldLock) return { ...s, locked: true };
      const unlocked = { ...s };
      delete unlocked.locked;
      return unlocked;
    });
    return commitProjectPatch(state, `${shouldLock ? 'Lock' : 'Unlock'} ${formatLppLabel(existing.layer, existing.purpose)} rect`, { shapes });
  }),

  nudgeSelectedShape: (dx, dy) => set((state) => {
    if (!state.selectedShapeId) return state;
    const existing = state.shapes.find(s => s.id === state.selectedShapeId);
    if (!existing || existing.locked) return state;
    const nextX = snapToGrid(existing.x + dx, state.gridSize);
    const nextY = snapToGrid(existing.y + dy, state.gridSize);
    const shapes = state.shapes.map(s => (
      s.id === existing.id
        ? { ...s, x: Object.is(nextX, -0) ? 0 : nextX, y: Object.is(nextY, -0) ? 0 : nextY }
        : s
    ));
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true);
    return commitProjectPatch(state, `Nudge ${formatLppLabel(existing.layer, existing.purpose)} rect`, {
      shapes,
      ...(boundsSync ?? {}),
    });
  }),

  fitActiveCellBoundsToContents: () => set((state) => {
    if (!state.activeCellId) return state;
    const boundsSync = syncMasterBoundsForActiveCell(state, state.shapes, state.instances, state.pixelArray, true);
    if (!boundsSync) return state;
    return commitProjectPatch(state, `Fit ${state.topCellName} bounds to contents`, boundsSync);
  }),

  setCellAutoBounds: (cellId, autoBounds) => set((state) => {
    const existing = state.masterCells[cellId];
    if (!existing) return state;
    const nextMaster: Cell = { ...existing };
    if (autoBounds) nextMaster.autoBounds = true;
    else delete nextMaster.autoBounds;
    let nextMasterCells = { ...state.masterCells, [cellId]: nextMaster };
    let extra: { topWidth?: number; topHeight?: number } = {};
    if (autoBounds && state.activeCellId === cellId) {
      const synced = syncMasterBoundsForActiveCell(
        { ...state, masterCells: nextMasterCells },
        state.shapes,
        state.instances,
        state.pixelArray,
        true,
      );
      if (synced) {
        nextMasterCells = synced.masterCells;
        extra = { topWidth: synced.topWidth, topHeight: synced.topHeight };
      }
    }
    return commitProjectPatch(state, `${autoBounds ? 'Enable' : 'Disable'} auto-fit bounds on ${existing.cellName}`, {
      masterCells: nextMasterCells,
      ...extra,
    });
  }),

  placeInstance: (cellId, targetX = 0, targetY = 0, orientation = 'R0', customName) => set((state) => {
    const master = state.masterCells[cellId];
    if (!master) return state;
    if (state.activeCellId === cellId) {
      throw new Error(`Cannot instantiate ${master.libName}/${master.cellName} inside itself (recursive hierarchy cycle).`);
    }
    if (state.activeCellId) {
      const mergedViews = mergeActiveViewIntoCellViews(state);
      if (wouldCreateHierarchyCycle(state.activeCellId, cellId, mergedViews)) {
        throw new Error(`Cannot instantiate ${master.libName}/${master.cellName} inside ${state.topLibName}/${state.topCellName} because it creates a hierarchy cycle.`);
      }
    }
    if (isCellEmpty(master)) {
      throw new Error(`Cannot instantiate empty cell ${master.libName}/${master.cellName}: open it and draw a rectangle (e.g. text/drawing) or instantiate a sub-cell first.`);
    }

    const effectiveOrientation = orientation;
    const isSubCellCanvas = state.activeCellId !== null;
    const clamped = isSubCellCanvas || master.kind !== 'pad'
      ? snapUnboundedPosition(targetX, targetY, state.gridSize)
      : snapPadToNearestEdge(targetX, targetY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, effectiveOrientation, state.padInset, master.originX ?? 0, master.originY ?? 0);

    const usedNames = new Set(state.instances.map(i => i.name));
    const trimmedCustom = customName?.trim() ?? '';
    let resolvedName: string;
    if (trimmedCustom) {
      resolvedName = trimmedCustom;
      let suffix = 1;
      while (usedNames.has(resolvedName)) {
        resolvedName = `${trimmedCustom}_${suffix}`;
        suffix += 1;
      }
    } else {
      resolvedName = getNextInstanceName(state.instances);
    }

    const newInst: Instance = {
      id: uuidv4(),
      cellId,
      name: resolvedName,
      x: clamped.x,
      y: clamped.y,
      orientation: effectiveOrientation,
    };
    const instances = [...state.instances, newInst];
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return {
      ...commitProjectPatch(state, `Place ${newInst.name}`, {
        instances,
        ...(boundsSync ?? {}),
      }),
      selectedInstanceId: master.kind === 'pad' ? null : newInst.id,
      selectedInstanceIds: master.kind === 'pad' ? [] : [newInst.id],
      selectedShapeId: null,
      pixelArraySelected: false,
      // Cadence keeps placement mode active so you can place multiple. We won't change appMode.
    };
  }),

  placeInstanceMosaic: (cellId, originX, originY, orientation, config) => set((state) => {
    const master = state.masterCells[cellId];
    if (!master) return state;
    if (state.activeCellId === cellId) {
      throw new Error(`Cannot instantiate ${master.libName}/${master.cellName} inside itself (recursive hierarchy cycle).`);
    }
    if (state.activeCellId) {
      const mergedViews = mergeActiveViewIntoCellViews(state);
      if (wouldCreateHierarchyCycle(state.activeCellId, cellId, mergedViews)) {
        throw new Error(`Cannot instantiate ${master.libName}/${master.cellName} inside ${state.topLibName}/${state.topCellName} because it creates a hierarchy cycle.`);
      }
    }
    if (isCellEmpty(master)) {
      throw new Error(`Cannot instantiate empty cell ${master.libName}/${master.cellName}: open it and draw a rectangle (e.g. text/drawing) or instantiate a sub-cell first.`);
    }
    const rows = Math.max(1, Math.floor(config.rows));
    const cols = Math.max(1, Math.floor(config.cols));
    const maxTiles = config.asMosaic ? 10000 : 500;
    if (rows * cols > maxTiles) {
      throw new RangeError(
        config.asMosaic
          ? 'Mosaic array cannot exceed 10,000 elements.'
          : 'Exploded array cannot exceed 500 instances at once.',
      );
    }
    if (!Number.isFinite(config.deltaX) || !Number.isFinite(config.deltaY)) {
      throw new RangeError('Mosaic pitch values must be finite numbers.');
    }

    const instances = [...state.instances];
    const usedNames = new Set(instances.map(i => i.name));
    const prefix = config.namePrefix?.trim() ?? '';
    const isSubCellCanvas = state.activeCellId !== null;

    if (config.asMosaic && (isSubCellCanvas || master.kind !== 'pad')) {
      const placed = snapUnboundedPosition(originX, originY, state.gridSize);
      let name: string;
      if (prefix) {
        name = prefix;
        let suffix = 1;
        while (usedNames.has(name)) {
          name = `${prefix}_${suffix}`;
          suffix += 1;
        }
      } else {
        name = getNextInstanceName(instances);
      }
      const snappedRowPitch = snapToGrid(config.deltaY, state.gridSize);
      const snappedColPitch = snapToGrid(config.deltaX, state.gridSize);
      const inst: Instance = {
        id: uuidv4(),
        cellId,
        name,
        x: placed.x,
        y: placed.y,
        orientation,
        ...(rows > 1 || cols > 1
          ? {
              mosaic: {
                rows,
                cols,
                rowPitch: Object.is(snappedRowPitch, -0) ? 0 : snappedRowPitch,
                colPitch: Object.is(snappedColPitch, -0) ? 0 : snappedColPitch,
              },
            }
          : {}),
      };
      instances.push(inst);
      const boundsSync = isSubCellCanvas
        ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
        : null;
      return {
        ...commitProjectPatch(state, `Place ${rows}×${cols} mosaic ${inst.name}`, {
          instances,
          ...(boundsSync ?? {}),
        }),
        selectedInstanceId: inst.id,
        selectedInstanceIds: [inst.id],
        selectedShapeId: null,
        pixelArraySelected: false,
      };
    }

    const newIds: string[] = [];

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const reqX = originX + c * config.deltaX;
        const reqY = originY + r * config.deltaY;
        const placed = isSubCellCanvas || master.kind !== 'pad'
          ? snapUnboundedPosition(reqX, reqY, state.gridSize)
          : snapPadToNearestEdge(reqX, reqY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, orientation, state.padInset, master.originX ?? 0, master.originY ?? 0);

        let name: string;
        if (prefix) {
          const base = rows === 1 && cols === 1 ? prefix : `${prefix}_${r}_${c}`;
          name = base;
          let suffix = 1;
          while (usedNames.has(name)) {
            name = `${base}_${suffix}`;
            suffix += 1;
          }
        } else {
          name = getNextInstanceName(instances);
        }
        usedNames.add(name);

        const inst: Instance = {
          id: uuidv4(),
          cellId,
          name,
          x: placed.x,
          y: placed.y,
          orientation,
        };
        instances.push(inst);
        newIds.push(inst.id);
      }
    }

    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;

    return {
      ...commitProjectPatch(state, `Place ${rows}×${cols} ${master.cellName}`, {
        instances,
        ...(boundsSync ?? {}),
      }),
      selectedInstanceId: master.kind === 'pad' ? null : (newIds.at(-1) ?? null),
      selectedInstanceIds: master.kind === 'pad' ? [] : newIds,
      selectedShapeId: null,
      pixelArraySelected: false,
    };
  }),

  createPadRow: (config) => set((state) => {
    const orientation = config.orientation ?? 'R0';
    const rootId = getRootIdentity(state);
    const libName = config.libName.trim() || rootId.topLibName;
    const cellName = config.cellName.trim();
    if (!libName || !cellName) throw new Error('Pad library and cell names are required');
    if (!Number.isFinite(config.width) || config.width <= 0 || !Number.isFinite(config.height) || config.height <= 0) {
      throw new RangeError('Pad width and height must be positive finite numbers');
    }
    if (!Number.isInteger(config.count) || config.count < 1 || config.count > 1000) {
      throw new RangeError('Pad count must be an integer from 1 to 1000');
    }
    if (!Number.isFinite(config.pitch) || config.pitch <= 0) {
      throw new RangeError('Pad pitch must be a positive finite number');
    }
    if (!Number.isFinite(config.offset)) throw new RangeError('Pad row offset must be finite');
    if (!(['top', 'bottom', 'left', 'right'] as const).includes(config.side)) {
      throw new Error('Pad side must be top, bottom, left, or right');
    }
    if (libName === rootId.topLibName && cellName === rootId.topCellName) {
      throw new Error('The top cell cannot also be used as the pad master');
    }
    snapPadToNearestEdge(
      0,
      0,
      config.width,
      config.height,
      state.topWidth,
      state.topHeight,
      state.gridSize,
      orientation,
      state.padInset,
    );

    const horizontal = config.side === 'top' || config.side === 'bottom';
    const localBounds = getPhysicalBounds({
      id: 'automatic-pad-row', x: 0, y: 0, orientation,
      width: config.width, height: config.height,
    });
    const padAlong = horizontal
      ? localBounds.right - localBounds.left
      : localBounds.top - localBounds.bottom;
    const rowSpan = (config.count - 1) * config.pitch + padAlong;
    const availableAlong = (horizontal ? state.topWidth : state.topHeight) - state.padInset * 2;
    const centerAlong = config.offsetReference === 'start'
      ? -availableAlong / 2 + config.offset + rowSpan / 2
      : config.offset;
    const positions = computePadGroupPositions({
      width: config.width, height: config.height, count: config.count, pitch: config.pitch,
      side: config.side, centerAlong, orientation,
      topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize,
      padInset: state.padInset, clampAlong: false,
    });

    const existingMaster = Object.values(state.masterCells).find(cell => (
      cell.libName === libName && cell.cellName === cellName
    ));
    if (existingMaster && state.activeCellId && wouldCreateHierarchyCycle(state.activeCellId, existingMaster.id, mergeActiveViewIntoCellViews(state))) {
      throw new Error(`Cannot instantiate ${cellName} inside ${state.topCellName} because it creates a hierarchy cycle.`);
    }
    if (existingMaster && (
      Math.abs(existingMaster.width - config.width) > 1e-9
      || Math.abs(existingMaster.height - config.height) > 1e-9
    )) {
      throw new Error(`Existing master ${libName}/${cellName} has different dimensions`);
    }

    const master: Cell = existingMaster ? {
      ...existingMaster,
      kind: 'pad',
      opacity: existingMaster.opacity ?? 0.65,
      outlineStyle: existingMaster.outlineStyle ?? 'solid',
    } : {
      id: uuidv4(),
      libName,
      cellName,
      width: config.width,
      height: config.height,
      color: config.color,
      kind: 'pad',
      opacity: 0.65,
      outlineStyle: 'solid',
    };
    const masterCells = { ...state.masterCells, [master.id]: master };
    const instances = [...state.instances];
    for (const position of positions) {
      const instance: Instance = {
        id: uuidv4(),
        cellId: master.id,
        name: getNextInstanceName(instances),
        x: position.x,
        y: position.y,
        orientation,
      };
      instances.push(instance);
    }

    return {
      ...commitProjectPatch(state, `Place ${config.count} ${cellName} pads on ${config.side}`, { masterCells, instances }),
      selectedInstanceId: null,
      selectedInstanceIds: [],
      pixelArraySelected: false,
      appMode: 'select',
      pendingManualPadGroup: null,
      edgeAlignmentSession: null,
    };
  }),

  prepareManualPadPlacement: (config) => set((state) => {
    const count = config.count ?? 1;
    const pitch = config.pitch ?? Math.max(config.width, config.height);
    const rootId = getRootIdentity(state);
    const libName = config.libName.trim() || rootId.topLibName;
    const cellName = config.cellName.trim();
    if (!libName || !cellName) throw new Error('Pad library and cell names are required');
    if (!Number.isFinite(config.width) || !Number.isFinite(config.height) || config.width <= 0 || config.height <= 0) {
      throw new RangeError('Pad width and height must be positive finite numbers');
    }
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new RangeError('Pad count must be an integer from 1 to 1000');
    }
    if (!Number.isFinite(pitch) || pitch <= 0) throw new RangeError('Pad pitch must be a positive finite number');
    if (pitch + 1e-9 < config.width) {
      throw new RangeError(`Manual pad pitch must be at least the pad width (${config.width} um) for automatic edge rotation`);
    }
    if (libName === rootId.topLibName && cellName === rootId.topCellName) {
      throw new Error('The top cell cannot also be used as the pad master');
    }
    snapPadToAutoOrientedEdge(
      0,
      0,
      config.width,
      config.height,
      state.topWidth,
      state.topHeight,
      state.gridSize,
      state.padInset,
    );
    const existingMaster = Object.values(state.masterCells).find(cell => (
      cell.libName === libName && cell.cellName === cellName
    ));
    if (existingMaster && state.activeCellId && wouldCreateHierarchyCycle(state.activeCellId, existingMaster.id, mergeActiveViewIntoCellViews(state))) {
      throw new Error(`Cannot instantiate ${cellName} inside ${state.topCellName} because it creates a hierarchy cycle.`);
    }
    if (existingMaster && (
      Math.abs(existingMaster.width - config.width) > 1e-9
      || Math.abs(existingMaster.height - config.height) > 1e-9
    )) {
      throw new Error(`Existing master ${libName}/${cellName} has different dimensions`);
    }
    const master: Cell = existingMaster ? {
      ...existingMaster,
      kind: 'pad',
      opacity: existingMaster.opacity ?? 0.65,
      outlineStyle: existingMaster.outlineStyle ?? 'solid',
    } : {
      id: uuidv4(),
      libName,
      cellName,
      width: config.width,
      height: config.height,
      color: config.color,
      kind: 'pad',
      opacity: 0.65,
      outlineStyle: 'solid',
    };
    const masterCells = { ...state.masterCells, [master.id]: master };
    const masterChanged = !existingMaster || existingMaster.kind !== 'pad';
    return {
      ...(masterChanged ? commitProjectPatch(state, `Prepare ${cellName} pad`, { masterCells }) : {}),
      masterCells,
      placementMasterId: master.id,
      placementOrientation: 'R0',
      pendingManualPadGroup: { masterId: master.id, count, pitch },
      appMode: 'place',
      pendingPixelArraySize: null,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      pixelArraySelected: false,
      edgeAlignmentSession: null,
    };
  }),

  placeManualPadGroup: (x, y) => set((state) => {
    const pending = state.pendingManualPadGroup;
    if (!pending) return state;
    const master = state.masterCells[pending.masterId];
    if (!master || master.kind !== 'pad') return state;
    const snapped = snapPadToAutoOrientedEdge(x, y, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, state.padInset, master.originX ?? 0, master.originY ?? 0);
    const horizontal = snapped.side === 'top' || snapped.side === 'bottom';
    const centerAlong = horizontal ? x : y;
    const positions = computePadGroupPositions({
      width: master.width, height: master.height, originX: master.originX, originY: master.originY,
      count: pending.count, pitch: pending.pitch,
      side: snapped.side, centerAlong, orientation: snapped.orientation,
      topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize,
      padInset: state.padInset,
    });
    const instances = [...state.instances];
    for (const position of positions) {
      instances.push({
        id: uuidv4(), cellId: master.id, name: getNextInstanceName(instances),
        ...position, orientation: snapped.orientation,
      });
    }
    return {
      ...commitProjectPatch(state, `Place ${pending.count} ${master.cellName} pads manually`, { instances }),
      selectedInstanceId: null, selectedInstanceIds: [], pixelArraySelected: false,
    };
  }),

  startPixelArrayPlacement: (width, height) => set((state) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new RangeError('Pixel array width and height must be positive finite numbers');
    }
    const snappedWidth = snapToGrid(width, state.gridSize);
    const snappedHeight = snapToGrid(height, state.gridSize);
    if (snappedWidth <= 0 || snappedHeight <= 0) {
      throw new RangeError('Pixel array dimensions must be at least one placement-grid step');
    }
    if (snappedWidth >= state.topWidth || snappedHeight >= state.topHeight) {
      throw new RangeError('Pixel array must be smaller than the top cell in both dimensions');
    }
    return {
      pendingPixelArraySize: { width: snappedWidth, height: snappedHeight },
      appMode: 'pixel-array',
      placementMasterId: null,
      edgeAlignmentSession: null,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      pixelArraySelected: false,
    };
  }),

  placePixelArray: (centerX, centerY) => set((state) => {
    const size = state.pendingPixelArraySize;
    if (!size) return state;
    const { originX, originY } = getActiveContainerOrigin(state);
    const pixelArray = normalizePixelArray(
      { x: centerX - size.width / 2, y: centerY - size.height / 2, width: size.width, height: size.height, visible: true },
      state.topWidth,
      state.topHeight,
      state.gridSize,
      originX,
      originY,
    );
    return {
      ...commitProjectPatch(state, state.pixelArray ? 'Move pixel array' : 'Place pixel array', { pixelArray }),
      pendingPixelArraySize: null,
      appMode: 'select',
      pixelArraySelected: true,
    };
  }),

  updatePixelArrayPosition: (x, y) => set((state) => {
    if (!state.pixelArray) return state;
    const { originX, originY } = getActiveContainerOrigin(state);
    const pixelArray = normalizePixelArray(
      { ...state.pixelArray, x, y },
      state.topWidth,
      state.topHeight,
      state.gridSize,
      originX,
      originY,
    );
    return commitProjectPatch(state, 'Move pixel array', { pixelArray });
  }),

  updatePixelArrayGeometry: (x, y, width, height) => set((state) => {
    if (!state.pixelArray) return state;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new RangeError('Pixel array coordinates and dimensions must be finite numbers');
    }
    if (width <= 0 || height <= 0) {
      throw new RangeError('Pixel array width and height must be positive');
    }
    const snappedWidth = snapToGrid(width, state.gridSize);
    const snappedHeight = snapToGrid(height, state.gridSize);
    if (snappedWidth <= 0 || snappedHeight <= 0) {
      throw new RangeError('Pixel array dimensions must be at least one placement-grid step');
    }
    if (snappedWidth >= state.topWidth || snappedHeight >= state.topHeight) {
      throw new RangeError('Pixel array must be smaller than the top cell in both dimensions');
    }
    const { originX, originY } = getActiveContainerOrigin(state);
    const pixelArray = normalizePixelArray(
      { ...state.pixelArray, x, y, width: snappedWidth, height: snappedHeight },
      state.topWidth,
      state.topHeight,
      state.gridSize,
      originX,
      originY,
    );
    return commitProjectPatch(state, 'Edit pixel array', { pixelArray });
  }),

  setPixelArrayVisible: (visible) => set((state) => {
    if (!state.pixelArray || state.pixelArray.visible === visible) return state;
    return {
      ...commitProjectPatch(state, `${visible ? 'Show' : 'Hide'} pixel array`, {
        pixelArray: { ...state.pixelArray, visible },
      }),
      ...(!visible ? { pixelArraySelected: false, edgeAlignmentSession: null } : {}),
    };
  }),

  deletePixelArray: () => set((state) => {
    if (!state.pixelArray) return state;
    return {
      ...commitProjectPatch(state, 'Delete pixel array', { pixelArray: null }),
      pendingPixelArraySize: null,
      appMode: 'select',
      pixelArraySelected: false,
      edgeAlignmentSession: null,
    };
  }),

  updateInstancePosition: (instanceId, x, y) => set((state) => {
    const isSubCellCanvas = state.activeCellId !== null;
    const instances = state.instances.map(inst => {
      if (inst.id === instanceId) {
        if (inst.locked) {
          throw new Error(`${inst.name} is locked. Unlock it before moving.`);
        }
        const master = state.masterCells[inst.cellId];
        if (!master) return inst;
        const nextPos = isSubCellCanvas || master.kind !== 'pad'
          ? snapUnboundedPosition(x, y, state.gridSize)
          : snapPadToNearestEdge(
              x,
              y,
              master.width,
              master.height,
              state.topWidth,
              state.topHeight,
              state.gridSize,
              inst.orientation,
              state.padInset,
              master.originX ?? 0,
              master.originY ?? 0,
            );
        return { ...inst, x: nextPos.x, y: nextPos.y };
      }
      return inst;
    });
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Move ${state.instances.find(instance => instance.id === instanceId)?.name ?? 'instance'}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  moveInstancesByDelta: (instanceIds, deltaX, deltaY) => set((state) => {
    if (instanceIds.length === 0) return state;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      throw new RangeError('Movement delta must be finite');
    }
    const snappedDx = snapToGrid(deltaX, state.gridSize);
    const snappedDy = snapToGrid(deltaY, state.gridSize);
    if (Math.abs(snappedDx) <= 1e-12 && Math.abs(snappedDy) <= 1e-12) return state;
    const idSet = new Set(instanceIds);
    const isSubCellCanvas = state.activeCellId !== null;
    const instances = state.instances.map(inst => {
      if (!idSet.has(inst.id)) return inst;
      if (inst.locked) {
        throw new Error(`Cannot move because ${inst.name} is locked.`);
      }
      const master = state.masterCells[inst.cellId];
      if (!master) return inst;
      const requested = snapUnboundedPosition(inst.x + snappedDx, inst.y + snappedDy, state.gridSize);
      if (isSubCellCanvas || master.kind !== 'pad') {
        return { ...inst, x: requested.x, y: requested.y };
      }
      const checked = clampInstancePosition(
        requested.x,
        requested.y,
        inst.orientation,
        master.width,
        master.height,
        state.topWidth,
        state.topHeight,
        state.gridSize,
        master.originX ?? 0,
        master.originY ?? 0,
      );
      if (Math.abs(checked.x - requested.x) > 1e-9 || Math.abs(checked.y - requested.y) > 1e-9) {
        throw new RangeError(`Cannot move the selected group without placing ${inst.name} outside the top cell`);
      }
      const bounds = getPhysicalBounds({
        ...inst, x: checked.x, y: checked.y, width: master.width, height: master.height,
        originX: master.originX, originY: master.originY,
      });
      if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
        throw new RangeError(`Cannot move the group because pad ${inst.name} would leave the pad perimeter`);
      }
      return { ...inst, x: checked.x, y: checked.y };
    });
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Move ${instanceIds.length} block${instanceIds.length === 1 ? '' : 's'}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  renameInstance: (instanceId, rawName) => set((state) => {
    const existing = state.instances.find(inst => inst.id === instanceId);
    if (!existing) return state;
    const name = rawName.trim();
    if (!name) throw new Error('Instance name is required');
    if (name === existing.name) return state;
    if (state.instances.some(inst => inst.id !== instanceId && inst.name === name)) {
      throw new Error(`Instance name ${name} is already used`);
    }
    const instances = state.instances.map(inst => (
      inst.id === instanceId ? { ...inst, name } : inst
    ));
    return commitProjectPatch(state, `Rename ${existing.name} to ${name}`, { instances });
  }),

  toggleInstanceLock: (instanceIds) => set((state) => {
    if (instanceIds.length === 0) return state;
    const idSet = new Set(instanceIds);
    const targets = state.instances.filter(inst => idSet.has(inst.id));
    if (targets.length === 0) return state;
    const shouldLock = targets.some(inst => !inst.locked);
    const instances = state.instances.map(inst => {
      if (!idSet.has(inst.id)) return inst;
      if (shouldLock) return { ...inst, locked: true };
      const unlocked = { ...inst };
      delete unlocked.locked;
      return unlocked;
    });
    return commitProjectPatch(
      state,
      `${shouldLock ? 'Lock' : 'Unlock'} ${targets.length} block${targets.length === 1 ? '' : 's'}`,
      { instances },
    );
  }),
  
  updateInstanceOrientation: (instanceId, orientation) => set((state) => {
    const isSubCellCanvas = state.activeCellId !== null;
    const instances = state.instances.map(inst => {
      if (inst.id === instanceId) {
        if (inst.locked) {
          throw new Error(`${inst.name} is locked. Unlock it before rotating.`);
        }
        const master = state.masterCells[inst.cellId];
        if (!master) return inst;
        const currentBounds = getPhysicalBounds({ ...inst, width: master.width, height: master.height, originX: master.originX, originY: master.originY });
        const nextLocalBounds = getPhysicalBounds({ ...inst, x: 0, y: 0, orientation, width: master.width, height: master.height, originX: master.originX, originY: master.originY });
        const centeredX = currentBounds.centerX - nextLocalBounds.centerX;
        const centeredY = currentBounds.centerY - nextLocalBounds.centerY;
        const clamped = isSubCellCanvas || master.kind !== 'pad'
          ? snapUnboundedPosition(centeredX, centeredY, state.gridSize)
          : snapPadToNearestEdge(centeredX, centeredY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, orientation, state.padInset, master.originX ?? 0, master.originY ?? 0);
        return { ...inst, orientation, x: clamped.x, y: clamped.y };
      }
      return inst;
    });
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Orient ${state.instances.find(instance => instance.id === instanceId)?.name ?? 'instance'}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  updateInstanceMosaic: (instanceId, rawMosaic) => set((state) => {
    const existing = state.instances.find(inst => inst.id === instanceId);
    if (!existing) return state;
    if (existing.locked) {
      throw new Error(`${existing.name} is locked. Unlock it before editing mosaic array properties.`);
    }
    const master = state.masterCells[existing.cellId];
    if (!master) return state;
    const isSubCellCanvas = state.activeCellId !== null;
    if (!isSubCellCanvas && master.kind === 'pad' && rawMosaic && (rawMosaic.rows > 1 || rawMosaic.cols > 1)) {
      throw new Error('Top-level edge-bound pads cannot be converted into a mosaic. Place pads inside a padring cellview to array them.');
    }

    let nextMosaic: InstanceMosaic | undefined;
    if (rawMosaic) {
      const rows = Math.floor(rawMosaic.rows);
      const cols = Math.floor(rawMosaic.cols);
      if (!Number.isFinite(rawMosaic.rows) || !Number.isFinite(rawMosaic.cols) || rows < 1 || cols < 1 || rows > 500 || cols > 500 || rows * cols > 10000) {
        throw new RangeError('Mosaic rows and columns must be integers between 1 and 500 (max 10,000 elements).');
      }
      if (!Number.isFinite(rawMosaic.rowPitch) || !Number.isFinite(rawMosaic.colPitch)) {
        throw new RangeError('Mosaic pitch values must be finite numbers.');
      }
      if (rows > 1 || cols > 1) {
        const snappedRowPitch = snapToGrid(rawMosaic.rowPitch, state.gridSize);
        const snappedColPitch = snapToGrid(rawMosaic.colPitch, state.gridSize);
        nextMosaic = {
          rows,
          cols,
          rowPitch: Object.is(snappedRowPitch, -0) ? 0 : snappedRowPitch,
          colPitch: Object.is(snappedColPitch, -0) ? 0 : snappedColPitch,
        };
      }
    }

    const instances = state.instances.map(inst => {
      if (inst.id !== instanceId) return inst;
      const updated: Instance = { ...inst };
      if (nextMosaic) updated.mosaic = nextMosaic;
      else delete updated.mosaic;
      return updated;
    });
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    const label = nextMosaic
      ? `Mosaic ${existing.name} (${nextMosaic.rows}×${nextMosaic.cols})`
      : `Convert ${existing.name} to single instance`;
    return commitProjectPatch(state, label, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  flattenMosaicInstance: (instanceId) => set((state) => {
    const existing = state.instances.find(inst => inst.id === instanceId);
    if (!existing) return state;
    if (existing.locked) {
      throw new Error(`${existing.name} is locked. Unlock it before flattening.`);
    }
    if (!isActiveMosaic(existing.mosaic)) return state;
    const { rows, cols, rowPitch, colPitch } = existing.mosaic;
    if (rows * cols > 500) {
      throw new RangeError('Cannot flatten a mosaic larger than 500 instances.');
    }
    const remaining = state.instances.filter(inst => inst.id !== instanceId);
    const usedNames = new Set(remaining.map(inst => inst.name));
    const flattened: Instance[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const offset = applyCadenceOrientationVector(existing.orientation, c * colPitch, r * rowPitch);
        const pos = snapUnboundedPosition(existing.x + offset.dx, existing.y + offset.dy, state.gridSize);
        const baseName = `${existing.name}_${r}_${c}`;
        let name = baseName;
        let suffix = 1;
        while (usedNames.has(name)) {
          name = `${baseName}_${suffix}`;
          suffix += 1;
        }
        usedNames.add(name);
        flattened.push({
          id: uuidv4(),
          cellId: existing.cellId,
          name,
          x: pos.x,
          y: pos.y,
          orientation: existing.orientation,
        });
      }
    }
    const instances = [...remaining, ...flattened];
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    const newIds = flattened.map(inst => inst.id);
    return {
      ...commitProjectPatch(state, `Flatten mosaic ${existing.name} (${rows}×${cols})`, {
        instances,
        ...(boundsSync ?? {}),
      }),
      selectedInstanceIds: newIds,
      selectedInstanceId: newIds.at(-1) ?? null,
      selectedShapeId: null,
      pixelArraySelected: false,
    };
  }),

  setSelectedInstance: (id, additive = false) => set((state) => {
    if (!id) return { selectedInstanceId: null, selectedInstanceIds: [], selectedShapeId: null, pixelArraySelected: false };
    if (!additive) {
      if (state.selectedInstanceIds.length > 1 && state.selectedInstanceIds.includes(id)) {
        return { selectedInstanceId: id, selectedShapeId: null, pixelArraySelected: false };
      }
      return { selectedInstanceId: id, selectedInstanceIds: [id], selectedShapeId: null, pixelArraySelected: false };
    }

    const isSelected = state.selectedInstanceIds.includes(id);
    const selectedInstanceIds = isSelected
      ? state.selectedInstanceIds.filter(selectedId => selectedId !== id)
      : [...state.selectedInstanceIds, id];
    return {
      selectedInstanceIds,
      selectedInstanceId: isSelected
        ? (state.selectedInstanceId === id ? selectedInstanceIds.at(-1) ?? null : state.selectedInstanceId)
        : id,
      selectedShapeId: null,
      pixelArraySelected: false,
    };
  }),

  setSelection: (ids) => set({
    selectedInstanceIds: ids,
    selectedInstanceId: ids.at(-1) ?? null,
    selectedShapeId: null,
    pixelArraySelected: false,
  }),


  setPixelArraySelected: (selected) => set((state) => ({
    pixelArraySelected: Boolean(selected && state.pixelArray?.visible),
    ...(selected ? { selectedInstanceId: null, selectedInstanceIds: [], selectedShapeId: null } : {}),
  })),

  selectAllInstances: () => set((state) => ({
    selectedInstanceIds: state.instances.map(instance => instance.id),
    selectedInstanceId: state.instances.at(-1)?.id ?? null,
    selectedShapeId: null,
    pixelArraySelected: false,
  })),

  deleteInstance: (id) => set((state) => {
    const instances = state.instances.filter(inst => inst.id !== id);
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return {
      ...commitProjectPatch(state, `Delete ${state.instances.find(instance => instance.id === id)?.name ?? 'instance'}`, {
        instances,
        ...(boundsSync ?? {}),
      }),
      ...selectionAfterInstancesChange(state, instances),
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, instances),
    };
  }),

  deleteSelectedInstances: () => set((state) => {
    if (state.selectedInstanceIds.length === 0) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const removableCount = state.instances.filter(instance => selectedIds.has(instance.id) && !instance.locked).length;
    if (removableCount === 0) return state;
    const instances = state.instances.filter(instance => !(selectedIds.has(instance.id) && !instance.locked));
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return {
      ...commitProjectPatch(state, `Delete ${removableCount} block${removableCount === 1 ? '' : 's'}`, {
        instances,
        ...(boundsSync ?? {}),
      }),
      ...selectionAfterInstancesChange(state, instances),
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, instances),
    };
  }),

  nudgeSelection: (dx, dy) => set((state) => {
    if (state.selectedInstanceIds.length === 0) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const isSubCellCanvas = state.activeCellId !== null;
    let error = false;
    const instances = state.instances.map(inst => {
      if (!selectedIds.has(inst.id)) return inst;
      if (inst.locked) {
        error = true;
        return inst;
      }
      const master = state.masterCells[inst.cellId];
      if (!master) return inst;
      try {
        const requested = snapUnboundedPosition(inst.x + dx, inst.y + dy, state.gridSize);
        if (isSubCellCanvas || master.kind !== 'pad') {
          return { ...inst, x: requested.x, y: requested.y };
        }
        const clamped = clampInstancePosition(
          requested.x,
          requested.y,
          inst.orientation,
          master.width,
          master.height,
          state.topWidth,
          state.topHeight,
          state.gridSize,
          master.originX ?? 0,
          master.originY ?? 0,
        );
        if (Math.abs(clamped.x - requested.x) > 1e-9 || Math.abs(clamped.y - requested.y) > 1e-9) {
          error = true;
          return inst;
        }
        const bounds = getPhysicalBounds({
          ...inst, x: clamped.x, y: clamped.y, width: master.width, height: master.height,
          originX: master.originX, originY: master.originY,
        });
        if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
          error = true;
          return inst;
        }
        return { ...inst, x: clamped.x, y: clamped.y };
      } catch {
        error = true;
        return inst;
      }
    });
    if (error) return state; // Cancel nudge if any block is locked or a pad leaves the perimeter
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Nudge ${state.selectedInstanceIds.length} block${state.selectedInstanceIds.length === 1 ? '' : 's'}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  copySelection: () => set((state) => {
    if (state.selectedInstanceIds.length > 0) {
      const selectedIds = new Set(state.selectedInstanceIds);
      const clipboard = state.instances
        .filter(inst => selectedIds.has(inst.id))
        .map(inst => ({ ...inst, ...(inst.mosaic ? { mosaic: { ...inst.mosaic } } : {}) }));
      return { clipboard, shapeClipboard: [], clipboardWasCut: false };
    }
    if (state.selectedShapeId) {
      const shape = state.shapes.find(s => s.id === state.selectedShapeId);
      if (!shape) return state;
      return { clipboard: [], shapeClipboard: [{ ...shape }], clipboardWasCut: false };
    }
    return state;
  }),

  cutSelection: () => {
    let didCut = false;
    set((state) => {
      if (state.selectedInstanceIds.length > 0) {
        const selectedIds = new Set(state.selectedInstanceIds);
        const cutTargets = state.instances.filter(inst => selectedIds.has(inst.id) && !inst.locked);
        if (cutTargets.length === 0) return state;
        const cutIdSet = new Set(cutTargets.map(inst => inst.id));
        const remaining = state.instances.filter(inst => !cutIdSet.has(inst.id));
        const boundsSync = state.activeCellId
          ? syncMasterBoundsForActiveCell(state, state.shapes, remaining, state.pixelArray)
          : null;
        didCut = true;
        return {
          ...commitProjectPatch(state, `Cut ${cutTargets.length} block${cutTargets.length === 1 ? '' : 's'}`, {
            instances: remaining,
            ...(boundsSync ?? {}),
          }),
          clipboard: cutTargets.map(inst => ({ ...inst, ...(inst.mosaic ? { mosaic: { ...inst.mosaic } } : {}) })),
          shapeClipboard: [],
          clipboardWasCut: true,
          ...selectionAfterInstancesChange(state, remaining),
          edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, remaining),
        };
      }
      if (state.selectedShapeId) {
        const target = state.shapes.find(s => s.id === state.selectedShapeId);
        if (!target || target.locked) return state;
        const shapes = state.shapes.filter(s => s.id !== target.id);
        const boundsSync = state.activeCellId
          ? syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray)
          : null;
        didCut = true;
        return {
          ...commitProjectPatch(state, `Cut ${target.kind === 'text' ? 'text label' : `${formatLppLabel(target.layer, target.purpose)} rect`}`, {
            shapes,
            ...(boundsSync ?? {}),
          }),
          clipboard: [],
          shapeClipboard: [{ ...target }],
          clipboardWasCut: true,
          selectedShapeId: null,
        };
      }
      return state;
    });
    return didCut;
  },

  pasteClipboard: () => set((state) => {
    const hasInstances = state.clipboard && state.clipboard.length > 0;
    const hasShapes = state.shapeClipboard && state.shapeClipboard.length > 0;
    if (!hasInstances && !hasShapes) return state;

    const offset = 20 * state.gridSize;
    const isSubCellCanvas = state.activeCellId !== null;

    if (hasInstances) {
      const mergedViews = state.activeCellId ? mergeActiveViewIntoCellViews(state) : state.cellViews;
      const validItems = state.clipboard.filter(item => {
        const master = state.masterCells[item.cellId];
        if (!master || isCellEmpty(master)) return false;
        if (state.activeCellId && wouldCreateHierarchyCycle(state.activeCellId, item.cellId, mergedViews)) {
          return false;
        }
        return true;
      });
      if (validItems.length === 0) return state;

      // Compute group bounding box so multi-object paste preserves exact relative spacing.
      let minLeft = Infinity;
      let maxRight = -Infinity;
      let minBottom = Infinity;
      let maxTop = -Infinity;
      for (const item of validItems) {
        const master = state.masterCells[item.cellId]!;
        const bounds = getPhysicalBounds({
          ...item,
          width: master.width,
          height: master.height,
          originX: master.originX,
          originY: master.originY,
        });
        if (bounds.left < minLeft) minLeft = bounds.left;
        if (bounds.right > maxRight) maxRight = bounds.right;
        if (bounds.bottom < minBottom) minBottom = bounds.bottom;
        if (bounds.top > maxTop) maxTop = bounds.top;
      }
      const stepX = Math.max(offset, (maxRight - minLeft) + offset);
      const stepY = Math.max(offset, (maxTop - minBottom) + offset);
      const candidateOffsets: Array<[number, number]> = [
        ...(state.clipboardWasCut ? ([[0, 0]] as Array<[number, number]>) : []),
        [stepX, 0],
        [0, -stepY],
        [-stepX, 0],
        [0, stepY],
        [stepX, -stepY],
        [-stepX, -stepY],
        [stepX, stepY],
        [-stepX, stepY],
        [stepX * 2, 0],
        [0, -stepY * 2],
      ];

      let chosenPositions: Array<{ x: number; y: number }> | null = null;
      let fallbackPositions: Array<{ x: number; y: number }> | null = null;
      for (const [dx, dy] of candidateOffsets) {
        try {
          const candidates = validItems.map(item => {
            const master = state.masterCells[item.cellId]!;
            return isSubCellCanvas || master.kind !== 'pad'
              ? snapUnboundedPosition(item.x + dx, item.y + dy, state.gridSize)
              : snapPadToNearestEdge(
                  item.x + dx,
                  item.y + dy,
                  master.width,
                  master.height,
                  state.topWidth,
                  state.topHeight,
                  state.gridSize,
                  item.orientation,
                  state.padInset,
                  master.originX ?? 0,
                  master.originY ?? 0,
                );
          });
          if (!fallbackPositions) fallbackPositions = candidates;
          const anyOverlap = validItems.some((item, idx) => {
            const master = state.masterCells[item.cellId]!;
            return Boolean(findOverlappingInstance(
              {
                x: candidates[idx].x,
                y: candidates[idx].y,
                orientation: item.orientation,
                width: master.width,
                height: master.height,
                originX: master.originX,
                originY: master.originY,
                mosaic: item.mosaic,
              },
              state.instances,
              state.masterCells,
            ));
          });
          if (!anyOverlap) {
            chosenPositions = candidates;
            break;
          }
        } catch {
          // Try next candidate shift
        }
      }

      const finalPositions = chosenPositions ?? fallbackPositions;
      if (!finalPositions) return state;

      const instances = [...state.instances];
      const newSelectedIds: string[] = [];
      validItems.forEach((item, idx) => {
        const newInst: Instance = {
          id: uuidv4(),
          cellId: item.cellId,
          name: getNextInstanceName(instances),
          x: finalPositions[idx].x,
          y: finalPositions[idx].y,
          orientation: item.orientation,
          ...(item.mosaic ? { mosaic: { ...item.mosaic } } : {}),
        };
        instances.push(newInst);
        newSelectedIds.push(newInst.id);
      });

      if (newSelectedIds.length === 0) return state;
      const boundsSync = isSubCellCanvas
        ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
        : null;
      return {
        ...commitProjectPatch(state, `Paste ${newSelectedIds.length} block${newSelectedIds.length === 1 ? '' : 's'}`, {
          instances,
          ...(boundsSync ?? {}),
        }),
        clipboardWasCut: false,
        selectedInstanceIds: newSelectedIds,
        selectedInstanceId: newSelectedIds.at(-1) ?? null,
        selectedShapeId: null,
        pixelArraySelected: false,
      };
    }

    // Paste shapes / text labels
    const pastedShapes: LayoutShape[] = [];
    const shiftX = state.clipboardWasCut
      ? 0
      : Math.max(offset, Math.max(...state.shapeClipboard.map(s => s.width)) + offset);
    for (const shape of state.shapeClipboard) {
      const nextPos = snapUnboundedPosition(shape.x + shiftX, shape.y, state.gridSize);
      const cloned: LayoutShape = {
        ...shape,
        id: uuidv4(),
        x: nextPos.x,
        y: nextPos.y,
      };
      delete cloned.locked;
      pastedShapes.push(cloned);
    }
    if (pastedShapes.length === 0) return state;
    const shapes = [...state.shapes, ...pastedShapes];
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true)
      : null;
    return {
      ...commitProjectPatch(state, `Paste ${pastedShapes.length} shape${pastedShapes.length === 1 ? '' : 's'}`, {
        shapes,
        ...(boundsSync ?? {}),
      }),
      clipboardWasCut: false,
      selectedShapeId: pastedShapes.at(-1)?.id ?? null,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      pixelArraySelected: false,
    };
  }),

  startInteractiveCopy: () => {
    let started = false;
    set((state) => {
      if (state.selectedInstanceIds.length > 0) {
        const selectedSet = new Set(state.selectedInstanceIds);
        const selected = state.instances.filter(inst => selectedSet.has(inst.id) && state.masterCells[inst.cellId]);
        if (selected.length === 0) return state;
        const primary = selected.find(inst => inst.id === state.selectedInstanceId) ?? selected[0];
        const anchorX = primary.x;
        const anchorY = primary.y;
        const pendingCopyGroup: PendingCopyGroup = {
          anchorX,
          anchorY,
          instances: selected.map(inst => ({
            cellId: inst.cellId,
            dx: inst.x - anchorX,
            dy: inst.y - anchorY,
            orientation: inst.orientation,
            ...(inst.mosaic ? { mosaic: { ...inst.mosaic } } : {}),
          })),
          shapes: [],
        };
        started = true;
        return {
          pendingCopyGroup,
          appMode: 'place' as AppMode,
          placementMasterId: null,
          pendingInstanceArray: null,
          pendingManualPadGroup: null,
          pendingPixelArraySize: null,
          edgeAlignmentSession: null,
          partialSelectMode: false,
        };
      }
      if (state.selectedShapeId) {
        const shape = state.shapes.find(s => s.id === state.selectedShapeId);
        if (!shape) return state;
        const rest = { ...shape } as Record<string, unknown>;
        delete rest.id;
        delete rest.locked;
        delete rest.x;
        delete rest.y;
        const pendingCopyGroup: PendingCopyGroup = {
          anchorX: shape.x,
          anchorY: shape.y,
          instances: [],
          shapes: [{ ...(rest as Omit<LayoutShape, 'id' | 'locked' | 'x' | 'y'>), dx: 0, dy: 0 }],
        };
        started = true;
        return {
          pendingCopyGroup,
          appMode: 'place' as AppMode,
          placementMasterId: null,
          pendingInstanceArray: null,
          pendingManualPadGroup: null,
          pendingPixelArraySize: null,
          edgeAlignmentSession: null,
          partialSelectMode: false,
        };
      }
      return state;
    });
    return started;
  },

  rotatePendingCopyGroup: (quarterTurns) => set((state) => {
    const group = state.pendingCopyGroup;
    if (!group) return state;
    const rotOrient = rotateOrientationByQuarterTurns('R0', quarterTurns);
    const nextInstances = group.instances.map(item => {
      const rotatedDelta = applyCadenceOrientationVector(rotOrient, item.dx, item.dy);
      const snapped = snapUnboundedPosition(rotatedDelta.dx, rotatedDelta.dy, state.gridSize);
      return {
        ...item,
        dx: snapped.x,
        dy: snapped.y,
        orientation: rotateOrientationByQuarterTurns(item.orientation, quarterTurns),
      };
    });
    const nextShapes = group.shapes.map(shape => {
      if (shape.kind === 'text') {
        const rotatedDelta = applyCadenceOrientationVector(rotOrient, shape.dx, shape.dy);
        const snapped = snapUnboundedPosition(rotatedDelta.dx, rotatedDelta.dy, state.gridSize);
        return {
          ...shape,
          dx: snapped.x,
          dy: snapped.y,
          orientation: rotateOrientationByQuarterTurns(shape.orientation ?? 'R0', quarterTurns) as CadenceOrientation,
        };
      }
      const p1 = applyCadenceOrientationVector(rotOrient, shape.dx, shape.dy);
      const p2 = applyCadenceOrientationVector(rotOrient, shape.dx + shape.width, shape.dy + shape.height);
      const minX = snapToGrid(Math.min(p1.dx, p2.dx), state.gridSize);
      const minY = snapToGrid(Math.min(p1.dy, p2.dy), state.gridSize);
      const width = snapToGrid(Math.abs(p2.dx - p1.dx), state.gridSize);
      const height = snapToGrid(Math.abs(p2.dy - p1.dy), state.gridSize);
      return {
        ...shape,
        dx: Object.is(minX, -0) ? 0 : minX,
        dy: Object.is(minY, -0) ? 0 : minY,
        width: Math.max(state.gridSize, width),
        height: Math.max(state.gridSize, height),
      };
    });
    return {
      pendingCopyGroup: {
        ...group,
        instances: nextInstances,
        shapes: nextShapes,
      },
    };
  }),

  placeCopyGroupAt: (targetX, targetY) => set((state) => {
    const group = state.pendingCopyGroup;
    if (!group) return state;
    const isSubCellCanvas = state.activeCellId !== null;
    const mergedViews = isSubCellCanvas ? mergeActiveViewIntoCellViews(state) : state.cellViews;
    const snappedTarget = snapUnboundedPosition(targetX, targetY, state.gridSize);

    const instances = [...state.instances];
    const newInstanceIds: string[] = [];
    for (const item of group.instances) {
      const master = state.masterCells[item.cellId];
      if (!master || isCellEmpty(master)) continue;
      if (state.activeCellId === item.cellId || (state.activeCellId && wouldCreateHierarchyCycle(state.activeCellId, item.cellId, mergedViews))) {
        throw new Error(`Cannot copy ${master.libName}/${master.cellName} inside ${state.topCellName} because it creates a hierarchy cycle.`);
      }
      const reqX = snappedTarget.x + item.dx;
      const reqY = snappedTarget.y + item.dy;
      const placed = isSubCellCanvas || master.kind !== 'pad'
        ? snapUnboundedPosition(reqX, reqY, state.gridSize)
        : snapPadToNearestEdge(
            reqX,
            reqY,
            master.width,
            master.height,
            state.topWidth,
            state.topHeight,
            state.gridSize,
            item.orientation,
            state.padInset,
            master.originX ?? 0,
            master.originY ?? 0,
          );
      const newInst: Instance = {
        id: uuidv4(),
        cellId: item.cellId,
        name: getNextInstanceName(instances),
        x: placed.x,
        y: placed.y,
        orientation: item.orientation,
        ...(item.mosaic ? { mosaic: { ...item.mosaic } } : {}),
      };
      instances.push(newInst);
      newInstanceIds.push(newInst.id);
    }

    const shapes = [...state.shapes];
    const newShapeIds: string[] = [];
    for (const shapeItem of group.shapes) {
      const pos = snapUnboundedPosition(snappedTarget.x + shapeItem.dx, snappedTarget.y + shapeItem.dy, state.gridSize);
      const { dx: _dx, dy: _dy, ...rest } = shapeItem;
      void _dx;
      void _dy;
      const newShape: LayoutShape = {
        ...rest,
        id: uuidv4(),
        x: pos.x,
        y: pos.y,
      };
      shapes.push(newShape);
      newShapeIds.push(newShape.id);
    }

    const totalPlaced = newInstanceIds.length + newShapeIds.length;
    if (totalPlaced === 0) return state;

    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, shapes, instances, state.pixelArray, false, newShapeIds.length > 0)
      : null;

    return {
      ...commitProjectPatch(state, `Copy ${totalPlaced} object${totalPlaced === 1 ? '' : 's'}`, {
        instances,
        shapes,
        ...(boundsSync ?? {}),
      }),
      pendingCopyGroup: {
        ...group,
        anchorX: snappedTarget.x,
        anchorY: snappedTarget.y,
      },
      selectedInstanceIds: newInstanceIds,
      selectedInstanceId: newInstanceIds.at(-1) ?? null,
      selectedShapeId: newInstanceIds.length === 0 ? (newShapeIds.at(-1) ?? null) : null,
      pixelArraySelected: false,
    };
  }),

  cancelPendingCopyGroup: () => set((state) => ({
    pendingCopyGroup: null,
    appMode: state.appMode === 'place' && !state.placementMasterId ? 'select' : state.appMode,
  })),

  setMoveConstraint: (mode) => set({ moveConstraint: mode }),

  cycleMoveConstraint: () => set((state) => {
    const order: readonly MoveConstraintMode[] = ['orthogonal', 'free', 'horizontal', 'vertical'];
    const idx = order.indexOf(state.moveConstraint);
    return { moveConstraint: order[(idx + 1) % order.length] };
  }),


  addRuler: (startX, startY, endX, endY, referenceX, referenceY) => set((state) => commitProjectPatch(state, 'Add ruler', {
    rulers: [...state.rulers, {
      id: uuidv4(), startX, startY, endX, endY,
      ...(referenceX !== undefined && referenceY !== undefined ? { referenceX, referenceY } : {}),
    }],
  })),
  deleteRuler: (id) => set((state) => commitProjectPatch(state, 'Delete ruler', {
    rulers: state.rulers.filter(r => r.id !== id),
  })),
  clearRulers: () => set((state) => commitProjectPatch(state, 'Clear rulers', { rulers: [] })),
  
  undo: () => set((state) => {
    const result = undoHistory(state.history, getProjectSnapshot(state));
    if (!result) return state;
    return applyCanonicalSnapshot(state, result.snapshot, result.history);
  }),

  redo: () => set((state) => {
    const result = redoHistory(state.history, getProjectSnapshot(state));
    if (!result) return state;
    return applyCanonicalSnapshot(state, result.snapshot, result.history);
  }),

  alignSelectedInstances: (operation) => set((state) => {
    if (state.selectedInstanceIds.length < 2) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const selected = state.instances.flatMap(instance => {
      if (!selectedIds.has(instance.id)) return [];
      const master = state.masterCells[instance.cellId];
      if (!master) return [];
      return [{ ...instance, width: master.width, height: master.height, originX: master.originX, originY: master.originY }];
    });
    if (selected.length < 2) return state;
    const positions = alignInstances(selected, operation, {
      topWidth: state.topWidth,
      topHeight: state.topHeight,
      gridSize: state.gridSize,
      anchorId: state.selectedInstanceId ?? undefined,
      unbounded: true,
    });
    const positionById = new Map(positions.map(position => [position.id, position]));
    const instances = state.instances.map(instance => {
      const position = positionById.get(instance.id);
      if (!position) return instance;
      if (instance.locked && (Math.abs(position.x - instance.x) > 1e-9 || Math.abs(position.y - instance.y) > 1e-9)) {
        throw new Error(`Cannot align because ${instance.name} is locked`);
      }
      const master = state.masterCells[instance.cellId];
      if (master?.kind === 'pad' && !state.activeCellId) {
        const bounds = getPhysicalBounds({
          ...instance, x: position.x, y: position.y, width: master.width, height: master.height,
          originX: master.originX, originY: master.originY,
        });
        if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
          throw new RangeError(`Cannot align because pad ${instance.name} would leave the top-cell perimeter`);
        }
      }
      return { ...instance, x: position.x, y: position.y };
    });
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Align ${operation.replace('-', ' ')}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  alignSelectedInstancesToBoundary: (edge) => set((state) => {
    const boxEdgeCoordinate = (box: { minX: number; maxX: number; minY: number; maxY: number }, targetEdge: AlignmentEdge): number => {
      if (targetEdge === 'left') return box.minX;
      if (targetEdge === 'right') return box.maxX;
      if (targetEdge === 'horizontal-center') return (box.minX + box.maxX) / 2;
      if (targetEdge === 'bottom') return box.minY;
      if (targetEdge === 'top') return box.maxY;
      return (box.minY + box.maxY) / 2;
    };

    const isEipRootedAtTop = state.activeCellId !== null
      && state.descendStack.length > 0
      && state.descendStack[0].parentCellId === null
      && Boolean(state.rootView);

    let refBox: { minX: number; maxX: number; minY: number; maxY: number };
    let refLabel: string;
    let forwardTransform: { x: number; y: number; orientation: CadenceOrientation } | null = null;
    let inverseTransform: { x: number; y: number; orientation: CadenceOrientation } | null = null;

    if (state.activeCellId === null) {
      refBox = {
        minX: -state.topWidth / 2,
        maxX: state.topWidth / 2,
        minY: -state.topHeight / 2,
        maxY: state.topHeight / 2,
      };
      refLabel = state.topCellName;
    } else if (isEipRootedAtTop && state.rootView) {
      const liveChain = state.descendStack.map(step => {
        const liveParent = step.parentCellId ? state.masterCells[step.parentCellId] : null;
        return {
          ...step,
          parentWidth: liveParent?.width ?? (step.parentCellId === null ? state.rootView!.topWidth : step.parentWidth),
          parentHeight: liveParent?.height ?? (step.parentCellId === null ? state.rootView!.topHeight : step.parentHeight),
        };
      });
      forwardTransform = computeActiveToBaseTransform(liveChain, state.activeCoordinateMode, state.topWidth, state.topHeight);
      inverseTransform = invertCadenceTransform(forwardTransform);
      refBox = {
        minX: -state.rootView.topWidth / 2,
        maxX: state.rootView.topWidth / 2,
        minY: -state.rootView.topHeight / 2,
        maxY: state.rootView.topHeight / 2,
      };
      refLabel = state.rootView.topCellName;
    } else {
      if (state.topWidth <= 0 || state.topHeight <= 0) {
        throw new Error(`Cannot align to boundary because ${state.topCellName} has no boundary size yet.`);
      }
      const { originX, originY } = getActiveContainerOrigin(state);
      refBox = {
        minX: originX,
        maxX: originX + state.topWidth,
        minY: originY,
        maxY: originY + state.topHeight,
      };
      refLabel = state.topCellName;
    }

    const axis = getAlignmentEdgeAxis(edge);

    if (state.pixelArraySelected && state.pixelArray?.visible) {
      const pa = state.pixelArray;
      const paBounds = getPhysicalBounds({
        id: PIXEL_ARRAY_ALIGNMENT_ID,
        x: pa.x,
        y: pa.y,
        width: pa.width,
        height: pa.height,
        orientation: 'R0',
      });
      let nextX = pa.x;
      let nextY = pa.y;
      if (forwardTransform && inverseTransform) {
        const c1 = applyCadenceTransformPoint(forwardTransform, paBounds.left, paBounds.bottom);
        const c2 = applyCadenceTransformPoint(forwardTransform, paBounds.right, paBounds.top);
        const baseBounds = {
          left: Math.min(c1.x, c2.x),
          right: Math.max(c1.x, c2.x),
          bottom: Math.min(c1.y, c2.y),
          top: Math.max(c1.y, c2.y),
          centerX: (c1.x + c2.x) / 2,
          centerY: (c1.y + c2.y) / 2,
          width: Math.abs(c2.x - c1.x),
          height: Math.abs(c2.y - c1.y),
        };
        const delta = boxEdgeCoordinate(refBox, edge) - getEdgeCoordinate(baseBounds, edge);
        const editDelta = applyCadenceOrientationVector(
          inverseTransform.orientation,
          axis === 'horizontal' ? delta : 0,
          axis === 'vertical' ? delta : 0,
        );
        nextX = pa.x + editDelta.dx;
        nextY = pa.y + editDelta.dy;
      } else {
        const delta = boxEdgeCoordinate(refBox, edge) - getEdgeCoordinate(paBounds, edge);
        if (axis === 'horizontal') nextX = pa.x + delta;
        else nextY = pa.y + delta;
      }
      const { originX, originY } = getActiveContainerOrigin(state);
      const pixelArray = normalizePixelArray(
        { ...pa, x: nextX, y: nextY },
        state.topWidth,
        state.topHeight,
        state.gridSize,
        originX,
        originY,
      );
      if (Math.abs(pixelArray.x - pa.x) <= 1e-9 && Math.abs(pixelArray.y - pa.y) <= 1e-9) {
        return state;
      }
      return commitProjectPatch(state, `Align Pixel Array to ${refLabel} ${edge.replace('-', ' ')}`, { pixelArray });
    }

    if (state.selectedInstanceIds.length === 0 && state.selectedShapeId) {
      const targetShape = state.shapes.find(s => s.id === state.selectedShapeId && s.kind !== 'text');
      if (!targetShape) return state;
      if (targetShape.locked) {
        throw new Error('Cannot align because the selected rectangle is locked');
      }
      const shapeBounds = getPhysicalBounds({
        id: makeShapeAlignmentId(targetShape.id),
        x: targetShape.x,
        y: targetShape.y,
        width: targetShape.width,
        height: targetShape.height,
        orientation: 'R0',
      });
      let nextPos: { x: number; y: number };
      if (forwardTransform && inverseTransform) {
        const c1 = applyCadenceTransformPoint(forwardTransform, shapeBounds.left, shapeBounds.bottom);
        const c2 = applyCadenceTransformPoint(forwardTransform, shapeBounds.right, shapeBounds.top);
        const baseBounds = {
          left: Math.min(c1.x, c2.x),
          right: Math.max(c1.x, c2.x),
          bottom: Math.min(c1.y, c2.y),
          top: Math.max(c1.y, c2.y),
          centerX: (c1.x + c2.x) / 2,
          centerY: (c1.y + c2.y) / 2,
          width: Math.abs(c2.x - c1.x),
          height: Math.abs(c2.y - c1.y),
        };
        const delta = boxEdgeCoordinate(refBox, edge) - getEdgeCoordinate(baseBounds, edge);
        const editDelta = applyCadenceOrientationVector(
          inverseTransform.orientation,
          axis === 'horizontal' ? delta : 0,
          axis === 'vertical' ? delta : 0,
        );
        nextPos = snapUnboundedPosition(targetShape.x + editDelta.dx, targetShape.y + editDelta.dy, state.gridSize);
      } else {
        const delta = boxEdgeCoordinate(refBox, edge) - getEdgeCoordinate(shapeBounds, edge);
        nextPos = snapUnboundedPosition(
          axis === 'horizontal' ? targetShape.x + delta : targetShape.x,
          axis === 'vertical' ? targetShape.y + delta : targetShape.y,
          state.gridSize,
        );
      }
      if (Math.abs(nextPos.x - targetShape.x) <= 1e-9 && Math.abs(nextPos.y - targetShape.y) <= 1e-9) {
        return state;
      }
      const shapes = state.shapes.map(s => (s.id === targetShape.id ? { ...s, x: nextPos.x, y: nextPos.y } : s));
      const boundsSync = state.activeCellId
        ? syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true)
        : null;
      return commitProjectPatch(state, `Align rectangle to ${refLabel} ${edge.replace('-', ' ')}`, {
        shapes,
        ...(boundsSync ?? {}),
      });
    }

    if (state.selectedInstanceIds.length === 0) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    let anyChanged = false;
    const instances = state.instances.map(instance => {
      if (!selectedIds.has(instance.id)) return instance;
      if (instance.locked) {
        throw new Error(`Cannot align because ${instance.name} is locked`);
      }
      const master = state.masterCells[instance.cellId];
      if (!master || isCellEmpty(master)) return instance;
      const bounds = getPhysicalBounds({
        ...instance,
        width: master.width,
        height: master.height,
        originX: master.originX,
        originY: master.originY,
      });

      let nextPos: { x: number; y: number };
      if (forwardTransform && inverseTransform) {
        const c1 = applyCadenceTransformPoint(forwardTransform, bounds.left, bounds.bottom);
        const c2 = applyCadenceTransformPoint(forwardTransform, bounds.right, bounds.top);
        const baseBounds = {
          left: Math.min(c1.x, c2.x),
          right: Math.max(c1.x, c2.x),
          bottom: Math.min(c1.y, c2.y),
          top: Math.max(c1.y, c2.y),
          centerX: (c1.x + c2.x) / 2,
          centerY: (c1.y + c2.y) / 2,
          width: Math.abs(c2.x - c1.x),
          height: Math.abs(c2.y - c1.y),
        };
        const delta = boxEdgeCoordinate(refBox, edge) - getEdgeCoordinate(baseBounds, edge);
        const editDelta = applyCadenceOrientationVector(
          inverseTransform.orientation,
          axis === 'horizontal' ? delta : 0,
          axis === 'vertical' ? delta : 0,
        );
        nextPos = snapUnboundedPosition(instance.x + editDelta.dx, instance.y + editDelta.dy, state.gridSize);
      } else {
        const isRootPad = state.activeCellId === null && master.kind === 'pad';
        const effectiveBox = isRootPad
          ? {
              minX: refBox.minX + state.padInset,
              maxX: refBox.maxX - state.padInset,
              minY: refBox.minY + state.padInset,
              maxY: refBox.maxY - state.padInset,
            }
          : refBox;
        const delta = boxEdgeCoordinate(effectiveBox, edge) - getEdgeCoordinate(bounds, edge);
        const rawX = axis === 'horizontal' ? instance.x + delta : instance.x;
        const rawY = axis === 'vertical' ? instance.y + delta : instance.y;
        nextPos = snapUnboundedPosition(rawX, rawY, state.gridSize);
        if (isRootPad) {
          const movedBounds = getPhysicalBounds({
            ...instance,
            x: nextPos.x,
            y: nextPos.y,
            width: master.width,
            height: master.height,
            originX: master.originX,
            originY: master.originY,
          });
          if (!isPadTouchingPerimeter(movedBounds, state.topWidth, state.topHeight, state.padInset)) {
            throw new RangeError(`Cannot align pad ${instance.name} to ${edge.replace('-', ' ')} because it would leave the top-cell perimeter`);
          }
        }
      }

      if (Math.abs(nextPos.x - instance.x) > 1e-9 || Math.abs(nextPos.y - instance.y) > 1e-9) {
        anyChanged = true;
      }
      return { ...instance, x: nextPos.x, y: nextPos.y };
    });

    if (!anyChanged) return state;
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Align to ${refLabel} ${edge.replace('-', ' ')}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  alignInstanceEdges: (sourceId, targetId, sourceEdge, targetEdge, offset = 0) => set((state) => (
    edgeAlignmentPatch(state, sourceId, targetId, sourceEdge, targetEdge, offset)
  )),

  startEdgeAlignment: (sourceId) => set((state) => {
    const shapeId = parseShapeAlignmentId(sourceId);
    const sourceExists = state.instances.some(instance => instance.id === sourceId)
      || (sourceId === PIXEL_ARRAY_ALIGNMENT_ID && Boolean(state.pixelArray?.visible))
      || (shapeId !== null && state.shapes.some(shape => shape.id === shapeId && shape.kind !== 'text'));
    if (!sourceExists) return state;
    const sourceIds = sourceId === PIXEL_ARRAY_ALIGNMENT_ID || shapeId !== null
      ? [sourceId]
      : state.selectedInstanceIds.includes(sourceId)
        ? state.selectedInstanceIds.filter(id => state.instances.some(instance => instance.id === id))
        : [sourceId];
    return {
      edgeAlignmentSession: {
        sourceIds,
        sourceId,
        sourceEdge: null,
        targetId: null,
        targetEdge: null,
        offset: state.lastAlignmentSpacing,
      },
    };
  }),

  setEdgeAlignmentEdge: (instanceId, edge) => set((state) => {
    const session = state.edgeAlignmentSession;
    const shapeId = parseShapeAlignmentId(instanceId);
    const exists = state.instances.some(instance => instance.id === instanceId)
      || (instanceId === PIXEL_ARRAY_ALIGNMENT_ID && Boolean(state.pixelArray?.visible))
      || (shapeId !== null && state.shapes.some(shape => shape.id === shapeId && shape.kind !== 'text'));
    if (!session || !exists) return state;
    if (session.sourceIds.includes(instanceId)) {
      return { edgeAlignmentSession: { ...session, sourceId: instanceId, sourceEdge: edge, targetId: null, targetEdge: null } };
    }
    return {
      edgeAlignmentSession: {
        ...session,
        targetId: instanceId,
        targetEdge: edge,
      },
    };
  }),

  setEdgeAlignmentOffset: (value) => set((state) => {
    if (!state.edgeAlignmentSession) return state;
    const edgeAlignmentSession = { ...state.edgeAlignmentSession, offset: value };
    const normalized = value.trim();
    const spacing = Number(normalized);
    if (normalized !== '' && Number.isFinite(spacing) && spacing >= 0) {
      storeAlignmentSpacing(normalized);
      return { edgeAlignmentSession, lastAlignmentSpacing: normalized };
    }
    return { edgeAlignmentSession };
  }),

  completeEdgeAlignment: (targetId, targetEdge) => set((state) => {
    const session = state.edgeAlignmentSession;
    if (!session?.sourceEdge) throw new Error('Choose the source edge first');
    if (getAlignmentEdgeAxis(session.sourceEdge) !== getAlignmentEdgeAxis(targetEdge)) {
      throw new Error('Source and target edges must be on the same axis');
    }
    const spacing = parseEdgeAlignmentSpacing(session);
    const target = getAlignable(state, targetId);
    const targetCoordinate = getEdgeCoordinate(getPhysicalBounds(target), targetEdge);
    const offset = directionalSpacingOffset(getAlignable(state, session.sourceId), session.sourceEdge, targetCoordinate, spacing);
    return {
      ...edgeAlignmentPatch(
        state,
        session.sourceId,
        targetId,
        session.sourceEdge,
        targetEdge,
        offset,
        spacing,
        session.sourceIds,
      ),
      edgeAlignmentSession: null,
    };
  }),

  completeEdgeAlignmentToBoundary: (targetEdge) => set((state) => {
    const session = state.edgeAlignmentSession;
    if (!session?.sourceEdge) throw new Error('Choose the source edge first');
    if (getAlignmentEdgeAxis(session.sourceEdge) !== getAlignmentEdgeAxis(targetEdge)) {
      throw new Error('Source and top-cell edges must be on the same axis');
    }
    const { originX, originY } = getActiveContainerOrigin(state);
    const coordinate = targetEdge === 'left' ? originX
      : targetEdge === 'right' ? originX + state.topWidth
      : targetEdge === 'bottom' ? originY
      : originY + state.topHeight;
    const spacing = parseEdgeAlignmentSpacing(session);
    const offset = directionalSpacingOffset(getAlignable(state, session.sourceId), session.sourceEdge, coordinate, spacing);
    return {
      ...edgeAlignmentCoordinatePatch(
        state,
        session.sourceId,
        session.sourceEdge,
        coordinate,
        offset,
        `top.${targetEdge}`,
        spacing,
        session.sourceIds,
      ),
      edgeAlignmentSession: null,
    };
  }),

  completeEdgeAlignmentToCoordinate: (coordinate, referenceLabel = 'boundary') => set((state) => {
    const session = state.edgeAlignmentSession;
    if (!session?.sourceEdge) throw new Error('Choose the source edge first');
    if (!Number.isFinite(coordinate)) throw new RangeError('Boundary reference coordinate must be finite');
    // Snap sub-grid cross-hierarchy coordinates (e.g. legacy odd-width centered sub-cells) to nearest legal grid point.
    const snappedCoord = snapToGrid(coordinate, state.gridSize);
    const effectiveCoordinate = Math.abs(snappedCoord - coordinate) > 1e-9 ? snappedCoord : coordinate;
    const spacing = parseEdgeAlignmentSpacing(session);
    const offset = directionalSpacingOffset(getAlignable(state, session.sourceId), session.sourceEdge, effectiveCoordinate, spacing);
    return {
      ...edgeAlignmentCoordinatePatch(
        state,
        session.sourceId,
        session.sourceEdge,
        effectiveCoordinate,
        offset,
        referenceLabel,
        spacing,
        session.sourceIds,
      ),
      edgeAlignmentSession: null,
    };
  }),

  completeEdgeAlignmentToRuler: (rulerId) => set((state) => {
    const session = state.edgeAlignmentSession;
    if (!session?.sourceEdge) throw new Error('Choose the source edge first');
    const ruler = state.rulers.find(item => item.id === rulerId);
    if (!ruler) throw new Error('The ruler no longer exists');
    const axis = getAlignmentEdgeAxis(session.sourceEdge);
    const verticalRuler = Math.abs(ruler.endX - ruler.startX) <= 1e-9;
    const horizontalRuler = Math.abs(ruler.endY - ruler.startY) <= 1e-9;
    if ((axis === 'horizontal' && !verticalRuler) || (axis === 'vertical' && !horizontalRuler)) {
      throw new Error('Only an orthogonal ruler on the matching axis can be an alignment reference');
    }
    const coordinate = axis === 'horizontal' ? ruler.startX : ruler.startY;
    const spacing = parseEdgeAlignmentSpacing(session);
    const offset = directionalSpacingOffset(getAlignable(state, session.sourceId), session.sourceEdge, coordinate, spacing);
    return {
      ...edgeAlignmentCoordinatePatch(
        state,
        session.sourceId,
        session.sourceEdge,
        coordinate,
        offset,
        'ruler line',
        spacing,
        session.sourceIds,
      ),
      edgeAlignmentSession: null,
    };
  }),

  cancelEdgeAlignment: () => set({ edgeAlignmentSession: null }),

  applyEdgeAlignment: () => set((state) => {
    const session = state.edgeAlignmentSession;
    if (!session?.sourceEdge || !session.targetId || !session.targetEdge) {
      throw new Error('Choose a source edge and a target edge before applying alignment');
    }
    if (getAlignmentEdgeAxis(session.sourceEdge) !== getAlignmentEdgeAxis(session.targetEdge)) {
      throw new Error('Source and target edges must be on the same axis');
    }
    const spacing = parseEdgeAlignmentSpacing(session);
    const targetCoordinate = getEdgeCoordinate(getPhysicalBounds(getAlignable(state, session.targetId)), session.targetEdge);
    const offset = directionalSpacingOffset(getAlignable(state, session.sourceId), session.sourceEdge, targetCoordinate, spacing);
    return {
      ...edgeAlignmentPatch(
        state,
        session.sourceId,
        session.targetId,
        session.sourceEdge,
        session.targetEdge,
        offset,
        spacing,
        session.sourceIds,
      ),
      edgeAlignmentSession: null,
    };
  }),

  distributeSelectedInstances: (axis) => set((state) => {
    if (state.selectedInstanceIds.length < 3) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const selected = state.instances.flatMap(instance => {
      if (!selectedIds.has(instance.id)) return [];
      const master = state.masterCells[instance.cellId];
      if (!master) return [];
      return [{ ...instance, width: master.width, height: master.height, originX: master.originX, originY: master.originY }];
    });
    if (selected.length < 3) return state;
    const positions = distributeInstances(selected, axis, {
      topWidth: state.topWidth,
      topHeight: state.topHeight,
      gridSize: state.gridSize,
      unbounded: true,
    });
    const positionById = new Map(positions.map(position => [position.id, position]));
    const instances = state.instances.map(instance => {
      const position = positionById.get(instance.id);
      if (!position) return instance;
      if (instance.locked && (Math.abs(position.x - instance.x) > 1e-9 || Math.abs(position.y - instance.y) > 1e-9)) {
        throw new Error(`Cannot distribute because ${instance.name} is locked`);
      }
      const master = state.masterCells[instance.cellId];
      if (master?.kind === 'pad' && !state.activeCellId) {
        const bounds = getPhysicalBounds({
          ...instance, x: position.x, y: position.y, width: master.width, height: master.height,
          originX: master.originX, originY: master.originY,
        });
        if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
          throw new RangeError(`Cannot distribute because pad ${instance.name} would leave the top-cell perimeter`);
        }
      }
      return { ...instance, x: position.x, y: position.y };
    });
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Distribute ${axis}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),
  
  toggleOrthogonalRuler: () => set((state) => ({ orthogonalRuler: !state.orthogonalRuler })),
  toggleAutoDim: () => set((state) => ({ showAutoDim: !state.showAutoDim })),
  toggleOverlapDrc: () => set((state) => ({ showOverlapDrc: !state.showOverlapDrc })),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleSnapToVisibleGrid: () => set((state) => ({ snapToVisibleGrid: !state.snapToVisibleGrid })),
  toggleEditInPlaceContext: () => set((state) => ({ showEditInPlaceContext: !state.showEditInPlaceContext })),
  togglePartialSelectMode: () => set((state) => {
    const next = !state.partialSelectMode;
    const switchToSelect = next && state.appMode !== 'select' && state.appMode !== 'stretch';
    return {
      partialSelectMode: next,
      ...(switchToSelect ? {
        appMode: 'select' as AppMode,
        placementMasterId: null,
        pendingInstanceArray: null,
        pendingManualPadGroup: null,
        pendingPixelArraySize: null,
        edgeAlignmentSession: null,
      } : {}),
    };
  }),

  loadProject: (data) => set((state) => {
    const gridSize = data.gridSize ?? state.gridSize;
    const topWidth = data.topWidth ?? state.topWidth;
    const topHeight = data.topHeight ?? state.topHeight;
    const topLibName = data.topLibName ?? state.topLibName;
    const topCellName = data.topCellName ?? state.topCellName;
    const padInset = normalizePadInset(data.padInset ?? 0, topWidth, topHeight, gridSize);
    const rawMasterCells: Record<string, Cell> = Object.fromEntries(Object.entries(data.masterCells ?? {}).map(([id, master]) => [
      id,
      { ...master, libName: master.libName?.trim() || topLibName },
    ]));
    // Pass 1: Normalize drawn shapes and promote any cell with drawn shapes to Virtuoso content-driven autoBounds
    // so legacy saved cells (e.g. pre-sized IP/PAD boxes that already contain text/drawing shapes) shrink cleanly to ONLY their drawn content.
    const provisionalViews: Record<string, CellViewContent> = {};
    for (const [cellId, rawView] of Object.entries(data.cellViews ?? {})) {
      const container = rawMasterCells[cellId];
      if (!container) continue;
      const viewShapes = normalizeShapesForGrid(rawView.shapes ?? [], gridSize);
      if (viewShapes.length > 0 && !container.autoBounds) {
        rawMasterCells[cellId] = { ...container, autoBounds: true };
      }
      provisionalViews[cellId] = {
        ...rawView,
        instances: rawView.instances ?? [],
        rulers: rawView.rulers ?? [],
        ...(viewShapes.length > 0 ? { shapes: viewShapes } : {}),
      };
    }
    const masterCells = propagateAutoBounds(rawMasterCells, provisionalViews);

    const instances = clampInstancesToContainer(data.instances ?? [], masterCells, topWidth, topHeight, gridSize, padInset);
    const shapes = normalizeShapesForGrid(data.shapes ?? [], gridSize);
    const pixelArray = data.pixelArray
      ? normalizePixelArray(data.pixelArray, topWidth, topHeight, gridSize)
      : null;
    const loadedCellViews: Record<string, CellViewContent> = {};
    for (const [cellId, rawView] of Object.entries(provisionalViews)) {
      const container = masterCells[cellId];
      if (!container) continue;
      const rawInset = rawView.padInset ?? 0;
      const viewInset = rawInset > 0 && rawInset * 2 < container.width && rawInset * 2 < container.height
        ? normalizePadInset(rawInset, container.width, container.height, gridSize)
        : 0;
      const isOriginView = resolveStoredCoordinateMode(rawView) === 'origin';
      const viewInstances = clampInstancesToContainer(rawView.instances ?? [], masterCells, container.width, container.height, gridSize, viewInset, undefined, isOriginView);
      const viewShapes = rawView.shapes ?? [];
      const viewOriginX = isOriginView ? (container.originX ?? 0) : -container.width / 2;
      const viewOriginY = isOriginView ? (container.originY ?? 0) : -container.height / 2;
      const viewPixelArray = rawView.pixelArray && container.width > gridSize && container.height > gridSize
        ? normalizePixelArray(rawView.pixelArray, container.width, container.height, gridSize, viewOriginX, viewOriginY)
        : null;
      const normalizedCoordMode = viewShapes.length > 0 && viewInstances.length === 0
        ? 'origin'
        : rawView.coordinateMode;
      const normalized = buildCellViewContent(viewInstances, rawView.rulers ?? [], viewPixelArray, viewInset, viewShapes, normalizedCoordMode);
      if (!isEmptyCellView(normalized)) {
        loadedCellViews[cellId] = normalized;
      }
    }
    const libraries = deriveLibraries(topLibName, masterCells, data.libraries ?? []);
    return {
      ...state,
      gridSize,
      topWidth,
      topHeight,
      padInset,
      libraries,
      topLibName,
      topCellName,
      masterCells,
      instances,
      rulers: data.rulers ?? [],
      shapes,
      activeCoordinateMode: 'origin',
      pixelArray,
      cellViews: loadedCellViews,
      activeCellId: null,
      openViewIds: [null],
      windowLayoutMode: 'tabs',
      viewBreadcrumb: [],
      descendStack: [],
      rootView: null,
      pendingPixelArraySize: null,
      placementMasterId: null,
      pendingInstanceArray: null,
      pendingManualPadGroup: null,
      pendingCopyGroup: null,
      history: { past: [], future: [] },
      edgeAlignmentSession: null,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      selectedShapeId: null,
      pixelArraySelected: false,
      appMode: 'select',
    };
  }),
}));
