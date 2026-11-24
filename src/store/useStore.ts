import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { alignInstanceToCoordinate, alignInstanceToTarget, alignInstances, distributeInstances, getAlignmentEdgeAxis, getEdgeCoordinate, getPhysicalBounds } from '../utils/alignment.ts';
import type { AlignmentEdge, AlignmentOperation, DistributionAxis } from '../utils/alignment.ts';
import type { ProjectSnapshot } from './projectDocument.ts';
import { recordHistory, redoHistory, undoHistory } from './projectHistory.ts';
import type { ProjectHistory } from './projectHistory.ts';
import { snapToGrid } from '../utils/grid.ts';
import { wouldCreateHierarchyCycle } from '../utils/hierarchy.ts';
import type { CellViewContent, CellViewCoordinateMode } from '../utils/hierarchy.ts';
import { computeCellContentBounds } from '../utils/layoutLayers.ts';
import type { LayoutShape } from '../utils/layoutLayers.ts';

export type { LayoutShape } from '../utils/layoutLayers.ts';

export type Instance = {
  id: string;
  cellId: string;
  name: string;
  x: number;
  y: number;
  orientation: string;
  /** Locked instances cannot be moved, rotated, aligned, or deleted until unlocked. */
  locked?: boolean;
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
export type AppMode = 'select' | 'measure' | 'place' | 'pixel-array' | 'rect';

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
  /** Optional custom name or prefix (e.g. "U_ADC" -> "U_ADC", or "U_ADC_0_0" for mosaics). */
  namePrefix?: string;
  rows: number;
  cols: number;
  deltaX: number;
  deltaY: number;
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
  showCreateModal: boolean;
  showInstantiateModal: boolean;
  leftSidebarPinned: boolean;
  rightSidebarPinned: boolean;
  orthogonalRuler: boolean;
  showAutoDim: boolean;
  showOverlapDrc: boolean;
  showGrid: boolean;
  /** When enabled, canvas anchor/drag/placement snap to visible grid lines (exact multiples of gridSize). */
  snapToVisibleGrid: boolean;
  
  placementMasterId: string | null;
  placementOrientation: string;
  pendingInstanceArray: PendingInstanceArray | null;
  pendingManualPadGroup: PendingManualPadGroup | null;
  history: ProjectHistory;
  edgeAlignmentSession: EdgeAlignmentSession | null;
  lastAlignmentSpacing: string;
  clipboard: Instance[];
  
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
  setSelectedShape: (id: string | null) => void;
  addShape: (shape: Omit<LayoutShape, 'id'>) => string;
  updateShape: (id: string, patch: Partial<Omit<LayoutShape, 'id'>>) => void;
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
  setSelectedInstance: (id: string | null, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  selectAllInstances: () => void;
  deleteInstance: (id: string) => void;
  deleteSelectedInstances: () => void;
  nudgeSelection: (dx: number, dy: number) => void;
  copySelection: () => void;
  pasteClipboard: () => void;

  
  addRuler: (startX: number, startY: number, endX: number, endY: number, referenceX?: number, referenceY?: number) => void;
  deleteRuler: (id: string) => void;
  clearRulers: () => void;
  
  undo: () => void;
  redo: () => void;
  alignSelectedInstances: (operation: AlignmentOperation) => void;
  alignInstanceEdges: (sourceId: string, targetId: string, sourceEdge: AlignmentEdge, targetEdge: AlignmentEdge, offset?: number) => void;
  startEdgeAlignment: (sourceId: string) => void;
  setEdgeAlignmentEdge: (instanceId: string, edge: AlignmentEdge) => void;
  setEdgeAlignmentOffset: (value: string) => void;
  completeEdgeAlignment: (targetId: string, targetEdge: AlignmentEdge) => void;
  completeEdgeAlignmentToBoundary: (targetEdge: 'left' | 'right' | 'bottom' | 'top') => void;
  completeEdgeAlignmentToRuler: (rulerId: string) => void;
  cancelEdgeAlignment: () => void;
  applyEdgeAlignment: () => void;
  distributeSelectedInstances: (axis: DistributionAxis) => void;
  toggleOrthogonalRuler: () => void;
  toggleAutoDim: () => void;
  toggleOverlapDrc: () => void;
  toggleGrid: () => void;
  toggleSnapToVisibleGrid: () => void;
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
) => {
  const innerW = topWidth - padInset * 2;
  const innerH = topHeight - padInset * 2;
  if (innerW <= 0 || innerH <= 0) {
    throw new RangeError('Pad inset leaves no room inside the top cell');
  }
  const localBounds = getPhysicalBounds({ id: 'pad-preview', x: 0, y: 0, orientation, width, height });
  const inside = clampInstancePosition(x, y, orientation, width, height, innerW, innerH, gridSize);
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
) => {
  const innerW = topWidth - padInset * 2;
  const innerH = topHeight - padInset * 2;
  if (innerW <= 0 || innerH <= 0) {
    throw new RangeError('Pad inset leaves no room inside the top cell');
  }
  const candidates = (Object.keys(PAD_ORIENTATION_BY_SIDE) as PadSide[]).map(side => {
    const orientation = PAD_ORIENTATION_BY_SIDE[side];
    const local = getPhysicalBounds({ id: 'auto-pad-preview', x: 0, y: 0, orientation, width, height });
    const inside = clampInstancePosition(x, y, orientation, width, height, innerW, innerH, gridSize);
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
    const physical = getPhysicalBounds({ id: 'auto-pad-candidate', ...snapped, orientation, width, height });
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
  const innerW = config.topWidth - padInset * 2;
  const innerH = config.topHeight - padInset * 2;
  if (innerW <= 0 || innerH <= 0) {
    throw new RangeError('Pad inset leaves no room inside the top cell');
  }
  const local = getPhysicalBounds({ id: 'pad-group-preview', x: 0, y: 0, orientation: config.orientation, width: config.width, height: config.height });
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
    const position = clampInstancePosition(targetX, targetY, config.orientation, config.width, config.height, innerW, innerH, config.gridSize);
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
  if (unbounded) {
    return {
      ...instance,
      x: snapToGrid(instance.x, gridSize),
      y: snapToGrid(instance.y, gridSize),
    };
  }
  const position = master.kind === 'pad'
    ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, containerW, containerH, gridSize, instance.orientation, padInset)
    : clampInstancePosition(instance.x, instance.y, instance.orientation, master.width, master.height, containerW, containerH, gridSize, master.originX ?? 0, master.originY ?? 0);
  return { ...instance, x: position.x, y: position.y };
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
      openViewIds: ensureOpenViewTab(state.openViewIds, state.activeCellId, snapshot.masterCells),
      viewBreadcrumb,
      history,
      ...selectionAfterInstancesChange(state, instances),
      selectedShapeId: state.selectedShapeId && shapes.some(s => s.id === state.selectedShapeId) ? state.selectedShapeId : null,
      edgeAlignmentSession: null,
      pendingPixelArraySize: null,
      placementMasterId: null,
      pendingInstanceArray: null,
      pendingManualPadGroup: null,
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
    rootView: null,
    history,
    ...selectionAfterInstancesChange(state, snapshot.instances),
    selectedShapeId: state.selectedShapeId && rootShapes.some(s => s.id === state.selectedShapeId) ? state.selectedShapeId : null,
    edgeAlignmentSession: null,
    pendingPixelArraySize: null,
    placementMasterId: null,
    pendingInstanceArray: null,
    pendingManualPadGroup: null,
    appMode: 'select' as AppMode,
    pixelArraySelected: false,
  };
};

const switchToCellView = (
  state: ProjectState,
  targetCellId: string | null,
  nextBreadcrumb: string[],
) => {
  if (targetCellId === state.activeCellId) return state;
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
    pendingPixelArraySize: null,
    appMode: 'select' as AppMode,
  };

  const openViewIds = ensureOpenViewTab(state.openViewIds, targetCellId, state.masterCells);

  if (targetCellId === null) {
    return {
      ...savedRoot,
      activeCoordinateMode: 'origin' as CellViewCoordinateMode,
      cellViews: flushedCellViews,
      activeCellId: null,
      openViewIds,
      viewBreadcrumb: [],
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

const edgeAlignmentAfterInstancesChange = (state: ProjectState, instances: Instance[]) => {
  const session = state.edgeAlignmentSession;
  if (!session) return null;
  const existingIds = new Set(instances.map(instance => instance.id));
  const exists = (id: string) => existingIds.has(id)
    || (id === PIXEL_ARRAY_ALIGNMENT_ID && Boolean(state.pixelArray?.visible));
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
): Pick<ProjectSnapshot, 'instances' | 'pixelArray'> => {
  if (sourceId === PIXEL_ARRAY_ALIGNMENT_ID) {
    if (!state.pixelArray) throw new Error('The pixel array no longer exists');
    return { instances: state.instances, pixelArray: { ...state.pixelArray, x, y } };
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
 * `candidate` (touching/abutting edges with zero interior area are allowed).
 * Pixel Array is intentionally exempt because it is the only cell allowed to overlap.
 */
export const findOverlappingInstance = (
  candidate: { id?: string; x: number; y: number; orientation: string; width: number; height: number; originX?: number; originY?: number },
  instances: readonly Instance[],
  masterCells: Record<string, Cell>,
  ignoreIds?: ReadonlySet<string>,
): Instance | null => {
  const candidateBounds = getPhysicalBounds({
    id: candidate.id ?? '__candidate__',
    x: candidate.x,
    y: candidate.y,
    orientation: candidate.orientation,
    width: candidate.width,
    height: candidate.height,
    originX: candidate.originX,
    originY: candidate.originY,
  });
  for (const existing of instances) {
    if (candidate.id && existing.id === candidate.id) continue;
    if (ignoreIds?.has(existing.id)) continue;
    const master = masterCells[existing.cellId];
    if (!master) continue;
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

/**
 * Ensures none of the instances in `movedIds` overlap each other or any stationary
 * instance. Pixel Array is intentionally exempt (only Pixel Array may overlap).
 */
const assertMovedInstancesDoNotOverlap = (
  instances: readonly Instance[],
  masterCells: Record<string, Cell>,
  movedIds: ReadonlySet<string>,
  actionLabel: string,
) => {
  const boxes = instances.flatMap(inst => {
    const master = masterCells[inst.cellId];
    if (!master) return [];
    return [{
      inst,
      bounds: getPhysicalBounds({
        ...inst,
        width: master.width,
        height: master.height,
        originX: master.originX,
        originY: master.originY,
      }),
    }];
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (!movedIds.has(a.inst.id) && !movedIds.has(b.inst.id)) continue;
      if (boundsOverlap(a.bounds, b.bounds)) {
        throw new RangeError(
          `Cannot ${actionLabel}: ${a.inst.name} overlaps ${b.inst.name} (only Pixel Array may overlap other cells).`,
        );
      }
    }
  }
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
): Pick<ProjectSnapshot, 'instances' | 'pixelArray'> => {
  if (pivotId === PIXEL_ARRAY_ALIGNMENT_ID) {
    if (sourceIds.length !== 1) throw new Error('The pixel array cannot be part of an instance alignment group');
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
    const checked = state.activeCellId
      ? { x: snapToGrid(requestedX, state.gridSize), y: snapToGrid(requestedY, state.gridSize) }
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
  assertMovedInstancesDoNotOverlap(instances, state.masterCells, sourceSet, 'align');
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
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize, unbounded: Boolean(state.activeCellId) },
  );
  const patch = alignmentGroupPositionPatch(state, sourceIds, sourceId, position.x, position.y);
  const boundsSync = state.activeCellId
    ? syncMasterBoundsForActiveCell(state, state.shapes, patch.instances, patch.pixelArray ?? null)
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
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize, unbounded: Boolean(state.activeCellId) },
  );
  const patch = alignmentGroupPositionPatch(state, sourceIds, sourceId, position.x, position.y);
  const boundsSync = state.activeCellId
    ? syncMasterBoundsForActiveCell(state, state.shapes, patch.instances, patch.pixelArray ?? null)
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
  rootView: null,
  selectedInstanceId: null,
  selectedInstanceIds: [],
  selectedShapeId: null,
  pixelArraySelected: false,
  activeDrawLayer: 'text',
  activeDrawPurpose: 'drawing',
  activeDrawLabel: '',
  activeDrawColor: '',
  showCreateModal: false,
  showInstantiateModal: false,
  leftSidebarPinned: false,
  rightSidebarPinned: false,
  
  placementMasterId: null,
  placementOrientation: 'R0',
  pendingInstanceArray: null,
  pendingManualPadGroup: null,
  history: { past: [], future: [] },
  edgeAlignmentSession: null,
  lastAlignmentSpacing: readStoredAlignmentSpacing(),
  orthogonalRuler: false,
  showAutoDim: false,
  showOverlapDrc: true,
  showGrid: true,
  snapToVisibleGrid: false,
  clipboard: [],

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
    ...(mode === 'place' ? {} : { pendingManualPadGroup: null }),
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
    if (cellId === state.activeCellId) {
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
    if (state.activeCellId !== cellId) {
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
    return switchToCellView(state, inst.cellId, [...state.viewBreadcrumb, inst.cellId]);
  }),
  ascendToParent: () => set((state) => {
    if (state.activeCellId === null) return state;
    if (state.viewBreadcrumb.length <= 1) {
      return switchToCellView(state, null, []);
    }
    const nextBreadcrumb = state.viewBreadcrumb.slice(0, -1);
    const parentId = nextBreadcrumb[nextBreadcrumb.length - 1] ?? null;
    return switchToCellView(state, parentId, nextBreadcrumb);
  }),
  navigateBreadcrumb: (index) => set((state) => {
    if (index < 0) return switchToCellView(state, null, []);
    const nextBreadcrumb = state.viewBreadcrumb.slice(0, index + 1);
    const targetId = nextBreadcrumb[nextBreadcrumb.length - 1] ?? null;
    return switchToCellView(state, targetId, nextBreadcrumb);
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

    if (Math.abs(nextW - existing.width) > 1e-9 || Math.abs(nextH - existing.height) > 1e-9) {
      const affectedActive = new Set(instances.filter(i => editingActiveView || i.cellId === id).map(i => i.id));
      if (affectedActive.size > 0) {
        assertMovedInstancesDoNotOverlap(instances, masterCells, affectedActive, `resize ${cellName}`);
      }
      if (rootView) {
        const affectedRoot = new Set(rootView.instances.filter(i => i.cellId === id).map(i => i.id));
        if (affectedRoot.size > 0) {
          assertMovedInstancesDoNotOverlap(rootView.instances, masterCells, affectedRoot, `resize ${cellName}`);
        }
      }
      for (const [viewCellId, view] of Object.entries(nextCellViews)) {
        const affectedView = new Set(view.instances.filter(i => viewCellId === id || i.cellId === id).map(i => i.id));
        if (affectedView.size > 0) {
          assertMovedInstancesDoNotOverlap(view.instances, masterCells, affectedView, `resize ${cellName}`);
        }
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
    const clearingPlacement = state.placementMasterId === id || state.pendingManualPadGroup?.masterId === id;
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
      if (!Number.isFinite(rawShape.x) || !Number.isFinite(rawShape.y) ||
          !Number.isFinite(rawShape.width) || !Number.isFinite(rawShape.height)) {
        throw new RangeError('Rectangle coordinates and dimensions must be finite numbers.');
      }
      const x = snapToGrid(rawShape.x, state.gridSize);
      const y = snapToGrid(rawShape.y, state.gridSize);
      const width = snapToGrid(rawShape.width, state.gridSize);
      const height = snapToGrid(rawShape.height, state.gridSize);
      if (width <= 1e-12 || height <= 1e-12) {
        throw new RangeError('Rectangle width and height must be positive.');
      }
      const shape: LayoutShape = {
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
      const shapes = [...state.shapes, shape];
      const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray, false, true);
      return {
        ...commitProjectPatch(state, `Draw ${layer}/${purpose} rect`, {
          shapes,
          ...(state.activeCellId ? { activeCoordinateMode: 'origin' as CellViewCoordinateMode } : {}),
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
    const rawW = patch.width !== undefined ? patch.width : existing.width;
    const rawH = patch.height !== undefined ? patch.height : existing.height;
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(rawW) || !Number.isFinite(rawH)) {
      throw new RangeError('Rectangle coordinates and dimensions must be finite numbers.');
    }
    const x = snapToGrid(rawX, state.gridSize);
    const y = snapToGrid(rawY, state.gridSize);
    const width = snapToGrid(rawW, state.gridSize);
    const height = snapToGrid(rawH, state.gridSize);
    if (width <= 1e-12 || height <= 1e-12) {
      throw new RangeError('Rectangle width and height must be positive.');
    }
    const nextColor = patch.color !== undefined ? patch.color.trim() : existing.color;
    const nextLabel = patch.label !== undefined ? patch.label.trim() : existing.label;
    const nextLocked = patch.locked !== undefined ? patch.locked : existing.locked;
    const updated: LayoutShape = {
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
    const shapes = state.shapes.map(s => (s.id === id ? updated : s));
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray);
    return commitProjectPatch(state, `Edit ${nextLayer}/${nextPurpose} rect`, {
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
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray);
    return {
      ...commitProjectPatch(state, `Delete ${existing.layer}/${existing.purpose} rect`, {
        shapes,
        ...(boundsSync ?? {}),
      }),
      selectedShapeId: state.selectedShapeId === id ? null : state.selectedShapeId,
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
    return commitProjectPatch(state, `${shouldLock ? 'Lock' : 'Unlock'} ${existing.layer}/${existing.purpose} rect`, { shapes });
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
    const boundsSync = syncMasterBoundsForActiveCell(state, shapes, state.instances, state.pixelArray);
    return commitProjectPatch(state, `Nudge ${existing.layer}/${existing.purpose} rect`, {
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
    const clamped = isSubCellCanvas
      ? {
          x: Object.is(snapToGrid(targetX, state.gridSize), -0) ? 0 : snapToGrid(targetX, state.gridSize),
          y: Object.is(snapToGrid(targetY, state.gridSize), -0) ? 0 : snapToGrid(targetY, state.gridSize),
        }
      : master.kind === 'pad'
        ? snapPadToNearestEdge(targetX, targetY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, effectiveOrientation, state.padInset)
        : clampInstancePosition(targetX, targetY, effectiveOrientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, master.originX ?? 0, master.originY ?? 0);

    const blocker = findOverlappingInstance(
      { x: clamped.x, y: clamped.y, orientation: effectiveOrientation, width: master.width, height: master.height, originX: master.originX, originY: master.originY },
      state.instances,
      state.masterCells,
    );
    if (blocker) {
      throw new RangeError(
        `Cannot place ${master.cellName} here: overlaps ${blocker.name} (only Pixel Array may overlap other cells).`,
      );
    }

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
    if (rows * cols > 500) {
      throw new RangeError('Mosaic array cannot exceed 500 instances at once.');
    }
    if (!Number.isFinite(config.deltaX) || !Number.isFinite(config.deltaY)) {
      throw new RangeError('Mosaic pitch values must be finite numbers.');
    }

    const instances = [...state.instances];
    const usedNames = new Set(instances.map(i => i.name));
    const prefix = config.namePrefix?.trim() ?? '';
    const newIds: string[] = [];
    const isSubCellCanvas = state.activeCellId !== null;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const reqX = originX + c * config.deltaX;
        const reqY = originY + r * config.deltaY;
        const placed = isSubCellCanvas
          ? {
              x: Object.is(snapToGrid(reqX, state.gridSize), -0) ? 0 : snapToGrid(reqX, state.gridSize),
              y: Object.is(snapToGrid(reqY, state.gridSize), -0) ? 0 : snapToGrid(reqY, state.gridSize),
            }
          : master.kind === 'pad'
            ? snapPadToNearestEdge(reqX, reqY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, orientation, state.padInset)
            : clampInstancePosition(reqX, reqY, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, master.originX ?? 0, master.originY ?? 0);

        const blocker = findOverlappingInstance(
          { x: placed.x, y: placed.y, orientation, width: master.width, height: master.height, originX: master.originX, originY: master.originY },
          instances,
          state.masterCells,
        );
        if (blocker) {
          throw new RangeError(
            `Cannot place ${rows}×${cols} ${master.cellName} mosaic: overlaps ${blocker.name} (only Pixel Array may overlap other cells).`,
          );
        }

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
      const blocker = findOverlappingInstance(
        { x: position.x, y: position.y, orientation, width: master.width, height: master.height },
        instances,
        masterCells,
      );
      if (blocker) {
        throw new RangeError(
          `Cannot place ${cellName} pad row: overlaps ${blocker.name} (only Pixel Array may overlap other cells).`,
        );
      }
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
    const snapped = snapPadToAutoOrientedEdge(x, y, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, state.padInset);
    const horizontal = snapped.side === 'top' || snapped.side === 'bottom';
    const centerAlong = horizontal ? x : y;
    const positions = computePadGroupPositions({
      width: master.width, height: master.height, count: pending.count, pitch: pending.pitch,
      side: snapped.side, centerAlong, orientation: snapped.orientation,
      topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize,
      padInset: state.padInset,
    });
    const instances = [...state.instances];
    for (const position of positions) {
      const blocker = findOverlappingInstance(
        { x: position.x, y: position.y, orientation: snapped.orientation, width: master.width, height: master.height },
        instances,
        state.masterCells,
      );
      if (blocker) {
        throw new RangeError(
          `Cannot place ${master.cellName} pad group: overlaps ${blocker.name} (only Pixel Array may overlap other cells).`,
        );
      }
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
        const nextPos = isSubCellCanvas
          ? {
              x: Object.is(snapToGrid(x, state.gridSize), -0) ? 0 : snapToGrid(x, state.gridSize),
              y: Object.is(snapToGrid(y, state.gridSize), -0) ? 0 : snapToGrid(y, state.gridSize),
            }
          : master.kind === 'pad'
            ? snapPadToNearestEdge(
                x,
                y,
                master.width,
                master.height,
                state.topWidth,
                state.topHeight,
                state.gridSize,
                inst.orientation,
                state.padInset,
              )
            : clampInstancePosition(x, y, inst.orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, master.originX ?? 0, master.originY ?? 0);
        const blocker = findOverlappingInstance(
          { id: inst.id, x: nextPos.x, y: nextPos.y, orientation: inst.orientation, width: master.width, height: master.height, originX: master.originX, originY: master.originY },
          state.instances,
          state.masterCells,
        );
        if (blocker) {
          throw new RangeError(
            `Cannot move ${inst.name} here: overlaps ${blocker.name} (only Pixel Array may overlap other cells).`,
          );
        }
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
      const requestedX = snapToGrid(inst.x + snappedDx, state.gridSize);
      const requestedY = snapToGrid(inst.y + snappedDy, state.gridSize);
      if (isSubCellCanvas) {
        return {
          ...inst,
          x: Object.is(requestedX, -0) ? 0 : requestedX,
          y: Object.is(requestedY, -0) ? 0 : requestedY,
        };
      }
      const checked = clampInstancePosition(
        requestedX,
        requestedY,
        inst.orientation,
        master.width,
        master.height,
        state.topWidth,
        state.topHeight,
        state.gridSize,
        master.originX ?? 0,
        master.originY ?? 0,
      );
      if (Math.abs(checked.x - requestedX) > 1e-9 || Math.abs(checked.y - requestedY) > 1e-9) {
        throw new RangeError(`Cannot move the selected group without placing ${inst.name} outside the top cell`);
      }
      if (master.kind === 'pad') {
        const bounds = getPhysicalBounds({
          ...inst, x: checked.x, y: checked.y, width: master.width, height: master.height,
          originX: master.originX, originY: master.originY,
        });
        if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
          throw new RangeError(`Cannot move the group because pad ${inst.name} would leave the pad perimeter`);
        }
      }
      return { ...inst, x: checked.x, y: checked.y };
    });
    assertMovedInstancesDoNotOverlap(instances, state.masterCells, idSet, 'move selection');
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
        const clamped = isSubCellCanvas
          ? {
              x: Object.is(snapToGrid(centeredX, state.gridSize), -0) ? 0 : snapToGrid(centeredX, state.gridSize),
              y: Object.is(snapToGrid(centeredY, state.gridSize), -0) ? 0 : snapToGrid(centeredY, state.gridSize),
            }
          : master.kind === 'pad'
            ? snapPadToNearestEdge(centeredX, centeredY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, orientation, state.padInset)
            : clampInstancePosition(centeredX, centeredY, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, master.originX ?? 0, master.originY ?? 0);
        const blocker = findOverlappingInstance(
          { id: inst.id, x: clamped.x, y: clamped.y, orientation, width: master.width, height: master.height, originX: master.originX, originY: master.originY },
          state.instances,
          state.masterCells,
        );
        if (blocker) {
          throw new RangeError(
            `Cannot orient ${inst.name} to ${orientation}: overlaps ${blocker.name} (only Pixel Array may overlap other cells).`,
          );
        }
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
        const requestedX = snapToGrid(inst.x + dx, state.gridSize);
        const requestedY = snapToGrid(inst.y + dy, state.gridSize);
        if (isSubCellCanvas) {
          return {
            ...inst,
            x: Object.is(requestedX, -0) ? 0 : requestedX,
            y: Object.is(requestedY, -0) ? 0 : requestedY,
          };
        }
        const clamped = clampInstancePosition(
          requestedX,
          requestedY,
          inst.orientation,
          master.width,
          master.height,
          state.topWidth,
          state.topHeight,
          state.gridSize,
          master.originX ?? 0,
          master.originY ?? 0,
        );
        if (Math.abs(clamped.x - requestedX) > 1e-9 || Math.abs(clamped.y - requestedY) > 1e-9) {
          error = true;
          return inst;
        }
        if (master.kind === 'pad') {
          const bounds = getPhysicalBounds({
            ...inst, x: clamped.x, y: clamped.y, width: master.width, height: master.height,
            originX: master.originX, originY: master.originY,
          });
          if (!isPadTouchingPerimeter(bounds, state.topWidth, state.topHeight, state.padInset)) {
            error = true;
            return inst;
          }
        }
        return { ...inst, x: clamped.x, y: clamped.y };
      } catch {
        error = true;
        return inst;
      }
    });
    if (error) return state; // Cancel nudge if any block hits bounds or leaves perimeter
    try {
      assertMovedInstancesDoNotOverlap(instances, state.masterCells, selectedIds, 'nudge');
    } catch {
      return state; // Cancel nudge atomically if any block would overlap another cell
    }
    const boundsSync = isSubCellCanvas
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Nudge ${state.selectedInstanceIds.length} block${state.selectedInstanceIds.length === 1 ? '' : 's'}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  copySelection: () => set((state) => {
    if (state.selectedInstanceIds.length === 0) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const clipboard = state.instances.filter(inst => selectedIds.has(inst.id));
    return { clipboard };
  }),

  pasteClipboard: () => set((state) => {
    if (!state.clipboard || state.clipboard.length === 0) return state;
    
    const offset = 20 * state.gridSize;
    const mergedViews = state.activeCellId ? mergeActiveViewIntoCellViews(state) : state.cellViews;
    let instances = [...state.instances];
    const newSelectedIds: string[] = [];
    
    for (const item of state.clipboard) {
      const master = state.masterCells[item.cellId];
      if (!master) continue; // master deleted
      if (state.activeCellId && wouldCreateHierarchyCycle(state.activeCellId, item.cellId, mergedViews)) {
        continue; // prevent pasting a recursive hierarchy cycle or self-instance
      }
      if (isCellEmpty(master)) {
        continue; // prevent pasting an empty cellview
      }
      
      const newInst = {
        ...item,
        id: uuidv4(),
        name: getNextInstanceName(instances),
      };
      
      const bounds = getPhysicalBounds({ ...item, width: master.width, height: master.height, originX: master.originX, originY: master.originY });
      const stepX = Math.max(offset, bounds.right - bounds.left + offset);
      const stepY = Math.max(offset, bounds.top - bounds.bottom + offset);
      const candidateOffsets: Array<[number, number]> = [
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

      const isSubCellCanvas = state.activeCellId !== null;
      let placedPos: { x: number; y: number } | null = null;
      for (const [dx, dy] of candidateOffsets) {
        try {
          const clamped = isSubCellCanvas
            ? {
                x: Object.is(snapToGrid(item.x + dx, state.gridSize), -0) ? 0 : snapToGrid(item.x + dx, state.gridSize),
                y: Object.is(snapToGrid(item.y + dy, state.gridSize), -0) ? 0 : snapToGrid(item.y + dy, state.gridSize),
              }
            : master.kind === 'pad'
              ? snapPadToNearestEdge(item.x + dx, item.y + dy, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, item.orientation, state.padInset)
              : clampInstancePosition(item.x + dx, item.y + dy, item.orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, master.originX ?? 0, master.originY ?? 0);
          const blocker = findOverlappingInstance(
            { x: clamped.x, y: clamped.y, orientation: item.orientation, width: master.width, height: master.height, originX: master.originX, originY: master.originY },
            instances,
            state.masterCells,
          );
          if (!blocker) {
            placedPos = clamped;
            break;
          }
        } catch {
          // Try next candidate spot
        }
      }
      if (!placedPos) continue;
      newInst.x = placedPos.x;
      newInst.y = placedPos.y;
      
      instances.push(newInst);
      newSelectedIds.push(newInst.id);
    }
    
    if (newSelectedIds.length === 0) return state;
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    
    return {
      ...commitProjectPatch(state, `Paste ${newSelectedIds.length} block${newSelectedIds.length === 1 ? '' : 's'}`, {
        instances,
        ...(boundsSync ?? {}),
      }),
      selectedInstanceIds: newSelectedIds,
      selectedInstanceId: newSelectedIds.at(-1) ?? null,
      selectedShapeId: null,
      pixelArraySelected: false,
    };
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
      unbounded: Boolean(state.activeCellId),
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
    assertMovedInstancesDoNotOverlap(instances, state.masterCells, selectedIds, `align ${operation.replace('-', ' ')}`);
    const boundsSync = state.activeCellId
      ? syncMasterBoundsForActiveCell(state, state.shapes, instances, state.pixelArray)
      : null;
    return commitProjectPatch(state, `Align ${operation.replace('-', ' ')}`, {
      instances,
      ...(boundsSync ?? {}),
    });
  }),

  alignInstanceEdges: (sourceId, targetId, sourceEdge, targetEdge, offset = 0) => set((state) => (
    edgeAlignmentPatch(state, sourceId, targetId, sourceEdge, targetEdge, offset)
  )),

  startEdgeAlignment: (sourceId) => set((state) => {
    const sourceExists = state.instances.some(instance => instance.id === sourceId)
      || (sourceId === PIXEL_ARRAY_ALIGNMENT_ID && Boolean(state.pixelArray?.visible));
    if (!sourceExists) return state;
    const sourceIds = sourceId === PIXEL_ARRAY_ALIGNMENT_ID
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
    const exists = state.instances.some(instance => instance.id === instanceId)
      || (instanceId === PIXEL_ARRAY_ALIGNMENT_ID && Boolean(state.pixelArray?.visible));
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
      unbounded: Boolean(state.activeCellId),
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
    assertMovedInstancesDoNotOverlap(instances, state.masterCells, selectedIds, `distribute ${axis}`);
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

  loadProject: (data) => set((state) => {
    const gridSize = data.gridSize ?? state.gridSize;
    const topWidth = data.topWidth ?? state.topWidth;
    const topHeight = data.topHeight ?? state.topHeight;
    const topLibName = data.topLibName ?? state.topLibName;
    const topCellName = data.topCellName ?? state.topCellName;
    const padInset = normalizePadInset(data.padInset ?? 0, topWidth, topHeight, gridSize);
    const masterCells = Object.fromEntries(Object.entries(data.masterCells ?? {}).map(([id, master]) => [
      id,
      { ...master, libName: master.libName?.trim() || topLibName },
    ]));
    const instances = clampInstancesToContainer(data.instances ?? [], masterCells, topWidth, topHeight, gridSize, padInset);
    const shapes = normalizeShapesForGrid(data.shapes ?? [], gridSize);
    const pixelArray = data.pixelArray
      ? normalizePixelArray(data.pixelArray, topWidth, topHeight, gridSize)
      : null;
    const loadedCellViews: Record<string, CellViewContent> = {};
    for (const [cellId, rawView] of Object.entries(data.cellViews ?? {})) {
      const container = masterCells[cellId];
      if (!container) continue;
      const viewInset = normalizePadInset(rawView.padInset ?? 0, container.width, container.height, gridSize);
      const isOriginView = resolveStoredCoordinateMode(rawView) === 'origin';
      const viewInstances = clampInstancesToContainer(rawView.instances ?? [], masterCells, container.width, container.height, gridSize, viewInset, undefined, isOriginView);
      const viewShapes = normalizeShapesForGrid(rawView.shapes ?? [], gridSize);
      const viewOriginX = isOriginView ? (container.originX ?? 0) : -container.width / 2;
      const viewOriginY = isOriginView ? (container.originY ?? 0) : -container.height / 2;
      const viewPixelArray = rawView.pixelArray
        ? normalizePixelArray(rawView.pixelArray, container.width, container.height, gridSize, viewOriginX, viewOriginY)
        : null;
      const normalized = buildCellViewContent(viewInstances, rawView.rulers ?? [], viewPixelArray, viewInset, viewShapes, rawView.coordinateMode);
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
      rootView: null,
      pendingPixelArraySize: null,
      placementMasterId: null,
      pendingInstanceArray: null,
      pendingManualPadGroup: null,
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
