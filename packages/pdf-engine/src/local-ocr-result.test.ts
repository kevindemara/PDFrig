import { describe, expect, it } from 'vitest';
import { readLocalOcrWords } from './local-ocr-result.js';
const word = { text: 'FIXTURE', bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } };
const line = { baseline: { y0: 38 }, words: [word] };
const raw = { blocks: [{ paragraphs: [{ lines: [line] }] }] };
describe('OCR-001 bounded native JSON admission', () => {
  it('retains validated confidence for table review without changing word geometry', () => {
    const result = readLocalOcrWords(
      {
        blocks: [{ paragraphs: [{ lines: [{ ...line, words: [{ ...word, confidence: 64 }] }] }] }],
      },
      100,
      100,
    );
    expect(result[0]?.confidence).toBe(64);
    for (const confidence of [-1, 101, NaN, '90'])
      expect(() =>
        readLocalOcrWords(
          {
            blocks: [{ paragraphs: [{ lines: [{ ...line, words: [{ ...word, confidence }] }] }] }],
          },
          100,
          100,
        ),
      ).toThrow('OCR_OUTPUT_INVALID');
  });
  it('normalizes valid words without changing the raster', () => {
    expect(readLocalOcrWords(raw, 100, 100)).toEqual([
      { text: 'FIXTURE', x: 0.1, y: 0.2, width: 0.5, height: 0.2, baseline: 0.38 },
    ]);
  });
  it('rejects malformed structure, oversized text and invalid geometry with content-free errors', () => {
    for (const value of [
      null,
      { blocks: [null] },
      { blocks: [{ paragraphs: null }] },
      { blocks: [{ paragraphs: [{ lines: [null] }] }] },
      ...[
        { text: null },
        { text: 'x'.repeat(257) },
        { bbox: { ...word.bbox, x0: NaN } },
        { bbox: { ...word.bbox, x1: 101 } },
        { bbox: { ...word.bbox, x1: 1 } },
      ].map((patch) => ({
        blocks: [{ paragraphs: [{ lines: [{ ...line, words: [{ ...word, ...patch }] }] }] }],
      })),
    ])
      expect(() => readLocalOcrWords(value, 100, 100)).toThrow('OCR_OUTPUT_INVALID');
  });
  it('bounds every nested collection including blank words, not only accepted words', () => {
    expect(() => readLocalOcrWords({ blocks: Array(1001).fill({}) }, 100, 100)).toThrow(
      'OCR_OUTPUT_INVALID',
    );
    const blank = { text: ' ' };
    const lines = [
      { ...line, words: Array(6000).fill(blank) },
      { ...line, words: Array(6000).fill(blank) },
    ];
    expect(() => readLocalOcrWords({ blocks: [{ paragraphs: [{ lines }] }] }, 100, 100)).toThrow(
      'OCR_WORD_LIMIT',
    );
    expect(() => readLocalOcrWords({ blocks: [] }, 100, 100)).toThrow('OCR_NO_TEXT_FOUND');
  });
});
