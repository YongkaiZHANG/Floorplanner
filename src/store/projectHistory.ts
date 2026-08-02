import type { ProjectSnapshot } from './projectDocument.ts';

export type HistoryEntry = {
  label: string;
  snapshot: ProjectSnapshot;
};

export type ProjectHistory = {
  past: HistoryEntry[];
  future: HistoryEntry[];
};

export const HISTORY_LIMIT = 100;

export const cloneProjectSnapshot = (snapshot: ProjectSnapshot): ProjectSnapshot =>
  structuredClone(snapshot);

export const snapshotsEqual = (a: ProjectSnapshot, b: ProjectSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Record the state before a mutation. Any new edit invalidates redo history. */
export const recordHistory = (
  history: ProjectHistory,
  label: string,
  before: ProjectSnapshot,
  after: ProjectSnapshot,
): ProjectHistory => {
  if (snapshotsEqual(before, after)) return history;
  return {
    past: [...history.past, { label, snapshot: cloneProjectSnapshot(before) }].slice(-HISTORY_LIMIT),
    future: [],
  };
};

export const undoHistory = (
  history: ProjectHistory,
  current: ProjectSnapshot,
): { history: ProjectHistory; snapshot: ProjectSnapshot; label: string } | null => {
  const entry = history.past.at(-1);
  if (!entry) return null;
  return {
    snapshot: cloneProjectSnapshot(entry.snapshot),
    label: entry.label,
    history: {
      past: history.past.slice(0, -1),
      future: [{ label: entry.label, snapshot: cloneProjectSnapshot(current) }, ...history.future],
    },
  };
};

export const redoHistory = (
  history: ProjectHistory,
  current: ProjectSnapshot,
): { history: ProjectHistory; snapshot: ProjectSnapshot; label: string } | null => {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    snapshot: cloneProjectSnapshot(entry.snapshot),
    label: entry.label,
    history: {
      past: [...history.past, { label: entry.label, snapshot: cloneProjectSnapshot(current) }].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    },
  };
};
