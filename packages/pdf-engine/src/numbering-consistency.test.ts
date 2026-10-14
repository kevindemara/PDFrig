import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  formatNumberingIdentifier,
  formatPageLabel,
  numberPdf,
  previewNumbering,
  type PdfNumberingOptions,
} from './numbering.js';

const labels = {
  alignment: 'right',
  color: '#17232d',
  endPage: null,
  fontSize: 9,
  kind: 'page-labels',
  marginPoints: 28,
  position: 'footer',
  prefix: '',
  replaceExistingLabels: false,
  startNumber: 1,
  startPage: 1,
  style: 'decimal',
} as const;
const bates = {
  alignment: 'right',
  color: '#17232d',
  digits: 6,
  endPage: null,
  fontSize: 9,
  kind: 'bates',
  marginPoints: 28,
  position: 'footer',
  prefix: '',
  startNumber: 1,
  startPage: 1,
  suffix: '',
} as const;
const smoke = async () => {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([612, 792]);
  return document.save();
};

describe('ORG-011 / ORG-012 identifier consistency', () => {
  it.each(['letters-upper', 'letters-lower'] as const)(
    'matches standard PDF repeated-letter labels at boundaries for %s',
    (style) => {
      for (const [value, expected] of [
        [1, 'A'],
        [26, 'Z'],
        [27, 'AA'],
        [28, 'BB'],
        [52, 'ZZ'],
        [53, 'AAA'],
        [78, 'ZZZ'],
        [79, 'AAAA'],
      ] as const)
        expect(formatPageLabel(style, value)).toBe(
          style === 'letters-lower' ? expected.toLowerCase() : expected,
        );
    },
  );

  it('bounds alphabetic allocation before creating a repeated string', () => {
    expect(formatPageLabel('letters-upper', 3_120)).toBe('Z'.repeat(120));
    for (const value of [3_121, 999_999_999])
      expect(() => formatPageLabel('letters-upper', value)).toThrow('NUMBERING_IDENTIFIER_LIMIT');
    expect(() =>
      formatNumberingIdentifier(
        { ...labels, style: 'letters-upper', prefix: 'X', startNumber: 3_120 },
        0,
      ),
    ).toThrow('NUMBERING_IDENTIFIER_LIMIT');
  });

  it.each([labels, bates])(
    'preserves literal spaces in $kind visible text and report',
    async (plan) => {
      const input = await smoke();
      const snapshot = input.slice();
      const options: PdfNumberingOptions =
        plan.kind === 'bates'
          ? { ...plan, prefix: ' QA  ', suffix: ' -X ' }
          : { ...plan, prefix: ' QA  ' };
      const expected = plan.kind === 'bates' ? ' QA  000001 -X ' : ' QA  1';
      const result = await numberPdf(input, options);
      const document = await PDFDocument.load(result.bytes);
      const text = document
        .getPage(0)
        .extractContents()
        .filter((asset) => asset.kind === 'text')
        .map((asset) => asset.getText().replace(/\n$/u, ''));
      expect(text).toContain(expected);
      expect(result.report.firstIdentifier).toBe(expected);
      expect(previewNumbering({ ...options, endPage: 1 })).toEqual([expected]);
      expect(input).toEqual(snapshot);
    },
  );

  it.each([labels, bates])(
    'rejects control characters without normalization for $kind',
    async (plan) => {
      const input = await smoke();
      const snapshot = input.slice();
      for (const control of ['\u0000', '\t', '\n', '\r', '\u007f', '\u0085', '\u2028', '\u2029']) {
        const candidates = [
          { ...plan, prefix: `QA${control}` },
          ...(plan.kind === 'bates' ? [{ ...plan, suffix: control }] : []),
        ];
        for (const options of candidates) {
          expect(() => previewNumbering(options)).toThrow('NUMBERING_TEXT_CONTROL_UNSUPPORTED');
          await expect(numberPdf(input, options).then(() => undefined)).rejects.toThrow(
            /^NUMBERING_TEXT_CONTROL_UNSUPPORTED$/u,
          );
        }
      }
      expect(input).toEqual(snapshot);
    },
  );

  it('previews only the explicit range or remaining supported values', () => {
    expect(previewNumbering({ ...bates, startPage: 500 })).toEqual(['000001']);
    expect(previewNumbering({ ...labels, startPage: 2, endPage: 2 })).toEqual(['1']);
    expect(previewNumbering({ ...labels, style: 'roman-upper', startNumber: 3_999 })).toEqual([
      'MMMCMXCIX',
    ]);
    expect(previewNumbering({ ...bates, startNumber: 999_999_999 })).toEqual(['999999999']);
    expect(previewNumbering({ ...labels, style: 'letters-upper', startNumber: 3_120 })).toEqual([
      'Z'.repeat(120),
    ]);
  });

  it('writes bounded exact alphabetic label entries and restores decimal labels outside the range', async () => {
    const source = await PDFDocument.load(await smoke());
    for (let page = 1; page < 5; page++) source.addPage([612, 792]);
    const input = await source.save();
    const snapshot = input.slice();
    const result = await numberPdf(input, {
      ...labels,
      style: 'letters-upper',
      prefix: ' QA  ',
      startNumber: 26,
      startPage: 2,
      endPage: 4,
    });
    const document = await PDFDocument.load(result.bytes);
    const nums = document.catalog
      .lookup(PDFName.of('PageLabels'), PDFDict)
      .lookup(PDFName.of('Nums'), PDFArray);
    expect(nums.size()).toBe(10);
    const expected = [' QA  Z', ' QA  AA', ' QA  BB'];
    for (let index = 0; index < 5; index++) {
      expect(nums.lookup(index * 2, PDFNumber).asNumber()).toBe(index);
      const label = nums.lookup(index * 2 + 1, PDFDict);
      if (index === 0 || index === 4) {
        expect(label.lookup(PDFName.of('S'), PDFName).asString()).toBe('/D');
        expect(label.lookup(PDFName.of('St'), PDFNumber).asNumber()).toBe(index + 1);
      } else {
        expect(label.has(PDFName.of('S'))).toBe(false);
        expect(label.lookup(PDFName.of('P'), PDFHexString).decodeText()).toBe(expected[index - 1]);
      }
    }
    expect(input).toEqual(snapshot);
  });

  it('rejects reversed ranges and known sequence overflow rather than previewing invalid work', () => {
    expect(() => previewNumbering({ ...labels, startPage: 3, endPage: 2 })).toThrow(
      'NUMBERING_PAGE_RANGE_INVALID',
    );
    expect(() => previewNumbering({ ...bates, startNumber: 999_999_999, endPage: 2 })).toThrow(
      'NUMBERING_SEQUENCE_LIMIT',
    );
    expect(() =>
      previewNumbering({ ...labels, style: 'roman-upper', startNumber: 3_999, endPage: 2 }),
    ).toThrow('NUMBERING_ROMAN_RANGE_UNSUPPORTED');
    expect(() =>
      previewNumbering({ ...labels, style: 'letters-upper', startNumber: 3_120, endPage: 2 }),
    ).toThrow('NUMBERING_IDENTIFIER_LIMIT');
    expect(() => formatNumberingIdentifier({ ...bates, startNumber: 999_999_999 }, 1)).toThrow(
      'NUMBERING_SEQUENCE_LIMIT',
    );
  });
});
