import type { BrowserPdfDocument } from './browser-document.js';
import type { LocalOcrWord } from './local-ocr-compose.js';
import { runLocalOcrWorker } from './local-ocr-worker-client.js';
import { encodeOcrPixels } from './local-ocr-pixels.js';
import { readLocalOcrWords } from './local-ocr-result.js';
/** OCR-001: only a locally rendered canvas enters OCR; URLs/documents never do. */
export async function recognizeLocalPage(
  document: BrowserPdfDocument,
  pageIndex: number,
  language: 'eng' | 'fra',
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<readonly LocalOcrWord[]> {
  if (!['eng', 'fra'].includes(language)) throw new Error('OCR_LANGUAGE_UNSUPPORTED');
  if (await document.hasSearchableText(pageIndex)) throw new Error('OCR_PAGE_ALREADY_SEARCHABLE');
  const metrics = await document.getPageMetrics(pageIndex);
  if (metrics.rotation % 360 !== 0) throw new Error('OCR_ROTATION_UNSUPPORTED');
  const scale = 200 / 72;
  if (metrics.width * metrics.height * scale * scale > 20_000_000)
    throw new Error('OCR_PAGE_PIXEL_LIMIT');
  const canvas = globalThis.document.createElement('canvas');
  const base = new URL('ocr/', globalThis.document.baseURI).href;
  const isCancelled = () => signal.aborted;
  try {
    await document.renderPage(canvas, pageIndex, scale, 0, 1, 'opaque', signal);
    if (isCancelled()) throw new Error('OCR_CANCELLED');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OCR_IMAGE_FAILED');
    const image = encodeOcrPixels(
      canvas.width,
      canvas.height,
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      signal,
    );
    const raw = await runLocalOcrWorker(image, language, base, signal, progress);
    if (isCancelled()) throw new Error('OCR_CANCELLED');
    return readLocalOcrWords(raw, canvas.width, canvas.height);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
