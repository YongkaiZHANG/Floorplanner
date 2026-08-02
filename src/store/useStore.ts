import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { alignInstanceToCoordinate, alignInstanceToTarget, alignInstances, distributeInstances, getAlignmentEdgeAxis, getPhysicalBounds } from '../utils/alignment.ts';
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
  /** Row-center displacement from the top-cell center: X on top/bottom, Y on left/right. */
  offset: number;
};

export type EdgeAlignmentSession = {
  sourceId: string;
  sourceEdge: AlignmentEdge | null;
  targetId: string | null;
  targetEdge: AlignmentEdge | null;
  /** Kept as text so intermediate decimal input remains editable. */
  offset: string;
};

export type ProjectState = {
  gridSize: number;
  appMode: 'select' | 'measure' | 'place';
  
  topWidth: number;
  topHeight: number;
  topLibName: string;
  topCellName: string;
  
  masterCells: Record<string, Cell>;
  instances: Instance[];
  rulers: Ruler[];
  
  selectedInstanceId: string | null;
  selectedInstanceIds: string[];
  showCreateModal: boolean;
  showInstantiateModal: boolean;
  leftSidebarPinned: boolean;
  rightSidebarPinned: boolean;
  orthogonalRuler: boolean;
  showAutoDim: boolean;
  
  placementMasterId: string | null;
  placementOrientation: string;
  history: ProjectHistory;
  edgeAlignmentSession: EdgeAlignmentSession | null;
  lastAlignmentSpacing: string;
  
  setGridSize: (size: number) => void;
  setAppMode: (mode: 'select' | 'measure' | 'place') => void;
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
) => {
  const inside = clampInstancePosition(x, y, 'R0', width, height, topWidth, topHeight, gridSize);
  const edgeCoordinates = {
    left: -topWidth / 2,
    right: topWidth / 2 - width,
    bottom: -topHeight / 2,
    top: topHeight / 2 - height,
  };
  const onGrid = (value: number) => Math.abs(snapToGrid(value, gridSize) - value) <= 1e-9;
  const candidates = [
    onGrid(edgeCoordinates.left) ? { x: edgeCoordinates.left, y: inside.y, distance: Math.abs(x - edgeCoordinates.left) } : null,
    onGrid(edgeCoordinates.right) ? { x: edgeCoordinates.right, y: inside.y, distance: Math.abs(x - edgeCoordinates.right) } : null,
    onGrid(edgeCoordinates.bottom) ? { x: inside.x, y: edgeCoordinates.bottom, distance: Math.abs(y - edgeCoordinates.bottom) } : null,
    onGrid(edgeCoordinates.top) ? { x: inside.x, y: edgeCoordinates.top, distance: Math.abs(y - edgeCoordinates.top) } : null,
  ].filter((candidate): candidate is { x: number; y: number; distance: number } => candidate !== null);
  const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (!closest) throw new RangeError('No top-cell edge is compatible with the active placement grid');
  return { x: snapToGrid(closest.x, gridSize), y: snapToGrid(closest.y, gridSize) };
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
  return existingIds.has(session.sourceId) && (!session.targetId || existingIds.has(session.targetId))
    ? session
    : null;
};

