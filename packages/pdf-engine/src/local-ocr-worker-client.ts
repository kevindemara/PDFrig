import { assertOcrPixels } from './local-ocr-pixels.js';
import { loadPinnedOcrModel } from './local-ocr-models.js';
/** Pinned Tesseract.js v7 worker protocol. Own the worker before initialization so
 * aborts, initialization failures and deadlines always terminate it immediately. */
export async function runLocalOcrWorker(
  image: Uint8Array,
  language: 'eng' | 'fra',
  base: string,
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<unknown> {
  if (signal.aborted) throw new Error('OCR_CANCELLED');
  if (!['eng', 'fra'].includes(language)) throw new Error('OCR_LANGUAGE_UNSUPPORTED');
  assertOcrPixels(image);
  const worker = new Worker(`${base}worker.min.js`);
  const modelController = new AbortController();
  let sequence = 0;
  let stopped = false;
  let stopCode: string | undefined;
  let pending:
    | {
        id: string;
        action: string;
        resolve: (data: unknown) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const stop = (code: string) => {
    if (stopped) return;
    stopped = true;
    stopCode = code;
    modelController.abort();
    worker.terminate();
    pending?.reject(new Error(code));
    pending = undefined;
  };
  const cancel = () => stop('OCR_CANCELLED');
  const timer = setTimeout(() => stop('OCR_TIMEOUT'), 180_000);
  signal.addEventListener('abort', cancel, { once: true });
  worker.onerror = () => stop('OCR_WORKER_FAILED');
  worker.onmessageerror = () => stop('OCR_WORKER_FAILED');
  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (stopped || typeof event.data !== 'object' || event.data === null) return;
    const packet = event.data as Record<string, unknown>;
    const current = pending;
    if (
      !current ||
      packet.workerId !== 'pdfrig-local-ocr' ||
      packet.jobId !== current.id ||
      packet.action !== current.action
    )
      return;
    if (packet.status === 'progress') {
      const data = packet.data as { status?: unknown; progress?: unknown } | null;
      if (
        data?.status === 'recognizing text' &&
        typeof data.progress === 'number' &&
        Number.isFinite(data.progress)
      )
        progress(Math.round(Math.min(1, Math.max(0, data.progress)) * 100));
    } else if (packet.status === 'resolve') {
      current.resolve(packet.data);
      pending = undefined;
    } else stop('OCR_WORKER_FAILED'); // Never expose native diagnostic text.
  };
  const job = (action: string, payload: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (stopped || signal.aborted) {
        reject(new Error('OCR_CANCELLED'));
        return;
      }
      const id = String(++sequence);
      pending = { id, action, resolve, reject };
      try {
        worker.postMessage({ workerId: 'pdfrig-local-ocr', jobId: id, action, payload });
      } catch {
        stop('OCR_WORKER_FAILED');
      }
    });
  try {
    await job('load', { options: { lstmOnly: true, corePath: base, logging: false } });
    const model = await loadPinnedOcrModel(language, base, modelController.signal);
    await job('loadLanguage', {
      langs: [{ code: language, data: model }],
      options: { gzip: false, cacheMethod: 'none', lstmOnly: true },
    });
    await job('initialize', { langs: language, oem: 1, config: {} });
    // Initialization yields to the caller. Recheck immediately before the
    // synchronous structured clone so a changed/detached header cannot reach native code.
    assertOcrPixels(image);
    return await job('recognize', { image, options: {}, output: { blocks: true, text: true } });
  } catch (error) {
    if (stopCode) throw new Error(stopCode);
    throw error;
  } finally {
    stop('OCR_CANCELLED');
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
