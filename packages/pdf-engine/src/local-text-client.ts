import type { SourceTextRun, SourceTextRange } from './source-text.js';
import type { LocalOcrWord } from './local-ocr-compose.js';
export type LocalTextRequest =
  | { readonly kind: 'inspect'; readonly bytes: Uint8Array; readonly pageIndex: number }
  | {
      readonly kind: 'replace';
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly expectedText: string;
      readonly replacement: string;
      readonly range?: SourceTextRange;
      readonly fitToSpace?: boolean;
    }
  | {
      readonly kind: 'ocr';
      readonly bytes: Uint8Array;
      readonly pageIndex: number;
      readonly words: readonly LocalOcrWord[];
    };
export function runLocalTextOperation(
  request: LocalTextRequest & { readonly kind: 'inspect' },
  signal: AbortSignal,
): Promise<readonly SourceTextRun[]>;
export function runLocalTextOperation(
  request: Exclude<LocalTextRequest, { readonly kind: 'inspect' }>,
  signal: AbortSignal,
): Promise<Uint8Array>;
export function runLocalTextOperation(
  request: LocalTextRequest,
  signal: AbortSignal,
): Promise<readonly SourceTextRun[] | Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('LOCAL_TEXT_CANCELLED'));
      return;
    }
    const worker = new Worker(new URL('./local-text-worker.js', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      finish();
      reject(new Error('LOCAL_TEXT_CANCELLED'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('LOCAL_TEXT_TIMEOUT'));
    }, 60_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error('LOCAL_TEXT_FAILED'));
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return;
      finish();
      if (typeof event.data !== 'object' || event.data === null) {
        reject(new Error('LOCAL_TEXT_FAILED'));
        return;
      }
      const value = event.data as {
        ok?: boolean;
        result?: readonly SourceTextRun[] | Uint8Array;
        code?: string;
      };
      const result = value.result;
      if (
        value.ok &&
        result !== undefined &&
        (request.kind === 'inspect'
          ? Array.isArray(value.result)
          : value.result instanceof Uint8Array)
      )
        resolve(result);
      else
        reject(
          new Error(
            typeof value.code === 'string' &&
              /^(?:OCR|SOURCE_TEXT|LOCAL_TEXT)_[A-Z_]+$/u.test(value.code)
              ? value.code
              : 'LOCAL_TEXT_FAILED',
          ),
        );
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error('LOCAL_TEXT_FAILED'));
    };
    try {
      worker.postMessage(request);
    } catch {
      finish();
      reject(new Error('LOCAL_TEXT_FAILED'));
    }
  });
}
