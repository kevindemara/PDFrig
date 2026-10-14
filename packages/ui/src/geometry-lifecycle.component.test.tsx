import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  PdfGeometryInspection,
  PdfPageGeometry,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from '@pdfmason/pdf-engine/browser';
import { UtilityWorkbench } from './utility-workbench.js';

const settle = async (action: () => void): Promise<void> => {
  await act(async () => {
    action();
    await Promise.resolve();
  });
};
const sourcePage: PdfPageGeometry = {
  cropBox: { x: 0, y: 0, width: 612, height: 792 },
  mediaBox: { x: 0, y: 0, width: 612, height: 792 },
  pageNumber: 1,
  rotation: 0,
  visibleHeight: 792,
  visibleWidth: 612,
};
const inspection: PdfGeometryInspection = {
  pageCount: 3,
  pages: [1, 2, 3].map((pageNumber) => ({ ...sourcePage, pageNumber })),
};
const syntheticFile = () =>
  new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });

const setup = () => {
  // Double only the transport, not the real worker client or its promise lifecycle.
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
      surface="Windows"
    />,
  );
  const ui = within(view.container);
  fireEvent.click(ui.getByRole('button', { name: /Crop \+ resize pages/u }));
  const change = (label: string, value: string) =>
    fireEvent.change(ui.getByLabelText(label), { target: { value } });
  const select = (files = [syntheticFile()]) => {
    const input = view.container.querySelector('input[type="file"]');
    if (input === null) throw new Error('Missing synthetic chooser');
    fireEvent.change(input, { target: { files } });
  };
  const request = async <K extends 'geometry-inspect' | 'geometry-modify'>(kind: K) => {
    await waitFor(() => expect(workers.at(-1)?.postMessage.mock.calls.at(-1)?.[0].kind).toBe(kind));
    const worker = workers.at(-1);
    const message = worker?.postMessage.mock.calls.at(-1)?.[0];
    if (worker === undefined || message?.kind !== kind) throw new Error('Missing geometry request');
    return { worker, message: message as Extract<PdfWorkerRequest, { kind: K }> };
  };
  const finish = (
    job: {
      worker: ReturnType<typeof makeWorker>;
      message: Extract<PdfWorkerRequest, { kind: 'geometry-inspect' | 'geometry-modify' }>;
    },
    ok = true,
    measured = inspection,
  ) => {
    const message = job.message;
    let response: PdfWorkerResponse;
    if (!ok) response = { id: message.id, ok: false, message: 'private failure canary' };
    else if (message.kind === 'geometry-inspect')
      response = {
        id: message.id,
        ok: true,
        payload: { kind: 'geometry-inspection', inspection: measured },
      };
    else {
      const options = message.options;
      const width =
        options.kind === 'crop'
          ? 612 - options.margins.left - options.margins.right
          : options.targetWidth;
      const height =
        options.kind === 'crop'
          ? 792 - options.margins.top - options.margins.bottom
          : options.targetHeight;
      response = {
        id: message.id,
        ok: true,
        payload: {
          kind: 'geometry-result',
          bytes: new Uint8Array([37, 80, 68, 70]),
          report: {
            appliedPages: (options.endPage ?? 3) - options.startPage + 1,
            firstPageAfter: { ...sourcePage, visibleHeight: height, visibleWidth: width },
            firstPageBefore: sourcePage,
            kind: options.kind,
            operationVersion: '1.0.0',
            range: { startPage: options.startPage, endPage: options.endPage ?? 3 },
            sourcePages: 3,
          },
        },
      };
    }
    job.worker.dispatchEvent(new MessageEvent('message', { data: response }));
  };
  const ready = async () => {
    select();
    const job = await request('geometry-inspect');
    await settle(() => finish(job));
    return job;
  };
  const start = async () => {
    fireEvent.click(ui.getByRole('button', { name: 'Create export' }));
    return request('geometry-modify');
  };
  const noDownload = () =>
    expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
  return { ...view, ui, workers, change, select, request, finish, ready, start, noDownload };
};

