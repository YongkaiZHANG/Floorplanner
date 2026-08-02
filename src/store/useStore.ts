import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { alignInstanceToCoordinate, alignInstanceToTarget, alignInstances, distributeInstances, getAlignmentEdgeAxis, getEdgeCoordinate, getPhysicalBounds } from '../utils/alignment.ts';
import type { AlignmentEdge, AlignmentOperation, DistributionAxis } from '../utils/alignment.ts';
import type { ProjectSnapshot } from './projectDocument.ts';
import { recordHistory, redoHistory, undoHistory } from './projectHistory.ts';
import type { ProjectHistory } from './projectHistory.ts';
import { snapToGrid } from '../utils/grid.ts';

export type Instance = {
  id: string;
  cellId: string;
  name: string;
  x: number;
  y: number;
  orientation: string;
};

export type Cell = {
  id: string;
  libName: string;
  cellName: string;
  width: number;
  height: number;
  color: string;
  /** Pads remain attached to the nearest top-cell edge when moved. */
  kind?: 'ip' | 'pad';
  /** Canvas/SVG planning appearance; Cadence display colors remain technology-controlled. */
  opacity?: number;
  outlineStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
};

export type Ruler = {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
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
export type AppMode = 'select' | 'measure' | 'place' | 'pixel-array';

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
  /** Row-center displacement from the top-cell center: X on top/bottom, Y on left/right. */
  offset: number;
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
  orientation: string;
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

export type ProjectState = {
  gridSize: number;
  appMode: AppMode;
  
  topWidth: number;
  topHeight: number;
  topLibName: string;
  topCellName: string;
  
  masterCells: Record<string, Cell>;
  instances: Instance[];
  rulers: Ruler[];
  pixelArray: PixelArray | null;
  pendingPixelArraySize: PixelArraySize | null;
  
  selectedInstanceId: string | null;
  selectedInstanceIds: string[];
  pixelArraySelected: boolean;
  showCreateModal: boolean;
  showInstantiateModal: boolean;
  leftSidebarPinned: boolean;
  rightSidebarPinned: boolean;
  orthogonalRuler: boolean;
  showAutoDim: boolean;
  
  placementMasterId: string | null;
  placementOrientation: string;
  pendingManualPadGroup: PendingManualPadGroup | null;
  history: ProjectHistory;
  edgeAlignmentSession: EdgeAlignmentSession | null;
  lastAlignmentSpacing: string;
  
  setGridSize: (size: number) => void;
  setAppMode: (mode: AppMode) => void;
  setTopDimensions: (w: number, h: number) => void;
  setTopNames: (lib: string, cell: string) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowInstantiateModal: (show: boolean) => void;
  setLeftSidebarPinned: (pinned: boolean) => void;
  setRightSidebarPinned: (pinned: boolean) => void;
  setPlacement: (masterId: string | null, orientation?: string) => void;
  
  addMasterCell: (libName: string, cellName: string, w: number, h: number, color: string, opacity?: number, outlineStyle?: Cell['outlineStyle']) => void;
  updateMasterCell: (id: string, libName: string, cellName: string, w: number, h: number, color: string, opacity?: number, outlineStyle?: Cell['outlineStyle']) => void;
  deleteMasterCell: (id: string) => void;
  placeInstance: (cellId: string, x?: number, y?: number, orientation?: string) => void;
  createPadRow: (config: PadRowConfig) => void;
  prepareManualPadPlacement: (config: PadMasterConfig) => void;
  placeManualPadGroup: (x: number, y: number) => void;
  startPixelArrayPlacement: (width: number, height: number) => void;
  placePixelArray: (centerX: number, centerY: number) => void;
  updatePixelArrayPosition: (x: number, y: number) => void;
  setPixelArrayVisible: (visible: boolean) => void;
  setPixelArraySelected: (selected: boolean) => void;
  deletePixelArray: () => void;
  
  updateInstancePosition: (instanceId: string, x: number, y: number) => void;
  updateInstanceOrientation: (instanceId: string, orientation: string) => void;
  setSelectedInstance: (id: string | null, additive?: boolean) => void;
  selectAllInstances: () => void;
  deleteInstance: (id: string) => void;
  deleteSelectedInstances: () => void;
  
  addRuler: (startX: number, startY: number, endX: number, endY: number) => void;
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
  gridSize: number
) => {
  const t = getTransformProps(orientation);
  const rad = t.rotation * Math.PI / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));

  const transformPoint = (px: number, py: number) => {
    let sx = px * t.scaleX;
    let sy = py * t.scaleY;
    let rx = sx * cos - sy * sin;
    let ry = sx * sin + sy * cos;
    return { x: rx, y: ry };
  };

  const p1 = transformPoint(0, 0);
  const p2 = transformPoint(w, 0);
  const p3 = transformPoint(w, h);
  const p4 = transformPoint(0, h);

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

