import type { TableColumnType } from '@pdfmason/pdf-engine/browser';

/** CONV-007: correction history is in memory only and never restores export approval. */
export interface TableGrid {
  readonly rows: readonly (readonly string[])[];
  readonly types: readonly TableColumnType[];
  readonly uncertain: readonly string[];
  readonly header: boolean;
}
export interface TableHistory {
  readonly present: TableGrid;
  readonly past: readonly TableGrid[];
  readonly future: readonly TableGrid[];
  readonly group: string | null;
}
export const TABLE_HISTORY_LIMIT = 50;
export const TABLE_HISTORY_UNITS = 2_000_000;
const units = (grid: TableGrid) =>
  grid.rows.reduce(
    (sum, row) => sum + row.reduce((total, text) => total + text.length + 1, 0),
    grid.uncertain.length + grid.types.length,
  );
export const createTableHistory = (present: TableGrid): TableHistory => ({
  present,
  past: [],
  future: [],
  group: null,
});
function bounded(history: TableHistory): TableHistory {
  const past = [...history.past],
    future = [...history.future];
  let size = [...past, ...future].reduce((sum, grid) => sum + units(grid), 0);
  while (past.length + future.length > TABLE_HISTORY_LIMIT || size > TABLE_HISTORY_UNITS) {
    const removed = past.length ? past.shift() : future.pop();
    if (!removed) break;
    size -= units(removed);
  }
  return { ...history, past, future };
}
export function commitTableCorrection(
  history: TableHistory,
  patch: Partial<TableGrid>,
  group: string | null = null,
): TableHistory {
  const next = { ...history.present, ...patch };
  if (
    Object.entries(patch).every(([key, value]) => history.present[key as keyof TableGrid] === value)
  )
    return history;
  return bounded({
    present: next,
    past:
      group !== null && group === history.group ? history.past : [...history.past, history.present],
    future: [],
    group,
  });
}
export function undoTableCorrection(history: TableHistory): TableHistory {
  const present = history.past.at(-1);
  return present
    ? bounded({
        present,
        past: history.past.slice(0, -1),
        future: [history.present, ...history.future],
        group: null,
      })
    : history;
}
export function redoTableCorrection(history: TableHistory): TableHistory {
  const present = history.future[0];
  return present
    ? bounded({
        present,
        past: [...history.past, history.present],
        future: history.future.slice(1),
        group: null,
      })
    : history;
}
