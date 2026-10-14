import { describe, expect, it } from 'vitest';
import { reviewDecorationPlacement } from './decoration-placement.js';
import type { PdfDecorationOptions } from './decoration-options.js';

const options: PdfDecorationOptions = {
  header: { text: 'Review', alignment: 'left', fontSize: 9, color: '#17232d' },
  footer: { text: '{page}', alignment: 'right', fontSize: 9, color: '#17232d' },
  marginPoints: 28,
  pageSelection: 'all',
  watermark: null,
};
const page = { width: 100, height: 100 };
const raster = (gray = 255) => ({
  width: 100,
  height: 100,
  data: new Uint8ClampedArray(40_000).fill(gray),
});
const paint = (
  image: ReturnType<typeof raster>,
  x: number,
  y: number,
  gray: number,
  alpha = 255,
) => {
  image.data.set([gray, gray, gray, alpha], (y * image.width + x) * 4);
  image.data.set([gray, gray, gray, alpha], (y * image.width + x + 1) * 4);
};
describe('EDIT-006 conservative source-ink warnings', () => {
  it('reports sampled bands, never a safe-placement verdict', () => {
    const result = reviewDecorationPlacement(raster(), page, options);
    expect(result).toMatchObject({
      status: 'sampled',
      bands: [
        { kind: 'header', top: 0.17, bottom: 0.336, finding: 'no-ink-detected' },
        {
          kind: 'footer',
          top: 0.61,
          finding: 'no-ink-detected',
        },
      ],
    });
    if (result.status !== 'sampled') throw new Error('Expected sampled bands');
    expect(result.bands[1]?.bottom).toBeCloseTo(0.776, 10);
  });
  it('detects visible text/image/vector/form-like pixels in either band, but not central ink', () => {
    const image = raster();
    paint(image, 30, 20, 0);
    paint(image, 50, 69, 0);
    expect(reviewDecorationPlacement(image, page, options)).toMatchObject({
      bands: [{ finding: 'ink-detected' }, { finding: 'ink-detected' }],
    });
    const central = raster();
    paint(central, 30, 50, 0);
    expect(reviewDecorationPlacement(central, page, options)).toMatchObject({
      bands: [{ finding: 'no-ink-detected' }, { finding: 'no-ink-detected' }],
    });
  });
  it('documents false positives from full-width bands and intentional backgrounds', () => {
    const outsideGlyph = raster();
    paint(outsideGlyph, 95, 20, 0);
    expect(reviewDecorationPlacement(outsideGlyph, page, options)).toMatchObject({
      bands: [{ finding: 'ink-detected' }, { finding: 'no-ink-detected' }],
    });
    expect(reviewDecorationPlacement(raster(180), page, options)).toMatchObject({
      bands: [{ finding: 'ink-detected' }, { finding: 'ink-detected' }],
    });
  });
  it('documents false negatives from faint, transparent, and isolated sub-threshold ink', () => {
    const image = raster();
    paint(image, 20, 20, 240);
    paint(image, 25, 20, 0, 0);
    image.data.set([0, 0, 0, 255], (20 * 100 + 40) * 4);
    expect(reviewDecorationPlacement(image, page, options)).toMatchObject({
      bands: [{ finding: 'no-ink-detected' }, { finding: 'no-ink-detected' }],
    });
    paint(image, 20, 20, 231);
    expect(reviewDecorationPlacement(image, page, options)).toMatchObject({
      bands: [{ finding: 'ink-detected' }, { finding: 'no-ink-detected' }],
    });
  });
  it('returns unavailable instead of reassuring users about invalid geometry, size, pixels, or resolution', () => {
    expect(reviewDecorationPlacement(raster(), { width: NaN, height: 100 }, options)).toMatchObject(
      { status: 'unavailable' },
    );
    expect(
      reviewDecorationPlacement(raster(), { width: 2049, height: 100 }, options),
    ).toMatchObject({ reason: 'geometry' });
    expect(reviewDecorationPlacement({ ...raster(), width: 2049 }, page, options)).toMatchObject({
      reason: 'pixel-limit',
    });
    expect(
      reviewDecorationPlacement({ ...raster(), data: new Uint8ClampedArray(1) }, page, options),
    ).toMatchObject({ reason: 'pixels' });
    expect(reviewDecorationPlacement(raster(), { width: 200, height: 200 }, options)).toMatchObject(
      { reason: 'resolution' },
    );
    expect(reviewDecorationPlacement(raster(), { width: 99, height: 80 }, options)).toMatchObject({
      reason: 'resolution',
    });
  });
  it('checks only configured headers/footers and never labels watermarks as checked', () => {
    expect(reviewDecorationPlacement(raster(), page, { ...options, footer: null })).toMatchObject({
      bands: [{ kind: 'header' }],
    });
    expect(
      reviewDecorationPlacement(raster(), page, {
        ...options,
        header: null,
        footer: null,
        watermark: { text: 'DRAFT', color: '#17232d', fontSize: 48, opacity: 0.16, rotation: 0 },
      }),
    ).toEqual({ status: 'not-applicable' });
    expect(() =>
      reviewDecorationPlacement(raster(), page, { ...options, marginPoints: Infinity }),
    ).toThrow('DECORATION_OPTIONS_INVALID');
  });
});
