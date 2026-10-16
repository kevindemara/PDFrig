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
import { wrapParagraph } from './paragraph-layout.js';
import {
  IDENTITY_TEXT_MATRIX,
  moveTextMatrix,
  multiplyTextMatrices,
  type TextMatrix,
} from './source-text-layout.js';

export interface SourceTextRun {
  readonly id: string;
  readonly pageIndex: number;
  readonly text: string;
  readonly fontName: string;
  readonly fontSize: number;
  readonly paragraph?: {
    readonly id: string;
    readonly text: string;
    readonly bounds: NonNullable<SourceTextRun['bounds']>;
    readonly width: number;
    readonly maxWidth: number;
    readonly height: number;
    readonly lineHeight: number;
    readonly lineCount: number;
  };
  /** Unrotated CropBox-relative, top-left coordinates for selection matching. */
  readonly bounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
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
  wordSpacing: boolean;
  decode(bytes: Uint8Array): string;
  encode(text: string): string;
  width(text: string): number;
}
interface Fragment extends SourceTextRun {
  stream: PDFRef;
  content: string;
  token: Token;
  operator: Token;
  codec: Codec;
  characterSpace: number;
  wordSpace: number;
  mcid: number | null;
  matrix: TextMatrix;
  textMatrix: TextMatrix;
  lineMatrix: TextMatrix;
  horizontalScale: number;
  boundary: number;
  paint: string;
}
interface Run extends SourceTextRun {
  fragments: { fragment: Fragment; start: number; end: number }[];
  growthSafe?: boolean;
  reflowSafe?: boolean;
}
export interface SourceTextRange {
  readonly start: number;
  readonly end: number;
  readonly scope?: 'paragraph';
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
    wordSpacing: codeBytes === 1,
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
const advanceText = (
  fragment: Pick<Fragment, 'codec' | 'fontSize' | 'characterSpace' | 'wordSpace'>,
  text: string,
): number =>
  (fragment.codec.width(text) * fragment.fontSize) / 1000 +
  text.length * fragment.characterSpace +
  (fragment.codec.wordSpacing ? (text.match(/ /gu)?.length ?? 0) * fragment.wordSpace : 0);
const textPoint = (fragment: Fragment, offset: number): readonly [number, number] => {
  const advance = advanceText(fragment, fragment.text.slice(0, offset)) * fragment.horizontalScale;
  return [
    fragment.matrix[4] + fragment.matrix[0] * advance,
    fragment.matrix[5] + fragment.matrix[1] * advance,
  ];
};
function groupFragments(
  fragments: readonly Fragment[],
  crop: { x: number; y: number; width: number; height: number },
): Run[] {
  const groups: Run[] = [];
  for (const fragment of fragments) {
    const group = groups.at(-1);
    const last = group?.fragments.at(-1)?.fragment;
    let separator = '';
    let joins = false;
    if (
      last?.codec === fragment.codec &&
      last.fontSize === fragment.fontSize &&
      last.boundary === fragment.boundary &&
      last.mcid === fragment.mcid &&
      last.characterSpace === fragment.characterSpace &&
      last.wordSpace === fragment.wordSpace &&
      last.horizontalScale === fragment.horizontalScale &&
      last.matrix
        .slice(0, 4)
        .every((value, index) => Math.abs(value - (fragment.matrix[index] ?? Infinity)) < 0.00001)
    ) {
      const end = textPoint(last, last.text.length);
      const axis = Math.hypot(last.matrix[0], last.matrix[1]);
      const dx = fragment.matrix[4] - end[0],
        dy = fragment.matrix[5] - end[1];
      const gap =
        (dx * last.matrix[0] + dy * last.matrix[1]) / (axis * axis * last.horizontalScale);
      const baseline = Math.abs(dx * last.matrix[1] - dy * last.matrix[0]) / axis;
      joins =
        axis > 0 &&
        baseline < last.fontSize * 0.08 * Math.hypot(last.matrix[2], last.matrix[3]) &&
        gap >= -last.fontSize * 0.15 &&
        gap <= last.fontSize * 0.75 &&
        (group?.text.length ?? 4096) + fragment.text.length < 4096;
      if (
        joins &&
        gap > last.fontSize * 0.18 &&
        !/\s$/u.test(last.text) &&
        !/^\s/u.test(fragment.text)
      )
        separator = ' ';
    }
    if (joins && group) {
      const start = group.text.length + separator.length;
      groups[groups.length - 1] = {
        ...group,
        text: group.text + separator + fragment.text,
        fragments: [...group.fragments, { fragment, start, end: start + fragment.text.length }],
      };
    } else
      groups.push({
        id: fragment.id,
        pageIndex: fragment.pageIndex,
        text: fragment.text,
        fontName: fragment.fontName,
        fontSize: fragment.fontSize,
        fragments: [{ fragment, start: 0, end: fragment.text.length }],
      });
  }
  return groups
    .filter((group) => group.text.trim())
    .map((group) => {
      const points = group.fragments.flatMap(({ fragment }) => {
        const start = textPoint(fragment, 0),
          end = textPoint(fragment, fragment.text.length);
        return [start, end].flatMap(([x, y]) => [
          [
            x + fragment.matrix[2] * fragment.fontSize * 0.85,
            y + fragment.matrix[3] * fragment.fontSize * 0.85,
          ],
          [
            x - fragment.matrix[2] * fragment.fontSize * 0.25,
            y - fragment.matrix[3] * fragment.fontSize * 0.25,
          ],
        ]);
      });
      const left = Math.min(...points.map((point) => point[0] ?? Infinity)),
        right = Math.max(...points.map((point) => point[0] ?? -Infinity));
      const bottom = Math.min(...points.map((point) => point[1] ?? Infinity)),
        top = Math.max(...points.map((point) => point[1] ?? -Infinity));
      return {
        ...group,
        bounds: {
          x: (left - crop.x) / crop.width,
          y: (crop.y + crop.height - top) / crop.height,
          width: (right - left) / crop.width,
          height: (top - bottom) / crop.height,
        },
      };
    });
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
  const runs: Fragment[] = [];
  const fontCache = new WeakMap<PDFDict, Codec | null>();
  let matrix = IDENTITY_TEXT_MATRIX,
    line = IDENTITY_TEXT_MATRIX,
    transform = IDENTITY_TEXT_MATRIX;
  let horizontalScale = 1,
    rise = 0,
    leading = 0,
    boundary = 0,
    positionKnown = true;
  // A page's content streams are concatenated: text/graphics state can cross streams.
  let codec: Codec | null = null;
  let size = 0;
  let inside = false;
  let rendering = 0;
  let characterSpace = 0;
  let wordSpace = 0;
  let paint = '0 g';
  let growthSafe = true;
  let reflowSafe = true;
  const marked: { mcid: number | null; semanticOverride: boolean }[] = [];
  const graphics: {
    codec: Codec | null;
    size: number;
    rendering: number;
    characterSpace: number;
    wordSpace: number;
    transform: TextMatrix;
    horizontalScale: number;
    rise: number;
    leading: number;
    paint: string;
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
      if (['g', 'rg', 'k'].includes(op))
        paint = `${op} ${operands.map((item) => item.raw).join(' ')}`;
      if (['cs', 'sc', 'scn', 'gs'].includes(op)) paint = `${boundary}:${op}`;
      if (
        ['Do', 'sh', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'gs', 'W', 'W*'].includes(op)
      )
        growthSafe = false;
      // External graphics state may change the font/text metrics, and clipping
      // can hide newly wrapped words. Neither is inferred from string operators.
      if (['gs', 'W', 'W*'].includes(op)) reflowSafe = false;
      if (op === 'q') {
        if (graphics.length >= 32) return [];
        graphics.push({
          codec,
          size,
          rendering,
          characterSpace,
          wordSpace,
          transform,
          horizontalScale,
          rise,
          leading,
          paint,
        });
      }
      if (op === 'Q') {
        const saved = graphics.pop();
        if (!saved) return [];
        ({
          codec,
          size,
          rendering,
          characterSpace,
          wordSpace,
          transform,
          horizontalScale,
          rise,
          leading,
          paint,
        } = saved);
      }
      if (op === 'BT') {
        if (inside) return [];
        inside = true;
        matrix = line = IDENTITY_TEXT_MATRIX;
        positionKnown = true;
      }
      if (op === 'ET') {
        if (!inside) return [];
        inside = false;
      }
      if (op === 'Tr') rendering = Number(operands[0]?.raw);
      if (op === 'Tc') characterSpace = Number(operands[0]?.raw);
      if (op === 'Tw') wordSpace = Number(operands[0]?.raw);
      if (op === 'Tz') horizontalScale = Number(operands[0]?.raw) / 100;
      if (op === 'Ts') rise = Number(operands[0]?.raw);
      if (op === 'TL') leading = Number(operands[0]?.raw);
      if (op === 'cm' || op === 'Tm') {
        const values = operands.map((token) => Number(token.raw));
        if (values.length !== 6 || !values.every(Number.isFinite)) return [];
        const next = values as unknown as TextMatrix;
        if (op === 'cm') transform = multiplyTextMatrices(transform, next);
        else {
          matrix = line = next;
          positionKnown = true;
        }
      }
      if (op === 'Td' || op === 'TD' || op === 'T*') {
        const x = op === 'T*' ? 0 : Number(operands[0]?.raw),
          y = op === 'T*' ? -leading : Number(operands[1]?.raw);
        if (![x, y].every(Number.isFinite)) return [];
        if (op === 'TD') leading = -y;
        matrix = line = moveTextMatrix(line, x, y);
        positionKnown = true;
      }
      if (
        ![
          'q',
          'Q',
          'BT',
          'ET',
          'Tr',
          'Tc',
          'Tw',
          'Tz',
          'Ts',
          'TL',
          'cm',
          'Tm',
          'Td',
          'TD',
          'T*',
          'Tf',
          'Tj',
          'TJ',
        ].includes(op)
      )
        boundary++;
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
        if (font instanceof PDFDict) {
          if (!fontCache.has(font)) fontCache.set(font, fontCodec(font));
          codec = fontCache.get(font) ?? null;
        } else codec = null;
      }
      if (![characterSpace, wordSpace, horizontalScale, rise, leading].every(Number.isFinite))
        return [];
      // Quote operators change both the line and text state. Until their full
      // semantics are supported, require a fresh known matrix before indexing.
      if (op === "'" || op === '"') positionKnown = false;
      if (inside && codec && size > 0 && size <= 1000 && ['Tj', 'TJ'].includes(op)) {
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
            : (operands[0]?.children ?? []);
        for (const token of strings) {
          if (token.kind === 'number') {
            matrix = moveTextMatrix(matrix, (-Number(token.raw) * size * horizontalScale) / 1000);
            continue;
          }
          try {
            const text = codec.decode(bytesOf(token));
            const editable =
              validText(text) &&
              rendering === 0 &&
              positionKnown &&
              horizontalScale > 0 &&
              Math.abs(transform[0] * transform[3] - transform[1] * transform[2]) > 0.000001 &&
              Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) > 0.000001 &&
              !marked.some((item) => item.semanticOverride);
            if (text.trim() && !editable) reflowSafe = false;
            if (editable)
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
                matrix: multiplyTextMatrices(transform, moveTextMatrix(matrix, 0, rise)),
                textMatrix: matrix,
                lineMatrix: line,
                horizontalScale,
                boundary,
                paint,
              });
            const advance = advanceText({ codec, fontSize: size, characterSpace, wordSpace }, text);
            matrix = moveTextMatrix(matrix, advance * horizontalScale);
          } catch {
            /* Unsupported glyphs are not editable. */
            positionKnown = false;
            growthSafe = false;
            reflowSafe = false;
            boundary++;
          }
        }
      }
      operands = [];
      if (
        ['Tj', 'TJ', "'", '"'].includes(op) &&
        (!inside || !codec || !(size > 0 && size <= 1000) || op === "'" || op === '"')
      ) {
        growthSafe = false;
        reflowSafe = false;
        positionKnown = false;
        boundary++;
      }
      if (runs.length > 20_000) return fail('SOURCE_TEXT_LIMIT');
    }
  }
  return graphics.length || inside || marked.length
    ? []
    : groupFragments(runs, page.getCropBox()).map((run) => ({ ...run, growthSafe, reflowSafe }));
}

