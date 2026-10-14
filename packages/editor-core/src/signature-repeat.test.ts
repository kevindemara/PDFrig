import { describe, expect, it } from 'vitest';
import {
  addAnnotationCommand,
  createInitialEditorDocument,
  type VisualSignatureAnnotation,
} from './document-state.js';
import { createInitialPageGraph } from './page-graph.js';
import { repeatVisualSignatureCommand, signatureRepeatPageIndices } from './signature-repeat.js';
import { DocumentSession } from './session.js';

const mark: VisualSignatureAnnotation = {
  id: 'mark',
  pageId: 'page-0',
  kind: 'visual-signature',
  label: 'signature',
  appearance: { kind: 'typed', color: '#17232d', text: 'Synthetic Reviewer' },
  rect: { x: 0.5, y: 0.76, width: 0.36, height: 0.09 },
};
const state = (annotation = mark, count = 4) =>
  addAnnotationCommand(
    createInitialEditorDocument(
      createInitialPageGraph('source', count, (index) => `page-${index}`),
    ),
    annotation,
  ).apply(createInitialEditorDocument({ pages: [] }));
const makeIds = () => {
  let index = 0;
  return () => `copy-${++index}`;
};

describe('SIGN-003 bounded explicit session reuse', () => {
  it('previews without mutation and applies all copies in one undoable command', () => {
    const before = state();
    const command = repeatVisualSignatureCommand(before, mark.id, ['page-2', 'page-1'], makeIds());
    const preview = command.apply(before);
    expect(before.annotations).toEqual([mark]);
    expect(preview.annotations.map(({ pageId }) => pageId)).toEqual(['page-0', 'page-2', 'page-1']);
    expect(preview.formValues).toBe(before.formValues);
    expect(preview.pageGraph).toBe(before.pageGraph);
    expect(preview.measurements).toBe(before.measurements);
    expect(new Set(preview.annotations.map(({ id }) => id)).size).toBe(3);
    for (const copy of preview.annotations.slice(1)) expect(copy.rect).toEqual(mark.rect);
    const session = new DocumentSession({ sourceId: 'source', contentHash: 'synthetic' }, before);
    session.execute(command);
    expect(session.snapshot().state).toBe(preview);
    expect(session.undo().state).toBe(before);
    expect(session.redo().state).toBe(preview);
  });
  it('resolves deterministic ranges, refuses duplicates and enforces 20 / 500 page bounds', () => {
    expect(signatureRepeatPageIndices('4, 2-3', 4)).toEqual([1, 2, 3]);
    expect(signatureRepeatPageIndices('2-21', 500)).toHaveLength(20);
    expect(signatureRepeatPageIndices('500', 500)).toEqual([499]);
    for (const range of [
      '',
      'all',
      '0',
      '01',
      '5',
      '3-2',
      '2,2',
      '1-2,2-3',
      '1;2',
      '2-22',
      '1,'.repeat(130),
      'NaN',
      '<script>',
    ])
      expect(() => signatureRepeatPageIndices(range, 4)).toThrow('SIGNATURE_REPEAT_INVALID');
    expect(() => signatureRepeatPageIndices('1-21', 500)).toThrow();
    expect(() => signatureRepeatPageIndices('1', 501)).toThrow();
    expect(() => signatureRepeatPageIndices('1', 0)).toThrow();
  });
  it('rejects stale, duplicate, occupied and missing targets before modifying state', () => {
    const before = state();
    for (const targets of [[], ['page-0'], ['missing'], ['page-1', 'page-1']]) {
      expect(() => repeatVisualSignatureCommand(before, mark.id, targets, makeIds())).toThrow(
        'SIGNATURE_REPEAT_INVALID',
      );
      expect(before.annotations).toHaveLength(1);
    }
    expect(() => repeatVisualSignatureCommand(before, 'missing', ['page-1'], makeIds())).toThrow();
    const occupied = {
      ...before,
      annotations: [...before.annotations, { ...mark, id: 'other', pageId: 'page-1' }],
    };
    expect(() => repeatVisualSignatureCommand(occupied, mark.id, ['page-1'], makeIds())).toThrow();
  });
  it('copies image bytes once and isolates the proposed output from later input mutation', () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const before = state({ ...mark, appearance: { kind: 'image', bytes, mimeType: 'image/png' } });
    const proposed = repeatVisualSignatureCommand(
      before,
      mark.id,
      ['page-1', 'page-2'],
      makeIds(),
    ).apply(before);
    bytes.fill(0);
    const first = proposed.annotations[1];
    const second = proposed.annotations[2];
    if (
      first?.kind !== 'visual-signature' ||
      first.appearance.kind !== 'image' ||
      second?.kind !== 'visual-signature'
    )
      throw new Error('Missing copy');
    expect([...first.appearance.bytes]).toEqual([137, 80, 78, 71]);
    expect(first.appearance).toBe(second.appearance);
  });
  it('freezes drawn appearances and preserves relative placement for rotated graph pages', () => {
    const points = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.8 },
    ];
    const before = state({ ...mark, appearance: { kind: 'drawn', color: '#17232d', points } });
    const rotated = {
      ...before,
      pageGraph: {
        pages: before.pageGraph.pages.map((page) => ({ ...page, rotation: 90 as const })),
      },
    };
    const copy = repeatVisualSignatureCommand(rotated, mark.id, ['page-1'], makeIds()).apply(
      rotated,
    ).annotations[1];
    points[0] = { x: 0, y: 0 };
    if (copy?.kind !== 'visual-signature' || copy.appearance.kind !== 'drawn')
      throw new Error('Missing copy');
    expect(copy.rect).toEqual(mark.rect);
    expect(copy.appearance.points[0]).toEqual({ x: 0.1, y: 0.2 });
    expect(Object.isFrozen(copy.appearance.points)).toBe(true);
  });
  it('rejects repeated identifiers, unsafe geometry, oversized appearances and annotation overflow', () => {
    const before = state();
    for (const createId of [() => mark.id, () => '', () => 'same']) {
      expect(() =>
        repeatVisualSignatureCommand(before, mark.id, ['page-1', 'page-2'], createId),
      ).toThrow();
    }
    for (const rect of [
      { ...mark.rect, width: NaN },
      { ...mark.rect, x: 0.9 },
      { ...mark.rect, height: 0 },
    ])
      expect(() =>
        repeatVisualSignatureCommand(
          { ...before, annotations: [{ ...mark, rect }] },
          mark.id,
          ['page-1'],
          makeIds(),
        ),
      ).toThrow();
    expect(() =>
      repeatVisualSignatureCommand(
        state({ ...mark, appearance: { kind: 'typed', color: '#17232d', text: 'x'.repeat(201) } }),
        mark.id,
        ['page-1'],
        makeIds(),
      ),
    ).toThrow();
    const many = {
      ...before,
      annotations: Array.from({ length: 1_000 }, (_, index) => ({
        ...mark,
        id: index === 0 ? mark.id : `existing-${index}`,
      })),
    };
    expect(() => repeatVisualSignatureCommand(many, mark.id, ['page-1'], makeIds())).toThrow();
    const large = state(mark, 22);
    expect(() =>
      repeatVisualSignatureCommand(
        large,
        mark.id,
        large.pageGraph.pages.slice(1).map(({ id }) => id),
        makeIds(),
      ),
    ).toThrow();
  });
});
