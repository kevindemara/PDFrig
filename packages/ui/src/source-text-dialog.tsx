'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  openBrowserPdf,
  runLocalTextOperation,
  recognizeLocalPage,
  type BrowserPdfDocument,
  type SourceTextRun,
} from '@pdfmason/pdf-engine/browser';
import { useDialogFocus } from './dialog-focus.js';
import { matchSourceTextSelection, type PdfTextSelection } from './source-text-selection.js';

interface Props {
  bytes: Uint8Array;
  document: BrowserPdfDocument;
  pageIndex: number;
  mode: 'edit' | 'ocr';
  initialSelection?: PdfTextSelection | null;
  onClose: () => void;
  onApply: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>;
}
export function SourceTextDialog({
  bytes,
  document,
  pageIndex,
  mode,
  initialSelection,
  onClose,
  onApply,
}: Props) {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef(new AbortController());
  const candidateRef = useRef<BrowserPdfDocument | null>(null);
  const [runs, setRuns] = useState<readonly SourceTextRun[]>([]);
  const [selected, setSelected] = useState('');
  const [replacement, setReplacement] = useState('');
  const [fitToSpace, setFitToSpace] = useState(true);
  const [language, setLanguage] = useState<'eng' | 'fra'>('eng');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(mode === 'edit');
  const [candidate, setCandidate] = useState<Uint8Array | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [recognized, setRecognized] = useState('');
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    controller.current = lifetime;
    if (mode === 'edit') {
      void runLocalTextOperation({ kind: 'inspect', bytes, pageIndex }, lifetime.signal)
        .then((items) => {
          if (!lifetime.signal.aborted) {
            setRuns(items);
            const match = initialSelection
              ? matchSourceTextSelection(items, initialSelection)
              : null;
            const first = match
              ? items.find((item) => item.id === match.id)
              : initialSelection
                ? undefined
                : items[0];
            setSelected(first?.id ?? '');
            setRange(match ? { start: match.start, end: match.end } : null);
            setReplacement(
              first ? (match ? first.text.slice(match.start, match.end) : first.text) : '',
            );
            setStatus(
              initialSelection
                ? match
                  ? 'Your selected text is ready to edit. Build the PDF preview below to enable review and apply.'
                  : 'Your selection could not be matched safely to one supported line. Reselect a word or line, or explicitly choose a line below. No unrelated text was chosen.'
                : items.length
                  ? 'Choose a text line below, or select words on the page before opening this editor.'
                  : 'No safely editable text runs on this page. Scans use OCR search/copy; unsupported fonts remain read-only.',
            );
          }
        })
        .catch(() => {
          if (!lifetime.signal.aborted)
            setStatus('This document cannot safely use original-text editing.');
        })
        .finally(() => {
          if (!lifetime.signal.aborted) setBusy(false);
        });
    }
    return () => {
      lifetime.abort();
      void candidateRef.current?.destroy();
    };
  }, [bytes, pageIndex, mode, initialSelection]);
  const invalidate = useCallback(() => {
    setCandidate(null);
    setReviewed(false);
    void candidateRef.current?.destroy();
    candidateRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.width = canvas.height = 0;
    setStatus('Preview needed. Build the actual PDF preview to enable review and apply.');
  }, []);
  const build = async () => {
    invalidate();
    setBusy(true);
    setStatus('Preparing local output…');
    try {
      const signal = controller.current.signal;
      const isCancelled = () => signal.aborted;
      let output: Uint8Array;
      if (mode === 'edit') {
        const run = runs.find((item) => item.id === selected);
        if (!run) throw new Error('SOURCE_TEXT_UNSUPPORTED');
        output = await runLocalTextOperation(
          {
            kind: 'replace',
            bytes,
            id: selected,
            expectedText: run.text,
            replacement,
            fitToSpace,
            ...(range ? { range } : {}),
          },
          signal,
        );
      } else {
        const words = await recognizeLocalPage(document, pageIndex, language, signal, (percent) =>
          setStatus(`Recognizing locally: ${percent}%`),
        );
        setRecognized(words.map((word) => word.text).join(' '));
        output = await runLocalTextOperation({ kind: 'ocr', bytes, pageIndex, words }, signal);
      }
      if (isCancelled()) return;
      const preview = await openBrowserPdf(output, { strictParsing: true });
      if (isCancelled()) {
        await preview.destroy();
        return;
      }
      candidateRef.current = preview;
      const metrics = await preview.getPageMetrics(pageIndex);
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('LOCAL_TEXT_FAILED');
      await preview.renderPage(
        canvas,
        pageIndex,
        Math.min(1, 620 / metrics.width),
        0,
        1,
        'opaque',
        signal,
      );
      if (!controller.current.signal.aborted) {
        setCandidate(output);
        setStatus(
          mode === 'ocr'
            ? 'Scan appearance is unchanged. Review recognized words; OCR can make mistakes.'
            : `This is the actual exported-PDF preview, using the original font and size.${fitToSpace ? ' Fit-to-space is enabled: wider replacement text is narrowed horizontally. Review its appearance before applying.' : ''}`,
        );
      }
    } catch (error) {
      if (!controller.current.signal.aborted)
        setStatus(
          error instanceof Error && error.message === 'SOURCE_TEXT_REPLACEMENT_TOO_WIDE'
            ? 'The replacement is wider in this font. Choose Fit to selected space under Replacement width, then build the preview again. Nothing was changed.'
            : error instanceof Error && error.message === 'SOURCE_TEXT_GLYPH_UNSUPPORTED'
              ? 'The original font does not contain these characters. No substitution was made.'
              : error instanceof Error && error.message === 'OCR_PAGE_ALREADY_SEARCHABLE'
                ? 'This page already contains searchable text. OCR was not added a second time; use Select text or Edit existing text.'
                : error instanceof Error && error.message === 'SOURCE_TEXT_SELECTION_UNSUPPORTED'
                  ? 'This selection crosses an unsupported text boundary. Select a complete supported word or choose a line below. Nothing was changed.'
                  : error instanceof Error &&
                      error.message === 'SOURCE_TEXT_ACCESSIBILITY_UNSUPPORTED'
                    ? 'This selection cannot yet be edited while preserving its accessibility text. Nothing was changed.'
                    : 'Could not safely build this copy. The source is unchanged. Review and apply stay unavailable until a preview succeeds. Try a supported page or shorter text.',
        );
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-modal="true"
        aria-labelledby="source-text-title"
        role="dialog"
        className="source-text-dialog"
        ref={dialogRef}
      >
        <header>
          <h2 id="source-text-title">
            {mode === 'edit' ? 'Edit existing text' : 'OCR · search and copy'}
          </h2>
          <button
            className="button button--secondary"
            type="button"
            ref={closeRef}
            onClick={onClose}
          >
            Cancel
          </button>
        </header>
        <p>
          On this device. No upload. Creates a new source revision with undo; your original file
          stays unchanged.
        </p>
        {mode === 'edit' ? (
          <>
            <p>
              Uses the original font, size and baseline. Fit to selected space allows wider text by
              narrowing it horizontally, without moving surrounding text. No paragraph reflow or
              covering overlays. Printable ASCII and supported existing glyphs only.
            </p>
            <label className="field-stack">
              {range ? 'Source line (context)' : 'Original text'}
              <select
                disabled={busy}
                value={selected}
                onChange={(event) => {
                  invalidate();
                  setSelected(event.target.value);
                  setRange(null);
                  setReplacement(runs.find((run) => run.id === event.target.value)?.text ?? '');
                }}
              >
                <option value="">Choose a text line</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.text}
                  </option>
                ))}
              </select>
            </label>
            {range && (
              <label className="field-stack">
                Selected text (only this will change)
                <input
                  readOnly
                  value={
                    runs.find((run) => run.id === selected)?.text.slice(range.start, range.end) ??
                    ''
                  }
                />
              </label>
            )}
            <label className="field-stack">
              Replacement text
              <input
                disabled={busy}
                maxLength={4096}
                value={replacement}
                onChange={(event) => {
                  invalidate();
                  setReplacement(event.target.value);
                }}
              />
            </label>
            <label className="field-stack">
              Replacement width
              <select
                disabled={busy}
                value={fitToSpace ? 'fit' : 'strict'}
                onChange={(event) => {
                  invalidate();
                  setFitToSpace(event.target.value === 'fit');
                }}
              >
                <option value="fit">Fit to selected space (allow wider text)</option>
                <option value="strict">Keep original character proportions (must fit)</option>
              </select>
              <small>
                Fitting keeps the font size and surrounding positions, but long replacements can
                look compressed. Review the actual PDF before applying.
              </small>
            </label>
          </>
        ) : (
          <>
            <p>
              Recognizes this page only. Adds invisible text for search/copy; it does not change
              scanned words visually. Existing reading-order tags are retained; new OCR text is
              untagged.
            </p>
            <label className="field-stack">
              OCR language
              <select
                disabled={busy}
                value={language}
                onChange={(event) => {
                  invalidate();
                  setRecognized('');
                  setLanguage(event.target.value as 'eng' | 'fra');
                }}
              >
                <option value="eng">English</option>
                <option value="fra">French</option>
              </select>
            </label>
            {recognized && (
              <label className="field-stack">
                Recognized text
                <textarea readOnly value={recognized} rows={3} />
              </label>
            )}
          </>
        )}
        <button
          className="button button--primary"
          type="button"
          disabled={busy || (mode === 'edit' && (!selected || !replacement))}
          onClick={() => void build()}
        >
          {busy ? 'Working…' : 'Build actual PDF preview'}
        </button>
        <p role="status">{status}</p>
        {!candidate && !busy && (
          <p className="source-text-review-help">
            First build the preview. Once it appears, review it and check the box to enable Apply
            reviewed copy.
          </p>
        )}
        <div
          hidden={!candidate && !busy}
          className="source-text-preview"
          role="region"
          aria-label="Scrollable exported PDF preview"
          tabIndex={0}
        >
          <canvas ref={canvasRef} aria-label="Actual exported PDF preview" />
        </div>
        <label className="source-text-review">
          <input
            type="checkbox"
            disabled={!candidate || busy}
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />{' '}
          I reviewed the actual output and {mode === 'ocr' ? 'recognized text' : 'text layout'}.
        </label>
        <button
          className="button button--primary"
          type="button"
          disabled={!candidate || !reviewed || busy}
          onClick={() => {
            if (!candidate) return;
            setBusy(true);
            const signal = controller.current.signal;
            void onApply(candidate, signal)
              .then(() => {
                if (!signal.aborted) onClose();
              })
              .catch(() => {
                if (signal.aborted) return;
                setBusy(false);
                setStatus('The editor changed; this copy was not applied.');
              });
          }}
        >
          Apply reviewed copy
        </button>
      </section>
    </div>
  );
}
