import { PDFDocument, PDFName, PDFNumber, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { decoratePdf } from './decorations.js';
import {
  isPdfDecorationOptions,
  parseDecorationPageRange,
  resolveDecorationPages,
  type PdfDecorationOptions,
} from './decoration-options.js';
import { parsePdfWorkerRequest } from './worker.js';
import { numberPdf } from './numbering.js';

const defaultHeader = {
  text: 'RANGE {page}/{pages}',
  alignment: 'left',
  color: '#17232d',
  fontSize: 9,
} as const;
const options: PdfDecorationOptions = {
  header: defaultHeader,
  footer: null,
  watermark: null,
  marginPoints: 28,
  pageSelection: 'custom',
  pageRange: '3, 1',
};

describe('EDIT-006 / EDIT-007 exact range and placement contract', () => {
  it('blocks unsupported characters instead of accepting the fork placeholder fallback', async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    const bytes = await document.save();
    const before = bytes.slice();
    for (const kind of ['header', 'footer', 'watermark'] as const) {
      const plan = {
        ...options,
        pageRange: '1',
        header: null,
        footer: null,
        watermark: null,
        [kind]:
          kind === 'watermark'
            ? { text: 'Lost ☃', color: '#17232d', fontSize: 48, opacity: 0.16, rotation: 0 }
            : { ...defaultHeader, text: 'Lost ☃' },
      } as PdfDecorationOptions;
      await expect(decoratePdf(bytes, plan)).rejects.toThrow(
        'DECORATION_TEXT_ENCODING_UNSUPPORTED',
      );
    }
    expect(bytes).toEqual(before);
    await expect(
      numberPdf(bytes, {
        kind: 'bates',
        prefix: 'Lost ☃',
        suffix: '',
        digits: 3,
        startNumber: 1,
        startPage: 1,
        endPage: null,
        position: 'header',
        alignment: 'left',
        color: '#17232d',
        fontSize: 9,
        marginPoints: 28,
      }),
    ).rejects.toThrow('NUMBERING_TEXT_ENCODING_UNSUPPORTED');
  });

  it('rejects text whose unkerned PDF advance exceeds the margin even when pair metrics fit', async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const text = 'AV'.repeat(15);
    const kerned = font.widthOfTextAtSize(text, 9);
    const actual = Array.from(text).reduce(
      (total, character) => total + font.widthOfTextAtSize(character, 9),
      0,
    );
    expect(actual).toBeGreaterThan(kerned + 5);
    document.addPage([56 + (actual + kerned) / 2, 792]);
    await expect(
      decoratePdf(await document.save(), {
        ...options,
        pageRange: '1',
        header: { ...defaultHeader, text },
      }),
    ).rejects.toThrow('DECORATION_TEXT_DOES_NOT_FIT');
  });
  it('resolves original page positions deterministically without reordering the document', () => {
    expect(parseDecorationPageRange('5, 1-3', 5)).toEqual([1, 2, 3, 5]);
    expect(resolveDecorationPages(options, 3)).toEqual([1, 3]);
    expect(resolveDecorationPages({ ...options, pageRange: '1-500' }, 500)).toHaveLength(500);
    for (const [selection, expected] of [
      ['all', [1, 2, 3]],
      ['first', [1]],
      ['odd', [1, 3]],
      ['even', [2]],
    ] as const) {
      expect(
        resolveDecorationPages(
          {
            header: options.header,
            footer: null,
            watermark: null,
            marginPoints: 28,
            pageSelection: selection,
          },
          3,
        ),
      ).toEqual(expected);
    }
  });

  it('rejects malformed, overlapping, repeated, empty, and out-of-document ranges', () => {
    for (const range of [
      '',
      ' ',
      '0',
      '-1',
      '1-',
      '2-1',
      '1,',
      '1,,3',
      '1,1',
      '1-3,3',
      '1-2,2-3',
      '01',
      '1.5',
      '1e2',
      '4',
      '1-4',
      '1;2',
      '1–2',
      '1'.repeat(1001),
    ])
      expect(() => parseDecorationPageRange(range, 3)).toThrow('DECORATION_PAGE_RANGE_INVALID');
    expect(() => parseDecorationPageRange('1', 501)).toThrow();
    expect(() =>
      resolveDecorationPages(
        {
          header: options.header,
          footer: null,
          watermark: null,
          marginPoints: 28,
          pageSelection: 'even',
        },
        1,
      ),
    ).toThrow('DECORATION_NO_PAGES');
  });

  it('shares exact option validation with the untrusted worker boundary', () => {
    const bytes = new TextEncoder().encode('%PDF-synthetic');
    expect(
      parsePdfWorkerRequest({ id: 'fixture', kind: 'decorate', bytes, options }),
    ).toMatchObject({ options });
    for (const candidate of [
      { ...options, extra: true },
      { ...options, pageRange: undefined },
      { ...options, pageRange: '1-2,2' },
      { ...options, pageSelection: 'all' },
      { ...options, header: { ...options.header, fontSize: NaN } },
      { ...options, marginPoints: Infinity },
      { ...options, header: [] },
    ]) {
      expect(isPdfDecorationOptions(candidate)).toBe(false);
      expect(() =>
        parsePdfWorkerRequest({ id: 'fixture', kind: 'decorate', bytes, options: candidate }),
      ).toThrow();
    }
  });

  it('writes only selected pages, keeps original page tokens, and leaves source bytes immutable', async () => {
    const input = await PDFDocument.create({ updateMetadata: false });
    for (let page = 0; page < 3; page += 1) input.addPage([612, 792]);
    const source = await input.save();
    const before = source.slice();
    const output = await PDFDocument.load(await decoratePdf(source, options));
    const marks = output.getPages().map((page) =>
      page
        .extractContents()
        .filter((item) => item.kind === 'text')
        .map((item) => item.getText().trim())
        .filter((value) => value.startsWith('RANGE')),
    );
    expect(marks).toEqual([['RANGE 1/3'], [], ['RANGE 3/3']]);
    expect(source).toEqual(before);
    await expect(decoratePdf(source, { ...options, pageRange: '4' })).rejects.toThrow(
      'DECORATION_PAGE_RANGE_INVALID',
    );
  });

  it('rejects clipped text on any selected page instead of shrinking or silently truncating it', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([80, 100]);
    const bytes = await source.save();
    await expect(decoratePdf(bytes, { ...options, pageRange: '1' })).resolves.toBeInstanceOf(
      Uint8Array,
    );
    await expect(decoratePdf(bytes, { ...options, pageRange: '1-2' })).rejects.toThrow(
      'DECORATION_TEXT_DOES_NOT_FIT',
    );
    await expect(
      decoratePdf(bytes, {
        ...options,
        pageRange: '1',
        marginPoints: 12,
        header: { text: 'RANGE', alignment: 'left', color: '#17232d', fontSize: 24 },
      }),
    ).rejects.toThrow('DECORATION_TEXT_DOES_NOT_FIT');
  });

  it('fails closed on nonstandard units and CropBoxes outside the MediaBox', async () => {
    for (const kind of ['units', 'crop'] as const) {
      const source = await PDFDocument.create();
      const page = source.addPage([612, 792]);
      if (kind === 'units') page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
      else page.setCropBox(-10, 0, 612, 792);
      await expect(
        decoratePdf(await source.save(), { ...options, pageRange: '1' }),
      ).rejects.toThrow('DECORATION_PAGE_BOX_UNSUPPORTED');
    }
  });
});
