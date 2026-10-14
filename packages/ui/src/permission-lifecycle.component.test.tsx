import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@pdfmason/pdf-engine/browser';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_UTILITY_FEATURES, UtilityWorkbench } from './utility-workbench.js';

const fixture = () => new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
const owner = 'synthetic-owner-password';
const settle = async (action: () => void) =>
  act(async () => {
    action();
    await Promise.resolve();
  });
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
      enabledFeatures={{ ...DEFAULT_UTILITY_FEATURES, permissions: true }}
      createWorker={() => {
        const worker = makeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      }}
    />,
  );
  const ui = within(view.container);
  fireEvent.click(ui.getByRole('button', { name: /PDF permissions/u }));
  const choose = (file = fixture()) => {
    const input = view.container.querySelector('input[type="file"]');
    if (input === null) throw new Error('Missing chooser');
    fireEvent.change(input, { target: { files: [file] } });
  };
  const credentials = (open = '') => {
    fireEvent.change(ui.getByLabelText('Owner password'), { target: { value: owner } });
    fireEvent.change(ui.getByLabelText('Open password (optional)'), { target: { value: open } });
  };
  const authority = () => ui.getByLabelText('I am authorized to set this document’s permissions.');
  const confirm = () =>
    ui.getByLabelText('I reviewed the password roles and understand the permission limitations.');
  const create = () => ui.getByRole('button', { name: 'Create permission copy' });
  const start = async (open = '') => {
    credentials(open);
    if (!(authority() as HTMLInputElement).checked) fireEvent.click(authority());
    fireEvent.click(confirm());
    fireEvent.click(create());
    await waitFor(() => expect(workers.at(-1)?.postMessage).toHaveBeenCalled());
    const worker = workers.at(-1);
    const request = worker?.postMessage.mock.calls.at(-1)?.[0];
    if (worker === undefined || request?.kind !== 'permissions') throw new Error('Missing request');
    return { worker, request };
  };
  const finish = (job: Awaited<ReturnType<typeof start>>, error?: string) => {
    const response: PdfWorkerResponse =
      error === undefined
        ? {
            id: job.request.id,
            ok: true,
            payload: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) },
          }
        : { id: job.request.id, ok: false, message: error };
    job.worker.dispatchEvent(new MessageEvent('message', { data: response }));
  };
  const noOutput = () =>
    expect(ui.queryByRole('button', { name: 'Download reviewed permission copy' })).toBeNull();
  choose();
  return {
    ...view,
    ui,
    choose,
    credentials,
    authority,
    confirm,
    create,
    start,
    finish,
    noOutput,
    workers,
  };
};

