import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  transformAnnotationRect,
  type EditorAnnotation,
  type NormalizedRect,
} from '@pdfmason/editor-core';
import { PlaceableOverlay } from './placeable-overlay.js';
import { AnnotationPreview } from './annotation-preview.js';

const base = { id: 'synthetic', pageId: 'page', rect: { x: 0.2, y: 0.3, width: 0.3, height: 0.2 } };
const annotations: readonly EditorAnnotation[] = [
  { ...base, kind: 'markup', style: 'highlight', color: '#123456', opacity: 0.35 },
  { ...base, kind: 'markup', style: 'underline', color: '#123456', opacity: 0.9 },
  { ...base, kind: 'markup', style: 'strikeout', color: '#123456', opacity: 0.9 },
  {
    ...base,
    kind: 'ink',
    color: '#123456',
    strokeWidth: 4,
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.5 },
    ],
  },
  {
    ...base,
    kind: 'shape',
    shape: 'arrow',
    fillColor: null,
    strokeColor: '#123456',
    strokeWidth: 2,
    from: { x: 0.5, y: 0.3 },
    to: { x: 0.2, y: 0.5 },
  },
  {
    ...base,
    kind: 'comment',
    author: 'Synthetic',
    color: '#123456',
    createdAt: '2026-10-13T00:00:00Z',
    status: 'open',
    text: 'Synthetic comment',
  },
  { ...base, kind: 'stamp', color: '#123456', source: 'built-in', text: 'APPROVED' },
  { ...base, kind: 'utility-mark', color: '#123456', mark: 'date', text: '2026-10-13' },
  { ...base, kind: 'utility-mark', color: '#123456', mark: 'checkmark', text: 'Checkmark' },
  {
    ...base,
    kind: 'visual-signature',
    label: 'signature',
    appearance: {
      kind: 'drawn',
      color: '#123456',
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.9, y: 0.8 },
      ],
    },
  },
  {
    ...base,
    kind: 'visual-signature',
    label: 'initials',
    appearance: { kind: 'typed', color: '#123456', text: 'QA' },
  },
  {
    ...base,
    kind: 'visual-signature',
    label: 'signature',
    appearance: { kind: 'image', mimeType: 'image/png', bytes: new Uint8Array([1, 2]) },
  },
];
const pointer = { button: 0, isPrimary: true, pointerId: 7, clientX: 100, clientY: 100 };
describe('ANNO-001–006 SIGN-001/002 shared direct controls', () => {
  it.each(annotations.map((annotation, index) => ({ annotation, index })))(
    'moves/resizes annotation $index without placing another object or changing its appearance contract',
    ({ annotation }) => {
      const commit = vi.fn<(rect: NormalizedRect) => void>();
      const parent = vi.fn();
      const select = vi.fn();
      render(
        <div onPointerDown={parent} onPointerUp={parent}>
          <PlaceableOverlay
            rect={annotation.rect}
            name="Synthetic item"
            bodyClassName={`annotation-item--${annotation.kind}`}
            selected
            disabled={false}
            scope="stable"
            onSelect={select}
            onCommit={commit}
            onKeyDown={() => undefined}
          >
            {() => <span>Synthetic appearance</span>}
          </PlaceableOverlay>
        </div>,
      );
      const body = screen.getByRole('button', { name: /^Synthetic item\./u });
      const page = body.parentElement?.parentElement;
      if (page === null || page === undefined) throw new Error('Missing synthetic page');
      vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 500, 800));
      for (const button of screen.getAllByRole('button')) {
        button.setPointerCapture = vi.fn();
        button.hasPointerCapture = () => true;
        button.releasePointerCapture = vi.fn();
      }
      act(() => {
        fireEvent.pointerDown(body, pointer);
        fireEvent.pointerMove(body, { ...pointer, clientX: 150, clientY: 180 });
        expect(commit).not.toHaveBeenCalled();
        fireEvent.pointerUp(body, { ...pointer, clientX: 150, clientY: 180 });
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0]?.[0].x).toBeCloseTo(0.3);
      expect(commit.mock.calls[0]?.[0]).toMatchObject({ y: 0.4, width: 0.3, height: 0.2 });
      const corner = screen.getByRole('button', { name: /^Resize Synthetic item bottom right\./u });
      fireEvent.pointerDown(corner, pointer);
      fireEvent.pointerUp(corner, { ...pointer, clientX: 150, clientY: 180 });
      expect(commit).toHaveBeenCalledTimes(2);
      const resized = commit.mock.calls[1]?.[0];
      if (resized === undefined) throw new Error('Missing resize');
      expect(resized.width).toBeCloseTo(0.4);
      expect(resized.height).toBeCloseTo(0.3);
      const transformed = transformAnnotationRect(annotation, resized);
      expect(transformed.kind).toBe(annotation.kind);
      if (annotation.kind === 'visual-signature')
        expect(transformed).toMatchObject({ appearance: annotation.appearance });
      expect(parent).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledTimes(2);
      expect(screen.getAllByRole('button', { name: /^Resize /u })).toHaveLength(8);
    },
  );
  it('previews stored reverse-direction arrow endpoints rather than a fabricated diagonal', () => {
    const annotation = annotations[4];
    if (annotation === undefined) throw new Error('Missing arrow');
    const { container } = render(
      <AnnotationPreview
        annotation={annotation}
        pageMetrics={{ width: 500, height: 800, rotation: 0 }}
      />,
    );
    const line = container.querySelector('line');
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo(150);
    expect(Number(line?.getAttribute('y1'))).toBeCloseTo(0);
    expect(Number(line?.getAttribute('x2'))).toBeCloseTo(0);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(160);
    expect(line?.getAttribute('stroke-width')).toBe('2');
  });
  it('previews ink using full path, PDF-point thickness and affine geometry', () => {
    const annotation = annotations[3];
    if (annotation === undefined) throw new Error('Missing ink');
    const moved = transformAnnotationRect(annotation, { x: 0.1, y: 0.2, width: 0.6, height: 0.4 });
    const { container } = render(
      <AnnotationPreview
        annotation={moved}
        pageMetrics={{ width: 500, height: 800, rotation: 0 }}
      />,
    );
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 300 320');
    expect(container.querySelector('path')?.getAttribute('d')).toContain('M0 0 L300');
    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('4');
  });
});
