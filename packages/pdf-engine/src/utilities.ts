import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';

import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { assertCompressionStructurePreserved } from './compression-preservation.js';
import { inspectPdfRevisionStructure } from './incremental-revisions.js';
import { normalizeImageForPdf, type SupportedImageMimeType } from './image-normalization.js';
import { findPdfModificationRisk } from './modification-risks.js';
import {
  assertPdfSecurityPreserved,
  assertSupportedEncryptionStringLayout,
  capturePdfSecurityPreservation,
  hasPdfSecuritySignatureStructure,
  isPermissionPassword,
  setPdfPermissions,
} from './permissions.js';

export const compressionPresets = ['highest-quality', 'balanced', 'smaller'] as const;
export type CompressionPreset = (typeof compressionPresets)[number];

export interface CompressionReport {
  readonly method: 'lossless-structural';
  readonly originalBytes: number;
  readonly outputBytes: number;
  readonly preset: CompressionPreset;
  readonly reductionPercent: number;
  readonly usedOriginal: boolean;
  readonly warningCodes: readonly ('ALREADY_OPTIMIZED' | 'LOSSLESS_ONLY')[];
}

export interface CompressionResult {
  readonly bytes: Uint8Array;
  readonly report: CompressionReport;
}

export interface PdfMetadata {
  readonly author: string;
  readonly creationDate: string | null;
  readonly creator: string;
  readonly hasXmpPacket: boolean;
  readonly keywords: string;
  readonly modificationDate: string | null;
  readonly producer: string;
  readonly subject: string;
  readonly title: string;
}

export interface PdfMetadataPatch {
  readonly author?: string;
  readonly creator?: string;
  readonly keywords?: string;
  readonly producer?: string;
  readonly subject?: string;
  readonly title?: string;
}

export interface ImagePdfSource {
  readonly bytes: Uint8Array;
  readonly mimeType: SupportedImageMimeType;
}

export interface ImagesToPdfOptions {
  readonly fit: 'contain' | 'cover';
  readonly pageSize: 'a4' | 'image' | 'letter';
}

export type BlankPageSize = 'a4' | 'legal' | 'letter';

export interface BlankPdfOptions {
  readonly marginPoints: number;
  readonly orientation: 'landscape' | 'portrait';
  readonly pageSize: BlankPageSize;
  /** CREATE-001: older callers default to one page. */
  readonly pageCount?: number;
}

export const BLANK_PAGE_SIZES = Object.freeze({
  a4: Object.freeze({ height: 841.89, label: 'A4', width: 595.28 }),
  legal: Object.freeze({ height: 1_008, label: 'US Legal', width: 612 }),
  letter: Object.freeze({ height: 792, label: 'US Letter', width: 612 }),
});

export const LOCAL_UTILITY_LIMITS = Object.freeze({
  maximumImageCount: 100,
  maximumImageInputBytes: 100 * 1024 * 1024,
  maximumRenderedDimension: 16_384,
  maximumRenderedPages: 50,
  maximumRenderedPixels: 20_000_000,
});

export const isBlankPdfOptions = (value: unknown): value is BlankPdfOptions => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !['marginPoints', 'orientation', 'pageSize'].every((key) => Object.hasOwn(candidate, key)) ||
    Object.keys(candidate).some(
      (key) => !['marginPoints', 'orientation', 'pageSize', 'pageCount'].includes(key),
    ) ||
    ('pageCount' in candidate && !Object.hasOwn(candidate, 'pageCount')) ||
    (Object.hasOwn(candidate, 'pageCount') &&
      (typeof candidate.pageCount !== 'number' ||
        !Number.isInteger(candidate.pageCount) ||
        candidate.pageCount < 1 ||
        candidate.pageCount > LOCAL_PDF_LIMITS.maximumPages)) ||
    (candidate.pageSize !== 'a4' &&
      candidate.pageSize !== 'legal' &&
      candidate.pageSize !== 'letter') ||
    (candidate.orientation !== 'landscape' && candidate.orientation !== 'portrait') ||
    typeof candidate.marginPoints !== 'number' ||
    !Number.isInteger(candidate.marginPoints) ||
    candidate.marginPoints < 0 ||
    candidate.marginPoints > 144
  )
    return false;
  const base = BLANK_PAGE_SIZES[candidate.pageSize];
  const width = candidate.orientation === 'landscape' ? base.height : base.width;
  const height = candidate.orientation === 'landscape' ? base.width : base.height;
  return width - candidate.marginPoints * 2 >= 36 && height - candidate.marginPoints * 2 >= 36;
};