function paragraphFor(document: PDFDocument, runs: readonly Run[], selected: Run) {
  if (runs.length > 500) return null;
  const base = selected.fragments[0]?.fragment;
  if (!base || selected.reflowSafe === false || !selected.bounds) return null;
  const eligible = (run: Run): boolean =>
    run.fragments.every(
      ({ fragment: f }) =>
        f.codec === base.codec &&
        f.fontSize === base.fontSize &&
        f.paint === base.paint &&
        f.mcid === base.mcid &&
        f.characterSpace === base.characterSpace &&
        f.wordSpace === base.wordSpace &&
        f.horizontalScale === base.horizontalScale &&
        Math.abs(f.matrix[1]) < 1e-8 &&
        Math.abs(f.matrix[2]) < 1e-8 &&
        f.matrix[0] > 0 &&
        f.matrix[3] > 0 &&
        f.matrix
          .slice(0, 4)
          .every((value, index) => Math.abs(value - (base.matrix[index] ?? NaN)) < 1e-8),
    );
  if (!eligible(selected)) return null;
  const em = base.fontSize * base.matrix[3];
  const compatible = (upper: Run, lower: Run): boolean => {
    const a = upper.fragments[0]?.fragment,
      b = lower.fragments[0]?.fragment;
    if (!a || !b || !eligible(lower) || !eligible(upper)) return false;
    const gap = a.matrix[5] - b.matrix[5];
    return Math.abs(a.matrix[4] - b.matrix[4]) < em * 0.3 && gap >= em * 0.9 && gap <= em * 1.7;
  };
  const index = runs.indexOf(selected);
  let from = index,
    to = index;
  while (from > 0 && compatible(runs[from - 1] ?? selected, runs[from] ?? selected)) from--;
  while (to + 1 < runs.length && compatible(runs[to] ?? selected, runs[to + 1] ?? selected)) to++;
  const members = runs.slice(from, to + 1),
    first = members[0]?.fragments[0]?.fragment;
  if (!first) return null;
  const page = document.getPage(selected.pageIndex),
    crop = page.getCropBox();
  const left = first.matrix[4],
    top = first.matrix[5] + em * 0.85;
  const right = Math.max(
    ...members.map(
      (run) => crop.x + (run.bounds?.x ?? 0) * crop.width + (run.bounds?.width ?? 0) * crop.width,
    ),
  );
  const bottom = Math.min(
    ...members.map(
      (run) =>
        crop.y +
        crop.height -
        (run.bounds?.y ?? 0) * crop.height -
        (run.bounds?.height ?? 0) * crop.height,
    ),
  );
  const lineHeight =
    members.length > 1
      ? (first.matrix[5] - (members.at(-1)?.fragments[0]?.fragment.matrix[5] ?? first.matrix[5])) /
        (members.length - 1)
      : em * 1.2;
  let maxWidth = crop.x + crop.width - left - 6,
    height = top - crop.y - 6;
  for (const other of runs) {
    if (members.includes(other) || !other.bounds) continue;
    const x = crop.x + other.bounds.x * crop.width,
      y = crop.y + crop.height - other.bounds.y * crop.height;
    const otherBottom = y - other.bounds.height * crop.height;
    if (x >= right - 0.01 && y > bottom && otherBottom < top)
      maxWidth = Math.min(maxWidth, x - left - em * 0.2);
    if (y <= bottom + 0.01 && x + other.bounds.width * crop.width > left)
      // Retain the existing clearance on closely spaced blocks. Requiring a
      // larger new margin would incorrectly reject an unchanged two-line area.
      height = Math.min(height, top - y - Math.min(em * 0.2, Math.max(0, bottom - y)));
  }
  const annotations = page.node.Annots();
  if (annotations?.size()) {
    for (const ref of annotations.asArray()) {
      const annotation = document.context.lookup(ref);
      const rect =
        annotation instanceof PDFDict
          ? annotation.lookupMaybe(PDFName.of('Rect'), PDFArray)
          : undefined;
      const values = rect
        ?.asArray()
        .map((value) => document.context.lookup(value))
        .map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN));
      if (values?.length !== 4 || !values.every(Number.isFinite)) return null;
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = values;
      if (
        Math.max(x0, x1) > left &&
        Math.min(x0, x1) < right &&
        Math.max(y0, y1) > bottom &&
        Math.min(y0, y1) < top
      )
        return null;
    }
  }
  // Without a full graphics/annotation obstacle map, never grow outside the
  // original paragraph rectangle on complex pages.
  if (!selected.growthSafe || (annotations?.size() ?? 0) > 0) {
    maxWidth = right - left;
    height = top - bottom;
  }
  if (
    !(height >= top - bottom - 0.01) ||
    !(maxWidth >= right - left - 0.01) ||
    left < crop.x ||
    top > crop.y + crop.height
  )
    return null;
  const text = members.map((run) => run.text.trim()).join(' ');
  if (text.length > 4096) return null;
  return {
    members,
    first,
    left,
    top,
    bottom,
    text,
    frame: { width: right - left, maxWidth, height, lineHeight, lineCount: members.length },
  };
}

