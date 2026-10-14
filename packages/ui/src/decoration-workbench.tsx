'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createPdfWorkerClient,
  isPdfDecorationOptions,
  openBrowserPdf,
  resolveDecorationPages,
  type BrowserPdfDocument,
  type DecorationAlignment,
  type DecorationPageSelection,
  type DecorationPlacementReview,
  type PdfDecorationOptions,
  type PdfWorkerClient,
} from '@pdfmason/pdf-engine/browser';
import { reviewDecorationSourcePage } from './decoration-source-review.js';
import { DecorationPlacementPanel } from './decoration-placement-panel.js';

interface Props {
  readonly createWorker?: () => Worker;
}
interface Candidate {
  readonly bytes: Uint8Array;
  readonly document: BrowserPdfDocument;
  readonly options: PdfDecorationOptions;
  readonly selectedPages: readonly number[];
}

const errorCopy = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  const messages: Readonly<Record<string, string>> = {
    DECORATION_PAGE_RANGE_INVALID:
      'Use pages that exist in this PDF, without repeated or overlapping ranges.',
    DECORATION_NO_PAGES: 'That selection contains no pages. Choose a different range.',
    DECORATION_OPTIONS_INVALID: 'Check the text, range, font size, and margin settings.',
    DECORATION_TEXT_DOES_NOT_FIT:
      'A header or footer does not fit. Shorten the text, reduce its size, or adjust the margin.',
    DECORATION_PAGE_BOX_UNSUPPORTED:
      'This PDF has unusual page boxes or physical units. Placement cannot be verified safely.',
    DECORATION_ROTATION_UNSUPPORTED: 'A page uses a rotation other than 0°, 90°, 180°, or 270°.',
    DECORATION_TEXT_ENCODING_UNSUPPORTED:
      'Use basic Latin characters for this text in the current build.',
    DECORATION_ACTIVE_CONTENT_BLOCKED: 'This PDF contains active content. Adding marks is blocked.',
    DECORATION_ATTACHMENTS_BLOCKED:
      'This PDF contains attachments whose fidelity is not verified for this operation.',
    DECORATION_SIGNATURES_BLOCKED:
      'Adding marks would invalidate a certificate signature. This PDF is blocked.',
    DECORATION_PASSWORD_REQUIRED: 'Unlock an authorized copy before adding marks.',
    DECORATION_XFA_BLOCKED: 'This PDF uses unsupported XFA forms. Adding marks is blocked.',
    DECORATION_PAGE_LIMIT: 'Choose a PDF with no more than 500 pages.',
    LIMIT_BYTES: 'The preview exceeds the 50 MB local limit.',
  };
  return `${messages[code] ?? 'The preview could not be built safely. Check the file and settings, then try again.'} Your original is unchanged.`;
};

