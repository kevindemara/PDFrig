import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePointerGesture } from './pointer-gesture.js';

describe('ANNO-003 pointer input ownership', () => {
  it('refuses an over-limit stroke instead of publishing truncated artwork', () => {
    const { result } = renderHook(() => usePointerGesture('page:draw'));
    act(() => {
      result.current.begin({ x: 0.1, y: 0.2 }, 1);
      for (let index = 0; index < 1998; index++) result.current.move({ x: 0.2, y: 0.3 }, 1, true);
      expect(result.current.move({ x: 0.3, y: 0.4 }, 1, true)).toBe('limit');
      expect(result.current.finish(1)).toBeNull();
    });
    expect(result.current.draft).toBeNull();
  });
  it('cancels placement when page bounds move, including before pointer-up', () => {
    const { result } = renderHook(() => usePointerGesture('page:draw'));
    const bounds = new DOMRect(10, 20, 500, 800);
    act(() => {
      expect(result.current.begin({ x: 0.1, y: 0.2 }, 1, bounds)).toBe(true);
      expect(result.current.begin({ x: 0.9, y: 0.9 }, 2, bounds)).toBe(false);
      expect(result.current.move({ x: 0.3, y: 0.4 }, 1, true, new DOMRect(10, 21, 500, 800))).toBe(
        'cancelled',
      );
      expect(result.current.finish(1, bounds)).toBeNull();
      result.current.begin({ x: 0.1, y: 0.2 }, 1, bounds);
      expect(result.current.finish(1, new DOMRect(10, 20, 600, 800))).toBeNull();
    });
  });
  it('retains the entire gesture when down/move/up occur before a preview commit', () => {
    const { result } = renderHook(() => usePointerGesture('page-one:eraser'));
    const handler = result.current;
    let completed;
    act(() => {
      handler.begin({ x: 0.52, y: 0.42 }, 1);
      handler.move({ x: 0.52, y: 0.55 }, 1, true);
      completed = handler.finish(1);
    });
    expect(completed).toMatchObject({
      points: [
        { x: 0.52, y: 0.42 },
        { x: 0.52, y: 0.55 },
      ],
      pointerId: 1,
    });
    expect(result.current.draft).toBeNull();
  });

  it('ignores another pointer without replacing, moving or cancelling the owner', () => {
    const { result } = renderHook(() => usePointerGesture('page-one:draw'));
    act(() => {
      result.current.begin({ x: 0.1, y: 0.2 }, 1);
      result.current.begin({ x: 0.9, y: 0.9 }, 2);
      result.current.move({ x: 0.8, y: 0.8 }, 2, true);
      result.current.cancel(2);
      expect(result.current.finish(2)).toBeNull();
    });
    expect(result.current.draft?.points).toEqual([{ x: 0.1, y: 0.2 }]);
    act(() => result.current.cancel(1));
    expect(result.current.draft).toBeNull();
    expect(result.current.finish(1)).toBeNull();
  });

  it.each(['page-two:draw', 'page-one:eraser', 'page-one:draw:rotated', 'page-one:draw:zoomed'])(
    'discards input when its page/tool/geometry scope changes to %s',
    (scope) => {
      const { result, rerender } = renderHook(({ scope }) => usePointerGesture(scope), {
        initialProps: { scope: 'page-one:draw' },
      });
      act(() => {
        result.current.begin({ x: 0.1, y: 0.2 }, 1);
      });
      rerender({ scope });
      expect(result.current.draft).toBeNull();
      act(() => {
        expect(result.current.finish(1)).toBeNull();
      });
      act(() => {
        result.current.begin({ x: 0.3, y: 0.4 }, 2);
      });
      expect(result.current.draft?.scope).toBe(scope);
    },
  );

  it('updates a rectangular preview without accumulating an ink path', () => {
    const { result } = renderHook(() => usePointerGesture('page:rectangle'));
    act(() => {
      result.current.begin({ x: 0.1, y: 0.2 }, 1);
      result.current.move({ x: 0.4, y: 0.5 }, 1, false);
    });
    expect(result.current.draft?.current).toEqual({ x: 0.4, y: 0.5 });
    expect(result.current.draft?.points).toHaveLength(1);
  });
});
