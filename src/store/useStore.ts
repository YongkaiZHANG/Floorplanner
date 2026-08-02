import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { alignInstances, distributeInstances, getPhysicalBounds } from '../utils/alignment.ts';
import type { AlignmentOperation, DistributionAxis } from '../utils/alignment.ts';
import type { ProjectSnapshot } from './projectDocument.ts';
import { recordHistory, redoHistory, undoHistory } from './projectHistory.ts';
import type { ProjectHistory } from './projectHistory.ts';

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
};

export type Ruler = {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
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
  
  setGridSize: (size: number) => void;
  setAppMode: (mode: 'select' | 'measure' | 'place') => void;
  setTopDimensions: (w: number, h: number) => void;
  setTopNames: (lib: string, cell: string) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowInstantiateModal: (show: boolean) => void;
  setLeftSidebarPinned: (pinned: boolean) => void;
  setRightSidebarPinned: (pinned: boolean) => void;
  setPlacement: (masterId: string | null, orientation?: string) => void;
  
  addMasterCell: (libName: string, cellName: string, w: number, h: number, color: string) => void;
  updateMasterCell: (id: string, libName: string, cellName: string, w: number, h: number, color: string) => void;
  deleteMasterCell: (id: string) => void;
  placeInstance: (cellId: string, x?: number, y?: number, orientation?: string) => void;
  
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

  let clampedX = Math.max(minAllowedX, Math.min(x, maxAllowedX));
  let clampedY = Math.max(minAllowedY, Math.min(y, maxAllowedY));

  clampedX = Math.round(clampedX / gridSize) * gridSize;
  clampedY = Math.round(clampedY / gridSize) * gridSize;

  return { x: clampedX, y: clampedY };
};

const getNextInstanceName = (instances: Instance[]) => {
  const usedNames = new Set(instances.map(instance => instance.name));
  let index = 0;
  while (usedNames.has(`I${index}`)) index += 1;
  return `I${index}`;
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
  orthogonalRuler: false,
  showAutoDim: false,

  setGridSize: (size) => set((state) => commitProjectPatch(state, 'Change grid', { gridSize: size })),
  setAppMode: (mode) => set({ appMode: mode }),
  setTopDimensions: (w, h) => set((state) => {
    const instances = state.instances.map(instance => {
      const master = state.masterCells[instance.cellId];
      if (!master) return instance;
      const position = clampInstancePosition(instance.x, instance.y, instance.orientation, master.width, master.height, w, h, state.gridSize);
      return { ...instance, ...position };
    });
    return commitProjectPatch(state, 'Resize top cell', { topWidth: w, topHeight: h, instances });
  }),
  setTopNames: (lib, cell) => set((state) => commitProjectPatch(state, 'Rename top cell', { topLibName: lib, topCellName: cell })),
  setShowCreateModal: (show) => set({ showCreateModal: show }),
  setShowInstantiateModal: (show) => set({ showInstantiateModal: show }),
  setLeftSidebarPinned: (pinned) => set({ leftSidebarPinned: pinned }),
  setRightSidebarPinned: (pinned) => set({ rightSidebarPinned: pinned }),
  setPlacement: (masterId, orientation = 'R0') => set({ placementMasterId: masterId, placementOrientation: orientation, appMode: masterId ? 'place' : 'select' }),
  
  addMasterCell: (libName, cellName, w, h, color) => set((state) => {
    const existing = Object.values(state.masterCells).find(c => c.cellName === cellName && c.libName === libName);
    if (existing) return state; 
    
    const id = uuidv4();
    return commitProjectPatch(state, `Create ${cellName}`, {
      masterCells: {
        ...state.masterCells,
        [id]: { id, libName, cellName, width: w, height: h, color }
      },
    });
  }),

  updateMasterCell: (id, libName, cellName, w, h, color) => set((state) => {
    if (!state.masterCells[id]) return state;
    const masterCells = {
      ...state.masterCells,
      [id]: { ...state.masterCells[id], libName, cellName, width: w, height: h, color },
    };
    const instances = state.instances.map(instance => {
      if (instance.cellId !== id) return instance;
      const position = clampInstancePosition(instance.x, instance.y, instance.orientation, w, h, state.topWidth, state.topHeight, state.gridSize);
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
    };
  }),

  placeInstance: (cellId, targetX = 0, targetY = 0, orientation = 'R0') => set((state) => {
    const master = state.masterCells[cellId];
    if (!master) return state;

    const clamped = clampInstancePosition(targetX, targetY, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
    
    const newInst: Instance = {
      id: uuidv4(),
      cellId,
      name: getNextInstanceName(state.instances),
      x: clamped.x,
      y: clamped.y,
      orientation: orientation,
    };
    const instances = [...state.instances, newInst];
    return {
      ...commitProjectPatch(state, `Place ${newInst.name}`, { instances }),
      selectedInstanceId: newInst.id,
      selectedInstanceIds: [newInst.id],
      // Cadence keeps placement mode active so you can place multiple. We won't change appMode.
    };
  }),

  updateInstancePosition: (instanceId, x, y) => set((state) => {
    const instances = state.instances.map(inst => {
      if (inst.id === instanceId) {
        const master = state.masterCells[inst.cellId];
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
    };
  }),

  redo: () => set((state) => {
    const result = redoHistory(state.history, getProjectSnapshot(state));
    if (!result) return state;
    return {
      ...result.snapshot,
      history: result.history,
      ...selectionAfterInstancesChange(state, result.snapshot.instances),
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

  loadProject: (data) => set((state) => ({
    ...state,
    gridSize: data.gridSize ?? state.gridSize,
    topWidth: data.topWidth ?? state.topWidth,
    topHeight: data.topHeight ?? state.topHeight,
    topLibName: data.topLibName ?? state.topLibName,
    topCellName: data.topCellName ?? state.topCellName,
    masterCells: data.masterCells ?? {},
    instances: data.instances ?? [],
    rulers: data.rulers ?? [],
    history: { past: [], future: [] },
    selectedInstanceId: null,
    selectedInstanceIds: [],
    appMode: 'select'
  })),
}));
