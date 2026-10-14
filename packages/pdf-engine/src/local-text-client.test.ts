import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLocalTextOperation } from './local-text-client.js';
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const start = (controller = new AbortController()) => {
  vi.stubGlobal('Worker', FakeWorker);
  return {
    controller,
    result: runLocalTextOperation(
      { kind: 'inspect', bytes: new Uint8Array([1]), pageIndex: 0 },
      controller.signal,
    ),
  };
};
describe('EDIT-002 local worker boundary', () => {
  it('terminates cancellation and ignores late results', async () => {
    const { controller, result } = start();
    const outcome = result.catch(() => 'cancelled');
    controller.abort();
    FakeWorker.latest.onmessage?.({ data: { ok: true, result: [] } });
    expect(await outcome).toBe('cancelled');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('bounds timeout, rejects malformed messages and preserves safe error codes', async () => {
    vi.useFakeTimers();
    const timeout = start().result.catch(() => 'timeout');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await timeout).toBe('timeout');
    for (const message of [
      null,
      'raw private text',
      { ok: false, code: 'private diagnostic' },
      { ok: false, code: 'SOURCE_TEXT_GLYPH_UNSUPPORTED' },
    ]) {
      const outcome = start().result.catch((error: unknown) =>
        error instanceof Error ? error.message : 'unknown',
      );
      FakeWorker.latest.onmessage?.({ data: message });
      expect(await outcome).toBe(
        typeof message === 'object' && message?.code === 'SOURCE_TEXT_GLYPH_UNSUPPORTED'
          ? message.code
          : 'LOCAL_TEXT_FAILED',
      );
      expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    }
  });
});
