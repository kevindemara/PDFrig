import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedRect, TextAnnotation } from '@pdfmason/editor-core';
import { TextOverlay, transformTextBox } from './text-overlay.js';

const annotation: TextAnnotation = {
  id: 'text-one',
  pageId: 'page-one',
  kind: 'text',
  alignment: 'left',
  color: '#17232D',
  fontSize: 18,
  text: 'Synthetic text',
  variant: 'box',
  rect: { x: 0.2, y: 0.3, width: 0.3, height: 0.2 },
};
const bounds = new DOMRect(10, 20, 500, 800);
const pointer = { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100 };
const setup = () => {
  const onCommit = vi.fn<(rect: NormalizedRect) => void>();
  const onSelect = vi.fn();
  const onKeyDown = vi.fn();
  const props = {
    annotation,
    disabled: false,
    selected: true,
    scope: 'one',
    pageMetrics: { width: 500, height: 800, rotation: 0 },
    onCommit,
    onSelect,
    onKeyDown,
  };
  const view = render(
    <div>
      <TextOverlay {...props} />
    </div>,
  );
  const box = screen.getByRole('button', { name: /^Text overlay/u });
  const root = box.parentElement;
  const page = root?.parentElement;
  if (root === null || page === null || page === undefined)
    throw new Error('Missing synthetic overlay');
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(bounds);
  for (const button of screen.getAllByRole('button')) {
    button.setPointerCapture = vi.fn();
    button.hasPointerCapture = vi.fn(() => true);
    button.releasePointerCapture = vi.fn();
  }
  return { ...view, props, onCommit, onSelect, onKeyDown, root, box, page };
};

describe('EDIT-001 direct text-box manipulation', () => {
  it('moves by exact displayed-page fractions and commits once even for batched events', () => {
    const test = setup();
    act(() => {
      fireEvent.pointerDown(test.box, pointer);
      fireEvent.pointerMove(test.box, { ...pointer, clientX: 137, clientY: 119 });
      expect(test.onCommit).not.toHaveBeenCalled();
      fireEvent.pointerUp(test.box, { ...pointer, clientX: 137, clientY: 119 });
    });
    expect(test.onCommit).toHaveBeenCalledTimes(1);
    expect(test.onCommit).toHaveBeenCalledWith({ x: 0.274, y: 0.32375, width: 0.3, height: 0.2 });
    expect(test.onSelect).toHaveBeenCalledTimes(1);
  });
  it.each(['pointerCancel', 'lostPointerCapture', 'Escape'] as const)(
    'cancels %s without a command',
    (kind) => {
      const test = setup();
      fireEvent.pointerDown(test.box, pointer);
      fireEvent.pointerMove(test.box, { ...pointer, clientX: 180 });
      if (kind === 'Escape') fireEvent.keyDown(test.box, { key: 'Escape' });
      else if (kind === 'pointerCancel') fireEvent.pointerCancel(test.box, pointer);
      else fireEvent.lostPointerCapture(test.box, pointer);
      fireEvent.pointerUp(test.box, { ...pointer, clientX: 180 });
      expect(test.onCommit).not.toHaveBeenCalled();
      expect(test.root.style.left).toBe('20%');
    },
  );
  it('ignores other pointers, right clicks, and no-op releases', () => {
    const test = setup();
    fireEvent.pointerDown(test.box, { ...pointer, button: 2 });
    fireEvent.pointerUp(test.box, { ...pointer, clientX: 180 });
    fireEvent.pointerDown(test.box, pointer);
    fireEvent.pointerDown(test.box, { ...pointer, pointerId: 2 });
    fireEvent.pointerMove(test.box, { ...pointer, pointerId: 2, clientX: 180 });
    fireEvent.pointerCancel(test.box, { ...pointer, pointerId: 2 });
    fireEvent.pointerUp(test.box, pointer);
    expect(test.onCommit).not.toHaveBeenCalled();
    const corner = screen.getByRole('button', { name: /^Resize text box bottom right\./u });
    fireEvent.pointerDown(corner, pointer);
    fireEvent.pointerUp(corner, pointer);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Resize text box top\./u }), {
      key: 'ArrowRight',
    });
    expect(test.onCommit).not.toHaveBeenCalled();
  });
  it('exposes eight independent accessible resize controls and preserves focus', () => {
    const test = setup();
    const controls = screen.getAllByRole('button', { name: /^Resize text box/u });
    expect(controls).toHaveLength(8);
    const right = screen.getByRole('button', { name: /^Resize text box right\./u });
    right.focus();
    fireEvent.keyDown(right, { key: 'ArrowRight' });
    expect(test.onCommit.mock.calls[0]?.[0].width).toBeCloseTo(0.301);
    const resized = test.onCommit.mock.calls[0]?.[0];
    if (resized === undefined) throw new Error('Missing resize');
    test.rerender(
      <div>
        <TextOverlay {...test.props} scope="two" annotation={{ ...annotation, rect: resized }} />
      </div>,
    );
    expect(right).toHaveFocus();
    fireEvent.keyDown(right, { key: 'ArrowRight', shiftKey: true });
    expect(test.onCommit.mock.calls[1]?.[0].width).toBeCloseTo(0.311);
  });
  it('discards stale input after a document-state or permission change', () => {
    const test = setup();
    fireEvent.pointerDown(test.box, pointer);
    fireEvent.pointerMove(test.box, { ...pointer, clientX: 180 });
    test.rerender(
      <div>
        <TextOverlay {...test.props} scope="two" />
      </div>,
    );
    expect(test.root.style.left).toBe('20%');
    fireEvent.pointerUp(test.box, { ...pointer, clientX: 180 });
    expect(test.onCommit).not.toHaveBeenCalled();
    test.rerender(
      <div>
        <TextOverlay {...test.props} disabled scope="three" />
      </div>,
    );
    expect(test.box).toBeDisabled();
    expect(
      screen
        .getAllByRole('button', { name: /^Resize text box/u })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true);
  });
  it('discards input when the captured page geometry changes', () => {
    const test = setup();
    fireEvent.pointerDown(test.box, pointer);
    vi.spyOn(test.page, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 600, 800));
    fireEvent.pointerUp(test.box, { ...pointer, clientX: 180 });
    expect(test.onCommit).not.toHaveBeenCalled();
  });
  it.each(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)(
    'resizes %s without moving its opposite edge',
    (mode) => {
      const result = transformTextBox(annotation.rect, mode, 0.01, 0.015);
      expect(result.x).toBeCloseTo(mode.includes('w') ? 0.21 : 0.2);
      expect(result.y).toBeCloseTo(mode.includes('n') ? 0.315 : 0.3);
      expect(result.x + result.width).toBeCloseTo(mode.includes('e') ? 0.51 : 0.5);
      expect(result.y + result.height).toBeCloseTo(mode.includes('s') ? 0.515 : 0.5);
    },
  );
  it('clamps movement and resizing to the page with non-inverted minimum dimensions', () => {
    expect(transformTextBox(annotation.rect, 'move', 8, -8)).toEqual({
      ...annotation.rect,
      x: 0.7,
      y: 0,
    });
    const collapsed = transformTextBox(annotation.rect, 'nw', 8, 8);
    expect(collapsed.width).toBeCloseTo(0.02);
    expect(collapsed.height).toBeCloseTo(0.02);
    const expanded = transformTextBox(annotation.rect, 'se', 8, 8);
    expect(expanded).toEqual({ x: 0.2, y: 0.3, width: 0.8, height: 0.7 });
  });
});

