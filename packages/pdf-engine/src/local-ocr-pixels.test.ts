import { describe, expect, it } from 'vitest';
import { encodeOcrPixels } from './local-ocr-pixels.js';
describe('OCR-001 controlled native raster', () => {
  it('emits only a fixed P6 header and bounded RGB pixels, composited on white', () => {
    const result = encodeOcrPixels(
      2,
      1,
      new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]),
      new AbortController().signal,
    );
    expect(new TextDecoder().decode(result.subarray(0, 11))).toBe('P6\n2 1\n255\n');
    expect([...result.subarray(11)]).toEqual([1, 2, 3, 255, 255, 255]);
  });
  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [1.5, 1],
    [20_000_001, 1],
    [Infinity, 1],
    [NaN, 1],
  ])('rejects unsafe dimensions %s %s', (width, height) => {
    expect(() =>
      encodeOcrPixels(width, height, new Uint8ClampedArray(), new AbortController().signal),
    ).toThrow('OCR_PAGE_PIXEL_LIMIT');
  });
  it('rejects truncated pixel buffers and cancellation before allocation', () => {
    expect(() =>
      encodeOcrPixels(1, 1, new Uint8ClampedArray(3), new AbortController().signal),
    ).toThrow('OCR_IMAGE_FAILED');
    const controller = new AbortController();
    controller.abort();
    expect(() => encodeOcrPixels(1, 1, new Uint8ClampedArray(4), controller.signal)).toThrow(
      'OCR_CANCELLED',
    );
  });
});
