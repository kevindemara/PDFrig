import { embedSignatureFont, layoutScriptSignature } from './signature-font.js';
import {
  degrees,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type {
  CommentAnnotation,
  EditorAnnotation,
  FormValue,
  MarkupAnnotation,
  NormalizedPoint,
  NormalizedRect,
  ShapeAnnotation,
  StampAnnotation,
  TextAnnotation,
  UtilityMarkAnnotation,
  VisualSignatureAnnotation,
} from '@pdfmason/editor-core';

import { assemblePdf, type AssemblyPage, type AssemblySource } from './assembly.js';
import { layoutTextOverlay, overlayFontMetrics } from './text-overlay-layout.js';
import {
  assertOutlineStructuresPreserved,
  snapshotOutlineStructures,
} from './outline-preservation.js';
import { assertTagStructuresPreserved, snapshotTagStructures } from './tag-preservation.js';

export interface EditedPagePlan extends AssemblyPage {
  readonly pageId: string;
}

export interface EditedPdfOptions {
  readonly flattenForms: boolean;
}

export interface EditedPdfRequest {
  readonly annotations: readonly EditorAnnotation[];
  readonly formValues: readonly FormValue[];
  readonly options: EditedPdfOptions;
  readonly pages: readonly EditedPagePlan[];
  readonly sources: readonly AssemblySource[];
}

interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

interface PageTransform {
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

const error = (code: string): never => {
  throw new Error(code);
};

const normalizeRotation = (value: number): 0 | 90 | 180 | 270 => {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270)
    return normalized;
  return error('EDIT_ROTATION_UNSUPPORTED');
};

const pageTransform = (page: PDFPage): PageTransform => {
  const crop = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  return {
    crop,
    displayHeight: rotation === 90 || rotation === 270 ? crop.width : crop.height,
    displayWidth: rotation === 90 || rotation === 270 ? crop.height : crop.width,
    rotation,
  };
};

const toPdfPoint = (transform: PageTransform, point: NormalizedPoint): PdfPoint => {
  const { crop, rotation } = transform;
  if (rotation === 0) {
    return { x: crop.x + point.x * crop.width, y: crop.y + (1 - point.y) * crop.height };
  }
  if (rotation === 90) {
    return { x: crop.x + point.y * crop.width, y: crop.y + point.x * crop.height };
  }
  if (rotation === 180) {
    return { x: crop.x + (1 - point.x) * crop.width, y: crop.y + point.y * crop.height };
  }
  return {
    x: crop.x + (1 - point.y) * crop.width,
    y: crop.y + (1 - point.x) * crop.height,
  };
};

const toPdfRect = (
  transform: PageTransform,
  rect: NormalizedRect,
): { readonly height: number; readonly width: number; readonly x: number; readonly y: number } => {
  const corners = [
    toPdfPoint(transform, { x: rect.x, y: rect.y }),
    toPdfPoint(transform, { x: rect.x + rect.width, y: rect.y }),
    toPdfPoint(transform, { x: rect.x, y: rect.y + rect.height }),
    toPdfPoint(transform, { x: rect.x + rect.width, y: rect.y + rect.height }),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { height: Math.max(...ys) - y, width: Math.max(...xs) - x, x, y };
};

const toRgb = (hex: string) => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) return error('EDIT_COLOR_INVALID');
  return rgb(
    Number.parseInt(match[1] ?? '0', 16) / 255,
    Number.parseInt(match[2] ?? '0', 16) / 255,
    Number.parseInt(match[3] ?? '0', 16) / 255,
  );
};

const drawLine = (
  page: PDFPage,
  start: PdfPoint,
  end: PdfPoint,
  color: string,
  thickness: number,
  opacity = 1,
): void => {
  page.drawLine({
    color: toRgb(color),
    end,
    opacity,
    start,
    thickness,
  });
};

const ensureEncodable = (font: PDFFont, value: string): string => {
  const normalized = value.replace(/\r/gu, '').slice(0, 2_000);
  try {
    font.encodeText(normalized);
  } catch {
    return error('EDIT_TEXT_ENCODING_UNSUPPORTED');
  }
  return normalized;
};

