import { PDFDocument } from '@cantoo/pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';

import type { NormalizedRect } from '@pdfmason/editor-core';

export const LOCAL_REDACTION_LIMITS = Object.freeze({
  maximumBytes: 50 * 1024 * 1024,
  maximumPages: 25,
  maximumPixelsPerPage: 20_000_000,
  maximumRegions: 200,
  maximumTotalPixels: 100_000_000,
  renderScale: 2,
});

export interface RedactionMark {
  readonly pageIndex: number;
  readonly rect: NormalizedRect;
}

export interface RasterRedactionRequest {
  readonly bytes: Uint8Array;
  readonly confirmPermanentRemoval: true;
  readonly confirmRasterization: true;
  readonly marks: readonly RedactionMark[];
}

export interface RedactionVerification {
  readonly annotationsRemoved: true;
  readonly attachmentsRemoved: true;
  readonly formsRemoved: true;
  readonly layersRemoved: true;
  readonly metadataRemoved: true;
  readonly pageCount: number;
  readonly searchableTextRemoved: true;
}

export interface RasterRedactionResult {
  readonly bytes: Uint8Array;
  readonly verification: RedactionVerification;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const createCanvas = (width: number, height: number): OffscreenCanvas => {
  if (typeof OffscreenCanvas === 'undefined') fail('REDACTION_CANVAS_UNAVAILABLE');
  return new OffscreenCanvas(width, height);
};

const getContext = (canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D => {
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('REDACTION_CANVAS_UNAVAILABLE');
  return context;
};

interface OffscreenCanvasAndContext {
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D;
}

class PdfJsOffscreenCanvasFactory {
  public create(width: number, height: number): OffscreenCanvasAndContext {
    const canvas = createCanvas(width, height);
    return { canvas, context: getContext(canvas) };
  }

  public reset({ canvas }: OffscreenCanvasAndContext, width: number, height: number): void {
    canvas.width = width;
    canvas.height = height;
  }

  public destroy({ canvas }: OffscreenCanvasAndContext): void {
    canvas.width = 0;
    canvas.height = 0;
  }
}

const isNearBlack = (data: Uint8ClampedArray): boolean => {
  for (let index = 0; index < data.length; index += 4) {
    if ((data[index] ?? 255) > 8 || (data[index + 1] ?? 255) > 8 || (data[index + 2] ?? 255) > 8)
      return false;
  }
  return true;
};

const loadPdfJs = async () => {
  try {
    // The redaction runtime already runs in a dedicated application worker.
    // Loading PDF.js' worker handler into that scope selects its supported
    // same-thread transport and avoids an unbounded nested worker surface.
    await import('pdfjs-dist/build/pdf.worker.mjs');
    return await import('pdfjs-dist/webpack.mjs');
  } catch {
    return fail('REDACTION_ENGINE_UNAVAILABLE');
  }
};

const renderPdfPage = async (
  page: PDFPageProxy,
  scale: number,
): Promise<{
  readonly canvas: OffscreenCanvas;
  readonly heightPoints: number;
  readonly widthPoints: number;
}> => {
  const points = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (width * height > LOCAL_REDACTION_LIMITS.maximumPixelsPerPage)
    fail('REDACTION_PAGE_PIXEL_LIMIT');
  const canvas = createCanvas(width, height);
  const context = getContext(canvas);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  // PDF.js' DOM declaration predates its OffscreenCanvas worker support. Keep the
  // compatibility cast isolated at this reviewed rendering boundary.
  try {
    const renderTask = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    });
    await renderTask.promise;
  } catch {
    fail('REDACTION_RENDER_FAILED');
  }
  return { canvas, heightPoints: points.height, widthPoints: points.width };
};

