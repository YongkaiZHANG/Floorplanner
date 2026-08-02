import type { Cell, Instance, PixelArray } from '../store/useStore';
import { formatGridValue, isOnGrid } from './grid.ts';

const VALID_ORIENTATIONS = new Set(['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90']);

/** Emit stable decimal coordinates without changing geometry that is visible on the canvas. */
const cleanNumber = (value: number): number => parseFloat(value.toFixed(12));

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
  topCellName: string,
  masterCells: Record<string, Cell>,
  instances: Instance[],
  pixelArray?: PixelArray | null,
): ExportHierarchy => {
  const usedCellNames = new Set([topCellName, ...Object.values(masterCells).map(cell => cell.cellName)]);
  const usedTopInstanceNames = new Set(instances.filter(instance => masterCells[instance.cellId]?.kind !== 'pad').map(instance => instance.name));
  const ipWrapperNames = new Map<string, string>();

  instances.forEach(instance => {
    if (masterCells[instance.cellId]?.kind === 'pad') return;
    ipWrapperNames.set(instance.id, allocateUniqueName(`${topCellName}_${instance.name}_PLACED`, usedCellNames));
  });

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

const validateFloorplan = (
  topLibName: string,
  topCellName: string,
  topWidth: number,
  topHeight: number,
  masterCells: Record<string, Cell>,
  instances: Instance[],
  gridSize: number,
  pixelArray?: PixelArray | null,
) => {
  if (!topLibName.trim() || !topCellName.trim()) throw new Error('Top library and cell names are required.');
  if (!Number.isFinite(gridSize) || gridSize <= 0) throw new Error('Grid size must be greater than zero.');
  if (!Number.isFinite(topWidth) || !Number.isFinite(topHeight) || topWidth <= 0 || topHeight <= 0) {
    throw new Error('Top-cell dimensions must be positive numbers.');
  }

  const masterNames = new Set<string>();
  Object.values(masterCells).forEach(cell => {
    if (!cell.libName.trim() || !cell.cellName.trim()) throw new Error('Every master requires a library and cell name.');
    if (!Number.isFinite(cell.width) || !Number.isFinite(cell.height) || cell.width <= 0 || cell.height <= 0) {
      throw new Error(`Master ${cell.cellName} has invalid dimensions.`);
    }
    if (cell.libName !== topLibName) {
      throw new Error(`Master ${cell.cellName} must use the Top Cell library ${topLibName}.`);
    }

    const qualifiedName = `${cell.libName}\u0000${cell.cellName}`;
    if (masterNames.has(qualifiedName)) throw new Error(`Duplicate master cell: ${cell.libName}/${cell.cellName}.`);
    masterNames.add(qualifiedName);
    if (cell.libName === topLibName && cell.cellName === topCellName) {
      throw new Error('The top cell cannot also be used as a master cell.');
    }
  });

  const instanceNames = new Set<string>();
  instances.forEach(instance => {
    if (!masterCells[instance.cellId]) throw new Error(`Instance ${instance.name} references a missing master cell.`);
    if (!instance.name.trim()) throw new Error('Every instance requires a name.');
    if (instanceNames.has(instance.name)) throw new Error(`Duplicate instance name: ${instance.name}.`);
    instanceNames.add(instance.name);
    if (!Number.isFinite(instance.x) || !Number.isFinite(instance.y)) throw new Error(`Instance ${instance.name} has invalid coordinates.`);
    if (!isOnGrid(instance.x, gridSize) || !isOnGrid(instance.y, gridSize)) {
      throw new Error(`Instance ${instance.name} is off the ${formatGridValue(gridSize, gridSize)} um placement grid.`);
    }
    if (!VALID_ORIENTATIONS.has(instance.orientation)) throw new Error(`Instance ${instance.name} has invalid orientation ${instance.orientation}.`);
  });

  if (pixelArray) {
    if (!Number.isFinite(pixelArray.x) || !Number.isFinite(pixelArray.y) ||
        !Number.isFinite(pixelArray.width) || !Number.isFinite(pixelArray.height) ||
        pixelArray.width <= 0 || pixelArray.height <= 0 ||
        pixelArray.width >= topWidth || pixelArray.height >= topHeight) {
      throw new Error('Pixel array has invalid dimensions or coordinates.');
    }
    for (const coordinate of [pixelArray.x, pixelArray.y, pixelArray.width, pixelArray.height]) {
      if (!isOnGrid(coordinate, gridSize)) {
        throw new Error(`Pixel array geometry is off the ${formatGridValue(gridSize, gridSize)} um placement grid.`);
      }
    }
    if (pixelArray.x < -topWidth / 2 - 1e-9 || pixelArray.x + pixelArray.width > topWidth / 2 + 1e-9 ||
        pixelArray.y < -topHeight / 2 - 1e-9 || pixelArray.y + pixelArray.height > topHeight / 2 + 1e-9) {
      throw new Error('Pixel array must fit completely inside the top cell.');
    }
  }
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
): string => {
  validateFloorplan(topLibName, topCellName, topWidth, topHeight, masterCells, instances, gridSize, pixelArray);
  const hierarchy = buildExportHierarchy(topCellName, masterCells, instances, pixelArray);
  const ipInstances = instances.filter(instance => masterCells[instance.cellId]?.kind !== 'pad');
  const padInstances = instances.filter(instance => masterCells[instance.cellId]?.kind === 'pad');

  // Dimensions are emitted exactly as drawn. Only placement coordinates are grid-snapped.
  const exactTopW = cleanNumber(topWidth);
  const exactTopH = cleanNumber(topHeight);
  const exactHalfW = cleanNumber(topWidth / 2);
  const exactHalfH = cleanNumber(topHeight / 2);

  const topLib = skillString(topLibName);
  const topCell = skillString(topCellName);
  const safeTopName = skillComment(topCellName);

  let code = `; =============================================================\n`;
  code += `; SKILL Layout Floorplan\n`;
  code += `; Generated by IC Floorplanner\n`;
  code += `; Loading this file creates/overwrites the generated layout views.\n`;
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

  // Step 1: Generate Master Cells
  code += `\n    ; ==========================================\n`;
  code += `    ; STEP 1: Create Master Cell Views\n`;
  code += `    ; ==========================================\n`;
  
  Object.values(masterCells).forEach(cell => {
    const exactW = cleanNumber(cell.width);
    const exactH = cleanNumber(cell.height);
    const exactCX = cleanNumber(cell.width / 2);
    const exactCY = cleanNumber(cell.height / 2);
    const isPad = cell.kind === 'pad';
    const sizeTextValue = `${formatGridValue(cell.width, gridSize)} x ${formatGridValue(cell.height, gridSize)} um`;
    const sizeText = skillString(sizeTextValue);
    const nameLabelHeight = fitLabelHeight(cell.cellName, cell.width, cell.height, isPad ? 0.12 : 0.16);
    const sizeLabelHeight = fitLabelHeight(sizeTextValue, cell.width, cell.height, 0.1);
    const nameLabelY = cleanNumber(exactCY + cell.height * 0.09);
    const sizeLabelY = cleanNumber(exactCY - cell.height * 0.09);

    const lib = skillString(cell.libName);
    const cellName = skillString(cell.cellName);
    code += `\n    ; --- ${skillComment(cell.libName)}/${skillComment(cell.cellName)} (${exactW} x ${exactH} um) ---\n`;
    code += `    printf("Creating master: %s/%s\\n" ${lib} ${cellName})\n`;
    code += `    cv = dbOpenCellViewByType(${lib} ${cellName} "layout" "maskLayout" "w")\n`;
    code += `    unless(cv error("Floorplanner: cannot create master %s/%s/layout.\\n" ${lib} ${cellName}))\n`;
    code += `    ; Native OA prBoundary object on ("prBoundary" "drawing").\n`;
    code += `    boundary = dbCreatePRBoundary(cv list(0:0 0:${exactH} ${exactW}:${exactH} ${exactW}:0))\n`;
    code += `    unless(boundary error("Floorplanner: cannot create prBoundary for %s/%s.\\n" ${lib} ${cellName}))\n`;
    if (isPad) {
      code += `    ; Compact pad label on the requested ("text" "drawing") LPP.\n`;
      code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${exactCX}:${exactCY} ${cellName} "centerCenter" "R0" "roman" ${nameLabelHeight}) t)\n`;
      code += `      printf("WARNING: label layer text/drawing is unavailable for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `    )\n`;
    } else {
      code += `    ; Centered IP name and size labels on ("text" "drawing").\n`;
      code += `    ; Text heights adapt to both the IP height and the available width.\n`;
      code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${exactCX}:${nameLabelY} ${cellName} "centerCenter" "R0" "roman" ${nameLabelHeight}) t)\n`;
      code += `      printf("WARNING: cannot create the IP name label for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `    )\n`;
      code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${exactCX}:${sizeLabelY} ${sizeText} "centerCenter" "R0" "roman" ${sizeLabelHeight}) t)\n`;
      code += `      printf("WARNING: cannot create the IP size label for %s/%s.\\n" ${lib} ${cellName})\n`;
      code += `    )\n`;
    }
    code += `    dbSave(cv)\n`;
    code += `    dbClose(cv)\n`;
  });

  // Step 2: Create origin-anchored placed cells.
  code += `\n    ; ==========================================\n`;
  code += `    ; STEP 2: Create Placed Wrapper Cells\n`;
  code += `    ; Each wrapper owns its canvas coordinates; the Top Cell places it at 0:0.\n`;
  code += `    ; ==========================================\n`;

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
    code += `\n    ; --- Placed IP wrapper ${skillComment(wrapperName)} ---\n`;
    code += `    cv = dbOpenCellViewByType(${topLib} ${wrapperCell} "layout" "maskLayout" "w")\n`;
    code += `    unless(cv error("Floorplanner: cannot create placed IP cell %s/%s/layout.\\n" ${topLib} ${wrapperCell}))\n`;
    code += `    master = dbOpenCellViewByType(${masterLib} ${masterName} "layout" "maskLayout" "r")\n`;
    code += `    unless(master error("Floorplanner: cannot open IP master %s/%s/layout.\\n" ${masterLib} ${masterName}))\n`;
    code += `    ; Original canvas transform is stored inside the wrapper.\n`;
    code += `    inst = dbCreateInst(cv master ${internalName} ${snapX}:${snapY} ${orientation} 1)\n`;
    code += `    unless(inst error("Floorplanner: cannot place IP master inside %s.\\n" ${wrapperCell}))\n`;
    code += `    dbClose(master)\n`;
    code += `    dbSave(cv)\n`;
    code += `    dbClose(cv)\n`;
  });

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

  // Step 3: Assemble Top Cell using only origin placements.
  code += `\n    ; ==========================================\n`;
  code += `    ; STEP 3: Assemble ${safeTopName} at Origin\n`;
  code += `    ; ==========================================\n`;
  code += `    printf("Assembling top cell: %s/%s\\n" ${topLib} ${topCell})\n`;
  code += `    cv = dbOpenCellViewByType(${topLib} ${topCell} "layout" "maskLayout" "w")\n`;
  code += `    unless(cv error("Floorplanner: cannot create top cell %s/%s/layout.\\n" ${topLib} ${topCell}))\n\n`;
  code += `    ; Chip boundary: native OA prBoundary on ("prBoundary" "drawing").\n`;
  code += `    boundary = dbCreatePRBoundary(cv list(${-exactHalfW}:${-exactHalfH} ${-exactHalfW}:${exactHalfH} ${exactHalfW}:${exactHalfH} ${exactHalfW}:${-exactHalfH}))\n`;
  code += `    unless(boundary error("Floorplanner: cannot create the top-cell prBoundary.\\n"))\n\n`;

  ipInstances.forEach(inst => {
    const wrapperName = hierarchy.ipWrapperNames.get(inst.id);
    if (!wrapperName) return;
    const wrapperCell = skillString(wrapperName);
    const instanceName = skillString(inst.name);
    code += `    ; TOP-ORIGIN IP ${skillComment(inst.name)} -> ${skillComment(wrapperName)}\n`;
    code += `    master = dbOpenCellViewByType(${topLib} ${wrapperCell} "layout" "maskLayout" "r")\n`;
    code += `    unless(master error("Floorplanner: cannot open placed IP cell %s/%s/layout.\\n" ${topLib} ${wrapperCell}))\n`;
    code += `    inst = dbCreateInst(cv master ${instanceName} 0:0 "R0" 1)\n`;
    code += `    unless(inst error("Floorplanner: cannot place origin IP instance %s.\\n" ${instanceName}))\n`;
    code += `    dbClose(master)\n\n`;
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

  if (ipInstances.length === 0 && padInstances.length === 0 && !pixelArray?.visible) {
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
