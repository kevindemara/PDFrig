'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createPdfWorkerClient,
  openBrowserPdf,
  TEXT_PDF_LIMITS,
  type BrowserPdfDocument,
  type PdfWorkerClient,
  type TextPdfOptions,
} from '@pdfmason/pdf-engine/browser';

interface Props {
  readonly createWorker?: () => Worker;
}
const safeFailure = (error: unknown): string => {
  const messages: Readonly<Record<string, string>> = {
    UTILITY_TEXT_ENCODING_INVALID:
      'The file is not valid UTF-8. Save it as UTF-8 plain text, then try again.',
    UTILITY_TEXT_CHARACTER_UNSUPPORTED:
      'This build supports printable ASCII, tabs and line breaks only. No characters were replaced or omitted.',
    UTILITY_TEXT_SIZE_LIMIT: 'Choose a non-empty text file no larger than 1 MiB.',
    UTILITY_TEXT_PAGE_LIMIT: 'This layout exceeds 500 pages. Split the text into smaller files.',
  };
  return `${messages[error instanceof Error ? error.message : ''] ?? 'The PDF or preview could not be verified. Try a supported text file again.'} Your original is unchanged.`;
};

/** CONV-005: the preview and download share one disposable, session-only output. */
export const TextPdfWorkbench = ({ createWorker }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [pageSize, setPageSize] = useState<TextPdfOptions['pageSize']>('letter');
  const [candidate, setCandidate] = useState<{
    readonly bytes: Uint8Array;
    readonly pageCount: number;
  } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'building' | 'rendering' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('Choose a UTF-8 plain-text file to begin.');
  const generation = useRef(0);
  const inFlight = useRef(false);
  const clientRef = useRef<PdfWorkerClient | null>(null);
  const documentRef = useRef<BrowserPdfDocument | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const release = (): void => {
    generation.current += 1;
    inFlight.current = false;
    clientRef.current?.terminate();
    clientRef.current = null;
    const document = documentRef.current;
    documentRef.current = null;
    if (document !== null) void document.destroy().catch(() => undefined);
  };
  useEffect(() => release, []);
  const invalidate = (): void => {
    release();
    setCandidate(null);
    setReviewed(false);
    setPhase('idle');
    setMessage('Build a new preview before downloading.');
    if (canvasRef.current !== null) {
      canvasRef.current.width = 1;
      canvasRef.current.height = 1;
    }
  };
  const renderPage = async (
    document: BrowserPdfDocument,
    page: number,
    request: number,
  ): Promise<boolean> => {
    const metrics = await document.getPageMetrics(page - 1);
    if (
      ![metrics.width, metrics.height].every(
        (value) => Number.isFinite(value) && value > 0 && value < 1100,
      )
    )
      throw new Error('preview');
    const staging = window.document.createElement('canvas');
    try {
      await document.renderPage(
        staging,
        page - 1,
        Math.min(1.25, 960 / metrics.width, 1200 / metrics.height),
      );
      if (generation.current !== request || canvasRef.current === null) return false;
      const canvas = canvasRef.current;
      canvas.width = staging.width;
      canvas.height = staging.height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('preview');
      context.drawImage(staging, 0, 0);
      return true;
    } finally {
      staging.width = 1;
      staging.height = 1;
    }
  };
  const build = async (): Promise<void> => {
    if (file === null || createWorker === undefined || inFlight.current) return;
    invalidate();
    const request = generation.current;
    inFlight.current = true;
    setPhase('building');
    setMessage('Building and verifying the PDF on this device…');
    try {
      const client = createPdfWorkerClient(createWorker());
      clientRef.current = client;
      const source = new Uint8Array(await file.arrayBuffer());
      if (request !== generation.current) return;
      const bytes = await client.textToPdf(source, { pageSize });
      if (request !== generation.current) return;
      client.terminate();
      clientRef.current = null;
      setPhase('rendering');
      setMessage('Rendering the actual PDF for layout review…');
      const document = await openBrowserPdf(bytes, { strictParsing: true });
      if (request !== generation.current) {
        await document.destroy();
        return;
      }
      documentRef.current = document;
      if (!(await renderPage(document, 1, request))) return;
      setCandidate({ bytes, pageCount: document.pageCount });
      setPageNumber(1);
      setPhase('ready');
      setMessage(
        `Preview ready · ${document.pageCount} pages. Check wrapping and pagination before saving.`,
      );
    } catch (error: unknown) {
      if (request !== generation.current) return;
      release();
      setCandidate(null);
      setPhase('error');
      setMessage(safeFailure(error));
    } finally {
      if (request === generation.current) inFlight.current = false;
    }
  };
  const showPage = async (page: number): Promise<void> => {
    const document = documentRef.current;
    if (
      candidate === null ||
      document === null ||
      inFlight.current ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > candidate.pageCount
    )
      return;
    const request = ++generation.current;
    inFlight.current = true;
    setReviewed(false);
    setPhase('rendering');
    setMessage(`Rendering page ${page}…`);
    try {
      if (!(await renderPage(document, page, request))) return;
      setPageNumber(page);
      setPhase('ready');
      setMessage(`Preview page ${page} of ${candidate.pageCount}.`);
    } catch (error: unknown) {
      if (request !== generation.current) return;
      release();
      setCandidate(null);
      setPhase('error');
      setMessage(safeFailure(error));
    } finally {
      if (request === generation.current) inFlight.current = false;
    }
  };
  const download = (): void => {
    if (candidate === null || !reviewed || phase !== 'ready' || inFlight.current) return;
    const url = URL.createObjectURL(
      new Blob([candidate.bytes.slice().buffer], { type: 'application/pdf' }),
    );
    try {
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = 'pdfmason-text.pdf';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    setMessage('Reviewed copy downloaded. Your original is unchanged.');
  };
  const busy = phase === 'building' || phase === 'rendering';
  return (
    <div className="decoration-workbench">
      <label className="utility-dropzone">
        <input
          accept="text/plain,.txt"
          type="file"
          onChange={(event) => {
            invalidate();
            const chosen = event.currentTarget.files?.[0];
            if (chosen === undefined) {
              setFile(null);
              setMessage('Choose a UTF-8 plain-text file to begin.');
              return;
            }
            if (
              !/\.txt$/iu.test(chosen.name) ||
              (chosen.type !== '' && chosen.type !== 'text/plain') ||
              chosen.size < 1 ||
              chosen.size > TEXT_PDF_LIMITS.maximumBytes
            ) {
              setFile(null);
              setPhase('error');
              setMessage('Choose one non-empty .txt file up to 1 MiB. Your original is unchanged.');
              return;
            }
            setFile(chosen);
            setMessage('Text file ready. Build a preview to check layout.');
          }}
        />
        <span className="utility-dropzone__mark" aria-hidden="true">
          +
        </span>
        <strong>Choose a UTF-8 text file</strong>
        <span>One .txt file · up to 1 MiB · never uploaded</span>
      </label>
      <label className="field-label">
        Text PDF page size
        <select
          value={pageSize}
          onChange={(event) => {
            invalidate();
            setPageSize(event.currentTarget.value as TextPdfOptions['pageSize']);
          }}
        >
          <option value="letter">US Letter · portrait</option>
          <option value="a4">A4 · portrait</option>
        </select>
      </label>
      <p className="fidelity-note">
        Printable ASCII only, with tabs and line breaks. Courier 12 pt · 36 pt margins · up to 500
        pages. Tabs expand at four-column source-line stops. Long lines wrap without trimming; blank
        lines remain. Markup stays literal. Other characters stop conversion, never substitute.
      </p>
      <p className="fidelity-note">
        Runs on this device. The new PDF has selectable text but is untagged. This is not an
        accessible PDF certification or a byte-identical text archive. Review wrapping and
        pagination; no source is overwritten.
      </p>
      <div className="decoration-preview-actions">
        <button
          className="button button--secondary"
          disabled={file === null || busy || createWorker === undefined}
          onClick={() => void build()}
          type="button"
        >
          Build text PDF preview
        </button>
        {busy && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              invalidate();
              setMessage('Preview cancelled. Your original is unchanged.');
            }}
          >
            Cancel text preview
          </button>
        )}
      </div>
      <section aria-label="Text PDF preview" className="decoration-preview">
        <header>
          <div>
            <p className="eyebrow">Actual output · on this device</p>
            <h3>Check the text before you save.</h3>
          </div>
          <span className="decoration-preview__badge">
            {candidate === null ? 'Not built' : `${candidate.pageCount} pages`}
          </span>
        </header>
        {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Keyboard access to the scrollable PDF preview. */}
        <div
          className="decoration-preview__canvas"
          tabIndex={0}
          role="region"
          aria-label="Scrollable text PDF preview"
          hidden={candidate === null || phase !== 'ready'}
        >
          <canvas
            ref={canvasRef}
            style={{ width: `${previewZoom * 100}%` }}
            role="img"
            aria-label={`Rendered text PDF page ${pageNumber}`}
          />
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
        {candidate === null ? (
          <p className="decoration-preview__empty">
            Build a preview to see the actual wrapping and page breaks.
          </p>
        ) : (
          <>
            <label className="field-label">
              Text preview zoom
              <select
                value={previewZoom}
                disabled={busy}
                onChange={(event) => setPreviewZoom(Number(event.currentTarget.value))}
              >
                <option value={1}>Fit width</option>
                <option value={2}>200% · scroll to inspect</option>
                <option value={4}>400% · scroll to inspect</option>
              </select>
            </label>
            <nav
              aria-label="Text preview page navigation"
              className="decoration-preview__navigation"
            >
              <button
                type="button"
                disabled={busy || pageNumber === 1}
                onClick={() => void showPage(pageNumber - 1)}
              >
                Previous text preview page
              </button>
              <label>
                Text preview page
                <select
                  value={pageNumber}
                  disabled={busy}
                  onChange={(event) => void showPage(Number(event.currentTarget.value))}
                >
                  {Array.from({ length: candidate.pageCount }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || pageNumber === candidate.pageCount}
                onClick={() => void showPage(pageNumber + 1)}
              >
                Next text preview page
              </button>
            </nav>
            <label className="confirmation-row">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(event) => setReviewed(event.currentTarget.checked)}
              />
              I reviewed the text layout, wrapping and pagination.
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={!reviewed || phase !== 'ready'}
              onClick={download}
            >
              Download reviewed text PDF
            </button>
          </>
        )}
      </section>
      <p className="utility-status" role={phase === 'error' ? 'alert' : 'status'}>
        {message}
      </p>
    </div>
  );
};
