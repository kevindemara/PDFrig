import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  BLANK_PAGE_SIZES,
  createBlankPdf,
  isBlankPdfOptions,
  type BlankPdfOptions,
} from './utilities.js';
import { parsePdfWorkerRequest } from './worker.js';

describe('CREATE-001 bounded multi-page blank output', () => {
  const base = { pageSize: 'letter', orientation: 'portrait', marginPoints: 36 } as const;

  it('preserves one-page defaults and verifies every page across sizes and orientations', async () => {
    expect((await PDFDocument.load(await createBlankPdf(base))).getPageCount()).toBe(1);
    for (const pageSize of ['a4', 'letter', 'legal'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const options = { ...base, pageSize, orientation, pageCount: 3 };
        const snapshot = { ...options };
        const output = await PDFDocument.load(await createBlankPdf(options), {
          updateMetadata: false,
        });
        const size = BLANK_PAGE_SIZES[pageSize];
        const width = orientation === 'portrait' ? size.width : size.height;
        const height = orientation === 'portrait' ? size.height : size.width;
        expect(output.getPageCount()).toBe(3);
        for (const page of output.getPages()) {
          expect(page.getMediaBox()).toEqual({ x: 0, y: 0, width, height });
          expect(page.getCropBox()).toEqual(page.getMediaBox());
          expect(page.getArtBox()).toEqual({
            x: 36,
            y: 36,
            width: width - 72,
            height: height - 72,
          });
          expect(page.node.Contents()).toBeUndefined();
          expect(page.node.Annots()).toBeUndefined();
        }
        expect(options).toEqual(snapshot);
        expect(output.getCreationDate()).toBeUndefined();
        expect(output.getModificationDate()).toBeUndefined();
      }
    }
  });

  it('accepts the inclusive 500-page boundary through the worker schema and engine', async () => {
    const options = { ...base, pageCount: 500 };
    expect(parsePdfWorkerRequest({ id: 'blank-max', kind: 'blank-pdf', options })).toMatchObject({
      options,
    });
    const output = await PDFDocument.load(await createBlankPdf(options));
    expect(output.getPageCount()).toBe(500);
    expect(output.getPages().every((page) => page.node.Contents() === undefined)).toBe(true);
  });

  it('rejects malformed, non-integer and excessive counts at both boundaries', async () => {
    for (const pageCount of [undefined, null, '3', 0, -1, 1.5, 501, NaN, Infinity]) {
      const options = { ...base, pageCount };
      expect(isBlankPdfOptions(options)).toBe(false);
      expect(() =>
        parsePdfWorkerRequest({ id: 'blank-invalid', kind: 'blank-pdf', options }),
      ).toThrow('request is invalid');
      await expect(createBlankPdf(options as unknown as BlankPdfOptions)).rejects.toThrow(
        'UTILITY_BLANK_OPTIONS_INVALID',
      );
    }
  });

  it('rejects extra or inherited required options without silently changing the contract', () => {
    expect(isBlankPdfOptions({ ...base, pageCount: 2, source: 'synthetic' })).toBe(false);
    expect(isBlankPdfOptions(Object.create(base))).toBe(false);
    expect(isBlankPdfOptions(Object.assign(Object.create({ pageCount: 50_000 }), base))).toBe(
      false,
    );
    expect(isBlankPdfOptions([])).toBe(false);
  });

  it('captures count and margins before asynchronous creation', async () => {
    const options = { ...base, pageCount: 3, marginPoints: 36 };
    const creating = createBlankPdf(options);
    options.pageCount = 501;
    options.marginPoints = 144;
    const output = await PDFDocument.load(await creating, { updateMetadata: false });
    expect(output.getPageCount()).toBe(3);
    expect(output.getPages().every((page) => page.getArtBox().x === 36)).toBe(true);
  });
});
