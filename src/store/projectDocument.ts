import type { Cell, Instance, PixelArray, Ruler } from './useStore.ts';
import { getTopologicalCellOrder } from '../utils/hierarchy.ts';
import type { CellViewContent } from '../utils/hierarchy.ts';
import type { LayoutShape } from '../utils/layoutLayers.ts';

export const PROJECT_FILE_VERSION = 1 as const;
export const PROJECT_RECOVERY_KEY = 'ic-floorplanner:recovery:v1';

export type ProjectSnapshot = {
  gridSize: number;
  topWidth: number;
  topHeight: number;
  topLibName: string;
  topCellName: string;
  masterCells: Record<string, Cell>;
  instances: Instance[];
  rulers: Ruler[];
  /** Optional drawn layout shapes (rectangles on Virtuoso layer/purpose pairs) in the Top Cell. */
  shapes?: LayoutShape[];
  pixelArray?: PixelArray | null;
  /** Optional seal-ring / edge margin (um) from the top-cell outer boundary to edge pads. */
  padInset?: number;
  /** Optional explicit Virtuoso library list (preserves empty user-created libraries). */
  libraries?: string[];
  /** Optional internal layout views for hierarchical master cells. */
  cellViews?: Record<string, CellViewContent>;
};

export type ProjectDocument = {
  format: 'ic-floorplanner';
  version: typeof PROJECT_FILE_VERSION;
  savedAt: string;
  project: ProjectSnapshot;
};

const orientations = new Set([
  'R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const assertInstances = (
  rawInstances: unknown[],
  masterCells: Record<string, Cell>,
): Instance[] => {
  const ids = new Set<string>();
  const names = new Set<string>();
  return rawInstances.map((raw, index) => {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !nonEmptyString(raw.cellId) ||
        !nonEmptyString(raw.name) || !finite(raw.x) || !finite(raw.y) ||
        !nonEmptyString(raw.orientation) || !orientations.has(raw.orientation) ||
        (raw.locked !== undefined && typeof raw.locked !== 'boolean')) {
      throw new Error(`Invalid instance at index ${index}.`);
    }
    if (!masterCells[raw.cellId]) throw new Error(`Instance ${raw.name} references a missing master.`);
    if (ids.has(raw.id)) throw new Error(`Duplicate instance id: ${raw.id}.`);
    if (names.has(raw.name)) throw new Error(`Duplicate instance name: ${raw.name}.`);
    ids.add(raw.id);
    names.add(raw.name);
    return raw as Instance;
  });
};

const assertRulers = (rawRulers: unknown[]): Ruler[] => {
  const rulerIds = new Set<string>();
  return rawRulers.map((raw, index) => {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !finite(raw.startX) ||
        !finite(raw.startY) || !finite(raw.endX) || !finite(raw.endY) ||
        ((raw.referenceX !== undefined || raw.referenceY !== undefined) &&
          (!finite(raw.referenceX) || !finite(raw.referenceY)))) {
      throw new Error(`Invalid ruler at index ${index}.`);
    }
    if (rulerIds.has(raw.id)) throw new Error(`Duplicate ruler id: ${raw.id}.`);
    rulerIds.add(raw.id);
    return raw as Ruler;
  });
};

const assertShapes = (rawShapes: unknown[]): LayoutShape[] => {
  const shapeIds = new Set<string>();
  return rawShapes.map((raw, index) => {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !nonEmptyString(raw.layer) ||
        !nonEmptyString(raw.purpose) || !finite(raw.x) || !finite(raw.y) ||
        !finite(raw.width) || raw.width <= 0 || !finite(raw.height) || raw.height <= 0 ||
        (raw.color !== undefined && typeof raw.color !== 'string') ||
        (raw.label !== undefined && typeof raw.label !== 'string') ||
        (raw.locked !== undefined && typeof raw.locked !== 'boolean')) {
      throw new Error(`Invalid layout shape at index ${index}.`);
    }
    if (shapeIds.has(raw.id)) throw new Error(`Duplicate shape id: ${raw.id}.`);
    shapeIds.add(raw.id);
    return raw as LayoutShape;
  });
};

