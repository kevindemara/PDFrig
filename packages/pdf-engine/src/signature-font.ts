import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib';
import type { NormalizedRect } from '@pdfmason/editor-core';
import { createFixedSignatureFont } from './fixed-signature-font.js';

let fontPromise: Promise<ReturnType<typeof createFixedSignatureFont>> | undefined;
let bytesPromise: Promise<Uint8Array> | undefined;
const features = { kern: false, liga: false };
const embeddedFonts = new WeakMap<PDFDocument, Promise<PDFFont>>();

// SIGN-001/002: embed only the reviewed font; never parse user-supplied font bytes.
const getBytes = (): Promise<Uint8Array> => {
  bytesPromise ??= import('./signature-font-data.js').then(async ({ signatureFontBase64 }) => {
    const bytes = Uint8Array.from(atob(signatureFontBase64), (value) => value.charCodeAt(0));
    if (bytes.length !== 133636) throw new Error('EDIT_SIGNATURE_FONT_INVALID');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== '21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c')
      throw new Error('EDIT_SIGNATURE_FONT_INVALID');
    return bytes;
  });
  return bytesPromise;
};
const getFont = (): Promise<ReturnType<typeof createFixedSignatureFont>> => {
  fontPromise ??= Promise.all([import('./signature-font-facts.js'), getBytes()]).then(
    ([{ signatureFontFacts }]) => createFixedSignatureFont(signatureFontFacts),
  );
  return fontPromise;
};

export const embedSignatureFont = async (document: PDFDocument): Promise<PDFFont> => {
  const existing = embeddedFonts.get(document);
  if (existing !== undefined) return existing;
  const font = await getFont();
  const bytes = await getBytes();
  document.registerFontkit({
    create: (input) => {
      if (input !== bytes) throw new Error('EDIT_SIGNATURE_FONT_INVALID');
      return font;
    },
  });
  // Embed the unmodified upstream font, retaining its original reserved font name.
  // Awaiting above may race with a second placement; recheck before embedding.
  const ready = embeddedFonts.get(document);
  if (ready !== undefined) return ready;
  const result = document.embedFont(bytes, { subset: false, features });
  embeddedFonts.set(document, result);
  return result;
};

export interface ScriptSignatureLayout {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly baseline: number;
  readonly fontSize: number;
  readonly glyphScale: number;
  readonly glyphs: readonly { readonly x: number; readonly path: string }[];
}
export const layoutScriptSignature = async (
  text: string,
  label: 'initials' | 'signature',
  rect: NormalizedRect,
  pageWidth: number,
  pageHeight: number,
): Promise<ScriptSignatureLayout> => {
  const font = await getFont();
  if (
    text.length === 0 ||
    text.length > 200 ||
    Array.from(text).some((glyph) => (glyph.codePointAt(0) ?? 0) < 32) ||
    !Array.from(text).every((glyph) => font.hasGlyphForCodePoint(glyph.codePointAt(0) ?? 0))
  )
    throw new Error('EDIT_SIGNATURE_TEXT_UNSUPPORTED');
  const width = rect.width * pageWidth;
  const height = rect.height * pageHeight;
  if (![width, height].every(Number.isFinite) || width <= 8 || height <= 8)
    throw new Error('EDIT_SIGNATURE_BOX_TOO_SMALL');
  const run = font.layout(text);
  const advance = run.glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
  const fontSize = Math.min(
    label === 'initials' ? 24 : 32,
    ((height - 8) * font.unitsPerEm) / (font.ascent - font.descent),
    ((width - 8) * font.unitsPerEm) / Math.max(1, advance),
  );
  if (fontSize < 6) throw new Error('EDIT_SIGNATURE_BOX_TOO_SMALL');
  const glyphScale = fontSize / font.unitsPerEm;
  const x = (width - advance * glyphScale) / 2;
  const baseline = 4 + font.ascent * glyphScale;
  let offset = 0;
  const glyphs = run.glyphs.map((glyph) => {
    const result = { x: offset, path: glyph.path.toSVG() };
    offset += glyph.advanceWidth;
    return result;
  });
  return { width, height, x, baseline, fontSize, glyphScale, glyphs };
};
