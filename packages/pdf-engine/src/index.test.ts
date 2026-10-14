import { degrees, PDFDocument, PDFName, PDFSignature, StandardFonts } from '@cantoo/pdf-lib';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  assemblePdf,
  compressPdfLosslessly,
  createBlankPdf,
  decoratePdf,
  exportEditedPdf,
  imagesToPdf,
  imageToPdf,
  formatPageLabel,
  inspectPdfGeometry,
  inspectImage,
  modifyPdfGeometry,
  numberPdf,
  parsePdfWorkerRequest,
  previewNumbering,
  protectPdf,
  readPdfMetadata,
  removePdfMetadata,
  resolveImageOrientation,
  UnavailablePdfEngine,
  unlockPdf,
  updatePdfMetadata,
} from './index.js';

describe('UnavailablePdfEngine', () => {
  it('fails explicitly and advertises no capabilities', async () => {
    const engine = new UnavailablePdfEngine();
    expect(engine.listCapabilities()).toEqual([]);
    await expect(
      engine.execute(
        { operation: 'foundation.none', options: {}, sources: [], version: '0.0.0' },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ category: 'capability_unavailable', ok: false });
  });
});

describe('local assembly adapter', () => {
  it('creates a structurally measured blank page for every supported size and orientation', async () => {
    for (const options of [
      { marginPoints: 36, orientation: 'portrait', pageSize: 'letter' },
      { marginPoints: 72, orientation: 'landscape', pageSize: 'a4' },
      { marginPoints: 0, orientation: 'portrait', pageSize: 'legal' },
    ] as const) {
      const bytes = await createBlankPdf(options);
      const output = await PDFDocument.load(bytes, { updateMetadata: false });
      const page = output.getPage(0);
      const { height, width } = page.getSize();
      expect(output.getPageCount()).toBe(1);
      expect(page.getArtBox()).toEqual({
        height: height - options.marginPoints * 2,
        width: width - options.marginPoints * 2,
        x: options.marginPoints,
        y: options.marginPoints,
      });
      expect(page.node.Contents()).toBeUndefined();
    }
  });

  it('rejects invalid or expanded blank-page requests at both engine boundaries', async () => {
    await expect(
      createBlankPdf({ marginPoints: 300, orientation: 'portrait', pageSize: 'letter' }),
    ).rejects.toThrow('UTILITY_BLANK_OPTIONS_INVALID');
    expect(() =>
      parsePdfWorkerRequest({
        id: 'blank-expanded',
        kind: 'blank-pdf',
        options: {
          marginPoints: 36,
          orientation: 'portrait',
          pageSize: 'letter',
          unexpected: true,
        },
      }),
    ).toThrow('request is invalid');
  });

  it('builds a new document from an immutable page plan', async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 500]);
    source.addPage([500, 300]);
    const sourceBytes = await source.save();
    const sourceHashBefore = sourceBytes.toString();

    const outputBytes = await assemblePdf(
      [{ bytes: sourceBytes, sourceId: 'source-a' }],
      [
        { rotation: 90, sourceId: 'source-a', sourcePageIndex: 1 },
        { rotation: 0, sourceId: 'source-a', sourcePageIndex: 0 },
      ],
    );
    const output = await PDFDocument.load(outputBytes);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(sourceBytes.toString()).toBe(sourceHashBefore);
  });

  it('blocks incompatible organizer sources before page copying', async () => {
    const synthetic = async (configure: (document: PDFDocument) => void): Promise<Uint8Array> => {
      const document = await PDFDocument.create();
      document.addPage([240, 320]);
      configure(document);
      return document.save();
    };
    const fixtureDirectory = new URL('../../test-corpus/fixtures/', import.meta.url);
    const cases = [
      {
        bytes: await synthetic((document) => {
          const field = document.getForm().createTextField('synthetic-field');
          field.addToPage(document.getPage(0));
        }),
        code: 'ORGANIZER_FORMS_BLOCKED',
      },
      {
        bytes: await synthetic((document) => {
          document.catalog.set(PDFName.of('StructTreeRoot'), document.context.obj({}));
        }),
        code: 'ORGANIZER_TAGGED_CONTENT_BLOCKED',
      },
      {
        bytes: await synthetic((document) => {
          document.catalog.set(
            PDFName.of('Outlines'),
            document.context.obj({ Count: 0, Type: PDFName.of('Outlines') }),
          );
        }),
        code: 'ORGANIZER_OUTLINES_BLOCKED',
      },
      {
        bytes: new Uint8Array(await readFile(new URL('file-attachment.pdf', fixtureDirectory))),
        code: 'ORGANIZER_ATTACHMENTS_BLOCKED',
      },
      {
        bytes: new Uint8Array(await readFile(new URL('embedded-javascript.pdf', fixtureDirectory))),
        code: 'ORGANIZER_ACTIVE_CONTENT_BLOCKED',
      },
      {
        bytes: new Uint8Array(
          await readFile(new URL('compression-incremental.pdf', fixtureDirectory)),
        ),
        code: 'ORGANIZER_INCREMENTAL_REVISIONS_BLOCKED',
      },
      {
        bytes: new TextEncoder().encode('%PDF-1.7\nsynthetic-damaged-structure'),
        code: 'ORGANIZER_INVALID_STRUCTURE',
      },
    ] as const;
    for (const [index, fixture] of cases.entries()) {
      await expect(
        assemblePdf(
          [{ bytes: fixture.bytes, sourceId: `risk-${index}` }],
          [{ rotation: 0, sourceId: `risk-${index}`, sourcePageIndex: 0 }],
        ),
      ).rejects.toThrow(new RegExp(`^${fixture.code}$`, 'u'));
    }
  });

  it('rejects ambiguous and cumulatively oversized assembly requests', () => {
    const page = { rotation: 0, sourceId: 'source-a', sourcePageIndex: 0 } as const;
    expect(() =>
      parsePdfWorkerRequest({
        id: 'duplicate-sources',
        kind: 'assemble',
        pages: [page],
        sources: [
          { bytes: new Uint8Array([1]), sourceId: 'source-a' },
          { bytes: new Uint8Array([2]), sourceId: 'source-a' },
        ],
      }),
    ).toThrow('safe limits');
    expect(() =>
      parsePdfWorkerRequest({
        annotations: [],
        formValues: [],
        id: 'duplicate-edit-sources',
        kind: 'export-edited',
        options: { flattenForms: false },
        pages: [{ pageId: 'page-a', ...page }],
        sources: [
          { bytes: new Uint8Array([1]), sourceId: 'source-a' },
          { bytes: new Uint8Array([2]), sourceId: 'source-a' },
        ],
      }),
    ).toThrow('safe limits');
    const fortyMegabytes = new Uint8Array(40 * 1024 * 1024);
    expect(() =>
      parsePdfWorkerRequest({
        id: 'cumulative-limit',
        kind: 'assemble',
        pages: [page],
        sources: ['source-a', 'source-b', 'source-c'].map((sourceId) => ({
          bytes: fortyMegabytes,
          sourceId,
        })),
      }),
    ).toThrow('safe limits');
  });

  it('wraps a synthetic PNG in a standalone PDF page', async () => {
    const png = Uint8Array.from(
      globalThis.atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );
    const output = await PDFDocument.load(await imageToPdf(png, 'image/png'));
    expect(output.getPageCount()).toBe(1);
  });

  it('inspects WebP geometry and EXIF orientation before browser decoding', async () => {
    const fixtureDirectory = new URL('../../test-corpus/fixtures/images/', import.meta.url);
    const orientedJpeg = new Uint8Array(
      await readFile(new URL('quadrants-orientation-6.jpg', fixtureDirectory)),
    );
    const orientedPng = new Uint8Array(
      await readFile(new URL('quadrants-orientation-6.png', fixtureDirectory)),
    );
    const webp = new Uint8Array(await readFile(new URL('split-colours.webp', fixtureDirectory)));
    const animatedWebp = new Uint8Array(
      await readFile(new URL('animated-two-frame.webp', fixtureDirectory)),
    );
    expect(inspectImage({ bytes: orientedJpeg, mimeType: 'image/jpeg' })).toMatchObject({
      encodedHeight: 20,
      encodedWidth: 40,
      orientation: 6,
    });
    expect(inspectImage({ bytes: orientedPng, mimeType: 'image/png' })).toMatchObject({
      encodedHeight: 20,
      encodedWidth: 40,
      orientation: 6,
    });
    expect(inspectImage({ bytes: webp, mimeType: 'image/webp' })).toMatchObject({
      encodedHeight: 18,
      encodedWidth: 30,
      orientation: 1,
    });
    expect(() => inspectImage({ bytes: webp, mimeType: 'image/png' })).toThrow(
      'UTILITY_IMAGE_INVALID',
    );
    expect(() => inspectImage({ bytes: animatedWebp, mimeType: 'image/webp' })).toThrow(
      'UTILITY_IMAGE_ANIMATION_UNSUPPORTED',
    );
    expect(
      parsePdfWorkerRequest({
        bytes: webp,
        id: 'webp-image',
        kind: 'image-to-pdf',
        mimeType: 'image/webp',
      }),
    ).toMatchObject({ kind: 'image-to-pdf', mimeType: 'image/webp' });
  });

  it('maps every EXIF orientation to bounded output geometry and a deterministic transform', () => {
    expect(
      ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((orientation) =>
        resolveImageOrientation(orientation, 40, 20),
      ),
    ).toEqual([
      { height: 20, transform: [1, 0, 0, 1, 0, 0], width: 40 },
      { height: 20, transform: [-1, 0, 0, 1, 40, 0], width: 40 },
      { height: 20, transform: [-1, 0, 0, -1, 40, 20], width: 40 },
      { height: 20, transform: [1, 0, 0, -1, 0, 20], width: 40 },
      { height: 40, transform: [0, 1, 1, 0, 0, 0], width: 20 },
      { height: 40, transform: [0, 1, -1, 0, 20, 0], width: 20 },
      { height: 40, transform: [0, -1, -1, 0, 20, 40], width: 20 },
      { height: 40, transform: [0, -1, 1, 0, 0, 40], width: 20 },
    ]);
  });

  it('creates a multi-page PDF from synthetic images with explicit sizing', async () => {
    const png = Uint8Array.from(
      globalThis.atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );
    const output = await PDFDocument.load(
      await imagesToPdf(
        [
          { bytes: png, mimeType: 'image/png' },
          { bytes: png, mimeType: 'image/png' },
        ],
        { fit: 'contain', pageSize: 'letter' },
      ),
    );
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getSize()).toEqual({ height: 792, width: 612 });
  });

  it('rejects an image composition whose combined input exceeds the memory bound', async () => {
    const sharedBytes = new Uint8Array(40 * 1024 * 1024);
    await expect(
      imagesToPdf(
        [
          { bytes: sharedBytes, mimeType: 'image/png' },
          { bytes: sharedBytes, mimeType: 'image/png' },
          { bytes: sharedBytes, mimeType: 'image/png' },
        ],
        { fit: 'contain', pageSize: 'image' },
      ),
    ).rejects.toThrow('UTILITY_IMAGE_TOTAL_SIZE_LIMIT');
    expect(() =>
      parsePdfWorkerRequest({
        id: 'total-image-limit',
        kind: 'images-to-pdf',
        options: { fit: 'contain', pageSize: 'image' },
        sources: [
          { bytes: sharedBytes, mimeType: 'image/png' },
          { bytes: sharedBytes, mimeType: 'image/png' },
          { bytes: sharedBytes, mimeType: 'image/png' },
        ],
      }),
    ).toThrow('request is invalid');
  });

  it('protects with AES-256, rejects a wrong password, and unlocks only after confirmation', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([320, 480]);
    const sourceBytes = await source.save();
    const password = 'synthetic-test-password';
    const protectedBytes = await protectPdf(sourceBytes, password);
    const encryptedInspection = await PDFDocument.load(protectedBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    expect(encryptedInspection.isEncrypted).toBe(true);
    await expect(
      PDFDocument.load(protectedBytes, { password: 'wrong-password', updateMetadata: false }),
    ).rejects.toThrow();
    await expect(unlockPdf(protectedBytes, password, false)).rejects.toThrow(
      'UTILITY_AUTHORIZATION_REQUIRED',
    );
    const unlockedBytes = await unlockPdf(protectedBytes, password, true);
    const unlocked = await PDFDocument.load(unlockedBytes, { updateMetadata: false });
    expect(unlocked.isEncrypted).toBe(false);
    expect(unlocked.getPageCount()).toBe(1);
  });

  it('views, edits, and completely removes common and XMP metadata', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([320, 480]);
    source.setTitle('Synthetic title');
    source.setAuthor('Synthetic author');
    source.setKeywords(['synthetic', 'fixture']);
    const sourceBytes = await source.save();
    expect(await readPdfMetadata(sourceBytes)).toMatchObject({
      author: 'Synthetic author',
      keywords: 'synthetic fixture',
      title: 'Synthetic title',
    });

    const editedBytes = await updatePdfMetadata(sourceBytes, {
      author: 'PDFMason test corpus',
      subject: 'Metadata utility verification',
      title: 'Updated synthetic title',
    });
    expect(await readPdfMetadata(editedBytes)).toMatchObject({
      author: 'PDFMason test corpus',
      subject: 'Metadata utility verification',
      title: 'Updated synthetic title',
    });

    const removed = await readPdfMetadata(await removePdfMetadata(editedBytes));
    expect(removed).toMatchObject({
      author: '',
      creationDate: null,
      creator: '',
      hasXmpPacket: false,
      keywords: '',
      modificationDate: null,
      producer: '',
      subject: '',
      title: '',
    });
  });

  it('reports lossless structural optimization without claiming an unmeasured size win', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([320, 480]);
    const sourceBytes = await source.save({ useObjectStreams: false });
    const sourceSnapshot = sourceBytes.toString();
    const result = await compressPdfLosslessly(sourceBytes, 'smaller');
    expect(result.report.method).toBe('lossless-structural');
    expect(result.report.warningCodes).toContain('LOSSLESS_ONLY');
    expect(result.bytes.byteLength).toBeLessThanOrEqual(sourceBytes.byteLength);
    expect(sourceBytes.toString()).toBe(sourceSnapshot);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  });

  it('adds repeating artifact decorations while preserving page geometry, forms, and source bytes', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    const first = source.addPage([420, 600]);
    first.setCropBox(20, 30, 380, 520);
    const second = source.addPage([600, 420]);
    second.setRotation(degrees(90));
    const form = source.getForm();
    const field = form.createTextField('synthetic.reference');
    field.setText('unchanged');
    field.addToPage(first, { height: 24, width: 180, x: 40, y: 500 });
    const sourceBytes = await source.save();
    const sourceSnapshot = sourceBytes.toString();

    const outputBytes = await decoratePdf(sourceBytes, {
      footer: {
        alignment: 'right',
        color: '#17232d',
        fontSize: 9,
        text: 'Page {page} of {pages}',
      },
      header: {
        alignment: 'left',
        color: '#17232d',
        fontSize: 9,
        text: 'Synthetic review copy',
      },
      marginPoints: 28,
      pageSelection: 'all',
      watermark: {
        color: '#60717c',
        fontSize: 42,
        opacity: 0.16,
        rotation: -35,
        text: 'INTERNAL',
      },
    });

    const output = await PDFDocument.load(outputBytes, { updateMetadata: false });
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getSize()).toEqual({ height: 600, width: 420 });
    expect(output.getPage(0).getCropBox()).toEqual({ height: 520, width: 380, x: 20, y: 30 });
    expect(output.getPage(1).getRotation().angle).toBe(90);
    expect(output.getForm().getTextField('synthetic.reference').getText()).toBe('unchanged');
    expect(outputBytes.byteLength).toBeGreaterThan(sourceBytes.byteLength);
    expect(sourceBytes.toString()).toBe(sourceSnapshot);
  });

  it('applies bounded page selection and substitutes page tokens', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([420, 600]);
    source.addPage([420, 600]);
    source.addPage([420, 600]);
    const sourceBytes = await source.save();
    const output = await PDFDocument.load(
      await decoratePdf(sourceBytes, {
        footer: {
          alignment: 'center',
          color: '#17232d',
          fontSize: 9,
          text: 'Selected {page} of {pages}',
        },
        header: null,
        marginPoints: 28,
        pageSelection: 'even',
        watermark: null,
      }),
      { updateMetadata: false },
    );
    const textByPage = output.getPages().map((page) =>
      page
        .extractContents()
        .filter((asset) => asset.kind === 'text')
        .map((asset) => asset.getText().trim()),
    );
    expect(textByPage).toEqual([[], ['Selected 2 of 3'], []]);
  });

  it('formats deterministic logical page-label and Bates previews', () => {
    expect(formatPageLabel('roman-lower', 14)).toBe('xiv');
    expect(formatPageLabel('roman-upper', 39)).toBe('XXXIX');
    expect(formatPageLabel('letters-upper', 27)).toBe('AA');
    expect(
      previewNumbering({
        alignment: 'right',
        color: '#17232d',
        digits: 6,
        endPage: null,
        fontSize: 9,
        kind: 'bates',
        marginPoints: 28,
        position: 'footer',
        prefix: 'CASE-',
        startNumber: 42,
        startPage: 1,
        suffix: '-A',
      }),
    ).toEqual(['CASE-000042-A', 'CASE-000043-A', 'CASE-000044-A']);
  });

  it('adds matching logical and visible labels, then preserves them during Bates numbering', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    const first = source.addPage([420, 600]);
    first.setCropBox(20, 30, 380, 520);
    source.addPage([420, 600]);
    source.addPage([600, 420]).setRotation(degrees(90));
    source.addPage([420, 600]);
    const form = source.getForm();
    const field = form.createTextField('synthetic.numbering');
    field.setText('preserved');
    field.addToPage(first, { height: 24, width: 160, x: 40, y: 500 });
    const sourceBytes = await source.save();
    const sourceSnapshot = sourceBytes.toString();

    const labeled = await numberPdf(sourceBytes, {
      alignment: 'center',
      color: '#17232d',
      endPage: 3,
      fontSize: 9,
      kind: 'page-labels',
      marginPoints: 28,
      position: 'footer',
      prefix: 'A-',
      replaceExistingLabels: false,
      startNumber: 1,
      startPage: 2,
      style: 'roman-lower',
    });
    expect(labeled.report).toEqual({
      appliedPages: 2,
      firstIdentifier: 'A-i',
      kind: 'page-labels',
      lastIdentifier: 'A-ii',
      operationVersion: '1.0.3',
      range: { endPage: 3, startPage: 2 },
      sourcePages: 4,
    });
    const labeledDocument = await PDFDocument.load(labeled.bytes, { updateMetadata: false });
    expect(labeledDocument.catalog.has(PDFName.of('PageLabels'))).toBe(true);
    expect(labeledDocument.getPage(0).getCropBox()).toEqual({
      height: 520,
      width: 380,
      x: 20,
      y: 30,
    });
    expect(labeledDocument.getPage(2).getRotation().angle).toBe(90);
    expect(labeledDocument.getForm().getTextField('synthetic.numbering').getText()).toBe(
      'preserved',
    );
    const labelText = labeledDocument.getPages().map((page) =>
      page
        .extractContents()
        .filter((asset) => asset.kind === 'text')
        .map((asset) => asset.getText().trim()),
    );
    expect(labelText[1]).toContain('A-i');
    expect(labelText[2]).toContain('A-ii');
    expect(labelText[3]).not.toContain('A-iii');
    expect(sourceBytes.toString()).toBe(sourceSnapshot);

    await expect(
      numberPdf(labeled.bytes, {
        alignment: 'center',
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
      }),
    ).rejects.toThrow('NUMBERING_PAGE_LABELS_EXIST');

    const bates = await numberPdf(labeled.bytes, {
      alignment: 'right',
      color: '#17232d',
      digits: 4,
      endPage: 4,
      fontSize: 8,
      kind: 'bates',
      marginPoints: 40,
      position: 'header',
      prefix: 'CASE-',
      startNumber: 7,
      startPage: 2,
      suffix: '',
    });
    expect(bates.report.firstIdentifier).toBe('CASE-0007');
    expect(bates.report.lastIdentifier).toBe('CASE-0009');
    const batesDocument = await PDFDocument.load(bates.bytes, { updateMetadata: false });
    expect(batesDocument.catalog.has(PDFName.of('PageLabels'))).toBe(true);
    expect(
      batesDocument
        .getPage(3)
        .extractContents()
        .filter((asset) => asset.kind === 'text')
        .map((asset) => asset.getText().trim()),
    ).toContain('CASE-0009');
    await expect(
      numberPdf(sourceBytes, {
        alignment: 'right',
        color: '#17232d',
        digits: 6,
        endPage: 2,
        fontSize: 9,
        kind: 'bates',
        marginPoints: 28,
        position: 'footer',
        prefix: 'CASE-',
        startNumber: 1,
        startPage: 3,
        suffix: '',
      }),
    ).rejects.toThrow('NUMBERING_PAGE_RANGE_INVALID');
  });

  it('crops displayed edges across page rotations without deleting content or forms', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    const first = source.addPage([400, 600]);
    first.setCropBox(20, 30, 360, 520);
    const second = source.addPage([600, 400]);
    second.setCropBox(10, 20, 560, 350);
    second.setRotation(degrees(90));
    const field = source.getForm().createTextField('synthetic.crop');
    field.setText('preserved');
    field.addToPage(first, { height: 20, width: 120, x: 80, y: 300 });
    const sourceBytes = await source.save();
    const sourceSnapshot = sourceBytes.toString();

    const result = await modifyPdfGeometry(sourceBytes, {
      endPage: null,
      kind: 'crop',
      margins: { bottom: 30, left: 40, right: 20, top: 10 },
      startPage: 1,
    });
    expect(result.report).toMatchObject({
      appliedPages: 2,
      kind: 'crop',
      operationVersion: '1.0.0',
      range: { endPage: 2, startPage: 1 },
      sourcePages: 2,
    });
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(output.getPage(0).getCropBox()).toEqual({ height: 480, width: 300, x: 60, y: 60 });
    expect(output.getPage(1).getCropBox()).toEqual({ height: 290, width: 520, x: 20, y: 60 });
    expect(output.getPage(1).getRotation().angle).toBe(90);
    expect(output.getForm().getTextField('synthetic.crop').getText()).toBe('preserved');
    expect(sourceBytes.toString()).toBe(sourceSnapshot);
  });

  it('normalizes mixed and rotated page sizes with contain/cover semantics', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.setTitle('Synthetic geometry');
    const first = source.addPage([400, 600]);
    first.drawText('FIT PAGE', { size: 24, x: 40, y: 300 });
    const second = source.addPage([700, 300]);
    second.setCropBox(20, 10, 660, 280);
    second.setRotation(degrees(90));
    second.drawText('ROTATED PAGE', { size: 24, x: 60, y: 140 });
    source.catalog.set(
      PDFName.of('PageLabels'),
      source.context.obj({ Nums: [0, { P: 'S-', S: 'D', St: 1, Type: 'PageLabel' }] }),
    );
    const sourceBytes = await source.save();
    const sourceSnapshot = sourceBytes.toString();

    const result = await modifyPdfGeometry(sourceBytes, {
      endPage: null,
      fit: 'contain',
      kind: 'resize',
      startPage: 1,
      targetHeight: 792,
      targetWidth: 612,
    });
    const inspection = await inspectPdfGeometry(result.bytes);
    expect(inspection.pages).toHaveLength(2);
    expect(inspection.pages[0]).toMatchObject({ visibleHeight: 792, visibleWidth: 612 });
    expect(inspection.pages[1]).toMatchObject({
      rotation: 90,
      visibleHeight: 792,
      visibleWidth: 612,
    });
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(output.getTitle()).toBe('Synthetic geometry');
    expect(output.catalog.has(PDFName.of('PageLabels'))).toBe(true);
    expect(output.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect(
      output
        .getPage(0)
        .extractContents()
        .filter((asset) => asset.kind === 'text')
        .map((asset) => asset.getText().trim()),
    ).toContain('FIT PAGE');
    expect(sourceBytes.toString()).toBe(sourceSnapshot);
  });

  it('fails closed when resize cannot preserve interactive, tagged, or prepress semantics', async () => {
    const options = {
      endPage: null,
      fit: 'contain',
      kind: 'resize',
      startPage: 1,
      targetHeight: 792,
      targetWidth: 612,
    } as const;
    const formSource = await PDFDocument.create({ updateMetadata: false });
    const formPage = formSource.addPage([400, 600]);
    formSource.getForm().createTextField('synthetic.resize').addToPage(formPage, {
      height: 20,
      width: 120,
      x: 40,
      y: 300,
    });
    await expect(modifyPdfGeometry(await formSource.save(), options)).rejects.toThrow(
      'GEOMETRY_FORMS_RESIZE_BLOCKED',
    );

    const taggedSource = await PDFDocument.create({ updateMetadata: false });
    taggedSource.addPage([400, 600]);
    taggedSource.catalog.set(PDFName.of('StructTreeRoot'), taggedSource.context.obj({}));
    await expect(modifyPdfGeometry(await taggedSource.save(), options)).rejects.toThrow(
      'GEOMETRY_TAGGED_RESIZE_BLOCKED',
    );

    const prepressSource = await PDFDocument.create({ updateMetadata: false });
    prepressSource.addPage([400, 600]).setTrimBox(10, 10, 380, 580);
    await expect(modifyPdfGeometry(await prepressSource.save(), options)).rejects.toThrow(
      'GEOMETRY_PREPRESS_RESIZE_BLOCKED',
    );
  });

  it('rejects crop margins that leave an unsafe visible page', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([200, 200]);
    await expect(
      modifyPdfGeometry(await source.save(), {
        endPage: null,
        kind: 'crop',
        margins: { bottom: 90, left: 90, right: 90, top: 90 },
        startPage: 1,
      }),
    ).rejects.toThrow('GEOMETRY_CROP_TOO_SMALL');
  });

  it('blocks active-content PDFs from the decoration export boundary', async () => {
    const source = await PDFDocument.create({ updateMetadata: false });
    source.addPage([420, 600]);
    source.addJavaScript('synthetic.fixture', 'app.alert("synthetic");');
    const activeContent = await source.save();
    await expect(
      decoratePdf(activeContent, {
        footer: null,
        header: null,
        marginPoints: 28,
        pageSelection: 'all',
        watermark: {
          color: '#60717c',
          fontSize: 42,
          opacity: 0.16,
          rotation: -35,
          text: 'INTERNAL',
        },
      }),
    ).rejects.toThrow('DECORATION_ACTIVE_CONTENT_BLOCKED');
    await expect(
      decoratePdf(activeContent, {
        footer: null,
        header: null,
        marginPoints: 28,
        pageSelection: 'all',
        watermark: {
          color: '#60717c',
          fontSize: 42,
          opacity: 1,
          rotation: -35,
          text: 'INTERNAL',
        },
      }),
    ).rejects.toThrow('DECORATION_OPTIONS_INVALID');
  });

  it('rejects malformed and over-limit worker messages at the boundary', () => {
    expect(() => parsePdfWorkerRequest({ id: 'bad', kind: 'assemble' })).toThrow(
      'exceeds its safe limits',
    );
    expect(() =>
      parsePdfWorkerRequest({
        bytes: new TextEncoder().encode('%PDF-synthetic'),
        id: 'unsafe-decoration-opacity',
        kind: 'decorate',
        options: {
          footer: null,
          header: null,
          marginPoints: 28,
          pageSelection: 'all',
          watermark: {
            color: '#60717c',
            fontSize: 42,
            opacity: 1,
            rotation: -35,
            text: 'INTERNAL',
          },
        },
      }),
    ).toThrow('request is invalid');
    expect(
      parsePdfWorkerRequest({
        bytes: new TextEncoder().encode('%PDF-synthetic'),
        id: 'valid-numbering',
        kind: 'number',
        options: {
          alignment: 'right',
          color: '#17232d',
          digits: 6,
          endPage: null,
          fontSize: 9,
          kind: 'bates',
          marginPoints: 28,
          position: 'footer',
          prefix: 'CASE-',
          startNumber: 1,
          startPage: 1,
          suffix: '',
        },
      }),
    ).toMatchObject({ kind: 'number' });
    expect(() =>
      parsePdfWorkerRequest({
        bytes: new TextEncoder().encode('%PDF-synthetic'),
        id: 'unsafe-numbering-digits',
        kind: 'number',
        options: {
          alignment: 'right',
          color: '#17232d',
          digits: 2,
          endPage: null,
          fontSize: 9,
          kind: 'bates',
          marginPoints: 28,
          position: 'footer',
          prefix: 'CASE-',
          startNumber: 1,
          startPage: 1,
          suffix: '',
        },
      }),
    ).toThrow('request is invalid');
    expect(
      parsePdfWorkerRequest({
        bytes: new TextEncoder().encode('%PDF-synthetic'),
        id: 'valid-geometry',
        kind: 'geometry-modify',
        options: {
          endPage: null,
          fit: 'contain',
          kind: 'resize',
          startPage: 1,
          targetHeight: 792,
          targetWidth: 612,
        },
      }),
    ).toMatchObject({ kind: 'geometry-modify' });
    expect(() =>
      parsePdfWorkerRequest({
        bytes: new TextEncoder().encode('%PDF-synthetic'),
        id: 'unsafe-geometry-size',
        kind: 'geometry-modify',
        options: {
          endPage: null,
          fit: 'contain',
          kind: 'resize',
          startPage: 1,
          targetHeight: 20,
          targetWidth: 612,
        },
      }),
    ).toThrow('request is invalid');
    expect(() =>
      parsePdfWorkerRequest({
        bytes: new Uint8Array(),
        id: 'bad-mime',
        kind: 'image-to-pdf',
        mimeType: 'image/svg+xml',
      }),
    ).toThrow('request is invalid');
    expect(() =>
      parsePdfWorkerRequest({
        annotations: [
          {
            appearance: {
              bytes: new Uint8Array(5 * 1024 * 1024 + 1),
              kind: 'image',
              mimeType: 'image/png',
            },
            id: 'signature',
            kind: 'visual-signature',
            label: 'signature',
            pageId: 'page-1',
            rect: { height: 0.1, width: 0.3, x: 0.1, y: 0.1 },
          },
        ],
        formValues: [],
        id: 'oversized-signature',
        kind: 'export-edited',
        options: { flattenForms: false },
        pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
        sources: [{ bytes: new Uint8Array([1]), sourceId: 'source' }],
      }),
    ).toThrow('safe limits');
    expect(
      parsePdfWorkerRequest({
        annotations: [
          {
            color: '#26756f',
            id: 'stamp',
            kind: 'stamp',
            pageId: 'page-1',
            rect: { height: 0.1, width: 0.3, x: 0.1, y: 0.1 },
            source: 'custom',
            text: 'QA passed',
          },
        ],
        formValues: [],
        id: 'valid-stamp',
        kind: 'export-edited',
        options: { flattenForms: false },
        pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
        sources: [{ bytes: new Uint8Array([1]), sourceId: 'source' }],
      }),
    ).toMatchObject({ kind: 'export-edited' });
    expect(() =>
      parsePdfWorkerRequest({
        annotations: [
          {
            color: '#26756f',
            id: 'stamp',
            kind: 'stamp',
            pageId: 'page-1',
            rect: { height: 0.1, width: 0.3, x: 0.1, y: 0.1 },
            source: 'custom',
            text: 'Not supported ☃',
          },
        ],
        formValues: [],
        id: 'invalid-stamp',
        kind: 'export-edited',
        options: { flattenForms: false },
        pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
        sources: [{ bytes: new Uint8Array(), sourceId: 'source' }],
      }),
    ).toThrow('safe limits');
    expect(() =>
      parsePdfWorkerRequest({
        annotations: [],
        formValues: [
          {
            fieldName: 'synthetic.approved',
            sourceId: 'source',
            type: 'checkbox',
            value: 'yes',
          },
        ],
        id: 'wrong-form-type',
        kind: 'export-edited',
        options: { flattenForms: false },
        pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
        sources: [{ bytes: new Uint8Array(), sourceId: 'source' }],
      }),
    ).toThrow('safe limits');
    const safePdf = new TextEncoder().encode('%PDF-synthetic');
    expect(
      parsePdfWorkerRequest({
        bytes: safePdf,
        confirmPermanentRemoval: true,
        confirmRasterization: true,
        id: 'redaction-valid',
        kind: 'redact-raster',
        marks: [{ pageIndex: 0, rect: { height: 0.1, width: 0.2, x: 0.3, y: 0.4 } }],
      }),
    ).toMatchObject({ kind: 'redact-raster' });
    expect(() =>
      parsePdfWorkerRequest({
        bytes: safePdf,
        confirmPermanentRemoval: true,
        confirmRasterization: true,
        id: 'redaction-outside-page',
        kind: 'redact-raster',
        marks: [{ pageIndex: 0, rect: { height: 0.2, width: 0.4, x: 0.8, y: 0.8 } }],
      }),
    ).toThrow('request is invalid');
  });

  it('exports flattened overlays on a rotated page without changing source bytes', async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([420, 600]);
    page.drawText('Synthetic Milestone 2 source', { font, size: 16, x: 36, y: 540 });
    const sourceBytes = await source.save();
    const sourceHashBefore = sourceBytes.toString();
    const outputBytes = await exportEditedPdf({
      annotations: [
        {
          alignment: 'left',
          color: '#17232d',
          fontSize: 18,
          id: 'text-1',
          kind: 'text',
          pageId: 'page-1',
          rect: { height: 0.08, width: 0.45, x: 0.1, y: 0.14 },
          text: 'Added locally',
          variant: 'box',
        },
        {
          alignment: 'left',
          color: '#17232d',
          fontSize: 12,
          id: 'callout-1',
          kind: 'text',
          pageId: 'page-1',
          rect: { height: 0.08, width: 0.3, x: 0.58, y: 0.2 },
          text: 'Callout',
          variant: 'callout',
        },
        {
          color: '#f4d35e',
          id: 'highlight-1',
          kind: 'markup',
          opacity: 0.35,
          pageId: 'page-1',
          rect: { height: 0.04, width: 0.4, x: 0.1, y: 0.3 },
          style: 'highlight',
        },
        {
          fillColor: null,
          id: 'arrow-1',
          kind: 'shape',
          pageId: 'page-1',
          rect: { height: 0.12, width: 0.35, x: 0.15, y: 0.45 },
          shape: 'arrow',
          strokeColor: '#c65d3b',
          strokeWidth: 2,
        },
        {
          color: '#c65d3b',
          id: 'ink-1',
          kind: 'ink',
          pageId: 'page-1',
          points: [
            { x: 0.1, y: 0.62 },
            { x: 0.2, y: 0.58 },
            { x: 0.3, y: 0.65 },
          ],
          rect: { height: 0.07, width: 0.2, x: 0.1, y: 0.58 },
          strokeWidth: 2,
        },
        {
          author: 'Synthetic reviewer',
          color: '#a86200',
          createdAt: '2026-08-21T00:00:00.000Z',
          id: 'comment-1',
          kind: 'comment',
          pageId: 'page-1',
          rect: { height: 0.1, width: 0.28, x: 0.08, y: 0.72 },
          status: 'open',
          text: 'Synthetic comment',
        },
        {
          appearance: { color: '#17232d', kind: 'typed', text: 'PDF Mason' },
          id: 'signature-1',
          kind: 'visual-signature',
          label: 'signature',
          pageId: 'page-1',
          rect: { height: 0.08, width: 0.35, x: 0.5, y: 0.72 },
        },
        {
          appearance: {
            color: '#17232d',
            kind: 'drawn',
            points: [
              { x: 0, y: 0.6 },
              { x: 0.45, y: 0.1 },
              { x: 1, y: 0.55 },
            ],
          },
          id: 'signature-drawn',
          kind: 'visual-signature',
          label: 'initials',
          pageId: 'page-1',
          rect: { height: 0.06, width: 0.16, x: 0.76, y: 0.65 },
        },
        {
          appearance: {
            bytes: Uint8Array.from(
              globalThis.atob(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              ),
              (character) => character.charCodeAt(0),
            ),
            kind: 'image',
            mimeType: 'image/png',
          },
          id: 'signature-image',
          kind: 'visual-signature',
          label: 'signature',
          pageId: 'page-1',
          rect: { height: 0.04, width: 0.1, x: 0.82, y: 0.83 },
        },
        {
          color: '#17232d',
          id: 'checkmark-1',
          kind: 'utility-mark',
          mark: 'checkmark',
          pageId: 'page-1',
          rect: { height: 0.04, width: 0.04, x: 0.42, y: 0.86 },
          text: 'Checkmark',
        },
        {
          color: '#26756f',
          id: 'stamp-1',
          kind: 'stamp',
          pageId: 'page-1',
          rect: { height: 0.09, width: 0.34, x: 0.1, y: 0.88 },
          source: 'custom',
          text: 'Reviewed locally',
        },
      ],
      formValues: [],
      options: { flattenForms: false },
      pages: [{ pageId: 'page-1', rotation: 90, sourceId: 'source', sourcePageIndex: 0 }],
      sources: [{ bytes: sourceBytes, sourceId: 'source' }],
    });
    const output = await PDFDocument.load(outputBytes);
    expect(output.getPageCount()).toBe(1);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(
      output
        .getPage(0)
        .extractContents()
        .filter((asset) => asset.kind === 'text')
        .map((asset) => asset.getText().trim()),
    ).toContain('REVIEWED LOCALLY');
    expect(outputBytes.byteLength).toBeGreaterThan(sourceBytes.byteLength);
    expect(sourceBytes.toString()).toBe(sourceHashBefore);
  });

  it('edits a synthetic signature-field copy without mutating the source or dropping the field', async () => {
    const sourceBytes = new Uint8Array(
      await readFile(new URL('../../test-corpus/fixtures/signature-field.pdf', import.meta.url)),
    );
    const snapshot = sourceBytes.slice();
    const outputBytes = await exportEditedPdf({
      annotations: [
        {
          alignment: 'left',
          color: '#17232d',
          fontSize: 12,
          id: 'signed-copy-note',
          kind: 'text',
          pageId: 'page-1',
          rect: { height: 0.08, width: 0.35, x: 0.1, y: 0.18 },
          text: 'Edited copy',
          variant: 'box',
        },
      ],
      formValues: [],
      options: { flattenForms: false },
      pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
      sources: [{ bytes: sourceBytes, sourceId: 'source' }],
    });
    const output = await PDFDocument.load(outputBytes, { updateMetadata: false });

    expect(sourceBytes).toEqual(snapshot);
    expect(
      output
        .getForm()
        .getFields()
        .some((field) => field instanceof PDFSignature),
    ).toBe(true);
  });

  it('preserves an empty signature field without inventing a signature value', async () => {
    const sourceBytes = new Uint8Array(
      await readFile(
        new URL('../../test-corpus/fixtures/signature-field-empty.pdf', import.meta.url),
      ),
    );
    const snapshot = sourceBytes.slice();
    const outputBytes = await exportEditedPdf({
      annotations: [
        {
          alignment: 'left',
          color: '#17232d',
          fontSize: 12,
          id: 'empty-signature-copy-note',
          kind: 'text',
          pageId: 'page-1',
          rect: { height: 0.08, width: 0.35, x: 0.1, y: 0.18 },
          text: 'Edited empty-field copy',
          variant: 'box',
        },
      ],
      formValues: [],
      options: { flattenForms: false },
      pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
      sources: [{ bytes: sourceBytes, sourceId: 'source' }],
    });
    const output = await PDFDocument.load(outputBytes, { updateMetadata: false });
    const signature = output
      .getForm()
      .getFields()
      .find((field): field is PDFSignature => field instanceof PDFSignature);

    expect(sourceBytes).toEqual(snapshot);
    expect(signature).toBeDefined();
    expect(signature?.acroField.dict.has(PDFName.of('V'))).toBe(false);
  });

  it('updates AcroForm values and verifies both interactive and flattened exports', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([500, 650]);
    const form = source.getForm();
    const name = form.createTextField('person.name');
    name.addToPage(page, { height: 28, width: 220, x: 50, y: 560 });
    const approved = form.createCheckBox('person.approved');
    approved.addToPage(page, { height: 20, width: 20, x: 50, y: 510 });
    const choice = form.createRadioGroup('person.choice');
    choice.addOptionToPage('A', page, { height: 18, width: 18, x: 50, y: 460 });
    choice.addOptionToPage('B', page, { height: 18, width: 18, x: 100, y: 460 });
    const province = form.createDropdown('person.province');
    province.addOptions(['ON', 'QC']);
    province.addToPage(page, { height: 28, width: 100, x: 50, y: 410 });
    const sourceBytes = await source.save();
    const formValues = [
      { fieldName: 'person.name', sourceId: 'source', type: 'text' as const, value: 'Alex Mason' },
      { fieldName: 'person.approved', sourceId: 'source', type: 'checkbox' as const, value: true },
      { fieldName: 'person.choice', sourceId: 'source', type: 'radio' as const, value: 'B' },
      { fieldName: 'person.province', sourceId: 'source', type: 'dropdown' as const, value: 'QC' },
    ];
    const request = {
      annotations: [],
      formValues,
      pages: [{ pageId: 'page-1', rotation: 0 as const, sourceId: 'source', sourcePageIndex: 0 }],
      sources: [{ bytes: sourceBytes, sourceId: 'source' }],
    };
    const interactiveBytes = await exportEditedPdf({
      ...request,
      options: { flattenForms: false },
    });
    const interactive = await PDFDocument.load(interactiveBytes);
    expect(interactive.getForm().getTextField('person.name').getText()).toBe('Alex Mason');
    expect(interactive.getForm().getCheckBox('person.approved').isChecked()).toBe(true);
    expect(interactive.getForm().getRadioGroup('person.choice').getSelected()).toBe('B');
    expect(interactive.getForm().getDropdown('person.province').getSelected()).toEqual(['QC']);

    const cleared = await PDFDocument.load(
      await exportEditedPdf({
        ...request,
        formValues: formValues.map((value) =>
          value.type === 'radio' || value.type === 'dropdown' ? { ...value, value: '' } : value,
        ),
        options: { flattenForms: false },
      }),
    );
    expect(cleared.getForm().getRadioGroup('person.choice').getSelected()).toBeUndefined();
    expect(cleared.getForm().getDropdown('person.province').getSelected()).toEqual([]);

    const flattened = await PDFDocument.load(
      await exportEditedPdf({ ...request, options: { flattenForms: true } }),
    );
    expect(flattened.getForm().getFields()).toHaveLength(0);
  });
});
