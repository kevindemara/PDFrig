import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormDataPanel } from './form-data-panel.js';

const definitions = [{ fieldName: 'name', type: 'text' as const, readOnly: false, options: [] }];
const values = [
  { fieldName: 'name', type: 'text' as const, sourceId: 'source', value: 'Before' },
] as const;
const report = {
  schema: 'pdfmason.form-data',
  version: 1,
  fields: [{ fieldName: 'name', type: 'text', value: '<script>SYNTHETIC</script>' }],
};
const bytes = new TextEncoder().encode(JSON.stringify(report));
const load = (buffer = bytes) => {
  const file = new File([buffer], 'private-filename.json', { type: 'application/json' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer.buffer) });
  fireEvent.change(screen.getByLabelText('Import form data JSON'), { target: { files: [file] } });
};
const props = () => ({
  definitions,
  values,
  sourceId: 'source',
  onApply: vi.fn(),
  onSave: vi.fn((bytes: Uint8Array) => Promise.resolve(bytes.byteLength > 0)),
});

describe('FORM-003 review and lifecycle', () => {
  it('requires review, escapes values, applies only on confirmation, and explains privacy', async () => {
    const callbacks = props();
    const { container } = render(<FormDataPanel {...callbacks} />);
    load();
    await screen.findByRole('heading', { name: 'Review 1 field values' });
    expect(screen.getByText('<script>SYNTHETIC</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/may be sensitive/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed form data' }));
    expect(callbacks.onApply).toHaveBeenCalledWith(report);
    expect(screen.getByRole('status')).toHaveTextContent('Form data applied');
  });

  it('cancels without applying and invalidates review after another edit', async () => {
    const callbacks = props();
    const view = render(<FormDataPanel {...callbacks} />);
    load();
    await screen.findByRole('button', { name: 'Cancel import' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(callbacks.onApply).not.toHaveBeenCalled();
    load();
    await screen.findByRole('button', { name: 'Apply reviewed form data' });
    view.rerender(<FormDataPanel {...callbacks} values={[{ ...values[0], value: 'Edited' }]} />);
    expect(
      screen.queryByRole('button', { name: 'Apply reviewed form data' }),
    ).not.toBeInTheDocument();
  });

  it('rejects malformed bytes without showing filename, contents, or parser exception', async () => {
    const callbacks = props();
    render(<FormDataPanel {...callbacks} />);
    load(new TextEncoder().encode('{"CONTENT_CANARY'));
    const error = await screen.findByRole('alert');
    expect(error.textContent).not.toMatch(/CONTENT_CANARY|private-filename|SyntaxError/);
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });

  it('checks size before reading and never applies an oversized file', async () => {
    render(<FormDataPanel {...props()} />);
    const read = vi.fn();
    const file = new File(['small'], 'huge.json');
    Object.defineProperties(file, { size: { value: 1_048_577 }, arrayBuffer: { value: read } });
    fireEvent.change(screen.getByLabelText('Import form data JSON'), { target: { files: [file] } });
    await screen.findByRole('alert');
    expect(read).not.toHaveBeenCalled();
  });

  it('discards asynchronous completion after document replacement', async () => {
    let complete: ((value: ArrayBuffer) => void) | undefined;
    const file = new File(['data'], 'data.json');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          complete = resolve;
        }),
    });
    const callbacks = props();
    const view = render(<FormDataPanel key="source" {...callbacks} />);
    fireEvent.change(screen.getByLabelText('Import form data JSON'), { target: { files: [file] } });
    view.rerender(<FormDataPanel key="replacement" {...callbacks} sourceId="replacement" />);
    await act(() => Promise.resolve(complete?.(bytes.buffer)));
    expect(
      screen.queryByRole('button', { name: 'Apply reviewed form data' }),
    ).not.toBeInTheDocument();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });

  it('exports exact JSON through the host adapter and handles cancellation and failure safely', async () => {
    const callbacks = props();
    callbacks.onSave
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('PATH_TOKEN_CANARY'));
    render(<FormDataPanel {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export form data' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saving cancelled'));
    expect(JSON.parse(new TextDecoder().decode(callbacks.onSave.mock.calls[0]?.[0]))).toEqual({
      ...report,
      fields: [{ fieldName: 'name', type: 'text', value: 'Before' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export form data' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/PATH_TOKEN_CANARY/)).not.toBeInTheDocument();
  });
});
