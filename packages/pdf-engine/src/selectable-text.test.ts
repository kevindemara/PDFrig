import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { BrowserPdfDocument } from './browser-document.js';

const mock = vi.hoisted(() => ({
  render: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('pdfjs-dist/webpack.mjs', () => ({
  PermissionFlag: { COPY: 16 },
  TextLayer: class {
    constructor(options: unknown) {
      mock.construct(options);
    }
    render = mock.render;
    cancel = mock.cancel;
  },
}));
const setup = (
  items: readonly { str: string }[] = [{ str: 'Synthetic text' }],
  permissions: number[] | null = null,
) => {
  const page = {
    rotate: 0,
    getTextContent: vi.fn(() => Promise.resolve({ items })),
    getViewport: vi.fn(({ scale, rotation }: { scale: number; rotation: number }) => ({
      scale,
      rotation,
      userUnit: 1,
    })),
  };
  const proxy = {
    getPage: vi.fn(() => Promise.resolve(page)),
    getPermissions: vi.fn(() => Promise.resolve(permissions)),
  };
  const document = new BrowserPdfDocument(
    proxy as unknown as PDFDocumentProxy,
    {} as PDFDocumentLoadingTask,
    false,
  );
  const setProperty = vi.fn();
  const container = { style: { setProperty, transform: '' } } as unknown as HTMLElement;
  return { document, proxy, page, container, setProperty, controller: new AbortController() };
};
describe('VIEW-008 permission, resource and lifecycle boundaries', () => {
  it('normalizes stored rotation plus editor turns before text-layer positioning', async () => {
    const test = setup();
    test.page.rotate = 270;
    await expect(
      test.document.renderSelectableText(test.container, 0, 1, 180, test.controller.signal),
    ).resolves.toBe('ready');
    expect(test.page.getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 90 });
    expect(test.container.style.transform).toBe('rotate(90deg) translateY(-100%)');
  });
  it('does not extract content when copy permission is denied', async () => {
    const test = setup(undefined, []);
    await expect(
      test.document.renderSelectableText(test.container, 0, 1, 0, test.controller.signal),
    ).resolves.toBe('restricted');
    expect(test.proxy.getPage).not.toHaveBeenCalled();
  });
  it('does not extract after cancellation while waiting for permissions', async () => {
    const test = setup();
    const pending = test.document.renderSelectableText(
      test.container,
      0,
      1,
      0,
      test.controller.signal,
    );
    test.controller.abort();
    await expect(pending).resolves.toBe('cancelled');
    expect(test.proxy.getPage).not.toHaveBeenCalled();
  });
  it.each([{ items: [] }, { items: [{ str: '' }] }])(
    'reports image-only or empty content without constructing a layer',
    async ({ items }) => {
      const test = setup(items);
      await expect(
        test.document.renderSelectableText(test.container, 0, 1, 0, test.controller.signal),
      ).resolves.toBe('empty');
    },
  );
  it.each([
    { items: Array.from({ length: 10_001 }, () => ({ str: 'x' })) },
    { items: [{ str: 'x'.repeat(1_000_001) }] },
  ])('caps items and characters', async ({ items }) => {
    const test = setup(items);
    await expect(
      test.document.renderSelectableText(test.container, 0, 1, 0, test.controller.signal),
    ).resolves.toBe('limited');
  });
  it.each([0, 90, 180, 270] as const)(
    'uses identical zoom and rotation %s for the source layer',
    async (rotation) => {
      const test = setup(undefined, [16]);
      await expect(
        test.document.renderSelectableText(
          test.container,
          0,
          1.25,
          rotation,
          test.controller.signal,
        ),
      ).resolves.toBe('ready');
      expect(test.page.getViewport).toHaveBeenCalledWith({ scale: 1.25, rotation });
      expect(test.setProperty).toHaveBeenCalledWith('--total-scale-factor', '1.25');
    },
  );
  it('cancels an in-flight text layer and removes the abort listener', async () => {
    let finish: (() => void) | undefined;
    mock.render.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const test = setup();
    const remove = vi.spyOn(test.controller.signal, 'removeEventListener');
    const pending = test.document.renderSelectableText(
      test.container,
      0,
      1,
      0,
      test.controller.signal,
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    const before = mock.cancel.mock.calls.length;
    test.controller.abort();
    expect(mock.cancel.mock.calls.length).toBe(before + 1);
    finish?.();
    await expect(pending).resolves.toBe('cancelled');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
