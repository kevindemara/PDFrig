import { describe, expect, it } from 'vitest';
import { fitPageScale } from './page-fit.js';

describe('VIEW-003 measured full-page fit', () => {
  it('fits portrait, landscape, and very tall pages in both dimensions', () => {
    for (const [width, height] of [
      [612, 792],
      [792, 612],
      [612, 4000],
    ]) {
      const scale = fitPageScale(width ?? 0, height ?? 0, 850, 550);
      expect(scale).not.toBeNull();
      expect((scale ?? 0) * (width ?? 0)).toBeLessThanOrEqual(850);
      expect((scale ?? 0) * (height ?? 0)).toBeLessThanOrEqual(550);
    }
  });
  it('responds to viewport/panel geometry and allows fitting below old 50% floor', () => {
    expect(fitPageScale(612, 4000, 1000, 600)).toBe(0.15);
    expect(fitPageScale(612, 792, 300, 600)).toBe(0.49);
    expect(fitPageScale(612, 792, 900, 600)).toBe(0.757);
    expect(fitPageScale(100, 100, 1000, 1000)).toBe(2.5);
  });
  it('ignores unmeasured or invalid geometry', () => {
    for (const value of [0, -1, Infinity, NaN])
      expect(fitPageScale(612, 792, value, 600)).toBeNull();
  });
});
