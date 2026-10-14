import type { Font } from 'fontkit';
import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib';
import type { NormalizedRect } from '@pdfmason/editor-core';

let fontPromise: Promise<Font> | undefined;
let bytesPromise: Promise<Uint8Array> | undefined;
const features = { kern: false, liga: false };
const embeddedFonts = new WeakMap<PDFDocument, Promise<PDFFont>>();

// SIGN-001/002: parse only this reviewed, bundled font. Never user-supplied font bytes.
const getBytes = (): Promise<Uint8Array> => {
  bytesPromise ??= import('./signature-font-data.js').then(({ signatureFontBase64 }) =>
    Uint8Array.from(atob(signatureFontBase64), (value) => value.charCodeAt(0)),
  );
  return bytesPromise;
};
const getFont = (): Promise<Font> => {
  fontPromise ??= Promise.all([import('fontkit'), getBytes()]).then(([fontkit, bytes]) => {
    // @types/fontkit types this as Node Buffer; the browser entry accepts Uint8Array.
    // This bridge is isolated to the fixed asset and covered in the real-browser lane.
    const create = fontkit.create as unknown as (
      bytes: Uint8Array,
    ) => ReturnType<typeof fontkit.create>;
    const font = create(bytes);
    if (!('layout' in font)) throw new Error('EDIT_SIGNATURE_FONT_INVALID');
    return font;
  });
  return fontPromise;
};

export const embedSignatureFont = async (document: PDFDocument): Promise<PDFFont> => {
  const existing = embeddedFonts.get(document);
  if (existing !== undefined) return existing;
  const font = await getFont();
  document.registerFontkit({ create: () => font });
  // Embed the unmodified upstream font, retaining its original reserved font name.
  // Awaiting above may race with a second placement; recheck before embedding.
  const ready = embeddedFonts.get(document);
  if (ready !== undefined) return ready;
  const bytes = await getBytes();
  const current = embeddedFonts.get(document);
  if (current !== undefined) return current;
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
  const run = font.layout(text, features);
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
