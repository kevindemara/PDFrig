import {
  PDFArray,
  PDFCatalog,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPageLeaf,
  PDFPageTree,
  PDFInvalidObject,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFStream,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { inspectPdfRevisionStructure } from './incremental-revisions.js';
import { findPdfModificationRisk } from './modification-risks.js';

/** SEC-003: reader-enforced requests, never a DRM/confidentiality claim. */
export interface PdfPermissionOptions {
  readonly printing: 'none' | 'low' | 'high';
  readonly copying: boolean;
  readonly modifying: boolean;
  readonly annotating: boolean;
  readonly fillingForms: boolean;
  readonly documentAssembly: boolean;
}
const permissionKeys = [
  'printing',
  'copying',
  'modifying',
  'annotating',
  'fillingForms',
  'documentAssembly',
] as const;
export const isPdfPermissionOptions = (value: unknown): value is PdfPermissionOptions => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === permissionKeys.length &&
    permissionKeys.every((key) => Object.hasOwn(candidate, key)) &&
    (candidate.printing === 'none' ||
      candidate.printing === 'low' ||
      candidate.printing === 'high') &&
    permissionKeys.slice(1).every((key) => typeof candidate[key] === 'boolean') &&
    !(candidate.annotating === true && candidate.fillingForms === false)
  );
};
export const isPermissionPassword = (value: unknown, allowEmpty = false): value is string =>
  typeof value === 'string' &&
  ((allowEmpty && value === '') || /^[\x20-\x7e]{12,127}$/u.test(value));

/** Includes reserved bits and accessibility; independent tests check each bit separately. */
export const permissionFlags = (options: PdfPermissionOptions): number => {
  if (!isPdfPermissionOptions(options)) throw new Error('UTILITY_PERMISSIONS_OPTIONS_INVALID');
  let flags = -3904 | 512;
  if (options.printing !== 'none') flags |= 4;
  if (options.printing === 'high') flags |= 2048;
  if (options.modifying) flags |= 8;
  if (options.copying) flags |= 16;
  if (options.annotating) flags |= 32;
  if (options.fillingForms) flags |= 256;
  if (options.documentAssembly) flags |= 1024;
  return flags;
};

// Compare source objects without logging values. Cipher lengths differ; decrypted
// stream bytes, dictionaries, references and literal string bytes must not differ.
const digestBytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const canonicalObject = async (object: PDFObject, ignoreExtension = false): Promise<unknown> => {
  if (object instanceof PDFString || object instanceof PDFHexString)
    return ['string', object.asBytes().byteLength, await digestBytes(object.asBytes())];
  if (object instanceof PDFRawStream)
    return [
      'stream',
      await canonicalDictionary(object.dict, ['Length']),
      object.getContents().byteLength,
      await digestBytes(object.getContents()),
    ];
  if (object instanceof PDFDict)
    return canonicalDictionary(object, ignoreExtension ? ['Extensions'] : []);
  if (object instanceof PDFArray)
    return Promise.all(object.asArray().map((entry) => canonicalObject(entry)));
  return object.toString();
};
const canonicalDictionary = async (
  dictionary: PDFDict,
  omitted: readonly string[],
): Promise<unknown> =>
  Promise.all(
    dictionary
      .entries()
      .filter(([key]) => !omitted.includes(key.decodeText()))
      .sort(([left], [right]) => left.asString().localeCompare(right.asString()))
      .map(async ([key, value]) => [key.asString(), await canonicalObject(value)]),
  );

const hasDirectStrings = (object: PDFObject): boolean => {
  if (object instanceof PDFString || object instanceof PDFHexString) return true;
  if (object instanceof PDFStream) return hasDirectStrings(object.dict);
  if (object instanceof PDFDict)
    return object.entries().some(([, value]) => hasDirectStrings(value));
  if (object instanceof PDFArray) return object.asArray().some(hasDirectStrings);
  return false;
};

