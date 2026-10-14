import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { updateSourceTextAccessibility } from './source-text-accessibility.js';

const load = async () =>
  PDFDocument.load(
    await readFile(new URL('../../test-corpus/fixtures/tagged-bookmarks.pdf', import.meta.url)),
  );
const target = {
  pageIndex: 0,
  markedContentId: 0,
  expectedText: 'Tagged synthetic paragraph 1',
  replacementText: 'SOURCE EDIT',
};
const rootAndParagraph = (document: PDFDocument) => {
  const root = document.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const children = root.lookup(PDFName.of('K'), PDFArray);
  return { root, children, paragraph: children.lookup(0, PDFDict) };
};
describe('EDIT-002 bounded source-text accessibility repair', () => {
  it.each(['', 'x'.repeat(4_097), String.fromCharCode(0), String.fromCharCode(0xd800)])(
    'refuses invalid semantic text before mutation (%#)',
    async (replacementText) => {
      const document = await load();
      const { paragraph } = rootAndParagraph(document);
      const before = paragraph.get(PDFName.of('ActualText'))?.toString();
      expect(() => updateSourceTextAccessibility(document, { ...target, replacementText })).toThrow(
        'SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED',
      );
      expect(paragraph.get(PDFName.of('ActualText'))?.toString()).toBe(before);
    },
  );
  it('updates only the owned MCID and round-trips Unicode without changing the other paragraph', async () => {
    const document = await load();
    updateSourceTextAccessibility(document, { ...target, replacementText: 'Révisé' });
    const reopened = await PDFDocument.load(await document.save({ updateFieldAppearances: false }));
    const { paragraph, children } = rootAndParagraph(reopened);
    expect(paragraph.lookup(PDFName.of('ActualText'), PDFHexString).decodeText()).toBe('Révisé');
    expect(
      children.lookup(1, PDFDict).lookup(PDFName.of('ActualText'), PDFString).decodeText(),
    ).toBe('Tagged synthetic paragraph 2');
  });
  it.each([
    'wrong-text',
    'wrong-page',
    'missing-mcid',
    'duplicate',
    'parent-cycle',
    'shared-stream',
    'alternative-text',
    'compound-ancestor',
    'parent-tree-mismatch',
  ])('refuses %s atomically without changing any ActualText', async (mode) => {
    const document = await load();
    const { root, children, paragraph } = rootAndParagraph(document);
    const change = { ...target };
    if (mode === 'wrong-text') change.expectedText = 'Wrong source text';
    if (mode === 'wrong-page') change.pageIndex = 1;
    if (mode === 'missing-mcid') change.markedContentId = 99;
    if (mode === 'duplicate') children.push(children.get(0));
    if (mode === 'parent-cycle') paragraph.set(PDFName.of('P'), children.get(0));
    if (mode === 'shared-stream')
      paragraph
        .lookup(PDFName.of('K'), PDFArray)
        .lookup(0, PDFDict)
        .set(PDFName.of('Stm'), document.context.register(document.context.flateStream('')));
    if (mode === 'alternative-text')
      paragraph.set(PDFName.of('Alt'), PDFString.of('Alternative speech'));
    if (mode === 'parent-tree-mismatch')
      root
        .lookup(PDFName.of('ParentTree'), PDFDict)
        .lookup(PDFName.of('Nums'), PDFArray)
        .set(1, document.context.obj([children.get(1)]));
    if (mode === 'compound-ancestor') {
      const parent = document.context.obj({
        Type: 'StructElem',
        S: 'Sect',
        P: document.catalog.get(PDFName.of('StructTreeRoot')),
        K: children,
        ActualText: PDFString.of(target.expectedText),
      });
      const parentRef = document.context.register(parent);
      for (const child of children.asArray())
        document.context.lookup(child, PDFDict).set(PDFName.of('P'), parentRef);
      root.set(PDFName.of('K'), parentRef);
    }
    const before = paragraph.get(PDFName.of('ActualText'))?.toString();
    expect(() => updateSourceTextAccessibility(document, change)).toThrow(
      'SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED',
    );
    expect(paragraph.get(PDFName.of('ActualText'))?.toString()).toBe(before);
  });
});
