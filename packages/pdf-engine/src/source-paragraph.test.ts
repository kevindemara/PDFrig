import {
  PDFDocument,
  PDFName,
  StandardFonts,
  PDFArray,
  PDFDict,
  type PDFHexString,
} from '@cantoo/pdf-lib';
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspectSourceText, reflowSourceText, replaceSourceText } from './source-text.js';
async function fixture(graphics = false) {
  const doc = await PDFDocument.create(),
    page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { H: font.ref } }));
  const content = `${graphics ? '0.9 g 400 200 40 40 re f 0 g ' : ''}BT /H 18 Tf 22 TL 1 0 0 1 54 650 Tm (This is the first line of a short paragraph.) Tj T* (The second line keeps the same natural font.) Tj 1 0 0 1 54 350 Tm (UNCHANGED FOOTER) Tj ET`;
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}
describe('EDIT-002 real source paragraph reflow', () => {
  it('keeps restored logo clipping and benign repeated gs out of body-paragraph eligibility', async () => {
    const doc = await PDFDocument.load(await fixture()),
      page = doc.getPage(0);
    const resources = page.node.Resources();
    if (!resources) throw new Error('Missing resources');
    resources.set(
      PDFName.of('ExtGState'),
      doc.context.obj({
        Opaque: { ca: 1, CA: 1, BM: 'Normal', LW: 1, LC: 0, LJ: 0, ML: 10, SA: true },
        Unsupported: { SMask: 'None' },
      }),
    );
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(
        doc.context.flateStream(
          'q 0 0 30 30 re W* n /Unsupported gs 0.5 g 0 0 30 30 re f Q /Opaque gs BT /H 18 Tf 22 TL 1 0 0 1 54 650 Tm (This is the first line of a short paragraph.) Tj /Opaque gs T* (The second line keeps the same natural font.) Tj 1 0 0 1 54 350 Tm (UNCHANGED FOOTER) Tj ET q 0 740 30 30 re W n 0.5 g 0 740 30 30 re f Q',
        ),
      ),
    );
    const source = await doc.save(),
      runs = await inspectSourceText(source, 0),
      run = runs[0];
    if (!run?.paragraph) throw new Error('Restored logo state still blocked body');
    expect(run.paragraph.lineCount).toBe(2);
    expect(run.paragraphIssue).toBeUndefined();
    const result = await reflowSourceText(source, run.id, run.text, 'final', {
      start: 12,
      end: 17,
    });
    const after = await inspectSourceText(result, 0);
    expect(after[0]?.text).toContain('final');
    expect(after.at(-1)?.bounds).toEqual(runs.at(-1)?.bounds);
  });
  it.each([{ Font: [0, 18] }, { ca: 0 }, { BM: 'Multiply' }])(
    'still refuses a selected paragraph under unmodeled graphics state %j',
    async (state) => {
      const doc = await PDFDocument.load(await fixture()),
        page = doc.getPage(0),
        resources = page.node.Resources();
      if (!resources) throw new Error('Missing resources');
      resources.set(PDFName.of('ExtGState'), doc.context.obj({ State: state }));
      page.node.set(
        PDFName.of('Contents'),
        doc.context.register(
          doc.context.flateStream('/State gs BT /H 18 Tf 1 0 0 1 54 650 Tm (Visible words) Tj ET'),
        ),
      );
      const source = await doc.save(),
        run = (await inspectSourceText(source, 0))[0];
      if (!run) throw new Error('Missing line');
      expect(run.paragraphIssue).toBe('SOURCE_TEXT_REFLOW_GRAPHICS_STATE');
      await expect(reflowSourceText(source, run.id, run.text, 'EDIT')).rejects.toThrow(
        'REFLOW_GRAPHICS_STATE',
      );
    },
  );
  it('does not use stale inline font metrics after an external font override', async () => {
    const doc = await PDFDocument.load(await fixture()),
      page = doc.getPage(0),
      resources = page.node.Resources();
    if (!resources) throw new Error('Missing resources');
    resources.set(PDFName.of('ExtGState'), doc.context.obj({ Override: { Font: [0, 18] } }));
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(
        doc.context.flateStream('BT /H 18 Tf 1 0 0 1 54 650 Tm /Override gs (Unknown font) Tj ET'),
      ),
    );
    expect(await inspectSourceText(await doc.save(), 0)).toEqual([]);
  });
  it('restores text and line state with original character/word spacing and horizontal scale', async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { H: font.ref } }));
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(
        doc.context.flateStream(
          'BT /H 18 Tf 22 TL 1.3 Tc 2 Tw 90 Tz 1 0 0 1 54 650 Tm [(First ) -20 (paragraph line)] TJ T* (Second paragraph line) Tj 0.5 g T* (UNCHANGED FOOTER) Tj ET',
        ),
      ),
    );
    const bytes = await doc.save(),
      runs = await inspectSourceText(bytes, 0),
      first = runs[0];
    if (!first?.paragraph) throw new Error('Missing paragraph');
    const changed = await reflowSourceText(bytes, first.id, first.text, 'ONE\nTWO', {
      start: 0,
      end: first.paragraph.text.length,
      scope: 'paragraph',
    });
    const after = await inspectSourceText(changed, 0);
    expect(after.map((run) => run.text)).toEqual(['ONE', 'TWO', 'UNCHANGED FOOTER']);
    expect(after.at(-1)?.bounds).toEqual(runs.at(-1)?.bounds);
    expect(after.every((run) => run.fontSize === 18)).toBe(true);
  });
  it('does not reflow over unindexed hidden text or merge differently styled lines', async () => {
    const bytes = await fixture(),
      doc = await PDFDocument.load(bytes),
      page = doc.getPage(0);
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(
        doc.context.flateStream(
          'BT /H 18 Tf 1 0 0 1 54 650 Tm (Visible words) Tj 3 Tr 1 0 0 1 54 620 Tm (Hidden words) Tj ET',
        ),
      ),
    );
    const hidden = await doc.save(),
      run = (await inspectSourceText(hidden, 0))[0];
    if (!run) throw new Error('Missing visible line');
    expect(run.paragraph).toBeUndefined();
    await expect(reflowSourceText(hidden, run.id, run.text, 'EDIT')).rejects.toThrow(
      'REFLOW_UNINDEXED_TEXT',
    );
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(
        doc.context.flateStream(
          'BT /H 18 Tf 22 TL 1 0 0 1 54 650 Tm (First color) Tj 0.5 g T* (Second color) Tj ET',
        ),
      ),
    );
    expect(
      (await inspectSourceText(await doc.save(), 0)).map((item) => item.paragraph?.lineCount),
    ).toEqual([1, 1]);
  });
  it.each(['W', '/External gs'])(
    'refuses unmodeled clipping or external graphics state: %s',
    async (operator) => {
      const doc = await PDFDocument.load(await fixture()),
        page = doc.getPage(0);
      page.node.set(
        PDFName.of('Contents'),
        doc.context.register(
          doc.context.flateStream(
            `0 0 612 792 re ${operator} n BT /H 18 Tf 1 0 0 1 54 650 Tm (Visible words) Tj ET`,
          ),
        ),
      );
      const bytes = await doc.save(),
        run = (await inspectSourceText(bytes, 0))[0];
      if (!run) throw new Error('Missing line');
      expect(run.paragraph).toBeUndefined();
      await expect(reflowSourceText(bytes, run.id, run.text, 'EDIT')).rejects.toThrow(
        'REFLOW_GRAPHICS_STATE',
      );
    },
  );
  it('replaces a cross-line selection without losing words on either side', async () => {
    const source = await fixture(),
      run = (await inspectSourceText(source, 0))[0];
    if (!run?.paragraph) throw new Error('Missing paragraph');
    const start = run.paragraph.text.indexOf('short'),
      end = run.paragraph.text.indexOf('keeps');
    const range = { start, end, scope: 'paragraph' as const };
    const output = await reflowSourceText(
      source,
      run.id,
      run.text,
      'rewritten paragraph now ',
      range,
    );
    const after = await inspectSourceText(output, 0);
    expect(
      after
        .slice(0, -1)
        .map((item) => item.text)
        .join(' '),
    ).toBe('This is the first line of a rewritten paragraph now keeps the same natural font.');
    await expect(replaceSourceText(source, run.id, run.text, 'EDIT', range)).rejects.toThrow(
      'INVALID_CHANGE',
    );
  });
  it('refuses linked paragraphs and shared streams instead of changing other content', async () => {
    const source = await fixture(),
      doc = await PDFDocument.load(source),
      page = doc.getPage(0);
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [54, 640, 300, 670] }),
        ),
      ]),
    );
    const linked = await doc.save(),
      run = (await inspectSourceText(linked, 0))[0];
    if (!run) throw new Error('Missing line');
    expect(run.paragraph).toBeUndefined();
    await expect(reflowSourceText(linked, run.id, run.text, 'EDIT')).rejects.toThrow(
      'REFLOW_LINKED_AREA',
    );
    const shared = await PDFDocument.load(source);
    const sharedContents = shared.getPage(0).node.get(PDFName.of('Contents'));
    if (!sharedContents) throw new Error('Missing contents');
    shared.addPage([612, 792]).node.set(PDFName.of('Contents'), sharedContents);
    const bytes = await shared.save(),
      first = (await inspectSourceText(bytes, 0))[0];
    if (!first) throw new Error('Missing shared line');
    await expect(reflowSourceText(bytes, first.id, first.text, 'EDIT')).rejects.toThrow(
      'SHARED_STREAM',
    );
  });
  it('reflows the containing multi-line paragraph at unchanged font size and keeps other blocks fixed', async () => {
    const source = await fixture(),
      before = new Uint8Array(source),
      runs = await inspectSourceText(source, 0),
      selected = runs[0];
    if (!selected) throw new Error('Missing synthetic paragraph');
    expect(selected.paragraph?.lineCount).toBe(2);
    const output = await reflowSourceText(
      source,
      selected.id,
      selected.text,
      'a substantially longer introductory passage with natural wrapping',
      { start: 12, end: 17 },
      { width: 220 },
    );
    const after = await inspectSourceText(output, 0),
      footer = after.find((run) => run.text === 'UNCHANGED FOOTER');
    expect(footer?.bounds).toEqual(runs.find((run) => run.text === 'UNCHANGED FOOTER')?.bounds);
    const body = after.filter((run) => run !== footer);
    expect(body.length).toBeGreaterThan(2);
    expect(body.every((run) => run.fontSize === 18 && run.fontName === 'Helvetica')).toBe(true);
    expect(body.map((run) => run.text).join(' ')).toBe(
      'This is the a substantially longer introductory passage with natural wrapping line of a short paragraph. The second line keeps the same natural font.',
    );
    expect(source).toEqual(before);
  });
  it('reports overflow, invalid frame bounds and stale changes', async () => {
    const source = await fixture(),
      run = (await inspectSourceText(source, 0))[0];
    if (!run) throw new Error('Missing synthetic paragraph');
    await expect(
      reflowSourceText(source, run.id, run.text, 'word '.repeat(100), undefined, {
        width: 100,
        height: 20,
      }),
    ).rejects.toThrow('OVERFLOW');
    await expect(
      reflowSourceText(source, run.id, run.text, 'EDIT', undefined, { width: 10000 }),
    ).rejects.toThrow('INVALID_FRAME');
    await expect(reflowSourceText(source, run.id, 'stale', 'EDIT')).rejects.toThrow('STALE');
  });
  it('does not expand over unindexed graphical content', async () => {
    const source = await fixture(true),
      run = (await inspectSourceText(source, 0))[0];
    if (!run) throw new Error('Missing synthetic paragraph');
    expect(run.paragraph?.height).toBeCloseTo(41.8);
    await expect(reflowSourceText(source, run.id, run.text, 'word '.repeat(100))).rejects.toThrow(
      'OVERFLOW',
    );
  });
  it('preserves uniquely owned accessibility text and bookmarks', async () => {
    const source = await readFile(
      new URL('../../test-corpus/fixtures/tagged-bookmarks.pdf', import.meta.url),
    );
    const run = (await inspectSourceText(source, 0))[0];
    if (!run) throw new Error('Missing synthetic tagged paragraph');
    const result = await reflowSourceText(source, run.id, run.text, 'EDIT WORDS');
    const doc = await PDFDocument.load(result),
      root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const paragraph = root.lookup(PDFName.of('K'), PDFArray).lookup(0, PDFDict);
    expect((paragraph.get(PDFName.of('ActualText')) as PDFHexString).decodeText()).toBe(
      'EDIT WORDS',
    );
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(true);
  });
});