/** Include orphaned/indirect signature structures, not only normalized form fields. */
export const hasPdfSecuritySignatureStructure = (document: PDFDocument): boolean => {
  const containsSignature = (object: PDFObject): boolean => {
    if (object instanceof PDFStream) return containsSignature(object.dict);
    if (object instanceof PDFArray) return object.asArray().some(containsSignature);
    if (!(object instanceof PDFDict)) return false;
    return (
      object.get(PDFName.of('FT'))?.toString() === '/Sig' ||
      object.get(PDFName.of('Type'))?.toString() === '/Sig' ||
      object.has(PDFName.of('ByteRange')) ||
      object.entries().some(([, value]) => containsSignature(value))
    );
  };
  return (
    document.catalog.has(PDFName.of('Perms')) ||
    document.context.enumerateIndirectObjects().some(([, object]) => containsSignature(object))
  );
};

// Locked writer encrypts streams, not standalone strings. Object streams protect
// ordinary dictionaries, but catalog/page/generation>0/stream dictionaries remain
// uncompressed. Reject direct strings there instead of leaking or corrupting them.
export const assertSupportedEncryptionStringLayout = (document: PDFDocument): void => {
  for (const [reference, object] of document.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFRawStream &&
      ['/XRef', '/ObjStm'].includes(
        object.dict.lookupMaybe(PDFName.of('Type'), PDFName)?.asString() ?? '',
      )
    )
      continue;
    if (object instanceof PDFInvalidObject) throw new Error('invalid object');
    if (
      (object instanceof PDFStream ||
        object instanceof PDFCatalog ||
        object instanceof PDFPageTree ||
        object instanceof PDFPageLeaf ||
        reference.generationNumber !== 0) &&
      hasDirectStrings(object)
    )
      throw new Error('string layout');
  }
};

/** Internal SEC-001/002/003 fidelity snapshot; never a report or log payload. */
export const capturePdfSecurityPreservation = async (
  document: PDFDocument,
  allowCryptoExtension = false,
) => ({
  allowCryptoExtension,
  root: document.context.trailerInfo.Root?.toString(),
  info: document.context.trailerInfo.Info?.toString(),
  objects: await Promise.all(
    document.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          !(
            object instanceof PDFRawStream &&
            ['/XRef', '/ObjStm'].includes(
              object.dict.lookupMaybe(PDFName.of('Type'), PDFName)?.asString() ?? '',
            )
          ),
      )
      .map(
        async ([reference, object]) =>
          [
            reference,
            JSON.stringify(
              await canonicalObject(object, allowCryptoExtension && object === document.catalog),
            ),
          ] as const,
      ),
  ),
});
export const assertPdfSecurityPreserved = async (
  snapshot: Awaited<ReturnType<typeof capturePdfSecurityPreservation>>,
  document: PDFDocument,
  trailerDocument = document,
): Promise<void> => {
  if (
    trailerDocument.context.trailerInfo.Root?.toString() !== snapshot.root ||
    trailerDocument.context.trailerInfo.Info?.toString() !== snapshot.info ||
    !(document.context.trailerInfo.Root instanceof PDFRef)
  )
    throw new Error('trailer');
  for (const [reference, expected] of snapshot.objects) {
    const object = document.context.lookup(reference);
    if (
      object === undefined ||
      JSON.stringify(
        await canonicalObject(object, snapshot.allowCryptoExtension && object === document.catalog),
      ) !== expected
    )
      throw new Error('preservation');
  }
};

const assertEncryption = (document: PDFDocument, expectedFlags: number): void => {
  const encryption = document.context.lookup(document.context.trailerInfo.Encrypt, PDFDict);
  const numbers = { V: 5, R: 6, Length: 256, P: expectedFlags };
  if (
    !document.isEncrypted ||
    Object.entries(numbers).some(
      ([key, expected]) => encryption.lookup(PDFName.of(key), PDFNumber).asNumber() !== expected,
    )
  )
    throw new Error('encryption');
  if (encryption.lookup(PDFName.of('Filter'), PDFName).asString() !== '/Standard')
    throw new Error('handler');
  const filters = encryption.lookup(PDFName.of('CF'), PDFDict);
  for (const key of ['StmF', 'StrF']) {
    const filterName = encryption.lookup(PDFName.of(key), PDFName);
    const filter = filters.lookup(filterName, PDFDict);
    if (filter.lookup(PDFName.of('CFM'), PDFName).asString() !== '/AESV3')
      throw new Error('cipher');
  }
};

