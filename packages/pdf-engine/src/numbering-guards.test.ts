import { degrees, PDFDocument, PDFName, PDFNumber, PDFString, type PDFPage } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { numberPdf, type PdfNumberingOptions } from './numbering.js';

const base = {
  alignment: 'right',
  color: '#17232d',
  endPage: null,
  fontSize: 9,
  marginPoints: 28,
  position: 'footer',
  startPage: 1,
  startNumber: 1,
  prefix: 'AV-AV-',
} as const;
const plans: readonly PdfNumberingOptions[] = [
  { ...base, kind: 'page-labels', style: 'decimal', replaceExistingLabels: false },
  { ...base, kind: 'bates', digits: 6, suffix: '-gyp' },
];
const synthetic = async (edit: (page: PDFPage, document: PDFDocument) => void) => {
  const document = await PDFDocument.create({ updateMetadata: false });
  edit(document.addPage([612, 792]), document);
  return document.save();
};
// Avoid dumping even synthetic PDF bytes if a negative regression unexpectedly succeeds.
const attempt = (bytes: Uint8Array, plan: PdfNumberingOptions) =>
  numberPdf(bytes, plan).then(() => undefined);

describe('ORG-011 / ORG-012 fail-closed numbering placement', () => {
  it.each(plans)(
    'rejects horizontal clipping for $kind at every alignment without changing the source',
    async (plan) => {
      const bytes = await synthetic((page) => page.setSize(70, 200));
      const snapshot = bytes.slice();
      for (const alignment of ['left', 'center', 'right'] as const)
        await expect(attempt(bytes, { ...plan, alignment })).rejects.toThrow(
          'NUMBERING_TEXT_DOES_NOT_FIT',
        );
      expect(bytes).toEqual(snapshot);
    },
  );

  it.each(plans)('rejects vertical clipping and too-short pages for $kind', async (plan) => {
    const normal = await synthetic(() => undefined);
    await expect(
      attempt(normal, { ...plan, position: 'header', fontSize: 24, marginPoints: 12 }),
    ).rejects.toThrow('NUMBERING_TEXT_DOES_NOT_FIT');
    const short = await synthetic((page) => page.setSize(612, 56));
    for (const position of ['header', 'footer'] as const)
      await expect(attempt(short, { ...plan, position })).rejects.toThrow(
        'NUMBERING_TEXT_DOES_NOT_FIT',
      );
  });

  it('uses visible CropBox dimensions after rotation, not the wider MediaBox', async () => {
    for (const rotation of [0, 90, 180, 270]) {
      const bytes = await synthetic((page) => {
        page.setCropBox(20, 20, rotation % 180 === 0 ? 70 : 200, rotation % 180 === 0 ? 200 : 70);
        page.setRotation(degrees(rotation));
      });
      for (const plan of plans)
        await expect(attempt(bytes, plan)).rejects.toThrow('NUMBERING_TEXT_DOES_NOT_FIT');
    }
  });

  it('rejects invalid, outside, oversized, and unsupported-unit page geometry with content-free errors', async () => {
    const mutations: readonly ((page: PDFPage, document: PDFDocument) => void)[] = [
      (page) => page.setCropBox(-1, 0, 612, 792),
      (page) => page.setCropBox(0, 0, 613, 792),
      (page) => page.setCropBox(0, 0, 0, 792),
      (page) => page.setSize(14_401, 792),
      (page) => page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)),
      (page) => page.node.set(PDFName.of('UserUnit'), PDFString.of('restricted-geometry-canary')),
      (page, document) => page.node.set(PDFName.of('CropBox'), document.context.obj([0, 0, 612])),
      (page, document) =>
        page.node.set(PDFName.of('MediaBox'), document.context.obj([0, 0, 0, 792])),
    ];
    for (const mutation of mutations) {
      const bytes = await synthetic(mutation);
      const snapshot = bytes.slice();
      for (const plan of plans)
        await expect(attempt(bytes, plan)).rejects.toThrow(/^NUMBERING_PAGE_BOX_UNSUPPORTED$/u);
      expect(bytes).toEqual(snapshot);
    }
  });

  it('keeps unsupported rotation errors in the numbering namespace', async () => {
    const bytes = await synthetic((page) => page.node.set(PDFName.of('Rotate'), PDFNumber.of(45)));
    for (const plan of plans)
      await expect(attempt(bytes, plan)).rejects.toThrow(/^NUMBERING_ROTATION_UNSUPPORTED$/u);
  });

  it('checks every selected identifier, including a later wider decimal value', async () => {
    const bytes = await synthetic((page, document) => {
      page.setSize(69, 200);
      document.addPage([69, 200]);
    });
    const plan: PdfNumberingOptions = {
      ...base,
      kind: 'page-labels',
      style: 'decimal',
      replaceExistingLabels: false,
      prefix: '',
      startNumber: 99,
      endPage: 1,
    };
    await expect(numberPdf(bytes, plan)).resolves.toMatchObject({
      report: { firstIdentifier: '99' },
    });
    await expect(attempt(bytes, { ...plan, endPage: 2 })).rejects.toThrow(
      'NUMBERING_TEXT_DOES_NOT_FIT',
    );
  });

  it('returns no partial PDF or report when a later selected page fails; excluding it still works', async () => {
    const bytes = await synthetic((_page, document) => document.addPage([70, 200]));
    const snapshot = bytes.slice();
    for (const plan of plans) {
      await expect(attempt(bytes, plan)).rejects.toThrow('NUMBERING_TEXT_DOES_NOT_FIT');
      const result = await numberPdf(bytes, { ...plan, endPage: 1 });
      expect(result.report).toMatchObject({
        appliedPages: 1,
        sourcePages: 2,
        operationVersion: '1.0.3',
      });
      expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
    }
    expect(bytes).toEqual(snapshot);
  });
});
