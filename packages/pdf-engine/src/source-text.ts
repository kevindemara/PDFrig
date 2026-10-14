/** EDIT-002: bounded original-operator editing. No covering rectangle, raster or font substitution. */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFontEmbedder,
  StandardFonts,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { findPdfModificationRisk } from './modification-risks.js';
import { inspectPdfRevisionStructure } from './incremental-revisions.js';
import {
  snapshotOutlineStructures,
  assertOutlineStructuresPreserved,
} from './outline-preservation.js';
import { snapshotTagStructures } from './tag-preservation.js';
import { updateSourceTextAccessibility } from './source-text-accessibility.js';

export interface SourceTextRun {
  readonly id: string;
  readonly pageIndex: number;
  readonly text: string;
  readonly fontName: string;
  readonly fontSize: number;
}
interface Token {
  start: number;
  end: number;
  kind: 'string' | 'array' | 'name' | 'number' | 'word' | 'dict';
  raw: string;
  children?: Token[];
}
interface Codec {
  name: string;
  decode(bytes: Uint8Array): string;
  encode(text: string): string;
  width(text: string): number;
}
interface Run extends SourceTextRun {
  stream: PDFRef;
  content: string;
  token: Token;
  operator: Token;
  codec: Codec;
  characterSpace: number;
  wordSpace: number;
  mcid: number | null;
}
const fail = (code = 'SOURCE_TEXT_UNSUPPORTED'): never => {
  throw new Error(code);
};
const validText = (text: string): boolean =>
  typeof text === 'string' &&
  text.length > 0 &&
  text.length <= 4096 &&
  /^[\x20-\x7e]+$/u.test(text);
const num = (dict: PDFDict, name: string, fallback: number): number =>
  dict.lookupMaybe(PDFName.of(name), PDFNumber)?.asNumber() ?? fallback;
const streamText = (stream: PDFRawStream): string => {
  const bytes = decodePDFRawStream(stream).decode();
  if (bytes.length > 8 * 1024 * 1024) return fail('SOURCE_TEXT_LIMIT');
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
};

function tokenize(content: string): Token[] {
  let offset = 0;
  let count = 0;
  const white = (c: string) => /[\s\0]/u.test(c);
  function read(depth = 0): Token {
    if (++count > 100_000 || depth > 32) return fail('SOURCE_TEXT_LIMIT');
    while (offset < content.length) {
      if (white(content[offset] ?? fail())) {
        offset++;
        continue;
      }
      if (content[offset] === '%') {
        while (offset < content.length && !/[\r\n]/u.test(content[offset] ?? fail())) offset++;
        continue;
      }
      break;
    }
    const start = offset;
    const first = content[offset++];
    if (first === undefined) return fail();
    let kind: Token['kind'] = 'word';
    let children: Token[] | undefined;
    if (first === '(') {
      kind = 'string';
      let balance = 1;
      while (offset < content.length && balance) {
        const c = content[offset++];
        if (c === '\\') {
          if (content[offset] === '\r' && content[offset + 1] === '\n') offset++;
          offset++;
        } else if (c === '(') balance++;
        else if (c === ')') balance--;
      }
      if (balance) return fail();
    } else if (first === '<' && content[offset] !== '<') {
      kind = 'string';
      while (offset < content.length && content[offset] !== '>') offset++;
      if (content[offset++] !== '>') return fail();
    } else if (first === '[' || (first === '<' && content[offset] === '<')) {
      kind = first === '[' ? 'array' : 'dict';
      if (kind === 'dict') offset++;
      children = [];
      for (;;) {
        while (offset < content.length && white(content[offset] ?? fail())) offset++;
        if (kind === 'array' && content[offset] === ']') {
          offset++;
          break;
        }
        if (kind === 'dict' && content.slice(offset, offset + 2) === '>>') {
          offset += 2;
          break;
        }
        if (offset >= content.length) return fail();
        children.push(read(depth + 1));
      }
    } else {
      kind = first === '/' ? 'name' : 'word';
      while (offset < content.length && !/[\s\0()[\]<>/%]/u.test(content[offset] ?? fail()))
        offset++;
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(content.slice(start, offset))) kind = 'number';
      if (kind === 'word' && content.slice(start, offset) === 'BI')
        return fail('SOURCE_TEXT_INLINE_IMAGE_UNSUPPORTED');
    }
    return {
      start,
      end: offset,
      raw: content.slice(start, offset),
      kind,
      ...(children ? { children } : {}),
    };
  }
  const tokens: Token[] = [];
  while (offset < content.length) {
    if (white(content[offset] ?? fail())) {
      offset++;
      continue;
    }
    if (content[offset] === '%') {
      while (offset < content.length && !/[\r\n]/u.test(content[offset] ?? fail())) offset++;
      continue;
    }
    tokens.push(read());
  }
  return tokens;
}
const bytesOf = (token: Token): Uint8Array =>
  token.raw.startsWith('(')
    ? PDFString.of(token.raw.slice(1, -1)).asBytes()
    : PDFHexString.of(token.raw.slice(1, -1)).asBytes();

