import { describe, expect, it } from 'vitest';
import { assertOcrPixels, encodeOcrPixels } from './local-ocr-pixels.js';
describe('OCR-001 controlled native raster', () => {
  it('emits only a fixed P6 header and bounded RGB pixels, composited on white', () => {
    const result = encodeOcrPixels(
      2,
      1,
      new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]),
      new AbortController().signal,
    );
    expect(new TextDecoder().decode(result.subarray(0, -6))).toBe(
      `P6\n${' '.repeat(512)}2 1\n255\n`,
    );
    expect([...result.subarray(-6)]).toEqual([1, 2, 3, 255, 255, 255]);
    expect(() => assertOcrPixels(result)).not.toThrow();
  });
  it('accepts only the canonical bounded P6 format, with no comments, extra bytes or alternate sample depth', () => {
    for (const header of [
      'P3\n1 1\n255\n',
      'P6\n01 1\n255\n',
      'P6\n1 1\n65535\n',
      'P6\n#comment\n1 1\n255\n',
      'P6\n-1 1\n255\n',
      'P6\n1.0 1\n255\n',
      'P6\n20000001 1\n255\n',
      'P6\n1 1\n255\nextra',
    ]) {
      const bytes = new TextEncoder().encode(header + '\0\0\0');
      expect(() => assertOcrPixels(bytes)).toThrow('OCR_IMAGE_FAILED');
    }
    const image = encodeOcrPixels(1, 1, new Uint8ClampedArray(4), new AbortController().signal);
    expect(() => assertOcrPixels(image.subarray(0, image.length - 1))).toThrow('OCR_IMAGE_FAILED');
    expect(() => assertOcrPixels(new Uint8Array([...image, 0]))).toThrow('OCR_IMAGE_FAILED');
    if (typeof SharedArrayBuffer !== 'undefined') {
      const shared = new Uint8Array(new SharedArrayBuffer(image.length));
      shared.set(image);
      expect(() => assertOcrPixels(shared)).toThrow('OCR_IMAGE_FAILED');
    }
  });
  it('deterministic header mutation corpus is refused without entering native code', () => {
    const image = encodeOcrPixels(2, 1, new Uint8ClampedArray(8), new AbortController().signal);
    // Exhaust each byte value at each canonical header position. Only unchanged
    // headers can retain both dimensions and this exact bounded raster length.
    for (const offset of [0, 1, 2, 3, 514, 515, 516, 517, 518, 519, 520, 521, 522])
      for (let byte = 0; byte < 256; byte++) {
        const mutated = image.slice();
        mutated[offset] = byte;
        if (byte === image[offset]) expect(() => assertOcrPixels(mutated)).not.toThrow();
        else expect(() => assertOcrPixels(mutated)).toThrow('OCR_IMAGE_FAILED');
      }
  });
  it('preserves RGB bytes while keeping pixel-forged EXIF orientation out of the worker probe', () => {
    const pixels = new Uint8ClampedArray([1, 18, 0, 255, 3, 0, 0, 255, 0, 1, 0, 255, 6, 0, 0, 255]);
    const image = encodeOcrPixels(4, 1, pixels, new AbortController().signal);
    expect([...image.subarray(-12)]).toEqual([1, 18, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0]);
    expect(image.slice(0, 500).join(' ')).not.toMatch(/1 18 0 3 0 0 0 1 0 (\d)/u);
    expect(() => assertOcrPixels(image)).not.toThrow();
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
