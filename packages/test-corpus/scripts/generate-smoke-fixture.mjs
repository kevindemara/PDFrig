import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  degrees,
  PDFArray,
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFString,
  rgb,
  StandardFonts,
} from '@cantoo/pdf-lib';

const fixtureDirectory = fileURLToPath(new URL('../fixtures/', import.meta.url));
const fixedDate = new Date('2026-08-21T00:00:00.000Z');
const fixtures = [];

const configureDocument = async (label, pageSizes = [[612, 792]], drawBaseline = true) => {
  const document = await PDFDocument.create();
  document.setCreator('PDFMason synthetic corpus generator');
  document.setProducer('PDFMason synthetic corpus generator');
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  document.setTitle(label);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = pageSizes.map((size, index) => {
    const page = document.addPage(size);
    if (drawBaseline) {
      page.drawText(label, { font, size: 18, x: 54, y: size[1] - 72 });
      page.drawText(`Synthetic page ${index + 1} — no user data`, {
        color: rgb(0.36, 0.43, 0.48),
        font,
        size: 10,
        x: 54,
        y: size[1] - 94,
      });
    }
    return page;
  });
  return { document, font, pages };
};

const register = (
  filename,
  expectedPageCount,
  expectedFeatures,
  featureIds,
  mutate,
  expectedWarnings = [],
  pageSizes,
  blankBase = false,
  saveOptions = undefined,
  transformBytes = undefined,
) => {
  fixtures.push({
    blankBase,
    expectedFeatures,
    expectedPageCount,
    expectedWarnings,
    featureIds,
    filename,
    mutate,
    pageSizes,
    saveOptions,
    transformBytes,
  });
};

