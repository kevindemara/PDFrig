import { describe, expect, it, vi } from 'vitest';
import { thumbnailWindow, ThumbnailRenderQueue } from './thumbnail-window.js';

describe('VIEW-004 bounded thumbnail work', () => {
  it('mounts only viewport rows plus two-row overscan at either edge', () => {
    expect(thumbnailWindow(500, 0, 600, 200)).toEqual([0, 1, 2, 3, 4]);
    expect(thumbnailWindow(500, 50_000, 600, 200)).toEqual([248, 249, 250, 251, 252, 253, 254]);
    expect(thumbnailWindow(500, 99_400, 600, 200)).toEqual([495, 496, 497, 498, 499]);
    expect(thumbnailWindow(0, 0, 600, 200)).toEqual([]);
    expect(thumbnailWindow(3, 99_400, 600, 200)).toEqual([0, 1, 2]);
  });

  it('handles text scaling, fractional scrolling and absent measurements without unbounded work', () => {
    expect(thumbnailWindow(500, 80.5, 600, 300)).toEqual([0, 1, 2, 3, 4]);
    expect(thumbnailWindow(500, Number.NaN, Number.NaN, Number.NaN)).toHaveLength(5);
    expect(thumbnailWindow(500, -1, 600, 0)).toHaveLength(21);
  });

  it('limits running renders and removes unmounted queued work, including after rejection', async () => {
    const queue = new ThumbnailRenderQueue();
    let release: () => void = () => undefined;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const second = vi.fn(() => Promise.reject(new Error('synthetic render failure')));
    const removed = vi.fn(() => Promise.resolve());
    const retained = vi.fn(() => Promise.resolve());
    queue.schedule(first);
    queue.schedule(second);
    const cancel = queue.schedule(removed);
    queue.schedule(retained);
    cancel();
    await vi.waitFor(() => expect(retained).toHaveBeenCalledOnce());
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    release();
  });
});
