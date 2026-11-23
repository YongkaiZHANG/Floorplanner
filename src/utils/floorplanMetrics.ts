import type { ProjectSnapshot } from '../store/projectDocument.ts';
import { getPhysicalBounds } from './alignment.ts';
import { formatGridValue } from './grid.ts';

export type OverlapKind = 'ip-ip' | 'pad-pad' | 'ip-pad';

export type OverlapViolation = {
  id: string;
  idA: string;
  idB: string;
  nameA: string;
  nameB: string;
  kind: OverlapKind;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  areaUm2: number;
};

export type PadSideCounts = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type FloorplanMetrics = {
  dieAreaUm2: number;
  dieAreaMm2: number;
  aspectRatio: number;
  ipCount: number;
  padCount: number;
  ipAreaUm2: number;
  padAreaUm2: number;
  ipUtilizationPct: number;
  totalUtilizationPct: number;
  whitespaceUm2: number;
  whitespacePct: number;
  pixelArrayAreaUm2: number;
  pixelArrayPct: number;
  padsBySide: PadSideCounts;
  overlaps: OverlapViolation[];
};

const OVERLAP_EPSILON = 1e-6;

const cleanDecimal = (value: number): number => parseFloat(value.toFixed(6));

const classifyPadSide = (
  bounds: { left: number; right: number; bottom: number; top: number },
  topWidth: number,
  topHeight: number,
  padInset: number,
): keyof PadSideCounts => {
  const halfW = topWidth / 2 - padInset;
  const halfH = topHeight / 2 - padInset;
  const distances: Array<{ side: keyof PadSideCounts; dist: number }> = [
    { side: 'top', dist: Math.abs(bounds.top - halfH) },
    { side: 'right', dist: Math.abs(bounds.right - halfW) },
    { side: 'bottom', dist: Math.abs(bounds.bottom + halfH) },
    { side: 'left', dist: Math.abs(bounds.left + halfW) },
  ];
  distances.sort((a, b) => a.dist - b.dist);
  return distances[0].side;
};

/**
 * Finds all physical bounding-box overlaps among placed instances (IP-IP, pad-pad,
 * and IP-pad). Touching edges (zero overlap area) are valid and not flagged.
 * Pixel-array overlaps are intentionally allowed and excluded from DRC violations.
 */
export const findOverlapViolations = (
  snapshot: Pick<ProjectSnapshot, 'masterCells' | 'instances'>,
): OverlapViolation[] => {
  const entries = snapshot.instances.flatMap(instance => {
    const master = snapshot.masterCells[instance.cellId];
    if (!master) return [];
    const bounds = getPhysicalBounds({
      ...instance,
      width: master.width,
      height: master.height,
    });
    return [{
      id: instance.id,
      name: instance.name,
      isPad: master.kind === 'pad',
      bounds,
    }];
  });

  const violations: OverlapViolation[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i];
    for (let j = i + 1; j < entries.length; j += 1) {
      const b = entries[j];
      const minX = Math.max(a.bounds.left, b.bounds.left);
      const maxX = Math.min(a.bounds.right, b.bounds.right);
      const minY = Math.max(a.bounds.bottom, b.bounds.bottom);
      const maxY = Math.min(a.bounds.top, b.bounds.top);
      const width = maxX - minX;
      const height = maxY - minY;
      if (width > OVERLAP_EPSILON && height > OVERLAP_EPSILON) {
        const kind: OverlapKind = a.isPad && b.isPad
          ? 'pad-pad'
          : (a.isPad || b.isPad ? 'ip-pad' : 'ip-ip');
        violations.push({
          id: `${a.id}:${b.id}`,
          idA: a.id,
          idB: b.id,
          nameA: a.name,
          nameB: b.name,
          kind,
          minX: cleanDecimal(minX),
          maxX: cleanDecimal(maxX),
          minY: cleanDecimal(minY),
          maxY: cleanDecimal(maxY),
          width: cleanDecimal(width),
          height: cleanDecimal(height),
          areaUm2: cleanDecimal(width * height),
        });
      }
    }
  }
  return violations;
};