describe.each(['Web', 'Windows'] as const)('SEC-003 %s permission ownership', (surface) => {
  it('requires authority, role review and post-result review; clears credentials and retires the worker', async () => {
    const t = setup(surface);
    t.credentials('synthetic-open-password');
    expect(t.create()).toBeDisabled();
    fireEvent.click(t.authority());
    expect(t.create()).toBeDisabled();
    const job = await t.start('synthetic-open-password');
    expect(job.request).toMatchObject({
      ownerPassword: owner,
      openPassword: 'synthetic-open-password',
      authorized: true,
    });
    await settle(() => t.finish(job));
    expect(job.worker.terminate).toHaveBeenCalled();
    expect(t.ui.getByLabelText('Owner password')).toHaveValue('');
    expect(t.ui.getByLabelText('Open password (optional)')).toHaveValue('');
    expect(t.ui.getByText(/requires the selected open password/u)).toBeVisible();
    const download = t.ui.getByRole('button', { name: 'Download reviewed permission copy' });
    expect(download).toBeDisabled();
    fireEvent.click(
      t.ui.getByLabelText('I reviewed these permissions and will keep the owner password private.'),
    );
    expect(download).toBeEnabled();
  });
  it('supports an empty open password with an explicit extraction disclosure', async () => {
    const t = setup(surface);
    const job = await t.start();
    expect(job.request.openPassword).toBe('');
    await settle(() => t.finish(job));
    expect(t.ui.getByText(/has no open password; anyone can open and extract it/u)).toBeVisible();
  });
  it.each(['short', owner, 'unicode-password-😀', 'x'.repeat(128)])(
    'blocks unsupported open password %s before dispatch',
    (open) => {
      const t = setup(surface);
      t.credentials(open);
      fireEvent.click(t.authority());
      fireEvent.click(t.confirm());
      expect(t.create()).toBeDisabled();
      expect(t.workers).toHaveLength(0);
    },
  );
  it('enforces the annotation/form-filling invariant in both directions', () => {
    const t = setup(surface);
    fireEvent.click(t.ui.getByLabelText('Fill form fields'));
    expect(t.ui.getByLabelText('Add annotations')).not.toBeChecked();
    fireEvent.click(t.ui.getByLabelText('Add annotations'));
    expect(t.ui.getByLabelText('Fill form fields')).toBeChecked();
    expect(t.ui.getByText('Accessibility extraction: always allowed')).toBeVisible();
  });
  it.each([
    'printing',
    'copying',
    'modifying',
    'annotating',
    'forms',
    'assembly',
    'owner',
    'open',
    'authority',
  ])('discards a completed copy when %s changes', async (change) => {
    const t = setup(surface);
    const job = await t.start();
    await settle(() => t.finish(job));
    if (change === 'printing')
      fireEvent.change(t.ui.getByLabelText('Printing permission'), { target: { value: 'none' } });
    const labels: Readonly<Record<string, string>> = {
      copying: 'Copy text and images',
      modifying: 'Modify page content',
      annotating: 'Add annotations',
      forms: 'Fill form fields',
      assembly: 'Combine and rearrange pages',
    };
    const label = labels[change];
    if (label !== undefined) fireEvent.click(t.ui.getByLabelText(label));
    if (change === 'owner' || change === 'open')
      fireEvent.change(
        t.ui.getByLabelText(change === 'owner' ? 'Owner password' : 'Open password (optional)'),
        { target: { value: 'replacement-password' } },
      );
    if (change === 'authority') fireEvent.click(t.authority());
    t.noOutput();
    expect(t.confirm()).not.toBeChecked();
  });
  it.each(['cancel', 'settings', 'authority', 'file', 'tool', 'teardown', 'gate'])(
    'rejects late completion after %s without clearing replacement credentials',
    async (change) => {
      const t = setup(surface);
      const job = await t.start();
      if (change === 'cancel')
        fireEvent.click(t.ui.getByRole('button', { name: 'Cancel permission changes' }));
      if (change === 'settings') fireEvent.click(t.ui.getByLabelText('Copy text and images'));
      if (change === 'authority') fireEvent.click(t.authority());
      if (change === 'file') t.choose();
      if (change === 'tool') fireEvent.click(t.ui.getByRole('button', { name: /Compress/u }));
      if (change === 'teardown') t.unmount();
      if (change === 'gate') t.rerender(<UtilityWorkbench surface={surface} />);
      if (!['tool', 'teardown', 'gate'].includes(change))
        t.credentials('replacement-open-password');
      await settle(() => t.finish(job));
      expect(job.worker.terminate).toHaveBeenCalled();
      t.noOutput();
      if (!['tool', 'teardown', 'gate'].includes(change))
        expect(t.ui.getByLabelText('Open password (optional)')).toHaveValue(
          'replacement-open-password',
        );
      if (change === 'file') expect(t.authority()).not.toBeChecked();
    },
  );
  it('sanitizes worker failure and permits an explicitly reviewed retry', async () => {
    const t = setup(surface);
    const job = await t.start();
    await settle(() => t.finish(job, 'private-password-document-canary'));
    t.noOutput();
    expect(t.ui.getByRole('alert')).not.toHaveTextContent('canary');
    expect(t.ui.getByRole('alert')).toHaveTextContent('Your original is unchanged');
    expect(t.ui.getByLabelText('Owner password')).toHaveValue('');
    expect(job.worker.terminate).toHaveBeenCalled();
  });
  it('discards a stale source read before dispatch without erasing new credentials', async () => {
    const t = setup(surface);
    const file = fixture();
    let finishRead: (bytes: ArrayBuffer) => void = () => {
      throw new Error('Read not started');
    };
    const read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    );
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    t.choose(file);
    t.credentials();
    fireEvent.click(t.authority());
    fireEvent.click(t.confirm());
    fireEvent.click(t.create());
    await waitFor(() => expect(read).toHaveBeenCalled());
    t.choose();
    t.credentials('replacement-open-password');
    await settle(() => finishRead(new Uint8Array([37, 80, 68, 70]).buffer));
    expect(t.workers[0]?.postMessage).not.toHaveBeenCalled();
    expect(t.workers[0]?.terminate).toHaveBeenCalled();
    expect(t.ui.getByLabelText('Open password (optional)')).toHaveValue(
      'replacement-open-password',
    );
    expect(t.authority()).not.toBeChecked();
    t.noOutput();
  });
  it.each(['empty', 'extension', 'mime', 'oversize'])(
    'rejects %s input without reading or dispatching',
    (kind) => {
      const t = setup(surface);
      const file = new File(
        kind === 'empty' ? [] : ['synthetic'],
        kind === 'extension' ? 'synthetic.txt' : 'synthetic.pdf',
        { type: kind === 'mime' ? 'text/plain' : 'application/pdf' },
      );
      if (kind === 'oversize') Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
      const read = vi.spyOn(file, 'arrayBuffer');
      t.choose(file);
      expect(t.ui.getByRole('alert')).toHaveTextContent('Choose one non-empty PDF');
      t.credentials();
      fireEvent.click(t.authority());
      fireEvent.click(t.confirm());
      expect(t.create()).toBeDisabled();
      expect(read).not.toHaveBeenCalled();
      expect(t.workers).toHaveLength(0);
    },
  );
});

it('keeps SEC-003 controls unavailable with default distribution flags', () => {
  const view = render(<UtilityWorkbench surface="Windows" />);
  expect(within(view.container).getByRole('button', { name: /PDF permissions/u })).toBeDisabled();
});