const drawTextAnnotation = (
  page: PDFPage,
  transform: PageTransform,
  annotation: TextAnnotation,
  font: PDFFont,
  sharedLayout = false,
): void => {
  const text = sharedLayout ? annotation.text : ensureEncodable(font, annotation.text);
  const pdfRect = toPdfRect(transform, annotation.rect);
  if (annotation.variant !== 'plain') {
    page.drawRectangle({
      borderColor: toRgb(annotation.color),
      borderOpacity: 0.65,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      opacity: 0.92,
      ...pdfRect,
    });
  }
  if (annotation.variant === 'callout') {
    drawLine(
      page,
      toPdfPoint(transform, {
        x: annotation.rect.x,
        y: annotation.rect.y + annotation.rect.height * 0.66,
      }),
      toPdfPoint(transform, {
        x: Math.max(0, annotation.rect.x - 0.08),
        y: Math.min(1, annotation.rect.y + annotation.rect.height + 0.06),
      }),
      annotation.color,
      1.2,
      0.8,
    );
  }
  if (sharedLayout) {
    const layout = layoutTextOverlay(
      annotation,
      transform.displayWidth,
      transform.displayHeight,
      overlayFontMetrics(font),
    );
    if (!layout.fits) return error('EDIT_TEXT_BOX_TOO_SMALL');
    for (const line of layout.lines) {
      if (line.text.length === 0) continue;
      const start = toPdfPoint(transform, {
        x: annotation.rect.x + line.x / transform.displayWidth,
        y: annotation.rect.y + line.baseline / transform.displayHeight,
      });
      page.drawText(line.text, {
        color: toRgb(annotation.color),
        font,
        size: layout.fontSize,
        rotate: degrees(transform.rotation),
        x: start.x,
        y: start.y,
      });
    }
    return;
  }
  const displayWidth = annotation.rect.width * transform.displayWidth;
  const displayHeight = annotation.rect.height * transform.displayHeight;
  let size = Math.max(6, Math.min(annotation.fontSize, displayHeight * 0.72));
  while (size > 6 && font.widthOfTextAtSize(text, size) > Math.max(1, displayWidth - 8))
    size -= 0.5;
  const textWidth = font.widthOfTextAtSize(text, size);
  const alignmentOffset =
    annotation.alignment === 'center'
      ? Math.max(0, (displayWidth - textWidth) / 2)
      : annotation.alignment === 'right'
        ? Math.max(0, displayWidth - textWidth - 4)
        : 4;
  const start = toPdfPoint(transform, {
    x: annotation.rect.x + alignmentOffset / transform.displayWidth,
    y:
      annotation.rect.y +
      annotation.rect.height -
      Math.min(4, displayHeight / 4) / transform.displayHeight,
  });
  page.drawText(text, {
    color: toRgb(annotation.color),
    font,
    lineHeight: size * 1.15,
    maxWidth: Math.max(1, displayWidth - alignmentOffset - 2),
    rotate: degrees(transform.rotation),
    size,
    x: start.x,
    y: start.y,
  });
};

const drawStamp = (
  page: PDFPage,
  transform: PageTransform,
  annotation: StampAnnotation,
  font: PDFFont,
): void => {
  const text = ensureEncodable(font, annotation.text.trim().toUpperCase());
  if (text.length === 0 || text.length > 40) error('EDIT_STAMP_TEXT_INVALID');
  const pdfRect = toPdfRect(transform, annotation.rect);
  const displayWidth = annotation.rect.width * transform.displayWidth;
  const displayHeight = annotation.rect.height * transform.displayHeight;
  let size = Math.max(8, Math.min(22, displayHeight * 0.46));
  while (size > 8 && font.widthOfTextAtSize(text, size) > Math.max(1, displayWidth - 20))
    size -= 0.5;
  const textWidth = font.widthOfTextAtSize(text, size);
  const start = toPdfPoint(transform, {
    x: annotation.rect.x + Math.max(4, (displayWidth - textWidth) / 2) / transform.displayWidth,
    y:
      annotation.rect.y +
      annotation.rect.height / 2 +
      Math.min(size * 0.34, displayHeight / 4) / transform.displayHeight,
  });
  page.drawRectangle({
    borderColor: toRgb(annotation.color),
    borderOpacity: 0.92,
    borderWidth: 2.4,
    color: toRgb(annotation.color),
    opacity: 0.07,
    ...pdfRect,
  });
  page.drawText(text, {
    color: toRgb(annotation.color),
    font,
    rotate: degrees(transform.rotation),
    size,
    x: start.x,
    y: start.y,
  });
};

