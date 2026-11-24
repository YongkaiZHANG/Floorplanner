export type ScreenLabelRect = {
  cx: number;
  cy: number;
  halfWidth: number;
  halfHeight: number;
};

/** Returns true when two axis-aligned screen-space label boxes overlap. */
export const labelRectsOverlap = (a: ScreenLabelRect, b: ScreenLabelRect): boolean => (
  Math.abs(a.cx - b.cx) < a.halfWidth + b.halfWidth
  && Math.abs(a.cy - b.cy) < a.halfHeight + b.halfHeight
);

export type NeighborCandidate<T extends { distance: number; overlap: { start: number; end: number }; isPad: boolean }> = T;

/**
 * Collapses multiple collinear pads at the same clearance distance from a block
 * into one representative group candidate so a pad row produces one clean
 * clearance dimension instead of N overlapping labels.
 */
export const collapseCollinearPadCandidates = <
  T extends {
    id: string;
    name: string;
    distance: number;
    overlap: { start: number; end: number };
    isPad: boolean;
    occludes: boolean;
    box: { minX: number; maxX: number; minY: number; maxY: number };
  },
>(
  candidates: readonly T[],
  tolerance = 1e-3,
): Array<T & { padCount?: number }> => {
  const nonPads: Array<T & { padCount?: number }> = [];
  const padGroups: Array<{ items: T[] }> = [];

  for (const candidate of candidates) {
    if (!candidate.isPad) {
      nonPads.push(candidate);
      continue;
    }
    const existing = padGroups.find(group => Math.abs(group.items[0].distance - candidate.distance) <= tolerance);
    if (existing) {
      existing.items.push(candidate);
    } else {
      padGroups.push({ items: [candidate] });
    }
  }

  const collapsedPads = padGroups.map(group => {
    if (group.items.length === 1) return { ...group.items[0], padCount: 1 };
    const first = group.items[0];
    const minStart = Math.min(...group.items.map(item => item.overlap.start));
    const maxEnd = Math.max(...group.items.map(item => item.overlap.end));
    const minX = Math.min(...group.items.map(item => item.box.minX));
    const maxX = Math.max(...group.items.map(item => item.box.maxX));
    const minY = Math.min(...group.items.map(item => item.box.minY));
    const maxY = Math.max(...group.items.map(item => item.box.maxY));
    return {
      ...first,
      id: `pad-group-${group.items.map(item => item.id).sort().join('-')}`,
      name: `${group.items.length} pads`,
      overlap: { start: minStart, end: maxEnd },
      box: { minX, maxX, minY, maxY },
      padCount: group.items.length,
    };
  });

  return [...nonPads, ...collapsedPads].sort((a, b) => a.distance - b.distance);
};
