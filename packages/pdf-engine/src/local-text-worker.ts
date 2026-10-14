import { inspectSourceText, replaceSourceText } from './source-text.js';
import { composeLocalOcr } from './local-ocr-compose.js';
import type { LocalTextRequest } from './local-text-client.js';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
};
scope.onmessage = (event) => {
  void (async () => {
    try {
      const raw = event.data;
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('bytes' in raw) ||
        !(raw.bytes instanceof Uint8Array) ||
        !('kind' in raw) ||
        !['inspect', 'replace', 'ocr'].includes(String(raw.kind))
      )
        throw new Error('LOCAL_TEXT_INVALID_REQUEST');
      const request = raw as LocalTextRequest;
      let result;
      if (request.kind === 'inspect')
        result = await inspectSourceText(request.bytes, request.pageIndex);
      else if (request.kind === 'replace')
        result = await replaceSourceText(
          request.bytes,
          request.id,
          request.expectedText,
          request.replacement,
        );
      else result = await composeLocalOcr(request.bytes, request.pageIndex, request.words);
      scope.postMessage({ ok: true, result });
    } catch (error) {
      scope.postMessage({
        ok: false,
        code:
          error instanceof Error && /^(?:OCR|SOURCE_TEXT|LOCAL_TEXT)_[A-Z_]+$/u.test(error.message)
            ? error.message
            : 'LOCAL_TEXT_FAILED',
      });
    }
  })();
};
