import { LOCAL_PDF_LIMITS, validatePdfImagePixelCount } from '@pdfmason/pdf-engine/browser';

export const PRINT_LIMITS = Object.freeze({
  maximumPages: 50,
  maximumRangeCharacters: 1_000,
  maximumRetainedPixels: 50_000_000,
});

export const validatePrintPixelBudget = (
  pages: readonly { readonly height: number; readonly width: number }[],
  resolution: number,
): void => {
  if (resolution !== 2 && resolution !== 3) throw new Error('PRINT_OPTIONS_INVALID');
  if (pages.length < 1 || pages.length > PRINT_LIMITS.maximumPages)
    throw new Error('PRINT_PIXEL_BUDGET');
  for (const page of pages) {
    try {
      validatePdfImagePixelCount(page.width, page.height, resolution);
    } catch {
      throw new Error('PRINT_PIXEL_BUDGET');
    }
  }
  const pixels = pages.reduce(
    (total, page) =>
      total + Math.floor(page.width * resolution) * Math.floor(page.height * resolution),
    0,
  );
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > PRINT_LIMITS.maximumRetainedPixels)
    throw new Error('PRINT_PIXEL_BUDGET');
};

export type PrintResolution = 2 | 3;

export interface PrintOptions {
  readonly pageRange: string;
  readonly resolution: PrintResolution;
}

export const isPrintOptions = (value: unknown): value is PrintOptions => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 2 &&
    typeof candidate.pageRange === 'string' &&
    (candidate.resolution === 2 || candidate.resolution === 3)
  );
};

export const resolvePrintPageIndices = (
  options: PrintOptions,
  pageCount: number,
): readonly number[] => {
  if (
    !isPrintOptions(options) ||
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > LOCAL_PDF_LIMITS.maximumPages
  )
    throw new Error('PRINT_OPTIONS_INVALID');
  if (
    options.pageRange.length === 0 ||
    options.pageRange.length > PRINT_LIMITS.maximumRangeCharacters
  )
    throw new Error('PRINT_RANGE_INVALID');
  if (options.pageRange.trim().toLowerCase() === 'all') {
    if (pageCount > PRINT_LIMITS.maximumPages) throw new Error('PRINT_PAGE_LIMIT');
    return Object.freeze(Array.from({ length: pageCount }, (_, index) => index));
  }

  const parts = options.pageRange.split(',');
  if (parts.length > 100) throw new Error('PRINT_RANGE_INVALID');
  const selected = new Set<number>();
  for (const part of parts) {
    const match = /^\s*([1-9]\d{0,2})\s*(?:-\s*([1-9]\d{0,2})\s*)?$/u.exec(part);
    if (match === null) throw new Error('PRINT_RANGE_INVALID');
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start > end || end > pageCount) throw new Error('PRINT_RANGE_INVALID');
    for (let page = start; page <= end; page += 1) {
      if (selected.has(page)) throw new Error('PRINT_RANGE_INVALID');
      selected.add(page);
      if (selected.size > PRINT_LIMITS.maximumPages) throw new Error('PRINT_PAGE_LIMIT');
    }
  }
  return Object.freeze([...selected].sort((left, right) => left - right).map((page) => page - 1));
};
