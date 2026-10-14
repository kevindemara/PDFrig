import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLocalOcrWorker } from './local-ocr-worker-client.js';
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  sent: { workerId: string; jobId: string; action: string; payload: unknown }[] = [];
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(packet: (typeof this.sent)[number]) {
    this.sent.push(packet);
  }
  reply(status: string, data: unknown = {}) {
    this.onmessage?.({ data: { ...this.sent.at(-1), status, data } });
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
    result: runLocalOcrWorker(
      new Uint8Array([1]),
      'eng',
      'http://localhost/ocr/',
      controller.signal,
      vi.fn(),
    ),
  };
};
describe('OCR-001 initialization ownership and cleanup', () => {
  it('owns and terminates the worker immediately on cancellation during initialization', async () => {
    const { controller, result } = start();
    const outcome = result.catch((error: unknown) =>
      error instanceof Error ? error.message : 'unknown',
    );
    controller.abort();
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    FakeWorker.latest.reply('resolve');
    expect(await outcome).toBe('OCR_CANCELLED');
    expect(FakeWorker.latest.sent).toHaveLength(1);
  });
  it('has a bounded deadline and hides raw native errors', async () => {
    vi.useFakeTimers();
    const first = start().result.catch((error: unknown) =>
      error instanceof Error ? error.message : 'unknown',
    );
    await vi.advanceTimersByTimeAsync(180_000);
    expect(await first).toBe('OCR_TIMEOUT');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    const second = start().result.catch((error: unknown) =>
      error instanceof Error ? error.message : 'unknown',
    );
    FakeWorker.latest.reply('reject', 'private native diagnostic');
    expect(await second).toBe('OCR_WORKER_FAILED');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('runs the pinned local protocol sequentially and cleans up success', async () => {
    const { result } = start();
    for (let index = 0; index < 3; index++) {
      FakeWorker.latest.reply('resolve');
      await Promise.resolve();
    }
    FakeWorker.latest.reply('resolve', { blocks: [] });
    expect(await result).toEqual({ blocks: [] });
    expect(FakeWorker.latest.sent.map((packet) => packet.action)).toEqual([
      'load',
      'loadLanguage',
      'initialize',
      'recognize',
    ]);
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('does not spawn for already-cancelled work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(start(controller).result).rejects.toThrow('OCR_CANCELLED');
  });
});
