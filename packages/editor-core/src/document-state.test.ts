import { describe, expect, it } from 'vitest';

import {
  addAnnotationCommand,
  createInitialEditorDocument,
  duplicateEditorPageCommand,
  eraseInkAnnotationsCommand,
  rotateEditorPageCommand,
  rotateNormalizedPoint,
  rotateNormalizedRect,
  setFormValueCommand,
  transformAnnotationRect,
} from './document-state.js';
import { createInitialPageGraph } from './page-graph.js';
import { DocumentSession } from './session.js';

describe('normalized editor document state', () => {
  it('keeps coordinates stable through every quarter turn', () => {
    const point = { x: 0.2, y: 0.3 };
    let rotated = point;
    for (let index = 0; index < 4; index += 1) rotated = rotateNormalizedPoint(rotated, 90);
    expect(rotated.x).toBeCloseTo(point.x);
    expect(rotated.y).toBeCloseTo(point.y);
    expect(rotateNormalizedRect({ height: 0.2, width: 0.3, x: 0.1, y: 0.2 }, 90)).toEqual({
      height: 0.3,
      width: 0.2,
      x: 0.6,
      y: 0.1,
    });
  });

  it('rotates, duplicates, fills, undoes, and redoes without retaining document bytes', () => {
    const graph = createInitialPageGraph('source', 1, (index) => `page-${index}`);
    const session = new DocumentSession(
      { contentHash: 'synthetic', sourceId: 'source' },
      createInitialEditorDocument(graph),
    );
    session.execute(
      addAnnotationCommand(session.snapshot().state, {
        alignment: 'left',
        color: '#17232d',
        fontSize: 16,
        id: 'annotation-1',
        kind: 'text',
        pageId: 'page-0',
        rect: { height: 0.1, width: 0.25, x: 0.1, y: 0.2 },
        text: 'Synthetic overlay',
        variant: 'box',
      }),
    );
    session.execute(rotateEditorPageCommand(session.snapshot().state, 'page-0', true));
    expect(session.snapshot().state.annotations[0]?.rect).toEqual({
      height: 0.25,
      width: 0.1,
      x: 0.7,
      y: 0.1,
    });
    session.execute(
      addAnnotationCommand(session.snapshot().state, {
        color: '#26756f',
        id: 'stamp-1',
        kind: 'stamp',
        pageId: 'page-0',
        rect: { height: 0.1, width: 0.32, x: 0.2, y: 0.3 },
        source: 'custom',
        text: 'Reviewed locally',
      }),
    );
    session.execute(
      duplicateEditorPageCommand(
        session.snapshot().state,
        'page-0',
        'page-copy',
        () => 'annotation-copy',
      ),
    );
    expect(session.snapshot().state.annotations).toHaveLength(4);
    session.execute(
      setFormValueCommand(session.snapshot().state, {
        fieldName: 'synthetic.name',
        sourceId: 'source',
        type: 'text',
        value: 'Filled locally',
      }),
    );
    expect(session.snapshot().state.formValues[0]?.value).toBe('Filled locally');
    session.undo();
    expect(session.snapshot().state.formValues).toHaveLength(0);
    session.redo();
    expect(session.snapshot().state.formValues[0]?.value).toBe('Filled locally');
  });

  it('splits crossed ink into undoable fragments without changing other annotations', () => {
    const graph = createInitialPageGraph('source', 2, (index) => `page-${index}`);
    const before = {
      ...createInitialEditorDocument(graph),
      annotations: [
        {
          color: '#c65d3b',
          id: 'ink-main',
          kind: 'ink' as const,
          pageId: 'page-0',
          points: [
            { x: 0.1, y: 0.5 },
            { x: 0.9, y: 0.5 },
          ],
          rect: { height: 0.002, width: 0.8, x: 0.1, y: 0.5 },
          strokeWidth: 2,
        },
        {
          alignment: 'left' as const,
          color: '#17232d',
          fontSize: 16,
          id: 'text-main',
          kind: 'text' as const,
          pageId: 'page-0',
          rect: { height: 0.1, width: 0.2, x: 0.1, y: 0.1 },
          text: 'Keep me',
          variant: 'box' as const,
        },
        {
          color: '#c65d3b',
          id: 'ink-other-page',
          kind: 'ink' as const,
          pageId: 'page-1',
          points: [
            { x: 0.1, y: 0.5 },
            { x: 0.9, y: 0.5 },
          ],
          rect: { height: 0.002, width: 0.8, x: 0.1, y: 0.5 },
          strokeWidth: 2,
        },
      ],
    };
    const command = eraseInkAnnotationsCommand(
      before,
      'page-0',
      [{ x: 0.5, y: 0.5 }],
      0.08,
      () => 'ink-split',
    );
    expect(command).not.toBeNull();
    if (command === null) throw new Error('Expected the eraser command to be created.');
    const after = command.apply(before);
    const fragments = after.annotations.filter(
      (annotation) => annotation.kind === 'ink' && annotation.pageId === 'page-0',
    );
    expect(fragments).toHaveLength(2);
    expect(fragments.map(({ id }) => id)).toEqual(['ink-main', 'ink-split']);
    expect(after.annotations.find(({ id }) => id === 'text-main')).toEqual(before.annotations[1]);
    expect(after.annotations.find(({ id }) => id === 'ink-other-page')).toEqual(
      before.annotations[2],
    );
    expect(command.revert(after)).toEqual(before);
  });

  it('fully erases a covered stroke, ignores misses, and rejects unsafe eraser input', () => {
    const graph = createInitialPageGraph('source', 1, () => 'page-0');
    const before = {
      ...createInitialEditorDocument(graph),
      annotations: [
        {
          color: '#c65d3b',
          id: 'ink-main',
          kind: 'ink' as const,
          pageId: 'page-0',
          points: [
            { x: 0.45, y: 0.5 },
            { x: 0.55, y: 0.5 },
          ],
          rect: { height: 0.002, width: 0.1, x: 0.45, y: 0.5 },
          strokeWidth: 2,
        },
      ],
    };
    expect(
      eraseInkAnnotationsCommand(before, 'page-0', [{ x: 0.5, y: 0.5 }], 0.08, () => 'new')?.apply(
        before,
      ).annotations,
    ).toEqual([]);
    expect(
      eraseInkAnnotationsCommand(before, 'page-0', [{ x: 0.1, y: 0.1 }], 0.02, () => 'new'),
    ).toBeNull();
    expect(() => eraseInkAnnotationsCommand(before, 'page-0', [], 0.02, () => 'new')).toThrow();
    expect(() =>
      eraseInkAnnotationsCommand(before, 'page-0', [{ x: 0.5, y: 0.5 }], 0.5, () => 'new'),
    ).toThrow();
  });

  it('keeps point geometry aligned when an ink annotation is moved or resized', () => {
    const annotation = {
      color: '#26756f',
      id: 'ink-main',
      kind: 'ink' as const,
      pageId: 'page-0',
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ],
      rect: { height: 0.2, width: 0.2, x: 0.2, y: 0.3 },
      strokeWidth: 4,
    };
    expect(
      transformAnnotationRect(annotation, { height: 0.1, width: 0.4, x: 0.1, y: 0.2 }),
    ).toMatchObject({
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.3 },
      ],
      rect: { height: 0.1, width: 0.4, x: 0.1, y: 0.2 },
    });
  });
  it('SIGN-001 preserves box-relative drawn signature points through repeated moves and resizes', () => {
    const annotation = {
      id: 'drawn-signature',
      pageId: 'page-0',
      kind: 'visual-signature' as const,
      label: 'signature' as const,
      rect: { x: 0.5, y: 0.7, width: 0.36, height: 0.09 },
      appearance: {
        kind: 'drawn' as const,
        color: '#17232d',
        points: [
          { x: 0.1, y: 0.8 },
          { x: 0.9, y: 0.2 },
        ],
      },
    };
    const moved = transformAnnotationRect(annotation, { x: 0.1, y: 0.2, width: 0.2, height: 0.3 });
    const resized = transformAnnotationRect(moved, { x: 0.2, y: 0.1, width: 0.4, height: 0.5 });
    expect(resized).toMatchObject({ appearance: annotation.appearance });
    expect(annotation.rect).toEqual({ x: 0.5, y: 0.7, width: 0.36, height: 0.09 });
  });
});
