/// <reference types="node" />
import { readFile } from 'node:fs/promises';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasIncrementalPdfRevisions } from './incremental-revisions.js';
import { compressPdfLosslessly, compressionPresets } from './utilities.js';
import { startPdfWorker } from './worker-runtime.js';
import type { PdfWorkerRequest, PdfWorkerResponse } from './worker.js';

const fixture = (filename: string) =>
  readFile(new URL(`../../test-corpus/fixtures/${filename}`, import.meta.url));

let incremental: Uint8Array;
let ordinary: Uint8Array;

beforeAll(async () => {
  incremental = await fixture('compression-incremental.pdf');
  ordinary = await fixture('smoke-one-page.pdf');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OPT-001 incremental revision preflight', () => {
  it('recognizes multiple valid revision terminators without flagging one revision', () => {
    expect(hasIncrementalPdfRevisions(ordinary)).toBe(false);
    expect(hasIncrementalPdfRevisions(incremental)).toBe(true);
  });

  it('ignores a second marker whose offset does not point to a cross-reference section', () => {
    const marker = new TextEncoder().encode('\nstartxref\n0\n%%EOF\n');
    const candidate = new Uint8Array(ordinary.byteLength + marker.byteLength);
    candidate.set(ordinary);
    candidate.set(marker, ordinary.byteLength);
    expect(hasIncrementalPdfRevisions(candidate)).toBe(false);
  });

  it.each(compressionPresets)(
    'blocks %s before parser or serializer invocation',
    async (preset) => {
      const snapshot = new Uint8Array(incremental);
      const load = vi.spyOn(PDFDocument, 'load');
      const save = vi.spyOn(PDFDocument.prototype, 'save');
      await expect(
        compressPdfLosslessly(incremental, preset).then(() => undefined),
      ).rejects.toThrow(/^UTILITY_INCREMENTAL_REVISIONS_BLOCKED$/u);
      expect(load).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(incremental.every((byte, index) => byte === snapshot[index])).toBe(true);
    },
  );

  it('returns only the content-free code through the worker dispatcher', async () => {
    const addListener =
      vi.fn<(type: string, listener: (event: MessageEvent<unknown>) => void) => void>();
    const postMessage = vi.fn<(response: PdfWorkerResponse) => void>();
    vi.stubGlobal('addEventListener', addListener);
    vi.stubGlobal('postMessage', postMessage);
    startPdfWorker();
    const listener = addListener.mock.calls[0]?.[1];
    if (listener === undefined) throw new Error('Missing worker listener');
    const request = {
      bytes: incremental,
      id: 'incremental-revision',
      kind: 'compress',
      preset: 'balanced',
    } satisfies PdfWorkerRequest;
    listener(new MessageEvent('message', { data: request }));
    await vi.waitFor(() => expect(postMessage.mock.calls.length).toBe(1));
    expect(postMessage.mock.calls[0]).toEqual([
      { id: request.id, message: 'UTILITY_INCREMENTAL_REVISIONS_BLOCKED', ok: false },
    ]);
  });
});
