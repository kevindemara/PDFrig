'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { NormalizedRect, PlatformAdapter } from '@pdfmason/editor-core';
import {
  extractTable,
  exportTableWorkbook,
  openBrowserPdf,
  parseTableBreaks,
  recognizeLocalPage,
  tableValues,
  TABLE_LIMITS,
  TABLE_MIME,
  type BrowserPdfDocument,
  type TableColumnType,
  type TableWord,
} from '@pdfmason/pdf-engine/browser';

interface Props {
  readonly surface: 'Web' | 'Windows';
  readonly ocrEnabled: boolean;
  readonly saveFile?: PlatformAdapter['saveFile'];
}
const initialRegion: NormalizedRect = { x: 0.05, y: 0.15, width: 0.9, height: 0.7 };
const columnTypes: readonly [TableColumnType, string][] = [
  ['auto', 'Auto (plain numbers)'],
  ['text', 'Text / identifier'],
  ['number-dot', 'Number (1,234.56)'],
  ['number-comma', 'Number (1.234,56)'],
  ['percent-dot', 'Percent (12.5%)'],
  ['percent-comma', 'Percent (12,5%)'],
];
const safeError = (error: unknown): string => {
  const messages: Readonly<Record<string, string>> = {
    TABLE_COPY_RESTRICTED: 'This PDF restricts copying. Table extraction and OCR are unavailable.',
    TABLE_NO_TEXT:
      'No text was found in this area. Adjust the selection, or use OCR for an image-only page.',
    TABLE_TEXT_TIMEOUT: 'Reading this page reached its time limit. Try a simpler PDF page.',
    NATIVE_OVERWRITE_BLOCKED: 'Choose a new filename. Existing files are never replaced.',
    NATIVE_EXTENSION_REQUIRED:
      'Keep the selected .xlsx or .ods extension and choose a new filename.',
    NATIVE_TRANSFER_CANCELLED: 'Cancelled. No file was saved.',
    TABLE_ROTATION_UNSUPPORTED:
      'Rotated pages or non-standard page units are not supported by table extraction yet.',
    TABLE_TEXT_UNSUPPORTED:
      'This page has rotated, vertical or oversized text runs that this first version cannot extract reliably.',
    TABLE_GUIDES_INVALID: 'Use increasing percentages between 0 and 100, separated by commas.',
    TABLE_NUMBER_INVALID:
      'A numeric column has an invalid or over-precision value. Correct it or change the column to Text.',
    TABLE_GRID_LIMIT: 'Use no more than 500 rows, 40 columns and 20,000 cells.',
    TABLE_REGION_INVALID: 'Choose a non-empty area within the page.',
    TABLE_WORD_LIMIT: 'This page has too many text fragments. Try a simpler page.',
    OCR_PAGE_ALREADY_SEARCHABLE:
      'This page already has text. Use Extract selectable text; mixed scanned/text pages are not supported by OCR tables yet.',
    OCR_ROTATION_UNSUPPORTED: 'OCR tables currently require an unrotated page.',
    OCR_TIMEOUT: 'OCR reached its time limit. Try a smaller supported page.',
    OCR_NO_TEXT_FOUND: 'OCR found no words. Try a clearer scan.',
    TABLE_CANCELLED: 'Cancelled. No file was saved.',
    OCR_CANCELLED: 'Cancelled. No file was saved.',
  };
  return (
    messages[error instanceof Error ? error.message : ''] ??
    'Local processing could not finish. Try a smaller supported PDF or correct the table settings. No source file was changed.'
  );
};

