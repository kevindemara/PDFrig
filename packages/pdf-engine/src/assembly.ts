import { degrees, PDFDocument } from '@cantoo/pdf-lib';

import { normalizeImageForPdf, type SupportedImageMimeType } from './image-normalization.js';
import { inspectPdfRevisionStructure } from './incremental-revisions.js';
import { findPdfOrganizerRisk } from './modification-risks.js';

export interface AssemblyPage {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly sourceId: string;
  readonly sourcePageIndex: number;
}

export interface AssemblySource {
  readonly bytes: Uint8Array;
  readonly sourceId: string;
}

export const assemblePdf = async (
  sources: readonly AssemblySource[],
  pages: readonly AssemblyPage[],
): Promise<Uint8Array> => {
  if (pages.length === 0) throw new Error('A PDF export must contain at least one page.');
  if (new Set(sources.map(({ sourceId }) => sourceId)).size !== sources.length) {
    throw new Error('ORGANIZER_SOURCE_IDS_INVALID');
  }
  const loaded = new Map<string, PDFDocument>();
  for (const source of sources) {
    const revisionStructure = inspectPdfRevisionStructure(source.bytes);
    if (revisionStructure === 'incremental') {
      throw new Error('ORGANIZER_INCREMENTAL_REVISIONS_BLOCKED');
    }
    if (revisionStructure === 'malformed') throw new Error('ORGANIZER_INVALID_STRUCTURE');
    const document = await PDFDocument.load(source.bytes, { updateMetadata: false }).catch(() => {
      throw new Error('ORGANIZER_INVALID_STRUCTURE');
    });
    const risk = (() => {
      try {
        return findPdfOrganizerRisk(document);
      } catch {
        throw new Error('ORGANIZER_INVALID_STRUCTURE');
      }
    })();
    if (risk !== null) throw new Error(`ORGANIZER_${risk}_BLOCKED`);
    loaded.set(source.sourceId, document);
  }
  const output = await PDFDocument.create();
  const expected: {
    readonly cropBox: ReturnType<ReturnType<PDFDocument['getPage']>['getCropBox']>;
    readonly mediaBox: ReturnType<ReturnType<PDFDocument['getPage']>['getMediaBox']>;
    readonly rotation: number;
  }[] = [];
  for (const page of pages) {
    const source = loaded.get(page.sourceId);
    if (source === undefined) throw new Error('ORGANIZER_SOURCE_UNAVAILABLE');
    const [copied] = await output.copyPages(source, [page.sourcePageIndex]).catch(() => {
      throw new Error('ORGANIZER_PAGE_UNAVAILABLE');
    });
    if (copied === undefined) throw new Error('ORGANIZER_PAGE_UNAVAILABLE');
    const sourceRotation = copied.getRotation().angle;
    const rotation = (sourceRotation + page.rotation) % 360;
    copied.setRotation(degrees(rotation));
    expected.push({ cropBox: copied.getCropBox(), mediaBox: copied.getMediaBox(), rotation });
    output.addPage(copied);
  }
  const bytes = await output.save({ addDefaultPage: false, useObjectStreams: true }).catch(() => {
    throw new Error('ORGANIZER_SERIALIZATION_FAILED');
  });
  const verification = await PDFDocument.load(bytes, { updateMetadata: false }).catch(() => {
    throw new Error('ORGANIZER_VERIFICATION_FAILED');
  });
  const coordinatesMatch = (
    left: {
      readonly height: number;
      readonly width: number;
      readonly x: number;
      readonly y: number;
    },
    right: {
      readonly height: number;
      readonly width: number;
      readonly x: number;
      readonly y: number;
    },
  ): boolean =>
    Math.abs(left.x - right.x) <= 0.01 &&
    Math.abs(left.y - right.y) <= 0.01 &&
    Math.abs(left.width - right.width) <= 0.01 &&
    Math.abs(left.height - right.height) <= 0.01;
  if (
    verification.getPageCount() !== pages.length ||
    verification.getPages().some((verifiedPage, index) => {
      const planned = expected[index];
      if (planned === undefined) return true;
      return (
        verifiedPage.getRotation().angle !== planned.rotation ||
        !coordinatesMatch(verifiedPage.getMediaBox(), planned.mediaBox) ||
        !coordinatesMatch(verifiedPage.getCropBox(), planned.cropBox)
      );
    })
  ) {
    throw new Error('ORGANIZER_VERIFICATION_FAILED');
  }
  return bytes;
};

export const imageToPdf = async (
  imageBytes: Uint8Array,
  mimeType: SupportedImageMimeType,
): Promise<Uint8Array> => {
  const normalized = await normalizeImageForPdf({ bytes: imageBytes, mimeType });
  const output = await PDFDocument.create();
  const image =
    normalized.mimeType === 'image/png'
      ? await output.embedPng(normalized.bytes)
      : await output.embedJpg(normalized.bytes);
  const maximumDimension = 1440;
  const scale = Math.min(1, maximumDimension / Math.max(image.width, image.height));
  const width = image.width * scale;
  const height = image.height * scale;
  const page = output.addPage([width, height]);
  page.drawImage(image, { height, width, x: 0, y: 0 });
  const bytes = await output.save({ addDefaultPage: false, useObjectStreams: true });
  const verification = await PDFDocument.load(bytes, { updateMetadata: false });
  const verifiedPage = verification.getPage(0);
  if (
    verification.getPageCount() !== 1 ||
    Math.abs(verifiedPage.getWidth() - width) > 0.01 ||
    Math.abs(verifiedPage.getHeight() - height) > 0.01
  ) {
    throw new Error('UTILITY_IMAGE_VERIFICATION_FAILED');
  }
  return bytes;
};
