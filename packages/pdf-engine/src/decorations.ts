import {
  beginMarkedContent,
  degrees,
  endMarkedContent,
  PDFDocument,
  PDFName,
  PDFNumber,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';

import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { findPdfModificationRisk } from './modification-risks.js';
import { isPdfDecorationOptions, resolveDecorationPages } from './decoration-options.js';
import {
  decorationAlignedX as alignedX,
  decorationFontSupports,
  decorationTextAdvance,
  normalizeDecorationText,
  substituteDecorationPageTokens as substitutePageTokens,
} from './decoration-layout.js';
import type {
  PdfDecorationOptions,
  RepeatingTextDecoration,
  WatermarkDecoration,
} from './decoration-options.js';
export type {
  DecorationAlignment,
  DecorationPageSelection,
  PdfDecorationOptions,
  RepeatingTextDecoration,
  WatermarkDecoration,
} from './decoration-options.js';

export type PageModificationNamespace = 'DECORATION' | 'GEOMETRY' | 'NUMBERING';

export interface PageTransform {
  readonly crop: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly displayHeight: number;
  readonly displayWidth: number;
  readonly rotation: 0 | 90 | 180 | 270;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const namespacedFail = (namespace: PageModificationNamespace, code: string): never =>
  fail(`${namespace}_${code}`);

const assertPdfBytes = (bytes: Uint8Array, namespace: PageModificationNamespace): void => {
  if (bytes.byteLength === 0 || bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes) {
    namespacedFail(namespace, 'PDF_SIZE_LIMIT');
  }
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    namespacedFail(namespace, 'NOT_PDF');
  }
};

const normalizeRotation = (
  value: number,
  namespace: PageModificationNamespace,
): 0 | 90 | 180 | 270 => {
  const normalized = ((value % 360) + 360) % 360;
  return normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : namespacedFail(namespace, 'ROTATION_UNSUPPORTED');
};

export const decorationPageTransform = (
  page: PDFPage,
  namespace: PageModificationNamespace = 'DECORATION',
): PageTransform => {
  const crop = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle, namespace);
  return {
    crop,
    displayHeight: rotation === 90 || rotation === 270 ? crop.width : crop.height,
    displayWidth: rotation === 90 || rotation === 270 ? crop.height : crop.width,
    rotation,
  };
};

/** EDIT-006/EDIT-007 and ORG-011/ORG-012: no ambiguous physical placement. */
export const validatedDecorationPageTransform = (
  page: PDFPage,
  namespace: PageModificationNamespace = 'DECORATION',
): PageTransform => {
  try {
    const transform = decorationPageTransform(page, namespace);
    const media = page.getMediaBox();
    const { crop } = transform;
    if (
      ![media.x, media.y, media.width, media.height, crop.x, crop.y, crop.width, crop.height].every(
        Number.isFinite,
      ) ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.width > 14_400 ||
      crop.height > 14_400 ||
      crop.x < media.x ||
      crop.y < media.y ||
      crop.x + crop.width > media.x + media.width ||
      crop.y + crop.height > media.y + media.height ||
      (page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1) !== 1
    )
      namespacedFail(namespace, 'PAGE_BOX_UNSUPPORTED');
    return transform;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === `${namespace}_ROTATION_UNSUPPORTED`)
      throw error;
    // Malformed PDF objects can carry content in parser errors; return only a fixed code.
    return namespacedFail(namespace, 'PAGE_BOX_UNSUPPORTED');
  }
};

const toPdfPoint = (
  transform: PageTransform,
  point: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => {
  const { crop, rotation } = transform;
  if (rotation === 0)
    return { x: crop.x + point.x * crop.width, y: crop.y + (1 - point.y) * crop.height };
  if (rotation === 90)
    return { x: crop.x + point.y * crop.width, y: crop.y + point.x * crop.height };
  if (rotation === 180)
    return { x: crop.x + (1 - point.x) * crop.width, y: crop.y + point.y * crop.height };
  return {
    x: crop.x + (1 - point.y) * crop.width,
    y: crop.y + (1 - point.x) * crop.height,
  };
};

const toRgb = (hex: string, namespace: PageModificationNamespace) => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) return namespacedFail(namespace, 'COLOR_INVALID');
  return rgb(
    Number.parseInt(match[1] ?? '0', 16) / 255,
    Number.parseInt(match[2] ?? '0', 16) / 255,
    Number.parseInt(match[3] ?? '0', 16) / 255,
  );
};

const encodable = (font: PDFFont, text: string, namespace: PageModificationNamespace): string => {
  // ORG-011/ORG-012 retain exactly the same text as logical labels and the report.
  const normalized = namespace === 'NUMBERING' ? text : normalizeDecorationText(text);
  if (!decorationFontSupports(font, normalized))
    return namespacedFail(namespace, 'TEXT_ENCODING_UNSUPPORTED');
  try {
    font.encodeText(normalized);
  } catch {
    return namespacedFail(namespace, 'TEXT_ENCODING_UNSUPPORTED');
  }
  return normalized;
};

