import {
  decorationReviewGeometrySupported,
  measureDecorationTextAreas,
  reviewDecorationPlacement,
  type BrowserPdfDocument,
  type DecorationPlacementReview,
  type PdfDecorationOptions,
  type DecorationTextArea,
} from '@pdfmason/pdf-engine/browser';

/** Source raster exists only for this page check, never in React state or telemetry. */
export const reviewDecorationSourcePage = async (
  source: Pick<BrowserPdfDocument, 'getPageMetrics' | 'renderPage' | 'pageCount'> | null,
  pageNumber: number,
  options: PdfDecorationOptions,
  current: () => boolean,
): Promise<DecorationPlacementReview> => {
  if (options.header === null && options.footer === null) return { status: 'not-applicable' };
  if (source === null || !current()) return { status: 'unavailable', reason: 'render' };
  const canvas = document.createElement('canvas');
  try {
    const metrics = await source.getPageMetrics(pageNumber - 1);
    if (!current()) return { status: 'unavailable', reason: 'render' };
    if (!decorationReviewGeometrySupported(metrics.width, metrics.height))
      return { status: 'unavailable', reason: 'geometry' };
    // Explicit 1x output: device zoom/DPI changes cannot expand the bounded analysis canvas.
    await source.renderPage(canvas, pageNumber - 1, 1, 0, 1);
    if (!current()) return { status: 'unavailable', reason: 'render' };
    const context = canvas.getContext('2d');
    if (context === null) return { status: 'unavailable', reason: 'render' };
    let textAreas: readonly DecorationTextArea[] = [];
    try {
      textAreas = await measureDecorationTextAreas(metrics, options, pageNumber, source.pageCount);
    } catch {
      // Missing metrics must retain the broad warning, never imply a negative text-area result.
    }
    if (!current()) return { status: 'unavailable', reason: 'render' };
    return reviewDecorationPlacement(
      context.getImageData(0, 0, canvas.width, canvas.height),
      metrics,
      options,
      textAreas,
    );
  } catch {
    // Do not expose renderer errors or turn missing pixels into a successful negative finding.
    return { status: 'unavailable', reason: 'render' };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
};
