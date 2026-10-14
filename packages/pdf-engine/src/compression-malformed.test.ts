/// <reference types="node" />
import { readFile } from 'node:fs/promises';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { inspectPdfRevisionStructure } from './incremental-revisions.js';
import { compressPdfLosslessly } from './utilities.js';
import { startPdfWorker } from './worker-runtime.js';
import type { PdfWorkerRequest, PdfWorkerResponse } from './worker.js';

const replaceAscii = (bytes: Uint8Array, pattern: RegExp, replacement: string): Uint8Array => {
  const text = Buffer.from(bytes).toString('latin1');
  const candidate = text.replace(pattern, replacement);
  if (candidate === text || candidate.length !== text.length)
    throw new Error('Synthetic malformed mutation failed.');
  return Buffer.from(candidate, 'latin1');
};

let malformedObject: Uint8Array;
let missingEof: Uint8Array;
let ordinary: Uint8Array;
let trailingWhitespace: Uint8Array;
let wrongStartXref: Uint8Array;

beforeAll(async () => {
  ordinary = await readFile(
    new URL('../../test-corpus/fixtures/smoke-one-page.pdf', import.meta.url),
  );
  const text = Buffer.from(ordinary).toString('latin1');
  const startXref = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(text)?.[1];
  if (startXref === undefined) throw new Error('Missing synthetic startxref.');
  wrongStartXref = replaceAscii(
    ordinary,
    new RegExp(`startxref\\s+${startXref}`, 'u'),
    `startxref\n${'0'.repeat(startXref.length)}`,
  );
  missingEof = replaceAscii(ordinary, /%%EOF/u, '     ');
  malformedObject = replaceAscii(ordinary, /1 0 obj/u, '1 0 obx');
  trailingWhitespace = Buffer.concat([Buffer.from(ordinary), Buffer.from('\n\t \r\n', 'ascii')]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OPT-001 malformed and recoverable input boundary', () => {
  it('accepts one valid terminator with legal trailing whitespace', async () => {
    expect(inspectPdfRevisionStructure(ordinary)).toBe('single');
    expect(inspectPdfRevisionStructure(trailingWhitespace)).toBe('single');
    await expect(compressPdfLosslessly(trailingWhitespace, 'balanced')).resolves.toMatchObject({
      report: { preset: 'balanced' },
    });
  });

  it.each([
    ['wrong startxref', () => wrongStartXref],
    ['missing EOF', () => missingEof],
  ])('blocks %s before parser invocation', async (_label, bytes) => {
    const candidate = bytes();
    const snapshot = new Uint8Array(candidate);
    const load = vi.spyOn(PDFDocument, 'load');
    expect(inspectPdfRevisionStructure(candidate)).toBe('malformed');
    await expect(
      compressPdfLosslessly(candidate, 'balanced').then(() => undefined),
    ).rejects.toThrow(/^UTILITY_PDF_MALFORMED$/u);
    expect(load).not.toHaveBeenCalled();
    expect(Buffer.from(candidate).equals(Buffer.from(snapshot))).toBe(true);
  });

  it('maps parser rejection to one content-free failure code', async () => {
    expect(inspectPdfRevisionStructure(malformedObject)).toBe('single');
    const load = vi.spyOn(PDFDocument, 'load');
    const save = vi.spyOn(PDFDocument.prototype, 'save');
    await expect(
      compressPdfLosslessly(malformedObject, 'balanced').then(() => undefined),
    ).rejects.toThrow(/^UTILITY_PDF_MALFORMED$/u);
    expect(load).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('returns only the safe code through the worker dispatcher', async () => {
    const addListener =
      vi.fn<(type: string, listener: (event: MessageEvent<unknown>) => void) => void>();
    const postMessage = vi.fn<(response: PdfWorkerResponse) => void>();
    vi.stubGlobal('addEventListener', addListener);
    vi.stubGlobal('postMessage', postMessage);
    startPdfWorker();
    const listener = addListener.mock.calls[0]?.[1];
    if (listener === undefined) throw new Error('Missing worker listener');
    const request = {
      bytes: malformedObject,
      id: 'malformed-compression',
      kind: 'compress',
      preset: 'balanced',
    } satisfies PdfWorkerRequest;
    listener(new MessageEvent('message', { data: request }));
    await vi.waitFor(() => expect(postMessage.mock.calls.length).toBe(1));
    expect(postMessage.mock.calls[0]).toEqual([
      { id: request.id, message: 'UTILITY_PDF_MALFORMED', ok: false },
    ]);
  });
});