function fontCodec(font: PDFDict): Codec | null {
  const name = font.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText() ?? '';
  const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
  const encoding = font.lookup(PDFName.of('Encoding'));
  const codeToText = new Map<number, string>();
  const textToCode = new Map<string, number>();
  let codeBytes = 1;
  const ambiguous = new Set<string>();
  let width = (code: number): number => code;
  if (subtype === 'Type0') {
    if (!(encoding instanceof PDFName) || encoding.decodeText() !== 'Identity-H') return null;
    const cmap = font.lookup(PDFName.of('ToUnicode'));
    if (!(cmap instanceof PDFRawStream)) return null;
    const data = streamText(cmap);
    codeBytes = 2;
    const register = (hex: string, unicode: string): void => {
      if (hex.length !== 4 || unicode.length !== 4) return;
      const code = Number.parseInt(hex, 16);
      const text = String.fromCharCode(Number.parseInt(unicode, 16));
      if (!validText(text)) return;
      if (codeToText.has(code) || textToCode.has(text)) {
        ambiguous.add(text);
        return;
      }
      codeToText.set(code, text);
      if (!textToCode.has(text)) textToCode.set(text, code);
    };
    for (const block of data.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu))
      for (const pair of (block[1] ?? fail()).matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/giu))
        register(pair[1] ?? fail(), pair[2] ?? fail());
    for (const block of data.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
      for (const range of (block[1] ?? fail()).matchAll(
        /<([0-9a-f]{4})>\s*<([0-9a-f]{4})>\s*<([0-9a-f]{4})>/giu,
      )) {
        const first = Number.parseInt(range[1] ?? fail(), 16);
        const last = Number.parseInt(range[2] ?? fail(), 16);
        if (last - first > 4096 || last < first) return null;
        for (let i = first; i <= last; i++)
          register(
            i.toString(16).padStart(4, '0'),
            (Number.parseInt(range[3] ?? fail(), 16) + i - first).toString(16).padStart(4, '0'),
          );
      }
    }
    const descendant = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0);
    if (ambiguous.size > 0) return null;
    if (!(descendant instanceof PDFDict)) return null;
    const widths = new Map<number, number>();
    const w = descendant.lookupMaybe(PDFName.of('W'), PDFArray);
    if (w && w.size() > 8192) return null;
    for (let i = 0; w && i < w.size();) {
      const start = w.lookup(i++);
      const next = w.lookup(i++);
      if (!(start instanceof PDFNumber)) return null;
      if (next instanceof PDFArray) {
        for (let j = 0; j < next.size(); j++) {
          const value = next.lookup(j);
          if (!(value instanceof PDFNumber) || j > 8192) return null;
          widths.set(start.asNumber() + j, value.asNumber());
        }
      } else if (next instanceof PDFNumber) {
        const value = w.lookup(i++);
        if (!(value instanceof PDFNumber) || next.asNumber() - start.asNumber() > 8192) return null;
        for (let j = start.asNumber(); j <= next.asNumber(); j++) widths.set(j, value.asNumber());
      } else return null;
    }
    width = (code) => widths.get(code) ?? num(descendant, 'DW', 1000);
  } else if (subtype === 'Type1' || subtype === 'TrueType') {
    // Unknown simple embedded fonts need actual cmap/glyph validation, not a width guess.
    if (
      subtype !== 'Type1' ||
      !(Object.values(StandardFonts) as string[]).includes(name) ||
      ['Symbol', 'ZapfDingbats'].includes(name)
    )
      return null;
    if (
      !(encoding instanceof PDFName) &&
      !(Object.values(StandardFonts) as string[]).includes(name)
    )
      return null;
    if (
      encoding instanceof PDFDict ||
      (encoding instanceof PDFName &&
        !['WinAnsiEncoding', 'StandardEncoding'].includes(encoding.decodeText()))
    )
      return null;
    const widths = font.lookupMaybe(PDFName.of('Widths'), PDFArray);
    const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    if (descriptor && (num(descriptor, 'Flags', 0) & 4) !== 0) return null;
    const first = num(font, 'FirstChar', 0);
    if (widths)
      width = (code) => {
        const value = widths.lookup(code - first);
        if (!(value instanceof PDFNumber)) return fail('SOURCE_TEXT_GLYPH_UNSUPPORTED');
        return value.asNumber();
      };
    else {
      if (
        !(Object.values(StandardFonts) as string[]).includes(name) ||
        ['Symbol', 'ZapfDingbats'].includes(name)
      )
        return null;
      const embedder = StandardFontEmbedder.for(
        name as Parameters<typeof StandardFontEmbedder.for>[0],
      );
      width = (code) => embedder.widthOfTextAtSize(String.fromCharCode(code), 1000);
    }
    // Only unambiguous printable ASCII encodings. Other encodings remain read-only.
    if (font.has(PDFName.of('ToUnicode'))) return null;
    for (let code = 32; code <= 126; code++) {
      // StandardEncoding uses quotation glyphs, not ASCII, in these two slots.
      if (
        (!(encoding instanceof PDFName) || encoding.decodeText() === 'StandardEncoding') &&
        [39, 96].includes(code)
      )
        continue;
      codeToText.set(code, String.fromCharCode(code));
      textToCode.set(String.fromCharCode(code), code);
    }
  } else return null;
  return {
    name,
    decode(bytes) {
      if (bytes.length % codeBytes) return fail();
      let text = '';
      for (let i = 0; i < bytes.length; i += codeBytes) {
        const code =
          codeBytes === 2
            ? (bytes[i] ?? fail()) * 256 + (bytes[i + 1] ?? fail())
            : (bytes[i] ?? fail());
        const char = codeToText.get(code);
        if (!char) return fail('SOURCE_TEXT_GLYPH_UNSUPPORTED');
        text += char;
      }
      return text;
    },
    encode(text) {
      let hex = '';
      for (const char of text) {
        const code = textToCode.get(char);
        if (code === undefined) return fail('SOURCE_TEXT_GLYPH_UNSUPPORTED');
        hex += code.toString(16).padStart(codeBytes * 2, '0');
      }
      return `<${hex}>`;
    },
    width(text) {
      let result = 0;
      for (const char of text) {
        const code = textToCode.get(char);
        if (code === undefined) return fail('SOURCE_TEXT_GLYPH_UNSUPPORTED');
        result += width(code);
      }
      if (!Number.isFinite(result) || result < 0) return fail();
      return result;
    },
  };
}

