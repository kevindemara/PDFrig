import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@pdfmason/pdf-engine/browser';
import { describe, expect, it, vi } from 'vitest';
import { UtilityWorkbench } from './utility-workbench.js';

describe.each(['Web', 'Windows'] as const)(
  'CREATE-001 %s blank-page result ownership',
  (surface) => {
    const setup = () => {
      const worker = Object.assign(new EventTarget(), {
        postMessage: vi.fn<(request: PdfWorkerRequest) => void>(),
        terminate: vi.fn(),
      });
      const view = render(
        <UtilityWorkbench surface={surface} createWorker={() => worker as unknown as Worker} />,
      );
      const ui = within(view.container);
      fireEvent.click(ui.getByRole('button', { name: /Create blank PDF/u }));
      const start = async () => {
        fireEvent.change(ui.getByLabelText('Number of pages'), { target: { value: '3' } });
        fireEvent.click(ui.getByRole('button', { name: 'Create export' }));
        await waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
        const request = worker.postMessage.mock.calls.at(-1)?.[0];
        if (request?.kind !== 'blank-pdf') throw new Error('Missing synthetic blank request');
        expect(request.options.pageCount).toBe(3);
        return request;
      };
      const finish = async (request: Awaited<ReturnType<typeof start>>, ok = true) => {
        const response: PdfWorkerResponse = ok
          ? {
              id: request.id,
              ok: true,
              payload: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) },
            }
          : { id: request.id, ok: false, message: 'private blank error canary' };
        await act(async () => {
          worker.dispatchEvent(new MessageEvent('message', { data: response }));
          await Promise.resolve();
        });
      };
      return { ...view, ui, worker, start, finish };
    };

    it('invalidates a completed download synchronously on a page-count change', async () => {
      const { ui, start, finish } = setup();
      await finish(await start());
      expect(ui.getByRole('button', { name: 'Download new copy' })).toBeVisible();
      expect(ui.getByText(/3 blank pages · US Letter/u)).toBeVisible();
      fireEvent.change(ui.getByLabelText('Number of pages'), { target: { value: '2' } });
      expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
      expect(ui.getByRole('button', { name: 'Create export' })).toBeEnabled();
    });

    it('terminates pending work and ignores its late reply after count changes', async () => {
      const { ui, worker, start, finish } = setup();
      const request = await start();
      fireEvent.change(ui.getByLabelText('Number of pages'), { target: { value: '2' } });
      await finish(request);
      expect(worker.terminate).toHaveBeenCalled();
      expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
      expect(ui.getByRole('status')).toHaveTextContent('Settings changed');
    });

    it('shows a safe failure without raw worker details and allows retry', async () => {
      const { ui, start, finish } = setup();
      await finish(await start(), false);
      expect(ui.queryByText(/private blank error canary/u)).toBeNull();
      expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
      expect(ui.getByRole('button', { name: 'Create export' })).toBeEnabled();
    });
  },
);
