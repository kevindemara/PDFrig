import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  addAnnotationCommand,
  createInitialEditorDocument,
  createInitialPageGraph,
  type EditorCommand,
  type EditorDocumentState,
  type VisualSignatureAnnotation,
} from '@pdfmason/editor-core';
import {
  SignatureRepeatDialog,
  type SignatureRepeatPreviewDocument,
} from './signature-repeat-dialog.js';

const mark: VisualSignatureAnnotation = {
  id: 'mark',
  pageId: 'page-0',
  kind: 'visual-signature',
  label: 'signature',
  appearance: { kind: 'typed', text: 'Synthetic Reviewer', color: '#17232d' },
  rect: { x: 0.5, y: 0.76, width: 0.36, height: 0.09 },
};
const initial = createInitialEditorDocument(
  createInitialPageGraph('source', 3, (index) => `page-${index}`),
);
const before = addAnnotationCommand(initial, mark).apply(initial);
const preview = (): SignatureRepeatPreviewDocument => ({
  pageCount: 3,
  destroy: vi.fn(() => Promise.resolve()),
  getPageMetrics: vi.fn(() => Promise.resolve({ height: 792, width: 612, rotation: 0 as const })),
  // The task handle is unobserved by the dialog; double only completed rendering.
  renderPage: vi.fn(() =>
    Promise.resolve({} as Awaited<ReturnType<SignatureRepeatPreviewDocument['renderPage']>>),
  ),
});
const setup = (document = preview()) => {
  const callbacks = {
    onApply: vi.fn<(command: EditorCommand<EditorDocumentState>) => void>(),
    onClose: vi.fn(),
    onPrepare: vi.fn<
      (command: EditorCommand<EditorDocumentState>) => Promise<SignatureRepeatPreviewDocument>
    >(() => Promise.resolve(document)),
  };
  const view = render(
    <SignatureRepeatDialog before={before} signatureId={mark.id} {...callbacks} />,
  );
  const change = (range: string) =>
    fireEvent.change(screen.getByLabelText(/Destination pages/u), { target: { value: range } });
  const start = async (range = '2-3') => {
    change(range);
    fireEvent.click(screen.getByRole('button', { name: 'Build placement preview' }));
    await waitFor(() =>
      expect(screen.getByLabelText('I reviewed the placement on page 2')).toBeEnabled(),
    );
  };
  return { ...view, callbacks, document, change, start };
};

describe('SIGN-003 explicit per-page preview', () => {
  it('renders actual proposed output and requires every acknowledgement before one apply', async () => {
    const { callbacks, document, start } = setup();
    expect(screen.getByText(/Nothing is saved for future documents or uploaded/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed signature copies' })).toBeDisabled();
    await start();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    const command = callbacks.onPrepare.mock.calls[0]?.[0];
    expect(document.renderPage).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I reviewed the placement on page 2'));
    expect(screen.getByRole('button', { name: 'Apply reviewed signature copies' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next destination' }));
    await waitFor(() =>
      expect(screen.getByLabelText('I reviewed the placement on page 3')).toBeEnabled(),
    );
    fireEvent.click(screen.getByLabelText('I reviewed the placement on page 3'));
    expect(screen.getByRole('button', { name: 'Apply reviewed signature copies' })).toBeEnabled();
    fireEvent.click(screen.getByLabelText('I reviewed the placement on page 3'));
    expect(screen.getByRole('button', { name: 'Apply reviewed signature copies' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I reviewed the placement on page 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed signature copies' }));
    expect(callbacks.onApply).toHaveBeenCalledTimes(1);
    expect(callbacks.onApply.mock.calls[0]?.[0]).toBe(command);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(before.annotations).toEqual([mark]);
  });
  it('invalidates all reviews and releases the proposed PDF after range edits', async () => {
    const { callbacks, document, change, start } = setup();
    await start();
    fireEvent.click(screen.getByLabelText('I reviewed the placement on page 2'));
    change('3');
    expect(document.destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('I reviewed the placement on page 2')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply reviewed signature copies' })).toBeDisabled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });
  it('refuses duplicate, occupied, missing and excessive destinations without building', async () => {
    const { callbacks, change } = setup();
    for (const range of ['1', '2,2', '4', '0', '1-500', 'NaN']) {
      change(range);
      fireEvent.click(screen.getByRole('button', { name: 'Build placement preview' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('No copies were added');
      expect(callbacks.onPrepare).not.toHaveBeenCalled();
    }
  });
  it('sanitizes preparation and rendering failures and never enables application', async () => {
    const { callbacks, change } = setup();
    callbacks.onPrepare.mockRejectedValueOnce(new Error('PRIVATE_FILENAME_AND_SIGNATURE_CANARY'));
    change('2');
    fireEvent.click(screen.getByRole('button', { name: 'Build placement preview' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('CANARY');
    expect(screen.getByRole('button', { name: 'Apply reviewed signature copies' })).toBeDisabled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });
  it('discards late preparation after cancellation/unmount without retaining output', async () => {
    const { callbacks, document, change, unmount } = setup();
    let resolve: ((document: SignatureRepeatPreviewDocument) => void) | undefined;
    callbacks.onPrepare.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    change('2');
    fireEvent.click(screen.getByRole('button', { name: 'Build placement preview' }));
    expect(screen.getByRole('status')).toHaveTextContent('Building');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel signature copies' }));
    unmount();
    await act(async () => {
      resolve?.(document);
      await Promise.resolve();
    });
    expect(document.destroy).toHaveBeenCalledTimes(1);
    expect(document.renderPage).not.toHaveBeenCalled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });
  it('refuses mismatched preview counts and releases the output', async () => {
    const document = { ...preview(), pageCount: 2 };
    const { callbacks, change } = setup(document);
    change('2');
    fireEvent.click(screen.getByRole('button', { name: 'Build placement preview' }));
    await screen.findByRole('alert');
    expect(document.destroy).toHaveBeenCalledTimes(1);
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });
  it('keeps controls locked on rendering failure without exposing raw errors', async () => {
    const document = preview();
    vi.mocked(document.renderPage).mockRejectedValueOnce(new Error('PRIVATE_RENDER_CANARY'));
    const { callbacks, change } = setup(document);
    change('2');
    fireEvent.click(screen.getByRole('button', { name: 'Build placement preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be rendered');
    expect(screen.getByRole('alert')).not.toHaveTextContent('CANARY');
    expect(screen.getByLabelText('I reviewed the placement on page 2')).toBeDisabled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });
  it('supports Escape and traps keyboard focus in review', () => {
    const { callbacks } = setup();
    const close = screen.getByRole('button', { name: 'Cancel signature copies' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Keep current signatures' })).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});
