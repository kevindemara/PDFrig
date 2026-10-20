import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createFixedSignatureFont } from './fixed-signature-font.js';
import { signatureFontFacts as facts } from './signature-font-facts.js';

describe('SIGN-001/002 parser-free, hash-bound script data', () => {
  it('retains the reviewed, independently regenerated OFL data without font-parser code', async () => {
    const source = (
      await readFile(new URL('./signature-font-facts.ts', import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n');
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      '92d6d2876a9f1033e59d7cbb0ef80e99d2d250f4453581ba9310cb1f0249c50d',
    );
    expect(facts.dataName).toBe('PDFrig Script Preview');
    expect(source).toContain('SIL OFL-1.1');
    expect(facts.characters).toHaveLength(559);
    expect(facts.glyphs).toHaveLength(567);
    expect(facts.substitutions).toHaveLength(8);
    expect(facts.sourceFontSha256).toBe(
      '21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c',
    );
    for (const [id, advance, path] of facts.glyphs) {
      expect(Number.isInteger(id) && id > 0 && id < 65536).toBe(true);
      expect(Number.isFinite(advance) && advance >= 0).toBe(true);
      expect(path).toMatch(/^[MLQCZ0-9 .-]*$/u);
    }
  });

  it('matches the previous engine across every supported two-character input', () => {
    const font = createFixedSignatureFont(facts);
    const digest = createHash('sha256');
    let successes = 0,
      refused = 0;
    for (const [a] of facts.characters)
      for (const [b] of facts.characters) {
        let run;
        try {
          run = font.layout(String.fromCodePoint(a, b));
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'EDIT_SIGNATURE_TEXT_UNSUPPORTED')
            throw error;
          digest.update(`${a}:${b}:refused\n`);
          refused++;
          continue;
        }
        digest.update(
          `${a}:${b}:${run.glyphs.map((glyph) => `${glyph.id},${glyph.advanceWidth}`).join(';')}\n`,
        );
        successes++;
      }
    // Captured from fontkit 2.0.4 before removing it. No library code retained.
    expect(digest.digest('hex')).toBe(
      '93bb104eb5236acf2d9bd5c8fa0034554b13fe122bace61a3e35120fb61f262f',
    );
    expect(successes).toBe(312452);
    expect(refused).toBe(29);
  }, 10000);

  it('keeps composition CMaps accurate without admitting private enumeration keys as input', () => {
    const font = createFixedSignatureFont(facts);
    for (const [inputs, id] of facts.substitutions) {
      const codes = inputs.map(
        (input) => facts.characters.find(([, gid]) => gid === input)?.[0] ?? 0,
      );
      const run = font.layout(String.fromCodePoint(...codes));
      expect(run.glyphs.map((glyph) => glyph.id)).toEqual([id]);
      expect(run.glyphs[0]?.codePoints).toEqual(codes);
      const key = font.characterSet.find(
        (code) => code >= 0x100000 && font.glyphForCodePoint(code).id === id,
      );
      expect(key).toBeDefined();
      expect(font.glyphForCodePoint(key ?? 0).codePoints).toEqual(codes);
      expect(font.hasGlyphForCodePoint(key ?? 0)).toBe(false);
      expect(() => font.layout(String.fromCodePoint(key ?? 0))).toThrow(
        'EDIT_SIGNATURE_TEXT_UNSUPPORTED',
      );
    }
    expect(font.layout('\u00ad').glyphs[0]?.id).toBe(font.glyphForCodePoint(32).id);
    expect(font.hasGlyphForCodePoint(0xffff)).toBe(false);
    expect(() => font.createSubset()).toThrow('EDIT_SIGNATURE_FONT_SUBSETTING_UNSUPPORTED');
  });
});
