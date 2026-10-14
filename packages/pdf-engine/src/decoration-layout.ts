import type { DecorationAlignment } from './decoration-options.js';
import type { PDFFont } from '@cantoo/pdf-lib';

/** EDIT-006/EDIT-007, ORG-011/ORG-012: shared standard-font export and advisory layout rules. */
export const normalizeDecorationText = (text: string): string =>
  text.replace(/[\r\n]/gu, ' ').trim();

export const substituteDecorationPageTokens = (text: string, page: number, total: number): string =>
  text.replaceAll('{page}', String(page)).replaceAll('{pages}', String(total));

export const decorationFontSupports = (
  font: Pick<PDFFont, 'getCharacterSet'>,
  text: string,
): boolean => {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text).every((character) => supported.has(character.codePointAt(0) ?? -1));
};

/** The standard-font export writes Tj, without pair-kerning adjustments. */
export const decorationTextAdvance = (
  font: Pick<PDFFont, 'widthOfTextAtSize'>,
  text: string,
  size: number,
): number =>
  Array.from(text).reduce((width, character) => width + font.widthOfTextAtSize(character, size), 0);

export const decorationAlignedX = (
  alignment: DecorationAlignment,
  displayWidth: number,
  marginPoints: number,
  textWidth: number,
): number => {
  if (alignment === 'left') return marginPoints / displayWidth;
  if (alignment === 'right')
    return Math.max(0, (displayWidth - marginPoints - textWidth) / displayWidth);
  return Math.max(0, (displayWidth - textWidth) / 2 / displayWidth);
};