export const createBlankPdf = async (options: BlankPdfOptions): Promise<Uint8Array> => {
  if (!isBlankPdfOptions(options)) throw new Error('UTILITY_BLANK_OPTIONS_INVALID');
  const base = BLANK_PAGE_SIZES[options.pageSize];
  const width = options.orientation === 'landscape' ? base.height : base.width;
  const height = options.orientation === 'landscape' ? base.width : base.height;
  const pageCount = options.pageCount ?? 1;
  const margin = options.marginPoints;
  const document = await PDFDocument.create({ updateMetadata: false });
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([width, height]);
    page.setArtBox(margin, margin, width - margin * 2, height - margin * 2);
  }
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: false });
  try {
    if (bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes) throw new Error('output limit');
    const verification = await PDFDocument.load(bytes, { updateMetadata: false });
    if (verification.getPageCount() !== pageCount) throw new Error('mismatch');
    for (const page of verification.getPages()) {
      const artBox = page.getArtBox();
      const boxes = [page.getMediaBox(), page.getCropBox()];
      if (
        boxes.some(
          (box) =>
            Math.abs(box.x) > 0.01 ||
            Math.abs(box.y) > 0.01 ||
            Math.abs(box.width - width) > 0.01 ||
            Math.abs(box.height - height) > 0.01,
        ) ||
        Math.abs(artBox.x - margin) > 0.01 ||
        Math.abs(artBox.y - margin) > 0.01 ||
        Math.abs(artBox.width - (width - margin * 2)) > 0.01 ||
        Math.abs(artBox.height - (height - margin * 2)) > 0.01 ||
        page.getRotation().angle !== 0 ||
        page.node.Contents() !== undefined ||
        page.node.Annots() !== undefined
      )
        throw new Error('mismatch');
    }
  } catch {
    throw new Error('UTILITY_BLANK_VERIFICATION_FAILED');
  }
  return bytes;
};

const boundedText = (value: string, label: string, maximum = 2_000): string => {
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`UTILITY_METADATA_${label}_LIMIT`);
  return normalized;
};

const assertPdfBytes = (bytes: Uint8Array): void => {
  if (bytes.byteLength === 0 || bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes) {
    throw new Error('UTILITY_PDF_SIZE_LIMIT');
  }
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('UTILITY_NOT_PDF');
  }
};

const loadUnencryptedPdf = async (bytes: Uint8Array, preserveXFA = false): Promise<PDFDocument> => {
  assertPdfBytes(bytes);
  const inspection = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    preserveXFA,
    updateMetadata: false,
  });
  if (inspection.isEncrypted) throw new Error('UTILITY_PASSWORD_REQUIRED');
  return PDFDocument.load(bytes, { preserveXFA, updateMetadata: false });
};

const percentageReduction = (before: number, after: number): number =>
  Math.max(0, Math.round(((before - after) / before) * 1_000) / 10);

/**
 * Rewrites PDF structure without resampling, rasterizing, or otherwise changing page content.
 * If the rewrite is larger, the immutable source bytes are returned instead.
 */
export const compressPdfLosslessly = async (
  bytes: Uint8Array,
  preset: CompressionPreset,
): Promise<CompressionResult> => {
  assertPdfBytes(bytes);
  const revisionStructure = inspectPdfRevisionStructure(bytes);
  if (revisionStructure === 'malformed') throw new Error('UTILITY_PDF_MALFORMED');
  if (revisionStructure === 'incremental') throw new Error('UTILITY_INCREMENTAL_REVISIONS_BLOCKED');
  let document: PDFDocument;
  try {
    document = await loadUnencryptedPdf(bytes, true);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'UTILITY_PASSWORD_REQUIRED') throw error;
    throw new Error('UTILITY_PDF_MALFORMED');
  }
  let pageCount: number;
  let risk: ReturnType<typeof findPdfModificationRisk>;
  try {
    pageCount = document.getPageCount();
    risk = findPdfModificationRisk(document);
  } catch {
    throw new Error('UTILITY_PDF_MALFORMED');
  }
  // OPT-001: count parsed page leaves before either rewriting or returning the original.
  if (pageCount > LOCAL_PDF_LIMITS.maximumPages) throw new Error('UTILITY_PDF_PAGE_LIMIT');
  if (risk !== null) throw new Error(`UTILITY_${risk}_BLOCKED`);
  const settings =
    preset === 'highest-quality'
      ? { rewrite: false, useObjectStreams: false }
      : preset === 'balanced'
        ? { rewrite: false, useObjectStreams: true }
        : { rewrite: true, useObjectStreams: true };
  let candidate: Uint8Array;
  try {
    candidate = await document.save({
      ...settings,
      addDefaultPage: false,
      updateFieldAppearances: false,
    });
  } catch {
    throw new Error('UTILITY_PDF_MALFORMED');
  }
  const usedOriginal = candidate.byteLength >= bytes.byteLength;
  if (!usedOriginal) {
    try {
      const verification = await PDFDocument.load(candidate, {
        preserveXFA: true,
        updateMetadata: false,
      });
      assertCompressionStructurePreserved(document, verification);
    } catch {
      throw new Error('UTILITY_PRESERVATION_FAILED');
    }
  }
  const output = usedOriginal ? bytes.slice() : candidate;
  return {
    bytes: output,
    report: Object.freeze({
      method: 'lossless-structural',
      originalBytes: bytes.byteLength,
      outputBytes: output.byteLength,
      preset,
      reductionPercent: percentageReduction(bytes.byteLength, output.byteLength),
      usedOriginal,
      warningCodes: Object.freeze(
        usedOriginal
          ? (['LOSSLESS_ONLY', 'ALREADY_OPTIMIZED'] as const)
          : (['LOSSLESS_ONLY'] as const),
      ),
    }),
  };
};