describe('EDIT-001 text layout preview', () => {
  it('renders point-size baselines and explicit line breaks rather than CSS reflow', async () => {
    const test = setup();
    test.rerender(
      <div>
        <TextOverlay
          {...test.props}
          annotation={{ ...annotation, text: 'First line\nSecond line' }}
        />
      </div>,
    );
    await waitFor(() => expect(test.container.querySelectorAll('svg text')).toHaveLength(2));
    const lines = test.container.querySelectorAll('svg text');
    expect(lines[0]).toHaveAttribute('font-size', '18');
    expect(lines[0]).toHaveAttribute('x', '4');
    expect(Number(lines[1]?.getAttribute('y')) - Number(lines[0]?.getAttribute('y'))).toBeCloseTo(
      21.6,
    );
    expect(test.container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 150 160');
  });
  it('visibly warns about overflow without changing the requested font size', async () => {
    const test = setup();
    test.rerender(
      <div>
        <TextOverlay
          {...test.props}
          annotation={{ ...annotation, rect: { ...annotation.rect, height: 0.01 } }}
        />
      </div>,
    );
    expect(await screen.findByText(/Text does not fit/u)).toBeVisible();
    expect(test.container.querySelector('svg text')).toHaveAttribute('font-size', '18');
  });
  it('rejects unsupported glyphs instead of displaying a misleading replacement', async () => {
    const test = setup();
    test.rerender(
      <div>
        <TextOverlay {...test.props} annotation={{ ...annotation, text: '🙂' }} />
      </div>,
    );
    expect(await screen.findByText('Text cannot be exported with this font.')).toBeVisible();
    expect(test.container.querySelector('svg')).toBeNull();
  });
});
