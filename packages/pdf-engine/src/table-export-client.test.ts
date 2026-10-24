import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportTableWorkbook } from './table-export-client.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onerror: null as null | (() => void),
    onmessageerror: null as null | (() => void),
    onmessage: null as null | ((event: MessageEvent<unknown>) => void),
  };
  const create = vi.fn(function () {
    return worker;
  });
  vi.stubGlobal('Worker', create);
  return { worker, create };
}
describe('CONV-007 owned export worker', () => {
  it('does not create a worker for a cancelled request', async () => {
    const { create } = setup();
    const c = new AbortController();
    c.abort();
    await expect(exportTableWorkbook([['a']], 'xlsx', true, c.signal)).rejects.toThrow(
      'TABLE_CANCELLED',
    );
    expect(create).not.toHaveBeenCalled();
  });
  it('terminates after success and ignores late messages', async () => {
    const { worker } = setup();
    const promise = exportTableWorkbook([['a']], 'ods', true, new AbortController().signal);
    worker.onmessage?.({
      data: { ok: true, bytes: new Uint8Array([80, 75, 3, 4, 0]) },
    } as MessageEvent);
    await expect(promise).resolves.toBeInstanceOf(Uint8Array);
    worker.onmessage?.({ data: { ok: false } } as MessageEvent);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('terminates on cancellation and timeout', async () => {
    vi.useFakeTimers();
    const { worker } = setup();
    const c = new AbortController();
    const promise = exportTableWorkbook([['a']], 'xlsx', true, c.signal);
    const check = expect(promise).rejects.toThrow('TABLE_CANCELLED');
    c.abort();
    await check;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const second = setup();
    const p = exportTableWorkbook([['a']], 'xlsx', true, new AbortController().signal);
    const timeout = expect(p).rejects.toThrow('TABLE_EXPORT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(30_001);
    await timeout;
    expect(second.worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(['error', 'messageerror', 'invalid', 'throw'])('rejects %s safely', async (action) => {
    const { worker } = setup();
    if (action === 'throw')
      worker.postMessage.mockImplementation(() => {
        throw new Error('private');
      });
    const p = exportTableWorkbook([['a']], 'xlsx', true, new AbortController().signal);
    const check = expect(p).rejects.toThrow('TABLE_EXPORT_FAILED');
    if (action === 'error') worker.onerror?.();
    if (action === 'messageerror') worker.onmessageerror?.();
    if (action === 'invalid') worker.onmessage?.({ data: { ok: true, bytes: [] } } as MessageEvent);
    await check;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
