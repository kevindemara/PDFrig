import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { BrowserPdfDocument } from './browser-document.js';
vi.mock('pdfjs-dist/webpack.mjs', () => ({ PermissionFlag: { COPY: 16 } }));
function setup(permissions: number[] | null = null) {
  const content = {
    items: [
      { str: 'Cell', dir: 'ltr', transform: [12, 0, 0, 12, 61.2, 712.8], width: 61.2, height: 12 },
    ],
  };
  const page = {
    streamTextContent: vi.fn(
      () =>
        new ReadableStream<typeof content>({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          },
        }),
    ),
    getTextContent: vi.fn(() =>
      Promise.resolve({
        items: [
          {
            str: 'Cell',
            dir: 'ltr',
            transform: [12, 0, 0, 12, 61.2, 712.8],
            width: 61.2,
            height: 12,
          },
        ],
      }),
    ),
    getViewport: vi.fn(() => ({
      rotation: 0,
      width: 612,
      height: 792,
      convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
    })),
  };
  const proxy = {
    numPages: 1,
    getPage: vi.fn(() => Promise.resolve(page)),
    getPermissions: vi.fn(() => Promise.resolve(permissions)),
  };
  return {
    page,
    proxy,
    document: new BrowserPdfDocument(
      proxy as unknown as PDFDocumentProxy,
      {} as PDFDocumentLoadingTask,
      false,
    ),
  };
}
describe('CONV-007 source text admission', () => {
  it('cancels a pending stream immediately and refuses oversized chunks', async () => {
    const { document, page } = setup();
    const cancel = vi.fn();
    page.streamTextContent.mockReturnValueOnce(new ReadableStream({ cancel }));
    const c = new AbortController(),
      pending = document.getTableWords(0, c.signal);
    const result = expect(pending).rejects.toThrow('TABLE_CANCELLED');
    await vi.waitFor(() => expect(page.streamTextContent).toHaveBeenCalled());
    c.abort();
    await result;
    expect(cancel).toHaveBeenCalled();
    const item = { str: 'X', dir: 'ltr', transform: [12, 0, 0, 12, 10, 10], width: 12, height: 12 };
    page.streamTextContent.mockReturnValueOnce(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ items: Array.from({ length: 10001 }, () => item) });
          controller.close();
        },
      }),
    );
    await expect(document.getTableWords(0, new AbortController().signal)).rejects.toThrow(
      'TABLE_WORD_LIMIT',
    );
  });
  it('returns normalized bounds for read-only table extraction', async () => {
    const { document } = setup();
    const words = await document.getTableWords(0, new AbortController().signal);
    expect(words[0]?.text).toBe('Cell');
    expect(words[0]?.x).toBeCloseTo(0.1);
    expect(words[0]?.y).toBeCloseTo((79.2 - 12) / 792);
  });
  it('checks COPY before extracting or OCR admission', async () => {
    const { document, proxy } = setup([]);
    await expect(document.getTableWords(0, new AbortController().signal)).rejects.toThrow(
      'TABLE_COPY_RESTRICTED',
    );
    expect(proxy.getPage).not.toHaveBeenCalled();
  });
  it('rejects cancellation, invalid pages and rotated pages', async () => {
    const { document, page } = setup();
    const c = new AbortController();
    c.abort();
    await expect(document.getTableWords(0, c.signal)).rejects.toThrow('TABLE_CANCELLED');
    await expect(document.getTableWords(1, new AbortController().signal)).rejects.toThrow(
      'TABLE_PAGE_INVALID',
    );
    page.getViewport.mockReturnValueOnce({ ...page.getViewport(), rotation: 90 });
    await expect(document.getTableWords(0, new AbortController().signal)).rejects.toThrow(
      'TABLE_ROTATION_UNSUPPORTED',
    );
  });
});
