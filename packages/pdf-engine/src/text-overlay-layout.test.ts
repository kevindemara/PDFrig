import { describe, expect, it } from 'vitest';
import type { TextAnnotation } from '@pdfmason/editor-core';
import { readFile } from 'node:fs/promises';
import { exportEditedPdf } from './editing.js';
import { getOverlayFontMetrics, layoutTextOverlay } from './text-overlay-layout.js';

const annotation: TextAnnotation = {
  id: 'synthetic-text',
  pageId: 'page',
  kind: 'text',
  text: 'One two three four five six',
  rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.3 },
  fontSize: 18,
  alignment: 'left',
  color: '#17232D',
  variant: 'box',
};
describe('EDIT-001 shared point-based overlay layout', () => {
  it('uses unkerned Tj glyph advances, not the fork’s kerned measurement', async () => {
    const metrics = await getOverlayFontMetrics();
    expect(metrics.width('AVATAR To WA', 18)).toBeCloseTo(
      Array.from('AVATAR To WA').reduce((sum, glyph) => sum + metrics.width(glyph, 18), 0),
    );
  });
  it.each(['left', 'center', 'right'] as const)(
    'wraps with %s alignment without changing text or size',
    async (alignment) => {
      const metrics = await getOverlayFontMetrics();
      const input = {
        ...annotation,
        alignment,
        text: 'One two three four five six\n\nAnother line',
      };
      const layout = layoutTextOverlay(input, 612, 792, metrics);
      expect(layout.lines.length).toBeGreaterThan(3);
      expect(layout.fontSize).toBe(18);
      expect(layout.fits).toBe(true);
      expect(
        layout.lines
          .slice(
            0,
            layout.lines.findIndex((line) => line.text === ''),
          )
          .map((line) => line.text)
          .join(''),
      ).toBe('One two three four five six');
      expect(layout.lines[0]?.baseline).toBeCloseTo(4 + metrics.ascent(18));
      for (const line of layout.lines) {
        const extra = layout.width - 8 - line.width;
        expect(line.x).toBeCloseTo(
          4 + (alignment === 'center' ? extra / 2 : alignment === 'right' ? extra : 0),
        );
        expect(line.width).toBeLessThanOrEqual(layout.width - 8);
      }
    },
  );
  it('preserves blank lines, CRLF, repeated spaces and breaks long words deterministically', async () => {
    const metrics = await getOverlayFontMetrics();
    const input = {
      ...annotation,
      text: 'Longwordwithoutanyspacesatall\r\n\r\nA  B',
      rect: { ...annotation.rect, width: 0.1, height: 0.8 },
    };
    const layout = layoutTextOverlay(input, 612, 792, metrics);
    expect(layout.lines.map((line) => line.text).join('')).toBe(
      'LongwordwithoutanyspacesatallA  B',
    );
    expect(layout.lines.filter((line) => line.text === '')).toHaveLength(1);
    expect(layout.fits).toBe(true);
    expect(layoutTextOverlay(input, 612, 792, metrics)).toEqual(layout);
  });
  it('never silently shrinks font size or drops overflowing text', async () => {
    const metrics = await getOverlayFontMetrics();
    const input = { ...annotation, rect: { ...annotation.rect, width: 0.03, height: 0.02 } };
    const layout = layoutTextOverlay(input, 612, 792, metrics);
    expect(layout.fits).toBe(false);
    expect(layout.fontSize).toBe(annotation.fontSize);
    expect(layout.lines.map((line) => line.text).join('')).toBe(annotation.text);
  });
  it('supports WinAnsi punctuation and empty text but refuses substituted glyphs', async () => {
    const metrics = await getOverlayFontMetrics();
    expect(
      layoutTextOverlay({ ...annotation, text: 'Café € – “yes”' }, 612, 792, metrics).fits,
    ).toBe(true);
    expect(layoutTextOverlay({ ...annotation, text: '' }, 612, 792, metrics).lines).toEqual([]);
    for (const text of ['汉字', '🙂', '\t', 'a'.repeat(2001)])
      expect(() => layoutTextOverlay({ ...annotation, text }, 612, 792, metrics)).toThrow(
        'EDIT_TEXT_ENCODING_UNSUPPORTED',
      );
  });
  it('rejects invalid geometry and font sizes', async () => {
    const metrics = await getOverlayFontMetrics();
    for (const size of [NaN, Infinity, 0, 5, 97])
      expect(() => layoutTextOverlay({ ...annotation, fontSize: size }, 612, 792, metrics)).toThrow(
        'EDIT_TEXT_LAYOUT_INVALID',
      );
    for (const width of [0, -1, NaN, Infinity])
      expect(() =>
        layoutTextOverlay(
          { ...annotation, rect: { ...annotation.rect, width } },
          612,
          792,
          metrics,
        ),
      ).toThrow('EDIT_TEXT_LAYOUT_INVALID');
  });
  it.each(['overflow', 'encoding'] as const)(
    'blocks %s export without modifying the source',
    async (kind) => {
      const bytes = new Uint8Array(
        await readFile(new URL('../../test-corpus/fixtures/smoke-one-page.pdf', import.meta.url)),
      );
      const original = bytes.slice();
      await expect(
        exportEditedPdf({
          sources: [{ sourceId: 'source', bytes }],
          pages: [{ pageId: 'page', sourceId: 'source', sourcePageIndex: 0, rotation: 0 }],
          formValues: [],
          options: { flattenForms: false },
          annotations: [
            {
              ...annotation,
              ...(kind === 'overflow'
                ? { rect: { ...annotation.rect, height: 0.01 } }
                : { text: '🙂' }),
            },
          ],
        }),
      ).rejects.toThrow(
        kind === 'overflow' ? 'EDIT_TEXT_BOX_TOO_SMALL' : 'EDIT_TEXT_ENCODING_UNSUPPORTED',
      );
      expect(bytes).toEqual(original);
    },
  );
});