const drawMarkup = (
  page: PDFPage,
  transform: PageTransform,
  annotation: MarkupAnnotation,
): void => {
  if (annotation.style === 'highlight') {
    page.drawRectangle({
      color: toRgb(annotation.color),
      opacity: annotation.opacity,
      ...toPdfRect(transform, annotation.rect),
    });
    return;
  }
  const y =
    annotation.style === 'underline'
      ? annotation.rect.y + annotation.rect.height
      : annotation.rect.y + annotation.rect.height / 2;
  drawLine(
    page,
    toPdfPoint(transform, { x: annotation.rect.x, y }),
    toPdfPoint(transform, { x: annotation.rect.x + annotation.rect.width, y }),
    annotation.color,
    1.5,
    annotation.opacity,
  );
};

const drawShape = (page: PDFPage, transform: PageTransform, annotation: ShapeAnnotation): void => {
  if (annotation.shape === 'rectangle') {
    page.drawRectangle({
      borderColor: toRgb(annotation.strokeColor),
      borderWidth: annotation.strokeWidth,
      ...(annotation.fillColor === null
        ? {}
        : { color: toRgb(annotation.fillColor), opacity: 0.2 }),
      ...toPdfRect(transform, annotation.rect),
    });
    return;
  }
  if (annotation.shape === 'ellipse') {
    const rect = toPdfRect(transform, annotation.rect);
    page.drawEllipse({
      borderColor: toRgb(annotation.strokeColor),
      borderWidth: annotation.strokeWidth,
      x: rect.x + rect.width / 2,
      xScale: rect.width / 2,
      y: rect.y + rect.height / 2,
      yScale: rect.height / 2,
      ...(annotation.fillColor === null
        ? {}
        : { color: toRgb(annotation.fillColor), opacity: 0.2 }),
    });
    return;
  }
  const from = toPdfPoint(
    transform,
    annotation.from ?? { x: annotation.rect.x, y: annotation.rect.y + annotation.rect.height },
  );
  const to = toPdfPoint(
    transform,
    annotation.to ?? { x: annotation.rect.x + annotation.rect.width, y: annotation.rect.y },
  );
  drawLine(page, from, to, annotation.strokeColor, annotation.strokeWidth);
  if (annotation.shape === 'arrow') {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = Math.max(6, annotation.strokeWidth * 4);
    for (const offset of [-Math.PI / 7, Math.PI / 7]) {
      drawLine(
        page,
        to,
        {
          x: to.x - Math.cos(angle + offset) * size,
          y: to.y - Math.sin(angle + offset) * size,
        },
        annotation.strokeColor,
        annotation.strokeWidth,
      );
    }
  }
};

const drawComment = (
  page: PDFPage,
  transform: PageTransform,
  annotation: CommentAnnotation,
  font: PDFFont,
): void => {
  drawTextAnnotation(
    page,
    transform,
    {
      alignment: 'left',
      color: annotation.color,
      fontSize: 9,
      id: annotation.id,
      kind: 'text',
      pageId: annotation.pageId,
      rect: annotation.rect,
      text: `${annotation.status === 'resolved' ? 'Resolved' : 'Comment'} - ${annotation.author}\n${annotation.text}`,
      variant: 'callout',
    },
    font,
  );
};

const drawUtilityMark = (
  page: PDFPage,
  transform: PageTransform,
  annotation: UtilityMarkAnnotation,
  font: PDFFont,
): void => {
  if (annotation.mark === 'checkmark') {
    const first = toPdfPoint(transform, {
      x: annotation.rect.x + annotation.rect.width * 0.12,
      y: annotation.rect.y + annotation.rect.height * 0.55,
    });
    const middle = toPdfPoint(transform, {
      x: annotation.rect.x + annotation.rect.width * 0.42,
      y: annotation.rect.y + annotation.rect.height * 0.82,
    });
    const last = toPdfPoint(transform, {
      x: annotation.rect.x + annotation.rect.width * 0.9,
      y: annotation.rect.y + annotation.rect.height * 0.16,
    });
    drawLine(page, first, middle, annotation.color, 2.5);
    drawLine(page, middle, last, annotation.color, 2.5);
    return;
  }
  drawTextAnnotation(
    page,
    transform,
    {
      alignment: 'center',
      color: annotation.color,
      fontSize: 11,
      id: annotation.id,
      kind: 'text',
      pageId: annotation.pageId,
      rect: annotation.rect,
      text: annotation.text,
      variant: 'plain',
    },
    font,
  );
};