export const computeFloorplanMetrics = (snapshot: ProjectSnapshot): FloorplanMetrics => {
  const dieAreaUm2 = snapshot.topWidth * snapshot.topHeight;
  const dieAreaMm2 = dieAreaUm2 / 1_000_000;
  const aspectRatio = snapshot.topHeight > 0 ? snapshot.topWidth / snapshot.topHeight : 0;
  const padInset = snapshot.padInset ?? 0;

  let ipCount = 0;
  let padCount = 0;
  let ipAreaUm2 = 0;
  let padAreaUm2 = 0;
  const padsBySide: PadSideCounts = { top: 0, right: 0, bottom: 0, left: 0 };

  for (const instance of snapshot.instances) {
    const master = snapshot.masterCells[instance.cellId];
    if (!master) continue;
    const area = master.width * master.height;
    if (master.kind === 'pad') {
      padCount += 1;
      padAreaUm2 += area;
      const bounds = getPhysicalBounds({ ...instance, width: master.width, height: master.height });
      const side = classifyPadSide(bounds, snapshot.topWidth, snapshot.topHeight, padInset);
      padsBySide[side] += 1;
    } else {
      ipCount += 1;
      ipAreaUm2 += area;
    }
  }

  const pixelArrayAreaUm2 = snapshot.pixelArray?.visible
    ? snapshot.pixelArray.width * snapshot.pixelArray.height
    : 0;
  const usedArea = ipAreaUm2 + padAreaUm2;
  const whitespaceUm2 = Math.max(0, dieAreaUm2 - usedArea);
  const pct = (part: number) => (dieAreaUm2 > 0 ? (part / dieAreaUm2) * 100 : 0);

  return {
    dieAreaUm2: cleanDecimal(dieAreaUm2),
    dieAreaMm2: cleanDecimal(dieAreaMm2),
    aspectRatio: cleanDecimal(aspectRatio),
    ipCount,
    padCount,
    ipAreaUm2: cleanDecimal(ipAreaUm2),
    padAreaUm2: cleanDecimal(padAreaUm2),
    ipUtilizationPct: cleanDecimal(pct(ipAreaUm2)),
    totalUtilizationPct: cleanDecimal(pct(usedArea)),
    whitespaceUm2: cleanDecimal(whitespaceUm2),
    whitespacePct: cleanDecimal(pct(whitespaceUm2)),
    pixelArrayAreaUm2: cleanDecimal(pixelArrayAreaUm2),
    pixelArrayPct: cleanDecimal(pct(pixelArrayAreaUm2)),
    padsBySide,
    overlaps: findOverlapViolations(snapshot),
  };
};

const escapeCsvField = (value: string): string => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const generateFloorplanCsv = (snapshot: ProjectSnapshot): string => {
  const padInset = snapshot.padInset ?? 0;
  const header = [
    'Instance',
    'Master',
    'Kind',
    'Library',
    'X (um)',
    'Y (um)',
    'Orientation',
    'Width (um)',
    'Height (um)',
    'Left (um)',
    'Bottom (um)',
    'Right (um)',
    'Top (um)',
    'CenterX (um)',
    'CenterY (um)',
    'PadSide',
  ];
  const rows: string[][] = [header];

  for (const instance of snapshot.instances) {
    const master = snapshot.masterCells[instance.cellId];
    if (!master) continue;
    const bounds = getPhysicalBounds({
      ...instance,
      width: master.width,
      height: master.height,
    });
    const isPad = master.kind === 'pad';
    const side = isPad
      ? classifyPadSide(bounds, snapshot.topWidth, snapshot.topHeight, padInset)
      : '';
    rows.push([
      instance.name,
      master.cellName,
      isPad ? 'pad' : 'ip',
      master.libName,
      formatGridValue(instance.x, snapshot.gridSize),
      formatGridValue(instance.y, snapshot.gridSize),
      instance.orientation,
      String(cleanDecimal(master.width)),
      String(cleanDecimal(master.height)),
      formatGridValue(bounds.left, snapshot.gridSize),
      formatGridValue(bounds.bottom, snapshot.gridSize),
      formatGridValue(bounds.right, snapshot.gridSize),
      formatGridValue(bounds.top, snapshot.gridSize),
      String(cleanDecimal(bounds.centerX)),
      String(cleanDecimal(bounds.centerY)),
      side,
    ]);
  }

  return `${rows.map(row => row.map(escapeCsvField).join(',')).join('\n')}\n`;
};

export const downloadCsvFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