export async function loadLocalTextDocument(bytes: Uint8Array): Promise<PDFDocument> {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    bytes.length > 50 * 1024 * 1024 ||
    inspectPdfRevisionStructure(bytes) !== 'single'
  )
    return fail('SOURCE_TEXT_INPUT_UNSUPPORTED');
  const document = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  if (document.isEncrypted || document.getPageCount() > 500 || findPdfModificationRisk(document))
    return fail('SOURCE_TEXT_INPUT_UNSUPPORTED');
  return document;
}
function indexPage(document: PDFDocument, pageIndex: number): Run[] {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.getPageCount())
    return fail();
  const page = document.getPage(pageIndex);
  const resources = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!resources) return [];
  const raw = page.node.get(PDFName.of('Contents'));
  const resolved = document.context.lookup(raw);
  const refs = resolved instanceof PDFArray ? resolved.asArray() : [raw];
  const runs: Run[] = [];
  // A page's content streams are concatenated: text/graphics state can cross streams.
  let codec: Codec | null = null;
  let size = 0;
  let inside = false;
  let rendering = 0;
  let characterSpace = 0;
  let wordSpace = 0;
  const marked: { mcid: number | null; semanticOverride: boolean }[] = [];
  const graphics: {
    codec: Codec | null;
    size: number;
    rendering: number;
    characterSpace: number;
    wordSpace: number;
  }[] = [];
  for (const [streamIndex, ref] of refs.entries()) {
    if (!(ref instanceof PDFRef)) continue;
    const stream = document.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const content = streamText(stream);
    let tokens: Token[];
    try {
      tokens = tokenize(content);
    } catch {
      return []; // Unknown stream state makes subsequent streams unsafe to edit.
    }
    let operands: Token[] = [];
    for (const operator of tokens) {
      if (operator.kind !== 'word') {
        operands.push(operator);
        continue;
      }
      const op = operator.raw;
      if (op === 'q') {
        if (graphics.length >= 32) return [];
        graphics.push({ codec, size, rendering, characterSpace, wordSpace });
      }
      if (op === 'Q') {
        const saved = graphics.pop();
        if (!saved) return [];
        ({ codec, size, rendering, characterSpace, wordSpace } = saved);
      }
      if (op === 'BT') {
        if (inside) return [];
        inside = true;
      }
      if (op === 'ET') {
        if (!inside) return [];
        inside = false;
      }
      if (op === 'Tr') rendering = Number(operands[0]?.raw);
      if (op === 'Tc') characterSpace = Number(operands[0]?.raw);
      if (op === 'Tw') wordSpace = Number(operands[0]?.raw);
      if (op === 'BDC' || op === 'BMC') {
        const prop = operands[1];
        const entries = prop?.children ?? [];
        const names = entries
          .filter((token) => token.kind === 'name')
          .map((token) => PDFName.of(token.raw.slice(1)).decodeText());
        const index = entries.findIndex(
          (token) =>
            token.kind === 'name' && PDFName.of(token.raw.slice(1)).decodeText() === 'MCID',
        );
        const value = index >= 0 ? entries[index + 1] : undefined;
        marked.push({
          mcid: value?.kind === 'number' ? Number(value.raw) : null,
          semanticOverride:
            op === 'BDC' &&
            (prop?.kind !== 'dict' ||
              names.some((name) => name === 'ActualText' || name === 'Alt')),
        });
      }
      if (op === 'EMC' && !marked.pop()) return [];
      if (op === 'Tf') {
        const font = resources.lookup(PDFName.of(operands[0]?.raw.slice(1) ?? ''));
        size = Number(operands[1]?.raw);
        codec = font instanceof PDFDict ? fontCodec(font) : null;
      }
      if (
        inside &&
        codec &&
        size > 0 &&
        size <= 1000 &&
        rendering === 0 &&
        !marked.some((item) => item.semanticOverride) &&
        ['Tj', 'TJ'].includes(op)
      ) {
        if (
          operands.length !== 1 ||
          (op === 'Tj' ? operands[0]?.kind !== 'string' : operands[0]?.kind !== 'array')
        )
          return [];
        if (
          op === 'TJ' &&
          operands[0]?.children?.some(
            (token) =>
              token.kind !== 'string' &&
              (token.kind !== 'number' || !Number.isFinite(Number(token.raw))),
          )
        )
          return [];
        const strings =
          op === 'Tj'
            ? operands.filter((token) => token.kind === 'string')
            : (operands[0]?.children?.filter((token) => token.kind === 'string') ?? []);
        for (const token of strings) {
          try {
            const text = codec.decode(bytesOf(token));
            if (validText(text) && text.trim())
              runs.push({
                id: `${pageIndex}:${streamIndex}:${token.start}`,
                pageIndex,
                text,
                fontName: codec.name,
                fontSize: size,
                stream: ref,
                content,
                token,
                operator,
                codec,
                characterSpace,
                wordSpace,
                mcid: marked.at(-1)?.mcid ?? null,
              });
          } catch {
            /* Unsupported glyphs are not editable. */
          }
        }
      }
      operands = [];
      if (runs.length > 4096) return fail('SOURCE_TEXT_LIMIT');
    }
  }
  return graphics.length || inside || marked.length ? [] : runs;
}

