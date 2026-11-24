import type { Cell, Instance, PixelArray } from '../store/useStore.ts';
import { getPhysicalBounds } from './alignment.ts';
import { formatGridValue, isOnGrid } from './grid.ts';
import {
  composeCadenceTransform,
  getHierarchyUsageCounts,
  getOrientationMatrix,
  getTopologicalCellOrder,
} from './hierarchy.ts';
import type { CellViewContent } from './hierarchy.ts';
import type { LayoutShape } from './layoutLayers.ts';

export type SkillHierarchyMode = 'zero-origin-direct' | 'wrapped' | 'local-origin';

export type SkillExportOptions = {
  /** Skip overwriting master layout views that already exist in the library. */
  preserveExistingMasters?: boolean;
  /** Legacy flag: wrap each IP placement in an origin-anchored `<Top>_<Cell>_PLACED` cell. */
  useIpWrappers?: boolean;
  /**
   * Hierarchy generation mode:
   * - `'zero-origin-direct'`: Single-instance IPs and sub-modules own their exact chip coordinates
   *   directly in their own `lib/cell/layout` and are instantiated at `0:0 "R0"` in their parent/top cell.
   *   Reused multi-instance cells keep local `originX..originX+W` coordinates and are placed at their exact transforms.
   * - `'wrapped'`: Origin-anchored `<Top>_<Cell>_PLACED` wrapper cells around local-origin masters.
   * - `'local-origin'`: Local masters placed directly at `(x:y, orient)` with no wrappers.
   */
  hierarchyMode?: SkillHierarchyMode;
  /** Optional internal layout views for hierarchical master cells (Virtuoso multi-view). */
  cellViews?: Record<string, CellViewContent>;
  /** Optional rectangles drawn directly inside the Top Cell view. */
  topShapes?: LayoutShape[];
};

const VALID_ORIENTATIONS = new Set(['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90']);

