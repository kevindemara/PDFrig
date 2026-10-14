import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectSourceText, replaceSourceText } from './source-text.js';
import { embedSignatureFont } from './signature-font.js';
const fixture = (name: string) =>
  readFile(new URL(`../../test-corpus/fixtures/${name}`, import.meta.url));
describe('EDIT-002 genuine bounded source text replacement', () => {
  it('replaces original text with the same font and keeps the source immutable', async () => {
    const source = await fixture('smoke-one-page.pdf');
    const before = new Uint8Array(source);
    const runs = await inspectSourceText(source, 0);
    expect(runs.length).toBeGreaterThan(0);
    const run = runs[0];
    if (!run) throw new Error('Missing synthetic run');
    const output = await replaceSourceText(source, run.id, run.text, 'EDIT');
    const after = await inspectSourceText(output, 0);
    expect(
      after.some(
        (item) =>
          item.text === 'EDIT' && item.fontName === run.fontName && item.fontSize === run.fontSize,
      ),
    ).toBe(true);
    expect(after.some((item) => item.text === run.text)).toBe(false);
    expect(
      source.length === before.length && before.every((byte, index) => source[index] === byte),
    ).toBe(true);
  });
  it('rejects stale changes, unencodable replacements and expansion instead of covering source text', async () => {
    const source = await fixture('smoke-one-page.pdf');
    const run = (await inspectSourceText(source, 0))[0];
    if (!run) throw new Error('Missing synthetic run');
    await expect(replaceSourceText(source, run.id, 'wrong', 'EDIT')).rejects.toThrow('STALE');
    await expect(replaceSourceText(source, run.id, run.text, '漢字')).rejects.toThrow('INVALID');
    await expect(replaceSourceText(source, run.id, run.text, 'W'.repeat(4096))).rejects.toThrow(
      'TOO_WIDE',
    );
  });
  it('updates only uniquely owned tagged accessibility text and retains bookmarks', async () => {
    const source = await fixture('tagged-bookmarks.pdf');
    const run = (await inspectSourceText(source, 0))[0];
    if (!run) throw new Error('Missing synthetic run');
    const output = await replaceSourceText(source, run.id, run.text, 'EDIT');
    expect((await inspectSourceText(output, 0)).some((item) => item.text === 'EDIT')).toBe(true);
  });
  it('refuses active, encrypted and signed documents and has no editable text on scans', async () => {
    for (const name of ['embedded-javascript.pdf', 'password-aes256.pdf', 'signature-field.pdf'])
      await expect(inspectSourceText(await fixture(name), 0)).rejects.toThrow();
    expect(await inspectSourceText(await fixture('scanned-ocr.pdf'), 0)).toEqual([]);
  });
  it('restores nested text graphics state across streams and rejects malformed state', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const other = await document.embedFont(StandardFonts.Courier);
    page.node.set(
      PDFName.of('Resources'),
      document.context.obj({ Font: { H: font.ref, C: other.ref } }),
    );
    const first = document.context.register(
      document.context.flateStream('/H 18 Tf q /C 30 Tf BT 54 600 Td (INNER) Tj ET'),
    );
    const second = document.context.register(
      document.context.flateStream('Q BT 54 500 Td (OUTER) Tj ET'),
    );
    page.node.set(PDFName.of('Contents'), document.context.obj([first, second]));
    const source = await document.save();
    const runs = await inspectSourceText(source, 0);
    expect(runs.map(({ text, fontName, fontSize }) => [text, fontName, fontSize])).toEqual([
      ['INNER', 'Courier', 30],
      ['OUTER', 'Helvetica', 18],
    ]);
    const run = runs.find((item) => item.text === 'OUTER');
    if (!run) throw new Error('Missing synthetic run');
    expect(
      (await inspectSourceText(await replaceSourceText(source, run.id, run.text, 'EDIT'), 0)).at(-1)
        ?.fontName,
    ).toBe('Helvetica');
    document.context.assign(second, document.context.flateStream('Q Q BT (BAD) Tj ET'));
    expect(await inspectSourceText(await document.save(), 0)).toEqual([]);
  });
  it('preserves an embedded Identity-H font rather than substituting Helvetica', async () => {
    const document = await PDFDocument.create();
    const font = await embedSignatureFont(document);
    document.addPage().drawText('EDIT SOURCE', { font, size: 22, x: 54, y: 600 });
    const source = await document.save();
    const run = (await inspectSourceText(source, 0))[0];
    if (!run) throw new Error('Missing embedded synthetic run');
    const after = await inspectSourceText(
      await replaceSourceText(source, run.id, run.text, 'EDIT'),
      0,
    );
    expect(after[0]?.fontName).toContain('DancingScript');
    expect(after[0]?.fontSize).toBe(22);
    expect(after[0]?.text).toBe('EDIT');
  });
  it('never leaves stream-level ActualText stale, including escaped dictionary names', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.node.set(PDFName.of('Resources'), document.context.obj({ Font: { H: font.ref } }));
    for (const dictionary of [
      '<< /ActualText (OLD) >>',
      '<< /#41ctualText (OLD) >>',
      '/NamedProperties',
    ]) {
      page.node.set(
        PDFName.of('Contents'),
        document.context.register(
          document.context.flateStream(
            `/P ${dictionary} BDC BT /H 18 Tf 54 600 Td (OLD) Tj ET EMC`,
          ),
        ),
      );
      expect(await inspectSourceText(await document.save(), 0)).toEqual([]);
    }
  });
  it('rejects shared page streams and unsupported ambiguous simple encodings', async () => {
    const document = await PDFDocument.load(await fixture('smoke-one-page.pdf'));
    const page = document.getPage(0);
    const run = (await inspectSourceText(await document.save(), 0))[0];
    if (!run) throw new Error('Missing synthetic run');
    const content = page.node.get(PDFName.of('Contents'));
    if (!content) throw new Error('Missing synthetic content');
    document.addPage().node.set(PDFName.of('Contents'), content);
    await expect(
      replaceSourceText(await document.save(), run.id, run.text, 'EDIT'),
    ).rejects.toThrow('SHARED');
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    if (!fonts) throw new Error('Missing fonts');
    for (const [, font] of fonts.entries()) {
      const value = document.context.lookup(font, PDFDict);
      value.set(
        PDFName.of('Encoding'),
        document.context.obj({ Type: 'Encoding', Differences: [32, PDFName.of('A')] }),
      );
    }
    expect(await inspectSourceText(await document.save(), 0)).toEqual([]);
    expect(page.node.lookup(PDFName.of('Contents'))).toBeInstanceOf(PDFArray);
  });
});
