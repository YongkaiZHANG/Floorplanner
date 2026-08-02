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

    const lib = skillString(cell.libName);
    const cellName = skillString(cell.cellName);
    code += `\n    ; --- ${skillComment(cell.libName)}/${skillComment(cell.cellName)} (${exactW} x ${exactH} um) ---\n`;
    code += `    printf("Creating master: %s/%s\\n" ${lib} ${cellName})\n`;
    code += `    cv = dbOpenCellViewByType(${lib} ${cellName} "layout" "maskLayout" "w")\n`;
    code += `    unless(cv error("Floorplanner: cannot create master %s/%s/layout.\\n" ${lib} ${cellName}))\n`;
    code += `    ; Native OA prBoundary object on ("prBoundary" "drawing").\n`;
    code += `    boundary = dbCreatePRBoundary(cv list(0:0 0:${exactH} ${exactW}:${exactH} ${exactW}:0))\n`;
    code += `    unless(boundary error("Floorplanner: cannot create prBoundary for %s/%s.\\n" ${lib} ${cellName}))\n`;
    code += `    ; Visual label uses only the requested ("text" "drawing") LPP.\n`;
    code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${exactCX}:${exactCY} ${cellName} "centerCenter" "R0" "roman" ${cleanNumber(cell.height * 0.1)}) t)\n`;
    code += `      printf("WARNING: label layer text/drawing is unavailable for %s/%s.\\n" ${lib} ${cellName})\n`;
    code += `    )\n`;
    code += `    dbSave(cv)\n`;
    code += `    dbClose(cv)\n`;
  });

  // Step 2: Assemble Top Cell
  code += `\n    ; ==========================================\n`;
  code += `    ; STEP 2: Assemble ${safeTopName}\n`;
  code += `    ; ==========================================\n`;
  code += `    printf("Assembling top cell: %s/%s\\n" ${topLib} ${topCell})\n`;
  code += `    cv = dbOpenCellViewByType(${topLib} ${topCell} "layout" "maskLayout" "w")\n`;
  code += `    unless(cv error("Floorplanner: cannot create top cell %s/%s/layout.\\n" ${topLib} ${topCell}))\n\n`;

  // Top Cell boundary (native prBoundary/drawing object)
  code += `    ; Chip boundary: native OA prBoundary on ("prBoundary" "drawing"); both origins are at its center.\n`;
  code += `    boundary = dbCreatePRBoundary(cv list(${-exactHalfW}:${-exactHalfH} ${-exactHalfW}:${exactHalfH} ${exactHalfW}:${exactHalfH} ${exactHalfW}:${-exactHalfH}))\n`;
  code += `    unless(boundary error("Floorplanner: cannot create the top-cell prBoundary.\\n"))\n\n`;

  if (pixelArray?.visible) {
    const arrayX = formatGridValue(pixelArray.x, gridSize);
    const arrayY = formatGridValue(pixelArray.y, gridSize);
    const arrayX2 = formatGridValue(pixelArray.x + pixelArray.width, gridSize);
    const arrayY2 = formatGridValue(pixelArray.y + pixelArray.height, gridSize);
    const arrayCX = formatGridValue(pixelArray.x + pixelArray.width / 2, gridSize);
    const arrayCY = formatGridValue(pixelArray.y + pixelArray.height / 2, gridSize);
    const arrayLabel = skillString(`PIXEL ARRAY ${formatGridValue(pixelArray.width, gridSize)}x${formatGridValue(pixelArray.height, gridSize)}um`);
    code += `    ; Pixel-array planning region on the requested drawing LPPs.\n`;
    code += `    unless(errset(dbCreateRect(cv list("prBoundary" "drawing") list(${arrayX}:${arrayY} ${arrayX2}:${arrayY2})) t)\n`;
    code += `      error("Floorplanner: cannot create the pixel-array region on prBoundary/drawing.\\n")\n`;
    code += `    )\n`;
    code += `    unless(errset(dbCreateLabel(cv list("text" "drawing") ${arrayCX}:${arrayCY} ${arrayLabel} "centerCenter" "R0" "roman" ${cleanNumber(Math.min(pixelArray.width, pixelArray.height) * 0.04)}) t)\n`;
    code += `      printf("WARNING: cannot create the pixel-array label on text/drawing.\\n")\n`;
    code += `    )\n\n`;
  }

  if (instances.length === 0) {
    code += `    ; No instances to place\n`;
  }

  // Instantiate Sub-IPs
  instances.forEach((inst) => {
    const masterCell = masterCells[inst.cellId];
    if (!masterCell) return;

    // Coordinates are already grid-normalized in the project store. Formatting
    // them here preserves the exact canvas placement without floating noise.
    const snapX = formatGridValue(inst.x, gridSize);
    const snapY = formatGridValue(inst.y, gridSize);

    const masterLib = skillString(masterCell.libName);
    const masterName = skillString(masterCell.cellName);
    const instanceName = skillString(inst.name);
    const orientation = skillString(inst.orientation);
    code += `    ; ${skillComment(inst.name)} <- ${skillComment(masterCell.libName)}/${skillComment(masterCell.cellName)}  @ (${snapX}, ${snapY})  [${inst.orientation}]\n`;
    code += `    master = dbOpenCellViewByType(${masterLib} ${masterName} "layout" "maskLayout" "r")\n`;
    code += `    unless(master error("Floorplanner: cannot open master %s/%s/layout.\\n" ${masterLib} ${masterName}))\n`;
    code += `    inst = dbCreateInst(cv master ${instanceName} ${snapX}:${snapY} ${orientation} 1)\n`;
    code += `    unless(inst error("Floorplanner: cannot create instance %s.\\n" ${instanceName}))\n`;
    code += `    dbClose(master)\n\n`;
  });

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