/** Emit stable decimal coordinates without changing geometry that is visible on the canvas. */
const cleanNumber = (value: number): number => {
  const rounded = parseFloat(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Format a coordinate canonically on-grid when possible, otherwise cleanly rounded. */
const formatCoord = (value: number, gridSize: number): string => (
  isOnGrid(value, gridSize) ? formatGridValue(value, gridSize) : String(cleanNumber(value))
);

/** Quote arbitrary user text as a Cadence SKILL string literal. */
const skillString = (value: string): string => `"${value
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r/g, '\\r')
  .replace(/\n/g, '\\n')}"`;

/** Keep generated comments on one line even when names came from an imported project. */
const skillComment = (value: string): string => value.replace(/[\r\n]+/g, ' ');

const fitLabelHeight = (
  text: string,
  cellWidth: number,
  cellHeight: number,
  maxHeightFraction: number,
): number => cleanNumber(Math.min(
  cellHeight * maxHeightFraction,
  (cellWidth * 0.86) / (Math.max(1, text.length) * 0.62),
));

const allocateUniqueName = (base: string, used: Set<string>): string => {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
};

type ExportHierarchy = {
  ipWrapperNames: Map<string, string>;
  padBankCellName: string | null;
  padBankInstanceName: string | null;
  pixelArrayCellName: string | null;
  pixelArrayInstanceName: string | null;
};

const buildExportHierarchy = (
  topLibName: string,
  topCellName: string,
  masterCells: Record<string, Cell>,
  instances: Instance[],
  pixelArray?: PixelArray | null,
  useIpWrappers = true,
): ExportHierarchy => {
  const usedCellNames = new Set([
    topCellName,
    ...Object.values(masterCells)
      .filter(cell => cell.libName === topLibName)
      .map(cell => cell.cellName),
  ]);
  const usedTopInstanceNames = new Set(
    instances.filter(instance => masterCells[instance.cellId]?.kind !== 'pad').map(instance => instance.name),
  );
  const ipWrapperNames = new Map<string, string>();

  if (useIpWrappers) {
    instances.forEach(instance => {
      const masterCell = masterCells[instance.cellId];
      if (!masterCell || masterCell.kind === 'pad') return;
      ipWrapperNames.set(instance.id, allocateUniqueName(`${topCellName}_${masterCell.cellName}_PLACED`, usedCellNames));
    });
  }

  const hasPads = instances.some(instance => masterCells[instance.cellId]?.kind === 'pad');
  const padBankCellName = hasPads ? allocateUniqueName(`${topCellName}_PAD_BANK`, usedCellNames) : null;
  const padBankInstanceName = hasPads ? allocateUniqueName('PAD_BANK', usedTopInstanceNames) : null;
  const pixelArrayCellName = pixelArray?.visible
    ? allocateUniqueName(`${topCellName}_PIXEL_ARRAY`, usedCellNames)
    : null;
  const pixelArrayInstanceName = pixelArray?.visible
    ? allocateUniqueName('PIXEL_ARRAY', usedTopInstanceNames)
    : null;

  return { ipWrapperNames, padBankCellName, padBankInstanceName, pixelArrayCellName, pixelArrayInstanceName };
};

const validateInstancesList = (
  instances: readonly Instance[],
  masterCells: Record<string, Cell>,
  gridSize: number,
  scopeLabel: string,
) => {
  const instanceNames = new Set<string>();
  instances.forEach(instance => {
    const master = masterCells[instance.cellId];
    if (!master) {
      throw new Error(`Instance ${instance.name} in ${scopeLabel} references a missing master cell.`);
    }
    if (master.width <= 0 || master.height <= 0) {
      throw new Error(`Instance ${instance.name} in ${scopeLabel} references empty cell ${master.libName}/${master.cellName}. Draw a shape or place a sub-cell inside it before exporting SKILL.`);
    }
    if (!instance.name.trim()) throw new Error(`Every instance in ${scopeLabel} requires a name.`);
    if (instanceNames.has(instance.name)) {
      throw new Error(`Duplicate instance name: ${instance.name} in ${scopeLabel}.`);
    }
    instanceNames.add(instance.name);
    if (!Number.isFinite(instance.x) || !Number.isFinite(instance.y)) {
      throw new Error(`Instance ${instance.name} has invalid coordinates.`);
    }
    if (!isOnGrid(instance.x, gridSize) || !isOnGrid(instance.y, gridSize)) {
      throw new Error(`Instance ${instance.name} is off the ${formatGridValue(gridSize, gridSize)} um placement grid.`);
    }
    if (!VALID_ORIENTATIONS.has(instance.orientation)) {
      throw new Error(`Instance ${instance.name} has invalid orientation ${instance.orientation}.`);
    }
  });
};

const resolveViewCoordinateMode = (view?: CellViewContent): 'origin' | 'centered' => (
  view?.coordinateMode ?? ((view?.shapes?.length ?? 0) > 0 ? 'origin' : 'centered')
);

const validatePixelArrayForContainer = (
  pixelArray: PixelArray,
  containerWidth: number,
  containerHeight: number,
  gridSize: number,
  originX = -containerWidth / 2,
  originY = -containerHeight / 2,
) => {
  if (!Number.isFinite(pixelArray.x) || !Number.isFinite(pixelArray.y) ||
      !Number.isFinite(pixelArray.width) || !Number.isFinite(pixelArray.height) ||
      pixelArray.width <= 0 || pixelArray.height <= 0 ||
      pixelArray.width >= containerWidth || pixelArray.height >= containerHeight) {
    throw new Error('Pixel array has invalid dimensions or coordinates.');
  }
  for (const coordinate of [pixelArray.x, pixelArray.y, pixelArray.width, pixelArray.height]) {
    if (!isOnGrid(coordinate, gridSize)) {
      throw new Error(`Pixel array geometry is off the ${formatGridValue(gridSize, gridSize)} um placement grid.`);
    }
  }
  if (pixelArray.x < originX - 1e-9 || pixelArray.x + pixelArray.width > originX + containerWidth + 1e-9 ||
      pixelArray.y < originY - 1e-9 || pixelArray.y + pixelArray.height > originY + containerHeight + 1e-9) {
    throw new Error('Pixel array must fit completely inside its parent cell.');
  }
};

const validateShapesList = (
  shapes: readonly LayoutShape[],
  gridSize: number,
  scopeLabel: string,
) => {
  shapes.forEach((shape, index) => {
    if (!shape.layer.trim() || !shape.purpose.trim()) {
      throw new Error(`Shape #${index + 1} in ${scopeLabel} requires a non-empty layer and purpose.`);
    }
    if (!Number.isFinite(shape.x) || !Number.isFinite(shape.y) ||
        !Number.isFinite(shape.width) || !Number.isFinite(shape.height) ||
        shape.width <= 0 || shape.height <= 0) {
      throw new Error(`Shape #${index + 1} in ${scopeLabel} has invalid geometry.`);
    }
    for (const coord of [shape.x, shape.y, shape.width, shape.height]) {
      if (!isOnGrid(coord, gridSize)) {
        throw new Error(`Shape #${index + 1} in ${scopeLabel} is off the ${formatGridValue(gridSize, gridSize)} um placement grid.`);
      }
    }
  });
};

const validateFloorplan = (
  topLibName: string,
  topCellName: string,
  topWidth: number,
  topHeight: number,
  masterCells: Record<string, Cell>,
  instances: Instance[],
  gridSize: number,
  pixelArray?: PixelArray | null,
  cellViews: Record<string, CellViewContent> = {},
  topShapes: readonly LayoutShape[] = [],
) => {
  if (!topLibName.trim() || !topCellName.trim()) throw new Error('Top library and cell names are required.');
  if (!Number.isFinite(gridSize) || gridSize <= 0) throw new Error('Grid size must be greater than zero.');
  if (!Number.isFinite(topWidth) || !Number.isFinite(topHeight) || topWidth <= 0 || topHeight <= 0) {
    throw new Error('Top-cell dimensions must be positive numbers.');
  }

  const masterNames = new Set<string>();
  Object.values(masterCells).forEach(cell => {
    if (!cell.libName.trim() || !cell.cellName.trim()) throw new Error('Every master requires a library and cell name.');
    const isEmptyAutoCell = Boolean(cell.autoBounds) && cell.width === 0 && cell.height === 0;
    if (!isEmptyAutoCell && (!Number.isFinite(cell.width) || !Number.isFinite(cell.height) || cell.width <= 0 || cell.height <= 0)) {
      throw new Error(`Master ${cell.cellName} has invalid dimensions.`);
    }
    const qualifiedName = `${cell.libName}\u0000${cell.cellName}`;
    if (masterNames.has(qualifiedName)) throw new Error(`Duplicate master cell: ${cell.libName}/${cell.cellName}.`);
    masterNames.add(qualifiedName);
    if (cell.libName === topLibName && cell.cellName === topCellName) {
      throw new Error('The top cell cannot also be used as a master cell.');
    }
  });

  validateInstancesList(instances, masterCells, gridSize, topCellName);
  validateShapesList(topShapes, gridSize, topCellName);

  if (pixelArray) {
    validatePixelArrayForContainer(pixelArray, topWidth, topHeight, gridSize);
  }

  for (const [cellId, view] of Object.entries(cellViews)) {
    const master = masterCells[cellId];
    if (!master) throw new Error(`Cell view ${cellId} references a missing master cell.`);
    validateInstancesList(view.instances, masterCells, gridSize, `${master.libName}/${master.cellName}`);
    if (view.shapes && view.shapes.length > 0) {
      validateShapesList(view.shapes, gridSize, `${master.libName}/${master.cellName}`);
    }
    if (view.pixelArray) {
      const viewCoordMode = resolveViewCoordinateMode(view);
      const containerOriginX = viewCoordMode === 'origin' ? (master.originX ?? 0) : -master.width / 2;
      const containerOriginY = viewCoordMode === 'origin' ? (master.originY ?? 0) : -master.height / 2;
      validatePixelArrayForContainer(view.pixelArray, master.width, master.height, gridSize, containerOriginX, containerOriginY);
    }
  }

  // Ensure the hierarchy DAG has no cycles.
  getTopologicalCellOrder(Object.keys(masterCells), cellViews);
};

const transformLocalRect = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  transform: { x: number; y: number; orientation: string },
) => {
  const m = getOrientationMatrix(transform.orientation);
  const corners = [
    [minX, minY],
    [minX, maxY],
    [maxX, maxY],
    [maxX, minY],
  ].map(([u, v]) => ({
    x: transform.x + m[0] * u + m[1] * v,
    y: transform.y + m[2] * u + m[3] * v,
  }));
  return {
    left: Math.min(...corners.map(c => c.x)),
    right: Math.max(...corners.map(c => c.x)),
    bottom: Math.min(...corners.map(c => c.y)),
    top: Math.max(...corners.map(c => c.y)),
  };
};

export const generateSkillCode = (
  topLibName: string,
  topCellName: string,
  topWidth: number,
  topHeight: number,
  masterCells: Record<string, Cell>,
  instances: Instance[],
  gridSize: number,
  pixelArray?: PixelArray | null,
  options: SkillExportOptions = {},
): string => {
  const preserveExistingMasters = options.preserveExistingMasters ?? false;
  const hierarchyMode: SkillHierarchyMode = options.hierarchyMode
    ?? (options.useIpWrappers === false ? 'local-origin' : 'wrapped');
  const useIpWrappers = hierarchyMode === 'wrapped';
  const cellViews = options.cellViews ?? {};
  const topShapes = options.topShapes ?? [];

  validateFloorplan(topLibName, topCellName, topWidth, topHeight, masterCells, instances, gridSize, pixelArray, cellViews, topShapes);
  const hierarchy = buildExportHierarchy(topLibName, topCellName, masterCells, instances, pixelArray, useIpWrappers);
  const ipInstances = instances.filter(instance => masterCells[instance.cellId]?.kind !== 'pad');
  const padInstances = instances.filter(instance => masterCells[instance.cellId]?.kind === 'pad');

  // Determine which single-instance IP/sub-cells are origin-anchored directly at chip coordinates.
  const originAnchored = new Set<string>();
  const globalPlacements = new Map<string, { x: number; y: number; orientation: string }>();

  if (hierarchyMode === 'zero-origin-direct') {
    const usageCounts = getHierarchyUsageCounts(instances, cellViews);
    for (const [cellId, count] of usageCounts.entries()) {
      const master = masterCells[cellId];
      if (count === 1 && master && master.kind !== 'pad') {
        originAnchored.add(cellId);
      }
    }

    const collectGlobalPlacements = (
      parentInstances: readonly Instance[],
      parentTransform: { x: number; y: number; orientation: string } | null,
      parentWidth: number,
      parentHeight: number,
      parentCoordinateMode: 'origin' | 'centered' = 'origin',
    ) => {
      for (const inst of parentInstances) {
        const master = masterCells[inst.cellId];
        if (!master) continue;
        const resolved = parentTransform
          ? composeCadenceTransform(parentTransform, inst, parentWidth, parentHeight, parentCoordinateMode)
          : { x: inst.x, y: inst.y, orientation: inst.orientation };
        if (originAnchored.has(inst.cellId)) {
          globalPlacements.set(inst.cellId, resolved);
          const childView = cellViews[inst.cellId];
          if (childView && childView.instances.length > 0) {
            collectGlobalPlacements(
              childView.instances,
              resolved,
              master.width,
              master.height,
              resolveViewCoordinateMode(childView),
            );
          }
        }
      }
    };
    collectGlobalPlacements(instances, null, topWidth, topHeight, 'origin');
  }

  // Strict bottom-up topological order so every child cellview exists before its parent opens it.
  const orderedCellIds = getTopologicalCellOrder(Object.keys(masterCells), cellViews);

  // Dimensions are emitted exactly as drawn. Only placement coordinates are grid-snapped.
  const exactTopW = cleanNumber(topWidth);
  const exactTopH = cleanNumber(topHeight);
  const exactHalfW = cleanNumber(topWidth / 2);
  const exactHalfH = cleanNumber(topHeight / 2);

  const topLib = skillString(topLibName);
  const topCell = skillString(topCellName);
  const safeTopName = skillComment(topCellName);

  const modeDescription = hierarchyMode === 'zero-origin-direct'
    ? 'Zero-origin direct hierarchy (unique IP cells positioned in-lib and instantiated at 0:0)'
    : hierarchyMode === 'wrapped'
      ? 'Origin-anchored wrapper hierarchy (<Top>_<Cell>_PLACED wrappers at 0:0)'
      : 'Local-origin direct hierarchy (0:0..W:H masters instantiated at x:y)';

  let code = `; =============================================================\n`;
  code += `; SKILL Layout Floorplan\n`;
  code += `; Generated by IC Floorplanner\n`;
  code += preserveExistingMasters
    ? `; Existing master layout views are preserved; generated top/wrapper views are refreshed.\n`
    : `; Loading this file creates/overwrites the generated layout views.\n`;
  code += `; Hierarchy: ${modeDescription}\n`;
  code += `; Top Cell : ${skillComment(topLibName)}/${safeTopName}\n`;
  code += `; Size     : ${exactTopW} x ${exactTopH} um\n`;
  code += `; Grid     : ${formatGridValue(gridSize, gridSize)} um\n`;
  code += `; =============================================================\n\n`;
  code += `procedure(FPCreateFloorplan()\n`;
  code += `  let((cv master inst boundary)\n`;

  const libraries = [...new Set([topLibName, ...Object.values(masterCells).map(cell => cell.libName)])];
  code += `\n    ; Libraries must already exist and be attached to the intended technology.\n`;
  libraries.forEach(libName => {
    const lib = skillString(libName);
    code += `    unless(ddGetObj(${lib}) error("Floorplanner: library %s does not exist.\\n" ${lib}))\n`;
  });

  // Step 1: Generate Master Cells in strict bottom-up topological order.
  code += `\n    ; ==========================================\n`;
  code += `    ; STEP 1: Create Master Cell Views (Bottom-Up)\n`;
  code += `    ; ==========================================\n`;

  orderedCellIds.forEach(cellId => {
    const cell = masterCells[cellId];
    if (!cell) return;
    const view = cellViews[cellId];
    const subInstances = view?.instances ?? [];
    const viewShapes = view?.shapes ?? [];
    const viewCoordinateMode = resolveViewCoordinateMode(view);
    const anchoredTransform = globalPlacements.get(cellId);
    const ox = cell.originX ?? 0;
    const oy = cell.originY ?? 0;
    const exactOX = cleanNumber(ox);
    const exactOY = cleanNumber(oy);
    const exactW = cleanNumber(cell.width);
    const exactH = cleanNumber(cell.height);
    const exactMaxX = cleanNumber(ox + cell.width);
    const exactMaxY = cleanNumber(oy + cell.height);
    const exactCX = cleanNumber(ox + cell.width / 2);
    const exactCY = cleanNumber(oy + cell.height / 2);
    const isPad = cell.kind === 'pad';
    const nameLabelHeight = fitLabelHeight(cell.cellName, cell.width, cell.height, 0.12);

    const lib = skillString(cell.libName);
    const cellName = skillString(cell.cellName);
    const indent = preserveExistingMasters ? '      ' : '    ';

    const isEmptyCell = cell.width <= 0 || cell.height <= 0;
    if (isEmptyCell) {
      code += `\n    ; --- ${skillComment(cell.libName)}/${skillComment(cell.cellName)} (empty Virtuoso cellview) ---\n`;
      if (preserveExistingMasters) {
        code += `    if(ddGetObj(${lib} ${cellName} "layout") then\n`;
        code += `      printf("Preserving existing master: %s/%s/layout\\n" ${lib} ${cellName})\n`;
        code += `    else\n`;
      }
      code += `${indent}printf("Creating empty cellview: %s/%s\\n" ${lib} ${cellName})\n`;
      code += `${indent}cv = dbOpenCellViewByType(${lib} ${cellName} "layout" "maskLayout" "w")\n`;
      code += `${indent}unless(cv error("Floorplanner: cannot create master %s/%s/layout.\\n" ${lib} ${cellName}))\n`;
      code += `${indent}dbSave(cv)\n`;
      code += `${indent}dbClose(cv)\n`;
      if (preserveExistingMasters) {
        code += `    )\n`;
      }
      return;
    }

    code += `\n    ; --- ${skillComment(cell.libName)}/${skillComment(cell.cellName)} (${exactW} x ${exactH} um)`;
    if (anchoredTransform) {
      code += ` [origin-anchored at ${formatCoord(anchoredTransform.x, gridSize)}:${formatCoord(anchoredTransform.y, gridSize)} ${anchoredTransform.orientation}]`;
    }
    code += ` ---\n`;

    if (preserveExistingMasters) {
      code += `    if(ddGetObj(${lib} ${cellName} "layout") then\n`;
      code += `      printf("Preserving existing master: %s/%s/layout\\n" ${lib} ${cellName})\n`;
      code += `    else\n`;
    }
    code += `${indent}printf("Creating master: %s/%s\\n" ${lib} ${cellName})\n`;
    code += `${indent}cv = dbOpenCellViewByType(${lib} ${cellName} "layout" "maskLayout" "w")\n`;
    code += `${indent}unless(cv error("Floorplanner: cannot create master %s/%s/layout.\\n" ${lib} ${cellName}))\n`;

    if (anchoredTransform) {
      const bounds = getPhysicalBounds({
        id: cell.id,
        x: anchoredTransform.x,
        y: anchoredTransform.y,
        orientation: anchoredTransform.orientation,
        width: cell.width,
        height: cell.height,
        originX: ox,
        originY: oy,
      });
      const left = formatCoord(bounds.left, gridSize);
      const right = formatCoord(bounds.right, gridSize);
      const bottom = formatCoord(bounds.bottom, gridSize);
      const top = formatCoord(bounds.top, gridSize);
      code += `${indent}; Native OA prBoundary placed directly at chip-level coordinates (parent instantiates at 0:0).\n`;
      code += `${indent}boundary = dbCreatePRBoundary(cv list(${left}:${bottom} ${left}:${top} ${right}:${top} ${right}:${bottom}))\n`;
      code += `${indent}unless(boundary error("Floorplanner: cannot create prBoundary for %s/%s.\\n" ${lib} ${cellName}))\n`;
    } else {
      code += `${indent}; Native OA prBoundary object on ("prBoundary" "drawing").\n`;
      code += `${indent}boundary = dbCreatePRBoundary(cv list(${exactOX}:${exactOY} ${exactOX}:${exactMaxY} ${exactMaxX}:${exactMaxY} ${exactMaxX}:${exactOY}))\n`;
      code += `${indent}unless(boundary error("Floorplanner: cannot create prBoundary for %s/%s.\\n" ${lib} ${cellName}))\n`;
    }

    // Emit user-drawn rectangles on their Virtuoso Layer/Purpose Pairs (e.g. ("text" "drawing")).
    if (viewShapes.length > 0) {
      code += `${indent}; Drawn layout shapes inside ${skillComment(cell.cellName)}\n`;
      viewShapes.forEach(shape => {
        const localMinX = viewCoordinateMode === 'origin' ? shape.x : shape.x + cell.width / 2;
        const localMinY = viewCoordinateMode === 'origin' ? shape.y : shape.y + cell.height / 2;
        const localMaxX = localMinX + shape.width;
        const localMaxY = localMinY + shape.height;
        const rect = anchoredTransform
          ? transformLocalRect(localMinX, localMinY, localMaxX, localMaxY, anchoredTransform)
          : { left: localMinX, bottom: localMinY, right: localMaxX, top: localMaxY };
        const rx1 = formatCoord(rect.left, gridSize);
        const ry1 = formatCoord(rect.bottom, gridSize);
        const rx2 = formatCoord(rect.right, gridSize);
        const ry2 = formatCoord(rect.top, gridSize);
        const layerStr = skillString(shape.layer);
        const purposeStr = skillString(shape.purpose);
        code += `${indent}unless(errset(dbCreateRect(cv list(${layerStr} ${purposeStr}) list(${rx1}:${ry1} ${rx2}:${ry2})) t)\n`;
        code += `${indent}  printf("WARNING: cannot create %s/%s rectangle in %s.\\n" ${layerStr} ${purposeStr} ${cellName})\n`;
        code += `${indent})\n`;
        if (shape.label?.trim()) {
          const shapeText = skillString(shape.label.trim());
          const shapeW = rect.right - rect.left;
          const shapeH = rect.top - rect.bottom;
          const scx = formatCoord((rect.left + rect.right) / 2, gridSize);
          const scy = formatCoord((rect.bottom + rect.top) / 2, gridSize);
          const sHeight = fitLabelHeight(shape.label.trim(), shapeW, shapeH, 0.14);
          code += `${indent}unless(errset(dbCreateLabel(cv list("text" "drawing") ${scx}:${scy} ${shapeText} "centerCenter" "R0" "roman" ${sHeight}) t)\n`;
          code += `${indent}  printf("WARNING: cannot create shape label %s in %s.\\n" ${shapeText} ${cellName})\n`;
          code += `${indent})\n`;
        }
      });
    }

    // Instantiate any hierarchical sub-cells inside this cell view.
    if (subInstances.length > 0) {
      code += `${indent}; Hierarchical sub-instances inside ${skillComment(cell.cellName)}\n`;
      subInstances.forEach(childInst => {
        const childMaster = masterCells[childInst.cellId];
        if (!childMaster) return;
        const childLib = skillString(childMaster.libName);
        const childCell = skillString(childMaster.cellName);
        const childInstName = skillString(childInst.name);

        let placeX: string;
        let placeY: string;
        let placeOrient: string;
        if (anchoredTransform && originAnchored.has(childInst.cellId)) {
          placeX = '0';
          placeY = '0';
          placeOrient = skillString('R0');
        } else if (anchoredTransform) {
          const composed = composeCadenceTransform(anchoredTransform, childInst, cell.width, cell.height, viewCoordinateMode);
          placeX = formatCoord(composed.x, gridSize);
          placeY = formatCoord(composed.y, gridSize);
          placeOrient = skillString(composed.orientation);
        } else {
          placeX = formatCoord(viewCoordinateMode === 'origin' ? childInst.x : childInst.x + cell.width / 2, gridSize);
          placeY = formatCoord(viewCoordinateMode === 'origin' ? childInst.y : childInst.y + cell.height / 2, gridSize);
          placeOrient = skillString(childInst.orientation);
        }

        code += `${indent}master = dbOpenCellViewByType(${childLib} ${childCell} "layout" "maskLayout" "r")\n`;
        code += `${indent}unless(master error("Floorplanner: cannot open sub-cell %s/%s/layout.\\n" ${childLib} ${childCell}))\n`;
        code += `${indent}inst = dbCreateInst(cv master ${childInstName} ${placeX}:${placeY} ${placeOrient} 1)\n`;
        code += `${indent}unless(inst error("Floorplanner: cannot place sub-instance %s inside %s.\\n" ${childInstName} ${cellName}))\n`;
        code += `${indent}dbClose(master)\n`;
      });
    }

    // Optional pixel array region defined inside a sub-cell view.
    if (view?.pixelArray?.visible) {
      const pa = view.pixelArray;
      const localMinX = viewCoordinateMode === 'origin' ? pa.x : pa.x + cell.width / 2;
      const localMinY = viewCoordinateMode === 'origin' ? pa.y : pa.y + cell.height / 2;
      const localMaxX = localMinX + pa.width;
      const localMaxY = localMinY + pa.height;
      const rect = anchoredTransform
        ? transformLocalRect(localMinX, localMinY, localMaxX, localMaxY, anchoredTransform)
        : { left: localMinX, bottom: localMinY, right: localMaxX, top: localMaxY };
      const paX1 = formatCoord(rect.left, gridSize);
      const paY1 = formatCoord(rect.bottom, gridSize);
      const paX2 = formatCoord(rect.right, gridSize);
      const paY2 = formatCoord(rect.top, gridSize);
      const paCX = formatCoord((rect.left + rect.right) / 2, gridSize);
      const paCY = formatCoord((rect.bottom + rect.top) / 2, gridSize);
      const paLabel = skillString(`PIXEL ARRAY ${formatGridValue(pa.width, gridSize)}x${formatGridValue(pa.height, gridSize)}um`);
      code += `${indent}unless(errset(dbCreateRect(cv list("prBoundary" "drawing") list(${paX1}:${paY1} ${paX2}:${paY2})) t)\n`;
      code += `${indent}  error("Floorplanner: cannot create the pixel-array region in %s.\\n" ${cellName})\n`;
      code += `${indent})\n`;
      code += `${indent}unless(errset(dbCreateLabel(cv list("text" "drawing") ${paCX}:${paCY} ${paLabel} "centerCenter" "R0" "roman" ${cleanNumber(Math.min(pa.width, pa.height) * 0.04)}) t)\n`;
      code += `${indent}  printf("WARNING: cannot create the pixel-array label in %s.\\n" ${cellName})\n`;
      code += `${indent})\n`;
    }

    // Labels (only for legacy fixed-box cells without user-drawn shapes; cells with drawn shapes keep strictly what the user drew)
    if (viewShapes.length > 0) {
      code += `${indent}; Cell contains user-drawn shapes; no synthetic wrapper labels added.\n`;
    } else if (isPad) {
      code += `${indent}; Compact pad label on the requested ("text" "drawing") LPP.\n`;
      code += `${indent}unless(errset(dbCreateLabel(cv list("text" "drawing") ${exactCX}:${exactCY} ${cellName} "centerCenter" "R0" "roman" ${nameLabelHeight}) t)\n`;
      code += `${indent}  printf("WARNING: label layer text/drawing is unavailable for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `${indent})\n`;
    } else if (anchoredTransform) {
      const bounds = getPhysicalBounds({
        id: cell.id,
        x: anchoredTransform.x,
        y: anchoredTransform.y,
        orientation: anchoredTransform.orientation,
        width: cell.width,
        height: cell.height,
        originX: ox,
        originY: oy,
      });
      const physicalWidth = bounds.right - bounds.left;
      const physicalHeight = bounds.top - bounds.bottom;
      const sizeTextValue = `${exactW} x ${exactH} um`;
      const sizeText = skillString(sizeTextValue);
      const labelX = cleanNumber(bounds.centerX);
      const nameLabelY = cleanNumber(bounds.centerY + physicalHeight * 0.09);
      const sizeLabelY = cleanNumber(bounds.centerY - physicalHeight * 0.09);
      const anchoredNameHeight = fitLabelHeight(cell.cellName, physicalWidth, physicalHeight, 0.16);
      const anchoredSizeHeight = fitLabelHeight(sizeTextValue, physicalWidth, physicalHeight, 0.1);
      code += `${indent}; Labels at transformed chip-level center on ("text" "drawing").\n`;
      code += `${indent}unless(errset(dbCreateLabel(cv list("text" "drawing") ${labelX}:${nameLabelY} ${cellName} "centerCenter" "R0" "roman" ${anchoredNameHeight}) t)\n`;
      code += `${indent}  printf("WARNING: label layer text/drawing is unavailable for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `${indent})\n`;
      code += `${indent}unless(errset(dbCreateLabel(cv list("text" "drawing") ${labelX}:${sizeLabelY} ${sizeText} "centerCenter" "R0" "roman" ${anchoredSizeHeight}) t)\n`;
      code += `${indent}  printf("WARNING: label layer text/drawing is unavailable for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `${indent})\n`;
    } else if (useIpWrappers) {
      code += `${indent}; IP information labels are added to the placed wrapper at its transformed center.\n`;
    } else {
      code += `${indent}unless(errset(dbCreateLabel(cv list("text" "drawing") ${exactCX}:${exactCY} ${cellName} "centerCenter" "R0" "roman" ${nameLabelHeight}) t)\n`;
      code += `${indent}  printf("WARNING: label layer text/drawing is unavailable for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `${indent})\n`;
    }
    code += `${indent}dbSave(cv)\n`;
    code += `${indent}dbClose(cv)\n`;
    if (preserveExistingMasters) {
      code += `    )\n`;
    }
  });

  // Step 2: Create origin-anchored wrappers (wrapped mode) and aggregate auxiliary cells.
  code += `\n    ; ==========================================\n`;
  code += useIpWrappers
    ? `    ; STEP 2: Create Placed Wrapper Cells\n    ; Each wrapper owns its canvas coordinates; the Top Cell places it at 0:0.\n`
    : `    ; STEP 2: Create Aggregate Auxiliary Cells (Pad Bank / Pixel Array)\n`;
  code += `    ; ==========================================\n`;

  if (useIpWrappers) {
    ipInstances.forEach(inst => {
      const masterCell = masterCells[inst.cellId];
      const wrapperName = hierarchy.ipWrapperNames.get(inst.id);
      if (!masterCell || !wrapperName) return;
      const wrapperCell = skillString(wrapperName);
      const masterLib = skillString(masterCell.libName);
      const masterName = skillString(masterCell.cellName);
      const internalName = skillString(`${inst.name}_MASTER`);
      const snapX = formatGridValue(inst.x, gridSize);
      const snapY = formatGridValue(inst.y, gridSize);
      const orientation = skillString(inst.orientation);
      const bounds = getPhysicalBounds({ ...inst, width: masterCell.width, height: masterCell.height, originX: masterCell.originX, originY: masterCell.originY });
      const physicalWidth = bounds.right - bounds.left;
      const physicalHeight = bounds.top - bounds.bottom;
      const sizeTextValue = `${cleanNumber(masterCell.width)} x ${cleanNumber(masterCell.height)} um`;
      const sizeText = skillString(sizeTextValue);
      const labelX = cleanNumber(bounds.centerX);
      const nameLabelY = cleanNumber(bounds.centerY + physicalHeight * 0.09);
      const sizeLabelY = cleanNumber(bounds.centerY - physicalHeight * 0.09);
      const nameLabelHeight = fitLabelHeight(masterCell.cellName, physicalWidth, physicalHeight, 0.16);
      const sizeLabelHeight = fitLabelHeight(sizeTextValue, physicalWidth, physicalHeight, 0.1);
      code += `\n    ; --- Placed IP wrapper ${skillComment(wrapperName)} ---\n`;
      code += `    cv = dbOpenCellViewByType(${topLib} ${wrapperCell} "layout" "maskLayout" "w")\n`;
      code += `    unless(cv error("Floorplanner: cannot create placed IP cell %s/%s/layout.\\n" ${topLib} ${wrapperCell}))\n`;
      code += `    master = dbOpenCellViewByType(${masterLib} ${masterName} "layout" "maskLayout" "r")\n`;
      code += `    unless(master error("Floorplanner: cannot open IP master %s/%s/layout.\\n" ${masterLib} ${masterName}))\n`;
      code += `    ; Original canvas transform is stored inside the wrapper.\n`;
      code += `    inst = dbCreateInst(cv master ${internalName} ${snapX}:${snapY} ${orientation} 1)\n`;
      code += `    unless(inst error("Floorplanner: cannot place IP master inside %s.\\n" ${wrapperCell}))\n`;
      code += `    dbClose(master)\n`;
      code += `    ; Explicit wrapper labels at the transformed IP center on ("text" "drawing").\n`;
      code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${labelX}:${nameLabelY} ${masterName} "centerCenter" "R0" "roman" ${nameLabelHeight}) t)\n`;
      code += `      printf("WARNING: cannot create the placed IP name label in %s.\\n" ${wrapperCell})\n`;
      code += `    )\n`;
      code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${labelX}:${sizeLabelY} ${sizeText} "centerCenter" "R0" "roman" ${sizeLabelHeight}) t)\n`;
      code += `      printf("WARNING: cannot create the placed IP size label in %s.\\n" ${wrapperCell})\n`;
      code += `    )\n`;
      code += `    dbSave(cv)\n`;
      code += `    dbClose(cv)\n`;
    });
  }

  if (hierarchy.padBankCellName && padInstances.length > 0) {
    const padBankCell = skillString(hierarchy.padBankCellName);
    code += `\n    ; --- One aggregate cell containing every placed pad ---\n`;
    code += `    cv = dbOpenCellViewByType(${topLib} ${padBankCell} "layout" "maskLayout" "w")\n`;
    code += `    unless(cv error("Floorplanner: cannot create pad-bank cell %s/%s/layout.\\n" ${topLib} ${padBankCell}))\n`;
    padInstances.forEach(inst => {
      const masterCell = masterCells[inst.cellId];
      if (!masterCell) return;
      const masterLib = skillString(masterCell.libName);
      const masterName = skillString(masterCell.cellName);
      const instanceName = skillString(inst.name);
      const snapX = formatGridValue(inst.x, gridSize);
      const snapY = formatGridValue(inst.y, gridSize);
      const orientation = skillString(inst.orientation);
      code += `    master = dbOpenCellViewByType(${masterLib} ${masterName} "layout" "maskLayout" "r")\n`;
      code += `    unless(master error("Floorplanner: cannot open pad master %s/%s/layout.\\n" ${masterLib} ${masterName}))\n`;
      code += `    inst = dbCreateInst(cv master ${instanceName} ${snapX}:${snapY} ${orientation} 1)\n`;
      code += `    unless(inst error("Floorplanner: cannot place pad %s in the pad bank.\\n" ${instanceName}))\n`;
      code += `    dbClose(master)\n`;
    });
    code += `    dbSave(cv)\n`;
    code += `    dbClose(cv)\n`;
  }

  if (pixelArray?.visible && hierarchy.pixelArrayCellName) {
    const pixelCell = skillString(hierarchy.pixelArrayCellName);
    const arrayX = formatGridValue(pixelArray.x, gridSize);
    const arrayY = formatGridValue(pixelArray.y, gridSize);
    const arrayX2 = formatGridValue(pixelArray.x + pixelArray.width, gridSize);
    const arrayY2 = formatGridValue(pixelArray.y + pixelArray.height, gridSize);
    const arrayCX = formatGridValue(pixelArray.x + pixelArray.width / 2, gridSize);
    const arrayCY = formatGridValue(pixelArray.y + pixelArray.height / 2, gridSize);
    const arrayLabel = skillString(`PIXEL ARRAY ${formatGridValue(pixelArray.width, gridSize)}x${formatGridValue(pixelArray.height, gridSize)}um`);
    code += `\n    ; --- Visible pixel array in the same Top Cell library ---\n`;
    code += `    cv = dbOpenCellViewByType(${topLib} ${pixelCell} "layout" "maskLayout" "w")\n`;
    code += `    unless(cv error("Floorplanner: cannot create pixel-array cell %s/%s/layout.\\n" ${topLib} ${pixelCell}))\n`;
    code += `    unless(errset(dbCreateRect(cv list("prBoundary" "drawing") list(${arrayX}:${arrayY} ${arrayX2}:${arrayY2})) t)\n`;
    code += `      error("Floorplanner: cannot create the pixel-array region on prBoundary/drawing.\\n")\n`;
    code += `    )\n`;
    code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${arrayCX}:${arrayCY} ${arrayLabel} "centerCenter" "R0" "roman" ${cleanNumber(Math.min(pixelArray.width, pixelArray.height) * 0.04)}) t)\n`;
    code += `      printf("WARNING: cannot create the pixel-array label on text/drawing.\\n")\n`;
    code += `    )\n`;
    code += `    dbSave(cv)\n`;
    code += `    dbClose(cv)\n`;
  }

  // Step 3: Assemble Top Cell.
  code += `\n    ; ==========================================\n`;
  code += `    ; STEP 3: Assemble ${safeTopName} at Origin\n`;
  code += `    ; ==========================================\n`;
  code += `    printf("Assembling top cell: %s/%s\\n" ${topLib} ${topCell})\n`;
  code += `    cv = dbOpenCellViewByType(${topLib} ${topCell} "layout" "maskLayout" "w")\n`;
  code += `    unless(cv error("Floorplanner: cannot create top cell %s/%s/layout.\\n" ${topLib} ${topCell}))\n\n`;
  code += `    ; Chip boundary: native OA prBoundary on ("prBoundary" "drawing").\n`;
  code += `    boundary = dbCreatePRBoundary(cv list(${-exactHalfW}:${-exactHalfH} ${-exactHalfW}:${exactHalfH} ${exactHalfW}:${exactHalfH} ${exactHalfW}:${-exactHalfH}))\n`;
  code += `    unless(boundary error("Floorplanner: cannot create the top-cell prBoundary.\\n"))\n\n`;

  if (topShapes.length > 0) {
    code += `    ; Drawn layout shapes directly inside ${safeTopName}\n`;
    topShapes.forEach(shape => {
      const rx1 = formatCoord(shape.x, gridSize);
      const ry1 = formatCoord(shape.y, gridSize);
      const rx2 = formatCoord(shape.x + shape.width, gridSize);
      const ry2 = formatCoord(shape.y + shape.height, gridSize);
      const layerStr = skillString(shape.layer);
      const purposeStr = skillString(shape.purpose);
      code += `    unless(errset(dbCreateRect(cv list(${layerStr} ${purposeStr}) list(${rx1}:${ry1} ${rx2}:${ry2})) t)\n`;
      code += `      printf("WARNING: cannot create %s/%s rectangle in %s.\\n" ${layerStr} ${purposeStr} ${topCell})\n`;
      code += `    )\n`;
      if (shape.label?.trim()) {
        const shapeText = skillString(shape.label.trim());
        const scx = formatCoord(shape.x + shape.width / 2, gridSize);
        const scy = formatCoord(shape.y + shape.height / 2, gridSize);
        const sHeight = fitLabelHeight(shape.label.trim(), shape.width, shape.height, 0.14);
        code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${scx}:${scy} ${shapeText} "centerCenter" "R0" "roman" ${sHeight}) t)\n`;
        code += `      printf("WARNING: cannot create shape label %s in %s.\\n" ${shapeText} ${topCell})\n`;
        code += `    )\n`;
      }
    });
    code += `\n`;
  }

  ipInstances.forEach(inst => {
    const instanceName = skillString(inst.name);
    if (useIpWrappers) {
      const wrapperName = hierarchy.ipWrapperNames.get(inst.id);
      if (!wrapperName) return;
      const wrapperCell = skillString(wrapperName);
      code += `    ; TOP-ORIGIN IP ${skillComment(inst.name)} -> ${skillComment(wrapperName)}\n`;
      code += `    master = dbOpenCellViewByType(${topLib} ${wrapperCell} "layout" "maskLayout" "r")\n`;
      code += `    unless(master error("Floorplanner: cannot open placed IP cell %s/%s/layout.\\n" ${topLib} ${wrapperCell}))\n`;
      code += `    inst = dbCreateInst(cv master ${instanceName} 0:0 "R0" 1)\n`;
      code += `    unless(inst error("Floorplanner: cannot place origin IP instance %s.\\n" ${instanceName}))\n`;
      code += `    dbClose(master)\n\n`;
    } else {
      const masterCell = masterCells[inst.cellId];
      if (!masterCell) return;
      const masterLib = skillString(masterCell.libName);
      const masterName = skillString(masterCell.cellName);
      const isAnchored = originAnchored.has(inst.cellId);
      const placeX = isAnchored ? '0' : formatGridValue(inst.x, gridSize);
      const placeY = isAnchored ? '0' : formatGridValue(inst.y, gridSize);
      const placeOrient = isAnchored ? skillString('R0') : skillString(inst.orientation);
      code += isAnchored
        ? `    ; TOP-ORIGIN DIRECT IP ${skillComment(inst.name)} -> ${skillComment(masterCell.libName)}/${skillComment(masterCell.cellName)} (positioned in-lib)\n`
        : `    ; DIRECT IP ${skillComment(inst.name)} -> ${skillComment(masterCell.libName)}/${skillComment(masterCell.cellName)}\n`;
      code += `    master = dbOpenCellViewByType(${masterLib} ${masterName} "layout" "maskLayout" "r")\n`;
      code += `    unless(master error("Floorplanner: cannot open IP master %s/%s/layout.\\n" ${masterLib} ${masterName}))\n`;
      code += `    inst = dbCreateInst(cv master ${instanceName} ${placeX}:${placeY} ${placeOrient} 1)\n`;
      code += `    unless(inst error("Floorplanner: cannot place direct IP instance %s.\\n" ${instanceName}))\n`;
      code += `    dbClose(master)\n\n`;
    }
  });

  if (hierarchy.padBankCellName && hierarchy.padBankInstanceName) {
    const padBankCell = skillString(hierarchy.padBankCellName);
    const padBankInstance = skillString(hierarchy.padBankInstanceName);
    code += `    ; TOP-ORIGIN PAD BANK: all pads are contained in one cell.\n`;
    code += `    master = dbOpenCellViewByType(${topLib} ${padBankCell} "layout" "maskLayout" "r")\n`;
    code += `    unless(master error("Floorplanner: cannot open pad-bank cell %s/%s/layout.\\n" ${topLib} ${padBankCell}))\n`;
    code += `    inst = dbCreateInst(cv master ${padBankInstance} 0:0 "R0" 1)\n`;
    code += `    unless(inst error("Floorplanner: cannot place the origin pad bank.\\n"))\n`;
    code += `    dbClose(master)\n\n`;
  }

  if (hierarchy.pixelArrayCellName && hierarchy.pixelArrayInstanceName) {
    const pixelCell = skillString(hierarchy.pixelArrayCellName);
    const pixelInstance = skillString(hierarchy.pixelArrayInstanceName);
    code += `    ; TOP-ORIGIN PIXEL ARRAY: visible drawing is contained in its own cell.\n`;
    code += `    master = dbOpenCellViewByType(${topLib} ${pixelCell} "layout" "maskLayout" "r")\n`;
    code += `    unless(master error("Floorplanner: cannot open pixel-array cell %s/%s/layout.\\n" ${topLib} ${pixelCell}))\n`;
    code += `    inst = dbCreateInst(cv master ${pixelInstance} 0:0 "R0" 1)\n`;
    code += `    unless(inst error("Floorplanner: cannot place the origin pixel-array cell.\\n"))\n`;
    code += `    dbClose(master)\n\n`;
  }

  if (ipInstances.length === 0 && padInstances.length === 0 && !pixelArray?.visible && topShapes.length === 0) {
    code += `    ; No generated child cells to place\n`;
  }

  code += `    dbSave(cv)\n`;
  code += `    dbClose(cv)\n`;
  code += `    printf("Floorplanner: %s/%s/layout created successfully.\\n" ${topLib} ${topCell})\n`;
  code += `    t\n`;
  code += `  )\n`;
  code += `)\n\n`;
  code += `FPCreateFloorplan()\n`;

  return code;
};

export const downloadSkillFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