const assertPassword = (password: string): void => {
  const byteLength = new TextEncoder().encode(password).byteLength;
  if (byteLength < 12) throw new Error('UTILITY_PASSWORD_TOO_SHORT');
  if (byteLength > 127) throw new Error('UTILITY_PASSWORD_TOO_LONG');
};

export const protectPdf = async (bytes: Uint8Array, password: string): Promise<Uint8Array> => {
  assertPassword(password);
  if (!isPermissionPassword(password)) throw new Error('UTILITY_PASSWORD_CHARACTERS_UNSUPPORTED');
  return setPdfPermissions(
    bytes,
    {
      annotating: true,
      copying: true,
      documentAssembly: true,
      fillingForms: true,
      modifying: true,
      printing: 'high',
    },
    `${crypto.randomUUID()}-${crypto.randomUUID()}`,
    password,
    true,
  );
};

export const unlockPdf = async (
  bytes: Uint8Array,
  password: string,
  authorized: boolean,
): Promise<Uint8Array> => {
  assertPdfBytes(bytes);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
  if (authorized !== true) throw new Error('UTILITY_AUTHORIZATION_REQUIRED');
  if (password.length === 0) throw new Error('UTILITY_PASSWORD_REQUIRED');
  const source = Uint8Array.from(bytes);
  const revision = inspectPdfRevisionStructure(source);
  if (revision === 'malformed') throw new Error('UTILITY_PDF_MALFORMED');
  if (revision === 'incremental') throw new Error('UTILITY_INCREMENTAL_REVISIONS_BLOCKED');
  let inspection: PDFDocument;
  try {
    inspection = await PDFDocument.load(source, {
      ignoreEncryption: true,
      preserveXFA: true,
      updateMetadata: false,
    });
  } catch {
    throw new Error('UTILITY_PDF_MALFORMED');
  }
  if (!inspection.isEncrypted) throw new Error('UTILITY_NOT_ENCRYPTED');
  const encryptionReference = inspection.context.trailerInfo.Encrypt;
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source, {
      password,
      preserveXFA: true,
      updateMetadata: false,
    });
  } catch {
    throw new Error('UTILITY_PASSWORD_INCORRECT');
  }
  // The locked decrypting parser drops Info from its trailer, not the object graph.
  // Restore that pointer explicitly; otherwise save silently loses source metadata.
  const metadataReference = inspection.context.trailerInfo.Info;
  if (metadataReference === undefined) delete document.context.trailerInfo.Info;
  else document.context.trailerInfo.Info = metadataReference;
  // Retire the source cipher dictionary before inspecting the decrypted graph.
  delete document.context.security;
  if (encryptionReference instanceof PDFRef) document.context.delete(encryptionReference);
  // The decrypting parser can treat the cleartext XRef transport stream as
  // encrypted and retain an invalid container. Parsed document objects survive;
  // retire only containers positively identified by the raw inspection.
  for (const [reference, object] of inspection.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFRawStream &&
      ['/XRef', '/ObjStm'].includes(
        object.dict.lookupMaybe(PDFName.of('Type'), PDFName)?.asString() ?? '',
      )
    )
      document.context.delete(reference);
  }
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
  try {
    assertSupportedEncryptionStringLayout(document);
  } catch {
    throw new Error('UTILITY_PERMISSIONS_STRING_LAYOUT_BLOCKED');
  }
  // Full serialization retains stable source references but no prior revision bytes.
  // Only this authorized operation removes encryption; all content must survive.
  try {
    const snapshot = await capturePdfSecurityPreservation(document);
    const output = await document.save({
      addDefaultPage: false,
      useObjectStreams: true,
      updateFieldAppearances: false,
    });
    if (output.byteLength > LOCAL_PDF_LIMITS.maximumBytes) throw new Error('output limit');
    const reopened = await PDFDocument.load(output, { preserveXFA: true, updateMetadata: false });
    if (reopened.isEncrypted) throw new Error('encryption');
    await assertPdfSecurityPreserved(snapshot, reopened);
    return output;
  } catch {
    throw new Error('UTILITY_DECRYPT_VERIFICATION_FAILED');
  }
};