const appendIncrementalMetadataRevision = (bytes) => {
  const source = Buffer.from(bytes);
  const text = source.toString('latin1');
  const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref\s*(\d+)\s*%%EOF\s*$/u.exec(text);
  if (trailer === null) throw new Error('Expected a classic trailer for incremental fixture.');
  const dictionary = trailer[1] ?? '';
  const previousStartXref = trailer[2];
  const root = /\/Root\s+(\d+\s+\d+\s+R)/u.exec(dictionary)?.[1];
  const info = /\/Info\s+(\d+)\s+(\d+)\s+R/u.exec(dictionary);
  const size = /\/Size\s+(\d+)/u.exec(dictionary)?.[1];
  if (previousStartXref === undefined || root === undefined || info === null || size === undefined)
    throw new Error('Missing incremental fixture trailer fields.');
  const objectNumber = info[1];
  const generation = info[2];
  if (objectNumber === undefined || generation === undefined)
    throw new Error('Missing incremental fixture info reference.');
  const objectOffset = source.byteLength;
  const updatedInfo = Buffer.from(
    `${objectNumber} ${generation} obj\n<<\n/Title (compression-incremental.pdf)\n/Author (PDFMason synthetic generator)\n/Subject (Current synthetic incremental revision; no user data)\n/Creator (PDFMason synthetic corpus generator)\n/Producer (PDFMason synthetic corpus generator)\n>>\nendobj\n`,
    'ascii',
  );
  const xrefOffset = objectOffset + updatedInfo.byteLength;
  const revision = Buffer.from(
    `xref\n${objectNumber} 1\n${String(objectOffset).padStart(10, '0')} ${generation.padStart(5, '0')} n \ntrailer\n<<\n/Size ${size}\n/Root ${root}\n/Info ${objectNumber} ${generation} R\n/Prev ${previousStartXref}\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'ascii',
  );
  return Buffer.concat([source, updatedInfo, revision]);
};

const patchRecognizedSignatureByteRange = (bytes) => {
  const source = Buffer.from(bytes);
  const text = source.toString('latin1');
  const contentsToken = '<0102030405060708>';
  const contentsStart = text.indexOf(contentsToken);
  if (contentsStart === -1) throw new Error('Missing synthetic signature contents token.');
  const contentsEnd = contentsStart + contentsToken.length;
  const byteRangePattern = /\/ByteRange\s*\[\s*0\s+9999999999\s+9999999999\s+9999999999\s*\]/u;
  const byteRange = byteRangePattern.exec(text)?.[0];
  if (byteRange === undefined) throw new Error('Missing synthetic signature byte-range slots.');
  const values = [contentsStart, contentsEnd, source.byteLength - contentsEnd];
  let valueIndex = 0;
  const replacement = byteRange.replace(/9999999999/gu, () => {
    const value = values[valueIndex];
    valueIndex += 1;
    if (value === undefined || value > 9_999_999_999)
      throw new Error('Synthetic signature byte range exceeds its reserved slot.');
    return String(value).padStart(10, '0');
  });
  const updated = text.replace(byteRange, replacement);
  if (Buffer.byteLength(updated, 'latin1') !== source.byteLength)
    throw new Error('Synthetic signature byte-range patch changed the fixture length.');
  return Buffer.from(updated, 'latin1');
};

const createSyntheticScan = () =>
  readFile(new URL('../fixtures/sources/scanned-ocr.png', import.meta.url));

register('smoke-one-page.pdf', 1, ['single-page', 'standard-font', 'text-content'], ['VIEW-001']);
register(
  'multipage-three.pdf',
  3,
  ['multi-page', 'text-content'],
  ['VIEW-001', 'VIEW-004'],
  undefined,
  [],
  [
    [612, 792],
    [612, 792],
    [612, 792],
  ],
);
register(
  'mixed-page-sizes.pdf',
  3,
  ['mixed-page-sizes'],
  ['VIEW-001', 'ORG-001'],
  undefined,
  [],
  [
    [612, 792],
    [595, 842],
    [792, 612],
  ],
);
register(
  'rotated-pages.pdf',
  4,
  ['page-rotation'],
  ['VIEW-003', 'ORG-004'],
  ({ pages }) => {
    pages[1].setRotation(degrees(90));
    pages[2].setRotation(degrees(180));
    pages[3].setRotation(degrees(270));
  },
  [],
  [
    [612, 792],
    [612, 792],
    [612, 792],
    [612, 792],
  ],
);
register('landscape-page.pdf', 1, ['landscape'], ['VIEW-001'], undefined, [], [[792, 612]]);
register(
  'searchable-text.pdf',
  2,
  ['text-content', 'search-target'],
  ['VIEW-005'],
  ({ pages, font }) => {
    pages[0].drawText('masonry compass', { font, size: 14, x: 54, y: 630 });
    pages[1].drawText('masonry compass second result', { font, size: 14, x: 54, y: 630 });
  },
  [],
  [
    [612, 792],
    [612, 792],
  ],
);
register(
  'acroform-text-field.pdf',
  1,
  ['acroform', 'text-field', 'checkbox', 'radio-group', 'dropdown'],
  ['FORM-001', 'FORM-002', 'FORM-007'],
  ({ document, font, pages }) => {
    const page = pages[0];
    const form = document.getForm();
    page.drawText('Name', { font, size: 10, x: 54, y: 655 });
    const field = form.createTextField('synthetic.name');
    field.setText('Synthetic value');
    field.addToPage(page, { height: 28, width: 220, x: 54, y: 620 });
    page.drawText('Approved', { font, size: 10, x: 82, y: 582 });
    form.createCheckBox('synthetic.approved').addToPage(page, {
      height: 20,
      width: 20,
      x: 54,
      y: 575,
    });
    page.drawText('Choice A', { font, size: 10, x: 82, y: 535 });
    page.drawText('Choice B', { font, size: 10, x: 180, y: 535 });
    const choice = form.createRadioGroup('synthetic.choice');
    choice.addOptionToPage('A', page, { height: 18, width: 18, x: 54, y: 528 });
    choice.addOptionToPage('B', page, { height: 18, width: 18, x: 152, y: 528 });
    page.drawText('Province', { font, size: 10, x: 54, y: 492 });
    const province = form.createDropdown('synthetic.province');
    province.addOptions(['ON', 'QC', 'BC']);
    province.select('ON');
    province.addToPage(page, { height: 28, width: 120, x: 54, y: 455 });
  },
  ['FORMS'],
);
register(
  'signature-field.pdf',
  1,
  ['acroform', 'signature-field', 'unsigned-signature-fixture'],
  ['SEC-007'],
  ({ document, pages }) => {
    const signatureValue = document.context.obj({
      ByteRange: [0, 0, 0, 0],
      Contents: PDFHexString.of('00'),
      Filter: PDFName.of('Adobe.PPKLite'),
      M: PDFString.of('D:20260828000000Z'),
      Name: PDFString.of('Synthetic signer — no identity claim'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      Type: PDFName.of('Sig'),
    });
    const signatureValueReference = document.context.register(signatureValue);
    const field = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-field'),
      Type: PDFName.of('Annot'),
      V: signatureValueReference,
    });
    const fieldReference = document.context.register(field);
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([fieldReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [fieldReference], SigFlags: 3 }),
    );
  },
  ['SIGNATURES'],
);
register(
  'signature-field-empty.pdf',
  1,
  ['acroform', 'signature-field', 'empty-signature-field'],
  ['SEC-007'],
  ({ document, pages }) => {
    const field = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.empty-signature-field'),
      Type: PDFName.of('Annot'),
    });
    const fieldReference = document.context.register(field);
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([fieldReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [fieldReference] }),
    );
  },
  ['SIGNATURES'],
);
register(
  'signature-malformed-value.pdf',
  1,
  ['acroform', 'signature-field', 'malformed-signature-value'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    const page = pages[0];
    page.drawText('signature-malformed-value.pdf', { font, size: 18, x: 54, y: 720 });
    page.drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    page.drawText('Malformed signature value - parser recovery evidence', {
      font,
      size: 10,
      x: 54,
      y: 650,
    });
    page.drawRectangle({
      borderColor: rgb(0.36, 0.43, 0.48),
      borderWidth: 1,
      height: 50,
      width: 240,
      x: 54,
      y: 580,
    });
    const field = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: page.ref,
      Rect: [54, 580, 294, 630],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-malformed-value'),
      Type: PDFName.of('Annot'),
      V: document.context.obj([1, 2, 3]),
    });
    const fieldReference = document.context.register(field);
    page.node.set(PDFName.of('Annots'), document.context.obj([fieldReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [fieldReference], SigFlags: 3 }),
    );
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-orphan-widget.pdf',
  1,
  ['signature-field', 'orphan-signature-widget'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    const page = pages[0];
    page.drawText('signature-orphan-widget.pdf', { font, size: 18, x: 54, y: 720 });
    page.drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    page.drawText('Orphan signature widget - parser boundary evidence', {
      font,
      size: 10,
      x: 54,
      y: 650,
    });
    page.drawRectangle({
      borderColor: rgb(0.36, 0.43, 0.48),
      borderWidth: 1,
      height: 50,
      width: 240,
      x: 54,
      y: 580,
    });
    const widget = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: page.ref,
      Rect: [54, 580, 294, 630],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-orphan-widget'),
      Type: PDFName.of('Annot'),
    });
    const widgetReference = document.context.register(widget);
    page.node.set(PDFName.of('Annots'), document.context.obj([widgetReference]));
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-with-text-field.pdf',
  1,
  ['acroform', 'signature-field', 'text-field', 'mixed-form-fields'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    const page = pages[0];
    page.drawText('signature-with-text-field.pdf', { font, size: 18, x: 54, y: 720 });
    page.drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    page.drawText('Action-free text field', { font, size: 10, x: 54, y: 650 });
    page.drawRectangle({
      borderColor: rgb(0.36, 0.43, 0.48),
      borderWidth: 1,
      height: 32,
      width: 240,
      x: 54,
      y: 608,
    });
    page.drawText('Empty signature field', { font, size: 10, x: 54, y: 570 });
    page.drawRectangle({
      borderColor: rgb(0.36, 0.43, 0.48),
      borderWidth: 1,
      height: 50,
      width: 240,
      x: 54,
      y: 510,
    });
    const textField = document.context.obj({
      FT: PDFName.of('Tx'),
      F: 4,
      P: page.ref,
      Rect: [54, 608, 294, 640],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.action-free-text'),
      Type: PDFName.of('Annot'),
      V: PDFString.of(''),
    });
    const textReference = document.context.register(textField);
    const signatureField = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: page.ref,
      Rect: [54, 510, 294, 560],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-with-text-field'),
      Type: PDFName.of('Annot'),
    });
    const signatureReference = document.context.register(signatureField);
    page.node.set(PDFName.of('Annots'), document.context.obj([textReference, signatureReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [textReference, signatureReference] }),
    );
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-with-text-field-action.pdf',
  1,
  ['acroform', 'signature-field', 'text-field', 'mixed-form-fields', 'explicit-field-action'],
  ['SEC-006', 'SEC-007'],
  ({ document, font, pages }) => {
    const page = pages[0];
    page.drawText('signature-with-text-field-action.pdf', { font, size: 18, x: 54, y: 720 });
    page.drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    page.drawText('Action-bearing text field', { font, size: 10, x: 54, y: 650 });
    page.drawRectangle({
      borderColor: rgb(0.36, 0.43, 0.48),
      borderWidth: 1,
      height: 32,
      width: 240,
      x: 54,
      y: 608,
    });
    page.drawText('Empty signature field', { font, size: 10, x: 54, y: 570 });
    page.drawRectangle({
      borderColor: rgb(0.36, 0.43, 0.48),
      borderWidth: 1,
      height: 50,
      width: 240,
      x: 54,
      y: 510,
    });
    const textField = document.context.obj({
      AA: {
        U: {
          JS: PDFString.of('/* synthetic text-field action canary; never execute */'),
          S: PDFName.of('JavaScript'),
        },
      },
      FT: PDFName.of('Tx'),
      F: 4,
      P: page.ref,
      Rect: [54, 608, 294, 640],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.action-bearing-text'),
      Type: PDFName.of('Annot'),
      V: PDFString.of(''),
    });
    const textReference = document.context.register(textField);
    const signatureField = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: page.ref,
      Rect: [54, 510, 294, 560],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-with-text-field-action'),
      Type: PDFName.of('Annot'),
    });
    const signatureReference = document.context.register(signatureField);
    page.node.set(PDFName.of('Annots'), document.context.obj([textReference, signatureReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [textReference, signatureReference] }),
    );
  },
  ['ACTIVE_CONTENT', 'SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-field-action.pdf',
  1,
  ['acroform', 'signature-field', 'explicit-field-action'],
  ['SEC-006', 'SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-field-action.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const field = document.context.obj({
      AA: {
        U: {
          JS: PDFString.of('/* synthetic signature action canary; never execute */'),
          S: PDFName.of('JavaScript'),
        },
      },
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-field-action'),
      Type: PDFName.of('Annot'),
    });
    const fieldReference = document.context.register(field);
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([fieldReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [fieldReference] }),
    );
  },
  ['ACTIVE_CONTENT', 'SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-parent-field-action.pdf',
  1,
  ['acroform', 'signature-field', 'parent-widget-signature-field', 'explicit-field-action'],
  ['SEC-006', 'SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-parent-field-action.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const parent = document.context.obj({
      AA: {
        U: {
          JS: PDFString.of('/* synthetic parent signature action canary; never execute */'),
          S: PDFName.of('JavaScript'),
        },
      },
      FT: PDFName.of('Sig'),
      T: PDFString.of('synthetic.signature-parent-field-action'),
    });
    const parentReference = document.context.register(parent);
    const widget = document.context.obj({
      F: 4,
      P: pages[0].ref,
      Parent: parentReference,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      Type: PDFName.of('Annot'),
    });
    const widgetReference = document.context.register(widget);
    parent.set(PDFName.of('Kids'), document.context.obj([widgetReference]));
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([widgetReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [parentReference] }),
    );
  },
  ['ACTIVE_CONTENT', 'SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-child-widget-action.pdf',
  1,
  ['acroform', 'signature-field', 'parent-widget-signature-field', 'explicit-field-action'],
  ['SEC-006', 'SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-child-widget-action.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const parent = document.context.obj({
      FT: PDFName.of('Sig'),
      T: PDFString.of('synthetic.signature-child-widget-action'),
    });
    const parentReference = document.context.register(parent);
    const widget = document.context.obj({
      AA: {
        U: {
          JS: PDFString.of('/* synthetic child signature action canary; never execute */'),
          S: PDFName.of('JavaScript'),
        },
      },
      F: 4,
      P: pages[0].ref,
      Parent: parentReference,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      Type: PDFName.of('Annot'),
    });
    const widgetReference = document.context.register(widget);
    parent.set(PDFName.of('Kids'), document.context.obj([widgetReference]));
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([widgetReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [parentReference] }),
    );
  },
  ['ACTIVE_CONTENT', 'SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-cross-page-action.pdf',
  2,
  ['acroform', 'signature-field', 'cross-page-action', 'explicit-annotation-action'],
  ['SEC-006', 'SEC-007'],
  ({ document, font, pages }) => {
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      pages[pageIndex].drawText('signature-cross-page-action.pdf', {
        font,
        size: 18,
        x: 54,
        y: 720,
      });
      pages[pageIndex].drawText(`Synthetic page ${pageIndex + 1} - no user data`, {
        color: rgb(0.36, 0.43, 0.48),
        font,
        size: 10,
        x: 54,
        y: 698,
      });
    }
    const signatureField = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-cross-page-action'),
      Type: PDFName.of('Annot'),
    });
    const signatureReference = document.context.register(signatureField);
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([signatureReference]));
    const actionAnnotation = document.context.obj({
      AA: {
        U: {
          JS: PDFString.of('/* synthetic cross-page action canary; never execute */'),
          S: PDFName.of('JavaScript'),
        },
      },
      Border: [0, 0, 0],
      F: 4,
      P: pages[1].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Link'),
      Type: PDFName.of('Annot'),
    });
    const actionReference = document.context.register(actionAnnotation);
    pages[1].node.set(PDFName.of('Annots'), document.context.obj([actionReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [signatureReference] }),
    );
  },
  ['ACTIVE_CONTENT', 'SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-metadata-placeholder.pdf',
  1,
  ['acroform', 'signature-field', 'signature-metadata-placeholder'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-metadata-placeholder.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const signatureValue = document.context.obj({
      ByteRange: [0, 9_999_999_999, 9_999_999_999, 9_999_999_999],
      ContactInfo: PDFString.of('synthetic-contact-canary@example.invalid'),
      Contents: PDFHexString.of('0102030405060708'),
      Filter: PDFName.of('Adobe.PPKLite'),
      Location: PDFString.of('Synthetic metadata location canary'),
      M: PDFString.of('D:20260828000000Z'),
      Name: PDFString.of('Synthetic metadata signer canary - no identity claim'),
      Reason: PDFString.of('Synthetic metadata reason canary'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      Type: PDFName.of('Sig'),
    });
    const signatureValueReference = document.context.register(signatureValue);
    const field = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-metadata-placeholder'),
      Type: PDFName.of('Annot'),
      V: signatureValueReference,
    });
    const fieldReference = document.context.register(field);
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([fieldReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [fieldReference], SigFlags: 3 }),
    );
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
  patchRecognizedSignatureByteRange,
);
register(
  'signature-mixed-fields.pdf',
  1,
  ['acroform', 'signature-field', 'mixed-signature-detection'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-mixed-fields.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const emptyField = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.mixed-signature-empty'),
      Type: PDFName.of('Annot'),
    });
    const emptyFieldReference = document.context.register(emptyField);
    const signatureValue = document.context.obj({
      ByteRange: [0, 9_999_999_999, 9_999_999_999, 9_999_999_999],
      ContactInfo: PDFString.of('mixed-contact-canary@example.invalid'),
      Contents: PDFHexString.of('0102030405060708'),
      Filter: PDFName.of('Adobe.PPKLite'),
      Location: PDFString.of('Mixed metadata location canary'),
      M: PDFString.of('D:20260828000000Z'),
      Name: PDFString.of('Mixed metadata signer canary - no identity claim'),
      Reason: PDFString.of('Mixed metadata reason canary'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      Type: PDFName.of('Sig'),
    });
    const signatureValueReference = document.context.register(signatureValue);
    const metadataField = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [280, 560, 466, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.mixed-signature-metadata'),
      Type: PDFName.of('Annot'),
      V: signatureValueReference,
    });
    const metadataFieldReference = document.context.register(metadataField);
    pages[0].node.set(
      PDFName.of('Annots'),
      document.context.obj([emptyFieldReference, metadataFieldReference]),
    );
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({
        Fields: [emptyFieldReference, metadataFieldReference],
        SigFlags: 3,
      }),
    );
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
  patchRecognizedSignatureByteRange,
);
register(
  'signature-byte-range-out-of-bounds.pdf',
  1,
  ['acroform', 'signature-field', 'out-of-bounds-signature-byte-range'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-byte-range-out-of-bounds.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const signatureValue = document.context.obj({
      ByteRange: [0, 64, 999_999, 64],
      ContactInfo: PDFString.of('out-of-bounds-contact-canary@example.invalid'),
      Contents: PDFHexString.of('1020304050607080'),
      Filter: PDFName.of('Adobe.PPKLite'),
      Location: PDFString.of('Out-of-bounds metadata location canary'),
      M: PDFString.of('D:20260828000000Z'),
      Name: PDFString.of('Out-of-bounds metadata signer canary - no identity claim'),
      Reason: PDFString.of('Out-of-bounds metadata reason canary'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      Type: PDFName.of('Sig'),
    });
    const signatureValueReference = document.context.register(signatureValue);
    const field = document.context.obj({
      FT: PDFName.of('Sig'),
      F: 4,
      P: pages[0].ref,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      T: PDFString.of('synthetic.signature-byte-range-out-of-bounds'),
      Type: PDFName.of('Annot'),
      V: signatureValueReference,
    });
    const fieldReference = document.context.register(field);
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([fieldReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [fieldReference], SigFlags: 3 }),
    );
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'signature-parent-widget.pdf',
  1,
  ['acroform', 'signature-field', 'parent-widget-signature-field'],
  ['SEC-007'],
  ({ document, font, pages }) => {
    pages[0].drawText('signature-parent-widget.pdf', {
      font,
      size: 18,
      x: 54,
      y: 720,
    });
    pages[0].drawText('Synthetic page 1 - no user data', {
      color: rgb(0.36, 0.43, 0.48),
      font,
      size: 10,
      x: 54,
      y: 698,
    });
    const parent = document.context.obj({
      FT: PDFName.of('Sig'),
      T: PDFString.of('synthetic.signature-parent-widget'),
    });
    const parentReference = document.context.register(parent);
    const widget = document.context.obj({
      F: 4,
      P: pages[0].ref,
      Parent: parentReference,
      Rect: [54, 560, 240, 610],
      Subtype: PDFName.of('Widget'),
      Type: PDFName.of('Annot'),
    });
    const widgetReference = document.context.register(widget);
    parent.set(PDFName.of('Kids'), document.context.obj([widgetReference]));
    pages[0].node.set(PDFName.of('Annots'), document.context.obj([widgetReference]));
    document.catalog.set(
      PDFName.of('AcroForm'),
      document.context.obj({ Fields: [parentReference] }),
    );
  },
  ['SIGNATURES'],
  undefined,
  true,
  { useObjectStreams: false },
);
register(
  'file-attachment.pdf',
  1,
  ['attachment'],
  ['SEC-006', 'VIEW-007'],
  async ({ document }) => {
    await document.attach(
      new TextEncoder().encode('Synthetic attachment; no user data.'),
      'synthetic-note.txt',
      { mimeType: 'text/plain' },
    );
  },
  ['ATTACHMENTS'],
);
register(
  'embedded-javascript.pdf',
  1,
  ['active-content', 'javascript'],
  ['SEC-006'],
  ({ document }) => {
    document.addJavaScript('synthetic-noop', '/* synthetic fixture; never execute */');
  },
  ['ACTIVE_CONTENT'],
);
register('metadata.pdf', 1, ['document-metadata'], ['SEC-004'], ({ document }) => {
  document.setAuthor('PDFMason synthetic generator');
  document.setSubject('Purpose-created fixture');
  document.setKeywords(['synthetic', 'fixture']);
});
register(
  'embedded-png.pdf',
  1,
  ['raster-image'],
  ['VIEW-001', 'ORG-008'],
  async ({ document, pages }) => {
    const png = await document.embedPng(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    );
    pages[0].drawImage(png, { height: 160, width: 160, x: 54, y: 520 });
  },
);
register('vector-shapes.pdf', 1, ['vector-graphics'], ['VIEW-001'], ({ pages }) => {
  pages[0].drawRectangle({
    borderColor: rgb(0.78, 0.36, 0.23),
    borderWidth: 3,
    color: rgb(0.95, 0.87, 0.82),
    height: 140,
    width: 220,
    x: 54,
    y: 500,
  });
  pages[0].drawLine({
    color: rgb(0.09, 0.14, 0.18),
    end: { x: 274, y: 500 },
    start: { x: 54, y: 640 },
    thickness: 2,
  });
});
register('cropped-page.pdf', 1, ['crop-box', 'media-box'], ['VIEW-001'], ({ pages }) => {
  pages[0].setCropBox(36, 36, 540, 720);
});
register(
  'many-pages-25.pdf',
  25,
  ['many-pages', 'lazy-thumbnails'],
  ['VIEW-004'],
  undefined,
  [],
  Array.from({ length: 25 }, () => [612, 792]),
);
register('narrow-page.pdf', 1, ['unusual-aspect-ratio'], ['VIEW-001'], undefined, [], [[240, 792]]);
register(
  'many-pages-500.pdf',
  500,
  ['many-pages', 'virtual-thumbnails', 'mixed-page-sizes', 'rotated-pages'],
  ['VIEW-004', 'ORG-003', 'ORG-004', 'ORG-005'],
  ({ pages }) => {
    pages.forEach((page, index) => {
      if (index % 10 === 9) page.setRotation(degrees(90));
    });
  },
  [],
  Array.from({ length: 500 }, (_, index) =>
    index % 3 === 0 ? [612, 792] : index % 3 === 1 ? [842, 595] : [300, 400],
  ),
);
register('wide-page.pdf', 1, ['unusual-aspect-ratio'], ['VIEW-001'], undefined, [], [[1000, 300]]);
register(
  'large-dimensions.pdf',
  1,
  ['large-page-dimensions'],
  ['VIEW-001'],
  undefined,
  [],
  [[2000, 2000]],
);
register('blank-page.pdf', 1, ['blank-page'], ['VIEW-001'], ({ pages }) => {
  pages[0].drawRectangle({ color: rgb(1, 1, 1), height: 1, width: 1, x: 0, y: 0 });
});
register(
  'duplicate-source-pages.pdf',
  3,
  ['duplicate-content'],
  ['ORG-005'],
  undefined,
  [],
  [
    [612, 792],
    [612, 792],
    [612, 792],
  ],
);
register(
  'password-aes256.pdf',
  1,
  ['encrypted', 'password-required'],
  ['VIEW-002', 'SEC-006'],
  ({ document }) => {
    document.encrypt({
      algorithm: 'AES-256',
      ownerPassword: 'pdfmason-owner-test',
      userPassword: 'pdfmason-test',
    });
  },
  ['ENCRYPTED'],
);

register(
  'scanned-ocr.pdf',
  1,
  ['raster-image', 'synthetic-scan', 'no-text-layer'],
  ['OCR-001'],
  async ({ document, pages }) => {
    const image = await document.embedPng(await createSyntheticScan());
    pages[0].drawImage(image, { height: 180, width: 600, x: 6, y: 306 });
  },
  [],
  [[612, 792]],
  true,
);

register(
  'redaction-markers.pdf',
  1,
  ['redaction-marker', 'metadata', 'acroform', 'attachment', 'active-content'],
  ['REDACT-001'],
  async ({ document, font, pages }) => {
    const marker = 'M5_SECRET_BRICK_4827';
    document.setAuthor(marker);
    document.setSubject(marker);
    document.setKeywords([marker]);
    document.addJavaScript('synthetic-marker', `/* ${marker} */`);
    await document.attach(new TextEncoder().encode(marker), 'synthetic-marker.txt', {
      mimeType: 'text/plain',
    });
    const field = document.getForm().createTextField('synthetic.redaction.marker');
    field.setText(marker);
    field.addToPage(pages[0], { height: 28, width: 260, x: 176, y: 350 });
    pages[0].drawText(marker, { font, size: 20, x: 176, y: 405 });
  },
  ['ACTIVE_CONTENT', 'ATTACHMENTS', 'FORMS'],
);

register(
  'decoration-placement.pdf',
  11,
  [
    'placement-warning',
    'text-content',
    'vector-graphics',
    'raster-image',
    'acroform',
    'page-rotation',
    'crop-box',
    'faint-content',
    'intentional-background',
  ],
  ['EDIT-006'],
  async ({ document, font, pages }) => {
    // Blank / header text / footer vector / header image / form appearance / faint ink /
    // intentional background / outside-glyph ink / rotated ink / cropped ink.
    pages[1].drawText('Synthetic existing header', { font, size: 10, x: 54, y: 764 });
    pages[2].drawRectangle({ x: 54, y: 28, width: 100, height: 8, color: rgb(0, 0, 0) });
    const image = await document.embedPng(createSyntheticScan());
    pages[3].drawImage(image, { x: 54, y: 760, width: 240, height: 16 });
    const field = document.getForm().createTextField('synthetic.placement.field');
    field.setText('Synthetic value');
    field.addToPage(pages[4], { x: 54, y: 756, width: 180, height: 24 });
    pages[5].drawRectangle({ x: 54, y: 760, width: 100, height: 8, color: rgb(0.96, 0.96, 0.96) });
    pages[6].drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.8, 0.8, 0.8) });
    pages[7].drawRectangle({ x: 520, y: 760, width: 30, height: 8, color: rgb(0, 0, 0) });
    pages[8].setRotation(degrees(90));
    pages[8].drawRectangle({ x: 20, y: 100, width: 8, height: 80, color: rgb(0, 0, 0) });
    pages[9].setCropBox(36, 36, 540, 720);
    pages[9].drawText('Synthetic cropped header', { font, size: 10, x: 54, y: 728 });
    pages[10].setSize(3000, 3000);
  },
  ['FORMS'],
  undefined,
  true,
);

register(
  'outline-navigation.pdf',
  3,
  ['multi-page', 'text-content', 'outline', 'nested-outline', 'named-destination'],
  ['VIEW-006'],
  ({ document, pages }) => {
    const [firstPage, secondPage, thirdPage] = pages;
    const outlineRoot = document.context.obj({ Count: 6, Type: PDFName.of('Outlines') });
    const outlineRootReference = document.context.register(outlineRoot);

    const overview = document.context.obj({
      Dest: [firstPage.ref, PDFName.of('Fit')],
      Parent: outlineRootReference,
      Title: PDFString.of('Overview'),
    });
    const overviewReference = document.context.register(overview);
    const namedSection = document.context.obj({
      Dest: PDFString.of('chapter-two'),
      Parent: overviewReference,
      Title: PDFHexString.fromText('Chapitre 二 — 安全'),
    });
    const namedSectionReference = document.context.register(namedSection);
    const actionOnly = document.context.obj({
      A: {
        S: PDFName.of('URI'),
        URI: PDFString.of('https://example.invalid/outline-action-must-not-open'),
      },
      Parent: overviewReference,
      Title: PDFString.of('External action is never followed'),
    });
    const actionOnlyReference = document.context.register(actionOnly);
    const missingDestination = document.context.obj({
      Dest: PDFString.of('missing-page'),
      Parent: overviewReference,
      Title: PDFString.of('Missing destination'),
    });
    const missingDestinationReference = document.context.register(missingDestination);
    const longTitle = document.context.obj({
      Dest: [secondPage.ref, PDFName.of('Fit')],
      Parent: overviewReference,
      Title: PDFString.of(`Long synthetic bookmark ${'x'.repeat(220)}`),
    });
    const longTitleReference = document.context.register(longTitle);
    const finalPage = document.context.obj({
      Dest: [thirdPage.ref, PDFName.of('Fit')],
      Parent: outlineRootReference,
      Prev: overviewReference,
      Title: PDFString.of('Final page'),
    });
    const finalPageReference = document.context.register(finalPage);

    overview.set(PDFName.of('Count'), document.context.obj(4));
    overview.set(PDFName.of('First'), namedSectionReference);
    overview.set(PDFName.of('Last'), longTitleReference);
    overview.set(PDFName.of('Next'), finalPageReference);
    namedSection.set(PDFName.of('Next'), actionOnlyReference);
    actionOnly.set(PDFName.of('Prev'), namedSectionReference);
    actionOnly.set(PDFName.of('Next'), missingDestinationReference);
    missingDestination.set(PDFName.of('Prev'), actionOnlyReference);
    missingDestination.set(PDFName.of('Next'), longTitleReference);
    longTitle.set(PDFName.of('Prev'), missingDestinationReference);
    outlineRoot.set(PDFName.of('First'), overviewReference);
    outlineRoot.set(PDFName.of('Last'), finalPageReference);
    document.catalog.set(PDFName.of('Outlines'), outlineRootReference);

    document.catalog.set(
      PDFName.of('Names'),
      document.context.obj({
        Dests: {
          Names: [PDFString.of('chapter-two'), [secondPage.ref, PDFName.of('Fit')]],
        },
      }),
    );
  },
  ['OUTLINES'],
  undefined,
  false,
  { useObjectStreams: false },
);

register(
  'compression-preservation.pdf',
  1,
  [
    'text-content',
    'document-metadata',
    'xmp-metadata',
    'acroform',
    'annotation',
    'link',
    'tagged-content',
    'outline',
    'optional-content',
    'nested-optional-content',
    'optional-content-radio-groups',
    'output-intent',
  ],
  [
    'OPT-001',
    'SEC-004',
    'FORM-001',
    'ANNO-002',
    'EDIT-004',
    'VIEW-007',
    'ORG-001',
    'ORG-002',
    'ORG-006',
    'ORG-007',
  ],
  ({ document, font, pages }) => {
    const page = pages[0];
    document.setAuthor('PDFMason synthetic generator');
    document.setSubject('Compression structure preservation fixture');
    document.setKeywords(['synthetic', 'compression', 'preservation']);
    document.catalog.set(PDFName.of('Lang'), PDFString.of('en-CA'));
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Synthetic preservation metadata</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const metadata = document.context.flateStream(new TextEncoder().encode(xmp), {
      Subtype: PDFName.of('XML'),
      Type: PDFName.of('Metadata'),
    });
    document.catalog.set(PDFName.of('Metadata'), document.context.register(metadata));

    page.drawText('Preservation field', { font, size: 10, x: 54, y: 655 });
    const field = document.getForm().createTextField('synthetic.preservation.name');
    field.setText('Preserved synthetic value');
    field.addToPage(page, { height: 28, width: 240, x: 54, y: 620 });

    const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray);
    const note = document.context.obj({
      Contents: PDFString.of('Synthetic preservation note'),
      Name: PDFName.of('Comment'),
      Rect: [330, 620, 354, 644],
      Subtype: PDFName.of('Text'),
      Type: PDFName.of('Annot'),
    });
    annotations.push(document.context.register(note));
    const link = document.context.obj({
      A: {
        S: PDFName.of('URI'),
        URI: PDFString.of('https://example.invalid/pdfmason-preservation'),
      },
      Border: [0, 0, 1],
      Rect: [54, 570, 300, 594],
      Subtype: PDFName.of('Link'),
      Type: PDFName.of('Annot'),
    });
    annotations.push(document.context.register(link));
    page.drawText('Synthetic safe link marker', { font, size: 11, x: 58, y: 578 });

    const structTreeRoot = document.context.obj({
      K: [],
      Type: PDFName.of('StructTreeRoot'),
    });
    document.catalog.set(PDFName.of('StructTreeRoot'), document.context.register(structTreeRoot));
    document.catalog.set(PDFName.of('MarkInfo'), document.context.obj({ Marked: true }));

    const outlines = document.context.obj({ Count: 0, Type: PDFName.of('Outlines') });
    const outlinesReference = document.context.register(outlines);
    const outlineItem = document.context.obj({
      Dest: [page.ref, PDFName.of('Fit')],
      Parent: outlinesReference,
      Title: PDFString.of('Synthetic preservation bookmark'),
    });
    const outlineItemReference = document.context.register(outlineItem);
    outlines.set(PDFName.of('Count'), document.context.obj(1));
    outlines.set(PDFName.of('First'), outlineItemReference);
    outlines.set(PDFName.of('Last'), outlineItemReference);
    document.catalog.set(PDFName.of('Outlines'), outlinesReference);

    const optionalContentGroup = document.context.obj({
      Name: PDFString.of('Synthetic optional content group'),
      Type: PDFName.of('OCG'),
    });
    const optionalContentGroupReference = document.context.register(optionalContentGroup);
    const hiddenOptionalContentGroup = document.context.obj({
      Name: PDFString.of('Synthetic hidden optional content group'),
      Type: PDFName.of('OCG'),
    });
    const hiddenOptionalContentGroupReference = document.context.register(
      hiddenOptionalContentGroup,
    );
    document.catalog.set(
      PDFName.of('OCProperties'),
      document.context.obj({
        D: {
          Name: PDFString.of('Synthetic layer configuration'),
          OFF: [hiddenOptionalContentGroupReference],
          RBGroups: [[optionalContentGroupReference, hiddenOptionalContentGroupReference]],
          Order: [
            [
              PDFString.of('Review layers'),
              optionalContentGroupReference,
              [PDFString.of('Secondary'), hiddenOptionalContentGroupReference],
            ],
          ],
        },
        OCGs: [optionalContentGroupReference, hiddenOptionalContentGroupReference],
      }),
    );

    const outputIntent = document.context.obj({
      OutputConditionIdentifier: PDFString.of('Synthetic output intent'),
      S: PDFName.of('GTS_PDFX'),
      Type: PDFName.of('OutputIntent'),
    });
    document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([outputIntent]));
  },
  ['FORMS', 'TAGGED_CONTENT'],
  undefined,
  false,
  { useObjectStreams: false },
);

register(
  'compression-incremental.pdf',
  1,
  ['incremental-revision', 'text-content', 'document-metadata'],
  ['OPT-001'],
  undefined,
  ['INCREMENTAL_REVISIONS'],
  undefined,
  false,
  { useObjectStreams: false },
  appendIncrementalMetadataRevision,
);

register(
  'tagged-bookmarks.pdf',
  2,
  [
    'tagged-reading-order',
    'mcid-content',
    'parent-tree',
    'role-map',
    'class-map',
    'id-tree',
    'outline',
    'tagged-form-widget',
    'rotated-page',
  ],
  ['EDIT-001', 'ANNO-001', 'ANNO-003', 'VIEW-006', 'FORM-001', 'FORM-002'],
  ({ document, pages, font }) => {
    const context = document.context;
    const root = context.obj({ Type: 'StructTreeRoot', ParentTreeNextKey: 3 });
    const rootRef = context.register(root);
    const elements = pages.map((page, index) => {
      page.node.set(PDFName.of('StructParents'), context.obj(index));
      page.pushOperators(PDFOperator.of('BDC', [PDFName.of('P'), context.obj({ MCID: 0 })]));
      page.drawText(`Tagged synthetic paragraph ${index + 1}`, { font, size: 18, x: 54, y: 690 });
      page.pushOperators(PDFOperator.of('EMC'));
      const element = context.obj({
        Type: 'StructElem',
        S: 'CustomParagraph',
        P: rootRef,
        Pg: page.ref,
        K: [{ Type: 'MCR', Pg: page.ref, MCID: 0 }],
        C: 'ParagraphStyle',
        ID: PDFString.of(`paragraph-${index}`),
        ActualText: PDFString.of(`Tagged synthetic paragraph ${index + 1}`),
      });
      return context.register(element);
    });
    pages[1].setRotation(degrees(90));
    const field = document.getForm().createTextField('tagged-field');
    field.setText('Original');
    field.addToPage(pages[0], { x: 54, y: 180, width: 200, height: 24 });
    document.getForm().updateFieldAppearances(font);
    const widgetRef = pages[0].node.lookup(PDFName.of('Annots'), PDFArray).get(0);
    context.lookup(widgetRef, PDFDict).set(PDFName.of('StructParent'), context.obj(2));
    const formRef = context.register(
      context.obj({
        Type: 'StructElem',
        S: 'Form',
        P: rootRef,
        Pg: pages[0].ref,
        K: { Type: 'OBJR', Pg: pages[0].ref, Obj: widgetRef },
      }),
    );
    root.set(PDFName.of('K'), context.obj([...elements, formRef]));
    root.set(
      PDFName.of('ParentTree'),
      context.register(context.obj({ Nums: [0, [elements[0]], 1, [elements[1]], 2, formRef] })),
    );
    root.set(PDFName.of('RoleMap'), context.obj({ CustomParagraph: 'P' }));
    root.set(
      PDFName.of('ClassMap'),
      context.obj({ ParagraphStyle: { O: 'Layout', TextAlign: 'Start' } }),
    );
    root.set(
      PDFName.of('IDTree'),
      context.obj({
        Names: [PDFString.of('paragraph-0'), elements[0], PDFString.of('paragraph-1'), elements[1]],
      }),
    );
    document.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
    document.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
    document.catalog.set(PDFName.of('Lang'), PDFString.of('en-CA'));
    const outlines = context.obj({ Type: 'Outlines', Count: 1 });
    const outlineRef = context.register(outlines);
    const item = context.register(
      context.obj({
        Title: PDFString.of('Tagged chapter'),
        Parent: outlineRef,
        Dest: [pages[0].ref, 'Fit'],
      }),
    );
    outlines.set(PDFName.of('First'), item);
    outlines.set(PDFName.of('Last'), item);
    document.catalog.set(PDFName.of('Outlines'), outlineRef);
  },
  ['ADDED_CONTENT_UNTAGGED'],
  undefined,
  true,
);

if (fixtures.length !== 42) throw new Error(`Expected 42 fixtures, received ${fixtures.length}.`);
const selectiveFixtures = Object.freeze({
  '--ocr-only': 'scanned-ocr.pdf',
  '--tagged-only': 'tagged-bookmarks.pdf',
  '--virtual-thumbnails-only': 'many-pages-500.pdf',
  '--empty-signature-only': 'signature-field-empty.pdf',
  '--signature-child-action-only': 'signature-child-widget-action.pdf',
  '--signature-cross-page-action-only': 'signature-cross-page-action.pdf',
  '--incremental-only': 'compression-incremental.pdf',
  '--outline-only': 'outline-navigation.pdf',
  '--placement-only': 'decoration-placement.pdf',
  '--preservation-only': 'compression-preservation.pdf',
  '--signature-only': 'signature-field.pdf',
  '--signature-action-only': 'signature-field-action.pdf',
  '--signature-malformed-value-only': 'signature-malformed-value.pdf',
  '--signature-metadata-only': 'signature-metadata-placeholder.pdf',
  '--signature-mixed-only': 'signature-mixed-fields.pdf',
  '--signature-orphan-widget-only': 'signature-orphan-widget.pdf',
  '--signature-out-of-bounds-only': 'signature-byte-range-out-of-bounds.pdf',
  '--signature-parent-action-only': 'signature-parent-field-action.pdf',
  '--signature-parent-widget-only': 'signature-parent-widget.pdf',
  '--signature-with-text-field-only': 'signature-with-text-field.pdf',
  '--signature-with-text-field-action-only': 'signature-with-text-field-action.pdf',
});
const selectedFixture =
  process.argv[2] === undefined ? undefined : selectiveFixtures[process.argv[2]];
if (process.argv.length > 3 || (process.argv.length > 2 && selectedFixture === undefined))
  throw new Error('Unknown fixture generation argument');
await mkdir(fixtureDirectory, { recursive: true });
const manifestEntries =
  selectedFixture === undefined
    ? []
    : JSON.parse(await readFile(`${fixtureDirectory}manifest.json`, 'utf8')).fixtures;
for (const fixture of fixtures.filter(
  (item) => selectedFixture === undefined || item.filename === selectedFixture,
)) {
  const pageSizes =
    fixture.pageSizes ?? Array.from({ length: fixture.expectedPageCount }, () => [612, 792]);
  const context = await configureDocument(fixture.filename, pageSizes, !fixture.blankBase);
  if (fixture.mutate !== undefined) await fixture.mutate(context);
  const savedBytes = await context.document.save({
    addDefaultPage: false,
    useObjectStreams: true,
    ...fixture.saveOptions,
  });
  const bytes =
    fixture.transformBytes === undefined
      ? savedBytes
      : await fixture.transformBytes(savedBytes, context);
  await writeFile(`${fixtureDirectory}${fixture.filename}`, bytes);
  const manifestEntry = {
    expectedFeatures: fixture.expectedFeatures,
    expectedPageCount: fixture.expectedPageCount,
    expectedWarnings: fixture.expectedWarnings,
    featureIds: fixture.featureIds,
    filename: fixture.filename,
    license: 'CC0-1.0',
    origin: 'Purpose-created by the PDFMason project generator',
    sensitivity: 'none',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const existingIndex = manifestEntries.findIndex(({ filename }) => filename === fixture.filename);
  if (existingIndex === -1) manifestEntries.push(manifestEntry);
  else manifestEntries.splice(existingIndex, 1, manifestEntry);
}
await writeFile(
  `${fixtureDirectory}manifest.json`,
  `${JSON.stringify({ fixtures: manifestEntries, schemaVersion: 1 }, null, 2)}\n`,
  'utf8',
);
