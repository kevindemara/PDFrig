import {
  TABLE_LIMITS,
  isTableArray,
  invalidTableText,
  type TableValue,
} from './table-extraction.js';

import { normalizeOdsPackage } from './ods-package.js';

/** Export only: never pass document-derived strings to formula/HTML/link fields. */
export async function createTableWorkbook(
  rows: readonly (readonly TableValue[])[],
  format: 'xlsx' | 'ods',
  header: boolean,
): Promise<Uint8Array> {
  if (
    !['xlsx', 'ods'].includes(format) ||
    !isTableArray(rows) ||
    rows.length < 1 ||
    rows.length > TABLE_LIMITS.rows
  )
    throw new Error('TABLE_GRID_INVALID');
  const width = rows[0]?.length ?? 0;
  if (width < 1 || width > TABLE_LIMITS.columns || rows.length * width > TABLE_LIMITS.cells)
    throw new Error('TABLE_GRID_LIMIT');
  let length = 0;
  for (const row of rows) {
    if (!isTableArray(row) || row.length !== width) throw new Error('TABLE_GRID_INVALID');
    for (const value of row) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number')
        throw new Error('TABLE_CELL_INVALID');
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('TABLE_CELL_INVALID');
      if (typeof value === 'string') {
        if (value.length > TABLE_LIMITS.cellText || invalidTableText(value))
          throw new Error('TABLE_CELL_INVALID');
        length += value.length;
      }
    }
  }
  if (length > TABLE_LIMITS.text) throw new Error('TABLE_TEXT_LIMIT');
  const { utils, write } = await import('xlsx');
  const sheet = utils.aoa_to_sheet(
    rows.map((row: readonly TableValue[]) =>
      row.map((value: TableValue) =>
        value === null ? null : { t: typeof value === 'number' ? 'n' : 's', v: value },
      ),
    ),
  );
  sheet['!cols'] = Array.from({ length: width }, (_, c) => ({
    wch: Math.min(
      48,
      Math.max(
        14,
        ...rows.map(
          (row) =>
            String(row[c] ?? '')
              .split('\n')
              .reduce((n, s) => Math.max(n, s.length), 0) + 2,
        ),
      ),
    ),
  }));
  if (header && rows.length > 1)
    sheet['!autofilter'] = {
      ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: width - 1 } }),
    };
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, 'Extracted table');
  const output: unknown = write(workbook, {
    type: 'array',
    bookType: format,
    compression: format === 'xlsx',
  });
  if (!(output instanceof ArrayBuffer)) throw new Error('TABLE_OUTPUT_INVALID');
  const bytes = new Uint8Array(output);
  if (bytes.length > TABLE_LIMITS.outputBytes) throw new Error('TABLE_OUTPUT_LIMIT');
  return format === 'ods' ? normalizeOdsPackage(bytes) : bytes;
}