describe('ORG-009 / ORG-010 geometry result lifecycle', () => {
  it.each([
    ['crop', 'First PDF page', '2', true],
    ['crop', 'Last PDF page (optional)', '1', true],
    ['crop', 'First PDF page', '4', false],
    ['crop', 'Top margin (pt)', '12', true],
    ['crop', 'Right margin (pt)', '12', true],
    ['crop', 'Bottom margin (pt)', '12', true],
    ['crop', 'Left margin (pt)', '12', true],
    ['crop', 'Left margin (pt)', '600', false],
    ['crop', 'mode', 'Normalize page size', true],
    ['resize', 'mode', 'Crop visible area', true],
    ['resize', 'Target size', 'a4', true],
    ['resize', 'Orientation', 'landscape', true],
    ['resize', 'Content fit', 'cover', true],
    ['custom', 'Target width (pt)', '720', true],
    ['custom', 'Target height (pt)', '600', true],
    ['custom', 'Target width (pt)', '0', false],
  ] as const)(
    'discards completed %s output when %s changes to %s',
    async (mode, label, value, valid) => {
      const test = setup();
      await test.ready();
      if (mode !== 'crop')
        fireEvent.click(test.ui.getByRole('button', { name: 'Normalize page size' }));
      if (mode === 'custom') test.change('Target size', 'custom');
      const job = await test.start();
      await settle(() => test.finish(job));
      expect(test.ui.getByRole('button', { name: 'Download new copy' })).toBeEnabled();
      if (label === 'mode') fireEvent.click(test.ui.getByRole('button', { name: value }));
      else test.change(label, value);
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
      const create = test.ui.getByRole('button', { name: 'Create export' });
      if (valid) expect(create).toBeEnabled();
      else expect(create).toBeDisabled();
      expect(test.ui.getByLabelText('Page geometry preview')).toHaveTextContent(
        '3 pages inspected',
      );
    },
  );

  it.each(['pending', 'success', 'failure'] as const)(
    'ignores %s export completion after editing and retries without inspecting again',
    async (completion) => {
      const test = setup();
      await test.ready();
      const old = await test.start();
      await settle(() => {
        if (completion !== 'pending') test.finish(old, completion === 'success');
        test.change('Left margin (pt)', '12');
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
      const current = await test.start();
      expect(current.message.options).toMatchObject({ kind: 'crop', margins: { left: 12 } });
      expect(current.message.bytes).toEqual(old.message.bytes);
      await settle(() => test.finish(current));
      await settle(() => test.finish(old));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
      expect(test.ui.getByText(/564 × 720 pt first result/u)).toBeVisible();
      expect(
        test.workers
          .flatMap((worker) => worker.postMessage.mock.calls)
          .filter(([message]) => message.kind === 'geometry-inspect'),
      ).toHaveLength(1);
      expect(test.ui.queryByText(/canary/u)).toBeNull();
    },
  );

  it.each(['pending', 'resolved'] as const)(
    'preserves %s source inspection while settings change and uses the latest controls',
    async (phase) => {
      const test = setup();
      test.select();
      const job = await test.request('geometry-inspect');
      fireEvent.click(test.ui.getByRole('button', { name: 'Normalize page size' }));
      await settle(() => {
        if (phase === 'resolved') test.finish(job);
        test.change('Target size', 'a4');
        test.change('Orientation', 'landscape');
      });
      expect(job.worker.terminate).not.toHaveBeenCalled();
      if (phase === 'pending') {
        expect(test.ui.getByRole('status')).toHaveTextContent('Measuring');
        await settle(() => test.finish(job));
      }
      expect(test.ui.getByLabelText('Page geometry preview')).toHaveTextContent(
        'Result: 842 × 595 pt',
      );
      const current = await test.start();
      expect(current.message.options).toMatchObject({
        kind: 'resize',
        targetWidth: 841.89,
        targetHeight: 595.28,
      });
      await settle(() => test.finish(current));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
    },
  );

  it.each(['replace', 'clear', 'invalid', 'tool', 'unmount'] as const)(
    'rejects already resolved export after %s',
    async (action) => {
      const test = setup();
      await test.ready();
      const old = await test.start();
      await settle(() => {
        test.finish(old);
        if (action === 'replace') test.select();
        if (action === 'clear') test.select([]);
        if (action === 'invalid')
          test.select([new File(['text'], 'synthetic.txt', { type: 'text/plain' })]);
        if (action === 'tool') fireEvent.click(test.ui.getByRole('button', { name: /Compress/u }));
        if (action === 'unmount') test.unmount();
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      if (action !== 'unmount')
        expect(test.ui.getByRole('status')).not.toHaveTextContent('Export ready');
    },
  );

  it('does not let an old inspection failure clear the newly measured source', async () => {
    const test = setup();
    test.select();
    const old = await test.request('geometry-inspect');
    await settle(() => {
      test.finish(old, false);
      test.select();
    });
    const current = await test.request('geometry-inspect');
    await settle(() => test.finish(current));
    expect(test.ui.getByRole('button', { name: 'Create export' })).toBeEnabled();
    expect(test.ui.getByRole('status')).toHaveTextContent('3 pages measured');
    expect(test.ui.queryByText(/canary/u)).toBeNull();
  });

  it.each(['replace', 'clear', 'invalid', 'tool', 'unmount'] as const)(
    'rejects already resolved inspection after %s',
    async (action) => {
      const test = setup();
      test.select();
      const old = await test.request('geometry-inspect');
      await settle(() => {
        test.finish(old);
        if (action === 'replace') test.select();
        if (action === 'clear') test.select([]);
        if (action === 'invalid')
          test.select([new File(['text'], 'synthetic.txt', { type: 'text/plain' })]);
        if (action === 'tool') fireEvent.click(test.ui.getByRole('button', { name: /Compress/u }));
        if (action === 'unmount') test.unmount();
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      if (action === 'replace') {
        expect(test.ui.getByRole('status')).toHaveTextContent('Measuring');
        const current = await test.request('geometry-inspect');
        await settle(() => test.finish(current, true, { pageCount: 1, pages: [sourcePage] }));
        expect(test.ui.getByRole('status')).toHaveTextContent('1 page measured');
      } else if (action !== 'unmount') {
        expect(test.ui.getByRole('status')).not.toHaveTextContent('measured locally');
      }
    },
  );

  it.each(['settings', 'replace'] as const)(
    'handles %s during a delayed source read',
    async (action) => {
      const test = setup();
      let completeRead: (bytes: ArrayBuffer) => void = () => undefined;
      const delayed = new Promise<ArrayBuffer>((resolve) => {
        completeRead = resolve;
      });
      const file = syntheticFile();
      vi.spyOn(file, 'arrayBuffer').mockReturnValue(delayed);
      test.select([file]);
      test.change('Left margin (pt)', '12');
      if (action === 'replace') test.select();
      await act(async () => {
        completeRead(new ArrayBuffer(4));
        await delayed;
      });
      const current = await test.request('geometry-inspect');
      expect(test.workers.flatMap((worker) => worker.postMessage.mock.calls)).toHaveLength(1);
      expect(current.message.bytes.byteLength).toBe(action === 'settings' ? 4 : 14);
      await settle(() => test.finish(current));
      expect(test.ui.getByLabelText('Page geometry preview')).toHaveTextContent(
        'Result: 564 × 720 pt',
      );
    },
  );

  it('recovers from inspection and export failures without exposing raw errors', async () => {
    const test = setup();
    test.select();
    const failed = await test.request('geometry-inspect');
    await settle(() => test.finish(failed, false));
    expect(test.ui.getByRole('button', { name: 'Create export' })).toBeDisabled();
    await test.ready();
    const job = await test.start();
    await settle(() => test.finish(job, false));
    test.noDownload();
    expect(test.ui.queryByText(/canary/u)).toBeNull();
    const retry = await test.start();
    await settle(() => test.finish(retry));
    expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
  });
});
