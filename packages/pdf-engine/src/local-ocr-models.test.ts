import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPinnedOcrModel, localOcrModels } from './local-ocr-models.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('OCR-001 pinned model admission before native parsing', () => {
  it('streams an exact-size model, checks SHA-256, and never requests worker caching or credentials', async () => {
    const data = new Uint8Array(localOcrModels.fra.bytes);
    const fetcher = vi.fn().mockResolvedValue(new Response(data));
    vi.stubGlobal('fetch', fetcher);
    // Control-flow test only. Real hashes and bytes are exercised in browser QA.
    const hash = Uint8Array.from(localOcrModels.fra.sha256.match(/../gu) ?? [], (pair) =>
      parseInt(pair, 16),
    );
    const digest = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(hash.buffer);
    const signal = new AbortController().signal;
    const output = await loadPinnedOcrModel('fra', 'http://localhost/ocr/', signal);
    expect(output.length).toBe(data.length);
    expect(digest).toHaveBeenCalledWith('SHA-256', output);
    expect(fetcher).toHaveBeenCalledWith(new URL('http://localhost/ocr/fra.traineddata'), {
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
  });
  it('rejects truncation, overflow, same-size corrupt bytes and network/status failures', async () => {
    for (const body of [
      new Uint8Array(10),
      new Uint8Array(localOcrModels.fra.bytes + 1),
      new Uint8Array(localOcrModels.fra.bytes),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      await expect(
        loadPinnedOcrModel('fra', 'http://localhost/ocr/', new AbortController().signal),
      ).rejects.toThrow('OCR_MODEL_FAILED');
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(
      loadPinnedOcrModel('eng', 'http://localhost/ocr/', new AbortController().signal),
    ).rejects.toThrow('OCR_MODEL_FAILED');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network details')));
    await expect(
      loadPinnedOcrModel('eng', 'http://localhost/ocr/', new AbortController().signal),
    ).rejects.toThrow(/^OCR_MODEL_FAILED$/u);
  });
  it('cancels an oversized stream and rejects unsupported or already-aborted requests without fetching', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(localOcrModels.fra.bytes + 1));
            },
            cancel,
          }),
        ),
      ),
    );
    await expect(
      loadPinnedOcrModel('fra', 'http://localhost/ocr/', new AbortController().signal),
    ).rejects.toThrow('OCR_MODEL_FAILED');
    expect(cancel).toHaveBeenCalledOnce();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadPinnedOcrModel('eng', 'http://localhost/ocr/', controller.signal),
    ).rejects.toThrow('OCR_CANCELLED');
    await expect(
      loadPinnedOcrModel('deu' as 'eng', 'http://localhost/ocr/', new AbortController().signal),
    ).rejects.toThrow('OCR_LANGUAGE_UNSUPPORTED');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
