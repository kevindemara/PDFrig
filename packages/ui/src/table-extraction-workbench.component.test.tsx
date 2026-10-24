import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as engine from '@pdfmason/pdf-engine/browser';
import { TableExtractionWorkbench } from './table-extraction-workbench.js';
import type { PlatformAdapter } from '@pdfmason/editor-core';

afterEach(() => vi.restoreAllMocks());
const words: engine.TableWord[] = [
  { text: 'Code', x: 0.1, y: 0.2, width: 0.1, height: 0.02 },
  { text: 'Value', x: 0.6, y: 0.2, width: 0.1, height: 0.02 },
  { text: '001', x: 0.1, y: 0.3, width: 0.1, height: 0.02 },
  { text: '12.5', x: 0.6, y: 0.3, width: 0.1, height: 0.02 },
];
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (v: T) => resolve(v),
  };
};
function setup(
  surface: 'Web' | 'Windows' = 'Web',
  ocrEnabled = true,
  saveFile?: PlatformAdapter['saveFile'],
) {
  const document = {
    pageCount: 3,
    assertCanExtract: vi.fn(() => Promise.resolve(undefined)),
    destroy: vi.fn(() => Promise.resolve(undefined)),
    getTableWords: vi.fn(() => Promise.resolve(words)),
    getPageMetrics: vi.fn(() => Promise.resolve({ width: 612, height: 792, rotation: 0 })),
    renderPage: vi.fn(() => Promise.resolve({})),
  };
  const open = vi
    .spyOn(engine, 'openBrowserPdf')
    .mockResolvedValue(document as unknown as engine.BrowserPdfDocument);
  const ocr = vi
    .spyOn(engine, 'recognizeLocalPage')
    .mockResolvedValue(words.map((w) => ({ ...w, baseline: w.y + w.height, confidence: 50 })));
  const exporting = vi
    .spyOn(engine, 'exportTableWorkbook')
    .mockResolvedValue(new Uint8Array([80, 75, 3, 4, 0]));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const view = render(
      <TableExtractionWorkbench
        surface={surface}
        ocrEnabled={ocrEnabled}
        {...(saveFile ? { saveFile } : {})}
      />,
    ),
    ui = within(view.container);
  const choose = () => {
    const file = new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode('%PDF-synthetic').buffer),
    });
    fireEvent.change(ui.getByLabelText('Open table PDF'), { target: { files: [file] } });
  };
  const load = async () => {
    choose();
    await waitFor(() =>
      expect(ui.getByRole('button', { name: 'Extract selectable text' })).toBeEnabled(),
    );
  };
  const extract = async () => {
    fireEvent.click(ui.getByRole('button', { name: 'Extract selectable text' }));
    await waitFor(() =>
      expect(ui.getByRole('textbox', { name: 'Row 2 column 1' })).toHaveValue('001'),
    );
  };
  return { ...view, ui, document, open, ocr, exporting, choose, load, extract };
}
describe('CONV-007 correction preview and ownership', () => {
  it('paginates large corrections without dropping rows from the native export', async () => {
    const save = vi.fn<PlatformAdapter['saveFile']>(() => Promise.resolve('saved'));
    const { ui, document, load, exporting } = setup('Windows', true, save);
    await load();
    document.getTableWords.mockResolvedValueOnce(
      Array.from({ length: 52 }, (_, r) => [
        { text: `Code${r}`, x: 0.1, y: 0.2 + r * 0.01, width: 0.1, height: 0.003 },
        { text: String(r), x: 0.6, y: 0.2 + r * 0.01, width: 0.1, height: 0.003 },
      ]).flat(),
    );
    fireEvent.click(ui.getByRole('button', { name: 'Extract selectable text' }));
    await waitFor(() => expect(ui.getByRole('textbox', { name: 'Row 50 column 1' })).toBeVisible());
    expect(ui.queryByRole('textbox', { name: 'Row 51 column 1' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Next grid rows' }));
    fireEvent.change(ui.getByRole('textbox', { name: 'Row 52 column 1' }), {
      target: { value: 'last corrected' },
    });
    fireEvent.click(ui.getByLabelText('I checked the rows, columns and values against the PDF.'));
    fireEvent.click(ui.getByRole('button', { name: 'Save reviewed XLSX' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(exporting.mock.calls[0]?.[0]).toHaveLength(52);
    expect(exporting.mock.calls[0]?.[0][51]?.[0]).toBe('last corrected');
  });
  it('does not save a late workbook after export cancellation', async () => {
    const save = vi.fn<PlatformAdapter['saveFile']>(() => Promise.resolve('saved'));
    const { ui, load, extract, exporting } = setup('Windows', true, save);
    await load();
    await extract();
    const pending = deferred<Uint8Array>();
    exporting.mockReturnValueOnce(pending.promise);
    fireEvent.click(ui.getByLabelText('I checked the rows, columns and values against the PDF.'));
    fireEvent.click(ui.getByRole('button', { name: 'Save reviewed ODS' }));
    fireEvent.click(ui.getByRole('button', { name: 'Cancel table operation' }));
    await act(async () => {
      pending.resolve(new Uint8Array([80, 75, 3, 4, 0]));
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps corrections visible while boundary edits await an explicit rebuild', async () => {
    const { ui, load, extract } = setup();
    await load();
    await extract();
    fireEvent.change(ui.getByRole('textbox', { name: 'Row 2 column 1' }), {
      target: { value: 'keep correction' },
    });
    fireEvent.change(ui.getByLabelText('Column breaks (% across selection)'), {
      target: { value: '40' },
    });
    expect(ui.getByRole('textbox', { name: 'Row 2 column 1' })).toHaveValue('keep correction');
    expect(
      ui.getByLabelText('I checked the rows, columns and values against the PDF.'),
    ).toBeDisabled();
    fireEvent.click(ui.getByRole('button', { name: 'Rebuild grid from boundaries' }));
    expect(ui.getByRole('textbox', { name: 'Row 2 column 1' })).toHaveValue('001');
  });
  it('requires reviewed corrections, resets review after edits and rejects invalid numeric columns', async () => {
    const { ui, load, extract } = setup();
    await load();
    await extract();
    const review = ui.getByLabelText('I checked the rows, columns and values against the PDF.');
    expect(ui.getByRole('button', { name: 'Save reviewed XLSX' })).toBeDisabled();
    fireEvent.click(review);
    expect(ui.getByRole('button', { name: 'Save reviewed XLSX' })).toBeEnabled();
    fireEvent.change(ui.getByRole('textbox', { name: 'Row 2 column 2' }), {
      target: { value: 'bad' },
    });
    expect(review).not.toBeChecked();
    fireEvent.change(ui.getByLabelText('Column 2 type'), { target: { value: 'number-dot' } });
    expect(review).toBeDisabled();
    expect(ui.getByRole('alert')).toHaveTextContent('numeric column');
    fireEvent.change(ui.getByRole('textbox', { name: 'Row 2 column 2' }), {
      target: { value: '17.5' },
    });
    expect(review).toBeEnabled();
    fireEvent.click(ui.getByRole('button', { name: 'Add row' }));
    expect(ui.getByRole('textbox', { name: 'Row 3 column 1' })).toHaveValue('');
    fireEvent.click(ui.getByRole('button', { name: 'Add column' }));
    expect(ui.getByLabelText('Column 3 type')).toBeVisible();
    fireEvent.click(ui.getByRole('button', { name: 'Delete row 3' }));
    fireEvent.click(ui.getByRole('button', { name: 'Delete column 3' }));
    expect(ui.queryByLabelText('Column 3 type')).toBeNull();
  });
  it.each(['xlsx', 'ods'] as const)(
    'uses native save for Windows %s without browser fallback',
    async (format) => {
      const save = vi.fn<PlatformAdapter['saveFile']>(() => Promise.resolve('saved'));
      const { ui, load, extract, exporting } = setup('Windows', true, save);
      await load();
      await extract();
      fireEvent.click(ui.getByLabelText('I checked the rows, columns and values against the PDF.'));
      fireEvent.click(ui.getByRole('button', { name: `Save reviewed ${format.toUpperCase()}` }));
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(save.mock.calls[0]?.[0]).toMatchObject({
        filenameSuggestion: `PDFrig-table.${format}`,
        mimeType: engine.TABLE_MIME[format],
      });
      expect(exporting.mock.calls[0]?.[0]).toEqual([
        ['Code', 'Value'],
        ['001', 12.5],
      ]);
      await waitFor(() => expect(ui.getByRole('status')).toHaveTextContent('saved'));
    },
  );
  it('retains the reviewed grid when native save is cancelled', async () => {
    const { ui, load, extract } = setup(
      'Windows',
      true,
      vi.fn<PlatformAdapter['saveFile']>(() => Promise.resolve('cancelled')),
    );
    await load();
    await extract();
    fireEvent.click(ui.getByLabelText('I checked the rows, columns and values against the PDF.'));
    fireEvent.click(ui.getByRole('button', { name: 'Save reviewed ODS' }));
    await waitFor(() => expect(ui.getByRole('status')).toHaveTextContent('Save cancelled'));
    expect(ui.getByRole('textbox', { name: 'Row 2 column 1' })).toHaveValue('001');
  });
  it('gates OCR and marks uncertain OCR cells without modifying the source', async () => {
    const first = setup('Web', false);
    await first.load();
    expect(first.ui.getByRole('button', { name: 'OCR scanned table' })).toBeDisabled();
    expect(first.ocr).not.toHaveBeenCalled();
    first.unmount();
    vi.restoreAllMocks();
    const { ui, load, ocr, container, document } = setup();
    await load();
    fireEvent.change(ui.getByLabelText('Table OCR language'), { target: { value: 'fra' } });
    fireEvent.click(ui.getByRole('button', { name: 'OCR scanned table' }));
    await waitFor(() =>
      expect(ui.getByRole('textbox', { name: 'Row 2 column 1' })).toHaveValue('001'),
    );
    expect(ocr.mock.calls[0]?.[2]).toBe('fra');
    expect(container.querySelectorAll('.table-cell-uncertain').length).toBe(4);
    expect(document.assertCanExtract).toHaveBeenCalledTimes(2);
    fireEvent.click(ui.getByRole('button', { name: 'Delete column 1' }));
    expect(container.querySelectorAll('.table-cell-uncertain').length).toBe(2);
    fireEvent.click(ui.getByRole('button', { name: 'Delete row 1' }));
    expect(container.querySelectorAll('.table-cell-uncertain').length).toBe(1);
    expect(ui.getByRole('textbox', { name: 'Row 1 column 1' }).closest('td')).toHaveClass(
      'table-cell-uncertain',
    );
  });
  it.each(['cancel', 'page', 'file', 'unmount'] as const)(
    'does not publish late text after %s',
    async (action) => {
      const { ui, document, load, choose, unmount } = setup();
      await load();
      const pending = deferred<readonly engine.TableWord[]>();
      document.getTableWords.mockReturnValueOnce(pending.promise as Promise<engine.TableWord[]>);
      fireEvent.click(ui.getByRole('button', { name: 'Extract selectable text' }));
      await waitFor(() => expect(document.getTableWords).toHaveBeenCalled());
      if (action === 'cancel')
        fireEvent.click(ui.getByRole('button', { name: 'Cancel table operation' }));
      if (action === 'page') {
        fireEvent.click(ui.getByRole('button', { name: 'Cancel table operation' }));
        fireEvent.change(ui.getByLabelText('Table page'), { target: { value: '2' } });
      }
      if (action === 'file') choose();
      if (action === 'unmount') unmount();
      await act(async () => {
        pending.resolve(words);
        await Promise.resolve();
      });
      expect(ui.queryByRole('textbox', { name: 'Row 2 column 1' })).toBeNull();
    },
  );
  it('rejects copying restrictions before rendering or OCR', async () => {
    const { ui, document, choose, ocr } = setup();
    document.assertCanExtract.mockRejectedValueOnce(new Error('TABLE_COPY_RESTRICTED'));
    choose();
    await waitFor(() => expect(ui.getByRole('status')).toHaveTextContent('restricts copying'));
    expect(document.renderPage).not.toHaveBeenCalled();
    expect(ocr).not.toHaveBeenCalled();
  });
});
