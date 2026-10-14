import { describe, expect, it } from 'vitest';
import { matchSourceTextSelection } from './source-text-selection.js';
const runs = [
  {
    id: '0:0:1',
    pageIndex: 0,
    text: 'FIRST SOURCE AFTER',
    fontName: 'Helvetica',
    fontSize: 18,
    bounds: { x: 0.1, y: 0.2, width: 0.7, height: 0.03 },
  },
  {
    id: '0:0:2',
    pageIndex: 0,
    text: 'SECOND SOURCE AFTER',
    fontName: 'Helvetica',
    fontSize: 18,
    bounds: { x: 0.1, y: 0.4, width: 0.7, height: 0.03 },
  },
];
describe('EDIT-002 viewer selection ownership', () => {
  it('retains literal selected spaces, punctuation and the final character', () => {
    const first = runs[0];
    if (!first) throw new Error('Missing synthetic line');
    const run = { ...first, text: 'BEFORE SOURCE, AFTER' };
    for (const [text, start, end] of [
      ['SOURCE,', 7, 14],
      [' SOURCE, ', 6, 15],
      ['SOURC', 7, 12],
    ] as const) {
      expect(
        matchSourceTextSelection([run], {
          text,
          rect: { x: 0.3, y: 0.2, width: 0.2, height: 0.02 },
        }),
      ).toEqual({ id: run.id, start, end });
      expect(run.text.slice(start, end)).toBe(text);
    }
  });
  it('uses the selected page region to choose the correct repeated word', () => {
    expect(
      matchSourceTextSelection(runs, {
        text: 'SOURCE',
        rect: { x: 0.3, y: 0.4, width: 0.2, height: 0.02 },
      }),
    ).toEqual({ id: '0:0:2', start: 7, end: 13 });
  });
  it('tolerates reader-inferred whitespace without changing case or choosing unrelated text', () => {
    expect(
      matchSourceTextSelection(runs, {
        text: 'SECOND\n SOURCE',
        rect: { x: 0.2, y: 0.4, width: 0.3, height: 0.02 },
      }),
    ).toEqual({ id: '0:0:2', start: 0, end: 13 });
    for (const text of ['source', 'OTHER', 'FIRST SOURCE AFTER SECOND SOURCE AFTER'])
      expect(
        matchSourceTextSelection(runs, {
          text,
          rect: { x: 0.3, y: 0.4, width: 0.2, height: 0.02 },
        }),
      ).toBeNull();
  });
  it('refuses ambiguous repeats in one line rather than guessing', () => {
    expect(
      matchSourceTextSelection(
        [
          {
            ...runs[0],
            id: 'x',
            pageIndex: 0,
            text: 'SOURCE SOURCE',
            fontName: 'Helvetica',
            fontSize: 18,
          },
        ],
        { text: 'SOURCE', rect: { x: 0.2, y: 0.2, width: 0.2, height: 0.02 } },
      ),
    ).toBeNull();
  });
});