const edgeAlignmentPatch = (
  state: ProjectState,
  sourceId: string,
  targetId: string,
  sourceEdge: AlignmentEdge,
  targetEdge: AlignmentEdge,
  offset: number,
  displaySpacing?: number,
) => {
  if (sourceId === targetId) throw new Error('Source and target must be different instances');
  const source = state.instances.find(instance => instance.id === sourceId);
  const target = state.instances.find(instance => instance.id === targetId);
  if (!source || !target) throw new Error('The source or target instance no longer exists');
  const sourceMaster = state.masterCells[source.cellId];
  const targetMaster = state.masterCells[target.cellId];
  if (!sourceMaster || !targetMaster) throw new Error('The source or target master cell no longer exists');

  const position = alignInstanceToTarget(
    { ...source, width: sourceMaster.width, height: sourceMaster.height },
    { ...target, width: targetMaster.width, height: targetMaster.height },
    sourceEdge,
    targetEdge,
    offset,
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize },
  );
  const instances = state.instances.map(instance => (
    instance.id === sourceId ? { ...instance, x: position.x, y: position.y } : instance
  ));
  const offsetLabel = displaySpacing === undefined
    ? (offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset} um`)
    : (displaySpacing === 0 ? '' : ` gap ${displaySpacing} um`);
  return commitProjectPatch(
    state,
    `Align ${source.name}.${sourceEdge} to ${target.name}.${targetEdge}${offsetLabel}`,
    { instances },
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
) => {
  const source = state.instances.find(instance => instance.id === sourceId);
  if (!source) throw new Error('The source instance no longer exists');
  const sourceMaster = state.masterCells[source.cellId];
  if (!sourceMaster) throw new Error('The source master cell no longer exists');
  const position = alignInstanceToCoordinate(
    { ...source, width: sourceMaster.width, height: sourceMaster.height },
    sourceEdge,
    targetCoordinate,
    offset,
    { topWidth: state.topWidth, topHeight: state.topHeight, gridSize: state.gridSize },
  );
  const instances = state.instances.map(instance => (
    instance.id === sourceId ? { ...instance, x: position.x, y: position.y } : instance
  ));
  const offsetLabel = displaySpacing === undefined
    ? (offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset} um`)
    : (displaySpacing === 0 ? '' : ` gap ${displaySpacing} um`);
  return commitProjectPatch(
    state,
    `Align ${source.name}.${sourceEdge} to ${referenceLabel}${offsetLabel}`,
    { instances },
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

const outwardDirectionForEdge = (edge: AlignmentEdge) => {
  if (edge === 'right' || edge === 'top') return 1;
  if (edge === 'left' || edge === 'bottom') return -1;
  return 0;
};

const sourceEdgeOutsideTarget = (targetEdge: AlignmentEdge): AlignmentEdge | null => {
  if (targetEdge === 'right') return 'left';
  if (targetEdge === 'left') return 'right';
  if (targetEdge === 'top') return 'bottom';
  if (targetEdge === 'bottom') return 'top';
  return null;
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
  selectedInstanceId: null,
  selectedInstanceIds: [],
  showCreateModal: false,
  showInstantiateModal: false,
  leftSidebarPinned: false,
  rightSidebarPinned: false,
  
  placementMasterId: null,
  placementOrientation: 'R0',
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
        ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, state.topWidth, state.topHeight, size)
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
    return commitProjectPatch(state, 'Change grid', { gridSize: size, instances });
  }),
  setAppMode: (mode) => set({ appMode: mode, edgeAlignmentSession: null }),
  setTopDimensions: (w, h) => set((state) => {
    const instances = state.instances.map(instance => {
      const master = state.masterCells[instance.cellId];
      if (!master) return instance;
      const position = master.kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, w, h, state.gridSize)
        : clampInstancePosition(instance.x, instance.y, instance.orientation, master.width, master.height, w, h, state.gridSize);
      return { ...instance, ...position };
    });
    return commitProjectPatch(state, 'Resize top cell', { topWidth: w, topHeight: h, instances });
  }),
  setTopNames: (lib, cell) => set((state) => commitProjectPatch(state, 'Rename top cell', { topLibName: lib, topCellName: cell })),
  setShowCreateModal: (show) => set({ showCreateModal: show }),
  setShowInstantiateModal: (show) => set({ showInstantiateModal: show }),
  setLeftSidebarPinned: (pinned) => set({ leftSidebarPinned: pinned }),
  setRightSidebarPinned: (pinned) => set({ rightSidebarPinned: pinned }),
  setPlacement: (masterId, orientation = 'R0') => set({ placementMasterId: masterId, placementOrientation: orientation, appMode: masterId ? 'place' : 'select', edgeAlignmentSession: null }),
  
  addMasterCell: (libName, cellName, w, h, color, opacity = 0.5, outlineStyle = 'solid') => set((state) => {
    const existing = Object.values(state.masterCells).find(c => c.cellName === cellName && c.libName === libName);
    if (existing) return state; 
    const appearance = normalizeCellAppearance(opacity, outlineStyle);
    const id = uuidv4();
    return commitProjectPatch(state, `Create ${cellName}`, {
      masterCells: {
        ...state.masterCells,
        [id]: { id, libName, cellName, width: w, height: h, color, ...appearance }
      },
    });
  }),

  updateMasterCell: (id, libName, cellName, w, h, color, opacity = 0.5, outlineStyle = 'solid') => set((state) => {
    if (!state.masterCells[id]) return state;
    const appearance = normalizeCellAppearance(opacity, outlineStyle);
    const masterCells = {
      ...state.masterCells,
      [id]: { ...state.masterCells[id], libName, cellName, width: w, height: h, color, ...appearance },
    };
    const instances = state.instances.map(instance => {
      if (instance.cellId !== id) return instance;
      const position = masterCells[id].kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, w, h, state.topWidth, state.topHeight, state.gridSize)
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

    const effectiveOrientation = master.kind === 'pad' ? 'R0' : orientation;
    const clamped = master.kind === 'pad'
      ? snapPadToNearestEdge(targetX, targetY, master.width, master.height, state.topWidth, state.topHeight, state.gridSize)
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
      selectedInstanceId: newInst.id,
      selectedInstanceIds: [newInst.id],
      // Cadence keeps placement mode active so you can place multiple. We won't change appMode.
    };
  }),

  createPadRow: (config) => set((state) => {
    const libName = config.libName.trim();
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

    const horizontal = config.side === 'top' || config.side === 'bottom';
    const padAlongRow = horizontal ? config.width : config.height;
    if (config.pitch + 1e-9 < padAlongRow) {
      throw new RangeError(`Pad pitch must be at least the pad ${horizontal ? 'width' : 'height'} to avoid overlap`);
    }

    const rowSpan = (config.count - 1) * config.pitch + padAlongRow;
    const availableSpan = horizontal ? state.topWidth : state.topHeight;
    if (rowSpan > availableSpan + 1e-9) {
      throw new RangeError(`Pad row span ${rowSpan} um exceeds the ${availableSpan} um top-cell edge`);
    }

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
    const firstCenter = config.offset - ((config.count - 1) * config.pitch) / 2;

    for (let index = 0; index < config.count; index += 1) {
      const along = firstCenter + index * config.pitch;
      const targetX = horizontal
        ? along - config.width / 2
        : config.side === 'left' ? -state.topWidth / 2 : state.topWidth / 2 - config.width;
      const targetY = horizontal
        ? config.side === 'bottom' ? -state.topHeight / 2 : state.topHeight / 2 - config.height
        : along - config.height / 2;
      const position = clampInstancePosition(
        targetX,
        targetY,
        'R0',
        config.width,
        config.height,
        state.topWidth,
        state.topHeight,
        state.gridSize,
      );
      if (Math.abs(position.x - targetX) > 1e-9 || Math.abs(position.y - targetY) > 1e-9) {
        throw new RangeError('Pad row position must fit inside the top cell and land exactly on the placement grid');
      }
      const instance: Instance = {
        id: uuidv4(),
        cellId: master.id,
        name: getNextInstanceName(instances),
        x: position.x,
        y: position.y,
        orientation: 'R0',
      };
      instances.push(instance);
    }

    return {
      ...commitProjectPatch(state, `Place ${config.count} ${cellName} pads on ${config.side}`, { masterCells, instances }),
      selectedInstanceId: null,
      selectedInstanceIds: [],
      appMode: 'select',
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
          );
          return { ...inst, ...position, orientation: 'R0' };
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
        if (master.kind === 'pad') return inst;
        const currentBounds = getPhysicalBounds({ ...inst, width: master.width, height: master.height });
        const nextLocalBounds = getPhysicalBounds({ ...inst, x: 0, y: 0, orientation, width: master.width, height: master.height });
        const centeredX = currentBounds.centerX - nextLocalBounds.centerX;
        const centeredY = currentBounds.centerY - nextLocalBounds.centerY;
        const clamped = clampInstancePosition(centeredX, centeredY, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
        return { ...inst, orientation, x: clamped.x, y: clamped.y };
      }
      return inst;
    });
    return commitProjectPatch(state, `Orient ${state.instances.find(instance => instance.id === instanceId)?.name ?? 'instance'}`, { instances });
  }),

  setSelectedInstance: (id, additive = false) => set((state) => {
    if (!id) return { selectedInstanceId: null, selectedInstanceIds: [] };
    if (!additive) {
      if (state.selectedInstanceIds.length > 1 && state.selectedInstanceIds.includes(id)) {
        return { selectedInstanceId: id };
      }
      return { selectedInstanceId: id, selectedInstanceIds: [id] };
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
    };
  }),

  selectAllInstances: () => set((state) => ({
    selectedInstanceIds: state.instances.map(instance => instance.id),
    selectedInstanceId: state.instances.at(-1)?.id ?? null,
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
    if (!state.instances.some(instance => instance.id === sourceId)) return state;
    return {
      edgeAlignmentSession: {
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
    if (!session || !state.instances.some(instance => instance.id === instanceId)) return state;
    if (instanceId === session.sourceId) {
      return { edgeAlignmentSession: { ...session, sourceEdge: edge } };
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
    const sourceEdge = sourceEdgeOutsideTarget(targetEdge) ?? session.sourceEdge;
    let direction = outwardDirectionForEdge(targetEdge);
    if (direction === 0) {
      const source = state.instances.find(instance => instance.id === session.sourceId);
      const target = state.instances.find(instance => instance.id === targetId);
      if (!source || !target) throw new Error('The source or target instance no longer exists');
      const sourceMaster = state.masterCells[source.cellId];
      const targetMaster = state.masterCells[target.cellId];
      const sourceBounds = getPhysicalBounds({ ...source, width: sourceMaster.width, height: sourceMaster.height });
      const targetBounds = getPhysicalBounds({ ...target, width: targetMaster.width, height: targetMaster.height });
      direction = getAlignmentEdgeAxis(session.sourceEdge) === 'horizontal'
        ? (sourceBounds.centerX < targetBounds.centerX ? -1 : 1)
        : (sourceBounds.centerY < targetBounds.centerY ? -1 : 1);
    }
    return {
      ...edgeAlignmentPatch(
        state,
        session.sourceId,
        targetId,
        sourceEdge,
        targetEdge,
        spacing * direction,
        spacing,
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
    const inwardDirection = -outwardDirectionForEdge(targetEdge);
    return {
      ...edgeAlignmentCoordinatePatch(
        state,
        session.sourceId,
        targetEdge,
        coordinate,
        spacing * inwardDirection,
        `top.${targetEdge}`,
        spacing,
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
    const source = state.instances.find(instance => instance.id === session.sourceId);
    if (!source) throw new Error('The source instance no longer exists');
    const master = state.masterCells[source.cellId];
    const bounds = getPhysicalBounds({ ...source, width: master.width, height: master.height });
    const sourceCenter = axis === 'horizontal' ? bounds.centerX : bounds.centerY;
    const spacing = parseEdgeAlignmentSpacing(session);
    const direction = sourceCenter < coordinate ? -1 : 1;
    const sourceEdge: AlignmentEdge = axis === 'horizontal'
      ? (direction < 0 ? 'right' : 'left')
      : (direction < 0 ? 'top' : 'bottom');
    return {
      ...edgeAlignmentCoordinatePatch(
        state,
        session.sourceId,
        sourceEdge,
        coordinate,
        spacing * direction,
        'ruler line',
        spacing,
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
    const sourceEdge = sourceEdgeOutsideTarget(session.targetEdge) ?? session.sourceEdge;
    const direction = outwardDirectionForEdge(session.targetEdge);
    return {
      ...edgeAlignmentPatch(
        state,
        session.sourceId,
        session.targetId,
        sourceEdge,
        session.targetEdge,
        spacing * direction,
        spacing,
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
    const masterCells = data.masterCells ?? {};
    const instances = (data.instances ?? []).map(instance => {
      const master = masterCells[instance.cellId];
      if (!master) return instance;
      const position = master.kind === 'pad'
        ? snapPadToNearestEdge(instance.x, instance.y, master.width, master.height, topWidth, topHeight, gridSize)
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
      history: { past: [], future: [] },
      edgeAlignmentSession: null,
      selectedInstanceId: null,
      selectedInstanceIds: [],
      appMode: 'select',
    };
  }),
}));
