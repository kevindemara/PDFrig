import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import {
  isPdfDecorationOptions,
  resolveDecorationPages,
  type PdfDecorationOptions,
} from './decoration-options.js';
import {
  decorationAlignedX,
  decorationFontSupports,
  decorationTextAdvance,
  normalizeDecorationText,
  substituteDecorationPageTokens,
} from './decoration-layout.js';
import { decorationReviewGeometrySupported } from './decoration-placement.js';

export interface DecorationTextArea {
  readonly kind: 'header' | 'footer';
  /** Normalized top-origin visible-page coordinates, including a two-point guard. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

// One empty, content-free font context. No source PDF is parsed or retained here.
let metricsFont: Promise<PDFFont> | undefined;
const getMetricsFont = (): Promise<PDFFont> => {
  metricsFont ??= PDFDocument.create().then((document) =>
    document.embedFont(StandardFonts.Helvetica),
  );
  return metricsFont;
};

/** EDIT-006: metric rectangles, not glyph silhouettes or a safe-placement verdict. */
export const measureDecorationTextAreas = async (
  page: { readonly width: number; readonly height: number },
  options: PdfDecorationOptions,
  pageNumber: number,
  pageCount: number,
): Promise<readonly DecorationTextArea[]> => {
  if (!isPdfDecorationOptions(options)) throw new Error('DECORATION_OPTIONS_INVALID');
  const selectedPages = resolveDecorationPages(options, pageCount);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount)
    throw new Error('DECORATION_PAGE_RANGE_INVALID');
  if (!selectedPages.includes(pageNumber)) return [];
  if (!decorationReviewGeometrySupported(page.width, page.height))
    throw new Error('DECORATION_PAGE_BOX_UNSUPPORTED');
  if (options.header === null && options.footer === null) return [];
  const font = await getMetricsFont();
  const areas: DecorationTextArea[] = [];
  for (const [kind, decoration] of [
    ['header', options.header],
    ['footer', options.footer],
  ] as const) {
    if (decoration === null) continue;
    const text = normalizeDecorationText(
      substituteDecorationPageTokens(decoration.text, pageNumber, pageCount),
    );
    let width: number;
    try {
      if (!decorationFontSupports(font, text)) throw new Error('Unsupported encoding');
      font.encodeText(text);
      width = decorationTextAdvance(font, text, decoration.fontSize);
    } catch {
      throw new Error('DECORATION_TEXT_ENCODING_UNSUPPORTED');
    }
    const ascent = font.heightAtSize(decoration.fontSize, { descender: false });
    const descent = font.heightAtSize(decoration.fontSize) - ascent;
    if (
      width <= 0 ||
      width > page.width - 2 * options.marginPoints ||
      page.height <= 2 * options.marginPoints + ascent + descent ||
      (kind === 'header' ? ascent : descent) > options.marginPoints
    )
      throw new Error('DECORATION_TEXT_DOES_NOT_FIT');
    const left =
      decorationAlignedX(decoration.alignment, page.width, options.marginPoints, width) *
      page.width;
    const baseline = kind === 'header' ? options.marginPoints : page.height - options.marginPoints;
    areas.push(
      Object.freeze({
        kind,
        left: Math.max(0, left - 2) / page.width,
        right: Math.min(page.width, left + width + 2) / page.width,
        // Retain the broad vertical guard for accents/descenders; narrow only by advance width.
        top: Math.max(0, baseline - Math.max(ascent, decoration.fontSize) - 2) / page.height,
        bottom:
          Math.min(page.height, baseline + Math.max(descent, decoration.fontSize * 0.4) + 2) /
          page.height,
      }),
    );
  }
  return Object.freeze(areas);
};