export const snapPadToNearestEdge = (
  x: number,
  y: number,
  width: number,
  height: number,
  topWidth: number,
  topHeight: number,
  gridSize: number,
  orientation = 'R0',
) => {
  const localBounds = getPhysicalBounds({ id: 'pad-preview', x: 0, y: 0, orientation, width, height });
  const inside = clampInstancePosition(x, y, orientation, width, height, topWidth, topHeight, gridSize);
  const edgeCoordinates = {
    left: -topWidth / 2 - localBounds.left,
    right: topWidth / 2 - localBounds.right,
    bottom: -topHeight / 2 - localBounds.bottom,
    top: topHeight / 2 - localBounds.top,
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
};

export const computePadGroupPositions = (config: PadGroupGeometry) => {
  const local = getPhysicalBounds({ id: 'pad-group-preview', x: 0, y: 0, orientation: config.orientation, width: config.width, height: config.height });
  const horizontal = config.side === 'top' || config.side === 'bottom';
  const padAlong = horizontal ? local.right - local.left : local.top - local.bottom;
  if (config.pitch + 1e-9 < padAlong) {
    throw new RangeError(`Pad pitch must be at least the rotated pad ${horizontal ? 'width' : 'height'} (${padAlong} um) to avoid overlap`);
  }
  const span = (config.count - 1) * config.pitch + padAlong;
  const available = horizontal ? config.topWidth : config.topHeight;
  if (span > available + 1e-9) throw new RangeError(`Pad group span ${span} um exceeds the ${available} um top-cell edge`);

  const minCenter = -available / 2 + span / 2;
  const maxCenter = available / 2 - span / 2;
  const centerAlong = snapToGrid(Math.max(minCenter, Math.min(config.centerAlong, maxCenter)), config.gridSize);
  const firstCenter = centerAlong - ((config.count - 1) * config.pitch) / 2;

  return Array.from({ length: config.count }, (_, index) => {
    const along = firstCenter + index * config.pitch;
    const targetX = horizontal
      ? along - local.centerX
      : config.side === 'left' ? -config.topWidth / 2 - local.left : config.topWidth / 2 - local.right;
    const targetY = horizontal
      ? config.side === 'bottom' ? -config.topHeight / 2 - local.bottom : config.topHeight / 2 - local.top
      : along - local.centerY;
    const position = clampInstancePosition(targetX, targetY, config.orientation, config.width, config.height, config.topWidth, config.topHeight, config.gridSize);
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
): PixelArray => {
  const maxWidth = snapToGrid(Math.floor((topWidth - 1e-9) / gridSize) * gridSize, gridSize);
  const maxHeight = snapToGrid(Math.floor((topHeight - 1e-9) / gridSize) * gridSize, gridSize);
  if (maxWidth <= 0 || maxHeight <= 0) throw new RangeError('The top cell is too small for a pixel array');
  const width = Math.min(maxWidth, Math.max(gridSize, snapToGrid(pixelArray.width, gridSize)));
  const height = Math.min(maxHeight, Math.max(gridSize, snapToGrid(pixelArray.height, gridSize)));
  const position = clampInstancePosition(
    pixelArray.x,
    pixelArray.y,
    'R0',
    width,
    height,
    topWidth,
    topHeight,
    gridSize,
  );
  return { ...pixelArray, ...position, width, height };
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

export const getProjectSnapshot = (state: ProjectState): ProjectSnapshot => ({
  gridSize: state.gridSize,
  topWidth: state.topWidth,
  topHeight: state.topHeight,
  topLibName: state.topLibName,
  topCellName: state.topCellName,
  masterCells: state.masterCells,
  instances: state.instances,
  rulers: state.rulers,
  pixelArray: state.pixelArray,
});

const commitProjectPatch = (
  state: ProjectState,
  label: string,
  patch: Partial<ProjectSnapshot>,
) => {
  const before = getProjectSnapshot(state);
  const after = { ...before, ...patch };
  return {
    ...patch,
    history: recordHistory(state.history, label, before, after),
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
  return { ...instance, width: master.width, height: master.height };
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
    const master = state.masterCells[instance.cellId];
    if (!master) throw new Error(`The master for ${instance.name} no longer exists`);
    const requestedX = instance.x + deltaX;
    const requestedY = instance.y + deltaY;
    const checked = clampInstancePosition(
      requestedX, requestedY, instance.orientation, master.width, master.height,
      state.topWidth, state.topHeight, state.gridSize,
    );
    if (Math.abs(checked.x - requestedX) > 1e-9 || Math.abs(checked.y - requestedY) > 1e-9) {
      throw new RangeError(`Cannot shift the selected group without moving ${instance.name} off-grid or outside the top cell`);
    }
    if (master.kind === 'pad') {
      const bounds = getPhysicalBounds({ ...instance, x: checked.x, y: checked.y, width: master.width, height: master.height });
      const touchesPerimeter = Math.abs(bounds.left + state.topWidth / 2) <= 1e-9
        || Math.abs(bounds.right - state.topWidth / 2) <= 1e-9
        || Math.abs(bounds.bottom + state.topHeight / 2) <= 1e-9
        || Math.abs(bounds.top - state.topHeight / 2) <= 1e-9;
      if (!touchesPerimeter) throw new RangeError(`Cannot shift the group because pad ${instance.name} would leave the top-cell perimeter`);
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
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize },
  );
  const patch = alignmentGroupPositionPatch(state, sourceIds, sourceId, position.x, position.y);
  const offsetLabel = displaySpacing === undefined
    ? (offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset} um`)
    : (displaySpacing === 0 ? '' : ` gap ${displaySpacing} um`);
  return commitProjectPatch(
    state,
    `Align ${sourceIds.length > 1 ? `${sourceIds.length} objects via ` : ''}${source.name}.${sourceEdge} to ${target.name}.${targetEdge}${offsetLabel}`,
    patch,
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
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize },
  );
  const patch = alignmentGroupPositionPatch(state, sourceIds, sourceId, position.x, position.y);
  const offsetLabel = displaySpacing === undefined
    ? (offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset} um`)
    : (displaySpacing === 0 ? '' : ` gap ${displaySpacing} um`);
  return commitProjectPatch(
    state,
    `Align ${sourceIds.length > 1 ? `${sourceIds.length} objects via ` : ''}${source.name}.${sourceEdge} to ${referenceLabel}${offsetLabel}`,
    patch,
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
  
  masterCells: {},
  instances: [],
  rulers: [],
  pixelArray: null,
  pendingPixelArraySize: null,
  selectedInstanceId: null,
  selectedInstanceIds: [],
  pixelArraySelected: false,
  showCreateModal: false,
  showInstantiateModal: false,
  leftSidebarPinned: false,
  rightSidebarPinned: false,
  
  placementMasterId: null,
  placementOrientation: 'R0',
  pendingManualPadGroup: null,
  history: { past: [], future: [] },
  edgeAlignmentSession: null,
  lastAlignmentSpacing: readStoredAlignmentSpacing(),
  orthogonalRuler: false,
  showAutoDim: false,

  setGridSize: (size) => set((state) => {
    if (!Number.isFinite(size) || size <= 0) return state;
    const instances = state.instances.map(instance => {
      const master = state.masterCells[instance.cellId];
      if (!master) return instance;
      const position = master.kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, state.topWidth, state.topHeight, size, instance.orientation)
        : clampInstancePosition(
            instance.x,
            instance.y,
            instance.orientation,
            master.width,
            master.height,
            state.topWidth,
            state.topHeight,
            size,
          );
      return { ...instance, ...position };
    });
    const pixelArray = state.pixelArray
      ? normalizePixelArray(state.pixelArray, state.topWidth, state.topHeight, size)
      : null;
    return commitProjectPatch(state, 'Change grid', { gridSize: size, instances, pixelArray });
  }),
  setAppMode: (mode) => set({
    appMode: mode,
    edgeAlignmentSession: null,
    ...(mode === 'pixel-array' ? {} : { pendingPixelArraySize: null }),
    ...(mode === 'place' ? {} : { pendingManualPadGroup: null }),
  }),
  setTopDimensions: (w, h) => set((state) => {
    const instances = state.instances.map(instance => {
      const master = state.masterCells[instance.cellId];
      if (!master) return instance;
      const position = master.kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, w, h, state.gridSize, instance.orientation)
        : clampInstancePosition(instance.x, instance.y, instance.orientation, master.width, master.height, w, h, state.gridSize);
      return { ...instance, ...position };
    });
    const pixelArray = state.pixelArray
      ? normalizePixelArray(state.pixelArray, w, h, state.gridSize)
      : null;
    return commitProjectPatch(state, 'Resize top cell', { topWidth: w, topHeight: h, instances, pixelArray });
  }),
  setTopNames: (lib, cell) => set((state) => {
    const topLibName = lib.trim();
    const topCellName = cell.trim();
    if (!topLibName || !topCellName) throw new Error('Top library and cell names are required');
    const masterCells = Object.fromEntries(Object.entries(state.masterCells).map(([id, master]) => [
      id,
      { ...master, libName: topLibName },
    ]));
    return commitProjectPatch(state, 'Rename top cell library and hierarchy', { topLibName, topCellName, masterCells });
  }),
  setShowCreateModal: (show) => set({ showCreateModal: show }),
  setShowInstantiateModal: (show) => set({ showInstantiateModal: show }),
  setLeftSidebarPinned: (pinned) => set({ leftSidebarPinned: pinned }),
  setRightSidebarPinned: (pinned) => set({ rightSidebarPinned: pinned }),
  setPlacement: (masterId, orientation = 'R0') => set({
    placementMasterId: masterId,
    placementOrientation: orientation,
    appMode: masterId ? 'place' : 'select',
    pendingPixelArraySize: null,
    pendingManualPadGroup: null,
    edgeAlignmentSession: null,
  }),
  
  addMasterCell: (_libName, cellName, w, h, color, opacity = 0.5, outlineStyle = 'solid') => set((state) => {
    const existing = Object.values(state.masterCells).find(c => c.cellName === cellName);
    if (existing) return state; 
    const appearance = normalizeCellAppearance(opacity, outlineStyle);
    const id = uuidv4();
    return commitProjectPatch(state, `Create ${cellName}`, {
      masterCells: {
        ...state.masterCells,
        [id]: { id, libName: state.topLibName, cellName, width: w, height: h, color, ...appearance }
      },
    });
  }),

  updateMasterCell: (id, _libName, cellName, w, h, color, opacity = 0.5, outlineStyle = 'solid') => set((state) => {
    if (!state.masterCells[id]) return state;
    if (Object.values(state.masterCells).some(master => master.id !== id && master.cellName === cellName)) {
      throw new Error(`Cell name ${cellName} is already used in ${state.topLibName}`);
    }
    const appearance = normalizeCellAppearance(opacity, outlineStyle);
    const masterCells = {
      ...state.masterCells,
      [id]: { ...state.masterCells[id], libName: state.topLibName, cellName, width: w, height: h, color, ...appearance },
    };
    const instances = state.instances.map(instance => {
      if (instance.cellId !== id) return instance;
      const position = masterCells[id].kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, w, h, state.topWidth, state.topHeight, state.gridSize, instance.orientation)
        : clampInstancePosition(instance.x, instance.y, instance.orientation, w, h, state.topWidth, state.topHeight, state.gridSize);
      return { ...instance, ...position };
    });
    return commitProjectPatch(state, `Edit ${cellName}`, { masterCells, instances });
  }),

  deleteMasterCell: (id) => set((state) => {
    if (!state.masterCells[id]) return state;
    const newMasterCells = { ...state.masterCells };
    delete newMasterCells[id];
    // Also remove instances of this cell
    const newInstances = state.instances.filter(inst => inst.cellId !== id);
    return {
      ...commitProjectPatch(state, `Delete ${state.masterCells[id].cellName}`, {
        masterCells: newMasterCells,
        instances: newInstances,
      }),
      ...selectionAfterInstancesChange(state, newInstances),
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, newInstances),
    };
  }),

  placeInstance: (cellId, targetX = 0, targetY = 0, orientation = 'R0') => set((state) => {
    const master = state.masterCells[cellId];
    if (!master) return state;

    const effectiveOrientation = orientation;
    const clamped = master.kind === 'pad'
      ? snapPadToNearestEdge(targetX, targetY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, effectiveOrientation)
      : clampInstancePosition(targetX, targetY, effectiveOrientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
    
    const newInst: Instance = {
      id: uuidv4(),
      cellId,
      name: getNextInstanceName(state.instances),
      x: clamped.x,
      y: clamped.y,
      orientation: effectiveOrientation,
    };
    const instances = [...state.instances, newInst];
    return {
      ...commitProjectPatch(state, `Place ${newInst.name}`, { instances }),
      selectedInstanceId: master.kind === 'pad' ? null : newInst.id,
      selectedInstanceIds: master.kind === 'pad' ? [] : [newInst.id],
      pixelArraySelected: false,
      // Cadence keeps placement mode active so you can place multiple. We won't change appMode.
    };
  }),

  createPadRow: (config) => set((state) => {
    const orientation = config.orientation ?? 'R0';
    const libName = state.topLibName;
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
    if (libName === state.topLibName && cellName === state.topCellName) {
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
    );

    const positions = computePadGroupPositions({
      width: config.width, height: config.height, count: config.count, pitch: config.pitch,
      side: config.side, centerAlong: config.offset, orientation,
      topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize,
    });

    const existingMaster = Object.values(state.masterCells).find(cell => (
      cell.libName === libName && cell.cellName === cellName
    ));
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
    const orientation = config.orientation ?? 'R0';
    const count = config.count ?? 1;
    const pitch = config.pitch ?? Math.max(config.width, config.height);
    const libName = state.topLibName;
    const cellName = config.cellName.trim();
    if (!libName || !cellName) throw new Error('Pad library and cell names are required');
    if (!Number.isFinite(config.width) || !Number.isFinite(config.height) || config.width <= 0 || config.height <= 0) {
      throw new RangeError('Pad width and height must be positive finite numbers');
    }
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new RangeError('Pad count must be an integer from 1 to 1000');
    }
    if (!Number.isFinite(pitch) || pitch <= 0) throw new RangeError('Pad pitch must be a positive finite number');
    if (libName === state.topLibName && cellName === state.topCellName) {
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
    );
    const existingMaster = Object.values(state.masterCells).find(cell => (
      cell.libName === libName && cell.cellName === cellName
    ));
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
      placementOrientation: orientation,
      pendingManualPadGroup: { masterId: master.id, count, pitch, orientation },
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
    const snapped = snapPadToNearestEdge(x, y, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, pending.orientation);
    const horizontal = snapped.side === 'top' || snapped.side === 'bottom';
    const centerAlong = horizontal ? x : y;
    const positions = computePadGroupPositions({
      width: master.width, height: master.height, count: pending.count, pitch: pending.pitch,
      side: snapped.side, centerAlong, orientation: pending.orientation,
      topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize,
    });
    const instances = [...state.instances];
    for (const position of positions) {
      instances.push({
        id: uuidv4(), cellId: master.id, name: getNextInstanceName(instances),
        ...position, orientation: pending.orientation,
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
    const position = clampInstancePosition(
      centerX - size.width / 2,
      centerY - size.height / 2,
      'R0',
      size.width,
      size.height,
      state.topWidth,
      state.topHeight,
      state.gridSize,
    );
    const pixelArray: PixelArray = { ...size, ...position, visible: true };
    return {
      ...commitProjectPatch(state, state.pixelArray ? 'Move pixel array' : 'Place pixel array', { pixelArray }),
      pendingPixelArraySize: null,
      appMode: 'select',
      pixelArraySelected: true,
    };
  }),

  updatePixelArrayPosition: (x, y) => set((state) => {
    if (!state.pixelArray) return state;
    const pixelArray = normalizePixelArray(
      { ...state.pixelArray, x, y },
      state.topWidth,
      state.topHeight,
      state.gridSize,
    );
    return commitProjectPatch(state, 'Move pixel array', { pixelArray });
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
    const instances = state.instances.map(inst => {
      if (inst.id === instanceId) {
        const master = state.masterCells[inst.cellId];
        if (master.kind === 'pad') {
          const position = snapPadToNearestEdge(
            x,
            y,
            master.width,
            master.height,
            state.topWidth,
            state.topHeight,
            state.gridSize,
            inst.orientation,
          );
          return { ...inst, ...position };
        }
        const clamped = clampInstancePosition(x, y, inst.orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
        return { ...inst, x: clamped.x, y: clamped.y };
      }
      return inst;
    });
    return commitProjectPatch(state, `Move ${state.instances.find(instance => instance.id === instanceId)?.name ?? 'instance'}`, { instances });
  }),
  
  updateInstanceOrientation: (instanceId, orientation) => set((state) => {
    const instances = state.instances.map(inst => {
      if (inst.id === instanceId) {
        const master = state.masterCells[inst.cellId];
        const currentBounds = getPhysicalBounds({ ...inst, width: master.width, height: master.height });
        const nextLocalBounds = getPhysicalBounds({ ...inst, x: 0, y: 0, orientation, width: master.width, height: master.height });
        const centeredX = currentBounds.centerX - nextLocalBounds.centerX;
        const centeredY = currentBounds.centerY - nextLocalBounds.centerY;
        const clamped = master.kind === 'pad'
          ? snapPadToNearestEdge(centeredX, centeredY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize, orientation)
          : clampInstancePosition(centeredX, centeredY, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
        return { ...inst, orientation, x: clamped.x, y: clamped.y };
      }
      return inst;
    });
    return commitProjectPatch(state, `Orient ${state.instances.find(instance => instance.id === instanceId)?.name ?? 'instance'}`, { instances });
  }),

  setSelectedInstance: (id, additive = false) => set((state) => {
    if (!id) return { selectedInstanceId: null, selectedInstanceIds: [], pixelArraySelected: false };
    if (!additive) {
      if (state.selectedInstanceIds.length > 1 && state.selectedInstanceIds.includes(id)) {
        return { selectedInstanceId: id, pixelArraySelected: false };
      }
      return { selectedInstanceId: id, selectedInstanceIds: [id], pixelArraySelected: false };
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
      pixelArraySelected: false,
    };
  }),

  setPixelArraySelected: (selected) => set((state) => ({
    pixelArraySelected: Boolean(selected && state.pixelArray?.visible),
    ...(selected ? { selectedInstanceId: null, selectedInstanceIds: [] } : {}),
  })),

  selectAllInstances: () => set((state) => ({
    selectedInstanceIds: state.instances.map(instance => instance.id),
    selectedInstanceId: state.instances.at(-1)?.id ?? null,
    pixelArraySelected: false,
  })),

  deleteInstance: (id) => set((state) => {
    const instances = state.instances.filter(inst => inst.id !== id);
    return {
      ...commitProjectPatch(state, `Delete ${state.instances.find(instance => instance.id === id)?.name ?? 'instance'}`, { instances }),
      ...selectionAfterInstancesChange(state, instances),
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, instances),
    };
  }),

  deleteSelectedInstances: () => set((state) => {
    if (state.selectedInstanceIds.length === 0) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const instances = state.instances.filter(instance => !selectedIds.has(instance.id));
    return {
      ...commitProjectPatch(state, `Delete ${state.selectedInstanceIds.length} block${state.selectedInstanceIds.length === 1 ? '' : 's'}`, { instances }),
      selectedInstanceId: null,
      selectedInstanceIds: [],
      edgeAlignmentSession: edgeAlignmentAfterInstancesChange(state, instances),
    };
  }),

  addRuler: (startX, startY, endX, endY) => set((state) => commitProjectPatch(state, 'Add ruler', {
    rulers: [...state.rulers, { id: uuidv4(), startX, startY, endX, endY }],
  })),
  deleteRuler: (id) => set((state) => commitProjectPatch(state, 'Delete ruler', {
    rulers: state.rulers.filter(r => r.id !== id),
  })),
  clearRulers: () => set((state) => commitProjectPatch(state, 'Clear rulers', { rulers: [] })),
  
  undo: () => set((state) => {
    const result = undoHistory(state.history, getProjectSnapshot(state));
    if (!result) return state;
    return {
      ...result.snapshot,
      history: result.history,
      ...selectionAfterInstancesChange(state, result.snapshot.instances),
      edgeAlignmentSession: null,
      pendingPixelArraySize: null,
      appMode: 'select',
      pixelArraySelected: false,
    };
  }),

  redo: () => set((state) => {
    const result = redoHistory(state.history, getProjectSnapshot(state));
    if (!result) return state;
    return {
      ...result.snapshot,
      history: result.history,
      ...selectionAfterInstancesChange(state, result.snapshot.instances),
      edgeAlignmentSession: null,
      pendingPixelArraySize: null,
      appMode: 'select',
      pixelArraySelected: false,
    };
  }),

  alignSelectedInstances: (operation) => set((state) => {
    if (state.selectedInstanceIds.length < 2) return state;
    const selectedIds = new Set(state.selectedInstanceIds);
    const selected = state.instances
      .filter(instance => selectedIds.has(instance.id))
      .map(instance => {
        const master = state.masterCells[instance.cellId];
        return { ...instance, width: master.width, height: master.height };
      });
    const positions = alignInstances(selected, operation, {
      topWidth: state.topWidth,
      topHeight: state.topHeight,
      gridSize: state.gridSize,
      anchorId: state.selectedInstanceId ?? undefined,
    });
    const positionById = new Map(positions.map(position => [position.id, position]));
    const instances = state.instances.map(instance => {
      const position = positionById.get(instance.id);
      return position ? { ...instance, x: position.x, y: position.y } : instance;
    });
    return commitProjectPatch(state, `Align ${operation.replace('-', ' ')}`, { instances });
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
    const coordinate = targetEdge === 'left' ? -state.topWidth / 2
      : targetEdge === 'right' ? state.topWidth / 2
      : targetEdge === 'bottom' ? -state.topHeight / 2
      : state.topHeight / 2;
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
    const selected = state.instances
      .filter(instance => selectedIds.has(instance.id))
      .map(instance => {
        const master = state.masterCells[instance.cellId];
        return { ...instance, width: master.width, height: master.height };
      });
    const positions = distributeInstances(selected, axis, {
      topWidth: state.topWidth,
      topHeight: state.topHeight,
      gridSize: state.gridSize,
    });
    const positionById = new Map(positions.map(position => [position.id, position]));
    const instances = state.instances.map(instance => {
      const position = positionById.get(instance.id);
      return position ? { ...instance, x: position.x, y: position.y } : instance;
    });
    return commitProjectPatch(state, `Distribute ${axis}`, { instances });
  }),
  
  toggleOrthogonalRuler: () => set((state) => ({ orthogonalRuler: !state.orthogonalRuler })),
  toggleAutoDim: () => set((state) => ({ showAutoDim: !state.showAutoDim })),

  loadProject: (data) => set((state) => {
    const gridSize = data.gridSize ?? state.gridSize;
    const topWidth = data.topWidth ?? state.topWidth;
    const topHeight = data.topHeight ?? state.topHeight;
    const masterCells = Object.fromEntries(Object.entries(data.masterCells ?? {}).map(([id, master]) => [
      id,
      { ...master, libName: data.topLibName ?? state.topLibName },
    ]));
    const instances = (data.instances ?? []).map(instance => {
      const master = masterCells[instance.cellId];
      if (!master) return instance;
      const position = master.kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, topWidth, topHeight, gridSize, instance.orientation)
        : clampInstancePosition(
            instance.x,
            instance.y,
            instance.orientation,
            master.width,
            master.height,
            topWidth,
            topHeight,
            gridSize,
          );
      return { ...instance, ...position };
    });
    const pixelArray = data.pixelArray
      ? normalizePixelArray(data.pixelArray, topWidth, topHeight, gridSize)
      : null;
    return {
      ...state,
      gridSize,
      topWidth,
      topHeight,
      topLibName: data.topLibName ?? state.topLibName,
      topCellName: data.topCellName ?? state.topCellName,
      masterCells,
      instances,
      rulers: data.rulers ?? [],
      pixelArray,
      pendingPixelArraySize: null,
      pendingManualPadGroup: null,
      history: { past: [], future: [] },
      edgeAlignmentSession: null,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      pixelArraySelected: false,
      appMode: 'select',
    };
  }),
}));