const assertPixelArray = (raw: unknown, containerWidth: number, containerHeight: number): PixelArray => {
  if (!isRecord(raw) || !finite(raw.x) || !finite(raw.y) ||
      !finite(raw.width) || raw.width <= 0 || raw.width >= containerWidth ||
      !finite(raw.height) || raw.height <= 0 || raw.height >= containerHeight ||
      typeof raw.visible !== 'boolean' ||
      raw.x < -containerWidth / 2 - 1e-9 || raw.x + raw.width > containerWidth / 2 + 1e-9 ||
      raw.y < -containerHeight / 2 - 1e-9 || raw.y + raw.height > containerHeight / 2 + 1e-9) {
    throw new Error('Invalid pixel array.');
  }
  return raw as PixelArray;
};

const assertPadInset = (raw: unknown, containerWidth: number, containerHeight: number): number => {
  if (!finite(raw) || raw < 0 || raw * 2 >= containerWidth || raw * 2 >= containerHeight) {
    throw new Error('Invalid pad inset.');
  }
  return raw;
};

const assertProject = (value: unknown): ProjectSnapshot => {
  if (!isRecord(value)) throw new Error('Project data must be an object.');
  if (!finite(value.gridSize) || value.gridSize <= 0) throw new Error('Grid size must be positive.');
  if (!finite(value.topWidth) || value.topWidth <= 0) throw new Error('Top width must be positive.');
  if (!finite(value.topHeight) || value.topHeight <= 0) throw new Error('Top height must be positive.');
  if (!nonEmptyString(value.topLibName)) throw new Error('Top library name is missing.');
  if (!nonEmptyString(value.topCellName)) throw new Error('Top cell name is missing.');
  if (!isRecord(value.masterCells)) throw new Error('Master cells must be an object.');
  if (!Array.isArray(value.instances)) throw new Error('Instances must be an array.');
  if (!Array.isArray(value.rulers)) throw new Error('Rulers must be an array.');

  const masterCells: Record<string, Cell> = {};
  for (const [key, raw] of Object.entries(value.masterCells)) {
    if (!isRecord(raw) || raw.id !== key || !nonEmptyString(raw.libName) ||
        !nonEmptyString(raw.cellName) || !finite(raw.width) || raw.width <= 0 ||
        !finite(raw.height) || raw.height <= 0 || !nonEmptyString(raw.color) ||
        (raw.originX !== undefined && !finite(raw.originX)) ||
        (raw.originY !== undefined && !finite(raw.originY)) ||
        (raw.autoBounds !== undefined && typeof raw.autoBounds !== 'boolean') ||
        (raw.kind !== undefined && raw.kind !== 'ip' && raw.kind !== 'pad') ||
        (raw.opacity !== undefined && (!finite(raw.opacity) || raw.opacity < 0 || raw.opacity > 1)) ||
        (raw.outlineStyle !== undefined && !['solid', 'dashed', 'dotted', 'none'].includes(String(raw.outlineStyle)))) {
      throw new Error(`Invalid master cell: ${key}.`);
    }
    masterCells[key] = raw as Cell;
  }

  const instances = assertInstances(value.instances, masterCells);
  const rulers = assertRulers(value.rulers);

  let shapes: LayoutShape[] | undefined;
  if (value.shapes !== undefined) {
    if (!Array.isArray(value.shapes)) throw new Error('Shapes must be an array.');
    const parsedShapes = assertShapes(value.shapes);
    if (parsedShapes.length > 0) shapes = parsedShapes;
  }

  let pixelArray: PixelArray | null = null;
  if (value.pixelArray !== undefined && value.pixelArray !== null) {
    pixelArray = assertPixelArray(value.pixelArray, value.topWidth, value.topHeight);
  }

  let padInset: number | undefined;
  if (value.padInset !== undefined) {
    padInset = assertPadInset(value.padInset, value.topWidth, value.topHeight);
  }

  let libraries: string[] | undefined;
  if (value.libraries !== undefined) {
    if (!Array.isArray(value.libraries)) throw new Error('Libraries must be an array.');
    const seenLibs = new Set<string>();
    const parsedLibs: string[] = [];
    for (const rawLib of value.libraries) {
      if (!nonEmptyString(rawLib)) throw new Error('Every library name must be a non-empty string.');
      const trimmed = rawLib.trim();
      if (!seenLibs.has(trimmed)) {
        seenLibs.add(trimmed);
        parsedLibs.push(trimmed);
      }
    }
    if (parsedLibs.length > 0) libraries = parsedLibs;
  }

  let cellViews: Record<string, CellViewContent> | undefined;
  if (value.cellViews !== undefined) {
    if (!isRecord(value.cellViews)) throw new Error('Cell views must be an object.');
    const parsedViews: Record<string, CellViewContent> = {};
    for (const [cellId, rawView] of Object.entries(value.cellViews)) {
      const master = masterCells[cellId];
      if (!master) throw new Error(`Cell view ${cellId} references a missing master.`);
      if (!isRecord(rawView) || !Array.isArray(rawView.instances) || !Array.isArray(rawView.rulers)) {
        throw new Error(`Invalid cell view for ${master.cellName}.`);
      }
      const viewInstances = assertInstances(rawView.instances, masterCells);
      const viewRulers = assertRulers(rawView.rulers);
      let viewShapes: LayoutShape[] | undefined;
      if (rawView.shapes !== undefined) {
        if (!Array.isArray(rawView.shapes)) throw new Error(`Invalid shapes in cell view ${master.cellName}.`);
        const parsed = assertShapes(rawView.shapes);
        if (parsed.length > 0) viewShapes = parsed;
      }
      if (rawView.coordinateMode !== undefined && rawView.coordinateMode !== 'origin' && rawView.coordinateMode !== 'centered') {
        throw new Error(`Invalid coordinateMode in cell view ${master.cellName}.`);
      }
      const viewPixelArray = rawView.pixelArray !== undefined && rawView.pixelArray !== null
        ? assertPixelArray(rawView.pixelArray, master.width, master.height)
        : undefined;
      const viewPadInset = rawView.padInset !== undefined
        ? assertPadInset(rawView.padInset, master.width, master.height)
        : undefined;
      parsedViews[cellId] = {
        instances: viewInstances,
        rulers: viewRulers,
        ...(viewShapes ? { shapes: viewShapes } : {}),
        ...(rawView.coordinateMode ? { coordinateMode: rawView.coordinateMode } : {}),
        ...(rawView.pixelArray === undefined ? {} : { pixelArray: viewPixelArray ?? null }),
        ...(viewPadInset === undefined ? {} : { padInset: viewPadInset }),
      };
    }
    getTopologicalCellOrder(Object.keys(parsedViews), parsedViews);
    if (Object.keys(parsedViews).length > 0) {
      cellViews = parsedViews;
    }
  }

  return {
    gridSize: value.gridSize,
    topWidth: value.topWidth,
    topHeight: value.topHeight,
    topLibName: value.topLibName,
    topCellName: value.topCellName,
    masterCells,
    instances,
    rulers,
    ...(shapes === undefined ? {} : { shapes }),
    ...(value.pixelArray === undefined ? {} : { pixelArray }),
    ...(padInset === undefined ? {} : { padInset }),
    ...(libraries === undefined ? {} : { libraries }),
    ...(cellViews === undefined ? {} : { cellViews }),
  };
};

