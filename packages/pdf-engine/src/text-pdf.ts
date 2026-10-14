import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { BLANK_PAGE_SIZES } from './utilities.js';

/** CONV-005: fixed typography avoids an unapproved font or substitution policy. */
export const TEXT_PDF_LIMITS = Object.freeze({
  maximumBytes: 1_048_576,
  fontSize: 12,
  margin: 36,
  lineHeight: 15,
  tabColumns: 4,
});
export interface TextPdfOptions {
  readonly pageSize: 'a4' | 'letter';
}
export interface TextPdfLayout {
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly pages: readonly (readonly string[])[];
}
export const isTextPdfOptions = (value: unknown): value is TextPdfOptions => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 1 &&
    Object.hasOwn(candidate, 'pageSize') &&
    (candidate.pageSize === 'a4' || candidate.pageSize === 'letter')
  );
};
export const isTextPdfBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array &&
  value.byteLength > 0 &&
  value.byteLength <= TEXT_PDF_LIMITS.maximumBytes;

/** Normalizes only disclosed layout controls, never trims or substitutes glyphs. */
export const layoutTextPdf = (bytes: Uint8Array, options: TextPdfOptions): TextPdfLayout => {
  if (!isTextPdfOptions(options)) throw new Error('UTILITY_TEXT_OPTIONS_INVALID');
  if (!isTextPdfBytes(bytes)) throw new Error('UTILITY_TEXT_SIZE_LIMIT');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('UTILITY_TEXT_ENCODING_INVALID');
  }
  if (/[^\x20-\x7e\t\r\n]/u.test(text)) throw new Error('UTILITY_TEXT_CHARACTER_UNSUPPORTED');
  const { width, height } = BLANK_PAGE_SIZES[options.pageSize];
  const columns = Math.floor(
    (width - 2 * TEXT_PDF_LIMITS.margin) / (TEXT_PDF_LIMITS.fontSize * 0.6),
  );
  const rows =
    Math.floor(
      (height - 2 * TEXT_PDF_LIMITS.margin - TEXT_PDF_LIMITS.fontSize) / TEXT_PDF_LIMITS.lineHeight,
    ) + 1;
  const lines: string[] = [];
  let line = '';
  let sourceColumn = 0;
  const emit = (): void => {
    if (lines.length >= rows * LOCAL_PDF_LIMITS.maximumPages)
      throw new Error('UTILITY_TEXT_PAGE_LIMIT');
    lines.push(line);
    line = '';
  };
  const append = (character: string): void => {
    if (line.length === columns) emit();
    line += character;
    sourceColumn += 1;
  };
  for (const character of text.replace(/\r\n?/gu, '\n')) {
    if (character === '\n') {
      emit();
      sourceColumn = 0;
    } else if (character === '\t') {
      const spaces = TEXT_PDF_LIMITS.tabColumns - (sourceColumn % TEXT_PDF_LIMITS.tabColumns);
      for (let index = 0; index < spaces; index += 1) append(' ');
    } else append(character);
  }
  emit();
  const pages: (readonly string[])[] = [];
  for (let index = 0; index < lines.length; index += rows)
    pages.push(Object.freeze(lines.slice(index, index + rows)));
  return Object.freeze({ columns, rows, width, height, pages: Object.freeze(pages) });
};

export const textToPdf = async (
  bytes: Uint8Array,
  options: TextPdfOptions,
): Promise<Uint8Array> => {
  // Capture bytes/options into a complete bounded plan before the first await.
  const layout = layoutTextPdf(bytes, options);
  try {
    const document = await PDFDocument.create({ updateMetadata: false });
    const font = await document.embedFont(StandardFonts.Courier);
    for (const lines of layout.pages) {
      const page = document.addPage([layout.width, layout.height]);
      for (const [index, line] of lines.entries()) {
        if (
          font.widthOfTextAtSize(line, TEXT_PDF_LIMITS.fontSize) >
          layout.width - 2 * TEXT_PDF_LIMITS.margin + 0.01
        )
          throw new Error('layout');
        // Even whitespace-only lines occupy their planned row; no source trimming.
        if (line.length > 0)
          page.drawText(line, {
            font,
            size: TEXT_PDF_LIMITS.fontSize,
            x: TEXT_PDF_LIMITS.margin,
            y:
              layout.height -
              TEXT_PDF_LIMITS.margin -
              TEXT_PDF_LIMITS.fontSize -
              index * TEXT_PDF_LIMITS.lineHeight,
          });
      }
    }
    const output = await document.save({ addDefaultPage: false, useObjectStreams: false });
    if (output.byteLength > LOCAL_PDF_LIMITS.maximumBytes) throw new Error('output limit');
    const reopened = await PDFDocument.load(output, { updateMetadata: false });
    if (reopened.getPageCount() !== layout.pages.length) throw new Error('count');
    for (const [index, page] of reopened.getPages().entries()) {
      const box = page.getMediaBox();
      if (
        box.x !== 0 ||
        box.y !== 0 ||
        box.width !== layout.width ||
        box.height !== layout.height ||
        JSON.stringify(page.getCropBox()) !== JSON.stringify(box) ||
        page.getRotation().angle !== 0 ||
        (page.node.Annots()?.size() ?? 0) !== 0 ||
        (layout.pages[index]?.some((line) => line.length > 0) === true &&
          page.node.Contents() === undefined)
      )
        throw new Error('structure');
    }
    return output;
  } catch {
    throw new Error('UTILITY_TEXT_VERIFICATION_FAILED');
  }
};
