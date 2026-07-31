import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

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

type ProjectState = {
  gridSize: number;
  appMode: 'select' | 'measure' | 'place';
  
  topWidth: number;
  topHeight: number;
  
  masterCells: Record<string, Cell>;
  instances: Instance[];
  rulers: Ruler[];
  
  selectedInstanceId: string | null;
  showCreateModal: boolean;
  showInstantiateModal: boolean;
  showPropertiesPanel: boolean;
  orthogonalRuler: boolean;
  
  placementMasterId: string | null;
  placementOrientation: string;
  pastStates: { instances: Instance[]; rulers: Ruler[] }[];
  
  setGridSize: (size: number) => void;
  setAppMode: (mode: 'select' | 'measure' | 'place') => void;
  setTopDimensions: (w: number, h: number) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowInstantiateModal: (show: boolean) => void;
  setShowPropertiesPanel: (show: boolean) => void;
  setPlacement: (masterId: string | null, orientation?: string) => void;
  
  addMasterCell: (libName: string, cellName: string, w: number, h: number, color: string) => void;
  updateMasterCell: (id: string, libName: string, cellName: string, w: number, h: number, color: string) => void;
  deleteMasterCell: (id: string) => void;
  placeInstance: (cellId: string, x?: number, y?: number, orientation?: string) => void;
  
  updateInstancePosition: (instanceId: string, x: number, y: number) => void;
  updateInstanceOrientation: (instanceId: string, orientation: string) => void;
  setSelectedInstance: (id: string | null) => void;
  deleteInstance: (id: string) => void;
  
  addRuler: (startX: number, startY: number, endX: number, endY: number) => void;
  clearRulers: () => void;
  
  undo: () => void;
  toggleOrthogonalRuler: () => void;
  loadProject: (data: Partial<ProjectState>) => void;
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

export const useStore = create<ProjectState>((set) => ({
  gridSize: 0.005,
  appMode: 'select',
  
  topWidth: 100, 
  topHeight: 100,
  
  masterCells: {},
  instances: [],
  rulers: [],
  selectedInstanceId: null,
  showCreateModal: false,
  showInstantiateModal: false,
  showPropertiesPanel: false,
  
  placementMasterId: null,
  placementOrientation: 'R0',
  pastStates: [],
  orthogonalRuler: false,

  setGridSize: (size) => set({ gridSize: size }),
  setAppMode: (mode) => set({ appMode: mode }),
  setTopDimensions: (w, h) => set({ topWidth: w, topHeight: h }),
  setShowCreateModal: (show) => set({ showCreateModal: show }),
  setShowInstantiateModal: (show) => set({ showInstantiateModal: show }),
  setShowPropertiesPanel: (show) => set({ showPropertiesPanel: show }),
  setPlacement: (masterId, orientation = 'R0') => set({ placementMasterId: masterId, placementOrientation: orientation, appMode: masterId ? 'place' : 'select' }),
  
  addMasterCell: (libName, cellName, w, h, color) => set((state) => {
    const existing = Object.values(state.masterCells).find(c => c.cellName === cellName && c.libName === libName);
    if (existing) return state; 
    
    const id = uuidv4();
    return {
      masterCells: {
        ...state.masterCells,
        [id]: { id, libName, cellName, width: w, height: h, color }
      }
    };
  }),

  updateMasterCell: (id, libName, cellName, w, h, color) => set((state) => {
    if (!state.masterCells[id]) return state;
    return {
      masterCells: {
        ...state.masterCells,
        [id]: { ...state.masterCells[id], libName, cellName, width: w, height: h, color }
      }
    };
  }),

  deleteMasterCell: (id) => set((state) => {
    if (!state.masterCells[id]) return state;
    const newMasterCells = { ...state.masterCells };
    delete newMasterCells[id];
    // Also remove instances of this cell
    const newInstances = state.instances.filter(inst => inst.cellId !== id);
    return {
      masterCells: newMasterCells,
      instances: newInstances,
      selectedInstanceId: state.selectedInstanceId && state.instances.find(i => i.id === state.selectedInstanceId)?.cellId === id ? null : state.selectedInstanceId,
    };
  }),

  placeInstance: (cellId, targetX = 0, targetY = 0, orientation = 'R0') => set((state) => {
    const master = state.masterCells[cellId];
    if (!master) return state;

    const clamped = clampInstancePosition(targetX, targetY, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
    
    const newInst: Instance = {
      id: uuidv4(),
      cellId,
      name: `I${state.instances.length}`,
      x: clamped.x,
      y: clamped.y,
      orientation: orientation,
    };
    return {
      pastStates: [...state.pastStates.slice(-19), { instances: state.instances, rulers: state.rulers }],
      instances: [...state.instances, newInst],
      selectedInstanceId: newInst.id,
      // Cadence keeps placement mode active so you can place multiple. We won't change appMode.
    };
  }),

  updateInstancePosition: (instanceId, x, y) => set((state) => ({
    pastStates: [...state.pastStates.slice(-19), { instances: state.instances, rulers: state.rulers }],
    instances: state.instances.map(inst => {
      if (inst.id === instanceId) {
        const master = state.masterCells[inst.cellId];
        const clamped = clampInstancePosition(x, y, inst.orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
        return { ...inst, x: clamped.x, y: clamped.y };
      }
      return inst;
    })
  })),
  
  updateInstanceOrientation: (instanceId, orientation) => set((state) => ({
    pastStates: [...state.pastStates.slice(-19), { instances: state.instances, rulers: state.rulers }],
    instances: state.instances.map(inst => {
      if (inst.id === instanceId) {
        const master = state.masterCells[inst.cellId];
        const clamped = clampInstancePosition(inst.x, inst.y, orientation, master.width, master.height, state.topWidth, state.topHeight, state.gridSize);
        return { ...inst, orientation, x: clamped.x, y: clamped.y };
      }
      return inst;
    })
  })),

  setSelectedInstance: (id) => set({ selectedInstanceId: id }),

  deleteInstance: (id) => set((state) => ({
    pastStates: [...state.pastStates.slice(-19), { instances: state.instances, rulers: state.rulers }],
    instances: state.instances.filter(inst => inst.id !== id),
    selectedInstanceId: state.selectedInstanceId === id ? null : state.selectedInstanceId
  })),

  addRuler: (startX, startY, endX, endY) => set((state) => ({
    pastStates: [...state.pastStates.slice(-19), { instances: state.instances, rulers: state.rulers }],
    rulers: [...state.rulers, { id: uuidv4(), startX, startY, endX, endY }]
  })),

  clearRulers: () => set((state) => ({ 
    pastStates: [...state.pastStates.slice(-19), { instances: state.instances, rulers: state.rulers }],
    rulers: [] 
  })),
  
  undo: () => set((state) => {
    if (state.pastStates.length === 0) return state;
    const previous = state.pastStates[state.pastStates.length - 1];
    return {
      instances: previous.instances,
      rulers: previous.rulers,
      pastStates: state.pastStates.slice(0, -1),
      selectedInstanceId: null
    };
  }),
  
  toggleOrthogonalRuler: () => set((state) => ({ orthogonalRuler: !state.orthogonalRuler })),

  loadProject: (data: Partial<ProjectState>) => set((state) => ({
    ...state,
    gridSize: data.gridSize ?? state.gridSize,
    topWidth: data.topWidth ?? state.topWidth,
    topHeight: data.topHeight ?? state.topHeight,
    masterCells: data.masterCells ?? {},
    instances: data.instances ?? [],
    rulers: data.rulers ?? [],
    pastStates: [],
    selectedInstanceId: null,
    appMode: 'select'
  })),
}));
