import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { measureDecorationTextAreas } from './decoration-text-areas.js';
import { reviewDecorationPlacement } from './decoration-placement.js';
import type { PdfDecorationOptions } from './decoration-options.js';

const defaultHeader = {
  text: 'Review {page}/{pages}',
  alignment: 'left',
  fontSize: 9,
  color: '#17232d',
} as const;
const options: PdfDecorationOptions = {
  header: defaultHeader,
  footer: null,
  watermark: null,
  marginPoints: 28,
  pageSelection: 'all',
};
const page = { width: 612, height: 792 };
const raster = () => ({
  width: 612,
  height: 792,
  data: new Uint8ClampedArray(612 * 792 * 4).fill(255),
});
const paint = (image: ReturnType<typeof raster>, x: number, y: number, gray = 0) => {
  for (let offset = 0; offset < 3; offset++)
    image.data.set([gray, gray, gray, 255], (y * image.width + x + offset) * 4);
};

describe('EDIT-006 estimated text-area placement hints', () => {
  it('uses the export font metrics, normalized text, actual page tokens, alignment and guard', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    for (const alignment of ['left', 'center', 'right'] as const) {
      const header = { ...defaultHeader, alignment, text: '  AV {page}/{pages}\n  ' };
      const result = await measureDecorationTextAreas(page, { ...options, header }, 12, 123);
      const area = result[0];
      if (area === undefined) throw new Error('Missing synthetic header area');
      const width = Array.from('AV 12/123').reduce(
        (total, character) => total + font.widthOfTextAtSize(character, 9),
        0,
      );
      const left =
        alignment === 'left' ? 28 : alignment === 'center' ? (612 - width) / 2 : 612 - 28 - width;
      expect(area.left).toBeCloseTo((left - 2) / 612, 12);
      expect(area.right).toBeCloseTo((left + width + 2) / 612, 12);
      expect(area.top).toBeCloseTo((28 - 9 - 2) / 792, 12);
      expect(Object.keys(area).sort()).toEqual(['bottom', 'kind', 'left', 'right', 'top']);
    }
  });
  it('uses visible dimensions for rotation/cropping and keeps footer descent in bounds', async () => {
    const footer = { ...defaultHeader, alignment: 'right' as const };
    for (const dimensions of [page, { width: 792, height: 612 }, { width: 540, height: 720 }]) {
      const result = await measureDecorationTextAreas(
        dimensions,
        { ...options, header: null, footer },
        1,
        11,
      );
      expect(result[0]?.right).toBeCloseTo(1 - 26 / dimensions.width, 12);
      expect(result[0]?.bottom).toBeLessThan(1);
      expect(result[0]?.top).toBeGreaterThan(0.9);
    }
  });
  it('retains broad warnings while distinguishing near-text and elsewhere ink', async () => {
    const areas = await measureDecorationTextAreas(page, options, 1, 11);
    const image = raster();
    paint(image, 520, 24);
    const review = () => reviewDecorationPlacement(image, page, options, areas);
    expect(review()).toMatchObject({
      bands: [
        { finding: 'ink-detected', textArea: { status: 'sampled', finding: 'no-ink-detected' } },
      ],
    });
    paint(image, 30, 24);
    expect(review()).toMatchObject({ bands: [{ textArea: { finding: 'ink-detected' } }] });
  });
  it('keeps intentional-background positives and faint-content misses explicit', async () => {
    const areas = await measureDecorationTextAreas(page, options, 1, 11);
    const image = raster();
    paint(image, 30, 24, 245);
    expect(reviewDecorationPlacement(image, page, options, areas)).toMatchObject({
      bands: [{ textArea: { finding: 'no-ink-detected' } }],
    });
    image.data.fill(200);
    expect(reviewDecorationPlacement(image, page, options, areas)).toMatchObject({
      bands: [{ textArea: { finding: 'ink-detected' } }],
    });
  });
  it('reports missing/duplicate/invalid text-area metrics as unavailable, not a negative', async () => {
    const areas = await measureDecorationTextAreas(page, options, 1, 11);
    const area = areas[0];
    if (area === undefined) throw new Error('Missing synthetic header area');
    for (const invalid of [
      [],
      [area, area],
      [area, area, area],
      [{ ...area, left: NaN }],
      [{ ...area, right: 2 }],
      [{ ...area, top: 0 }],
      [{ ...area, left: 0.9, right: 0.8 }],
    ]) {
      expect(reviewDecorationPlacement(raster(), page, options, invalid)).toMatchObject({
        bands: [{ textArea: { status: 'unavailable' } }],
      });
    }
  });
  it('rejects invalid context, unsupported text and clipping; skips unselected/watermark-only pages', async () => {
    await expect(measureDecorationTextAreas(page, options, 0, 11)).rejects.toThrow(
      'DECORATION_PAGE_RANGE_INVALID',
    );
    await expect(measureDecorationTextAreas(page, options, 1, 501)).rejects.toThrow(
      'DECORATION_PAGE_LIMIT',
    );
    await expect(
      measureDecorationTextAreas({ width: 3000, height: 3000 }, options, 1, 11),
    ).rejects.toThrow('DECORATION_PAGE_BOX_UNSUPPORTED');
    await expect(
      measureDecorationTextAreas(
        page,
        { ...options, header: { ...defaultHeader, text: '☃' } },
        1,
        11,
      ),
    ).rejects.toThrow('DECORATION_TEXT_ENCODING_UNSUPPORTED');
    await expect(
      measureDecorationTextAreas(
        page,
        { ...options, header: { ...defaultHeader, text: 'W'.repeat(120), fontSize: 24 } },
        1,
        11,
      ),
    ).rejects.toThrow('DECORATION_TEXT_DOES_NOT_FIT');
    expect(
      await measureDecorationTextAreas(page, { ...options, pageSelection: 'first' }, 2, 11),
    ).toEqual([]);
    expect(
      await measureDecorationTextAreas(
        page,
        {
          ...options,
          header: null,
          watermark: { text: 'DRAFT', fontSize: 48, color: '#17232d', opacity: 0.16, rotation: 0 },
        },
        1,
        11,
      ),
    ).toEqual([]);
  });
});
