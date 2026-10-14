/// <reference types="node" />
// Node fixture access is test-only; the browser build excludes this module.
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDF_OPERATION_REGISTRY } from '@pdfmason/contracts';
import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { compressPdfLosslessly, compressionPresets } from './utilities.js';
import { startPdfWorker } from './worker-runtime.js';
import type { PdfWorkerRequest, PdfWorkerResponse } from './worker.js';

let supported: Uint8Array;
let oversized: Uint8Array;
let underreported: Uint8Array;

beforeAll(async () => {
  // Derive the boundary inputs from the committed synthetic corpus, never user documents.
  const source = await PDFDocument.load(
    await readFile(new URL('../../test-corpus/fixtures/smoke-one-page.pdf', import.meta.url)),
    { updateMetadata: false },
  );
  const document = await PDFDocument.create({ updateMetadata: false });
  for (const page of await document.copyPages(source, Array<number>(500).fill(0)))
    document.addPage(page);
  supported = await document.save();
  const [extra] = await document.copyPages(source, [0]);
  if (extra === undefined) throw new Error('Missing synthetic page');
  document.addPage(extra);
  oversized = await document.save();
  document.catalog.Pages().set(PDFName.of('Count'), PDFNumber.of(1));
  underreported = await document.save();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OPT-001 compression page boundary', () => {
  it('keeps the engine limit aligned with the versioned operation contract', () => {
    expect(LOCAL_PDF_LIMITS.maximumPages).toBe(500);
    expect(PDF_OPERATION_REGISTRY['optimize.compress']).toMatchObject({
      featureIds: ['OPT-001', 'SEC-006', 'SEC-007'],
      input: { maximumPages: LOCAL_PDF_LIMITS.maximumPages },
      version: '1.0.5',
    });
  });

  it.each(compressionPresets)(
    'accepts exactly 500 pages for %s without source mutation',
    async (preset) => {
      const snapshot = supported.slice();
      const result = await compressPdfLosslessly(supported, preset);
      expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(500);
      expect(result.bytes.byteLength).toBeLessThanOrEqual(supported.byteLength);
      expect(result.report.preset).toBe(preset);
      expect(result.bytes).not.toBe(supported);
      expect(supported.every((byte, index) => byte === snapshot[index])).toBe(true);
    },
  );

  it.each(compressionPresets)(
    'rejects 501 pages before saving or returning a fallback for %s',
    async (preset) => {
      const snapshot = oversized.slice();
      const save = vi.spyOn(PDFDocument.prototype, 'save');
      // Strip success data so a failing negative assertion cannot print document bytes.
      await expect(compressPdfLosslessly(oversized, preset).then(() => undefined)).rejects.toThrow(
        /^UTILITY_PDF_PAGE_LIMIT$/u,
      );
      expect(save.mock.calls.length).toBe(0);
      expect(oversized.every((byte, index) => byte === snapshot[index])).toBe(true);
    },
  );

  it('counts actual page leaves rather than trusting a smaller catalog Count', async () => {
    const parsed = await PDFDocument.load(underreported, { updateMetadata: false });
    expect(parsed.catalog.Pages().lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(1);
    expect(parsed.getPageCount()).toBe(501);
    await expect(
      compressPdfLosslessly(underreported, 'balanced').then(() => undefined),
    ).rejects.toThrow(/^UTILITY_PDF_PAGE_LIMIT$/u);
  });

  it.each(compressionPresets)(
    'returns only a safe failure through the real worker dispatcher for %s',
    async (preset) => {
      const addListener =
        vi.fn<(type: string, listener: (event: MessageEvent<unknown>) => void) => void>();
      const postMessage = vi.fn<(response: PdfWorkerResponse) => void>();
      vi.stubGlobal('addEventListener', addListener);
      vi.stubGlobal('postMessage', postMessage);
      startPdfWorker();
      const listener = addListener.mock.calls[0]?.[1];
      if (listener === undefined) throw new Error('Missing worker listener');
      const request = {
        id: 'compression-limit',
        kind: 'compress',
        bytes: oversized,
        preset,
      } satisfies PdfWorkerRequest;
      listener(new MessageEvent('message', { data: request }));
      await vi.waitFor(() => expect(postMessage.mock.calls.length).toBe(1));
      // Check the discriminant first so unexpected PDF success data is never printed.
      expect(postMessage.mock.calls[0]?.[0].ok).toBe(false);
      expect(postMessage.mock.calls[0]).toEqual([
        {
          id: request.id,
          ok: false,
          message: 'UTILITY_PDF_PAGE_LIMIT',
        },
      ]);
    },
  );
});