export const drawRepeatingText = (
  page: PDFPage,
  transform: PageTransform,
  decoration: RepeatingTextDecoration,
  text: string,
  marginPoints: number,
  position: 'footer' | 'header',
  font: PDFFont,
  namespace: PageModificationNamespace = 'DECORATION',
): void => {
  const safeText = encodable(font, text, namespace);
  const textWidth = decorationTextAdvance(font, safeText, decoration.fontSize);
  const ascent = font.heightAtSize(decoration.fontSize, { descender: false });
  const descent = font.heightAtSize(decoration.fontSize) - ascent;
  if (
    textWidth > transform.displayWidth - 2 * marginPoints ||
    transform.displayHeight <= 2 * marginPoints + ascent + descent ||
    (position === 'header' ? ascent : descent) > marginPoints
  )
    namespacedFail(namespace, 'TEXT_DOES_NOT_FIT');
  const point = toPdfPoint(transform, {
    x: alignedX(decoration.alignment, transform.displayWidth, marginPoints, textWidth),
    y:
      position === 'header'
        ? marginPoints / transform.displayHeight
        : 1 - marginPoints / transform.displayHeight,
  });
  page.pushOperators(beginMarkedContent('Artifact'));
  page.drawText(safeText, {
    color: toRgb(decoration.color, namespace),
    font,
    rotate: degrees(transform.rotation),
    size: decoration.fontSize,
    x: point.x,
    y: point.y,
  });
  page.pushOperators(endMarkedContent());
};

const drawWatermark = (
  page: PDFPage,
  transform: PageTransform,
  decoration: WatermarkDecoration,
  text: string,
  font: PDFFont,
): void => {
  const safeText = encodable(font, text, 'DECORATION');
  const textWidth = decorationTextAdvance(font, safeText, decoration.fontSize);
  const point = toPdfPoint(transform, {
    x: Math.max(0.02, (transform.displayWidth - textWidth) / 2 / transform.displayWidth),
    y: 0.5,
  });
  page.pushOperators(beginMarkedContent('Artifact'));
  page.drawText(safeText, {
    color: toRgb(decoration.color, 'DECORATION'),
    font,
    opacity: decoration.opacity,
    rotate: degrees(transform.rotation + decoration.rotation),
    size: decoration.fontSize,
    x: point.x,
    y: point.y,
  });
  page.pushOperators(endMarkedContent());
};

const assertSafeStructure = (document: PDFDocument, namespace: PageModificationNamespace): void => {
  const risk = findPdfModificationRisk(document);
  if (risk !== null) namespacedFail(namespace, `${risk}_BLOCKED`);
};

const formNames = (document: PDFDocument): readonly string[] => {
  if (document.catalog.getAcroForm() === undefined) return [];
  return document
    .getForm()
    .getFields()
    .map((field) => field.getName())
    .sort();
};

export interface PageModificationDocument {
  readonly beforeForms: readonly string[];
  readonly document: PDFDocument;
  readonly namespace: PageModificationNamespace;
  readonly pageCount: number;
  readonly taggedBefore: boolean;
}

export const loadPageModificationDocument = async (
  bytes: Uint8Array,
  namespace: PageModificationNamespace,
): Promise<PageModificationDocument> => {
  assertPdfBytes(bytes, namespace);
  const inspection = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    preserveXFA: true,
    updateMetadata: false,
  });
  if (inspection.isEncrypted) namespacedFail(namespace, 'PASSWORD_REQUIRED');
  const document = await PDFDocument.load(bytes, { preserveXFA: true, updateMetadata: false });
  assertSafeStructure(document, namespace);
  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > LOCAL_PDF_LIMITS.maximumPages) {
    namespacedFail(namespace, 'PAGE_LIMIT');
  }
  return {
    beforeForms: formNames(document),
    document,
    namespace,
    pageCount,
    taggedBefore: document.catalog.has(PDFName.of('StructTreeRoot')),
  };
};

export const savePageModificationDocument = async (
  snapshot: PageModificationDocument,
): Promise<Uint8Array> => {
  const output = await snapshot.document.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: true,
  });
  const verification = await PDFDocument.load(output, { preserveXFA: true, updateMetadata: false });
  if (verification.getPageCount() !== snapshot.pageCount) {
    namespacedFail(snapshot.namespace, 'PAGE_VERIFY_FAILED');
  }
  if (JSON.stringify(formNames(verification)) !== JSON.stringify(snapshot.beforeForms)) {
    namespacedFail(snapshot.namespace, 'FORM_VERIFY_FAILED');
  }
  if (snapshot.taggedBefore && !verification.catalog.has(PDFName.of('StructTreeRoot'))) {
    namespacedFail(snapshot.namespace, 'TAG_VERIFY_FAILED');
  }
  return output;
};

export const decoratePdf = async (
  bytes: Uint8Array,
  options: PdfDecorationOptions,
): Promise<Uint8Array> => {
  if (!isPdfDecorationOptions(options)) fail('DECORATION_OPTIONS_INVALID');
  const snapshot = await loadPageModificationDocument(bytes, 'DECORATION');
  const { document } = snapshot;
  const font = await document.embedFont(StandardFonts.Helvetica);
  const total = snapshot.pageCount;
  const selectedPages = resolveDecorationPages(options, total);
  for (const pageNumber of selectedPages) {
    const page = document.getPage(pageNumber - 1);
    const transform = validatedDecorationPageTransform(page);
    if (options.header !== null) {
      drawRepeatingText(
        page,
        transform,
        options.header,
        substitutePageTokens(options.header.text, pageNumber, total),
        options.marginPoints,
        'header',
        font,
      );
    }
    if (options.footer !== null) {
      drawRepeatingText(
        page,
        transform,
        options.footer,
        substitutePageTokens(options.footer.text, pageNumber, total),
        options.marginPoints,
        'footer',
        font,
      );
    }
    if (options.watermark !== null) {
      drawWatermark(
        page,
        transform,
        options.watermark,
        substitutePageTokens(options.watermark.text, pageNumber, total),
        font,
      );
    }
  }
  return savePageModificationDocument(snapshot);
};
