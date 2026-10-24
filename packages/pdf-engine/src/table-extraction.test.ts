import { describe, expect, it } from 'vitest';
import {
  extractTable,
  parseTableBreaks,
  tableCellValue,
  tableValues,
  TABLE_LIMITS,
  type TableWord,
} from './table-extraction.js';
import { createTableWorkbook } from './table-workbook.js';
import { read, utils, type CellObject } from 'xlsx';
const region = { x: 0, y: 0, width: 1, height: 1 };
const word = (text: string, x: number, y: number, width = 0.1): TableWord => ({
  text,
  x,
  y,
  width,
  height: 0.02,
});
const words = [
  word('Code', 0.1, 0.1),
  word('Value', 0.6, 0.1),
  word('001', 0.1, 0.2),
  word('12.5', 0.6, 0.2),
  word('002', 0.1, 0.3),
  word('-2', 0.6, 0.3),
];
describe('CONV-007 bounded table suggestions', () => {
  it('groups cell text, infers columns and preserves numeric spelling', () => {
    const result = extractTable(words, region);
    expect(result.rows).toEqual([
      ['Code', 'Value'],
      ['001', '12.5'],
      ['002', '-2'],
    ]);
    expect(result.columns).toHaveLength(1);
  });
  it('ignores words outside the selection and preserves empty cells', () => {
    const result = extractTable(
      [...words, word('Outside', 0.1, 0.8)],
      { x: 0, y: 0, width: 1, height: 0.5 },
      [0.4],
      [0.3, 0.5],
    );
    expect(result.rows).toEqual([
      ['Code', 'Value'],
      ['001', '12.5'],
      ['002', '-2'],
    ]);
    expect(
      extractTable(
        [word('Code', 0.1, 0.1), word('Value', 0.6, 0.1), word('001', 0.1, 0.2)],
        region,
        [0.4],
      ).rows[1],
    ).toEqual(['001', '']);
  });
  it('joins fragmented glyphs and preserves spaces and explicit multiline cells', () => {
    const result = extractTable(
      [
        word('A', 0.1, 0.1, 0.01),
        word('B', 0.11, 0.1, 0.01),
        word('word', 0.14, 0.1, 0.05),
        word('next', 0.1, 0.2, 0.1),
      ],
      region,
      [],
      [],
    );
    expect(result.rows).toEqual([['AB word\nnext']]);
  });
  it('marks low OCR confidence and text crossing a column boundary', () => {
    const result = extractTable(
      [{ ...word('uncertain', 0.1, 0.1, 0.4), confidence: 40 }],
      region,
      [0.3],
    );
    expect(result.uncertainCells).toEqual(['0:0']);
  });
  it.each(['0', '100', '50, 20', 'NaN', '10,,20', '-1', '20,20'])(
    'rejects invalid guides %s',
    (input) => expect(() => parseTableBreaks(input)).toThrow('TABLE_GUIDES_INVALID'),
  );
  it('parses guides without accepting executable expressions', () => {
    expect(parseTableBreaks(' 20, 50.25 ')).toEqual([0.2, 0.5025]);
    expect(parseTableBreaks('')).toEqual([]);
  });
  it('refuses invalid geometry, over-limit grids, invalid text and no text', () => {
    expect(() => extractTable(words, { ...region, width: 2 })).toThrow('TABLE_REGION_INVALID');
    expect(() =>
      extractTable(
        words,
        region,
        Array.from({ length: 40 }, (_, i) => (i + 1) / 41),
      ),
    ).toThrow('TABLE_GRID_LIMIT');
    expect(() => extractTable([word('bad\u0000', 0.1, 0.1)], region)).toThrow('TABLE_WORD_INVALID');
    expect(() => extractTable([], region)).toThrow('TABLE_NO_TEXT');
    expect(() =>
      extractTable(
        Array.from({ length: TABLE_LIMITS.words + 1 }, () => word('Code', 0.1, 0.1)),
        region,
      ),
    ).toThrow('TABLE_WORD_LIMIT');
  });
});
describe('CONV-007 explicit safe cell typing', () => {
  it.each([
    ['12.50', 12.5],
    ['-12', -12],
    ['0', 0],
    ['00127', '00127'],
    ['1,234', '1,234'],
    ['1/2/26', '1/2/26'],
    ['1234567890123456', '1234567890123456'],
    ['=SUM(A1:A4)', '=SUM(A1:A4)'],
    ['@SUM(1,2)', '@SUM(1,2)'],
    ['', ''],
  ])('auto types %s conservatively', (input, expected) => {
    expect(tableCellValue(input, 'auto')).toBe(expected === '' ? null : expected);
  });
  it('exports explicitly selected locale values and percentages as numbers', () => {
    expect(tableCellValue('1,234.56', 'number-dot')).toBe(1234.56);
    expect(tableCellValue('1.234,56', 'number-comma')).toBe(1234.56);
    expect(tableCellValue('1\u202f234,56', 'number-comma')).toBe(1234.56);
    expect(tableCellValue('12,5%', 'percent-comma')).toBe(0.125);
  });
  it.each(['12,3,4', '1.2.3', 'NaN', 'Infinity', '=1+1', '1234567890123456'])(
    'refuses malformed numeric value %s',
    (value) => expect(() => tableCellValue(value, 'number-dot')).toThrow('TABLE_NUMBER_INVALID'),
  );
  it('keeps headers as literal text and blank cells as blank, not zero', () => {
    expect(
      tableValues(
        [
          ['2026', 'Total'],
          ['001', '12.50'],
          ['', ''],
        ],
        ['text', 'auto'],
        true,
      ),
    ).toEqual([
      ['2026', 'Total'],
      ['001', 12.5],
      [null, null],
    ]);
  });
});
describe.each(['xlsx', 'ods'] as const)('CONV-007 %s writer', (format) => {
  it('round-trips values and never creates a formula from PDF text', async () => {
    const rows = [
      ['Code', 'Amount', 'Literal'],
      ['00127', 12.5, '=HYPERLINK("https://example.invalid","x")'],
      ['002', -2, '<b>& text'],
      ['003', null, '@SUM(1,2)'],
    ];
    const bytes = await createTableWorkbook(rows, format, true);
    expect(bytes.length).toBeGreaterThan(100);
    const book = read(bytes, { type: 'array' }),
      sheet = book.Sheets['Extracted table'];
    if (!sheet) throw new Error('Missing sheet');
    expect(utils.sheet_to_json(sheet, { header: 1, defval: null })).toEqual(rows);
    expect((sheet.A2 as CellObject | undefined)?.t).toBe('s');
    expect((sheet.B2 as CellObject | undefined)?.t).toBe('n');
    expect((sheet.C2 as CellObject | undefined)?.f).toBeUndefined();
    expect((sheet.C2 as CellObject | undefined)?.l).toBeUndefined();
  });
  it('rejects arbitrary values, oversized cells and invalid numbers', async () => {
    await expect(createTableWorkbook([[NaN]], format, false)).rejects.toThrow('TABLE_CELL_INVALID');
    await expect(createTableWorkbook([['x'.repeat(2001)]], format, false)).rejects.toThrow(
      'TABLE_CELL_INVALID',
    );
    await expect(createTableWorkbook([['a'], ['b', 'c']], format, false)).rejects.toThrow(
      'TABLE_GRID_INVALID',
    );
  });
});
