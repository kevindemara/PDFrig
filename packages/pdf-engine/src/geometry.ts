import { PDFArray, PDFDocument, PDFName, PDFNumber, type PDFPage } from '@cantoo/pdf-lib';

import { loadPageModificationDocument, savePageModificationDocument } from './decorations.js';

export interface PdfRectangle {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface PdfPageGeometry {
  readonly cropBox: PdfRectangle;
  readonly mediaBox: PdfRectangle;
  readonly pageNumber: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly visibleHeight: number;
  readonly visibleWidth: number;
}

export interface PdfGeometryInspection {
  readonly pageCount: number;
  readonly pages: readonly PdfPageGeometry[];
}

interface PageRangeOptions {
  readonly endPage: number | null;
  readonly startPage: number;
}

export interface PdfCropOptions extends PageRangeOptions {
  readonly kind: 'crop';
  readonly margins: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  };
}

export interface PdfResizeOptions extends PageRangeOptions {
  readonly fit: 'contain' | 'cover';
  readonly kind: 'resize';
  readonly targetHeight: number;
  readonly targetWidth: number;
}

export type PdfGeometryOptions = PdfCropOptions | PdfResizeOptions;

export interface PdfGeometryReport {
  readonly appliedPages: number;
  readonly firstPageAfter: PdfPageGeometry;
  readonly firstPageBefore: PdfPageGeometry;
  readonly kind: PdfGeometryOptions['kind'];
  readonly operationVersion: '1.0.0';
  readonly range: { readonly endPage: number; readonly startPage: number };
  readonly sourcePages: number;
}

export interface PdfGeometryResult {
  readonly bytes: Uint8Array;
  readonly report: PdfGeometryReport;
}

const MAXIMUM_PAGE_POINTS = 14_400;
const MAXIMUM_MARGIN_POINTS = 1_440;
const MINIMUM_VISIBLE_POINTS = 36;
const MINIMUM_TARGET_POINTS = 72;
const MAXIMUM_TARGET_POINTS = 2_000;
const BOX_TOLERANCE = 0.01;

