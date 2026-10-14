/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPdfPermissionOptions,
  isPermissionPassword,
  permissionFlags,
  setPdfPermissions,
  type PdfPermissionOptions,
} from './permissions.js';
import { parsePdfWorkerRequest, type PdfWorkerResponse } from './worker.js';
import { startPdfWorker } from './worker-runtime.js';
import { protectPdf, unlockPdf } from './utilities.js';

const fixture = (name = 'smoke-one-page.pdf') =>
  readFile(new URL(`../../test-corpus/fixtures/${name}`, import.meta.url));
const owner = 'synthetic-owner-password';
const open = 'synthetic-open-password';
const restricted: PdfPermissionOptions = {
  printing: 'none',
  copying: false,
  modifying: false,
  annotating: false,
  fillingForms: false,
  documentAssembly: false,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SEC-003 bounded permission engine', () => {
  it('checks exact permission schemas and credential bounds without coercion or normalization', () => {
    expect(isPdfPermissionOptions(restricted)).toBe(true);
    const invalid: readonly unknown[] = [
      null,
      [],
      { ...restricted, extra: false },
      { ...restricted, copying: 'false' },
      { ...restricted, printing: false },
      { ...restricted, printing: 'highResolution' },
      { ...restricted, annotating: true },
      Object.create(restricted),
    ];
    for (const value of invalid) expect(isPdfPermissionOptions(value)).toBe(false);
    for (const value of [
      '',
      'short',
      'a'.repeat(128),
      'é'.repeat(12),
      'x'.repeat(12) + '\n',
      'x'.repeat(12) + '\u0000',
    ])
      expect(isPermissionPassword(value)).toBe(false);
    expect(isPermissionPassword('')).toBe(false);
    expect(isPermissionPassword('', true)).toBe(true);
    expect(isPermissionPassword(' '.repeat(12))).toBe(true); // Literal bounds, not a strength claim.
    expect(isPermissionPassword('x'.repeat(127))).toBe(true);
  });

  it('reopens both password roles, rejects wrong credentials, and verifies every allowed bit', async () => {
    const source = await fixture();
    const before = Uint8Array.from(source);
    const variants: PdfPermissionOptions[] = [
      restricted,
      { ...restricted, printing: 'low' },
      { ...restricted, printing: 'high' },
      ...(['copying', 'modifying', 'fillingForms', 'documentAssembly'] as const).map((key) => ({
        ...restricted,
        [key]: true,
      })),
      { ...restricted, annotating: true, fillingForms: true },
      {
        printing: 'high',
        copying: true,
        modifying: true,
        annotating: true,
        fillingForms: true,
        documentAssembly: true,
      },
    ];
    for (const options of variants) {
      const bytes = await setPdfPermissions(source, options, owner, open, true);
      for (const password of [owner, open]) {
        const document = await PDFDocument.load(bytes, { password, updateMetadata: false });
        const inspection = await PDFDocument.load(bytes, {
          ignoreEncryption: true,
          updateMetadata: false,
        });
        const encryption = inspection.context.lookup(
          inspection.context.trailerInfo.Encrypt,
          PDFDict,
        );
        expect(encryption.lookup(PDFName.of('P'), PDFNumber).asNumber()).toBe(
          permissionFlags(options),
        );
        expect(document.getPageCount()).toBe(1);
      }
      await expect(
        PDFDocument.load(bytes, { password: 'synthetic-wrong-password' }),
      ).rejects.toThrow();
      await expect(PDFDocument.load(bytes)).rejects.toThrow();
      expect(bytes).not.toEqual(source);
    }
    expect(Uint8Array.from(source)).toEqual(before);
  }, 30000);

  it('supports an explicitly empty open password and retained structures, but not source mutation', async () => {
    for (const name of ['multipage-three.pdf', 'acroform-text-field.pdf']) {
      const source = await fixture(name);
      const sourceDocument = await PDFDocument.load(source, { updateMetadata: false });
      const sourcePageCount = sourceDocument.getPageCount();
      const options = { ...restricted };
      const work = setPdfPermissions(source, options, owner, '', true);
      source.fill(0);
      options.copying = true;
      const outputBytes = await work;
      const output = await PDFDocument.load(outputBytes, { password: '', updateMetadata: false });
      expect(output.getPageCount()).toBe(sourcePageCount);
      const inspection = await PDFDocument.load(outputBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      const encryption = inspection.context.lookup(inspection.context.trailerInfo.Encrypt, PDFDict);
      expect(encryption.lookup(PDFName.of('P'), PDFNumber).asNumber()).toBe(-3392);
    }
  });

  it('fails authorization and unsafe credentials before loading or saving', async () => {
    const source = await fixture();
    const load = vi.spyOn(PDFDocument, 'load');
    await expect(setPdfPermissions(source, restricted, owner, open, false)).rejects.toThrow(
      /^UTILITY_AUTHORIZATION_REQUIRED$/u,
    );
    await expect(setPdfPermissions(source, restricted, owner, owner, true)).rejects.toThrow(
      /^UTILITY_PERMISSIONS_PASSWORD_INVALID$/u,
    );
    await expect(setPdfPermissions(source, restricted, '', open, true)).rejects.toThrow(
      /^UTILITY_PERMISSIONS_PASSWORD_INVALID$/u,
    );
    expect(load).not.toHaveBeenCalled();
  });

  it('SEC-001 shares safe encryption and refuses unsupported strings/password characters', async () => {
    const source = await fixture();
    const bytes = await protectPdf(source, open);
    const output = await PDFDocument.load(bytes, { password: open, updateMetadata: false });
    const original = await PDFDocument.load(source, { updateMetadata: false });
    expect(
      output.context
        .lookup(original.context.trailerInfo.Info, PDFDict)
        .lookup(PDFName.of('Title'), PDFHexString)
        .decodeText(),
    ).toBe(original.getTitle());
    await expect(protectPdf(await fixture('compression-preservation.pdf'), open)).rejects.toThrow(
      /^UTILITY_PERMISSIONS_STRING_LAYOUT_BLOCKED$/u,
    );
    await expect(protectPdf(source, 'é'.repeat(12))).rejects.toThrow(
      /^UTILITY_PASSWORD_CHARACTERS_UNSUPPORTED$/u,
    );
  });

  it('SEC-002 preserves the metadata trailer and complete objects through authorized removal', async () => {
    for (const name of ['smoke-one-page.pdf', 'multipage-three.pdf', 'acroform-text-field.pdf']) {
      const source = await fixture(name);
      const encrypted = await setPdfPermissions(source, restricted, owner, open, true);
      const before = Uint8Array.from(encrypted);
      const pending = unlockPdf(encrypted, open, true);
      encrypted.fill(0); // Must not mutate the captured source graph.
      const plain = await PDFDocument.load(await pending, { updateMetadata: false });
      const original = await PDFDocument.load(source, { updateMetadata: false });
      expect(plain.isEncrypted).toBe(false);
      expect(plain.getTitle()).toBe(original.getTitle());
      expect(plain.getPageCount()).toBe(original.getPageCount());
      await expect(unlockPdf(before, open, false)).rejects.toThrow(
        /^UTILITY_AUTHORIZATION_REQUIRED$/u,
      );
      await expect(unlockPdf(before, 'synthetic-wrong-password', true)).rejects.toThrow(
        /^UTILITY_PASSWORD_INCORRECT$/u,
      );
    }
  });

  it('blocks risky, encrypted, damaged and excessive inputs before serialization', async () => {
    const synthetic = async (configure: (document: PDFDocument) => void) => {
      const document = await PDFDocument.create({ updateMetadata: false });
      document.addPage();
      configure(document);
      return document.save({ updateFieldAppearances: false, useObjectStreams: false });
    };
    const cases = [
      { bytes: await fixture('embedded-javascript.pdf'), code: 'ACTIVE_CONTENT_BLOCKED' },
      { bytes: await fixture('file-attachment.pdf'), code: 'ATTACHMENTS_BLOCKED' },
      {
        bytes: await fixture('compression-incremental.pdf'),
        code: 'INCREMENTAL_REVISIONS_BLOCKED',
      },
      {
        bytes: await fixture('compression-preservation.pdf'),
        code: 'PERMISSIONS_STRING_LAYOUT_BLOCKED',
      },
      {
        bytes: await synthetic((doc) =>
          doc.getPage(0).node.set(PDFName.of('LastModified'), PDFString.of('D:20260930000000Z')),
        ),
        code: 'PERMISSIONS_STRING_LAYOUT_BLOCKED',
      },
      {
        bytes: await synthetic((doc) =>
          doc.catalog.set(PDFName.of('Extensions'), doc.context.obj({})),
        ),
        code: 'PERMISSIONS_EXTENSIONS_BLOCKED',
      },
      {
        bytes: await synthetic((doc) =>
          doc.catalog.set(
            PDFName.of('AcroForm'),
            doc.context.obj({ Fields: [], XFA: PDFString.of('synthetic') }),
          ),
        ),
        code: 'XFA_BLOCKED',
      },
      {
        bytes: await synthetic((doc) =>
          doc.catalog.set(
            PDFName.of('AcroForm'),
            doc.context.obj({
              Fields: [
                doc.context.register(
                  doc.context.obj({ FT: PDFName.of('Sig'), T: PDFString.of('synthetic') }),
                ),
              ],
            }),
          ),
        ),
        code: 'SIGNATURES_BLOCKED',
      },
      {
        bytes: await synthetic((doc) => {
          for (let index = 1; index < 501; index += 1) doc.addPage();
        }),
        code: 'PERMISSIONS_PAGE_LIMIT',
      },
      {
        bytes: new TextEncoder().encode('%PDF-1.7\nsynthetic-private-parser-marker'),
        code: 'PDF_MALFORMED',
      },
    ];
    const encrypted = await setPdfPermissions(await fixture(), restricted, owner, open, true);
    cases.push({ bytes: encrypted, code: 'PASSWORD_REQUIRED' });
    const save = vi.spyOn(PDFDocument.prototype, 'save');
    for (const entry of cases)
      await expect(setPdfPermissions(entry.bytes, restricted, owner, open, true)).rejects.toThrow(
        new RegExp(`^UTILITY_${entry.code}$`, 'u'),
      );
    expect(save).not.toHaveBeenCalled();
  });

  it('SEC-001/002 reject orphaned signatures, active content, XFA and attachments before saving', async () => {
    const inputs: { bytes: Uint8Array; code: string }[] = [
      { bytes: await fixture('embedded-javascript.pdf'), code: 'ACTIVE_CONTENT_BLOCKED' },
      { bytes: await fixture('file-attachment.pdf'), code: 'ATTACHMENTS_BLOCKED' },
      { bytes: await fixture('signature-orphan-widget.pdf'), code: 'SIGNATURES_BLOCKED' },
    ];
    for (const code of ['SIGNATURES_BLOCKED', 'XFA_BLOCKED']) {
      const document = await PDFDocument.create({ updateMetadata: false });
      document.addPage();
      if (code === 'SIGNATURES_BLOCKED')
        document.context.register(
          document.context.obj({ Type: PDFName.of('Sig'), ByteRange: [0, 1, 2, 3] }),
        );
      else
        document.catalog.set(
          PDFName.of('AcroForm'),
          document.context.obj({ Fields: [], XFA: PDFString.of('synthetic') }),
        );
      inputs.push({ bytes: await document.save({ updateFieldAppearances: false }), code });
    }
    const encrypted: Uint8Array[] = [];
    for (const { bytes } of inputs) {
      // Deliberately bypass product preflight to construct only synthetic unsafe encrypted inputs.
      const document = await PDFDocument.load(bytes, { preserveXFA: true, updateMetadata: false });
      document.encrypt({ algorithm: 'AES-256', ownerPassword: owner, userPassword: open });
      encrypted.push(
        await document.save({ useObjectStreams: true, updateFieldAppearances: false }),
      );
    }
    const save = vi.spyOn(PDFDocument.prototype, 'save');
    for (const [index, { bytes, code }] of inputs.entries()) {
      await expect(protectPdf(bytes, open)).rejects.toThrow(new RegExp(`^UTILITY_${code}$`, 'u'));
      const encryptedInput = encrypted[index];
      if (encryptedInput === undefined) throw new Error('missing synthetic case');
      await expect(unlockPdf(encryptedInput, open, true)).rejects.toThrow(
        new RegExp(`^UTILITY_${code}$`, 'u'),
      );
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('SEC-002 refuses an unrelated saved candidate and malformed source without leaking diagnostics', async () => {
    const encrypted = await protectPdf(await fixture(), open);
    vi.spyOn(PDFDocument.prototype, 'save').mockResolvedValueOnce(
      await fixture('multipage-three.pdf'),
    );
    await expect(unlockPdf(encrypted, open, true)).rejects.toThrow(
      /^UTILITY_DECRYPT_VERIFICATION_FAILED$/u,
    );
    await expect(
      unlockPdf(new TextEncoder().encode('%PDF-1.7\nsynthetic-private-parser-marker'), open, true),
    ).rejects.toThrow(/^UTILITY_PDF_MALFORMED$/u);
  });

  it('refuses a corrupted/unrelated candidate instead of returning it', async () => {
    const wrong = await PDFDocument.create({ updateMetadata: false });
    wrong.addPage([100, 100]);
    const bytes = await wrong.save();
    vi.spyOn(PDFDocument.prototype, 'save').mockResolvedValueOnce(bytes);
    await expect(setPdfPermissions(await fixture(), restricted, owner, open, true)).rejects.toThrow(
      /^UTILITY_PERMISSIONS_VERIFICATION_FAILED$/u,
    );
  });

  it('refuses PDF/A encryption and allows exactly 500 blank pages without weakening flags', async () => {
    const archivalMarker = await PDFDocument.create({ updateMetadata: false });
    archivalMarker.addPage();
    // A synthetic XMP claim tests refusal; it is not an archival-certification fixture.
    const packet =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>';
    archivalMarker.catalog.set(
      PDFName.of('Metadata'),
      archivalMarker.context.register(
        archivalMarker.context.flateStream(packet, {
          Type: PDFName.of('Metadata'),
          Subtype: PDFName.of('XML'),
        }),
      ),
    );
    const source = await archivalMarker.save();
    await expect(setPdfPermissions(source, restricted, owner, open, true)).rejects.toThrow(
      /^UTILITY_PERMISSIONS_VERIFICATION_FAILED$/u,
    );
    const maximum = await PDFDocument.create({ updateMetadata: false });
    for (let index = 0; index < 500; index += 1) maximum.addPage();
    const bytes = await setPdfPermissions(await maximum.save(), restricted, owner, open, true);
    expect((await PDFDocument.load(bytes, { password: open })).getPageCount()).toBe(500);
  }, 30000);

  it('validates exact worker requests and emits only sanitized failure codes', async () => {
    const request = {
      id: 'permission-test',
      kind: 'permissions',
      bytes: await fixture(),
      options: restricted,
      ownerPassword: owner,
      openPassword: open,
      authorized: false,
    };
    expect(parsePdfWorkerRequest(request)).toMatchObject({ kind: 'permissions' });
    for (const invalid of [
      { ...request, extra: true },
      { ...request, authorized: 'true' },
      Object.create(request),
      { ...request, ownerPassword: open },
    ])
      expect(() => parsePdfWorkerRequest(invalid)).toThrow('request is invalid');
    const listener =
      vi.fn<(type: string, callback: (event: MessageEvent<unknown>) => void) => void>();
    const post = vi.fn<(response: PdfWorkerResponse) => void>();
    vi.stubGlobal('addEventListener', listener);
    vi.stubGlobal('postMessage', post);
    startPdfWorker();
    listener.mock.calls[0]?.[1](new MessageEvent('message', { data: request }));
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toEqual([
      { id: request.id, ok: false, message: 'UTILITY_AUTHORIZATION_REQUIRED' },
    ]);
    expect(JSON.stringify(post.mock.calls)).not.toContain(owner);
    expect(JSON.stringify(post.mock.calls)).not.toContain(open);
  });
});
