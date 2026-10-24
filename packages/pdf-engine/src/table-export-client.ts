import { TABLE_LIMITS, type TableValue } from './table-extraction.js';
export function exportTableWorkbook(
  rows: readonly (readonly TableValue[])[],
  format: 'xlsx' | 'ods',
  header: boolean,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('TABLE_CANCELLED'));
      return;
    }
    const worker = new Worker(new URL('./table-export-worker.js', import.meta.url), {
      type: 'module',
    });
    let done = false;
    const finish = (error?: string, bytes?: Uint8Array) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(new Error(error));
      else if (bytes) resolve(bytes);
    };
    const cancel = () => finish('TABLE_CANCELLED');
    const timer = setTimeout(() => finish('TABLE_EXPORT_TIMEOUT'), 30_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => finish('TABLE_EXPORT_FAILED');
    worker.onmessageerror = () => finish('TABLE_EXPORT_FAILED');
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const result = event.data as { ok?: unknown; bytes?: unknown } | null;
      if (
        result?.ok !== true ||
        !(result.bytes instanceof Uint8Array) ||
        result.bytes.length < 5 ||
        result.bytes.length > TABLE_LIMITS.outputBytes
      )
        finish('TABLE_EXPORT_FAILED');
      else finish(undefined, result.bytes);
    };
    try {
      worker.postMessage({ rows, format, header });
    } catch {
      finish('TABLE_EXPORT_FAILED');
    }
  });
}
