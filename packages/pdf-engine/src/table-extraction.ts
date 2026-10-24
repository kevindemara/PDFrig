import type { NormalizedRect } from '@pdfmason/editor-core';

/** CONV-007: geometry is a suggestion, never proof of a table's correctness. */
export const TABLE_LIMITS = Object.freeze({
  words: 10_000,
  rows: 500,
  columns: 40,
  cells: 20_000,
  cellText: 2_000,
  text: 1_000_000,
  outputBytes: 8 * 1024 * 1024,
});
export interface TableWord extends NormalizedRect {
  readonly text: string;
  readonly confidence?: number;
}
export interface ExtractedTable {
  readonly rows: readonly (readonly string[])[];
  readonly columns: readonly number[];
  readonly rowBreaks: readonly number[];
  readonly uncertainCells: readonly string[];
}
export type TableColumnType =
  'auto' | 'text' | 'number-dot' | 'number-comma' | 'percent-dot' | 'percent-comma';
export type TableValue = string | number | null;
export const TABLE_MIME = Object.freeze({
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
});
// Boolean wrapper preserves readonly element types during runtime admission.
export const isTableArray = (value: unknown): boolean => Array.isArray(value);
export function invalidTableText(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      return true;
  }
  return false;
}

export function assertTableRegion(region: NormalizedRect): void {
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1.000001 ||
    region.y + region.height > 1.000001
  )
    throw new Error('TABLE_REGION_INVALID');
}
export function parseTableBreaks(input: string): readonly number[] {
  if (input.length > 5000) throw new Error('TABLE_GUIDES_INVALID');
  if (!input.trim()) return [];
  const parts = input.split(',');
  if (parts.length >= TABLE_LIMITS.rows || parts.some((p) => !/^\s*\d+(?:\.\d+)?\s*$/u.test(p)))
    throw new Error('TABLE_GUIDES_INVALID');
  const values = parts.map((p) => Number(p) / 100);
  if (values.some((v, i) => v <= 0 || v >= 1 || (i > 0 && v <= (values[i - 1] ?? 0))))
    throw new Error('TABLE_GUIDES_INVALID');
  return values;
}
function assertWords(words: readonly TableWord[]): void {
  if (!isTableArray(words) || words.length > TABLE_LIMITS.words)
    throw new Error('TABLE_WORD_LIMIT');
  let count = 0;
  for (const word of words) {
    assertTableRegion(word);
    if (
      typeof word.text !== 'string' ||
      word.text.length > TABLE_LIMITS.cellText ||
      invalidTableText(word.text) ||
      (word.confidence !== undefined &&
        (!Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 100))
    )
      throw new Error('TABLE_WORD_INVALID');
    count += word.text.length;
  }
  if (count > TABLE_LIMITS.text) throw new Error('TABLE_TEXT_LIMIT');
}
export function extractTable(
  words: readonly TableWord[],
  region: NormalizedRect,
  columnBreaks?: readonly number[],
  rowBreaks?: readonly number[],
): ExtractedTable {
  assertWords(words);
  assertTableRegion(region);
  const chosen = words
    .filter(
      (w) =>
        w.text.trim() &&
        w.x + w.width / 2 >= region.x &&
        w.x + w.width / 2 <= region.x + region.width &&
        w.y + w.height / 2 >= region.y &&
        w.y + w.height / 2 <= region.y + region.height,
    )
    .sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2 || a.x - b.x);
  if (!chosen.length) throw new Error('TABLE_NO_TEXT');
  const groups: TableWord[][] = [];
  for (const word of chosen) {
    const row = groups.at(-1),
      anchor = row?.[0];
    if (
      anchor &&
      Math.abs(word.y + word.height / 2 - anchor.y - anchor.height / 2) <=
        Math.max(word.height, anchor.height) * 0.55
    )
      row.push(word);
    else groups.push([word]);
  }
  groups.forEach((row) => row.sort((a, b) => a.x - b.x));
  const runs = groups.map((row) => {
    const values: { x: number; end: number }[] = [];
    for (const word of row) {
      const previous = values.at(-1);
      if (previous && word.x - previous.end < Math.max(0.012, word.height * 0.75))
        previous.end = Math.max(previous.end, word.x + word.width);
      else values.push({ x: word.x, end: word.x + word.width });
    }
    return values;
  });
  const exemplar = runs.reduce(
    (best, row) => (row.length > best.length ? row : best),
    runs[0] ?? [],
  );
  const columns =
    columnBreaks ??
    exemplar
      .slice(1)
      .map((r, i) => ((r.x + (exemplar[i]?.end ?? r.x)) / 2 - region.x) / region.width);
  const rows =
    rowBreaks ??
    groups.slice(1).map((r, i) => {
      const before = groups[i]?.[0],
        after = r[0];
      return before && after
        ? ((before.y + before.height / 2 + after.y + after.height / 2) / 2 - region.y) /
            region.height
        : 0;
    });
  for (const breaks of [columns, rows])
    if (
      breaks.some(
        (v, i) => !Number.isFinite(v) || v <= 0 || v >= 1 || (i > 0 && v <= (breaks[i - 1] ?? 0)),
      )
    )
      throw new Error('TABLE_GUIDES_INVALID');
  if (
    columns.length >= TABLE_LIMITS.columns ||
    rows.length >= TABLE_LIMITS.rows ||
    (columns.length + 1) * (rows.length + 1) > TABLE_LIMITS.cells
  )
    throw new Error('TABLE_GRID_LIMIT');
  const buckets = Array.from({ length: rows.length + 1 }, () =>
    Array.from({ length: columns.length + 1 }, () => [] as TableWord[]),
  );
  const uncertain = new Set<string>();
  for (const word of chosen) {
    const cx = (word.x + word.width / 2 - region.x) / region.width,
      cy = (word.y + word.height / 2 - region.y) / region.height;
    const col = columns.filter((c) => c < cx - 1e-9).length,
      row = rows.filter((y) => y < cy - 1e-9).length;
    buckets[row]?.[col]?.push(word);
    if (
      (word.confidence !== undefined && word.confidence < 85) ||
      columns.some(
        (c) =>
          region.x + c * region.width > word.x && region.x + c * region.width < word.x + word.width,
      ) ||
      word.x < region.x ||
      word.x + word.width > region.x + region.width ||
      word.y < region.y ||
      word.y + word.height > region.y + region.height
    )
      uncertain.add(`${row}:${col}`);
  }
  const result = buckets.map((row) =>
    row.map((cell) => {
      cell.sort((a, b) =>
        Math.abs(a.y - b.y) < Math.max(a.height, b.height) * 0.55 ? a.x - b.x : a.y - b.y,
      );
      let text = '';
      let previous: TableWord | undefined;
      for (const word of cell) {
        const separator = previous
          ? Math.abs(word.y - previous.y) > Math.max(word.height, previous.height) * 0.55
            ? '\n'
            : word.x - (previous.x + previous.width) > Math.min(word.height, previous.height) * 0.12
              ? ' '
              : ''
          : '';
        text += separator + word.text.trim();
        previous = word;
      }
      if (text.length > TABLE_LIMITS.cellText) throw new Error('TABLE_CELL_LIMIT');
      return text;
    }),
  );
  return {
    rows: result,
    columns: [...columns],
    rowBreaks: [...rows],
    uncertainCells: [...uncertain],
  };
}

