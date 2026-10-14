/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compressPdfLosslessly, compressionPresets } from './utilities.js';
import { startPdfWorker } from './worker-runtime.js';
import type { PdfWorkerRequest, PdfWorkerResponse } from './worker.js';

const fixture = (filename: string) =>
  readFile(new URL(`../../test-corpus/fixtures/${filename}`, import.meta.url));

const syntheticRisk = async (kind: 'SIGNATURES' | 'XFA'): Promise<Uint8Array> => {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([612, 792]);
  const fields = [];
  if (kind === 'SIGNATURES') {
    const field = document.context.obj({
      FT: PDFName.of('Sig'),
      T: PDFString.of('synthetic.signature'),
    });
    fields.push(document.context.register(field));
  }
  const form = document.context.obj({
    Fields: fields,
    ...(kind === 'XFA' ? { XFA: PDFString.of('synthetic-xfa-placeholder') } : {}),
  });
  document.catalog.set(PDFName.of('AcroForm'), document.context.register(form));
  return document.save({ addDefaultPage: false, updateFieldAppearances: false });
};

let cases: readonly { readonly bytes: Uint8Array; readonly code: string; readonly label: string }[];

beforeAll(async () => {
  cases = [
    {
      bytes: await fixture('embedded-javascript.pdf'),
      code: 'UTILITY_ACTIVE_CONTENT_BLOCKED',
      label: 'active content',
    },
    {
      bytes: await fixture('file-attachment.pdf'),
      code: 'UTILITY_ATTACHMENTS_BLOCKED',
      label: 'attachments',
    },
    {
      bytes: await syntheticRisk('SIGNATURES'),
      code: 'UTILITY_SIGNATURES_BLOCKED',
      label: 'digital-signature structure',
    },
    { bytes: await syntheticRisk('XFA'), code: 'UTILITY_XFA_BLOCKED', label: 'XFA' },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OPT-001 / SEC-006 / SEC-007 compression preflight', () => {
  it.each(compressionPresets)(
    'rejects every risky family before serialization for %s',
    async (preset) => {
      for (const entry of cases) {
        const snapshot = new Uint8Array(entry.bytes);
        const save = vi.spyOn(PDFDocument.prototype, 'save');
        await expect(
          compressPdfLosslessly(entry.bytes, preset).then(() => undefined),
        ).rejects.toThrow(new RegExp(`^${entry.code}$`, 'u'));
        expect(save.mock.calls.length, entry.label).toBe(0);
        expect(
          entry.bytes.every((byte, index) => byte === snapshot[index]),
          entry.label,
        ).toBe(true);
        save.mockRestore();
      }
    },
  );

  it('keeps ordinary AcroForms supported and preserved', async () => {
    const bytes = await fixture('acroform-text-field.pdf');
    const snapshot = new Uint8Array(bytes);
    const result = await compressPdfLosslessly(bytes, 'balanced');
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(
      output
        .getForm()
        .getFields()
        .map((field) => field.getName())
        .sort(),
    ).toEqual(['synthetic.approved', 'synthetic.choice', 'synthetic.name', 'synthetic.province']);
    expect(bytes.every((byte, index) => byte === snapshot[index])).toBe(true);
  });

  it('returns only content-free risk codes through the worker dispatcher', async () => {
    for (const entry of cases) {
      const addListener =
        vi.fn<(type: string, listener: (event: MessageEvent<unknown>) => void) => void>();
      const postMessage = vi.fn<(response: PdfWorkerResponse) => void>();
      vi.stubGlobal('addEventListener', addListener);
      vi.stubGlobal('postMessage', postMessage);
      startPdfWorker();
      const listener = addListener.mock.calls[0]?.[1];
      if (listener === undefined) throw new Error('Missing worker listener');
      const request = {
        bytes: entry.bytes,
        id: `risk-${entry.label}`,
        kind: 'compress',
        preset: 'balanced',
      } satisfies PdfWorkerRequest;
      listener(new MessageEvent('message', { data: request }));
      await vi.waitFor(() => expect(postMessage.mock.calls.length).toBe(1));
      expect(postMessage.mock.calls[0]?.[0].ok).toBe(false);
      expect(postMessage.mock.calls[0]).toEqual([
        { id: request.id, message: entry.code, ok: false },
      ]);
      vi.unstubAllGlobals();
    }
  });
});
