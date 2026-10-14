import { LOCAL_PDF_LIMITS } from './browser-document.js';

/** EDIT-006 / EDIT-007: shared UI, worker-boundary, and engine contract. */
export type DecorationAlignment = 'center' | 'left' | 'right';
export type DecorationPageSelection = 'all' | 'even' | 'first' | 'odd' | 'custom';
export interface RepeatingTextDecoration {
  readonly alignment: DecorationAlignment;
  readonly color: string;
  readonly fontSize: number;
  readonly text: string;
}
export interface WatermarkDecoration {
  readonly color: string;
  readonly fontSize: number;
  readonly opacity: number;
  readonly rotation: number;
  readonly text: string;
}
export interface PdfDecorationOptions {
  readonly footer: RepeatingTextDecoration | null;
  readonly header: RepeatingTextDecoration | null;
  readonly marginPoints: number;
  readonly pageSelection: DecorationPageSelection;
  readonly pageRange?: string;
  readonly watermark: WatermarkDecoration | null;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const number = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = (value: unknown): boolean =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
const text = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const repeating = (value: unknown): value is RepeatingTextDecoration =>
  record(value) &&
  onlyKeys(value, ['alignment', 'color', 'fontSize', 'text']) &&
  (value.alignment === 'center' || value.alignment === 'left' || value.alignment === 'right') &&
  color(value.color) &&
  number(value.fontSize, 6, 24) &&
  text(value.text);
const watermark = (value: unknown): value is WatermarkDecoration =>
  record(value) &&
  onlyKeys(value, ['color', 'fontSize', 'opacity', 'rotation', 'text']) &&
  color(value.color) &&
  number(value.fontSize, 12, 120) &&
  number(value.opacity, 0.05, 0.35) &&
  number(value.rotation, -60, 60) &&
  text(value.text);

export const parseDecorationPageRange = (input: string, pageCount: number): readonly number[] => {
  const invalid = (): never => {
    throw new Error('DECORATION_PAGE_RANGE_INVALID');
  };
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.length > 1_000 ||
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > LOCAL_PDF_LIMITS.maximumPages
  )
    return invalid();
  const parts = input.split(',');
  if (parts.length > 100) return invalid();
  const pages = new Set<number>();
  for (const part of parts) {
    const match = /^\s*([1-9]\d{0,2})\s*(?:-\s*([1-9]\d{0,2})\s*)?$/u.exec(part);
    if (match === null) return invalid();
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start > end || end > pageCount) return invalid();
    for (let page = start; page <= end; page += 1) {
      if (pages.has(page)) return invalid();
      pages.add(page);
    }
  }
  return Object.freeze([...pages].sort((left, right) => left - right));
};

export const isPdfDecorationOptions = (value: unknown): value is PdfDecorationOptions => {
  if (
    !record(value) ||
    !onlyKeys(value, [
      'footer',
      'header',
      'marginPoints',
      'pageSelection',
      'pageRange',
      'watermark',
    ]) ||
    (value.footer !== null && !repeating(value.footer)) ||
    (value.header !== null && !repeating(value.header)) ||
    (value.watermark !== null && !watermark(value.watermark)) ||
    (value.footer === null && value.header === null && value.watermark === null) ||
    !number(value.marginPoints, 12, 72)
  )
    return false;
  if (value.pageSelection === 'custom') {
    if (typeof value.pageRange !== 'string') return false;
    try {
      parseDecorationPageRange(value.pageRange, LOCAL_PDF_LIMITS.maximumPages);
      return true;
    } catch {
      return false;
    }
  }
  return (
    value.pageRange === undefined &&
    (value.pageSelection === 'all' ||
      value.pageSelection === 'even' ||
      value.pageSelection === 'first' ||
      value.pageSelection === 'odd')
  );
};

export const resolveDecorationPages = (
  options: PdfDecorationOptions,
  pageCount: number,
): readonly number[] => {
  if (!isPdfDecorationOptions(options)) throw new Error('DECORATION_OPTIONS_INVALID');
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > LOCAL_PDF_LIMITS.maximumPages)
    throw new Error('DECORATION_PAGE_LIMIT');
  if (options.pageSelection === 'custom')
    return parseDecorationPageRange(options.pageRange ?? '', pageCount);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) =>
      options.pageSelection === 'all' ||
      (options.pageSelection === 'first' && page === 1) ||
      (options.pageSelection === 'even' && page % 2 === 0) ||
      (options.pageSelection === 'odd' && page % 2 === 1),
  );
  if (pages.length === 0) throw new Error('DECORATION_NO_PAGES');
  return Object.freeze(pages);
};
