import type { BrowserPdfDocument } from './browser-document.js';
import type { LocalOcrWord } from './local-ocr-compose.js';
import type { Page } from 'tesseract.js';
import { runLocalOcrWorker } from './local-ocr-worker-client.js';
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
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('OCR_IMAGE_FAILED'))),
        'image/png',
      ),
    );
    const image = new Uint8Array(await blob.arrayBuffer());
    const raw = await runLocalOcrWorker(image, language, base, signal, progress);
    if (isCancelled()) throw new Error('OCR_CANCELLED');
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('blocks' in raw) ||
      !Array.isArray(raw.blocks) ||
      raw.blocks.length > 1000
    )
      throw new Error('OCR_OUTPUT_INVALID');
    const blocks = raw.blocks as NonNullable<Page['blocks']>;
    const words: LocalOcrWord[] = [];
    for (const block of blocks)
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines)
          for (const word of line.words) {
            if (!word.text.trim()) continue;
            words.push({
              text: word.text,
              x: word.bbox.x0 / canvas.width,
              y: word.bbox.y0 / canvas.height,
              width: (word.bbox.x1 - word.bbox.x0) / canvas.width,
              height: (word.bbox.y1 - word.bbox.y0) / canvas.height,
              baseline: Math.min(1, Math.max(0, line.baseline.y0 / canvas.height)),
            });
            if (words.length > 10_000) throw new Error('OCR_WORD_LIMIT');
          }
    if (!words.length) throw new Error('OCR_NO_TEXT_FOUND');
    return words;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
