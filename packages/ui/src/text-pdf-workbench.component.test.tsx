import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import * as pdfEngine from '@pdfmason/pdf-engine/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UTILITY_FEATURES, UtilityWorkbench } from './utility-workbench.js';

afterEach(() => vi.restoreAllMocks());
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
describe.each(['Web', 'Windows'] as const)('CONV-005 %s result ownership', (surface) => {
  const setup = () => {
    const document = {
      pageCount: 2,
      destroy: vi.fn(() => Promise.resolve()),
      getPageMetrics: vi.fn(() => Promise.resolve({ width: 612, height: 792, rotation: 0 })),
      renderPage: vi.fn(() =>
        Promise.resolve({} as Awaited<ReturnType<pdfEngine.BrowserPdfDocument['renderPage']>>),
      ),
    };
    const open = vi
      .spyOn(pdfEngine, 'openBrowserPdf')
      .mockResolvedValue(document as unknown as pdfEngine.BrowserPdfDocument);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const worker = Object.assign(new EventTarget(), {
      postMessage: vi.fn<(request: pdfEngine.PdfWorkerRequest) => void>(),
      terminate: vi.fn(),
    });
    const view = render(
      <UtilityWorkbench
        surface={surface}
        enabledFeatures={{ ...DEFAULT_UTILITY_FEATURES, text: true }}
        createWorker={() => worker as unknown as Worker}
      />,
    );
    const ui = within(view.container);
    fireEvent.click(ui.getByRole('button', { name: /Text to PDF/u }));
    const choose = (file = new File(['Synthetic text'], 'fixture.txt', { type: 'text/plain' })) => {
      const input = view.container.querySelector('input[type="file"]');
      if (input === null) throw new Error('chooser');
      fireEvent.change(input, { target: { files: [file] } });
    };
    const start = async () => {
      choose();
      fireEvent.click(ui.getByRole('button', { name: 'Build text PDF preview' }));
      await waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const request = worker.postMessage.mock.calls.at(-1)?.[0];
      if (request?.kind !== 'text-to-pdf') throw new Error('request');
      return request;
    };
    const finish = async (request: Awaited<ReturnType<typeof start>>, error?: string) => {
      await act(async () => {
        worker.dispatchEvent(
          new MessageEvent('message', {
            data:
              error === undefined
                ? {
                    id: request.id,
                    ok: true,
                    payload: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) },
                  }
                : { id: request.id, ok: false, message: error },
          }),
        );
        await Promise.resolve();
      });
    };
    return { ...view, ui, worker, document, open, choose, start, finish };
  };
  it('requires a completed actual preview and review; settings invalidate the exact output', async () => {
    const { ui, document, start, finish } = setup();
    await finish(await start());
    const download = ui.getByRole('button', { name: 'Download reviewed text PDF' });
    expect(download).toBeDisabled();
    expect(document.renderPage).toHaveBeenCalled();
    fireEvent.change(ui.getByLabelText('Text preview zoom'), { target: { value: '4' } });
    expect(ui.getByRole('img', { name: 'Rendered text PDF page 1' })).toHaveStyle({
      width: '400%',
    });
    fireEvent.click(ui.getByLabelText('I reviewed the text layout, wrapping and pagination.'));
    expect(download).toBeEnabled();
    fireEvent.change(ui.getByLabelText('Text PDF page size'), { target: { value: 'a4' } });
    expect(ui.queryByRole('button', { name: 'Download reviewed text PDF' })).toBeNull();
    expect(document.destroy).toHaveBeenCalled();
  });
  it.each(['cancel', 'settings', 'file', 'tool', 'unmount'] as const)(
    'discards late worker output after %s',
    async (action) => {
      const { ui, worker, open, choose, unmount, start, finish } = setup();
      const request = await start();
      if (action === 'cancel')
        fireEvent.click(ui.getByRole('button', { name: 'Cancel text preview' }));
      if (action === 'settings')
        fireEvent.change(ui.getByLabelText('Text PDF page size'), { target: { value: 'a4' } });
      if (action === 'file') choose();
      if (action === 'tool') fireEvent.click(ui.getByRole('button', { name: /Create blank PDF/u }));
      if (action === 'unmount') unmount();
      await finish(request);
      expect(worker.terminate).toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(ui.queryByRole('button', { name: 'Download reviewed text PDF' })).toBeNull();
    },
  );
  it.each(['opening', 'rendering'] as const)(
    'disposes late preview %s without publishing',
    async (stage) => {
      const { ui, document, open, start, finish } = setup();
      const pending = deferred<undefined>();
      if (stage === 'opening')
        open.mockImplementation(async () => {
          await pending.promise;
          return document as unknown as pdfEngine.BrowserPdfDocument;
        });
      else
        document.renderPage.mockImplementation(async () => {
          await pending.promise;
          return {} as Awaited<ReturnType<pdfEngine.BrowserPdfDocument['renderPage']>>;
        });
      await finish(await start());
      await waitFor(() =>
        expect(stage === 'opening' ? open : document.renderPage).toHaveBeenCalled(),
      );
      fireEvent.click(ui.getByRole('button', { name: 'Cancel text preview' }));
      await act(async () => {
        pending.resolve(undefined);
        await Promise.resolve();
      });
      expect(document.destroy).toHaveBeenCalled();
      expect(ui.queryByRole('button', { name: 'Download reviewed text PDF' })).toBeNull();
    },
  );
  it('sanitizes raw worker failures and allows recovery', async () => {
    const { ui, start, finish } = setup();
    await finish(await start(), 'private text canary');
    expect(ui.getByRole('alert')).toHaveTextContent('Your original is unchanged');
    expect(ui.queryByText(/canary/u)).toBeNull();
    expect(ui.getByRole('button', { name: 'Build text PDF preview' })).toBeEnabled();
  });
  it('rejects invalid file bounds/type before reading', () => {
    const { ui, choose, worker } = setup();
    const file = new File(['x'], 'wrong.html', { type: 'text/html' });
    const read = vi.spyOn(file, 'arrayBuffer');
    choose(file);
    expect(ui.getByRole('button', { name: 'Build text PDF preview' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled();
    const oversized = new File(['x'], 'large.txt', { type: 'text/plain' });
    Object.defineProperty(oversized, 'size', { value: 1_048_577 });
    choose(oversized);
    expect(ui.getByRole('alert')).toHaveTextContent('up to 1 MiB');
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});
