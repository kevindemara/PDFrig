/// <reference types="node" />
import { readFile } from 'node:fs/promises';

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertCompressionStructurePreserved } from './compression-preservation.js';
import { compressPdfLosslessly, compressionPresets } from './utilities.js';
import { startPdfWorker } from './worker-runtime.js';
import type { PdfWorkerRequest, PdfWorkerResponse } from './worker.js';

const fixture = () =>
  readFile(new URL('../../test-corpus/fixtures/compression-preservation.pdf', import.meta.url));

const textValue = (dictionary: PDFDict, key: string): string | undefined =>
  dictionary.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText();

const verifyPreservedFixture = async (bytes: Uint8Array): Promise<void> => {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(document.getAuthor()).toBe('PDFMason synthetic generator');
  expect(document.getSubject()).toBe('Compression structure preservation fixture');
  expect(document.getKeywords()).toBe('synthetic compression preservation');
  expect(document.catalog.lookup(PDFName.of('Lang'), PDFString).decodeText()).toBe('en-CA');
  expect(document.catalog.has(PDFName.of('Metadata'))).toBe(true);
  expect(document.catalog.has(PDFName.of('StructTreeRoot'))).toBe(true);
  expect(document.catalog.has(PDFName.of('MarkInfo'))).toBe(true);
  expect(document.catalog.has(PDFName.of('Outlines'))).toBe(true);
  expect(document.catalog.has(PDFName.of('OCProperties'))).toBe(true);
  expect(document.catalog.has(PDFName.of('OutputIntents'))).toBe(true);
  expect(document.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).size()).toBe(1);
  const optionalContent = document.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
  const optionalGroups = optionalContent.lookup(PDFName.of('OCGs'), PDFArray);
  expect(optionalGroups.size()).toBe(2);
  expect(
    Array.from({ length: optionalGroups.size() }, (_, index) =>
      textValue(optionalGroups.lookup(index, PDFDict), 'Name'),
    ),
  ).toEqual(['Synthetic optional content group', 'Synthetic hidden optional content group']);
  const optionalDefaults = optionalContent.lookup(PDFName.of('D'), PDFDict);
  expect(textValue(optionalDefaults, 'Name')).toBe('Synthetic layer configuration');
  const hiddenGroups = optionalDefaults.lookup(PDFName.of('OFF'), PDFArray);
  expect(textValue(hiddenGroups.lookup(0, PDFDict), 'Name')).toBe(
    'Synthetic hidden optional content group',
  );
  const radioGroups = optionalDefaults.lookup(PDFName.of('RBGroups'), PDFArray);
  const radioGroup = radioGroups.lookup(0, PDFArray);
  expect(
    Array.from({ length: radioGroup.size() }, (_, index) =>
      textValue(radioGroup.lookup(index, PDFDict), 'Name'),
    ),
  ).toEqual(['Synthetic optional content group', 'Synthetic hidden optional content group']);
  const reviewOrder = optionalDefaults.lookup(PDFName.of('Order'), PDFArray).lookup(0, PDFArray);
  expect(reviewOrder.lookup(0, PDFString).decodeText()).toBe('Review layers');
  expect(textValue(reviewOrder.lookup(1, PDFDict), 'Name')).toBe(
    'Synthetic optional content group',
  );
  const secondaryOrder = reviewOrder.lookup(2, PDFArray);
  expect(secondaryOrder.lookup(0, PDFString).decodeText()).toBe('Secondary');
  expect(textValue(secondaryOrder.lookup(1, PDFDict), 'Name')).toBe(
    'Synthetic hidden optional content group',
  );
  expect(document.getForm().getTextField('synthetic.preservation.name').getText()).toBe(
    'Preserved synthetic value',
  );

  const annotations = document.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  const dictionaries = Array.from({ length: annotations.size() }, (_, index) =>
    annotations.lookup(index, PDFDict),
  );
  expect(
    dictionaries
      .map((annotation) => annotation.lookup(PDFName.of('Subtype'), PDFName).asString())
      .sort(),
  ).toEqual(['/Link', '/Text', '/Widget']);
  const note = dictionaries.find(
    (annotation) => annotation.lookup(PDFName.of('Subtype'), PDFName).asString() === '/Text',
  );
  expect(note === undefined ? undefined : textValue(note, 'Contents')).toBe(
    'Synthetic preservation note',
  );
  const link = dictionaries.find(
    (annotation) => annotation.lookup(PDFName.of('Subtype'), PDFName).asString() === '/Link',
  );
  const action = link?.lookupMaybe(PDFName.of('A'), PDFDict);
  expect(action === undefined ? undefined : textValue(action, 'URI')).toBe(
    'https://example.invalid/pdfmason-preservation',
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OPT-001 compression structure preservation', () => {
  it.each(compressionPresets)('preserves the bounded structure matrix for %s', async (preset) => {
    const source = await fixture();
    const snapshot = new Uint8Array(source);
    const result = await compressPdfLosslessly(source, preset);
    expect(source.every((byte, index) => byte === snapshot[index])).toBe(true);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(source.byteLength);
    if (preset === 'highest-quality') {
      expect(result.report.usedOriginal).toBe(true);
    } else {
      expect(result.report.usedOriginal).toBe(false);
      expect(result.bytes.byteLength).toBeLessThan(source.byteLength);
      expect(result.bytes).not.toEqual(source);
    }
    await verifyPreservedFixture(result.bytes);
  });

  it.each([
    {
      family: 'metadata',
      remove: (document: PDFDocument) =>
        document.context
          .lookup(document.context.trailerInfo.Info, PDFDict)
          .delete(PDFName.of('Author')),
    },
    {
      family: 'XMP metadata',
      remove: (document: PDFDocument) => document.catalog.delete(PDFName.of('Metadata')),
    },
    {
      family: 'form fields',
      remove: (document: PDFDocument) => document.catalog.delete(PDFName.of('AcroForm')),
    },
    {
      family: 'annotations',
      remove: (document: PDFDocument) => document.getPage(0).node.delete(PDFName.of('Annots')),
    },
    {
      family: 'link actions',
      remove: (document: PDFDocument) => {
        const annotations = document.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
        const link = Array.from({ length: annotations.size() }, (_, index) =>
          annotations.lookup(index, PDFDict),
        ).find(
          (annotation) => annotation.lookup(PDFName.of('Subtype'), PDFName).asString() === '/Link',
        );
        if (link === undefined) throw new Error('Missing synthetic link');
        link.delete(PDFName.of('A'));
      },
    },
    {
      family: 'tagging',
      remove: (document: PDFDocument) => document.catalog.delete(PDFName.of('StructTreeRoot')),
    },
    {
      family: 'outlines',
      remove: (document: PDFDocument) => document.catalog.delete(PDFName.of('Outlines')),
    },
    {
      family: 'optional content',
      remove: (document: PDFDocument) => document.catalog.delete(PDFName.of('OCProperties')),
    },
    {
      family: 'output intents',
      remove: (document: PDFDocument) => document.catalog.delete(PDFName.of('OutputIntents')),
    },
  ])('fails closed when $family is missing', async ({ remove }) => {
    const source = await PDFDocument.load(await fixture(), { updateMetadata: false });
    const output = await PDFDocument.load(await fixture(), { updateMetadata: false });
    remove(output);
    expect(() => assertCompressionStructurePreserved(source, output)).toThrow(
      /^UTILITY_PRESERVATION_FAILED$/u,
    );
  });

  it('returns a verified rewritten result through the worker dispatcher', async () => {
    const addListener =
      vi.fn<(type: string, listener: (event: MessageEvent<unknown>) => void) => void>();
    const postMessage = vi.fn<(response: PdfWorkerResponse) => void>();
    vi.stubGlobal('addEventListener', addListener);
    vi.stubGlobal('postMessage', postMessage);
    startPdfWorker();
    const listener = addListener.mock.calls[0]?.[1];
    if (listener === undefined) throw new Error('Missing worker listener');
    const request = {
      bytes: await fixture(),
      id: 'compression-preservation',
      kind: 'compress',
      preset: 'balanced',
    } satisfies PdfWorkerRequest;
    listener(new MessageEvent('message', { data: request }));
    await vi.waitFor(() => expect(postMessage.mock.calls.length).toBe(1));
    const response = postMessage.mock.calls[0]?.[0];
    if (response?.ok !== true || response.payload.kind !== 'compression') {
      throw new Error('Expected a successful compression response');
    }
    expect(response.payload.report.usedOriginal).toBe(false);
    await verifyPreservedFixture(response.payload.bytes);
  });
});
