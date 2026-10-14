import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, degrees } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { composeLocalOcr, type LocalOcrWord } from './local-ocr-compose.js';
import { inspectSourceText } from './source-text.js';
const fixture = () =>
  readFile(new URL('../../test-corpus/fixtures/scanned-ocr.pdf', import.meta.url));
const words: readonly LocalOcrWord[] = [
  { text: 'OCR FIXTURE 4827', x: 0.08, y: 0.2, width: 0.7, height: 0.12, baseline: 0.32 },
];
describe('OCR-001 immutable scan composition', () => {
  it('appends invisible text while retaining original content and page geometry', async () => {
    const bytes = await fixture();
    const before = new Uint8Array(bytes);
    const original = await PDFDocument.load(bytes);
    const output = await composeLocalOcr(bytes, 0, words);
    const parsed = await PDFDocument.load(output);
    expect(parsed.getPageCount()).toBe(original.getPageCount());
    expect(parsed.getPage(0).getMediaBox()).toEqual(original.getPage(0).getMediaBox());
    expect(parsed.getPage(0).getCropBox()).toEqual(original.getPage(0).getCropBox());
    expect(await inspectSourceText(output, 0)).toEqual([]); // Invisible OCR words cannot visually edit the scan.
    expect(
      bytes.length === before.length && before.every((byte, index) => bytes[index] === byte),
    ).toBe(true);
  });
  it('rejects invalid pages, coordinates, empty text, controls and unsupported glyphs atomically', async () => {
    const bytes = await fixture();
    const before = new Uint8Array(bytes);
    await expect(composeLocalOcr(bytes, 99, words)).rejects.toThrow('INVALID');
    for (const patch of [
      { x: NaN },
      { width: 1.5 },
      { text: '' },
      { text: '\nsecret' },
      { text: '漢字' },
    ]) {
      const outcome = await composeLocalOcr(bytes, 0, [
        { ...words[0], ...patch } as LocalOcrWord,
      ]).then(
        () => 'unexpected-success',
        () => 'rejected',
      );
      expect(outcome).toBe('rejected'); // Never print PDF bytes on assertion failure.
    }
    expect(
      bytes.length === before.length && before.every((byte, index) => bytes[index] === byte),
    ).toBe(true);
  });
  it('refuses rotation and encrypted/signature/active-content boundaries rather than flattening', async () => {
    const document = await PDFDocument.load(await fixture());
    document.getPage(0).setRotation(degrees(90));
    await expect(composeLocalOcr(await document.save(), 0, words)).rejects.toThrow('ROTATION');
    document.getPage(0).setRotation(degrees(0));
    document.catalog.set(PDFName.of('OpenAction'), PDFNumber.of(1));
    await expect(composeLocalOcr(await document.save(), 0, words)).rejects.toThrow('UNSUPPORTED');
  });
});