/** EDIT-006 / EDIT-007: review and download the very same in-memory PDF. */
export const DecorationWorkbench = ({ createWorker }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('Page {page} of {pages}');
  const [headerAlignment, setHeaderAlignment] = useState<DecorationAlignment>('left');
  const [footerAlignment, setFooterAlignment] = useState<DecorationAlignment>('right');
  const [fontSize, setFontSize] = useState('9');
  const [margin, setMargin] = useState('28');
  const [selection, setSelection] = useState<DecorationPageSelection>('all');
  const [range, setRange] = useState('');
  const [watermark, setWatermark] = useState('');
  const [opacity, setOpacity] = useState(0.16);
  const [angle, setAngle] = useState(-35);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [placementReviews, setPlacementReviews] = useState<
    Readonly<Partial<Record<number, DecorationPlacementReview>>>
  >({});
  const [phase, setPhase] = useState<'idle' | 'building' | 'rendering' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('Choose a PDF, set the marks, then build a preview.');
  const generation = useRef(0);
  const clientRef = useRef<PdfWorkerClient | null>(null);
  const documentRef = useRef<BrowserPdfDocument | null>(null);
  const sourceRef = useRef<BrowserPdfDocument | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const release = (): void => {
    generation.current += 1;
    clientRef.current?.terminate();
    clientRef.current = null;
    const document = documentRef.current;
    documentRef.current = null;
    if (document !== null) void document.destroy().catch(() => undefined);
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source !== null) void source.destroy().catch(() => undefined);
  };
  useEffect(() => release, []);

  const invalidate = (): void => {
    release();
    setCandidate(null);
    setReviewed(false);
    setPlacementReviews({});
    setPhase('idle');
    setMessage('Settings changed. Build a new preview before downloading.');
    const canvas = canvasRef.current;
    if (canvas !== null) {
      canvas.width = 1;
      canvas.height = 1;
    }
  };
  const options: PdfDecorationOptions = {
    footer:
      footer.trim() === ''
        ? null
        : {
            alignment: footerAlignment,
            color: '#17232d',
            fontSize: Number(fontSize),
            text: footer,
          },
    header:
      header.trim() === ''
        ? null
        : {
            alignment: headerAlignment,
            color: '#17232d',
            fontSize: Number(fontSize),
            text: header,
          },
    marginPoints: Number(margin),
    pageSelection: selection,
    ...(selection === 'custom' ? { pageRange: range } : {}),
    watermark:
      watermark.trim() === ''
        ? null
        : { color: '#60717c', fontSize: 48, opacity, rotation: angle, text: watermark },
  };
  const valid = isPdfDecorationOptions(options);
  const busy = phase === 'building' || phase === 'rendering';

  const render = async (
    document: BrowserPdfDocument,
    page: number,
    request: number,
  ): Promise<boolean> => {
    const metrics = await document.getPageMetrics(page - 1);
    if (
      !Number.isFinite(metrics.width) ||
      !Number.isFinite(metrics.height) ||
      metrics.width <= 0 ||
      metrics.height <= 0
    )
      throw new Error('DECORATION_PAGE_BOX_UNSUPPORTED');
    // At most 960 × 1200 CSS pixels, and the adapter caps device scale at two.
    const scale = Math.min(1.25, 960 / metrics.width, 1200 / metrics.height);
    const staging = window.document.createElement('canvas');
    try {
      await document.renderPage(staging, page - 1, scale);
      if (generation.current !== request || canvasRef.current === null) return false;
      const canvas = canvasRef.current;
      canvas.width = staging.width;
      canvas.height = staging.height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('DECORATION_PREVIEW_UNAVAILABLE');
      context.drawImage(staging, 0, 0);
      return true;
    } finally {
      staging.width = 1;
      staging.height = 1;
    }
  };

  const build = async (): Promise<void> => {
    if (file === null || !valid || createWorker === undefined || busy) return;
    invalidate();
    const request = generation.current;
    setPhase('building');
    setMessage('Building and verifying a new PDF in the local worker…');
    try {
      const client = createPdfWorkerClient(createWorker());
      clientRef.current = client;
      const source = new Uint8Array(await file.arrayBuffer());
      if (generation.current !== request) return;
      const bytes = await client.decorate(source, options);
      if (generation.current !== request) return;
      client.terminate();
      clientRef.current = null;
      setPhase('rendering');
      setMessage('Rendering the first selected page of the new PDF…');
      const document = await openBrowserPdf(bytes);
      if (generation.current !== request) {
        await document.destroy();
        return;
      }
      documentRef.current = document;
      const selectedPages = resolveDecorationPages(options, document.pageCount);
      const first = selectedPages[0] ?? 1;
      if (options.header !== null || options.footer !== null) {
        try {
          const sourceDocument = await openBrowserPdf(source, { strictParsing: true });
          if (generation.current !== request) {
            await sourceDocument.destroy();
            return;
          }
          sourceRef.current = sourceDocument;
        } catch {
          // A source sampling failure does not change the candidate or manufacture a negative finding.
          if (generation.current !== request) return;
        }
      }
      setMessage('Checking the first selected source-page margin bands…');
      const placement = await reviewDecorationSourcePage(
        sourceRef.current,
        first,
        options,
        () => generation.current === request,
      );
      if (generation.current !== request) return;
      if (!(await render(document, first, request))) return;
      setPlacementReviews({ [first]: placement });
      setCandidate({ bytes, document, options, selectedPages });
      setPageNumber(first);
      setPhase('ready');
      setMessage(
        `Preview ready. ${selectedPages.length} of ${document.pageCount} pages receive marks. Review placement before downloading.`,
      );
    } catch (error: unknown) {
      if (generation.current !== request) return;
      release();
      setCandidate(null);
      setPhase('error');
      setMessage(errorCopy(error));
    }
  };

  const showPage = async (page: number): Promise<void> => {
    if (
      candidate === null ||
      busy ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > candidate.document.pageCount
    )
      return;
    const request = ++generation.current;
    setReviewed(false);
    setPhase('rendering');
    setMessage(`Rendering preview page ${page}…`);
    try {
      if (candidate.selectedPages.includes(page) && placementReviews[page] === undefined) {
        const placement = await reviewDecorationSourcePage(
          sourceRef.current,
          page,
          candidate.options,
          () => generation.current === request,
        );
        if (generation.current !== request) return;
        setPlacementReviews((previous) => ({ ...previous, [page]: placement }));
      }
      if (!(await render(candidate.document, page, request))) return;
      setPageNumber(page);
      setPhase('ready');
      setMessage(
        `Preview page ${page} of ${candidate.document.pageCount}. ${candidate.selectedPages.includes(page) ? 'Marks applied.' : 'No marks applied to this page.'}`,
      );
    } catch (error: unknown) {
      if (generation.current !== request) return;
      release();
      setCandidate(null);
      setPhase('error');
      setMessage(errorCopy(error));
    }
  };
  const download = (): void => {
    if (candidate === null || !reviewed || phase !== 'ready') return;
    const url = URL.createObjectURL(
      new Blob([candidate.bytes.slice().buffer], { type: 'application/pdf' }),
    );
    try {
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = 'pdfmason-decorated.pdf';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    setMessage('Reviewed copy downloaded. Your original remains unchanged.');
  };

  const selectedPage = candidate?.selectedPages.includes(pageNumber) === true;
  const pageText = (value: string | undefined): string =>
    value
      ?.replaceAll('{page}', String(pageNumber))
      .replaceAll('{pages}', String(candidate?.document.pageCount ?? 0)) ?? 'None';
  return (
    <div className="decoration-workbench">
      <label className="utility-dropzone">
        <input
          accept="application/pdf,.pdf"
          type="file"
          onChange={(event) => {
            invalidate();
            const chosen = event.currentTarget.files?.[0];
            if (chosen === undefined) {
              setFile(null);
              setMessage('Choose a PDF to begin.');
              return;
            }
            if (
              chosen.size === 0 ||
              chosen.size > 50 * 1024 * 1024 ||
              chosen.type !== 'application/pdf'
            ) {
              setFile(null);
              setPhase('error');
              setMessage('Choose a PDF up to 50 MB. Your original is unchanged.');
              return;
            }
            setFile(chosen);
            setMessage('PDF ready. Build a preview when your settings are ready.');
          }}
        />
        <span className="utility-dropzone__mark" aria-hidden="true">
          +
        </span>
        <strong>Choose a PDF</strong>
        <span>One PDF · up to 50 MB and 500 pages · never uploaded</span>
      </label>
      <div className="decoration-panel">
        <div className="metadata-grid">
          <label className="field-label">
            Header text (optional)
            <input
              maxLength={120}
              value={header}
              onChange={(event) => {
                invalidate();
                setHeader(event.currentTarget.value);
              }}
              placeholder="Review copy"
            />
          </label>
          <label className="field-label">
            Header alignment
            <select
              value={headerAlignment}
              onChange={(event) => {
                invalidate();
                setHeaderAlignment(event.currentTarget.value as DecorationAlignment);
              }}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="field-label">
            Footer text (optional)
            <input
              maxLength={120}
              value={footer}
              onChange={(event) => {
                invalidate();
                setFooter(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field-label">
            Footer alignment
            <select
              value={footerAlignment}
              onChange={(event) => {
                invalidate();
                setFooterAlignment(event.currentTarget.value as DecorationAlignment);
              }}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="field-label">
            Header/footer size (pt)
            <input
              type="number"
              min={6}
              max={24}
              step="any"
              value={fontSize}
              onChange={(event) => {
                invalidate();
                setFontSize(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field-label">
            Edge margin (pt)
            <input
              type="number"
              min={12}
              max={72}
              step="any"
              value={margin}
              onChange={(event) => {
                invalidate();
                setMargin(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field-label">
            Apply to pages
            <select
              value={selection}
              onChange={(event) => {
                invalidate();
                setSelection(event.currentTarget.value as DecorationPageSelection);
              }}
            >
              <option value="all">All pages</option>
              <option value="first">First page only</option>
              <option value="odd">Odd pages</option>
              <option value="even">Even pages</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {selection === 'custom' && (
            <label className="field-label">
              PDF page range
              <input
                aria-describedby="decoration-range-help"
                maxLength={1000}
                placeholder="1, 3-5"
                value={range}
                onChange={(event) => {
                  invalidate();
                  setRange(event.currentTarget.value);
                }}
              />
            </label>
          )}
        </div>
        <p id="decoration-range-help" className="fidelity-note">
          Use 1-based PDF page positions, not logical page labels. Separate pages/ranges with
          commas; no repeats or overlaps. {'{page}'} and {'{pages}'} keep the original page position
          and total.
        </p>
        <details className="decoration-watermark">
          <summary>Optional text watermark</summary>
          <div className="metadata-grid">
            <label className="field-label">
              Watermark text (optional)
              <input
                maxLength={120}
                value={watermark}
                onChange={(event) => {
                  invalidate();
                  setWatermark(event.currentTarget.value);
                }}
                placeholder="DRAFT"
              />
            </label>
            <label className="field-label">
              Watermark strength
              <select
                value={opacity}
                onChange={(event) => {
                  invalidate();
                  setOpacity(Number(event.currentTarget.value));
                }}
              >
                <option value="0.1">Subtle</option>
                <option value="0.16">Standard</option>
                <option value="0.25">Strong</option>
              </select>
            </label>
            <label className="field-label">
              Watermark angle
              <select
                value={angle}
                onChange={(event) => {
                  invalidate();
                  setAngle(Number(event.currentTarget.value));
                }}
              >
                <option value="-45">45° rising</option>
                <option value="-35">35° rising</option>
                <option value="0">Horizontal</option>
                <option value="35">35° falling</option>
                <option value="45">45° falling</option>
              </select>
            </label>
          </div>
        </details>
        <p className="fidelity-note">
          Repeating marks become PDF artifacts, not editable review annotations. Existing
          signatures, XFA, attachments, active content, encryption, and unsupported text encoding
          stop safely. Backgrounds, custom fonts, removal, and automatic overlap detection are not
          available. Source-pixel warnings are advisory, not an overlap guarantee.
        </p>
      </div>
      <div className="decoration-preview-actions">
        <button
          className="button button--secondary"
          disabled={file === null || !valid || busy || createWorker === undefined}
          onClick={() => void build()}
          type="button"
        >
          Build preview
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
            Cancel preview
          </button>
        )}
        {!valid && <span>Check the text, range, size, and margin settings.</span>}
      </div>
      <section aria-label="Decoration preview" className="decoration-preview">
        <header>
          <div>
            <p className="eyebrow">Actual output · on this device</p>
            <h3>Check the page before you save.</h3>
          </div>
          <span className="decoration-preview__badge">
            {candidate === null ? 'Not built' : selectedPage ? 'Marks applied' : 'Unchanged page'}
          </span>
        </header>
        {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- WCAG 2.1.1 requires keyboard focus for this scrollable region. */}
        <div
          className="decoration-preview__canvas"
          tabIndex={0}
          role="region"
          aria-label="Scrollable PDF preview"
          hidden={candidate === null || phase !== 'ready'}
        >
          <canvas
            ref={canvasRef}
            aria-label={`Rendered decoration preview, PDF page ${pageNumber}`}
            role="img"
          />
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
        {candidate === null && (
          <p className="decoration-preview__empty">
            Build a preview to see your marks on the source page. A preview is not an overlap or
            accessibility certification.
          </p>
        )}
        {candidate !== null && (
          <>
            <nav aria-label="Preview page navigation" className="decoration-preview__navigation">
              <button
                type="button"
                disabled={busy || pageNumber === 1}
                onClick={() => void showPage(pageNumber - 1)}
              >
                Previous preview page
              </button>
              <label>
                Preview page
                <select
                  aria-label="Preview page"
                  value={pageNumber}
                  disabled={busy}
                  onChange={(event) => void showPage(Number(event.currentTarget.value))}
                >
                  {Array.from({ length: candidate.document.pageCount }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || pageNumber === candidate.document.pageCount}
                onClick={() => void showPage(pageNumber + 1)}
              >
                Next preview page
              </button>
            </nav>
            <p className="decoration-preview__selection">
              {candidate.selectedPages.length} of {candidate.document.pageCount} pages receive
              marks. Preview page {pageNumber}:{' '}
              {selectedPage ? 'marks applied' : 'no marks applied'}.
            </p>
            {selectedPage && (
              <dl className="decoration-preview__text">
                <dt>Header</dt>
                <dd>{pageText(candidate.options.header?.text)}</dd>
                <dt>Footer</dt>
                <dd>{pageText(candidate.options.footer?.text)}</dd>
                <dt>Watermark</dt>
                <dd>{pageText(candidate.options.watermark?.text)}</dd>
              </dl>
            )}
            <DecorationPlacementPanel
              pageNumber={pageNumber}
              selectedPages={candidate.selectedPages}
              reviews={placementReviews}
              busy={busy}
              hasWatermark={candidate.options.watermark !== null}
              onNavigate={(page) => void showPage(page)}
            />
            <label className="authorization-check">
              {/* The same candidate still requires manual review regardless of sampling results. */}
              <input
                type="checkbox"
                checked={reviewed}
                disabled={phase !== 'ready'}
                onChange={(event) => setReviewed(event.currentTarget.checked)}
              />
              I checked the relevant pages for overlap and placement.
            </label>
            <p className="fidelity-note">
              Inspect selected pages, especially mixed sizes and existing headers. Download saves
              the same PDF bytes used by this preview; margin warnings do not change the output.
            </p>
          </>
        )}
      </section>
      <div
        className={`utility-status utility-status--${phase === 'error' ? 'error' : busy ? 'working' : 'ready'}`}
        role="status"
      >
        <span aria-hidden="true" className="utility-status__indicator" />
        <span>{message}</span>
      </div>
      <footer className="utility-actions">
        <span>No source file is overwritten.</span>
        <button
          className="button button--primary"
          disabled={candidate === null || !reviewed || phase !== 'ready'}
          type="button"
          onClick={download}
        >
          Download reviewed copy
        </button>
      </footer>
    </div>
  );
};
