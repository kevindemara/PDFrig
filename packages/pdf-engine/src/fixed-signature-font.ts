// SIGN-001/002: a fixed-font adapter, not a parser for arbitrary font files.
// Outline/metric data retain OFL-1.1. This adapter's original code is MIT.
export interface SignatureFontFacts {
  readonly schemaVersion: number;
  readonly dataName: string;
  readonly sourceFontSha256: string;
  readonly postscriptName: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly italicAngle: number;
  readonly familyClass: number;
  readonly italic: boolean;
  readonly isFixedPitch: boolean;
  readonly bbox: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
  readonly characters: readonly (readonly [number, number])[];
  readonly substitutions: readonly (readonly [readonly number[], number])[];
  readonly glyphs: readonly (readonly [number, number, string])[];
}

const unsupported = (): never => {
  throw new Error('EDIT_SIGNATURE_TEXT_UNSUPPORTED');
};
// These malformed mark-anchor pairs failed in the previous engine. Keep them
// refused instead of silently broadening the supported shaping contract.
const unsupportedPairs = new Set([
  '65:183',
  '65:795',
  '69:183',
  '69:795',
  '73:183',
  '73:795',
  '76:808',
  '79:183',
  '85:183',
  '97:183',
  '97:795',
  '100:183',
  '100:808',
  '101:183',
  '101:795',
  '105:183',
  '105:795',
  '108:808',
  '111:183',
  '113:795',
  '113:808',
  '116:183',
  '116:808',
  '117:183',
  '216:183',
  '248:183',
  '248:808',
  '305:183',
  '305:795',
]);

export const createFixedSignatureFont = (facts: SignatureFontFacts) => {
  const characters = new Map(facts.characters);
  const glyphs = new Map(
    facts.glyphs.map(([id, advanceWidth, svg]) => [
      id,
      {
        id,
        advanceWidth,
        path: { toSVG: () => svg },
      },
    ]),
  );
  const glyph = (id: number, codePoints: number[]) => {
    const value = glyphs.get(id);
    if (!value) return unsupported();
    return { ...value, codePoints };
  };
  // pdf-lib enumerates glyphs via this structural API. Internal private-use
  // enumeration keys include the eight ccmp outputs in ToUnicode/widths. They
  // are never admitted as signature input; their actual combining sequences
  // are emitted into the PDF CMap. No original font table is modified.
  const composed = new Map(
    facts.substitutions.map(([inputs, id], index) => [
      0x100000 + index,
      {
        id,
        codes: inputs.map(
          (input) => facts.characters.find(([, gid]) => gid === input)?.[0] ?? unsupported(),
        ),
      },
    ]),
  );
  const glyphForCodePoint = (code: number) => {
    const composition = composed.get(code);
    if (composition) return glyph(composition.id, [...composition.codes]);
    const id = characters.get(code);
    return id === undefined ? unsupported() : glyph(id, [code]);
  };
  return {
    postscriptName: facts.postscriptName,
    unitsPerEm: facts.unitsPerEm,
    ascent: facts.ascent,
    descent: facts.descent,
    capHeight: facts.capHeight,
    xHeight: facts.xHeight,
    italicAngle: facts.italicAngle,
    bbox: {
      ...facts.bbox,
      width: facts.bbox.maxX - facts.bbox.minX,
      height: facts.bbox.maxY - facts.bbox.minY,
    },
    'OS/2': { sFamilyClass: facts.familyClass },
    head: { macStyle: { italic: facts.italic } },
    post: { isFixedPitch: facts.isFixedPitch },
    characterSet: [...characters.keys(), ...composed.keys()],
    hasGlyphForCodePoint: (code: number) => characters.has(code),
    glyphForCodePoint,
    createSubset: (): never => {
      throw new Error('EDIT_SIGNATURE_FONT_SUBSETTING_UNSUPPORTED');
    },
    layout: (text: string) => {
      if (text.length > 200) return unsupported();
      const codes = Array.from(text, (char) => char.codePointAt(0) ?? unsupported());
      for (let i = 1; i < codes.length; i++)
        if (unsupportedPairs.has(`${codes[i - 1]}:${codes[i]}`)) return unsupported();
      const run = codes.map((code) => {
        // Preserve the previous fixed-font soft-hyphen normalization.
        const id = characters.get(code === 0xad ? 0x20 : code);
        return id === undefined ? unsupported() : glyph(id, [code]);
      });
      for (let i = 0; i < run.length; i++) {
        const rule = facts.substitutions.find(([inputs]) =>
          inputs.every((id, offset) => run[i + offset]?.id === id),
        );
        if (rule) {
          const codes = run.slice(i, i + rule[0].length).flatMap((item) => item.codePoints);
          run.splice(i, rule[0].length, glyph(rule[1], codes));
        }
      }
      return { glyphs: run };
    },
  };
};
