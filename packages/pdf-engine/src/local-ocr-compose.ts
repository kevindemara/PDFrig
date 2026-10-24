import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFStream,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from '@cantoo/pdf-lib';
import { loadLocalTextDocument } from './source-text.js';
import {
  assertOutlineStructuresPreserved,
  snapshotOutlineStructures,
} from './outline-preservation.js';
import { assertTagStructuresPreserved, snapshotTagStructures } from './tag-preservation.js';

export interface LocalOcrWord {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly confidence?: number;
}
export async function composeLocalOcr(
  bytes: Uint8Array,
  pageIndex: number,
  words: readonly LocalOcrWord[],
): Promise<Uint8Array> {
  const document = await loadLocalTextDocument(bytes);
  if (
    !Number.isSafeInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= document.getPageCount() ||
    !Array.isArray(words) ||
    words.length < 1 ||
    words.length > 10_000
  )
    throw new Error('OCR_INVALID_WORDS');
  const page = document.getPage(pageIndex);
  const crop = page.getCropBox();
  if (((page.getRotation().angle % 360) + 360) % 360 !== 0)
    throw new Error('OCR_ROTATION_UNSUPPORTED');
  const outline = snapshotOutlineStructures(document);
  const tags = await snapshotTagStructures(document);
  const originals = document.getPages().map((sourcePage) => {
    const raw = sourcePage.node.get(PDFName.of('Contents'));
    const value = document.context.lookup(raw);
    return (value instanceof PDFArray ? value.asArray() : raw ? [raw] : []).map((item) => {
      const stream = document.context.lookup(item);
      if (!(stream instanceof PDFStream)) throw new Error('OCR_SOURCE_CONTENT_UNSUPPORTED');
      return stream.getContents().slice();
    });
  });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const supportedCharacters = new Set(font.getCharacterSet());
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const validatedWords: readonly LocalOcrWord[] = words;
  for (const word of validatedWords) {
    if (
      typeof word !== 'object' ||
      typeof word.text !== 'string' ||
      !word.text.trim() ||
      word.text.length > 256 ||
      [word.x, word.y, word.width, word.height, word.baseline].some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1,
      ) ||
      word.width <= 0 ||
      word.height <= 0 ||
      word.x + word.width > 1.001 ||
      word.y + word.height > 1.001 ||
      Array.from(word.text).some(
        (character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127,
      )
    )
      throw new Error('OCR_INVALID_WORDS');
    const size = (word.height * crop.height) / 0.718;
    // The library can silently substitute unsupported glyphs. Reject before encoding.
    if (
      Array.from(word.text).some(
        (character) => !supportedCharacters.has(character.codePointAt(0) ?? -1),
      )
    )
      throw new Error('OCR_GLYPH_UNSUPPORTED');
    let encoded;
    try {
      encoded = font.encodeText(word.text);
    } catch {
      throw new Error('OCR_GLYPH_UNSUPPORTED');
    }
    const advance = font.widthOfTextAtSize(word.text, size);
    if (!advance || size > 1000) throw new Error('OCR_INVALID_WORDS');
    page.pushOperators(
      pushGraphicsState(),
      beginText(),
      setFontAndSize(fontKey, size),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setTextMatrix(
        (word.width * crop.width) / advance,
        0,
        0,
        1,
        crop.x + word.x * crop.width,
        crop.y + (1 - word.baseline) * crop.height,
      ),
      showText(encoded),
      endText(),
      popGraphicsState(),
    );
  }
  // Originals are never replaced or painted; only a text-only stream is appended.
  const output = await document.save({ updateFieldAppearances: false });
  const reopened = await PDFDocument.load(output, { updateMetadata: false });
  for (const [index, originalStreams] of originals.entries()) {
    const raw = reopened.getPage(index).node.get(PDFName.of('Contents'));
    const value = reopened.context.lookup(raw);
    const streams = (value instanceof PDFArray ? value.asArray() : raw ? [raw] : []).map((item) =>
      reopened.context.lookup(item),
    );
    let cursor = 0;
    for (const before of originalStreams) {
      const match = streams.findIndex(
        (stream, position) =>
          position >= cursor &&
          stream instanceof PDFStream &&
          stream.getContents().length === before.length &&
          before.every((byte, offset) => stream.getContents()[offset] === byte),
      );
      if (match < 0) throw new Error('OCR_SOURCE_CONTENT_CHANGED');
      cursor = match + 1;
    }
  }
  assertOutlineStructuresPreserved(outline, reopened);
  await assertTagStructuresPreserved(tags, reopened);
  return output;
}
