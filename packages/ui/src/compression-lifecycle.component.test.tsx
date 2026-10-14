import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import type {
  CompressionPreset,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from '@pdfmason/pdf-engine/browser';
import { describe, expect, it, vi } from 'vitest';
import { UtilityWorkbench } from './utility-workbench.js';

const settle = async (action: () => void): Promise<void> => {
  await act(async () => {
    action();
    await Promise.resolve();
  });
};
const presetLabels = {
  balanced: 'Balanced',
  'highest-quality': 'Highest quality',
  smaller: 'Smaller',
} as const;
const syntheticFile = () =>
  new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
const safeCompressionFailures = [
  ['UTILITY_ACTIVE_CONTENT_BLOCKED', /contains active content/u],
  ['UTILITY_ATTACHMENTS_BLOCKED', /contains attachments/u],
  ['UTILITY_INCREMENTAL_REVISIONS_BLOCKED', /contains earlier revisions/u],
  ['UTILITY_PDF_MALFORMED', /damaged or incomplete structure/u],
  ['UTILITY_PRESERVATION_FAILED', /could not verify that the document structure was preserved/u],
  ['UTILITY_SIGNATURES_BLOCKED', /digital-signature structure/u],
  ['UTILITY_XFA_BLOCKED', /uses XFA/u],
] as const;
const setup = (surface: 'Web' | 'Windows' = 'Windows') => {
  // Only the Worker transport is doubled; exercise the real pending-promise client.
  const makeWorker = () =>
    Object.assign(new EventTarget(), {
      postMessage: vi.fn<(request: PdfWorkerRequest) => void>(),
      terminate: vi.fn(),
    });
  const workers: ReturnType<typeof makeWorker>[] = [];
  const view = render(
    <UtilityWorkbench
      createWorker={() => {
        const worker = makeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      }}
      surface={surface}
    />,
  );
  const ui = within(view.container);
  const changePreset = (preset: CompressionPreset) =>
    fireEvent.click(ui.getByRole('radio', { name: presetLabels[preset] }));
  const select = (files = [syntheticFile()]) => {
    const input = view.container.querySelector('input[type="file"]');
    if (input === null) throw new Error('Missing synthetic chooser');
    fireEvent.change(input, { target: { files } });
  };
  const start = async () => {
    fireEvent.click(ui.getByRole('button', { name: 'Create export' }));
    await waitFor(() => expect(workers.at(-1)?.postMessage).toHaveBeenCalled());
    const worker = workers.at(-1);
    const request = worker?.postMessage.mock.calls.at(-1)?.[0];
    if (worker === undefined || request?.kind !== 'compress')
      throw new Error('Missing compression request');
    return { worker, request };
  };
  const finish = (job: Awaited<ReturnType<typeof start>>, ok = true, usedOriginal = false) => {
    const response: PdfWorkerResponse = ok
      ? {
          id: job.request.id,
          ok: true,
          payload: {
            kind: 'compression',
            bytes: usedOriginal ? job.request.bytes.slice() : new Uint8Array([37, 80, 68, 70]),
            report: {
              method: 'lossless-structural',
              originalBytes: job.request.bytes.byteLength,
              outputBytes: usedOriginal ? job.request.bytes.byteLength : 4,
              preset: job.request.preset,
              reductionPercent: usedOriginal ? 0 : 71.4,
              usedOriginal,
              warningCodes: usedOriginal
                ? ['LOSSLESS_ONLY', 'ALREADY_OPTIMIZED']
                : ['LOSSLESS_ONLY'],
            },
          },
        }
      : { id: job.request.id, ok: false, message: 'private compression failure canary' };
    job.worker.dispatchEvent(new MessageEvent('message', { data: response }));
  };
  const noDownload = () =>
    expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
  return { ...view, ui, workers, select, start, finish, changePreset, noDownload };
};

describe.each(['Web', 'Windows'] as const)('OPT-001 %s completed-result ownership', (surface) => {
  it.each(safeCompressionFailures)(
    'explains %s and recovers with a replacement',
    async (code, copy) => {
      const test = setup(surface);
      test.select();
      const failed = await test.start();
      await settle(() =>
        failed.worker.dispatchEvent(
          new MessageEvent('message', {
            data: {
              id: failed.request.id,
              ok: false,
              message: code,
            } satisfies PdfWorkerResponse,
          }),
        ),
      );
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent(copy);
      expect(test.ui.queryByText(code, { exact: true })).toBeNull();
      test.select();
      const retry = await test.start();
      await settle(() => test.finish(retry));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
    },
  );

  it('explains the page cap without a download and recovers with a replacement source', async () => {
    const test = setup(surface);
    test.select();
    const failed = await test.start();
    await settle(() =>
      failed.worker.dispatchEvent(
        new MessageEvent('message', {
          data: {
            id: failed.request.id,
            ok: false,
            message: 'UTILITY_PDF_PAGE_LIMIT',
          } satisfies PdfWorkerResponse,
        }),
      ),
    );
    test.noDownload();
    expect(test.ui.getByRole('status')).toHaveTextContent(
      'Compression supports PDFs up to 500 pages. Choose a smaller PDF. Your original was not changed.',
    );
    expect(test.ui.queryByText(/UTILITY_PDF_PAGE_LIMIT/u)).toBeNull();
    test.select();
    const retry = await test.start();
    await settle(() => test.finish(retry));
    expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
    expect(test.ui.getByRole('button', { name: 'Download new copy' })).toBeEnabled();
  });

  it.each(['balanced', 'highest-quality', 'smaller'] as const)(
    'discards the old download when selecting %s',
    async (preset) => {
      const test = setup(surface);
      test.select();
      test.changePreset(preset === 'balanced' ? 'smaller' : 'balanced');
      const old = await test.start();
      await settle(() => test.finish(old));
      expect(test.ui.getByRole('button', { name: 'Download new copy' })).toBeEnabled();
      test.changePreset(preset);
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      expect(test.workers).toHaveLength(1);
      const current = await test.start();
      expect(current.request.preset).toBe(preset);
      expect(current.request.bytes).toEqual(old.request.bytes);
      await settle(() => test.finish(current, true, true));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
      expect(test.ui.getByText(/Already structurally optimized/u)).toBeVisible();
      expect(test.ui.getByText(/Lossless only: no image resampling/u)).toBeVisible();
    },
  );
});

describe('OPT-001 attempt isolation', () => {
  it.each(['pending', 'success', 'failure'] as const)(
    'ignores %s old completion when the preset changes',
    async (completion) => {
      const test = setup();
      test.select();
      const old = await test.start();
      await settle(() => {
        if (completion !== 'pending') test.finish(old, completion === 'success');
        test.changePreset('smaller');
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
      test.noDownload();
      const current = await test.start();
      await settle(() => test.finish(current, true, true));
      await settle(() => test.finish(old));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
      expect(test.ui.getByText(/Already structurally optimized/u)).toBeVisible();
      expect(test.ui.queryByText(/71.4% smaller/u)).toBeNull();
      expect(test.ui.queryByText(/canary/u)).toBeNull();
    },
  );

  it.each(['replace', 'clear', 'invalid', 'tool', 'unmount'] as const)(
    'rejects an already resolved export after %s',
    async (action) => {
      const test = setup();
      test.select();
      const old = await test.start();
      await settle(() => {
        test.finish(old);
        if (action === 'replace') test.select();
        if (action === 'clear') test.select([]);
        if (action === 'invalid')
          test.select([new File(['text'], 'synthetic.txt', { type: 'text/plain' })]);
        if (action === 'tool')
          fireEvent.click(test.ui.getByRole('button', { name: /Crop \+ resize pages/u }));
        if (action === 'unmount') test.unmount();
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      if (action !== 'unmount')
        expect(test.ui.getByRole('status')).not.toHaveTextContent('Export ready');
    },
  );

  it.each(['success', 'failure'] as const)(
    'ignores a superseded file-read %s before enqueue and can retry',
    async (completion) => {
      const test = setup();
      let resolveRead: (bytes: ArrayBuffer) => void = () => undefined;
      let rejectRead: (error: Error) => void = () => undefined;
      const delayed = new Promise<ArrayBuffer>((resolve, reject) => {
        resolveRead = resolve;
        rejectRead = reject;
      });
      const file = syntheticFile();
      const read = vi.spyOn(file, 'arrayBuffer').mockReturnValue(delayed);
      test.select([file]);
      fireEvent.click(test.ui.getByRole('button', { name: 'Create export' }));
      test.changePreset('smaller');
      await settle(() => {
        if (completion === 'success') resolveRead(new ArrayBuffer(4));
        else rejectRead(new Error('private read failure canary'));
      });
      expect(test.workers.every((worker) => worker.postMessage.mock.calls.length === 0)).toBe(true);
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
      read.mockRestore();
      const current = await test.start();
      expect(current.request.preset).toBe('smaller');
      await settle(() => test.finish(current));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
      expect(test.ui.queryByText(/canary/u)).toBeNull();
    },
  );

  it('recovers from a current failure without exposing raw errors', async () => {
    const test = setup();
    test.select();
    const failed = await test.start();
    await settle(() => test.finish(failed, false));
    test.noDownload();
    expect(test.ui.queryByText(/canary/u)).toBeNull();
    const retry = await test.start();
    await settle(() => test.finish(retry));
    expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
  });

  it('does not start work on preset selection without a file', () => {
    const test = setup();
    test.changePreset('smaller');
    expect(test.ui.getByRole('button', { name: 'Create export' })).toBeDisabled();
    expect(test.ui.getByRole('status')).toHaveTextContent('Choose a file');
    expect(test.workers).toHaveLength(0);
  });

  it('keeps the result when clicking the already selected preset', async () => {
    const test = setup();
    test.select();
    const job = await test.start();
    await settle(() => test.finish(job));
    test.changePreset('balanced');
    expect(test.ui.getByRole('button', { name: 'Download new copy' })).toBeEnabled();
    expect(job.worker.terminate).not.toHaveBeenCalled();
  });
});