export async function inspectSourceText(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<readonly SourceTextRun[]> {
  const document = await loadLocalTextDocument(bytes),
    runs = indexPage(document, pageIndex),
    crop = document.getPage(pageIndex).getCropBox();
  return runs.map((run) => {
    const paragraph = paragraphFor(document, runs, run);
    return {
      id: run.id,
      text: run.text,
      fontName: run.fontName,
      fontSize: run.fontSize,
      ...(paragraph
        ? {
            paragraph: {
              ...paragraph.frame,
              id: paragraph.members[0]?.id ?? run.id,
              text: paragraph.text,
              bounds: {
                x: (paragraph.left - crop.x) / crop.width,
                y: (crop.y + crop.height - paragraph.top) / crop.height,
                width: paragraph.frame.width / crop.width,
                height: (paragraph.top - paragraph.bottom) / crop.height,
              },
            },
          }
        : {}),
      pageIndex,
      ...(run.bounds ? { bounds: run.bounds } : {}),
    };
  });
}

export interface ParagraphReflowOptions {
  readonly width?: number;
  readonly height?: number;
}
const isReflowOptions = (value: unknown): value is ParagraphReflowOptions =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Replace source strings and typeset the containing uniform paragraph. No
 * covering paint, new font, shrinking, horizontal squeeze or rasterization. */
export async function reflowSourceText(
  bytes: Uint8Array,
  id: string,
  expectedText: string,
  replacement: string,
  range?: SourceTextRange,
  options: ParagraphReflowOptions = {},
): Promise<Uint8Array> {
  const rangeScope: unknown = range?.scope;
  if (
    !validText(expectedText) ||
    typeof replacement !== 'string' ||
    !replacement.length ||
    replacement.length > 4096 ||
    !/^[\x20-\x7e\n]+$/u.test(replacement) ||
    typeof id !== 'string' ||
    !isReflowOptions(options) ||
    (rangeScope !== undefined && rangeScope !== 'paragraph') ||
    !/^\d+:\d+:\d+$/u.test(id)
  )
    return fail('SOURCE_TEXT_INVALID_CHANGE');
  const document = await loadLocalTextDocument(bytes),
    pageIndex = Number(id.split(':')[0]);
  const runs = indexPage(document, pageIndex),
    run = runs.find((item) => item.id === id);
  if (run?.text !== expectedText) return fail('SOURCE_TEXT_STALE_CHANGE');
  const paragraph = paragraphFor(document, runs, run);
  if (!paragraph) return fail('SOURCE_TEXT_REFLOW_UNSUPPORTED');
  const width = options.width ?? paragraph.frame.width,
    height = options.height ?? paragraph.frame.height;
  if (
    ![width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    width > paragraph.frame.maxWidth + 0.01 ||
    height > paragraph.frame.height + 0.01
  )
    return fail('SOURCE_TEXT_REFLOW_INVALID_FRAME');
  const selectionText = range?.scope === 'paragraph' ? paragraph.text : run.text;
  if (range?.scope === 'paragraph' && paragraph.members[0] !== run)
    return fail('SOURCE_TEXT_INVALID_CHANGE');
  const start = range?.start ?? 0,
    end = range?.end ?? selectionText.length;
  if (
    ![start, end].every(Number.isSafeInteger) ||
    start < 0 ||
    end > selectionText.length ||
    start >= end
  )
    return fail('SOURCE_TEXT_INVALID_CHANGE');
  // Preserve the selected characters exactly; paragraph joins only infer the
  // whitespace between existing visual lines.
  const text =
    range?.scope === 'paragraph'
      ? paragraph.text.slice(0, start) + replacement + paragraph.text.slice(end)
      : paragraph.members
          .map((item) =>
            item === run
              ? (item.text.slice(0, start) + replacement + item.text.slice(end)).trim()
              : item.text.trim(),
          )
          .join(' ');
  if (text.length > 4096) return fail('SOURCE_TEXT_LIMIT');
  const first = paragraph.first,
    crop = document.getPage(pageIndex).getCropBox();
  const measure = (value: string) =>
    advanceText(first, value) * first.horizontalScale * first.matrix[0];
  const lines = wrapParagraph(text, width, measure);
  const em = first.fontSize * first.matrix[3];
  const usedHeight = (lines.length - 1) * paragraph.frame.lineHeight + em * 1.1;
  if (usedHeight > height + 0.01) return fail('SOURCE_TEXT_REFLOW_OVERFLOW');
  const members = new Set(paragraph.members),
    fragments = paragraph.members.flatMap((item) => item.fragments.map((part) => part.fragment));
  for (const [index, page] of document.getPages().entries()) {
    if (index === pageIndex) continue;
    const raw = page.node.get(PDFName.of('Contents')),
      value = document.context.lookup(raw);
    if (
      (value instanceof PDFArray ? value.asArray() : [raw]).some((ref) =>
        fragments.some((f) => ref?.toString() === f.stream.toString()),
      )
    )
      return fail('SOURCE_TEXT_SHARED_STREAM');
  }
  const outlines = snapshotOutlineStructures(document),
    mcid = first.mcid;
  if (document.catalog.has(PDFName.of('StructTreeRoot'))) {
    if (
      mcid === null ||
      runs.some(
        (item) => !members.has(item) && item.fragments.some((part) => part.fragment.mcid === mcid),
      )
    )
      return fail('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
    updateSourceTextAccessibility(document, {
      pageIndex,
      markedContentId: mcid,
      expectedText: paragraph.text,
      replacementText: text,
    });
  }
  const expectedTags = (await snapshotTagStructures(document))?.graph;
  const decimal = (value: number): string => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e12)
      return fail('SOURCE_TEXT_REFLOW_INVALID_FRAME');
    return value.toFixed(10);
  };
  const matrixText = (matrix: TextMatrix) => matrix.map(decimal).join(' ');
  let inserted = lines
    .map(
      (value, index) =>
        `${matrixText(moveTextMatrix(first.textMatrix, 0, (-index * paragraph.frame.lineHeight) / first.matrix[3]))} Tm [${first.codec.encode(value)}] TJ`,
    )
    .join('\n');
  const local = first.textMatrix,
    line = first.lineMatrix;
  const axis = line[0] * line[0] + line[1] * line[1];
  const before =
    ((local[4] - line[4]) * line[0] + (local[5] - line[5]) * line[1]) /
    axis /
    first.horizontalScale;
  const restore = -(((before + advanceText(first, first.text)) * 1000) / first.fontSize);
  inserted += `\n${matrixText(line)} Tm [${decimal(restore)}] TJ`;
  const patches = new Map<
    string,
    { fragment: Fragment; start: number; end: number; value: string }[]
  >();
  for (const fragment of fragments) {
    const encoded =
      fragment === first
        ? `<>] TJ ${inserted} [<>`
        : `<> ${decimal((-advanceText(fragment, fragment.text) * 1000) / fragment.fontSize)}`;
    const changes = patches.get(fragment.stream.toString()) ?? [];
    changes.push({
      fragment,
      start: fragment.token.start,
      end: fragment.operator.raw === 'Tj' ? fragment.operator.end : fragment.token.end,
      value: fragment.operator.raw === 'Tj' ? `[${encoded}] TJ` : encoded,
    });
    patches.set(fragment.stream.toString(), changes);
  }
  for (const changes of patches.values()) {
    const original = changes[0]?.fragment;
    if (!original) return fail();
    let changed = original.content;
    for (const patch of changes.sort((a, b) => b.start - a.start))
      changed = changed.slice(0, patch.start) + patch.value + changed.slice(patch.end);
    document.context.assign(original.stream, document.context.flateStream(changed));
  }
  const saved = await document.save({ updateFieldAppearances: false }),
    reopened = await PDFDocument.load(saved, { updateMetadata: false });
  assertOutlineStructuresPreserved(outlines, reopened);
  if (expectedTags !== (await snapshotTagStructures(reopened))?.graph)
    return fail('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
  const verified = indexPage(reopened, pageIndex).filter(
    (item) =>
      item.bounds &&
      item.fontName === first.fontName &&
      item.fontSize === first.fontSize &&
      item.bounds.x * crop.width + crop.x >= paragraph.left - 0.001 &&
      (item.bounds.x + item.bounds.width) * crop.width + crop.x <= paragraph.left + width + 0.001 &&
      crop.y + crop.height - item.bounds.y * crop.height <= paragraph.top + 0.001 &&
      crop.y + crop.height - (item.bounds.y + item.bounds.height) * crop.height >=
        paragraph.top - usedHeight - 0.001,
  );
  if (
    verified
      .map((item) => item.text)
      .join('')
      .replace(/\s/gu, '') !== text.replace(/\s/gu, '')
  )
    return fail('SOURCE_TEXT_VERIFICATION_FAILED');
  return saved;
}

export async function replaceSourceText(
  bytes: Uint8Array,
  id: string,
  expectedText: string,
  replacement: string,
  range?: SourceTextRange,
  fitToSpace = false,
): Promise<Uint8Array> {
  if (
    !validText(expectedText) ||
    !validText(replacement) ||
    typeof fitToSpace !== 'boolean' ||
    range?.scope !== undefined ||
    typeof id !== 'string' ||
    !/^\d+:\d+:\d+$/u.test(id)
  )
    return fail('SOURCE_TEXT_INVALID_CHANGE');
  const document = await loadLocalTextDocument(bytes);
  const pageIndex = Number(id.split(':')[0]);
  const runs = indexPage(document, pageIndex);
  const run = runs.find((item) => item.id === id);
  if (run?.text !== expectedText) return fail('SOURCE_TEXT_STALE_CHANGE');
  const startOffset = range?.start ?? 0,
    endOffset = range?.end ?? run.text.length;
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset < 0 ||
    endOffset > run.text.length ||
    startOffset >= endOffset
  )
    return fail('SOURCE_TEXT_INVALID_CHANGE');
  const affected = run.fragments.filter((part) => part.end > startOffset && part.start < endOffset);
  const first = affected[0],
    last = affected.at(-1);
  if (!first || !last || startOffset < first.start || endOffset > last.end)
    return fail('SOURCE_TEXT_SELECTION_UNSUPPORTED');
  // Refuse streams used by another page; never mutate a shared resource by accident.
  for (const [index, page] of document.getPages().entries())
    if (index !== pageIndex) {
      const raw = page.node.get(PDFName.of('Contents'));
      const value = document.context.lookup(raw);
      if (
        (value instanceof PDFArray ? value.asArray() : [raw]).some((ref) =>
          affected.some((part) => ref?.toString() === part.fragment.stream.toString()),
        )
      )
        return fail('SOURCE_TEXT_SHARED_STREAM');
    }
  const startPoint = textPoint(first.fragment, startOffset - first.start),
    endPoint = textPoint(last.fragment, endOffset - last.start);
  const basis = first.fragment.matrix,
    axisSquared = basis[0] * basis[0] + basis[1] * basis[1];
  const oldWidth =
    ((endPoint[0] - startPoint[0]) * basis[0] + (endPoint[1] - startPoint[1]) * basis[1]) /
    (axisSquared * first.fragment.horizontalScale);
  const newWidth = advanceText(first.fragment, replacement);
  if (![oldWidth, newWidth].every(Number.isFinite) || oldWidth < 0 || newWidth < 0)
    return fail('SOURCE_TEXT_INVALID_GEOMETRY');
  const needsFit = newWidth > oldWidth + 0.01;
  if (needsFit && !fitToSpace) return fail('SOURCE_TEXT_REPLACEMENT_TOO_WIDE');
  const originalScale = first.fragment.horizontalScale;
  const fittedPercent = needsFit
    ? Number(((100 * originalScale * oldWidth) / newWidth).toFixed(10))
    : originalScale * 100;
  if (needsFit && (!(oldWidth > 0) || !(fittedPercent > 0)))
    return fail('SOURCE_TEXT_INVALID_GEOMETRY');
  const fitRatio = fittedPercent / (100 * originalScale);
  const outlines = snapshotOutlineStructures(document);
  const changedText = run.text.slice(0, startOffset) + replacement + run.text.slice(endOffset);
  const mcid = first.fragment.mcid;
  if (document.catalog.has(PDFName.of('StructTreeRoot'))) {
    if (
      mcid === null ||
      runs.filter((item) => item.fragments.some((part) => part.fragment.mcid === mcid)).length !== 1
    )
      return fail('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
    updateSourceTextAccessibility(document, {
      pageIndex,
      markedContentId: mcid,
      expectedText,
      replacementText: changedText,
    });
  }
  const expectedTags = (await snapshotTagStructures(document))?.graph;
  const patches = new Map<
    string,
    { fragment: Fragment; start: number; end: number; value: string }[]
  >();
  for (const [index, part] of affected.entries()) {
    const fragment = part.fragment,
      from = Math.max(0, startOffset - part.start),
      to = Math.min(fragment.text.length, endOffset - part.start);
    const insertion = index === 0 ? replacement : '';
    const removedWidth = advanceText(fragment, fragment.text.slice(from, to));
    const adjustment = -(
      ((removedWidth - advanceText(fragment, insertion) * (index === 0 ? fitRatio : 1)) * 1000) /
      fragment.fontSize
    );
    const prefix = fragment.codec.encode(fragment.text.slice(0, from)),
      suffix = fragment.codec.encode(fragment.text.slice(to)),
      added = fragment.codec.encode(insertion);
    // Split the enclosing TJ array around the insertion, temporarily changing
    // only its horizontal scale. Restore Tz before compensation/suffix so text
    // and line matrices, following glyphs and later Td/T* operators stay intact.
    // This is genuine source replacement, not a covering rectangle or overlay.
    const encoded =
      index === 0 && needsFit
        ? `${prefix}] TJ ${fittedPercent.toFixed(10)} Tz [${added}] TJ ${(100 * originalScale).toFixed(10)} Tz [${adjustment.toFixed(8)} ${suffix}`
        : `${prefix} ${added} ${adjustment.toFixed(8)} ${suffix}`;
    const changes = patches.get(fragment.stream.toString()) ?? [];
    changes.push({
      fragment,
      start: fragment.token.start,
      end: fragment.operator.raw === 'Tj' ? fragment.operator.end : fragment.token.end,
      value: fragment.operator.raw === 'Tj' ? `[${encoded}] TJ` : encoded,
    });
    patches.set(fragment.stream.toString(), changes);
  }
  for (const changes of patches.values()) {
    const original = changes[0]?.fragment;
    if (!original) return fail();
    let changed = original.content;
    for (const patch of changes.sort((a, b) => b.start - a.start))
      changed = changed.slice(0, patch.start) + patch.value + changed.slice(patch.end);
    document.context.assign(original.stream, document.context.flateStream(changed));
  }
  const saved = await document.save({ updateFieldAppearances: false });
  const reopened = await PDFDocument.load(saved, { updateMetadata: false });
  assertOutlineStructuresPreserved(outlines, reopened);
  if (expectedTags !== (await snapshotTagStructures(reopened))?.graph)
    return fail('SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED');
  const verified = indexPage(reopened, pageIndex)
    .filter((item) => {
      if (!run.bounds || !item.bounds) return false;
      return (
        item.fontName === run.fontName &&
        item.fontSize === run.fontSize &&
        Math.abs(item.bounds.y - run.bounds.y) < 0.0001 &&
        item.bounds.x >= run.bounds.x - 0.0001 &&
        item.bounds.x + item.bounds.width <= run.bounds.x + run.bounds.width + 0.0001
      );
    })
    .map((item) => item.text)
    .join('')
    .replace(/\s/gu, '');
  if (verified !== changedText.replace(/\s/gu, '')) return fail('SOURCE_TEXT_VERIFICATION_FAILED');
  return saved;
}