const fail = (code: string): never => {
  throw new Error(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isIntegerBetween = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isFiniteBetween = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const validRange = (value: Record<string, unknown>): boolean =>
  (value.endPage === null || isIntegerBetween(value.endPage, 1, 500)) &&
  isIntegerBetween(value.startPage, 1, 500);

export const isPdfGeometryOptions = (value: unknown): value is PdfGeometryOptions => {
  if (!isRecord(value) || !validRange(value)) return false;
  if (value.kind === 'crop') {
    return (
      hasOnlyKeys(value, ['endPage', 'kind', 'margins', 'startPage']) &&
      isRecord(value.margins) &&
      hasOnlyKeys(value.margins, ['bottom', 'left', 'right', 'top']) &&
      isFiniteBetween(value.margins.bottom, 0, MAXIMUM_MARGIN_POINTS) &&
      isFiniteBetween(value.margins.left, 0, MAXIMUM_MARGIN_POINTS) &&
      isFiniteBetween(value.margins.right, 0, MAXIMUM_MARGIN_POINTS) &&
      isFiniteBetween(value.margins.top, 0, MAXIMUM_MARGIN_POINTS)
    );
  }
  return (
    value.kind === 'resize' &&
    hasOnlyKeys(value, ['endPage', 'fit', 'kind', 'startPage', 'targetHeight', 'targetWidth']) &&
    (value.fit === 'contain' || value.fit === 'cover') &&
    isFiniteBetween(value.targetHeight, MINIMUM_TARGET_POINTS, MAXIMUM_TARGET_POINTS) &&
    isFiniteBetween(value.targetWidth, MINIMUM_TARGET_POINTS, MAXIMUM_TARGET_POINTS)
  );
};

const rotation = (page: PDFPage): 0 | 90 | 180 | 270 => {
  const normalized = ((page.getRotation().angle % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return fail('GEOMETRY_ROTATION_UNSUPPORTED');
};

const finiteBox = (box: PdfRectangle): PdfRectangle => {
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !isFiniteBetween(box.width, 1, MAXIMUM_PAGE_POINTS) ||
    !isFiniteBetween(box.height, 1, MAXIMUM_PAGE_POINTS)
  ) {
    fail('GEOMETRY_PAGE_BOX_UNSUPPORTED');
  }
  return box;
};

const geometryForPage = (page: PDFPage, pageNumber: number): PdfPageGeometry => {
  const cropBox = finiteBox(page.getCropBox());
  const mediaBox = finiteBox(page.getMediaBox());
  const pageRotation = rotation(page);
  return Object.freeze({
    cropBox: Object.freeze({ ...cropBox }),
    mediaBox: Object.freeze({ ...mediaBox }),
    pageNumber,
    rotation: pageRotation,
    visibleHeight: pageRotation === 90 || pageRotation === 270 ? cropBox.width : cropBox.height,
    visibleWidth: pageRotation === 90 || pageRotation === 270 ? cropBox.height : cropBox.width,
  });
};

const inspectDocument = (document: PDFDocument): PdfGeometryInspection => ({
  pageCount: document.getPageCount(),
  pages: Object.freeze(document.getPages().map((page, index) => geometryForPage(page, index + 1))),
});

export const inspectPdfGeometry = async (bytes: Uint8Array): Promise<PdfGeometryInspection> => {
  const { document } = await loadPageModificationDocument(bytes, 'GEOMETRY');
  return inspectDocument(document);
};

const resolveRange = (
  options: PageRangeOptions,
  pageCount: number,
): { readonly appliedPages: number; readonly endPage: number } => {
  const endPage = options.endPage ?? pageCount;
  if (options.startPage > endPage || endPage > pageCount) fail('GEOMETRY_PAGE_RANGE_INVALID');
  return { appliedPages: endPage - options.startPage + 1, endPage };
};

const rawMargins = (
  pageRotation: PdfPageGeometry['rotation'],
  margins: PdfCropOptions['margins'],
): PdfCropOptions['margins'] => {
  if (pageRotation === 0) return margins;
  if (pageRotation === 90) {
    return {
      bottom: margins.left,
      left: margins.top,
      right: margins.bottom,
      top: margins.right,
    };
  }
  if (pageRotation === 180) {
    return {
      bottom: margins.top,
      left: margins.right,
      right: margins.left,
      top: margins.bottom,
    };
  }
  return {
    bottom: margins.right,
    left: margins.bottom,
    right: margins.top,
    top: margins.left,
  };
};

const cropPage = (page: PDFPage, before: PdfPageGeometry, options: PdfCropOptions): void => {
  const margins = rawMargins(before.rotation, options.margins);
  const width = before.cropBox.width - margins.left - margins.right;
  const height = before.cropBox.height - margins.top - margins.bottom;
  if (width < MINIMUM_VISIBLE_POINTS || height < MINIMUM_VISIBLE_POINTS) {
    fail('GEOMETRY_CROP_TOO_SMALL');
  }
  page.setCropBox(
    before.cropBox.x + margins.left,
    before.cropBox.y + margins.bottom,
    width,
    height,
  );
};

const hasAnnotations = (page: PDFPage): boolean => {
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annotations !== undefined && annotations.size() > 0;
};

const hasUnusualUserUnit = (page: PDFPage): boolean => {
  const value = page.node.getInheritableAttribute(PDFName.of('UserUnit'));
  if (value === undefined) return false;
  const number = page.doc.context.lookupMaybe(value, PDFNumber);
  return number === undefined || Math.abs(number.asNumber() - 1) > Number.EPSILON;
};

const assertResizeStructure = (document: PDFDocument): void => {
  if (document.catalog.has(PDFName.of('StructTreeRoot'))) fail('GEOMETRY_TAGGED_RESIZE_BLOCKED');
  if (document.catalog.getAcroForm() !== undefined && document.getForm().getFields().length > 0) {
    fail('GEOMETRY_FORMS_RESIZE_BLOCKED');
  }
  for (const page of document.getPages()) {
    if (hasAnnotations(page)) fail('GEOMETRY_ANNOTATIONS_RESIZE_BLOCKED');
    if (hasUnusualUserUnit(page)) fail('GEOMETRY_USER_UNIT_RESIZE_BLOCKED');
    if (
      page.node.has(PDFName.of('BleedBox')) ||
      page.node.has(PDFName.of('TrimBox')) ||
      page.node.has(PDFName.of('ArtBox')) ||
      page.node.has(PDFName.of('PieceInfo')) ||
      page.node.has(PDFName.of('SeparationInfo'))
    ) {
      fail('GEOMETRY_PREPRESS_RESIZE_BLOCKED');
    }
  }
};

const resizePage = (page: PDFPage, before: PdfPageGeometry, options: PdfResizeOptions): void => {
  const sideways = before.rotation === 90 || before.rotation === 270;
  const targetRawWidth = sideways ? options.targetHeight : options.targetWidth;
  const targetRawHeight = sideways ? options.targetWidth : options.targetHeight;
  const scale =
    options.fit === 'cover'
      ? Math.max(targetRawWidth / before.cropBox.width, targetRawHeight / before.cropBox.height)
      : Math.min(targetRawWidth / before.cropBox.width, targetRawHeight / before.cropBox.height);
  const offsetX = (targetRawWidth - before.cropBox.width * scale) / 2;
  const offsetY = (targetRawHeight - before.cropBox.height * scale) / 2;

  // Each pdf-lib helper wraps the existing streams. This call order yields
  // (source - CropBox origin) * scale + centred target offset in the PDF CTM.
  page.translateContent(offsetX, offsetY);
  page.scaleContent(scale, scale);
  page.translateContent(-before.cropBox.x, -before.cropBox.y);
  page.setMediaBox(0, 0, targetRawWidth, targetRawHeight);
  page.setCropBox(0, 0, targetRawWidth, targetRawHeight);
};

const close = (left: number, right: number): boolean => Math.abs(left - right) <= BOX_TOLERANCE;

const verifyOutput = (
  beforeInspection: PdfGeometryInspection,
  inspection: PdfGeometryInspection,
  options: PdfGeometryOptions,
  startPage: number,
  endPage: number,
): void => {
  for (let index = 0; index < inspection.pages.length; index += 1) {
    const page = inspection.pages[index] ?? fail('GEOMETRY_VERIFY_FAILED');
    const pageNumber = index + 1;
    if (pageNumber < startPage || pageNumber > endPage) continue;
    if (options.kind === 'resize') {
      if (
        !close(page.visibleWidth, options.targetWidth) ||
        !close(page.visibleHeight, options.targetHeight)
      ) {
        fail('GEOMETRY_RESIZE_VERIFY_FAILED');
      }
    } else {
      const before = beforeInspection.pages[index];
      if (
        before === undefined ||
        !close(
          page.visibleWidth,
          before.visibleWidth - options.margins.left - options.margins.right,
        ) ||
        !close(
          page.visibleHeight,
          before.visibleHeight - options.margins.top - options.margins.bottom,
        )
      ) {
        fail('GEOMETRY_CROP_VERIFY_FAILED');
      }
    }
  }
};

export const modifyPdfGeometry = async (
  bytes: Uint8Array,
  options: PdfGeometryOptions,
): Promise<PdfGeometryResult> => {
  if (!isPdfGeometryOptions(options)) fail('GEOMETRY_OPTIONS_INVALID');
  const snapshot = await loadPageModificationDocument(bytes, 'GEOMETRY');
  const beforeInspection = inspectDocument(snapshot.document);
  const { appliedPages, endPage } = resolveRange(options, snapshot.pageCount);
  if (options.kind === 'resize') assertResizeStructure(snapshot.document);

  for (let pageNumber = options.startPage; pageNumber <= endPage; pageNumber += 1) {
    const page = snapshot.document.getPage(pageNumber - 1);
    const before = beforeInspection.pages[pageNumber - 1] ?? fail('GEOMETRY_PAGE_RANGE_INVALID');
    if (options.kind === 'crop') cropPage(page, before, options);
    else resizePage(page, before, options);
  }

  const output = await savePageModificationDocument(snapshot);
  const verification = await PDFDocument.load(output, { preserveXFA: true, updateMetadata: false });
  const afterInspection = inspectDocument(verification);
  verifyOutput(beforeInspection, afterInspection, options, options.startPage, endPage);
  const firstPageBefore =
    beforeInspection.pages[options.startPage - 1] ?? fail('GEOMETRY_VERIFY_FAILED');
  const firstPageAfter =
    afterInspection.pages[options.startPage - 1] ?? fail('GEOMETRY_VERIFY_FAILED');
  return {
    bytes: output,
    report: {
      appliedPages,
      firstPageAfter,
      firstPageBefore,
      kind: options.kind,
      operationVersion: '1.0.0',
      range: { endPage, startPage: options.startPage },
      sourcePages: snapshot.pageCount,
    },
  };
};
