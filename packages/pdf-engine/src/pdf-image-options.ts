import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { LOCAL_UTILITY_LIMITS } from './utilities.js';

export type PdfImageFormat = 'jpeg' | 'png';
export type PdfImageScale = 1 | 2 | 3;
export type PdfImageJpegQuality = 0.72 | 0.85 | 0.92;

export interface PdfImageRenderOptions {
  readonly format: PdfImageFormat;
  readonly jpegQuality: PdfImageJpegQuality;
  readonly pageRange: string;
  readonly scale: PdfImageScale;
  readonly transparentBackground: boolean;
}

export const isPdfImageRenderOptions = (value: unknown): value is PdfImageRenderOptions => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 5 &&
    (candidate.format === 'jpeg' || candidate.format === 'png') &&
    (candidate.jpegQuality === 0.72 ||
      candidate.jpegQuality === 0.85 ||
      candidate.jpegQuality === 0.92) &&
    typeof candidate.pageRange === 'string' &&
    (candidate.scale === 1 || candidate.scale === 2 || candidate.scale === 3) &&
    typeof candidate.transparentBackground === 'boolean' &&
    (candidate.format === 'png' || !candidate.transparentBackground)
  );
};

export const resolvePdfImagePages = (
  options: PdfImageRenderOptions,
  pageCount: number,
): readonly number[] => {
  if (
    !isPdfImageRenderOptions(options) ||
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > LOCAL_PDF_LIMITS.maximumPages
  )
    throw new Error('UTILITY_RENDER_OPTIONS_INVALID');
  if (options.pageRange.length === 0 || options.pageRange.length > 1_000)
    throw new Error('UTILITY_RENDER_PAGE_RANGE_INVALID');
  if (options.pageRange.trim().toLowerCase() === 'all') {
    if (pageCount > LOCAL_UTILITY_LIMITS.maximumRenderedPages)
      throw new Error('UTILITY_RENDER_PAGE_LIMIT');
    return Object.freeze(Array.from({ length: pageCount }, (_, index) => index));
  }
  const parts = options.pageRange.split(',');
  if (parts.length > 100) throw new Error('UTILITY_RENDER_PAGE_RANGE_INVALID');
  const selected = new Set<number>();
  for (const part of parts) {
    const match = /^\s*([1-9]\d{0,2})\s*(?:-\s*([1-9]\d{0,2})\s*)?$/u.exec(part);
    if (match === null) throw new Error('UTILITY_RENDER_PAGE_RANGE_INVALID');
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start > end || end > pageCount) throw new Error('UTILITY_RENDER_PAGE_RANGE_INVALID');
    for (let page = start; page <= end; page += 1) {
      if (selected.has(page)) throw new Error('UTILITY_RENDER_PAGE_RANGE_INVALID');
      selected.add(page);
      if (selected.size > LOCAL_UTILITY_LIMITS.maximumRenderedPages)
        throw new Error('UTILITY_RENDER_PAGE_LIMIT');
    }
  }
  return Object.freeze([...selected].sort((left, right) => left - right).map((page) => page - 1));
};

export const validatePdfImagePixelCount = (width: number, height: number, scale: number): void => {
  const scaledWidth = Math.floor(width * scale);
  const scaledHeight = Math.floor(height * scale);
  if (
    (scale !== 1 && scale !== 2 && scale !== 3) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    scaledWidth < 1 ||
    scaledHeight < 1 ||
    scaledWidth > LOCAL_UTILITY_LIMITS.maximumRenderedDimension ||
    scaledHeight > LOCAL_UTILITY_LIMITS.maximumRenderedDimension ||
    scaledWidth * scaledHeight > LOCAL_UTILITY_LIMITS.maximumRenderedPixels
  )
    throw new Error('UTILITY_RENDER_PIXELS_LIMIT');
};
