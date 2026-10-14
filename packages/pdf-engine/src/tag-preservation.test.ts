import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
} from '@cantoo/pdf-lib';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { exportEditedPdf, exportEditedPdfResult, type EditedPdfRequest } from './editing.js';
import { assertTagStructuresPreserved, snapshotTagStructures } from './tag-preservation.js';

const fixture = async () =>
  new Uint8Array(
    await readFile(new URL('../../test-corpus/fixtures/tagged-bookmarks.pdf', import.meta.url)),
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
      text: 'Tagged document overlay',
      variant: 'plain',
    },
  ],
  formValues: [
    { fieldName: 'tagged-field', sourceId: 'source', type: 'text', value: 'Filled value' },
  ],
  options: { flattenForms: false },
  pages: [0, 1].map((sourcePageIndex) => ({
    pageId: `page-${sourcePageIndex}`,
    rotation: 0,
    sourceId: 'source',
    sourcePageIndex,
  })),
  sources: [{ bytes, sourceId: 'source' }],
});

describe('EDIT-001 / ANNO-001–006 tagged direct export', () => {
  it('retains tag graph, MCIDs, content streams, rotated pages and OBJR identities while filling a form', async () => {
    const bytes = await fixture();
    const before = bytes.slice();
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const snapshot = await snapshotTagStructures(source);
    expect(snapshot).not.toBeNull();
    const result = await exportEditedPdfResult(request(bytes));
    expect(result.warnings).toEqual(['ANNOTATIONS_FLATTENED', 'ADDED_CONTENT_UNTAGGED']);
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    await expect(assertTagStructuresPreserved(snapshot, output)).resolves.toBeUndefined();
    expect(output.getForm().getTextField('tagged-field').getText()).toBe('Filled value');
    expect(output.getPage(1).getRotation().angle).toBe(90);
    expect(bytes).toEqual(before);
  });

  it.each(['reorder', 'rotate', 'delete', 'duplicate', 'multiple sources'] as const)(
    'refuses %s instead of dropping tag references',
    async (change) => {
      const input = request(await fixture());
      const pages = [...input.pages];
      const first = pages[0];
      const source = input.sources[0];
      if (first === undefined || source === undefined) throw new Error('Invalid fixture');
      if (change === 'reorder') pages.reverse();
      if (change === 'rotate') pages[0] = { ...first, rotation: 90 };
      if (change === 'delete') pages.pop();
      if (change === 'duplicate') pages.push({ ...first, pageId: 'duplicate' });
      await expect(
        exportEditedPdf({
          ...input,
          formValues: [],
          pages,
          sources:
            change === 'multiple sources'
              ? [...input.sources, { ...source, sourceId: 'second' }]
              : input.sources,
        }),
      ).rejects.toThrow('ORGANIZER_FORMS_BLOCKED');
    },
  );

  it('refuses tagged form flattening before removing OBJR widget targets', async () => {
    const input = request(await fixture());
    await expect(exportEditedPdf({ ...input, options: { flattenForms: true } })).rejects.toThrow(
      'EDIT_TAGGED_FORM_FLATTEN_UNSUPPORTED',
    );
  });

  it.each([
    'language',
    'role map',
    'reading order',
    'parent tree',
    'MCID',
    'page identity',
    'widget identity',
    'content removal',
  ] as const)('detects changed %s without exposing metadata', async (change) => {
    const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
    const before = await snapshotTagStructures(document);
    const root = document.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const page = document.getPage(0);
    if (change === 'language') document.catalog.set(PDFName.of('Lang'), PDFString.of('changed'));
    if (change === 'role map')
      root.set(PDFName.of('RoleMap'), document.context.obj({ CustomParagraph: 'Span' }));
    if (change === 'reading order')
      root.lookup(PDFName.of('K'), PDFArray).set(0, document.context.obj(42));
    if (change === 'parent tree') root.delete(PDFName.of('ParentTree'));
    if (change === 'MCID') {
      const raw = page.node.lookup(PDFName.of('Contents'), PDFArray).get(0);
      const replacement = document.context.register(
        document.context.flateStream('/P <</MCID 99>> BDC EMC'),
      );
      page.node.lookup(PDFName.of('Contents'), PDFArray).set(0, replacement);
      document.context.delete(raw as PDFRef);
    }
    if (change === 'page identity')
      page.node.set(PDFName.of('StructParents'), document.context.obj(99));
    if (change === 'widget identity')
      page.node
        .lookup(PDFName.of('Annots'), PDFArray)
        .lookup(0, PDFDict)
        .set(PDFName.of('StructParent'), document.context.obj(99));
    if (change === 'content removal') page.node.delete(PDFName.of('Contents'));
    await expect(assertTagStructuresPreserved(before, document)).rejects.toThrow(
      /^EDIT_TAG_PRESERVATION_FAILED$/u,
    );
  });

  it.each(['dangling', 'deep', 'oversized'] as const)(
    'bounds %s graphs with content-free errors',
    async (change) => {
      const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
      const root = document.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
      if (change === 'dangling') root.set(PDFName.of('K'), PDFRef.of(999999));
      if (change === 'oversized')
        root.set(PDFName.of('Canary'), PDFString.of('x'.repeat(8 * 1024 * 1024)));
      if (change === 'deep') {
        let cursor = root;
        for (let index = 0; index < 140; index++) {
          const next = document.context.obj({});
          cursor.set(PDFName.of('Nested'), next);
          cursor = next;
        }
      }
      await expect(snapshotTagStructures(document)).rejects.toThrow(
        /^EDIT_TAG_PRESERVATION_FAILED$/u,
      );
    },
  );

  it('does not invent tag preservation for untagged documents', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    await expect(snapshotTagStructures(document)).resolves.toBeNull();
  });

  it('resolves indirect stream filters instead of checking only their reference', async () => {
    const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
    const stream = document.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray).get(0);
    const resolved = document.context.lookup(stream);
    if (!(resolved instanceof PDFStream)) throw new Error('Invalid fixture');
    const filterRef = document.context.register(PDFName.of('FlateDecode'));
    resolved.dict.set(PDFName.of('Filter'), filterRef);
    const before = await snapshotTagStructures(document);
    document.context.assign(filterRef, PDFName.of('ASCIIHexDecode'));
    await expect(assertTagStructuresPreserved(before, document)).rejects.toThrow(
      /^EDIT_TAG_PRESERVATION_FAILED$/u,
    );
  });
});