export const createProjectDocument = (project: ProjectSnapshot): ProjectDocument => ({
  format: 'ic-floorplanner',
  version: PROJECT_FILE_VERSION,
  savedAt: new Date().toISOString(),
  project,
});

/** Parse the versioned .flp format, while accepting the legacy raw project object. */
export const parseProjectDocument = (text: string): ProjectSnapshot => {
  const raw: unknown = JSON.parse(text);
  if (isRecord(raw) && raw.format === 'ic-floorplanner') {
    if (raw.version !== PROJECT_FILE_VERSION) {
      throw new Error(`Unsupported project version: ${String(raw.version)}.`);
    }
    return assertProject(raw.project);
  }
  return assertProject(raw);
};

export const serializeProjectDocument = (project: ProjectSnapshot): string =>
  `${JSON.stringify(createProjectDocument(project), null, 2)}\n`;

export const saveRecovery = (project: ProjectSnapshot): boolean => {
  try {
    localStorage.setItem(PROJECT_RECOVERY_KEY, serializeProjectDocument(project));
    return true;
  } catch {
    return false;
  }
};

export const loadRecovery = (): ProjectSnapshot | null => {
  try {
    const text = localStorage.getItem(PROJECT_RECOVERY_KEY);
    return text ? parseProjectDocument(text) : null;
  } catch {
    return null;
  }
};