const drawVisualSignature = async (
  document: PDFDocument,
  page: PDFPage,
  transform: PageTransform,
  annotation: VisualSignatureAnnotation,
): Promise<void> => {
  const { appearance, rect } = annotation;
  if (appearance.kind === 'typed') {
    const layout = await layoutScriptSignature(
      appearance.text,
      annotation.label,
      rect,
      transform.displayWidth,
      transform.displayHeight,
    );
    const font = await embedSignatureFont(document);
    const anchor = toPdfPoint(transform, {
      x: rect.x + layout.x / transform.displayWidth,
      y: rect.y + layout.baseline / transform.displayHeight,
    });
    page.drawText(appearance.text, {
      font,
      color: toRgb(appearance.color),
      size: layout.fontSize,
      rotate: degrees(transform.rotation),
      x: anchor.x,
      y: anchor.y,
    });
    return;
  }
  if (appearance.kind === 'drawn') {
    for (let index = 1; index < appearance.points.length; index += 1) {
      const previous = appearance.points[index - 1];
      const current = appearance.points[index];
      if (previous === undefined || current === undefined) continue;
      drawLine(
        page,
        toPdfPoint(transform, {
          x: rect.x + previous.x * rect.width,
          y: rect.y + previous.y * rect.height,
        }),
        toPdfPoint(transform, {
          x: rect.x + current.x * rect.width,
          y: rect.y + current.y * rect.height,
        }),
        appearance.color,
        1.8,
      );
    }
    return;
  }
  const image =
    appearance.mimeType === 'image/png'
      ? await document.embedPng(appearance.bytes)
      : await document.embedJpg(appearance.bytes);
  const anchor = toPdfPoint(transform, { x: rect.x, y: rect.y + rect.height });
  page.drawImage(image, {
    height: rect.height * transform.displayHeight,
    rotate: degrees(transform.rotation),
    width: rect.width * transform.displayWidth,
    x: anchor.x,
    y: anchor.y,
  });
};

const fillForms = (document: PDFDocument, values: readonly FormValue[], flatten: boolean): void => {
  const form = document.getForm();
  for (const value of values) {
    const field = form.getField(value.fieldName);
    // FORM-001/002: widget controls are convenience, not authority for export.
    if (field.isReadOnly()) error('EDIT_FORM_READ_ONLY');
    if (value.type === 'text' && field instanceof PDFTextField && typeof value.value === 'string') {
      const maximumLength = field.getMaxLength();
      if (maximumLength !== undefined && value.value.length > maximumLength)
        error('EDIT_FORM_VALUE_INVALID');
      field.setText(value.value);
    } else if (
      value.type === 'checkbox' &&
      field instanceof PDFCheckBox &&
      typeof value.value === 'boolean'
    ) {
      if (value.value) field.check();
      else field.uncheck();
    } else if (
      value.type === 'radio' &&
      field instanceof PDFRadioGroup &&
      typeof value.value === 'string'
    ) {
      if (value.value === '') field.clear();
      else {
        if (!field.getOptions().includes(value.value)) error('EDIT_FORM_VALUE_INVALID');
        field.select(value.value);
      }
    } else if (
      value.type === 'dropdown' &&
      field instanceof PDFDropdown &&
      typeof value.value === 'string'
    ) {
      if (value.value === '') field.clear();
      else {
        // PDFDropdown.select otherwise enables editing for unknown options.
        if (!field.getOptions().includes(value.value)) error('EDIT_FORM_VALUE_INVALID');
        field.select(value.value);
      }
    } else {
      error('EDIT_FORM_TYPE_UNSUPPORTED');
    }
  }
  form.updateFieldAppearances();
  if (flatten) form.flatten({ updateFieldAppearances: true });
};

const isDirectPlan = (
  document: PDFDocument,
  source: AssemblySource,
  pages: readonly EditedPagePlan[],
): boolean =>
  pages.length === document.getPageCount() &&
  pages.every(
    (page, index) =>
      page.sourceId === source.sourceId && page.sourcePageIndex === index && page.rotation === 0,
  );

const verifyForms = (
  document: PDFDocument,
  values: readonly FormValue[],
  flattened: boolean,
): void => {
  const form = document.getForm();
  if (flattened) {
    if (form.getFields().length !== 0) error('EDIT_FLATTEN_VERIFY_FAILED');
    return;
  }
  for (const value of values) {
    const field = form.getField(value.fieldName);
    const actual =
      field instanceof PDFTextField
        ? field.getText()
        : field instanceof PDFCheckBox
          ? field.isChecked()
          : field instanceof PDFRadioGroup
            ? (field.getSelected() ?? '')
            : field instanceof PDFDropdown
              ? (field.getSelected()[0] ?? '')
              : error('EDIT_FORM_VERIFY_FAILED');
    if (actual !== value.value) error('EDIT_FORM_VERIFY_FAILED');
  }
};

