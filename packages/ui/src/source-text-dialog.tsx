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

interface Props {
  bytes: Uint8Array;
  document: BrowserPdfDocument;
  pageIndex: number;
  mode: 'edit' | 'ocr';
  onClose: () => void;
  onApply: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>;
}
export function SourceTextDialog({ bytes, document, pageIndex, mode, onClose, onApply }: Props) {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef(new AbortController());
  const candidateRef = useRef<BrowserPdfDocument | null>(null);
  const [runs, setRuns] = useState<readonly SourceTextRun[]>([]);
  const [selected, setSelected] = useState('');
  const [replacement, setReplacement] = useState('');
  const [language, setLanguage] = useState<'eng' | 'fra'>('eng');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(mode === 'edit');
  const [candidate, setCandidate] = useState<Uint8Array | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [recognized, setRecognized] = useState('');
  useEffect(() => {
    const lifetime = new AbortController();
    controller.current = lifetime;
    if (mode === 'edit') {
      void runLocalTextOperation({ kind: 'inspect', bytes, pageIndex }, lifetime.signal)
        .then((items) => {
          if (!lifetime.signal.aborted) {
            setRuns(items);
            setSelected(items[0]?.id ?? '');
            setReplacement(items[0]?.text ?? '');
            setStatus(
              items.length
                ? ''
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
  }, [bytes, pageIndex, mode]);
  const invalidate = useCallback(() => {
    setCandidate(null);
    setReviewed(false);
    void candidateRef.current?.destroy();
    candidateRef.current = null;
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
          { kind: 'replace', bytes, id: selected, expectedText: run.text, replacement },
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
            : 'This is the actual exported-PDF preview, using the original font and size.',
        );
      }
    } catch (error) {
      if (!controller.current.signal.aborted)
        setStatus(
          error instanceof Error && error.message === 'SOURCE_TEXT_REPLACEMENT_TOO_WIDE'
            ? 'Replacement is too wide. Shorten it to preserve the original layout.'
            : error instanceof Error && error.message === 'SOURCE_TEXT_GLYPH_UNSUPPORTED'
              ? 'The original font does not contain these characters. No substitution was made.'
              : error instanceof Error && error.message === 'OCR_PAGE_ALREADY_SEARCHABLE'
                ? 'This page already contains searchable text. OCR was not added a second time; use Select text or Edit existing text.'
                : 'Could not safely build this copy. The source is unchanged. Try a supported page or shorter text.',
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
          <button type="button" ref={closeRef} onClick={onClose}>
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
              Original font, size and placement are preserved. Printable ASCII text and existing
              supported glyphs only; replacement must fit. No paragraph reflow or covering overlays.
            </p>
            <label className="field-stack">
              Original text
              <select
                disabled={busy}
                value={selected}
                onChange={(event) => {
                  invalidate();
                  setSelected(event.target.value);
                  setReplacement(runs.find((run) => run.id === event.target.value)?.text ?? '');
                }}
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.text}
                  </option>
                ))}
              </select>
            </label>
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
          type="button"
          disabled={busy || (mode === 'edit' && (!selected || !replacement))}
          onClick={() => void build()}
        >
          {busy ? 'Working…' : 'Build actual PDF preview'}
        </button>
        <p role="status">{status}</p>
        <div
          className="source-text-preview"
          role="region"
          aria-label="Scrollable exported PDF preview"
          tabIndex={0}
        >
          <canvas ref={canvasRef} aria-label="Actual exported PDF preview" />
        </div>
        <label>
          <input
            type="checkbox"
            disabled={!candidate || busy}
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />{' '}
          I reviewed the actual output and {mode === 'ocr' ? 'recognized text' : 'text layout'}.
        </label>
        <button
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