/** Engine-only until the shared review/credential-lifecycle UI is verified. */
export const setPdfPermissions = async (
  bytes: Uint8Array,
  options: PdfPermissionOptions,
  ownerPassword: string,
  openPassword: string,
  authorized: boolean,
): Promise<Uint8Array> => {
  // Direct callers, as well as parsed worker requests, must supply literal true.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  if (authorized !== true) throw new Error('UTILITY_AUTHORIZATION_REQUIRED');
  if (!isPdfPermissionOptions(options)) throw new Error('UTILITY_PERMISSIONS_OPTIONS_INVALID');
  if (
    !isPermissionPassword(ownerPassword) ||
    !isPermissionPassword(openPassword, true) ||
    ownerPassword === openPassword
  )
    throw new Error('UTILITY_PERMISSIONS_PASSWORD_INVALID');
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 5 ||
    bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes
  )
    throw new Error('UTILITY_PDF_SIZE_LIMIT');
  const capturedBytes = Uint8Array.from(bytes);
  const capturedOptions = { ...options };
  if (new TextDecoder('ascii').decode(capturedBytes.subarray(0, 5)) !== '%PDF-')
    throw new Error('UTILITY_NOT_PDF');
  const revision = inspectPdfRevisionStructure(capturedBytes);
  if (revision === 'malformed') throw new Error('UTILITY_PDF_MALFORMED');
  if (revision === 'incremental') throw new Error('UTILITY_INCREMENTAL_REVISIONS_BLOCKED');
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(capturedBytes, {
      ignoreEncryption: true,
      preserveXFA: true,
      updateMetadata: false,
    });
  } catch {
    throw new Error('UTILITY_PDF_MALFORMED');
  }
  if (document.isEncrypted) throw new Error('UTILITY_PASSWORD_REQUIRED');
  let count: number;
  let risk: ReturnType<typeof findPdfModificationRisk>;
  try {
    count = document.getPageCount();
    risk = hasPdfSecuritySignatureStructure(document)
      ? 'SIGNATURES'
      : findPdfModificationRisk(document);
  } catch {
    throw new Error('UTILITY_PDF_MALFORMED');
  }
  if (count < 1 || count > LOCAL_PDF_LIMITS.maximumPages)
    throw new Error('UTILITY_PERMISSIONS_PAGE_LIMIT');
  if (risk !== null) throw new Error(`UTILITY_${risk}_BLOCKED`);
  // Existing extension claims need separate compatibility evidence before rewrite.
  if (document.catalog.has(PDFName.of('Extensions')))
    throw new Error('UTILITY_PERMISSIONS_EXTENSIONS_BLOCKED');
  try {
    assertSupportedEncryptionStringLayout(document);
  } catch {
    throw new Error('UTILITY_PERMISSIONS_STRING_LAYOUT_BLOCKED');
  }
  try {
    const sourceSnapshot = await capturePdfSecurityPreservation(document, true);
    document.encrypt({
      algorithm: 'AES-256',
      ownerPassword,
      userPassword: openPassword,
      permissions: {
        ...capturedOptions,
        printing:
          capturedOptions.printing === 'none'
            ? false
            : capturedOptions.printing === 'low'
              ? 'lowResolution'
              : 'highResolution',
        contentAccessibility: true,
      },
    });
    const output = await document.save({
      addDefaultPage: false,
      useObjectStreams: true,
      updateFieldAppearances: false,
    });
    if (output.byteLength > LOCAL_PDF_LIMITS.maximumBytes) throw new Error('output limit');
    const encryptedInspection = await PDFDocument.load(output, {
      ignoreEncryption: true,
      preserveXFA: true,
      updateMetadata: false,
    });
    assertEncryption(encryptedInspection, permissionFlags(capturedOptions));
    for (const password of [ownerPassword, openPassword]) {
      const reopened = await PDFDocument.load(output, {
        password,
        preserveXFA: true,
        updateMetadata: false,
      });
      if (reopened.getPageCount() !== count) throw new Error('page count');
      // Check raw trailer pointers separately: the decrypting parser drops Info.
      await assertPdfSecurityPreserved(sourceSnapshot, reopened, encryptedInspection);
    }
    return output;
  } catch {
    throw new Error('UTILITY_PERMISSIONS_VERIFICATION_FAILED');
  }
};
