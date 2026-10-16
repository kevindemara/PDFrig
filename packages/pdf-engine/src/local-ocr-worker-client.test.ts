import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLocalOcrWorker } from './local-ocr-worker-client.js';
import { encodeOcrPixels } from './local-ocr-pixels.js';
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
      encodeOcrPixels(1, 1, new Uint8ClampedArray([0, 0, 0, 255]), controller.signal),
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
    await expect(
      runLocalOcrWorker(new Uint8Array(), 'eng', '', controller.signal, vi.fn()),
    ).rejects.toThrow('OCR_CANCELLED');
  });
  it('rejects compressed/URL/arbitrary raster bytes before creating a worker', async () => {
    const constructor = vi.fn();
    vi.stubGlobal('Worker', constructor);
    for (const input of [
      new Uint8Array([137, 80, 78, 71]),
      new TextEncoder().encode('https://example.invalid/image.png'),
    ])
      await expect(
        runLocalOcrWorker(input, 'eng', '', new AbortController().signal, vi.fn()),
      ).rejects.toThrow('OCR_IMAGE_FAILED');
    expect(constructor).not.toHaveBeenCalled();
  });
  it('refuses unsupported runtime language values before loading native assets', async () => {
    const constructor = vi.fn();
    vi.stubGlobal('Worker', constructor);
    const image = encodeOcrPixels(1, 1, new Uint8ClampedArray(4), new AbortController().signal);
    await expect(
      runLocalOcrWorker(image, 'deu' as 'eng', '', new AbortController().signal, vi.fn()),
    ).rejects.toThrow('OCR_LANGUAGE_UNSUPPORTED');
    expect(constructor).not.toHaveBeenCalled();
  });
  it('rechecks mutable raster headers after initialization and always terminates on refusal', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const image = encodeOcrPixels(1, 1, new Uint8ClampedArray(4), new AbortController().signal);
    const result = runLocalOcrWorker(image, 'eng', '', new AbortController().signal, vi.fn());
    const outcome = result.catch((error: unknown) =>
      error instanceof Error ? error.message : 'unknown',
    );
    for (let index = 0; index < 2; index++) {
      FakeWorker.latest.reply('resolve');
      await Promise.resolve();
    }
    image[0] = 0;
    FakeWorker.latest.reply('resolve');
    expect(await outcome).toBe('OCR_IMAGE_FAILED');
    expect(FakeWorker.latest.sent).toHaveLength(3);
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