export type EditedPdfWarningCode = 'ANNOTATIONS_FLATTENED' | 'ADDED_CONTENT_UNTAGGED';
export interface EditedPdfResult {
  readonly bytes: Uint8Array;
  readonly warnings: readonly EditedPdfWarningCode[];
}

export const exportEditedPdfResult = async (
  request: EditedPdfRequest,
): Promise<EditedPdfResult> => {
  const firstSource = request.sources[0];
  if (firstSource === undefined) return error('EDIT_SOURCE_MISSING');
  const directCandidate =
    request.sources.length === 1
      ? await PDFDocument.load(firstSource.bytes, { updateMetadata: false })
      : null;
  const direct =
    directCandidate !== null && isDirectPlan(directCandidate, firstSource, request.pages);
  if (request.formValues.length > 0 && !direct) return error('EDIT_FORM_PAGE_PLAN_UNSUPPORTED');
  const document = direct
    ? directCandidate
    : await PDFDocument.load(await assemblePdf(request.sources, request.pages), {
        updateMetadata: false,
      });
  const outlineSnapshot = snapshotOutlineStructures(document);
  const tagSnapshot = await snapshotTagStructures(document);
  if (
    tagSnapshot !== null &&
    request.options.flattenForms &&
    document.getForm().getFields().length > 0
  )
    return error('EDIT_TAGGED_FORM_FLATTEN_UNSUPPORTED');
  if (request.formValues.length > 0 || request.options.flattenForms) {
    fillForms(document, request.formValues, request.options.flattenForms);
  }
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const pageIndexById = new Map(request.pages.map(({ pageId }, index) => [pageId, index]));
  for (const annotation of request.annotations) {
    const pageIndex = pageIndexById.get(annotation.pageId);
    if (pageIndex === undefined) return error('EDIT_PAGE_MISSING');
    const page = document.getPage(pageIndex);
    const transform = pageTransform(page);
    if (annotation.kind === 'text') drawTextAnnotation(page, transform, annotation, bodyFont, true);
    else if (annotation.kind === 'markup') drawMarkup(page, transform, annotation);
    else if (annotation.kind === 'shape') drawShape(page, transform, annotation);
    else if (annotation.kind === 'comment') drawComment(page, transform, annotation, bodyFont);
    else if (annotation.kind === 'stamp') drawStamp(page, transform, annotation, bodyFont);
    else if (annotation.kind === 'utility-mark')
      drawUtilityMark(page, transform, annotation, bodyFont);
    else if (annotation.kind === 'visual-signature')
      await drawVisualSignature(document, page, transform, annotation);
    else {
      for (let index = 1; index < annotation.points.length; index += 1) {
        const previous = annotation.points[index - 1];
        const current = annotation.points[index];
        if (previous === undefined || current === undefined) continue;
        drawLine(
          page,
          toPdfPoint(transform, previous),
          toPdfPoint(transform, current),
          annotation.color,
          annotation.strokeWidth,
        );
      }
    }
  }
  let bytes: Uint8Array;
  try {
    bytes = await document.save({
      addDefaultPage: false,
      updateFieldAppearances: false,
      useObjectStreams: true,
    });
  } catch {
    return error('EDIT_EXPORT_FAILED');
  }
  const verification = await PDFDocument.load(bytes, { updateMetadata: false });
  if (verification.getPageCount() !== request.pages.length) return error('EDIT_PAGE_VERIFY_FAILED');
  assertOutlineStructuresPreserved(outlineSnapshot, verification);
  await assertTagStructuresPreserved(tagSnapshot, verification);
  if (request.formValues.length > 0 || request.options.flattenForms) {
    verifyForms(verification, request.formValues, request.options.flattenForms);
  }
  const warnings: EditedPdfWarningCode[] = [];
  if (request.annotations.length > 0) {
    warnings.push('ANNOTATIONS_FLATTENED');
    if (tagSnapshot !== null) warnings.push('ADDED_CONTENT_UNTAGGED');
  }
  return { bytes, warnings: Object.freeze(warnings) };
};

export const exportEditedPdf = async (request: EditedPdfRequest): Promise<Uint8Array> =>
  (await exportEditedPdfResult(request)).bytes;
