import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from '@cantoo/pdf-lib';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { exportEditedPdf, type EditedPdfRequest } from './editing.js';
import {
  assertOutlineStructuresPreserved,
  snapshotOutlineStructures,
} from './outline-preservation.js';

const fixture = async () =>
  new Uint8Array(
    await readFile(new URL('../../test-corpus/fixtures/outline-navigation.pdf', import.meta.url)),
  );
const request = (bytes: Uint8Array): EditedPdfRequest => ({
  annotations: [
    {
      alignment: 'left',
      color: '#17232D',
      fontSize: 14,
      id: 'overlay',
      kind: 'text',
      pageId: 'page-0',
      rect: { height: 0.08, width: 0.5, x: 0.1, y: 0.4 },
      text: 'Synthetic bookmark overlay',
      variant: 'plain',
    },
  ],
  formValues: [],
  options: { flattenForms: false },
  pages: [0, 1, 2].map((sourcePageIndex) => ({
    pageId: `page-${sourcePageIndex}`,
    rotation: 0,
    sourceId: 'source',
    sourcePageIndex,
  })),
  sources: [{ bytes, sourceId: 'source' }],
});

describe('VIEW-006 / EDIT-001 bookmark-preserving direct export', () => {
  it('preserves nested, named, long and action-only bookmarks without changing source bytes', async () => {
    const bytes = await fixture();
    const original = bytes.slice();
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const snapshot = snapshotOutlineStructures(source);
    expect(snapshot).not.toBeNull();
    const result = await exportEditedPdf(request(bytes));
    const output = await PDFDocument.load(result, { updateMetadata: false });
    expect(() => assertOutlineStructuresPreserved(snapshot, output)).not.toThrow();
    expect(bytes).toEqual(original);
  });

  it.each(['reorder', 'rotate', 'delete', 'duplicate', 'multiple sources'] as const)(
    'still refuses %s rather than silently losing bookmarks',
    async (change) => {
      const input = request(await fixture());
      const pages = [...input.pages];
      const firstPage = pages[0];
      const firstSource = input.sources[0];
      if (firstPage === undefined || firstSource === undefined) throw new Error('Invalid fixture');
      if (change === 'reorder') pages.reverse();
      if (change === 'rotate') pages[0] = { ...firstPage, rotation: 90 };
      if (change === 'delete') pages.pop();
      if (change === 'duplicate') pages.push({ ...firstPage, pageId: 'duplicate' });
      const sources =
        change === 'multiple sources'
          ? [...input.sources, { ...firstSource, sourceId: 'second' }]
          : input.sources;
      await expect(exportEditedPdf({ ...input, pages, sources })).rejects.toThrow(
        'ORGANIZER_OUTLINES_BLOCKED',
      );
    },
  );

  it.each(['title', 'destination', 'named target', 'page order', 'missing outline'] as const)(
    'fails closed if %s changes',
    async (change) => {
      const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
      const snapshot = snapshotOutlineStructures(document);
      const root = document.catalog.lookup(PDFName.of('Outlines'), PDFDict);
      const first = root.lookup(PDFName.of('First'), PDFDict);
      if (change === 'title') first.set(PDFName.of('Title'), PDFString.of('changed'));
      if (change === 'destination')
        first.set(
          PDFName.of('Dest'),
          document.context.obj([document.getPage(2).ref, PDFName.of('Fit')]),
        );
      if (change === 'named target') {
        const names = document.catalog.lookup(PDFName.of('Names'), PDFDict);
        names
          .lookup(PDFName.of('Dests'), PDFDict)
          .lookup(PDFName.of('Names'), PDFArray)
          .set(1, document.context.obj([document.getPage(2).ref, PDFName.of('Fit')]));
      }
      if (change === 'page order') {
        document.removePage(0);
      }
      if (change === 'missing outline') document.catalog.delete(PDFName.of('Outlines'));
      expect(() => assertOutlineStructuresPreserved(snapshot, document)).toThrow(
        'EDIT_OUTLINE_PRESERVATION_FAILED',
      );
    },
  );

  it('bounds deep, oversized and dangling structures with a content-free failure', async () => {
    for (const change of ['deep', 'oversized', 'dangling'] as const) {
      const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
      const root = document.catalog.lookup(PDFName.of('Outlines'), PDFDict);
      if (change === 'dangling') root.set(PDFName.of('First'), PDFRef.of(999999));
      if (change === 'oversized')
        root.set(PDFName.of('SensitiveCanary'), PDFString.of('x'.repeat(2 * 1024 * 1024)));
      if (change === 'deep') {
        let cursor = root;
        for (let index = 0; index < 70; index++) {
          const next = document.context.obj({});
          cursor.set(PDFName.of('Nested'), next);
          cursor = next;
        }
      }
      expect(() => snapshotOutlineStructures(document)).toThrow(
        /^EDIT_OUTLINE_PRESERVATION_FAILED$/u,
      );
    }
  });
});
