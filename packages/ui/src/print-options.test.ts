import { describe, expect, it } from 'vitest';

import {
  PRINT_LIMITS,
  resolvePrintPageIndices,
  validatePrintPixelBudget,
} from './print-options.js';

describe('PRINT-001 options', () => {
  it('resolves all pages and sorted comma/range selections', () => {
    expect(resolvePrintPageIndices({ pageRange: 'all', resolution: 2 }, 3)).toEqual([0, 1, 2]);
    expect(resolvePrintPageIndices({ pageRange: '5, 1-2', resolution: 3 }, 5)).toEqual([0, 1, 4]);
  });

  it.each(['', '0', '3-2', '1-3,3', '1,,2', '6', '1-'])('rejects unsafe range %j', (pageRange) => {
    expect(() => resolvePrintPageIndices({ pageRange, resolution: 2 }, 5)).toThrow(
      'PRINT_RANGE_INVALID',
    );
  });

  it('enforces document, selection, and exact option boundaries', () => {
    expect(
      resolvePrintPageIndices({ pageRange: `1-${PRINT_LIMITS.maximumPages}`, resolution: 2 }, 500),
    ).toHaveLength(PRINT_LIMITS.maximumPages);
    expect(() =>
      resolvePrintPageIndices(
        { pageRange: `1-${PRINT_LIMITS.maximumPages + 1}`, resolution: 2 },
        500,
      ),
    ).toThrow('PRINT_PAGE_LIMIT');
    expect(() => resolvePrintPageIndices({ pageRange: 'all', resolution: 2 }, 500)).toThrow(
      'PRINT_PAGE_LIMIT',
    );
    expect(() => resolvePrintPageIndices({ pageRange: '1', resolution: 2 }, 501)).toThrow(
      'PRINT_OPTIONS_INVALID',
    );
    expect(() => resolvePrintPageIndices({ pageRange: '1', resolution: 4 } as never, 1)).toThrow(
      'PRINT_OPTIONS_INVALID',
    );
  });

  it('bounds the aggregate raster memory retained for the native dialog', () => {
    expect(() => validatePrintPixelBudget([{ width: 612, height: 792 }], 3)).not.toThrow();
    expect(() =>
      validatePrintPixelBudget(
        Array.from({ length: 26 }, () => ({ width: 612, height: 792 })),
        2,
      ),
    ).toThrow('PRINT_PIXEL_BUDGET');
  });
  it.each(
    [
      [],
      [{ width: -10, height: -20 }],
      [{ width: 0, height: 100 }],
      [{ width: Infinity, height: 100 }],
      [{ width: NaN, height: 100 }],
      [{ width: 0.1, height: 0.1 }],
      [{ width: 3000, height: 3000 }],
      [{ width: 9000, height: 1 }],
      Array.from({ length: 51 }, () => ({ width: 1, height: 1 })),
    ].map((pages) => ({ pages })),
  )('rejects malformed, excessive or per-page over-budget geometry %j', ({ pages }) => {
    expect(() => validatePrintPixelBudget(pages, 2)).toThrow('PRINT_PIXEL_BUDGET');
  });
});