/** CONV-007: a session-only, reviewed grid. OCR never composes or modifies a PDF. */
export const TableExtractionWorkbench = ({ surface, ocrEnabled, saveFile }: Props) => {
  const [file, setFile] = useState<File | null>(null),
    [pageNumber, setPageNumber] = useState(1),
    [pageCount, setPageCount] = useState(0);
  const [region, setRegion] = useState<NormalizedRect>(initialRegion),
    [columns, setColumns] = useState(''),
    [rowGuides, setRowGuides] = useState('');
  const [rows, setRows] = useState<string[][]>([]),
    [types, setTypes] = useState<TableColumnType[]>([]),
    [uncertain, setUncertain] = useState<readonly string[]>([]);
  const [header, setHeader] = useState(true),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [message, setMessage] = useState(
    'Choose a PDF, select the table area, then extract and correct its cells.',
  );
  const [source, setSource] = useState<'text' | 'ocr' | null>(null);
  const [language, setLanguage] = useState<'eng' | 'fra'>('eng');
  const [gridPage, setGridPage] = useState(0);
  const [guidesDirty, setGuidesDirty] = useState(false);
  const uncertainSet = useMemo(() => new Set(uncertain), [uncertain]);
  const documentRef = useRef<BrowserPdfDocument | null>(null),
    canvasRef = useRef<HTMLCanvasElement | null>(null),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const wordsRef = useRef<readonly TableWord[] | null>(null),
    inFlight = useRef(false),
    drag = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
  }, []);
  const destroy = useCallback(() => {
    stop();
    wordsRef.current = null;
    const document = documentRef.current;
    documentRef.current = null;
    if (document) void document.destroy().catch(() => undefined);
  }, [stop]);
  useEffect(() => destroy, [destroy]);
  const clearGrid = () => {
    setGuidesDirty(false);
    setGridPage(0);
    setRows([]);
    setTypes([]);
    setUncertain([]);
    setReviewed(false);
  };
  const invalidate = () => {
    stop();
    setBusy(false);
    clearGrid();
  };
  const load = async (chosen: File, page: number) => {
    destroy();
    clearGrid();
    wordsRef.current = null;
    setSource(null);
    setReady(false);
    setBusy(true);
    setPageCount(0);
    setMessage('Opening the PDF locally…');
    const request = generation.current,
      abort = new AbortController();
    controller.current = abort;
    inFlight.current = true;
    const current = () => request === generation.current && !abort.signal.aborted;
    try {
      if (
        chosen.size < 5 ||
        chosen.size > 50 * 1024 * 1024 ||
        !/\.pdf$/iu.test(chosen.name) ||
        (chosen.type !== '' && chosen.type !== 'application/pdf')
      )
        throw new Error('invalid');
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      if (!current()) return;
      const document = await openBrowserPdf(bytes, { strictParsing: true });
      if (!current()) {
        await document.destroy();
        return;
      }
      documentRef.current = document;
      await document.assertCanExtract(abort.signal);
      if (!current()) return;
      if (!Number.isInteger(page) || page < 1 || page > document.pageCount)
        throw new Error('invalid');
      const metrics = await document.getPageMetrics(page - 1);
      if (!current()) return;
      if (metrics.rotation % 360 !== 0) throw new Error('TABLE_ROTATION_UNSUPPORTED');
      const staging = window.document.createElement('canvas');
      try {
        await document.renderPage(
          staging,
          page - 1,
          Math.min(1.25, 800 / metrics.width, 1000 / metrics.height),
          0,
          1,
          'opaque',
          abort.signal,
        );
        if (!current() || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = staging.width;
        canvas.height = staging.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('preview');
        context.drawImage(staging, 0, 0);
      } finally {
        staging.width = staging.height = 0;
      }
      setPageCount(document.pageCount);
      setPageNumber(page);
      setReady(true);
      setMessage('Drag over the table on the page. Suggested rows and columns must be reviewed.');
    } catch (error) {
      if (current()) {
        destroy();
        setMessage(safeError(error));
        setBusy(false);
      }
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const detect = async (ocr: boolean) => {
    const document = documentRef.current;
    if (!document || !ready || inFlight.current || (ocr && !ocrEnabled)) return;
    invalidate();
    setBusy(true);
    inFlight.current = true;
    const request = generation.current,
      abort = new AbortController();
    controller.current = abort;
    const current = () => request === generation.current && !abort.signal.aborted;
    setMessage(
      ocr
        ? 'Recognizing the page locally. Scanned artwork stays unchanged…'
        : 'Reading the selected table locally…',
    );
    try {
      await document.assertCanExtract(abort.signal);
      const words = ocr
        ? await recognizeLocalPage(document, pageNumber - 1, language, abort.signal, (p) => {
            if (current())
              setMessage(`Local OCR ${p}%. Check every recognized value before export.`);
          })
        : await document.getTableWords(pageNumber - 1, abort.signal);
      if (!current()) return;
      const result = extractTable(
        words,
        region,
        columns.trim() ? parseTableBreaks(columns) : undefined,
        rowGuides.trim() ? parseTableBreaks(rowGuides) : undefined,
      );
      wordsRef.current = words;
      setSource(ocr ? 'ocr' : 'text');
      setRows(result.rows.map((r) => [...r]));
      setTypes(Array.from({ length: result.columns.length + 1 }, () => 'auto'));
      setUncertain(result.uncertainCells);
      setColumns(result.columns.map((n) => (n * 100).toFixed(2)).join(', '));
      setRowGuides(result.rowBreaks.map((n) => (n * 100).toFixed(2)).join(', '));
      setMessage(
        `${result.rows.length} rows, ${result.columns.length + 1} columns suggested. ${ocr ? 'OCR can misread numbers. ' : ''}Correct cells and column types, then review before saving.`,
      );
    } catch (error) {
      if (current()) {
        wordsRef.current = null;
        setSource(null);
        setMessage(safeError(error));
      }
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const rebuild = () => {
    if (!wordsRef.current) return;
    clearGrid();
    try {
      const result = extractTable(
        wordsRef.current,
        region,
        parseTableBreaks(columns),
        parseTableBreaks(rowGuides),
      );
      setRows(result.rows.map((r) => [...r]));
      setTypes(Array.from({ length: result.columns.length + 1 }, () => 'auto'));
      setUncertain(result.uncertainCells);
      setMessage(
        'Grid rebuilt from the source. Previous cell corrections were replaced; review again.',
      );
    } catch (error) {
      setMessage(safeError(error));
    }
  };
  const exportFile = async (format: 'xlsx' | 'ods') => {
    if (!reviewed || guidesDirty || !rows.length || inFlight.current) return;
    stop();
    setBusy(true);
    inFlight.current = true;
    const request = generation.current,
      abort = new AbortController();
    controller.current = abort;
    const current = () => request === generation.current && !abort.signal.aborted;
    try {
      const bytes = await exportTableWorkbook(
        tableValues(rows, types, header),
        format,
        header,
        abort.signal,
      );
      if (!current()) return;
      let result: 'saved' | 'cancelled' = 'saved';
      if (surface === 'Windows') {
        if (!saveFile) throw new Error('native');
        result = await saveFile({
          bytes,
          filenameSuggestion: `PDFrig-table.${format}`,
          mimeType: TABLE_MIME[format],
          signal: abort.signal,
        });
      } else {
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer], { type: TABLE_MIME[format] }),
        );
        try {
          const anchor = window.document.createElement('a');
          anchor.href = url;
          anchor.download = `PDFrig-table.${format}`;
          anchor.click();
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (current())
        setMessage(
          result === 'saved'
            ? `Reviewed ${format.toUpperCase()} saved. Your PDF is unchanged.`
            : 'Save cancelled. Your reviewed grid is still here.',
        );
    } catch (error) {
      if (current()) setMessage(safeError(error));
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  };
  const selection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start?.pointer !== event.pointerId) return;
    const end = point(event);
    setRegion({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
  };
  let numberError = false;
  try {
    if (rows.length) tableValues(rows, types, header);
  } catch {
    numberError = true;
  }
  return (
    <section className="table-workbench" aria-label="PDF table extraction">
      <p className="fidelity-note">
        Extract values, not screenshots. One page and one table at a time. Original formulas,
        merged-cell structure and page layout are not recovered. Everything stays in this session;
        export before leaving.
      </p>
      <p className="property-help">
        Spreadsheet output uses SheetJS Community Edition (Apache-2.0).{' '}
        <a href="./third-party/SheetJS-0.20.3-Apache-2.0.txt" target="_blank" rel="noreferrer">
          License and attribution
        </a>
        .
      </p>
      <div className="table-file-controls">
        <label className="field-stack">
          Open table PDF
          <input
            accept="application/pdf,.pdf"
            type="file"
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              setFile(chosen ?? null);
              setColumns('');
              setRowGuides('');
              setRegion(initialRegion);
              if (chosen) void load(chosen, 1);
              else {
                destroy();
                clearGrid();
                setSource(null);
                setReady(false);
                setPageCount(0);
                setBusy(false);
              }
            }}
          />
        </label>
        <label className="field-stack">
          Table page
          <input
            type="number"
            min="1"
            max={pageCount || 500}
            value={pageNumber}
            disabled={busy || !file}
            onChange={(event) => {
              invalidate();
              wordsRef.current = null;
              setSource(null);
              setReady(false);
              setPageNumber(Number(event.currentTarget.value));
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || !file}
          onClick={() => {
            setColumns('');
            setRowGuides('');
            if (file) void load(file, pageNumber);
          }}
        >
          Show page
        </button>
        <span>{pageCount ? `${pageCount} pages` : 'PDF up to 50 MB'}</span>
      </div>
      <div className="table-review-layout">
        <div className="table-source">
          <h3>Source table</h3>
          <p>Drag to select a table. Percentages below also work with a keyboard.</p>
          <div
            className="table-source-page"
            role="group"
            aria-label="Source page and table selection"
            onPointerDown={(event) => {
              if (!ready || busy || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { ...point(event), pointer: event.pointerId };
              invalidate();
              setColumns('');
              setRowGuides('');
            }}
            onPointerMove={selection}
            onPointerUp={(event) => {
              selection(event);
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
              setRegion(initialRegion);
            }}
          >
            <canvas ref={canvasRef} role="img" aria-label={`Table source PDF page ${pageNumber}`} />
            {ready && (
              <div
                className="table-selection"
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
              />
            )}
          </div>
          <div className="table-region-fields">
            {(
              [
                ['x', 'Left'],
                ['y', 'Top'],
                ['width', 'Width'],
                ['height', 'Height'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label} %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={Number((region[key] * 100).toFixed(2))}
                  disabled={busy}
                  onChange={(event) => {
                    invalidate();
                    setColumns('');
                    setRowGuides('');
                    setRegion({ ...region, [key]: Number(event.currentTarget.value) / 100 });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="table-actions">
            <button type="button" disabled={!ready || busy} onClick={() => void detect(false)}>
              Extract selectable text
            </button>
            <button
              type="button"
              disabled={!ready || busy || !ocrEnabled}
              onClick={() => void detect(true)}
            >
              OCR scanned table
            </button>
          </div>
          <label className="field-stack">
            Table OCR language
            <select
              value={language}
              disabled={busy || !ocrEnabled}
              onChange={(event) => {
                invalidate();
                wordsRef.current = null;
                setSource(null);
                setLanguage(event.currentTarget.value as 'eng' | 'fra');
              }}
            >
              <option value="eng">English</option>
              <option value="fra">French</option>
            </select>
          </label>
          <p className="property-help">
            OCR works on image-only, unrotated pages. It never changes scanned artwork.{' '}
            {ocrEnabled
              ? 'Native OCR security review remains incomplete; verify every value.'
              : 'OCR is disabled in this build.'}
          </p>
        </div>
        <div className="table-correction">
          <h3>Correct the extracted cells</h3>
          <p>
            Auto keeps leading zeros, dates and ambiguous values as text. Choose a numeric
            convention per column when needed.
          </p>
          <details>
            <summary>Adjust row and column boundaries</summary>
            <label className="field-stack">
              Column breaks (% across selection)
              <input
                value={columns}
                disabled={busy}
                placeholder="25, 50, 75"
                maxLength={5000}
                onChange={(event) => {
                  setColumns(event.currentTarget.value);
                  setGuidesDirty(true);
                  setReviewed(false);
                }}
              />
            </label>
            <label className="field-stack">
              Row breaks (% down selection)
              <textarea
                value={rowGuides}
                maxLength={5000}
                disabled={busy}
                rows={2}
                onChange={(event) => {
                  setRowGuides(event.currentTarget.value);
                  setGuidesDirty(true);
                  setReviewed(false);
                }}
              />
            </label>
            <p>
              Increasing percentages, separated by commas. Rebuilding replaces cell corrections.
            </p>
            <button type="button" disabled={busy || source === null} onClick={rebuild}>
              Rebuild grid from boundaries
            </button>
          </details>
          {guidesDirty && (
            <p role="status">
              Boundary settings changed. Rebuild the grid to apply them; this replaces cell
              corrections.
            </p>
          )}
          {rows.length > 0 ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={header}
                  disabled={busy}
                  onChange={(event) => {
                    setHeader(event.currentTarget.checked);
                    setReviewed(false);
                  }}
                />{' '}
                First row contains headers
              </label>
              <div className="table-grid-scroll">
                <table className="table-correction-grid">
                  <caption>
                    {source === 'ocr' ? 'OCR' : 'Selectable text'} correction preview. All cells are
                    editable. Marked cells need extra review.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      {types.map((type, c) => (
                        <th key={c} scope="col">
                          <label>
                            Column {c + 1}
                            <select
                              aria-label={`Column ${c + 1} type`}
                              value={type}
                              disabled={busy}
                              onChange={(event) => {
                                setTypes(
                                  types.map((t, i) =>
                                    i === c ? (event.currentTarget.value as TableColumnType) : t,
                                  ),
                                );
                                setReviewed(false);
                              }}
                            >
                              {columnTypes.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            aria-label={`Delete column ${c + 1}`}
                            disabled={busy || types.length === 1}
                            onClick={() => {
                              setTypes(types.filter((_, i) => i !== c));
                              setRows(rows.map((row) => row.filter((_, i) => i !== c)));
                              setUncertain(
                                uncertain.flatMap((cell) => {
                                  const [row = 0, column = 0] = cell.split(':').map(Number);
                                  return column === c
                                    ? []
                                    : [`${row}:${column > c ? column - 1 : column}`];
                                }),
                              );
                              setReviewed(false);
                            }}
                          >
                            Remove
                          </button>
                        </th>
                      ))}
                      <th scope="col">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .slice(
                        Math.min(gridPage, Math.floor((rows.length - 1) / 50)) * 50,
                        Math.min(gridPage, Math.floor((rows.length - 1) / 50)) * 50 + 50,
                      )
                      .map((row, index) => {
                        const r =
                          Math.min(gridPage, Math.floor((rows.length - 1) / 50)) * 50 + index;
                        return (
                          <tr key={r}>
                            <th scope="row">{r + 1}</th>
                            {row.map((value, c) => (
                              <td
                                key={c}
                                className={
                                  uncertainSet.has(`${r}:${c}`) ? 'table-cell-uncertain' : ''
                                }
                              >
                                <textarea
                                  aria-label={`Row ${r + 1} column ${c + 1}`}
                                  title={
                                    uncertainSet.has(`${r}:${c}`)
                                      ? 'Uncertain OCR or boundary overlap. Check against the source.'
                                      : undefined
                                  }
                                  value={value}
                                  rows={2}
                                  maxLength={TABLE_LIMITS.cellText}
                                  disabled={busy}
                                  onChange={(event) => {
                                    setRows(
                                      rows.map((line, i) =>
                                        i === r
                                          ? line.map((v, j) =>
                                              j === c ? event.currentTarget.value : v,
                                            )
                                          : line,
                                      ),
                                    );
                                    setReviewed(false);
                                  }}
                                />
                              </td>
                            ))}
                            <td>
                              <button
                                type="button"
                                aria-label={`Delete row ${r + 1}`}
                                disabled={busy || rows.length === 1}
                                onClick={() => {
                                  setRows(rows.filter((_, i) => i !== r));
                                  setUncertain(
                                    uncertain.flatMap((cell) => {
                                      const [row = 0, column = 0] = cell.split(':').map(Number);
                                      return row === r
                                        ? []
                                        : [`${row > r ? row - 1 : row}:${column}`];
                                    }),
                                  );
                                  setReviewed(false);
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div className="table-actions">
                <button
                  type="button"
                  disabled={busy || gridPage === 0}
                  onClick={() => setGridPage(Math.max(0, gridPage - 1))}
                >
                  Previous grid rows
                </button>
                <span>
                  Rows {Math.min(gridPage, Math.floor((rows.length - 1) / 50)) * 50 + 1}–
                  {Math.min(
                    rows.length,
                    Math.min(gridPage, Math.floor((rows.length - 1) / 50)) * 50 + 50,
                  )}{' '}
                  of {rows.length}
                </span>
                <button
                  type="button"
                  disabled={busy || (gridPage + 1) * 50 >= rows.length}
                  onClick={() => setGridPage(gridPage + 1)}
                >
                  Next grid rows
                </button>
              </div>
              <div className="table-actions">
                <button
                  type="button"
                  disabled={
                    busy ||
                    rows.length >= TABLE_LIMITS.rows ||
                    (rows.length + 1) * types.length > TABLE_LIMITS.cells
                  }
                  onClick={() => {
                    setRows([...rows, types.map(() => '')]);
                    setReviewed(false);
                  }}
                >
                  Add row
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    types.length >= TABLE_LIMITS.columns ||
                    rows.length * (types.length + 1) > TABLE_LIMITS.cells
                  }
                  onClick={() => {
                    setRows(rows.map((row) => [...row, '']));
                    setTypes([...types, 'auto']);
                    setReviewed(false);
                  }}
                >
                  Add column
                </button>
              </div>
              {numberError && (
                <p role="alert">
                  A numeric column contains an invalid or over-precision value. Correct it or choose
                  Text before export.
                </p>
              )}
              <label className="table-review-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || numberError || guidesDirty}
                  onChange={(event) => setReviewed(event.currentTarget.checked)}
                />{' '}
                I checked the rows, columns and values against the PDF.
              </label>
              <div className="table-actions">
                <button
                  type="button"
                  disabled={busy || !reviewed || numberError}
                  onClick={() => void exportFile('xlsx')}
                >
                  Save reviewed XLSX
                </button>
                <button
                  type="button"
                  disabled={busy || !reviewed || numberError}
                  onClick={() => void exportFile('ods')}
                >
                  Save reviewed ODS
                </button>
              </div>
            </>
          ) : (
            <p className="table-empty">
              Select the table on the left, then extract its text. Your correction grid will appear
              here.
            </p>
          )}
        </div>
      </div>
      <div className="utility-status" role="status">
        {message}
      </div>
      {busy && (
        <button
          type="button"
          onClick={() => {
            stop();
            setBusy(false);
            setReviewed(false);
            setMessage('Cancelled. No file was saved.');
          }}
        >
          Cancel table operation
        </button>
      )}
    </section>
  );
};
