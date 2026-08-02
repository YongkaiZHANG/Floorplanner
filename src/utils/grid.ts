const MAX_GRID_DECIMALS = 12;

/** Decimal precision required to represent one grid step without trailing noise. */
export const getGridPrecision = (gridSize: number): number => {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return 3;
  const text = gridSize.toExponential(MAX_GRID_DECIMALS);
  const [coefficient, exponentText] = text.split('e');
  const exponent = Number(exponentText);
  const fraction = coefficient.split('.')[1]?.replace(/0+$/, '') ?? '';
  return Math.min(MAX_GRID_DECIMALS, Math.max(0, fraction.length - exponent));
};

/** Snap using integer decimal units so values such as 0.005 stay canonical. */
export const snapToGrid = (value: number, gridSize: number): number => {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(gridSize) || gridSize <= 0) return value;
  const precision = getGridPrecision(gridSize);
  const scale = 10 ** precision;
  const gridUnits = Math.round(gridSize * scale);
  const snappedUnits = Math.round((value * scale) / gridUnits) * gridUnits;
  return snappedUnits / scale;
};

export const isOnGrid = (value: number, gridSize: number): boolean => {
  const tolerance = Math.max(1e-12, Math.abs(gridSize) * 1e-9);
  return Math.abs(value - snapToGrid(value, gridSize)) <= tolerance;
};

/** UI/export form: exact active-grid precision, without unnecessary zeroes. */
export const formatGridValue = (value: number, gridSize: number): string => {
  const snapped = snapToGrid(value, gridSize);
  const normalized = Object.is(snapped, -0) ? 0 : snapped;
  const fixed = normalized.toFixed(getGridPrecision(gridSize));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
};
