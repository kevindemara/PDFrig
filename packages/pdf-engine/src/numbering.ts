import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
} from '@cantoo/pdf-lib';

import {
  validatedDecorationPageTransform,
  drawRepeatingText,
  loadPageModificationDocument,
  savePageModificationDocument,
  type DecorationAlignment,
  type RepeatingTextDecoration,
} from './decorations.js';

export type PageLabelStyle =
  'decimal' | 'letters-lower' | 'letters-upper' | 'roman-lower' | 'roman-upper';
export type NumberingPosition = 'footer' | 'header';

interface NumberingBaseOptions {
  readonly alignment: DecorationAlignment;
  readonly color: string;
  readonly endPage: number | null;
  readonly fontSize: number;
  readonly marginPoints: number;
  readonly position: NumberingPosition;
  readonly startPage: number;
}

export interface PageLabelNumberingOptions extends NumberingBaseOptions {
  readonly kind: 'page-labels';
  readonly prefix: string;
  readonly replaceExistingLabels: boolean;
  readonly startNumber: number;
  readonly style: PageLabelStyle;
}

export interface BatesNumberingOptions extends NumberingBaseOptions {
  readonly digits: number;
  readonly kind: 'bates';
  readonly prefix: string;
  readonly startNumber: number;
  readonly suffix: string;
}

export type PdfNumberingOptions = BatesNumberingOptions | PageLabelNumberingOptions;

export interface PdfNumberingReport {
  readonly appliedPages: number;
  readonly firstIdentifier: string;
  readonly kind: PdfNumberingOptions['kind'];
  readonly lastIdentifier: string;
  readonly operationVersion: '1.0.3';
  readonly range: { readonly endPage: number; readonly startPage: number };
  readonly sourcePages: number;
}

