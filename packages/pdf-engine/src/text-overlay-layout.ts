import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import type { TextAnnotation } from '@pdfmason/editor-core';

export interface OverlayFontMetrics {
  readonly width: (text: string, size: number) => number;
  readonly ascent: (size: number) => number;
  readonly height: (size: number) => number;
}
export interface TextOverlayLayout {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly fits: boolean;
  readonly lines: readonly {
    readonly text: string;
    readonly x: number;
    readonly baseline: number;
    readonly width: number;
  }[];
}

export const overlayFontMetrics = (font: PDFFont): OverlayFontMetrics => ({
  // Standard-font drawText emits Tj without pair-kerning adjustments. The fork's
  // whole-string width includes kerning, so sum individual glyph advances instead.
  width: (text, size) =>
    Array.from(text).reduce((sum, glyph) => sum + font.widthOfTextAtSize(glyph, size), 0),
  ascent: (size) => font.heightAtSize(size, { descender: false }),
  height: (size) => font.heightAtSize(size),
});
let metricsPromise: Promise<OverlayFontMetrics> | undefined;
// Cache font metrics only, never document content or user text.
export const getOverlayFontMetrics = (): Promise<OverlayFontMetrics> => {
  metricsPromise ??= PDFDocument.create().then(async (document) =>
    overlayFontMetrics(await document.embedFont(StandardFonts.Helvetica)),
  );
  return metricsPromise;
};

// The locked fork substitutes unknown glyphs; explicitly reject them before drawing.
const supportedText =
  /^[\x20-\x7e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178\n]*$/u;

// EDIT-001: one top-origin, point-based layout shared by SVG preview and PDF output.
export const layoutTextOverlay = (
  annotation: TextAnnotation,
  pageWidth: number,
  pageHeight: number,
  metrics: OverlayFontMetrics,
): TextOverlayLayout => {
  const text = annotation.text.replace(/\r\n?/gu, '\n');
  if (text.length > 2_000 || !supportedText.test(text))
    throw new Error('EDIT_TEXT_ENCODING_UNSUPPORTED');
  if (
    ![pageWidth, pageHeight, annotation.fontSize].every(Number.isFinite) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    annotation.fontSize < 6 ||
    annotation.fontSize > 96
  )
    throw new Error('EDIT_TEXT_LAYOUT_INVALID');
  const width = annotation.rect.width * pageWidth;
  const height = annotation.rect.height * pageHeight;
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error('EDIT_TEXT_LAYOUT_INVALID');
  const available = Math.max(0, width - 8);
  const size = annotation.fontSize;
  const lines: string[] = [];
  for (const paragraph of text === '' ? [] : text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > 0) {
      let count = 0;
      let breakAt = 0;
      while (
        count < remaining.length &&
        metrics.width(remaining.slice(0, count + 1), size) <= available
      ) {
        if (remaining[count] === ' ') breakAt = count + 1;
        count += 1;
      }
      if (count === 0) count = 1;
      else if (count < remaining.length && breakAt > 0) count = breakAt;
      lines.push(remaining.slice(0, count));
      remaining = remaining.slice(count);
    }
  }
  const ascent = metrics.ascent(size);
  const lineHeight = Math.max(size * 1.2, metrics.height(size));
  const positioned = lines.map((line, index) => {
    const lineWidth = metrics.width(line, size);
    const offset =
      annotation.alignment === 'center'
        ? (available - lineWidth) / 2
        : annotation.alignment === 'right'
          ? available - lineWidth
          : 0;
    return {
      text: line,
      width: lineWidth,
      x: 4 + Math.max(0, offset),
      baseline: 4 + ascent + index * lineHeight,
    };
  });
  const last = positioned.at(-1);
  return {
    width,
    height,
    fontSize: size,
    lines: positioned,
    fits:
      positioned.every((line) => line.width <= available + 1e-6) &&
      (last === undefined || last.baseline + metrics.height(size) - ascent <= height - 4 + 1e-6),
  };
};
