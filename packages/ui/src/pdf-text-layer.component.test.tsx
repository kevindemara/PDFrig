import { act, fireEvent, render, screen } from '@testing-library/react';
import type { BrowserPdfDocument } from '@pdfmason/pdf-engine/browser';
import { describe, expect, it, vi } from 'vitest';
import { PdfTextLayer } from './pdf-text-layer.js';

describe('VIEW-008 source-text selection lifecycle', () => {
  it.each(['ready', 'empty', 'restricted', 'limited'] as const)(
    'announces %s and remains keyboard accessible',
    async (result) => {
      const renderSelectableText = vi.fn<BrowserPdfDocument['renderSelectableText']>((target) => {
        if (result === 'ready') {
          const span = target.ownerDocument.createElement('span');
          span.textContent = 'Synthetic source text';
          target.append(span);
        }
        return Promise.resolve(result);
      });
      const document = {
        renderSelectableText,
        getPageMetrics: vi.fn(() => Promise.resolve({ rotation: 0, width: 612, height: 792 })),
      } as unknown as BrowserPdfDocument;
      const view = render(
        <PdfTextLayer document={document} pageIndex={0} scale={1} rotation={0} enabled />,
      );
      await act(async () => {
        await Promise.resolve();
      });
      const layer = screen.getByRole('region', { name: 'Selectable PDF text' });
      expect(layer).toHaveAttribute('tabindex', '0');
      expect(view.container.querySelector('.pdf-text-status')?.textContent).toMatch(
        result === 'ready'
          ? /selectable/u
          : result === 'empty'
            ? /OCR/u
            : result === 'restricted'
              ? /restricts/u
              : /limit/u,
      );
      if (result === 'ready') {
        fireEvent.keyDown(layer, { ctrlKey: true, key: 'a' });
        expect(layer.ownerDocument.getSelection()?.toString()).toBe('Synthetic source text');
      }
      const signal = renderSelectableText.mock.calls[0]?.[4];
      view.unmount();
      expect(signal?.aborted).toBe(true);
      expect(layer.childElementCount).toBe(0);
    },
  );
  it('ignores late results after unmount without leaking parser details', async () => {
    let finish: ((value: 'ready') => void) | undefined;
    const document = {
      getPageMetrics: vi.fn(() => Promise.resolve({ rotation: 0, width: 612, height: 792 })),
      renderSelectableText: vi.fn(
        () =>
          new Promise<'ready'>((resolve) => {
            finish = resolve;
          }),
      ),
    } as unknown as BrowserPdfDocument;
    const view = render(
      <PdfTextLayer document={document} pageIndex={0} scale={1} rotation={0} enabled={false} />,
    );
    expect(screen.getByRole('region')).toHaveAttribute('tabindex', '-1');
    view.unmount();
    await act(async () => {
      finish?.('ready');
      await Promise.resolve();
    });
    expect(view.container.querySelector('.pdf-text-status')).toBeNull();
  });
  it('shows a content-free error on renderer failure', async () => {
    const document = {
      renderSelectableText: vi.fn(() => Promise.reject(new Error('private canary'))),
    } as unknown as BrowserPdfDocument;
    render(<PdfTextLayer document={document} pageIndex={0} scale={1} rotation={0} enabled />);
    expect(await screen.findByText('Selectable text is unavailable on this page.')).toBeVisible();
    expect(screen.queryByText(/private canary/u)).toBeNull();
  });
});
