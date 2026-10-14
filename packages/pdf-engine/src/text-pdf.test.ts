import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { isTextPdfOptions, layoutTextPdf, textToPdf, TEXT_PDF_LIMITS } from './text-pdf.js';
import { parsePdfWorkerRequest } from './worker.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const options = { pageSize: 'letter' } as const;
describe('CONV-005 bounded plain-text PDF', () => {
  it('retains all printable ASCII, literal markup, spaces, blank/trailing lines and disclosed tabs', () => {
    const glyphs = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join(
      '',
    );
    const layout = layoutTextPdf(encode(`\uFEFF${glyphs}\r\n\r  <b>literal</b>\tX\n`), options);
    expect(layout.columns).toBe(75);
    expect(layout.rows).toBe(48);
    expect(layout.pages.flat().slice(0, 2).join('')).toBe(glyphs);
    expect(layout.pages.flat().slice(2)).toEqual(['', '  <b>literal</b>    X', '']);
    expect(Object.isFrozen(layout.pages[0])).toBe(true);
    expect(layoutTextPdf(encode('A'.repeat(74) + '\tZ'), options).pages.flat()).toEqual([
      'A'.repeat(74) + ' ',
      ' Z',
    ]);
    expect(layoutTextPdf(encode(' '), options).pages).toEqual([[' ']]);
  });
  it('wraps without trimming or hyphens and paginates on exact row boundaries', () => {
    const text = ' '.repeat(75) + 'x'.repeat(75) + 'end';
    expect(layoutTextPdf(encode(text), options).pages.flat().join('')).toBe(text);
    const plan = layoutTextPdf(
      encode(Array.from({ length: 49 }, (_, index) => `Row ${index}`).join('\n')),
      options,
    );
    expect(plan.pages.map((page) => page.length)).toEqual([48, 1]);
    expect(plan.pages[1]).toEqual(['Row 48']);
    expect(layoutTextPdf(encode('x'), { pageSize: 'a4' }).columns).toBe(72);
    expect(layoutTextPdf(encode('x'), { pageSize: 'a4' }).rows).toBe(51);
  });
  it('refuses invalid encoding, non-ASCII and undisclosed controls without content-bearing errors', async () => {
    for (const bytes of [
      new Uint8Array([0xc3, 0x28]),
      encode('secret café'),
      encode('secret 😀'),
      encode('secret\0'),
      encode('secret\f'),
      encode('secret\x7f'),
      encode('\uFEFF\uFEFFx'),
    ]) {
      await expect(textToPdf(bytes, options)).rejects.toThrow(
        /^UTILITY_TEXT_(ENCODING_INVALID|CHARACTER_UNSUPPORTED)$/u,
      );
    }
  });
  it('enforces inclusive byte and page bounds without truncation', () => {
    expect(
      layoutTextPdf(new Uint8Array(TEXT_PDF_LIMITS.maximumBytes).fill(65), options).pages.length,
    ).toBeLessThanOrEqual(500);
    expect(() => layoutTextPdf(new Uint8Array(TEXT_PDF_LIMITS.maximumBytes + 1), options)).toThrow(
      'UTILITY_TEXT_SIZE_LIMIT',
    );
    expect(() => layoutTextPdf(new Uint8Array(), options)).toThrow('UTILITY_TEXT_SIZE_LIMIT');
    expect(layoutTextPdf(encode('\n'.repeat(48 * 500 - 1)), options).pages.length).toBe(500);
    expect(() => layoutTextPdf(encode('\n'.repeat(48 * 500)), options)).toThrow(
      'UTILITY_TEXT_PAGE_LIMIT',
    );
    expect(() => layoutTextPdf(encode('\t'.repeat(500_000)), options)).toThrow(
      'UTILITY_TEXT_PAGE_LIMIT',
    );
  });
  it('validates exact worker shape and options, rejecting inherited, extra or coerced values', () => {
    const request = { id: 'text', kind: 'text-to-pdf', bytes: encode('test'), options };
    expect(parsePdfWorkerRequest(request)).toEqual(request);
    const invalidOptions: readonly unknown[] = [
      null,
      [],
      {},
      { pageSize: 'legal' },
      { pageSize: 'letter', font: 'unreviewed' },
      Object.create(options),
    ];
    for (const invalid of invalidOptions) {
      expect(isTextPdfOptions(invalid)).toBe(false);
      expect(() => parsePdfWorkerRequest({ ...request, options: invalid })).toThrow(
        'request is invalid',
      );
    }
    for (const bytes of [
      encode('x').buffer,
      new Uint8Array(),
      new Uint8Array(TEXT_PDF_LIMITS.maximumBytes + 1),
    ])
      expect(() => parsePdfWorkerRequest({ ...request, bytes })).toThrow('request is invalid');
    expect(() => parsePdfWorkerRequest({ ...request, filename: 'private.txt' })).toThrow(
      'request is invalid',
    );
  });
  it('builds and reopens the inclusive 500-page text layout boundary', async () => {
    const output = await textToPdf(encode('\n'.repeat(48 * 500 - 1)), options);
    const document = await PDFDocument.load(output, { updateMetadata: false });
    expect(document.getPageCount()).toBe(500);
    expect(document.getPages().every((page) => page.node.Contents() === undefined)).toBe(true);
  });
  it('creates deterministic searchable-page structure without source/date metadata, capturing mutable input before awaits', async () => {
    const source = encode(
      Array.from({ length: 97 }, (_, index) => `Synthetic row ${index}`).join('\n'),
    );
    const snapshot = source.slice();
    const mutable = { pageSize: 'letter' as 'a4' | 'letter' };
    const work = textToPdf(source, mutable);
    source.fill(0);
    mutable.pageSize = 'a4';
    const output = await work;
    expect(output).toEqual(await textToPdf(snapshot, options));
    const document = await PDFDocument.load(output, { updateMetadata: false });
    expect(document.getPageCount()).toBe(3);
    expect(
      document
        .getPages()
        .every(
          (page) =>
            page.getWidth() === 612 &&
            page.getHeight() === 792 &&
            page.getRotation().angle === 0 &&
            page.node.Contents() !== undefined &&
            (page.node.Annots()?.size() ?? 0) === 0,
        ),
    ).toBe(true);
    expect(document.getCreationDate()).toBeUndefined();
    expect(document.getModificationDate()).toBeUndefined();
    expect(document.getTitle()).toBeUndefined();
    expect(document.getAuthor()).toBeUndefined();
  });
});
