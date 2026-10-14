import { isPdfDecorationOptions, type PdfDecorationOptions } from './decoration-options.js';
import type { DecorationTextArea } from './decoration-text-areas.js';

/** EDIT-006: advisory visible-ink sampling, never a safe-placement certificate. */
export const DECORATION_REVIEW_LIMITS = Object.freeze({
  maximumEdge: 2048,
  maximumPixels: 2048 * 2048,
  minimumPixelsPerPoint: 0.95,
  whiteDifference: 24,
});
export interface DecorationReviewBand {
  readonly kind: 'header' | 'footer';
  readonly top: number;
  readonly bottom: number;
  readonly finding: 'ink-detected' | 'no-ink-detected';
  readonly textArea?:
    | {
        readonly status: 'sampled';
        readonly finding: 'ink-detected' | 'no-ink-detected';
        readonly bounds: DecorationTextArea;
      }
    | { readonly status: 'unavailable' };
}
export type DecorationReviewUnavailableReason =
  'geometry' | 'pixel-limit' | 'resolution' | 'pixels' | 'render';
export type DecorationPlacementReview =
  | { readonly status: 'sampled'; readonly bands: readonly DecorationReviewBand[] }
  | { readonly status: 'unavailable'; readonly reason: DecorationReviewUnavailableReason }
  | { readonly status: 'not-applicable' };
export interface DecorationReviewRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export const decorationReviewGeometrySupported = (width: number, height: number): boolean =>
  [width, height].every(
    (value) =>
      Number.isFinite(value) && value >= 16 && value <= DECORATION_REVIEW_LIMITS.maximumEdge,
  );

export const reviewDecorationPlacement = (
  raster: DecorationReviewRaster,
  page: { readonly width: number; readonly height: number },
  options: PdfDecorationOptions,
  textAreas: readonly DecorationTextArea[] = [],
): DecorationPlacementReview => {
  if (!isPdfDecorationOptions(options)) throw new Error('DECORATION_OPTIONS_INVALID');
  if (options.header === null && options.footer === null) return { status: 'not-applicable' };
  if (!decorationReviewGeometrySupported(page.width, page.height))
    return { status: 'unavailable', reason: 'geometry' };
  if (
    ![raster.width, raster.height].every(
      (value) =>
        Number.isInteger(value) && value > 0 && value <= DECORATION_REVIEW_LIMITS.maximumEdge,
    ) ||
    raster.width * raster.height > DECORATION_REVIEW_LIMITS.maximumPixels
  )
    return { status: 'unavailable', reason: 'pixel-limit' };
  if (
    !(raster.data instanceof Uint8ClampedArray) ||
    raster.data.length !== raster.width * raster.height * 4
  )
    return { status: 'unavailable', reason: 'pixels' };
  const scaleX = raster.width / page.width;
  const scaleY = raster.height / page.height;
  if (
    Math.min(scaleX, scaleY) < DECORATION_REVIEW_LIMITS.minimumPixelsPerPoint ||
    Math.max(scaleX, scaleY) > 2 ||
    Math.abs(scaleX - scaleY) > 0.02
  )
    return { status: 'unavailable', reason: 'resolution' };
  const requiredInk = Math.max(2, Math.ceil(scaleX * scaleY * 0.5));
  const sample = (
    left: number,
    right: number,
    top: number,
    bottom: number,
  ): 'ink-detected' | 'no-ink-detected' => {
    let ink = 0;
    for (
      let y = Math.floor(top * raster.height);
      y < Math.ceil(bottom * raster.height) && ink < requiredInk;
      y += 1
    ) {
      for (
        let x = Math.floor(left * raster.width);
        x < Math.ceil(right * raster.width) && ink < requiredInk;
        x += 1
      ) {
        const offset = (y * raster.width + x) * 4;
        const alpha = (raster.data[offset + 3] ?? 0) / 255;
        const darkest = Math.min(
          raster.data[offset] ?? 255,
          raster.data[offset + 1] ?? 255,
          raster.data[offset + 2] ?? 255,
        );
        if ((255 - darkest) * alpha >= DECORATION_REVIEW_LIMITS.whiteDifference) ink += 1;
      }
    }
    return ink >= requiredInk ? 'ink-detected' : 'no-ink-detected';
  };
  const bands: DecorationReviewBand[] = [];
  for (const [kind, decoration] of [
    ['header', options.header],
    ['footer', options.footer],
  ] as const) {
    if (decoration === null) continue;
    const baseline = kind === 'header' ? options.marginPoints : page.height - options.marginPoints;
    // Generous full-width band, not a glyph/object bounding box. Includes a 2-point guard.
    const top = Math.max(0, baseline - decoration.fontSize - 2);
    const bottom = Math.min(page.height, baseline + decoration.fontSize * 0.4 + 2);
    if (top >= bottom) return { status: 'unavailable', reason: 'geometry' };
    const matchingAreas =
      textAreas.length <= 2 ? textAreas.filter((area) => area.kind === kind) : [];
    const area = matchingAreas.length === 1 ? matchingAreas[0] : undefined;
    const validArea =
      area !== undefined &&
      [area.left, area.right, area.top, area.bottom].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ) &&
      area.left < area.right &&
      area.top < area.bottom &&
      area.top >= top / page.height &&
      area.bottom <= bottom / page.height;
    bands.push({
      kind,
      top: top / page.height,
      bottom: bottom / page.height,
      finding: sample(0, 1, top / page.height, bottom / page.height),
      textArea: validArea
        ? {
            status: 'sampled',
            finding: sample(area.left, area.right, area.top, area.bottom),
            bounds: area,
          }
        : { status: 'unavailable' },
    });
  }
  return { status: 'sampled', bands: Object.freeze(bands) };
};
