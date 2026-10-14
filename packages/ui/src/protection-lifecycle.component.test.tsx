import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@pdfmason/pdf-engine/browser';
import { describe, expect, it, vi } from 'vitest';
import { UtilityWorkbench } from './utility-workbench.js';

const file = () => new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
const settle = async (action: () => void) => {
  await act(async () => {
    action();
    await Promise.resolve();
  });
};
const setup = (surface: 'Web' | 'Windows') => {
  const makeWorker = () =>
    Object.assign(new EventTarget(), {
      postMessage: vi.fn<(request: PdfWorkerRequest) => void>(),
      terminate: vi.fn(),
    });
  const workers: ReturnType<typeof makeWorker>[] = [];
  const view = render(
    <UtilityWorkbench
      surface={surface}
      createWorker={() => {
        const worker = makeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      }}
    />,
  );
  const ui = within(view.container);
  fireEvent.click(ui.getByRole('button', { name: /Protect \/ unlock/u }));
  const select = () => {
    const chooser = view.container.querySelector('input[type="file"]');
    if (chooser === null) throw new Error('Missing chooser');
    fireEvent.change(chooser, { target: { files: [file()] } });
  };
  select();
  const password = () => ui.getByLabelText(/(?:New|Current) open password/u);
  const typePassword = () =>
    fireEvent.change(password(), { target: { value: 'synthetic-private-password' } });
  const start = async () => {
    typePassword();
    fireEvent.click(ui.getByRole('button', { name: 'Create export' }));
    await waitFor(() => expect(workers.at(-1)?.postMessage).toHaveBeenCalled());
    const worker = workers.at(-1);
    const request = worker?.postMessage.mock.calls.at(-1)?.[0];
    if (worker === undefined || (request?.kind !== 'protect' && request?.kind !== 'unlock'))
      throw new Error('Missing protection request');
    return { worker, request };
  };
  const finish = (job: Awaited<ReturnType<typeof start>>, message?: string) => {
    const response: PdfWorkerResponse =
      message === undefined
        ? {
            id: job.request.id,
            ok: true,
            payload: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) },
          }
        : { id: job.request.id, ok: false, message };
    job.worker.dispatchEvent(new MessageEvent('message', { data: response }));
  };
  const noDownload = () =>
    expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
  return { ...view, ui, start, finish, select, password, typePassword, noDownload };
};

describe.each(['Web', 'Windows'] as const)(
  'SEC-001/002 %s credential and result ownership',
  (surface) => {
    it('clears credentials and terminates the worker after success; new credentials invalidate output', async () => {
      const test = setup(surface);
      const job = await test.start();
      await settle(() => test.finish(job));
      expect(test.password()).toHaveValue('');
      expect(job.worker.terminate).toHaveBeenCalled();
      expect(test.ui.getByRole('button', { name: 'Download new copy' })).toBeEnabled();
      test.typePassword();
      test.noDownload();
    });
    it.each(['mode', 'file', 'tool', 'teardown'] as const)(
      'discards pending work on %s, including late credentials cleanup',
      async (change) => {
        const test = setup(surface);
        const job = await test.start();
        if (change === 'mode')
          fireEvent.click(test.ui.getByRole('button', { name: 'Unlock a copy' }));
        if (change === 'file') test.select();
        if (change === 'tool')
          fireEvent.click(test.ui.getByRole('button', { name: /Compress OPT-001/u }));
        if (change === 'teardown') test.unmount();
        expect(job.worker.terminate).toHaveBeenCalled();
        if (change === 'mode' || change === 'file') {
          expect(test.password()).toHaveValue('');
          test.typePassword();
        }
        await settle(() => test.finish(job));
        test.noDownload();
        if (change === 'mode' || change === 'file')
          expect(test.password()).toHaveValue('synthetic-private-password');
        expect(test.ui.queryByText(/Export ready/u)).toBeNull();
      },
    );
    it('requires fresh authorization for replacement sources and retires revoked unlock work', async () => {
      const test = setup(surface);
      fireEvent.click(test.ui.getByRole('button', { name: 'Unlock a copy' }));
      const authority = () => test.ui.getByRole('checkbox', { name: /I am authorized/u });
      fireEvent.click(authority());
      const job = await test.start();
      fireEvent.click(authority());
      expect(job.worker.terminate).toHaveBeenCalled();
      await settle(() => test.finish(job));
      test.noDownload();
      fireEvent.click(authority());
      test.select();
      expect(authority()).not.toBeChecked();
      expect(test.password()).toHaveValue('');
      expect(test.ui.getByRole('button', { name: 'Create export' })).toBeDisabled();
    });
    it.each([
      'UTILITY_PERMISSIONS_STRING_LAYOUT_BLOCKED',
      'UTILITY_DECRYPT_VERIFICATION_FAILED',
      'private-parser-password-canary',
    ] as const)('clears passwords on safe failure %s and allows retry', async (code) => {
      const test = setup(surface);
      const job = await test.start();
      await settle(() => test.finish(job, code));
      test.noDownload();
      expect(test.password()).toHaveValue('');
      expect(job.worker.terminate).toHaveBeenCalled();
      expect(test.ui.queryByText(code, { exact: true })).toBeNull();
      const retry = await test.start();
      await settle(() => test.finish(retry));
      expect(test.ui.getByRole('button', { name: 'Download new copy' })).toBeEnabled();
    });
  },
);
