import { describe, expect, it } from 'vitest';

import {
  isPdfImageRenderOptions,
  resolvePdfImagePages,
  validatePdfImagePixelCount,
  type PdfImageRenderOptions,
} from './pdf-image-options.js';

const options: PdfImageRenderOptions = {
  format: 'png',
  jpegQuality: 0.92,
  pageRange: 'all',
  scale: 2,
  transparentBackground: true,
};

describe('PDF page-image options', () => {
  it('resolves all or ordered explicit ranges to zero-based page indices', () => {
    expect(resolvePdfImagePages(options, 3)).toEqual([0, 1, 2]);
    expect(resolvePdfImagePages({ ...options, pageRange: '5, 1-3' }, 5)).toEqual([0, 1, 2, 4]);
  });

  it('allows a bounded selection from a larger document', () => {
    expect(resolvePdfImagePages({ ...options, pageRange: '451-500' }, 500)).toHaveLength(50);
    expect(() => resolvePdfImagePages(options, 51)).toThrow('UTILITY_RENDER_PAGE_LIMIT');
  });

  it.each(['', '0', '2-1', '1,1', '1-2,2', '4', '1-', 'all,2'])(
    'rejects invalid or duplicate page range %j',
    (pageRange) => {
      expect(() => resolvePdfImagePages({ ...options, pageRange }, 3)).toThrow(
        'UTILITY_RENDER_PAGE_RANGE_INVALID',
      );
    },
  );

  it('caps selected pages and validates the exact option boundary', () => {
    expect(() => resolvePdfImagePages({ ...options, pageRange: '1-51' }, 100)).toThrow(
      'UTILITY_RENDER_PAGE_LIMIT',
    );
    expect(isPdfImageRenderOptions(options)).toBe(true);
    expect(isPdfImageRenderOptions({ ...options, scale: 4 })).toBe(false);
    expect(isPdfImageRenderOptions({ ...options, format: 'jpeg' })).toBe(false);
    expect(
      isPdfImageRenderOptions({ ...options, format: 'jpeg', transparentBackground: false }),
    ).toBe(true);
    expect(isPdfImageRenderOptions({ ...options, unexpected: true })).toBe(false);
  });

  it('bounds rendered dimensions and pixels before allocating a canvas', () => {
    expect(() => validatePdfImagePixelCount(612, 792, 3)).not.toThrow();
    expect(() => validatePdfImagePixelCount(10_000, 10_000, 1)).toThrow(
      'UTILITY_RENDER_PIXELS_LIMIT',
    );
    expect(() => validatePdfImagePixelCount(20_000, 1, 1)).toThrow('UTILITY_RENDER_PIXELS_LIMIT');
    expect(() => validatePdfImagePixelCount(Number.NaN, 792, 1)).toThrow(
      'UTILITY_RENDER_PIXELS_LIMIT',
    );
    expect(() => validatePdfImagePixelCount(612, 792, 4)).toThrow('UTILITY_RENDER_PIXELS_LIMIT');
  });
});