const verifyOutput = async (
  bytes: Uint8Array,
  marks: readonly RedactionMark[],
  expectedPages: number,
): Promise<RedactionVerification> => {
  const structural = await PDFDocument.load(bytes, {
    preserveXFA: true,
    updateMetadata: false,
  }).catch(() => fail('REDACTION_VERIFY_STRUCTURE_FAILED'));
  try {
    if (
      structural.getPageCount() !== expectedPages ||
      structural.getForm().getFields().length !== 0 ||
      structural.getAttachments().length !== 0 ||
      structural.getOptionalContentGroups().length !== 0 ||
      structural.getDocumentJavaScripts().length !== 0 ||
      structural.getXFAJavaScripts().length !== 0
    )
      fail('REDACTION_VERIFY_STRUCTURE_FAILED');
    if (
      structural.getTitle() !== undefined ||
      structural.getAuthor() !== undefined ||
      structural.getSubject() !== undefined ||
      structural.getKeywords() !== undefined
    )
      fail('REDACTION_VERIFY_STRUCTURE_FAILED');
  } catch {
    fail('REDACTION_VERIFY_STRUCTURE_FAILED');
  }

  const { getDocument } = await loadPdfJs();
  const task = (() => {
    try {
      return getDocument({
        CanvasFactory: PdfJsOffscreenCanvasFactory,
        data: bytes.slice(),
        disableFontFace: true,
        enableXfa: false,
        useWasm: false,
        verbosity: 0,
      });
    } catch {
      return fail('REDACTION_ENGINE_UNAVAILABLE');
    }
  })();
  try {
    const document = await task.promise.catch(() => fail('REDACTION_VERIFY_CONTENT_FAILED'));
    if (document.numPages !== expectedPages) fail('REDACTION_VERIFY_CONTENT_FAILED');
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document
        .getPage(pageIndex + 1)
        .catch(() => fail('REDACTION_VERIFY_CONTENT_FAILED'));
      const [annotations, text] = await Promise.all([
        page.getAnnotations(),
        page.getTextContent(),
      ]).catch(() => fail('REDACTION_VERIFY_CONTENT_FAILED'));
      if (annotations.length !== 0 || text.items.length !== 0)
        fail('REDACTION_VERIFY_CONTENT_FAILED');
      const pageMarks = marks.filter((mark) => mark.pageIndex === pageIndex);
      if (pageMarks.length === 0) continue;
      const { canvas } = await renderPdfPage(page, 1);
      const context = getContext(canvas);
      for (const mark of pageMarks) {
        const x = Math.floor(mark.rect.x * canvas.width) + 1;
        const y = Math.floor(mark.rect.y * canvas.height) + 1;
        const width = Math.max(1, Math.floor(mark.rect.width * canvas.width) - 2);
        const height = Math.max(1, Math.floor(mark.rect.height * canvas.height) - 2);
        try {
          if (!isNearBlack(context.getImageData(x, y, width, height).data))
            fail('REDACTION_VERIFY_PIXELS_FAILED');
        } catch {
          fail('REDACTION_VERIFY_PIXELS_FAILED');
        }
      }
    }
  } finally {
    await task.destroy().catch(() => fail('REDACTION_VERIFY_CLEANUP_FAILED'));
  }
  return Object.freeze({
    annotationsRemoved: true,
    attachmentsRemoved: true,
    formsRemoved: true,
    layersRemoved: true,
    metadataRemoved: true,
    pageCount: expectedPages,
    searchableTextRemoved: true,
  });
};

export const applyRasterRedactions = async (
  request: RasterRedactionRequest,
): Promise<RasterRedactionResult> => {
  if (request.marks.length < 1 || request.marks.length > LOCAL_REDACTION_LIMITS.maximumRegions)
    fail('REDACTION_MARK_LIMIT');

  const { getDocument } = await loadPdfJs();
  const task = (() => {
    try {
      return getDocument({
        CanvasFactory: PdfJsOffscreenCanvasFactory,
        canvasMaxAreaInBytes: 32 * 1024 * 1024,
        data: request.bytes.slice(),
        disableFontFace: true,
        enableXfa: false,
        maxImageSize: LOCAL_REDACTION_LIMITS.maximumPixelsPerPage,
        stopAtErrors: false,
        useWasm: false,
        verbosity: 0,
      });
    } catch {
      return fail('REDACTION_ENGINE_UNAVAILABLE');
    }
  })();
  const output = await PDFDocument.create().catch(() => fail('REDACTION_REBUILD_FAILED'));
  let totalPixels = 0;
  try {
    const source = await task.promise.catch(() => fail('REDACTION_SOURCE_OPEN_FAILED'));
    if (source.numPages > LOCAL_REDACTION_LIMITS.maximumPages) fail('REDACTION_PAGE_LIMIT');
    if (request.marks.some((mark) => mark.pageIndex < 0 || mark.pageIndex >= source.numPages))
      fail('REDACTION_MARK_INVALID');
    for (let pageIndex = 0; pageIndex < source.numPages; pageIndex += 1) {
      const sourcePage = await source.getPage(pageIndex + 1);
      const rendered = await renderPdfPage(sourcePage, LOCAL_REDACTION_LIMITS.renderScale);
      totalPixels += rendered.canvas.width * rendered.canvas.height;
      if (totalPixels > LOCAL_REDACTION_LIMITS.maximumTotalPixels)
        fail('REDACTION_TOTAL_PIXEL_LIMIT');
      const context = getContext(rendered.canvas);
      context.fillStyle = '#000000';
      for (const mark of request.marks.filter((candidate) => candidate.pageIndex === pageIndex)) {
        const padding = 2;
        const x = Math.floor(mark.rect.x * rendered.canvas.width) - padding;
        const y = Math.floor(mark.rect.y * rendered.canvas.height) - padding;
        const width = Math.ceil(mark.rect.width * rendered.canvas.width) + padding * 2;
        const height = Math.ceil(mark.rect.height * rendered.canvas.height) + padding * 2;
        context.fillRect(x, y, width, height);
      }
      const image = await (async () => {
        const blob = await rendered.canvas.convertToBlob({ type: 'image/png' });
        const png = new Uint8Array(await blob.arrayBuffer());
        return output.embedPng(png);
      })().catch(() => fail('REDACTION_REBUILD_FAILED'));
      const page = output.addPage([rendered.widthPoints, rendered.heightPoints]);
      page.drawImage(image, {
        height: rendered.heightPoints,
        width: rendered.widthPoints,
        x: 0,
        y: 0,
      });
    }
  } finally {
    await task.destroy().catch(() => fail('REDACTION_CLEANUP_FAILED'));
  }
  const bytes = await output
    .save({ addDefaultPage: false, useObjectStreams: true })
    .catch(() => fail('REDACTION_REBUILD_FAILED'));
  const verification = await verifyOutput(bytes, request.marks, output.getPageCount());
  return Object.freeze({ bytes, verification });
};
