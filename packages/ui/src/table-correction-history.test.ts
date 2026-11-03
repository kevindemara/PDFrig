import { describe, expect, it } from 'vitest';
import {
  createTableHistory,
  commitTableCorrection,
  undoTableCorrection,
  redoTableCorrection,
  TABLE_HISTORY_LIMIT,
  TABLE_HISTORY_UNITS,
  type TableGrid,
} from './table-correction-history.js';
const grid: TableGrid = {
  rows: [
    ['Code', 'Value'],
    ['001', '12.50'],
  ],
  types: ['text', 'auto'],
  uncertain: ['1:1'],
  header: true,
};
describe('CONV-007 bounded correction history', () => {
  it('groups typing, restores exact cell text/types/uncertainty and drops redo on a new edit', () => {
    const initial = createTableHistory(grid);
    let h = commitTableCorrection(
      initial,
      {
        rows: [
          ['Code', 'Value'],
          ['001', '13'],
        ],
      },
      'cell:1:1',
    );
    h = commitTableCorrection(
      h,
      {
        rows: [
          ['Code', 'Value'],
          ['001', '13.50'],
        ],
      },
      'cell:1:1',
    );
    expect(h.past).toHaveLength(1);
    const edited = h.present;
    h = undoTableCorrection(h);
    expect(h.present).toBe(grid);
    expect(redoTableCorrection(h).present).toBe(edited);
    h = commitTableCorrection(h, { header: false });
    expect(h.future).toHaveLength(0);
    expect(redoTableCorrection(h)).toBe(h);
    expect(initial.present.rows[1]?.[1]).toBe('12.50');
  });
  it('bounds history depth and large-snapshot retention, and resets at extraction boundaries', () => {
    let h = createTableHistory(grid);
    for (let i = 0; i < 80; i++) h = commitTableCorrection(h, { header: i % 2 === 0 });
    expect(h.past).toHaveLength(TABLE_HISTORY_LIMIT);
    const huge = { ...grid, rows: [['x'.repeat(TABLE_HISTORY_UNITS + 1)]] };
    h = commitTableCorrection(createTableHistory(huge), { rows: [['small']] });
    expect(h.past).toHaveLength(0);
    expect(undoTableCorrection(h)).toBe(h);
    h = createTableHistory(grid);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
  });
});
