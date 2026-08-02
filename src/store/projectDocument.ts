import type { Cell, Instance, Ruler } from './useStore';

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
        (raw.kind !== undefined && raw.kind !== 'ip' && raw.kind !== 'pad')) {
      throw new Error(`Invalid master cell: ${key}.`);
    }
    masterCells[key] = raw as Cell;
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  const instances = value.instances.map((raw, index) => {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !nonEmptyString(raw.cellId) ||
        !nonEmptyString(raw.name) || !finite(raw.x) || !finite(raw.y) ||
        !nonEmptyString(raw.orientation) || !orientations.has(raw.orientation)) {
      throw new Error(`Invalid instance at index ${index}.`);
    }
    if (!masterCells[raw.cellId]) throw new Error(`Instance ${raw.name} references a missing master.`);
    if (ids.has(raw.id)) throw new Error(`Duplicate instance id: ${raw.id}.`);
    if (names.has(raw.name)) throw new Error(`Duplicate instance name: ${raw.name}.`);
    ids.add(raw.id);
    names.add(raw.name);
    return raw as Instance;
  });

  const rulerIds = new Set<string>();
  const rulers = value.rulers.map((raw, index) => {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !finite(raw.startX) ||
        !finite(raw.startY) || !finite(raw.endX) || !finite(raw.endY)) {
      throw new Error(`Invalid ruler at index ${index}.`);
    }
    if (rulerIds.has(raw.id)) throw new Error(`Duplicate ruler id: ${raw.id}.`);
    rulerIds.add(raw.id);
    return raw as Ruler;
  });

  return {
    gridSize: value.gridSize,
    topWidth: value.topWidth,
    topHeight: value.topHeight,
    topLibName: value.topLibName,
    topCellName: value.topCellName,
    masterCells,
    instances,
    rulers,
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