export function tableCellValue(raw: string, type: TableColumnType): TableValue {
  if (typeof raw !== 'string' || raw.length > TABLE_LIMITS.cellText || invalidTableText(raw))
    throw new Error('TABLE_CELL_INVALID');
  if (
    !['auto', 'text', 'number-dot', 'number-comma', 'percent-dot', 'percent-comma'].includes(type)
  )
    throw new Error('TABLE_TYPE_INVALID');
  const text = raw.trim();
  if (!text) return null;
  if (type === 'text') return raw;
  if (type === 'auto') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text) || text.replace(/[^0-9]/gu, '').length > 15)
      return raw;
    return Number.isFinite(Number(text)) ? Number(text) : raw;
  }
  const comma = type.endsWith('comma'),
    percent = type.startsWith('percent');
  const input = percent ? text.replace(/%$/u, '').trim() : text;
  const valid = comma
    ? /^-?(?:(?:0|[1-9]\d*)|(?:[1-9]\d{0,2}(?:[.\u00a0\u202f ]\d{3})+))(?:,\d+)?$/u
    : /^-?(?:(?:0|[1-9]\d*)|(?:[1-9]\d{0,2}(?:,\d{3})+))(?:\.\d+)?$/u;
  if (!valid.test(input) || input.replace(/[^0-9]/gu, '').length > 15)
    throw new Error('TABLE_NUMBER_INVALID');
  const value =
    Number(
      comma ? input.replace(/[.\u00a0\u202f ]/gu, '').replace(',', '.') : input.replace(/,/gu, ''),
    ) / (percent ? 100 : 1);
  if (!Number.isFinite(value)) throw new Error('TABLE_NUMBER_INVALID');
  return value;
}
export function tableValues(
  rows: readonly (readonly string[])[],
  types: readonly TableColumnType[],
  header: boolean,
): readonly (readonly TableValue[])[] {
  if (
    !rows.length ||
    rows.length > TABLE_LIMITS.rows ||
    !types.length ||
    types.length > TABLE_LIMITS.columns ||
    rows.length * types.length > TABLE_LIMITS.cells
  )
    throw new Error('TABLE_GRID_LIMIT');
  let text = 0;
  return rows.map((row, r) => {
    if (row.length !== types.length) throw new Error('TABLE_GRID_INVALID');
    return row.map((value, c) => {
      text += typeof value === 'string' ? value.length : TABLE_LIMITS.text + 1;
      if (text > TABLE_LIMITS.text) throw new Error('TABLE_TEXT_LIMIT');
      return tableCellValue(value, header && r === 0 ? 'text' : (types[c] ?? 'text'));
    });
  });
}