export interface PdfNumberingResult {
  readonly bytes: Uint8Array;
  readonly report: PdfNumberingReport;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isIntegerBetween = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isBaseOptions = (value: Record<string, unknown>): boolean =>
  (value.alignment === 'center' || value.alignment === 'left' || value.alignment === 'right') &&
  typeof value.color === 'string' &&
  /^#[0-9a-f]{6}$/iu.test(value.color) &&
  (value.endPage === null || isIntegerBetween(value.endPage, 1, 500)) &&
  isIntegerBetween(value.fontSize, 6, 24) &&
  isIntegerBetween(value.marginPoints, 12, 72) &&
  (value.position === 'footer' || value.position === 'header') &&
  isIntegerBetween(value.startPage, 1, 500);

const isPageLabelStyle = (value: unknown): value is PageLabelStyle =>
  value === 'decimal' ||
  value === 'letters-lower' ||
  value === 'letters-upper' ||
  value === 'roman-lower' ||
  value === 'roman-upper';

const validOptions = (value: unknown): value is PdfNumberingOptions => {
  if (!isRecord(value) || !isBaseOptions(value)) return false;
  if (value.kind === 'page-labels') {
    return (
      hasOnlyKeys(value, [
        'alignment',
        'color',
        'endPage',
        'fontSize',
        'kind',
        'marginPoints',
        'position',
        'prefix',
        'replaceExistingLabels',
        'startNumber',
        'startPage',
        'style',
      ]) &&
      typeof value.prefix === 'string' &&
      value.prefix.length <= 40 &&
      typeof value.replaceExistingLabels === 'boolean' &&
      isIntegerBetween(value.startNumber, 1, 999_999_999) &&
      isPageLabelStyle(value.style)
    );
  }
  return (
    value.kind === 'bates' &&
    hasOnlyKeys(value, [
      'alignment',
      'color',
      'digits',
      'endPage',
      'fontSize',
      'kind',
      'marginPoints',
      'position',
      'prefix',
      'startNumber',
      'startPage',
      'suffix',
    ]) &&
    isIntegerBetween(value.digits, 3, 12) &&
    typeof value.prefix === 'string' &&
    value.prefix.length <= 40 &&
    isIntegerBetween(value.startNumber, 1, 999_999_999) &&
    typeof value.suffix === 'string' &&
    value.suffix.length <= 40
  );
};

const roman = (value: number): string => {
  if (value < 1 || value > 3_999) fail('NUMBERING_ROMAN_RANGE_UNSUPPORTED');
  const numerals = [
    [1_000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ] as const;
  let remainder = value;
  let output = '';
  for (const [unit, text] of numerals) {
    while (remainder >= unit) {
      output += text;
      remainder -= unit;
    }
  }
  return output;
};

const letters = (value: number): string => {
  // ORG-011: PDF alphabetic labels repeat one letter per 26-page group, not spreadsheet columns.
  const length = Math.ceil(value / 26);
  if (length > 120) fail('NUMBERING_IDENTIFIER_LIMIT');
  return String.fromCharCode(65 + ((value - 1) % 26)).repeat(length);
};

export const formatPageLabel = (style: PageLabelStyle, value: number): string => {
  if (!isPageLabelStyle(style)) fail('NUMBERING_OPTIONS_INVALID');
  if (!Number.isInteger(value) || value < 1 || value > 999_999_999) {
    fail('NUMBERING_START_INVALID');
  }
  if (style === 'decimal') return String(value);
  if (style === 'roman-lower') return roman(value).toLowerCase();
  if (style === 'roman-upper') return roman(value);
  if (style === 'letters-lower') return letters(value).toLowerCase();
  return letters(value);
};

export const formatNumberingIdentifier = (options: PdfNumberingOptions, offset: number): string => {
  if (!validOptions(options)) fail('NUMBERING_OPTIONS_INVALID');
  if (!Number.isInteger(offset) || offset < 0 || offset > 499) fail('NUMBERING_OFFSET_INVALID');
  // Identifiers are literal: never turn a control character into a different printed identifier.
  const affixes = options.kind === 'bates' ? [options.prefix, options.suffix] : [options.prefix];
  if (affixes.some((text) => /[\p{Cc}\p{Zl}\p{Zp}]/u.test(text)))
    fail('NUMBERING_TEXT_CONTROL_UNSUPPORTED');
  const value = options.startNumber + offset;
  if (value > 999_999_999) fail('NUMBERING_SEQUENCE_LIMIT');
  const identifier =
    options.kind === 'bates'
      ? `${options.prefix}${String(value).padStart(options.digits, '0')}${options.suffix}`
      : `${options.prefix}${formatPageLabel(options.style, value)}`;
  if (identifier.length === 0 || identifier.length > 120) fail('NUMBERING_IDENTIFIER_LIMIT');
  return identifier;
};

const lastSupportedValue = (options: PdfNumberingOptions): number => {
  if (options.kind === 'bates' || options.style === 'decimal') return 999_999_999;
  if (options.style === 'roman-lower' || options.style === 'roman-upper') return 3_999;
  return (120 - options.prefix.length) * 26;
};

export const previewNumbering = (options: PdfNumberingOptions, count = 3): readonly string[] => {
  if (!validOptions(options) || !isIntegerBetween(count, 1, 10)) {
    fail('NUMBERING_OPTIONS_INVALID');
  }
  const lastPage = options.endPage ?? 500;
  if (lastPage < options.startPage) fail('NUMBERING_PAGE_RANGE_INVALID');
  formatNumberingIdentifier(options, 0);
  if (options.endPage !== null) formatNumberingIdentifier(options, lastPage - options.startPage);
  const length = Math.min(
    count,
    lastPage - options.startPage + 1,
    lastSupportedValue(options) - options.startNumber + 1,
  );
  return Object.freeze(
    Array.from({ length }, (_, offset) => formatNumberingIdentifier(options, offset)),
  );
};

const pageLabelPdfName = (style: PageLabelStyle): string => {
  if (style === 'decimal') return 'D';
  if (style === 'roman-lower') return 'r';
  if (style === 'roman-upper') return 'R';
  if (style === 'letters-lower') return 'a';
  return 'A';
};

const labelDictionary = (
  document: PDFDocument,
  style: string,
  prefix: string,
  startNumber: number,
): PDFDict =>
  document.context.obj({
    P: prefix.length === 0 ? undefined : PDFHexString.fromText(prefix),
    S: style,
    St: startNumber,
    Type: 'PageLabel',
  });

const setPageLabels = (
  document: PDFDocument,
  options: PageLabelNumberingOptions,
  endPage: number,
  sourcePages: number,
): number => {
  const nums = document.context.obj([]);
  let rangeCount = 0;
  if (options.startPage > 1) {
    nums.push(PDFNumber.of(0));
    nums.push(labelDictionary(document, 'D', '', 1));
    rangeCount += 1;
  }
  if (options.style === 'letters-lower' || options.style === 'letters-upper') {
    // Reader implementations disagree on /A and /a. Standard prefix-only entries are exact
    // across readers and bounded to the existing 500-page / 120-character limits (ADR 0019).
    for (let page = options.startPage; page <= endPage; page++) {
      nums.push(PDFNumber.of(page - 1));
      nums.push(
        document.context.obj({
          P: PDFHexString.fromText(formatNumberingIdentifier(options, page - options.startPage)),
          Type: 'PageLabel',
        }),
      );
      rangeCount += 1;
    }
  } else {
    nums.push(PDFNumber.of(options.startPage - 1));
    nums.push(
      labelDictionary(
        document,
        pageLabelPdfName(options.style),
        options.prefix,
        options.startNumber,
      ),
    );
    rangeCount += 1;
  }
  if (endPage < sourcePages) {
    nums.push(PDFNumber.of(endPage));
    nums.push(labelDictionary(document, 'D', '', endPage + 1));
    rangeCount += 1;
  }
  document.catalog.set(PDFName.of('PageLabels'), document.context.obj({ Nums: nums }));
  return rangeCount;
};

const pageLabelRangeCount = (document: PDFDocument): number => {
  const root = document.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict);
  const nums = root?.lookupMaybe(PDFName.of('Nums'), PDFArray);
  if (nums === undefined) {
    throw new Error('NUMBERING_PAGE_LABEL_VERIFY_FAILED');
  }
  if (nums.size() === 0 || nums.size() % 2 !== 0) {
    fail('NUMBERING_PAGE_LABEL_VERIFY_FAILED');
  }
  for (let index = 0; index < nums.size(); index += 2) {
    nums.lookup(index, PDFNumber);
    nums.lookup(index + 1, PDFDict);
  }
  return nums.size() / 2;
};

export const numberPdf = async (
  bytes: Uint8Array,
  options: PdfNumberingOptions,
): Promise<PdfNumberingResult> => {
  if (!validOptions(options)) fail('NUMBERING_OPTIONS_INVALID');
  formatNumberingIdentifier(options, 0);
  const snapshot = await loadPageModificationDocument(bytes, 'NUMBERING');
  const { document, pageCount } = snapshot;
  const endPage = options.endPage ?? pageCount;
  if (options.startPage > endPage || endPage > pageCount) fail('NUMBERING_PAGE_RANGE_INVALID');
  const appliedPages = endPage - options.startPage + 1;
  formatNumberingIdentifier(options, appliedPages - 1);

  const hadPageLabels = document.catalog.has(PDFName.of('PageLabels'));
  if (options.kind === 'page-labels' && hadPageLabels && !options.replaceExistingLabels) {
    fail('NUMBERING_PAGE_LABELS_EXIST');
  }

  const expectedPageLabelRanges =
    options.kind === 'page-labels' ? setPageLabels(document, options, endPage, pageCount) : null;
  const font = await document.embedFont(StandardFonts.Helvetica);
  const decoration: RepeatingTextDecoration = {
    alignment: options.alignment,
    color: options.color,
    fontSize: options.fontSize,
    text: '',
  };
  for (let pageNumber = options.startPage; pageNumber <= endPage; pageNumber += 1) {
    const identifier = formatNumberingIdentifier(options, pageNumber - options.startPage);
    const page = document.getPage(pageNumber - 1);
    drawRepeatingText(
      page,
      validatedDecorationPageTransform(page, 'NUMBERING'),
      decoration,
      identifier,
      options.marginPoints,
      options.position,
      font,
      'NUMBERING',
    );
  }

  const output = await savePageModificationDocument(snapshot);
  const verification = await PDFDocument.load(output, { updateMetadata: false });
  if (
    expectedPageLabelRanges !== null &&
    pageLabelRangeCount(verification) !== expectedPageLabelRanges
  ) {
    fail('NUMBERING_PAGE_LABEL_VERIFY_FAILED');
  }
  if (
    options.kind === 'bates' &&
    verification.catalog.has(PDFName.of('PageLabels')) !== hadPageLabels
  ) {
    fail('NUMBERING_PAGE_LABEL_PRESERVATION_FAILED');
  }

  return {
    bytes: output,
    report: {
      appliedPages,
      firstIdentifier: formatNumberingIdentifier(options, 0),
      kind: options.kind,
      lastIdentifier: formatNumberingIdentifier(options, appliedPages - 1),
      operationVersion: '1.0.3',
      range: { endPage, startPage: options.startPage },
      sourcePages: pageCount,
    },
  };
};