const toIso = (value: Date | undefined): string | null => value?.toISOString() ?? null;

export const readPdfMetadata = async (bytes: Uint8Array): Promise<PdfMetadata> => {
  const document = await loadUnencryptedPdf(bytes);
  return Object.freeze({
    author: document.getAuthor() ?? '',
    creationDate: toIso(document.getCreationDate()),
    creator: document.getCreator() ?? '',
    hasXmpPacket: document.catalog.has(PDFName.of('Metadata')),
    keywords: document.getKeywords() ?? '',
    modificationDate: toIso(document.getModificationDate()),
    producer: document.getProducer() ?? '',
    subject: document.getSubject() ?? '',
    title: document.getTitle() ?? '',
  });
};

export const updatePdfMetadata = async (
  bytes: Uint8Array,
  patch: PdfMetadataPatch,
): Promise<Uint8Array> => {
  const document = await loadUnencryptedPdf(bytes);
  if (patch.title !== undefined) document.setTitle(boundedText(patch.title, 'TITLE'));
  if (patch.author !== undefined) document.setAuthor(boundedText(patch.author, 'AUTHOR'));
  if (patch.subject !== undefined) document.setSubject(boundedText(patch.subject, 'SUBJECT'));
  if (patch.creator !== undefined) document.setCreator(boundedText(patch.creator, 'CREATOR'));
  if (patch.producer !== undefined) document.setProducer(boundedText(patch.producer, 'PRODUCER'));
  if (patch.keywords !== undefined) {
    const keywords = patch.keywords
      .split(',')
      .map((value) => boundedText(value, 'KEYWORDS', 200))
      .filter(Boolean);
    if (keywords.length > 50) throw new Error('UTILITY_METADATA_KEYWORDS_LIMIT');
    document.setKeywords(keywords);
  }
  return document.save({ addDefaultPage: false, rewrite: true, useObjectStreams: true });
};

const documentInfoKeys = [
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
] as const;

export const removePdfMetadata = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const document = await loadUnencryptedPdf(bytes);
  const infoReference = document.context.trailerInfo.Info;
  if (infoReference !== undefined) {
    const info = document.context.lookup(infoReference, PDFDict);
    for (const key of documentInfoKeys) info.delete(PDFName.of(key));
  }
  document.catalog.delete(PDFName.of('Metadata'));
  return document.save({ addDefaultPage: false, rewrite: true, useObjectStreams: true });
};

const pageDimensions = (
  pageSize: ImagesToPdfOptions['pageSize'],
  width: number,
  height: number,
): readonly [number, number] => {
  if (pageSize === 'a4') return [595.28, 841.89];
  if (pageSize === 'letter') return [612, 792];
  const maximumDimension = 2_000;
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  return [width * scale, height * scale];
};

export const imagesToPdf = async (
  sources: readonly ImagePdfSource[],
  options: ImagesToPdfOptions,
): Promise<Uint8Array> => {
  if (sources.length === 0 || sources.length > LOCAL_UTILITY_LIMITS.maximumImageCount) {
    throw new Error('UTILITY_IMAGE_COUNT_LIMIT');
  }
  if (
    sources.some(
      ({ bytes }) => bytes.byteLength === 0 || bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes,
    )
  ) {
    throw new Error('UTILITY_IMAGE_SIZE_LIMIT');
  }
  if (
    sources.reduce((total, { bytes }) => total + bytes.byteLength, 0) >
    LOCAL_UTILITY_LIMITS.maximumImageInputBytes
  ) {
    throw new Error('UTILITY_IMAGE_TOTAL_SIZE_LIMIT');
  }
  const document = await PDFDocument.create({ updateMetadata: false });
  for (const source of sources) {
    const normalized = await normalizeImageForPdf(source);
    let image;
    try {
      image =
        normalized.mimeType === 'image/png'
          ? await document.embedPng(normalized.bytes)
          : await document.embedJpg(normalized.bytes);
    } catch {
      throw new Error('UTILITY_IMAGE_INVALID');
    }
    if (
      image.width !== normalized.width ||
      image.height !== normalized.height ||
      image.width * image.height > LOCAL_PDF_LIMITS.maximumImagePixels
    ) {
      throw new Error('UTILITY_IMAGE_PIXELS_LIMIT');
    }
    const [pageWidth, pageHeight] = pageDimensions(options.pageSize, image.width, image.height);
    const page = document.addPage([pageWidth, pageHeight]);
    const scale =
      options.fit === 'cover'
        ? Math.max(pageWidth / image.width, pageHeight / image.height)
        : Math.min(pageWidth / image.width, pageHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      height,
      width,
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
    });
  }
  return document.save({ addDefaultPage: false, useObjectStreams: true });
};