export async function inspectSourceText(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<readonly SourceTextRun[]> {
  return indexPage(await loadLocalTextDocument(bytes), pageIndex).map(
    ({ id, text, fontName, fontSize }) => ({ id, text, fontName, fontSize, pageIndex }),
  );
}
export async function replaceSourceText(
  bytes: Uint8Array,
  id: string,
  expectedText: string,
  replacement: string,
): Promise<Uint8Array> {
  if (
    !validText(expectedText) ||
    !validText(replacement) ||
    typeof id !== 'string' ||
    !/^\d+:\d+:\d+$/u.test(id)
  )
    return fail('SOURCE_TEXT_INVALID_CHANGE');
  const document = await loadLocalTextDocument(bytes);
  const pageIndex = Number(id.split(':')[0]);
  const runs = indexPage(document, pageIndex);
  const run = runs.find((item) => item.id === id);
  if (run?.text !== expectedText) return fail('SOURCE_TEXT_STALE_CHANGE');
  // Refuse streams used by another page; never mutate a shared resource by accident.
  for (const [index, page] of document.getPages().entries())
    if (index !== pageIndex) {
      const raw = page.node.get(PDFName.of('Contents'));
      const value = document.context.lookup(raw);
      if (
        (value instanceof PDFArray ? value.asArray() : [raw]).some(
          (ref) => ref?.toString() === run.stream.toString(),
        )
      )
        return fail('SOURCE_TEXT_SHARED_STREAM');
    }
  const advance = (text: string) =>
    (run.codec.width(text) * run.fontSize) / 1000 +
    text.length * run.characterSpace +
    (text.match(/ /gu)?.length ?? 0) * run.wordSpace;
  const oldWidth = advance(run.text);
  const newWidth = advance(replacement);
  if (
    ![oldWidth, newWidth].every(Number.isFinite) ||
    oldWidth < 0 ||
    newWidth < 0 ||
    newWidth > oldWidth + 0.01
  )
    return fail('SOURCE_TEXT_REPLACEMENT_TOO_WIDE');
  const outlines = snapshotOutlineStructures(document);
  if (document.catalog.has(PDFName.of('StructTreeRoot'))) {
    if (run.mcid === null || runs.filter((item) => item.mcid === run.mcid).length !== 1)
      return fail('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
    updateSourceTextAccessibility(document, {
      pageIndex,
      markedContentId: run.mcid,
      expectedText,
      replacementText: replacement,
    });
  }
  const expectedTags = (await snapshotTagStructures(document))?.graph;
  const adjustment = -(((oldWidth - newWidth) * 1000) / run.fontSize);
  const encoded = `${run.codec.encode(replacement)} ${adjustment.toFixed(8)}`;
  const start = run.token.start;
  const end = run.operator.raw === 'Tj' ? run.operator.end : run.token.end;
  const changed =
    run.content.slice(0, start) +
    (run.operator.raw === 'Tj' ? `[${encoded}] TJ` : encoded) +
    run.content.slice(end);
  document.context.assign(run.stream, document.context.flateStream(changed));
  const saved = await document.save({ updateFieldAppearances: false });
  const reopened = await PDFDocument.load(saved, { updateMetadata: false });
  assertOutlineStructuresPreserved(outlines, reopened);
  if (expectedTags !== (await snapshotTagStructures(reopened))?.graph)
    return fail('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
  if (!indexPage(reopened, pageIndex).some((item) => item.text === replacement))
    return fail('SOURCE_TEXT_VERIFICATION_FAILED');
  return saved;
}
